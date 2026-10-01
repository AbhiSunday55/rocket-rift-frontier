import React, { useEffect, useState } from 'react';
import { useGame } from '../state/GameProvider';
import { useWallet } from '../wallet/WalletProvider';
import { STANDALONE } from '../api/client';
import { shortAddress } from '../wallet/connectors';
import { Hangar } from './Hangar';
import { Profile } from './Profile';
import { Missions } from './Missions';
import { Inventory } from './Inventory';
import { Crafting } from './Crafting';
import { Marketplace } from './Marketplace';
import { Trade } from './Trade';
import { WalletModal } from './WalletModal';
import { CurrencyChip } from './ui';
import type { GameHost } from '../game/GameHost';

/**
 * CommandCenter — the React shell that wraps the game.
 *
 * It is the game's front end: launch a run, manage the fleet, run missions,
 * craft, and trade. The Phaser canvas sits behind it and is revealed the moment
 * a run starts.
 */

type Tab = 'LAUNCH' | 'HANGAR' | 'MISSIONS' | 'INVENTORY' | 'CRAFTING' | 'MARKETPLACE' | 'TRADE' | 'PROFILE';

const TABS: { key: Tab; label: string }[] = [
  { key: 'LAUNCH', label: 'LAUNCH' },
  { key: 'HANGAR', label: 'HANGAR' },
  { key: 'MISSIONS', label: 'MISSIONS' },
  { key: 'INVENTORY', label: 'INVENTORY' },
  { key: 'CRAFTING', label: 'CRAFTING' },
  { key: 'MARKETPLACE', label: 'MARKETPLACE' },
  { key: 'TRADE', label: 'TRADE' },
  { key: 'PROFILE', label: 'PROFILE' },
];

export function CommandCenter({ host }: { host: GameHost | null }) {
  const { profile, missions, apiOnline, syncing, toasts, dismissToast, pushToast } = useGame();
  const wallet = useWallet();
  const [tab, setTab] = useState<Tab>('LAUNCH');
  const [walletOpen, setWalletOpen] = useState(false);

  // Surface connection problems once, rather than nagging.
  useEffect(() => {
    if (wallet.status === 'error' && wallet.error) pushToast(wallet.error, 'danger');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.status, wallet.error]);

  const claimable = missions.filter((m) => m.completed && !m.claimed).length;

  return (
    <div className="command-center">
      <header className="cc-topbar">
        <div className="cc-brand">
          <h1>ROCKET RIFT</h1>
          <span>FRONTIER</span>
        </div>

        <div className="cc-currencies">
          <CurrencyChip icon="⚙" label="Scrap" value={profile.scrap} tone="var(--gold)" />
          <CurrencyChip icon="◈" label="Plasma" value={profile.plasma} tone="var(--accent)" />
          <CurrencyChip icon="✦" label="Crystals" value={profile.riftCrystal} tone="var(--accent-2)" />
          <CurrencyChip icon="★" label="Level" value={profile.level} tone="var(--ok)" />
        </div>

        <div className="btn-row">
          <span className="mono-dim" title={apiOnline ? 'Game server reachable' : 'Playing in local mode'}>
            {syncing ? 'SYNCING…' : apiOnline ? '● ONLINE' : STANDALONE ? '○ GUEST MODE' : '○ LOCAL'}
          </span>
          <button className="wallet-btn" onClick={() => setWalletOpen(true)}>
            {wallet.connection ? (
              <>
                <span className="wallet-dot" />
                {shortAddress(wallet.connection.address)}
              </>
            ) : (
              <>CONNECT WALLET</>
            )}
          </button>
        </div>
      </header>

      <nav className="cc-nav" aria-label="Command centre sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`nav-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
          >
            {t.label}
            {t.key === 'MISSIONS' && claimable > 0 ? ` (${claimable})` : ''}
          </button>
        ))}
      </nav>

      <div className="cc-body">
        {tab === 'LAUNCH' ? <LaunchPanel host={host} onNavigate={setTab} /> : null}
        {tab === 'HANGAR' ? <Hangar /> : null}
        {tab === 'MISSIONS' ? <Missions /> : null}
        {tab === 'INVENTORY' ? <Inventory /> : null}
        {tab === 'CRAFTING' ? <Crafting /> : null}
        {tab === 'MARKETPLACE' ? <Marketplace /> : null}
        {tab === 'TRADE' ? <Trade /> : null}
        {tab === 'PROFILE' ? <Profile /> : null}
      </div>

      <div className="hud-toasts" style={{ position: 'fixed', bottom: 16, right: 16, top: 'auto' }}>
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismissToast(t.id)} role="status">
            {t.message}
          </div>
        ))}
      </div>

      {walletOpen ? <WalletModal onClose={() => setWalletOpen(false)} /> : null}
    </div>
  );
}

function LaunchPanel({ host, onNavigate }: { host: GameHost | null; onNavigate: (t: Tab) => void }) {
  const { profile, missions, apiOnline, authenticated } = useGame();
  const [sector, setSector] = useState(1);

  const ship = profile.ships.find((s) => s.id === profile.equippedShipId) ?? profile.ships[0];
  const daily = missions.filter((m) => m.missionKey.startsWith('daily'));
  const dailyDone = daily.filter((m) => m.completed).length;

  return (
    <>
      <section className="panel">
        <h2 className="panel-title">
          <span>LAUNCH BAY</span>
          <span className="mono-dim">Season 01 · The Void War</span>
        </h2>

        <div className="grid grid-2">
          <div>
            <p className="card-sub" style={{ fontSize: 12, lineHeight: 1.7 }}>
              Fly an endless run through the Rift. Every sector is procedurally generated from a seed, every fifth sector
              is a boss, and everything you earn is yours — with or without a wallet.
            </p>

            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                className="btn btn-primary"
                style={{ padding: '14px 32px', fontSize: 14 }}
                onClick={() => host?.launchRun({ sectorIndex: sector })}
              >
                ▶ LAUNCH RUN
              </button>
              <button className="btn" onClick={() => onNavigate('HANGAR')}>
                CHANGE HULL
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <label className="mono-dim" htmlFor="start-sector">
                STARTING SECTOR
              </label>
              <div className="btn-row" style={{ marginTop: 6 }}>
                <input
                  id="start-sector"
                  type="range"
                  min={1}
                  max={Math.max(1, profile.stats.bestSector)}
                  value={sector}
                  onChange={(e) => setSector(Number(e.target.value))}
                  style={{ flex: 1, minWidth: 180 }}
                />
                <span style={{ fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>{sector}</span>
              </div>
              <div className="mono-dim" style={{ marginTop: 4 }}>
                You may start at any sector you have already reached (best: {profile.stats.bestSector}).
              </div>
            </div>
          </div>

          <div>
            <div className="card">
              <div className="mono-dim">ACTIVE HULL</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--accent)', margin: '4px 0 10px' }}>
                {ship?.nickname ?? 'Raptor-X'}
              </div>
              <div className="stat-row">
                <span>Level</span>
                <span>{ship?.level ?? 1}</span>
              </div>
              <div className="stat-row">
                <span>Upgrade points</span>
                <span>{ship?.upgradePoints ?? 0}</span>
              </div>
              <div className="stat-row">
                <span>Fleet size</span>
                <span>{profile.ships.length}</span>
              </div>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="mono-dim">TODAY'S MISSIONS</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--gold)', margin: '4px 0 10px' }}>
                {dailyDone} / {daily.length} complete
              </div>
              <div className="mono-dim">
                {authenticated ? 'Signed in — progress syncs to the server.' : 'Local mode — progress saves on this device.'}
              </div>
              <div className="mono-dim">{apiOnline ? 'Server online.' : 'Server unreachable.'}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">
          <span>CONTROLS</span>
        </h2>
        <div className="grid grid-4">
          {[
            ['MOVE', 'WASD / Arrows'],
            ['FIRE', 'Space'],
            ['ABILITY', 'E'],
            ['DASH', 'Shift'],
            ['SECONDARY', 'Q'],
            ['ULTIMATE', 'R'],
            ['PAUSE', 'Esc'],
            ['MOBILE', 'On-screen stick'],
          ].map(([action, key]) => (
            <div key={action} className="card">
              <div className="mono-dim">{action}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--accent)', marginTop: 4 }}>
                {key}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
