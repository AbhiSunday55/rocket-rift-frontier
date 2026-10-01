/**
 * Wallet layer types.
 *
 * SECURITY: this layer NEVER asks for, stores, or transmits a seed phrase or
 * private key. It only ever requests signatures over server-issued nonces, and
 * the server verifies the recovered address. That is the whole auth model.
 */

export type WalletId = 'metamask' | 'walletconnect' | 'coinbase' | 'phantom';

export interface WalletInfo {
  id: WalletId;
  name: string;
  icon: string;
  description: string;
  /** Whether the provider is detected in this browser right now. */
  available: boolean;
  /** Chains this wallet can serve. */
  chains: ('evm' | 'solana')[];
}

export interface WalletConnection {
  id: WalletId;
  address: string;
  chainId: number;
  /** EIP-1193 provider, when the wallet exposes one. */
  provider?: unknown;
}

export interface AuthSession {
  token: string;
  address: string;
  playerId: string;
  expiresAt: number;
}

export interface WalletState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  connection: WalletConnection | null;
  session: AuthSession | null;
  error: string | null;
}

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isPhantom?: boolean;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
    coinbaseWalletExtension?: Eip1193Provider;
    phantom?: { ethereum?: Eip1193Provider; solana?: unknown };
  }
}
