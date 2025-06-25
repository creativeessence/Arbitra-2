const { createClient } = require("redis");

const PROFIT_MARGIN = 0.005;  // minimum ETH you want to net

/**
 * Given an Opensea offer in ETH, subtract your profit margin,
 * then floor to the nearest 0.01 ETH and return that.
 *
 * e.g. osOfferEth = 0.199:
 *   rawTarget = 0.199 - 0.005 = 0.194
 *   ticks     = Math.floor(0.194 * 100) = 19
 *   result    = 19 / 100 = 0.19
 */
function calculateBidWithMargin(osOfferEth, profitMargin = PROFIT_MARGIN) {
  const rawTarget = osOfferEth - profitMargin;
  if (rawTarget <= 0) return 0;
  const flooredTicks = Math.floor(rawTarget * 100);
  return flooredTicks / 100;
}

async function main() {
  const client = createClient();
  await client.connect();

  const osKeys = await client.keys("c-offer:opensea:*");
  if (!osKeys.length) {
    console.log("No Opensea collection offers found in Redis.");
    await client.quit();
    return;
  }

  console.log(`\n🔍 Next Blur bids (profit ≥ ${PROFIT_MARGIN} ETH):\n`);

  for (const key of osKeys) {
    const contract = key.split(":")[2];
    const osRaw    = await client.get(key);
    if (!osRaw) {
      console.log(`• ${contract}: no Opensea data`);
      continue;
    }

    let osOfferEth;
    try {
      const osData    = JSON.parse(osRaw);
      osOfferEth      = parseFloat(osData.price_per_nft.readable);
    } catch {
      console.log(`• ${contract}: invalid Opensea JSON`);
      continue;
    }

    const bidEth = calculateBidWithMargin(osOfferEth);
    console.log(
      bidEth > 0
        ? `• ${contract}: Opensea @ ${osOfferEth.toFixed(3)} → bid @ ${bidEth.toFixed(2)} ETH`
        : `• ${contract}: Opensea @ ${osOfferEth.toFixed(3)} → bid too low (would be ≤ 0)`
    );
  }

  await client.quit();
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});