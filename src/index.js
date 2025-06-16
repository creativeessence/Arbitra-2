import { config, validateConfig } from './config/config.js';
import logger from './utils/logger.js';
import BidManager from './services/BidManager.js';
import NftAcceptor from './services/NftAcceptor.js';

// Initialize application
const initialize = async () => {
  try {
    // Validate configuration
    validateConfig();

    logger.info('Starting Arbitra-2 application...');
    logger.info('Configuration loaded successfully');

    // Initialize services
    await initializeServices();

    // Set up event listeners
    setupEventListeners();

    logger.info('Application initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Initialize all services
const initializeServices = async () => {
  try {
    // Start NFT acceptor monitoring
    await NftAcceptor.monitorWallet();
    logger.info('NFT acceptor monitoring started');

    // Start bid invalidation monitoring for each collection
    const collections = await loadCollections();
    for (const collection of collections) {
      await BidManager.monitorBidInvalidation(collection);
    }
    logger.info('Bid invalidation monitoring started');
  } catch (error) {
    logger.error('Error initializing services:', error);
    throw error;
  }
};

// Set up event listeners
const setupEventListeners = () => {
  // Bid Manager events
  BidManager.on('orderInvalidated', ({ collection, platform }) => {
    logger.warn(`Order invalidated for ${collection} on ${platform}`);
    // TODO: Implement order invalidation handling
  });

  // NFT Acceptor events
  NftAcceptor.on('nftReceived', (nft) => {
    logger.info(`New NFT received: ${nft.tokenId} from ${nft.collection}`);
  });
};

// Load collections from configuration
const loadCollections = async () => {
  // TODO: Implement collection loading from configuration
  return [];
};

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Performing cleanup...');
  // TODO: Implement cleanup logic
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Performing cleanup...');
  // TODO: Implement cleanup logic
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the application
initialize();
