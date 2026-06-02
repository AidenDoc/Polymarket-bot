/**
 * ====================================================
 *  POLYMARKET TRADING BOT — STEP 6: CLOSER
 *  Checks open positions via Gamma API and closes
 *  resolved ones with P&L calculation
 * ====================================================
 *
 * How to run:
 *   npx ts-node src/closer.ts
 *
 * No auth required — uses public Polymarket Gamma API
 * ====================================================
 */

import * as fs from "fs";
import * as https from "https";
import * as dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const GAMMA_API        = "https://gamma-api.polymarket.com";
const CLOB_API         = "https://clob.polymarket.com";
const STARTING_BANKROLL = parseFloat(process.env.STARTING_BANKROLL ?? "1000");
const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

const OPEN_POSITIONS_FILE  = "open_positions.json";
const TRADE_HISTORY_FILE   = "trade_history.json";
const PERFORMANCE_FILE     = "performance_metrics.json";
const PORTFOLIO_FILE       = "portfolio.json";

// ─────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────

interface OpenPosition {
  conditionId: string;
  question:    string;
  action:      "BUY_YES" | "BUY_NO";
  tokenId:     string;
  price:       number;
  sizeUsdc:    number;
  openedAt:    string;
  orderId?:    string;
  paper:       boolean;
}

interface ClosedRecord extends OpenPosition {
  closedAt:   string;
  exitPrice:  number;
  pnl:        number;
  outcome:    "WIN" | "LOSS" | "PUSH";
}

interface MarketStatus {
  resolved:     boolean;
  yesWon:       boolean;
  noWon:        boolean;
  currentPrice: number;  // YES token mid-price
}

// ─────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────

function log(msg: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
  const ts = new Date().toLocaleTimeString();
  const prefix = level === "ERROR" ? "[ERR] " : level === "WARN" ? "[WARN]" : "[OK]  ";
  console.log(`  [${ts}] ${prefix} ${msg}`);
}

function loadJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {}
  return fallback;
}

function saveJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────────
// TELEGRAM
// ─────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" },
      { timeout: 8000 }
    );
  } catch {}
}

// ─────────────────────────────────────────────────
// GAMMA API: MARKET STATUS
// ─────────────────────────────────────────────────

async function getMarketStatus(conditionId: string): Promise<MarketStatus | null> {
  try {
    const res = await axios.get(`${GAMMA_API}/markets`, {
      params: { condition_ids: conditionId },  // snake_case plural — Gamma ignores unknown params
      timeout: 10000,
    });

    const markets: any[] = Array.isArray(res.data) ? res.data : (res.data?.markets ?? [res.data]);
    const market = markets.find((m: any) => m.conditionId === conditionId) ?? markets[0];

    if (!market) return null;

    // outcomePrices comes back as a stringified JSON array from Gamma — must parse
    let prices: number[] = [0.5, 0.5];
    try {
      const raw = typeof market.outcomePrices === "string"
        ? JSON.parse(market.outcomePrices)
        : market.outcomePrices;
      if (Array.isArray(raw)) prices = raw.map((p: string) => parseFloat(p));
    } catch {}
    const p0 = prices[0] ?? 0.5;  // YES price
    const p1 = prices[1] ?? 0.5;  // NO price

    // Gamma signals resolution via closed=true or prices pinned to rails (no resolved field)
    const resolved: boolean =
      market.closed === true ||
      (p0 >= 0.99 && p1 <= 0.01) ||
      (p0 <= 0.01 && p1 >= 0.99);

    const yesWon = resolved && p0 >= 0.99;
    const noWon  = resolved && p1 >= 0.99;

    return {
      resolved,
      yesWon,
      noWon,
      currentPrice: p0,
    };
  } catch (e: any) {
    log(`Gamma error for ${conditionId.slice(0, 12)}...: ${e.message}`, "WARN");
    return null;
  }
}

// ─────────────────────────────────────────────────
// CLOB API: CURRENT MID PRICE (for unrealized P&L)
// ─────────────────────────────────────────────────

async function getCurrentPrice(tokenId: string): Promise<number | null> {
  try {
    const res = await axios.get(`${CLOB_API}/price`, {
      params: { token_id: tokenId, side: "buy" },
      timeout: 8000,
    });
    const price = parseFloat(res.data?.price ?? "0");
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────
// P&L CALCULATION
// ─────────────────────────────────────────────────

function calculatePnl(
  position: OpenPosition,
  yesWon: boolean,
  noWon: boolean
): { pnl: number; exitPrice: number; outcome: "WIN" | "LOSS" | "PUSH" } {
  const tokenAmount = position.price > 0 ? position.sizeUsdc / position.price : 0;

  const won =
    (position.action === "BUY_YES" && yesWon) ||
    (position.action === "BUY_NO"  && noWon);
  const lost =
    (position.action === "BUY_YES" && noWon) ||
    (position.action === "BUY_NO"  && yesWon);

  if (won) {
    // Each token redeems for $1.00 USDC
    const pnl = tokenAmount * 1.0 - position.sizeUsdc;
    return { pnl, exitPrice: 1.0, outcome: "WIN" };
  } else if (lost) {
    // Tokens expire worthless
    return { pnl: -position.sizeUsdc, exitPrice: 0.0, outcome: "LOSS" };
  } else {
    // Void / push — return cost basis
    return { pnl: 0, exitPrice: position.price, outcome: "PUSH" };
  }
}

// ─────────────────────────────────────────────────
// PERFORMANCE METRICS
// ─────────────────────────────────────────────────

function updatePerformanceMetrics(history: ClosedRecord[]): void {
  const totalTrades = history.length;
  if (totalTrades === 0) return;

  const wins   = history.filter((r) => r.outcome === "WIN").length;
  const losses = history.filter((r) => r.outcome === "LOSS").length;
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;

  const pnls   = history.map((r) => r.pnl);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const roi      = (totalPnl / STARTING_BANKROLL) * 100;
  const avgPnl   = totalPnl / totalTrades;

  const variance = pnls.length > 1
    ? pnls.reduce((a, b) => a + Math.pow(b - avgPnl, 2), 0) / pnls.length
    : 1;
  const sharpeRatio = avgPnl / (Math.sqrt(variance) || 1);

  // Max drawdown
  let peak = STARTING_BANKROLL;
  let maxDrawdown = 0;
  let running = STARTING_BANKROLL;
  for (const r of history) {
    running += r.pnl;
    if (running > peak) peak = running;
    const dd = (peak - running) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const grossWins   = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLosses = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

  saveJson(PERFORMANCE_FILE, {
    timestamp: new Date().toISOString(),
    totalTrades,
    wins,
    losses,
    winRate,
    totalPnl,
    roi,
    sharpeRatio,
    maxDrawdown: maxDrawdown * 100,
    profitFactor,
    avgPnl,
    bankroll: STARTING_BANKROLL + totalPnl,
  });
}

// ─────────────────────────────────────────────────
// PORTFOLIO SUMMARY (for dashboard compatibility)
// ─────────────────────────────────────────────────

function updatePortfolio(
  closedHistory: ClosedRecord[],
  openPositions: OpenPosition[]
): void {
  const totalPnl    = closedHistory.reduce((a, r) => a + r.pnl, 0);
  const wins        = closedHistory.filter((r) => r.outcome === "WIN").length;
  const losses      = closedHistory.filter((r) => r.outcome === "LOSS").length;
  const cashInTrade = openPositions.reduce((a, p) => a + p.sizeUsdc, 0);
  const bankroll    = STARTING_BANKROLL + totalPnl;

  const today  = new Date().toDateString();
  const todayPnl = closedHistory
    .filter((r) => new Date(r.closedAt).toDateString() === today)
    .reduce((a, r) => a + r.pnl, 0);

  saveJson(PORTFOLIO_FILE, {
    bankroll,
    startingBankroll: STARTING_BANKROLL,
    cashAvailable:    bankroll - cashInTrade,
    totalPnl,
    dailyPnl:         todayPnl,
    winCount:         wins,
    lossCount:        losses,
    openPositions:    openPositions.length,
    lastUpdated:      new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "═".repeat(65));
  console.log("  STEP 6: CLOSER");
  console.log("  Checking open positions for resolution...");
  console.log("═".repeat(65) + "\n");

  const openPositions = loadJson<OpenPosition[]>(OPEN_POSITIONS_FILE, []);

  if (openPositions.length === 0) {
    log("No open positions to check");
    console.log("  Nothing to close\n");
    return;
  }

  log(`Checking ${openPositions.length} open position(s)...`);

  const closedHistory = loadJson<ClosedRecord[]>(TRADE_HISTORY_FILE, [])
    .filter((r: any) => r.closedAt !== undefined) as ClosedRecord[];

  const stillOpen:  OpenPosition[] = [];
  let closedCount = 0;

  for (const position of openPositions) {
    const label = position.question.slice(0, 50);
    console.log(`\n  ── ${position.action} | ${label}`);

    const status = await getMarketStatus(position.conditionId);

    if (!status) {
      log(`Could not fetch status — keeping open`, "WARN");
      stillOpen.push(position);
      continue;
    }

    if (status.resolved) {
      const { pnl, exitPrice, outcome } = calculatePnl(position, status.yesWon, status.noWon);

      const closed: ClosedRecord = {
        ...position,
        closedAt:  new Date().toISOString(),
        exitPrice,
        pnl,
        outcome,
      };

      closedHistory.push(closed);
      closedCount++;

      const emoji = outcome === "WIN" ? "✅" : outcome === "LOSS" ? "❌" : "➖";
      const pnlStr = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
      log(`${emoji} CLOSED: ${outcome} | P&L: ${pnlStr} | entry $${position.price.toFixed(4)} → exit $${exitPrice.toFixed(2)}`);

      await sendTelegram(
        `${emoji} <b>POSITION CLOSED — ${outcome}</b>\n` +
        `${position.action === "BUY_YES" ? "🟢" : "🔴"} <b>${position.action}</b>\n` +
        `📊 ${label}\n` +
        `💵 Entry: $${position.price.toFixed(4)}\n` +
        `🏁 Exit: $${exitPrice.toFixed(2)}\n` +
        `💰 P&amp;L: <b>${pnlStr}</b>\n` +
        `📐 Size: $${position.sizeUsdc.toFixed(2)}` +
        (position.paper ? "\n📝 (paper)" : "")
      );
    } else {
      // Still open — show unrealized P&L
      const livePrice = await getCurrentPrice(position.tokenId) ?? status.currentPrice;
      const tokenAmount = position.price > 0 ? position.sizeUsdc / position.price : 0;
      const unrealized = position.action === "BUY_YES"
        ? (livePrice - position.price)  * tokenAmount
        : (position.price - livePrice)  * tokenAmount;
      const unrealStr = `${unrealized >= 0 ? "+" : ""}$${unrealized.toFixed(2)}`;

      log(`Still open | price $${position.price.toFixed(4)} → $${livePrice.toFixed(4)} | unrealized: ${unrealStr}`);
      stillOpen.push(position);
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  // Persist all updates
  saveJson(OPEN_POSITIONS_FILE, stillOpen);

  // Append newly closed records to trade_history.json
  const allHistory = loadJson<any[]>(TRADE_HISTORY_FILE, []);
  // Remove any previously-closed records for the same conditionIds we just closed
  const newlyClosedIds = new Set(
    closedHistory
      .slice(closedHistory.length - closedCount)
      .map((r) => r.conditionId)
  );
  const existingOpen = allHistory.filter(
    (r: any) => !newlyClosedIds.has(r.conditionId) || r.closedAt !== undefined
  );
  const newClosed = closedHistory.slice(closedHistory.length - closedCount);
  saveJson(TRADE_HISTORY_FILE, [...existingOpen, ...newClosed]);

  if (closedCount > 0) {
    updatePerformanceMetrics(closedHistory);
    updatePortfolio(closedHistory, stillOpen);
  }

  console.log("\n" + "═".repeat(65));
  console.log(`  Closed: ${closedCount}  |  Still open: ${stillOpen.length}`);

  if (closedHistory.length > 0) {
    const totalPnl = closedHistory.reduce((a, r) => a + r.pnl, 0);
    const wins     = closedHistory.filter((r) => r.outcome === "WIN").length;
    const losses   = closedHistory.filter((r) => r.outcome === "LOSS").length;
    console.log(`  All-time P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`);
    console.log(`  Win/Loss: ${wins}W / ${losses}L`);
  }

  console.log("═".repeat(65) + "\n");
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});
