/**
 * ====================================================
 *  POLYMARKET TRADING BOT — STEP 5: EXECUTOR
 *  Reads predictor signals → places Polymarket CLOB orders
 * ====================================================
 *
 * Prerequisites:
 *   npm install ethers
 *
 * How to run:
 *   npx ts-node src/executor.ts
 *
 * Paper mode is ON by default. To trade live:
 *   Set PAPER_TRADING=false in your .env file
 * ====================================================
 */

import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import axios from "axios";
import { ethers } from "ethers";

dotenv.config();

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────

const PAPER_TRADING      = process.env.PAPER_TRADING !== "false";
const MAX_OPEN_POSITIONS = parseInt(process.env.MAX_OPEN_POSITIONS ?? "15");
const POLYGON_PRIVATE_KEY = process.env.POLYGON_PRIVATE_KEY ?? "";
const TELEGRAM_TOKEN     = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID ?? "";

const CLOB_BASE_URL       = "https://clob.polymarket.com";
// CTF Exchange on Polygon mainnet (binary markets)
const CTF_EXCHANGE        = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const CHAIN_ID            = 137;
const USDC_DECIMALS       = 6;
const KILL_SWITCH_FILE    = "STOP";

const PREDICTOR_RESULTS_FILE = "predictor_results.json";
const OPEN_POSITIONS_FILE    = "open_positions.json";
const TRADE_HISTORY_FILE     = "trade_history.json";

// ─────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────

interface TradeSignal {
  conditionId: string;
  question: string;
  marketPrice: number;
  marketImpliedProb: number;
  ensembleProbability: number;
  edge: number;
  action: "BUY_YES" | "BUY_NO" | "PASS";
  confidence: number;
  suggestedPositionSize: number;
  riskFlags: string[];
  reasoning: string;
  clobTokenIds: string[];
  timestamp: string;
}

interface OpenPosition {
  conditionId: string;
  question: string;
  action: "BUY_YES" | "BUY_NO";
  tokenId: string;
  price: number;
  sizeUsdc: number;
  openedAt: string;
  orderId?: string;
  paper: boolean;
}

interface TradeRecord {
  conditionId: string;
  question: string;
  action: "BUY_YES" | "BUY_NO";
  price: number;
  size: number;
  timestamp: string;
  txHash?: string;
  paper: boolean;
}

interface OrderResult {
  success: boolean;
  orderId?: string;
  txHash?: string;
  error?: string;
}

// ─────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────

function log(msg: string, level: "INFO" | "WARN" | "ERROR" = "INFO"): void {
  const ts = new Date().toLocaleTimeString();
  const prefix = level === "ERROR" ? "[ERR] " : level === "WARN" ? "[WARN]" : "[OK]  ";
  console.log(`  [${ts}] ${prefix} ${msg}`);
}

function loadJson<T>(file: string, fallback: T): T {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {}
  return fallback;
}

function saveJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─────────────────────────────────────────────────
// TELEGRAM
// ─────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<void> {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" },
      { timeout: 8000 }
    );
  } catch {
    // Non-critical — swallow silently
  }
}

// ─────────────────────────────────────────────────
// CLOB API AUTH (L1 — EOA personal sign)
// ─────────────────────────────────────────────────

async function buildAuthHeaders(wallet: ethers.Wallet): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await wallet.signMessage(timestamp);
  return {
    "POLY_ADDRESS":   wallet.address,
    "POLY_SIGNATURE": signature,
    "POLY_TIMESTAMP": timestamp,
    "POLY_NONCE":     "",
    "Content-Type":   "application/json",
  };
}

// ─────────────────────────────────────────────────
// CLOB API: BEST PRICE
// ─────────────────────────────────────────────────

async function getBestPrice(tokenId: string, side: "buy" | "sell"): Promise<number | null> {
  try {
    const res = await axios.get(`${CLOB_BASE_URL}/price`, {
      params: { token_id: tokenId, side },
      timeout: 8000,
    });
    const price = parseFloat(res.data?.price ?? "0");
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────
// EIP-712 ORDER SIGNING
// ─────────────────────────────────────────────────

const ORDER_DOMAIN = {
  name:              "Polymarket CTF Exchange",
  version:           "1",
  chainId:           CHAIN_ID,
  verifyingContract: CTF_EXCHANGE,
} as const;

const ORDER_TYPES = {
  Order: [
    { name: "salt",          type: "uint256" },
    { name: "maker",         type: "address" },
    { name: "signer",        type: "address" },
    { name: "taker",         type: "address" },
    { name: "tokenId",       type: "uint256" },
    { name: "makerAmount",   type: "uint256" },
    { name: "takerAmount",   type: "uint256" },
    { name: "expiration",    type: "uint256" },
    { name: "nonce",         type: "uint256" },
    { name: "feeRateBps",    type: "uint256" },
    { name: "side",          type: "uint8"   },
    { name: "signatureType", type: "uint8"   },
  ],
};

interface ClobOrderStruct {
  salt:          bigint;
  maker:         string;
  signer:        string;
  taker:         string;
  tokenId:       bigint;
  makerAmount:   bigint;
  takerAmount:   bigint;
  expiration:    bigint;
  nonce:         bigint;
  feeRateBps:    bigint;
  side:          number;
  signatureType: number;
}

function buildOrder(
  walletAddress: string,
  tokenId: string,
  sizeUsdc: number,
  price: number,
  side: 0 | 1  // 0 = BUY, 1 = SELL
): ClobOrderStruct {
  // BUY: makerAmount = USDC spent, takerAmount = tokens received
  const makerAmount = BigInt(Math.round(sizeUsdc * 10 ** USDC_DECIMALS));
  const takerAmount = price > 0
    ? BigInt(Math.round((sizeUsdc / price) * 10 ** USDC_DECIMALS))
    : BigInt(0);

  return {
    salt:          BigInt("0x" + crypto.randomBytes(32).toString("hex")) >> BigInt(1),
    maker:         walletAddress,
    signer:        walletAddress,
    taker:         "0x0000000000000000000000000000000000000000",
    tokenId:       BigInt(tokenId),
    makerAmount,
    takerAmount,
    expiration:    BigInt(0),  // 0 = FOK (no expiry, cancel if not filled)
    nonce:         BigInt(0),
    feeRateBps:    BigInt(0),
    side,
    signatureType: 0,          // 0 = EOA
  };
}

async function signAndSubmitOrder(
  wallet: ethers.Wallet,
  tokenId: string,
  sizeUsdc: number,
  price: number
): Promise<OrderResult> {
  try {
    const order = buildOrder(wallet.address, tokenId, sizeUsdc, price, 0);

    // ethers v6: signTypedData | ethers v5: _signTypedData
    const signature = await (wallet as any).signTypedData
      ? wallet.signTypedData(ORDER_DOMAIN, ORDER_TYPES, order)
      : (wallet as any)._signTypedData(ORDER_DOMAIN, ORDER_TYPES, order);

    const authHeaders = await buildAuthHeaders(wallet);

    const body = {
      order: {
        salt:          order.salt.toString(),
        maker:         order.maker,
        signer:        order.signer,
        taker:         order.taker,
        tokenId:       order.tokenId.toString(),
        makerAmount:   order.makerAmount.toString(),
        takerAmount:   order.takerAmount.toString(),
        expiration:    order.expiration.toString(),
        nonce:         order.nonce.toString(),
        feeRateBps:    order.feeRateBps.toString(),
        side:          order.side,
        signatureType: order.signatureType,
      },
      signature,
      owner:     wallet.address,
      orderType: "FOK",
    };

    const res = await axios.post(`${CLOB_BASE_URL}/order`, body, {
      headers: authHeaders,
      timeout: 15000,
    });

    const data = res.data;
    if (data.success !== false && (data.orderID ?? data.order_id ?? data.transactionHash)) {
      return {
        success: true,
        orderId: data.orderID ?? data.order_id,
        txHash:  data.transactionHash,
      };
    }

    return { success: false, error: JSON.stringify(data) };
  } catch (e: any) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    return { success: false, error: detail };
  }
}

// ─────────────────────────────────────────────────
// POSITION & HISTORY HELPERS
// ─────────────────────────────────────────────────

function loadOpenPositions(): OpenPosition[] {
  return loadJson<OpenPosition[]>(OPEN_POSITIONS_FILE, []);
}

function isAlreadyTraded(positions: OpenPosition[], conditionId: string): boolean {
  return positions.some((p) => p.conditionId === conditionId);
}

function appendTradeRecord(record: TradeRecord): void {
  const history = loadJson<TradeRecord[]>(TRADE_HISTORY_FILE, []);
  history.push(record);
  saveJson(TRADE_HISTORY_FILE, history);
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + "═".repeat(65));
  console.log("  STEP 5: EXECUTOR");
  console.log(`  Mode: ${PAPER_TRADING ? "PAPER TRADING (no real orders)" : "LIVE TRADING (real money)"}`);
  console.log("═".repeat(65) + "\n");

  if (fs.existsSync(KILL_SWITCH_FILE)) {
    log("Kill switch active — execution halted", "WARN");
    process.exit(0);
  }

  // ── Wallet setup (live mode only) ──────────────
  let wallet: ethers.Wallet | null = null;
  if (!PAPER_TRADING) {
    if (!POLYGON_PRIVATE_KEY) {
      log("POLYGON_PRIVATE_KEY not set in .env — cannot run live", "ERROR");
      process.exit(1);
    }
    wallet = new ethers.Wallet(POLYGON_PRIVATE_KEY);
    log(`Wallet: ${wallet.address}`);
  }

  // ── Load signals ───────────────────────────────
  const signalFile = fs.existsSync(PREDICTOR_RESULTS_FILE)
    ? PREDICTOR_RESULTS_FILE
    : "signal_results.json";

  if (!fs.existsSync(signalFile)) {
    log(`No signal file found (expected ${PREDICTOR_RESULTS_FILE})`, "ERROR");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(signalFile, "utf-8"));
  const signals: TradeSignal[] = (raw.signals ?? []).filter(
    (s: TradeSignal) => s.action === "BUY_YES" || s.action === "BUY_NO"
  );

  if (signals.length === 0) {
    log("No actionable signals (BUY_YES / BUY_NO) in signal file");
    process.exit(0);
  }

  log(`${signals.length} actionable signal(s) to evaluate`);

  const openPositions = loadOpenPositions();
  log(`Open positions: ${openPositions.length} / ${MAX_OPEN_POSITIONS}`);

  let executed = 0;
  let skipped  = 0;

  for (const signal of signals) {
    const label = (signal.question ?? signal.conditionId).slice(0, 55);
    console.log(`\n  ── ${signal.action} | ${label}`);
    console.log(
      `     Edge: ${signal.edge > 0 ? "+" : ""}${signal.edge.toFixed(1)}%` +
      `  Confidence: ${(signal.confidence * 100).toFixed(0)}%` +
      `  Size: $${signal.suggestedPositionSize}`
    );

    if (fs.existsSync(KILL_SWITCH_FILE)) {
      log("Kill switch triggered mid-run — stopping", "WARN");
      break;
    }

    if (openPositions.length >= MAX_OPEN_POSITIONS) {
      log(`Max open positions (${MAX_OPEN_POSITIONS}) reached — skipping`, "WARN");
      skipped++;
      continue;
    }

    if (isAlreadyTraded(openPositions, signal.conditionId)) {
      log(`Already have a position in conditionId ${signal.conditionId} — skipping`);
      skipped++;
      continue;
    }

    if (!Array.isArray(signal.clobTokenIds) || signal.clobTokenIds.length < 2) {
      log(`Missing clobTokenIds on signal for ${signal.conditionId} — skipping`, "WARN");
      skipped++;
      continue;
    }

    const tokenId  = signal.action === "BUY_YES" ? signal.clobTokenIds[0] : signal.clobTokenIds[1];
    const sizeUsdc = signal.suggestedPositionSize;

    // ── Determine fill price ───────────────────────
    let price: number;
    if (PAPER_TRADING) {
      price = signal.marketPrice;
    } else {
      const fetched = await getBestPrice(tokenId, "buy");
      if (fetched === null) {
        log(`Could not fetch price for token ${tokenId.slice(0, 16)}... — skipping`, "WARN");
        skipped++;
        continue;
      }
      price = fetched;
    }

    log(`  tokenId: ${tokenId.slice(0, 18)}...  price: $${price.toFixed(4)}  size: $${sizeUsdc}`);

    const action = signal.action as "BUY_YES" | "BUY_NO";

    const position: OpenPosition = {
      conditionId: signal.conditionId,
      question:    signal.question,
      action,
      tokenId,
      price,
      sizeUsdc,
      openedAt:    new Date().toISOString(),
      paper:       PAPER_TRADING,
    };

    const record: TradeRecord = {
      conditionId: signal.conditionId,
      question:    signal.question,
      action,
      price,
      size:        sizeUsdc,
      timestamp:   new Date().toISOString(),
      paper:       PAPER_TRADING,
    };

    if (PAPER_TRADING) {
      openPositions.push(position);
      appendTradeRecord(record);
      executed++;

      log(`PAPER TRADE logged: ${signal.action} $${sizeUsdc} @ $${price.toFixed(4)}`);
      await sendTelegram(
        `📝 <b>PAPER TRADE</b>\n` +
        `${signal.action === "BUY_YES" ? "🟢" : "🔴"} <b>${signal.action}</b>\n` +
        `📊 ${label}\n` +
        `💵 Size: $${sizeUsdc.toFixed(2)}\n` +
        `📈 Price: $${price.toFixed(4)}\n` +
        `🎯 Edge: ${signal.edge > 0 ? "+" : ""}${signal.edge.toFixed(1)}%  ` +
        `Conf: ${(signal.confidence * 100).toFixed(0)}%`
      );
    } else {
      log(`Placing LIVE FOK order...`);
      const result = await signAndSubmitOrder(wallet!, tokenId, sizeUsdc, price);

      if (result.success) {
        position.orderId = result.orderId;
        record.txHash    = result.txHash ?? result.orderId;
        openPositions.push(position);
        appendTradeRecord(record);
        executed++;

        log(`LIVE order filled: orderId=${result.orderId}  tx=${result.txHash ?? "—"}`);
        await sendTelegram(
          `💰 <b>LIVE TRADE EXECUTED</b>\n` +
          `${signal.action === "BUY_YES" ? "🟢" : "🔴"} <b>${signal.action}</b>\n` +
          `📊 ${label}\n` +
          `💵 Size: $${sizeUsdc.toFixed(2)}\n` +
          `📈 Price: $${price.toFixed(4)}\n` +
          `🎯 Edge: ${signal.edge > 0 ? "+" : ""}${signal.edge.toFixed(1)}%\n` +
          `🔗 Order: ${result.orderId ?? "—"}`
        );
      } else {
        skipped++;
        log(`Order failed: ${result.error}`, "ERROR");
        await sendTelegram(
          `❌ <b>ORDER FAILED</b>\n` +
          `${signal.action} — ${label}\n` +
          `Error: ${(result.error ?? "unknown").slice(0, 120)}`
        );
      }
    }
  }

  // ── Persist & summarize ────────────────────────
  saveJson(OPEN_POSITIONS_FILE, openPositions);

  const execLog = loadJson<any[]>("execution_log.json", []);
  execLog.push({
    timestamp:        new Date().toISOString(),
    mode:             PAPER_TRADING ? "paper" : "live",
    signalsEvaluated: signals.length,
    executed,
    skipped,
    openPositions:    openPositions.length,
  });
  if (execLog.length > 500) execLog.splice(0, execLog.length - 500);
  saveJson("execution_log.json", execLog);

  console.log("\n" + "═".repeat(65));
  console.log(`  Executed: ${executed}  |  Skipped/Failed: ${skipped}`);
  console.log(`  Open positions: ${openPositions.length} / ${MAX_OPEN_POSITIONS}`);
  if (PAPER_TRADING) {
    console.log("  (Paper mode — no real money spent)");
    console.log("  Set PAPER_TRADING=false in .env to trade live");
  }
  console.log("═".repeat(65) + "\n");
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});
