/**
 * ============================================================
 *  POLYMARKET BOT — GUARDIAN AGENT
 *  Monitors bot 24/7, auto-fixes issues, sends Telegram alerts
 * ============================================================
 */

import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import * as dotenv from "dotenv";

dotenv.config();

// ─── CONFIG ────────────────────────────────────────────────────
const MEMORY_CHECK_MS   = 10 * 60 * 1000;       // 10 minutes
const PIPELINE_CHECK_MS = 30 * 60 * 1000;       // 30 minutes
const ALERT_COOLDOWN_MS = 20 * 60 * 1000;       // 20 min cooldown per alert type
const PIPELINE_STALE_MS = 3 * 60 * 60 * 1000;  // 3 hours
const MEMORY_THRESHOLD  = 0.80;                 // 80%
const GUARDIAN_LOG      = "guardian_log.json";
const MAX_LOG_ENTRIES   = 500;

const TELEGRAM_TOKEN   = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

const WATCHED_PROCESSES = [
  "kalshi-bot",
  "kalshi-dashboard",
  "kalshi-guardian",
  "kalshi-telegram",
];

const PIPELINE_FILES = [
  "whale_signals.json",
  "scan_results.json",
  "research_results.json",
  "predictor_results.json",
  "open_positions.json",
];

// ─── STATE ─────────────────────────────────────────────────────
const lastAlertTime: Record<string, number> = {};
const lastRestartCounts: Record<string, number> = {};

// ─── TYPES ─────────────────────────────────────────────────────
interface ProcessInfo {
  name:     string;
  status:   string;
  restarts: number;
  memoryMb: number;
  cpu:      number;
}

// ─── HELPERS ───────────────────────────────────────────────────
function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [GUARDIAN] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldAlert(key: string): boolean {
  const now = Date.now();
  if (now - (lastAlertTime[key] ?? 0) > ALERT_COOLDOWN_MS) {
    lastAlertTime[key] = now;
    return true;
  }
  return false;
}

function appendLog(entry: object): void {
  let entries: object[] = [];
  try {
    if (fs.existsSync(GUARDIAN_LOG))
      entries = JSON.parse(fs.readFileSync(GUARDIAN_LOG, "utf-8"));
  } catch {}
  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) entries = entries.slice(-MAX_LOG_ENTRIES);
  try { fs.writeFileSync(GUARDIAN_LOG, JSON.stringify(entries, null, 2)); } catch {}
}

// ─── TELEGRAM ──────────────────────────────────────────────────
function sendTelegram(message: string): Promise<void> {
  return new Promise((resolve) => {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) { resolve(); return; }
    const body = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML",
    });
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path:     `/bot${TELEGRAM_TOKEN}/sendMessage`,
        method:   "POST",
        headers: {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => { res.resume(); res.on("end", resolve); }
    );
    req.on("error", (e) => { log(`Telegram error: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

// ─── PM2 ───────────────────────────────────────────────────────
function getPm2Status(): ProcessInfo[] {
  try {
    const result = spawnSync("pm2", ["jlist"], { encoding: "utf-8", timeout: 10000 });
    if (result.status !== 0 || !result.stdout) return [];
    const list: any[] = JSON.parse(result.stdout);
    return list
      .filter((p) => WATCHED_PROCESSES.includes(p.name))
      .map((p) => ({
        name:     p.name,
        status:   p.pm2_env?.status ?? "unknown",
        restarts: p.pm2_env?.restart_time ?? 0,
        memoryMb: Math.round((p.monit?.memory ?? 0) / 1024 / 1024),
        cpu:      p.monit?.cpu ?? 0,
      }));
  } catch { return []; }
}

function pm2Restart(name: string): boolean {
  try {
    execSync(`pm2 restart ${name}`, { timeout: 20000 });
    log(`Restarted: ${name}`);
    return true;
  } catch {
    log(`Failed to restart: ${name}`);
    return false;
  }
}

// ─── PIPELINE FRESHNESS ────────────────────────────────────────
interface FreshnessResult {
  stale:    string[];
  oldestMs: number;
}

function checkPipelineFreshness(): FreshnessResult {
  const now = Date.now();
  const stale: string[] = [];
  let oldestMs = 0;

  for (const file of PIPELINE_FILES) {
    if (!fs.existsSync(file)) {
      stale.push(`${file} (missing)`);
      continue;
    }
    const ageMs = now - fs.statSync(file).mtimeMs;
    if (ageMs > oldestMs) oldestMs = ageMs;
    if (ageMs > PIPELINE_STALE_MS) {
      stale.push(`${file} (${Math.round(ageMs / 3_600_000)}h old)`);
    }
  }

  return { stale, oldestMs };
}

// ─── MEMORY CHECK ──────────────────────────────────────────────
async function checkMemory(processes: ProcessInfo[]): Promise<void> {
  const totalMb  = Math.round(os.totalmem() / 1024 / 1024);
  const freeMb   = Math.round(os.freemem()  / 1024 / 1024);
  const usedFrac = 1 - freeMb / totalMb;

  log(`Memory: ${Math.round(usedFrac * 100)}% used (${freeMb}MB free / ${totalMb}MB total)`);

  if (usedFrac >= MEMORY_THRESHOLD && shouldAlert("memory_high")) {
    const procLines = processes
      .map((p) => `  • ${p.name}: ${p.memoryMb}MB`)
      .join("\n");
    await sendTelegram(
      `⚠️ <b>POLYMARKET BOT — HIGH MEMORY</b>\n\n` +
      `🧠 System: ${Math.round(usedFrac * 100)}% used\n` +
      `   ${freeMb}MB free of ${totalMb}MB\n\n` +
      `📊 Per process:\n${procLines}`
    );
  }
}

// ─── PROCESS CHECK ─────────────────────────────────────────────
async function checkProcesses(): Promise<void> {
  const processes = getPm2Status();
  const onlineNames = new Set(
    processes.filter((p) => p.status === "online").map((p) => p.name)
  );
  const offlineNames = WATCHED_PROCESSES.filter((n) => !onlineNames.has(n));

  log(
    `Online: [${[...onlineNames].join(", ") || "none"}]  ` +
    `Offline: [${offlineNames.join(", ") || "none"}]`
  );

  for (const name of offlineNames) {
    log(`⚠️  ${name} is offline`);

    // For dashboard: clear port 3000 before restarting (port conflict is the #1 cause)
    if (name === "kalshi-dashboard") {
      try { execSync("fuser -k 3000/tcp", { timeout: 5000 }); } catch {}
      await sleep(2000);
    }

    const ok = pm2Restart(name);

    if (shouldAlert(`offline_${name}`)) {
      await sendTelegram(
        `🔴 <b>POLYMARKET BOT — PROCESS OFFLINE</b>\n\n` +
        `❌ <code>${name}</code> went offline\n` +
        `🔧 Auto-restart: ${ok ? "✅ succeeded" : "❌ failed"}\n` +
        `🕐 ${new Date().toLocaleTimeString()}`
      );
    }

    appendLog({
      timestamp: new Date().toISOString(),
      event:     "process_offline",
      process:   name,
      action:    ok ? "restarted" : "restart_failed",
    });
  }

  // Crash loop detection (3+ new restarts since last check)
  for (const proc of processes) {
    const prev = lastRestartCounts[proc.name] ?? proc.restarts;
    const diff = proc.restarts - prev;
    if (diff >= 3 && shouldAlert(`crash_${proc.name}`)) {
      await sendTelegram(
        `⚠️ <b>CRASH LOOP — ${proc.name}</b>\n` +
        `Restarted ${diff}× since last check`
      );
    }
    lastRestartCounts[proc.name] = proc.restarts;
  }

  await checkMemory(processes);
}

// ─── PIPELINE CHECK ────────────────────────────────────────────
async function checkPipeline(): Promise<void> {
  const { stale, oldestMs } = checkPipelineFreshness();

  if (stale.length === 0) {
    log(`✅ Pipeline fresh — oldest file ${Math.round(oldestMs / 60_000)}m ago`);
    return;
  }

  log(`⚠️  Stale pipeline files: ${stale.join(", ")}`);

  const ok = pm2Restart("kalshi-bot");

  if (shouldAlert("pipeline_stale")) {
    await sendTelegram(
      `⏰ <b>POLYMARKET BOT — PIPELINE STALLED</b>\n\n` +
      `🕐 No pipeline run in 3+ hours\n\n` +
      `📁 Stale files:\n${stale.map((f) => `  • ${f}`).join("\n")}\n\n` +
      `🔧 kalshi-bot restart: ${ok ? "✅ triggered" : "❌ failed"}`
    );
  }

  appendLog({
    timestamp:  new Date().toISOString(),
    event:      "pipeline_stale",
    staleFiles: stale,
    action:     ok ? "restarted_bot" : "restart_failed",
  });
}

// ─── MAIN ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  log("=".repeat(55));
  log("  POLYMARKET BOT — GUARDIAN AGENT STARTED");
  log(`  Process/memory check: every ${MEMORY_CHECK_MS / 60_000} minutes`);
  log(`  Pipeline check:       every ${PIPELINE_CHECK_MS / 60_000} minutes`);
  log(`  Pipeline stale after: ${PIPELINE_STALE_MS / 3_600_000} hours`);
  log(`  Memory alert above:   ${MEMORY_THRESHOLD * 100}%`);
  log(`  Watching: ${WATCHED_PROCESSES.join(", ")}`);
  log(`  Telegram: ${TELEGRAM_CHAT_ID ? "configured ✅" : "not configured ❌"}`);
  log("=".repeat(55));

  await sendTelegram(
    `🚀 <b>POLYMARKET GUARDIAN STARTED</b>\n\n` +
    `✅ Watching: ${WATCHED_PROCESSES.join(", ")}\n` +
    `🧠 Memory + process check: every 10 min\n` +
    `📁 Pipeline freshness check: every 30 min\n` +
    `⏰ Pipeline stale threshold: 3 hours\n` +
    `🤖 Auto-fix: enabled`
  );

  // Initial checks on startup
  await checkProcesses();
  await checkPipeline();

  // Process + memory: every 10 minutes
  setInterval(async () => { await checkProcesses(); }, MEMORY_CHECK_MS);

  // Pipeline freshness: every 30 minutes
  setInterval(async () => { await checkPipeline(); }, PIPELINE_CHECK_MS);
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});
