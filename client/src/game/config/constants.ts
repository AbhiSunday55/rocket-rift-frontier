/**
 * Global tuning constants for ROCKET RIFT: FRONTIER.
 *
 * Everything the balance team touches lives here or in a sibling config file —
 * scenes and systems never hard-code magic numbers.
 */

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const WORLD = {
  /** Playfield is wider than the viewport; the camera follows the player. */
  width: 2400,
  height: 1600,
  /** Distance from the world edge the player cannot cross. */
  margin: 60,
} as const;

export const SCENE_KEYS = {
  BOOT: 'BootScene',
  MENU: 'MenuScene',
  GAME: 'GameScene',
  BOSS: 'BossScene',
  GAME_OVER: 'GameOverScene',
} as const;

export const STORAGE_KEYS = {
  SAVE: 'rrf.save.v1',
  SETTINGS: 'rrf.settings.v1',
  SESSION: 'rrf.session.v1',
} as const;

export const COLORS = {
  bg: 0x05060f,
  bgDeep: 0x02030a,
  grid: 0x1b2a4a,
  player: 0x4fd1ff,
  playerAccent: 0xffd166,
  bullet: 0x9ef7ff,
  enemy: 0xff5d73,
  enemyAlt: 0xff9f43,
  boss: 0xb14aff,
  shield: 0x5ce1e6,
  loot: 0xffe066,
  danger: 0xff2e63,
  ok: 0x3ddc97,
  text: 0xe8f1ff,
  textDim: 0x8fa3c8,
} as const;

export const CSS_COLORS = {
  bg: '#05060f',
  panel: '#0b1020',
  panelAlt: '#111a33',
  border: '#1e2b4d',
  accent: '#4fd1ff',
  accent2: '#b14aff',
  gold: '#ffd166',
  text: '#e8f1ff',
  textDim: '#8fa3c8',
  danger: '#ff2e63',
  ok: '#3ddc97',
} as const;

/**
 * Anti-cheat / server-authority ceilings. The client clamps to these so a
 * tampered client cannot even *report* an impossible run; the server re-checks
 * independently and is the only source of truth for rewards.
 */
export const LIMITS = {
  /** Max score a single second of play may produce (score-density check). */
  maxScorePerSecond: 900,
  /** Max kills a single second of play may produce (kill-rate check). */
  maxKillsPerSecond: 6,
  /** Hard ceiling on a single session's score. */
  maxSessionScore: 5_000_000,
  /** Max XP a single session may grant. */
  maxSessionXp: 250_000,
  /** Sessions shorter than this are discarded as noise. */
  minSessionMs: 5_000,
} as const;

export const ECONOMY = {
  /** Scrap is the soft currency — earned constantly, spent on common upgrades. */
  scrapPerKill: 3,
  scrapPerLoot: 12,
  /** Plasma is the mid-tier currency — missions, dismantling, rare crafting. */
  plasmaPerBoss: 25,
  plasmaPerMission: 10,
  /** Rift Crystals are premium — bought OR earned slowly from seasonal play. */
  riftCrystalPerSeasonTier: 5,
  /** Dismantle returns a fraction of an item's craft cost. */
  dismantleReturnRatio: 0.4,
} as const;

export const PROGRESSION = {
  /** XP required for level N is base * N^exponent, rounded. */
  xpBase: 120,
  xpExponent: 1.45,
  maxLevel: 60,
  /** Stat growth applied per ship level. */
  perLevel: {
    health: 0.06,
    shield: 0.05,
    damage: 0.05,
    speed: 0.01,
    fireRate: 0.02,
  },
} as const;

export const COMBAT = {
  /** Invulnerability window after taking a hit (ms). */
  hitInvulnMs: 700,
  /** Dash duration + cooldown (ms). */
  dashMs: 220,
  dashCooldownMs: 2600,
  dashSpeedMultiplier: 3.4,
  /** Special ability cooldown (ms). */
  abilityCooldownMs: 9000,
  /** Shield regenerates after this long without taking damage (ms). */
  shieldRegenDelayMs: 4000,
  shieldRegenPerSecond: 6,
  /** Crit damage multiplier. */
  critMultiplier: 2.0,
  /** Pickup magnet radius (px). */
  magnetRadius: 130,
} as const;

export const SECTOR = {
  /** Kills required to clear a normal sector. */
  killsToClear: 18,
  /** Every Nth sector is a boss sector. */
  bossEvery: 5,
  /** Enemy count scales with sector index. */
  baseEnemyCount: 6,
  enemyCountPerSector: 0.8,
  maxEnemiesAlive: 26,
  /** Difficulty multiplier applied per sector. */
  difficultyPerSector: 0.11,
} as const;

export const RENDER = {
  /** Depth layers — keeps draw order deterministic across scenes. */
  depth: {
    background: 0,
    parallax: 5,
    loot: 10,
    enemy: 20,
    player: 30,
    bullet: 40,
    fx: 50,
    hud: 100,
    overlay: 200,
  },
} as const;
