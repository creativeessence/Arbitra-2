import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const config = {
  // Network configuration
  network: {
    rpcUrl: process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
    chainId: parseInt(process.env.CHAIN_ID || '1'),
    maxGasPrice: process.env.MAX_GAS_PRICE || '100',
    maxPriorityFee: process.env.MAX_PRIORITY_FEE || '2',
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
      minBidAmount: process.env.BLUR_MIN_BID || '0.01',
      maxBidAmount: process.env.BLUR_MAX_BID || '100',
      bidDeduction: process.env.BLUR_BID_DEDUCTION || '0.005',
      roundingPrecision: process.env.BLUR_ROUNDING || '0.01',
      gasCost: process.env.BLUR_GAS_COST || '0.001',
    },
    opensea: {
      minBidAmount: process.env.OPENSEA_MIN_BID || '0.01',
      maxBidAmount: process.env.OPENSEA_MAX_BID || '100',
      bidDeduction: process.env.OPENSEA_BID_DEDUCTION || '0.005',
      outbidAmount: process.env.OPENSEA_OUTBID || '0.00001',
      gasCost: process.env.OPENSEA_GAS_COST || '0.001',
    },
  },

  // Transaction configuration
  transaction: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.RETRY_DELAY || '5000'),
    gasLimit: {
      blur: parseInt(process.env.BLUR_GAS_LIMIT || '300000'),
      opensea: parseInt(process.env.OPENSEA_GAS_LIMIT || '300000'),
    },
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || path.join(__dirname, '../../logs/app.log'),
    maxSize: parseInt(process.env.LOG_MAX_SIZE || '5242880'), // 5MB
    maxFiles: parseInt(process.env.LOG_MAX_FILES || '5'),
  },

  // Monitoring configuration
  monitoring: {
    checkInterval: parseInt(process.env.CHECK_INTERVAL || '60000'),
    orderInvalidationCheck: parseInt(process.env.ORDER_INVALIDATION_CHECK || '300000'),
    collections: process.env.COLLECTIONS ? JSON.parse(process.env.COLLECTIONS) : [],
  },

  // Queue configuration
  queue: {
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '5'),
    priorityLevels: {
      HIGH: 1,
      MEDIUM: 2,
      LOW: 3,
    },
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
    'ALCHEMY_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate wallet address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(config.wallet.address)) {
    throw new Error('Invalid wallet address format');
  }

  // Validate private key format
  if (!/^0x[a-fA-F0-9]{64}$/.test(config.wallet.privateKey)) {
    throw new Error('Invalid private key format');
  }

  // Validate bid amounts
  if (parseFloat(config.bid.blur.minBidAmount) >= parseFloat(config.bid.blur.maxBidAmount)) {
    throw new Error('Blur min bid amount must be less than max bid amount');
  }

  if (parseFloat(config.bid.opensea.minBidAmount) >= parseFloat(config.bid.opensea.maxBidAmount)) {
    throw new Error('OpenSea min bid amount must be less than max bid amount');
  }
};

// Export configuration
export { config, validateConfig };
