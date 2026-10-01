import { Rarity } from '../config/rarity';
import type { MissionDef, MissionProgress, MissionRewards, RunResult } from './types';

/**
 * Mission system — daily / weekly / special / seasonal.
 *
 * Missions are the primary *earned* progression channel: they are the main
 * source of Plasma, and the only source of several ship blueprints. None of them
 * require spending anything.
 */

export const MISSIONS: MissionDef[] = [
  // ── Daily ────────────────────────────────────────────────────────────────
  {
    key: 'daily_first_blood',
    name: 'First Blood',
    description: 'Destroy 40 hostiles in any sector.',
    kind: 'DAILY',
    objective: 'KILL_ENEMIES',
    target: 40,
    rewards: { xp: 300, scrap: 250, plasma: 8 },
  },
  {
    key: 'daily_salvage',
    name: 'Salvage Run',
    description: 'Collect 600 Scrap from wrecks and loot.',
    kind: 'DAILY',
    objective: 'COLLECT_SCRAP',
    target: 600,
    rewards: { xp: 250, scrap: 400, plasma: 6 },
  },
  {
    key: 'daily_sweep',
    name: 'Sector Sweep',
    description: 'Clear 3 sectors.',
    kind: 'DAILY',
    objective: 'CLEAR_SECTORS',
    target: 3,
    rewards: { xp: 400, scrap: 300, plasma: 10 },
  },
  {
    key: 'daily_ability',
    name: 'Systems Check',
    description: 'Use your ship ability 8 times.',
    kind: 'DAILY',
    objective: 'USE_ABILITY',
    target: 8,
    rewards: { xp: 200, scrap: 180, plasma: 5 },
  },

  // ── Weekly ───────────────────────────────────────────────────────────────
  {
    key: 'weekly_titan_slayer',
    name: 'Titan Slayer',
    description: 'Defeat 3 sector bosses.',
    kind: 'WEEKLY',
    objective: 'KILL_BOSSES',
    target: 3,
    rewards: {
      xp: 2500,
      scrap: 2000,
      plasma: 60,
      items: [{ itemKey: 'void_shard', rarity: Rarity.RARE, quantity: 3 }],
    },
  },
  {
    key: 'weekly_deep_run',
    name: 'Deep Run',
    description: 'Reach sector 12 in a single run.',
    kind: 'WEEKLY',
    objective: 'REACH_SECTOR',
    target: 12,
    rewards: {
      xp: 3000,
      scrap: 1500,
      plasma: 75,
      items: [{ itemKey: 'targeting_chip', rarity: Rarity.RARE, quantity: 1 }],
    },
  },
  {
    key: 'weekly_arsenal',
    name: 'Arsenal Expansion',
    description: 'Craft 5 items at the fabricator.',
    kind: 'WEEKLY',
    objective: 'CRAFT_ITEMS',
    target: 5,
    rewards: { xp: 1800, scrap: 1200, plasma: 45 },
  },
  {
    key: 'weekly_marathon',
    name: 'Endurance Trial',
    description: 'Survive 25 minutes of total combat time.',
    kind: 'WEEKLY',
    objective: 'SURVIVE_MS',
    target: 1_500_000,
    rewards: { xp: 2200, scrap: 1600, plasma: 55 },
  },

  // ── Special ──────────────────────────────────────────────────────────────
  {
    key: 'special_hoarder',
    name: 'Hoarder',
    description: 'Recover 25 pieces of loot.',
    kind: 'SPECIAL',
    objective: 'COLLECT_LOOT',
    target: 25,
    rewards: {
      xp: 1200,
      scrap: 900,
      plasma: 30,
      items: [{ itemKey: 'lucky_charm', rarity: Rarity.RARE, quantity: 1 }],
    },
  },
  {
    key: 'special_demolition',
    name: 'Demolition Derby',
    description: 'Deal 250,000 total damage.',
    kind: 'SPECIAL',
    objective: 'DEAL_DAMAGE',
    target: 250_000,
    rewards: { xp: 2000, scrap: 1400, plasma: 50 },
  },

  // ── Seasonal — Season 01: THE VOID WAR ───────────────────────────────────
  {
    key: 's01_breach',
    name: 'S01 · Breach the Rift',
    description: 'Clear 20 sectors during Season 01.',
    kind: 'SEASONAL',
    objective: 'CLEAR_SECTORS',
    target: 20,
    seasonId: 1,
    rewards: {
      xp: 5000,
      scrap: 3000,
      plasma: 120,
      riftCrystal: 10,
      items: [{ itemKey: 'skin_void', rarity: Rarity.EPIC, quantity: 1 }],
    },
  },
  {
    key: 's01_herald',
    name: 'S01 · Silence the Herald',
    description: 'Defeat the VOID TITAN 5 times.',
    kind: 'SEASONAL',
    objective: 'KILL_BOSSES',
    target: 5,
    seasonId: 1,
    rewards: {
      xp: 8000,
      scrap: 5000,
      plasma: 200,
      riftCrystal: 25,
      items: [{ itemKey: 'titan_sigil', rarity: Rarity.EPIC, quantity: 1 }],
    },
  },
  {
    key: 's01_vanguard',
    name: 'S01 · Vanguard',
    description: 'Reach sector 25 during Season 01.',
    kind: 'SEASONAL',
    objective: 'REACH_SECTOR',
    target: 25,
    seasonId: 1,
    rewards: {
      xp: 10000,
      scrap: 6000,
      plasma: 250,
      riftCrystal: 40,
      items: [{ itemKey: 'skin_gilded', rarity: Rarity.LEGENDARY, quantity: 1 }],
    },
  },
];

export const MISSION_BY_KEY: Record<string, MissionDef> = Object.fromEntries(MISSIONS.map((m) => [m.key, m]));

/**
 * Period key for a mission kind. Daily rolls at UTC midnight, weekly on Monday,
 * seasonal is fixed to the season id.
 */
export function periodKeyFor(kind: MissionDef['kind'], now = new Date(), seasonId = 1): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');

  switch (kind) {
    case 'DAILY':
      return `${y}-${m}-${d}`;
    case 'WEEKLY': {
      // ISO week number.
      const date = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
      const day = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    case 'SEASONAL':
      return `S${String(seasonId).padStart(2, '0')}`;
    case 'SPECIAL':
    default:
      return 'ALL';
  }
}

/** Builds a fresh progress list for the current period. */
export function freshMissions(now = new Date(), seasonId = 1): MissionProgress[] {
  return MISSIONS.filter((m) => !m.seasonId || m.seasonId === seasonId).map((m) => ({
    missionKey: m.key,
    progress: 0,
    target: m.target,
    completed: false,
    claimed: false,
    periodKey: periodKeyFor(m.kind, now, seasonId),
  }));
}

/**
 * Advances every mission matching `objective` by `amount`.
 * Returns the updated list plus which missions just completed.
 */
export function advanceMissions(
  progress: MissionProgress[],
  objective: MissionDef['objective'],
  amount: number,
  /** For REACH_SECTOR, progress is a high-water mark, not a sum. */
  mode: 'ADD' | 'MAX' = 'ADD'
): { progress: MissionProgress[]; completed: MissionDef[] } {
  const completed: MissionDef[] = [];
  const next = progress.map((p) => {
    const def = MISSION_BY_KEY[p.missionKey];
    if (!def || def.objective !== objective || p.completed) return p;

    const value = mode === 'MAX' ? Math.max(p.progress, amount) : p.progress + amount;
    const isComplete = value >= p.target;
    if (isComplete) completed.push(def);

    return { ...p, progress: Math.min(value, p.target), completed: isComplete };
  });
  return { progress: next, completed };
}

/** Rolls a finished run into mission progress. Returns the updated list. */
export function applyRunToMissions(
  progress: MissionProgress[],
  result: RunResult
): { progress: MissionProgress[]; completed: MissionDef[] } {
  let current = progress;
  const allCompleted: MissionDef[] = [];

  const steps: { objective: MissionDef['objective']; amount: number; mode?: 'ADD' | 'MAX' }[] = [
    { objective: 'KILL_ENEMIES', amount: result.kills },
    { objective: 'COLLECT_SCRAP', amount: result.scrapGained },
    { objective: 'COLLECT_LOOT', amount: Math.max(0, Math.round(result.lootValue / 40)) },
    { objective: 'DEAL_DAMAGE', amount: result.damageDealt },
    { objective: 'SURVIVE_MS', amount: result.durationMs },
    { objective: 'REACH_SECTOR', amount: result.sectorReached, mode: 'MAX' },
    { objective: 'CLEAR_SECTORS', amount: Math.max(0, result.sectorReached - 1) },
    { objective: 'KILL_BOSSES', amount: result.bossKilled ? 1 : 0 },
  ];

  for (const step of steps) {
    if (step.amount <= 0) continue;
    const res = advanceMissions(current, step.objective, step.amount, step.mode ?? 'ADD');
    current = res.progress;
    allCompleted.push(...res.completed);
  }

  return { progress: current, completed: allCompleted };
}

/** Merges a persisted progress list with the current period's definitions. */
export function reconcileMissions(
  stored: MissionProgress[],
  now = new Date(),
  seasonId = 1
): MissionProgress[] {
  const fresh = freshMissions(now, seasonId);
  const byKey = new Map(stored.map((p) => [`${p.missionKey}::${p.periodKey}`, p]));

  return fresh.map((f) => {
    const existing = byKey.get(`${f.missionKey}::${f.periodKey}`);
    return existing ? { ...f, ...existing, target: f.target } : f;
  });
}

/** Total rewards from a list of completed-but-unclaimed missions. */
export function sumRewards(defs: MissionDef[]): MissionRewards {
  return defs.reduce<MissionRewards>((acc, d) => {
    acc.xp = (acc.xp ?? 0) + (d.rewards.xp ?? 0);
    acc.scrap = (acc.scrap ?? 0) + (d.rewards.scrap ?? 0);
    acc.plasma = (acc.plasma ?? 0) + (d.rewards.plasma ?? 0);
    acc.riftCrystal = (acc.riftCrystal ?? 0) + (d.rewards.riftCrystal ?? 0);
    if (d.rewards.items) acc.items = [...(acc.items ?? []), ...d.rewards.items];
    return acc;
  }, {});
}
