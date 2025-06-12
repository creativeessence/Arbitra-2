import { config, validateConfig } from './config/config.js';
import logger from './utils/logger.js';

// Initialize application
const initialize = async () => {
  try {
    // Validate configuration
    validateConfig();

    logger.info('Starting Arbitra-2 application...');
    logger.info('Configuration loaded successfully');

    // TODO: Initialize services
    // - Initialize Web3 provider
    // - Initialize OpenSea client
    // - Initialize Blur client
    // - Set up event listeners
    // - Start monitoring services
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
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
