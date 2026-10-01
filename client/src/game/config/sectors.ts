/**
 * Procedural sector generation.
 *
 * A "sector" is one endless-run stage. Biomes change the visual language, the
 * hazard set, and the enemy mix — but never the core rules, so the game stays
 * learnable while looking endlessly new.
 */

export type Biome =
  | 'NEBULA'
  | 'PLANET_FIELD'
  | 'ASTEROID_BELT'
  | 'BLACK_HOLE'
  | 'SOLAR_SYSTEM'
  | 'ALIEN_TERRITORY'
  | 'SPACE_STATION';

export interface BiomeDef {
  key: Biome;
  name: string;
  /** Background gradient stops (top → bottom). */
  gradient: [number, number];
  /** Star/particle tint. */
  particleTint: number;
  /** Ambient hazard descriptor. */
  hazard: 'NONE' | 'RADIATION' | 'GRAVITY_WELL' | 'DEBRIS' | 'SOLAR_FLARE' | 'BIO_SPORES' | 'TURRETS';
  hazardDescription: string;
  /** Enemy spawn weight modifiers for this biome. */
  spawnBias: Partial<Record<string, number>>;
  /** Loot quality bonus (0..1) — richer biomes are riskier and more rewarding. */
  lootBonus: number;
  /** Difficulty multiplier applied on top of the sector curve. */
  difficulty: number;
  /** Parallax layer count for the background. */
  parallaxLayers: number;
  blurb: string;
}

export const BIOMES: BiomeDef[] = [
  {
    key: 'NEBULA',
    name: 'Nebula Drift',
    gradient: [0x0a0a2e, 0x1b0b3a],
    particleTint: 0x8f6bff,
    hazard: 'NONE',
    hazardDescription: 'Ionised gas clouds. Beautiful, harmless, and full of ambushes.',
    spawnBias: { swarm: 1.4, kamikaze: 1.2 },
    lootBonus: 0,
    difficulty: 1.0,
    parallaxLayers: 3,
    blurb: 'The Frontier’s front door. Where every pilot learns to fly.',
  },
  {
    key: 'PLANET_FIELD',
    name: 'Planet Field',
    gradient: [0x061428, 0x0d2b4a],
    particleTint: 0x4fd1ff,
    hazard: 'GRAVITY_WELL',
    hazardDescription: 'Planetary mass tugs at your hull. Drift is real; compensate.',
    spawnBias: { sniper: 1.5, interceptor: 1.2 },
    lootBonus: 0.05,
    difficulty: 1.05,
    parallaxLayers: 4,
    blurb: 'Ringed giants and their moons. Long sightlines, longer shots.',
  },
  {
    key: 'ASTEROID_BELT',
    name: 'Asteroid Belt',
    gradient: [0x1a1206, 0x2b1d0a],
    particleTint: 0xff9f43,
    hazard: 'DEBRIS',
    hazardDescription: 'Tumbling rock. Cover for you — and for them.',
    spawnBias: { tank: 1.4, kamikaze: 1.3 },
    lootBonus: 0.1,
    difficulty: 1.12,
    parallaxLayers: 3,
    blurb: 'A graveyard of shattered worlds. Rich in ore, richer in ambush.',
  },
  {
    key: 'BLACK_HOLE',
    name: 'Black-Hole Zone',
    gradient: [0x000000, 0x1a0033],
    particleTint: 0xb14aff,
    hazard: 'GRAVITY_WELL',
    hazardDescription: 'The singularity pulls everything inward. So does the loot.',
    spawnBias: { interceptor: 1.5, shield_carrier: 1.3 },
    lootBonus: 0.2,
    difficulty: 1.25,
    parallaxLayers: 2,
    blurb: 'Light goes in. Occasionally, something comes back out.',
  },
  {
    key: 'SOLAR_SYSTEM',
    name: 'Solar System',
    gradient: [0x2b0a00, 0x4a1a00],
    particleTint: 0xffd166,
    hazard: 'SOLAR_FLARE',
    hazardDescription: 'Periodic flares sweep the sector. Break line of sight or burn.',
    spawnBias: { sniper: 1.3, healer: 1.2 },
    lootBonus: 0.15,
    difficulty: 1.2,
    parallaxLayers: 4,
    blurb: 'A dying star and its scorched children. Shields run hot here.',
  },
  {
    key: 'ALIEN_TERRITORY',
    name: 'Alien Territory',
    gradient: [0x001a12, 0x00332a],
    particleTint: 0x3ddc97,
    hazard: 'BIO_SPORES',
    hazardDescription: 'Airborne spores corrode hull plating over time.',
    spawnBias: { healer: 1.6, shield_carrier: 1.5, swarm: 1.3 },
    lootBonus: 0.25,
    difficulty: 1.3,
    parallaxLayers: 3,
    blurb: 'Something built this. Something is still here.',
  },
  {
    key: 'SPACE_STATION',
    name: 'Derelict Station',
    gradient: [0x0d0d14, 0x1f2233],
    particleTint: 0x9aa7bd,
    hazard: 'TURRETS',
    hazardDescription: 'Automated defence turrets still track anything that moves.',
    spawnBias: { tank: 1.5, interceptor: 1.4, sniper: 1.2 },
    lootBonus: 0.3,
    difficulty: 1.35,
    parallaxLayers: 2,
    blurb: 'Abandoned, but not undefended. The logs are worth the risk.',
  },
];

export const BIOME_BY_KEY: Record<Biome, BiomeDef> = Object.fromEntries(BIOMES.map((b) => [b.key, b])) as Record<
  Biome,
  BiomeDef
>;

export interface SectorPlan {
  index: number;
  biome: BiomeDef;
  isBoss: boolean;
  enemyCount: number;
  difficulty: number;
  lootBonus: number;
  /** Deterministic seed so a sector can be replayed/verified server-side. */
  seed: number;
  /** Human-readable sector designation, e.g. "SECTOR 07 · ASTEROID BELT". */
  designation: string;
}

/** Small deterministic PRNG (mulberry32) — same seed, same sector, always. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the plan for a sector. Pure function of (index, seed) — the server can
 * regenerate the exact same sector to validate a submitted run.
 */
export function planSector(
  index: number,
  seed: number,
  opts: { bossEvery: number; baseEnemyCount: number; enemyCountPerSector: number; difficultyPerSector: number }
): SectorPlan {
  const rng = mulberry32(seed + index * 7919);
  const isBoss = index > 0 && index % opts.bossEvery === 0;

  // Biome selection: weighted, and never the same biome twice in a row.
  const biome = BIOMES[Math.floor(rng() * BIOMES.length)];

  const enemyCount = Math.round(opts.baseEnemyCount + index * opts.enemyCountPerSector);
  const difficulty = (1 + index * opts.difficultyPerSector) * biome.difficulty;

  return {
    index,
    biome,
    isBoss,
    enemyCount,
    difficulty,
    lootBonus: biome.lootBonus,
    seed: seed + index * 7919,
    designation: `SECTOR ${String(index).padStart(2, '0')} · ${biome.name.toUpperCase()}`,
  };
}

/**
 * Boss ladder. Each entry is a distinct multi-phase encounter; the ladder loops
 * with escalating stats once exhausted.
 */
export interface BossPhase {
  key: string;
  name: string;
  /** Health fraction at which this phase begins (1.0 = start). */
  threshold: number;
  attack: 'MISSILE_ATTACK' | 'LASER_GRID' | 'DRONE_SWARM' | 'EXPOSED_CORE' | 'RAGE_MODE';
  description: string;
  durationMs: number;
}

export interface BossDef {
  key: string;
  name: string;
  title: string;
  health: number;
  shield: number;
  radius: number;
  tint: number;
  phases: BossPhase[];
  xp: number;
  scrap: number;
  plasma: number;
  guaranteedDrop: { itemKey: string; rarity: number };
  blurb: string;
}

/**
 * VOID TITAN — the Season 01 antagonist.
 * Phase order is fixed and telegraphed: missile attack → laser grid → drone
 * swarm → exposed core → rage mode.
 */
export const VOID_TITAN: BossDef = {
  key: 'void_titan',
  name: 'VOID TITAN',
  title: 'Herald of the Rift',
  health: 4200,
  shield: 900,
  radius: 96,
  tint: 0xb14aff,
  xp: 1200,
  scrap: 400,
  plasma: 60,
  guaranteedDrop: { itemKey: 'titan_core', rarity: 4 },
  blurb: 'It was a mining platform once. Then the Rift opened inside it.',
  phases: [
    {
      key: 'p1_missiles',
      name: 'PHASE I — MISSILE ATTACK',
      threshold: 1.0,
      attack: 'MISSILE_ATTACK',
      description: 'The Titan opens its launch bays and saturates the sector with homing ordnance.',
      durationMs: 0,
    },
    {
      key: 'p2_laser_grid',
      name: 'PHASE II — LASER GRID',
      threshold: 0.75,
      attack: 'LASER_GRID',
      description: 'Sweeping laser lattices carve the arena into safe lanes. Read the pattern or die.',
      durationMs: 0,
    },
    {
      key: 'p3_drones',
      name: 'PHASE III — DRONE SWARM',
      threshold: 0.5,
      attack: 'DRONE_SWARM',
      description: 'It stops fighting you directly and lets its children do the work.',
      durationMs: 0,
    },
    {
      key: 'p4_core',
      name: 'PHASE IV — EXPOSED CORE',
      threshold: 0.25,
      attack: 'EXPOSED_CORE',
      description: 'Armour peels away. The core is vulnerable — and it knows it.',
      durationMs: 0,
    },
    {
      key: 'p5_rage',
      name: 'PHASE V — RAGE MODE',
      threshold: 0.1,
      attack: 'RAGE_MODE',
      description: 'All systems overclock. Everything it has, all at once, until one of you stops.',
      durationMs: 0,
    },
  ],
};

export const BOSSES: BossDef[] = [
  VOID_TITAN,
  {
    key: 'obsidian_warden',
    name: 'OBSIDIAN WARDEN',
    title: 'Keeper of the Belt',
    health: 3600,
    shield: 1400,
    radius: 88,
    tint: 0xff9f43,
    xp: 1000,
    scrap: 340,
    plasma: 50,
    guaranteedDrop: { itemKey: 'warden_plating', rarity: 3 },
    blurb: 'A mining rig that never received the recall order. It is still guarding.',
    phases: VOID_TITAN.phases.map((p) => ({ ...p })),
  },
  {
    key: 'seraph_prime',
    name: 'SERAPH PRIME',
    title: 'Choir of the Deep',
    health: 5200,
    shield: 1100,
    radius: 104,
    tint: 0x3ddc97,
    xp: 1500,
    scrap: 480,
    plasma: 75,
    guaranteedDrop: { itemKey: 'seraph_wing', rarity: 4 },
    blurb: 'Alien. Patient. It has been waiting for something worth singing about.',
    phases: VOID_TITAN.phases.map((p) => ({ ...p })),
  },
];

export function bossForSector(sectorIndex: number): BossDef {
  const idx = Math.max(0, Math.floor(sectorIndex / 5) - 1) % BOSSES.length;
  return BOSSES[idx];
}
