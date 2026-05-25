/**
 * ====================================================
 *  PREDICTION MARKET TRADING BOT — POSITION CLOSER
 *  Checks open positions against Kalshi API and
 *  closes resolved ones with P&L calculation
 * ====================================================
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as https from "https";
import * as dotenv from "dotenv";

dotenv.config();

const KEY_ID = process.env.KALSHI_KEY_ID ?? "";
const PRIVATE_KEY_PATH = process.env.KALSHI_PRIVATE_KEY_PATH ?? "./kalshi_private.key";
const ENV = process.env.KALSHI_ENV ?? "demo";
const BASE_URL = ENV === "demo"
  ? "https://demo-api.kalshi.co/trade-api/v2"
  : "https://api.kalshi.com/trade-api/v2";

const PORTFOLIO_FILE = "portfolio.json";
const TRADE_LOG_FILE = "trade_log.json";
const PERFORMANCE_FILE = "performance_metrics.json";

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

interface TradeLogEntry {
  ticker: string;
  title: string;
  action: string;
  contracts: number;
  entryPrice: number;
  exitPrice: number;
  costBasis: number;
  pnl: number;
  outcome: string;
  openedAt: string;
  closedAt: string;
}

function loadPortfolio(): Portfolio | null {
  try {
    if (!fs.existsSync(PORTFOLIO_FILE)) return null;
    return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, "utf-8"));
  } catch { return null; }
}

function savePortfolio(portfolio: Portfolio): void {
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(portfolio, null, 2));
}

function loadTradeLog(): TradeLogEntry[] {
  try {
    if (!fs.existsSync(TRADE_LOG_FILE)) return [];
    return JSON.parse(fs.readFileSync(TRADE_LOG_FILE, "utf-8"));
  } catch { return []; }
}

function saveTradeLog(log: TradeLogEntry[]): void {
  fs.writeFileSync(TRADE_LOG_FILE, JSON.stringify(log, null, 2));
}

function buildAuthHeaders(method: string, urlPath: string): Record<string, string> {
  const keyPath = path.resolve(PRIVATE_KEY_PATH);
  const keyData = fs.readFileSync(keyPath, "utf-8");
  const privateKey = crypto.createPrivateKey(keyData);
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

function httpsGet(urlPath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const hostname = BASE_URL.replace("https://", "").split("/")[0];
    const fullPath = `/trade-api/v2${urlPath}`;
    const headers = buildAuthHeaders("GET", fullPath);
    const options = { hostname, path: fullPath, method: "GET", headers, timeout: 10000 };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

async function getMarketStatus(ticker: string): Promise<{ status: string; result?: string; lastPrice?: number } | null> {
  try {
    const data = await httpsGet(`/markets/${ticker}`);
    const market = data.market;
    if (!market) return null;
    return {
      status: market.status,
      result: market.result,
      lastPrice: parseFloat(market.last_price_dollars ?? "0"),
    };
  } catch {
    return null;
  }
}

function calculatePnl(position: Position, result: string): { pnl: number; exitPrice: number; outcome: "WIN" | "LOSS" | "PUSH" } {
  const isYesBet = position.action === "BUY_YES";
  const won = (isYesBet && result === "yes") || (!isYesBet && result === "no");
  const lost = (isYesBet && result === "no") || (!isYesBet && result === "yes");

  if (won) {
    // Won: each contract pays $1, minus cost
    const exitPrice = 1.0;
    const pnl = position.contracts * exitPrice - position.costBasis;
    return { pnl, exitPrice, outcome: "WIN" };
  } else if (lost) {
    // Lost: contracts worth $0
    const exitPrice = 0.0;
    const pnl = -position.costBasis;
    return { pnl, exitPrice, outcome: "LOSS" };
  } else {
    // Push/void
    const exitPrice = position.entryPrice;
    const pnl = 0;
    return { pnl, exitPrice, outcome: "PUSH" };
  }
}

function updatePerformanceMetrics(portfolio: Portfolio): void {
  const closedPositions = portfolio.positions.filter(p => p.status === "CLOSED");
  const totalTrades = closedPositions.length;
  const wins = closedPositions.filter(p => p.outcome === "WIN").length;
  const losses = closedPositions.filter(p => p.outcome === "LOSS").length;
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;
  const totalPnl = portfolio.totalPnl;
  const roi = (totalPnl / portfolio.startingBankroll) * 100;

  // Sharpe ratio (simplified)
  const pnls = closedPositions.map(p => p.pnl ?? 0);
  const avgPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
  const variance = pnls.length > 1
    ? pnls.reduce((a, b) => a + Math.pow(b - avgPnl, 2), 0) / pnls.length
    : 1;
  const stdDev = Math.sqrt(variance) || 1;
  const sharpeRatio = avgPnl / stdDev;

  // Max drawdown
  let peak = portfolio.startingBankroll;
  let maxDrawdown = 0;
  let runningBankroll = portfolio.startingBankroll;
  for (const pos of closedPositions) {
    runningBankroll += pos.pnl ?? 0;
    if (runningBankroll > peak) peak = runningBankroll;
    const drawdown = (peak - runningBankroll) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Profit factor
  const grossWins = closedPositions.filter(p => (p.pnl ?? 0) > 0).reduce((a, p) => a + (p.pnl ?? 0), 0);
  const grossLosses = Math.abs(closedPositions.filter(p => (p.pnl ?? 0) < 0).reduce((a, p) => a + (p.pnl ?? 0), 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

  const metrics = {
    timestamp: new Date().toISOString(),
    totalTrades,
    winRate,
    wins,
    losses,
    totalPnl,
    roi,
    sharpeRatio,
    maxDrawdown,
    profitFactor,
    avgPnl,
    bankroll: portfolio.bankroll,
  };

  fs.writeFileSync(PERFORMANCE_FILE, JSON.stringify(metrics, null, 2));
}

async function main(): Promise<void> {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  POSITION CLOSER`);
  console.log(`  Checking open positions for resolution...`);
  console.log(`${"═".repeat(60)}`);

  const portfolio = loadPortfolio();
  if (!portfolio) {
    console.log("  No portfolio found — skipping");
    return;
  }

  const openPositions = portfolio.positions.filter(p => p.status === "OPEN");
  console.log(`  Open positions: ${openPositions.length}`);

  if (openPositions.length === 0) {
    console.log("  Nothing to close\n");
    return;
  }

  const tradeLog = loadTradeLog();
  let closed = 0;
  let stillOpen = 0;

  for (const position of openPositions) {
    console.log(`\n  Checking: ${position.ticker.slice(0, 45)}`);

    const marketStatus = await getMarketStatus(position.ticker);

    if (!marketStatus) {
      console.log(`  ⚠ Could not fetch market status`);
      stillOpen++;
      continue;
    }

    console.log(`  Status: ${marketStatus.status} | Result: ${marketStatus.result ?? "pending"}`);

    if (marketStatus.status === "finalized" && marketStatus.result) {
      // Market resolved — close position
      const { pnl, exitPrice, outcome } = calculatePnl(position, marketStatus.result);

      position.status = "CLOSED";
      position.closedAt = new Date().toISOString();
      position.exitPrice = exitPrice;
      position.pnl = pnl;
      position.outcome = outcome;

      // Update portfolio
      portfolio.bankroll += pnl;
      portfolio.cashAvailable += position.costBasis + pnl;
      portfolio.totalPnl += pnl;
      portfolio.dailyPnl += pnl;

      if (outcome === "WIN") portfolio.winCount++;
      else if (outcome === "LOSS") portfolio.lossCount++;

      // Add to trade log
      tradeLog.push({
        ticker: position.ticker,
        title: position.title,
        action: position.action,
        contracts: position.contracts,
        entryPrice: position.entryPrice,
        exitPrice,
        costBasis: position.costBasis,
        pnl,
        outcome,
        openedAt: position.openedAt,
        closedAt: position.closedAt,
      });

      const emoji = outcome === "WIN" ? "✅" : outcome === "LOSS" ? "❌" : "➖";
      console.log(`  ${emoji} CLOSED: ${outcome} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`);
      closed++;

    } else if (marketStatus.status === "closed" || marketStatus.status === "settled") {
      // Market closed but result not available yet
      console.log(`  ⏳ Market closed, awaiting resolution`);
      stillOpen++;
    } else {
      // Still trading
      const currentPrice = marketStatus.lastPrice ?? position.entryPrice;
      const unrealizedPnl = position.action === "BUY_YES"
        ? (currentPrice - position.entryPrice) * position.contracts
        : (position.entryPrice - currentPrice) * position.contracts;
      console.log(`  📊 Still open | Current: $${currentPrice.toFixed(4)} | Unrealized: ${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}`);
      stillOpen++;
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // Save everything
  savePortfolio(portfolio);
  saveTradeLog(tradeLog);
  updatePerformanceMetrics(portfolio);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Closed: ${closed} | Still open: ${stillOpen}`);
  console.log(`  Bankroll: $${portfolio.bankroll.toFixed(2)} | Total P&L: ${portfolio.totalPnl >= 0 ? "+" : ""}$${portfolio.totalPnl.toFixed(2)}`);
  console.log(`  Win/Loss: ${portfolio.winCount}W / ${portfolio.lossCount}L`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});