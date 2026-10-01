import React, { useState } from 'react';
import { useWallet } from '../wallet/WalletProvider';
import { useGame } from '../state/GameProvider';
import { shortAddress } from '../wallet/connectors';
import { ADDRESSES, CHAIN_ID, isContractsConfigured } from '../wallet/contracts';
import { Modal, Notice, StatRow } from './ui';

/**
 * WalletModal — connect / disconnect, and an honest account of what the wallet
 * is and is not used for.
 *
 * SECURITY: this UI never asks for a seed phrase or private key. It only ever
 * requests a signature over a server-issued nonce.
 */

export function WalletModal({ onClose }: { onClose: () => void }) {
  const wallet = useWallet();
  const { apiOnline, authenticated } = useGame();
  const [busy, setBusy] = useState<string | null>(null);

  const handleConnect = async (id: (typeof wallet.wallets)[number]['id']) => {
    setBusy(id);
    try {
      await wallet.connect(id);
    } finally {
      setBusy(null);
    }
  };

  if (wallet.status === 'connected' && wallet.connection) {
    return (
      <Modal
        title="WALLET CONNECTED"
        onClose={onClose}
        footer={
          <>
            <button className="btn btn-danger" onClick={() => wallet.disconnect()}>
              DISCONNECT
            </button>
            <button className="btn" onClick={onClose}>
              CLOSE
            </button>
          </>
        }
      >
        <p>
          Your wallet proves who you are. It never holds your progress — the game server does — and it is never asked for a
          seed phrase or private key.
        </p>
        <StatRow label="Address" value={shortAddress(wallet.connection.address, 6)} />
        <StatRow label="Wallet" value={wallet.connection.id} />
        <StatRow label="Chain ID" value={wallet.connection.chainId} />
        <StatRow label="Target Chain" value={CHAIN_ID} />
        <StatRow label="Server Auth" value={authenticated ? 'SIGNED IN' : 'LOCAL MODE'} />
        <StatRow label="API" value={apiOnline ? 'ONLINE' : 'OFFLINE'} />
        <StatRow label="Contracts" value={isContractsConfigured() ? 'CONFIGURED' : 'NOT DEPLOYED'} />
        <div style={{ marginTop: 14 }}>
          <Notice tone={isContractsConfigured() ? 'info' : 'warn'}>
            {isContractsConfigured() ? (
              <>
                Marketplace: <code>{shortAddress(ADDRESSES.marketplace, 6)}</code>
              </>
            ) : (
              <>
                No contract addresses are configured, so on-chain minting and settlement are disabled. The game, the
                marketplace, and P2P trading all still work — they settle in the game database instead.
              </>
            )}
          </Notice>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="CONNECT A WALLET" onClose={onClose}>
      <p>
        Optional. ROCKET RIFT is fully playable without a wallet — connecting one lets you mint your ships and items as
        tokens, and trade them with other pilots.
      </p>

      {wallet.error ? <Notice tone="danger">{wallet.error}</Notice> : null}

      {wallet.wallets.map((w) => (
        <button
          key={w.id}
          className="wallet-option"
          disabled={busy !== null}
          onClick={() => handleConnect(w.id)}
        >
          <span className="wallet-option-icon" aria-hidden>
            {w.icon}
          </span>
          <span className="wallet-option-text">
            <b>{w.name}</b>
            <small>{w.description}</small>
          </span>
          <span className="mono-dim">
            {busy === w.id ? <span className="spinner" /> : w.available ? 'DETECTED' : 'NOT INSTALLED'}
          </span>
        </button>
      ))}

      <div style={{ marginTop: 14 }}>
        <Notice>
          <b>We will never ask for your seed phrase or private key.</b> Connecting only requests a signature over a
          one-time message so the server can verify your address. Anyone who asks you for a seed phrase is stealing from
          you.
        </Notice>
      </div>
    </Modal>
  );
}
