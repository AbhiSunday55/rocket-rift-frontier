import React from 'react';
import { RARITY, Rarity } from '../game/config/rarity';
import { getShip } from '../game/config/ships';
import { computeShipStats } from '../game/systems/ProgressionSystem';
import { dismantleValue } from '../game/systems/InventorySystem';
import type { InventoryItem, OwnedShip } from '../game/systems/types';

/**
 * Shared UI primitives.
 *
 * Every panel in the command centre is built from these, so spacing, rarity
 * colour, and stat presentation stay identical everywhere.
 */

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title ? (
        <h2 className="panel-title">
          <span>{title}</span>
          {actions}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

export function StatRow({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="stat-row">
      <span>{label}</span>
      <span style={tone ? { color: tone } : undefined}>{value}</span>
    </div>
  );
}

export function Bar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'gold' | 'ok' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="bar">
      <div className={`bar-fill ${tone === 'accent' ? '' : tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function RarityTag({ rarity }: { rarity: Rarity }) {
  const meta = RARITY[rarity] ?? RARITY[Rarity.COMMON];
  return (
    <span className="rarity-tag" style={{ color: meta.css }}>
      {meta.name}
    </span>
  );
}

export function CurrencyChip({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="currency-chip" title={label}>
      <span aria-hidden>{icon}</span>
      <b style={tone ? { color: tone } : undefined}>{typeof value === 'number' ? value.toLocaleString() : value}</b>
      <span className="mono-dim">{label}</span>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden>
        {icon}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', letterSpacing: 1, marginBottom: 6 }}>{title}</div>
      {hint ? <div>{hint}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger'; children: React.ReactNode }) {
  return <div className={`notice ${tone === 'info' ? '' : tone}`}>{children}</div>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
        {footer ? <div className="btn-row" style={{ marginTop: 18 }}>{footer}</div> : null}
      </div>
    </div>
  );
}

/** A single inventory item, rendered as a selectable card. */
export function ItemCard({
  item,
  selected,
  onClick,
  footer,
}: {
  item: InventoryItem;
  selected?: boolean;
  onClick?: () => void;
  footer?: React.ReactNode;
}) {
  const meta = RARITY[item.rarity] ?? RARITY[Rarity.COMMON];
  return (
    <div
      className={`card ${selected ? 'selected' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ borderColor: selected ? meta.css : undefined }}
    >
      <div className="flex-between" style={{ marginBottom: 6 }}>
        <h3 className="card-name" style={{ color: meta.css }}>
          {item.name}
        </h3>
        <RarityTag rarity={item.rarity} />
      </div>
      <p className="card-sub">
        {item.category}
        {item.quantity > 1 ? ` · ×${item.quantity}` : ''} · Lv {item.level}
      </p>
      <StatRow label="State" value={item.state} />
      <StatRow label="Dismantle" value={`${dismantleValue(item)} Scrap`} />
      {item.tokenId ? <StatRow label="Token" value={`#${item.tokenId}`} /> : null}
      {footer ? <div style={{ marginTop: 10 }}>{footer}</div> : null}
    </div>
  );
}

/** A single owned ship, rendered as a selectable card. */
export function ShipCard({
  ship,
  selected,
  onClick,
  footer,
}: {
  ship: OwnedShip;
  selected?: boolean;
  onClick?: () => void;
  footer?: React.ReactNode;
}) {
  const def = getShip(ship.shipKey);
  const stats = computeShipStats(def.stats, ship.level, {});
  const meta = RARITY[ship.rarity] ?? RARITY[Rarity.COMMON];

  return (
    <div
      className={`card ${selected ? 'selected' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ borderColor: selected ? meta.css : undefined }}
    >
      <div className="flex-between" style={{ marginBottom: 6 }}>
        <h3 className="card-name" style={{ color: meta.css }}>
          {ship.nickname ?? def.name}
        </h3>
        <RarityTag rarity={ship.rarity} />
      </div>
      <p className="card-sub">
        {def.role} · Lv {ship.level}
        {ship.isStarter ? ' · STARTER' : ''}
      </p>
      <StatRow label="Hull" value={stats.health} />
      <StatRow label="Shield" value={stats.shield} />
      <StatRow label="Damage" value={stats.damage} />
      <StatRow label="Speed" value={stats.speed.toFixed(2)} />
      <StatRow label="Fire Rate" value={`${stats.fireRate.toFixed(2)}/s`} />
      <StatRow label="Crit" value={`${(stats.critChance * 100).toFixed(1)}%`} />
      <StatRow label="Cargo" value={stats.cargo} />
      <StatRow label="Upgrade Pts" value={ship.upgradePoints} />
      {ship.tokenId ? <StatRow label="Token" value={`#${ship.tokenId}`} /> : null}
      {footer ? <div style={{ marginTop: 10 }}>{footer}</div> : null}
    </div>
  );
}

/** Formats a wei string as a short ETH amount. */
export function formatEth(wei: string | bigint, digits = 4): string {
  try {
    const v = typeof wei === 'bigint' ? wei : BigInt(wei);
    const whole = v / 10n ** 18n;
    const frac = (v % 10n ** 18n).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : whole.toString();
  } catch {
    return '0';
  }
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
