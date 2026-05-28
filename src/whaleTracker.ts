/**
 * ====================================================
 *  POLYMARKET WHALE TRACKER
 *  Monitors large wallets for BUY signals (non-sports)
 * ====================================================
 */

import * as fs from "fs";
import axios from "axios";

// ─── WHALE WALLETS ─────────────────────────────────────────
const WHALE_WALLETS: string[] = [
  "0xde7be6d489bce070a959e0cb813128ae659b5f4b", // wan123 - politics
  "0xd7f85d0eb0fe0732ca38d9107ad0d4d01b1289e4", // tdrhrhhd - politics/econ
  "0x96489abcb9f583d6835c8ef95ffc923d05a86825", // anoin123 - politics
  "0x6e1d5040d0ac73709b0621f620d2a60b80d2d0fa", // Anon - crypto
  "0xe8dd7741ccb12350957ec71e9ee332e0d1e6ec86", // influen - politics/econ
  "0xe734e7bf7cfb9e464681f71822f6c2f6be514f0c", // boyau - oil/politics
  "0x241f846866c2de4fb67cdb0ca6b963d85e56ef50", // Pestle - politics
  "0xfbfd14dd4bb607373119de95f1d4b21c3b6c0029", // XAE12A - economics/oil
  "0xee1706b93845d50ea60e49219be7311a2ebb6ea1", // jwerhor - geopolitics
  "0x2110ba2a1e18840109482ff4ddc547baeff45850", // George.S - tech/AI
  "0xd029b13f2e562c77e2db3e5eda140cee79a44fc1", // bignewsa - tech
];

// ─── FILTERS ───────────────────────────────────────────────
const SPORTS_KEYWORDS = [
  "dota", "nba", "nfl", "mlb", "nhl", "soccer", "football",
  "basketball", "esport", "gaming",
  "up or down", "bitcoin up", "ethereum up", "15 min", "5 min", "1 hour",
  "iem", "cologne", "major", "billboard", "netflix", "tweet", "post from",
];

const MIN_USDC_SIZE = 5;

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ─── TYPES ─────────────────────────────────────────────────
interface PolymarketActivity {
  type: string;   // "TRADE"
  side: string;   // "BUY" or "SELL"
  conditionId: string;
  title: string;
  outcome: string;
  price: number;
  usdcSize: number;
  timestamp: number; // unix seconds
}

export interface WhaleSignal {
  walletAddress: string;
  conditionId: string;
  title: string;
  outcome: string;
  price: number;
  usdcSize: number;
  timestamp: number;
}

// ─── HELPERS ───────────────────────────────────────────────
function isSports(title: string): boolean {
  const lower = title.toLowerCase();
  return SPORTS_KEYWORDS.some((kw) => lower.includes(kw));
}

function isRecent(timestampSeconds: number): boolean {
  return Date.now() - timestampSeconds * 1000 < TWENTY_FOUR_HOURS_MS;
}

// ─── FETCHER ───────────────────────────────────────────────
async function fetchWalletActivity(address: string): Promise<PolymarketActivity[]> {
  const url = `https://data-api.polymarket.com/activity?user=${address}&limit=20`;
  const resp = await axios.get<PolymarketActivity[]>(url, { timeout: 10_000 });
  return Array.isArray(resp.data) ? resp.data : [];
}

// ─── MAIN ──────────────────────────────────────────────────
export async function getWhaleSignals(): Promise<WhaleSignal[]> {
  const signals: WhaleSignal[] = [];

  for (const address of WHALE_WALLETS) {
    try {
      const activity = await fetchWalletActivity(address);

      for (const tx of activity) {
        if (tx.side?.toUpperCase() !== "BUY") continue;
        if (!isRecent(tx.timestamp)) continue;
        if (isSports(tx.title ?? "")) continue;
        if ((tx.usdcSize ?? 0) < MIN_USDC_SIZE) continue;

        signals.push({
          walletAddress: address,
          conditionId: tx.conditionId,
          title: tx.title,
          outcome: tx.outcome,
          price: tx.price,
          usdcSize: tx.usdcSize,
          timestamp: tx.timestamp,
        });
      }
    } catch (err) {
      console.warn(`[whaleTracker] Failed to fetch activity for ${address}: ${(err as Error).message}`);
    }
  }

  // Most recent first
  signals.sort((a, b) => b.timestamp - a.timestamp);

  // Persist so scanner/predictor can load whale context without re-fetching
  fs.writeFileSync("whale_signals.json", JSON.stringify(signals, null, 2));

  return signals;
}

// ─── ENTRYPOINT (standalone run) ───────────────────────────
async function main() {
  console.log("Fetching whale activity from Polymarket...\n");
  const signals = await getWhaleSignals();

  if (!signals.length) {
    console.log("No qualifying BUY signals in the last 24h.");
    return;
  }

  console.log(`Found ${signals.length} signal(s):\n`);
  for (const s of signals) {
    const time = new Date(s.timestamp * 1000).toLocaleString();
    console.log(`  [${time}] ${s.walletAddress.slice(0, 10)}…`);
    console.log(`    Market : ${s.title}`);
    console.log(`    Outcome: ${s.outcome} @ $${s.price.toFixed(3)}`);
    console.log(`    Size   : $${s.usdcSize.toLocaleString()} USDC\n`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[FATAL]", err.message);
    process.exit(1);
  });
}
