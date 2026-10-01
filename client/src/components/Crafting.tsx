import React, { useEffect, useMemo, useState } from 'react';
import { useGame } from '../state/GameProvider';
import { RECIPES, canCraft, visibleRecipes } from '../game/systems/CraftingSystem';
import { materialCounts } from '../game/systems/InventorySystem';
import { RARITY, Rarity } from '../game/config/rarity';
import { Bar, EmptyState, Notice, Panel, RarityTag, StatRow, formatDuration } from './ui';

/**
 * Crafting — the fabricator.
 *
 * Every recipe consumes materials that drop from normal play. This is the main
 * way a free-to-play pilot reaches high-rarity gear without ever touching the
 * marketplace.
 */

export function Crafting() {
  const { profile, crafting, startCraft, pushToast } = useGame();
  const [now, setNow] = useState(Date.now());

  // Tick once a second so the in-flight job timers stay live.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const materials = useMemo(() => materialCounts(profile.inventory), [profile.inventory]);
  const recipes = useMemo(() => visibleRecipes(profile.level), [profile.level]);

  const materialKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of RECIPES) for (const i of r.inputs) keys.add(i.itemKey);
    return Array.from(keys).sort();
  }, []);

  return (
    <>
      <Panel
        title="FABRICATOR"
        actions={<span className="mono-dim">Level {profile.level} · {crafting.length} job(s) running</span>}
      >
        <Notice>
          Crafting is the free-to-play path to high-rarity gear. Materials drop from enemies, bosses, and loot crates —
          nothing here requires a purchase.
        </Notice>

        {crafting.length > 0 ? (
          <div style={{ marginBottom: 18 }}>
            <h3 className="panel-title" style={{ fontSize: 12 }}>
              IN PROGRESS
            </h3>
            <div className="grid grid-2">
              {crafting.map((job) => {
                const recipe = RECIPES.find((r) => r.key === job.recipeKey);
                if (!recipe) return null;
                const total = job.completesAt - job.startedAt;
                const done = Math.max(0, now - job.startedAt);
                const remaining = Math.max(0, job.completesAt - now);
                return (
                  <div key={job.recipeKey + job.startedAt} className="card">
                    <div className="flex-between" style={{ marginBottom: 6 }}>
                      <h3 className="card-name" style={{ color: 'var(--accent)' }}>
                        {recipe.name}
                      </h3>
                      <span className="mono-dim">{formatDuration(remaining)} left</span>
                    </div>
                    <Bar value={done} max={total} />
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <h3 className="panel-title" style={{ fontSize: 12 }}>
          MATERIALS
        </h3>
        {materialKeys.length === 0 ? (
          <EmptyState icon="⛏" title="NO MATERIALS" hint="Fly a run — materials drop from wrecks." />
        ) : (
          <div className="grid grid-4">
            {materialKeys.map((key) => (
              <div key={key} className="card">
                <div className="mono-dim" style={{ textTransform: 'capitalize' }}>
                  {key.replace(/_/g, ' ')}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--accent)' }}>
                  {materials[key] ?? 0}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="RECIPES" actions={<span className="mono-dim">{recipes.length} available at your level</span>}>
        <div className="grid grid-2">
          {recipes.map((recipe) => {
            const check = canCraft(
              recipe,
              materials,
              { scrap: profile.scrap, plasma: profile.plasma },
              profile.level
            );
            const meta = RARITY[recipe.output.rarity] ?? RARITY[Rarity.COMMON];

            return (
              <div key={recipe.key} className="card">
                <div className="flex-between" style={{ marginBottom: 6 }}>
                  <h3 className="card-name" style={{ color: meta.css }}>
                    {recipe.name}
                  </h3>
                  <RarityTag rarity={recipe.output.rarity} />
                </div>
                <p className="card-sub">{recipe.blurb}</p>

                <StatRow label="Output" value={`${recipe.output.category} ×${recipe.output.quantity}`} />
                <StatRow label="Required level" value={recipe.requiredLevel} />
                <StatRow label="Craft time" value={recipe.craftTimeSec === 0 ? 'Instant' : formatDuration(recipe.craftTimeSec * 1000)} />
                {recipe.cost.scrap ? <StatRow label="Scrap cost" value={recipe.cost.scrap.toLocaleString()} /> : null}
                {recipe.cost.plasma ? <StatRow label="Plasma cost" value={recipe.cost.plasma.toLocaleString()} /> : null}

                <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                  <div className="mono-dim" style={{ marginBottom: 4 }}>
                    INPUTS
                  </div>
                  {recipe.inputs.map((input) => {
                    const have = materials[input.itemKey] ?? 0;
                    const enough = have >= input.quantity;
                    return (
                      <div key={input.itemKey} className="stat-row">
                        <span style={{ textTransform: 'capitalize' }}>{input.itemKey.replace(/_/g, ' ')}</span>
                        <span style={{ color: enough ? 'var(--ok)' : 'var(--danger)' }}>
                          {have} / {input.quantity}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!check.ok}
                    onClick={() => {
                      const res = startCraft(recipe.key);
                      if (!res.ok) pushToast(res.reason ?? 'Cannot craft', 'warn');
                    }}
                  >
                    {check.ok ? 'FABRICATE' : (check.reason ?? 'UNAVAILABLE').toUpperCase()}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
