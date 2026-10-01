import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { connectWallet, detectWallets, getProvider, signMessage, switchChain } from './connectors';
import { api, STANDALONE } from '../api/client';
import type { AuthSession, Eip1193Provider, WalletConnection, WalletId, WalletInfo, WalletState } from './types';

/**
 * Wallet context.
 *
 * Auth flow (never touches a private key):
 *   1. GET  /api/auth/nonce?address=0x…   → { nonce, message }
 *   2. wallet personal_sign(message)      → signature
 *   3. POST /api/auth/verify { address, signature, nonce } → { token, playerId }
 *
 * The token is a short-lived JWT. The server is the only thing that decides what
 * the player owns — the wallet merely proves who they are.
 */

const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000').trim();
const TARGET_CHAIN = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

interface WalletContextValue extends WalletState {
  wallets: WalletInfo[];
  connect: (id: WalletId) => Promise<void>;
  disconnect: () => void;
  /** Signs a message with the connected wallet (used for trade confirmations). */
  sign: (message: string) => Promise<string>;
  /** True when the API is reachable; false means offline/local-only mode. */
  apiOnline: boolean;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = 'rrf.wallet.v1';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    status: 'disconnected',
    connection: null,
    session: null,
    error: null,
  });
  const [wallets, setWallets] = useState<WalletInfo[]>(() => detectWallets());
  const [apiOnline, setApiOnline] = useState(false);

  // Probe the API once so the UI can label offline mode honestly. In standalone
  // guest mode this short-circuits without touching the network.
  useEffect(() => {
    let cancelled = false;
    api.health().then((ok) => {
      if (!cancelled) setApiOnline(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-detect wallets when extensions inject late.
  useEffect(() => {
    const t = window.setTimeout(() => setWallets(detectWallets()), 600);
    return () => window.clearTimeout(t);
  }, []);

  // Restore a previous session if the token is still valid.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { connection: WalletConnection; session: AuthSession };
      if (saved.session?.expiresAt > Date.now()) {
        setState({ status: 'connected', connection: saved.connection, session: saved.session, error: null });
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const persist = useCallback((connection: WalletConnection | null, session: AuthSession | null) => {
    if (connection && session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ connection, session }));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const connect = useCallback(
    async (id: WalletId) => {
      setState((s) => ({ ...s, status: 'connecting', error: null }));

      try {
        const { address, chainId, provider } = await connectWallet(id);

        // Nudge the wallet onto the configured chain (non-fatal if it refuses).
        if (chainId !== TARGET_CHAIN) {
          try {
            await switchChain(provider, TARGET_CHAIN);
          } catch {
            // The player can still browse; only on-chain actions need the chain.
          }
        }

        const connection: WalletConnection = { id, address, chainId, provider };

        // Attempt server auth. If the API is down — or we are in standalone
        // guest mode — stay connected in local mode.
        let session: AuthSession | null = null;
        if (!STANDALONE) {
          try {
            const nonceRes = await fetch(`${API_URL}/api/auth/nonce?address=${address}`);
            if (nonceRes.ok) {
              const { nonce, message } = (await nonceRes.json()) as { nonce: string; message: string };
              const signature = await signMessage(provider, address, message);

              const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address, signature, nonce }),
              });

              if (verifyRes.ok) {
                session = (await verifyRes.json()) as AuthSession;
              }
            }
          } catch {
            // Offline / API unavailable — local mode.
          }
        }

        persist(connection, session);
        setState({ status: 'connected', connection, session, error: null });
      } catch (err) {
        setState({
          status: 'error',
          connection: null,
          session: null,
          error: err instanceof Error ? err.message : 'Failed to connect wallet.',
        });
      }
    },
    [persist]
  );

  const disconnect = useCallback(() => {
    persist(null, null);
    setState({ status: 'disconnected', connection: null, session: null, error: null });
  }, [persist]);

  const sign = useCallback(
    async (message: string) => {
      const conn = state.connection;
      if (!conn) throw new Error('No wallet connected.');
      const provider = (conn.provider as Eip1193Provider) ?? getProvider(conn.id);
      if (!provider) throw new Error('Wallet provider unavailable.');
      return signMessage(provider, conn.address, message);
    },
    [state.connection]
  );

  // React to account / chain changes from the wallet itself.
  useEffect(() => {
    const conn = state.connection;
    if (!conn) return;
    const provider = conn.provider as Eip1193Provider | undefined;
    if (!provider?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (!accounts?.length) {
        disconnect();
      } else if (accounts[0].toLowerCase() !== conn.address.toLowerCase()) {
        // A different account is now selected — re-auth from scratch.
        disconnect();
      }
    };

    const onChainChanged = (...args: unknown[]) => {
      const chainHex = args[0] as string;
      setState((s) =>
        s.connection ? { ...s, connection: { ...s.connection, chainId: parseInt(chainHex, 16) } } : s
      );
    };

    provider.on('accountsChanged', onAccountsChanged);
    provider.on('chainChanged', onChainChanged);

    return () => {
      provider.removeListener?.('accountsChanged', onAccountsChanged);
      provider.removeListener?.('chainChanged', onChainChanged);
    };
  }, [state.connection, disconnect]);

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, wallets, connect, disconnect, sign, apiOnline }),
    [state, wallets, connect, disconnect, sign, apiOnline]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}
