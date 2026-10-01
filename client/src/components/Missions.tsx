import React, { useMemo, useState } from 'react';
import { useGame } from '../state/GameProvider';
import { MISSIONS, MISSION_BY_KEY } from '../game/systems/MissionSystem';
import { RARITY, Rarity } from '../game/config/rarity';
import { Bar, EmptyState, Notice, Panel, RarityTag, StatRow } from './ui';

/**
 * Missions — daily / weekly / special / seasonal.
 *
 * Missions are the primary *earned* progression channel: the main source of
 * Plasma, and the only source of several blueprints. None require spending.
 */

type Tab = 'DAILY' | 'WEEKLY' | 'SPECIAL' | 'SEASONAL';

const TABS: Tab[] = ['DAILY', 'WEEKLY', 'SPECIAL', 'SEASONAL'];

export function Missions() {
  const { missions, claimMission, profile } = useGame();
  const [tab, setTab] = useState<Tab>('DAILY');

  const byKey = useMemo(() => new Map(missions.map((m) => [m.missionKey, m])), [missions]);

  const visible = MISSIONS.filter((m) => m.kind === tab && (!m.seasonId || m.seasonId === profile.seasonId));

  const claimable = missions.filter((m) => m.completed && !m.claimed).length;

  return (
    <Panel
      title="MISSIONS"
      actions={
        claimable > 0 ? <span className="confirm-badge yes">{claimable} READY TO CLAIM</span> : <span className="mono-dim">No rewards pending</span>
      }
    >
      <Notice>
        Missions reset on a schedule — daily at 00:00 UTC, weekly on Monday. Seasonal missions run for the whole of Season
        01: THE VOID WAR.
      </Notice>

      <div className="filters">
        {TABS.map((t) => (
          <button key={t} className={`filter-chip ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="📡" title="NO MISSIONS" hint="Nothing is active in this category right now." />
      ) : (
        <div className="grid grid-2">
          {visible.map((def) => {
            const progress = byKey.get(def.key);
            const current = progress?.progress ?? 0;
            const completed = progress?.completed ?? false;
            const claimed = progress?.claimed ?? false;

            return (
              <div key={def.key} className="card">
                <div className="flex-between" style={{ marginBottom: 6 }}>
                  <h3 className="card-name" style={{ color: completed ? 'var(--ok)' : undefined }}>
                    {def.name}
                  </h3>
                  <span className="mono-dim">{def.kind}</span>
                </div>
                <p className="card-sub">{def.description}</p>

                <div style={{ margin: '10px 0 6px' }}>
                  <Bar value={current} max={def.target} tone={completed ? 'ok' : 'accent'} />
                </div>
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <span className="mono-dim">
                    {current.toLocaleString()} / {def.target.toLocaleString()}
                  </span>
                  <span className="mono-dim">{progress?.periodKey ?? '—'}</span>
                </div>

                <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                  <div className="mono-dim" style={{ marginBottom: 4 }}>
                    REWARDS
                  </div>
                  {def.rewards.xp ? <StatRow label="XP" value={def.rewards.xp.toLocaleString()} /> : null}
                  {def.rewards.scrap ? <StatRow label="Scrap" value={def.rewards.scrap.toLocaleString()} /> : null}
                  {def.rewards.plasma ? <StatRow label="Plasma" value={def.rewards.plasma.toLocaleString()} /> : null}
                  {def.rewards.riftCrystal ? (
                    <StatRow label="Rift Crystals" value={def.rewards.riftCrystal} tone="var(--accent-2)" />
                  ) : null}
                  {(def.rewards.items ?? []).map((item) => (
                    <div key={item.itemKey} className="stat-row">
                      <span>{item.itemKey.replace(/_/g, ' ')}</span>
                      <span>
                        <RarityTag rarity={item.rarity as Rarity} /> ×{item.quantity}
                      </span>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 12 }}>
                  {claimed ? (
                    <span className="confirm-badge no">CLAIMED</span>
                  ) : completed ? (
                    <button className="btn btn-primary btn-sm" onClick={() => claimMission(def.key)}>
                      CLAIM REWARDS
                    </button>
                  ) : (
                    <span className="mono-dim">In progress</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <h3 className="panel-title" style={{ fontSize: 12 }}>
          ALL MISSION TYPES
        </h3>
        <div className="grid grid-4">
          {(['DAILY', 'WEEKLY', 'SPECIAL', 'SEASONAL'] as const).map((kind) => {
            const count = MISSIONS.filter((m) => m.kind === kind).length;
            const done = missions.filter((m) => MISSION_BY_KEY[m.missionKey]?.kind === kind && m.completed).length;
            return (
              <div key={kind} className="card">
                <div className="mono-dim">{kind}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--accent)' }}>
                  {done} / {count}
                </div>
                <div style={{ marginTop: 8 }}>
                  <Bar value={done} max={count} tone="ok" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
