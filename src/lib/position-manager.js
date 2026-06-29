import {
  hardStopLossPct,
  trailingStopPct,
  takeProfitLevels,
  timeStopMinutes,
} from "../strategy/strategy.js";
import { evaluateMomentumDecay } from "./momentum-scorer.js";

export class PositionManager {
  constructor() {
    this.positions = new Map();
  }

  //open a new position for a mint at the given entry price.
  open(mint, entry) {
    this.positions.set(mint, {
      mint,
      entryPriceUsd: entry.priceUsd,
      entryTime: Date.now(),
      entryVolume5m: entry.volume5m ?? null,
      highestPriceUsd: entry.priceUsd,
      remainingPct: 100,
      tpHit: new Set(),
    });
  }
  //Check whether a postion is open for the given mint
  has(mint) {
    return this.positions.has(mint);
  }
  //Return the open position record, or undefined.
  get(mint) {
    return this.positions.get(mint);
  }
  //Remove a closed position form tracking
  close(mint) {
    this.positions.delete(mint);
  }
  //Update the trailing high-water mark for an open position
  updateHigh(mint, priceUsd) {
    const pos = this.positions.get(mint);
    if (!pos || !priceUsd) return;
    pos.highestPriceUsd = Math.max(pos.highestPriceUsd, priceUsd);
  }
  //Evalute exit rules: stop loss, trailing stop, take-profit ladder, time stop, momentum decay
  evaluateSell(mint, currentPriceUsd, tokenState, market = null) {
    const pos = this.positions.get(mint);
    if (!pos || !currentPriceUsd || !pos.entryPriceUsd) {
      return { action: "HOLD", reason: "no_position" };
    }

    this.updateHigh(mint, currentPriceUsd);

    const pnlPct =
      ((currentPriceUsd - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;

    const drawdownFromHighPct =
      ((pos.highestPriceUsd - currentPriceUsd) / pos.highestPriceUsd) * 100;

    // Hard stop loss
    if (pnlPct <= -hardStopLossPct) {
      return {
        action: "SELL",
        reason: "hard_stop_loss",
        sellPct: pos.remainingPct,
        pnlPct,
        drawdownFromHighPct,
        fullExit: true,
      };
    }

    // Trailing stop
    if (
      pos.highestPriceUsd > pos.entryPriceUsd &&
      drawdownFromHighPct >= trailingStopPct
    ) {
      return {
        action: "SELL",
        reason: "trailing_stop",
        sellPct: pos.remainingPct,
        pnlPct,
        drawdownFromHighPct,
        fullExit: true,
      };
    }

    // Take profit ladder
    for (const level of takeProfitLevels) {
      if (pnlPct >= level.pct && !pos.tpHit.has(level.pct)) {
        pos.tpHit.add(level.pct);
        pos.remainingPct -= level.sellPct;
        const fullExit = pos.remainingPct <= 0;
        if (fullExit) this.close(mint);
        return {
          action: "SELL",
          reason: `take_profit_${level.pct}`,
          sellPct: level.sellPct,
          pnlPct,
          fullExit,
        };
      }
    }

    // Time stop
    const minutesHeld = (Date.now() - pos.entryTime) / 60000;
    if (minutesHeld >= timeStopMinutes && pnlPct < 5) {
      return {
        action: "SELL",
        reason: "time_stop",
        sellPct: pos.remainingPct,
        pnlPct,
        minutesHeld,
        fullExit: true,
      };
    }

    // Momentum decay
    const decay = evaluateMomentumDecay(tokenState, pos.entryVolume5m, market);
    if (decay.decayed && pnlPct > 0) {
      return {
        action: "SELL",
        reason: "momentum_decay",
        sellPct: pos.remainingPct,
        pnlPct,
        decay,
        fullExit: true,
      };
    }

    return {
      action: "HOLD",
      reason: "position_open",
      pnlPct,
      drawdownFromHighPct,
      remainingPct: pos.remainingPct,
    };
  }
}
