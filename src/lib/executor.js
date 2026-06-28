import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import BN from "bn.js";
import bs58 from "bs58";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
} from "@pump-fun/pump-sdk";
import { RPCURL, COMMITMENT, PRIVATE_KEY, EXECUTE_TRADES, TRADE_SOL, SLIPPAGE_PCT, PRIORITY_FEE_MICROLAMPORTS, COMPUTE_UNIT_LIMIT, BLOCKHASH_REFRESH_MS } from "../constants/constants.js";

export const EXECUTE_TRADES = Number(EXECUTE_TRADES);
export const TRADE_SOL = Number(TRADE_SOL);
export const SLIPPAGE_PCT = Number(SLIPPAGE_PCT);
export const PRIORITY_FEE_MICROLAMPORTS = Number(PRIORITY_FEE_MICROLAMPORTS);
export const COMPUTE_UNIT_LIMIT = Number(COMPUTE_UNIT_LIMIT);
export const BLOCKHASH_REFRESH_MS = Number(BLOCKHASH_REFRESH_MS);

let wallet = null;
let connection = null;
let onlineSdk = null;
let blockhashLoopStarted = false;

const cachedBlockhash = {
  blockhash: null,
  lastValidBlockHeight: 0,
  ts: 0,
};
const cachedGlobal = { value: null, ts: 0 };
const inFlightMints = new Set();

function loadWallet() {
  if (wallet) return wallet;
  const raw = PRIVATE_KEY?.trim();
  if (!raw) throw new Error("PRIVATE_KEY is not set in .env");
  wallet = Keypair.fromSecretKey(bs58.decode(raw));
  return wallet;
}

function getConnection() {
  if (!connection) {
    if (!RPCURL) throw new Error("RPC_URL is not set in .env");
    connection = new Connection(RPCURL, COMMITMENT || "confirmed");
  }
  return connection;
}

function getOnlineSdk() {
  if (!onlineSdk) onlineSdk = new OnlinePumpSdk(getConnection());
  return onlineSdk;
}

export function isExecutorReady() {
  return Boolean(PRIVATE_KEY?.trim() && RPCURL);
}

export async function refreshBlockhash() {
  const { blockhash, lastValidBlockHeight } =
    await getConnection().getLatestBlockhash("processed");
  cachedBlockhash.blockhash = blockhash;
  cachedBlockhash.lastValidBlockHeight = lastValidBlockHeight;
  cachedBlockhash.ts = Date.now();
  return cachedBlockhash;
}

/** Keep a fresh blockhash in memory to shave latency off each send. */
export function startBlockhashRefresh(
  intervalMs = BLOCKHASH_REFRESH_MS,
) {
  if (blockhashLoopStarted) return;
  blockhashLoopStarted = true;
  refreshBlockhash().catch(() => { });
  setInterval(() => refreshBlockhash().catch(() => { }), intervalMs);
}

async function getBlockhash() {
  if (!cachedBlockhash.blockhash || Date.now() - cachedBlockhash.ts > 30_000) {
    await refreshBlockhash();
  }
  return cachedBlockhash;
}

async function getGlobalCached() {
  if (!cachedGlobal.value || Date.now() - cachedGlobal.ts > 60_000) {
    cachedGlobal.value = await getOnlineSdk().fetchGlobal();
    cachedGlobal.ts = Date.now();
  }
  return cachedGlobal.value;
}

function priorityInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: PRIORITY_FEE_MICROLAMPORTS,
    }),
  ];
}

async function sendFast(instructions, payer) {
  const conn = getConnection();
  const { blockhash, lastValidBlockHeight } = await getBlockhash();

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...priorityInstructions(), ...instructions],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const signature = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 2,
    preflightCommitment: "processed",
  });

  conn
    .confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")
    .catch(() => { });

  return signature;
}

/**
 * Buy a pump.fun token with SOL (bonding curve only).
 * @param {string} mintAddress - Token mint
 * @param {number} [solAmount] - SOL to spend (default TRADE_SOL)
 */
export async function executeBuy(mintAddress, solAmount = TRADE_SOL) {
  if (!isExecutorReady()) {
    return { ok: false, reason: "executor_not_configured" };
  }
  if (inFlightMints.has(mintAddress)) {
    return { ok: false, reason: "in_flight", mint: mintAddress };
  }

  inFlightMints.add(mintAddress);
  const started = Date.now();

  try {
    const payer = loadWallet();
    const mint = new PublicKey(mintAddress);
    const online = getOnlineSdk();
    const global = await getGlobalCached();
    const buyState = await online.fetchBuyState(mint, payer.publicKey);

    const lamports = new BN(Math.floor(solAmount * 1e9));
    const tokenAmount = getBuyTokenAmountFromSolAmount(
      global,
      buyState.bondingCurve,
      lamports,
    );

    const instructions = await PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
      bondingCurve: buyState.bondingCurve,
      associatedUserAccountInfo: buyState.associatedUserAccountInfo,
      mint,
      user: payer.publicKey,
      solAmount: lamports,
      amount: tokenAmount,
      slippage: SLIPPAGE_PCT,
    });

    const signature = await sendFast(instructions, payer);

    return {
      ok: true,
      side: "buy",
      mint: mintAddress,
      solAmount,
      signature,
      latencyMs: Date.now() - started,
      wallet: payer.publicKey.toBase58(),
    };
  } catch (err) {
    return {
      ok: false,
      side: "buy",
      mint: mintAddress,
      reason: err.message || String(err),
      latencyMs: Date.now() - started,
    };
  } finally {
    inFlightMints.delete(mintAddress);
  }
}

/**
 * Sell pump.fun tokens back to the bonding curve.
 * @param {string} mintAddress - Token mint
 * @param {{ sellPct?: number }} [opts] - Percent of wallet balance to sell (default 100)
 */
export async function executeSell(mintAddress, { sellPct = 100 } = {}) {
  if (!isExecutorReady()) {
    return { ok: false, reason: "executor_not_configured" };
  }
  if (inFlightMints.has(mintAddress)) {
    return { ok: false, reason: "in_flight", mint: mintAddress };
  }

  inFlightMints.add(mintAddress);
  const started = Date.now();

  try {
    const payer = loadWallet();
    const mint = new PublicKey(mintAddress);
    const online = getOnlineSdk();
    const global = await getGlobalCached();
    const sellState = await online.fetchSellState(mint, payer.publicKey);

    const ata = getAssociatedTokenAddressSync(mint, payer.publicKey);
    const balance = await getConnection().getTokenAccountBalance(ata);
    const total = new BN(balance.value.amount);
    const amount = total.muln(Math.max(0, Math.min(100, sellPct))).divn(100);

    if (amount.isZero()) {
      return { ok: false, side: "sell", mint: mintAddress, reason: "zero_balance" };
    }

    const solAmount = getSellSolAmountFromTokenAmount(
      global,
      sellState.bondingCurve,
      amount,
    );

    const instructions = await PUMP_SDK.sellInstructions({
      global,
      bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
      bondingCurve: sellState.bondingCurve,
      mint,
      user: payer.publicKey,
      amount,
      solAmount,
      slippage: SLIPPAGE_PCT,
    });

    const signature = await sendFast(instructions, payer);

    return {
      ok: true,
      side: "sell",
      mint: mintAddress,
      sellPct,
      signature,
      latencyMs: Date.now() - started,
      wallet: payer.publicKey.toBase58(),
    };
  } catch (err) {
    return {
      ok: false,
      side: "sell",
      mint: mintAddress,
      reason: err.message || String(err),
      latencyMs: Date.now() - started,
    };
  } finally {
    inFlightMints.delete(mintAddress);
  }
}

export const executor = {
  executeBuy,
  executeSell,
  isExecutorReady,
  startBlockhashRefresh,
  refreshBlockhash,
};
