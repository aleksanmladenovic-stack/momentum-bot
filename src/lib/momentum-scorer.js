import {
  weights,
  windows,
  minPriceChange3mPct,
  maxPriceChange15mPct,
  minVolumeSpikeRatio,
  minBuySellRatio,
  maxSingleSellSol,
  minBuyScore,
  minVolumeDecayRatio,
} from "../strategy/strategy.js";

import { passesUniverseFilters } from "./filters.js";

function hasTradeData(state, minutes = windows.medium) {
  return state.tradesInWindow(minutes).length > 0;
}

function volume5mFromMarket(market) {
  return market?.volume5m ?? 0;
}

function avgVolume5mFromMarket(market) {
  const volume24h = market?.volume24h ?? 0;
  return volume24h > 0 ? volume24h / 288 : 0;
}

function buySellRatioFromMarket(market) {
  const txns = market?.txns5m;
  if (!txns) return 0;
  const buys = txns.buys ?? 0;
  const sells = txns.sells ?? 0;
  if (sells === 0) return buys > 0 ? buys : 0;
  return buys / sells;
}

//Weighted momentum scoring and BUY/SKIP / decay evaluation.
export function computeMomentumScore(state, market) {
  const w = weights;

  const priceChange5m =
    state.priceChangePct(windows.medium) || market.priceChange5m || 0;

  const volume5m = hasTradeData(state)
    ? state.volumeSolInWindow(windows.medium)
    : volume5mFromMarket(market);
  const avgVolume5m = hasTradeData(state, windows.volumeAvg)
    ? state.volumeSolInWindow(windows.volumeAvg) / 6
    : avgVolume5mFromMarket(market);
  const volumeSpikeRatio = volume5m / (avgVolume5m || 1);

  const buySellRatio = hasTradeData(state)
    ? state.buySellRatio(windows.medium)
    : buySellRatioFromMarket(market);
  const breakout = state.isBreakout(windows.long);
  const holderGrowth = state.holderGrowth(1);
  const score =
    priceChange5m * w.priceChange5m +
    volumeSpikeRatio * w.volumeSpike +
    buySellRatio * w.buySellRatio +
    (breakout ? w.breakout : 0) +
    holderGrowth * w.holderGrowth;

  return {
    score,
    priceChange3m: state.priceChangePct(windows.short),
    priceChange5m,
    priceChange15m:
      state.priceChangePct(windows.long) || market.priceChange15m || 0,
    volumeSpikeRatio,
    buySellRatio,
    breakout,
    holderGrowth,
    largestSell60s: hasTradeData(state, 1) ? state.largestSellSol(60) : 0,
  };
}

//Decide BUY or SKIP after universe filters and momentum threshold checks.
export function evaluateBuyPoint(state, market) {
  const filter = passesUniverseFilters(market);
  if (!filter.pass) {
    return {
      action: "SKIP",
      reason: "universe_filter",
      details: filter.reasons,
      metrics: null,
    };
  }

  const metrics = computeMomentumScore(state, market);

  const checks = [];

  if (metrics.priceChange3m < minPriceChange3mPct) {
    checks.push(
      `priceChange3m ${metrics.priceChange3m.toFixed(2)}% < ${minPriceChange3mPct}%`,
    );
  }
  if (metrics.priceChange15m > maxPriceChange15mPct) {
    checks.push(
      `priceChange15m ${metrics.priceChange15m.toFixed(2)}% > ${maxPriceChange15mPct}% (too late)`,
    );
  }
  if (metrics.volumeSpikeRatio < minVolumeSpikeRatio) {
    checks.push(
      `volumeSpike ${metrics.volumeSpikeRatio.toFixed(2)} < ${minVolumeSpikeRatio}`,
    );
  }
  if (metrics.buySellRatio < minBuySellRatio) {
    checks.push(
      `buySellRatio ${metrics.buySellRatio.toFixed(2)} < ${minBuySellRatio}`,
    );
  }
  if (metrics.largestSell60s > maxSingleSellSol) {
    checks.push(
      `large sell ${metrics.largestSell60s.toFixed(2)} SOL in last 60s`,
    );
  }
  if (metrics.score < minBuyScore) {
    checks.push(`score ${metrics.score.toFixed(2)} < ${minBuyScore}`);
  }

  if (checks.length > 0) {
    return {
      action: "SKIP",
      reason: "momentum_threshold",
      details: checks,
      metrics,
      score: metrics.score,
    };
  }

  return {
    action: "BUY",
    reason: "momentum_confirmed",
    details: [],
    metrics,
    score: metrics.score,
    buyPriceUsd: state.latestPrice() ?? market.priceUsd,
  };
}

//Detect whether post-entry momentum has faded (negative price or volume collapse).
export function evaluateMomentumDecay(state, entryVolume5m) {
  const volume5m = state.volumeSolInWindow(windows.medium);
  const baseline = entryVolume5m ?? volume5m;
  const volumeRatio = baseline > 0 ? volume5m / baseline : 1;
  const priceChange5m = state.priceChangePct(windows.medium);

  const decayed = priceChange5m < 0 || volumeRatio < minVolumeDecayRatio;

  return {
    decayed,
    volumeRatio,
    priceChange5m,
  };
}
