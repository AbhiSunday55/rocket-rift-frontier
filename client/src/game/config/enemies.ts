import { Rarity } from './rarity';

/**
 * Enemy archetypes. Each has a genuinely distinct AI behaviour — not just
 * different numbers stapled to the same chase loop.
 */
export type EnemyAI =
  | 'KAMIKAZE'
  | 'SNIPER'
  | 'SWARM'
  | 'TANK'
  | 'INTERCEPTOR'
  | 'SHIELD_CARRIER'
  | 'HEALER';

export interface EnemyDef {
  key: string;
  name: string;
  ai: EnemyAI;
  health: number;
  shield: number;
  damage: number;
  speed: number;
  /** Preferred engagement distance in px — drives the AI's positioning. */
  preferredRange: number;
  /** Seconds between attacks. */
  attackInterval: number;
  /** Projectile speed; 0 = contact damage only. */
  projectileSpeed: number;
  /** XP granted on kill. */
  xp: number;
  /** Scrap granted on kill. */
  scrap: number;
  /** Chance (0..1) to drop loot. */
  lootChance: number;
  /** Rarity ceiling for this enemy's drops. */
  maxDropRarity: Rarity;
  /** Visual + collision radius. */
  radius: number;
  tint: number;
  /** Behaviour tuning knobs read by the AI implementation. */
  behavior: Record<string, number>;
  /** Flavour text for the codex. */
  blurb: string;
}

export const ENEMIES: EnemyDef[] = [
  {
    key: 'kamikaze',
    name: 'Kamikaze Drone',
    ai: 'KAMIKAZE',
    health: 22,
    shield: 0,
    damage: 18,
    speed: 3.6,
    preferredRange: 0,
    attackInterval: 0,
    projectileSpeed: 0,
    xp: 8,
    scrap: 3,
    lootChance: 0.12,
    maxDropRarity: Rarity.UNCOMMON,
    radius: 14,
    tint: 0xff5d73,
    behavior: { chargeSpeed: 6.2, armDistance: 90, fuseMs: 260, blastRadius: 70 },
    blurb: 'Cheap, expendable, and entirely willing. Detonates on contact.',
  },
  {
    key: 'sniper',
    name: 'Rift Sniper',
    ai: 'SNIPER',
    health: 34,
    shield: 10,
    damage: 22,
    speed: 1.9,
    preferredRange: 520,
    attackInterval: 2.6,
    projectileSpeed: 9.5,
    xp: 14,
    scrap: 5,
    lootChance: 0.2,
    maxDropRarity: Rarity.RARE,
    radius: 16,
    tint: 0xff9f43,
    behavior: { aimTimeMs: 900, retreatSpeed: 2.6, laserSight: 1 },
    blurb: 'Holds the far edge of the sector and paints you with a targeting laser.',
  },
  {
    key: 'swarm',
    name: 'Swarmling',
    ai: 'SWARM',
    health: 12,
    shield: 0,
    damage: 6,
    speed: 4.4,
    preferredRange: 60,
    attackInterval: 0.9,
    projectileSpeed: 6.0,
    xp: 4,
    scrap: 1,
    lootChance: 0.05,
    maxDropRarity: Rarity.COMMON,
    radius: 9,
    tint: 0x9ef7ff,
    behavior: { flockRadius: 120, separation: 34, cohesion: 0.6, alignment: 0.5 },
    blurb: 'Boids-flocking swarm. Individually trivial, collectively lethal.',
  },
  {
    key: 'tank',
    name: 'Siege Hulk',
    ai: 'TANK',
    health: 220,
    shield: 60,
    damage: 26,
    speed: 1.4,
    preferredRange: 240,
    attackInterval: 3.2,
    projectileSpeed: 5.0,
    xp: 40,
    scrap: 16,
    lootChance: 0.55,
    maxDropRarity: Rarity.EPIC,
    radius: 30,
    tint: 0xb14aff,
    behavior: { volleyCount: 5, spreadDeg: 46, armorFlat: 3 },
    blurb: 'Slow siege platform. Flat armour reduces every incoming hit.',
  },
  {
    key: 'interceptor',
    name: 'Interceptor',
    ai: 'INTERCEPTOR',
    health: 48,
    shield: 20,
    damage: 12,
    speed: 5.2,
    preferredRange: 200,
    attackInterval: 1.1,
    projectileSpeed: 8.0,
    xp: 18,
    scrap: 6,
    lootChance: 0.22,
    maxDropRarity: Rarity.RARE,
    radius: 15,
    tint: 0x4fd1ff,
    behavior: { strafeBias: 0.8, leadFactor: 0.7, dashChance: 0.25 },
    blurb: 'Predictive strafer. Leads its shots and cuts across your firing line.',
  },
  {
    key: 'shield_carrier',
    name: 'Shield Carrier',
    ai: 'SHIELD_CARRIER',
    health: 90,
    shield: 140,
    damage: 10,
    speed: 2.2,
    preferredRange: 300,
    attackInterval: 2.0,
    projectileSpeed: 6.5,
    xp: 30,
    scrap: 12,
    lootChance: 0.4,
    maxDropRarity: Rarity.EPIC,
    radius: 24,
    tint: 0x5ce1e6,
    behavior: { auraRadius: 190, allyShieldPerSecond: 9, shieldRegen: 14 },
    blurb: 'Projects a shield aura over nearby allies. Kill it first, or not at all.',
  },
  {
    key: 'healer',
    name: 'Mender Drone',
    ai: 'HEALER',
    health: 60,
    shield: 30,
    damage: 4,
    speed: 3.0,
    preferredRange: 420,
    attackInterval: 1.6,
    projectileSpeed: 5.5,
    xp: 26,
    scrap: 10,
    lootChance: 0.45,
    maxDropRarity: Rarity.EPIC,
    radius: 18,
    tint: 0x3ddc97,
    behavior: { healPerSecond: 16, healRadius: 240, fleeHealthPct: 0.4 },
    blurb: 'Repairs damaged allies and flees when threatened. Priority target.',
  },
];

export const ENEMY_BY_KEY: Record<string, EnemyDef> = Object.fromEntries(ENEMIES.map((e) => [e.key, e]));

export function getEnemy(key: string): EnemyDef {
  return ENEMY_BY_KEY[key] ?? ENEMIES[0];
}

/**
 * Which archetypes can spawn in a given sector. Early sectors stay simple;
 * support archetypes (carrier/healer) only appear once the player has tools
 * to deal with them.
 */
export function spawnTableForSector(sectorIndex: number): { key: string; weight: number }[] {
  const table: { key: string; weight: number }[] = [
    { key: 'kamikaze', weight: 100 },
    { key: 'swarm', weight: sectorIndex >= 2 ? 90 : 40 },
    { key: 'sniper', weight: sectorIndex >= 2 ? 70 : 25 },
    { key: 'interceptor', weight: sectorIndex >= 3 ? 80 : 0 },
    { key: 'tank', weight: sectorIndex >= 4 ? 45 : 0 },
    { key: 'shield_carrier', weight: sectorIndex >= 6 ? 35 : 0 },
    { key: 'healer', weight: sectorIndex >= 7 ? 30 : 0 },
  ];
  return table.filter((t) => t.weight > 0);
}
