import { TokenStateStore } from "../store/token-state.js";
import { PositionManager } from "../lib/position-manager.js";
import {
  fetchMarketSnapshot,
  fetchMarketCapFromSupply,
} from "../lib/market-data.js";
import { evaluateBuyPoint } from "../lib/momentum-scorer.js";
import { syncPumpTrades } from "../lib/pump-trades.js";
import { windows } from "../strategy/strategy.js";
import storeState from "../store/store.js";

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const TRADE_INTERVAL_MS = Number(
  process.env.TRADE_POLL_INTERVAL_MS || INTERVAL_MS,
);

const store = new TokenStateStore();
const positions = new PositionManager();
let ticking = false;
let lastTradePollAt = 0;

function getWatchMints() {
  const fromStore = storeState.mintAddresses ?? [];
  const fromEnv = (process.env.WATCH_MINTS || process.env.TARGET_MINT || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...fromStore, ...fromEnv])];
}

//Emit a structured JSON log line for signals and events.
export function log(event, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

//Fetch market data for one mint and evaluate buy/sell signals.
export async function pollMint(mint, { syncTrades = true } = {}) {
  const state = store.get(mint);

  // if (syncTrades) {
  //   const added = await syncPumpTrades(mint, state);
  //   if (added > 0) {
  //     log("trades_synced", { mint, added, tradesInState: state.trades.length });
  //     console.log("tokenState.trades:", state.trades);
  //   }
  // }

  const market = await fetchMarketSnapshot(mint);
  const marketCap =
    market.marketCap ?? (await fetchMarketCapFromSupply(mint, market.priceUsd));

  if (market.priceUsd) state.addPrice(market.priceUsd);
  if (market.totalHolders != null) state.addHolderCount(market.totalHolders);

  const currentPrice = state.latestPrice() ?? market.priceUsd;

  if (positions.has(mint)) {
    positions.updateHigh(mint, currentPrice);
    const sell = positions.evaluateSell(mint, currentPrice, state, market);
    if (sell.action === "SELL") {
      log("sell_signal", { mint, ...sell, priceUsd: currentPrice });
      if (sell.fullExit) {
        positions.close(mint);
      }
    }
    return;
  }

  const decision = evaluateBuyPoint(state, { ...market, marketCap });

  if (decision.action === "BUY") {
    const volume5m = state.tradesInWindow(windows.medium).length
      ? state.volumeSolInWindow(windows.medium)
      : (market.volume5m ?? null);

    positions.open(mint, {
      priceUsd: decision.buyPriceUsd ?? currentPrice,
      volume5m,
    });
    log("buy_signal", {
      mint,
      priceUsd: decision.buyPriceUsd ?? currentPrice,
      score: decision.score,
      metrics: decision.metrics,
      marketCap,
      volume24h: market.volume24h,
      totalHolders: market.totalHolders,
      tradesInState: state.trades.length,
    });
  } else {
    log("skip", {
      mint,
      reason: decision.reason,
      score: decision.score,
      details: decision.details,
      tradesInState: state.trades.length,
    });
  }
}

//Poll all configured watch mints once per interval tick.
async function tick() {
  if (ticking) return;
  ticking = true;

  const mints = getWatchMints();
  if (mints.length === 0) {
    log("idle", { reason: "no_mints", hint: "set WATCH_MINTS or run catchCreated" });
    ticking = false;
    return;
  }

  const now = Date.now();
  const syncTrades = now - lastTradePollAt >= TRADE_INTERVAL_MS;
  if (syncTrades) lastTradePollAt = now;

  try {
    for (const mint of mints) {
      try {
        await pollMint(mint, { syncTrades });
      } catch (err) {
        log("error", { mint, message: err.message });
      }
    }
  } finally {
    ticking = false;
  }
}

const initialMints = getWatchMints();
console.log(
  `Polling every ${INTERVAL_MS}ms (trades every ${TRADE_INTERVAL_MS}ms) for: ${initialMints.length ? initialMints.join(", ") : "(waiting for mints)"
  }`,
);

tick();
setInterval(tick, INTERVAL_MS);
