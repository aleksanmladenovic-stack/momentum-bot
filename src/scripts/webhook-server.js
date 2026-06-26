/**
 * HTTP webhook server: receives Helius/Moralis swap events and emits buy/sell signals.
 */

import http from "http";
import strategy from "../config/strategy";
import { TokenStateStore } from "../lib/token-state";
import { PositionManager } from "../lib/position-manager";
import {
  parseSwapForMint,
  matchesAmountFilter,
  extractMintsFromTx,
} from "../lib/swap-parser";
import {
  fetchSolPriceUsd,
  fetchMarketSnapshot,
  fetchMarketCapFromSupply,
  priceFromSwap,
} from "../lib/market-data";
import { evaluateBuyPoint } from "../lib/momentum-scorer";

const PORT = Number(process.env.PORT || 3000);
const TARGET_MINT = process.env.TARGET_MINT || "";

const store = new TokenStateStore();
const positions = new PositionManager();

/**
 * Emit a structured JSON log line for signals and events.
 * @param {string} event - Event name (e.g. buy_signal, sell_signal, swap).
 * @param {object} data - Additional fields to include in the log payload.
 */
export function log(event, data) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

/**
 * Process one swap for a mint: update state, evaluate sell/buy, and log signals.
 * @param {object} tx - Webhook transaction payload.
 * @param {string} mint - Token mint address.
 */
export async function handleSwap(tx, mint) {
  if (TARGET_MINT && mint !== TARGET_MINT) return;

  const swap = parseSwapForMint(tx, mint);
  if (!swap.side) return;

  const minSol = strategy.minTradeSol;
  const maxSol = strategy.maxTradeSol;
  if (!matchesAmountFilter(swap, { minSol, maxSol })) return;

  const solPriceUsd = await fetchSolPriceUsd();
  const tradePrice = priceFromSwap(swap, solPriceUsd);

  const state = store.get(mint);
  state.addTrade({
    ...swap,
    priceUsd: tradePrice?.priceUsd,
    timestamp: swap.timestamp,
  });
  if (tradePrice?.priceUsd) {
    state.addPrice(tradePrice.priceUsd);
  }

  const market = await fetchMarketSnapshot(mint);
  if (market.totalHolders != null) {
    state.addHolderCount(market.totalHolders);
  }
  if (market.priceUsd) {
    state.addPrice(market.priceUsd);
  }

  const marketCap =
    market.marketCap ??
    (await fetchMarketCapFromSupply(
      mint,
      tradePrice?.priceUsd ?? market.priceUsd,
    ));

  log("swap", {
    mint,
    signature: swap.signature,
    side: swap.side,
    solAmount: swap.solAmount,
    tokenAmount: swap.tokenAmount,
    priceUsd: tradePrice?.priceUsd ?? market.priceUsd,
    marketCap,
    volume24h: market.volume24h,
    totalHolders: market.totalHolders,
  });

  const currentPrice =
    tradePrice?.priceUsd ?? market.priceUsd ?? state.latestPrice();

  if (positions.has(mint)) {
    positions.updateHigh(mint, currentPrice);
    const sell = positions.evaluateSell(mint, currentPrice, state);
    if (sell.action === "SELL") {
      log("sell_signal", { mint, ...sell, priceUsd: currentPrice });
      if (
        sell.fullExit ||
        sell.reason === "hard_stop_loss" ||
        sell.reason === "trailing_stop"
      ) {
        positions.close(mint);
      }
    }
    return;
  }

  const decision = evaluateBuyPoint(state, {
    ...market,
    marketCap,
  });

  if (decision.action === "BUY") {
    positions.open(mint, {
      priceUsd: decision.buyPriceUsd,
      volume5m: state.volumeSolInWindow(strategy.windows.medium),
    });
    log("buy_signal", {
      mint,
      priceUsd: decision.buyPriceUsd,
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
      details: decision.details,
      score: decision.score,
      metrics: decision.metrics,
    });
  }
}

/**
 * Route a webhook payload (single tx or batch) to handleSwap per mint.
 * @param {object|object[]} payload - Helius/Moralis webhook body.
 */
async function handlePayload(payload) {
  const txs = Array.isArray(payload) ? payload : [payload];

  for (const tx of txs) {
    const mints = extractMintsFromTx(tx);
    if (mints.length === 0 && TARGET_MINT) {
      await handleSwap(tx, TARGET_MINT);
      continue;
    }
    for (const mint of mints) {
      await handleSwap(tx, mint);
    }
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(req.url === "/health" ? 200 : 404, {
      "Content-Type": "application/json",
    });
    res.end(
      JSON.stringify({ ok: req.url === "/health", service: "momentum-bot" }),
    );
    return;
  }

  if (process.env.WEBHOOK_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== process.env.WEBHOOK_SECRET) {
      res.writeHead(401);
      return res.end("Unauthorized");
    }
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body);
      await handlePayload(payload);
      res.writeHead(200);
      res.end("OK");
    } catch (err) {
      console.error(err);
      res.writeHead(500);
      res.end(err.message);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Momentum webhook server: http://localhost:${PORT}/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  if (TARGET_MINT) console.log(`Watching mint: ${TARGET_MINT}`);
});
