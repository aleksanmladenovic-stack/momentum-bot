import dotenv from "dotenv";

dotenv.config();

function num(key, fallback) {
  const v = process.env[key];
  return v != null && v !== "" ? Number(v) : fallback;
}

// Universe filters
export const minLiquidityUsd = num("MIN_LIQUIDITY_USD", 5000);
export const minVolume24hUsd = num("MIN_VOLUME_24H_USD", 1000);
export const minHolders = num("MIN_HOLDERS", 20);
export const minMarketCapUsd = num("MIN_MARKET_CAP_USD", 3000);
export const maxMarketCapUsd = num("MAX_MARKET_CAP_USD", 500000);

// Buy = momentum thresholds
export const minPriceChange3mPct = num("MIN_PRICE_CHANGE_3M_PCT", 8);
export const maxPriceChange15mPct = num("MAX_PRICE_CHANGE_15M_PCT", 50);
export const minVolumeSpikeRatio = num("MIN_VOLUME_SPIKE_RATIO", 2.5);
export const minBuySellRatio = num("MIN_BUY_SELL_RATIO", 1.6);
export const minBuyScore = num("MIN_BUY_SCORE", 15);
export const maxSingleSellSol = num("MAX_SINGLE_SELL_SOL", 3);

// Amount filter for whale alerts (webhook)
export const minTradeSol = num("MIN_TRADE_SOL", 0.05);
export const maxTradeSol = num("MAX_TRADE_SOL", 5);

// Sell = exits
export const takeProfitLevels = [
  { pct: 25, sellPct: 30 },
  { pct: 60, sellPct: 30 },
];
export const trailingStopPct = num("TRAILING_STOP_PCT", 25);
export const hardStopLossPct = num("HARD_STOP_LOSS_PCT", 15);
export const timeStopMinutes = num("TIME_STOP_MINUTES", 3);
export const minVolumeDecayRatio = num("MIN_VOLUME_DECAY_RATIO", 0.4);

// Rolling windows (minutes)
export const windows = {
  short: 3,
  medium: 5,
  long: 15,
  volumeAvg: 30,
};

// Scorer weights
export const weights = {
  priceChange5m: 3,
  volumeSpike: 2,
  buySellRatio: 1,
  breakout: 5,
  holderGrowth: 1,
};
