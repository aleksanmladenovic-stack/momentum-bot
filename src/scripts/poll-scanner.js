import { TokenStateStore } from "../tokenState/token-state.js";
import { PositionManager } from "../lib/position-manager.js";
import {
  fetchMarketSnapshot,
  fetchMarketCapFromSupply,
} from "../lib/market-data.js";
import { evaluateBuyPoint } from "../lib/momentum-scorer.js";

const WATCH_MINTS = (process.env.WATCH_MINTS || process.env.TARGET_MINT || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

if (WATCH_MINTS.length === 0) {
  console.error("Set TARGET_MINT or WATCH_MINTS (comma-separated) in .env");
  process.exit(1);
}

const store = new TokenStateStore();
const positions = new PositionManager();

//Emit a structured JSON log line for signals and events.
export function log(event, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

//Fetch market data for one mint and evaluate buy/sell signals.
export async function pollMint(mint) {
  const market = await fetchMarketSnapshot(mint);
  const marketCap =
    market.marketCap ?? (await fetchMarketCapFromSupply(mint, market.priceUsd));

  const state = store.get(mint);
  if (market.priceUsd) state.addPrice(market.priceUsd);
  if (market.totalHolders != null) state.addHolderCount(market.totalHolders);

  const currentPrice = market.priceUsd ?? state.latestPrice();
  console.log(state.trades);
  if (positions.has(mint)) {
    const sell = positions.evaluateSell(mint, currentPrice, state);
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
    positions.open(mint, {
      priceUsd: decision.buyPriceUsd ?? currentPrice,
      volume5m: market.volume5m ?? null,
    });
    log("buy_signal", {
      mint,
      priceUsd: decision.buyPriceUsd ?? currentPrice,
      score: decision.score,
      metrics: decision.metrics,
      marketCap,
      volume24h: market.volume24h,
      totalHolders: market.totalHolders,
    });
  } else {
    log("skip", {
      mint,
      reason: decision.reason,
      score: decision.score,
      details: decision.details,
    });
  }
}

//Poll all configured watch mints once per interval tick.
async function tick() {
  for (const mint of WATCH_MINTS) {
    try {
      await pollMint(mint);
    } catch (err) {
      log("error", { mint, message: err.message });
    }
  }
}

console.log(`Polling every ${INTERVAL_MS}ms for: ${WATCH_MINTS.join(", ")}`);
tick();
setInterval(tick, INTERVAL_MS);
