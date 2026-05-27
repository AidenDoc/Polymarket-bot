/**
 * ====================================================
 *  PREDICTION MARKET TRADING BOT — SENTIMENT AGENT
 *  Fetches real-time news and sentiment for markets
 *  before the predictor runs to improve AI accuracy
 * ====================================================
 */

import * as fs from "fs";
import * as https from "https";
import * as dotenv from "dotenv";

dotenv.config();

const NEWS_API_KEY = process.env.NEWS_API_KEY ?? "";
const SENTIMENT_FILE = "sentiment_results.json";
const RESEARCH_FILE = "research_results.json";

interface NewsItem {
  title: string;
  source: string;
  snippet: string;
  publishedAt: string;
  url: string;
}

interface MarketSentiment {
  conditionId: string;
  question: string;
  newsItems: NewsItem[];
  sentimentScore: number;
  keyTopics: string[];
  bullishSignals: string[];
  bearishSignals: string[];
  confidence: number;
  timestamp: string;
}

function httpsGet(hostname: string, urlPath: string, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = { hostname, path: urlPath, method: "GET", headers, timeout: 10000 };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

function extractKeywords(title: string): string[] {
  // Extract meaningful keywords from market title
  const stopWords = new Set(["the", "a", "an", "is", "will", "by", "in", "on", "at", "to", "for", "of", "and", "or", "be", "above", "below", "than", "more", "less"]);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))
    .slice(0, 5);
}

async function fetchNewsForMarket(title: string): Promise<NewsItem[]> {
  const keywords = extractKeywords(title);
  const query = keywords.slice(0, 3).join(" ");

  if (!query || query.length < 5) return [];

  try {
    if (NEWS_API_KEY) {
      // Use NewsAPI if key available
      const encodedQuery = encodeURIComponent(query);
      const urlPath = `/v2/everything?q=${encodedQuery}&sortBy=publishedAt&pageSize=5&language=en&apiKey=${NEWS_API_KEY}`;
      const data = await httpsGet("newsapi.org", urlPath);

      if (data.articles) {
        return data.articles.map((a: any) => ({
          title: a.title ?? "",
          source: a.source?.name ?? "Unknown",
          snippet: (a.description ?? "").slice(0, 200),
          publishedAt: a.publishedAt ?? "",
          url: a.url ?? "",
        }));
      }
    }

    // Fallback: use free RSS/news search
    const encodedQuery = encodeURIComponent(query);
    const urlPath = `/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;
    const data = await httpsGet("news.google.com", urlPath);
    return [];

  } catch {
    return [];
  }
}

function analyzeSentiment(newsItems: NewsItem[], marketTitle: string): {
  score: number;
  bullishSignals: string[];
  bearishSignals: string[];
  keyTopics: string[];
} {
  const bullishWords = ["win", "pass", "approve", "rise", "increase", "higher", "yes", "confirm", "likely", "expected", "positive", "strong", "beat", "exceed", "growth"];
  const bearishWords = ["lose", "fail", "reject", "fall", "decrease", "lower", "no", "deny", "unlikely", "unexpected", "negative", "weak", "miss", "below", "decline"];

  const bullishSignals: string[] = [];
  const bearishSignals: string[] = [];
  const keyTopics: string[] = [];

  let bullishCount = 0;
  let bearishCount = 0;

  for (const item of newsItems) {
    const text = (item.title + " " + item.snippet).toLowerCase();

    for (const word of bullishWords) {
      if (text.includes(word)) {
        bullishCount++;
        if (!bullishSignals.includes(word)) bullishSignals.push(word);
      }
    }

    for (const word of bearishWords) {
      if (text.includes(word)) {
        bearishCount++;
        if (!bearishSignals.includes(word)) bearishSignals.push(word);
      }
    }

    // Extract key topics from titles
    const titleWords = item.title.split(" ").filter(w => w.length > 5).slice(0, 3);
    keyTopics.push(...titleWords);
  }

  const total = bullishCount + bearishCount;
  const score = total > 0 ? (bullishCount - bearishCount) / total : 0;

  return {
    score: Math.max(-1, Math.min(1, score)),
    bullishSignals: bullishSignals.slice(0, 5),
    bearishSignals: bearishSignals.slice(0, 5),
    keyTopics: [...new Set(keyTopics)].slice(0, 10),
  };
}

async function main(): Promise<void> {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SENTIMENT AGENT`);
  console.log(`  Fetching real-time news for open markets...`);
  console.log(`${"═".repeat(60)}`);

  // Load research results to get market titles
  if (!fs.existsSync(RESEARCH_FILE)) {
    console.log("  No research results found — run scanner first");
    return;
  }

  const researchData = JSON.parse(fs.readFileSync(RESEARCH_FILE, "utf-8"));
  const briefs = researchData.briefs ?? [];

  if (briefs.length === 0) {
    console.log("  No markets to analyze");
    return;
  }

  console.log(`  Analyzing sentiment for ${briefs.length} markets...`);
  const results: MarketSentiment[] = [];

  for (const brief of briefs) {
    console.log(`  [${results.length + 1}/${briefs.length}] ${brief.question?.slice(0, 40)}...`);

    const newsItems = await fetchNewsForMarket(brief.question ?? "");
    const { score, bullishSignals, bearishSignals, keyTopics } = analyzeSentiment(newsItems, brief.question ?? "");

    results.push({
      conditionId: brief.conditionId,
      question: brief.question,
      newsItems,
      sentimentScore: score,
      keyTopics,
      bullishSignals,
      bearishSignals,
      confidence: newsItems.length > 3 ? 0.8 : newsItems.length > 0 ? 0.5 : 0.2,
      timestamp: new Date().toISOString(),
    });

    const emoji = score > 0.2 ? "📈" : score < -0.2 ? "📉" : "➖";
    console.log(`  ${emoji} Sentiment: ${score.toFixed(2)} | News items: ${newsItems.length} | Signals: +${bullishSignals.length}/-${bearishSignals.length}`);

    await new Promise(r => setTimeout(r, 500));
  }

  // Save sentiment results
  const output = {
    timestamp: new Date().toISOString(),
    marketsAnalyzed: results.length,
    results,
  };

  fs.writeFileSync(SENTIMENT_FILE, JSON.stringify(output, null, 2));

  // Merge sentiment back into research results
  for (const brief of briefs) {
    const sentiment = results.find(r => r.conditionId === brief.conditionId);
    if (sentiment) {
      brief.sentimentScore = sentiment.sentimentScore;
      brief.newsItems = [...(brief.newsItems ?? []), ...sentiment.newsItems].slice(0, 10);
    }
  }

  fs.writeFileSync(RESEARCH_FILE, JSON.stringify(researchData, null, 2));

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ✓ Sentiment analysis complete for ${results.length} markets`);
  console.log(`  ✓ Research results enriched with news data`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("[FATAL]", err.message);
  process.exit(1);
});