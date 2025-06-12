// auth.cjs
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');
const { Wallet } = require('ethers');

const API_BASE      = 'https://nfttools.pro/blur';
const X_NFT_API_KEY = 'xyz';
const PRIVATE_KEY   = 'xyz';
const WALLET_ADDR   = 'xyz'.toLowerCase();

async function getAuthToken() {
  // 1) Fetch the challenge
  const chalRes = await axios.post(
    `${API_BASE}/auth/challenge`,
    { walletAddress: WALLET_ADDR },
    { headers: { 'X-NFT-API-Key': X_NFT_API_KEY } }
  );
  const chal = chalRes.data;

  // 2) Sign the challenge message
  const wallet    = new Wallet(PRIVATE_KEY);
  const signature = await wallet.signMessage(chal.message);

  // 3) Exchange for authToken
  const loginRes = await axios.post(
    `${API_BASE}/auth/login`,
    { ...chal, signature },
    { headers: { 'X-NFT-API-Key': X_NFT_API_KEY } }
  );

  return loginRes.data.accessToken;
}

(async () => {
  try {
    const token = await getAuthToken();
    console.log('🔑 authToken:', token);

    // write to auth.json
    const out = { authToken: token };
    const filePath = path.join(__dirname, 'auth.json');
    fs.writeFileSync(filePath, JSON.stringify(out, null, 2), 'utf8');
    console.log(`✅ Saved authToken to ${filePath}`);
  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
    process.exit(1);
  }
})();
