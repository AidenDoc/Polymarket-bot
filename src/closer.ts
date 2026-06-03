/**
 * ====================================================
 *  STEP 7: CLOSER  (paper mode — international Gamma)
 *  Resolves paper positions and books P&L.
 *
 *  Why the old one never closed anything:
 *   1. queried Gamma with `conditionId` — the real filter is `condition_ids`
 *   2. read `outcomePrices` as an array — Gamma returns it as a JSON STRING
 *   3. trusted `market.resolved` / `closed` — Gamma reports resolved markets
 *      as closed:false. The reliable signal is prices pinned to ~0.99/0.01.
 *
 *  This version logs WHY each position did or didn't resolve, so nothing
 *  fails silently again. Read-only; no orders, no wallet.
 *  Run:  npx ts-node src/closer.ts
 * ====================================================
 */
import * as fs from "fs";
import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const GAMMA_API         = "https://gamma-api.polymarket.com";
const STARTING_BANKROLL = parseFloat(process.env.STARTING_BANKROLL ?? "1000");
const PIN_HI            = 0.99;   // price >= this => that side won
const PIN_LO            = 0.01;

const OPEN_POSITIONS_FILE = "open_positions.json";
const TRADE_HISTORY_FILE  = "trade_history.json";
const PERFORMANCE_FILE    = "performance_metrics.json";
const PORTFOLIO_FILE      = "portfolio.json";

interface OpenPosition {
  conditionId: string; question: string;
  action: "BUY_YES" | "BUY_NO"; tokenId?: string;
  price: number; sizeUsdc: number; openedAt: string; paper: boolean;
}
interface ClosedRecord extends OpenPosition {
  closedAt: string; exitPrice: number; pnl: number; outcome: "WIN" | "LOSS" | "PUSH";
}

function loadJson<T>(file: string, fb: T): T {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  return fb;
}
function saveJson(file: string, data: unknown) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function parsePrices(raw: any): number[] {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(Number) : []; } catch { return []; } }
  return [];
}

interface Status { found: boolean; resolved: boolean; yesWon: boolean; noWon: boolean; yes: number; no: number; basis: string; }

async function getMarketStatus(conditionId: string): Promise<Status> {
  const blank: Status = { found: false, resolved: false, yesWon: false, noWon: false, yes: NaN, no: NaN, basis: "not-found" };
  try {
    const res = await axios.get(`${GAMMA_API}/markets`, { params: { condition_ids: conditionId }, timeout: 10000 });
    const list: any[] = Array.isArray(res.data) ? res.data : (res.data?.markets ?? [res.data]);
    const m = list.find((x: any) => x?.conditionId === conditionId) ?? list[0];
    if (!m || !m.conditionId) return blank;

    const prices = parsePrices(m.outcomePrices);          // [YES, NO]
    const yes = prices[0] ?? NaN, no = prices[1] ?? NaN;
    const uma = String(m.umaResolutionStatus ?? "").toLowerCase();
    const umaResolved = uma === "resolved" || uma === "settled" || uma === "final";

    const pinned = (yes >= PIN_HI && no <= PIN_LO) || (yes <= PIN_LO && no >= PIN_HI);
    const resolved = pinned || umaResolved;

    const yesWon = resolved && yes >= PIN_HI;
    const noWon  = resolved && no  >= PIN_HI;
    const basis  = pinned ? `pinned(${yes.toFixed(3)}/${no.toFixed(3)})` : umaResolved ? `uma=${uma}` : `open uma=${uma || "n/a"} closed=${m.closed}`;
    return { found: true, resolved, yesWon, noWon, yes, no, basis };
  } catch (e: any) {
    console.log(`    Gamma error: ${e.response ? `HTTP ${e.response.status}` : e.message}`);
    return blank;
  }
}

function calcPnl(p: OpenPosition, yesWon: boolean, noWon: boolean) {
  const tokens = p.price > 0 ? p.sizeUsdc / p.price : 0;
  const won  = (p.action === "BUY_YES" && yesWon) || (p.action === "BUY_NO" && noWon);
  const lost = (p.action === "BUY_YES" && noWon) || (p.action === "BUY_NO" && yesWon);
  if (won)  return { pnl: tokens * 1.0 - p.sizeUsdc, exitPrice: 1.0, outcome: "WIN"  as const };
  if (lost) return { pnl: -p.sizeUsdc,               exitPrice: 0.0, outcome: "LOSS" as const };
  return { pnl: 0, exitPrice: p.price, outcome: "PUSH" as const };
}

function writeMetrics(history: ClosedRecord[], stillOpen: OpenPosition[]) {
  const n = history.length; if (!n) return;
  const wins = history.filter(r => r.outcome === "WIN").length;
  const losses = history.filter(r => r.outcome === "LOSS").length;
  const totalPnl = history.reduce((a, r) => a + r.pnl, 0);
  saveJson(PERFORMANCE_FILE, {
    timestamp: new Date().toISOString(), totalTrades: n, wins, losses,
    winRate: wins / n, totalPnl, roi: (totalPnl / STARTING_BANKROLL) * 100,
    bankroll: STARTING_BANKROLL + totalPnl,
  });
  const cashInTrade = stillOpen.reduce((a, p) => a + p.sizeUsdc, 0);
  saveJson(PORTFOLIO_FILE, {
    bankroll: STARTING_BANKROLL + totalPnl, startingBankroll: STARTING_BANKROLL,
    cashAvailable: STARTING_BANKROLL + totalPnl - cashInTrade, totalPnl,
    winCount: wins, lossCount: losses, openPositions: stillOpen.length,
    lastUpdated: new Date().toISOString(),
  });
}

async function main() {
  console.log("\n" + "=".repeat(64) + "\n  STEP 7: CLOSER (paper)\n" + "=".repeat(64));
  const open = loadJson<OpenPosition[]>(OPEN_POSITIONS_FILE, []);
  if (!open.length) { console.log("  No open positions.\n"); return; }
  console.log(`  Checking ${open.length} position(s)...\n`);

  const history = loadJson<ClosedRecord[]>(TRADE_HISTORY_FILE, []).filter((r: any) => r.closedAt) as ClosedRecord[];
  const stillOpen: OpenPosition[] = [];
  let closed = 0;

  for (const p of open) {
    const label = p.question.slice(0, 48);
    const s = await getMarketStatus(p.conditionId);

    if (!s.found) { console.log(`  ? ${p.action} ${label}\n    NOT FOUND on Gamma for conditionId ${p.conditionId.slice(0, 18)}... (is it a real Polymarket id?)`); stillOpen.push(p); continue; }
    if (!s.resolved) { console.log(`  · ${p.action} ${label}\n    still open — ${s.basis}`); stillOpen.push(p); continue; }

    const { pnl, exitPrice, outcome } = calcPnl(p, s.yesWon, s.noWon);
    history.push({ ...p, closedAt: new Date().toISOString(), exitPrice, pnl, outcome });
    closed++;
    const mark = outcome === "WIN" ? "✓" : outcome === "LOSS" ? "✗" : "–";
    console.log(`  ${mark} ${p.action} ${label}\n    ${outcome} | P&L ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} | ${s.basis}`);
    await new Promise(r => setTimeout(r, 250));
  }

  saveJson(OPEN_POSITIONS_FILE, stillOpen);
  saveJson(TRADE_HISTORY_FILE, history);
  if (closed) writeMetrics(history, stillOpen);

  const totalPnl = history.reduce((a, r) => a + r.pnl, 0);
  const wins = history.filter(r => r.outcome === "WIN").length;
  const losses = history.filter(r => r.outcome === "LOSS").length;
  console.log("\n" + "=".repeat(64));
  console.log(`  Closed now: ${closed} | still open: ${stillOpen.length}`);
  console.log(`  All-time: ${wins}W / ${losses}L | P&L ${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)} | bankroll $${(STARTING_BANKROLL + totalPnl).toFixed(2)}`);
  console.log("=".repeat(64) + "\n");
}

main().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
