// collection-bids-filtered.js
const fs = require("fs");
const path = require("path");
const io = require("socket.io-client");
const redis = require("redis");

// 🔹 Connect to Redis (added)
const redisClient = redis.createClient();
redisClient.on("error", (err) => console.error("❌ Redis Error:", err));
(async () => {
  await redisClient.connect();
  console.log("✅ Connected to Redis");
})();

// 🔑 your Blur API key
const API_KEY = "xyz";

// load and normalize allowed addresses
const { collections } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "collections.json"), "utf8")
);
const allowed = new Set(
  collections.map((c) => c.contract_address.toLowerCase())
);

const socket = io("ws://nfttools.pro?app=blur", {
  transports: ["websocket"],
  auth: { "api-key": API_KEY },
});

socket.on("connect", () => {
  console.log("✅ Connected – listening for filtered collection_bidLevels");
});

socket.on("collection_bidLevels", async (raw) => {
  let evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    console.warn("⚠️  [collection_bidLevels] unparsed payload:", raw);
    return;
  }

  const addr = (evt.contractAddress || "").toLowerCase();
  if (!allowed.has(addr)) return; // skip anything not in collections.json

  const { contractAddress, bestPrice, totalValue } = evt;
  console.log(
    `ℹ️  [collection_bidLevels] ${JSON.stringify({
      contractAddress,
      bestPrice,
      totalValue,
    })}`
  );

  // 🔹 Save to Redis (added)
  try {
    const key = `c-offer:blur:collection:${addr}`;
    await redisClient.set(key, bestPrice);
    console.log(`✅ Stored in Redis: ${key} → ${bestPrice}`);
  } catch (err) {
    console.error("❌ Failed to save to Redis:", err);
  }
});

socket.on("disconnect", (reason) => {
  console.log("🔌 Disconnected:", reason);
});
socket.on("error", (err) => {
  console.error("❌ WebSocket error:", err);
});