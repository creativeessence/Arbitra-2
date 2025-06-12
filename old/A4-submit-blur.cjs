/**
 * Blur Bidder – Monitor both OpenSea and Blur “best offer” changes
 * and maintain a Blur collection bid at PROFIT_MARGIN below the highest reported price.
 *
 * – Watches Redis keys:
 *     • “c-offer:opensea:<contract>”        → JSON { price_per_nft: { readable: "<eth>" }, … }
 *     • “c-offer:blur:collection:<contract>” → Either:
 *         – JSON { bestPrice: "<eth>", totalValue: "<…>" }
 *         – Or a bare numeric string like "0.18" (if that’s how your upstream writes it)
 *
 * – Logs immediately on startup for any existing OpenSea keys (and submits bids),
 *   but does NOT act on existing Blur keys at startup—only on their changes after startup.
 *
 * – Whenever *any* watched JSON changes (OpenSea or Blur), logs that change (old → new), then
 *   extracts the relevant numeric field to recalc our Blur bid:
 *     bidEth = floor((observedPrice − PROFIT_MARGIN) * 100) / 100
 *
 * – If that newly-calculated bid exactly matches what’s in Redis under “Bid:Blur:<contract>”,
 *   logs “Calculated Blur bid unchanged @ X.XX ETH.” If it differs, cancels the old bid (if any),
 *   formats → signs → submits a new one via the Blur API, and updates Redis.
 *
 * – Polls Redis every 10 ms for any key change, using raw-string comparison so
 *   even if bestPrice stays the same but totalValue changes, you still see a log.
 */

const fs         = require("fs");
const path       = require("path");
const axios      = require("axios");
const { ethers } = require("ethers");
const { createClient } = require("redis");

// —– LOAD AUTH TOKEN FROM auth.json —–
let AUTH_TOKEN;
try {
  const authPath = path.resolve(__dirname, "auth.json");
  const rawAuth  = fs.readFileSync(authPath, "utf-8");
  const parsed   = JSON.parse(rawAuth);
  if (!parsed.authToken) {
    console.error("⚠️  auth.json must contain an \"authToken\" field.");
    process.exit(1);
  }
  AUTH_TOKEN = parsed.authToken;
} catch (err) {
  console.error("⚠️  Could not read auth.json:", err.message);
  process.exit(1);
}

// —– CONFIGURE THESE —–
const WALLET_ADDRESS = "xyz";
const NFT_API_KEY    = "xyz";
const PRIVATE_KEY    = "xyz";

// How far below the observed price to bid (in ETH)
const PROFIT_MARGIN  = 0.005;
// Each bid expires after 24 hours
const EXPIRE_MS      = 24 * 60 * 60 * 1000;
// Polling interval (ms)
const POLL_INTERVAL  = 10;

// Redis key patterns
const OS_PATTERN     = "c-offer:opensea:*";
const BLUR_PATTERN   = "c-offer:blur:collection:*";

// —– VALIDATE CONFIG —–
if (![AUTH_TOKEN, WALLET_ADDRESS, NFT_API_KEY, PRIVATE_KEY].every(x => x)) {
  console.error("⚠️  authToken, WALLET_ADDRESS, NFT_API_KEY & PRIVATE_KEY must all be set.");
  process.exit(1);
}

// Axios instance for Blur API
const BLUR = axios.create({
  baseURL: "https://nfttools.pro/blur/v1",
  headers: {
    "Content-Type":    "application/json",
    authToken:         AUTH_TOKEN,
    walletAddress:     WALLET_ADDRESS,
    "X-NFT-API-Key":   NFT_API_KEY,
  },
});

// lastSeenOpenSea: Map<contract, string>  — last raw JSON seen for each OpenSea key
// lastSeenBlur:   Map<contract, string>  — last raw string seen for each Blur key
const lastSeenOpenSea = new Map();
const lastSeenBlur     = new Map();

/**
 * Compute the “desired” Blur bid (ETH) given an observed price (ETH).
 * Two-decimal precision, floored.
 */
function calculateBidWithMargin(observedEth) {
  const raw = observedEth - PROFIT_MARGIN;
  if (raw <= 0) return 0;
  return Math.floor(raw * 100) / 100;
}

/**
 * Called whenever we detect a new or changed OpenSea JSON for `contract`.
 * Logs the “First-time” or “changed” message (already printed up above),
 * then extracts price_per_nft.readable → recalc the Blur bid, compares to Redis, and updates if needed.
 *
 * @param {string} contract
 * @param {string} rawJson      – the new raw JSON string from Redis
 * @param {RedisClient} redisClient
 */
async function processFromOpenSea(contract, rawJson, redisClient) {
  let osOfferEth;
  try {
    const obj = JSON.parse(rawJson);
    osOfferEth = parseFloat(obj.price_per_nft.readable);
    if (isNaN(osOfferEth)) throw new Error("price_per_nft.readable is NaN");
  } catch (err) {
    console.warn(`• [${contract}] Malformed OpenSea JSON → skipping:`, err.message);
    return;
  }

  // 1) Calculate our new bid
  const bidEth = calculateBidWithMargin(osOfferEth);
  if (bidEth <= 0) {
    console.log(`• [${contract}] OS @ ${osOfferEth.toFixed(3)} → margin too large, skip.`);
    return;
  }

  // 2) Check Redis for the old Blur bid
  const redisKey  = `Bid:Blur:${contract}`;
  const oldBidRaw = await redisClient.get(redisKey);
  const oldBidVal = oldBidRaw ? parseFloat(oldBidRaw) : null;

  // 3) If it matches exactly, log “calculated bid unchanged”
  if (oldBidVal !== null && !isNaN(oldBidVal) && oldBidVal === bidEth) {
    console.log(`↳ [${contract}] Calculated Blur bid (OS trigger) unchanged @ ${bidEth.toFixed(2)} ETH`);
    return;
  }

  // 4) Otherwise, cancel old and place new
  if (oldBidVal !== null && !isNaN(oldBidVal)) {
    console.log(`↳ [${contract}] Canceling old Blur @ ${oldBidVal.toFixed(2)} ETH (was based on OS)`);
    // TODO ↦ Insert Blur-API call to cancel the old bid for this contract
  } else {
    console.log(`↳ [${contract}] No prior Blur bid (OS trigger), will place new @ ${bidEth.toFixed(2)} ETH`);
  }

  await submitNewBlurBid(contract, bidEth, redisClient, "(triggered by OpenSea)");
}

/**
 * Called whenever we detect a new or changed Blur data for `contract`.
 * rawString might be JSON (with bestPrice) or a bare numeric string.
 * Logs the “First-time” or “changed” message (already printed up above),
 * then extracts the numeric price (bestPrice or raw number) → recalc the Blur bid,
 * compares to Redis, and updates if needed.
 *
 * @param {string} contract
 * @param {string} rawString   – the new raw string from Redis
 * @param {RedisClient} redisClient
 */
async function processFromBlur(contract, rawString, redisClient) {
  // Determine blurBestPrice from either JSON.bestPrice or bare numeric
  let blurBestPrice;
  let usedSource; // for logging
  try {
    if (rawString.trim().startsWith("{")) {
      const obj = JSON.parse(rawString);
      blurBestPrice = parseFloat(obj.bestPrice);
      if (isNaN(blurBestPrice)) throw new Error("bestPrice is NaN");
      usedSource = "JSON.bestPrice";
    } else {
      blurBestPrice = parseFloat(rawString);
      if (isNaN(blurBestPrice)) throw new Error("raw string is not a number");
      usedSource = "raw string";
    }
  } catch (err) {
    console.warn(`• [${contract}] Malformed Blur data → skipping:`, err.message);
    return;
  }

  // 1) Calculate our new bid
  const bidEth = calculateBidWithMargin(blurBestPrice);
  if (bidEth <= 0) {
    console.log(`• [${contract}] Blur ${usedSource} ${blurBestPrice.toFixed(3)} → margin too large, skip.`);
    return;
  }

  // 2) Check Redis for the old Blur bid
  const redisKey  = `Bid:Blur:${contract}`;
  const oldBidRaw = await redisClient.get(redisKey);
  const oldBidVal = oldBidRaw ? parseFloat(oldBidRaw) : null;

  // 3) If it matches exactly, log “calculated bid unchanged”
  if (oldBidVal !== null && !isNaN(oldBidVal) && oldBidVal === bidEth) {
    console.log(`↳ [${contract}] Calculated Blur bid (Blur trigger) unchanged @ ${bidEth.toFixed(2)} ETH`);
    return;
  }

  // 4) Otherwise, cancel old and place new
  if (oldBidVal !== null && !isNaN(oldBidVal)) {
    console.log(`↳ [${contract}] Canceling old Blur @ ${oldBidVal.toFixed(2)} ETH (was based on Blur)`);
    // TODO ↦ Insert Blur-API call to cancel the old bid for this contract
  } else {
    console.log(`↳ [${contract}] No prior Blur bid (Blur trigger), will place new @ ${bidEth.toFixed(2)} ETH`);
  }

  await submitNewBlurBid(contract, bidEth, redisClient, "(triggered by Blur)");
}

/**
 * Format → sign → submit a new Blur collection bid for `contract` at `bidEth` ETH.
 * On success, store the new bid in Redis under `Bid:Blur:<contract>`.
 *
 * @param {string} contract
 * @param {number} bidEth
 * @param {RedisClient} redisClient
 * @param {string}   note       – additional text for logging (e.g. source of trigger)
 */
async function submitNewBlurBid(contract, bidEth, redisClient, note) {
  // Prepare the bid data
  const bidData = {
    contractAddress: contract,
    price:           { unit: "BETH", amount: bidEth.toFixed(2) },
    quantity:        1,
    expirationTime:  new Date(Date.now() + EXPIRE_MS).toISOString(),
  };

  // STEP 1: format
  let fmt;
  try {
    fmt = await BLUR.post("/collection-bids/format", bidData);
  } catch (err) {
    console.error(`✗ [${contract}] Blur “format” failed →`, err.response?.data || err.message);
    return;
  }

  // STEP 2: extract our BLUR signature object
  const sigObj = fmt.data.signatures.find(s => s.marketplace === "BLUR");
  if (!sigObj) {
    console.error(`✗ [${contract}] no BLUR signature returned from format`);
    return;
  }

  // STEP 3: normalize any BigNumber fields into decimal strings
  const normalized = {};
  for (const [k, v] of Object.entries(sigObj.signData.value)) {
    if (v && typeof v === "object" && typeof v.hex === "string") {
      normalized[k] = BigInt(v.hex).toString();
    } else {
      normalized[k] = v;
    }
  }

  // STEP 4: sign with our private key
  let signature;
  try {
    const wallet = new ethers.Wallet(PRIVATE_KEY);
    signature = await wallet.signTypedData(
      sigObj.signData.domain,
      sigObj.signData.types,
      normalized
    );
  } catch (err) {
    console.error(`✗ [${contract}] signing failed →`, err.message);
    return;
  }

  // STEP 5: submit the bid
  try {
    await BLUR.post("/collection-bids/submit", {
      ...bidData,
      marketplaceData: sigObj.marketplaceData,
      signature,
    });
    console.log(`✅ [${contract}] New Blur bid @ ${bidEth.toFixed(2)} ETH ${note}`);

    // STEP 6: store the new bid in Redis
    const redisKey = `Bid:Blur:${contract}`;
    await redisClient.set(redisKey, bidEth.toFixed(2));
    console.log(`   ↳ saved ${redisKey} → ${bidEth.toFixed(2)}`);
  } catch (err) {
    console.error(`✗ [${contract}] Blur “submit” failed →`, err.response?.data || err.message);
  }
}

/**
 * MAIN: connect to Redis, print a startup message, initialize lastSeen maps (with logs for OpenSea only),
 * then poll every POLL_INTERVAL ms for any raw-string change on both key patterns.
 * – Does NOT act on existing Blur keys at startup; only on their changes after startup.
 */
async function main() {
  console.log("🔍 Starting Blur Bidder… connecting to Redis.");
  const client = createClient();
  await client.connect();
  console.log("✅ Connected to Redis. Populating initial keys…");

  // ─── INITIAL POPULATION ─────────────────────────────────────────────────────────

  // 1) Load and process all existing OpenSea-offer keys
  {
    const osKeys = await client.keys(OS_PATTERN);
    for (const key of osKeys) {
      // Key format: "c-offer:opensea:<contract>"
      const contract = key.split(":")[2];
      const raw       = await client.get(key);
      if (!raw) continue;

      const trimmed = raw.trim();
      lastSeenOpenSea.set(contract, trimmed);
      console.log(`• [${contract}] First-time OpenSea data: ${trimmed}`);
      await processFromOpenSea(contract, trimmed, client);
    }
  }

  // 2) Load all existing Blur-offer keys into lastSeenBlur (raw string),
  //    but do NOT call processFromBlur here. Just store them.
  {
    const blurKeys = await client.keys(BLUR_PATTERN);
    for (const key of blurKeys) {
      // Key format: "c-offer:blur:collection:<contract>"
      const contract = key.split(":")[3];
      const raw       = await client.get(key);
      if (!raw) continue;

      const trimmed = raw.trim();
      lastSeenBlur.set(contract, trimmed);
      console.log(`• [${contract}] First-time Blur data: ${trimmed}`);
      // NOTE: We do NOT call processFromBlur() for initial data.
    }
  }

  console.log("➡️ Now watching for changes… (polling every " + POLL_INTERVAL + " ms)");

  // ─── POLLING LOOP ────────────────────────────────────────────────────────────────

  setInterval(async () => {
    try {
      // ─── 1) Check OpenSea keys ─────────────────────────────────────────────────
      const osKeys = await client.keys(OS_PATTERN);
      for (const key of osKeys) {
        // e.g. "c-offer:opensea:0xAbC123..."
        const contract = key.split(":")[2];
        const raw       = await client.get(key);
        if (!raw) continue;

        const rawTrim = raw.trim();
        const prevRaw = lastSeenOpenSea.get(contract);

        if (prevRaw === undefined) {
          // Brand-new key not seen on startup
          console.log(`• [${contract}] First-time OpenSea data: ${rawTrim}`);
          lastSeenOpenSea.set(contract, rawTrim);
          await processFromOpenSea(contract, rawTrim, client);
        } else if (prevRaw !== rawTrim) {
          // Existing key whose value changed
          console.log(
            `• [${contract}] OpenSea data changed:\n` +
            `   old → ${prevRaw}\n` +
            `   new → ${rawTrim}`
          );
          lastSeenOpenSea.set(contract, rawTrim);
          await processFromOpenSea(contract, rawTrim, client);
        }
        // Otherwise: prevRaw === rawTrim → no change → do nothing
      }

      // ─── 2) Check Blur keys ────────────────────────────────────────────────────
      const blurKeys = await client.keys(BLUR_PATTERN);
      for (const key of blurKeys) {
        // e.g. "c-offer:blur:collection:0xAbC123..."
        const contract = key.split(":")[3];
        const raw       = await client.get(key);
        if (!raw) continue;

        const rawTrim = raw.trim();
        const prevRaw = lastSeenBlur.get(contract);

        if (prevRaw === undefined) {
          // Brand-new key not seen on startup
          console.log(`• [${contract}] First-time Blur data: ${rawTrim}`);
          lastSeenBlur.set(contract, rawTrim);
          await processFromBlur(contract, rawTrim, client);
        } else if (prevRaw !== rawTrim) {
          // Existing key whose value changed
          console.log(
            `• [${contract}] Blur data changed:\n` +
            `   old → ${prevRaw}\n` +
            `   new → ${rawTrim}`
          );
          lastSeenBlur.set(contract, rawTrim);
          await processFromBlur(contract, rawTrim, client);
        }
        // Otherwise: prevRaw === rawTrim → no change → do nothing
      }
    } catch (err) {
      console.error("Polling loop error:", err);
      // (You can optionally clearInterval / attempt reconnect here if persistent)
    }
  }, POLL_INTERVAL);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
