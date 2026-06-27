// Parse buy/sell side and amounts from Helius/Moralis-style webhook payloads.

export function getBalanceRows(tx) {
  const pre = tx.meta?.preTokenBalances ?? tx.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? tx.postTokenBalances ?? [];
  return { pre, post };
}

export function getFeePayer(tx) {
  return (
    tx.feePayer ??
    tx.transaction?.message?.accountKeys?.[0] ??
    tx.transaction?.message?.staticAccountKeys?.[0] ??
    null
  );
}

function rawTokenAmountToNumber(raw) {
  if (!raw) return 0;
  const amount = BigInt(raw.tokenAmount ?? "0");
  const decimals = raw.decimals ?? 0;
  return Number(amount) / 10 ** decimals;
}

function sumSolFromNativeTransfers(tx, feePayer) {
  let solAmount = 0;
  for (const t of tx.nativeTransfers ?? []) {
    const lamports = Math.abs(Number(t.amount ?? 0));
    if (!feePayer) {
      solAmount += lamports / 1e9;
      continue;
    }
    if (t.fromUserAccount === feePayer || t.toUserAccount === feePayer) {
      solAmount += lamports / 1e9;
    }
  }
  return solAmount;
}

function sumSolFromTokenTransfers(tx) {
  let solAmount = 0;
  for (const tt of tx.tokenTransfers ?? []) {
    if (tt.mint === "So11111111111111111111111111111111111111112") {
      solAmount += Math.abs(Number(tt.tokenAmount ?? 0));
    }
  }
  return solAmount;
}

function parseFromBalanceDelta(tx, targetMint) {
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

  if (tokenDelta === 0n) return null;

  const rawAmount = tokenDelta < 0n ? -tokenDelta : tokenDelta;
  return {
    side: tokenDelta > 0n ? "buy" : "sell",
    tokenAmount: Number(rawAmount) / 10 ** decimals,
    decimals,
  };
}

function parseFromTokenTransfers(tx, targetMint) {
  const feePayer = getFeePayer(tx);
  if (!Array.isArray(tx.tokenTransfers)) return null;

  let received = 0;
  let sent = 0;
  for (const tt of tx.tokenTransfers) {
    if (tt.mint !== targetMint) continue;
    const amount = Math.abs(Number(tt.tokenAmount ?? 0));
    if (feePayer) {
      if (tt.toUserAccount === feePayer) received += amount;
      if (tt.fromUserAccount === feePayer) sent += amount;
    } else {
      received += amount;
    }
  }

  if (received > sent) {
    return { side: "buy", tokenAmount: received - sent };
  }
  if (sent > received) {
    return { side: "sell", tokenAmount: sent - received };
  }
  if (received > 0) {
    return { side: "buy", tokenAmount: received };
  }
  return null;
}

function parseFromSwapEvent(tx, targetMint) {
  const swap = tx.events?.swap;
  if (!swap) return null;

  for (const out of swap.tokenOutputs ?? []) {
    if (out.mint !== targetMint) continue;
    const tokenAmount = rawTokenAmountToNumber(out.rawTokenAmount);
    if (tokenAmount > 0) {
      return { side: "buy", tokenAmount };
    }
  }

  for (const inp of swap.tokenInputs ?? []) {
    if (inp.mint !== targetMint) continue;
    const tokenAmount = rawTokenAmountToNumber(inp.rawTokenAmount);
    if (tokenAmount > 0) {
      return { side: "sell", tokenAmount };
    }
  }

  return null;
}

function parseFromAccountData(tx, targetMint) {
  const feePayer = getFeePayer(tx);
  if (!feePayer || !Array.isArray(tx.accountData)) return null;

  const account = tx.accountData.find((a) => a.account === feePayer);
  if (!account) return null;

  let net = 0;
  let decimals = inferDecimals([], [], targetMint);
  for (const change of account.tokenBalanceChanges ?? []) {
    if (change.mint !== targetMint) continue;
    const raw = change.rawTokenAmount;
    if (raw?.decimals != null) decimals = raw.decimals;
    const amount = rawTokenAmountToNumber(raw);
    const signed = String(raw?.tokenAmount ?? "").startsWith("-")
      ? -amount
      : amount;
    net += signed;
  }

  if (net === 0) return null;
  return {
    side: net > 0 ? "buy" : "sell",
    tokenAmount: Math.abs(net),
    decimals,
  };
}

// Parse swap side, SOL/token amounts, and metadata for a specific mint.
export function parseSwapForMint(tx, targetMint) {
  const parsed =
    parseFromBalanceDelta(tx, targetMint) ??
    parseFromTokenTransfers(tx, targetMint) ??
    parseFromSwapEvent(tx, targetMint) ??
    parseFromAccountData(tx, targetMint);

  const feePayer = getFeePayer(tx);
  let solAmount = sumSolFromNativeTransfers(tx, feePayer);
  if (solAmount === 0) {
    solAmount = sumSolFromTokenTransfers(tx);
  }

  const side = parsed?.side ?? inferSideFromType(tx);
  const tokenAmount = parsed?.tokenAmount ?? 0;
  const decimals = parsed?.decimals ?? inferDecimals([], [], targetMint);

  return {
    side: side === "swap" ? null : side,
    tokenAmount,
    solAmount,
    decimals,
    signature: tx.signature ?? tx.transaction?.signatures?.[0] ?? null,
    timestamp: tx.timestamp ?? tx.blockTime ?? Math.floor(Date.now() / 1000),
  };
}

// Infer buy/sell/swap side from transaction type or description when balance delta is zero.
export function inferSideFromType(tx) {
  const text = (tx.type ?? tx.description ?? "").toUpperCase();
  if (text.includes("BUY") || text.includes("BOUGHT")) return "buy";
  if (text.includes("SELL") || text.includes("SOLD")) return "sell";
  if (text.includes("SWAP")) return "swap";
  return null;
}

// Read token decimals from balance rows, defaulting to 6 for pump.fun tokens.
export function inferDecimals(post, pre, mint) {
  for (const p of [...post, ...pre]) {
    if (p.mint === mint && p.uiTokenAmount?.decimals != null) {
      return p.uiTokenAmount.decimals;
    }
  }
  return 6;
}

// Check whether a swap's SOL amount falls within optional min/max filters.
export function matchesAmountFilter(swap, { minSol, maxSol }) {
  if (!swap.side || swap.side === "swap") return false;
  const value = swap.solAmount;
  if (value < minSol) return false;
  if (value > maxSol) return false;
  return true;
}

// Collect unique non-wrapped-SOL mint addresses involved in a transaction.
export function extractMintsFromTx(tx) {
  const mints = new Set();
  const { pre, post } = getBalanceRows(tx);

  for (const row of [...pre, ...post]) {
    if (row.mint) mints.add(row.mint);
  }
  for (const tt of tx.tokenTransfers ?? []) {
    if (tt.mint) mints.add(tt.mint);
  }
  for (const account of tx.accountData ?? []) {
    for (const change of account.tokenBalanceChanges ?? []) {
      if (change.mint) mints.add(change.mint);
    }
  }
  const swap = tx.events?.swap;
  for (const item of [
    ...(swap?.tokenInputs ?? []),
    ...(swap?.tokenOutputs ?? []),
  ]) {
    if (item.mint) mints.add(item.mint);
  }

  return [...mints].filter(
    (m) => m !== "So11111111111111111111111111111111111111112",
  );
}

// Normalize Helius/Moralis webhook bodies into an array of transactions.
export function normalizeWebhookPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  if (Array.isArray(payload?.data)) return payload.data;
  if (payload?.transaction) return [payload.transaction];
  if (payload?.signature || payload?.type || payload?.tokenTransfers) {
    return [payload];
  }
  return [payload];
}

export function txInvolvesMint(tx, mint) {
  return extractMintsFromTx(tx).includes(mint);
}
