import { CSS_COLORS } from './constants';

/** Rarity ladder. Index order matters — it is the on-chain `uint8 rarity`. */
export enum Rarity {
  COMMON = 0,
  UNCOMMON = 1,
  RARE = 2,
  EPIC = 3,
  LEGENDARY = 4,
  MYTHIC = 5,
}

export const RARITY_ORDER: Rarity[] = [
  Rarity.COMMON,
  Rarity.UNCOMMON,
  Rarity.RARE,
  Rarity.EPIC,
  Rarity.LEGENDARY,
  Rarity.MYTHIC,
];

export interface RarityMeta {
  key: Rarity;
  name: string;
  /** Hex tint used by Phaser (number) and CSS (string). */
  tint: number;
  css: string;
  /** Multiplier applied to a base stat roll. */
  statMultiplier: number;
  /** Relative drop weight — lower is rarer. */
  weight: number;
  /** Scrap value when dismantled, before item-specific modifiers. */
  dismantleValue: number;
}

export const RARITY: Record<Rarity, RarityMeta> = {
  [Rarity.COMMON]: {
    key: Rarity.COMMON,
    name: 'COMMON',
    tint: 0x9aa7bd,
    css: '#9aa7bd',
    statMultiplier: 1.0,
    weight: 1000,
    dismantleValue: 8,
  },
  [Rarity.UNCOMMON]: {
    key: Rarity.UNCOMMON,
    name: 'UNCOMMON',
    tint: 0x3ddc97,
    css: '#3ddc97',
    statMultiplier: 1.18,
    weight: 480,
    dismantleValue: 20,
  },
  [Rarity.RARE]: {
    key: Rarity.RARE,
    name: 'RARE',
    tint: 0x4fd1ff,
    css: '#4fd1ff',
    statMultiplier: 1.42,
    weight: 190,
    dismantleValue: 55,
  },
  [Rarity.EPIC]: {
    key: Rarity.EPIC,
    name: 'EPIC',
    tint: 0xb14aff,
    css: '#b14aff',
    statMultiplier: 1.75,
    weight: 62,
    dismantleValue: 140,
  },
  [Rarity.LEGENDARY]: {
    key: Rarity.LEGENDARY,
    name: 'LEGENDARY',
    tint: 0xffd166,
    css: '#ffd166',
    statMultiplier: 2.2,
    weight: 16,
    dismantleValue: 380,
  },
  [Rarity.MYTHIC]: {
    key: Rarity.MYTHIC,
    name: 'MYTHIC',
    tint: 0xff2e63,
    css: '#ff2e63',
    statMultiplier: 2.9,
    weight: 3,
    dismantleValue: 900,
  },
};

/** Weighted roll. `luck` (0..1) shifts weight toward the top of the ladder. */
export function rollRarity(luck = 0, rng: () => number = Math.random): Rarity {
  const entries = RARITY_ORDER.map((r) => {
    const meta = RARITY[r];
    // Luck only ever *helps*: it boosts rare weights, never suppresses commons.
    const boost = 1 + luck * (meta.key / Rarity.MYTHIC) * 2.5;
    return { r, w: meta.weight * boost };
  });
  const total = entries.reduce((sum, e) => sum + e.w, 0);
  let roll = rng() * total;
  for (const e of entries) {
    roll -= e.w;
    if (roll <= 0) return e.r;
  }
  return Rarity.COMMON;
}

export function rarityName(r: Rarity): string {
  return RARITY[r]?.name ?? 'COMMON';
}

export function rarityCss(r: Rarity): string {
  return RARITY[r]?.css ?? CSS_COLORS.textDim;
}

export function rarityTint(r: Rarity): number {
  return RARITY[r]?.tint ?? 0x9aa7bd;
}

/** Rarity is a *cosmetic + sidegrade* axis. It never gates content. */
export function rarityStatMultiplier(r: Rarity): number {
  return RARITY[r]?.statMultiplier ?? 1;
}
