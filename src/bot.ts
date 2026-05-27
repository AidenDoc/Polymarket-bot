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

const SCAN_INTERVAL_MINUTES = 120;
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
  const modeText = paper ? "PAPER" : "LIVE";
  const modeCls  = paper ? "badge-paper" : "badge-live";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Polymarket Bot</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#050508;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;min-height:100vh;line-height:1.5}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#050508}::-webkit-scrollbar-thumb{background:#1e1e3a;border-radius:3px}
.hdr{background:#08080f;border-bottom:1px solid #12121e;padding:0 28px;height:64px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.hdr-l{display:flex;align-items:center;gap:16px}
.logo{width:40px;height:40px;background:linear-gradient(135deg,#7c3aed,#4f46e5);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;box-shadow:0 0 24px #7c3aed30}
.app-name{font-size:18px;font-weight:800;color:#fff;letter-spacing:.4px}
.app-sub{font-size:11px;color:#3a3a6a;margin-top:1px}
.badge-live{background:#0a2e1a;color:#4ade80;border:1px solid #166534;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.5px}
.badge-paper{background:#1a0a40;color:#a78bfa;border:1px solid #4c1d95;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.5px}
.hdr-r{display:flex;align-items:center;gap:10px}
.sdot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 10px #22c55e80;animation:blink 2s infinite;flex-shrink:0}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.upd{font-size:12px;color:#2a2a4a}
.btn{background:#0c0c18;border:1px solid #1a1a30;color:#818cf8;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:500;transition:all .15s}
.btn:hover{background:#14143a;border-color:#2d2d5e}
.btn-stop{border-color:#3a0f0f;color:#f87171}.btn-stop:hover{background:#1e0808;border-color:#f87171}
.btn-go{border-color:#0f3a1a;color:#4ade80}.btn-go:hover{background:#0a2a14;border-color:#4ade80}
.pipe-wrap{background:#06060d;border-bottom:1px solid #0e0e1a;padding:14px 28px;overflow-x:auto}
.pipe{display:flex;align-items:center;min-width:max-content}
.pstep{display:flex;flex-direction:column;align-items:center;padding:10px 20px;border-radius:10px;background:#0d0d1a;border:1px solid #16162a;min-width:100px;transition:all .3s}
.pstep.done{border-color:#7c3aed50;background:#120a28;box-shadow:0 0 20px #7c3aed12}
.pstep.done .p-lbl{color:#c4b5fd}.pstep.done .p-chk{color:#22c55e}.pstep.done .p-num{color:#7c3aed}
.p-num{font-size:9px;color:#1e1e3a;font-weight:700;letter-spacing:1px;font-family:monospace}
.p-lbl{font-size:12px;font-weight:600;color:#2a2a4a;margin-top:3px;white-space:nowrap}
.p-chk{font-size:14px;margin-top:4px;color:#1a1a2e}
.parr{color:#1a1a2e;font-size:18px;padding:0 8px;flex-shrink:0}
.main{padding:24px 28px;max-width:1600px;margin:0 auto}
.col4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
.col2{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;margin-bottom:18px}
.col1{margin-bottom:18px}
@media(max-width:1100px){.col4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:700px){.col4,.col2{grid-template-columns:1fr}}
.card{background:#0d0d1a;border:1px solid #16162a;border-radius:14px;padding:20px}
.scard{background:#0d0d1a;border:1px solid #16162a;border-radius:16px;padding:22px 24px;transition:border-color .2s}
.scard:hover{border-color:#2a2a4a}
.slbl{font-size:11px;font-weight:600;color:#3a3a6a;text-transform:uppercase;letter-spacing:1.2px;margin-bottom:10px}
.sval{font-size:30px;font-weight:700;font-family:'SF Mono',Menlo,'Courier New',monospace;color:#fff;line-height:1;letter-spacing:-1px}
.ssub{font-size:12px;color:#3a3a6a;margin-top:7px;font-weight:500}
.sval.grn{color:#22c55e}.sval.red{color:#ef4444}.sval.yel{color:#f59e0b}
.sec{font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.chart-card{background:#0d0d1a;border:1px solid #16162a;border-radius:16px;padding:24px;margin-bottom:18px}
.chart-hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px}
.chart-lbl{font-size:11px;font-weight:600;color:#3a3a6a;text-transform:uppercase;letter-spacing:1.2px}
.chart-val{font-size:28px;font-weight:700;font-family:'SF Mono',Menlo,monospace;color:#fff;margin-top:6px;letter-spacing:-1px}
.chart-chg{font-size:13px;font-weight:600;margin-top:4px}
.chart-chg.up{color:#22c55e}.chart-chg.dn{color:#ef4444}
.tbns{display:flex;gap:6px}
.tbn{background:transparent;border:1px solid #16162a;color:#3a3a6a;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:500;transition:all .15s}
.tbn:hover{border-color:#2d2d5e;color:#94a3b8}
.tbn.on{background:#7c3aed20;border-color:#7c3aed;color:#c4b5fd}
.chart-empty{height:160px;display:flex;align-items:center;justify-content:center;color:#1e1e3a;font-size:13px;font-style:italic}
.badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.3px;white-space:nowrap}
.b-yes{background:#0a2e1a;color:#4ade80;border:1px solid #166534}
.b-no{background:#2e0a0a;color:#f87171;border:1px solid #7f1d1d}
.b-win{background:#0a2e1a;color:#4ade80}.b-loss{background:#2e0a0a;color:#f87171}
.b-whale{background:#1a0a3e;color:#a78bfa;border:1px solid #4c1d95}
.ri{padding:14px 16px;border-bottom:1px solid #0c0c14;transition:background .1s}
.ri:last-child{border-bottom:none}.ri:hover{background:#09091a}
.rq{font-size:13px;color:#e2e8f0;font-weight:500;line-height:1.45;flex:1}
.rq-sm{font-size:12px;color:#94a3b8;font-weight:400;line-height:1.4;flex:1}
.rmeta{display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;align-items:center}
.ml{font-size:10px;color:#2a2a4a;font-weight:600;text-transform:uppercase;letter-spacing:.6px;display:block;margin-bottom:2px}
.mv2{font-size:12px;color:#94a3b8;font-family:'SF Mono',Menlo,monospace;font-weight:600}
.mv2.grn{color:#22c55e}.mv2.red{color:#ef4444}.mv2.pur{color:#a78bfa}
.sig{border-radius:12px;padding:18px;margin-bottom:10px;border:1px solid;transition:transform .1s}
.sig:hover{transform:translateY(-1px)}
.sig.strong{background:#0a1e10;border-color:#14532d}
.sig.strong-no{background:#1a0a0a;border-color:#7f1d1d}
.sig.mod{background:#1a150a;border-color:#78350f}
.sig.weak{background:#0d0d1a;border-color:#16162a}
.sig-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.sig-act{font-size:17px;font-weight:800;letter-spacing:.4px}
.sig-act.buy{color:#22c55e}.sig-act.no{color:#ef4444}
.sig-q{font-size:13px;color:#e2e8f0;font-weight:500;line-height:1.45;margin-top:5px}
.sig-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid #0f0f1e}
.ss-lbl{font-size:10px;color:#2a2a4a;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px}
.ss-val{font-size:13px;font-weight:700;font-family:'SF Mono',Menlo,monospace}
.ss-val.grn{color:#22c55e}.ss-val.red{color:#ef4444}.ss-val.pur{color:#a78bfa}.ss-val.wht{color:#e2e8f0}
.cbar{height:3px;background:#16162a;border-radius:2px;margin-top:5px;overflow:hidden}
.cbar-f{height:100%;border-radius:2px}
.cbar-f.lo{background:#ef4444;width:25%}.cbar-f.md{background:#f59e0b;width:55%}.cbar-f.hi{background:#22c55e;width:90%}
.mkt-r{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #0c0c14;transition:background .1s}
.mkt-r:last-child{border-bottom:none}.mkt-r:hover{background:#09091a}
.mkt-n{font-size:11px;color:#2a2a4a;font-family:monospace;width:18px;flex-shrink:0}
.mkt-q{font-size:12px;color:#94a3b8;flex:1;line-height:1.35}
.sbar-w{width:60px;height:4px;background:#16162a;border-radius:2px;flex-shrink:0;overflow:hidden}
.sbar{height:100%;background:linear-gradient(90deg,#7c3aed,#4f46e5);border-radius:2px}
.res-r{padding:12px 16px;border-bottom:1px solid #0c0c14;transition:background .1s}
.res-r:last-child{border-bottom:none}.res-r:hover{background:#09091a}
.res-q{font-size:12px;color:#94a3b8;margin-bottom:7px;line-height:1.4}
.res-stats{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.res-s{font-size:11px;color:#3a3a6a}
.res-s span{font-weight:600;font-family:monospace}
.rec{font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px}
.rec.by{background:#0a2e1a;color:#4ade80}.rec.bn{background:#2e0a0a;color:#f87171}.rec.pa{background:#16162a;color:#64748b}
.hist-r{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #0c0c14;transition:background .1s}
.hist-r:last-child{border-bottom:none}.hist-r:hover{background:#09091a}
.hist-q{font-size:12px;color:#94a3b8;flex:1;line-height:1.35}
.hist-pnl{font-size:13px;font-weight:700;font-family:monospace;white-space:nowrap}
.hist-pnl.grn{color:#22c55e}.hist-pnl.red{color:#ef4444}
.kb-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.kb-s{background:#080810;border-radius:10px;padding:14px;text-align:center}
.kb-n{font-size:24px;font-weight:700;font-family:monospace;color:#fff}
.kb-l{font-size:10px;color:#2a2a4a;margin-top:4px;text-transform:uppercase;letter-spacing:.8px}
.kb-i{padding:10px 14px;border-bottom:1px solid #0c0c14;font-size:12px;display:flex;gap:8px;align-items:flex-start}
.kb-i:last-child{border-bottom:none}
.scroll{max-height:340px;overflow-y:auto}
.empty{text-align:center;padding:32px 20px;color:#1e1e3a;font-size:13px;font-style:italic}
</style>
</head>
<body>

<header class="hdr">
  <div class="hdr-l">
    <div class="logo">&#11041;</div>
    <div>
      <div class="app-name">POLYMARKET BOT</div>
      <div class="app-sub">Automated Prediction Market Trading</div>
    </div>
    <span class="${modeCls}" id="mode-badge">${modeText}</span>
  </div>
  <div class="hdr-r">
    <div class="sdot" id="sdot"></div>
    <span class="upd" id="upd">Loading...</span>
    <button class="btn btn-stop" onclick="stopBot()">&#9632; Stop</button>
    <button class="btn btn-go" onclick="resumeBot()">&#9654; Resume</button>
    <button class="btn" onclick="loadData()">&#8635; Refresh</button>
  </div>
</header>

<div class="pipe-wrap">
  <div class="pipe">
    <div class="pstep" id="ps1"><div class="p-num">STEP 01</div><div class="p-lbl">Whales</div><div class="p-chk" id="pc1">&#9675;</div></div>
    <div class="parr">&#8250;</div>
    <div class="pstep" id="ps2"><div class="p-num">STEP 02</div><div class="p-lbl">Scanner</div><div class="p-chk" id="pc2">&#9675;</div></div>
    <div class="parr">&#8250;</div>
    <div class="pstep" id="ps3"><div class="p-num">STEP 03</div><div class="p-lbl">Research</div><div class="p-chk" id="pc3">&#9675;</div></div>
    <div class="parr">&#8250;</div>
    <div class="pstep" id="ps4"><div class="p-num">STEP 04</div><div class="p-lbl">Sentiment</div><div class="p-chk" id="pc4">&#9675;</div></div>
    <div class="parr">&#8250;</div>
    <div class="pstep" id="ps5"><div class="p-num">STEP 05</div><div class="p-lbl">Predictor</div><div class="p-chk" id="pc5">&#9675;</div></div>
    <div class="parr">&#8250;</div>
    <div class="pstep" id="ps6"><div class="p-num">STEP 06</div><div class="p-lbl">Executor</div><div class="p-chk" id="pc6">&#9675;</div></div>
    <div class="parr">&#8250;</div>
    <div class="pstep" id="ps7"><div class="p-num">STEP 07</div><div class="p-lbl">Closer</div><div class="p-chk" id="pc7">&#9675;</div></div>
  </div>
</div>

<div class="main">

  <div class="col4">
    <div class="scard">
      <div class="slbl">Portfolio Value</div>
      <div class="sval" id="sv-port">--</div>
      <div class="ssub" id="sv-roi">vs. starting balance</div>
    </div>
    <div class="scard">
      <div class="slbl">Today's Profit / Loss</div>
      <div class="sval" id="sv-dpnl">--</div>
      <div class="ssub" id="sv-dsub">since midnight</div>
    </div>
    <div class="scard">
      <div class="slbl">Win Rate</div>
      <div class="sval" id="sv-wr">--</div>
      <div class="ssub" id="sv-wl">-- wins, -- losses</div>
    </div>
    <div class="scard">
      <div class="slbl">Open Bets</div>
      <div class="sval" id="sv-op">--</div>
      <div class="ssub">out of 15 max</div>
    </div>
  </div>

  <div class="chart-card">
    <div class="chart-hdr">
      <div>
        <div class="chart-lbl">Portfolio Value Over Time</div>
        <div class="chart-val" id="ch-val">--</div>
        <div class="chart-chg" id="ch-chg">--</div>
      </div>
      <div class="tbns">
        <button class="tbn on" onclick="setRange('1D')" id="tb-1D">1D</button>
        <button class="tbn" onclick="setRange('1W')" id="tb-1W">1W</button>
        <button class="tbn" onclick="setRange('1M')" id="tb-1M">1M</button>
        <button class="tbn" onclick="setRange('ALL')" id="tb-ALL">ALL</button>
      </div>
    </div>
    <div id="chart-wrap"><div class="chart-empty">No trade history yet -- make some bets!</div></div>
  </div>

  <div class="card col1">
    <div class="sec">&#128051; What Smart Money Is Buying</div>
    <div style="font-size:12px;color:#2a2a4a;font-style:italic;margin-bottom:14px">These are the most profitable traders on Polymarket. When they make big bets, we pay attention.</div>
    <div class="scroll" id="whale-panel"><div class="empty">No whale activity detected yet</div></div>
  </div>

  <div class="col1">
    <div class="sec">&#9889; Bot's Current Picks</div>
    <div id="sigs-panel"><div class="card"><div class="empty">No picks yet -- waiting for the predictor to run</div></div></div>
  </div>

  <div class="card col1">
    <div class="sec">&#128194; Active Bets</div>
    <div class="scroll" id="pos-panel"><div class="empty">No active bets right now</div></div>
  </div>

  <div class="col2">
    <div class="card">
      <div class="sec">&#128202; Top Markets Right Now</div>
      <div class="scroll" id="mkt-panel"><div class="empty">Waiting for scanner to run</div></div>
    </div>
    <div class="card">
      <div class="sec">&#128302; Research Summary</div>
      <div class="scroll" id="res-panel"><div class="empty">Waiting for researcher to run</div></div>
    </div>
  </div>

  <div class="col2">
    <div class="card">
      <div class="sec">&#128203; Bet History</div>
      <div class="scroll" id="hist-panel"><div class="empty">No closed bets yet</div></div>
    </div>
    <div class="card">
      <div class="sec">&#129504; What The Bot Has Learned</div>
      <div id="kb-panel"><div class="empty">Run overnight to populate</div></div>
    </div>
  </div>

</div>
<script>
var D={},chartRange='1D',nrt=Date.now()+15*60*1000;
async function loadData(){
  try{var r=await fetch('/api/data');D=await r.json();renderAll();
  document.getElementById('upd').textContent='Updated '+new Date().toLocaleTimeString();
  var dot=document.getElementById('sdot');dot.style.background='#22c55e';dot.style.boxShadow='0 0 10px #22c55e80';}
  catch(e){var dot=document.getElementById('sdot');dot.style.background='#ef4444';dot.style.boxShadow='0 0 10px #ef444480';}
}
async function stopBot(){if(!confirm('Stop the bot?'))return;await fetch('/api/stop');var d=document.getElementById('sdot');d.style.background='#ef4444';d.style.boxShadow='0 0 10px #ef444480';}
async function resumeBot(){await fetch('/api/resume');var d=document.getElementById('sdot');d.style.background='#22c55e';d.style.boxShadow='0 0 10px #22c55e80';}
function setRange(r){chartRange=r;['1D','1W','1M','ALL'].forEach(function(x){document.getElementById('tb-'+x).className='tbn'+(x===r?' on':'');});renderChart();}
function renderAll(){rPipe();rStats();renderChart();rWhale();rSigs();rPos();rMkts();rRes();rHist();rKB();}
function rPipe(){
  var keys=[D.whale,D.scan,D.research,D.sentiment,D.predictor,D.execLog,D.metrics];
  for(var i=0;i<7;i++){var ps=document.getElementById('ps'+(i+1));var pc=document.getElementById('pc'+(i+1));
    if(keys[i]){ps.className='pstep done';pc.textContent='✓';}
    else{ps.className='pstep';pc.innerHTML='&#9675;';}}
}
function rStats(){
  var p=D.portfolio;if(!p)return;
  var bank=p.bankroll||0,start=p.startingBankroll||1000,roi=((bank-start)/start*100)||0;
  var dpnl=p.dailyPnl||0,wins=p.winCount||0,losses=p.lossCount||0;
  var total=wins+losses,wr=total>0?wins/total*100:0,op=p.openPositions||(D.openPos||[]).length||0;
  document.getElementById('sv-port').textContent='$'+bank.toFixed(2);
  document.getElementById('sv-roi').textContent=(roi>=0?'+':'')+roi.toFixed(2)+'% from $'+start.toFixed(0);
  var dpEl=document.getElementById('sv-dpnl');
  dpEl.textContent=(dpnl>=0?'+$':'-$')+Math.abs(dpnl).toFixed(2);
  dpEl.className='sval '+(dpnl>=0?'grn':'red');
  document.getElementById('sv-dsub').textContent=(dpnl>=0?'profit':'loss')+' today';
  var wrEl=document.getElementById('sv-wr');wrEl.textContent=wr.toFixed(1)+'%';
  wrEl.className='sval '+(wr>=60?'grn':wr>=50?'yel':'red');
  document.getElementById('sv-wl').textContent=wins+' wins, '+losses+' losses';
  var opEl=document.getElementById('sv-op');opEl.textContent=op+'/15';
  opEl.className='sval '+(op>=15?'red':op>=10?'yel':'grn');
}
function buildPts(){
  var p=D.portfolio;if(!p)return[];
  var start=p.startingBankroll||1000;
  var trades=Array.isArray(D.trades)?D.trades:[];
  var closed=trades.filter(function(t){return t.closedAt&&t.pnl!==undefined;}).sort(function(a,b){return new Date(a.closedAt).getTime()-new Date(b.closedAt).getTime();});
  var now=Date.now(),cutoff=0;
  if(chartRange==='1D')cutoff=now-86400000;
  else if(chartRange==='1W')cutoff=now-604800000;
  else if(chartRange==='1M')cutoff=now-2592000000;
  var running=start;
  if(chartRange!=='ALL'){for(var i=0;i<closed.length;i++){if(new Date(closed[i].closedAt).getTime()<cutoff)running+=closed[i].pnl;}}
  var filtered=chartRange==='ALL'?closed:closed.filter(function(t){return new Date(t.closedAt).getTime()>=cutoff;});
  var startT=cutoff>0?cutoff:(filtered.length>0?new Date(filtered[0].closedAt).getTime()-3600000:now-3600000);
  var pts=[{t:startT,v:running}];
  for(var j=0;j<filtered.length;j++){running+=filtered[j].pnl;pts.push({t:new Date(filtered[j].closedAt).getTime(),v:running});}
  pts.push({t:now,v:p.bankroll||running});
  return pts;
}
function renderChart(){
  var p=D.portfolio,wrap=document.getElementById('chart-wrap');
  if(p){
    document.getElementById('ch-val').textContent='$'+(p.bankroll||0).toFixed(2);
    var roi=((p.bankroll-(p.startingBankroll||1000))/(p.startingBankroll||1000)*100)||0;
    var tpnl=p.totalPnl||0;
    var chEl=document.getElementById('ch-chg');
    chEl.textContent=(tpnl>=0?'+$':'-$')+Math.abs(tpnl).toFixed(2)+' ('+(roi>=0?'+':'')+roi.toFixed(2)+'%) all time';
    chEl.className='chart-chg '+(tpnl>=0?'up':'dn');
  }
  var pts=buildPts();
  if(pts.length<2){wrap.innerHTML='<div class="chart-empty">No trade history yet!</div>';return;}
  var base=(p&&p.startingBankroll)||1000;
  var W=800,H=180,PL=8,PR=8,PT=14,PB=22;
  var vals=pts.map(function(x){return x.v;}),times=pts.map(function(x){return x.t;});
  var minV=Math.min.apply(null,vals),maxV=Math.max.apply(null,vals);
  var vp=(maxV-minV)*0.12||10;minV-=vp;maxV+=vp;
  var minT=times[0],maxT=times[times.length-1],tr=maxT-minT||1,vr=maxV-minV||1;
  function sx(t){return PL+(t-minT)/tr*(W-PL-PR);}
  function sy(v){return PT+(1-(v-minV)/vr)*(H-PT-PB);}
  var path=[];
  for(var i=0;i<pts.length;i++){
    var x=sx(pts[i].t).toFixed(1),y=sy(pts[i].v).toFixed(1);
    if(i===0)path.push('M'+x+' '+y);
    else{var px=sx(pts[i-1].t).toFixed(1),py=sy(pts[i-1].v).toFixed(1),cx=((parseFloat(px)+parseFloat(x))/2).toFixed(1);path.push('C'+cx+' '+py+' '+cx+' '+y+' '+x+' '+y);}
  }
  var lp=path.join(' ');
  var last=pts[pts.length-1],isUp=last.v>=base,col=isUp?'#22c55e':'#ef4444';
  var baseY=Math.max(PT,Math.min(H-PB,sy(base))).toFixed(1);
  var lx=sx(last.t).toFixed(1),ly=sy(last.v).toFixed(1);
  var area=lp+' L'+lx+' '+(H-PB)+' L'+PL+' '+(H-PB)+' Z';
  var tls='';
  for(var k=0;k<=4;k++){var tt=minT+k/4*tr;var d=new Date(tt);var lbl=chartRange==='1D'?d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):(d.getMonth()+1)+'/'+d.getDate();tls+='<text x="'+sx(tt).toFixed(1)+'" y="'+(H-4)+'" fill="#1e1e3a" font-size="9" text-anchor="middle" font-family="monospace">'+lbl+'</text>';}
  wrap.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="width:100%;height:180px;display:block">'
    +'<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+col+'" stop-opacity="0.25"/><stop offset="100%" stop-color="'+col+'" stop-opacity="0"/></linearGradient></defs>'
    +'<line x1="'+PL+'" y1="'+(H/4+PT/2)+'" x2="'+(W-PR)+'" y2="'+(H/4+PT/2)+'" stroke="#0c0c14" stroke-width="1"/>'
    +'<line x1="'+PL+'" y1="'+(H/2)+'" x2="'+(W-PR)+'" y2="'+(H/2)+'" stroke="#0c0c14" stroke-width="1"/>'
    +'<line x1="'+PL+'" y1="'+(H*3/4-PB/2)+'" x2="'+(W-PR)+'" y2="'+(H*3/4-PB/2)+'" stroke="#0c0c14" stroke-width="1"/>'
    +'<line x1="'+PL+'" y1="'+baseY+'" x2="'+(W-PR)+'" y2="'+baseY+'" stroke="#2d2d5e" stroke-width="1" stroke-dasharray="4,4"/>'
    +'<path d="'+area+'" fill="url(#cg)"/>'
    +'<path d="'+lp+'" fill="none" stroke="'+col+'" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
    +'<circle cx="'+lx+'" cy="'+ly+'" r="5" fill="'+col+'"/>'
    +'<circle cx="'+lx+'" cy="'+ly+'" r="10" fill="'+col+'" fill-opacity="0.2"/>'
    +tls+'</svg>';
}
function ago(ts){if(!ts)return'--';var d=Math.floor((Date.now()-new Date(ts).getTime())/60000);if(d<1)return'just now';if(d<60)return d+'m ago';var h=Math.floor(d/60);if(h<24)return h+'h ago';return Math.floor(h/24)+'d ago';}
function wNick(addr){if(!addr)return'Whale';var h=0;for(var i=0;i<addr.length;i++)h=((h<<5)-h)+addr.charCodeAt(i);return'Whale #'+(Math.abs(h)%50+1);}
function rWhale(){
  var el=document.getElementById('whale-panel');
  var s=Array.isArray(D.whale)?D.whale:(D.whale&&D.whale.signals?D.whale.signals:[]);
  if(!s.length){el.innerHTML='<div class="empty">No whale activity detected yet</div>';return;}
  el.innerHTML=s.slice(-20).reverse().map(function(w){
    var yes=(w.outcome||'').toLowerCase()==='yes';
    var sz=w.usdcSize||w.size||0;
    var szs=sz>=1000?'$'+(sz/1000).toFixed(1)+'k':'$'+sz.toFixed(0);
    var q=(w.question||w.conditionId||'Unknown market').slice(0,72);
    return '<div class="ri"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px">'
      +'<div style="display:flex;align-items:center;gap:8px">'
      +'<span style="font-size:11px;color:#7c3aed;font-family:monospace;font-weight:600">'+wNick(w.walletAddress)+'</span>'
      +'<span class="badge '+(yes?'b-yes':'b-no')+'">'+(yes?'Betting YES':'Betting NO')+'</span>'
      +'</div><div style="display:flex;align-items:center;gap:10px">'
      +'<span style="font-size:13px;font-weight:700;font-family:monospace;color:'+(yes?'#22c55e':'#ef4444')+'">'+szs+'</span>'
      +'<span style="font-size:11px;color:#2a2a4a">'+ago(w.timestamp)+'</span>'
      +'</div></div><div class="rq-sm" style="margin-top:6px">'+q+'</div></div>';
  }).join('');
}
function rSigs(){
  var el=document.getElementById('sigs-panel');
  if(!D.predictor||!D.predictor.signals){el.innerHTML='<div class="card"><div class="empty">No picks yet</div></div>';return;}
  var sigs=D.predictor.signals.filter(function(s){return s.action!=='PASS';}).slice(0,8);
  if(!sigs.length){el.innerHTML='<div class="card"><div class="empty">No actionable picks this cycle</div></div>';return;}
  el.innerHTML=sigs.map(function(s){
    var yes=s.action==='BUY_YES';
    var edge=s.edge||0,edgeS=(edge>0?'+':'')+edge.toFixed(1)+'%';
    var conf=(s.confidence||0)*100;
    var cLbl=conf>=70?'High':conf>=45?'Medium':'Low';
    var cCls=conf>=70?'hi':conf>=45?'md':'lo';
    var cls=yes&&edge>8?'strong':!yes&&edge>8?'strong-no':edge>4?'mod':'weak';
    var q=(s.question||s.conditionId||'Unknown market').slice(0,100);
    var hasW=s.whaleContext&&s.whaleContext.netBias&&s.whaleContext.netBias!=='NONE';
    var mp=(s.marketImpliedProb||0).toFixed(1),op2=(s.ensembleProbability||0).toFixed(1);
    var diff=(s.ensembleProbability||0)-(s.marketImpliedProb||0);
    return '<div class="sig '+cls+'">'
      +'<div class="sig-top"><div style="flex:1">'
      +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'
      +'<span class="sig-act '+(yes?'buy':'no')+'">'+(yes?'▲ BUY YES':'▼ BUY NO')+'</span>'
      +(hasW?'<span class="badge b-whale">🐳 Whales Agree</span>':'')
      +'</div><div class="sig-q">'+q+'</div></div></div>'
      +'<div class="sig-stats">'
      +'<div><div class="ss-lbl">Market thinks</div><div class="ss-val wht">'+mp+'%</div></div>'
      +'<div><div class="ss-lbl">Our estimate</div><div class="ss-val '+(yes?'grn':'red')+'">'+op2+'%</div></div>'
      +'<div><div class="ss-lbl">Edge (underpriced)</div><div class="ss-val '+(edge>0?'grn':'red')+'">'+edgeS+'</div><div style="font-size:10px;color:#2a2a4a;margin-top:2px">'+(diff>0?'+':'')+diff.toFixed(1)+'% mispricing</div></div>'
      +'<div><div class="ss-lbl">Confidence</div><div class="ss-val wht">'+cLbl+'</div><div class="cbar"><div class="cbar-f '+cCls+'"></div></div></div>'
      +'<div><div class="ss-lbl">Suggested bet</div><div class="ss-val pur">$'+(s.suggestedPositionSize||0)+'</div></div>'
      +'</div></div>';
  }).join('');
}
function rPos(){
  var el=document.getElementById('pos-panel');
  var pos=Array.isArray(D.openPos)?D.openPos:[];
  if(!pos.length){el.innerHTML='<div class="empty">No active bets right now</div>';return;}
  el.innerHTML=pos.map(function(p){
    var yes=p.action==='BUY_YES';
    var q=(p.question||p.conditionId||'Unknown market').slice(0,90);
    var entry=(p.price||p.entryPrice||0).toFixed(3);
    var sz=(p.sizeUsdc||p.costBasis||0).toFixed(2);
    var cur=p.currentValue||p.sizeUsdc||0;
    var upnl=p.unrealizedPnl!==undefined?p.unrealizedPnl:(cur-(p.sizeUsdc||0));
    return '<div class="ri"><div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
      +'<span class="badge '+(yes?'b-yes':'b-no')+'">'+(yes?'YES':'NO')+'</span>'
      +(p.paper?'<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:#1a0a40;color:#a78bfa;font-weight:700">PAPER</span>':'')
      +'<span style="font-size:11px;color:#2a2a4a;margin-left:auto">'+ago(p.openedAt)+'</span>'
      +'</div><div class="rq">'+q+'</div>'
      +'<div class="rmeta">'
      +'<div><span class="ml">Bought at</span><span class="mv2">$'+entry+'</span></div>'
      +'<div><span class="ml">Bet size</span><span class="mv2">$'+sz+'</span></div>'
      +'<div><span class="ml">Current value</span><span class="mv2">$'+cur.toFixed(2)+'</span></div>'
      +'<div><span class="ml">Unrealized P&amp;L</span><span class="mv2 '+(upnl>=0?'grn':'red')+'">'+(upnl>=0?'+$':'-$')+Math.abs(upnl).toFixed(2)+'</span></div>'
      +'</div></div>';
  }).join('');
}
function rMkts(){
  var el=document.getElementById('mkt-panel');
  if(!D.scan||!D.scan.markets){el.innerHTML='<div class="empty">Waiting for scanner to run</div>';return;}
  el.innerHTML=D.scan.markets.slice(0,15).map(function(m,i){
    var q=(m.question||m.ticker||'Unknown').slice(0,65);
    var vol=m.volume24hr||m.volume||0;
    var vs=vol>=1000000?'$'+(vol/1000000).toFixed(1)+'M':vol>=1000?'$'+(vol/1000).toFixed(0)+'k':'$'+vol.toFixed(0);
    var pct=Math.min((m.score||0)*100,100).toFixed(0);
    return '<div class="mkt-r"><span class="mkt-n">'+(i+1)+'</span><span class="mkt-q">'+q+'</span><span style="font-size:11px;color:#3a3a6a;font-family:monospace;white-space:nowrap">'+vs+'</span><div class="sbar-w"><div class="sbar" style="width:'+pct+'%"></div></div></div>';
  }).join('');
}
function rRes(){
  var el=document.getElementById('res-panel');
  var b=(D.research&&D.research.briefs)?D.research.briefs:[];
  if(!b.length){el.innerHTML='<div class="empty">Waiting for researcher to run</div>';return;}
  el.innerHTML=b.slice(0,12).map(function(r){
    var q=(r.question||r.title||'Unknown').slice(0,70);
    var mkt=((r.marketImpliedProbability||(r.marketPrice&&r.marketPrice*100))||0).toFixed(1);
    var ai=(r.aiEstimatedProbability||0).toFixed(1);
    var edge=r.edge||0;
    var rec=r.recommendation||'PASS';
    var rcls=rec==='BUY_YES'?'by':rec==='BUY_NO'?'bn':'pa';
    var rlbl=rec==='BUY_YES'?'Buy Yes':rec==='BUY_NO'?'Buy No':'Skip';
    return '<div class="res-r"><div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px"><div class="res-q" style="margin:0">'+q+'</div><span class="rec '+rcls+'">'+rlbl+'</span></div>'
      +'<div class="res-stats">'
      +'<div class="res-s">Market: <span style="color:#94a3b8">'+mkt+'%</span></div>'
      +'<div class="res-s">Our est: <span style="color:'+(edge>0?'#22c55e':'#60a5fa')+'">'+ai+'%</span></div>'
      +'<div class="res-s">Edge: <span style="color:'+(edge>5?'#22c55e':edge<-5?'#ef4444':'#f59e0b')+'">'+(edge>0?'+':'')+edge.toFixed(1)+'%</span></div>'
      +'</div></div>';
  }).join('');
}
function rHist(){
  var el=document.getElementById('hist-panel');
  var trades=Array.isArray(D.trades)?D.trades.filter(function(t){return t.closedAt!==undefined;}):[];
  if(!trades.length){el.innerHTML='<div class="empty">No closed bets yet</div>';return;}
  el.innerHTML=trades.slice(-15).reverse().map(function(t){
    var pnl=t.pnl||0,win=pnl>=0;
    var q=(t.question||t.conditionId||'Unknown').slice(0,60);
    return '<div class="hist-r"><span class="badge '+(t.action==='BUY_YES'?'b-yes':'b-no')+'" style="flex-shrink:0">'+(t.action==='BUY_YES'?'YES':'NO')+'</span><span class="hist-q">'+q+'</span><span class="badge '+(win?'b-win':'b-loss')+'" style="flex-shrink:0">'+(win?'WIN':'LOSS')+'</span><span class="hist-pnl '+(win?'grn':'red')+'">'+(win?'+$':'-$')+Math.abs(pnl).toFixed(2)+'</span></div>';
  }).join('');
}
function rKB(){
  var kb=D.kb;if(!kb)return;
  var lessons=kb.totalLessons||0,bl=(kb.marketBlacklist||[]).length,pt=(kb.successPatterns||[]).length;
  var items=[];
  (kb.avoidPatterns||[]).slice(-5).forEach(function(p){items.push('<div class="kb-i"><span style="color:#ef4444">✗</span><span style="color:#94a3b8">'+p+'</span></div>');});
  (kb.successPatterns||[]).slice(-5).forEach(function(p){items.push('<div class="kb-i"><span style="color:#22c55e">✓</span><span style="color:#94a3b8">'+p+'</span></div>');});
  document.getElementById('kb-panel').innerHTML='<div class="kb-grid">'
    +'<div class="kb-s"><div class="kb-n">'+lessons+'</div><div class="kb-l">Lessons Learned</div></div>'
    +'<div class="kb-s"><div class="kb-n" style="color:#ef4444">'+bl+'</div><div class="kb-l">Avoided Markets</div></div>'
    +'<div class="kb-s"><div class="kb-n" style="color:#22c55e">'+pt+'</div><div class="kb-l">Winning Patterns</div></div>'
    +'</div>'+(items.length?'<div class="scroll" style="max-height:200px">'+items.join('')+'</div>':'<div class="empty">Run overnight to populate</div>');
}
function tick(){var rem=Math.max(0,nrt-Date.now());if(rem===0){nrt=Date.now()+15*60*1000;loadData();}}
loadData();setInterval(loadData,30000);setInterval(tick,1000);
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
