import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { parseTxData } from "./parser.js";
import {
  PUMPFUN_PROGRAM_ID,
  RPCURL,
  COMMITMENT,
} from "../constants/constants.js";
import { fetchSolPriceUsd } from "./market-data.js";

const PUMP_DECIMALS = 6;
const seenSignatures = new Map();
const lastSignature = new Map();

let connection;

function getConnection() {
  if (!connection) {
    connection = new Connection(RPCURL, COMMITMENT || "confirmed");
  }
  return connection;
}

function resolveAccountKeys(message, meta) {
  const staticKeys = (message.accountKeys ?? message.staticAccountKeys ?? []).map(
    (key) => (typeof key === "string" ? key : bs58.encode(key)),
  );
  const loadedWritable = (meta?.loadedWritableAddresses ?? []).map((k) =>
    bs58.encode(k),
  );
  const loadedReadonly = (meta?.loadedReadonlyAddresses ?? []).map((k) =>
    bs58.encode(k),
  );
  return [...staticKeys, ...loadedWritable, ...loadedReadonly];
}

function rpcTxToParserFormat(rpcTx, signature) {
  const message = rpcTx.transaction.message;
  const meta = rpcTx.meta;

  const accountKeys = (message.accountKeys ?? message.staticAccountKeys ?? []).map(
    (key) => new Uint8Array(typeof key === "string" ? bs58.decode(key) : key),
  );
  const instructions = (message.instructions ?? message.compiledInstructions ?? []).map(
    (ix) => ({
      programIdIndex: ix.programIdIndex,
      accounts: Array.from(ix.accounts ?? ix.accountKeyIndexes ?? []),
      data: new Uint8Array(
        typeof ix.data === "string" ? bs58.decode(ix.data) : (ix.data ?? []),
      ),
    }),
  );

  const innerInstructions = (meta?.innerInstructions ?? []).map((group) => ({
    index: group.index ?? 0,
    instructions: (group.instructions ?? []).map((ix) => ({
      programIdIndex: ix.programIdIndex ?? 0,
      accounts: Array.from(ix.accounts ?? []),
      data: new Uint8Array(
        typeof ix.data === "string" ? bs58.decode(ix.data) : (ix.data ?? []),
      ),
    })),
  }));

  return {
    signature,
    slot: rpcTx.slot,
    message: {
      accountKeys,
      instructions,
      innerInstructions,
      loadedWritableAddresses: (meta?.loadedWritableAddresses ?? []).map(
        (k) => new Uint8Array(k),
      ),
      loadedReadonlyAddresses: (meta?.loadedReadonlyAddresses ?? []).map(
        (k) => new Uint8Array(k),
      ),
    },
    logs: meta?.logMessages ?? [],
  };
}

function extractSolAmount(rpcTx, event) {
  const user = event.user;
  if (!user) return 0;

  const message = rpcTx.transaction.message;
  const accountKeys = resolveAccountKeys(message, rpcTx.meta);
  const index = accountKeys.indexOf(user);
  if (index < 0) return 0;

  const pre = rpcTx.meta.preBalances[index] ?? 0;
  const post = rpcTx.meta.postBalances[index] ?? 0;
  const fee = index === 0 ? (rpcTx.meta.fee ?? 0) : 0;

  if (event.type === "buy") {
    return Math.max(0, (pre - post - fee) / 1e9);
  }
  if (event.type === "sell") {
    return Math.max(0, (post - pre) / 1e9);
  }
  return 0;
}

function trimSeen(mint) {
  const seen = seenSignatures.get(mint);
  if (!seen || seen.size <= 500) return;
  const keep = [...seen].slice(-500);
  seenSignatures.set(mint, new Set(keep));
}

/**
 * Fetch new pump.fun buy/sell txs for a mint and append them to TokenState.
 * @returns {number} count of newly recorded trades
 */
export async function syncPumpTrades(mint, state) {
  if (!PUMPFUN_PROGRAM_ID || !RPCURL) return 0;

  const conn = getConnection();
  const seen = seenSignatures.get(mint) ?? new Set();
  const options = { limit: 30 };
  const prev = lastSignature.get(mint);
  if (prev) options.until = prev;

  let sigInfos;
  try {
    sigInfos = await conn.getSignaturesForAddress(new PublicKey(mint), options);
  } catch {
    return 0;
  }

  if (sigInfos.length === 0) return 0;

  lastSignature.set(mint, sigInfos[0].signature);

  const solPriceUsd = await fetchSolPriceUsd();
  let added = 0;

  for (const { signature, err } of [...sigInfos].reverse()) {
    if (err || seen.has(signature)) continue;

    let rpcTx;
    try {
      rpcTx = await conn.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: COMMITMENT || "confirmed",
      });
    } catch {
      continue;
    }
    if (!rpcTx?.meta) continue;

    const txData = rpcTxToParserFormat(rpcTx, signature);
    const events = parseTxData(txData, PUMPFUN_PROGRAM_ID).filter(
      (e) => e.mint === mint && (e.type === "buy" || e.type === "sell"),
    );

    for (const event of events) {
      const solAmount = extractSolAmount(rpcTx, event);
      const tokenAmount = Number(event.amount) / 10 ** PUMP_DECIMALS;
      const priceUsd =
        solAmount > 0 && tokenAmount > 0
          ? (solAmount / tokenAmount) * solPriceUsd
          : null;

      state.addTrade({
        side: event.type,
        solAmount,
        tokenAmount,
        priceUsd,
        timestamp: rpcTx.blockTime ?? Math.floor(Date.now() / 1000),
      });

      if (priceUsd) {
        state.addPrice(priceUsd, (rpcTx.blockTime ?? Date.now() / 1000) * 1000);
      }
      added++;
    }

    seen.add(signature);
  }

  seenSignatures.set(mint, seen);
  trimSeen(mint);
  return added;
}
