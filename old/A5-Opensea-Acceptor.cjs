/**
 * a5-opensea-acceptor.cjs
 *
 * 1. Fetch NFTs for OWNER_ADDRESS via Alchemy.
 * 2. Filter by collections.json (contract_address → slug).
 * 3. For each matching NFT:
 *    a) GET its “best offer” from Opensea (print raw JSON).
 *    b) POST to /offers/fulfillment_data with:
 *         { offer: { hash, chain, protocol_address },
 *           fulfiller: { address: OWNER_ADDRESS },
 *           consideration: { asset_contract_address, token_id } }
 *       and print the raw JSON response.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ─── CONFIGURATION ─────────────────────────────────────────────────────────────

const ALCHEMY_API_KEY   = 'xyz';
const OPENSEA_API_KEY   = 'xyz';
const OWNER_ADDRESS     = 'xyz';  // your wallet
const ALCHEMY_URL       = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getNFTsForOwner`;

// Load collections.json
const COLLECTIONS_PATH = path.join(__dirname, 'collections.json');
let collections;
try {
  const raw = fs.readFileSync(COLLECTIONS_PATH, 'utf8');
  collections = JSON.parse(raw).collections || [];
} catch (err) {
  console.error('⚠️  Could not read collections.json:', err.message);
  process.exit(1);
}

// Build a set of allowed contract addresses (lowercased)
const allowedContracts = new Set(
  collections.map((c) => c.contract_address.toLowerCase())
);
const slugByContract = {};
collections.forEach((c) => {
  slugByContract[c.contract_address.toLowerCase()] = c.slug;
});

// ─── MAIN ASYNC ─────────────────────────────────────────────────────────────────

;(async () => {
  console.log(`Fetching NFTs for owner: ${OWNER_ADDRESS} …`);

  let alchemyResponse;
  try {
    alchemyResponse = await axios.get(ALCHEMY_URL, {
      params: {
        owner: OWNER_ADDRESS,
        withMetadata: true,
      },
    });
  } catch (err) {
    console.error('❌ Error fetching NFTs from Alchemy:', err.response?.data || err.message);
    process.exit(1);
  }

  const ownedNfts = alchemyResponse.data.ownedNfts || [];
  if (ownedNfts.length === 0) {
    console.log('No NFTs found for this owner.');
    process.exit(0);
  }

  // Filter to only those whose contract is in collections.json
  const matching = ownedNfts.filter((nft) => {
    const contract = nft.contract.address.toLowerCase();
    return allowedContracts.has(contract);
  });

  if (matching.length === 0) {
    console.log('No matching NFTs found in your collections.');
    process.exit(0);
  }

  console.log(`Found ${matching.length} matching NFT(s):\n`);
  matching.forEach((nft, i) => {
    const c = nft.contract.address.toLowerCase();
    const slug = slugByContract[c];
    console.log(
      `${i + 1}. [${slug}] ${nft.contract.address.toLowerCase()}  |  tokenId: ${nft.tokenId}  |  name: ${nft.title || '–'}`
    );
  });
  console.log('');

  // ─── FOR EACH MATCHING NFT: GET “BEST OFFER” AND THEN POST FULFILLMENT DATA ────

  for (let i = 0; i < matching.length; i++) {
    const nft = matching[i];
    const contractAddr = nft.contract.address.toLowerCase();
    const tokenId      = nft.tokenId;
    const slug         = slugByContract[contractAddr];

    console.log(`→ Fetching best offer for ${slug} / #${tokenId} …`);

    // 1) GET best offer
    const bestOfferUrl = `https://api.opensea.io/api/v2/offers/collection/${slug}/nfts/${tokenId}/best`;
    let bestOfferResp;
    try {
      bestOfferResp = await axios.get(bestOfferUrl, {
        headers: {
          accept: 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
      });
    } catch (err) {
      console.error(
        `❌ Error fetching Opensea offer for ${slug} #${tokenId}:`,
        err.response?.status,
        err.response?.data || err.message
      );
      console.log('');
      continue;
    }

    // Print the entire “best offer” JSON
    console.log('• Best‐offer raw response:');
    console.log(JSON.stringify(bestOfferResp.data, null, 2));
    console.log('');

    // 2) Extract { order_hash, chain, protocol_address } from the best-offer response
    const { order_hash, chain, protocol_address } = bestOfferResp.data;
    if (!order_hash || !chain || !protocol_address) {
      console.error('❌ Missing one of order_hash/chain/protocol_address – skipping fulfillment.');
      console.log('');
      continue;
    }

    // 3) POST to /offers/fulfillment_data
    console.log(`→ Requesting fulfillment_data for order ${order_hash} …`);
    const fulfillUrl = 'https://api.opensea.io/api/v2/offers/fulfillment_data';
    const postBody = {
      offer: {
        hash: order_hash,
        chain: chain,
        protocol_address: protocol_address,
      },
      fulfiller: {
        address: OWNER_ADDRESS,
      },
      consideration: {
        asset_contract_address: contractAddr,
        token_id: tokenId,
      },
    };

    let fulfillResp;
    try {
      fulfillResp = await axios.post(fulfillUrl, postBody, {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
      });
    } catch (err) {
      console.error(
        `❌ Error fetching fulfillment_data for ${slug} #${tokenId}:`,
        err.response?.status,
        err.response?.data || err.message
      );
      console.log('');
      continue;
    }

    // Print the entire “fulfillment_data” JSON exactly as returned
    console.log('• Fulfillment_data raw response:');
    console.log(JSON.stringify(fulfillResp.data, null, 2));
    console.log('');
  }
})();
