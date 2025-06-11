#!/usr/bin/env node
/**
 * a3-opensea-amount.cjs
 *
 * Reads all collections from collections.json and, for each:
 *  1. Fetches the Blur bid from Redis.
 *  2. Fetches the OpenSea bid JSON from Redis.
 *  3. Computes the optimal bid (capped by blurBid − PROFIT_MARGIN, or osBid + MIN_INCREMENT).
 *  4. Prints slug, contract_address, blurBid, osBid, maxBid, and finalBid.
 *
 * Usage:
 *   node a3-opensea-amount.cjs
 *
 * Requirements:
 *   npm install redis
 *   Make sure `collections.json` resides in the same folder and looks like:
 *   {
 *     "collections": [
 *       {
 *         "contract_address": "0xb6a37b5d14d502c3ab0ae6f3a0e058bc9517786e",
 *         "slug": "azukielementals"
 *       }
 *     ]
 *   }
 */

const { createClient } = require('redis');
const path = require('path');
const fs = require('fs');

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const REDIS_HOST    = '127.0.0.1';
const REDIS_PORT    = 6379;
const REDIS_DB      = 0;

// Profit margin in ETH (e.g. 0.005 means we want at least 0.005 ETH profit)
const PROFIT_MARGIN = 0.005;

// Minimum outbid increment in ETH (e.g. 0.00001)
const MIN_INCREMENT = 0.00001;

// Path to collections.json (must be in the same directory as this script)
const COLLECTIONS_FILE = path.join(__dirname, 'collections.json');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Fetch the current Blur bid for a given collection from Redis.
 * Key format: "c-offer:blur:collection:<collection_addr>"
 * Returns as a float in ETH (e.g. 0.200).
 */
async function getBlurBid(client, collectionAddr) {
  const key = `c-offer:blur:collection:${collectionAddr}`;
  const raw = await client.get(key);
  if (raw === null) {
    throw new Error(`(Blur) No entry at Redis key "${key}"`);
  }
  const blurStr = raw.toString();
  const blurBid = parseFloat(blurStr);
  if (isNaN(blurBid)) {
    throw new Error(`Failed to parse Blur bid "${blurStr}" as a float`);
  }
  return blurBid;
}

/**
 * Fetch the current OpenSea bid JSON for a given collection from Redis.
 * Key format: "c-offer:opensea:<collection_addr>"
 * Parses the JSON and returns price_per_nft.readable as a float (e.g. "0.198" → 0.198).
 */
async function getOpenseaBid(client, collectionAddr) {
  const key = `c-offer:opensea:${collectionAddr}`;
  const raw = await client.get(key);
  if (raw === null) {
    throw new Error(`(OpenSea) No entry at Redis key "${key}"`);
  }
  let data;
  try {
    data = JSON.parse(raw.toString());
  } catch (err) {
    throw new Error(`Failed to JSON.parse OpenSea bid: ${err.message}`);
  }
  const readable = data?.price_per_nft?.readable;
  if (typeof readable !== 'string') {
    throw new Error(`Missing "price_per_nft.readable" field in JSON at "${key}"`);
  }
  const osBid = parseFloat(readable);
  if (isNaN(osBid)) {
    throw new Error(`Failed to parse OpenSea "readable" price "${readable}" as a float`);
  }
  return osBid;
}

/**
 * Given:
 *   - blurBid     (float): current Blur bid (ETH)
 *   - osBid       (float): current highest OpenSea bid (ETH)
 *   - profitMargin(float): desired minimum profit (ETH)
 *   - minIncrement(float): smallest outbid increment (ETH)
 * Returns:
 *   - bidAmount (float): ETH amount we should submit on OpenSea
 */
function computeBidAmount(blurBid, osBid, profitMargin, minIncrement) {
  const maxBid = blurBid - profitMargin;
  if (maxBid <= 0) {
    throw new Error(
      `Blur bid (${blurBid.toFixed(6)} ETH) is not greater than profit margin (${profitMargin.toFixed(6)} ETH)`
    );
  }
  if (osBid >= maxBid) {
    // Cap at maxBid
    return Math.round(maxBid * 1e5) / 1e5;
  } else {
    // Outbid by the minimum increment
    const bumped = osBid + minIncrement;
    return Math.round(bumped * 1e5) / 1e5;
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load collections.json
  let collectionsData;
  try {
    const raw = fs.readFileSync(COLLECTIONS_FILE, 'utf-8');
    collectionsData = JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading or parsing "${COLLECTIONS_FILE}": ${err.message}`);
    process.exit(1);
  }

  const collections = collectionsData.collections;
  if (!Array.isArray(collections) || collections.length === 0) {
    console.error(`No collections found in "${COLLECTIONS_FILE}".`);
    process.exit(1);
  }

  // 2. Connect to Redis
  const client = createClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
    database: REDIS_DB,
  });

  client.on('error', (err) => {
    console.error('Redis client error:', err);
    process.exit(1);
  });

  await client.connect();

  console.log(`Found ${collections.length} collection(s). Computing bids:\n`);

  // 3. Loop through each collection
  for (const entry of collections) {
    const contract = entry.contract_address.toLowerCase();
    const slug     = entry.slug || contract;

    process.stdout.write(`→ [${slug}] (${contract}): `);

    try {
      // 3a. Fetch Blur bid
      const blurBid = await getBlurBid(client, contract);

      // 3b. Fetch OpenSea bid
      const osBid = await getOpenseaBid(client, contract);

      // 3c. Compute our final bid
      const maxBid    = blurBid - PROFIT_MARGIN;
      const finalBid  = computeBidAmount(blurBid, osBid, PROFIT_MARGIN, MIN_INCREMENT);

      // 3d. Print results
      console.log(
        `Blur=${blurBid.toFixed(6)} ETH,  ` +
        `OpenSea=${osBid.toFixed(6)} ETH,  ` +
        `Max=${maxBid.toFixed(6)} ETH,  ` +
        `→ Bid ${finalBid.toFixed(5)} ETH`
      );
    } catch (err) {
      console.log(`Error: ${err.message}`);
    }
  }

  // 4. Disconnect
  await client.disconnect();
  console.log('\nDone.');
}

main();
