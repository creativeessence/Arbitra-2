# Arbitra-2

A sophisticated NFT trading automation system that manages bidding and offer acceptance across OpenSea and Blur marketplaces.

## Project Structure

```
src/
├── config/         # Configuration management
├── services/       # Core services
├── utils/          # Utility functions
├── models/         # Data models
└── events/         # Event handlers
```

## Features

- Bid management for both OpenSea and Blur
- Automatic offer acceptance
- Gas-aware bid calculations
- Order invalidation monitoring
- Priority-based operation queue
- Comprehensive logging
- Error handling and recovery

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your configuration:
   ```bash
   cp .env.example .env
   ```
4. Configure your environment variables in `.env`

## Configuration

The system is configured through environment variables. See `.env.example` for all available options.

### Required Variables

- `RPC_URL`: Your Ethereum node RPC URL
- `PRIVATE_KEY`: Your wallet's private key
- `WALLET_ADDRESS`: Your wallet address
- `OPENSEA_API_KEY`: OpenSea API key
- `BLUR_API_KEY`: Blur API key
- `ALCHEMY_API_KEY`: Alchemy API key

### Optional Variables

- Bid amounts and deductions
- Gas limits and prices
- Logging configuration
- Monitoring intervals
- Queue settings

## Development

```bash
# Start in development mode
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Format code
npm run format
```

## Architecture

### BidManager

Handles all bid-related operations:
- Bid calculation with gas consideration
- Order invalidation monitoring
- Priority-based bid submission
- Automatic bid cancellation

### NftAcceptor

Manages NFT acceptance:
- Wallet monitoring
- On-chain transaction submission
- Gas optimization
- Platform-specific handling

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

ISC
