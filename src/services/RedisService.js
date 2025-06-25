import Redis from 'ioredis';
import logger from '../utils/logger.js';
import { config } from '../config/config.js';

class RedisService {
  constructor() {
    this.client = new Redis(config.redis.url);
    this.subscriber = new Redis(config.redis.url);
    this.publisher = new Redis(config.redis.url);
  }

  async initialize() {
    try {
      await this.client.ping();
      logger.info('Redis connection established');
    } catch (error) {
      logger.error('Redis connection failed:', error);
      throw error;
    }
  }

  // Top bid caching
  async setTopBid(collection, platform, bid) {
    const key = `top_bid:${collection}:${platform}`;
    await this.client.set(key, JSON.stringify(bid));
    await this.publisher.publish(
      'bid_update',
      JSON.stringify({ collection, platform, bid }),
    );
  }

  async getTopBid(collection, platform) {
    const key = `top_bid:${collection}:${platform}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async getAllTopBids(collection) {
    const [blurBid, openseaBid] = await Promise.all([
      this.getTopBid(collection, 'blur'),
      this.getTopBid(collection, 'opensea'),
    ]);
    return { blur: blurBid, opensea: openseaBid };
  }

  // Floor price tracking
  async setFloorPrice(collection, platform, price) {
    const key = `floor_price:${collection}:${platform}`;
    await this.client.set(key, price.toString());
    await this.publisher.publish(
      'floor_update',
      JSON.stringify({ collection, platform, price }),
    );
  }

  async getFloorPrice(collection, platform) {
    const key = `floor_price:${collection}:${platform}`;
    const price = await this.client.get(key);
    return price ? parseFloat(price) : null;
  }

  // System state management
  async setCollectionState(collection, state) {
    const key = `collection_state:${collection}`;
    await this.client.set(key, JSON.stringify(state));
  }

  async getCollectionState(collection) {
    const key = `collection_state:${collection}`;
    const state = await this.client.get(key);
    return state ? JSON.parse(state) : null;
  }

  // Bid invalidation tracking
  async setInvalidBid(collection, platform, bidId) {
    const key = `invalid_bids:${collection}:${platform}`;
    await this.client.sadd(key, bidId);
  }

  async isBidInvalid(collection, platform, bidId) {
    const key = `invalid_bids:${collection}:${platform}`;
    return await this.client.sismember(key, bidId);
  }

  // WebSocket event subscription
  async subscribeToBidUpdates(callback) {
    await this.subscriber.subscribe('bid_update');
    this.subscriber.on('message', (channel, message) => {
      if (channel === 'bid_update') {
        callback(JSON.parse(message));
      }
    });
  }

  async subscribeToFloorUpdates(callback) {
    await this.subscriber.subscribe('floor_update');
    this.subscriber.on('message', (channel, message) => {
      if (channel === 'floor_update') {
        callback(JSON.parse(message));
      }
    });
  }

  // Cleanup
  async cleanup() {
    await this.client.quit();
    await this.subscriber.quit();
    await this.publisher.quit();
  }
}

export default new RedisService();
