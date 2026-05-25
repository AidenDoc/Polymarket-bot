/**
 * ============================================================
 *  KALSHI BOT — GUARDIAN AGENT
 *  AI-powered monitor that watches your bot 24/7,
 *  auto-fixes issues, and sends Telegram notifications.
 * ============================================================
 */

import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import * as dotenv from "dotenv";

dotenv.config();

// ─── CONFIG ────────────────────────────────────────────────
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DASHBOARD_URL = "http://localhost:3000";
const GUARDIAN_LOG = "guardian_log.json";
const BOT_ERROR_LOG = path.join(process.env.HOME || "/root", ".pm2/logs/kalshi-bot-error.log");
const DASHBOARD_ERROR_LOG = path.join(process.env.HOME || "/root", ".pm2/logs/kalshi-dashboard-error.log");
const MAX_RESTARTS_BEFORE_ALERT = 5;
const MAX_LOG_ENTRIES = 200;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const WATCHED_PROCESSES = ["kalshi-bot", "kalshi-dashboard"];

let lastKnownTradeCount = 0;
let lastDailySummaryDate = "";

// ─── TYPES ─────────────────────────────────────────────────
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
  diagnosis: string;
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

// ─── HELPERS ───────────────────────────────────────────────
function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [GUARDIAN] ${msg}`);
}

function readLog(filePath: string, lines = 50): string {
  try {
    if (!fs.existsSync(filePath)) return "";
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function loadJson(file: string): any {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
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

// ─── TELEGRAM ──────────────────────────────────────────────
function sendTelegram(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      log("Telegram not configured — skipping notification");
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

// ─── PM2 STATUS ────────────────────────────────────────────
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
        uptime: p.pm2_env?.pm_uptime ? `${Math.round((Date.now() - p.pm2_env.pm_uptime) / 60000)}m` : "unknown",
      }));
  } catch { return []; }
}

// ─── DASHBOARD PING ────────────────────────────────────────
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

// ─── TRADE MONITORING ──────────────────────────────────────
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

// ─── DAILY SUMMARY ─────────────────────────────────────────
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
      `📅 Date: ${today}\n\n` +
      `🤖 Bot is running smoothly on Kalshi`;
    await sendTelegram(msg);
    log("Daily summary sent");
  }
}

// ─── ISSUE DETECTION ───────────────────────────────────────
function detectIssues(processes: ProcessStatus[], dashboardReachable: boolean, errorLog: string): string[] {
  const issues: string[] = [];
  for (const proc of processes) {
    if (proc.status !== "online") issues.push(`Process "${proc.name}" is ${proc.status} (not online)`);
    if (proc.restarts > MAX_RESTARTS_BEFORE_ALERT) issues.push(`Process "${proc.name}" has restarted ${proc.restarts} times — possible crash loop`);
  }
  if (WATCHED_PROCESSES.some((n) => !processes.find((p) => p.name === n))) {
    const missing = WATCHED_PROCESSES.filter((n) => !processes.find((p) => p.name === n));
    issues.push(`Missing processes: ${missing.join(", ")}`);
  }
  if (!dashboardReachable) issues.push("Dashboard is not reachable at localhost:3000");
  if (errorLog.includes("ETIMEDOUT")) issues.push("Scanner ETIMEDOUT detected in error log");
  if (errorLog.includes("ECONNREFUSED")) issues.push("Connection refused error in log — possible API key issue");
  if (errorLog.includes("Cannot find module")) issues.push("Missing module error — npm install may be needed");
  if (errorLog.includes("SyntaxError")) issues.push("Syntax error detected in logs");
  if (errorLog.includes("out of memory") || errorLog.includes("heap")) issues.push("Memory issue detected — process may need restart");
  if (errorLog.includes("Invalid API key") || errorLog.includes("401")) issues.push("API key error detected — check your .env file");
  if (errorLog.includes("429") || errorLog.includes("rate limit")) issues.push("API rate limit hit — consider spacing out requests");
  return issues;
}

// ─── CLAUDE API DIAGNOSIS ──────────────────────────────────
async function getDiagnosis(report: HealthReport): Promise<string> {
  const prompt = `You are an expert DevOps agent monitoring a Kalshi prediction market trading bot running on a Ubuntu VPS with PM2.

Here is the current health report:
- Timestamp: ${report.timestamp}
- Processes: ${JSON.stringify(report.processes, null, 2)}
- Dashboard reachable: ${report.dashboardReachable}
- Detected issues: ${report.issues.join("; ")}
- Recent error log snippet:
${report.errorLogSnippet}

Based on this, provide:
1. A brief diagnosis of what's wrong (2-3 sentences max)
2. The recommended fix (be specific — exact commands if needed)
3. Whether this is AUTO-FIXABLE (just a restart) or NEEDS MANUAL ATTENTION

Format your response as:
DIAGNOSIS: <diagnosis>
FIX: <fix>
AUTO-FIXABLE: <YES or NO>`;

  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });
    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || "No diagnosis available");
        } catch { resolve("Failed to parse Claude response"); }
      });
    });
    req.on("error", () => resolve("Claude API unreachable"));
    req.write(body);
    req.end();
  });
}

// ─── AUTO-FIX ──────────────────────────────────────────────
async function attemptAutoFix(issues: string[]): Promise<string> {
  const actions: string[] = [];
  for (const issue of issues) {
    if (issue.includes("is stopped") || issue.includes("is errored")) {
      const match = issue.match(/Process "(.+?)"/);
      if (match) {
        try {
          execSync(`pm2 restart ${match[1]}`, { timeout: 15000 });
          actions.push(`Restarted ${match[1]}`);
        } catch { actions.push(`Failed to restart ${match[1]}`); }
      }
    }
    if (issue.includes("Missing processes")) {
      if (issue.includes("kalshi-bot")) {
        try {
          execSync('pm2 start npm --name "kalshi-bot" -- run bot', { timeout: 15000 });
          actions.push("Re-started kalshi-bot");
        } catch { actions.push("Failed to re-start kalshi-bot"); }
      }
      if (issue.includes("kalshi-dashboard")) {
        try {
          try { execSync("fuser -k 3000/tcp", { timeout: 5000 }); } catch {}
          await sleep(2000);
          execSync('pm2 start npx --name "kalshi-dashboard" -- ts-node src/dashboard.ts', { timeout: 15000 });
          actions.push("Re-started kalshi-dashboard");
        } catch { actions.push("Failed to re-start kalshi-dashboard"); }
      }
    }
    if (issue.includes("Dashboard is not reachable")) {
      try {
        try { execSync("fuser -k 3000/tcp", { timeout: 5000 }); } catch {}
        await sleep(2000);
        execSync("pm2 restart kalshi-dashboard", { timeout: 15000 });
        actions.push("Cleared port 3000 and restarted kalshi-dashboard");
      } catch { actions.push("Failed to restart kalshi-dashboard"); }
    }
  }
  return actions.length > 0 ? actions.join("; ") : "No auto-fix applied";
}

// ─── MAIN HEALTH CHECK ─────────────────────────────────────
async function runHealthCheck() {
  log("Running health check...");
  const processes = getPm2Status();
  const dashboardReachable = await pingDashboard();
  const botErrorLog = readLog(BOT_ERROR_LOG, 30);
  const dashErrorLog = readLog(DASHBOARD_ERROR_LOG, 20);
  const errorLogSnippet = [botErrorLog, dashErrorLog].filter(Boolean).join("\n---\n").slice(0, 2000);
  const issues = detectIssues(processes, dashboardReachable, errorLogSnippet);
  await checkForNewTrades();
  await checkDailySummary();
  const report: HealthReport = { timestamp: new Date().toISOString(), processes, dashboardReachable, errorLogSnippet, issues };
  if (issues.length === 0) {
    log("✅ All systems healthy");
    appendGuardianLog({ timestamp: report.timestamp, healthReport: report, diagnosis: "All systems healthy", actionTaken: "None", fixed: true });
    return;
  }
  log(`⚠️  ${issues.length} issue(s) detected: ${issues.join(" | ")}`);
  log("Calling Claude API for diagnosis...");
  const diagnosis = await getDiagnosis(report);
  log(`Diagnosis: ${diagnosis}`);
  const actionTaken = await attemptAutoFix(issues);
  log(`Action taken: ${actionTaken}`);
  const needsManual = diagnosis.includes("NEEDS MANUAL ATTENTION") || actionTaken === "No auto-fix applied";
  const emoji = needsManual ? "🔴" : "⚠️";
  const status = needsManual ? "NEEDS YOUR ATTENTION" : "AUTO-FIXED";
  const telegramMsg =
    `${emoji} <b>KALSHI BOT ALERT — ${status}</b>\n\n` +
    `🔍 Issues:\n${issues.map((i) => `• ${i}`).join("\n")}\n\n` +
    `🤖 Diagnosis:\n${diagnosis.replace("DIAGNOSIS: ", "").split("FIX:")[0].trim()}\n\n` +
    `🔧 Action Taken: ${actionTaken}\n\n` +
    `📊 Dashboard: http://159.223.189.172:3000`;
  await sendTelegram(telegramMsg);
  appendGuardianLog({ timestamp: report.timestamp, healthReport: report, diagnosis, actionTaken, fixed: actionTaken !== "No auto-fix applied" });
}

// ─── STARTUP ───────────────────────────────────────────────
async function main() {
  log("=".repeat(55));
  log("  KALSHI BOT — GUARDIAN AGENT STARTED");
  log(`  Checking every ${CHECK_INTERVAL_MS / 60000} minutes`);
  log(`  Watching: ${WATCHED_PROCESSES.join(", ")}`);
  log(`  Telegram: ${TELEGRAM_CHAT_ID ? "configured ✅" : "not configured ❌"}`);
  log("=".repeat(55));
  await sendTelegram(
    `🚀 <b>KALSHI GUARDIAN STARTED</b>\n\n` +
    `✅ Watching: kalshi-bot, kalshi-dashboard\n` +
    `🔄 Health checks every 5 minutes\n` +
    `📊 Dashboard: http://159.223.189.172:3000\n\n` +
    `You'll be notified of trades, issues, and daily summaries.`
  );
  await runHealthCheck();
  setInterval(async () => { await runHealthCheck(); }, CHECK_INTERVAL_MS);
}

main().catch((err) => { log(`Fatal error: ${err.message}`); process.exit(1); });