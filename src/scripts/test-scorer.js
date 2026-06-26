import { evaluateBuyPoint } from "../lib/momentum-scorer.js";
import { PositionManager } from "../lib/position-manager.js";
import { TokenState } from "../lib/token-state.js";
import { minBuyScore } from "../strategy/strategy.js";

function simulateTrades(state, basePrice) {
  const now = Date.now();
  const trades = [
    { side: "buy", solAmount: 2.5, tokenAmount: 100000, ts: now - 4 * 60000 },
    { side: "buy", solAmount: 1.8, tokenAmount: 70000, ts: now - 3 * 60000 },
    { side: "buy", solAmount: 3.0, tokenAmount: 110000, ts: now - 2 * 60000 },
    { side: "sell", solAmount: 0.5, tokenAmount: 20000, ts: now - 1 * 60000 },
  ];

  let price = basePrice * 0.92;
  for (const t of trades) {
    state.addTrade({
      ...t,
      priceUsd: price,
      timestamp: Math.floor(t.ts / 1000),
    });
    price *= 1.03;
    state.addPrice(price, t.ts);
  }
  state.addHolderCount(50, now - 10 * 60000);
  state.addHolderCount(88, now);
}

const state = new TokenState("TEST_MINT");
simulateTrades(state, 0.00001);

const market = {
  priceUsd: state.latestPrice(),
  marketCap: 42000,
  volume24h: 85000,
  liquidityUsd: 12000,
  totalHolders: 88,
};

const buy = evaluateBuyPoint(state, market);
console.log("=== BUY EVALUATION ===");
console.log(JSON.stringify(buy, null, 2));

const positions = new PositionManager();
positions.open("TEST_MINT", {
  priceUsd: buy.buyPriceUsd ?? market.priceUsd,
  volume5m: state.volumeSolInWindow(5),
});

const entry = buy.buyPriceUsd ?? market.priceUsd;
const pumpPrice = entry * 1.35;
const sell = positions.evaluateSell("TEST_MINT", pumpPrice, state);
console.log("\n=== SELL EVALUATION (+35%) ===");
console.log(JSON.stringify(sell, null, 2));

const dumpPrice = entry * 0.88;
const stop = positions.evaluateSell("TEST_MINT", dumpPrice, state);
console.log("\n=== SELL EVALUATION (-12%) ===");
console.log(JSON.stringify(stop, null, 2));

console.log("\nStrategy minBuyScore:", minBuyScore);
