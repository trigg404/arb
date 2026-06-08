/**
 * CEX Arbitrage Scanner v3 — Auto Discovery Mode
 * Fetches ALL trading pairs from every exchange automatically
 * No manual coin list needed — scans 5000+ coins
 * Exchanges: Binance, MEXC, Gate.io, KuCoin, Kraken, Coinbase
 */

require("dotenv").config();
const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  minSpreadPercent: parseFloat(process.env.MIN_SPREAD || "5.0"),
  maxSpreadPercent: parseFloat(process.env.MAX_SPREAD || "50.0"),
  pollIntervalMs:   parseInt(process.env.POLL_INTERVAL_MS || "60000"), // 60s recommended for large scans
  minExchanges:     parseInt(process.env.MIN_EXCHANGES || "2"),         // coin must appear on at least 2 exchanges
  excludeCoins:     new Set((process.env.EXCLUDE_COINS || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean)),
  alertCooldownMs:  10 * 60 * 1000,                                     // 10 min cooldown per pair
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId:   process.env.TELEGRAM_CHAT_ID,
  },
};

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   "GET",
      headers:  { "User-Agent": "ArbitrageScanner/3.0", ...headers },
      timeout:  15000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error from ${parsedUrl.hostname}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout: ${parsedUrl.hostname}`)); });
    req.end();
  });
}

// ─── Exchange Fetchers ────────────────────────────────────────────────────────
// Each returns: { SYMBOL: price }  (USDT-quoted, symbol uppercased)

async function fetchBinance() {
  const prices = {};
  // Binance blocks some cloud IPs — try multiple fallback endpoints
  const urls = [
    "https://api.binance.com/api/v3/ticker/price",
    "https://api1.binance.com/api/v3/ticker/price",
    "https://api2.binance.com/api/v3/ticker/price",
    "https://api3.binance.com/api/v3/ticker/price",
  ];
  let data = null;
  for (const url of urls) {
    try {
      data = await httpGet(url);
      if (Array.isArray(data) && data.length > 0) break;
    } catch (e) { /* try next */ }
  }
  try {
    if (Array.isArray(data) && data.length > 0) {
      for (const t of data) {
        if (t.symbol.endsWith("USDT")) {
          const sym = t.symbol.slice(0, -4);
          const price = parseFloat(t.price);
          if (price > 0) prices[sym] = price;
        }
      }
      console.log(`  ✅ Binance: ${Object.keys(prices).length} pairs`);
    } else {
      console.error("  ❌ Binance: All endpoints failed or IP is blocked");
    }
  } catch (e) { console.error(`  ❌ Binance: ${e.message}`); }
  return prices;
}

async function fetchMEXC() {
  const prices = {};
  try {
    const data = await httpGet("https://api.mexc.com/api/v3/ticker/price");
    if (Array.isArray(data)) {
      for (const t of data) {
        if (t.symbol.endsWith("USDT")) {
          const sym = t.symbol.slice(0, -4);
          const price = parseFloat(t.price);
          if (price > 0) prices[sym] = price;
        }
      }
    }
    console.log(`  ✅ MEXC: ${Object.keys(prices).length} pairs`);
  } catch (e) { console.error(`  ❌ MEXC: ${e.message}`); }
  return prices;
}

async function fetchGate() {
  const prices = {};
  try {
    const data = await httpGet("https://api.gateio.ws/api/v4/spot/tickers");
    if (Array.isArray(data)) {
      for (const t of data) {
        if (t.currency_pair.endsWith("_USDT") && t.last) {
          const sym = t.currency_pair.slice(0, -5);
          const price = parseFloat(t.last);
          if (price > 0) prices[sym] = price;
        }
      }
    }
    console.log(`  ✅ Gate.io: ${Object.keys(prices).length} pairs`);
  } catch (e) { console.error(`  ❌ Gate.io: ${e.message}`); }
  return prices;
}

async function fetchKuCoin() {
  const prices = {};
  try {
    const data = await httpGet("https://api.kucoin.com/api/v1/market/allTickers");
    if (data.data?.ticker) {
      for (const t of data.data.ticker) {
        if (t.symbol.endsWith("-USDT") && t.last) {
          const sym = t.symbol.slice(0, -5);
          const price = parseFloat(t.last);
          if (price > 0) prices[sym] = price;
        }
      }
    }
    console.log(`  ✅ KuCoin: ${Object.keys(prices).length} pairs`);
  } catch (e) { console.error(`  ❌ KuCoin: ${e.message}`); }
  return prices;
}

async function fetchKraken() {
  const prices = {};
  try {
    // Kraken: get all USD pairs via AssetPairs then Ticker
    const pairsData = await httpGet("https://api.kraken.com/0/public/AssetPairs");
    if (!pairsData.result) throw new Error("No result from Kraken AssetPairs");

    // Filter to USD pairs only
    const usdPairs = Object.entries(pairsData.result)
      .filter(([, v]) => v.quote === "ZUSD" || v.quote === "USD")
      .map(([k]) => k);

    if (usdPairs.length === 0) throw new Error("No USD pairs found");

    // Fetch tickers in batches of 100 to avoid URL length limits
    const batchSize = 100;
    for (let i = 0; i < usdPairs.length; i += batchSize) {
      const batch = usdPairs.slice(i, i + batchSize);
      try {
        const tickerData = await httpGet(
          `https://api.kraken.com/0/public/Ticker?pair=${batch.join(",")}`
        );
        if (tickerData.result) {
          for (const [pairKey, val] of Object.entries(tickerData.result)) {
            const pairInfo = pairsData.result[pairKey] || Object.values(pairsData.result)
              .find(p => p.altname === pairKey);
            if (!pairInfo) continue;
            // Get base symbol, strip leading X or Z (Kraken convention)
            let base = pairInfo.base || "";
            if (base.startsWith("X") || base.startsWith("Z")) base = base.slice(1);
            if (base === "BTC") base = "BTC"; // keep BTC as-is
            const ask = parseFloat(val.a?.[0]);
            const bid = parseFloat(val.b?.[0]);
            if (ask > 0 && bid > 0 && base) {
              prices[base] = (ask + bid) / 2;
            }
          }
        }
      } catch (batchErr) {
        // skip failed batch silently
      }
    }
    console.log(`  ✅ Kraken: ${Object.keys(prices).length} pairs`);
  } catch (e) { console.error(`  ❌ Kraken: ${e.message}`); }
  return prices;
}

async function fetchCoinbase() {
  const prices = {};
  try {
    // Use public exchange API (no auth required)
    const data = await httpGet("https://api.exchange.coinbase.com/products");
    if (Array.isArray(data)) {
      const usdProducts = data
        .filter(p => p.quote_currency === "USD" && p.status === "online")
        .map(p => p.id);

      // Fetch tickers in batches of 20
      const batchSize = 20;
      for (let i = 0; i < usdProducts.length; i += batchSize) {
        const batch = usdProducts.slice(i, i + batchSize);
        await Promise.all(batch.map(async (productId) => {
          try {
            const ticker = await httpGet(`https://api.exchange.coinbase.com/products/${productId}/ticker`);
            const sym = productId.replace("-USD", "");
            const price = parseFloat(ticker.price);
            if (price > 0) prices[sym] = price;
          } catch (e) { /* skip */ }
        }));
      }
      console.log(`  ✅ Coinbase: ${Object.keys(prices).length} pairs`);
    }
  } catch (e) { console.error(`  ❌ Coinbase: ${e.message}`); }
  return prices;
}

// ─── DEX Fetcher (Uniswap V3, V2, PancakeSwap, Aerodrome subgraphs) ─────────
async function fetchDEX() {
  const prices = {};

  // GraphQL query — top 1000 pools by TVL, get token prices in USD
  const query = JSON.stringify({
    query: `{
      pools(first: 1000, orderBy: totalValueLockedUSD, orderByDirection: desc,
            where: {totalValueLockedUSD_gt: "50000"}) {
        token0 { symbol }
        token1 { symbol }
        token0Price
        token1Price
        totalValueLockedUSD
      }
    }`
  });

  // Subgraphs: Uniswap V3 Ethereum, Arbitrum, Base + PancakeSwap BSC + Aerodrome Base
  const subgraphs = [
    // Uniswap V3 Ethereum
    "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3",
    // Uniswap V3 Arbitrum
    "https://api.thegraph.com/subgraphs/name/ianlapham/arbitrum-minimal",
    // Uniswap V3 Base (via Uniswap hosted)
    "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3-base",
    // PancakeSwap V3 BSC
    "https://api.thegraph.com/subgraphs/name/pancakeswap/exchange-v3-bsc",
  ];

  const STABLES = new Set(["USDT","USDC","DAI","BUSD","TUSD","FRAX","LUSD","USDP","GUSD","USDD"]);

  async function querySubgraph(url) {
    const parsed = new URL(url);
    return new Promise((resolve, reject) => {
      const body = Buffer.from(query);
      const req = https.request({
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": body.length,
        },
        timeout: 12000,
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.write(body);
      req.end();
    });
  }

  await Promise.all(subgraphs.map(async (url) => {
    try {
      const data = await querySubgraph(url);
      const pools = data?.data?.pools || [];
      for (const pool of pools) {
        const sym0 = pool.token0?.symbol?.toUpperCase();
        const sym1 = pool.token1?.symbol?.toUpperCase();
        if (!sym0 || !sym1) continue;

        // If one side is a stablecoin, the other side price = token0Price or token1Price
        if (STABLES.has(sym1) && !STABLES.has(sym0)) {
          const price = parseFloat(pool.token0Price);
          if (price > 0 && !prices[sym0]) prices[sym0] = price;
        } else if (STABLES.has(sym0) && !STABLES.has(sym1)) {
          const price = parseFloat(pool.token1Price);
          if (price > 0 && !prices[sym1]) prices[sym1] = price;
        }
      }
    } catch (e) { /* skip failed subgraph */ }
  }));

  // Also hit DexScreener for any remaining gaps — broad token search
  try {
    const ds = await httpGet("https://api.dexscreener.com/latest/dex/tokens/trending");
    const pairs = ds?.pairs || [];
    for (const pair of pairs) {
      const sym = pair.baseToken?.symbol?.toUpperCase();
      const price = parseFloat(pair.priceUsd);
      if (sym && price > 0 && !prices[sym]) prices[sym] = price;
    }
  } catch(e) { /* skip */ }

  const count = Object.keys(prices).length;
  if (count > 0) {
    console.log(`  ✅ DEX (Uniswap/PancakeSwap/Aerodrome): ${count} pairs`);
  } else {
    console.error("  ❌ DEX: No prices returned — subgraphs may be down");
  }
  return prices;
}

// ─── Find Opportunities ───────────────────────────────────────────────────────
function findOpportunities(allPrices) {
  const exchangeNames = Object.keys(allPrices);

  // Build a unified set of all symbols
  const allSymbols = new Set();
  for (const ex of exchangeNames) {
    for (const sym of Object.keys(allPrices[ex])) {
      allSymbols.add(sym);
    }
  }

  const opportunities = [];

  for (const sym of allSymbols) {
    const markets = [];
    for (const ex of exchangeNames) {
      const price = allPrices[ex][sym];
      if (price && price > 0) markets.push({ exchange: ex, price });
    }

    // Only compare if coin is on enough exchanges
    if (CONFIG.excludeCoins.has(sym)) continue;
    if (markets.length < CONFIG.minExchanges) continue;

    const sorted = [...markets].sort((a, b) => a.price - b.price);
    const cheapest     = sorted[0];
    const mostExpensive = sorted[sorted.length - 1];
    const spread = ((mostExpensive.price - cheapest.price) / cheapest.price) * 100;

    if (spread >= CONFIG.minSpreadPercent && spread <= CONFIG.maxSpreadPercent) {
      opportunities.push({
        symbol: sym,
        buyAt: cheapest,
        sellAt: mostExpensive,
        spreadPercent: spread.toFixed(2),
        allMarkets: sorted,
        exchangeCount: markets.length,
      });
    }
  }

  // Sort by spread descending
  return opportunities.sort((a, b) => parseFloat(b.spreadPercent) - parseFloat(a.spreadPercent));
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!CONFIG.telegram.botToken || !CONFIG.telegram.chatId) {
    console.warn("⚠️  Telegram not configured.");
    return;
  }
  // Telegram messages max 4096 chars
  const truncated = text.length > 4000 ? text.slice(0, 4000) + "..." : text;
  const url  = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id:    CONFIG.telegram.chatId,
    text:       truncated,
    parse_mode: "Markdown",
    disable_notification: false,
  });
  return new Promise((resolve) => {
    const req = https.request(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const r = JSON.parse(data);
          if (r.ok) console.log("  ✅ Telegram alert sent");
          else console.error("  ❌ Telegram:", r.description);
        } catch(e) {}
        resolve();
      });
    });
    req.on("error", (e) => { console.error("Telegram error:", e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

async function alertOpportunity(opp) {
  const allPricesText = opp.allMarkets
    .map(m => `  • ${m.exchange}: $${m.price.toFixed(8)}`)
    .join("\n");

  const msg =
    `🚨🚨 *ARBITRAGE OPPORTUNITY* 🚨🚨\n\n` +
    `*Token:* ${opp.symbol}\n` +
    `*Spread:* ${opp.spreadPercent}%\n` +
    `*On ${opp.exchangeCount} exchanges*\n\n` +
    `✅ *BUY on ${opp.buyAt.exchange}*\n` +
    `   Price: $${opp.buyAt.price.toFixed(8)}\n\n` +
    `💰 *SELL on ${opp.sellAt.exchange}*\n` +
    `   Price: $${opp.sellAt.price.toFixed(8)}\n\n` +
    `📊 *All Markets:*\n${allPricesText}\n\n` +
    `⚠️ _Always account for trading & withdrawal fees_`;

  await sendTelegram(msg);
}

// ─── Cooldown Tracker ─────────────────────────────────────────────────────────
const alertedOpportunities = new Map();

// ─── Main Scan ────────────────────────────────────────────────────────────────
let scanCount = 0;

async function scan() {
  scanCount++;
  const start = Date.now();
  console.log(`\n${"═".repeat(55)}`);
  console.log(`🔍 Scan #${scanCount} — ${new Date().toISOString()}`);
  console.log(`${"═".repeat(55)}`);
  console.log("📡 Fetching all tickers...");

  const [binance, mexc, gate, kucoin, kraken, coinbase, dex] = await Promise.allSettled([
    fetchBinance(),
    fetchMEXC(),
    fetchGate(),
    fetchKuCoin(),
    fetchKraken(),
    fetchCoinbase(),
    fetchDEX(),
  ]);

  const allPrices = {
    Binance:   binance.status   === "fulfilled" ? binance.value   : {},
    MEXC:      mexc.status      === "fulfilled" ? mexc.value      : {},
    "Gate.io": gate.status      === "fulfilled" ? gate.value      : {},
    KuCoin:    kucoin.status    === "fulfilled" ? kucoin.value    : {},
    Kraken:    kraken.status    === "fulfilled" ? kraken.value    : {},
    Coinbase:  coinbase.status  === "fulfilled" ? coinbase.value  : {},
    "DEX":     dex.status       === "fulfilled" ? dex.value       : {},
  };

  const totalPrices  = Object.values(allPrices).reduce((s, ex) => s + Object.keys(ex).length, 0);
  const uniqueCoins  = new Set(Object.values(allPrices).flatMap(ex => Object.keys(ex))).size;
  const elapsed      = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n📊 Results:`);
  console.log(`  Total prices fetched: ${totalPrices.toLocaleString()}`);
  console.log(`  Unique coins found:   ${uniqueCoins.toLocaleString()}`);
  console.log(`  Fetch time:           ${elapsed}s`);

  console.log(`
🔎 Scanning for ${CONFIG.minSpreadPercent}%–${CONFIG.maxSpreadPercent}% spreads...`);
  const opportunities = findOpportunities(allPrices);

  if (opportunities.length === 0) {
    console.log(`  ✅ No opportunities in ${CONFIG.minSpreadPercent}%–${CONFIG.maxSpreadPercent}% range found this cycle.`);
  } else {
    console.log(`  🎯 ${opportunities.length} opportunit${opportunities.length === 1 ? "y" : "ies"} found!\n`);

    for (const opp of opportunities) {
      const key         = `${opp.symbol}-${opp.buyAt.exchange}-${opp.sellAt.exchange}`;
      const lastAlerted = alertedOpportunities.get(key) || 0;
      const now         = Date.now();

      if (now - lastAlerted > CONFIG.alertCooldownMs) {
        console.log(`  🚨 ${opp.symbol}: ${opp.spreadPercent}% | Buy ${opp.buyAt.exchange} @ $${opp.buyAt.price.toFixed(8)} → Sell ${opp.sellAt.exchange} @ $${opp.sellAt.price.toFixed(8)}`);
        alertedOpportunities.set(key, now);
        await alertOpportunity(opp);
      } else {
        const cooldownLeft = Math.ceil((CONFIG.alertCooldownMs - (now - lastAlerted)) / 60000);
        console.log(`  ⏳ ${opp.symbol}: ${opp.spreadPercent}% (cooldown: ${cooldownLeft}m left)`);
      }
    }
  }

  // Clean up stale cooldowns
  for (const [key, time] of alertedOpportunities.entries()) {
    if (Date.now() - time > CONFIG.alertCooldownMs) alertedOpportunities.delete(key);
  }

  const totalTime = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n⏱️  Full scan completed in ${totalTime}s`);
  console.log(`⏭️  Next scan in ${CONFIG.pollIntervalMs / 1000}s`);
}

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("════════════════════════════════════════════════════════");
console.log("  CEX Arbitrage Scanner v3 — Auto Discovery Mode");
console.log("  Exchanges: Binance, MEXC, Gate.io, KuCoin, Kraken, Coinbase");
console.log(`  Min spread:    ${CONFIG.minSpreadPercent}%`);
  console.log(`  Max spread:    ${CONFIG.maxSpreadPercent}%`);
console.log(`  Scan interval: ${CONFIG.pollIntervalMs / 1000}s`);
console.log(`  Min exchanges: ${CONFIG.minExchanges} (coin must appear on at least ${CONFIG.minExchanges})`);
console.log("  No manual coin list — ALL pairs fetched automatically");
console.log("════════════════════════════════════════════════════════\n");

scan();
setInterval(scan, CONFIG.pollIntervalMs);
