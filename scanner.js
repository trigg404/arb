/**
 * CEX Arbitrage Scanner v3 — Auto Discovery Mode
 * Fetches ALL trading pairs from every exchange automatically
 * No manual coin list needed — scans 5000+ coins
 * Exchanges: Binance, MEXC, Gate.io, KuCoin, Kraken, Coinbase
 * DEX chains: ETH, BSC, ARB, BASE, POLYGON, AVAX, SOL + Robinhood Chain (4663)
 */

require("dotenv").config();
const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  minSpreadPercent: parseFloat(process.env.MIN_SPREAD || "5.0"),
  maxSpreadPercent: parseFloat(process.env.MAX_SPREAD || "50.0"),
  pollIntervalMs:   parseInt(process.env.POLL_INTERVAL_MS || "60000"),
  minExchanges:     parseInt(process.env.MIN_EXCHANGES || "2"),
  excludeCoins:     new Set((process.env.EXCLUDE_COINS || "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean)),
  alertCooldownMs:  10 * 60 * 1000,
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

// ─── RPC POST Helper (for Robinhood Chain) ────────────────────────────────────
function rpcPost(url, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const payload = JSON.stringify(body);
    const options = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "User-Agent":     "ArbitrageScanner/3.0",
      },
      timeout: 15000,
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON parse error from RPC")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("RPC timeout")); });
    req.write(payload);
    req.end();
  });
}

// ─── Exchange Fetchers ────────────────────────────────────────────────────────
async function fetchBinance() {
  const prices = {};
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
    const pairsData = await httpGet("https://api.kraken.com/0/public/AssetPairs");
    if (!pairsData.result) throw new Error("No result from Kraken AssetPairs");
    const usdPairs = Object.entries(pairsData.result)
      .filter(([, v]) => v.quote === "ZUSD" || v.quote === "USD")
      .map(([k]) => k);
    if (usdPairs.length === 0) throw new Error("No USD pairs found");
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
            let base = pairInfo.base || "";
            if (base.startsWith("X") || base.startsWith("Z")) base = base.slice(1);
            const ask = parseFloat(val.a?.[0]);
            const bid = parseFloat(val.b?.[0]);
            if (ask > 0 && bid > 0 && base) prices[base] = (ask + bid) / 2;
          }
        }
      } catch (batchErr) { /* skip failed batch */ }
    }
    console.log(`  ✅ Kraken: ${Object.keys(prices).length} pairs`);
  } catch (e) { console.error(`  ❌ Kraken: ${e.message}`); }
  return prices;
}

async function fetchCoinbase() {
  const prices = {};
  try {
    const data = await httpGet("https://api.exchange.coinbase.com/products");
    if (Array.isArray(data)) {
      const usdProducts = data
        .filter(p => p.quote_currency === "USD" && p.status === "online")
        .map(p => p.id);
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

// ─── Robinhood Chain DEX Fetcher ──────────────────────────────────────────────
// Chain ID: 4663 | RPC: rpc.mainnet.chain.robinhood.com
// Official token contracts from docs.robinhood.com/chain/contracts
// Reads Uniswap v3 pool prices directly via RPC (slot0 sqrtPriceX96)

const RH_RPC      = "https://rpc.mainnet.chain.robinhood.com";
const RH_FACTORY  = "0x1F98431c8aD98523631AE4a59f267346ea31F984"; // Uniswap v3 factory
const RH_WETH     = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"; // Official WETH on RH Chain
const RH_USDG     = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // Global Dollar (stablecoin, peg $1)

// Stock tokens from docs.robinhood.com — 10 most liquid
const RH_STOCK_TOKENS = [
  { sym: "TSLA", addr: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { sym: "AAPL", addr: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { sym: "NVDA", addr: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { sym: "AMZN", addr: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
  { sym: "MSFT", addr: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
  { sym: "GOOGL", addr: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  { sym: "META", addr: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
  { sym: "MSTR", addr: "0xec262a75e413fAfD0dF80480274532C79D42da09" },
  { sym: "SPY",  addr: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
  { sym: "QCOM", addr: "0x0f17206447090e464C277571124dD2688E48AEA9" },
];

const RH_FEES = [500, 3000, 10000]; // 0.05%, 0.3%, 1%
let rhRpcId = 1;

async function rhRpcCall(method, params) {
  const res = await rpcPost(RH_RPC, {
    jsonrpc: "2.0", id: rhRpcId++, method, params,
  });
  if (res.error) throw new Error(res.error.message);
  return res.result;
}

function encodeAddr(addr) {
  return addr.replace("0x", "").toLowerCase().padStart(64, "0");
}
function encodeUint24(n) {
  return n.toString(16).padStart(64, "0");
}
function decodeAddr(hex) {
  if (!hex || hex === "0x") return null;
  const addr = "0x" + hex.slice(-40);
  return addr === "0x0000000000000000000000000000000000000000" ? null : addr;
}
function decodeUint(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}
function sqrtPriceX96ToPrice(sqrtPX96) {
  if (!sqrtPX96 || sqrtPX96 === 0n) return 0;
  const s = Number(sqrtPX96) / Number(2n ** 96n);
  return s * s;
}

const SLOT0_SEL     = "0x3850c7bd";
const TOKEN0_SEL    = "0x0dfe1681";
const LIQUIDITY_SEL = "0x1a686502";
const GETPOOL_SEL   = "0x1698ee82";

async function rhGetPool(tokenA, tokenB, fee) {
  const t0 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenA : tokenB;
  const t1 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenB : tokenA;
  const data = GETPOOL_SEL + encodeAddr(t0) + encodeAddr(t1) + encodeUint24(fee);
  const res = await rhRpcCall("eth_call", [{ to: RH_FACTORY, data }, "latest"]);
  return decodeAddr(res);
}

// Returns USD price of tokenA quoted in USDG (≈ USD, peg $1)
// tokenADecimals: 18 for WETH/stock tokens, 18 for USDG
async function rhGetPrice(tokenA, tokenADecimals, tokenB, tokenBDecimals, fee) {
  try {
    const pool = await rhGetPool(tokenA, tokenB, fee);
    if (!pool) return null;

    const liq = decodeUint(await rhRpcCall("eth_call", [{ to: pool, data: LIQUIDITY_SEL }, "latest"]));
    if (liq === 0n) return null;

    const t0hex = await rhRpcCall("eth_call", [{ to: pool, data: TOKEN0_SEL }, "latest"]);
    const token0 = decodeAddr(t0hex) || tokenA;

    const slot0hex = await rhRpcCall("eth_call", [{ to: pool, data: SLOT0_SEL }, "latest"]);
    if (!slot0hex || slot0hex.length < 66) return null;

    const sqrtPX96 = BigInt("0x" + slot0hex.slice(2, 66));
    const rawPrice = sqrtPriceX96ToPrice(sqrtPX96);
    if (rawPrice === 0) return null;

    const isToken0A = token0.toLowerCase() === tokenA.toLowerCase();
    const decDiff = tokenADecimals - tokenBDecimals;
    const factor = Math.pow(10, decDiff);

    // rawPrice = price of token0 in terms of token1 (ignoring decimals)
    const priceAinB = isToken0A
      ? rawPrice / factor
      : (1 / rawPrice) * factor;

    return isFinite(priceAinB) && priceAinB > 0 ? priceAinB : null;
  } catch { return null; }
}

// Returns sleep helper for gentle RPC throttling
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchRobinhoodChain() {
  const prices = {}; // { SYM: priceInUSD }
  let poolsFound = 0;

  try {
    console.log("  🔗 Robinhood Chain: connecting to rpc.mainnet.chain.robinhood.com...");

    // Verify RPC is reachable
    const blockHex = await rhRpcCall("eth_blockNumber", []);
    const block = parseInt(blockHex, 16);
    console.log(`  🔗 Robinhood Chain: connected at block #${block.toLocaleString()}`);

    // ── 1. WETH price in USDG (both 18 dec) ──────────────────────────────────
    for (const fee of RH_FEES) {
      const price = await rhGetPrice(RH_WETH, 18, RH_USDG, 18, fee);
      if (price && price > 0) {
        // Use best (highest liquidity approximated by first found) price
        if (!prices["WETH"] || fee === 500) prices["WETH"] = price;
        poolsFound++;
        await sleep(80);
        break; // use tightest fee tier first
      }
      await sleep(80);
    }

    // ── 2. USDG de-peg check (vs $1 target) ──────────────────────────────────
    // USDG price in USD = 1 / (WETH price in USDG) * (WETH price in USD)
    // Simpler: USDG/WETH pool gives us USDG price in WETH, * WETH price = USDG in USD
    if (prices["WETH"]) {
      for (const fee of RH_FEES) {
        const usdgInWeth = await rhGetPrice(RH_USDG, 18, RH_WETH, 18, fee);
        if (usdgInWeth && usdgInWeth > 0) {
          prices["USDG"] = usdgInWeth * prices["WETH"];
          poolsFound++;
          await sleep(80);
          break;
        }
        await sleep(80);
      }
    }

    // ── 3. Stock token prices via USDG pools ──────────────────────────────────
    for (const tok of RH_STOCK_TOKENS) {
      let found = false;
      for (const fee of RH_FEES) {
        const price = await rhGetPrice(tok.addr, 18, RH_USDG, 18, fee);
        if (price && price > 0) {
          prices[tok.sym] = price;
          poolsFound++;
          found = true;
          await sleep(80);
          break;
        }
        await sleep(80);
      }
      if (!found) {
        // Fallback: try WETH quote pool + convert via WETH/USDG price
        if (prices["WETH"]) {
          for (const fee of RH_FEES) {
            const priceInWeth = await rhGetPrice(tok.addr, 18, RH_WETH, 18, fee);
            if (priceInWeth && priceInWeth > 0) {
              prices[tok.sym] = priceInWeth * prices["WETH"];
              poolsFound++;
              await sleep(80);
              break;
            }
            await sleep(80);
          }
        }
      }
    }

    console.log(`  ✅ Robinhood Chain: ${Object.keys(prices).length} tokens from ${poolsFound} pools`);
    if (prices["WETH"]) console.log(`     WETH: $${prices["WETH"].toFixed(2)}`);
    if (prices["USDG"]) console.log(`     USDG: $${prices["USDG"].toFixed(4)} (peg target: $1.00)`);

  } catch (e) {
    console.error(`  ❌ Robinhood Chain: ${e.message}`);
  }

  return prices;
}

// ─── DEX + Cross-Chain ────────────────────────────────────────────────────────
const SKIP_SYMS = new Set([
  "USDT","USDC","DAI","BUSD","TUSD","FRAX","WETH","WBNB","WMATIC",
  "WAVAX","WSOL","WBTC","USD","USDD","USDP","GUSD","USDE","PYUSD",
  "LUSD","CRVUSD","SUSD","MUSD","EURC","FDUSD",
]);

const GECKO_CHAINS = [
  { id: "ethereum-ecosystem",  label: "ETH"     },
  { id: "binance-smart-chain", label: "BSC"     },
  { id: "arbitrum-ecosystem",  label: "ARB"     },
  { id: "base-ecosystem",      label: "BASE"    },
  { id: "polygon-ecosystem",   label: "POLYGON" },
  { id: "avalanche-ecosystem", label: "AVAX"    },
  { id: "solana-ecosystem",    label: "SOL"     },
];

let _lastChainData = null;

async function fetchChainPrices(geckoCategory, label) {
  const priceMap = {};
  try {
    const data = await httpGet(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=${geckoCategory}&order=volume_desc&per_page=250&page=1&sparkline=false`,
      { "Accept": "application/json" }
    );
    if (Array.isArray(data)) {
      for (const coin of data) {
        const sym = coin.symbol?.toUpperCase();
        const price = coin.current_price;
        if (!sym || !price || price <= 0) continue;
        if (SKIP_SYMS.has(sym) || sym.includes("USD")) continue;
        priceMap[sym] = price;
      }
    }
    console.log(`  ✅ DEX ${label}: ${Object.keys(priceMap).length} tokens`);
    return priceMap;
  } catch (e) {
    // Fallback: GeckoTerminal
    try {
      const geckoId = {
        "ETH":"eth","BSC":"bsc","ARB":"arbitrum","BASE":"base",
        "POLYGON":"polygon_pos","AVAX":"avax","SOL":"solana"
      }[label] || label.toLowerCase();
      const pages = await Promise.allSettled([
        httpGet(`https://api.geckoterminal.com/api/v2/networks/${geckoId}/pools?page=1&sort=h24_volume_usd_liquidity_desc`),
        httpGet(`https://api.geckoterminal.com/api/v2/networks/${geckoId}/pools?page=2&sort=h24_volume_usd_liquidity_desc`),
      ]);
      for (const page of pages) {
        if (page.status !== "fulfilled") continue;
        for (const pool of page.value?.data || []) {
          const attrs = pool.attributes || {};
          const sym = attrs.base_token_symbol?.toUpperCase();
          const price = parseFloat(attrs.base_token_price_usd);
          const liq = parseFloat(attrs.reserve_in_usd || "0");
          if (!sym || !price || price <= 0 || liq < 5000) continue;
          if (SKIP_SYMS.has(sym) || sym.includes("USD")) continue;
          if (!priceMap[sym]) priceMap[sym] = price;
        }
      }
      console.log(`  ✅ DEX ${label} (fallback): ${Object.keys(priceMap).length} tokens`);
      return priceMap;
    } catch (e2) {
      console.error(`  ❌ DEX ${label}: ${e2.message}`);
      return {};
    }
  }
}

async function fetchAllChains() {
  // Fetch standard chains + Robinhood Chain in parallel
  const [standardResults, rhPrices] = await Promise.all([
    Promise.allSettled(GECKO_CHAINS.map(({ id, label }) => fetchChainPrices(id, label))),
    fetchRobinhoodChain(),
  ]);

  const chainData = {};
  GECKO_CHAINS.forEach(({ label }, i) => {
    chainData[label] = standardResults[i].status === "fulfilled" ? standardResults[i].value : {};
  });

  // ── Add Robinhood Chain as its own chain entry ──────────────────────────────
  chainData["RH_CHAIN"] = rhPrices;

  const symCount = {};
  for (const prices of Object.values(chainData)) {
    for (const sym of Object.keys(prices)) {
      symCount[sym] = (symCount[sym] || 0) + 1;
    }
  }
  const multiChain = Object.values(symCount).filter(c => c >= 2).length;
  console.log(`  📊 Symbols on 2+ chains: ${multiChain}`);
  if (Object.keys(rhPrices).length > 0) {
    console.log(`  🔗 Robinhood Chain tokens indexed: ${Object.keys(rhPrices).join(", ")}`);
  }

  _lastChainData = chainData;
  return chainData;
}

async function fetchDEX() {
  const chainData = _lastChainData || await fetchAllChains();
  const merged = {};
  for (const prices of Object.values(chainData)) {
    for (const [sym, price] of Object.entries(prices)) {
      if (!merged[sym]) merged[sym] = price;
    }
  }
  return merged;
}

async function fetchCrossChain() {
  return _lastChainData || await fetchAllChains();
}

// ─── Bridge Cost Estimates ────────────────────────────────────────────────────
// RH_CHAIN uses Arbitrum Orbit — bridging goes via ETH or ARB as the L1
const BRIDGE_COSTS = {
  "ETH-ARB":        { cost: 2,  time: "2-5 min",   bridge: "Across / Arbitrum Bridge" },
  "ETH-BASE":       { cost: 2,  time: "2-5 min",   bridge: "Across / Base Bridge"     },
  "ETH-POLYGON":    { cost: 3,  time: "3-7 min",   bridge: "Stargate"                 },
  "ETH-BSC":        { cost: 5,  time: "5-15 min",  bridge: "Stargate / Wormhole"      },
  "ETH-AVAX":       { cost: 4,  time: "5-10 min",  bridge: "Stargate"                 },
  "ETH-SOL":        { cost: 6,  time: "10-20 min", bridge: "Wormhole"                 },
  "ETH-RH_CHAIN":   { cost: 3,  time: "3-8 min",   bridge: "Robinhood Chain Bridge (Orbit)" },
  "ARB-BASE":       { cost: 1,  time: "2-4 min",   bridge: "Across"                   },
  "ARB-POLYGON":    { cost: 2,  time: "3-6 min",   bridge: "Stargate"                 },
  "ARB-BSC":        { cost: 3,  time: "5-10 min",  bridge: "Stargate"                 },
  "ARB-AVAX":       { cost: 3,  time: "5-10 min",  bridge: "Stargate"                 },
  "ARB-RH_CHAIN":   { cost: 2,  time: "2-5 min",   bridge: "Robinhood Chain Bridge (Orbit)" },
  "BASE-POLYGON":   { cost: 2,  time: "3-6 min",   bridge: "Stargate"                 },
  "BASE-BSC":       { cost: 3,  time: "5-10 min",  bridge: "Stargate"                 },
  "BASE-RH_CHAIN":  { cost: 2,  time: "3-6 min",   bridge: "Wormhole"                 },
  "BSC-POLYGON":    { cost: 2,  time: "3-7 min",   bridge: "Stargate"                 },
  "BSC-SOL":        { cost: 5,  time: "10-20 min", bridge: "Wormhole"                 },
  "SOL-ETH":        { cost: 6,  time: "10-20 min", bridge: "Wormhole"                 },
  "SOL-RH_CHAIN":   { cost: 7,  time: "15-25 min", bridge: "Wormhole → Orbit"         },
};

function getBridgeCost(chain1, chain2) {
  const key1 = `${chain1}-${chain2}`;
  const key2 = `${chain2}-${chain1}`;
  return BRIDGE_COSTS[key1] || BRIDGE_COSTS[key2] || { cost: 8, time: "10-25 min", bridge: "Wormhole" };
}

// ─── Find Cross-Chain Opportunities ──────────────────────────────────────────
function findCrossChainOpportunities(chainPrices) {
  const chains = Object.keys(chainPrices);
  const allSymbols = new Set(chains.flatMap(c => Object.keys(chainPrices[c])));
  const opportunities = [];

  for (const sym of allSymbols) {
    if (CONFIG.excludeCoins?.has(sym)) continue;

    const chainMarkets = [];
    for (const chain of chains) {
      const price = chainPrices[chain][sym];
      if (price && price > 0) chainMarkets.push({ chain, price });
    }
    if (chainMarkets.length < 2) continue;

    const sorted = [...chainMarkets].sort((a, b) => a.price - b.price);
    const cheapest = sorted[0];
    const mostExpensive = sorted[sorted.length - 1];
    const spread = ((mostExpensive.price - cheapest.price) / cheapest.price) * 100;

    if (spread < CONFIG.minSpreadPercent || spread > CONFIG.maxSpreadPercent) continue;

    const bridge = getBridgeCost(cheapest.chain, mostExpensive.chain);
    const grossProfit = 1000 * (spread / 100);
    const netProfit = grossProfit - bridge.cost - 5;

    // Flag Robinhood Chain opportunities prominently
    const involvesRHChain = cheapest.chain === "RH_CHAIN" || mostExpensive.chain === "RH_CHAIN";

    opportunities.push({
      symbol: sym,
      buyChain: cheapest.chain,
      buyPrice: cheapest.price,
      sellChain: mostExpensive.chain,
      sellPrice: mostExpensive.price,
      spreadPercent: spread.toFixed(2),
      bridge,
      netProfitOn1000: netProfit.toFixed(2),
      allChains: sorted,
      involvesRHChain,
    });
  }

  // Sort: RH Chain opportunities first, then by spread
  return opportunities.sort((a, b) => {
    if (a.involvesRHChain && !b.involvesRHChain) return -1;
    if (!a.involvesRHChain && b.involvesRHChain) return 1;
    return parseFloat(b.spreadPercent) - parseFloat(a.spreadPercent);
  });
}

// ─── Find CEX↔CEX Opportunities ──────────────────────────────────────────────
function findOpportunities(allPrices) {
  const exchangeNames = Object.keys(allPrices);
  const allSymbols = new Set();
  for (const ex of exchangeNames) {
    for (const sym of Object.keys(allPrices[ex])) allSymbols.add(sym);
  }

  const opportunities = [];
  for (const sym of allSymbols) {
    const markets = [];
    for (const ex of exchangeNames) {
      const price = allPrices[ex][sym];
      if (price && price > 0) markets.push({ exchange: ex, price });
    }
    if (CONFIG.excludeCoins.has(sym)) continue;
    if (markets.length < CONFIG.minExchanges) continue;

    const sorted = [...markets].sort((a, b) => a.price - b.price);
    const cheapest = sorted[0];
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
  return opportunities.sort((a, b) => parseFloat(b.spreadPercent) - parseFloat(a.spreadPercent));
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!CONFIG.telegram.botToken || !CONFIG.telegram.chatId) {
    console.warn("⚠️  Telegram not configured.");
    return;
  }
  const truncated = text.length > 4000 ? text.slice(0, 4000) + "..." : text;
  const url  = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: CONFIG.telegram.chatId, text: truncated,
    parse_mode: "Markdown", disable_notification: false,
  });
  return new Promise((resolve) => {
    const req = https.request(url, {
      method: "POST",
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

async function alertCrossChain(opp) {
  const chainList = opp.allChains
    .map(c => `  • ${c.chain}: $${c.price.toFixed(8)}`)
    .join("\n");
  const profitable = parseFloat(opp.netProfitOn1000) > 0;
  const profitEmoji = profitable ? "💰" : "⚠️";
  const rhFlag = opp.involvesRHChain ? "🔗 *Robinhood Chain involved!*\n" : "";

  const msg =
    `🌉🌉 *CROSS-CHAIN OPPORTUNITY* 🌉🌉\n\n` +
    `${rhFlag}` +
    `*Token:* ${opp.symbol}\n` +
    `*Spread:* ${opp.spreadPercent}%\n\n` +
    `✅ *BUY on ${opp.buyChain} DEX*\n` +
    `   Price: $${opp.buyPrice.toFixed(8)}\n\n` +
    `💸 *SELL on ${opp.sellChain} DEX*\n` +
    `   Price: $${opp.sellPrice.toFixed(8)}\n\n` +
    `🌉 *Bridge:* ${opp.bridge.bridge}\n` +
    `⏱️ *Bridge time:* ${opp.bridge.time}\n` +
    `💵 *Bridge cost:* ~$${opp.bridge.cost}\n\n` +
    `${profitEmoji} *Est. net profit on $1,000:* $${opp.netProfitOn1000}\n\n` +
    `📊 *Prices by chain:*\n${chainList}\n\n` +
    `⚠️ _Prices move fast — verify before bridging_`;
  await sendTelegram(msg);
}

// ─── USDG De-peg Alert ────────────────────────────────────────────────────────
async function checkUSDGPeg(rhPrices) {
  const usdgPrice = rhPrices["USDG"];
  if (!usdgPrice) return;
  const deviation = ((usdgPrice - 1.0) / 1.0) * 100;
  const absDeviation = Math.abs(deviation);

  if (absDeviation >= 0.5) {
    console.log(`  ⚠️  USDG DE-PEG DETECTED: $${usdgPrice.toFixed(4)} (${deviation >= 0 ? "+" : ""}${deviation.toFixed(3)}% from $1.00)`);
    const direction = deviation > 0 ? "ABOVE" : "BELOW";
    const action = deviation > 0
      ? "Mint USDG at $1.00 → sell on DEX above peg"
      : "Buy USDG below peg on DEX → redeem at $1.00";
    const msg =
      `🪙 *USDG DE-PEG ALERT* 🪙\n\n` +
      `USDG is trading *${direction} peg*\n\n` +
      `*Current DEX price:* $${usdgPrice.toFixed(4)}\n` +
      `*Target peg:* $1.0000\n` +
      `*Deviation:* ${deviation >= 0 ? "+" : ""}${deviation.toFixed(3)}%\n\n` +
      `💡 *Opportunity:* ${action}\n\n` +
      `🔗 Chain: Robinhood Chain (ID 4663)\n` +
      `⚠️ _Verify mint/redeem eligibility before trading_`;
    await sendTelegram(msg);
  } else {
    console.log(`  ✅ USDG peg healthy: $${usdgPrice.toFixed(4)} (${deviation >= 0 ? "+" : ""}${deviation.toFixed(3)}%)`);
  }
}

// ─── Cooldown Tracker ─────────────────────────────────────────────────────────
const alertedOpportunities = new Map();

// ─── Main Scan ────────────────────────────────────────────────────────────────
let scanCount = 0;

async function scan() {
  scanCount++;
  const start = Date.now();
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🔍 Scan #${scanCount} — ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}`);
  console.log("📡 Fetching all tickers...\n");

  // Reset chain cache each scan
  _lastChainData = null;

  // Pre-fetch all chains (includes Robinhood Chain via RPC)
  console.log("🌐 Pre-fetching DEX chain data (incl. Robinhood Chain)...");
  await fetchAllChains();

  // Fetch CEX + standard DEX
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
    Binance:    binance.status  === "fulfilled" ? binance.value  : {},
    MEXC:       mexc.status     === "fulfilled" ? mexc.value     : {},
    "Gate.io":  gate.status     === "fulfilled" ? gate.value     : {},
    KuCoin:     kucoin.status   === "fulfilled" ? kucoin.value   : {},
    Kraken:     kraken.status   === "fulfilled" ? kraken.value   : {},
    Coinbase:   coinbase.status === "fulfilled" ? coinbase.value : {},
    DEX:        dex.status      === "fulfilled" ? dex.value      : {},
  };

  // ── USDG peg check ──────────────────────────────────────────────────────────
  const rhPrices = _lastChainData?.["RH_CHAIN"] || {};
  console.log("\n🪙 Checking USDG peg...");
  await checkUSDGPeg(rhPrices);

  // ── Cross-chain scan (includes Robinhood Chain) ─────────────────────────────
  console.log("\n🌉 Scanning cross-chain opportunities (incl. Robinhood Chain)...");
  const chainPrices = await fetchCrossChain();
  const crossChainOpps = findCrossChainOpportunities(chainPrices);
  const rhOpps = crossChainOpps.filter(o => o.involvesRHChain);

  if (rhOpps.length > 0) {
    console.log(`  🔗 ${rhOpps.length} Robinhood Chain opportunit${rhOpps.length === 1 ? "y" : "ies"} found!`);
  }

  if (crossChainOpps.length === 0) {
    console.log(`  ✅ No cross-chain opportunities above ${CONFIG.minSpreadPercent}% found.`);
  } else {
    console.log(`  🎯 ${crossChainOpps.length} cross-chain opportunit${crossChainOpps.length === 1 ? "y" : "ies"} found!`);
    for (const opp of crossChainOpps) {
      const key = `XCHAIN-${opp.symbol}-${opp.buyChain}-${opp.sellChain}`;
      const lastAlerted = alertedOpportunities.get(key) || 0;
      const now = Date.now();
      const rhTag = opp.involvesRHChain ? " 🔗 RH_CHAIN" : "";
      if (now - lastAlerted > CONFIG.alertCooldownMs) {
        console.log(`  🌉 ${opp.symbol}: ${opp.spreadPercent}% | ${opp.buyChain} → ${opp.sellChain} | Net: $${opp.netProfitOn1000}/1k${rhTag}`);
        alertedOpportunities.set(key, now);
        await alertCrossChain(opp);
      } else {
        const left = Math.ceil((CONFIG.alertCooldownMs - (now - lastAlerted)) / 60000);
        console.log(`  ⏳ ${opp.symbol} (XCHAIN): ${opp.spreadPercent}% (cooldown: ${left}m)${rhTag}`);
      }
    }
  }

  // ── CEX↔CEX scan ───────────────────────────────────────────────────────────
  const totalPrices = Object.values(allPrices).reduce((s, ex) => s + Object.keys(ex).length, 0);
  const uniqueCoins = new Set(Object.values(allPrices).flatMap(ex => Object.keys(ex))).size;
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`\n📊 Summary:`);
  console.log(`  Total prices fetched:     ${totalPrices.toLocaleString()}`);
  console.log(`  Unique coins found:       ${uniqueCoins.toLocaleString()}`);
  console.log(`  Robinhood Chain tokens:   ${Object.keys(rhPrices).length}`);
  console.log(`  Fetch time:               ${elapsed}s`);

  console.log(`\n🔎 Scanning CEX opportunities (${CONFIG.minSpreadPercent}%–${CONFIG.maxSpreadPercent}% spreads)...`);
  const opportunities = findOpportunities(allPrices);

  if (opportunities.length === 0) {
    console.log(`  ✅ No CEX opportunities in range found this cycle.`);
  } else {
    console.log(`  🎯 ${opportunities.length} opportunit${opportunities.length === 1 ? "y" : "ies"} found!\n`);
    for (const opp of opportunities) {
      const key = `${opp.symbol}-${opp.buyAt.exchange}-${opp.sellAt.exchange}`;
      const lastAlerted = alertedOpportunities.get(key) || 0;
      const now = Date.now();
      if (now - lastAlerted > CONFIG.alertCooldownMs) {
        console.log(`  🚨 ${opp.symbol}: ${opp.spreadPercent}% | Buy ${opp.buyAt.exchange} @ $${opp.buyAt.price.toFixed(8)} → Sell ${opp.sellAt.exchange} @ $${opp.sellAt.price.toFixed(8)}`);
        alertedOpportunities.set(key, now);
        await alertOpportunity(opp);
      } else {
        const left = Math.ceil((CONFIG.alertCooldownMs - (now - lastAlerted)) / 60000);
        console.log(`  ⏳ ${opp.symbol}: ${opp.spreadPercent}% (cooldown: ${left}m)`);
      }
    }
  }

  // Clean stale cooldowns
  for (const [key, time] of alertedOpportunities.entries()) {
    if (Date.now() - time > CONFIG.alertCooldownMs) alertedOpportunities.delete(key);
  }

  const totalTime = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n⏱️  Full scan completed in ${totalTime}s`);
  console.log(`⏭️  Next scan in ${CONFIG.pollIntervalMs / 1000}s`);
}

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("═".repeat(62));
console.log("  CEX Arbitrage Scanner v3 — Robinhood Chain Edition");
console.log("  CEX: Binance, MEXC, Gate.io, KuCoin, Kraken, Coinbase");
console.log("  DEX chains: ETH, BSC, ARB, BASE, POLYGON, AVAX, SOL");
console.log("  + Robinhood Chain (ID 4663) via direct RPC");
console.log(`  Min spread:    ${CONFIG.minSpreadPercent}%`);
console.log(`  Max spread:    ${CONFIG.maxSpreadPercent}%`);
console.log(`  Scan interval: ${CONFIG.pollIntervalMs / 1000}s`);
console.log("  RH Chain tokens: WETH, USDG + 10 stock tokens");
console.log("  USDG peg monitoring: alerts on >0.5% deviation");
console.log("═".repeat(62) + "\n");

scan();
setInterval(scan, CONFIG.pollIntervalMs);
