import { ethers } from 'ethers';
import { config } from '../config/config.js';

class NftBid {
  constructor({
    collection,
    platform,
    amount,
    tokenId = null,
    expirationTime = null,
    nonce = null,
    signature = null,
  }) {
    this.collection = collection;
    this.platform = platform;
    this.amount = amount;
    this.tokenId = tokenId;
    this.expirationTime = expirationTime || this.calculateExpirationTime();
    this.nonce = nonce || this.generateNonce();
    this.signature = signature;
    this.createdAt = Date.now();
    this.status = 'pending'; // pending, active, cancelled, invalid
  }

  calculateExpirationTime() {
    // Default expiration time is 24 hours from now
    return Math.floor(Date.now() / 1000) + 86400;
  }

  generateNonce() {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  validate() {
    if (!ethers.isAddress(this.collection)) {
      throw new Error('Invalid collection address');
    }

    if (!['blur', 'opensea'].includes(this.platform)) {
      throw new Error('Invalid platform');
    }

    if (typeof this.amount !== 'number' || this.amount <= 0) {
      throw new Error('Invalid bid amount');
    }

    const minBid = parseFloat(config.bid[this.platform].minBidAmount);
    const maxBid = parseFloat(config.bid[this.platform].maxBidAmount);

    if (this.amount < minBid || this.amount > maxBid) {
      throw new Error(`Bid amount must be between ${minBid} and ${maxBid}`);
    }

    if (this.expirationTime <= Math.floor(Date.now() / 1000)) {
      throw new Error('Bid has already expired');
    }

    return true;
  }

  toJSON() {
    return {
      collection: this.collection,
      platform: this.platform,
      amount: this.amount,
      tokenId: this.tokenId,
      expirationTime: this.expirationTime,
      nonce: this.nonce,
      signature: this.signature,
      createdAt: this.createdAt,
      status: this.status,
    };
  }

  static fromJSON(data) {
    return new NftBid(data);
  }
}

export default NftBid;
