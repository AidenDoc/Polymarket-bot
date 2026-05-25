/**
 * ====================================================
 *  PREDICTION MARKET TRADING BOT — STEP 4: EXECUTOR
 *  Risk management + Paper/Live trade execution
 * ====================================================
 *
 * How to run:
 *   npx ts-node src/executor.ts
 *
 * PAPER MODE is ON by default. To go live:
 *   Set PAPER_TRADE=false in your .env file
 *   (only do this after monitoring paper trades)
 *
 * Kill switch: create a file called STOP in your
 *   kalshi-bot folder to halt all trading immediately
 * ====================================================
 */

import * as fs from "fs";
import * as crypto from "crypto";
import * as https from "https";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────

const PAPER_TRADE = process.env.PAPER_TRADE !== "false"; // default ON
const STARTING_BANKROLL = parseFloat(process.env.STARTING_BANKROLL ?? "1000");
const KELLY_FRACTION = 0.25;        // Quarter-Kelly for safety
const MAX_POSITION_PCT = 0.05;      // Max 5% of bankroll per trade
const MAX_CONCURRENT = 15;          // Max 15 open positions
const MAX_DAILY_LOSS_PCT = 0.15;    // Stop trading if down 15% in a day
const MAX_DRAWDOWN_PCT = 0.08;      // Block trades if drawdown > 8%
const MIN_EDGE = 0.02;          // Minimum 2% edge required
const MAX_SLIPPAGE = 0.02;          // Abort if price moves > 2%
const KILL_SWITCH_FILE = "STOP";    // Create this file to halt all trading

// Kalshi API
const KEY_ID = process.env.KALSHI_KEY_ID ?? "";
const PRIVATE_KEY_PATH = process.env.KALSHI_PRIVATE_KEY_PATH ?? "./kalshi_private.key";
const ENV = process.env.KALSHI_ENV ?? "demo";
const BASE_URL =
  ENV === "demo"
    ? "https://demo-api.kalshi.co/trade-api/v2"
    : "https://api.kalshi.com/trade-api/v2";

// ─────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────

interface TradeSignal {
  ticker: string;
  title: string;
  marketPrice: number;
  marketImpliedProb: number;
  ensembleProbability: number;
  edge: number;
  expectedValue: number;
  action: "BUY_YES" | "BUY_NO" | "PASS";
  confidence: number;
  suggestedPositionSize: number;
  riskFlags: string[];
  reasoning: string;
}

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

interface RiskCheckResult {
  passed: boolean;
  reasons: string[];
  approvedSize: number;
}

interface ExecutionResult {
  success: boolean;
  ticker: string;
  action: string;
  contracts: number;
  price: number;
  costBasis: number;
  paper: boolean;
  orderId?: string;
  error?: string;
}

// ─────────────────────────────────────────────────
// PORTFOLIO STATE
// ─────────────────────────────────────────────────

const PORTFOLIO_FILE = "portfolio.json";

function loadPortfolio(): Portfolio {
  if (fs.existsSync(PORTFOLIO_FILE)) {
    try {
      const p = JSON.parse(fs.readFileSync(PORTFOLIO_FILE, "utf-8"));
      // Reset daily P&L if it's a new day
      const today = new Date().toDateString();
      if (p.lastResetDate !== today) {
        p.dailyPnl = 0;
        p.lastResetDate = today;
      }
      return p;
    } catch {
      // fall through to create new
    }
  }

  const portfolio: Portfolio = {
    bankroll: STARTING_BANKROLL,
    startingBankroll: STARTING_BANKROLL,
    cashAvailable: STARTING_BANKROLL,
    positions: [],
    dailyPnl: 0,
    dailyLossLimit: STARTING_BANKROLL * MAX_DAILY_LOSS_PCT,
    totalPnl: 0,
    winCount: 0,
    lossCount: 0,
    lastResetDate: new Date().toDateString(),
  };

  savePortfolio(portfolio);
  return portfolio;
}

function savePortfolio(portfolio: Portfolio): void {
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
}

// ─────────────────────────────────────────────────
// KILL SWITCH
// ─────────────────────────────────────────────────

function isKillSwitchActive(): boolean {
  return fs.existsSync(KILL_SWITCH_FILE);
}

// ─────────────────────────────────────────────────
// KELLY CRITERION
// ─────────────────────────────────────────────────

function kellyPositionSize(
  probability: number,
  marketPrice: number,
  bankroll: number,
  action: "BUY_YES" | "BUY_NO"
): number {
  const p = probability / 100;
  const q = 1 - p;

  // For BUY_YES: odds = (1 - price) / price
  // For BUY_NO:  odds = price / (1 - price)
  const b =
    action === "BUY_YES"
      ? (1 - marketPrice) / marketPrice
      : marketPrice / (1 - marketPrice);

  // Kelly formula: f* = (bp - q) / b
  const kelly = (b * p - q) / b;

  if (kelly <= 0) return 0;

  // Apply fractional Kelly and cap at max position size
  const fractional = kelly * KELLY_FRACTION;
  const maxAllowed = bankroll * MAX_POSITION_PCT;
  const kellySized = bankroll * fractional;

  return Math.min(kellySized, maxAllowed);
}

// ─────────────────────────────────────────────────
// RISK CHECKS
// ─────────────────────────────────────────────────

function runRiskChecks(
  signal: TradeSignal,
  portfolio: Portfolio
): RiskCheckResult {
  const reasons: string[] = [];
  let passed = true;

  // 1. Kill switch
  if (isKillSwitchActive()) {
    return { passed: false, reasons: ["KILL SWITCH ACTIVE — trading halted"], approvedSize: 0 };
  }

  // 2. Edge check
  const edgePct = Math.abs(signal.edge);
  if (edgePct < MIN_EDGE * 100) {
    passed = false;
    reasons.push(`Edge ${edgePct.toFixed(1)}% below minimum ${MIN_EDGE * 100}%`);
  }

  // 3. Daily loss limit
  if (portfolio.dailyPnl < -portfolio.dailyLossLimit) {
    passed = false;
    reasons.push(`Daily loss limit reached ($${Math.abs(portfolio.dailyPnl).toFixed(2)})`);
  }

  // 4. Max drawdown check
  const drawdown = (portfolio.startingBankroll - portfolio.bankroll) / portfolio.startingBankroll;
  if (drawdown > MAX_DRAWDOWN_PCT) {
    passed = false;
    reasons.push(`Max drawdown exceeded (${(drawdown * 100).toFixed(1)}%)`);
  }

  // 5. Concurrent position limit
  const openPositions = portfolio.positions.filter((p) => p.status === "OPEN");
  if (openPositions.length >= MAX_CONCURRENT) {
    passed = false;
    reasons.push(`Max concurrent positions reached (${MAX_CONCURRENT})`);
  }

  // 6. Duplicate position check
  const alreadyOpen = openPositions.find((p) => p.ticker === signal.ticker);
  if (alreadyOpen) {
    passed = false;
    reasons.push(`Already have open position in ${signal.ticker}`);
  }

  // 7. Sufficient cash
  const minBet = 1;
  if (portfolio.cashAvailable < minBet) {
    passed = false;
    reasons.push(`Insufficient cash ($${portfolio.cashAvailable.toFixed(2)})`);
  }

  // 8. Value at Risk (95% confidence)
  // VaR = position size * (1 - confidence)
  const posSize = kellyPositionSize(
    signal.ensembleProbability,
    signal.marketPrice,
    portfolio.bankroll,
    signal.action as "BUY_YES" | "BUY_NO"
  );
  const var95 = posSize * (1 - signal.confidence);
  const dailyVarLimit = portfolio.bankroll * 0.05; // 5% daily VaR limit
  if (var95 > dailyVarLimit) {
    reasons.push(`High VaR warning: $${var95.toFixed(2)} (limit $${dailyVarLimit.toFixed(2)})`);
    // Warning only, don't block
  }

  // Calculate approved size
  const approvedSize = passed
    ? Math.min(
        posSize,
        portfolio.cashAvailable,
        portfolio.bankroll * MAX_POSITION_PCT
      )
    : 0;

  return { passed, reasons, approvedSize };
}

// ─────────────────────────────────────────────────
// KALSHI AUTH (for live trading)
// ─────────────────────────────────────────────────

function buildAuthHeaders(method: string, urlPath: string): Record<string, string> {
  const keyPath = path.resolve(PRIVATE_KEY_PATH);
  const keyData = fs.readFileSync(keyPath, "utf-8");
  const privateKey = crypto.createPrivateKey(keyData);

  const timestampMs = Date.now().toString();
  const message = timestampMs + method.toUpperCase() + urlPath;

  const signature = crypto.sign(
    "SHA256",
    Buffer.from(message, "utf-8"),
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }
  );

  return {
    "KALSHI-ACCESS-KEY": KEY_ID,
    "KALSHI-ACCESS-TIMESTAMP": timestampMs,
    "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
    "Content-Type": "application/json",
  };
}

function httpsRequest(
  hostname: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method,
      headers: body
        ? { ...headers, "Content-Length": Buffer.byteLength(body) }
        : headers,
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

async function getCurrentPrice(ticker: string): Promise<number | null> {
  try {
    const urlPath = `/trade-api/v2/markets/${ticker}`;
    const hostname = BASE_URL.replace("https://", "").split("/")[0];
    const raw = await httpsRequest(hostname, urlPath, "GET", {});
    const data = JSON.parse(raw);
    const price = data.market?.last_price_dollars ?? data.market?.yes_bid_dollars;
    return price ? parseFloat(price) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────
// PAPER TRADE EXECUTION
// ─────────────────────────────────────────────────

function executePaperTrade(
  signal: TradeSignal,
  approvedSize: number,
  portfolio: Portfolio
): ExecutionResult {
  const price = signal.marketPrice;
  const contracts = Math.floor(approvedSize / price);

  if (contracts < 1) {
    return {
      success: false,
      ticker: signal.ticker,
      action: signal.action,
      contracts: 0,
      price,
      costBasis: 0,
      paper: true,
      error: "Position size too small for even 1 contract",
    };
  }

  const costBasis = contracts * price;

  // Add position to portfolio
  const position: Position = {
    ticker: signal.ticker,
    title: signal.title,
    action: signal.action as "BUY_YES" | "BUY_NO",
    contracts,
    entryPrice: price,
    costBasis,
    openedAt: new Date().toISOString(),
    status: "OPEN",
  };

  portfolio.positions.push(position);
  portfolio.cashAvailable -= costBasis;
  savePortfolio(portfolio);

  return {
    success: true,
    ticker: signal.ticker,
    action: signal.action,
    contracts,
    price,
    costBasis,
    paper: true,
    orderId: `PAPER-${Date.now()}`,
  };
}

// ─────────────────────────────────────────────────
// LIVE TRADE EXECUTION
// ─────────────────────────────────────────────────

async function executeLiveTrade(
  signal: TradeSignal,
  approvedSize: number
): Promise<ExecutionResult> {
  const price = signal.marketPrice;
  const contracts = Math.floor(approvedSize / price);

  if (contracts < 1) {
    return {
      success: false,
      ticker: signal.ticker,
      action: signal.action,
      contracts: 0,
      price,
      costBasis: 0,
      paper: false,
      error: "Too small for 1 contract",
    };
  }

  // Slippage check — get current price before placing
  const currentPrice = await getCurrentPrice(signal.ticker);
  if (currentPrice !== null) {
    const slippage = Math.abs(currentPrice - price) / price;
    if (slippage > MAX_SLIPPAGE) {
      return {
        success: false,
        ticker: signal.ticker,
        action: signal.action,
        contracts,
        price,
        costBasis: 0,
        paper: false,
        error: `Price slipped ${(slippage * 100).toFixed(1)}% — aborting`,
      };
    }
  }

  // Place limit order via Kalshi API
  const side = signal.action === "BUY_YES" ? "yes" : "no";
  const urlPath = "/trade-api/v2/portfolio/orders";
  const hostname = BASE_URL.replace("https://", "").split("/")[0];

  const orderBody = JSON.stringify({
    ticker: signal.ticker,
    client_order_id: crypto.randomUUID(),
    type: "limit",
    action: "buy",
    side,
    count: contracts,
    limit_price: Math.round(price * 100), // cents
    time_in_force: "ioc", // immediate or cancel
  });

  try {
    const headers = buildAuthHeaders("POST", urlPath);
    const raw = await httpsRequest(hostname, urlPath, "POST", headers, orderBody);
    const response = JSON.parse(raw);

    if (response.order) {
      return {
        success: true,
        ticker: signal.ticker,
        action: signal.action,
        contracts,
        price,
        costBasis: contracts * price,
        paper: false,
        orderId: response.order.order_id,
      };
    } else {
      return {
        success: false,
        ticker: signal.ticker,
        action: signal.action,
        contracts,
        price,
        costBasis: 0,
        paper: false,
        error: JSON.stringify(response),
      };
    }
  } catch (e) {
    return {
      success: false,
      ticker: signal.ticker,
      action: signal.action,
      contracts,
      price,
      costBasis: 0,
      paper: false,
      error: (e as Error).message,
    };
  }
}

// ─────────────────────────────────────────────────
// DISPLAY
// ─────────────────────────────────────────────────

function printPortfolioSummary(portfolio: Portfolio): void {
  const openPositions = portfolio.positions.filter((p) => p.status === "OPEN");
  const totalTrades = portfolio.winCount + portfolio.lossCount;
  const winRate = totalTrades > 0 ? (portfolio.winCount / totalTrades) * 100 : 0;
  const roi = ((portfolio.bankroll - portfolio.startingBankroll) / portfolio.startingBankroll) * 100;

  console.log(`\n${"═".repeat(65)}`);
  console.log(`  PORTFOLIO SUMMARY  ${PAPER_TRADE ? "[PAPER TRADING]" : "[LIVE TRADING]"}`);
  console.log(`${"═".repeat(65)}`);
  console.log(`  Bankroll:      $${portfolio.bankroll.toFixed(2)}  (started: $${portfolio.startingBankroll.toFixed(2)})`);
  console.log(`  Cash:          $${portfolio.cashAvailable.toFixed(2)}`);
  console.log(`  Total P&L:     ${portfolio.totalPnl >= 0 ? "+" : ""}$${portfolio.totalPnl.toFixed(2)}  (${roi >= 0 ? "+" : ""}${roi.toFixed(1)}% ROI)`);
  console.log(`  Daily P&L:     ${portfolio.dailyPnl >= 0 ? "+" : ""}$${portfolio.dailyPnl.toFixed(2)}`);
  console.log(`  Win/Loss:      ${portfolio.winCount}W / ${portfolio.lossCount}L  (${winRate.toFixed(0)}% win rate)`);
  console.log(`  Open positions: ${openPositions.length}/${MAX_CONCURRENT}`);

  if (openPositions.length > 0) {
    console.log(`\n  OPEN POSITIONS:`);
    for (const pos of openPositions) {
      console.log(
        `    ${pos.action === "BUY_YES" ? "✅" : "🔴"} ${pos.ticker.slice(0, 35)} | ${pos.contracts} contracts @ $${pos.entryPrice.toFixed(4)} | cost: $${pos.costBasis.toFixed(2)}`
      );
    }
  }
  console.log(`${"═".repeat(65)}\n`);
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${"═".repeat(65)}`);
  console.log(`  STEP 4: EXECUTOR`);
  console.log(`  Risk management + Trade execution`);
  console.log(`  Mode: ${PAPER_TRADE ? "📝 PAPER TRADING (safe)" : "💰 LIVE TRADING (real money)"}`);
  console.log(`${"═".repeat(65)}`);

  // Kill switch check
  if (isKillSwitchActive()) {
    console.log(`\n  🛑 KILL SWITCH ACTIVE`);
    console.log(`  Delete the STOP file to resume trading.`);
    process.exit(0);
  }

  // Load signal results from Step 3
  if (!fs.existsSync("signal_results.json")) {
    console.error("[ERROR] signal_results.json not found. Run npm run predict first.");
    process.exit(1);
  }

  const signalData = JSON.parse(fs.readFileSync("signal_results.json", "utf-8"));
  const signals: TradeSignal[] = (signalData.signals ?? []).filter(
    (s: TradeSignal) => s.action !== "PASS"
  );

  if (signals.length === 0) {
    console.log("\n  No actionable signals found. Run the full pipeline first:");
    console.log("    npm run scan");
    console.log("    npm run research");
    console.log("    npm run predict\n");
    process.exit(0);
  }

  console.log(`\n  Found ${signals.length} actionable signal(s) to evaluate...\n`);

  const portfolio = loadPortfolio();

  // Process each signal
  let executed = 0;
  let blocked = 0;

  for (const signal of signals) {
    console.log(`\n  ── Signal: ${signal.action} ${signal.ticker.slice(0, 40)}`);
    console.log(`     Edge: ${signal.edge > 0 ? "+" : ""}${signal.edge.toFixed(1)}% | Confidence: ${(signal.confidence * 100).toFixed(0)}%`);

    // Run risk checks
    const riskResult = runRiskChecks(signal, portfolio);

    if (!riskResult.passed) {
      blocked++;
      console.log(`  ❌ BLOCKED by risk checks:`);
      for (const reason of riskResult.reasons) {
        console.log(`     • ${reason}`);
      }
      continue;
    }

    // Show approved size
    const approvedSize = Math.max(1, Math.round(riskResult.approvedSize * 100) / 100);
    console.log(`  ✓ Risk checks passed`);
    console.log(`  ✓ Approved position: $${approvedSize.toFixed(2)}`);

    if (riskResult.reasons.length > 0) {
      console.log(`  ⚠ Warnings:`);
      for (const reason of riskResult.reasons) {
        console.log(`    • ${reason}`);
      }
    }

    // Execute
    let result: ExecutionResult;

    if (PAPER_TRADE) {
      result = executePaperTrade(signal, approvedSize, portfolio);
    } else {
      console.log(`\n  ⚠️  LIVE TRADE — placing real order on Kalshi...`);
      result = await executeLiveTrade(signal, approvedSize);
    }

    if (result.success) {
      executed++;
      console.log(`\n  ${PAPER_TRADE ? "📝" : "💰"} ${result.paper ? "PAPER" : "LIVE"} TRADE EXECUTED:`);
      console.log(`     Ticker:    ${result.ticker.slice(0, 45)}`);
      console.log(`     Action:    ${result.action}`);
      console.log(`     Contracts: ${result.contracts}`);
      console.log(`     Price:     $${result.price.toFixed(4)}`);
      console.log(`     Cost:      $${result.costBasis.toFixed(2)}`);
      console.log(`     Order ID:  ${result.orderId}`);
    } else {
      blocked++;
      console.log(`  ❌ Execution failed: ${result.error}`);
    }
  }

  // Summary
  console.log(`\n${"─".repeat(65)}`);
  console.log(`  Executed: ${executed} | Blocked: ${blocked}`);

  // Portfolio summary
  printPortfolioSummary(portfolio);

  // Save execution log
  const log = {
    timestamp: new Date().toISOString(),
    mode: PAPER_TRADE ? "paper" : "live",
    signalsEvaluated: signals.length,
    executed,
    blocked,
  };

  const logPath = "execution_log.json";
  let logs = [];
  if (fs.existsSync(logPath)) {
    try { logs = JSON.parse(fs.readFileSync(logPath, "utf-8")); } catch { logs = []; }
  }
  logs.push(log);
  fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
  console.log("  ✓ Execution log saved\n");

  if (PAPER_TRADE) {
    console.log("  📝 Running in PAPER MODE — no real money spent");
    console.log("  To go live: add PAPER_TRADE=false to your .env file");
    console.log("  (only after monitoring paper trades for a few days)\n");
  }
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});