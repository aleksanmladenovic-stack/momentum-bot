export class TokenState {
  constructor(mint) {
    this.mint = mint;
    this.trades = [];
    this.priceHistory = [];
    this.holderSnapshots = [];
    this.high15m = 0;
    this.entryVolume5m = null;
  }
  //Record a buy or sell trade aand purne stale data
  addTrade(trade) {
    this.trades.push({
      side: trade.side,
      solAmount: trade.solAmount,
      tokenAmount: trade.tokenAmount,
      priceUsd: trade.priceUsd ?? null,
      ts: trade.timestamp ? trade.timestamp * 1000 : Date.now(),
    });
    this._prune();
  }
  //Append ad USD price observation
  addPrice(priceUsd, ts = Date.now()) {
    if (priceUsd == null || priceUsd <= 0) return;
    this.priceHistory.push({ priceUsd, ts });
    this._prune();
  }
  // Append holder-count
  addHolderCount(count, ts = Date.now()) {
    if (count == null) return;
    this.holderSnapshots.push({ count, ts });
    this._prune();
  }
  /** Drop entries older than one hour from all rolling buffers. */
  _prune() {
    const cutoff = Date.now() - 60 * 60 * 1000;
    this.trades = this.trades.filter((t) => t.ts >= cutoff);
    this.priceHistory = this.priceHistory.filter((p) => p.ts >= cutoff);
    this.holderSnapshots = this.holderSnapshots.filter((h) => h.ts >= cutoff);
  }
  //Return trades within the last N minutes.
  tradesInWindow(minutes) {
    const since = Date.now() - minutes * 60 * 1000;
    return this.trades.filter((t) => t.ts >= since);
  }
  //Percent price change over a rolling window.
  priceChangePct(minutes) {
    const since = Date.now() - minutes * 60 * 1000;
    const inWindow = this.priceHistory.filter((p) => p.ts >= since);
    if (inWindow.length < 2) return 0;
    const first = inWindow[0].priceUsd;
    const last = inWindow[inWindow.length - 1].priceUsd;
    if (!first) return 0;
    return ((last - first) / first) * 100;
  }

  //Total SOL volume traded within a rolling window.
  volumeSolInWindow(minutes) {
    return this.tradesInWindow(minutes).reduce(
      (s, t) => s + (t.solAmount || 0),
      0,
    );
  }

  //Ratio of buy trades to sell trades in a rolling window.
  buySellRatio(minutes) {
    const trades = this.tradesInWindow(minutes);
    const buys = trades.filter((t) => t.side === "buy").length;
    const sells = trades.filter((t) => t.side === "sell").length;
    if (sells === 0) return buys > 0 ? buys : 0;
    return buys / sells;
  }

  //Largest single sell (in SOL) within the last N seconds.
  largestSellSol(seconds) {
    const since = Date.now() - seconds * 1000;
    return this.trades
      .filter((t) => t.side === "sell" && t.ts >= since)
      .reduce((max, t) => Math.max(max, t.solAmount || 0), 0);
  }

  //Net change in holder count over a rolling window.
  holderGrowth(minutes) {
    const since = Date.now() - minutes * 60 * 1000;
    const snaps = this.holderSnapshots.filter((h) => h.ts >= since);
    if (snaps.length < 2) return 0;
    return snaps[snaps.length - 1].count - snaps[0].count;
  }

  //True when the latest price exceeds the prior high within the window (breakout).
  isBreakout(minutes) {
    const since = Date.now() - minutes * 60 * 1000;
    const prices = this.priceHistory.filter((p) => p.ts >= since);
    if (prices.length === 0) return false;
    const current = prices[prices.length - 1].priceUsd;
    const prevHigh = prices
      .slice(0, -1)
      .reduce((m, p) => Math.max(m, p.priceUsd), 0);
    return current > prevHigh && prevHigh > 0;
  }

  //Most recent USD price observation, or null if none recorded.
  latestPrice() {
    if (this.priceHistory.length === 0) return null;
    return this.priceHistory[this.priceHistory.length - 1].priceUsd;
  }
}
/** Registry that lazily creates one TokenState per mint. */
export class TokenStateStore {
  /** Initialize an empty registry of per-mint TokenState instances. */
  constructor() {
    this.tokens = new Map();
  }

  /**
   * Get or create rolling state for a mint.
   */
  get(mint) {
    if (!this.tokens.has(mint)) {
      this.tokens.set(mint, new TokenState(mint));
    }
    return this.tokens.get(mint);
  }
}
