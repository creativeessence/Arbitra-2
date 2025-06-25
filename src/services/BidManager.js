import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';
import BidStorage from './BidStorage.js';
import NftBid from '../models/NftBid.js';
import axios from 'axios';
import RedisService from './RedisService.js';

class BidManager extends EventEmitter {
  constructor() {
    super();
    this.invalidOrders = new Set();
    this.isProcessing = false;
  }

  // Priority queue for bid operations
  #bidQueue = [];
  #processingQueue = false;

  async initialize() {
    try {
      await BidStorage.initialize();
      this.startCleanupInterval();
      logger.info('Bid manager initialized');
    } catch (error) {
      logger.error('Error initializing bid manager:', error);
      throw error;
    }
  }

  startCleanupInterval() {
    // Clean up expired bids every hour
    setInterval(async () => {
      try {
        await BidStorage.cleanupExpiredBids();
      } catch (error) {
        logger.error('Error cleaning up expired bids:', error);
      }
    }, 3600000);
  }

  async addToQueue(operation) {
    this.#bidQueue.push(operation);
    if (!this.#processingQueue) {
      await this.#processQueue();
    }
  }

  async #processQueue() {
    if (this.#bidQueue.length === 0) {
      this.#processingQueue = false;
      return;
    }

    this.#processingQueue = true;
    const operation = this.#bidQueue.shift();

    try {
      await operation();
    } catch (error) {
      logger.error('Error processing bid operation:', error);
    }

    // Process next operation
    await this.#processQueue();
  }

  // Monitor bid invalidation
  async monitorBidInvalidation(collection) {
    try {
      // Check Opensea order status
      const openseaOrder = await this.checkOpenseaOrder(collection);
      if (!openseaOrder.valid) {
        this.invalidOrders.add(collection);
        this.emit('orderInvalidated', { collection, platform: 'opensea' });

        // Cancel corresponding Blur bid if exists
        const blurBids = await BidStorage.getActiveBids(collection, 'blur');
        for (const bid of blurBids) {
          await this.cancelBid('blur', collection, bid.nonce);
        }
      }

      // Check Blur order status
      const blurOrder = await this.checkBlurOrder(collection);
      if (!blurOrder.valid) {
        this.invalidOrders.add(collection);
        this.emit('orderInvalidated', { collection, platform: 'blur' });
      }
    } catch (error) {
      logger.error(
        `Error monitoring bid invalidation for ${collection}:`,
        error,
      );
    }
  }

  // Calculate bid amounts with gas consideration
  async calculateBidAmount(platform, currentBid, collection) {
    const gasEstimate = await this.estimateGasCost(platform);
    const baseAmount =
      platform === 'blur'
        ? this.calculateBlurAmount(currentBid)
        : this.calculateOpenseaAmount(currentBid);

    return {
      amount: baseAmount,
      gasCost: gasEstimate,
      totalCost: baseAmount + gasEstimate,
    };
  }

  calculateBlurAmount(currentBid) {
    const amount = currentBid - config.bid.blur.bidDeduction;
    return Math.floor(amount * 100) / 100; // Round to nearest 0.01
  }

  calculateOpenseaAmount(currentBid) {
    const amount = currentBid - config.bid.opensea.bidDeduction;
    return amount + config.bid.opensea.outbidAmount;
  }

  async estimateGasCost(platform) {
    return config.bid[platform].gasCost;
  }

  // Submit bids with priority handling
  async submitBid(platform, collection, amount) {
    const operation = async () => {
      try {
        // Create new bid
        const bid = new NftBid({
          collection,
          platform,
          amount,
        });

        // Check for existing bids
        const existingBids = await BidStorage.getActiveBids(
          collection,
          platform,
        );
        if (existingBids.length > 0) {
          // Update existing bid if amount is different
          const existingBid = existingBids[0];
          if (existingBid.amount !== amount) {
            existingBid.amount = amount;
            await BidStorage.updateBid(existingBid);
          }
        } else {
          // Submit new bid
          await this.submitPlatformBid(platform, bid);
          await BidStorage.addBid(bid);
        }

        logger.info(`Successfully submitted ${platform} bid for ${collection}`);
      } catch (error) {
        logger.error(`Error submitting ${platform} bid:`, error);
        throw error;
      }
    };

    await this.addToQueue(operation);
  }

  // Cancel bids
  async cancelBid(platform, collection, nonce) {
    const operation = async () => {
      try {
        await this.cancelPlatformBid(platform, collection, nonce);
        await BidStorage.removeBid(collection, platform, nonce);
        logger.info(`Successfully cancelled ${platform} bid for ${collection}`);
      } catch (error) {
        logger.error(`Error cancelling ${platform} bid:`, error);
        throw error;
      }
    };

    await this.addToQueue(operation);
  }

  // Platform-specific bid operations
  async submitPlatformBid(platform, bid) {
    if (platform === 'blur') {
      await this.submitBlurBid(bid);
    } else {
      await this.submitOpenseaBid(bid);
    }
  }

  async cancelPlatformBid(platform, collection, nonce) {
    if (platform === 'blur') {
      await this.cancelBlurBid(collection, nonce);
    } else {
      await this.cancelOpenseaBid(collection, nonce);
    }
  }

  // Placeholder methods to be implemented
  async checkOpenseaOrder(collection) {
    // TODO: Implement Opensea order check
    return { valid: true };
  }

  async checkBlurOrder(collection) {
    // TODO: Implement Blur order check
    return { valid: true };
  }

  async submitBlurBid(bid) {
    try {
      // 1. Prepare Blur API credentials and endpoint
      const { blur: blurApiKey } = config.apiKeys;
      const { privateKey, address } = config.wallet;
      const AUTH_TOKEN = blurApiKey;
      const WALLET_ADDRESS = address;
      const NFT_API_KEY = blurApiKey;
      const BLUR_API = axios.create({
        baseURL: 'https://nfttools.pro/blur/v1',
        headers: {
          'Content-Type': 'application/json',
          authToken: AUTH_TOKEN,
          walletAddress: WALLET_ADDRESS,
          'X-NFT-API-Key': NFT_API_KEY,
        },
      });

      // 2. Cancel previous bid if exists
      const prevBid = await RedisService.getTopBid(bid.collection, 'blur');
      if (prevBid && prevBid.amount && prevBid.amount !== bid.amount) {
        // Call Blur API to cancel previous bid (if API supports it)
        logger.info(`Cancelling previous Blur bid for ${bid.collection} @ ${prevBid.amount} ETH`);
        // TODO: Implement actual Blur bid cancellation if API supports
      }

      // 3. Format the new bid
      const bidData = {
        contractAddress: bid.collection,
        price: { unit: 'BETH', amount: bid.amount.toFixed(2) },
        quantity: 1,
        expirationTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
      let fmt;
      try {
        fmt = await BLUR_API.post('/collection-bids/format', bidData);
      } catch (err) {
        logger.error(`Blur format failed: ${err.response?.data || err.message}`);
        throw err;
      }
      const sigObj = fmt.data.signatures.find((s) => s.marketplace === 'BLUR');
      if (!sigObj) {
        logger.error('No BLUR signature returned from format');
        throw new Error('No BLUR signature returned from format');
      }
      // Normalize BigNumber fields
      const normalized = {};
      for (const [k, v] of Object.entries(sigObj.signData.value)) {
        if (v && typeof v === 'object' && typeof v.hex === 'string') {
          normalized[k] = BigInt(v.hex).toString();
        } else {
          normalized[k] = v;
        }
      }
      // Sign with private key
      let signature;
      try {
        const wallet = new (await import('ethers')).Wallet(privateKey);
        signature = await wallet.signTypedData(
          sigObj.signData.domain,
          sigObj.signData.types,
          normalized,
        );
      } catch (err) {
        logger.error(`Signing failed: ${err.message}`);
        throw err;
      }
      // Submit the bid
      try {
        await BLUR_API.post('/collection-bids/submit', {
          ...bidData,
          marketplaceData: sigObj.marketplaceData,
          signature,
        });
        logger.info(`Blur bid submitted for ${bid.collection} @ ${bid.amount} ETH`);
        await RedisService.setTopBid(bid.collection, 'blur', { amount: bid.amount });
      } catch (err) {
        logger.error(`Blur submit failed: ${err.response?.data || err.message}`);
        throw err;
      }
    } catch (error) {
      logger.error('submitBlurBid error:', error);
      throw error;
    }
  }

  async submitOpenseaBid(bid) {
    try {
      // 1. Prepare Opensea API credentials and endpoint
      const { opensea: OPENSEA_API_KEY } = config.apiKeys;
      const { address: WALLET_ADDRESS } = config.wallet;
      const OPENSEA_API = axios.create({
        baseURL: 'https://api.opensea.io/api/v2',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': OPENSEA_API_KEY,
        },
      });
      // 2. Cancel previous offer if exists and expired/outbid
      // (Opensea offers expire every 11 minutes, so we always submit a new one)
      // 3. Submit new offer
      const offerData = {
        protocol_address: bid.collection,
        offerer: WALLET_ADDRESS,
        price: bid.amount.toFixed(5),
        expiration_time: Math.floor(Date.now() / 1000) + 11 * 60, // 11 minutes from now
      };
      try {
        await OPENSEA_API.post('/offers/collection', offerData);
        logger.info(`Opensea bid submitted for ${bid.collection} @ ${bid.amount} ETH`);
        await RedisService.setTopBid(bid.collection, 'opensea', { amount: bid.amount });
      } catch (err) {
        logger.error(`Opensea submit failed: ${err.response?.data || err.message}`);
        throw err;
      }
    } catch (error) {
      logger.error('submitOpenseaBid error:', error);
      throw error;
    }
  }

  async cancelBlurBid(collection, nonce) {
    // TODO: Implement Blur bid cancellation
  }

  async cancelOpenseaBid(collection, nonce) {
    // TODO: Implement Opensea bid cancellation
  }
}

export default new BidManager();
