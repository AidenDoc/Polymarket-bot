/**
 * ============================================================
 *  KALSHI BOT — TELEGRAM COMMAND CENTER
 *  Two-way Telegram bot: ask questions, get human-readable
 *  responses, control the bot from your phone.
 * ============================================================
 */

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import { execSync } from "child_process";
import * as dotenv from "dotenv";

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const POLL_INTERVAL_MS = 2000;
const BOT_LOG = path.join(process.env.HOME || "/root", ".pm2/logs/kalshi-bot-out.log");

let lastUpdateId = 0;

// ─── HELPERS ───────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] [TELEGRAM] ${msg}`);
}

function loadJson(file: string): any {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { return null; }
}

function readLog(filePath: string, lines = 30): string {
  try {
    if (!fs.existsSync(filePath)) return "No log file found.";
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").slice(-lines).filter(Boolean).join("\n");
  } catch { return "Could not read log."; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── TELEGRAM API ──────────────────────────────────────────

function telegramRequest(method: string, body: object): Promise<any> {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_TOKEN}/${method}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => raw += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.write(data);
    req.end();
  });
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  });
}

async function getUpdates(): Promise<any[]> {
  const result = await telegramRequest("getUpdates", {
    offset: lastUpdateId + 1,
    timeout: 10,
    limit: 10,
  });
  if (!result?.ok) return [];
  return result.result || [];
}

// ─── DATA FORMATTERS ───────────────────────────────────────

function formatPositions(): string {
  const portfolio = loadJson("/root/Kalshi-bot/portfolio.json");
  if (!portfolio) return "❌ Could not load portfolio data.";

  const open = (portfolio.positions || []).filter((p: any) => p.status === "OPEN");
  if (open.length === 0) return "📂 <b>No open positions right now.</b>";

  let msg = `📂 <b>OPEN POSITIONS (${open.length})</b>\n`;
  msg += `💰 Bankroll: $${(portfolio.bankroll || 0).toFixed(2)}\n`;
  msg += `💵 Cash Available: $${(portfolio.cashAvailable || 0).toFixed(2)}\n\n`;

  for (const p of open) {
    const contracts = p.contracts || 0;
    const entryPrice = p.entryPrice || 0;
    const costBasis = p.costBasis || 0;
    const payoutIfWin = contracts * 1.0;
    const payoutIfLose = 0;
    const potentialProfit = payoutIfWin - costBasis;

    msg += `──────────────────\n`;
    msg += `📌 <b>${p.action || "BUY_YES"}</b>\n`;
    msg += `📊 ${(p.title || p.ticker || "Unknown").slice(0, 50)}\n`;
    msg += `🎯 Contracts: ${contracts.toLocaleString()}\n`;
    msg += `💵 Entry Price: $${entryPrice.toFixed(4)}\n`;
    msg += `💸 Cost Basis: $${costBasis.toFixed(2)}\n`;
    msg += `✅ Payout if WIN: $${payoutIfWin.toFixed(2)}\n`;
    msg += `❌ Payout if LOSE: $0.00\n`;
    msg += `📈 Potential Profit: +$${potentialProfit.toFixed(2)}\n`;
    msg += `📅 Opened: ${new Date(p.openedAt || Date.now()).toLocaleString()}\n`;
  }

  return msg;
}

function formatStatus(): string {
  const portfolio = loadJson("/root/Kalshi-bot/portfolio.json");
  const metrics = loadJson("/root/Kalshi-bot/performance_metrics.json");
  const lastMetric = metrics ? metrics[metrics.length - 1] : null;

  const bankroll = portfolio?.bankroll || 1000;
  const startingBankroll = portfolio?.startingBankroll || 1000;
  const totalPnl = portfolio?.totalPnl || 0;
  const roi = ((bankroll - startingBankroll) / startingBankroll * 100).toFixed(2);
  const winCount = portfolio?.winCount || 0;
  const lossCount = portfolio?.lossCount || 0;
  const total = winCount + lossCount;
  const winRate = total > 0 ? ((winCount / total) * 100).toFixed(1) : "0.0";
  const openPositions = (portfolio?.positions || []).filter((p: any) => p.status === "OPEN").length;

  let msg = `📊 <b>BOT STATUS</b>\n\n`;
  msg += `💰 Bankroll: $${bankroll.toFixed(2)}\n`;
  msg += `📈 Total P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}\n`;
  msg += `📊 ROI: ${Number(roi) >= 0 ? "+" : ""}${roi}%\n`;
  msg += `🏆 Win Rate: ${winRate}% (${winCount}W / ${lossCount}L)\n`;
  msg += `📂 Open Positions: ${openPositions}\n`;

  if (lastMetric) {
    msg += `\n📉 Sharpe Ratio: ${(lastMetric.sharpeRatio || 0).toFixed(2)}\n`;
    msg += `📉 Max Drawdown: ${(lastMetric.maxDrawdown || 0).toFixed(1)}%\n`;
    msg += `📊 Profit Factor: ${(lastMetric.profitFactor || 0).toFixed(2)}\n`;
  }

  // PM2 process status
  try {
    const pm2 = execSync("pm2 jlist", { encoding: "utf-8" });
    const processes = JSON.parse(pm2);
    msg += `\n🤖 <b>Processes:</b>\n`;
    for (const p of processes) {
      if (["kalshi-bot", "kalshi-dashboard", "kalshi-guardian", "kalshi-telegram"].includes(p.name)) {
        const status = p.pm2_env?.status === "online" ? "🟢" : "🔴";
        const mem = Math.round((p.monit?.memory || 0) / 1024 / 1024);
        msg += `${status} ${p.name} (${mem}mb, ${p.pm2_env?.restart_time || 0} restarts)\n`;
      }
    }
  } catch {}

  msg += `\n🕐 Last updated: ${new Date().toLocaleTimeString()}`;
  return msg;
}

function formatTrades(): string {
  const trades = loadJson("/root/Kalshi-bot/trade_log.json");
  if (!trades || !trades.length) return "📋 <b>No closed trades yet.</b>\nThe bot is still in paper trading mode finding opportunities.";

  const recent = trades.slice(-5).reverse();
  let msg = `📋 <b>RECENT TRADES (last ${recent.length})</b>\n\n`;

  for (const t of recent) {
    const pnl = t.pnl || 0;
    const emoji = pnl >= 0 ? "✅" : "❌";
    msg += `${emoji} <b>${t.action || "BUY_YES"}</b>\n`;
    msg += `📊 ${(t.ticker || "Unknown").slice(0, 45)}\n`;
    msg += `💵 Entry: $${(t.entryPrice || 0).toFixed(4)}\n`;
    msg += `💰 P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}\n`;
    msg += `🏁 Result: ${pnl >= 0 ? "WIN" : "LOSS"}\n\n`;
  }

  const totalPnl = trades.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
  msg += `──────────────────\n`;
  msg += `💰 Total P&L: ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`;
  return msg;
}

function formatSignals(): string {
  const signals = loadJson("/root/Kalshi-bot/signal_results.json");
  if (!signals) return "📡 <b>No signals yet.</b> Wait for next pipeline run.";

  const actionable = (signals.signals || []).filter((s: any) => s.action !== "PASS");
  const all = signals.signals || [];

  let msg = `📡 <b>LATEST SIGNALS</b>\n`;
  msg += `🕐 ${new Date(signals.timestamp || Date.now()).toLocaleString()}\n`;
  msg += `📊 Total: ${signals.totalSignals || 0} | Actionable: ${signals.actionable || 0}\n\n`;

  if (actionable.length === 0) {
    msg += `⏳ No actionable signals this cycle.\n`;
    msg += `All ${all.length} markets PASSED (edge too low or confidence too low)\n\n`;
    msg += `Top market analyzed:\n`;
    if (all[0]) {
      msg += `📌 ${(all[0].title || all[0].ticker || "").slice(0, 50)}\n`;
      msg += `Edge: ${(all[0].edge || 0).toFixed(3)} | Conf: ${((all[0].confidence || 0) * 100).toFixed(0)}%`;
    }
  } else {
    for (const s of actionable.slice(0, 3)) {
      const emoji = s.action === "BUY_YES" ? "🟢" : "🔴";
      msg += `${emoji} <b>${s.action}</b>\n`;
      msg += `📊 ${(s.title || s.ticker || "").slice(0, 50)}\n`;
      msg += `Edge: ${(s.edge || 0).toFixed(3)} | Conf: ${((s.confidence || 0) * 100).toFixed(0)}%\n`;
      msg += `Market: ${(s.marketImpliedProb || 0).toFixed(1)}% → AI: ${(s.ensembleProbability || 0).toFixed(1)}%\n\n`;
    }
  }

  return msg;
}

function formatLogs(): string {
  const raw = readLog(BOT_LOG, 25);
  const lines = raw.split("\n")
    .filter(l => l.includes("kalshi-bot"))
    .map(l => l.replace(/^.*kalshi-bot\s*\|\s*/, "").trim())
    .filter(Boolean)
    .slice(-15);

  let msg = `📜 <b>RECENT BOT LOGS</b>\n\n`;
  msg += `<code>${lines.join("\n")}</code>`;
  return msg;
}

// ─── CLAUDE NLP ────────────────────────────────────────────

async function classifyIntent(message: string): Promise<string> {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      messages: [{
        role: "user",
        content: `Classify this message into exactly one of these intents:
STATUS, POSITIONS, TRADES, SIGNALS, LOGS, RESTART, STOP, RESUME, HELP

Message: "${message}"

Reply with only the intent word, nothing else.`,
      }],
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
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const intent = parsed.content?.[0]?.text?.trim().toUpperCase() || "HELP";
          resolve(intent);
        } catch { resolve("HELP"); }
      });
    });
    req.on("error", () => resolve("HELP"));
    req.write(body);
    req.end();
  });
}

// ─── COMMAND HANDLER ───────────────────────────────────────

async function handleMessage(chatId: string, text: string): Promise<void> {
  const msg = text.trim().toLowerCase();

  // Quick slash command shortcuts (no Claude API needed)
  if (msg === "/status" || msg === "/start")     return sendMessage(chatId, formatStatus());
  if (msg === "/positions")                       return sendMessage(chatId, formatPositions());
  if (msg === "/trades")                          return sendMessage(chatId, formatTrades());
  if (msg === "/signals")                         return sendMessage(chatId, formatSignals());
  if (msg === "/logs")                            return sendMessage(chatId, formatLogs());
  if (msg === "/help") {
    return sendMessage(chatId,
      `🤖 <b>KALSHI BOT COMMANDS</b>\n\n` +
      `You can type naturally or use shortcuts:\n\n` +
      `📊 <b>Info:</b>\n` +
      `/status — Bot health & P&amp;L\n` +
      `/positions — Open trades &amp; payouts\n` +
      `/trades — Recent trade history\n` +
      `/signals — Latest market signals\n` +
      `/logs — Recent bot activity\n\n` +
      `⚙️ <b>Control:</b>\n` +
      `/restart — Restart the bot\n` +
      `/stop — Activate kill switch\n` +
      `/resume — Deactivate kill switch\n\n` +
      `💬 Or just ask naturally:\n` +
      `"what are my open positions"\n` +
      `"how much have I made today"\n` +
      `"show me the latest signals"\n` +
      `"restart the bot"`
    );
  }

  if (msg === "/restart") {
    await sendMessage(chatId, "🔄 Restarting kalshi-bot...");
    try {
      execSync("pm2 restart kalshi-bot", { timeout: 15000 });
      await sendMessage(chatId, "✅ kalshi-bot restarted successfully.");
    } catch {
      await sendMessage(chatId, "❌ Failed to restart kalshi-bot.");
    }
    return;
  }

  if (msg === "/stop") {
    fs.writeFileSync("/root/Kalshi-bot/STOP", "stop");
    return sendMessage(chatId, "🛑 Kill switch activated. Bot will halt after current pipeline finishes.");
  }

  if (msg === "/resume") {
    if (fs.existsSync("/root/Kalshi-bot/STOP")) fs.unlinkSync("/root/Kalshi-bot/STOP");
    return sendMessage(chatId, "▶️ Kill switch deactivated. Bot will resume on next cycle.");
  }

  // Natural language — classify with Claude
  await sendMessage(chatId, "🤔 Let me check that for you...");
  const intent = await classifyIntent(text);
  log(`Intent classified: "${text}" → ${intent}`);

  switch (intent) {
    case "STATUS":    return sendMessage(chatId, formatStatus());
    case "POSITIONS": return sendMessage(chatId, formatPositions());
    case "TRADES":    return sendMessage(chatId, formatTrades());
    case "SIGNALS":   return sendMessage(chatId, formatSignals());
    case "LOGS":      return sendMessage(chatId, formatLogs());
    case "RESTART":
      await sendMessage(chatId, "🔄 Restarting kalshi-bot...");
      try {
        execSync("pm2 restart kalshi-bot", { timeout: 15000 });
        await sendMessage(chatId, "✅ kalshi-bot restarted successfully.");
      } catch {
        await sendMessage(chatId, "❌ Failed to restart.");
      }
      break;
    case "STOP":
      fs.writeFileSync("/root/Kalshi-bot/STOP", "stop");
      await sendMessage(chatId, "🛑 Kill switch activated.");
      break;
    case "RESUME":
      if (fs.existsSync("/root/Kalshi-bot/STOP")) fs.unlinkSync("/root/Kalshi-bot/STOP");
      await sendMessage(chatId, "▶️ Bot resumed.");
      break;
    default:
      await sendMessage(chatId,
        `I didn't quite understand that. Try:\n\n` +
        `"show my positions" • "bot status" • "recent trades"\n` +
        `"latest signals" • "restart bot" • /help`
      );
  }
}

// ─── POLLING LOOP ──────────────────────────────────────────

async function poll(): Promise<void> {
  const updates = await getUpdates();
  for (const update of updates) {
    lastUpdateId = update.update_id;
    const msg = update.message;
    if (!msg || !msg.text) continue;

    const chatId = String(msg.chat.id);
    const text = msg.text;

    log(`Message from ${chatId}: ${text}`);

    // Security: only respond to your chat ID
    if (chatId !== ALLOWED_CHAT_ID) {
      log(`Blocked message from unauthorized chat: ${chatId}`);
      await sendMessage(chatId, "⛔ Unauthorized. This bot is private.");
      continue;
    }

    try {
      await handleMessage(chatId, text);
    } catch (e: any) {
      log(`Error handling message: ${e.message}`);
      await sendMessage(chatId, "❌ Something went wrong. Check the logs.");
    }
  }
}

// ─── MAIN ──────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!TELEGRAM_TOKEN || !ALLOWED_CHAT_ID) {
    console.error("[ERROR] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in .env");
    process.exit(1);
  }

  log("=".repeat(55));
  log("  KALSHI TELEGRAM COMMAND CENTER STARTED");
  log(`  Polling every ${POLL_INTERVAL_MS / 1000}s`);
  log(`  Authorized chat: ${ALLOWED_CHAT_ID}`);
  log("=".repeat(55));

  // Send startup message
  await telegramRequest("sendMessage", {
    chat_id: ALLOWED_CHAT_ID,
    text:
      `🤖 <b>TELEGRAM COMMAND CENTER ONLINE</b>\n\n` +
      `You can now control your bot from here!\n\n` +
      `Type /help to see all commands, or just ask naturally:\n` +
      `"what are my open positions"\n` +
      `"how is the bot doing"\n` +
      `"show me recent trades"`,
    parse_mode: "HTML",
  });

  // Start polling
  while (true) {
    try {
      await poll();
    } catch (e: any) {
      log(`Poll error: ${e.message}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch(err => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});