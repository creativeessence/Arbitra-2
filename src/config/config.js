const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config();

const config = {
  // Network configuration
  network: {
    rpcUrl:
      process.env.RPC_URL ||
      'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
    chainId: parseInt(process.env.CHAIN_ID || '1'),
  },

  // Wallet configuration
  wallet: {
    privateKey: process.env.PRIVATE_KEY,
    address: process.env.WALLET_ADDRESS,
  },

  // API Keys
  apiKeys: {
    opensea: process.env.OPENSEA_API_KEY,
    blur: process.env.BLUR_API_KEY,
    alchemy: process.env.ALCHEMY_API_KEY,
  },

  // Bid configuration
  bid: {
    blur: {
      minBidAmount: '0.01',
      maxBidAmount: '100',
      bidDeduction: '0.005',
      roundingPrecision: '0.01',
    },
    opensea: {
      minBidAmount: '0.01',
      maxBidAmount: '100',
      bidDeduction: '0.005',
      outbidAmount: '0.00001',
    },
  },

  // Transaction configuration
  transaction: {
    maxGasPrice: process.env.MAX_GAS_PRICE || '100',
    maxPriorityFee: process.env.MAX_PRIORITY_FEE || '2',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.RETRY_DELAY || '5000'),
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || path.join(__dirname, '../../logs/app.log'),
  },

  // Monitoring configuration
  monitoring: {
    checkInterval: parseInt(process.env.CHECK_INTERVAL || '60000'),
    orderInvalidationCheck: parseInt(
      process.env.ORDER_INVALIDATION_CHECK || '300000',
    ),
  },
};

// Validate required configuration
const validateConfig = () => {
  const required = [
    'RPC_URL',
    'PRIVATE_KEY',
    'WALLET_ADDRESS',
    'OPENSEA_API_KEY',
    'BLUR_API_KEY',
    'ALCHEMY_API_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
};

// Export configuration
module.exports = {
  config,
  validateConfig,
};
