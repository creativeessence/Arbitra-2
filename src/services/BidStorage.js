import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import NftBid from '../models/NftBid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class BidStorage {
  constructor() {
    this.bids = new Map(); // collection -> { blur: NftBid[], opensea: NftBid[] }
    this.storageFile = path.join(__dirname, '../../data/bids.json');
  }

  async initialize() {
    try {
      await this.loadBids();
      logger.info('Bid storage initialized');
    } catch (error) {
      logger.error('Error initializing bid storage:', error);
      throw error;
    }
  }

  async loadBids() {
    try {
      const data = await fs.readFile(this.storageFile, 'utf-8');
      const bids = JSON.parse(data);

      // Convert stored data back to NftBid objects
      for (const [collection, platforms] of Object.entries(bids)) {
        this.bids.set(collection, {
          blur: platforms.blur.map((bid) => NftBid.fromJSON(bid)),
          opensea: platforms.opensea.map((bid) => NftBid.fromJSON(bid)),
        });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, create empty storage
        await this.saveBids();
      } else {
        throw error;
      }
    }
  }

  async saveBids() {
    try {
      const data = {};
      for (const [collection, platforms] of this.bids.entries()) {
        data[collection] = {
          blur: platforms.blur.map((bid) => bid.toJSON()),
          opensea: platforms.opensea.map((bid) => bid.toJSON()),
        };
      }

      await fs.mkdir(path.dirname(this.storageFile), { recursive: true });
      await fs.writeFile(this.storageFile, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Error saving bids:', error);
      throw error;
    }
  }

  async addBid(bid) {
    try {
      bid.validate();

      const collectionBids = this.bids.get(bid.collection) || {
        blur: [],
        opensea: [],
      };
      collectionBids[bid.platform].push(bid);
      this.bids.set(bid.collection, collectionBids);

      await this.saveBids();
      logger.info(`Added ${bid.platform} bid for collection ${bid.collection}`);
    } catch (error) {
      logger.error('Error adding bid:', error);
      throw error;
    }
  }

  async updateBid(bid) {
    try {
      bid.validate();

      const collectionBids = this.bids.get(bid.collection);
      if (!collectionBids) {
        throw new Error(`No bids found for collection ${bid.collection}`);
      }

      const platformBids = collectionBids[bid.platform];
      const index = platformBids.findIndex((b) => b.nonce === bid.nonce);

      if (index === -1) {
        throw new Error(`Bid not found for collection ${bid.collection}`);
      }

      platformBids[index] = bid;
      await this.saveBids();
      logger.info(
        `Updated ${bid.platform} bid for collection ${bid.collection}`,
      );
    } catch (error) {
      logger.error('Error updating bid:', error);
      throw error;
    }
  }

  async removeBid(collection, platform, nonce) {
    try {
      const collectionBids = this.bids.get(collection);
      if (!collectionBids) {
        throw new Error(`No bids found for collection ${collection}`);
      }

      const platformBids = collectionBids[platform];
      const index = platformBids.findIndex((bid) => bid.nonce === nonce);

      if (index === -1) {
        throw new Error(`Bid not found for collection ${collection}`);
      }

      platformBids.splice(index, 1);
      await this.saveBids();
      logger.info(`Removed ${platform} bid for collection ${collection}`);
    } catch (error) {
      logger.error('Error removing bid:', error);
      throw error;
    }
  }

  getBids(collection, platform = null) {
    const collectionBids = this.bids.get(collection);
    if (!collectionBids) {
      return [];
    }

    if (platform) {
      return collectionBids[platform] || [];
    }

    return [...collectionBids.blur, ...collectionBids.opensea];
  }

  getActiveBids(collection, platform = null) {
    const bids = this.getBids(collection, platform);
    const now = Math.floor(Date.now() / 1000);

    return bids.filter(
      (bid) => bid.status === 'active' && bid.expirationTime > now,
    );
  }

  async cleanupExpiredBids() {
    const now = Math.floor(Date.now() / 1000);
    let cleaned = 0;

    for (const [collection, platforms] of this.bids.entries()) {
      for (const platform of ['blur', 'opensea']) {
        const expiredBids = platforms[platform].filter(
          (bid) => bid.expirationTime <= now || bid.status === 'cancelled',
        );

        if (expiredBids.length > 0) {
          platforms[platform] = platforms[platform].filter(
            (bid) => bid.expirationTime > now && bid.status !== 'cancelled',
          );
          cleaned += expiredBids.length;
        }
      }
    }

    if (cleaned > 0) {
      await this.saveBids();
      logger.info(`Cleaned up ${cleaned} expired bids`);
    }
  }
}

export default new BidStorage();
