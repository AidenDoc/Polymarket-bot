/**
 * ====================================================
 *  PREDICTION MARKET TRADING BOT — STEP 5: COMPOUNDER
 *  Learning system — post-mortems, knowledge base,
 *  performance metrics, nightly consolidation
 * ====================================================
 *
 * How to run:
 *   npx ts-node src/compounder.ts
 *
 * Set up nightly: add "compound" to your scheduler
 * ====================================================
 */

import * as fs from "fs";
import * as dotenv from "dotenv";
import * as https from "https";

dotenv.config();

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? "";

// ─────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────

interface Position {
  ticker: string;
  title: string;
  action: "BUY_YES" | "BUY_NO";
  contracts: number;
  entryPrice: number;
  costBasis: number;
  openedAt: string;
  status: "OPEN" | "CLOSED";
  closedAt?: string;
  exitPrice?: number;
  pnl?: number;
  outcome?: "WIN" | "LOSS" | "PUSH";
}

interface Portfolio {
  bankroll: number;
  startingBankroll: number;
  cashAvailable: number;
  positions: Position[];
  dailyPnl: number;
  dailyLossLimit: number;
  totalPnl: number;
  winCount: number;
  lossCount: number;
  lastResetDate: string;
}

interface TradeLog {
  ticker: string;
  title: string;
  action: string;
  entryPrice: number;
  exitPrice: number;
  predictedProbability: number;
  actualOutcome: number;
  pnl: number;
  holdingPeriodHours: number;
  marketConditions: string;
  failureType?: "BAD_PREDICTION" | "BAD_TIMING" | "BAD_EXECUTION" | "EXTERNAL_SHOCK" | null;
  lesson?: string;
  timestamp: string;
}

interface KnowledgeBase {
  lastUpdated: string;
  totalLessons: number;
  avoidPatterns: string[];
  successPatterns: string[];
  failureLogs: {
    ticker: string;
    failureType: string;
    lesson: string;
    date: string;
  }[];
  marketBlacklist: string[];
}

interface PerformanceMetrics {
  timestamp: string;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  brierScore: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
}

// ─────────────────────────────────────────────────
// FILE PATHS
// ─────────────────────────────────────────────────

const PORTFOLIO_FILE = "portfolio.json";
const KNOWLEDGE_BASE_FILE = "knowledge_base.json";
const TRADE_LOG_FILE = "trade_log.json";
const METRICS_FILE = "performance_metrics.json";
const CALIBRATION_FILE = "calibration_log.json";

// ─────────────────────────────────────────────────
// LOADERS
// ─────────────────────────────────────────────────

function loadPortfolio(): Portfolio | null {
  if (!fs.existsSync(PORTFOLIO_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, "utf-8")); }
  catch { return null; }
}

function loadKnowledgeBase(): KnowledgeBase {
  if (fs.existsSync(KNOWLEDGE_BASE_FILE)) {
    try { return JSON.parse(fs.readFileSync(KNOWLEDGE_BASE_FILE, "utf-8")); }
    catch {}
  }
  return {
    lastUpdated: new Date().toISOString(),
    totalLessons: 0,
    avoidPatterns: [],
    successPatterns: [],
    failureLogs: [],
    marketBlacklist: [],
  };
}

function loadTradeLogs(): TradeLog[] {
  if (!fs.existsSync(TRADE_LOG_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TRADE_LOG_FILE, "utf-8")); }
  catch { return []; }
}

function loadCalibrationLog(): any[] {
  if (!fs.existsSync(CALIBRATION_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(CALIBRATION_FILE, "utf-8")); }
  catch { return []; }
}

// ─────────────────────────────────────────────────
// TRADE OUTCOME RECORDER
// Call this when you know the outcome of a trade
// ─────────────────────────────────────────────────

function recordTradeOutcome(
  position: Position,
  exitPrice: number,
  actualOutcome: number, // 1 = YES resolved, 0 = NO resolved
  predictedProbability: number,
  marketConditions: string = "normal"
): TradeLog {
  const pnl =
    position.action === "BUY_YES"
      ? position.contracts * (actualOutcome - position.entryPrice)
      : position.contracts * ((1 - actualOutcome) - (1 - position.entryPrice));

  const openedAt = new Date(position.openedAt).getTime();
  const closedAt = Date.now();
  const holdingPeriodHours = (closedAt - openedAt) / (1000 * 60 * 60);

  const log: TradeLog = {
    ticker: position.ticker,
    title: position.title,
    action: position.action,
    entryPrice: position.entryPrice,
    exitPrice,
    predictedProbability,
    actualOutcome,
    pnl,
    holdingPeriodHours,
    marketConditions,
    timestamp: new Date().toISOString(),
  };

  return log;
}

// ─────────────────────────────────────────────────
// FAILURE CLASSIFIER
// Uses Claude to classify what went wrong
// ─────────────────────────────────────────────────

async function classifyFailure(log: TradeLog): Promise<{
  failureType: "BAD_PREDICTION" | "BAD_TIMING" | "BAD_EXECUTION" | "EXTERNAL_SHOCK";
  lesson: string;
}> {
  const prompt = `You are a trading post-mortem analyst for a prediction market bot.

TRADE DATA (trusted input):
- Market: ${log.title}
- Action: ${log.action}
- Entry price: $${log.entryPrice.toFixed(4)} (${(log.entryPrice * 100).toFixed(1)}% implied)
- Exit price: $${log.exitPrice.toFixed(4)}
- Predicted probability: ${log.predictedProbability.toFixed(1)}%
- Actual outcome: ${log.actualOutcome === 1 ? "YES resolved" : "NO resolved"}
- P&L: ${log.pnl >= 0 ? "+" : ""}$${log.pnl.toFixed(2)}
- Holding period: ${log.holdingPeriodHours.toFixed(1)} hours
- Market conditions: ${log.marketConditions}

This was a LOSING trade. Classify the failure and extract one actionable lesson.

Failure types:
- BAD_PREDICTION: The model's probability estimate was wrong
- BAD_TIMING: Right direction but entered/exited at wrong time
- BAD_EXECUTION: Correct signal but poor order execution or sizing
- EXTERNAL_SHOCK: Unpredictable external event changed the outcome

Respond in JSON only:
{
  "failureType": "<BAD_PREDICTION|BAD_TIMING|BAD_EXECUTION|EXTERNAL_SHOCK>",
  "lesson": "<one specific actionable lesson to prevent this in future>"
}`;

  try {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const response = await new Promise<string>((resolve, reject) => {
      const options = {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body),
        },
      };
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    const parsed = JSON.parse(response);
    const text = parsed.content?.[0]?.text ?? "{}";
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "{}");

    return {
      failureType: json.failureType ?? "BAD_PREDICTION",
      lesson: json.lesson ?? "Review model inputs for this market type.",
    };
  } catch {
    return {
      failureType: "BAD_PREDICTION",
      lesson: "AI classification failed — review trade manually.",
    };
  }
}

// ─────────────────────────────────────────────────
// PERFORMANCE METRICS
// ─────────────────────────────────────────────────

function computeMetrics(logs: TradeLog[], portfolio: Portfolio): PerformanceMetrics {
  if (logs.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      totalTrades: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      profitFactor: 0,
      brierScore: 0,
      totalPnl: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
    };
  }

  const wins = logs.filter((l) => l.pnl > 0);
  const losses = logs.filter((l) => l.pnl < 0);
  const winRate = wins.length / logs.length;

  const avgWin = wins.length > 0
    ? wins.reduce((s, l) => s + l.pnl, 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((s, l) => s + l.pnl, 0) / losses.length)
    : 0;

  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

  // Sharpe ratio (simplified — daily returns)
  const pnls = logs.map((l) => l.pnl);
  const meanPnl = pnls.reduce((s, p) => s + p, 0) / pnls.length;
  const variance = pnls.reduce((s, p) => s + Math.pow(p - meanPnl, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance) || 1;
  const sharpeRatio = (meanPnl / stdDev) * Math.sqrt(252); // annualized

  // Max drawdown
  let peak = portfolio.startingBankroll;
  let maxDrawdown = 0;
  let running = portfolio.startingBankroll;
  for (const log of logs) {
    running += log.pnl;
    if (running > peak) peak = running;
    const dd = (peak - running) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Profit factor
  const grossProfit = wins.reduce((s, l) => s + l.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, l) => s + l.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  // Brier score from calibration log
  const calibration = loadCalibrationLog();
  const resolved = calibration.filter((c) => c.outcome !== undefined);
  const brierScore = resolved.length > 0
    ? resolved.reduce((s: number, c: any) => {
        const p = (c.predictedProbability ?? 50) / 100;
        return s + Math.pow(p - (c.outcome ?? 0), 2);
      }, 0) / resolved.length
    : 0;

  return {
    timestamp: new Date().toISOString(),
    totalTrades: logs.length,
    winRate: winRate * 100,
    sharpeRatio,
    maxDrawdown: maxDrawdown * 100,
    profitFactor,
    brierScore,
    totalPnl: logs.reduce((s, l) => s + l.pnl, 0),
    avgWin,
    avgLoss,
    expectancy,
  };
}

// ─────────────────────────────────────────────────
// KNOWLEDGE BASE UPDATER
// ─────────────────────────────────────────────────

function updateKnowledgeBase(
  kb: KnowledgeBase,
  logs: TradeLog[]
): KnowledgeBase {
  const losses = logs.filter((l) => l.pnl < 0 && l.failureType);
  const wins = logs.filter((l) => l.pnl > 0);

  // Add failure lessons
  for (const loss of losses) {
    if (loss.lesson) {
      kb.failureLogs.push({
        ticker: loss.ticker,
        failureType: loss.failureType ?? "BAD_PREDICTION",
        lesson: loss.lesson,
        date: loss.timestamp,
      });

      // Add to avoid patterns if not already there
      if (loss.lesson && !kb.avoidPatterns.includes(loss.lesson)) {
        kb.avoidPatterns.push(loss.lesson);
      }

      // Blacklist markets with repeated failures
      const failuresForTicker = kb.failureLogs.filter(
        (f) => f.ticker === loss.ticker
      ).length;
      if (failuresForTicker >= 2 && !kb.marketBlacklist.includes(loss.ticker)) {
        kb.marketBlacklist.push(loss.ticker);
        console.log(`  ⚠ Added ${loss.ticker.slice(0, 40)} to blacklist (2+ failures)`);
      }
    }
  }

  // Extract success patterns from wins
  for (const win of wins) {
    const pattern = `${win.action} on ${win.title.slice(0, 40)} — held ${win.holdingPeriodHours.toFixed(0)}h`;
    if (!kb.successPatterns.includes(pattern) && kb.successPatterns.length < 20) {
      kb.successPatterns.push(pattern);
    }
  }

  // Keep knowledge base manageable
  kb.avoidPatterns = kb.avoidPatterns.slice(-50);
  kb.successPatterns = kb.successPatterns.slice(-20);
  kb.failureLogs = kb.failureLogs.slice(-100);
  kb.totalLessons = kb.failureLogs.length;
  kb.lastUpdated = new Date().toISOString();

  return kb;
}

// ─────────────────────────────────────────────────
// SIMULATE TRADE RESOLUTION (for paper trading)
// In live mode this would pull actual outcomes from Kalshi
// ─────────────────────────────────────────────────

function simulateOpenPositionResolution(portfolio: Portfolio): TradeLog[] {
  const newLogs: TradeLog[] = [];
  const now = Date.now();

  for (const pos of portfolio.positions) {
    if (pos.status !== "OPEN") continue;

    const openedAt = new Date(pos.openedAt).getTime();
    const hoursOpen = (now - openedAt) / (1000 * 60 * 60);

    // Auto-resolve paper positions after 48 hours for testing
    if (hoursOpen > 48) {
      // Simulate outcome — 50/50 for paper trading demo
      // In live mode: fetch actual resolution from Kalshi API
      const simulatedOutcome = Math.random() > 0.5 ? 1 : 0;
      const exitPrice = simulatedOutcome;

      const log = recordTradeOutcome(
        pos,
        exitPrice,
        simulatedOutcome,
        pos.entryPrice * 100,
        "simulated_paper_resolution"
      );

      pos.status = "CLOSED";
      pos.closedAt = new Date().toISOString();
      pos.exitPrice = exitPrice;
      pos.pnl = log.pnl;
      pos.outcome = log.pnl > 0 ? "WIN" : log.pnl < 0 ? "LOSS" : "PUSH";

      if (log.pnl > 0) portfolio.winCount++;
      else if (log.pnl < 0) portfolio.lossCount++;

      portfolio.totalPnl += log.pnl;
      portfolio.dailyPnl += log.pnl;
      portfolio.cashAvailable += pos.costBasis + log.pnl;

      newLogs.push(log);
      console.log(
        `  ${log.pnl >= 0 ? "✅ WIN" : "❌ LOSS"} — ${pos.ticker.slice(0, 35)} | P&L: ${log.pnl >= 0 ? "+" : ""}$${log.pnl.toFixed(2)}`
      );
    }
  }

  return newLogs;
}

// ─────────────────────────────────────────────────
// DISPLAY
// ─────────────────────────────────────────────────

function printMetrics(m: PerformanceMetrics): void {
  const winRateStatus = m.winRate >= 60 ? "✅" : m.winRate >= 50 ? "⚠️" : "❌";
  const sharpeStatus = m.sharpeRatio >= 2.0 ? "✅" : m.sharpeRatio >= 1.0 ? "⚠️" : "❌";
  const drawdownStatus = m.maxDrawdown <= 8 ? "✅" : m.maxDrawdown <= 15 ? "⚠️" : "❌";
  const pfStatus = m.profitFactor >= 1.5 ? "✅" : m.profitFactor >= 1.0 ? "⚠️" : "❌";
  const brierStatus = m.brierScore <= 0.25 ? "✅" : m.brierScore <= 0.35 ? "⚠️" : "❌";

  console.log(`\n${"═".repeat(65)}`);
  console.log(`  PERFORMANCE METRICS`);
  console.log(`${"═".repeat(65)}`);
  console.log(`  Total trades:   ${m.totalTrades}`);
  console.log(`  Total P&L:      ${m.totalPnl >= 0 ? "+" : ""}$${m.totalPnl.toFixed(2)}`);
  console.log(`  Expectancy:     ${m.expectancy >= 0 ? "+" : ""}$${m.expectancy.toFixed(3)} per trade`);
  console.log(`\n  ${winRateStatus} Win rate:      ${m.winRate.toFixed(1)}%  (target: 60%+)`);
  console.log(`  ${sharpeStatus} Sharpe ratio:  ${m.sharpeRatio.toFixed(2)}  (target: 2.0+)`);
  console.log(`  ${drawdownStatus} Max drawdown:  ${m.maxDrawdown.toFixed(1)}%  (limit: 8%)`);
  console.log(`  ${pfStatus} Profit factor: ${m.profitFactor.toFixed(2)}  (target: 1.5+)`);
  console.log(`  ${brierStatus} Brier score:   ${m.brierScore.toFixed(4)}  (target: <0.25)`);
  console.log(`\n  Avg win:  $${m.avgWin.toFixed(2)}  |  Avg loss: $${m.avgLoss.toFixed(2)}`);
  console.log(`${"═".repeat(65)}\n`);
}

function printKnowledgeBase(kb: KnowledgeBase): void {
  console.log(`${"═".repeat(65)}`);
  console.log(`  KNOWLEDGE BASE`);
  console.log(`${"═".repeat(65)}`);
  console.log(`  Total lessons:    ${kb.totalLessons}`);
  console.log(`  Blacklisted:      ${kb.marketBlacklist.length} markets`);
  console.log(`  Avoid patterns:   ${kb.avoidPatterns.length}`);
  console.log(`  Success patterns: ${kb.successPatterns.length}`);

  if (kb.avoidPatterns.length > 0) {
    console.log(`\n  AVOID:`);
    kb.avoidPatterns.slice(-5).forEach((p) => console.log(`    ✗ ${p}`));
  }

  if (kb.successPatterns.length > 0) {
    console.log(`\n  REPEAT:`);
    kb.successPatterns.slice(-3).forEach((p) => console.log(`    ✓ ${p}`));
  }

  if (kb.marketBlacklist.length > 0) {
    console.log(`\n  BLACKLISTED MARKETS:`);
    kb.marketBlacklist.slice(-5).forEach((t) =>
      console.log(`    🚫 ${t.slice(0, 50)}`)
    );
  }
  console.log(`${"═".repeat(65)}\n`);
}

// ─────────────────────────────────────────────────
// NIGHTLY CONSOLIDATION
// ─────────────────────────────────────────────────

async function nightlyConsolidation(): Promise<void> {
  console.log(`\n${"═".repeat(65)}`);
  console.log(`  STEP 5: COMPOUNDER — Nightly Consolidation`);
  console.log(`  ${new Date().toLocaleString()}`);
  console.log(`${"═".repeat(65)}\n`);

  const portfolio = loadPortfolio();
  if (!portfolio) {
    console.log("  No portfolio found. Run npm run execute first.");
    return;
  }

  // 1. Resolve any expired paper positions
  console.log("  [1/5] Checking for resolved positions...");
  const newLogs = simulateOpenPositionResolution(portfolio);

  if (newLogs.length > 0) {
    fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
    console.log(`  Resolved ${newLogs.length} position(s)`);
  } else {
    console.log("  No positions to resolve yet");
  }

  // 2. Run post-mortems on losses
  console.log("\n  [2/5] Running post-mortems on losses...");
  const losses = newLogs.filter((l) => l.pnl < 0);

  for (const loss of losses) {
    console.log(`  Analyzing loss: ${loss.ticker.slice(0, 40)}...`);
    const { failureType, lesson } = await classifyFailure(loss);
    loss.failureType = failureType;
    loss.lesson = lesson;
    console.log(`    Type: ${failureType}`);
    console.log(`    Lesson: ${lesson}`);
  }

  // 3. Save trade logs
  console.log("\n  [3/5] Saving trade logs...");
  const allLogs = loadTradeLogs();
  allLogs.push(...newLogs);
  fs.writeFileSync(TRADE_LOG_FILE, JSON.stringify(allLogs, null, 2));
  console.log(`  Total logged trades: ${allLogs.length}`);

  // 4. Update knowledge base
  console.log("\n  [4/5] Updating knowledge base...");
  let kb = loadKnowledgeBase();
  kb = updateKnowledgeBase(kb, newLogs);
  fs.writeFileSync(KNOWLEDGE_BASE_FILE, JSON.stringify(kb, null, 2));
  console.log(`  Knowledge base updated — ${kb.totalLessons} lessons stored`);

  // 5. Compute and save performance metrics
  console.log("\n  [5/5] Computing performance metrics...");
  const metrics = computeMetrics(allLogs, portfolio);
  const allMetrics = fs.existsSync(METRICS_FILE)
    ? JSON.parse(fs.readFileSync(METRICS_FILE, "utf-8"))
    : [];
  allMetrics.push(metrics);
  fs.writeFileSync(METRICS_FILE, JSON.stringify(allMetrics, null, 2));

  // Display results
  printMetrics(metrics);
  printKnowledgeBase(kb);

  console.log("  ✓ Nightly consolidation complete");
  console.log("  ✓ Knowledge base updated");
  console.log("  ✓ Performance metrics saved");
  console.log("\n  Files updated:");
  console.log("    portfolio.json          — positions + bankroll");
  console.log("    trade_log.json          — full trade history");
  console.log("    knowledge_base.json     — lessons + blacklist");
  console.log("    performance_metrics.json — metrics over time\n");
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

nightlyConsolidation().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});