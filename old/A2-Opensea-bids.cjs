/**
 * 1) On startup, fetches the top offer for each collection via:
 *      https://api.opensea.io/api/v2/offers/collection/{slug}
 *    and stores it in Redis under `c-offer:opensea:{contract_address}`.
 *
 * 2) Every 500 ms, re-fetches each collection’s top offer and, if the order_hash
 *    differs from what’s in Redis, updates Redis (so the stored “top bid” is always current).
 *
 * 3) Connects to the Opensea Stream WebSocket (wss://stream.openseabeta.com/socket/websocket),
 *    subscribes to each collection’s topic (collection:{slug}), and listens for “order_invalidate”.
 *    If an invalidation matches the Redis‐stored order_hash, immediately re-fetch that slug’s
 *    top offer and update Redis.
 *
 * 4) If the WebSocket connection fails (e.g. HTTP 504, DNS error, network drop), waits 5 seconds and reconnects.
 *
 * Usage:
 *   npm install ws axios redis
 */

const fs        = require('fs').promises;
const path      = require('path');
const axios     = require('axios');
const WebSocket = require('ws');
const redis     = require('redis');

////////////////////////////////////////////////////////////////////////////////
// CONFIGURATION
////////////////////////////////////////////////////////////////////////////////

// REST API key for fetching offers
const REST_API_KEY = 'xyz';

// WebSocket (Stream) API key
const WS_API_KEY = 'xyz';

// Phoenix‐style Stream WebSocket endpoint (Mainnet)
const WS_BASE_URL = 'wss://stream.openseabeta.com/socket/websocket';
const WS_ENDPOINT = `${WS_BASE_URL}?token=${WS_API_KEY}`;

// Redis connection URL (defaults to localhost:6379)
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Path to collections.json
const COLLECTIONS_FILE = path.resolve(__dirname, 'collections.json');

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL_MS = 30_000;

// Poll interval (500 ms)
const POLL_INTERVAL_MS = 500;

// Delay before attempting reconnect (ms)
const RECONNECT_DELAY_MS = 5_000;

////////////////////////////////////////////////////////////////////////////////
// HELPER: fetchFirstOfferForSlug(slug)
//
// Calls exactly: https://api.opensea.io/api/v2/offers/collection/{slug}
// Returns `null` if no offers; otherwise returns the top‐offer object augmented
// with `price_per_nft`, following your original A2 logic.
//
////////////////////////////////////////////////////////////////////////////////
async function fetchFirstOfferForSlug(slug) {
  const url = `https://api.opensea.io/api/v2/offers/collection/${slug}`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        accept: 'application/json',
        'x-api-key': REST_API_KEY
      }
    });

    if (!Array.isArray(data.offers) || data.offers.length === 0) {
      return null;
    }

    const offer = data.offers[0];
    // Compute totalWei & per‐NFT Wei
    const totalWei = BigInt(offer.price.value);
    const cons     = offer.protocol_data?.parameters?.consideration || [];
    const nftCount = cons.filter(c => c.itemType === 4).length;
    const count    = nftCount > 0 ? nftCount : 1;
    const perWei   = totalWei / BigInt(count);

    const pricePerNft = {
      currency : offer.price.currency,
      value    : perWei.toString(),
      decimals : offer.price.decimals,
      readable : (Number(perWei) / (10 ** offer.price.decimals)).toString()
    };

    return {
      ...offer,
      price_per_nft: pricePerNft
    };
  } catch (err) {
    console.error(`❌ Error fetching offer for "${slug}":`, err.response?.data || err.message);
    return null;
  }
}

////////////////////////////////////////////////////////////////////////////////
// MAIN
////////////////////////////////////////////////////////////////////////////////
(async () => {
  // 1) Load collections.json
  let collectionsList;
  try {
    const raw = await fs.readFile(COLLECTIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.collections)) {
      throw new Error('collections.json must have a top‐level "collections" array.');
    }
    collectionsList = parsed.collections.map(entry => {
      if (!entry.slug || !entry.contract_address) {
        throw new Error('Each entry in collections.json needs both "slug" and "contract_address".');
      }
      return {
        slug:     entry.slug.toLowerCase(),
        contract: entry.contract_address.toLowerCase()
      };
    });
  } catch (err) {
    console.error(`❌ Failed to load/parse collections.json: ${err.message}`);
    process.exit(1);
  }

  if (collectionsList.length === 0) {
    console.warn('⚠️  collections.json is empty. Nothing to monitor.');
    process.exit(0);
  }

  // Build a map: slug → contract_address
  const slugToContract = {};
  collectionsList.forEach(({ slug, contract }) => {
    slugToContract[slug] = contract;
  });

  // 2) Connect to Redis
  const redisClient = redis.createClient({ url: REDIS_URL });
  redisClient.on('error', e => console.error('❌ Redis error:', e));
  await redisClient.connect();
  console.log('✅ Connected to Redis.');

  // 3) INITIAL POPULATION: for each collection, fetch top offer & store in Redis
  console.log('🔄 Initial population of top offers in Redis…');
  await Promise.all(collectionsList.map(async ({ slug, contract }) => {
    const redisKey = `c-offer:opensea:${contract}`;
    try {
      const topOffer = await fetchFirstOfferForSlug(slug);
      if (topOffer) {
        await redisClient.set(redisKey, JSON.stringify(topOffer));
        console.log(`   • [${slug}] stored top offer → order_hash=${topOffer.order_hash}`);
      } else {
        await redisClient.set(redisKey, '');
        console.log(`   • [${slug}] no open offers → stored empty string`);
      }
    } catch (err) {
      console.error(`   • [${slug}] initial fetch error: ${err.message}`);
    }
  }));
  console.log('✅ Initial population complete.\n');

  // 4) Start polling loop (every 500 ms) to keep Redis fully up to date
  setInterval(async () => {
    for (const { slug, contract } of collectionsList) {
      const redisKey = `c-offer:opensea:${contract}`;
      try {
        const newOffer = await fetchFirstOfferForSlug(slug);
        // Fetch what’s currently in Redis
        const storedRaw = await redisClient.get(redisKey);
        let storedHash = null;
        if (storedRaw) {
          try {
            const parsed = JSON.parse(storedRaw);
            storedHash = parsed.order_hash;
          } catch {
            storedHash = null;
          }
        }
        const newHash = newOffer?.order_hash ?? null;

        // If hashes differ (including from null → something), update Redis
        if (newHash !== storedHash) {
          if (newOffer) {
            await redisClient.set(redisKey, JSON.stringify(newOffer));
            console.log(
              `   ↻ [Poll] Updated Redis for [${slug}]: order_hash changed ` +
              `(was=${storedHash ?? '<none>'}, now=${newHash})`
            );
          } else {
            await redisClient.set(redisKey, '');
            console.log(`   ↻ [Poll] Cleared Redis for [${slug}]: no open offers now`);
          }
        }
      } catch (err) {
        console.error(`   • [Poll] Error fetching/updating for [${slug}]:`, err.message);
      }
    }
  }, POLL_INTERVAL_MS);

  // 5) Open & maintain WebSocket connection with auto‐reconnect
  async function connectWebSocket() {
    console.log(`[WS] Attempting to connect to ${WS_ENDPOINT} …`);
    const ws = new WebSocket(WS_ENDPOINT);

    let heartbeatInterval = null;

    ws.on('open', () => {
      console.log('[WS] Connected to Opensea Stream API.');

      // Send initial heartbeat, then every 30 s
      const hbMsg = { topic: 'phoenix', event: 'heartbeat', payload: {}, ref: 0 };
      ws.send(JSON.stringify(hbMsg));
      heartbeatInterval = setInterval(() => {
        ws.send(JSON.stringify(hbMsg));
      }, HEARTBEAT_INTERVAL_MS);

      // Subscribe (phx_join) to each collection topic
      collectionsList.forEach(({ slug }, idx) => {
        const joinMsg = {
          topic:   `collection:${slug}`,
          event:   'phx_join',
          payload: {},
          ref:     idx + 1
        };
        ws.send(JSON.stringify(joinMsg));
        console.log(`[WS] Subscribed to collection:${slug}`);
      });
    });

    ws.on('message', async rawData => {
      let msg;
      try {
        msg = JSON.parse(rawData);
      } catch {
        console.error('[WS] Received non‐JSON message:', rawData);
        return;
      }

      // Determine event name (msg.event or msg.payload.event_type)
      const eventName = msg.event || msg.payload?.event_type || '';
      if (eventName !== 'order_invalidate') {
        return; // ignore everything except invalidations
      }

      // Actual data is usually under msg.payload.payload
      const rawPayload = msg.payload?.payload ?? msg.payload;
      if (!rawPayload || !rawPayload.collection) {
        console.warn('[WS] order_invalidate missing payload.collection; skipping.');
        return;
      }

      const slug = rawPayload.collection.slug.toLowerCase();
      const invalidatedHash = rawPayload.order_hash;
      console.log(`\n▶ Received order_invalidate for [${slug}] → order_hash=${invalidatedHash}`);

      const contractAddress = slugToContract[slug];
      if (!contractAddress) {
        console.warn(`   • No contract found for slug "${slug}". Skipping.`);
        return;
      }

      const redisKey = `c-offer:opensea:${contractAddress}`;
      let storedJSON;
      try {
        storedJSON = await redisClient.get(redisKey);
      } catch (err) {
        console.error(`   • Redis GET error for ${redisKey}:`, err.message);
        return;
      }

      if (!storedJSON) {
        console.log(`   • Redis key ${redisKey} empty (no stored top offer). Skipping.`);
        return;
      }

      let storedOffer;
      try {
        storedOffer = JSON.parse(storedJSON);
      } catch (err) {
        console.error(`   • Failed to parse JSON from Redis for ${redisKey}:`, err.message);
        return;
      }

      if (storedOffer.order_hash !== invalidatedHash) {
        console.log('   • Stored order_hash ≠ invalidatedHash. No action.');
        return;
      }

      // The invalidated order was our stored top-offer → REFRESH immediately
      console.log('   • Invalidated order WAS our stored top-offer. Fetching new top offer…');
      try {
        const newOffer = await fetchFirstOfferForSlug(slug);
        if (newOffer) {
          await redisClient.set(redisKey, JSON.stringify(newOffer));
          console.log(
            `   ✓ Updated Redis: new top-offer for [${slug}] → order_hash=${newOffer.order_hash}`
          );
        } else {
          await redisClient.set(redisKey, '');
          console.log(`   ✓ Updated Redis: [${slug}] now has NO open offers.`);
        }
      } catch (err) {
        console.error(`   • Error re-fetching top-offer for [${slug}]:`, err.message);
      }
    });

    ws.on('error', err => {
      console.error('[WS] Error:', err.message);
    });

    ws.on('close', (code, reason) => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      console.warn(`[WS] Disconnected (code=${code}, reason="${reason}").`);
      console.log(`   → Reconnecting in ${RECONNECT_DELAY_MS / 1000}s…\n`);
      setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
    });
  }

  // Start the first WebSocket connection
  connectWebSocket();
})();