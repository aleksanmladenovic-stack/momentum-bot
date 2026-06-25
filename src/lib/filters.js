import {
  minLiquidityUsd,
  minVolume24hUsd,
  minHolders,
  minMarketCapUsd,
  maxMarketCapUsd,
} from "../strategy/strategy.js";

export function passesUniverseFilters(market) {
  const reasons = [];

  if ((market.liquidityUsd ?? 0) < minLiquidityUsd) {
    reasons.push(`liquidity ${market.liquidityUsd} < ${minLiquidityUsd}`);
  }
  if ((market.volume24h ?? 0) < minVolume24hUsd) {
    reasons.push(`volume24h ${market.volume24h} < ${minVolume24hUsd}`);
  }
  if (market.totalHolders != null && market.totalHolders < minHolders) {
    reasons.push(`holders ${market.totalHolders} < ${minHolders}`);
  }
  if (market.marketCap != null) {
    if (market.marketCap < minMarketCapUsd) {
      reasons.push(`marketCap ${market.marketCap} < ${minMarketCapUsd}`);
    }
    if (market.marketCap > maxMarketCapUsd) {
      reasons.push(`marketCap ${market.marketCap} > ${maxMarketCapUsd}`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}
