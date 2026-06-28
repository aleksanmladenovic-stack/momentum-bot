import { Connection, PublicKey } from "@solana/web3.js";
import {
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { MORALIS_API_KEY, RPCURL, COMMITMENT } from "../constants/constants.js";

const PUMP_DECIMALS = 6;
const PUMP_SUPPLY_RAW = 1_000_000_000_000_000;
const DEX_CACHE_MS = 15_000;
const DEX_STALE_MS = 5 * 60_000;

let solPriceCache = { price: null, ts: 0 };
let marketCache = new Map();
let pumpCache = new Map();

async function fetchJson(url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) {
      return { ok: false, status: res.status, data: null };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    return { ok: true, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function staleDexCache(mint) {
  const cached = marketCache.get(mint);
  if (cached && Date.now() - cached.ts < DEX_STALE_MS) {
    return cached.data;
  }
  return null;
}

async function pumpSolReservesToUsd(solReserves) {
  if (!solReserves || solReserves <= 0) return null;
  const solPrice = await fetchSolPriceUsd();
  return (solReserves / 1e6) * solPrice;
}

// Get current SOL price
export async function fetchSolPriceUsd() {
  if (solPriceCache.price && Date.now() - solPriceCache.ts < 30000) {
    return solPriceCache.price;
  }

  const { ok, data: pairs } = await fetchJson(
    "https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112",
  );
  if (ok) {
    const price = parseFloat(pairs?.[0]?.priceUsd);
    if (price > 0) {
      solPriceCache = { price, ts: Date.now() };
      return price;
    }
  }

  return solPriceCache.price ?? 150;
}

export async function fetchPumpCoin(mint) {
  const cached = pumpCache.get(mint);
  if (cached && Date.now() - cached.ts < 10000) {
    return cached.data;
  }

  const { ok, data: coin } = await fetchJson(
    `https://frontend-api-v3.pump.fun/coins/${mint}`,
  );
  if (!ok || !coin?.mint) return null;

  pumpCache.set(mint, { data: coin, ts: Date.now() });
  return coin;
}

async function fetchPumpVolume24h(mint) {
  const { ok, data: candles } = await fetchJson(
    `https://swap-api.pump.fun/v1/coins/${mint}/candles?interval=1h&limit=24`,
  );
  if (!ok || !Array.isArray(candles) || candles.length === 0) return null;

  const volume = candles.reduce(
    (sum, candle) => sum + (parseFloat(candle.volume) || 0),
    0,
  );
  return volume > 0 ? volume : null;
}

async function fetchPumpMarket(mint) {
  const coin = await fetchPumpCoin(mint);
  if (!coin) return null;

  const supply =
    Number(coin.total_supply ?? PUMP_SUPPLY_RAW) / 10 ** PUMP_DECIMALS;
  const marketCap = coin.usd_market_cap ?? null;
  const priceUsd = marketCap != null && supply > 0 ? marketCap / supply : null;

  let liquidityUsd = null;
  if (!coin.complete && coin.real_sol_reserves > 0) {
    liquidityUsd = await pumpSolReservesToUsd(coin.real_sol_reserves);
  }

  const volume24h =
    coin.usd_24h_volume ?? coin.volume24h ?? (await fetchPumpVolume24h(mint));

  if (coin.complete && liquidityUsd == null && marketCap != null) {
    liquidityUsd = marketCap;
  }

  return {
    priceUsd,
    marketCap,
    volume24h,
    volume5m: null,
    liquidityUsd,
    txns5m: null,
    dexId: "pumpfun",
    priceChange5m: null,
    priceChange15m: null,
  };
}

// Get real liquidity in USD from pump.fun bonding curve reserves.
export async function fetchPumpLiquidityUsd(mint) {
  const coin = await fetchPumpCoin(mint);
  if (!coin || coin.complete) return null;
  return pumpSolReservesToUsd(coin.real_sol_reserves);
}

function mergeMarket(primary, fallback) {
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    priceUsd: primary.priceUsd ?? fallback.priceUsd,
    marketCap: primary.marketCap ?? fallback.marketCap,
    volume24h: primary.volume24h ?? fallback.volume24h,
    volume5m: primary.volume5m ?? fallback.volume5m,
    liquidityUsd: primary.liquidityUsd ?? fallback.liquidityUsd,
    txns5m: primary.txns5m ?? fallback.txns5m,
    dexId: primary.dexId ?? fallback.dexId,
    priceChange5m: primary.priceChange5m ?? fallback.priceChange5m,
    priceChange15m: primary.priceChange15m ?? fallback.priceChange15m,
  };
}

function dexPairToMarket(best, mint) {
  let liquidityUsd = best.liquidity?.usd ?? null;

  return {
    priceUsd: parseFloat(best.priceUsd) || null,
    marketCap: best.marketCap ?? best.fdv ?? null,
    volume24h: best.volume?.h24 ?? null,
    volume5m: best.volume?.m5 ?? null,
    liquidityUsd,
    txns5m: best.txns?.m5 ?? null,
    dexId: best.dexId ?? null,
    priceChange5m: best.priceChange?.m5 ?? null,
    priceChange15m: best.priceChange?.m15 ?? null,
    _mint: mint,
    _needsPumpLiquidity:
      best.dexId === "pumpfun" && (liquidityUsd == null || liquidityUsd < 1000),
  };
}

//Fetch the highest-liquidity DexScreener pair for a Solana token mint.
export async function fetchDexPair(mint) {
  const cached = marketCache.get(mint);
  if (cached && Date.now() - cached.ts < DEX_CACHE_MS) {
    return cached.data;
  }

  const { ok, data: pairs } = await fetchJson(
    `https://api.dexscreener.com/tokens/v1/solana/${mint}`,
  );

  if (!ok) {
    return staleDexCache(mint);
  }

  if (!Array.isArray(pairs) || pairs.length === 0) {
    return null;
  }

  const best = pairs.sort(
    (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
  )[0];
  const draft = dexPairToMarket(best, mint);
  if (draft._needsPumpLiquidity) {
    const pumpLiq = await fetchPumpLiquidityUsd(mint);
    if (pumpLiq != null) draft.liquidityUsd = pumpLiq;
  }
  delete draft._mint;
  delete draft._needsPumpLiquidity;

  marketCache.set(mint, { data: draft, ts: Date.now() });
  return draft;
}

function holderCountFromMoralis(data) {
  if (!data) return null;

  const total = data.totalHolders;
  if (typeof total === "number" && total >= 0) return total;

  const dist = data.holderDistribution;
  if (dist && typeof dist === "object") {
    const sum = Object.values(dist).reduce(
      (acc, n) => acc + (typeof n === "number" && n > 0 ? n : 0),
      0,
    );
    if (sum > 0) return sum;
  }

  return null;
}

//Fetch total holder count from Moralis (requires MORALIS_API_KEY).
export async function fetchHolders(mint) {
  const key = MORALIS_API_KEY;
  if (!key) return null;

  const { ok, data } = await fetchJson(
    `https://solana-gateway.moralis.io/token/mainnet/holders/${mint}`,
    { headers: { "X-API-Key": key } },
  );
  if (!ok) return null;
  return holderCountFromMoralis(data);
}

//Combine DexScreener / pump.fun market data and Moralis holder count.
export async function fetchMarketSnapshot(mint) {
  const [dex, pump, totalHolders] = await Promise.all([
    fetchDexPair(mint),
    fetchPumpMarket(mint),
    fetchHolders(mint),
  ]);

  const merged = mergeMarket(dex, pump);
  const sources = [];
  if (dex) sources.push("dexscreener");
  if (pump) sources.push("pumpfun");

  return {
    mint,
    priceUsd: merged?.priceUsd ?? null,
    marketCap: merged?.marketCap ?? null,
    volume24h: merged?.volume24h ?? null,
    volume5m: merged?.volume5m ?? null,
    txns5m: merged?.txns5m ?? null,
    liquidityUsd: merged?.liquidityUsd ?? null,
    totalHolders,
    priceChange5m: merged?.priceChange5m ?? null,
    priceChange15m: merged?.priceChange15m ?? null,
    source: {
      market: sources.length ? sources.join("+") : null,
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
