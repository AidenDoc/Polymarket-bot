/**
 * ====================================================
 *  KALSHI BOT â€” MASTER ORCHESTRATOR
 *  Runs the entire pipeline automatically
 * ====================================================
 *
 * How to run:
 *   npx ts-node src/bot.ts
 *
 * To stop: press Ctrl+C or create a STOP file
 * ====================================================
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as dotenv from "dotenv";

dotenv.config();

const SCAN_INTERVAL_MINUTES = 15;
const KILL_SWITCH_FILE = "STOP";
const LOG_FILE = "bot_log.json";
const PORT = 3001;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LOGGER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function log(message: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = level === "ERROR" ? "âŒ" : level === "WARN" ? "âš ï¸" : "âœ“";
  console.log("  [" + timestamp + "] " + prefix + " " + message);
  try {
    const logs = fs.existsSync(LOG_FILE)
      ? JSON.parse(fs.readFileSync(LOG_FILE, "utf-8"))
      : [];
    logs.push({ timestamp: new Date().toISOString(), level, message });
    if (logs.length > 500) logs.splice(0, logs.length - 500);
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch {}
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP RUNNER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function runStep(name: string, script: string): boolean {
  try {
    log("Running " + name + "...");
    execSync("npx ts-node src/" + script, {
      stdio: "pipe",
      timeout: 600000,
    });
    log(name + " complete");
    return true;
  } catch (e: any) {
    log(name + " failed: " + (e.message || "").slice(0, 100), "ERROR");
    return false;
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FULL PIPELINE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runPipeline(): Promise<void> {
  if (fs.existsSync(KILL_SWITCH_FILE)) {
    log("Kill switch active â€” pipeline halted", "WARN");
    return;
  }

  const start = Date.now();
  console.log("\n" + "â•".repeat(55));
  console.log("  PIPELINE RUN â€” " + new Date().toLocaleTimeString());
  console.log("â•".repeat(55));

  const steps = [
    { name: "Step 1: Whale Tracker", script: "whaleTracker.ts"  },
    { name: "Step 2: Scanner",       script: "marketScanner.ts" },
    { name: "Step 3: Research",      script: "researcher.ts"    },
    { name: "Step 4: Sentiment",     script: "sentiment.ts"     },
    { name: "Step 5: Predictor",     script: "predictor.ts"     },
    { name: "Step 6: Executor",      script: "executor.ts"      },
    { name: "Step 7: Closer",        script: "closer.ts"        },
  ];

  for (const step of steps) {
    runStep(step.name, step.script);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log("Pipeline finished in " + elapsed + "s");
  console.log("â•".repeat(55) + "\n");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MIDNIGHT COMPOUNDER (runs separately at midnight, not in pipeline)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function scheduleCompounder(): void {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();
  log("Compounder scheduled for midnight (in " + (msUntilMidnight / 3600000).toFixed(1) + "h)");
  setTimeout(() => {
    log("Running nightly compounder...");
    runStep("Compounder", "compounder.ts");
    scheduleCompounder();
  }, msUntilMidnight);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DATA LOADER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function loadJson(file: string): any {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {}
  return null;
}

function getApiData(): string {
  return JSON.stringify({
    whale:     loadJson("whale_signals.json"),
    scan:      loadJson("scan_results.json"),
    research:  loadJson("research_results.json"),
    sentiment: loadJson("sentiment_results.json"),
    predictor: loadJson("predictor_results.json"),
    portfolio: loadJson("portfolio.json"),
    metrics:   loadJson("performance_metrics.json"),
    openPos:   loadJson("open_positions.json"),
    brier:     loadJson("calibration_log.json"),
    kb:        loadJson("knowledge_base.json"),
    trades:    loadJson("trade_history.json"),
    execLog:   loadJson("execution_log.json"),
    botLog:    loadJson(LOG_FILE),
    timestamp: new Date().toISOString(),
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DASHBOARD HTML
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getDashboardHtml(): string {
  const paper = process.env.PAPER_TRADING !== "false";
  const modeCls  = paper ? "b-paper" : "b-live";
  const modeText = paper ? "PAPER"   : "LIVE";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Polymarket Bot</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;min-height:100vh}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0a0a0f}::-webkit-scrollbar-thumb{background:#2d2d5e;border-radius:2px}
.hdr{background:#0d0d1e;border-bottom:1px solid #1a1a3e;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.hdr-l{display:flex;align-items:center;gap:14px}
.logo{width:38px;height:38px;background:linear-gradient(135deg,#7c3aed,#3b82f6);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.hdr-title{font-size:17px;font-weight:700;color:#f8fafc;letter-spacing:.3px}
.hdr-sub{font-size:11px;color:#3a3a6a;margin-top:1px}
.hdr-r{display:flex;align-items:center;gap:10px}
.dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 8px #22c55e80;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.upd{font-size:11px;color:#3a3a6a}
.badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.3px}
.b-live{background:#0a2e1a;color:#4ade80;border:1px solid #166534}
.b-paper{background:#1a1040;color:#a78bfa;border:1px solid #4c1d95}
.b-yes{background:#0a2e1a;color:#4ade80}.b-no{background:#2e0a0a;color:#f87171}
.b-win{background:#0a2e1a;color:#4ade80}.b-loss{background:#2e0a0a;color:#f87171}.b-push{background:#1a1a3e;color:#94a3b8}
.b-blue{background:#0a1e3e;color:#60a5fa}.b-whale{background:#1a0a3e;color:#a78bfa}
.btn{background:#111128;border:1px solid #2d2d5e;color:#818cf8;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:11px;font-family:inherit;transition:background .15s}
.btn:hover{background:#1a1a4e}
.btn-red{border-color:#4a1010;color:#f87171}.btn-red:hover{background:#2a0a0a}
.btn-green{border-color:#0a3a1a;color:#4ade80}.btn-green:hover{background:#0a2a0a}
.pipe-wrap{background:#0d0d1e;border-bottom:1px solid #1a1a3e;padding:14px 24px;overflow-x:auto}
.pipe{display:flex;align-items:center;gap:0;min-width:max-content}
.pstep{display:flex;flex-direction:column;align-items:center;padding:8px 16px;border-radius:10px;background:#111128;border:1px solid #1a1a3e;min-width:82px;transition:all .3s}
.pstep.done{border-color:#7c3aed40;background:#18102e;box-shadow:0 0 12px #7c3aed18}
.pstep.done .pnum{color:#7c3aed}.pstep.done .pname{color:#c4b5fd}.pstep.done .pchk{color:#22c55e}
.pnum{font-size:10px;color:#3a3a6a;font-weight:700;letter-spacing:.5px;font-family:'SF Mono',monospace}
.pname{font-size:11px;font-weight:600;color:#4a4a8a;margin-top:2px}
.pchk{font-size:11px;margin-top:3px;color:#2d2d5e}
.parr{color:#2d2d5e;font-size:16px;padding:0 6px;flex-shrink:0}
.main{padding:20px 24px;max-width:1600px;margin:0 auto}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px}
.g2{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:14px}
.g1{margin-bottom:14px}
@media(max-width:1100px){.g4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:700px){.g4,.g2{grid-template-columns:1fr}}
.card{background:#111128;border:1px solid #1a1a3e;border-radius:12px;padding:16px}
.ct{font-size:10px;font-weight:700;color:#3a3a6a;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:8px}
.mv{font-size:26px;font-weight:700;font-family:'SF Mono',Menlo,monospace;color:#f8fafc;line-height:1}
.ms{font-size:11px;color:#3a3a6a;margin-top:5px}
.pb{height:3px;background:#1a1a3e;border-radius:2px;overflow:hidden;margin-top:8px}
.pf{height:100%;border-radius:2px;transition:width .6s ease}
.cdown{font-size:24px;font-weight:700;font-family:'SF Mono',Menlo,monospace;color:#7c3aed;line-height:1}
.sec{font-size:10px;font-weight:800;color:#7c3aed;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;display:flex;align-items:center;gap:10px}
.sec::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,#2d2d5e,transparent)}
.pos{color:#22c55e}.neg{color:#ef4444}.wrn{color:#f59e0b}.muted{color:#3a3a6a}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:10px;font-weight:700;color:#3a3a6a;text-transform:uppercase;letter-spacing:.5px;padding:8px 10px;border-bottom:1px solid #1a1a3e}
td{padding:9px 10px;border-bottom:1px solid #0f0f24;font-size:12px;color:#cbd5e1;vertical-align:top}
tr:hover td{background:#0f0f1e}tr:last-child td{border-bottom:none}
.row{padding:11px 12px;border-bottom:1px solid #0f0f24;transition:background .1s}
.row:last-child{border-bottom:none}.row:hover{background:#0f0f1e}
.row-h{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:5px}
.row-q{font-size:12px;color:#e2e8f0;font-weight:500;line-height:1.4;flex:1}
.row-meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:4px}
.ml{font-size:10px;color:#3a3a6a;text-transform:uppercase;letter-spacing:.4px}
.mv2{font-size:11px;color:#cbd5e1;font-family:'SF Mono',monospace;font-weight:600}
.wallet{font-size:10px;color:#7c3aed;font-family:'SF Mono',monospace}
.scroll{max-height:320px;overflow-y:auto}
.scroll::-webkit-scrollbar{width:3px}.scroll::-webkit-scrollbar-thumb{background:#2d2d5e;border-radius:2px}
.empty{text-align:center;padding:28px;color:#3a3a6a;font-size:12px;font-style:italic}
.log-item{padding:5px 10px;border-bottom:1px solid #0f0f24;font-size:11px;font-family:'SF Mono',monospace}
.lI{color:#4a4a8a}.lW{color:#f59e0b}.lE{color:#ef4444}
</style>
</head>
<body>

<header class="hdr">
  <div class="hdr-l">
    <div class="logo">â¬¡</div>
    <div>
      <div class="hdr-title">POLYMARKET BOT</div>
      <div class="hdr-sub">Fully Automated Pipeline Â· Polygon Network</div>
    </div>
    <span class="badge ${modeCls}">${modeText}</span>
  </div>
  <div class="hdr-r">
    <div class="dot" id="dot"></div>
    <span class="upd" id="upd">Loading...</span>
    <button class="btn btn-red" onclick="stopBot()">Stop</button>
    <button class="btn btn-green" onclick="resumeBot()">Resume</button>
    <button class="btn" onclick="loadData()">Refresh</button>
  </div>
</header>

<div class="pipe-wrap">
  <div class="pipe">
    <div class="pstep" id="p1"><div class="pnum">01</div><div class="pname">Whales</div><div class="pchk" id="s1">â—‹</div></div>
    <div class="parr">â€º</div>
    <div class="pstep" id="p2"><div class="pnum">02</div><div class="pname">Scanner</div><div class="pchk" id="s2">â—‹</div></div>
    <div class="parr">â€º</div>
    <div class="pstep" id="p3"><div class="pnum">03</div><div class="pname">Research</div><div class="pchk" id="s3">â—‹</div></div>
    <div class="parr">â€º</div>
    <div class="pstep" id="p4"><div class="pnum">04</div><div class="pname">Sentiment</div><div class="pchk" id="s4">â—‹</div></div>
    <div class="parr">â€º</div>
    <div class="pstep" id="p5"><div class="pnum">05</div><div class="pname">Predictor</div><div class="pchk" id="s5">â—‹</div></div>
    <div class="parr">â€º</div>
    <div class="pstep" id="p6"><div class="pnum">06</div><div class="pname">Executor</div><div class="pchk" id="s6">â—‹</div></div>
    <div class="parr">â€º</div>
    <div class="pstep" id="p7"><div class="pnum">07</div><div class="pname">Closer</div><div class="pchk" id="s7">â—‹</div></div>
  </div>
</div>

<div class="main">

  <div class="g4">
    <div class="card"><div class="ct">Bankroll</div><div class="mv" id="bnk">â€”</div><div class="ms" id="roi">â€”</div></div>
    <div class="card"><div class="ct">Total P&amp;L</div><div class="mv" id="pnl">â€”</div><div class="ms" id="dpnl">Daily: â€”</div></div>
    <div class="card"><div class="ct">Win Rate</div><div class="mv" id="wr">â€”</div><div class="ms" id="wl">â€”W / â€”L</div></div>
    <div class="card"><div class="ct">Open Positions</div><div class="mv" id="op">â€”</div><div class="ms">Max: 15</div></div>
  </div>

  <div class="g4">
    <div class="card"><div class="ct">Sharpe Ratio</div><div class="mv" id="sh">â€”</div><div class="ms">Target: 2.0+</div><div class="pb"><div class="pf" id="shb" style="background:#7c3aed;width:0%"></div></div></div>
    <div class="card"><div class="ct">Max Drawdown</div><div class="mv" id="dd">â€”</div><div class="ms">Limit: 8%</div><div class="pb"><div class="pf" id="ddb" style="background:#ef4444;width:0%"></div></div></div>
    <div class="card"><div class="ct">Profit Factor</div><div class="mv" id="pf">â€”</div><div class="ms">Target: 1.5+</div><div class="pb"><div class="pf" id="pfb" style="background:#22c55e;width:0%"></div></div></div>
    <div class="card"><div class="ct">Next Run</div><div class="cdown" id="cd">â€”</div><div class="ms">Every 15 min Â· Brier: <span id="brier" class="muted">â€”</span></div></div>
  </div>

  <div class="g2">
    <div>
      <div class="sec">ðŸ³ Whale Signals</div>
      <div class="card scroll" id="whale-panel"><div class="empty">No whale activity detected</div></div>
    </div>
    <div>
      <div class="sec">âš¡ Active Signals</div>
      <div id="sigs-panel"><div class="empty">No signals yet</div></div>
    </div>
  </div>

  <div class="g2">
    <div>
      <div class="sec">ðŸ“‚ Open Positions</div>
      <div class="card scroll" id="pos-panel"><div class="empty">No open positions</div></div>
    </div>
    <div>
      <div class="sec">ðŸ“Š Top Markets</div>
      <div class="card"><div class="scroll"><table>
        <thead><tr><th>#</th><th>Market</th><th>Vol 24h</th><th>Liquidity</th><th>Spread</th><th>Score</th></tr></thead>
        <tbody id="mkt-body"><tr><td colspan="6" class="empty">Run scanner to populate</td></tr></tbody>
      </table></div></div>
    </div>
  </div>

  <div class="g1">
    <div class="sec">ðŸ”¬ Research Briefs</div>
    <div class="card"><div class="scroll"><table>
      <thead><tr><th>#</th><th>Market</th><th>Market %</th><th>AI Est %</th><th>Edge</th><th>Recommendation</th></tr></thead>
      <tbody id="research-body"><tr><td colspan="6" class="empty">Run researcher to populate</td></tr></tbody>
    </table></div></div>
  </div>

  <div class="g2">
    <div>
      <div class="sec">ðŸ“‹ Trade History</div>
      <div class="card"><div class="scroll"><table>
        <thead><tr><th>Market</th><th>Action</th><th>Entry</th><th>P&amp;L</th><th>Result</th></tr></thead>
        <tbody id="trades-body"><tr><td colspan="5" class="empty">No closed trades yet</td></tr></tbody>
      </table></div></div>
    </div>
    <div>
      <div class="sec">ðŸ“œ Bot Activity Log</div>
      <div class="card scroll" id="log-panel"><div class="empty">Waiting...</div></div>
    </div>
  </div>

  <div class="g1">
    <div class="sec">ðŸ§  Knowledge Base</div>
    <div class="card">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
        <div style="text-align:center;padding:12px;background:#0d0d1e;border-radius:8px"><div style="font-size:22px;font-weight:700;font-family:monospace" id="kbl">0</div><div style="font-size:10px;color:#3a3a6a;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Lessons</div></div>
        <div style="text-align:center;padding:12px;background:#0d0d1e;border-radius:8px"><div style="font-size:22px;font-weight:700;font-family:monospace;color:#ef4444" id="kbb">0</div><div style="font-size:10px;color:#3a3a6a;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Blacklisted</div></div>
        <div style="text-align:center;padding:12px;background:#0d0d1e;border-radius:8px"><div style="font-size:22px;font-weight:700;font-family:monospace;color:#22c55e" id="kbp">0</div><div style="font-size:10px;color:#3a3a6a;text-transform:uppercase;letter-spacing:1px;margin-top:4px">Patterns</div></div>
      </div>
      <div class="scroll" id="kb-items"><div class="empty">Run overnight to populate</div></div>
    </div>
  </div>

</div>
<script>
var data={};var nrt=Date.now()+15*60*1000;
async function loadData(){try{var r=await fetch('/api/data');data=await r.json();renderAll();document.getElementById('upd').textContent='Updated '+new Date().toLocaleTimeString();}catch(e){}}
async function stopBot(){await fetch('/api/stop');var d=document.getElementById('dot');d.style.background='#ef4444';d.style.boxShadow='0 0 8px #ef444480';alert('Kill switch activated.');}
async function resumeBot(){await fetch('/api/resume');var d=document.getElementById('dot');d.style.background='#22c55e';d.style.boxShadow='0 0 8px #22c55e80';alert('Trading resumed.');}
function renderAll(){rPipe();rMetrics();rWhale();rSigs();rPos();rMkts();rResearch();rTrades();rKB();rLog();}
function rPipe(){var keys=[data.whale,data.scan,data.research,data.sentiment,data.predictor,data.execLog,data.metrics];for(var i=0;i<7;i++){var el=document.getElementById('p'+(i+1));var st=document.getElementById('s'+(i+1));if(keys[i]){el.className='pstep done';st.textContent='âœ“';}else{el.className='pstep';st.textContent='â—‹';}}}
function rMetrics(){var p=data.portfolio;var m=data.metrics;if(p){var roi=((p.bankroll-p.startingBankroll)/p.startingBankroll*100)||0;var tot=(p.winCount||0)+(p.lossCount||0);var wr=tot>0?(p.winCount/tot*100):0;document.getElementById('bnk').textContent='$'+(p.bankroll||0).toFixed(2);document.getElementById('roi').textContent=(roi>=0?'+':'')+roi.toFixed(1)+'% ROI';document.getElementById('pnl').textContent=(p.totalPnl>=0?'+':'')+'$'+(p.totalPnl||0).toFixed(2);document.getElementById('pnl').className='mv '+(p.totalPnl>=0?'pos':'neg');document.getElementById('dpnl').textContent='Daily: '+(p.dailyPnl>=0?'+':'')+'$'+(p.dailyPnl||0).toFixed(2);document.getElementById('wr').textContent=wr.toFixed(1)+'%';document.getElementById('wr').className='mv '+(wr>=60?'pos':wr>=50?'wrn':'neg');document.getElementById('wl').textContent=(p.winCount||0)+'W / '+(p.lossCount||0)+'L';var op=p.openPositions||(data.openPos||[]).length;document.getElementById('op').textContent=op+'/15';document.getElementById('op').className='mv '+(op>=15?'neg':'pos');}if(m){document.getElementById('sh').textContent=(m.sharpeRatio||0).toFixed(2);document.getElementById('sh').className='mv '+(m.sharpeRatio>=2?'pos':m.sharpeRatio>=1?'wrn':'neg');document.getElementById('shb').style.width=Math.min((m.sharpeRatio||0)/3*100,100)+'%';document.getElementById('dd').textContent=(m.maxDrawdown||0).toFixed(1)+'%';document.getElementById('dd').className='mv '+(m.maxDrawdown<=8?'pos':m.maxDrawdown<=15?'wrn':'neg');document.getElementById('ddb').style.width=Math.min((m.maxDrawdown||0)/20*100,100)+'%';document.getElementById('pf').textContent=(m.profitFactor||0).toFixed(2);document.getElementById('pf').className='mv '+(m.profitFactor>=1.5?'pos':m.profitFactor>=1?'wrn':'neg');document.getElementById('pfb').style.width=Math.min((m.profitFactor||0)/3*100,100)+'%';}var b=data.brier;if(b&&Array.isArray(b)){var res=b.filter(function(r){return r.outcome!==undefined;});if(res.length>0){var bs=res.reduce(function(s,r){return s+Math.pow((r.predictedProbability||50)/100-(r.outcome||0),2);},0)/res.length;var bel=document.getElementById('brier');bel.textContent=bs.toFixed(4);bel.className=bs<0.2?'pos':bs<0.25?'wrn':'neg';}}}
function rWhale(){var el=document.getElementById('whale-panel');var sigs=Array.isArray(data.whale)?data.whale:((data.whale&&data.whale.signals)?data.whale.signals:[]);if(!sigs.length){el.innerHTML='<div class="empty">No whale activity detected</div>';return;}el.innerHTML=sigs.slice(-20).reverse().map(function(w){var sz=(w.usdcSize||0).toLocaleString('en-US',{maximumFractionDigits:0});var ts=w.timestamp?new Date(w.timestamp).toLocaleTimeString():'â€”';var oc=(w.outcome||'').toLowerCase()==='yes'?'b-yes':'b-no';var wallet=(w.walletAddress||'').slice(0,6)+'...'+(w.walletAddress||'').slice(-4);return '<div class="row"><div class="row-h"><span class="wallet">ðŸ³ '+wallet+'</span><span class="badge '+oc+'">'+(w.outcome||'?').toUpperCase()+'</span></div><div class="row-q">'+(w.question||w.conditionId||'').slice(0,65)+'</div><div class="row-meta"><span><span class="ml">Size </span><span class="mv2 pos">$'+sz+'</span></span><span><span class="ml">Price </span><span class="mv2">'+((w.price||0).toFixed?((w.price||0).toFixed(3)):'â€”')+'</span></span><span><span class="ml">Time </span><span class="mv2 muted">'+ts+'</span></span></div></div>';}).join('');}
function rSigs(){var el=document.getElementById('sigs-panel');if(!data.predictor||!data.predictor.signals){el.innerHTML='<div class="empty">No signals yet</div>';return;}var sigs=data.predictor.signals.filter(function(s){return s.action!=='PASS';}).slice(0,6);if(!sigs.length){el.innerHTML='<div class="empty">No actionable signals this cycle</div>';return;}el.innerHTML=sigs.map(function(s){var isBuy=s.action==='BUY_YES';var edge=s.edge?(s.edge>0?'+':'')+s.edge.toFixed(1)+'%':'â€”';var whale=(s.whaleContext&&s.whaleContext.netBias!=='NONE')?' <span class="badge b-whale">ðŸ³ '+s.whaleContext.netBias+'</span>':'';return '<div class="row"><div class="row-h"><span class="badge '+(isBuy?'b-yes':'b-no')+'">'+s.action+'</span>'+whale+'</div><div class="row-q">'+(s.question||s.conditionId||'').slice(0,85)+'</div><div class="row-meta"><span><span class="ml">Market </span><span class="mv2">'+(s.marketImpliedProb||0).toFixed(1)+'%</span></span><span><span class="ml">AI Est </span><span class="mv2 '+(s.edge>0?'pos':'neg')+'">'+(s.ensembleProbability||0).toFixed(1)+'%</span></span><span><span class="ml">Edge </span><span class="mv2 '+(s.edge>0?'pos':'neg')+'">'+edge+'</span></span><span><span class="ml">Conf </span><span class="mv2">'+((s.confidence||0)*100).toFixed(0)+'%</span></span><span><span class="ml">Size </span><span class="mv2">$'+(s.suggestedPositionSize||0)+'</span></span></div></div>';}).join('');}
function rPos(){var el=document.getElementById('pos-panel');var pos=Array.isArray(data.openPos)?data.openPos:[];if(!pos.length){el.innerHTML='<div class="empty">No open positions</div>';return;}el.innerHTML=pos.map(function(p){return '<div class="row"><div class="row-h"><span class="badge '+(p.action==='BUY_YES'?'b-yes':'b-no')+'">'+p.action+'</span>'+(p.paper?'<span class="badge b-paper" style="margin-left:4px">PAPER</span>':'')+'</div><div class="row-q">'+(p.question||p.conditionId||'').slice(0,80)+'</div><div class="row-meta"><span><span class="ml">Entry </span><span class="mv2">$'+(p.price||0).toFixed(4)+'</span></span><span><span class="ml">Size </span><span class="mv2">$'+(p.sizeUsdc||0).toFixed(2)+'</span></span><span><span class="ml">Opened </span><span class="mv2 muted">'+(p.openedAt?new Date(p.openedAt).toLocaleTimeString():'â€”')+'</span></span></div></div>';}).join('');}
function rMkts(){var tbody=document.getElementById('mkt-body');if(!data.scan||!data.scan.markets){tbody.innerHTML='<tr><td colspan="6" class="empty">Waiting for scanner</td></tr>';return;}tbody.innerHTML=data.scan.markets.slice(0,15).map(function(m,i){var vol=(m.volume24hr||0).toLocaleString('en-US',{maximumFractionDigits:0});var liq=(m.liquidityNum||0).toLocaleString('en-US',{maximumFractionDigits:0});var spr=((m.spread||0)*100).toFixed(1)+'%';return '<tr><td class="muted">'+(i+1)+'</td><td style="color:#c4b5fd;font-size:11px">'+(m.question||'').slice(0,55)+'</td><td>$'+vol+'</td><td>$'+liq+'</td><td class="'+(m.spread<0.03?'pos':m.spread<0.07?'wrn':'neg')+'">'+spr+'</td><td><span class="badge b-blue">'+(m.score||0).toFixed(3)+'</span></td></tr>';}).join('');}
function rResearch(){var tbody=document.getElementById('research-body');var briefs=(data.research&&data.research.briefs)?data.research.briefs:[];if(!briefs.length){tbody.innerHTML='<tr><td colspan="6" class="empty">Run researcher to populate</td></tr>';return;}tbody.innerHTML=briefs.slice(0,12).map(function(b,i){var edge=b.edge||0;var ep=(edge>0?'+':'')+edge.toFixed(1)+'%';var mkt=((b.marketImpliedProbability||b.marketPrice*100)||0).toFixed(1)+'%';var ai=(b.aiEstimatedProbability||0).toFixed(1)+'%';return '<tr><td class="muted">'+(i+1)+'</td><td style="color:#c4b5fd;font-size:11px">'+(b.question||'').slice(0,52)+'</td><td style="font-family:monospace">'+mkt+'</td><td style="font-family:monospace;color:'+(edge>0?'#22c55e':'#60a5fa')+'">'+ai+'</td><td class="'+(edge>5?'pos':edge<-5?'neg':'wrn')+'" style="font-family:monospace">'+ep+'</td><td style="font-size:11px;color:#94a3b8">'+(b.recommendation||'â€”').slice(0,32)+'</td></tr>';}).join('');}
function rTrades(){var tbody=document.getElementById('trades-body');var trades=Array.isArray(data.trades)?data.trades.filter(function(t){return t.closedAt!==undefined;}):[]; if(!trades.length){tbody.innerHTML='<tr><td colspan="5" class="empty">No closed trades yet</td></tr>';return;}tbody.innerHTML=trades.slice(-12).reverse().map(function(t){var pnl=t.pnl||0;var res=t.outcome||(pnl>=0?'WIN':'LOSS');var rcls=res==='WIN'?'b-win':res==='LOSS'?'b-loss':'b-push';return '<tr><td style="font-size:11px;color:#c4b5fd">'+(t.question||t.conditionId||'').slice(0,45)+'</td><td><span class="badge '+(t.action==='BUY_YES'?'b-yes':'b-no')+'">'+(t.action||'â€”')+'</span></td><td style="font-family:monospace">$'+(t.price||t.entryPrice||0).toFixed(4)+'</td><td style="font-family:monospace" class="'+(pnl>=0?'pos':'neg')+'">'+(pnl>=0?'+':'')+'$'+pnl.toFixed(2)+'</td><td><span class="badge '+rcls+'">'+res+'</span></td></tr>';}).join('');}
function rKB(){var kb=data.kb;if(!kb)return;document.getElementById('kbl').textContent=kb.totalLessons||0;document.getElementById('kbb').textContent=(kb.marketBlacklist||[]).length;document.getElementById('kbp').textContent=(kb.successPatterns||[]).length;var el=document.getElementById('kb-items');var items=[].concat((kb.avoidPatterns||[]).slice(-4).map(function(p){return '<div class="row"><span style="color:#ef4444;margin-right:8px">âœ—</span><span style="font-size:11px;color:#94a3b8">'+p+'</span></div>';}),(kb.successPatterns||[]).slice(-4).map(function(p){return '<div class="row"><span style="color:#22c55e;margin-right:8px">âœ“</span><span style="font-size:11px;color:#94a3b8">'+p+'</span></div>';}));el.innerHTML=items.length?items.join(''):'<div class="empty">Run overnight to populate</div>';}
function rLog(){var el=document.getElementById('log-panel');if(!data.botLog||!data.botLog.length){el.innerHTML='<div class="empty">No activity yet</div>';return;}el.innerHTML=data.botLog.slice(-30).reverse().map(function(l){return '<div class="log-item l'+l.level+'"><span class="muted">'+new Date(l.timestamp).toLocaleTimeString()+'</span><span style="margin-left:8px">'+l.message+'</span></div>';}).join('');}
function updateCountdown(){var rem=Math.max(0,nrt-Date.now());var mins=Math.floor(rem/60000);var secs=Math.floor((rem%60000)/1000);document.getElementById('cd').textContent=mins+':'+(secs<10?'0':'')+secs;if(rem===0){nrt=Date.now()+15*60*1000;loadData();}}
loadData();setInterval(loadData,30000);setInterval(updateCountdown,1000);
</script>
</body>
</html>`;
}



// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DASHBOARD SERVER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function startDashboard(): void {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/data") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(getApiData());
      return;
    }
    if (req.url === "/api/stop") {
      fs.writeFileSync(KILL_SWITCH_FILE, "stop");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Kill switch activated" }));
      log("Kill switch activated via dashboard", "WARN");
      return;
    }
    if (req.url === "/api/resume") {
      if (fs.existsSync(KILL_SWITCH_FILE)) fs.unlinkSync(KILL_SWITCH_FILE);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Trading resumed" }));
      log("Trading resumed via dashboard");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(getDashboardHtml());
  });

  server.listen(PORT, () => {
    log("Dashboard live at http://localhost:" + PORT);
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MAIN
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main(): Promise<void> {
  console.log("\n" + "â•".repeat(55));
  console.log("  KALSHI BOT â€” MASTER ORCHESTRATOR");
  console.log("â•".repeat(55));
  console.log("  Mode: " + (process.env.PAPER_TRADING === "false" ? "LIVE" : "PAPER"));
  console.log("  Interval: every " + SCAN_INTERVAL_MINUTES + " minutes");
  console.log("  Dashboard: http://localhost:" + PORT);
  console.log("  Kill switch: create a STOP file to halt");
  console.log("â•".repeat(55) + "\n");

  startDashboard();
  scheduleCompounder();

  await runPipeline();

  setInterval(async () => {
    await runPipeline();
  }, SCAN_INTERVAL_MINUTES * 60 * 1000);
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});
