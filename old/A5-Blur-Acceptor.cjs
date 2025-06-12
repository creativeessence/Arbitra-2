// a5-blur-acceptor.cjs

/**
 * Fetch all NFTs owned by a given wallet using Alchemy’s getNFTsForOwner endpoint,
 * filter to only those whose contract address matches one in collections.json,
 * then for each matched NFT:
 *   1) repeatedly request a bid quote from the Blur API and attempt to accept it,
 *      looping until the accept call returns success.
 *
 * The fee rate is configured per‐collection in collections.json.
 * Replace placeholder strings with your real values before running.
 *
 * Prerequisites:
 *   1. npm install axios
 *   2. Place a file named `collections.json` in the same directory, for example:
 *      {
 *        "collections": [
 *          {
 *            "contract_address": "0xb6a37b5d14d502c3ab0ae6f3a0e058bc9517786e",
 *            "slug": "azukielementals",
 *            "Fee_Rate": "30"
 *          },
 *          {
 *            "contract_address": "0x09233d553058c2F42ba751C87816a8E9FaE7Ef10",
 *            "slug": "mypethooligan",
 *            "Fee_Rate": "25"
 *          },
 *          {
 *            "contract_address": "0x71d1e9741da1e25ffd377be56d133359492b9c3b",
 *            "slug": "seedworld-vanguards-revealed",
 *            "Fee_Rate": "50"
 *          }
 *        ]
 *      }
 *
 * Usage:
 *   node a5-blur-acceptor.cjs
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ─── HARD-CODED CONFIGURATION ───────────────────────────────────────────────────

// Your Alchemy API key:
const ALCHEMY_API_KEY = 'xyz';

// The wallet address you want to query & use for Blur:
const WALLET_ADDRESS = 'xyz';

// Your Blur Bid Quote API auth token (JWT):
const AUTH_TOKEN = 'xyz';

// Your X-NFT-API-Key for the Blur API:
const NFT_API_KEY = 'xyz';

// The Ethereum network to query (e.g. 'eth-mainnet'):
const NETWORK = 'eth-mainnet';

// ────────────────────────────────────────────────────────────────────────────────

// Load collections.json and build a Set of contract addresses (lowercased)
let collectionAddresses = new Set();
let collectionData;
try {
  const jsonPath = path.join(__dirname, 'collections.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  collectionData = JSON.parse(raw);

  if (!Array.isArray(collectionData.collections)) {
    throw new Error('collections.json must contain a top-level "collections" array.');
  }

  collectionData.collections.forEach((col) => {
    if (col.contract_address) {
      collectionAddresses.add(col.contract_address.toLowerCase());
    }
  });
} catch (err) {
  console.error('Failed to load or parse collections.json:', err.message);
  process.exit(1);
}

/**
 * Fetch all NFTs owned by `owner` via Alchemy’s getNFTsForOwner, handling pagination.
 */
async function getAllNftsForOwner(owner) {
  const baseURL = `https://${NETWORK}.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getNFTsForOwner`;
  let pageKey = null;
  const allNfts = [];

  do {
    const params = { owner, withMetadata: true };
    if (pageKey) {
      params.pageKey = pageKey;
    }

    try {
      const response = await axios.get(baseURL, { params });
      const data = response.data;

      if (!Array.isArray(data.ownedNfts)) {
        throw new Error('Unexpected response format: “ownedNfts” is not an array.');
      }

      allNfts.push(...data.ownedNfts);
      pageKey = data.pageKey || null;
    } catch (err) {
      console.error('Failed to fetch NFTs from Alchemy:', err.message);
      process.exit(1);
    }
  } while (pageKey);

  return allNfts;
}

/**
 * Call the Blur Bid Quote API for a single NFT, ensuring contractAddress is lowercase.
 */
async function getBlurBidQuote({ contractAddress, tokenId }) {
  const url = 'https://nfttools.pro/blur/v1/bids/quote';
  const headers = {
    accept: '*/*',
    walletAddress: WALLET_ADDRESS,
    authToken: AUTH_TOKEN,
    'X-NFT-API-Key': NFT_API_KEY,
    'Content-Type': 'application/json',
  };
  const body = {
    contractAddress: contractAddress.toLowerCase(),
    tokens: [{ tokenId }],
  };

  try {
    const resp = await axios.post(url, body, { headers });
    return resp.data;
  } catch (err) {
    if (err.response) {
      console.error(
        `Error from Blur Quote API for ${contractAddress.toLowerCase()} (tokenId: ${tokenId}):`,
        `status ${err.response.status} – ${JSON.stringify(err.response.data)}`
      );
    } else {
      console.error(
        `Network/error calling Blur Quote API for ${contractAddress.toLowerCase()} (tokenId: ${tokenId}):`,
        err.message
      );
    }
    return null;
  }
}

/**
 * Call the Blur Accept API for a single NFT (accepting a quote).
 *   - Expects quoteId to be the original string returned by the quote endpoint.
 *   - feeRate must be a number.
 */
async function acceptBlurBid({ contractAddress, tokenId, quoteId, feeRate }) {
  const url = 'https://nfttools.pro/blur/v1/bids/accept';
  const headers = {
    accept: '*/*',
    walletAddress: WALLET_ADDRESS,
    authToken: AUTH_TOKEN,
    'X-NFT-API-Key': NFT_API_KEY,
    'Content-Type': 'application/json',
  };
  const body = {
    contractAddress: contractAddress.toLowerCase(),
    tokens: [{ tokenId }],
    feeRate,   // number
    quoteId,   // original string from quote response
  };

  try {
    const resp = await axios.post(url, body, { headers });
    return resp.data;
  } catch (err) {
    if (err.response) {
      console.error(
        `Error from Blur Accept API for ${contractAddress.toLowerCase()} (tokenId: ${tokenId}):`,
        `status ${err.response.status} – ${JSON.stringify(err.response.data)}`
      );
    } else {
      console.error(
        `Network/error calling Blur Accept API for ${contractAddress.toLowerCase()} (tokenId: ${tokenId}):`,
        err.message
      );
    }
    return null;
  }
}

(async () => {
  console.log(`Fetching NFTs for owner: ${WALLET_ADDRESS} ...`);
  const nfts = await getAllNftsForOwner(WALLET_ADDRESS);

  // Filter by contract address matching collections.json (lowercased)
  const matches = nfts.filter((nft) =>
    collectionAddresses.has(nft.contract.address.toLowerCase())
  );

  if (matches.length === 0) {
    console.log('No NFTs match any collection in collections.json.');
    process.exit(0);
  }

  console.log(`Found ${matches.length} NFT(s) matching your collections:\n`);
  for (let i = 0; i < matches.length; i++) {
    const nft = matches[i];
    const contractAddr = nft.contract.address; // original casing
    const tokenId = nft.tokenId;
    const matchInfo = collectionData.collections.find(
      (col) => col.contract_address.toLowerCase() === contractAddr.toLowerCase()
    );
    const slug = matchInfo ? matchInfo.slug : '(no slug)';
    const feeRateForCollection = matchInfo
      ? Number(matchInfo.Fee_Rate)
      : null;

    console.log(
      `${i + 1}. [${slug}] ${contractAddr}  |  tokenId: ${tokenId}  |  name: ${
        nft.name || '(no name)'
      }`
    );

    if (feeRateForCollection === null || isNaN(feeRateForCollection)) {
      console.log(
        `   → No valid Fee_Rate found in collections.json for ${contractAddr}. Skipping.\n`
      );
      continue;
    }

    let acceptResp = null;
    let attempt = 1;

    // Loop until acceptBlurBid returns a success
    while (true) {
      console.log(`   → Attempt ${attempt}: requesting quote...`);
      const quote = await getBlurBidQuote({
        contractAddress: contractAddr,
        tokenId,
      });

      if (!quote || !quote.quoteId) {
        console.log('      • Failed to retrieve a valid quote. Retrying immediately...');
        attempt++;
        continue;
      }

      console.log('      • Quote received:', JSON.stringify(quote, null, 2));
      const { quoteId } = quote;

      console.log(`   → Attempt ${attempt}: attempting to accept with feeRate=${feeRateForCollection}...`);
      acceptResp = await acceptBlurBid({
        contractAddress: contractAddr,
        tokenId,
        quoteId,
        feeRate: feeRateForCollection,
      });

      if (acceptResp && acceptResp.success) {
        console.log('      • Accept successful:', JSON.stringify(acceptResp, null, 2));
        break;
      } else {
        console.log('      • Accept failed or returned no success. Retrying immediately...');
        attempt++;
        continue;
      }
    }

    console.log(''); // blank line between each NFT
  }
})();
