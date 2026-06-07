/**
 * CEX + DEX Arbitrage Scanner
 * Monitors 100 tokens across Kraken, Coinbase, KuCoin, Gate, MEXC + DEXes
 * Sends Telegram alert when spread >= 2%
 */

require("dotenv").config();
const https = require("https");

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  minSpreadPercent: parseFloat(process.env.MIN_SPREAD || "2.0"),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "60000"),
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
};

// ─── 100 Token List ───────────────────────────────────────────────────────────
// Format: { symbol, kraken, coinbase, kucoin, gate, mexc }
// Exchange symbols vary per platform — mapped individually
const TOKENS = [
  // Major Alts
  { s: "SOL",   k: "SOLUSD",   cb: "SOL-USD",   ku: "SOL-USDT",   g: "SOL_USDT",   mx: "SOLUSDT"   },
  { s: "ARB",   k: "ARBUSD",   cb: "ARB-USD",   ku: "ARB-USDT",   g: "ARB_USDT",   mx: "ARBUSDT"   },
  { s: "OP",    k: "OPUSD",    cb: "OP-USD",    ku: "OP-USDT",    g: "OP_USDT",    mx: "OPUSDT"    },
  { s: "MATIC", k: "MATICUSD", cb: "MATIC-USD", ku: "MATIC-USDT", g: "MATIC_USDT", mx: "MATICUSDT" },
  { s: "AVAX",  k: "AVAXUSD",  cb: "AVAX-USD",  ku: "AVAX-USDT",  g: "AVAX_USDT",  mx: "AVAXUSDT"  },
  { s: "LINK",  k: "LINKUSD",  cb: "LINK-USD",  ku: "LINK-USDT",  g: "LINK_USDT",  mx: "LINKUSDT"  },
  { s: "DOT",   k: "DOTUSD",   cb: "DOT-USD",   ku: "DOT-USDT",   g: "DOT_USDT",   mx: "DOTUSDT"   },
  { s: "ADA",   k: "ADAUSD",   cb: "ADA-USD",   ku: "ADA-USDT",   g: "ADA_USDT",   mx: "ADAUSDT"   },
  { s: "ATOM",  k: "ATOMUSD",  cb: "ATOM-USD",  ku: "ATOM-USDT",  g: "ATOM_USDT",  mx: "ATOMUSDT"  },
  { s: "NEAR",  k: "NEARUSD",  cb: "NEAR-USD",  ku: "NEAR-USDT",  g: "NEAR_USDT",  mx: "NEARUSDT"  },
  // L2s & Infra
  { s: "IMX",   k: "IMXUSD",   cb: "IMX-USD",   ku: "IMX-USDT",   g: "IMX_USDT",   mx: "IMXUSDT"   },
  { s: "STRK",  k: null,       cb: null,        ku: "STRK-USDT",  g: "STRK_USDT",  mx: "STRKUSDT"  },
  { s: "ZK",    k: null,       cb: null,        ku: "ZK-USDT",    g: "ZK_USDT",    mx: "ZKUSDT"    },
  { s: "MANTA", k: null,       cb: null,        ku: "MANTA-USDT", g: "MANTA_USDT", mx: "MANTAUSDT" },
  { s: "METIS", k: null,       cb: null,        ku: "METIS-USDT", g: "METIS_USDT", mx: "METISUSDT" },
  { s: "BLAST", k: null,       cb: null,        ku: "BLAST-USDT", g: "BLAST_USDT", mx: "BLASTUSDT" },
  { s: "ALT",   k: null,       cb: null,        ku: "ALT-USDT",   g: "ALT_USDT",   mx: "ALTUSDT"   },
  { s: "TAIKO", k: null,       cb: null,        ku: "TAIKO-USDT", g: "TAIKO_USDT", mx: "TAIKOUSDT" },
  { s: "SCROLL",k: null,       cb: null,        ku: "SCR-USDT",   g: "SCR_USDT",   mx: "SCRUSDT"   },
  { s: "CYBER", k: null,       cb: null,        ku: "CYBER-USDT", g: "CYBER_USDT", mx: "CYBERUSDT" },
  // DeFi
  { s: "UNI",   k: "UNIUSD",   cb: "UNI-USD",   ku: "UNI-USDT",   g: "UNI_USDT",   mx: "UNIUSDT"   },
  { s: "AAVE",  k: "AAVEUSD",  cb: "AAVE-USD",  ku: "AAVE-USDT",  g: "AAVE_USDT",  mx: "AAVEUSDT"  },
  { s: "CRV",   k: "CRVUSD",   cb: "CRV-USD",   ku: "CRV-USDT",   g: "CRV_USDT",   mx: "CRVUSDT"   },
  { s: "MKR",   k: "MKRUSD",   cb: "MKR-USD",   ku: "MKR-USDT",   g: "MKR_USDT",   mx: "MKRUSDT"   },
  { s: "SNX",   k: "SNXUSD",   cb: "SNX-USD",   ku: "SNX-USDT",   g: "SNX_USDT",   mx: "SNXUSDT"   },
  { s: "COMP",  k: "COMPUSD",  cb: "COMP-USD",  ku: "COMP-USDT",  g: "COMP_USDT",  mx: "COMPUSDT"  },
  { s: "BAL",   k: "BALUSD",   cb: "BAL-USD",   ku: "BAL-USDT",   g: "BAL_USDT",   mx: "BALUSDT"   },
  { s: "1INCH", k: "1INCHUSD", cb: "1INCH-USD", ku: "1INCH-USDT", g: "1INCH_USDT", mx: "1INCHUSDT" },
  { s: "LDO",   k: "LDOUSD",   cb: "LDO-USD",   ku: "LDO-USDT",   g: "LDO_USDT",   mx: "LDOUSDT"   },
  { s: "RPL",   k: "RPLUSD",   cb: "RPL-USD",   ku: "RPL-USDT",   g: "RPL_USDT",   mx: "RPLUSDT"   },
  // Meme Coins
  { s: "DOGE",  k: "DOGEUSD",  cb: "DOGE-USD",  ku: "DOGE-USDT",  g: "DOGE_USDT",  mx: "DOGEUSDT"  },
  { s: "SHIB",  k: "SHIBUSD",  cb: "SHIB-USD",  ku: "SHIB-USDT",  g: "SHIB_USDT",  mx: "SHIBUSDT"  },
  { s: "PEPE",  k: "PEPEUSD",  cb: "PEPE-USD",  ku: "PEPE-USDT",  g: "PEPE_USDT",  mx: "PEPEUSDT"  },
  { s: "BONK",  k: null,       cb: "BONK-USD",  ku: "BONK-USDT",  g: "BONK_USDT",  mx: "BONKUSDT"  },
  { s: "WIF",   k: null,       cb: "WIF-USD",   ku: "WIF-USDT",   g: "WIF_USDT",   mx: "WIFUSDT"   },
  { s: "FLOKI", k: null,       cb: null,        ku: "FLOKI-USDT", g: "FLOKI_USDT", mx: "FLOKIUSDT" },
  { s: "TURBO", k: null,       cb: null,        ku: "TURBO-USDT", g: "TURBO_USDT", mx: "TURBOUSDT" },
  { s: "MEME",  k: null,       cb: null,        ku: "MEME-USDT",  g: "MEME_USDT",  mx: "MEMEUSDT"  },
  { s: "BOME",  k: null,       cb: null,        ku: "BOME-USDT",  g: "BOME_USDT",  mx: "BOMEUSDT"  },
  { s: "DOGS",  k: null,       cb: null,        ku: "DOGS-USDT",  g: "DOGS_USDT",  mx: "DOGSUSDT"  },
  // AI Tokens
  { s: "FET",   k: "FETUSD",   cb: "FET-USD",   ku: "FET-USDT",   g: "FET_USDT",   mx: "FETUSDT"   },
  { s: "RNDR",  k: "RNDRUSD",  cb: "RENDER-USD",ku: "RNDR-USDT",  g: "RNDR_USDT",  mx: "RNDRUSDT"  },
  { s: "WLD",   k: null,       cb: "WLD-USD",   ku: "WLD-USDT",   g: "WLD_USDT",   mx: "WLDUSDT"   },
  { s: "TAO",   k: null,       cb: null,        ku: "TAO-USDT",   g: "TAO_USDT",   mx: "TAOUSDT"   },
  { s: "AGIX",  k: null,       cb: null,        ku: "AGIX-USDT",  g: "AGIX_USDT",  mx: "AGIXUSDT"  },
  { s: "NMR",   k: "NMRUSD",   cb: "NMR-USD",   ku: "NMR-USDT",   g: "NMR_USDT",   mx: "NMRUSDT"   },
  { s: "OCEAN", k: "OCEANUSD", cb: "OCEAN-USD", ku: "OCEAN-USDT", g: "OCEAN_USDT", mx: "OCEANUSDT" },
  { s: "GRT",   k: "GRTUSD",   cb: "GRT-USD",   ku: "GRT-USDT",   g: "GRT_USDT",   mx: "GRTUSDT"   },
  { s: "ARKM",  k: null,       cb: "ARKM-USD",  ku: "ARKM-USDT",  g: "ARKM_USDT",  mx: "ARKMUSDT"  },
  { s: "MYRIA", k: null,       cb: null,        ku: null,         g: "MYRIA_USDT", mx: "MYRIAUSDT" },
  // Gaming & Metaverse
  { s: "AXS",   k: "AXSUSD",   cb: "AXS-USD",   ku: "AXS-USDT",   g: "AXS_USDT",   mx: "AXSUSDT"   },
  { s: "SAND",  k: "SANDUSD",  cb: "SAND-USD",  ku: "SAND-USDT",  g: "SAND_USDT",  mx: "SANDUSDT"  },
  { s: "MANA",  k: "MANAUSD",  cb: "MANA-USD",  ku: "MANA-USDT",  g: "MANA_USDT",  mx: "MANAUSDT"  },
  { s: "GALA",  k: "GALAUSD",  cb: "GALA-USD",  ku: "GALA-USDT",  g: "GALA_USDT",  mx: "GALAUSDT"  },
  { s: "IMX",   k: "IMXUSD",   cb: "IMX-USD",   ku: "IMX-USDT",   g: "IMX_USDT",   mx: "IMXUSDT"   },
  { s: "BEAM",  k: null,       cb: null,        ku: "BEAM-USDT",  g: "BEAM_USDT",  mx: "BEAMUSDT"  },
  { s: "RON",   k: null,       cb: null,        ku: "RON-USDT",   g: "RON_USDT",   mx: "RONUSDT"   },
  { s: "YGG",   k: null,       cb: null,        ku: "YGG-USDT",   g: "YGG_USDT",   mx: "YGGUSDT"   },
  { s: "MAGIC", k: null,       cb: null,        ku: "MAGIC-USDT", g: "MAGIC_USDT", mx: "MAGICUSDT" },
  { s: "TLM",   k: null,       cb: null,        ku: "TLM-USDT",   g: "TLM_USDT",   mx: "TLMUSDT"   },
  // Low Cap / High Opportunity
  { s: "KAS",   k: null,       cb: null,        ku: "KAS-USDT",   g: "KAS_USDT",   mx: "KASUSDT"   },
  { s: "ROSE",  k: "ROSEUSD",  cb: null,        ku: "ROSE-USDT",  g: "ROSE_USDT",  mx: "ROSEUSDT"  },
  { s: "CORE",  k: null,       cb: null,        ku: "CORE-USDT",  g: "CORE_USDT",  mx: "COREUSDT"  },
  { s: "CFX",   k: null,       cb: null,        ku: "CFX-USDT",   g: "CFX_USDT",   mx: "CFXUSDT"   },
  { s: "SUI",   k: "SUIUSD",   cb: "SUI-USD",   ku: "SUI-USDT",   g: "SUI_USDT",   mx: "SUIUSDT"   },
  { s: "APT",   k: "APTUSD",   cb: "APT-USD",   ku: "APT-USDT",   g: "APT_USDT",   mx: "APTUSDT"   },
  { s: "SEI",   k: null,       cb: "SEI-USD",   ku: "SEI-USDT",   g: "SEI_USDT",   mx: "SEIUSDT"   },
  { s: "TIA",   k: null,       cb: "TIA-USD",   ku: "TIA-USDT",   g: "TIA_USDT",   mx: "TIAUSDT"   },
  { s: "PYTH",  k: null,       cb: "PYTH-USD",  ku: "PYTH-USDT",  g: "PYTH_USDT",  mx: "PYTHUSDT"  },
  { s: "JTO",   k: null,       cb: "JTO-USD",   ku: "JTO-USDT",   g: "JTO_USDT",   mx: "JTOUSDT"   },
  { s: "JUP",   k: null,       cb: "JUP-USD",   ku: "JUP-USDT",   g: "JUP_USDT",   mx: "JUPUSDT"   },
  { s: "W",     k: null,       cb: null,        ku: "W-USDT",     g: "W_USDT",     mx: "WUSDT"     },
  { s: "TNSR",  k: null,       cb: null,        ku: "TNSR-USDT",  g: "TNSR_USDT",  mx: "TNSRUSDT"  },
  { s: "POPCAT",k: null,       cb: null,        ku: "POPCAT-USDT",g: "POPCAT_USDT",mx: "POPCATUSDT"},
  // RWA & Newer
  { s: "ONDO",  k: null,       cb: "ONDO-USD",  ku: "ONDO-USDT",  g: "ONDO_USDT",  mx: "ONDOUSDT"  },
  { s: "ENA",   k: null,       cb: "ENA-USD",   ku: "ENA-USDT",   g: "ENA_USDT",   mx: "ENAUSDT"   },
  { s: "ETHFI", k: null,       cb: "ETHFI-USD", ku: "ETHFI-USDT", g: "ETHFI_USDT", mx: "ETHFIUSDT" },
  { s: "REZ",   k: null,       cb: null,        ku: "REZ-USDT",   g: "REZ_USDT",   mx: "REZUSDT"   },
  { s: "OMNI",  k: null,       cb: null,        ku: "OMNI-USDT",  g: "OMNI_USDT",  mx: "OMNIUSDT"  },
  { s: "BB",    k: null,       cb: null,        ku: "BB-USDT",    g: "BB_USDT",    mx: "BBUSDT"    },
  { s: "IO",    k: null,       cb: null,        ku: "IO-USDT",    g: "IO_USDT",    mx: "IOUSDT"    },
  { s: "ZRO",   k: null,       cb: null,        ku: "ZRO-USDT",   g: "ZRO_USDT",   mx: "ZROUSDT"   },
  { s: "LISTA", k: null,       cb: null,        ku: "LISTA-USDT", g: "LISTA_USDT", mx: "LISTAUSDT" },
  { s: "ZETA",  k: null,       cb: null,        ku: "ZETA-USDT",  g: "ZETA_USDT",  mx: "ZETAUSDT"  },
  // Ecosystem / Misc
  { s: "INJ",   k: "INJUSD",   cb: "INJ-USD",   ku: "INJ-USDT",   g: "INJ_USDT",   mx: "INJUSDT"   },
  { s: "TRX",   k: "TRXUSD",   cb: "TRX-USD",   ku: "TRX-USDT",   g: "TRX_USDT",   mx: "TRXUSDT"   },
  { s: "FIL",   k: "FILUSD",   cb: "FIL-USD",   ku: "FIL-USDT",   g: "FIL_USDT",   mx: "FILUSDT"   },
  { s: "ICP",   k: "ICPUSD",   cb: "ICP-USD",   ku: "ICP-USDT",   g: "ICP_USDT",   mx: "ICPUSDT"   },
  { s: "HBAR",  k: "HBARUSD",  cb: "HBAR-USD",  ku: "HBAR-USDT",  g: "HBAR_USDT",  mx: "HBARUSDT"  },
  { s: "VET",   k: "VETUSD",   cb: null,        ku: "VET-USDT",   g: "VET_USDT",   mx: "VETUSDT"   },
  { s: "FLR",   k: "FLRUSD",   cb: null,        ku: "FLR-USDT",   g: "FLR_USDT",   mx: "FLRUSDT"   },
  { s: "ALGO",  k: "ALGOUSD",  cb: "ALGO-USD",  ku: "ALGO-USDT",  g: "ALGO_USDT",  mx: "ALGOUSDT"  },
  { s: "EGLD",  k: null,       cb: null,        ku: "EGLD-USDT",  g: "EGLD_USDT",  mx: "EGLDUSDT"  },
  { s: "KAVA",  k: "KAVAUSD",  cb: null,        ku: "KAVA-USDT",  g: "KAVA_USDT",  mx: "KAVAUSDT"  },
  { s: "FLOW",  k: "FLOWUSD",  cb: "FLOW-USD",  ku: "FLOW-USDT",  g: "FLOW_USDT",  mx: "FLOWUSDT"  },
  { s: "AUDIO", k: "AUDIOUSD", cb: "AUDIO-USD", ku: "AUDIO-USDT", g: "AUDIO_USDT", mx: "AUDIOUSDT" },
  { s: "MASK",  k: null,       cb: null,        ku: "MASK-USDT",  g: "MASK_USDT",  mx: "MASKUSDT"  },
  { s: "SKL",   k: "SKLUSD",   cb: "SKL-USD",   ku: "SKL-USDT",   g: "SKL_USDT",   mx: "SKLUSDT"   },
  { s: "CTSI",  k: "CTSIUSD",  cb: "CTSI-USD",  ku: "CTSI-USDT",  g: "CTSI_USDT",  mx: "CTSIUSDT"  },
  { s: "SPELL", k: null,       cb: null,        ku: "SPELL-USDT", g: "SPELL_USDT", mx: "SPELLUSDT" },
  { s: "HIGH",  k: null,       cb: null,        ku: "HIGH-USDT",  g: "HIGH_USDT",  mx: "HIGHUSDT"  },
  { s: "HOOK",  k: null,       cb: null,        ku: "HOOK-USDT",  g: "HOOK_USDT",  mx: "HOOKUSDT"  },
];

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: { "User-Agent": "ArbitrageScanner/1.0", ...headers },
      timeout: 8000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON parse error")); }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
}

// ─── Exchange Price Fetchers ──────────────────────────────────────────────────

// Fetch all Kraken tickers in one call
async function fetchKraken(tokens) {
  const prices = {};
  try {
    const pairs = tokens.filter(t => t.k).map(t => t.k).join(",");
    const data = await httpGet(`https://api.kraken.com/0/public/Ticker?pair=${pairs}`);
    if (data.result) {
      for (const token of tokens) {
        if (!token.k) continue;
        // Kraken sometimes returns a modified key
        const key = Object.keys(data.result).find(k =>
          k.toUpperCase().includes(token.s.toUpperCase()) ||
          k === token.k
        );
        if (key && data.result[key]) {
          const ask = parseFloat(data.result[key].a[0]);
          const bid = parseFloat(data.result[key].b[0]);
          if (ask > 0) prices[token.s] = { price: (ask + bid) / 2, exchange: "Kraken" };
        }
      }
    }
  } catch (e) {
    console.error("Kraken fetch error:", e.message);
  }
  return prices;
}

// Fetch all Coinbase tickers
async function fetchCoinbase(tokens) {
  const prices = {};
  const cbTokens = tokens.filter(t => t.cb);
  // Coinbase best-bids endpoint (batch)
  try {
    const productIds = cbTokens.map(t => t.cb).join(",");
    const data = await httpGet(`https://api.coinbase.com/api/v3/brokerage/best_bid_ask?product_ids=${productIds}`);
    if (data.pricebooks) {
      for (const pb of data.pricebooks) {
        const token = cbTokens.find(t => t.cb === pb.product_id);
        if (token && pb.asks?.[0]?.price) {
          const ask = parseFloat(pb.asks[0].price);
          const bid = parseFloat(pb.bids?.[0]?.price || pb.asks[0].price);
          prices[token.s] = { price: (ask + bid) / 2, exchange: "Coinbase" };
        }
      }
    }
  } catch (e) {
    console.error("Coinbase fetch error:", e.message);
  }
  return prices;
}

// Fetch all KuCoin tickers in one call
async function fetchKuCoin(tokens) {
  const prices = {};
  try {
    const data = await httpGet("https://api.kucoin.com/api/v1/market/allTickers");
    if (data.data?.ticker) {
      for (const token of tokens) {
        if (!token.ku) continue;
        const ticker = data.data.ticker.find(t => t.symbol === token.ku);
        if (ticker && ticker.last) {
          prices[token.s] = { price: parseFloat(ticker.last), exchange: "KuCoin" };
        }
      }
    }
  } catch (e) {
    console.error("KuCoin fetch error:", e.message);
  }
  return prices;
}

// Fetch all Gate.io tickers in one call
async function fetchGate(tokens) {
  const prices = {};
  try {
    const data = await httpGet("https://api.gateio.ws/api/v4/spot/tickers");
    if (Array.isArray(data)) {
      for (const token of tokens) {
        if (!token.g) continue;
        const ticker = data.find(t => t.currency_pair === token.g);
        if (ticker && ticker.last) {
          prices[token.s] = { price: parseFloat(ticker.last), exchange: "Gate.io" };
        }
      }
    }
  } catch (e) {
    console.error("Gate fetch error:", e.message);
  }
  return prices;
}

// Fetch all MEXC tickers in one call
async function fetchMEXC(tokens) {
  const prices = {};
  try {
    const data = await httpGet("https://api.mexc.com/api/v3/ticker/price");
    if (Array.isArray(data)) {
      for (const token of tokens) {
        if (!token.mx) continue;
        const ticker = data.find(t => t.symbol === token.mx);
        if (ticker && ticker.price) {
          prices[token.s] = { price: parseFloat(ticker.price), exchange: "MEXC" };
        }
      }
    }
  } catch (e) {
    console.error("MEXC fetch error:", e.message);
  }
  return prices;
}

// ─── Find Arbitrage Opportunities ─────────────────────────────────────────────
function findOpportunities(allPrices) {
  const opportunities = [];

  for (const token of TOKENS) {
    const symbol = token.s;
    const markets = [];

    // Collect all prices for this token
    for (const [exchange, prices] of Object.entries(allPrices)) {
      if (prices[symbol]) {
        markets.push({ exchange, price: prices[symbol].price });
      }
    }

    if (markets.length < 2) continue;

    // Find best buy (lowest) and best sell (highest)
    const sorted = markets.sort((a, b) => a.price - b.price);
    const cheapest = sorted[0];
    const mostExpensive = sorted[sorted.length - 1];

    const spread = ((mostExpensive.price - cheapest.price) / cheapest.price) * 100;

    if (spread >= CONFIG.minSpreadPercent) {
      opportunities.push({
        symbol,
        buyAt: cheapest,
        sellAt: mostExpensive,
        spreadPercent: spread.toFixed(2),
        allMarkets: markets,
      });
    }
  }

  // Sort by spread descending (best opportunities first)
  return opportunities.sort((a, b) => b.spreadPercent - a.spreadPercent);
}

// ─── Telegram ─────────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!CONFIG.telegram.botToken || !CONFIG.telegram.chatId) {
    console.warn("⚠️  Telegram not configured.");
    return;
  }

  const url = `https://api.telegram.org/bot${CONFIG.telegram.botToken}/sendMessage`;
  const body = JSON.stringify({
    chat_id: CONFIG.telegram.chatId,
    text,
    parse_mode: "Markdown",
    disable_notification: false,
  });

  return new Promise((resolve) => {
    const req = https.request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          const parsed = JSON.parse(data);
          if (parsed.ok) console.log("✅ Telegram alert sent");
          else console.error("❌ Telegram error:", parsed.description);
          resolve();
        });
      }
    );
    req.on("error", (e) => { console.error("Telegram request error:", e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

async function alertOpportunity(opp) {
  const allPricesText = opp.allMarkets
    .sort((a, b) => a.price - b.price)
    .map(m => `  • ${m.exchange}: $${m.price.toFixed(6)}`)
    .join("\n");

  const msg =
    `🚨🚨 *ARBITRAGE OPPORTUNITY* 🚨🚨\n\n` +
    `*Token:* ${opp.symbol}\n` +
    `*Spread:* ${opp.spreadPercent}%\n\n` +
    `✅ *BUY on ${opp.buyAt.exchange}*\n` +
    `   Price: $${opp.buyAt.price.toFixed(6)}\n\n` +
    `💰 *SELL on ${opp.sellAt.exchange}*\n` +
    `   Price: $${opp.sellAt.price.toFixed(6)}\n\n` +
    `📊 *All Markets:*\n${allPricesText}\n\n` +
    `⚠️ _Always account for trading fees & withdrawal costs before acting_`;

  await sendTelegram(msg);
}

// ─── Main Scan Loop ───────────────────────────────────────────────────────────
// Track already-alerted opportunities to avoid spam (reset every 10 minutes)
const alertedOpportunities = new Map();
const ALERT_COOLDOWN_MS = 10 * 60 * 1000;

async function scan() {
  console.log(`\n🔍 Scanning ${TOKENS.length} tokens across 5 exchanges... ${new Date().toISOString()}`);

  // Fetch all exchanges in parallel
  const [kraken, coinbase, kucoin, gate, mexc] = await Promise.allSettled([
    fetchKraken(TOKENS),
    fetchCoinbase(TOKENS),
    fetchKuCoin(TOKENS),
    fetchGate(TOKENS),
    fetchMEXC(TOKENS),
  ]);

  const allPrices = {
    Kraken:   kraken.status   === "fulfilled" ? kraken.value   : {},
    Coinbase: coinbase.status === "fulfilled" ? coinbase.value : {},
    KuCoin:   kucoin.status   === "fulfilled" ? kucoin.value   : {},
    "Gate.io": gate.status    === "fulfilled" ? gate.value     : {},
    MEXC:     mexc.status     === "fulfilled" ? mexc.value     : {},
  };

  const opportunities = findOpportunities(allPrices);

  if (opportunities.length === 0) {
    console.log(`✅ No opportunities above ${CONFIG.minSpreadPercent}% spread found.`);
  } else {
    console.log(`🎯 Found ${opportunities.length} opportunity(ies)!`);

    for (const opp of opportunities) {
      const key = `${opp.symbol}-${opp.buyAt.exchange}-${opp.sellAt.exchange}`;
      const lastAlerted = alertedOpportunities.get(key) || 0;
      const now = Date.now();

      if (now - lastAlerted > ALERT_COOLDOWN_MS) {
        console.log(`  🚨 ${opp.symbol}: ${opp.spreadPercent}% spread | Buy ${opp.buyAt.exchange} @ $${opp.buyAt.price.toFixed(6)} | Sell ${opp.sellAt.exchange} @ $${opp.sellAt.price.toFixed(6)}`);
        alertedOpportunities.set(key, now);
        await alertOpportunity(opp);
      } else {
        console.log(`  ⏳ ${opp.symbol}: ${opp.spreadPercent}% (cooldown active)`);
      }
    }
  }

  // Clean up old cooldowns
  for (const [key, time] of alertedOpportunities.entries()) {
    if (Date.now() - time > ALERT_COOLDOWN_MS) alertedOpportunities.delete(key);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
console.log("═══════════════════════════════════════════════════");
console.log("  CEX + DEX Arbitrage Scanner");
console.log(`  Tokens: ${TOKENS.length} | Exchanges: Kraken, Coinbase, KuCoin, Gate.io, MEXC`);
console.log(`  Min spread: ${CONFIG.minSpreadPercent}%`);
console.log(`  Scan interval: ${CONFIG.pollIntervalMs / 1000}s`);
console.log("═══════════════════════════════════════════════════");

scan();
setInterval(scan, CONFIG.pollIntervalMs);
