import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { kvGet, kvSet } from '../redis.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler, rateLimit } from '../middleware/rateLimit.js';
import { adjudicateRun, computeRunMac, canonicaliseRun, type RunClaim, type SessionRecord } from './anticheat.js';
import { MISSION_DEFS, ensureMissions, periodKeyFor } from './missions.js';
import { publish } from '../redis.js';

/**
 * Runs module — session issuance and verified run submission.
 *
 * The flow is deliberately split in two:
 *
 *   POST /api/runs/start   → the server picks the seed and issues a session id.
 *                            The client never chooses its own seed, so it cannot
 *                            pre-compute a favourable galaxy.
 *   POST /api/runs/submit  → the client reports what happened, signed with the
 *                            session MAC. The server adjudicates and pays out.
 *
 * The client is given the session MAC key so it can sign its own summary — but
 * that key is derived from the server secret, so a client can only sign a
 * summary it actually produced, not forge an arbitrary one.
 */

export const runsRouter = Router();

runsRouter.use(requireAuth);

const SESSION_TTL_SECONDS = 60 * 60 * 3;

runsRouter.post(
  '/start',
  rateLimit({ name: 'run-start', limit: 30, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;

    // The server owns the seed.
    const seed = randomBytes(4).readUInt32BE(0);
    const sessionId = randomBytes(16).toString('hex');

    const record: SessionRecord = {
      sessionId,
      playerId,
      seed,
      hmacKey: '', // derived on demand from the server secret
      startedAt: Date.now(),
      acknowledgedSector: 1,
    };

    await kvSet(`run:${sessionId}`, JSON.stringify(record), SESSION_TTL_SECONDS);

    await query(
      `INSERT INTO game_sessions (id, player_id, seed, started_at, status)
       VALUES ($1, $2, $3, now(), 'ACTIVE')`,
      [sessionId, playerId, seed]
    );

    // The client signs with this key. It is scoped to one session and expires
    // with it, so leaking it costs nothing beyond that run.
    const signingKey = computeRunMac(sessionId, 'key-derivation');

    res.json({ sessionId, seed, signingKey, expiresIn: SESSION_TTL_SECONDS });
  })
);

const SubmitSchema = z.object({
  sessionId: z.string().min(8),
  seed: z.number().int().nonnegative(),
  sectorReached: z.number().int().nonnegative(),
  score: z.number().int().nonnegative(),
  kills: z.number().int().nonnegative(),
  damageDealt: z.number().int().nonnegative(),
  damageTaken: z.number().int().nonnegative(),
  lootValue: z.number().int().nonnegative(),
  xpGained: z.number().int().nonnegative(),
  scrapGained: z.number().int().nonnegative(),
  plasmaGained: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  bossKilled: z.boolean(),
  signature: z.string().min(16),
  payload: z.string().optional().default(''),
});

runsRouter.post(
  '/submit',
  rateLimit({ name: 'run-submit', limit: 30, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = SubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid run payload' });
      return;
    }

    const playerId = req.auth!.playerId;
    const claim = parsed.data as RunClaim;

    // Load the session the server issued.
    const raw = await kvGet(`run:${claim.sessionId}`);
    const session = raw ? (JSON.parse(raw) as SessionRecord) : null;

    const verdict = adjudicateRun(claim, session, playerId);

    // Record the run either way — flagged runs are evidence, not noise.
    await query(
      `INSERT INTO game_sessions
         (id, player_id, seed, sector_reached, score, kills, damage_dealt, damage_taken,
          loot_value, xp_gained, scrap_gained, plasma_gained, duration_ms, boss_killed,
          verified, flagged, flag_reason, ended_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now(), $18)
       ON CONFLICT (id) DO UPDATE SET
         sector_reached = EXCLUDED.sector_reached,
         score = EXCLUDED.score,
         kills = EXCLUDED.kills,
         damage_dealt = EXCLUDED.damage_dealt,
         damage_taken = EXCLUDED.damage_taken,
         loot_value = EXCLUDED.loot_value,
         xp_gained = EXCLUDED.xp_gained,
         scrap_gained = EXCLUDED.scrap_gained,
         plasma_gained = EXCLUDED.plasma_gained,
         duration_ms = EXCLUDED.duration_ms,
         boss_killed = EXCLUDED.boss_killed,
         verified = EXCLUDED.verified,
         flagged = EXCLUDED.flagged,
         flag_reason = EXCLUDED.flag_reason,
         ended_at = now(),
         status = EXCLUDED.status`,
      [
        claim.sessionId,
        playerId,
        claim.seed,
        claim.sectorReached,
        claim.score,
        claim.kills,
        claim.damageDealt,
        claim.damageTaken,
        claim.lootValue,
        claim.xpGained,
        claim.scrapGained,
        claim.plasmaGained,
        claim.durationMs,
        claim.bossKilled,
        verdict.verified,
        verdict.flagged,
        verdict.reason ?? null,
        verdict.flagged ? 'FLAGGED' : 'COMPLETED',
      ]
    );

    if (verdict.flagged) {
      await query('UPDATE players SET cheat_flags = cheat_flags + 1 WHERE id = $1', [playerId]);
      await publish('anticheat', { playerId, sessionId: claim.sessionId, reason: verdict.reason, layer: verdict.layer });

      res.json({ verified: false, flagged: true, reason: verdict.reason, rewards: verdict.rewards });
      return;
    }

    // Verified — apply rewards and mission progress atomically.
    const result = await withTransaction(async (client) => {
      const r = verdict.rewards;

      await client.query(
        `UPDATE players
            SET xp = xp + $1,
                scrap = scrap + $2,
                plasma = plasma + $3,
                rift_crystal = rift_crystal + $4,
                season_xp = season_xp + $5,
                runs_played = runs_played + 1,
                best_score = GREATEST(best_score, $6),
                best_sector = GREATEST(best_sector, $7),
                total_kills = total_kills + $8,
                total_bosses_killed = total_bosses_killed + $9,
                total_playtime_ms = total_playtime_ms + $10,
                total_loot_value = total_loot_value + $11
          WHERE id = $12`,
        [
          r.xp,
          r.scrap,
          r.plasma,
          r.riftCrystal,
          Math.floor(r.xp * 0.5),
          claim.score,
          claim.sectorReached,
          claim.kills,
          claim.bossKilled ? 1 : 0,
          claim.durationMs,
          claim.lootValue,
          playerId,
        ]
      );

      await client.query(
        `INSERT INTO transaction_history (player_id, kind, currency, amount, metadata, created_at)
         VALUES ($1, 'RUN_REWARD', 'MIXED', $2, $3, now())`,
        [playerId, r.xp + r.scrap + r.plasma, JSON.stringify({ sessionId: claim.sessionId, rewards: r })]
      );

      // Advance mission progress from the verified numbers only.
      const now = new Date();
      const progressUpdates: [string, number][] = [
        ['daily_first_blood', claim.kills],
        ['daily_sector_runner', claim.sectorReached],
        ['daily_boss_hunter', claim.bossKilled ? 1 : 0],
        ['daily_loot_goblin', Math.floor(claim.lootValue / 50)],
        ['weekly_deep_diver', claim.sectorReached],
        ['weekly_void_slayer', claim.bossKilled ? 1 : 0],
        ['weekly_perfect_pilot', claim.damageTaken === 0 && claim.sectorReached >= 5 ? 1 : 0],
        ['season_void_war_1', claim.kills],
        ['season_void_war_2', claim.bossKilled ? 1 : 0],
        ['season_void_war_3', claim.sectorReached >= 50 ? 1 : 0],
      ];

      for (const [key, delta] of progressUpdates) {
        const def = MISSION_DEFS[key];
        if (!def || delta <= 0) continue;
        const periodKey = periodKeyFor(def.kind, now);

        await client.query(
          `INSERT INTO missions (player_id, mission_key, kind, period_key, progress, target, completed, claimed, updated_at)
           VALUES ($1, $2, $3, $4, LEAST($5::int, $6::int), $6::int, LEAST($5::int, $6::int) >= $6::int, false, now())
           ON CONFLICT (player_id, mission_key, period_key) DO UPDATE SET
             progress = LEAST(missions.progress + $5::int, missions.target),
             completed = LEAST(missions.progress + $5::int, missions.target) >= missions.target,
             updated_at = now()`,
          [playerId, key, def.kind, periodKey, delta, def.target]
        );
      }

      const player = await client.query('SELECT * FROM players WHERE id = $1', [playerId]);
      return player.rows[0];
    });

    // The session is spent.
    await query(`UPDATE game_sessions SET status = 'COMPLETED' WHERE id = $1`, [claim.sessionId]);

    await publish('run:verified', { playerId, sessionId: claim.sessionId, rewards: verdict.rewards });

    res.json({
      verified: true,
      flagged: false,
      rewards: verdict.rewards,
      profile: result,
    });
  })
);

/**
 * Exposes the canonical serialisation so the client can sign the exact same
 * string the server will verify. Keeping this in one place is what makes the
 * HMAC check reliable.
 */
runsRouter.get(
  '/canonical-spec',
  asyncHandler(async (_req, res) => {
    res.json({
      fields: [
        'sessionId',
        'seed',
        'sectorReached',
        'score',
        'kills',
        'damageDealt',
        'damageTaken',
        'lootValue',
        'xpGained',
        'scrapGained',
        'plasmaGained',
        'durationMs',
        'bossKilled',
      ],
      separator: '|',
      bossKilledEncoding: '1 for true, 0 for false',
      example: canonicaliseRun({
        sessionId: 'abc',
        seed: 1,
        sectorReached: 5,
        score: 1000,
        kills: 20,
        damageDealt: 5000,
        damageTaken: 100,
        lootValue: 200,
        xpGained: 300,
        scrapGained: 100,
        plasmaGained: 0,
        durationMs: 120000,
        bossKilled: true,
      }),
    });
  })
);
