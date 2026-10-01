import React, { useMemo, useState } from 'react';
import { useGame } from '../state/GameProvider';
import { SHIPS, getShip } from '../game/config/ships';
import { UPGRADE_OPTIONS, computeShipStats, upgradeCost } from '../game/systems/ProgressionSystem';
import { RARITY, Rarity } from '../game/config/rarity';
import { Bar, EmptyState, Notice, Panel, RarityTag, ShipCard, StatRow } from './ui';

/**
 * Hangar — the player's fleet.
 *
 * Shows every hull they own, lets them pick the active one, and spends Scrap on
 * stat upgrades. Upgrades are earned-only: nothing here can be bought with
 * premium currency.
 */

export function Hangar() {
  const { profile, equipShip, upgradeShip, pushToast } = useGame();
  const [selectedId, setSelectedId] = useState(profile.equippedShipId);

  const selected = profile.ships.find((s) => s.id === selectedId) ?? profile.ships[0];
  const def = selected ? getShip(selected.shipKey) : null;

  const stats = useMemo(
    () => (selected && def ? computeShipStats(def.stats, selected.level, {}) : null),
    [selected, def]
  );

  // Upgrade points are tracked per ship; we derive the per-stat split from the
  // ship's total so the UI can show a coherent cost curve.
  const upgradePoints = selected?.upgradePoints ?? 0;

  if (!selected || !def || !stats) {
    return (
      <Panel title="HANGAR">
        <EmptyState icon="🛰" title="NO HULLS" hint="Something went wrong loading your fleet." />
      </Panel>
    );
  }

  const isEquipped = profile.equippedShipId === selected.id;

  return (
    <>
      <Panel
        title="HANGAR"
        actions={<span className="mono-dim">{profile.ships.length} hull(s) owned</span>}
      >
        <Notice>
          Every hull in the game is earnable by playing. Rarity changes feel and flair — never whether a ship is viable.
        </Notice>
        <div className="grid grid-3">
          {profile.ships.map((ship) => (
            <ShipCard
              key={ship.id}
              ship={ship}
              selected={ship.id === selected.id}
              onClick={() => setSelectedId(ship.id)}
              footer={
                ship.id === profile.equippedShipId ? (
                  <span className="confirm-badge yes">ACTIVE HULL</span>
                ) : (
                  <button
                    className="btn btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      equipShip(ship.id);
                    }}
                  >
                    SELECT
                  </button>
                )
              }
            />
          ))}
        </div>
      </Panel>

      <Panel
        title={`${def.name.toUpperCase()} · ${def.role}`}
        actions={
          <div className="btn-row">
            {!isEquipped ? (
              <button className="btn btn-primary btn-sm" onClick={() => equipShip(selected.id)}>
                SET ACTIVE
              </button>
            ) : null}
            <RarityTag rarity={selected.rarity} />
          </div>
        }
      >
        <p className="card-sub" style={{ fontSize: 12, marginBottom: 14 }}>
          {def.blurb}
        </p>

        <div className="grid grid-2">
          <div>
            <h3 className="panel-title" style={{ fontSize: 12 }}>
              EFFECTIVE STATS
            </h3>
            <StatRow label="Hull" value={stats.health} />
            <StatRow label="Shield" value={stats.shield} />
            <StatRow label="Damage" value={stats.damage} />
            <StatRow label="Speed" value={stats.speed.toFixed(2)} />
            <StatRow label="Fire Rate" value={`${stats.fireRate.toFixed(2)}/s`} />
            <StatRow label="Crit Chance" value={`${(stats.critChance * 100).toFixed(1)}%`} />
            <StatRow label="Cargo" value={stats.cargo} />
            <StatRow label="Ship Level" value={selected.level} />
            <StatRow label="Upgrade Points" value={upgradePoints} />
          </div>

          <div>
            <h3 className="panel-title" style={{ fontSize: 12 }}>
              SPECIAL ABILITY
            </h3>
            <div className="card" style={{ marginBottom: 14 }}>
              <h3 className="card-name" style={{ color: 'var(--accent)' }}>
                {def.ability.name}
              </h3>
              <p className="card-sub">{def.ability.description}</p>
              <StatRow label="Effect" value={def.ability.effect} />
              <StatRow label="Cooldown" value={`${(def.ability.cooldownMs / 1000).toFixed(0)}s`} />
              <StatRow label="Magnitude" value={def.ability.magnitude} />
            </div>

            <h3 className="panel-title" style={{ fontSize: 12 }}>
              ACQUISITION
            </h3>
            <StatRow label="Source" value={def.acquisition} />
            <StatRow label="On-chain" value={selected.tokenId ? `Token #${selected.tokenId}` : 'Not minted'} />
          </div>
        </div>
      </Panel>

      <Panel
        title="UPGRADES"
        actions={<span className="mono-dim">Scrap: {profile.scrap.toLocaleString()}</span>}
      >
        <Notice>
          Upgrades are bought with Scrap earned in combat. Each point is permanent and applies to this hull only.
        </Notice>
        <div className="grid grid-2">
          {UPGRADE_OPTIONS.map((option) => {
            const cost = upgradeCost(option, upgradePoints);
            const affordable = profile.scrap >= cost;
            const maxed = upgradePoints >= option.maxPoints;

            return (
              <div key={option.key} className="card">
                <div className="flex-between" style={{ marginBottom: 6 }}>
                  <h3 className="card-name">{option.name}</h3>
                  <span className="mono-dim">
                    {upgradePoints} / {option.maxPoints}
                  </span>
                </div>
                <p className="card-sub">{option.description}</p>
                <div style={{ marginBottom: 10 }}>
                  <Bar value={upgradePoints} max={option.maxPoints} tone="gold" />
                </div>
                <div className="flex-between">
                  <span className="mono-dim">Next: {maxed ? 'MAX' : `${cost.toLocaleString()} Scrap`}</span>
                  <button
                    className="btn btn-sm"
                    disabled={maxed || !affordable}
                    onClick={() => {
                      const res = upgradeShip(selected.id, option.key);
                      if (!res.ok) pushToast(res.reason ?? 'Upgrade failed', 'warn');
                    }}
                  >
                    {maxed ? 'MAXED' : affordable ? 'UPGRADE' : 'NEED SCRAP'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="SHIP CATALOGUE" actions={<span className="mono-dim">{SHIPS.length} hulls in the game</span>}>
        <div className="grid grid-3">
          {SHIPS.map((ship) => {
            const owned = profile.ships.some((s) => s.shipKey === ship.key);
            const meta = RARITY[ship.rarity] ?? RARITY[Rarity.COMMON];
            return (
              <div key={ship.key} className="card" style={{ opacity: owned ? 1 : 0.62 }}>
                <div className="flex-between" style={{ marginBottom: 6 }}>
                  <h3 className="card-name" style={{ color: meta.css }}>
                    {ship.name}
                  </h3>
                  <RarityTag rarity={ship.rarity} />
                </div>
                <p className="card-sub">{ship.blurb}</p>
                <StatRow label="Role" value={ship.role} />
                <StatRow label="Source" value={ship.acquisition} />
                <StatRow label="Status" value={owned ? 'OWNED' : 'LOCKED'} />
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
