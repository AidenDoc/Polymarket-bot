/**
 * ====================================================
 *  KALSHI BOT — LOCAL DASHBOARD SERVER
 *  Serves a real-time web dashboard on localhost:3000
 * ====================================================
 *
 * How to run:
 *   npx ts-node src/dashboard.ts
 *
 * Then open your browser to:
 *   http://localhost:3000
 * ====================================================
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const PORT = 3000;

// ─────────────────────────────────────────────────
// DATA LOADERS
// ─────────────────────────────────────────────────

function loadJson(file: string): any {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch {}
  return null;
}

function getApiData(): string {
  const scan = loadJson("scan_results.json");
  const research = loadJson("research_results.json");
  const signals = loadJson("signal_results.json");
  const portfolio = loadJson("portfolio.json");
  const metrics = loadJson("performance_metrics.json");
  const kb = loadJson("knowledge_base.json");
  const trades = loadJson("trade_log.json");
  const execLog = loadJson("execution_log.json");

  return JSON.stringify({
    scan,
    research,
    signals,
    portfolio,
    metrics: metrics ? metrics[metrics.length - 1] : null,
    kb,
    trades,
    execLog,
    timestamp: new Date().toISOString(),
  });
}

// ─────────────────────────────────────────────────
// HTML DASHBOARD
// ─────────────────────────────────────────────────

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kalshi Trading Bot</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  body {
    background: #0a0a0f;
    color: #e2e8f0;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px;
    min-height: 100vh;
  }

  .header {
    background: #0d0d1a;
    border-bottom: 1px solid #1e2d4a;
    padding: 16px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
  }

  .title { font-size: 16px; font-weight: 700; color: #f1f5f9; letter-spacing: 0.5px; }
  .subtitle { font-size: 11px; color: #64748b; margin-top: 2px; }

  .status-bar {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 8px #22c55e;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .status-text { font-size: 11px; color: #64748b; }
  .last-update { font-size: 11px; color: #475569; }

  .refresh-btn {
    background: #1e2d4a;
    border: 1px solid #2d4a7a;
    color: #93c5fd;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    font-family: inherit;
    transition: all 0.2s;
  }
  .refresh-btn:hover { background: #2d4a7a; }

  .main { padding: 20px 24px; max-width: 1400px; margin: 0 auto; }

  .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 20px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }

  .card {
    background: #0d0d1a;
    border: 1px solid #1e2d4a;
    border-radius: 10px;
    padding: 16px;
  }

  .card-title {
    font-size: 10px;
    font-weight: 600;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
  }

  .metric-value {
    font-size: 28px;
    font-weight: 700;
    color: #f1f5f9;
    line-height: 1;
  }

  .metric-sub {
    font-size: 11px;
    color: #64748b;
    margin-top: 4px;
  }

  .positive { color: #22c55e; }
  .negative { color: #ef4444; }
  .warning { color: #f59e0b; }
  .neutral { color: #94a3b8; }
  .blue { color: #3b82f6; }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #1e2d4a;
  }

  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left;
    font-size: 10px;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 8px 10px;
    border-bottom: 1px solid #1e2d4a;
  }
  td {
    padding: 10px 10px;
    border-bottom: 1px solid #111827;
    font-size: 12px;
    color: #cbd5e1;
  }
  tr:hover td { background: #0f172a; }
  tr:last-child td { border-bottom: none; }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }
  .badge-green { background: #14532d; color: #4ade80; }
  .badge-red { background: #450a0a; color: #f87171; }
  .badge-yellow { background: #422006; color: #fbbf24; }
  .badge-blue { background: #1e3a5f; color: #60a5fa; }
  .badge-gray { background: #1e293b; color: #94a3b8; }

  .progress-bar {
    height: 4px;
    background: #1e2d4a;
    border-radius: 2px;
    overflow: hidden;
    margin-top: 6px;
  }
  .progress-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .empty-state {
    text-align: center;
    padding: 32px;
    color: #475569;
    font-size: 12px;
  }

  .pipeline-steps {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 20px;
  }

  .step {
    flex: 1;
    background: #0d0d1a;
    border: 1px solid #1e2d4a;
    border-radius: 8px;
    padding: 12px;
    text-align: center;
  }

  .step.active { border-color: #3b82f6; background: #0f1f3d; }
  .step.done { border-color: #16a34a; background: #0f2d1a; }

  .step-num {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 4px;
  }

  .step-name { font-size: 10px; color: #64748b; text-transform: uppercase; }
  .step-status { font-size: 11px; margin-top: 4px; }

  .arrow { color: #1e2d4a; font-size: 18px; }

  .signal-card {
    background: #0d0d1a;
    border: 1px solid #1e2d4a;
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 10px;
  }

  .signal-card.buy-yes { border-left: 3px solid #22c55e; }
  .signal-card.buy-no { border-left: 3px solid #ef4444; }
  .signal-card.pass { border-left: 3px solid #475569; }

  .signal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
  }

  .signal-ticker { font-size: 11px; color: #60a5fa; font-weight: 600; }
  .signal-title { font-size: 11px; color: #94a3b8; margin-top: 2px; }

  .signal-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-top: 8px;
  }

  .signal-stat-label { font-size: 9px; color: #475569; text-transform: uppercase; }
  .signal-stat-value { font-size: 13px; font-weight: 600; color: #e2e8f0; margin-top: 2px; }

  .kb-item {
    padding: 8px 12px;
    background: #0a0f1a;
    border-radius: 6px;
    margin-bottom: 6px;
    font-size: 11px;
    color: #94a3b8;
    border-left: 2px solid #1e2d4a;
  }
  .kb-avoid { border-left-color: #ef4444; }
  .kb-success { border-left-color: #22c55e; }

  .scrollable { max-height: 300px; overflow-y: auto; }
  .scrollable::-webkit-scrollbar { width: 4px; }
  .scrollable::-webkit-scrollbar-track { background: #0a0a0f; }
  .scrollable::-webkit-scrollbar-thumb { background: #1e2d4a; border-radius: 2px; }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="logo">⚡</div>
    <div>
      <div class="title">KALSHI TRADING BOT</div>
      <div class="subtitle">AI-Powered Prediction Market System</div>
    </div>
  </div>
  <div class="status-bar">
    <div class="status-dot"></div>
    <span class="status-text">LIVE</span>
    <span class="last-update" id="lastUpdate">Loading...</span>
    <button class="refresh-btn" onclick="loadData()">↻ Refresh</button>
  </div>
</div>

<div class="main">

  <!-- Pipeline Status -->
  <div class="pipeline-steps" id="pipeline">
    <div class="step" id="step1">
      <div class="step-num">1</div>
      <div class="step-name">Scanner</div>
      <div class="step-status neutral">—</div>
    </div>
    <div class="arrow">→</div>
    <div class="step" id="step2">
      <div class="step-num">2</div>
      <div class="step-name">Research</div>
      <div class="step-status neutral">—</div>
    </div>
    <div class="arrow">→</div>
    <div class="step" id="step3">
      <div class="step-num">3</div>
      <div class="step-name">Predict</div>
      <div class="step-status neutral">—</div>
    </div>
    <div class="arrow">→</div>
    <div class="step" id="step4">
      <div class="step-num">4</div>
      <div class="step-name">Execute</div>
      <div class="step-status neutral">—</div>
    </div>
    <div class="arrow">→</div>
    <div class="step" id="step5">
      <div class="step-num">5</div>
      <div class="step-name">Compound</div>
      <div class="step-status neutral">—</div>
    </div>
  </div>

  <!-- Top Metrics -->
  <div class="grid-4" id="topMetrics">
    <div class="card">
      <div class="card-title">Bankroll</div>
      <div class="metric-value" id="bankroll">—</div>
      <div class="metric-sub" id="bankrollSub">Starting balance</div>
    </div>
    <div class="card">
      <div class="card-title">Total P&L</div>
      <div class="metric-value" id="totalPnl">—</div>
      <div class="metric-sub" id="pnlSub">All time</div>
    </div>
    <div class="card">
      <div class="card-title">Win Rate</div>
      <div class="metric-value" id="winRate">—</div>
      <div class="metric-sub">Target: 60%+</div>
    </div>
    <div class="card">
      <div class="card-title">Open Positions</div>
      <div class="metric-value" id="openPositions">—</div>
      <div class="metric-sub">Max: 15</div>
    </div>
  </div>

  <!-- Performance Metrics -->
  <div class="grid-4">
    <div class="card">
      <div class="card-title">Sharpe Ratio</div>
      <div class="metric-value" id="sharpe">—</div>
      <div class="metric-sub">Target: 2.0+</div>
      <div class="progress-bar"><div class="progress-fill" id="sharpeBar" style="background:#3b82f6;width:0%"></div></div>
    </div>
    <div class="card">
      <div class="card-title">Max Drawdown</div>
      <div class="metric-value" id="drawdown">—</div>
      <div class="metric-sub">Limit: 8%</div>
      <div class="progress-bar"><div class="progress-fill" id="drawdownBar" style="background:#ef4444;width:0%"></div></div>
    </div>
    <div class="card">
      <div class="card-title">Profit Factor</div>
      <div class="metric-value" id="profitFactor">—</div>
      <div class="metric-sub">Target: 1.5+</div>
      <div class="progress-bar"><div class="progress-fill" id="pfBar" style="background:#22c55e;width:0%"></div></div>
    </div>
    <div class="card">
      <div class="card-title">Brier Score</div>
      <div class="metric-value" id="brier">—</div>
      <div class="metric-sub">Target: &lt;0.25</div>
      <div class="progress-bar"><div class="progress-fill" id="brierBar" style="background:#8b5cf6;width:0%"></div></div>
    </div>
  </div>

  <div class="grid-2">
    <!-- Active Signals -->
    <div>
      <div class="section-title">Active Signals</div>
      <div id="signalsList">
        <div class="empty-state">No signals yet — run npm run predict</div>
      </div>
    </div>

    <!-- Open Positions -->
    <div>
      <div class="section-title">Open Positions</div>
      <div class="card">
        <div class="scrollable" id="positionsList">
          <div class="empty-state">No open positions</div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid-2">
    <!-- Top Markets -->
    <div>
      <div class="section-title">Top Scanned Markets</div>
      <div class="card">
        <div class="scrollable">
          <table id="marketsTable">
            <thead>
              <tr>
                <th>#</th>
                <th>Ticker</th>
                <th>Price</th>
                <th>Vol</th>
                <th>Days</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody id="marketsBody">
              <tr><td colspan="6" class="empty-state">Run npm run scan</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Research Briefs -->
    <div>
      <div class="section-title">Research Briefs</div>
      <div class="card">
        <div class="scrollable" id="researchList">
          <div class="empty-state">Run npm run research</div>
        </div>
      </div>
    </div>
  </div>

  <div class="grid-2">
    <!-- Trade History -->
    <div>
      <div class="section-title">Trade History</div>
      <div class="card">
        <div class="scrollable">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Action</th>
                <th>Entry</th>
                <th>P&L</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody id="tradeHistory">
              <tr><td colspan="5" class="empty-state">No closed trades yet</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Knowledge Base -->
    <div>
      <div class="section-title">Knowledge Base</div>
      <div class="card">
        <div id="kbStats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px;">
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:700;color:#f1f5f9" id="kbLessons">0</div>
            <div style="font-size:10px;color:#64748b">Lessons</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:700;color:#ef4444" id="kbBlacklist">0</div>
            <div style="font-size:10px;color:#64748b">Blacklisted</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:20px;font-weight:700;color:#22c55e" id="kbPatterns">0</div>
            <div style="font-size:10px;color:#64748b">Patterns</div>
          </div>
        </div>
        <div class="scrollable" id="kbList">
          <div class="empty-state">Run npm run compound</div>
        </div>
      </div>
    </div>
  </div>

</div>

<script>
  let data = {};

  async function loadData() {
    try {
      const res = await fetch('/api/data');
      data = await res.json();
      renderAll();
      document.getElementById('lastUpdate').textContent =
        'Updated ' + new Date().toLocaleTimeString();
    } catch(e) {
      console.error('Failed to load data:', e);
    }
  }

  function renderAll() {
    renderPipeline();
    renderMetrics();
    renderSignals();
    renderPositions();
    renderMarkets();
    renderResearch();
    renderTrades();
    renderKnowledgeBase();
  }

  function renderPipeline() {
    const steps = [
      { id: 'step1', data: data.scan, label: 'markets' },
      { id: 'step2', data: data.research, label: 'researched' },
      { id: 'step3', data: data.signals, label: 'signals' },
      { id: 'step4', data: data.execLog, label: 'executed' },
      { id: 'step5', data: data.kb, label: 'lessons' },
    ];

    steps.forEach(s => {
      const el = document.getElementById(s.id);
      const statusEl = el.querySelector('.step-status');
      if (s.data) {
        el.className = 'step done';
        statusEl.className = 'step-status positive';
        statusEl.textContent = '✓ Done';
      } else {
        el.className = 'step';
        statusEl.className = 'step-status neutral';
        statusEl.textContent = '— Pending';
      }
    });
  }

  function renderMetrics() {
    const p = data.portfolio;
    const m = data.metrics;

    if (p) {
      const bankroll = p.bankroll || 0;
      const starting = p.startingBankroll || 1000;
      const pnl = p.totalPnl || 0;
      const roi = ((bankroll - starting) / starting * 100);
      const wins = p.winCount || 0;
      const losses = p.lossCount || 0;
      const total = wins + losses;
      const wr = total > 0 ? (wins / total * 100) : 0;
      const open = (p.positions || []).filter(x => x.status === 'OPEN').length;

      document.getElementById('bankroll').textContent = '$' + bankroll.toFixed(2);
      document.getElementById('bankroll').className = 'metric-value';
      document.getElementById('bankrollSub').textContent =
        (roi >= 0 ? '+' : '') + roi.toFixed(1) + '% ROI';

      document.getElementById('totalPnl').textContent =
        (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
      document.getElementById('totalPnl').className =
        'metric-value ' + (pnl >= 0 ? 'positive' : 'negative');

      document.getElementById('winRate').textContent = wr.toFixed(1) + '%';
      document.getElementById('winRate').className =
        'metric-value ' + (wr >= 60 ? 'positive' : wr >= 50 ? 'warning' : 'negative');

      document.getElementById('openPositions').textContent = open + '/15';
    }

    if (m) {
      const sharpe = m.sharpeRatio || 0;
      const dd = m.maxDrawdown || 0;
      const pf = m.profitFactor || 0;
      const bs = m.brierScore || 0;

      document.getElementById('sharpe').textContent = sharpe.toFixed(2);
      document.getElementById('sharpe').className =
        'metric-value ' + (sharpe >= 2 ? 'positive' : sharpe >= 1 ? 'warning' : 'negative');
      document.getElementById('sharpeBar').style.width = Math.min(sharpe / 3 * 100, 100) + '%';

      document.getElementById('drawdown').textContent = dd.toFixed(1) + '%';
      document.getElementById('drawdown').className =
        'metric-value ' + (dd <= 8 ? 'positive' : dd <= 15 ? 'warning' : 'negative');
      document.getElementById('drawdownBar').style.width = Math.min(dd / 20 * 100, 100) + '%';

      document.getElementById('profitFactor').textContent = pf.toFixed(2);
      document.getElementById('profitFactor').className =
        'metric-value ' + (pf >= 1.5 ? 'positive' : pf >= 1 ? 'warning' : 'negative');
      document.getElementById('pfBar').style.width = Math.min(pf / 3 * 100, 100) + '%';

      document.getElementById('brier').textContent = bs.toFixed(4);
      document.getElementById('brier').className =
        'metric-value ' + (bs <= 0.25 ? 'positive' : bs <= 0.35 ? 'warning' : 'negative');
      document.getElementById('brierBar').style.width = Math.min(bs / 0.5 * 100, 100) + '%';
    }
  }

  function renderSignals() {
    const el = document.getElementById('signalsList');
    if (!data.signals || !data.signals.signals) {
      el.innerHTML = '<div class="empty-state">No signals yet — run npm run predict</div>';
      return;
    }

    const signals = data.signals.signals.filter(s => s.action !== 'PASS').slice(0, 5);
    if (signals.length === 0) {
      el.innerHTML = '<div class="empty-state">No actionable signals — all PASS</div>';
      return;
    }

    el.innerHTML = signals.map(s => {
      const cls = s.action === 'BUY_YES' ? 'buy-yes' : s.action === 'BUY_NO' ? 'buy-no' : 'pass';
      const badgeCls = s.action === 'BUY_YES' ? 'badge-green' : 'badge-red';
      const edge = s.edge ? (s.edge > 0 ? '+' : '') + s.edge.toFixed(1) + '%' : '—';
      return \`
        <div class="signal-card \${cls}">
          <div class="signal-header">
            <div>
              <div class="signal-ticker">\${s.ticker ? s.ticker.slice(0,45) : '—'}</div>
              <div class="signal-title">\${s.title ? s.title.slice(0,55) : '—'}</div>
            </div>
            <span class="badge \${badgeCls}">\${s.action}</span>
          </div>
          <div class="signal-stats">
            <div>
              <div class="signal-stat-label">Market</div>
              <div class="signal-stat-value">\${s.marketImpliedProb ? s.marketImpliedProb.toFixed(1) : '—'}%</div>
            </div>
            <div>
              <div class="signal-stat-label">AI Estimate</div>
              <div class="signal-stat-value">\${s.ensembleProbability ? s.ensembleProbability.toFixed(1) : '—'}%</div>
            </div>
            <div>
              <div class="signal-stat-label">Edge</div>
              <div class="signal-stat-value \${s.edge > 0 ? 'positive' : 'negative'}">\${edge}</div>
            </div>
            <div>
              <div class="signal-stat-label">Confidence</div>
              <div class="signal-stat-value">\${s.confidence ? (s.confidence*100).toFixed(0) : '—'}%</div>
            </div>
          </div>
        </div>
      \`;
    }).join('');
  }

  function renderPositions() {
    const el = document.getElementById('positionsList');
    if (!data.portfolio || !data.portfolio.positions) {
      el.innerHTML = '<div class="empty-state">No positions</div>';
      return;
    }
    const open = data.portfolio.positions.filter(p => p.status === 'OPEN');
    if (open.length === 0) {
      el.innerHTML = '<div class="empty-state">No open positions</div>';
      return;
    }
    el.innerHTML = open.map(p => \`
      <div style="padding:10px;border-bottom:1px solid #111827;">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="badge \${p.action === 'BUY_YES' ? 'badge-green' : 'badge-red'}">\${p.action}</span>
          <span style="font-size:11px;color:#64748b">\${p.contracts} contracts</span>
        </div>
        <div style="font-size:11px;color:#60a5fa;margin-top:6px">\${p.ticker ? p.ticker.slice(0,45) : '—'}</div>
        <div style="display:flex;justify-content:space-between;margin-top:4px">
          <span style="font-size:11px;color:#94a3b8">Entry: $\${p.entryPrice ? p.entryPrice.toFixed(4) : '—'}</span>
          <span style="font-size:11px;color:#94a3b8">Cost: $\${p.costBasis ? p.costBasis.toFixed(2) : '—'}</span>
        </div>
      </div>
    \`).join('');
  }

  function renderMarkets() {
    const tbody = document.getElementById('marketsBody');
    if (!data.scan || !data.scan.markets) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Run npm run scan</td></tr>';
      return;
    }
    const markets = data.scan.markets.slice(0, 15);
    tbody.innerHTML = markets.map((m, i) => \`
      <tr>
        <td style="color:#475569">\${i+1}</td>
        <td style="color:#60a5fa;font-size:10px">\${m.ticker ? m.ticker.slice(0,28) : '—'}</td>
        <td>\${m.lastPrice !== undefined ? '$'+m.lastPrice.toFixed(3) : '—'}</td>
        <td>\${m.volume !== undefined ? m.volume.toLocaleString() : '—'}</td>
        <td>\${m.daysToExpiry !== undefined ? m.daysToExpiry.toFixed(1)+'d' : '—'}</td>
        <td><span class="badge badge-blue">\${m.score !== undefined ? m.score.toFixed(3) : '—'}</span></td>
      </tr>
    \`).join('');
  }

  function renderResearch() {
    const el = document.getElementById('researchList');
    if (!data.research || !data.research.briefs) {
      el.innerHTML = '<div class="empty-state">Run npm run research</div>';
      return;
    }
    el.innerHTML = data.research.briefs.map(b => \`
      <div style="padding:10px;border-bottom:1px solid #111827;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:10px;color:#60a5fa">\${b.ticker ? b.ticker.slice(0,35) : '—'}</span>
          <span class="badge \${b.recommendation === 'BUY_YES' ? 'badge-green' : b.recommendation === 'BUY_NO' ? 'badge-red' : 'badge-gray'}">\${b.recommendation || 'PASS'}</span>
        </div>
        <div style="font-size:10px;color:#64748b;margin-bottom:6px">\${b.title ? b.title.slice(0,55) : '—'}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">
          <div style="font-size:10px">Market: <span style="color:#e2e8f0">\${b.marketImpliedProbability ? b.marketImpliedProbability.toFixed(1) : '—'}%</span></div>
          <div style="font-size:10px">AI: <span style="color:#e2e8f0">\${b.aiEstimatedProbability ? b.aiEstimatedProbability.toFixed(1) : '—'}%</span></div>
          <div style="font-size:10px">Edge: <span class="\${b.edge > 0 ? 'positive' : 'negative'}">\${b.edge ? (b.edge > 0 ? '+' : '') + b.edge.toFixed(1) + '%' : '—'}</span></div>
        </div>
      </div>
    \`).join('');
  }

  function renderTrades() {
    const tbody = document.getElementById('tradeHistory');
    if (!data.trades || data.trades.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No closed trades yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.trades.slice(-10).reverse().map(t => \`
      <tr>
        <td style="font-size:10px;color:#60a5fa">\${t.ticker ? t.ticker.slice(0,25) : '—'}</td>
        <td><span class="badge \${t.action === 'BUY_YES' ? 'badge-green' : 'badge-red'}">\${t.action || '—'}</span></td>
        <td>\${t.entryPrice !== undefined ? '$'+t.entryPrice.toFixed(4) : '—'}</td>
        <td class="\${t.pnl >= 0 ? 'positive' : 'negative'}">\${t.pnl !== undefined ? (t.pnl >= 0 ? '+' : '')+'$'+t.pnl.toFixed(2) : '—'}</td>
        <td><span class="badge \${t.pnl >= 0 ? 'badge-green' : 'badge-red'}">\${t.pnl >= 0 ? 'WIN' : 'LOSS'}</span></td>
      </tr>
    \`).join('');
  }

  function renderKnowledgeBase() {
    const kb = data.kb;
    if (!kb) return;

    document.getElementById('kbLessons').textContent = kb.totalLessons || 0;
    document.getElementById('kbBlacklist').textContent = (kb.marketBlacklist || []).length;
    document.getElementById('kbPatterns').textContent = (kb.successPatterns || []).length;

    const el = document.getElementById('kbList');
    const items = [];

    (kb.avoidPatterns || []).slice(-3).forEach(p => {
      items.push(\`<div class="kb-item kb-avoid">✗ \${p}</div>\`);
    });
    (kb.successPatterns || []).slice(-3).forEach(p => {
      items.push(\`<div class="kb-item kb-success">✓ \${p}</div>\`);
    });

    el.innerHTML = items.length > 0
      ? items.join('')
      : '<div class="empty-state">Run npm run compound to populate</div>';
  }

  // Load data immediately and refresh every 30 seconds
  loadData();
  setInterval(loadData, 30000);
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────
// HTTP SERVER
// ─────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === "/api/data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(getApiData());
    return;
  }

  // Serve dashboard for all other routes
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(getDashboardHtml());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`  KALSHI BOT DASHBOARD`);
  console.log(`${"═".repeat(55)}`);
  console.log(`  ✓ Server running at http://localhost:${PORT}`);
  console.log(`  ✓ Auto-refreshes every 30 seconds`);
  console.log(`\n  Open your browser and go to:`);
  console.log(`  → http://localhost:3000`);
  console.log(`\n  Keep this terminal open while using the dashboard.`);
  console.log(`  Press Ctrl+C to stop.`);
  console.log(`${"═".repeat(55)}\n`);
});