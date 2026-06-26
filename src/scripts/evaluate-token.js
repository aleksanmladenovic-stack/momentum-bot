import { TokenStateStore } from "../lib/token-state.js";
import { PositionManager } from "../lib/position-manager.js";
import {
  fetchMarketSnapshot,
  fetchMarketCapFromSupply,
} from "../lib/market-data.js";
import { evaluateBuyPoint } from "../lib/momentum-scorer.js";
import {
  minBuyScore,
  minLiquidityUsd,
  minPriceChange3mPct,
} from "../strategy/strategy.js";

const mint = "9Cn7or8TVicZYjSUEmgRk4A9XdXFzkBS8vn1ebt6pump";

async function main() {
  const market = await fetchMarketSnapshot(mint);
  // console.log(market);
  const marketCap =
    market.marketCap ?? (await fetchMarketCapFromSupply(mint, market.priceUsd));

  const store = new TokenStateStore();
  const state = store.get(mint);

  if (market.priceUsd) state.addPrice(market.priceUsd);
  if (market.totalHolders != null) state.addHolderCount(market.totalHolders);
  // console.log(market);

  const decision = evaluateBuyPoint(state, { ...market, marketCap });

  const output = {
    mint,
    action: decision.action,
    reason: decision.reason,
    details: decision.details,
    score: decision.score,
    metrics: decision.metrics,
    market: {
      priceUsd: market.priceUsd,
      marketCap,
      volume24h: market.volume24h,
      liquidityUsd: market.liquidityUsd,
      totalHolders: market.totalHolders,
    },
    strategy: {
      minBuyScore: minBuyScore,
      minLiquidityUsd: minLiquidityUsd,
      minPriceChange3mPct: minPriceChange3mPct,
    },
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
