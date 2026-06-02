/**
 * ====================================================
 *  POLYMARKET US MARKET SCANNER  (api.polymarket.us)
 *  Replaces marketScanner.ts for the US (live) path.
 *
 *  Pulls open, non-sports, mid-priced markets and writes scan_results.json
 *  with US-native identifiers (slug) so the rest of the pipeline can trade them.
 *
 *  Verified against the live /v1/markets response (June 2026):
 *   - `outcomes` & `outcomePrices` come back as JSON STRINGS -> parsed here.
 *   - a market can be active:true AND closed:true at once -> we trust `closed`.
 *   - `category === "sports"` is the sports flag. Do NOT filter on
 *     `sportsMarketType` — it's reused for non-sports (e.g. "election").
 *   - `orderPriceMinTickSize` is the per-market price tick.
 *   - this endpoint exposes NO volume/liquidity field, so depth filtering
 *     is not possible here yet (see TODO). Scoring uses price + time only.
 *
 *  Read-only. Requires PM_US_ACCESS_KEY / PM_US_SECRET in .env.
 *  Run:  npx ts-node src/usScanner.ts
 * ====================================================
 */
import * as crypto from "crypto";
import * as fs from "fs";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const BASE       = process.env.PM_US_BASE ?? "https://api.polymarket.us";
const ACCESS_KEY = process.env.PM_US_ACCESS_KEY ?? "";
const SECRET_B64 = process.env.PM_US_SECRET ?? "";
const PREFIX     = "302e020100300506032b657004220420";

// ── filters (tune via .env) ──
const MIN_PRICE          = 0.05;
const MAX_PRICE          = 0.95;
const MAX_DAYS_TO_EXPIRY = parseInt(process.env.SCAN_MAX_DAYS ?? "400"); // US non-sports skew long-dated (e.g. midterms)
const MAX_PAGES          = 5;     // ~500 markets scanned
const PAGE_LIMIT         = 100;
const TOP_N              = parseInt(process.env.SCAN_TOP_N ?? "10");
const OUTPUT_FILE        = "scan_results.json";

function headers(method: string, path: string): Record<string, string> {
  const ts  = String(Date.now());
  const msg = ts + method + path;
  const seed = Buffer.from(SECRET_B64, "base64").subarray(0, 32);
  const der  = Buffer.concat([Buffer.from(PREFIX, "hex"), seed]);
  const key  = crypto.createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const sig  = crypto.sign(null, Buffer.from(msg), key).toString("base64");
  return { "X-PM-Access-Key": ACCESS_KEY, "X-PM-Timestamp": ts, "X-PM-Signature": sig, "Content-Type": "application/json" };
}

function parseJsonArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } }
  return [];
}
function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  return (new Date(iso).getTime() - Date.now()) / 86_400_000;
}

interface ScanMarket {
  // marketScanner-compatible fields (so researcher/predictor flow unchanged)
  id: string;
  conditionId: string;       // = slug; pipeline keys/dedupes on this
  question: string;
  outcomePrices: number[];   // [yes, no] as numbers
  clobTokenIds: string[];    // unused on US path; kept so downstream shape is happy
  endDateIso: string;
  score: number;
  // US-native fields the executor needs
  marketSlug: string;
  category: string;
  yesPrice: number;
  noPrice: number;
  tickSize: number;
  daysToExpiry: number;
}

async function fetchPage(cursor?: string): Promise<{ markets: any[]; nextCursor?: string; eof?: boolean }> {
  const path = "/v1/markets";
  const params: any = { closed: false, limit: PAGE_LIMIT };
  if (cursor) params.cursor = cursor;          // TODO: confirm cursor param name if pagination doesn't advance
  const res = await axios.get(BASE + path, { headers: headers("GET", path), params, timeout: 12000 });
  const d = res.data ?? {};
  const markets = Array.isArray(d) ? d : (d.markets ?? d.data ?? []);
  return { markets, nextCursor: d.nextCursor, eof: d.eof };
}

function evaluate(m: any): { ok: boolean; reason?: string; yes?: number; no?: number; days?: number } {
  if (m.closed)               return { ok: false, reason: "closed" };
  if (m.archived || m.hidden) return { ok: false, reason: "archived/hidden" };
  if (m.category === "sports") return { ok: false, reason: "sports" };

  const prices = parseJsonArray(m.outcomePrices).map(parseFloat);
  const outs   = parseJsonArray(m.outcomes);
  if (prices.length < 2 || outs.length < 2) return { ok: false, reason: "missing outcomes/prices" };

  let yesIdx = outs.findIndex(o => o.toLowerCase() === "yes");
  if (yesIdx < 0) yesIdx = 0;
  const noIdx = yesIdx === 0 ? 1 : 0;
  const yes = prices[yesIdx], no = prices[noIdx];

  if (!Number.isFinite(yes) || !Number.isFinite(no)) return { ok: false, reason: "bad price" };
  if (yes < MIN_PRICE || yes > MAX_PRICE)            return { ok: false, reason: "off-band" };

  const days = daysUntil(m.endDate);
  if (days === null) return { ok: false, reason: "no endDate" };
  if (days < 0)      return { ok: false, reason: "past" };
  if (days > MAX_DAYS_TO_EXPIRY) return { ok: false, reason: "too far" };

  return { ok: true, yes, no, days };
}

function scoreMarket(yes: number, days: number): number {
  // No volume field on this endpoint, so score on uncertainty (closer to 0.5 =
  // more room for edge) + timeliness (sooner resolution preferred). Tune freely.
  const uncertainty = 1 - Math.abs(yes - 0.5) * 2;
  const timeliness  = Math.max(0, 1 - days / MAX_DAYS_TO_EXPIRY);
  return Number((uncertainty * 0.7 + timeliness * 0.3).toFixed(4));
}

async function main() {
  if (!ACCESS_KEY || !SECRET_B64) { console.error("PM_US_ACCESS_KEY / PM_US_SECRET missing in .env"); process.exit(1); }
  console.log("\n" + "=".repeat(60) + "\n  POLYMARKET US SCANNER\n" + "=".repeat(60));

  const all: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { markets, nextCursor, eof } = await fetchPage(cursor);
    all.push(...markets);
    console.log(`  page ${page + 1}: +${markets.length} (total ${all.length})`);
    if (eof || !nextCursor || markets.length === 0) break;
    cursor = nextCursor;
    await new Promise(r => setTimeout(r, 300));
  }

  const results: ScanMarket[] = [];
  const drop: Record<string, number> = {};
  for (const m of all) {
    const t = evaluate(m);
    if (!t.ok) { drop[t.reason!] = (drop[t.reason!] ?? 0) + 1; continue; }
    const outs = parseJsonArray(m.outcomes);
    results.push({
      id: m.slug, conditionId: m.slug, marketSlug: m.slug,
      question: m.question ?? "", category: m.category ?? "",
      yesPrice: t.yes!, noPrice: t.no!,
      outcomePrices: [t.yes!, t.no!],
      tickSize: m.orderPriceMinTickSize ?? 0.01,
      daysToExpiry: Number(t.days!.toFixed(1)),
      endDateIso: m.endDate ?? "",
      clobTokenIds: outs,
      score: scoreMarket(t.yes!, t.days!),
    });
  }
  results.sort((a, b) => b.score - a.score);

  console.log(`\n  Scanned ${all.length} | tradeable ${results.length}`);
  console.log(`  dropped: ${JSON.stringify(drop)}\n`);
  for (const r of results.slice(0, TOP_N)) {
    console.log(`  ${r.score.toFixed(3)}  yes ${r.yesPrice.toFixed(3)}  ${String(r.daysToExpiry.toFixed(0)).padStart(4)}d  ${r.category.padEnd(9)} ${r.question.slice(0, 45)}`);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
    timestamp: new Date().toISOString(),
    venue: "polymarket_us",
    totalScanned: all.length,
    tradeableCount: results.length,
    markets: results.slice(0, TOP_N),
  }, null, 2));
  console.log(`\n  ✓ wrote ${OUTPUT_FILE} (${Math.min(TOP_N, results.length)} markets)\n`);
}

main().catch(e =>
  console.error("[FATAL]", e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data).slice(0, 200)}` : e.message)
);