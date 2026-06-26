import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { MORALIS_API_KEY, RPCURL, COMMITMENT } from "../constants/constants.js";

let solPriceCache = { price: null, ts: 0 };
let marketCache = new Map();

// Get current SOL price
export async function fetchSolPriceUsd() {
  if (solPriceCache.price && Date.now() - solPriceCache.ts < 30000) {
    return solPriceCache.price;
  }
  try {
    const res = await fetch(
      "https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112",
    );
    const pairs = await res.json();
    const price = parseFloat(pairs?.[0]?.priceUsd);
    if (price > 0) {
      solPriceCache = { price, ts: Date.now() };
      return price;
    }
  } catch {
    /* fallback below */
  }
  return solPriceCache.price ?? 150;
}
// Get real liquidityUsd
export async function fetchPumpLiquidityUsd(mint) {
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`);
    if (!res.ok) return null;
    const coin = await res.json();
    if (coin.complete) return null; // graduated — use DexScreener instead
    return coin.real_sol_reserves / 1e6;
  } catch {
    return null;
  }
}
//Fetch the highest-liquidity DexScreener pair for a Solana token mint.
export async function fetchDexPair(mint) {
  const cached = marketCache.get(mint);
  if (cached && Date.now() - cached.ts < 15000) {
    return cached.data;
  }

  const res = await fetch(
    `https://api.dexscreener.com/tokens/v1/solana/${mint}`,
  );
  const pairs = await res.json();
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return null;
  }

  const best = pairs.sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];
  console.log(best);
  let liquidityUsd = best.liquidity?.usd ?? null;
  if (best.dexId === "pumpfun" && liquidityUsd == null) {
    const solPrice = await fetchSolPriceUsd();
    liquidityUsd = await fetchPumpLiquidityUsd(mint);
  }
  const data = {
    priceUsd: parseFloat(best.priceUsd) || null,
    marketCap: best.marketCap ?? best.fdv ?? null,
    volume24h: best.volume?.h24 ?? null,
    volume5m: best.volume?.m5 ?? null,
    liquidityUsd: liquidityUsd,
    txns5m: best.txns?.m5 ?? null,
    dexId: best.dexId ?? null,
    priceChange5m: best.priceChange?.m5 ?? null,
    priceChange15m: best.priceChange?.m15 ?? null,
  };

  marketCache.set(mint, { data, ts: Date.now() });
  return data;
}
//Fetch total holder count from Moralis (requires MORALIS_API_KEY).
export async function fetchHolders(mint) {
  const key = MORALIS_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(
      `https://solana-gateway.moralis.io/token/mainnet/holders/${mint}`,
      { headers: { "X-API-Key": key } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.totalHolders ?? null;
  } catch {
    return null;
  }
}

//Combine DexScreener market data and Moralis holder count into one snapshot.
export async function fetchMarketSnapshot(mint) {
  const [dex, totalHolders] = await Promise.all([
    fetchDexPair(mint),
    fetchHolders(mint),
  ]);
  return {
    mint,
    priceUsd: dex?.priceUsd ?? null,
    marketCap: dex?.marketCap ?? null,
    volume24h: dex?.volume24h ?? null,
    volume5m: dex?.volume5m ?? null,
    liquidityUsd: dex?.liquidityUsd ?? null,
    totalHolders,
    priceChange5m: dex?.priceChange5m ?? null,
    priceChange15m: dex?.priceChange15m ?? null,
    source: {
      market: dex ? "dexscreener" : null,
      holders: totalHolders != null ? "moralis" : null,
    },
  };
}

//Derive per-token price from a swap's SOL and token amounts.
export async function fetchMarketCapFromSupply(mint, priceUsd) {
  if (!priceUsd) return null;
  try {
    const connection = new Connection(RPCURL, COMMITMENT);
    const pubkey = new PublicKey(mint);
    let mintInfo;
    try {
      mintInfo = await getMint(
        connection,
        pubkey,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
    } catch {
      mintInfo = await getMint(connection, pubkey, undefined, TOKEN_PROGRAM_ID);
    }
    const supply = Number(mintInfo.supply) / 10 ** mintInfo.decimals;
    return priceUsd * supply;
  } catch {
    return null;
  }
}

// Derive per-token price from a swap's SOL and token amounts.
export function priceFromSwap(swap, solPriceUsd) {
  if (!swap.solAmount || !swap.tokenAmount) return null;
  const priceSol = swap.solAmount / swap.tokenAmount;
  return {
    priceSol,
    priceUsd: priceSol * solPriceUsd,
  };
}
