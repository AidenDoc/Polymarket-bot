// src/marketFilters.ts
//
// Hard blocks at the SCANNER level so junk markets never reach the predictor.
// This is the fix for "sports keep slipping through" — a priority sort is not a
// filter. Sports markets are where the bot bleeds, because the models can't price
// them and the bot ends up fading efficient favorites (see tradeGuards.ts).
//
// Wire-in: call shouldBlockMarket() inside scanner.ts when iterating markets and
// `continue` (skip) anything that returns blocked: true. See INTEGRATION below.

export interface KalshiMarketLike {
  ticker?: string;
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  category?: string;
  series_ticker?: string;
  [k: string]: unknown; // tolerate whatever else Kalshi returns
}

export interface BlockResult {
  blocked: boolean;
  reason: string;
}

// Build one lowercased string from every text field we might get.
function haystack(m: KalshiMarketLike): string {
  return [m.title, m.subtitle, m.yes_sub_title, m.category, m.series_ticker, m.ticker]
    .filter(Boolean)
    .join(" || ")
    .toLowerCase();
}

// "Brazil win on <date>", "Brazil vs. Haiti", "end in a draw", "beat", "defeat".
// NOTE: these are GAME verbs, not country names — so "US x Iran diplomatic
// meeting" correctly passes (no win/vs/draw/beat), while "Brazil win on ..." blocks.
const SPORTS_VERB =
  /\bwin on\b|\bvs\.?\b|\bbeat\b|\bdefeat\b|\bend in a (draw|tie)\b/;

// League / sport nouns.
const SPORTS_NOUN =
  /\b(nba|nfl|mlb|nhl|mls|epl|premier league|la liga|serie a|bundesliga|ligue 1|ncaa|ufc|mma|f1|formula 1|grand prix|world cup|champions league|super ?bowl|playoffs?|match|fixture|kickoff|touchdown|home run|goal scorer|set point)\b/;

// Betting structures the models have no business pricing.
const STRUCTURE =
  /\b(spread|parlay|moneyline|over\/under|point total|handicap)\b|[+-]\d+(\.5)?\b/;

/**
 * Returns blocked: true for any market the bot should never enter.
 * Defaults are intentionally aggressive — false negatives (a sports market
 * sneaking through) cost real losses; false positives (skipping a market)
 * cost nothing in paper mode and very little live.
 */
export function shouldBlockMarket(m: KalshiMarketLike): BlockResult {
  const cat = (m.category || "").toLowerCase();
  if (cat.includes("sport")) return { blocked: true, reason: "category=sports" };

  const h = haystack(m);
  if (SPORTS_VERB.test(h))
    return { blocked: true, reason: "sports game verb (win on / vs / draw / beat)" };
  if (SPORTS_NOUN.test(h))
    return { blocked: true, reason: "sports league/term" };
  if (STRUCTURE.test(h))
    return { blocked: true, reason: "spread/parlay/handicap structure" };

  return { blocked: false, reason: "" };
}

/**
 * OPTIONAL stricter mode: only allow markets whose category looks like
 * politics or economics. Flip ALLOWLIST_ONLY to true if you want a hard
 * whitelist instead of a blocklist. Leave false to use the blocklist above,
 * which still permits non-sports markets outside politics/econ.
 */
export const ALLOWLIST_ONLY = false;
const ALLOWED_CATEGORIES = ["politics", "economics", "economy", "world", "financials"];

export function passesAllowlist(m: KalshiMarketLike): boolean {
  if (!ALLOWLIST_ONLY) return true;
  const cat = (m.category || "").toLowerCase();
  return ALLOWED_CATEGORIES.some((c) => cat.includes(c));
}

/**
 * Normalize a title into a "series key" by stripping dates, so daily recurring
 * markets ("... by June 17", "... by June 18", "... 2026-06-19") collapse to one
 * key. Used by tradeGuards.shouldBlockSeries to stop re-betting the same losing
 * thesis every day (your repeated US-Iran losses).
 */
export function seriesKey(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/\bby\s+\w+\s+\d{1,2},?\s+\d{4}\b/g, "")
    .replace(/\bon\s+\w+\s+\d{1,2},?\s+\d{4}\b/g, "")
    .replace(/[?.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/*
INTEGRATION (scanner.ts) — inside your market loop, before a market is queued:

  import { shouldBlockMarket, passesAllowlist } from "./marketFilters";

  for (const market of markets) {
    const block = shouldBlockMarket(market);
    if (block.blocked) {
      console.log(`[scanner] skip ${market.ticker}: ${block.reason}`);
      continue;
    }
    if (!passesAllowlist(market)) continue;
    // ...existing handling...
  }
*/