import React, { useEffect, useState } from 'react';
import { useGame } from '../state/GameProvider';
import { useWallet } from '../wallet/WalletProvider';
import { api, type LeaderboardRow } from '../api/client';
import { seasonTierProgress } from '../game/systems/ProgressionSystem';
import { inventoryValue, rarityBreakdown } from '../game/systems/InventorySystem';
import { RARITY, Rarity } from '../game/config/rarity';
import { Bar, CurrencyChip, Notice, Panel, StatRow, formatDuration } from './ui';

/**
 * Profile — identity, progression, season track, and the leaderboard.
 */

export function Profile() {
  const { profile, apiOnline, authenticated, setDisplayName, resetProgress, pushToast } = useGame();
  const wallet = useWallet();
  const [name, setName] = useState(profile.displayName);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);

  useEffect(() => {
    if (!apiOnline) return;
    let cancelled = false;
    api
      .leaderboard(profile.seasonId)
      .then((res) => {
        if (!cancelled) setBoard(res.rows ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiOnline, profile.seasonId]);

  const season = seasonTierProgress(profile.seasonXp);
  const breakdown = rarityBreakdown(profile.inventory);
  const totalItems = profile.inventory.reduce((sum, i) => sum + i.quantity, 0);
  const playtime = formatDuration(profile.stats.totalPlaytimeMs);

  return (
    <>
      <Panel title="PILOT PROFILE">
        <div className="grid grid-2">
          <div>
            <label className="mono-dim" htmlFor="pilot-name">
              CALLSIGN
            </label>
            <div className="btn-row" style={{ marginTop: 6 }}>
              <input
                id="pilot-name"
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                style={{ flex: 1, minWidth: 160 }}
              />
              <button
                className="btn btn-sm"
                onClick={() => {
                  setDisplayName(name);
                  pushToast('Callsign updated', 'success');
                }}
              >
                SAVE
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              <StatRow label="Level" value={profile.level} />
              <StatRow label="XP" value={`${profile.xp.toLocaleString()} / ${(profile.xp + 1).toLocaleString()}`} />
              <StatRow label="Season" value={`S${String(profile.seasonId).padStart(2, '0')}`} />
              <StatRow label="Season XP" value={profile.seasonXp.toLocaleString()} />
              <StatRow label="Wallet" value={wallet.connection ? 'CONNECTED' : 'NOT CONNECTED'} />
              <StatRow label="Server Auth" value={authenticated ? 'SIGNED IN' : 'LOCAL MODE'} />
              <StatRow label="Member Since" value={new Date(profile.createdAt).toLocaleDateString()} />
            </div>
          </div>

          <div>
            <h3 className="panel-title" style={{ fontSize: 12 }}>
              SEASON 01 · THE VOID WAR
            </h3>
            <div className="card">
              <div className="flex-between" style={{ marginBottom: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13 }}>TIER {season.tier}</span>
                <span className="mono-dim">
                  {season.into} / {season.needed}
                </span>
              </div>
              <Bar value={season.into} max={season.needed} tone="gold" />
              <p className="card-sub" style={{ marginTop: 10 }}>
                Every 5th tier grants Rift Crystals. Season XP is earned by playing — never bought.
              </p>
            </div>

            <h3 className="panel-title" style={{ fontSize: 12, marginTop: 16 }}>
              COLLECTION
            </h3>
            <div className="card">
              <StatRow label="Items held" value={totalItems} />
              <StatRow label="Inventory value" value={`${inventoryValue(profile.inventory).toLocaleString()} Scrap`} />
              {(Object.keys(breakdown) as unknown as Rarity[]).map((r) => {
                const key = Number(r) as Rarity;
                const meta = RARITY[key];
                if (!meta) return null;
                return <StatRow key={key} label={meta.name} value={breakdown[key]} tone={meta.css} />;
              })}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="CAREER STATS">
        <div className="grid grid-4">
          <div className="card">
            <div className="mono-dim">RUNS PLAYED</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--accent)' }}>
              {profile.stats.runsPlayed}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">BEST SCORE</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--gold)' }}>
              {profile.stats.bestScore.toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">DEEPEST SECTOR</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--accent-2)' }}>
              {profile.stats.bestSector}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">TOTAL KILLS</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--danger)' }}>
              {profile.stats.totalKills.toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">BOSSES KILLED</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--ok)' }}>
              {profile.stats.totalBossesKilled}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">LOOT RECOVERED</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--gold)' }}>
              {profile.stats.totalLootValue.toLocaleString()}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">COMBAT TIME</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--accent)' }}>
              {playtime}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">CURRENCIES</div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <CurrencyChip icon="⚙" label="Scrap" value={profile.scrap} tone="var(--gold)" />
              <CurrencyChip icon="◈" label="Plasma" value={profile.plasma} tone="var(--accent)" />
              <CurrencyChip icon="✦" label="Crystals" value={profile.riftCrystal} tone="var(--accent-2)" />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="SEASON LEADERBOARD" actions={<span className="mono-dim">Season {profile.seasonId}</span>}>
        {!apiOnline ? (
          <Notice tone="warn">
            The leaderboard needs the game server. You are playing in local mode — your progress is saved on this device.
          </Notice>
        ) : board.length === 0 ? (
          <Notice>No ranked pilots yet this season. Be the first.</Notice>
        ) : (
          <div>
            {board.slice(0, 20).map((row) => (
              <div key={row.playerId} className="stat-row">
                <span>
                  #{row.rank} · {row.displayName || 'Anonymous Pilot'}
                </span>
                <span>
                  LV {row.level} · {row.seasonXp.toLocaleString()} SXP
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="DANGER ZONE">
        <Notice tone="danger">
          Resetting clears your local save — profile, inventory, missions, and crafting. Server-side progress (if you are
          signed in) is not affected.
        </Notice>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('Reset all local progress? This cannot be undone.')) resetProgress();
          }}
        >
          RESET LOCAL PROGRESS
        </button>
      </Panel>
    </>
  );
}
