/**
 * Manual trade CLI: node src/scripts/execute-trade.js buy <mint> [solAmount]
 *                     node src/scripts/execute-trade.js sell <mint> [sellPct]
 */

import {
  executeBuy,
  executeSell,
  isExecutorReady,
  startBlockhashRefresh,
} from "../lib/executor.js";

const [side, mint, amountArg] = process.argv.slice(2);

if (!side || !mint) {
  console.error("Usage:");
  console.error("  node src/scripts/execute-trade.js buy <mint> [solAmount]");
  console.error("  node src/scripts/execute-trade.js sell <mint> [sellPct]");
  process.exit(1);
}

if (!isExecutorReady()) {
  console.error("Set PRIVATE_KEY and RPC_URL in .env");
  process.exit(1);
}

startBlockhashRefresh();

async function main() {
  let result;
  if (side === "buy") {
    const solAmount = amountArg ? Number(amountArg) : undefined;
    result = await executeBuy(mint, solAmount);
  } else if (side === "sell") {
    const sellPct = amountArg ? Number(amountArg) : 100;
    result = await executeSell(mint, { sellPct });
  } else {
    console.error('side must be "buy" or "sell"');
    process.exit(1);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
