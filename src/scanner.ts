/**
 * ====================================================
 *  PREDICTION MARKET TRADING BOT — STEP 1: SCANNER
 *  Kalshi REST API v2 | RSA-PSS Auth | TypeScript
 * ====================================================
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import axios, { AxiosInstance } from "axios";
import * as dotenv from "dotenv";

dotenv.config();

// ─── CONFIG ────────────────────────────────────────────────
const KEY_ID = process.env.KALSHI_KEY_ID ?? "";
const PRIVATE_KEY_PATH = process.env.KALSHI_PRIVATE_KEY_PATH ?? "./kalshi_private.key";
const ENV = process.env.KALSHI_ENV ?? "demo";
const BASE_URL = ENV === "demo"
  ? "https://demo-api.kalshi.co/trade-api/v2"
  : "https://api.elections.kalshi.com/trade-api/v2";

const MIN_VOLUME = 500;           // raised: junk markets have tiny volume
const MAX_DAYS_TO_EXPIRY = 7;
const MIN_OPEN_INTEREST = 200;    // raised: need real liquidity
const MAX_MARKETS_TO_RESEARCH = 10;
const PRICE_SPIKE_THRESHOLD = 0.1;
const SPREAD_THRESHOLD = 0.05;
const MIN_PRICE = 0.05;           // NEW: block sub-5¢ lottery tickets
const MAX_PRICE = 0.95;           // NEW: block near-certain markets (no edge)

// Hard-blocked series — never trade these regardless of score
const BLOCKED_SERIES = [
  "MULTIGAME",      // sports parlays (5+ team combos)
  "CROSSCATEGORY",  // mixed junk parlays
  "KXMVESPORTS",    // sports multi-game extended
  "KXMVECROSS",     // cross-category junk
];

// Preferred series — economics, politics, macro
const PREFERRED_SERIES = [
  "PRES", "FED", "CPI", "GDP", "JOBS", "SENATE", "HOUSE",
  "GOV", "ECON", "CRYPTO", "INX", "NASDAQ", "INXD",
  "UNEMP", "PCE", "PPI", "RETAIL", "HOUSING",
];

// ─── TYPES ─────────────────────────────────────────────────
interface KalshiMarket {
  ticker: string;
  title: string;
  status: string;
  volume_fp?: string;
  open_interest_fp?: string;
  last_price_dollars?: string;
  previous_price_dollars?: string;
  yes_bid_dollars?: string;
  no_ask_dollars?: string;
  close_time?: string;
  expiration_time?: string;
}

interface OrderBook {
  orderbook?: {
    yes?: [number | string, number][];
    no?: [number | string, number][];
  };
}

interface ScanResult {
  ticker: string;
  title: string;
  lastPrice: number;
  volume: number;
  openInterest: number;
  daysToExpiry: number;
  flags: string[];
  score: number;
}

// ─── AUTH ──────────────────────────────────────────────────
function loadPrivateKey(): crypto.KeyObject {
  const keyPath = path.resolve(PRIVATE_KEY_PATH);
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Private key not found at: ${keyPath}`);
  }
  const keyData = fs.readFileSync(keyPath, "utf-8");
  return crypto.createPrivateKey(keyData);
}

function buildAuthHeaders(privateKey: crypto.KeyObject, method: string, urlPath: string): Record<string, string> {
  const timestampMs = Date.now().toString();
  const message = timestampMs + method.toUpperCase() + urlPath;
  const signature = crypto.sign("SHA256", Buffer.from(message, "utf-8"), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return {
    "KALSHI-ACCESS-KEY": KEY_ID,
    "KALSHI-ACCESS-TIMESTAMP": timestampMs,
    "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
    "Content-Type": "application/json",
  };
}

// ─── KALSHI CLIENT ─────────────────────────────────────────
class KalshiClient {
  private http: AxiosInstance;
  private privateKey: crypto.KeyObject;

  constructor() {
    this.privateKey = loadPrivateKey();
    this.http = axios.create({ baseURL: BASE_URL, timeout: 10_000 });
    console.log(`✓ Kalshi client ready [ENV=${ENV.toUpperCase()}]`);
  }

  private async get<T>(urlPath: string, params?: Record<string, unknown>, auth = false): Promise<T> {
    const headers = auth ? buildAuthHeaders(this.privateKey, "GET", `/trade-api/v2${urlPath}`) : {};
    const resp = await this.http.get<T>(urlPath, { headers, params });
    return resp.data;
  }

  async ping(): Promise<boolean> {
    try { await this.http.get("/exchange/status"); return true; } catch { return false; }
  }

  async getBalance(): Promise<{ balance: number }> {
    return this.get("/portfolio/balance", undefined, true);
  }

  async getMarkets(limit = 200, cursor?: string): Promise<{ markets: KalshiMarket[]; cursor?: string }> {
    const params: Record<string, unknown> = { limit, status: "open" };
    if (cursor) params.cursor = cursor;
    return this.get("/markets", params);
  }

  async getOrderbook(ticker: string, depth = 5): Promise<OrderBook> {
    return this.get(`/markets/${ticker}/orderbook`, { depth });
  }
}

// ─── HELPERS ───────────────────────────────────────────────
function parsePrice(raw: number | string | undefined): number {
  if (raw == null) return 0;
  if (typeof raw === "string") return parseFloat(raw);
  return raw > 1 ? raw / 100 : raw;
}

function daysUntilExpiry(closeTime?: string): number | null {
  if (!closeTime) return null;
  const close = new Date(closeTime).getTime();
  const now = Date.now();
  return (close - now) / (1000 * 60 * 60 * 24);
}

function isBlocked(ticker: string): boolean {
  const upper = ticker.toUpperCase();
  return BLOCKED_SERIES.some(b => upper.includes(b.toUpperCase()));
}

function isTradeable(m: KalshiMarket): { ok: boolean; reason: string } {
  // Hard block junk series first
  if (isBlocked(m.ticker)) return { ok: false, reason: "blocked series (parlay/junk)" };

  const volume = parseFloat(m.volume_fp ?? "0");
  const oi = parseFloat(m.open_interest_fp ?? "0");
  const price = parseFloat(m.last_price_dollars ?? "0");
  const days = daysUntilExpiry(m.close_time ?? m.expiration_time);

  if (volume < MIN_VOLUME)        return { ok: false, reason: `low volume (${volume})` };
  if (oi < MIN_OPEN_INTEREST)     return { ok: false, reason: `low OI (${oi})` };
  if (days === null)               return { ok: false, reason: "missing expiry" };
  if (days < 0)                   return { ok: false, reason: "expired" };
  if (days > MAX_DAYS_TO_EXPIRY)  return { ok: false, reason: `too far out (${days.toFixed(1)}d)` };
  if (price < MIN_PRICE)          return { ok: false, reason: `price too low ($${price.toFixed(3)}) — lottery ticket` };
  if (price > MAX_PRICE)          return { ok: false, reason: `price too high ($${price.toFixed(3)}) — no edge` };

  return { ok: true, reason: "" };
}

function detectAnomalies(m: KalshiMarket, ob: OrderBook): string[] {
  const flags: string[] = [];
  const lastPrice = parseFloat(m.last_price_dollars ?? "0");
  const openPrice = parseFloat(m.previous_price_dollars ?? "0");
  if (openPrice > 0 && lastPrice > 0) {
    const change = Math.abs(lastPrice - openPrice) / openPrice;
    if (change > PRICE_SPIKE_THRESHOLD) {
      const dir = lastPrice > openPrice ? "↑" : "↓";
      flags.push(`PRICE_SPIKE ${dir}${(change * 100).toFixed(1)}%`);
    }
  }
  const yesBids = ob.orderbook?.yes ?? [];
  const noBids = ob.orderbook?.no ?? [];
  if (yesBids.length && noBids.length) {
    const bestBid = parsePrice(Array.isArray(yesBids[0]) ? yesBids[0][0] : yesBids[0]);
    const bestNo = parsePrice(Array.isArray(noBids[0]) ? noBids[0][0] : noBids[0]);
    const bestAsk = 1.0 - bestNo;
    const spread = bestAsk - bestBid;
    if (spread > SPREAD_THRESHOLD) {
      flags.push(`WIDE_SPREAD $${spread.toFixed(3)}`);
    }
  }
  return flags;
}

function scoreMarket(m: KalshiMarket, days: number, flags: string[]): number {
  const volume = parseFloat(m.volume_fp ?? "0");
  const oi = parseFloat(m.open_interest_fp ?? "0");
  const volScore = Math.min(volume / 10_000, 1.0);
  const oiScore = Math.min(oi / 5_000, 1.0);
  const timeScore = Math.max(0, 1.0 - days / MAX_DAYS_TO_EXPIRY);
  const anomalyBonus = flags.length * 0.1;
  // Bonus for preferred series
  const preferredBonus = PREFERRED_SERIES.some(s => m.ticker.toUpperCase().includes(s)) ? 0.2 : 0;
  return parseFloat((volScore * 0.35 + oiScore * 0.25 + timeScore * 0.25 + anomalyBonus + preferredBonus).toFixed(4));
}

// ─── MAIN SCAN ─────────────────────────────────────────────
async function runScan(client: KalshiClient): Promise<ScanResult[]> {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SCAN STARTED  [${timestamp}]`);
  console.log(`${"═".repeat(60)}`);

  // 1. Fetch all open markets
  const allMarkets: KalshiMarket[] = [];
  let cursor: string | undefined;
  let page = 0;
  do {
    page++;
    const resp = await client.getMarkets(200, cursor);
    allMarkets.push(...resp.markets);
    cursor = resp.cursor;
    console.log(`  Page ${page}: +${resp.markets.length} markets (total: ${allMarkets.length})`);
    await new Promise((r) => setTimeout(r, 500));
  } while (cursor && allMarkets.length < 1000);

  // 2. Filter tradeable (with hard blocks applied inside isTradeable)
  const blocked = allMarkets.filter(m => isBlocked(m.ticker));
  const tradeable = allMarkets.filter((m) => isTradeable(m).ok);
  console.log(`\n  Total: ${allMarkets.length} | Blocked (junk): ${blocked.length} | Tradeable: ${tradeable.length}`);

  // 3. Enrich with orderbook + score
  const results: ScanResult[] = [];
  for (const m of tradeable) {
    try {
      const ob = await client.getOrderbook(m.ticker, 5);
      const flags = detectAnomalies(m, ob);
      const days = daysUntilExpiry(m.close_time ?? m.expiration_time) ?? 0;
      const score = scoreMarket(m, days, flags);
      results.push({
        ticker: m.ticker,
        title: m.title?.slice(0, 60) ?? "",
        lastPrice: parseFloat(m.last_price_dollars ?? "0"),
        volume: parseFloat(m.volume_fp ?? "0"),
        openInterest: parseFloat(m.open_interest_fp ?? "0"),
        daysToExpiry: parseFloat(days.toFixed(1)),
        flags,
        score,
      });
      await new Promise((r) => setTimeout(r, 100));
    } catch (e) {
      console.warn(`  Skipping ${m.ticker}: ${(e as Error).message}`);
    }
  }

  // 4. Sort: preferred first, then by score
  const preferred = results.filter(r => PREFERRED_SERIES.some(s => r.ticker.toUpperCase().includes(s)));
  const neutral   = results.filter(r => !PREFERRED_SERIES.some(s => r.ticker.toUpperCase().includes(s)));

  preferred.sort((a, b) => b.score - a.score);
  neutral.sort((a, b) => b.score - a.score);

  const reordered: ScanResult[] = [...preferred, ...neutral];

  // 5. Print ranked table
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${"#".padEnd(3)} ${"TICKER".padEnd(30)} ${"PRICE".padStart(6)} ${"VOL".padStart(8)} ${"DAYS".padStart(5)} ${"SCORE".padStart(6)}`);
  console.log(`${"─".repeat(70)}`);

  const top = reordered.slice(0, 20);
  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const flagMark = r.flags.length ? " 🚩" : "";
    const category = PREFERRED_SERIES.some(s => r.ticker.toUpperCase().includes(s)) ? " ⭐" : "";
    console.log(
      `  ${String(i + 1).padEnd(3)} ${r.ticker.padEnd(30)} ` +
      `$${r.lastPrice.toFixed(2).padStart(5)} ` +
      `${r.volume.toLocaleString().padStart(8)} ` +
      `${r.daysToExpiry.toFixed(1).padStart(4)}d ` +
      `${r.score.toFixed(3).padStart(6)}` +
      flagMark + category
    );
  }

  console.log(`${"═".repeat(70)}`);
  console.log(`  Top ${Math.min(20, reordered.length)} shown | ⭐ Econ/Politics: ${preferred.length} | Neutral: ${neutral.length}`);

  // 6. Save top markets for researcher
  const output = {
    timestamp: new Date().toISOString(),
    env: ENV,
    totalScanned: allMarkets.length,
    blockedCount: blocked.length,
    tradeableCount: reordered.length,
    markets: reordered.slice(0, MAX_MARKETS_TO_RESEARCH),
  };
  fs.writeFileSync("scan_results.json", JSON.stringify(output, null, 2));
  console.log("\n  ✓ Results saved to scan_results.json\n");

  return reordered;
}

// ─── ENTRYPOINT ────────────────────────────────────────────
async function main() {
  if (!KEY_ID) {
    console.error("[ERROR] KALSHI_KEY_ID is not set.");
    process.exit(1);
  }

  const client = new KalshiClient();
  const alive = await client.ping();
  if (!alive) {
    console.error("[ERROR] Kalshi API is unreachable.");
    process.exit(1);
  }

  try {
    const { balance } = await client.getBalance();
    console.log(`  ✓ Auth OK — Balance: $${(balance / 100).toFixed(2)}`);
  } catch (e) {
    console.warn(`  ⚠ Auth check failed: ${(e as Error).message}`);
  }

  await runScan(client);
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});