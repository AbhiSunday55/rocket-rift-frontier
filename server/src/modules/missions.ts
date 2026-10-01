import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler, rateLimit } from '../middleware/rateLimit.js';

/**
 * Missions module.
 *
 * Mission progress is tracked server-side from verified run results. The client
 * may display progress, but claiming a reward re-checks completion against the
 * database — a client cannot claim a mission it has not finished.
 */

export const missionsRouter = Router();

missionsRouter.use(requireAuth);

interface MissionRow {
  id: string;
  player_id: string;
  mission_key: string;
  kind: string;
  period_key: string;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
  updated_at: Date;
}

function toMission(row: MissionRow) {
  return {
    missionKey: row.mission_key,
    kind: row.kind,
    periodKey: row.period_key,
    progress: row.progress,
    target: row.target,
    completed: row.completed,
    claimed: row.claimed,
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

/**
 * Mission definitions.
 *
 * Kept server-side so the client cannot invent a mission with a huge reward.
 * The client ships a mirror of this for offline play; the server's copy is the
 * one that pays out.
 */
export const MISSION_DEFS: Record<
  string,
  { kind: string; target: number; rewards: { xp?: number; scrap?: number; plasma?: number; riftCrystal?: number } }
> = {
  daily_first_blood: { kind: 'DAILY', target: 25, rewards: { xp: 150, scrap: 60 } },
  daily_sector_runner: { kind: 'DAILY', target: 3, rewards: { xp: 200, scrap: 80 } },
  daily_boss_hunter: { kind: 'DAILY', target: 1, rewards: { xp: 400, scrap: 150, plasma: 5 } },
  daily_loot_goblin: { kind: 'DAILY', target: 15, rewards: { xp: 180, scrap: 120 } },
  weekly_deep_diver: { kind: 'WEEKLY', target: 15, rewards: { xp: 1200, scrap: 500, plasma: 25 } },
  weekly_void_slayer: { kind: 'WEEKLY', target: 5, rewards: { xp: 1500, scrap: 600, plasma: 30 } },
  weekly_perfect_pilot: { kind: 'WEEKLY', target: 1, rewards: { xp: 2000, scrap: 800, plasma: 40 } },
  special_black_hole: { kind: 'SPECIAL', target: 1, rewards: { xp: 800, scrap: 300, plasma: 15 } },
  special_station_defense: { kind: 'SPECIAL', target: 1, rewards: { xp: 900, scrap: 350, plasma: 20 } },
  season_void_war_1: { kind: 'SEASONAL', target: 50, rewards: { xp: 5000, scrap: 2000, plasma: 100, riftCrystal: 5 } },
  season_void_war_2: { kind: 'SEASONAL', target: 10, rewards: { xp: 8000, scrap: 3000, plasma: 150, riftCrystal: 10 } },
  season_void_war_3: { kind: 'SEASONAL', target: 1, rewards: { xp: 15000, scrap: 5000, plasma: 250, riftCrystal: 25 } },
};

/** Computes the current period key for a mission kind. */
export function periodKeyFor(kind: string, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');

  if (kind === 'DAILY') return `${y}-${m}-${d}`;
  if (kind === 'WEEKLY') {
    // ISO week number.
    const date = new Date(Date.UTC(y, now.getUTCMonth(), now.getUTCDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  if (kind === 'SEASONAL') return 'S01';
  return 'PERMANENT';
}

/**
 * Ensures the player has a row for every mission in the current period, and
 * rolls over rows whose period has expired.
 */
export async function ensureMissions(playerId: string): Promise<MissionRow[]> {
  const now = new Date();

  for (const [key, def] of Object.entries(MISSION_DEFS)) {
    const periodKey = periodKeyFor(def.kind, now);
    await query(
      `INSERT INTO missions (player_id, mission_key, kind, period_key, progress, target, completed, claimed, updated_at)
       VALUES ($1, $2, $3, $4, 0, $5, false, false, now())
       ON CONFLICT (player_id, mission_key, period_key) DO NOTHING`,
      [playerId, key, def.kind, periodKey, def.target]
    );
  }

  const rows = await query<MissionRow>(
    `SELECT * FROM missions
      WHERE player_id = $1
        AND (kind = 'SEASONAL' OR period_key = $2 OR period_key = $3 OR period_key = $4)
      ORDER BY kind, mission_key`,
    [playerId, periodKeyFor('DAILY', now), periodKeyFor('WEEKLY', now), periodKeyFor('SPECIAL', now)]
  );

  return rows.rows;
}

missionsRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const rows = await ensureMissions(req.auth!.playerId);
    res.json({ missions: rows.map(toMission) });
  })
);

missionsRouter.post(
  '/:key/claim',
  rateLimit({ name: 'mission-claim', limit: 60, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const missionKey = req.params.key;

    const def = MISSION_DEFS[missionKey];
    if (!def) {
      res.status(404).json({ error: 'Unknown mission' });
      return;
    }

    const result = await withTransaction(async (client) => {
      const found = await client.query<MissionRow>(
        `SELECT * FROM missions
          WHERE player_id = $1 AND mission_key = $2 AND period_key = $3
          FOR UPDATE`,
        [playerId, missionKey, periodKeyFor(def.kind)]
      );

      const mission = found.rows[0];
      if (!mission) return { error: 'Mission not found for this period' };
      if (!mission.completed) return { error: 'Mission is not complete' };
      if (mission.claimed) return { error: 'Reward already claimed' };

      // Re-verify completion against the stored progress — never trust the flag alone.
      if (mission.progress < mission.target) return { error: 'Progress does not meet the target' };

      await client.query('UPDATE missions SET claimed = true, updated_at = now() WHERE id = $1', [mission.id]);

      const r = def.rewards;
      await client.query(
        `UPDATE players
            SET xp = xp + $1,
                scrap = scrap + $2,
                plasma = plasma + $3,
                rift_crystal = rift_crystal + $4,
                season_xp = season_xp + $5
          WHERE id = $6`,
        [r.xp ?? 0, r.scrap ?? 0, r.plasma ?? 0, r.riftCrystal ?? 0, Math.floor((r.xp ?? 0) * 0.5), playerId]
      );

      await client.query(
        `INSERT INTO transaction_history (player_id, kind, currency, amount, metadata, created_at)
         VALUES ($1, 'MISSION_REWARD', 'MIXED', $2, $3, now())`,
        [playerId, (r.xp ?? 0) + (r.scrap ?? 0) + (r.plasma ?? 0), JSON.stringify({ missionKey, rewards: r })]
      );

      const player = await client.query('SELECT * FROM players WHERE id = $1', [playerId]);
      const missions = await client.query<MissionRow>(
        `SELECT * FROM missions WHERE player_id = $1 ORDER BY kind, mission_key`,
        [playerId]
      );

      return { player: player.rows[0], missions: missions.rows.map(toMission) };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ profile: result.player, missions: result.missions });
  })
);
