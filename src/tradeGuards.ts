// src/tradeGuards.ts
//
// These guards sit between the predictor's probability and the executor's order.
// They fix the core failure visible in the bet history: the bot wasn't picking
// underdogs — it was FADING efficient favorites because the LLM ensemble is
// miscalibrated. Brazil priced at 0.92 YES, models said ~0.78, so the bot saw a
// ~14% "edge" on NO and bet against a heavy favorite. That edge was the model's
// error, not a real mispricing. On a liquid market the price is almost always
// right and a big model-vs-price gap means the MODEL is wrong.

export type Side = "YES" | "NO";
export type Action = "BUY_YES" | "BUY_NO" | "PASS";

export interface GuardInput {
  side: Side;        // direction the bot wants to bet
  yesPrice: number;  // market YES price, 0..1
  modelProb: number; // ensemble P(YES), 0..1
  confidence: number;// ensemble confidence, 0..1
}

export interface GuardResult {
  action: Action;
  edge: number;
  reason: string;
}

export interface GuardConfig {
  MIN_EDGE: number;       // existing: 0.02
  MAX_EDGE: number;       // NEW backstop: edges above this on a real market are almost always miscalibration
  MIN_CONFIDENCE: number; // existing: 0.5
  FAVORITE_PRICE: number; // NEW: never fade a favorite priced at/above this; never back a longshot at/below (1 - this)
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  MIN_EDGE: 0.02,
  MAX_EDGE: 0.20,        // a claimed >20% edge is your model being wrong, not the market
  MIN_CONFIDENCE: 0.5,
  FAVORITE_PRICE: 0.80,  // don't bet against an 80c+ favorite; don't chase a 20c- longshot
};

/**
 * Decide whether a proposed trade is allowed. Returns PASS with a reason when a
 * guard trips, otherwise the BUY action. Drop this in wherever you currently
 * compare edge to MIN_EDGE.
 */
export function guardTrade(
  input: GuardInput,
  cfg: GuardConfig = DEFAULT_GUARD_CONFIG
): GuardResult {
  const { side, yesPrice, modelProb, confidence } = input;

  // Edge for the side we'd actually bet.
  const edge = side === "YES" ? modelProb - yesPrice : yesPrice - modelProb;
  const buy: Action = side === "YES" ? "BUY_YES" : "BUY_NO";

  if (confidence < cfg.MIN_CONFIDENCE)
    return { action: "PASS", edge, reason: `confidence ${confidence.toFixed(2)} < MIN_CONFIDENCE` };

  if (edge < cfg.MIN_EDGE)
    return { action: "PASS", edge, reason: `edge ${edge.toFixed(3)} < MIN_EDGE` };

  // --- The fix for fading favorites ---
  // Don't bet NO against a heavy favorite. A 0.92 YES favorite means the crowd's
  // money says ~92%; the model thinking 78% is the model's miscalibration.
  if (side === "NO" && yesPrice >= cfg.FAVORITE_PRICE)
    return {
      action: "PASS",
      edge,
      reason: `won't fade favorite (YES=${yesPrice.toFixed(2)} >= ${cfg.FAVORITE_PRICE})`,
    };

  // Mirror image: don't chase a longshot the model loves. YES at 0.12 means the
  // crowd says ~12%; the model saying 30% is the same miscalibration, flipped.
  if (side === "YES" && yesPrice <= 1 - cfg.FAVORITE_PRICE)
    return {
      action: "PASS",
      edge,
      reason: `won't chase longshot (YES=${yesPrice.toFixed(2)} <= ${(1 - cfg.FAVORITE_PRICE).toFixed(2)})`,
    };

  // Sanity backstop: an enormous edge on any market is a red flag, not a green light.
  if (edge > cfg.MAX_EDGE)
    return {
      action: "PASS",
      edge,
      reason: `edge ${edge.toFixed(3)} > MAX_EDGE — treat large divergence as model error`,
    };

  return { action: buy, edge, reason: "passed guards" };
}

// ---------------------------------------------------------------------------
// Recurring-series dedup: stop re-betting the same thesis every day.
// Your US-Iran "meeting by June 17 / 18 / 19" markets are one series that lost
// repeatedly. This blocks a new entry when that series already has an open
// position OR recently lost.
// ---------------------------------------------------------------------------

import { seriesKey } from "./marketFilters";

export interface TradeRecordLike {
  title?: string;
  ticker?: string;
  pnl?: number;        // realized P&L if closed
  result?: string;     // "WIN" | "LOSS" | etc., if you store it
  closedAt?: string | number;
}

export interface SeriesGuardResult {
  blocked: boolean;
  reason: string;
}

/**
 * Block a new entry in a recurring series if:
 *   - an open position already exists in the same series, or
 *   - the series lost within the last `lossLookbackDays` days.
 *
 * Pass your open positions and recent trade history (any shape with a title and
 * pnl/result). Schema-tolerant on purpose.
 */
export function shouldBlockSeries(
  candidateTitle: string,
  openPositions: TradeRecordLike[],
  recentTrades: TradeRecordLike[],
  lossLookbackDays = 3
): SeriesGuardResult {
  const key = seriesKey(candidateTitle);
  if (!key) return { blocked: false, reason: "" };

  const sameSeries = (r: TradeRecordLike) => seriesKey(r.title || "") === key;

  if (openPositions.some(sameSeries))
    return { blocked: true, reason: `already holding a position in series "${key}"` };

  const cutoff = Date.now() - lossLookbackDays * 86_400_000;
  const recentLoss = recentTrades.some((r) => {
    if (!sameSeries(r)) return false;
    const lost = (typeof r.pnl === "number" && r.pnl < 0) || (r.result || "").toUpperCase() === "LOSS";
    if (!lost) return false;
    const when = r.closedAt ? new Date(r.closedAt).getTime() : Date.now();
    return when >= cutoff;
  });
  if (recentLoss)
    return { blocked: true, reason: `series "${key}" lost within ${lossLookbackDays}d — not re-entering` };

  return { blocked: false, reason: "" };
}

/*
INTEGRATION (predictor.ts or executor.ts) — replace your raw edge check:

  import { guardTrade, shouldBlockSeries } from "./tradeGuards";

  const g = guardTrade({ side, yesPrice, modelProb, confidence });
  if (g.action === "PASS") {
    console.log(`[guard] PASS ${market.ticker}: ${g.reason}`);
    continue; // or return PASS
  }

  // optional dedup, if you load open_positions.json / trade_history.json here:
  const dedup = shouldBlockSeries(market.title, openPositions, tradeHistory);
  if (dedup.blocked) {
    console.log(`[guard] PASS ${market.ticker}: ${dedup.reason}`);
    continue;
  }

  // proceed to size + execute g.action ("BUY_YES" | "BUY_NO")
*/