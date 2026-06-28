import { TokenStateStore } from "../store/token-state.js";
import { PositionManager } from "../lib/position-manager.js";
import {
  fetchMarketSnapshot,
  fetchMarketCapFromSupply,
} from "../lib/market-data.js";
import { evaluateBuyPoint } from "../lib/momentum-scorer.js";
import { windows } from "../strategy/strategy.js";
import storeState from "../store/store.js";
import {
  EXECUTE_TRADES,
  executeBuy,
  executeSell,
  isExecutorReady,
  startBlockhashRefresh,
} from "../lib/executor.js";

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

const store = new TokenStateStore();
const positions = new PositionManager();
let ticking = false;

if (EXECUTE_TRADES) {
  if (!isExecutorReady()) {
    console.error("EXECUTE_TRADES=true but PRIVATE_KEY or RPC_URL is missing");
    process.exit(1);
  }
  startBlockhashRefresh();
  console.log("Auto-execution enabled (EXECUTE_TRADES=true)");
}

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
export async function pollMint(mint) {
  const state = store.get(mint);

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
      if (EXECUTE_TRADES) {
        const exec = await executeSell(mint, { sellPct: sell.sellPct ?? 100 });
        log("executed", exec);
      }
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
    if (EXECUTE_TRADES) {
      const exec = await executeBuy(mint);
      log("executed", exec);
    }
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

  try {
    for (const mint of mints) {
      try {
        await pollMint(mint);
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
  `Polling every ${INTERVAL_MS}ms for: ${
    initialMints.length ? initialMints.join(", ") : "(waiting for mints)"
  }`,
);

tick();
setInterval(tick, INTERVAL_MS);
