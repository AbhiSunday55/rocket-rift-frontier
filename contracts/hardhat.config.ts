import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    // 0.8.24 is the minimum OpenZeppelin v5 requires, and it satisfies the
    // `^0.8.20` pragma our own contracts declare.
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // OpenZeppelin v5 uses the `mcopy` opcode, which requires the Cancun
      // EVM target. Without this the compile fails with "Function mcopy not found".
      evmVersion: 'cancun',
      // ShipNFT's mint path packs a full stat struct into calldata, which
      // overflows the legacy codegen's stack. The IR pipeline compiles it.
      viaIR: true,
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: 'http://127.0.0.1:8545' },
    sepolia: {
      // NOTE: `https://rpc.sepolia.org` is dead (returns an Apache 404, which
      // Hardhat surfaces as "HH110: Invalid JSON-RPC response"). This public
      // endpoint is live and needs no API key. Override with RPC_URL for a
      // dedicated provider (Alchemy/Infura) in production.
      url: process.env.RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
      chainId: 11155111,
      accounts,
    },
    polygon: {
      url: process.env.RPC_URL || 'https://polygon-rpc.com',
      chainId: 137,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || '',
      polygon: process.env.ETHERSCAN_API_KEY || '',
    },
  },
  paths: {
    sources: './src',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
