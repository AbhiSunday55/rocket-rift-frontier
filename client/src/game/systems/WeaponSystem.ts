import Phaser from 'phaser';
import { COMBAT } from '../config/constants';
import { getWeapon, type WeaponDef } from '../config/weapons';
import type { ShipStats } from '../config/ships';

/**
 * Weapon system.
 *
 * Owns the three slots (PRIMARY / SECONDARY / ULTIMATE), the ultimate charge
 * meter, and the actual projectile spawning. Damage numbers are computed here
 * and reported to the run state so the anti-cheat layer can sanity-check them.
 */

export interface WeaponRuntime {
  primary: WeaponDef;
  secondary: WeaponDef;
  ultimate: WeaponDef;
  /** 0..100 ultimate charge. */
  charge: number;
  /** Timestamps (ms) when each slot becomes usable again. */
  nextPrimaryAt: number;
  nextSecondaryAt: number;
  /** Active temporary modifiers from power-ups. */
  modifiers: {
    damageMultiplier: number;
    fireRateMultiplier: number;
    speedMultiplier: number;
    scrapMultiplier: number;
    magnet: boolean;
    invulnerable: boolean;
  };
  /** Expiry timestamps for each modifier. */
  modifierExpiry: Record<string, number>;
}

export function createWeaponRuntime(loadout: { primary: string; secondary: string; ultimate: string }): WeaponRuntime {
  return {
    primary: getWeapon(loadout.primary),
    secondary: getWeapon(loadout.secondary),
    ultimate: getWeapon(loadout.ultimate),
    charge: 0,
    nextPrimaryAt: 0,
    nextSecondaryAt: 0,
    modifiers: {
      damageMultiplier: 1,
      fireRateMultiplier: 1,
      speedMultiplier: 1,
      scrapMultiplier: 1,
      magnet: false,
      invulnerable: false,
    },
    modifierExpiry: {},
  };
}

/** Milliseconds between primary shots for a given ship + weapon. */
export function primaryInterval(stats: ShipStats, weapon: WeaponDef, fireRateMultiplier = 1): number {
  const shotsPerSecond = stats.fireRate * weapon.fireRateMultiplier * fireRateMultiplier;
  return Math.max(40, 1000 / Math.max(0.1, shotsPerSecond));
}

/** Damage of a single projectile, including crit resolution. */
export function rollDamage(
  stats: ShipStats,
  weapon: WeaponDef,
  damageMultiplier = 1,
  rng: () => number = Math.random
): { damage: number; crit: boolean } {
  const crit = rng() < stats.critChance;
  const base = stats.damage * weapon.damageMultiplier * damageMultiplier;
  const damage = Math.max(1, Math.round(base * (crit ? COMBAT.critMultiplier : 1)));
  return { damage, crit };
}

/**
 * Computes the muzzle offsets + angles for a volley.
 * Spread is distributed evenly across the pattern's arc.
 */
export function volleyPattern(
  weapon: WeaponDef,
  aimAngle: number,
  muzzleX: number,
  muzzleY: number
): { x: number; y: number; angle: number }[] {
  const n = Math.max(1, weapon.projectiles);
  const spread = Phaser.Math.DegToRad(weapon.spreadDeg);
  const out: { x: number; y: number; angle: number }[] = [];

  if (weapon.pattern === 'MINE') {
    // Mines scatter in a full ring behind the ship.
    for (let i = 0; i < n; i++) {
      const a = aimAngle + Math.PI + (Math.PI * 2 * i) / n;
      out.push({ x: muzzleX, y: muzzleY, angle: a });
    }
    return out;
  }

  if (n === 1) {
    out.push({ x: muzzleX, y: muzzleY, angle: aimAngle });
    return out;
  }

  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const offset = (t - 0.5) * spread;
    // Perpendicular muzzle offset so double barrels read as two barrels.
    const perp = (t - 0.5) * 14;
    out.push({
      x: muzzleX + Math.cos(aimAngle + Math.PI / 2) * perp,
      y: muzzleY + Math.sin(aimAngle + Math.PI / 2) * perp,
      angle: aimAngle + offset,
    });
  }
  return out;
}

/** Adds ultimate charge from damage dealt. */
export function addCharge(rt: WeaponRuntime, damageDealt: number): void {
  // ~100 charge per 1200 damage, so an ultimate lands roughly every 30-60s.
  rt.charge = Math.min(100, rt.charge + damageDealt / 12);
}

export function canUseUltimate(rt: WeaponRuntime): boolean {
  return rt.charge >= rt.ultimate.chargeCost;
}

/** Applies a power-up modifier and records its expiry. */
export function applyModifier(
  rt: WeaponRuntime,
  kind: string,
  magnitude: number,
  durationMs: number,
  now: number
): void {
  switch (kind) {
    case 'DAMAGE_BOOST':
      rt.modifiers.damageMultiplier = 1 + magnitude;
      rt.modifierExpiry.damageMultiplier = now + durationMs;
      break;
    case 'FIRE_RATE_BOOST':
      rt.modifiers.fireRateMultiplier = 1 + magnitude;
      rt.modifierExpiry.fireRateMultiplier = now + durationMs;
      break;
    case 'SPEED_BOOST':
      rt.modifiers.speedMultiplier = 1 + magnitude;
      rt.modifierExpiry.speedMultiplier = now + durationMs;
      break;
    case 'MAGNET':
      rt.modifiers.magnet = true;
      rt.modifierExpiry.magnet = now + durationMs;
      break;
    case 'INVULN':
      rt.modifiers.invulnerable = true;
      rt.modifierExpiry.invulnerable = now + durationMs;
      break;
    case 'SCRAP_MULTIPLIER':
      rt.modifiers.scrapMultiplier = magnitude;
      rt.modifierExpiry.scrapMultiplier = now + durationMs;
      break;
    default:
      break;
  }
}

/** Expires any modifier whose timer has run out. */
export function tickModifiers(rt: WeaponRuntime, now: number): void {
  const exp = rt.modifierExpiry;
  if (exp.damageMultiplier && now > exp.damageMultiplier) {
    rt.modifiers.damageMultiplier = 1;
    delete exp.damageMultiplier;
  }
  if (exp.fireRateMultiplier && now > exp.fireRateMultiplier) {
    rt.modifiers.fireRateMultiplier = 1;
    delete exp.fireRateMultiplier;
  }
  if (exp.speedMultiplier && now > exp.speedMultiplier) {
    rt.modifiers.speedMultiplier = 1;
    delete exp.speedMultiplier;
  }
  if (exp.magnet && now > exp.magnet) {
    rt.modifiers.magnet = false;
    delete exp.magnet;
  }
  if (exp.invulnerable && now > exp.invulnerable) {
    rt.modifiers.invulnerable = false;
    delete exp.invulnerable;
  }
  if (exp.scrapMultiplier && now > exp.scrapMultiplier) {
    rt.modifiers.scrapMultiplier = 1;
    delete exp.scrapMultiplier;
  }
}

/** Texture key for a weapon's projectile. */
export function projectileTexture(weapon: WeaponDef): string {
  switch (weapon.pattern) {
    case 'BEAM':
      return 'bullet_player_heavy';
    case 'HOMING':
      return 'missile';
    case 'MINE':
      return 'mine';
    case 'ORBITAL':
      return 'bullet_player_heavy';
    default:
      return 'bullet_player';
  }
}
