/**
 * ====================================================
 *  KALSHI BOT — MASTER ORCHESTRATOR
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

// ─────────────────────────────────────────────────
// LOGGER
// ─────────────────────────────────────────────────

function log(message: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = level === "ERROR" ? "❌" : level === "WARN" ? "⚠️" : "✓";
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

// ─────────────────────────────────────────────────
// STEP RUNNER
// ─────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────
// FULL PIPELINE
// ─────────────────────────────────────────────────

async function runPipeline(): Promise<void> {
  if (fs.existsSync(KILL_SWITCH_FILE)) {
    log("Kill switch active — pipeline halted", "WARN");
    return;
  }

  const start = Date.now();
  console.log("\n" + "═".repeat(55));
  console.log("  PIPELINE RUN — " + new Date().toLocaleTimeString());
  console.log("═".repeat(55));

  const steps = [
    { name: "Step 1: Scanner",   script: "scanner.ts"    },
    { name: "Step 2: Research",  script: "researcher.ts" },
    { name: "Step 3: Sentiment", script: "sentiment.ts"  },
    { name: "Step 4: Predictor", script: "predictor.ts"  },
    { name: "Step 5: Executor",  script: "executor.ts"   },
    { name: "Step 6: Closer",    script: "closer.ts"     },
  ];

  for (const step of steps) {
    runStep(step.name, step.script);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log("Pipeline finished in " + elapsed + "s");
  console.log("═".repeat(55) + "\n");
}

// ─────────────────────────────────────────────────
// MIDNIGHT COMPOUNDER (runs separately at midnight, not in pipeline)
// ─────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────
// DATA LOADER
// ─────────────────────────────────────────────────

function loadJson(file: string): any {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {}
  return null;
}

function getApiData(): string {
  const metrics = loadJson("performance_metrics.json");
  return JSON.stringify({
    scan:      loadJson("scan_results.json"),
    research:  loadJson("research_results.json"),
    sentiment: loadJson("sentiment_results.json"),
    signals:   loadJson("signal_results.json"),
    portfolio: loadJson("portfolio.json"),
    metrics:   metrics ? metrics[metrics.length - 1] : null,
    kb:        loadJson("knowledge_base.json"),
    trades:    loadJson("trade_log.json"),
    execLog:   loadJson("execution_log.json"),
    botLog:    loadJson(LOG_FILE),
    timestamp: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────
// DASHBOARD HTML
// ─────────────────────────────────────────────────

function getDashboardHtml(): string {
  return [
    "<!DOCTYPE html>",
    "<html lang='en'>",
    "<head>",
    "<meta charset='UTF-8'>",
    "<title>Kalshi Bot</title>",
    "<style>",
    "* { margin:0; padding:0; box-sizing:border-box; }",
    "body { background:#0a0a0f; color:#e2e8f0; font-family:'SF Mono',monospace; font-size:13px; }",
    ".header { background:#0d0d1a; border-bottom:1px solid #1e2d4a; padding:16px 24px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100; }",
    ".logo { width:32px; height:32px; background:linear-gradient(135deg,#3b82f6,#8b5cf6); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:16px; }",
    ".title { font-size:16px; font-weight:700; color:#f1f5f9; }",
    ".subtitle { font-size:11px; color:#64748b; margin-top:2px; }",
    ".status-bar { display:flex; align-items:center; gap:12px; }",
    ".dot { width:8px; height:8px; border-radius:50%; background:#22c55e; box-shadow:0 0 8px #22c55e; animation:pulse 2s infinite; }",
    "@keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }",
    ".btn { background:#1e2d4a; border:1px solid #2d4a7a; color:#93c5fd; padding:6px 14px; border-radius:6px; cursor:pointer; font-size:11px; font-family:inherit; }",
    ".btn:hover { background:#2d4a7a; }",
    ".btn-red { border-color:#7f1d1d; color:#f87171; }",
    ".btn-red:hover { background:#450a0a; }",
    ".btn-green { border-color:#14532d; color:#4ade80; }",
    ".btn-green:hover { background:#14532d; }",
    ".main { padding:20px 24px; max-width:1400px; margin:0 auto; }",
    ".g4 { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }",
    ".g2 { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin-bottom:20px; }",
    ".card { background:#0d0d1a; border:1px solid #1e2d4a; border-radius:10px; padding:16px; }",
    ".ct { font-size:10px; font-weight:600; color:#475569; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }",
    ".mv { font-size:28px; font-weight:700; color:#f1f5f9; line-height:1; }",
    ".ms { font-size:11px; color:#64748b; margin-top:4px; }",
    ".pos { color:#22c55e; } .neg { color:#ef4444; } .wrn { color:#f59e0b; }",
    ".sec { font-size:12px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-bottom:12px; display:flex; align-items:center; gap:8px; }",
    ".sec::after { content:''; flex:1; height:1px; background:#1e2d4a; }",
    "table { width:100%; border-collapse:collapse; }",
    "th { text-align:left; font-size:10px; color:#475569; text-transform:uppercase; padding:8px 10px; border-bottom:1px solid #1e2d4a; }",
    "td { padding:10px; border-bottom:1px solid #111827; font-size:12px; color:#cbd5e1; }",
    "tr:hover td { background:#0f172a; }",
    "tr:last-child td { border-bottom:none; }",
    ".badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:10px; font-weight:600; }",
    ".bg { background:#14532d; color:#4ade80; }",
    ".br { background:#450a0a; color:#f87171; }",
    ".bb { background:#1e3a5f; color:#60a5fa; }",
    ".bgy { background:#1e293b; color:#94a3b8; }",
    ".pb { height:4px; background:#1e2d4a; border-radius:2px; overflow:hidden; margin-top:6px; }",
    ".pf { height:100%; border-radius:2px; transition:width 0.5s; }",
    ".empty { text-align:center; padding:32px; color:#475569; font-size:12px; }",
    // Pipeline: 6 steps, use flex-wrap so they fit on screen
    ".pipe { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:20px; }",
    ".step { flex:1; min-width:80px; background:#0d0d1a; border:1px solid #1e2d4a; border-radius:8px; padding:10px; text-align:center; }",
    ".step.done { border-color:#16a34a; background:#0f2d1a; }",
    ".step.err  { border-color:#991b1b; background:#1c0a0a; }",
    ".snum { font-size:16px; font-weight:700; margin-bottom:4px; }",
    ".sname { font-size:10px; color:#64748b; text-transform:uppercase; }",
    ".sstat { font-size:11px; margin-top:4px; }",
    ".arrow { color:#1e2d4a; font-size:16px; }",
    ".sc { background:#0d0d1a; border:1px solid #1e2d4a; border-radius:8px; padding:14px; margin-bottom:10px; }",
    ".sc.yes { border-left:3px solid #22c55e; }",
    ".sc.no { border-left:3px solid #ef4444; }",
    ".sh { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; }",
    ".stk { font-size:11px; color:#60a5fa; font-weight:600; }",
    ".sti { font-size:11px; color:#94a3b8; margin-top:2px; }",
    ".ss { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:8px; }",
    ".ssl { font-size:9px; color:#475569; text-transform:uppercase; }",
    ".ssv { font-size:13px; font-weight:600; color:#e2e8f0; margin-top:2px; }",
    ".log-item { padding:6px 10px; border-bottom:1px solid #0f172a; font-size:11px; }",
    ".lI { color:#64748b; } .lW { color:#f59e0b; } .lE { color:#ef4444; }",
    ".scroll { max-height:300px; overflow-y:auto; }",
    ".scroll::-webkit-scrollbar { width:4px; }",
    ".scroll::-webkit-scrollbar-thumb { background:#1e2d4a; border-radius:2px; }",
    ".cdown { font-size:20px; font-weight:700; color:#3b82f6; }",
    "</style>",
    "</head>",
    "<body>",
    "<div class='header'>",
    "  <div style='display:flex;align-items:center;gap:12px'>",
    "    <div class='logo'>⚡</div>",
    "    <div><div class='title'>KALSHI TRADING BOT</div><div class='subtitle'>Fully Automated Pipeline</div></div>",
    "  </div>",
    "  <div class='status-bar'>",
    "    <div class='dot' id='dot'></div>",
    "    <span id='stxt' style='font-size:11px;color:#64748b'>RUNNING</span>",
    "    <span id='upd' style='font-size:11px;color:#475569'>Loading...</span>",
    "    <button class='btn btn-red' onclick='stopBot()'>Stop</button>",
    "    <button class='btn btn-green' onclick='resumeBot()'>Resume</button>",
    "    <button class='btn' onclick='loadData()'>Refresh</button>",
    "  </div>",
    "</div>",
    "<div class='main'>",
    // 6-step pipeline display
    "  <div class='pipe'>",
    "    <div class='step' id='p1'><div class='snum'>1</div><div class='sname'>Scanner</div><div class='sstat' id='s1'>—</div></div>",
    "    <div class='arrow'>→</div>",
    "    <div class='step' id='p2'><div class='snum'>2</div><div class='sname'>Research</div><div class='sstat' id='s2'>—</div></div>",
    "    <div class='arrow'>→</div>",
    "    <div class='step' id='p3'><div class='snum'>3</div><div class='sname'>Sentiment</div><div class='sstat' id='s3'>—</div></div>",
    "    <div class='arrow'>→</div>",
    "    <div class='step' id='p4'><div class='snum'>4</div><div class='sname'>Predictor</div><div class='sstat' id='s4'>—</div></div>",
    "    <div class='arrow'>→</div>",
    "    <div class='step' id='p5'><div class='snum'>5</div><div class='sname'>Executor</div><div class='sstat' id='s5'>—</div></div>",
    "    <div class='arrow'>→</div>",
    "    <div class='step' id='p6'><div class='snum'>6</div><div class='sname'>Closer</div><div class='sstat' id='s6'>—</div></div>",
    "  </div>",
    "  <div class='g4'>",
    "    <div class='card'><div class='ct'>Bankroll</div><div class='mv' id='bnk'>—</div><div class='ms' id='roi'>—</div></div>",
    "    <div class='card'><div class='ct'>Total P&L</div><div class='mv' id='pnl'>—</div><div class='ms' id='dpnl'>Daily: —</div></div>",
    "    <div class='card'><div class='ct'>Win Rate</div><div class='mv' id='wr'>—</div><div class='ms' id='wl'>—W / —L</div></div>",
    "    <div class='card'><div class='ct'>Next Run</div><div class='cdown' id='cd'>—</div><div class='ms'>Every 15 minutes</div></div>",
    "  </div>",
    "  <div class='g4'>",
    "    <div class='card'><div class='ct'>Sharpe Ratio</div><div class='mv' id='sh'>—</div><div class='ms'>Target: 2.0+</div><div class='pb'><div class='pf' id='shb' style='background:#3b82f6;width:0%'></div></div></div>",
    "    <div class='card'><div class='ct'>Max Drawdown</div><div class='mv' id='dd'>—</div><div class='ms'>Limit: 8%</div><div class='pb'><div class='pf' id='ddb' style='background:#ef4444;width:0%'></div></div></div>",
    "    <div class='card'><div class='ct'>Profit Factor</div><div class='mv' id='pf'>—</div><div class='ms'>Target: 1.5+</div><div class='pb'><div class='pf' id='pfb' style='background:#22c55e;width:0%'></div></div></div>",
    "    <div class='card'><div class='ct'>Open Positions</div><div class='mv' id='op'>—</div><div class='ms'>Max: 15</div></div>",
    "  </div>",
    "  <div class='g2'>",
    "    <div><div class='sec'>Active Signals</div><div id='sigs'><div class='empty'>No signals yet</div></div></div>",
    "    <div><div class='sec'>Open Positions</div><div class='card scroll' id='pos'><div class='empty'>No open positions</div></div></div>",
    "  </div>",
    "  <div class='g2'>",
    "    <div><div class='sec'>Top Markets</div><div class='card'><div class='scroll'><table><thead><tr><th>#</th><th>Ticker</th><th>Price</th><th>Vol</th><th>Days</th><th>Score</th></tr></thead><tbody id='mkt'><tr><td colspan='6' class='empty'>Run bot to populate</td></tr></tbody></table></div></div></div>",
    "    <div><div class='sec'>Bot Activity Log</div><div class='card'><div class='scroll' id='blog'><div class='empty'>Waiting...</div></div></div></div>",
    "  </div>",
    "  <div class='g2'>",
    "    <div><div class='sec'>Trade History</div><div class='card'><div class='scroll'><table><thead><tr><th>Market</th><th>Action</th><th>Entry</th><th>P&L</th><th>Result</th></tr></thead><tbody id='th'><tr><td colspan='5' class='empty'>No closed trades yet</td></tr></tbody></table></div></div></div>",
    "    <div><div class='sec'>Knowledge Base</div><div class='card'><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px'><div style='text-align:center'><div style='font-size:20px;font-weight:700' id='kbl'>0</div><div style='font-size:10px;color:#64748b'>Lessons</div></div><div style='text-align:center'><div style='font-size:20px;font-weight:700;color:#ef4444' id='kbb'>0</div><div style='font-size:10px;color:#64748b'>Blacklisted</div></div><div style='text-align:center'><div style='font-size:20px;font-weight:700;color:#22c55e' id='kbp'>0</div><div style='font-size:10px;color:#64748b'>Patterns</div></div></div><div class='scroll' id='kbi'><div class='empty'>Run overnight to populate</div></div></div></div>",
    "  </div>",
    "</div>",
    "<script>",
    "var data={};var nrt=Date.now()+15*60*1000;",
    "async function loadData(){try{var r=await fetch('/api/data');data=await r.json();renderAll();document.getElementById('upd').textContent='Updated '+new Date().toLocaleTimeString();}catch(e){}}",
    "async function stopBot(){await fetch('/api/stop');document.getElementById('dot').style.background='#ef4444';document.getElementById('stxt').textContent='STOPPED';alert('Kill switch activated.');}",
    "async function resumeBot(){await fetch('/api/resume');document.getElementById('dot').style.background='#22c55e';document.getElementById('stxt').textContent='RUNNING';alert('Trading resumed.');}",
    "function renderAll(){rPipe();rMetrics();rSigs();rPos();rMkts();rTrades();rKB();rLog();}",
    // Updated rPipe to check 6 data sources
    "function rPipe(){var keys=[data.scan,data.research,data.sentiment,data.signals,data.execLog,data.kb];for(var i=0;i<6;i++){var el=document.getElementById('p'+(i+1));var st=document.getElementById('s'+(i+1));if(keys[i]){el.className='step done';st.textContent='Done';}else{el.className='step';st.textContent='Pending';}}}",
    "function rMetrics(){var p=data.portfolio;var m=data.metrics;if(p){var roi=((p.bankroll-p.startingBankroll)/p.startingBankroll*100);var tot=(p.winCount||0)+(p.lossCount||0);var wr=tot>0?(p.winCount/tot*100):0;var op=(p.positions||[]).filter(function(x){return x.status==='OPEN';}).length;document.getElementById('bnk').textContent='$'+(p.bankroll||0).toFixed(2);document.getElementById('roi').textContent=(roi>=0?'+':'')+roi.toFixed(1)+'% ROI';document.getElementById('pnl').textContent=(p.totalPnl>=0?'+':'')+'$'+(p.totalPnl||0).toFixed(2);document.getElementById('pnl').className='mv '+(p.totalPnl>=0?'pos':'neg');document.getElementById('dpnl').textContent='Daily: '+(p.dailyPnl>=0?'+':'')+'$'+(p.dailyPnl||0).toFixed(2);document.getElementById('wr').textContent=wr.toFixed(1)+'%';document.getElementById('wr').className='mv '+(wr>=60?'pos':wr>=50?'wrn':'neg');document.getElementById('wl').textContent=(p.winCount||0)+'W / '+(p.lossCount||0)+'L';document.getElementById('op').textContent=op+'/15';}if(m){document.getElementById('sh').textContent=(m.sharpeRatio||0).toFixed(2);document.getElementById('sh').className='mv '+(m.sharpeRatio>=2?'pos':m.sharpeRatio>=1?'wrn':'neg');document.getElementById('shb').style.width=Math.min((m.sharpeRatio||0)/3*100,100)+'%';document.getElementById('dd').textContent=(m.maxDrawdown||0).toFixed(1)+'%';document.getElementById('dd').className='mv '+(m.maxDrawdown<=8?'pos':m.maxDrawdown<=15?'wrn':'neg');document.getElementById('ddb').style.width=Math.min((m.maxDrawdown||0)/20*100,100)+'%';document.getElementById('pf').textContent=(m.profitFactor||0).toFixed(2);document.getElementById('pf').className='mv '+(m.profitFactor>=1.5?'pos':m.profitFactor>=1?'wrn':'neg');document.getElementById('pfb').style.width=Math.min((m.profitFactor||0)/3*100,100)+'%';}}",
    "function rSigs(){var el=document.getElementById('sigs');if(!data.signals||!data.signals.signals){el.innerHTML='<div class=\"empty\">No signals yet</div>';return;}var sigs=data.signals.signals.filter(function(s){return s.action!=='PASS';}).slice(0,5);if(!sigs.length){el.innerHTML='<div class=\"empty\">No actionable signals</div>';return;}el.innerHTML=sigs.map(function(s){var cls=s.action==='BUY_YES'?'yes':'no';var bc=s.action==='BUY_YES'?'bg':'br';var edge=s.edge?(s.edge>0?'+':'')+s.edge.toFixed(1)+'%':'—';return '<div class=\"sc '+cls+'\"><div class=\"sh\"><div><div class=\"stk\">'+(s.ticker||'').slice(0,45)+'</div><div class=\"sti\">'+(s.title||'').slice(0,55)+'</div></div><span class=\"badge '+bc+'\">'+s.action+'</span></div><div class=\"ss\"><div><div class=\"ssl\">Market</div><div class=\"ssv\">'+(s.marketImpliedProb||0).toFixed(1)+'%</div></div><div><div class=\"ssl\">AI Est.</div><div class=\"ssv\">'+(s.ensembleProbability||0).toFixed(1)+'%</div></div><div><div class=\"ssl\">Edge</div><div class=\"ssv '+(s.edge>0?'pos':'neg')+'\">'+edge+'</div></div><div><div class=\"ssl\">Conf.</div><div class=\"ssv\">'+((s.confidence||0)*100).toFixed(0)+'%</div></div></div></div>';}).join('');}",
    "function rPos(){var el=document.getElementById('pos');var open=(data.portfolio&&data.portfolio.positions?data.portfolio.positions:[]).filter(function(p){return p.status==='OPEN';});if(!open.length){el.innerHTML='<div class=\"empty\">No open positions</div>';return;}el.innerHTML=open.map(function(p){return '<div style=\"padding:10px;border-bottom:1px solid #111827\"><div style=\"display:flex;justify-content:space-between\"><span class=\"badge '+(p.action==='BUY_YES'?'bg':'br')+'\">'+p.action+'</span><span style=\"font-size:11px;color:#64748b\">'+p.contracts+' contracts</span></div><div style=\"font-size:11px;color:#60a5fa;margin-top:6px\">'+(p.ticker||'').slice(0,45)+'</div><div style=\"display:flex;justify-content:space-between;margin-top:4px\"><span style=\"font-size:11px;color:#94a3b8\">Entry: $'+(p.entryPrice||0).toFixed(4)+'</span><span style=\"font-size:11px;color:#94a3b8\">Cost: $'+(p.costBasis||0).toFixed(2)+'</span></div></div>';}).join('');}",
    "function rMkts(){var tbody=document.getElementById('mkt');if(!data.scan||!data.scan.markets){tbody.innerHTML='<tr><td colspan=\"6\" class=\"empty\">Waiting for scan</td></tr>';return;}tbody.innerHTML=data.scan.markets.slice(0,15).map(function(m,i){return '<tr><td style=\"color:#475569\">'+(i+1)+'</td><td style=\"color:#60a5fa;font-size:10px\">'+(m.ticker||'').slice(0,28)+'</td><td>$'+(m.lastPrice||0).toFixed(3)+'</td><td>'+(m.volume||0).toLocaleString()+'</td><td>'+(m.daysToExpiry||0).toFixed(1)+'d</td><td><span class=\"badge bb\">'+(m.score||0).toFixed(3)+'</span></td></tr>';}).join('');}",
    "function rTrades(){var tbody=document.getElementById('th');if(!data.trades||!data.trades.length){tbody.innerHTML='<tr><td colspan=\"5\" class=\"empty\">No closed trades yet</td></tr>';return;}tbody.innerHTML=data.trades.slice(-10).reverse().map(function(t){return '<tr><td style=\"font-size:10px;color:#60a5fa\">'+(t.ticker||'').slice(0,25)+'</td><td><span class=\"badge '+(t.action==='BUY_YES'?'bg':'br')+'\">'+(t.action||'—')+'</span></td><td>$'+(t.entryPrice||0).toFixed(4)+'</td><td class=\"'+(t.pnl>=0?'pos':'neg')+'\">'+(t.pnl>=0?'+':'')+'$'+(t.pnl||0).toFixed(2)+'</td><td><span class=\"badge '+(t.pnl>=0?'bg':'br')+'\">'+(t.pnl>=0?'WIN':'LOSS')+'</span></td></tr>';}).join('');}",
    "function rKB(){var kb=data.kb;if(!kb)return;document.getElementById('kbl').textContent=kb.totalLessons||0;document.getElementById('kbb').textContent=(kb.marketBlacklist||[]).length;document.getElementById('kbp').textContent=(kb.successPatterns||[]).length;var el=document.getElementById('kbi');var items=[].concat((kb.avoidPatterns||[]).slice(-3).map(function(p){return '<div style=\"padding:8px 12px;background:#0a0f1a;border-radius:6px;margin-bottom:6px;font-size:11px;color:#94a3b8;border-left:2px solid #ef4444\">✗ '+p+'</div>';}),(kb.successPatterns||[]).slice(-3).map(function(p){return '<div style=\"padding:8px 12px;background:#0a0f1a;border-radius:6px;margin-bottom:6px;font-size:11px;color:#94a3b8;border-left:2px solid #22c55e\">✓ '+p+'</div>';}));el.innerHTML=items.length?items.join(''):'<div class=\"empty\">Run overnight to populate</div>';}",
    "function rLog(){var el=document.getElementById('blog');if(!data.botLog||!data.botLog.length){el.innerHTML='<div class=\"empty\">No activity yet</div>';return;}el.innerHTML=data.botLog.slice(-30).reverse().map(function(l){return '<div class=\"log-item l'+l.level+'\"><span style=\"color:#334155\">'+new Date(l.timestamp).toLocaleTimeString()+'</span><span style=\"margin-left:8px\">'+l.message+'</span></div>';}).join('');}",
    "function updateCountdown(){var rem=Math.max(0,nrt-Date.now());var mins=Math.floor(rem/60000);var secs=Math.floor((rem%60000)/1000);document.getElementById('cd').textContent=mins+':'+(secs<10?'0':'')+secs;if(rem===0){nrt=Date.now()+15*60*1000;loadData();}}",
    "loadData();setInterval(loadData,30000);setInterval(updateCountdown,1000);",
    "</script>",
    "</body>",
    "</html>"
  ].join("\n");
}

// ─────────────────────────────────────────────────
// DASHBOARD SERVER
// ─────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "═".repeat(55));
  console.log("  KALSHI BOT — MASTER ORCHESTRATOR");
  console.log("═".repeat(55));
  console.log("  Mode: " + (process.env.PAPER_TRADE === "false" ? "LIVE" : "PAPER"));
  console.log("  Interval: every " + SCAN_INTERVAL_MINUTES + " minutes");
  console.log("  Dashboard: http://localhost:" + PORT);
  console.log("  Kill switch: create a STOP file to halt");
  console.log("═".repeat(55) + "\n");

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