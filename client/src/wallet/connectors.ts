import type { Eip1193Provider, WalletId, WalletInfo } from './types';

/**
 * Wallet connectors.
 *
 * Each connector is a thin adapter over EIP-1193. Nothing here ever touches a
 * private key — the wallet does all signing, and the game only ever receives a
 * public address plus signatures.
 */

export const WALLETS: WalletInfo[] = [
  {
    id: 'metamask',
    name: 'MetaMask',
    icon: '🦊',
    description: 'Browser extension & mobile app. The most widely used EVM wallet.',
    available: false,
    chains: ['evm'],
  },
  {
    id: 'walletconnect',
    name: 'WalletConnect',
    icon: '🔗',
    description: 'Scan a QR code with any mobile wallet. Works everywhere.',
    available: true,
    chains: ['evm'],
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    icon: '🔵',
    description: 'Coinbase’s self-custody wallet. Extension, mobile, or passkey.',
    available: false,
    chains: ['evm'],
  },
  {
    id: 'phantom',
    name: 'Phantom',
    icon: '👻',
    description: 'Solana-first wallet with EVM support. Great for cross-chain players.',
    available: false,
    chains: ['evm', 'solana'],
  },
];

/** Detects which wallets are actually present in this browser. */
export function detectWallets(): WalletInfo[] {
  const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
  const providers: Eip1193Provider[] = eth?.providers ?? (eth ? [eth] : []);

  const hasMetaMask = providers.some((p) => p.isMetaMask && !p.isPhantom) || !!eth?.isMetaMask;
  const hasCoinbase = providers.some((p) => p.isCoinbaseWallet) || !!window.coinbaseWalletExtension;
  const hasPhantom = !!window.phantom?.ethereum || providers.some((p) => p.isPhantom);

  return WALLETS.map((w) => ({
    ...w,
    available:
      w.id === 'walletconnect'
        ? true
        : w.id === 'metamask'
          ? hasMetaMask
          : w.id === 'coinbase'
            ? hasCoinbase
            : hasPhantom,
  }));
}

/** Picks the EIP-1193 provider for a given wallet id. */
export function getProvider(id: WalletId): Eip1193Provider | null {
  const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
  const providers: Eip1193Provider[] = eth?.providers ?? (eth ? [eth] : []);

  switch (id) {
    case 'metamask':
      return providers.find((p) => p.isMetaMask && !p.isPhantom) ?? (eth?.isMetaMask ? eth : null);
    case 'coinbase':
      return providers.find((p) => p.isCoinbaseWallet) ?? window.coinbaseWalletExtension ?? null;
    case 'phantom':
      return window.phantom?.ethereum ?? providers.find((p) => p.isPhantom) ?? null;
    case 'walletconnect':
      // WalletConnect is initialised lazily in `connectWallet` — it needs a
      // project id and an async handshake, so it cannot be a static provider.
      return null;
    default:
      return null;
  }
}

/**
 * Connects a wallet and returns its address + chain id.
 *
 * WalletConnect is loaded dynamically so the (fairly large) dependency is only
 * paid for by players who actually use it.
 */
export async function connectWallet(id: WalletId): Promise<{ address: string; chainId: number; provider: Eip1193Provider }> {
  if (id === 'walletconnect') {
    const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined;
    if (!projectId) {
      throw new Error('WalletConnect is not configured (missing VITE_WALLETCONNECT_PROJECT_ID).');
    }

    const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
    const wc = await EthereumProvider.init({
      projectId,
      chains: [Number(import.meta.env.VITE_CHAIN_ID ?? 11155111)],
      showQrModal: true,
      metadata: {
        name: 'ROCKET RIFT: FRONTIER',
        description: 'Free-to-play rocket shooter with optional Web3 ownership.',
        url: window.location.origin,
        icons: [],
      },
    });

    await wc.connect();
    const accounts = (await wc.request({ method: 'eth_accounts' })) as string[];
    const chainHex = (await wc.request({ method: 'eth_chainId' })) as string;

    return {
      address: accounts[0],
      chainId: parseInt(chainHex, 16),
      provider: wc as unknown as Eip1193Provider,
    };
  }

  const provider = getProvider(id);
  if (!provider) {
    throw new Error(`${id} is not installed. Install the extension and reload.`);
  }

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.length) throw new Error('No accounts returned by the wallet.');

  const chainHex = (await provider.request({ method: 'eth_chainId' })) as string;

  return {
    address: accounts[0],
    chainId: parseInt(chainHex, 16),
    provider,
  };
}

/** Requests a personal_sign signature over a server-issued nonce. */
export async function signMessage(provider: Eip1193Provider, address: string, message: string): Promise<string> {
  return (await provider.request({
    method: 'personal_sign',
    params: [message, address],
  })) as string;
}

/** Asks the wallet to switch to the configured chain. */
export async function switchChain(provider: Eip1193Provider, chainId: number): Promise<void> {
  const hex = `0x${chainId.toString(16)}`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (err) {
    // 4902 = chain not added to the wallet yet.
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      throw new Error(`Chain ${chainId} is not configured in your wallet. Add it and try again.`);
    }
    throw err;
  }
}

export function shortAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}
