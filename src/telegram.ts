/**
 * ============================================================
 *  POLYMARKET BOT — TELEGRAM COMMAND CENTER
 *  Full command interface + automatic credit alerts
 * ============================================================
 */

import * as fs from "fs";
import * as https from "https";
import { execSync, exec } from "child_process";
import * as dotenv from "dotenv";

dotenv.config();

// ─── CONFIG ────────────────────────────────────────────────────
const TELEGRAM_TOKEN          = process.env.TELEGRAM_BOT_TOKEN ?? "";
const ALLOWED_CHAT_ID         = process.env.TELEGRAM_CHAT_ID ?? "";
const ANTHROPIC_KEY           = process.env.ANTHROPIC_API_KEY ?? "";
const POLL_INTERVAL_MS        = 2_000;
const CREDIT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000; // 6 hours
const CREDIT_ALERT_THRESHOLD  = 2.00;                  // alert below $2
const KILL_SWITCH_FILE        = "STOP";
const DASHBOARD_URL           = process.env.DASHBOARD_URL ?? "http://localhost:3000";

const PM2_PROCESSES = ["kalshi-bot", "kalshi-dashboard", "kalshi-guardian", "kalshi-telegram"];

let lastUpdateId = 0;
let lastCreditBalance: number | null = null;

// ─── HELPERS ───────────────────────────────────────────────────
function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [TELEGRAM] ${msg}`);
}

function loadJson(file: string): any {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { return null; }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ago(isoOrUnix: string | number): string {
  const ms = typeof isoOrUnix === "number"
    ? (isoOrUnix > 1e12 ? isoOrUnix : isoOrUnix * 1000)
    : new Date(isoOrUnix).getTime();
  const diff = Math.floor((Date.now() - ms) / 60_000);
  if (diff < 1)  return "just now";
  if (diff < 60) return `${diff}m ago`;
  const h = Math.floor(diff / 60);
  if (h < 24)    return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmt$(n: number): string {
  return (n >= 0 ? "+$" : "-$") + Math.abs(n).toFixed(2);
}

// ─── TELEGRAM API ──────────────────────────────────────────────
function telegramRequest(method: string, body: object): Promise<any> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path:     `/bot${TELEGRAM_TOKEN}/${method}`,
        method:   "POST",
        headers: {
          "Content-Type":   "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
      }
    );
    req.on("error", () => resolve(null));
    req.write(data);
    req.end();
  });
}

async function send(chatId: string, text: string): Promise<void> {
  await telegramRequest("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

async function getUpdates(): Promise<any[]> {
  const r = await telegramRequest("getUpdates", {
    offset: lastUpdateId + 1,
    timeout: 10,
    limit: 10,
  });
  return r?.ok ? r.result ?? [] : [];
}

// ─── ANTHROPIC CREDIT CHECK ────────────────────────────────────
async function fetchAnthropicCredits(): Promise<number | null> {
  return new Promise((resolve) => {
    if (!ANTHROPIC_KEY) { resolve(null); return; }
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path:     "/v1/organizations/usage",
        method:   "GET",
        headers: {
          "x-api-key":         ANTHROPIC_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            // Field name varies — try several candidates
            const balance =
              parsed.credit_balance ??
              parsed.remaining_credits ??
              parsed.balance ??
              parsed.credits_remaining ??
              null;
            resolve(typeof balance === "number" ? balance : null);
          } catch { resolve(null); }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}

async function checkAndAlertCredits(): Promise<void> {
  const balance = await fetchAnthropicCredits();
  lastCreditBalance = balance;
  if (balance !== null && balance < CREDIT_ALERT_THRESHOLD) {
    await send(
      ALLOWED_CHAT_ID,
      `⚠️ <b>LOW ANTHROPIC CREDITS</b>\n\n` +
      `💳 Remaining: <b>$${balance.toFixed(2)}</b>\n` +
      `🚨 Below alert threshold ($${CREDIT_ALERT_THRESHOLD.toFixed(2)})\n` +
      `👉 Top up at console.anthropic.com`
    );
  }
}

// ─── FORMATTERS ────────────────────────────────────────────────

function formatStatus(): string {
  const portfolio = loadJson("portfolio.json");
  const scan      = loadJson("scan_results.json");
  const pred      = loadJson("predictor_results.json");

  let msg = `📊 <b>POLYMARKET BOT STATUS</b>\n`;
  msg += `🕐 ${new Date().toLocaleString()}\n\n`;

  // Kill switch
  msg += fs.existsSync(KILL_SWITCH_FILE)
    ? `🛑 <b>Kill switch: ACTIVE</b> (trading paused)\n\n`
    : `✅ Kill switch: OFF (trading active)\n\n`;

  // PM2 processes
  msg += `<b>Processes:</b>\n`;
  try {
    const list: any[] = JSON.parse(execSync("pm2 jlist", { encoding: "utf-8" }));
    for (const name of PM2_PROCESSES) {
      const p = list.find((x) => x.name === name);
      if (!p) { msg += `⚫ ${name} — not found\n`; continue; }
      const online = p.pm2_env?.status === "online";
      const mem = Math.round((p.monit?.memory ?? 0) / 1024 / 1024);
      const restarts = p.pm2_env?.restart_time ?? 0;
      msg += `${online ? "🟢" : "🔴"} ${name} — ${mem}MB, ${restarts} restarts\n`;
    }
  } catch { msg += `❌ Could not read PM2 status\n`; }

  // Last pipeline run times
  msg += `\n<b>Last pipeline runs:</b>\n`;
  const files: [string, string][] = [
    ["whale_signals.json",    "🐳 Whale tracker"],
    ["scan_results.json",     "🔍 Scanner"],
    ["research_results.json", "📚 Researcher"],
    ["predictor_results.json","🧠 Predictor"],
    ["open_positions.json",   "📂 Positions"],
  ];
  for (const [file, label] of files) {
    if (!fs.existsSync(file)) { msg += `  ${label}: never\n`; continue; }
    const mtime = fs.statSync(file).mtimeMs;
    msg += `  ${label}: ${ago(mtime)}\n`;
  }

  if (scan)   msg += `\n🔍 Markets scanned: ${scan.qualifyingCount ?? "?"} | fetched: ${scan.totalFetched ?? "?"}`;
  if (pred)   msg += `\n🧠 Signals: ${pred.totalSignals ?? "?"} total, ${pred.actionable ?? "?"} actionable`;
  if (portfolio) {
    const bankroll = portfolio.bankroll ?? 0;
    const pnl = portfolio.totalPnl ?? 0;
    msg += `\n💰 Bankroll: $${bankroll.toFixed(2)} (${fmt$(pnl)} all time)`;
  }

  return msg;
}

function formatPositions(): string {
  const pos: any[] = loadJson("open_positions.json") ?? [];
  if (!pos.length) return `📂 <b>No open positions</b>\n\nThe bot hasn't placed any trades yet.`;

  let msg = `📂 <b>OPEN POSITIONS (${pos.length})</b>\n\n`;
  for (const p of pos) {
    const yes = p.action === "BUY_YES";
    const q = (p.question ?? p.conditionId ?? "Unknown").slice(0, 60);
    const entry = (p.price ?? p.entryPrice ?? 0).toFixed(3);
    const size = (p.sizeUsdc ?? p.costBasis ?? 0).toFixed(2);
    const upnl = p.unrealizedPnl !== undefined ? p.unrealizedPnl : 0;
    msg += `${yes ? "🟢" : "🔴"} <b>${p.action}</b>${p.paper ? " 📝PAPER" : ""}\n`;
    msg += `📌 ${q}\n`;
    msg += `💵 Entry: $${entry}  Size: $${size}\n`;
    msg += `📈 Unrealized P&L: ${fmt$(upnl)}\n`;
    msg += `🕐 Opened: ${ago(p.openedAt)}\n\n`;
  }
  return msg.trimEnd();
}

function formatTrades(): string {
  const trades: any[] = loadJson("trade_history.json") ?? [];
  const closed = trades.filter((t) => t.closedAt !== undefined || t.pnl !== undefined);
  if (!closed.length) return `📋 <b>No closed trades yet</b>`;

  const recent = closed.slice(-10).reverse();
  let msg = `📋 <b>LAST ${recent.length} CLOSED TRADES</b>\n\n`;
  for (const t of recent) {
    const pnl = t.pnl ?? 0;
    const win = pnl >= 0;
    const q = (t.question ?? t.conditionId ?? "Unknown").slice(0, 55);
    msg += `${win ? "✅" : "❌"} <b>${win ? "WIN" : "LOSS"}</b> ${t.action === "BUY_YES" ? "🟢YES" : "🔴NO"}\n`;
    msg += `📌 ${q}\n`;
    msg += `💰 P&L: <b>${fmt$(pnl)}</b>  Size: $${(t.size ?? t.sizeUsdc ?? 0).toFixed(2)}\n`;
    msg += `🕐 ${ago(t.closedAt ?? t.timestamp)}\n\n`;
  }

  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const wins = closed.filter((t) => (t.pnl ?? 0) >= 0).length;
  msg += `──────────────\n`;
  msg += `💰 Total P&L: <b>${fmt$(totalPnl)}</b>\n`;
  msg += `🏆 Win rate: ${closed.length > 0 ? ((wins / closed.length) * 100).toFixed(1) : "0.0"}% (${wins}W/${closed.length - wins}L)`;
  return msg;
}

function formatPnl(): string {
  const portfolio = loadJson("portfolio.json");
  const trades: any[] = loadJson("trade_history.json") ?? [];

  if (!portfolio) return `💰 <b>No portfolio data yet</b>`;

  const bankroll = portfolio.bankroll ?? 0;
  const start    = portfolio.startingBankroll ?? 1000;
  const totalPnl = portfolio.totalPnl ?? 0;
  const dailyPnl = portfolio.dailyPnl ?? 0;
  const wins     = portfolio.winCount ?? 0;
  const losses   = portfolio.lossCount ?? 0;
  const total    = wins + losses;
  const wr       = total > 0 ? (wins / total * 100).toFixed(1) : "0.0";
  const roi      = ((bankroll - start) / start * 100).toFixed(2);

  let msg = `💰 <b>P&L SUMMARY</b>\n\n`;
  msg += `🏦 Bankroll: <b>$${bankroll.toFixed(2)}</b>\n`;
  msg += `📈 All-time P&L: <b>${fmt$(totalPnl)}</b> (${Number(roi) >= 0 ? "+" : ""}${roi}% ROI)\n`;
  msg += `📅 Today's P&L: <b>${fmt$(dailyPnl)}</b>\n`;
  msg += `🏆 Win rate: <b>${wr}%</b> (${wins}W / ${losses}L)\n`;
  msg += `📂 Open positions: ${portfolio.openPositions ?? (loadJson("open_positions.json") ?? []).length}\n`;
  msg += `💼 Starting balance: $${start.toFixed(2)}`;
  return msg;
}

function formatCredits(): string {
  const balance = lastCreditBalance;
  if (balance === null) {
    return (
      `💳 <b>ANTHROPIC CREDITS</b>\n\n` +
      `⚠️ Could not fetch credit balance.\n` +
      `The API may not expose this endpoint.\n` +
      `👉 Check manually at console.anthropic.com`
    );
  }
  const emoji = balance < CREDIT_ALERT_THRESHOLD ? "🚨" : balance < 5 ? "⚠️" : "✅";
  return (
    `💳 <b>ANTHROPIC CREDITS</b>\n\n` +
    `${emoji} Remaining: <b>$${balance.toFixed(2)}</b>\n` +
    `🔔 Alert threshold: $${CREDIT_ALERT_THRESHOLD.toFixed(2)}\n` +
    `👉 console.anthropic.com`
  );
}

function formatMarkets(): string {
  const scan = loadJson("scan_results.json");
  if (!scan?.markets?.length) return `🔍 <b>No scan data yet</b>\n\nRun the scanner first.`;

  const top5 = scan.markets.slice(0, 5);
  let msg = `🔍 <b>TOP 5 MARKETS</b>\n`;
  msg += `🕐 Scanned ${ago(scan.timestamp)}\n\n`;
  for (let i = 0; i < top5.length; i++) {
    const m = top5[i];
    const q = (m.question ?? "Unknown").slice(0, 60);
    const vol = m.volume24hr >= 1_000
      ? `$${(m.volume24hr / 1_000).toFixed(1)}k`
      : `$${m.volume24hr?.toFixed(0) ?? "?"}`;
    const price = m.outcomePrices?.[0];
    msg += `<b>${i + 1}.</b> ${q}\n`;
    msg += `   📊 Vol: ${vol}  💲 YES: ${price !== undefined ? (price * 100).toFixed(1) + "%" : "?"}\n`;
    msg += `   🎯 Score: ${m.score?.toFixed(3) ?? "?"}\n\n`;
  }
  return msg.trimEnd();
}

function formatWhales(): string {
  const raw = loadJson("whale_signals.json");
  const signals: any[] = Array.isArray(raw) ? raw : (raw?.signals ?? []);
  if (!signals.length) return `🐳 <b>No whale signals yet</b>`;

  const recent = signals.slice(0, 10);
  let msg = `🐳 <b>LAST ${recent.length} WHALE SIGNALS</b>\n\n`;
  for (const w of recent) {
    const yes = (w.outcome ?? "").toLowerCase() === "yes";
    const sz  = (w.usdcSize ?? w.size ?? 0);
    const szs = sz >= 1_000 ? `$${(sz / 1_000).toFixed(1)}k` : `$${sz.toFixed(0)}`;
    const q   = (w.title ?? w.question ?? w.conditionId ?? "Unknown").slice(0, 55);
    msg += `${yes ? "🟢" : "🔴"} <b>${yes ? "YES" : "NO"}</b> ${szs}\n`;
    msg += `📌 ${q}\n`;
    msg += `🕐 ${ago(w.timestamp)}\n\n`;
  }
  return msg.trimEnd();
}

function formatSignals(): string {
  const data = loadJson("predictor_results.json");
  if (!data?.signals?.length) return `🧠 <b>No signals yet</b>\n\nWaiting for next predictor run.`;

  const actionable = data.signals.filter((s: any) => s.action !== "PASS");
  let msg = `🧠 <b>ACTIVE SIGNALS</b>\n`;
  msg += `🕐 ${ago(data.timestamp)}\n`;
  msg += `📊 ${data.totalSignals ?? 0} total | ${data.actionable ?? 0} actionable\n\n`;

  if (!actionable.length) {
    msg += `⏸ No actionable signals this cycle\n`;
    msg += `All markets below edge/confidence threshold`;
    return msg;
  }

  for (const s of actionable.slice(0, 5)) {
    const yes = s.action === "BUY_YES";
    const q   = (s.question ?? s.conditionId ?? "Unknown").slice(0, 55);
    msg += `${yes ? "🟢" : "🔴"} <b>${s.action}</b>\n`;
    msg += `📌 ${q}\n`;
    msg += `📈 Market: ${(s.marketImpliedProb ?? 0).toFixed(1)}% → AI: ${(s.ensembleProbability ?? 0).toFixed(1)}%\n`;
    msg += `⚡ Edge: ${(s.edge > 0 ? "+" : "")}${(s.edge ?? 0).toFixed(1)}%  Conf: ${((s.confidence ?? 0) * 100).toFixed(0)}%\n`;
    msg += `💵 Suggested: $${s.suggestedPositionSize ?? 0}\n\n`;
  }
  return msg.trimEnd();
}

// ─── COMMAND HANDLER ───────────────────────────────────────────

async function handleCommand(chatId: string, text: string): Promise<void> {
  const cmd = text.trim().toLowerCase().split(" ")[0];
  log(`Command: ${cmd}`);

  switch (cmd) {
    case "/status":
    case "/start":
      return send(chatId, formatStatus());

    case "/positions":
      return send(chatId, formatPositions());

    case "/trades":
      return send(chatId, formatTrades());

    case "/pnl":
      return send(chatId, formatPnl());

    case "/credits": {
      await send(chatId, "💳 Checking Anthropic credits...");
      lastCreditBalance = await fetchAnthropicCredits();
      return send(chatId, formatCredits());
    }

    case "/markets":
      return send(chatId, formatMarkets());

    case "/whales":
      return send(chatId, formatWhales());

    case "/signals":
      return send(chatId, formatSignals());

    case "/dashboard":
      return send(chatId,
        `📊 <b>DASHBOARD</b>\n\n` +
        `🔗 ${DASHBOARD_URL}\n\n` +
        `Auto-refreshes every 30 seconds.`
      );

    case "/stop":
      fs.writeFileSync(KILL_SWITCH_FILE, "stop");
      return send(chatId,
        `🛑 <b>Kill switch ACTIVATED</b>\n\n` +
        `Trading will halt after the current pipeline finishes.\n` +
        `Use /resume to restart.`
      );

    case "/resume":
      if (fs.existsSync(KILL_SWITCH_FILE)) fs.unlinkSync(KILL_SWITCH_FILE);
      return send(chatId,
        `▶️ <b>Kill switch DEACTIVATED</b>\n\n` +
        `Trading will resume on the next pipeline cycle.`
      );

    case "/run":
      await send(chatId, "🔄 Triggering pipeline run — restarting kalshi-bot...");
      try {
        execSync("pm2 restart kalshi-bot", { timeout: 20_000 });
        await send(chatId,
          `✅ <b>kalshi-bot restarted</b>\n\n` +
          `Pipeline will run immediately then resume its normal schedule.\n` +
          `Use /status to monitor progress.`
        );
      } catch {
        await send(chatId, `❌ Failed to restart kalshi-bot. Check PM2 logs.`);
      }
      return;

    case "/help":
      return send(chatId,
        `🤖 <b>POLYMARKET BOT COMMANDS</b>\n\n` +
        `📊 <b>Info:</b>\n` +
        `/status — PM2 processes, pipeline freshness\n` +
        `/positions — All open bets with P&amp;L\n` +
        `/trades — Last 10 closed trades\n` +
        `/pnl — Total P&amp;L, win rate, bankroll\n` +
        `/credits — Anthropic API credit balance\n` +
        `/markets — Top 5 markets from last scan\n` +
        `/whales — Last 10 whale signals\n` +
        `/signals — Current predictor signals\n` +
        `/dashboard — Dashboard link\n\n` +
        `⚙️ <b>Control:</b>\n` +
        `/stop — Activate kill switch (pause trading)\n` +
        `/resume — Deactivate kill switch\n` +
        `/run — Trigger a pipeline run now\n\n` +
        `💡 Credits checked automatically every 6 hours.`
      );

    default:
      return send(chatId,
        `❓ Unknown command: <code>${cmd}</code>\n\nType /help to see all available commands.`
      );
  }
}

// ─── POLLING LOOP ──────────────────────────────────────────────

async function poll(): Promise<void> {
  const updates = await getUpdates();
  for (const update of updates) {
    lastUpdateId = update.update_id;
    const msg = update.message;
    if (!msg?.text) continue;

    const chatId = String(msg.chat.id);
    const text   = msg.text;
    log(`Message from ${chatId}: ${text}`);

    if (chatId !== ALLOWED_CHAT_ID) {
      log(`Blocked unauthorized chat: ${chatId}`);
      await send(chatId, "⛔ Unauthorized. This bot is private.");
      continue;
    }

    try {
      await handleCommand(chatId, text);
    } catch (e: any) {
      log(`Error handling command: ${e.message}`);
      await send(chatId, `❌ Error: ${e.message.slice(0, 100)}`);
    }
  }
}

// ─── MAIN ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!TELEGRAM_TOKEN || !ALLOWED_CHAT_ID) {
    console.error("[ERROR] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in .env");
    process.exit(1);
  }

  log("=".repeat(55));
  log("  POLYMARKET BOT — TELEGRAM COMMAND CENTER");
  log(`  Polling every ${POLL_INTERVAL_MS / 1000}s`);
  log(`  Credit check every ${CREDIT_CHECK_INTERVAL_MS / 3_600_000}h`);
  log(`  Authorized chat: ${ALLOWED_CHAT_ID}`);
  log("=".repeat(55));

  // Initial credit check
  lastCreditBalance = await fetchAnthropicCredits();

  await send(
    ALLOWED_CHAT_ID,
    `🤖 <b>POLYMARKET COMMAND CENTER ONLINE</b>\n\n` +
    `✅ All systems go — type /help for commands.\n` +
    `📊 Dashboard: ${DASHBOARD_URL}\n` +
    `💳 Credits checked every 6 hours (alert &lt; $${CREDIT_ALERT_THRESHOLD})`
  );

  // Credit check every 6 hours
  setInterval(async () => {
    await checkAndAlertCredits();
  }, CREDIT_CHECK_INTERVAL_MS);

  // Polling loop
  while (true) {
    try { await poll(); } catch (e: any) { log(`Poll error: ${e.message}`); }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});
