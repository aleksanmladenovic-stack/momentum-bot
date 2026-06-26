//Parse buy/sell side and amounts from Helius/Moralis-style webhook payloads.
export function getBalanceRows(tx) {
  const pre = tx.meta?.preTokenBalances ?? tx.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? tx.postTokenBalances ?? [];
  return { pre, post };
}
//Parse swap side, SOL/token amounts, and metadata for a specific mint.
export function parseSwapForMint(tx, targetMint) {
  const { pre, post } = getBalanceRows(tx);
  const decimals = inferDecimals(post, pre, targetMint);

  let tokenDelta = 0n;
  for (const p of post) {
    if (p.mint !== targetMint) continue;
    const preBal = pre.find(
      (x) => x.accountIndex === p.accountIndex && x.mint === targetMint,
    );
    const before = BigInt(preBal?.uiTokenAmount?.amount ?? "0");
    const after = BigInt(p.uiTokenAmount?.amount ?? "0");
    tokenDelta += after - before;
  }

  let solAmount = 0;
  const nativeTransfers = tx.nativeTransfers ?? [];
  for (const t of nativeTransfers) {
    solAmount += Math.abs(Number(t.amount ?? 0)) / 1e9;
  }

  // Helius enhanced swaps sometimes include tokenTransfers
  if (solAmount === 0 && Array.isArray(tx.tokenTransfers)) {
    for (const tt of tx.tokenTransfers) {
      if (tt.mint === "So11111111111111111111111111111111111111112") {
        solAmount += Math.abs(Number(tt.tokenAmount ?? 0));
      }
    }
  }

  const side =
    tokenDelta > 0n ? "buy" : tokenDelta < 0n ? "sell" : inferSideFromType(tx);

  const rawAmount = tokenDelta < 0n ? -tokenDelta : tokenDelta;
  const tokenAmount = Number(rawAmount) / 10 ** decimals;

  return {
    side,
    tokenAmount,
    solAmount,
    decimals,
    signature: tx.signature ?? tx.transaction?.signatures?.[0] ?? null,
    timestamp: tx.timestamp ?? tx.blockTime ?? Math.floor(Date.now() / 1000),
  };
}
//Infer buy/sell/swap side from transaction type or description when balance delta is zero
export function inferSideFromType(tx) {
  const type = (tx.type ?? tx.description ?? "").toUpperCase();
  if (type.includes("BUY")) return "buy";
  if (type.includes("SELL")) return "sell";
  if (type.includes("SWAP")) return "swap";
  return null;
}
//Read token decimals from balance rows, defaulting to 6 for pump.fun tokens.
export function inferDecimals(post, pre, mint) {
  for (const p of [...post, ...pre]) {
    if (p.mint === mint && p.uiTokenAmount?.decimals != null) {
      return p.uiTokenAmount.decimals;
    }
  }
  return 6;
}
//Check whether a swap's SOL amount falls within optional min/max filters.
export function matchesAmountFilter(swap, { minSol, maxSol }) {
  if (!swap.side || swap.side === "swap") return false;
  const value = swap.solAmount;
  if (value < minSol) return false;
  if (value > maxSol) return false;
  return true;
}
//Collect unique non-wrapped-SOL mint addresses involved in a transaction.
export function extractMintsFromTx(tx) {
  const { pre, post } = getBalanceRows(tx);
  const mints = new Set();
  for (const row of [...pre, ...post]) {
    if (row.mint) mints.add(row.mint);
  }
  return [...mints].filter(
    (m) => m !== "So11111111111111111111111111111111111111112",
  );
}
