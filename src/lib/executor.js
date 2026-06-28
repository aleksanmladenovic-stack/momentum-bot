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
import {
  RPCURL,
  EXECUTOR_RPC_URL,
  COMMITMENT,
  PRIVATE_KEY,
  executeTrades,
  tradeSol,
  slippagePct,
  priorityFeeMicrolamports,
  computeUnitLimit,
  blockhashRefreshMs,
} from "../constants/constants.js";

export const EXECUTE_TRADES = Boolean(executeTrades);
export const TRADE_SOL = Number(tradeSol);
export const SLIPPAGE_PCT = Number(slippagePct);
export const PRIORITY_FEE_MICROLAMPORTS = Number(priorityFeeMicrolamports);
export const COMPUTE_UNIT_LIMIT = Number(computeUnitLimit);
export const BLOCKHASH_REFRESH_MS = Number(blockhashRefreshMs);

const EXECUTOR_COMMITMENT = COMMITMENT || "processed";
const GLOBAL_CACHE_MS = 45_000;
const BLOCKHASH_MAX_AGE_MS = 60_000;

let wallet = null;
let readConnection = null;
let sendConnection = null;
let onlineSdk = null;
let blockhashLoopStarted = false;
let warmed = false;

const cachedBlockhash = {
  blockhash: null,
  lastValidBlockHeight: 0,
  ts: 0,
};
const cachedGlobal = { value: null, ts: 0, refresh: null };
const inFlightMints = new Set();
const mintKeyCache = new Map();

function loadWallet() {
  if (wallet) return wallet;
  const raw = PRIVATE_KEY?.trim();
  if (!raw) throw new Error("PRIVATE_KEY is not set in .env");
  wallet = Keypair.fromSecretKey(bs58.decode(raw));
  return wallet;
}

function getReadConnection() {
  if (!readConnection) {
    if (!RPCURL) throw new Error("RPC_URL is not set in .env");
    readConnection = new Connection(RPCURL, EXECUTOR_COMMITMENT);
  }
  return readConnection;
}

function getSendConnection() {
  if (!sendConnection) {
    const url = EXECUTOR_RPC_URL || RPCURL;
    if (!url) throw new Error("RPC_URL is not set in .env");
    sendConnection = new Connection(url, EXECUTOR_COMMITMENT);
  }
  return sendConnection;
}

function getOnlineSdk() {
  if (!onlineSdk) onlineSdk = new OnlinePumpSdk(getReadConnection());
  return onlineSdk;
}

function getMintKey(mintAddress) {
  let mint = mintKeyCache.get(mintAddress);
  if (!mint) {
    mint = new PublicKey(mintAddress);
    mintKeyCache.set(mintAddress, mint);
  }
  return mint;
}

export function isExecutorReady() {
  return Boolean(PRIVATE_KEY?.trim() && RPCURL);
}

export async function refreshBlockhash() {
  const { blockhash, lastValidBlockHeight } =
    await getReadConnection().getLatestBlockhash(EXECUTOR_COMMITMENT);
  cachedBlockhash.blockhash = blockhash;
  cachedBlockhash.lastValidBlockHeight = lastValidBlockHeight;
  cachedBlockhash.ts = Date.now();
  return cachedBlockhash;
}

export async function refreshGlobal() {
  if (cachedGlobal.refresh) {
    return cachedGlobal.refresh;
  }

  cachedGlobal.refresh = getOnlineSdk()
    .fetchGlobal()
    .then((value) => {
      cachedGlobal.value = value;
      cachedGlobal.ts = Date.now();
      return value;
    })
    .finally(() => {
      cachedGlobal.refresh = null;
    });

  return cachedGlobal.refresh;
}

async function getGlobalCached() {
  if (cachedGlobal.value && Date.now() - cachedGlobal.ts < GLOBAL_CACHE_MS) {
    return cachedGlobal.value;
  }
  return refreshGlobal();
}

function getBlockhashCached() {
  if (
    cachedBlockhash.blockhash &&
    Date.now() - cachedBlockhash.ts < BLOCKHASH_MAX_AGE_MS
  ) {
    return cachedBlockhash;
  }
  return null;
}

async function getBlockhash() {
  const cached = getBlockhashCached();
  if (cached) return cached;
  return refreshBlockhash();
}

/** Pre-load wallet, connections, blockhash, and pump global state. */
export function warmExecutor() {
  if (!isExecutorReady()) return false;
  if (warmed) return true;

  loadWallet();
  getReadConnection();
  getSendConnection();
  getOnlineSdk();
  warmed = true;

  refreshBlockhash().catch(() => {});
  refreshGlobal().catch(() => {});
  return true;
}

/** Keep blockhash and global state warm to shave latency off each send. */
export function startBlockhashRefresh(intervalMs = BLOCKHASH_REFRESH_MS) {
  warmExecutor();
  if (blockhashLoopStarted) return;
  blockhashLoopStarted = true;

  refreshBlockhash().catch(() => {});
  setInterval(() => refreshBlockhash().catch(() => {}), intervalMs);
  setInterval(() => refreshGlobal().catch(() => {}), GLOBAL_CACHE_MS);
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
  const conn = getSendConnection();
  const { blockhash, lastValidBlockHeight } = await getBlockhash();

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [...priorityInstructions(), ...instructions],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  const raw = tx.serialize();

  const signature = await conn.sendRawTransaction(raw, {
    skipPreflight: true,
    maxRetries: 3,
    preflightCommitment: "processed",
  });

  // Confirm in background — do not block the hot path.
  conn
    .confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    )
    .catch(() => {});

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
    warmExecutor();
    const payer = loadWallet();
    const mint = getMintKey(mintAddress);
    const online = getOnlineSdk();

    const [global, buyState] = await Promise.all([
      getGlobalCached(),
      online.fetchBuyState(mint, payer.publicKey),
    ]);

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
    warmExecutor();
    const payer = loadWallet();
    const mint = getMintKey(mintAddress);
    const online = getOnlineSdk();
    const ata = getAssociatedTokenAddressSync(mint, payer.publicKey);

    const [global, sellState, balance] = await Promise.all([
      getGlobalCached(),
      online.fetchSellState(mint, payer.publicKey),
      getReadConnection().getTokenAccountBalance(ata),
    ]);

    const total = new BN(balance.value.amount);
    const amount = total.muln(Math.max(0, Math.min(100, sellPct))).divn(100);

    if (amount.isZero()) {
      return {
        ok: false,
        side: "sell",
        mint: mintAddress,
        reason: "zero_balance",
        latencyMs: Date.now() - started,
      };
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
  warmExecutor,
  startBlockhashRefresh,
  refreshBlockhash,
  refreshGlobal,
};
