/**
 * ============================================================
 *  KALSHI BOT — GUARDIAN AGENT
 *  Monitors bot 24/7, auto-fixes issues, sends Telegram alerts
 * ============================================================
 */

import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as dotenv from "dotenv";

dotenv.config();

const CHECK_INTERVAL_MS = 5 * 60 * 1000;       // check every 5 min
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;      // only alert once per 15 min per issue
const DASHBOARD_URL = "http://localhost:3001";  // bot serves on 3001
const GUARDIAN_LOG = "guardian_log.json";
const BOT_ERROR_LOG = path.join(process.env.HOME || "/root", ".pm2/logs/kalshi-bot-error.log");
const DASHBOARD_ERROR_LOG = path.join(process.env.HOME || "/root", ".pm2/logs/kalshi-dashboard-error.log");
const MAX_LOG_ENTRIES = 200;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const WATCHED_PROCESSES = ["kalshi-bot", "kalshi-dashboard"];

// Track state to prevent spam
let lastAlertTime: Record<string, number> = {};
let lastRestartCounts: Record<string, number> = {};
let lastKnownTradeCount = 0;
let lastDailySummaryDate = "";

interface ProcessStatus {
  name: string;
  status: string;
  restarts: number;
  cpu: string;
  memory: string;
  uptime: string;
}

interface HealthReport {
  timestamp: string;
  processes: ProcessStatus[];
  dashboardReachable: boolean;
  errorLogSnippet: string;
  issues: string[];
}

interface GuardianLogEntry {
  timestamp: string;
  healthReport: HealthReport;
  actionTaken: string;
  fixed: boolean;
}

interface Trade {
  market?: string;
  action?: string;
  entry?: number;
  pnl?: number;
  result?: string;
  timestamp?: string;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [GUARDIAN] ${msg}`);
}

function readLog(filePath: string, lines = 50): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").slice(-lines).join("\n");
  } catch { return ""; }
}

function loadJson(file: string): any {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { return null; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function appendGuardianLog(entry: GuardianLogEntry) {
  let entries: GuardianLogEntry[] = [];
  if (fs.existsSync(GUARDIAN_LOG)) {
    try { entries = JSON.parse(fs.readFileSync(GUARDIAN_LOG, "utf-8")); } catch { entries = []; }
  }
  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) entries = entries.slice(-MAX_LOG_ENTRIES);
  fs.writeFileSync(GUARDIAN_LOG, JSON.stringify(entries, null, 2));
}

function sendTelegram(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      log("Telegram not configured — skipping");
      resolve();
      return;
    }
    const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" });
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    };
    const req = https.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve());
    });
    req.on("error", (err) => { log(`Telegram error: ${err.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

// Only send alert if cooldown has passed for this issue type
function shouldAlert(key: string): boolean {
  const last = lastAlertTime[key] || 0;
  const now = Date.now();
  if (now - last > ALERT_COOLDOWN_MS) {
    lastAlertTime[key] = now;
    return true;
  }
  return false;
}

function getPm2Status(): ProcessStatus[] {
  try {
    const result = spawnSync("pm2", ["jlist"], { encoding: "utf-8" });
    if (result.status !== 0) return [];
    const list = JSON.parse(result.stdout);
    return list
      .filter((p: any) => WATCHED_PROCESSES.includes(p.name))
      .map((p: any) => ({
        name: p.name,
        status: p.pm2_env?.status || "unknown",
        restarts: p.pm2_env?.restart_time || 0,
        cpu: `${p.monit?.cpu || 0}%`,
        memory: `${Math.round((p.monit?.memory || 0) / 1024 / 1024)}mb`,
        uptime: p.pm2_env?.pm_uptime
          ? `${Math.round((Date.now() - p.pm2_env.pm_uptime) / 60000)}m`
          : "unknown",
      }));
  } catch { return []; }
}

function pingDashboard(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = http.get(DASHBOARD_URL, { timeout: 5000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

async function checkForNewTrades() {
  const tradeLog = loadJson("trade_log.json");
  if (!tradeLog || !Array.isArray(tradeLog)) return;
  const currentCount = tradeLog.length;
  if (currentCount > lastKnownTradeCount && lastKnownTradeCount > 0) {
    const newTrades: Trade[] = tradeLog.slice(lastKnownTradeCount);
    for (const trade of newTrades) {
      const pnl = trade.pnl || 0;
      const emoji = pnl >= 0 ? "✅" : "🔴";
      const msg =
        `${emoji} <b>TRADE EXECUTED</b>\n\n` +
        `📊 Market: ${trade.market || "Unknown"}\n` +
        `📈 Action: ${trade.action || "Unknown"}\n` +
        `💵 Entry: $${trade.entry || 0}\n` +
        `💰 P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}\n` +
        `🏁 Result: ${trade.result || "Pending"}\n` +
        `🕐 Time: ${trade.timestamp || new Date().toISOString()}`;
      await sendTelegram(msg);
      log(`Trade notification sent: ${trade.market} ${trade.action}`);
    }
  }
  lastKnownTradeCount = currentCount;
}

async function checkDailySummary() {
  const today = new Date().toDateString();
  const hour = new Date().getHours();
  if (hour === 0 && lastDailySummaryDate !== today) {
    lastDailySummaryDate = today;
    const portfolio = loadJson("portfolio.json");
    const tradeLog = loadJson("trade_log.json");
    const metrics = loadJson("performance_metrics.json");
    const bankroll = portfolio?.bankroll || 0;
    const totalPnl = portfolio?.totalPnl || 0;
    const trades = tradeLog?.length || 0;
    const winRate = metrics?.winRate || 0;
    const msg =
      `📊 <b>DAILY SUMMARY</b>\n\n` +
      `💰 Bankroll: $${bankroll.toFixed(2)}\n` +
      `📈 Total P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}\n` +
      `🏆 Win Rate: ${(winRate * 100).toFixed(1)}%\n` +
      `📋 Total Trades: ${trades}\n` +
      `📅 Date: ${today}`;
    await sendTelegram(msg);
    log("Daily summary sent");
  }
}

function detectIssues(processes: ProcessStatus[], errorLog: string): string[] {
  const issues: string[] = [];

  for (const proc of processes) {
    // Only flag if status is not online
    if (proc.status !== "online") {
      issues.push(`${proc.name} is ${proc.status}`);
      continue;
    }

    // Only flag restart loops if restarts INCREASED since last check
    const prevRestarts = lastRestartCounts[proc.name] ?? proc.restarts;
    const newRestarts = proc.restarts - prevRestarts;
    if (newRestarts >= 3) {
      issues.push(`${proc.name} restarted ${newRestarts} times in last 5 min — crash loop`);
    }
    lastRestartCounts[proc.name] = proc.restarts;
  }

  // Check for missing processes
  const missing = WATCHED_PROCESSES.filter(n => !processes.find(p => p.name === n));
  if (missing.length) issues.push(`Missing processes: ${missing.join(", ")}`);

  // Error log checks
  if (errorLog.includes("Cannot find module")) issues.push("Missing module — npm install needed");
  if (errorLog.includes("out of memory") || errorLog.includes("heap")) issues.push("Memory issue detected");
  if (errorLog.includes("Invalid API key") || errorLog.includes("401")) issues.push("API key error — check .env");
  if (errorLog.includes("429") || errorLog.includes("rate limit")) issues.push("API rate limit hit");

  return issues;
}

async function attemptAutoFix(issues: string[]): Promise<string> {
  const actions: string[] = [];

  for (const issue of issues) {
    // Auto-restart any process that's not online
    if (issue.includes("is stopped") || issue.includes("is errored") || issue.includes("is undefined")) {
      const match = issue.match(/^(kalshi-\w+)/);
      if (match) {
        try {
          execSync(`pm2 restart ${match[1]}`, { timeout: 15000 });
          actions.push(`✅ Restarted ${match[1]}`);
          log(`Auto-restarted ${match[1]}`);
        } catch { actions.push(`❌ Failed to restart ${match[1]}`); }
      }
    }

    // Auto-fix crash loops for kalshi-bot
    if (issue.includes("kalshi-bot") && issue.includes("crash loop")) {
      try {
        execSync("pm2 restart kalshi-bot", { timeout: 15000 });
        execSync("pm2 reset kalshi-bot", { timeout: 5000 });
        actions.push("✅ Restarted kalshi-bot and reset crash counter");
        log("Auto-fixed kalshi-bot crash loop");
      } catch { actions.push("❌ Failed to fix kalshi-bot crash loop"); }
    }

    // Auto-fix crash loops for kalshi-dashboard (port conflict)
    if (issue.includes("kalshi-dashboard") && issue.includes("crash loop")) {
      try {
        try { execSync("fuser -k 3000/tcp", { timeout: 5000 }); } catch {}
        await sleep(2000);
        execSync("pm2 restart kalshi-dashboard", { timeout: 15000 });
        execSync("pm2 reset kalshi-dashboard", { timeout: 5000 });
        actions.push("✅ Cleared port 3000, restarted kalshi-dashboard");
        log("Auto-fixed kalshi-dashboard crash loop");
      } catch { actions.push("❌ Failed to fix kalshi-dashboard crash loop"); }
    }

    // Re-start missing processes
    if (issue.includes("Missing processes")) {
      if (issue.includes("kalshi-bot")) {
        try {
          execSync('pm2 start npm --name "kalshi-bot" -- run bot', { timeout: 15000 });
          actions.push("✅ Re-launched kalshi-bot");
        } catch { actions.push("❌ Failed to launch kalshi-bot"); }
      }
      if (issue.includes("kalshi-dashboard")) {
        try {
          try { execSync("fuser -k 3000/tcp", { timeout: 5000 }); } catch {}
          await sleep(2000);
          execSync('pm2 start npx --name "kalshi-dashboard" -- ts-node src/dashboard.ts', { timeout: 15000 });
          actions.push("✅ Re-launched kalshi-dashboard");
        } catch { actions.push("❌ Failed to launch kalshi-dashboard"); }
      }
    }
  }

  return actions.length > 0 ? actions.join("\n") : "No action needed";
}

async function runHealthCheck() {
  log("Running health check...");
  const processes = getPm2Status();
  const dashboardReachable = await pingDashboard();
  const botErrorLog = readLog(BOT_ERROR_LOG, 30);
  const dashErrorLog = readLog(DASHBOARD_ERROR_LOG, 20);
  const errorLogSnippet = [botErrorLog, dashErrorLog].filter(Boolean).join("\n---\n").slice(0, 2000);
  const issues = detectIssues(processes, errorLogSnippet);

  await checkForNewTrades();
  await checkDailySummary();

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    processes,
    dashboardReachable,
    errorLogSnippet,
    issues,
  };

  if (issues.length === 0) {
    log("✅ All systems healthy");
    appendGuardianLog({ timestamp: report.timestamp, healthReport: report, actionTaken: "None", fixed: true });
    return;
  }

  log(`⚠️  ${issues.length} issue(s): ${issues.join(" | ")}`);

  // Attempt auto-fix first
  const actionTaken = await attemptAutoFix(issues);
  log(`Action taken: ${actionTaken}`);

  // Only send Telegram if cooldown allows
  const alertKey = issues.join("|");
  if (shouldAlert(alertKey)) {
    const fixed = !actionTaken.includes("❌") && actionTaken !== "No action needed";
    const emoji = fixed ? "⚠️" : "🔴";
    const status = fixed ? "AUTO-FIXED ✅" : "NEEDS ATTENTION";
    const msg =
      `${emoji} <b>KALSHI BOT — ${status}</b>\n\n` +
      `🔍 Issues:\n${issues.map(i => `• ${i}`).join("\n")}\n\n` +
      `🔧 Actions:\n${actionTaken}\n\n` +
      `📊 Dashboard: http://159.223.189.172:3000`;
    await sendTelegram(msg);
  } else {
    log("Alert suppressed — cooldown active");
  }

  appendGuardianLog({
    timestamp: report.timestamp,
    healthReport: report,
    actionTaken,
    fixed: !actionTaken.includes("❌"),
  });
}

async function main() {
  log("=".repeat(55));
  log("  KALSHI BOT — GUARDIAN AGENT STARTED");
  log(`  Checking every ${CHECK_INTERVAL_MS / 60000} minutes`);
  log(`  Alert cooldown: ${ALERT_COOLDOWN_MS / 60000} minutes`);
  log(`  Watching: ${WATCHED_PROCESSES.join(", ")}`);
  log(`  Telegram: ${TELEGRAM_CHAT_ID ? "configured ✅" : "not configured ❌"}`);
  log("=".repeat(55));

  await sendTelegram(
    `🚀 <b>KALSHI GUARDIAN STARTED</b>\n\n` +
    `✅ Watching: kalshi-bot, kalshi-dashboard\n` +
    `🔄 Health checks every 5 minutes\n` +
    `🔕 Alert cooldown: 15 minutes (no spam)\n` +
    `🤖 Auto-fix: enabled for all processes\n` +
    `📊 Dashboard: http://159.223.189.172:3000`
  );

  await runHealthCheck();
  setInterval(async () => { await runHealthCheck(); }, CHECK_INTERVAL_MS);
}

main().catch(err => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});