import React, { useEffect, useRef, useState } from 'react';
import { bus } from '../game/systems/EventBus';
import { useGame } from '../state/GameProvider';
import type { GameHost } from '../game/GameHost';
import { Bar } from './ui';

/**
 * HUD — the in-run overlay.
 *
 * It subscribes to the game's event bus rather than polling scene state, so it
 * stays correct across scene hand-offs (GameScene → BossScene → GameOverScene)
 * without holding a reference to any scene that may have been destroyed.
 */

interface HudState {
  designation: string;
  biome: string;
  isBoss: boolean;
  score: number;
  kills: number;
  level: number;
  xp: number;
  xpToNext: number;
  health: number;
  maxHealth: number;
  shield: number;
  maxShield: number;
  boss: { name: string; title: string; health: number; maxHealth: number; phase: string } | null;
  mission: { name: string; progress: number; target: number } | null;
  paused: boolean;
}

const INITIAL: HudState = {
  designation: 'SECTOR 01',
  biome: '',
  isBoss: false,
  score: 0,
  kills: 0,
  level: 1,
  xp: 0,
  xpToNext: 120,
  health: 100,
  maxHealth: 100,
  shield: 50,
  maxShield: 50,
  boss: null,
  mission: null,
  paused: false,
};

export function HUD({ host }: { host: GameHost | null }) {
  const { profile, toasts, dismissToast } = useGame();
  const [hud, setHud] = useState<HudState>(INITIAL);
  const [feed, setFeed] = useState<{ id: string; text: string; tone: string }[]>([]);
  const feedId = useRef(0);

  const pushFeed = (text: string, tone = 'info') => {
    const id = `f${feedId.current++}`;
    setFeed((prev) => [...prev.slice(-3), { id, text, tone }]);
    window.setTimeout(() => setFeed((prev) => prev.filter((f) => f.id !== id)), 3200);
  };

  useEffect(() => {
    const offs: (() => void)[] = [];

    offs.push(
      bus.on('sector:enter', ({ designation, biome, isBoss }) => {
        setHud((h) => ({ ...h, designation, biome, isBoss, boss: null }));
        pushFeed(designation, isBoss ? 'warn' : 'info');
      })
    );

    offs.push(
      bus.on('sector:clear', ({ index, score }) => {
        setHud((h) => ({ ...h, score }));
        pushFeed(`SECTOR ${index} CLEARED`, 'success');
      })
    );

    offs.push(
      bus.on('boss:spawn', ({ name, title, health }) => {
        setHud((h) => ({ ...h, boss: { name, title, health, maxHealth: health, phase: 'PHASE I' } }));
        pushFeed(`${name} — ${title}`, 'danger');
      })
    );

    offs.push(
      bus.on('boss:phase', ({ name }) => {
        setHud((h) => (h.boss ? { ...h, boss: { ...h.boss, phase: name } } : h));
        pushFeed(name, 'warn');
      })
    );

    offs.push(
      bus.on('boss:defeated', ({ name }) => {
        setHud((h) => ({ ...h, boss: null }));
        pushFeed(`${name} DESTROYED`, 'success');
      })
    );

    offs.push(
      bus.on('player:damaged', ({ health, shield }) => {
        setHud((h) => ({ ...h, health, shield, maxHealth: Math.max(h.maxHealth, health), maxShield: Math.max(h.maxShield, shield) }));
      })
    );

    offs.push(
      bus.on('player:healed', ({ health }) => {
        setHud((h) => ({ ...h, health, maxHealth: Math.max(h.maxHealth, health) }));
      })
    );

    offs.push(
      bus.on('player:xp', ({ xp, level, xpToNext }) => {
        setHud((h) => ({ ...h, xp, level, xpToNext }));
      })
    );

    offs.push(
      bus.on('player:levelup', ({ level }) => {
        setHud((h) => ({ ...h, level }));
        pushFeed(`LEVEL ${level} REACHED`, 'success');
      })
    );

    offs.push(
      bus.on('enemy:killed', () => {
        setHud((h) => ({ ...h, kills: h.kills + 1 }));
      })
    );

    offs.push(
      bus.on('loot:pickup', ({ name, rarity }) => {
        pushFeed(`+ ${name}`, rarity >= 3 ? 'success' : 'info');
      })
    );

    offs.push(
      bus.on('powerup:pickup', ({ name }) => {
        pushFeed(name, 'success');
      })
    );

    offs.push(
      bus.on('mission:progress', ({ missionKey, progress, target, completed }) => {
        setHud((h) => ({ ...h, mission: { name: missionKey.replace(/_/g, ' '), progress, target } }));
        if (completed) pushFeed('MISSION COMPLETE', 'success');
      })
    );

    offs.push(
      bus.on('pause', () => setHud((h) => ({ ...h, paused: true })))
    );
    offs.push(
      bus.on('resume', () => setHud((h) => ({ ...h, paused: false })))
    );

    return () => offs.forEach((off) => off());
  }, []);

  // Seed the HUD from the persisted profile so it is never blank on entry.
  useEffect(() => {
    setHud((h) => ({ ...h, level: profile.level, xp: profile.xp }));
  }, [profile.level, profile.xp]);

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-pill">
          <b>{hud.designation}</b>
          {hud.biome ? <span className="mono-dim"> · {hud.biome}</span> : null}
        </div>
        <div className="hud-pill">
          SCORE <b>{hud.score.toLocaleString()}</b>
        </div>
        <div className="hud-pill">
          KILLS <b>{hud.kills}</b>
        </div>
        <div className="hud-pill">
          LV <b>{hud.level}</b>
        </div>
      </div>

      {/* Vitals */}
      <div
        style={{
          position: 'absolute',
          left: 16,
          bottom: 16,
          width: 240,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div className="mono-dim">HULL {Math.round(hud.health)}</div>
        <Bar value={hud.health} max={hud.maxHealth} tone="ok" />
        <div className="mono-dim">SHIELD {Math.round(hud.shield)}</div>
        <Bar value={hud.shield} max={hud.maxShield} />
        <div className="mono-dim">
          XP {hud.xp} / {hud.xpToNext}
        </div>
        <Bar value={hud.xp} max={hud.xpToNext} tone="gold" />
      </div>

      {/* Boss bar */}
      {hud.boss ? (
        <div
          style={{
            position: 'absolute',
            top: 62,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(560px, 80vw)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontFamily: 'var(--font-display)', letterSpacing: 2, color: 'var(--danger)', fontSize: 13 }}>
            {hud.boss.name} · {hud.boss.phase}
          </div>
          <div style={{ marginTop: 6 }}>
            <Bar value={hud.boss.health} max={hud.boss.maxHealth} tone="gold" />
          </div>
        </div>
      ) : null}

      {/* Mission tracker */}
      {hud.mission ? (
        <div
          style={{
            position: 'absolute',
            left: 16,
            top: 62,
            width: 220,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(11,16,32,0.85)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="mono-dim" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
            Mission
          </div>
          <div style={{ fontSize: 12, margin: '4px 0 6px', textTransform: 'capitalize' }}>{hud.mission.name}</div>
          <Bar value={hud.mission.progress} max={hud.mission.target} />
          <div className="mono-dim" style={{ marginTop: 4 }}>
            {hud.mission.progress} / {hud.mission.target}
          </div>
        </div>
      ) : null}

      {/* Event feed */}
      <div className="hud-toasts">
        {feed.map((f) => (
          <div key={f.id} className={`toast ${f.tone}`}>
            {f.text}
          </div>
        ))}
        {toasts.slice(-2).map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismissToast(t.id)}>
            {t.message}
          </div>
        ))}
      </div>

      {/* Pause */}
      <div className="hud-pause">
        <button
          className="btn btn-sm"
          onClick={() => host?.setPaused(!hud.paused)}
          aria-label={hud.paused ? 'Resume' : 'Pause'}
        >
          {hud.paused ? '▶ RESUME' : '❚❚ PAUSE'}
        </button>
      </div>

      {hud.paused ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2,3,10,0.6)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: 6, color: 'var(--accent)' }}>
            PAUSED
          </div>
        </div>
      ) : null}
    </div>
  );
}
