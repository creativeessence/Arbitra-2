#!/usr/bin/env node
/**
 * build-only.js
 *
 * Calls OpenSea’s “Build Criteria Offer” endpoint and logs the full JSON response.
 *
 * USAGE:
 *   node build-only.js
 *
 * PREREQS:
 *   npm install axios
 *
 * CONFIGURE THESE VARIABLES:
 */
const API_KEY          = 'xyz';  // <— your OpenSea API key
const OFFERER_ADDRESS  = '0x8619aD8B126Cc45D78C9D1F04c9cB2451D3e5D52';
const PROTOCOL_ADDRESS = '0x0000000000000068f116a894984e2db1123eb395';
const COLLECTION_SLUG  = 'proof-moonbirds';   // <— change to whatever collection slug you need
const QUANTITY         = 1;                   // <— number of NFTs (for a collection‐wide offer, usually 1)
const OFFER_PROTECTION = true;                // <— true or false

// Dependencies
const axios = require('axios');

;(async () => {
  try {
    const buildBody = {
      quantity: QUANTITY,
      criteria: { collection: { slug: COLLECTION_SLUG } },
      offer_protection_enabled: OFFER_PROTECTION,
      offerer: OFFERER_ADDRESS,
      protocol_address: PROTOCOL_ADDRESS
    };

    const response = await axios.post(
      'https://api.opensea.io/api/v2/offers/build',
      buildBody,
      {
        headers: {
          'Accept':        'application/json',
          'Content-Type':  'application/json',
          'X-API-KEY':     API_KEY
        }
      }
    );

    // Print out the entire JSON object, unfiltered and uncondensed:
    console.log('✅ Build response (full JSON):\n', JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error('❌ Build failed:\n', err.response?.data || err.message);
    process.exit(1);
  }
})();
