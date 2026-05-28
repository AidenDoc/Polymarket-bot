/**
 * ====================================================
 *  POLYMARKET MARKET SCANNER
 *  Gamma API | TypeScript | ts-node runnable
 * ====================================================
 */

import * as fs from "fs";
import axios from "axios";

// ─── CONFIG ────────────────────────────────────────────────
const GAMMA_URL = "https://gamma-api.polymarket.com/markets";
const MIN_LIQUIDITY = 500;
const MIN_VOLUME_24H = 10;
const MAX_DAYS_TO_EXPIRY = 30;
const TOP_N = 20;
const WHALE_SCORE_BONUS  = 0.30;
const WHALE_LOOKBACK_MS  = 24 * 60 * 60 * 1000;

const NOISE_KEYWORDS = [
  "up or down", "bitcoin up", "ethereum up", "15 min", "5 min", "1 hour",
  "iem", "cologne", "billboard", "netflix", "post from", "tweets from",
  "how many", "number of",
];

// ─── TYPES ─────────────────────────────────────────────────
interface RawMarket {
  id: string;
  conditionId: string;
  question: string;
  outcomePrices: string;       // JSON string: "[\"0.65\",\"0.35\"]"
  volume24hr: number;
  liquidityNum: number;
  spread: number;
  endDateIso: string;
  clobTokenIds: string;        // JSON string: "[\"123\",\"456\"]"
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
}

export interface ScoredMarket {
  id: string;
  conditionId: string;
  question: string;
  outcomePrices: number[];
  volume24hr: number;
  liquidityNum: number;
  spread: number;
  endDateIso: string;
  clobTokenIds: string[];
  score: number;
}

// ─── HELPERS ───────────────────────────────────────────────
function daysUntil(isoDate: string): number {
  return (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

function isNoise(question: string): boolean {
  const lower = question.toLowerCase();
  return NOISE_KEYWORDS.some((kw) => lower.includes(kw));
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function scoreMarket(m: RawMarket): number {
  // Normalise each component to [0, 1] with soft caps
  const volScore = Math.min(m.volume24hr / 50_000, 1.0);
  const liqScore = Math.min(m.liquidityNum / 100_000, 1.0);
  // Spread: 0 = perfect (score 1), 0.10+ = worst (score 0)
  const spreadScore = Math.max(0, 1.0 - m.spread / 0.10);
  return volScore * 0.40 + liqScore * 0.35 + spreadScore * 0.25;
}

// ─── WHALE LOADER ──────────────────────────────────────────
function loadWhaleConditionIds(): Set<string> {
  const ids = new Set<string>();
  try {
    if (!fs.existsSync("whale_signals.json")) return ids;
    const raw = JSON.parse(fs.readFileSync("whale_signals.json", "utf-8"));
    const signals: any[] = Array.isArray(raw) ? raw : (raw.signals ?? []);
    const cutoff = Date.now() - WHALE_LOOKBACK_MS;
    for (const s of signals) {
      if (s.conditionId && new Date(s.timestamp).getTime() >= cutoff) {
        ids.add(s.conditionId);
      }
    }
  } catch {}
  return ids;
}

// ─── FETCH ─────────────────────────────────────────────────
async function fetchMarkets(limit = 500): Promise<RawMarket[]> {
  const resp = await axios.get<RawMarket[]>(GAMMA_URL, {
    params: { active: true, closed: false, limit },
    timeout: 15_000,
  });
  if (!Array.isArray(resp.data)) {
    throw new Error(`Unexpected response shape: ${JSON.stringify(resp.data).slice(0, 200)}`);
  }
  return resp.data;
}

// ─── MAIN SCAN ─────────────────────────────────────────────
async function runScan(): Promise<ScoredMarket[]> {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  POLYMARKET SCAN  [${timestamp}]`);
  console.log(`${"═".repeat(60)}`);

  // 1. Fetch
  const raw = await fetchMarkets(500);
  console.log(`  Fetched: ${raw.length} markets`);

  // Load whale activity for score boosting
  const whaleIds = loadWhaleConditionIds();
  console.log(`  Whale-active markets (24h): ${whaleIds.size}`);

  // 2. Filter
  const now = Date.now();
  const filtered = raw.filter((m) => {
    if (!m.acceptingOrders)                          return false;
    if (m.liquidityNum < MIN_LIQUIDITY)              return false;
    if (m.volume24hr < MIN_VOLUME_24H)               return false;
    if (!m.endDateIso)                               return false;
    const days = daysUntil(m.endDateIso);
    if (days < 0 || days > MAX_DAYS_TO_EXPIRY)       return false;
    if (isNoise(m.question))                         return false;
    return true;
  });
  console.log(`  After filters: ${filtered.length} markets`);

  // 3. Score + shape output (whale-active markets get +0.30 bonus)
  const scored: ScoredMarket[] = filtered.map((m) => {
    const base  = scoreMarket(m);
    const bonus = whaleIds.has(m.conditionId) ? WHALE_SCORE_BONUS : 0;
    return {
      id: m.id,
      conditionId: m.conditionId,
      question: m.question,
      outcomePrices: parseJsonArray(m.outcomePrices).map(Number),
      volume24hr: m.volume24hr,
      liquidityNum: m.liquidityNum,
      spread: m.spread,
      endDateIso: m.endDateIso,
      clobTokenIds: parseJsonArray(m.clobTokenIds),
      score: parseFloat((base + bonus).toFixed(4)),
    };
  });

  // 4. Sort descending by score, take top N
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N);

  // 5. Print ranked table
  console.log(`\n${"═".repeat(80)}`);
  console.log(
    `  ${"#".padEnd(3)} ${"QUESTION".padEnd(45)} ${"VOL24H".padStart(9)} ${"LIQ".padStart(10)} ${"SCORE".padStart(6)}`
  );
  console.log(`${"─".repeat(80)}`);
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const q = r.question.slice(0, 44).padEnd(44);
    const vol = `$${(r.volume24hr / 1000).toFixed(1)}k`.padStart(8);
    const liq = `$${(r.liquidityNum / 1000).toFixed(1)}k`.padStart(9);
    const whale = whaleIds.has(r.conditionId) ? " 🐳" : "";
    console.log(`  ${String(i + 1).padEnd(3)} ${q} ${vol} ${liq} ${r.score.toFixed(3).padStart(6)}${whale}`);
  }
  console.log(`${"═".repeat(80)}`);
  console.log(`  Top ${top.length} shown of ${scored.length} qualifying markets`);

  // 6. Save results
  const output = {
    timestamp: new Date().toISOString(),
    totalFetched: raw.length,
    qualifyingCount: scored.length,
    markets: top,
  };
  fs.writeFileSync("scan_results.json", JSON.stringify(output, null, 2));
  console.log("  ✓ Results saved to scan_results.json\n");

  return top;
}

// ─── ENTRYPOINT ────────────────────────────────────────────
async function main() {
  try {
    await runScan();
  } catch (err) {
    console.error("[FATAL]", (err as Error).message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
