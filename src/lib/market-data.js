import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { MORALIS_API_KEY } from "../constants/constants.js";

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

  const data = {
    priceUsd: parseFloat(best.priceUsd) || null,
    marketCap: best.marketCap ?? best.fdv ?? null,
    volume24h: best.volume?.h24 ?? null,
    volume5m: best.volume?.m5 ?? null,
    liquidityUsd: best.liquidity?.usd ?? null,
    txns5m: best.txns?.m5 ?? null,
    dexId: best.dexId ?? null,
    priceChange5m: best.priceChange?.m5 ?? null,
    priceChange15m: best.priceChange?.m15 ?? null,
  };

  marketCache.set(mint, { data, ts: Date.now() });
  return data;
}

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
