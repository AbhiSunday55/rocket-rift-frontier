import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Anti-cheat.
 *
 * The governing principle: **the client is never trusted**. Everything the client
 * reports is treated as a *claim*, and every claim is checked against what the
 * server knows independently.
 *
 * Four layers, applied in order:
 *
 *   1. HMAC payload verification — the run summary is signed with a per-session
 *      key the server issued at session start. A tampered payload fails the MAC.
 *   2. Structural validation — the numbers must be internally consistent
 *      (kills ≤ damage, sectors ≤ duration, etc.).
 *   3. Density checks — score/kill/XP/damage rates must be physically plausible
 *      for the elapsed time. This is what catches a client that simply reports
 *      "score: 999999999".
 *   4. Server-side ownership & balance checks — rewards are only granted for
 *      assets the server can prove the player owns, and currency spends are
 *      re-validated against the database inside a transaction.
 *
 * A flagged run is recorded but never rewarded. Repeat offenders accumulate
 * flags on their player row for review.
 */

export interface RunClaim {
  sessionId: string;
  seed: number;
  sectorReached: number;
  score: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  lootValue: number;
  xpGained: number;
  scrapGained: number;
  plasmaGained: number;
  durationMs: number;
  bossKilled: boolean;
  signature: string;
  payload: string;
}

export interface SessionRecord {
  sessionId: string;
  playerId: string;
  seed: number;
  /** Per-session HMAC key, issued at session start and never sent to the client. */
  hmacKey: string;
  startedAt: number;
  /** Highest sector the server has already acknowledged for this session. */
  acknowledgedSector: number;
}

export interface Verdict {
  verified: boolean;
  flagged: boolean;
  reason?: string;
  /** Which layer rejected the run, for logging and tuning. */
  layer?: 'hmac' | 'structure' | 'density' | 'ownership' | 'session';
  /** Rewards after clamping — always zero when flagged. */
  rewards: { xp: number; scrap: number; plasma: number; riftCrystal: number };
}

const ZERO_REWARDS = { xp: 0, scrap: 0, plasma: 0, riftCrystal: 0 };

/**
 * Layer 1 — HMAC verification.
 *
 * The client signs a canonical serialisation of the run summary with the session
 * key. We recompute it here. Any edit to any field changes the digest.
 */
export function canonicaliseRun(claim: Omit<RunClaim, 'signature' | 'payload'>): string {
  // Field order is fixed and documented — changing it is a breaking change.
  return [
    claim.sessionId,
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
    claim.bossKilled ? 1 : 0,
  ].join('|');
}

/**
 * Computes the expected MAC for a run.
 *
 * The session key is derived from the server secret and the session id, so the
 * server can recompute it without storing a per-session secret — while the
 * client still cannot forge it without the server secret.
 */
export function computeRunMac(sessionId: string, canonical: string): string {
  const key = createHmac('sha256', config.sessionHmacSecret).update(`session:${sessionId}`).digest('hex');
  return createHmac('sha256', key).update(canonical).digest('hex');
}

/** Constant-time MAC comparison. */
export function verifyRunMac(sessionId: string, canonical: string, signature: string): boolean {
  const expected = computeRunMac(sessionId, canonical);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature.replace(/^0x/, ''), 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Layer 2 — structural validation.
 *
 * Catches internally impossible reports before we even look at rates.
 */
export function validateStructure(claim: RunClaim): { ok: boolean; reason?: string } {
  const numeric: [string, number][] = [
    ['score', claim.score],
    ['kills', claim.kills],
    ['damageDealt', claim.damageDealt],
    ['damageTaken', claim.damageTaken],
    ['lootValue', claim.lootValue],
    ['xpGained', claim.xpGained],
    ['scrapGained', claim.scrapGained],
    ['plasmaGained', claim.plasmaGained],
    ['durationMs', claim.durationMs],
    ['sectorReached', claim.sectorReached],
  ];

  for (const [name, value] of numeric) {
    if (!Number.isFinite(value) || value < 0) return { ok: false, reason: `${name} is not a non-negative finite number` };
    if (!Number.isInteger(value)) return { ok: false, reason: `${name} must be an integer` };
  }

  if (claim.durationMs < config.anticheat.minRunDurationMs) {
    return { ok: false, reason: `run shorter than the ${config.anticheat.minRunDurationMs}ms minimum` };
  }

  if (claim.sectorReached > config.anticheat.maxSectorsPerRun) {
    return { ok: false, reason: `sectorReached exceeds the ${config.anticheat.maxSectorsPerRun} cap` };
  }

  // A run cannot kill more enemies than it dealt damage to, at 1 damage minimum.
  if (claim.kills > claim.damageDealt) {
    return { ok: false, reason: 'kills exceed total damage dealt' };
  }

  // Reaching a sector takes time — at least ~4s per sector even when rushing.
  const minMsForSectors = claim.sectorReached * 4_000;
  if (claim.durationMs < minMsForSectors) {
    return { ok: false, reason: `sectorReached is impossible in ${claim.durationMs}ms` };
  }

  // A boss kill implies at least one boss sector was reached.
  if (claim.bossKilled && claim.sectorReached < 5) {
    return { ok: false, reason: 'bossKilled reported before the first boss sector' };
  }

  return { ok: true };
}

/**
 * Layer 3 — density checks.
 *
 * The core anti-cheat. Every rate is compared against a ceiling derived from the
 * game's own balance numbers. A legitimate player at the theoretical maximum
 * build sits comfortably below these; a memory-edited client blows straight
 * through them.
 */
export function validateDensity(claim: RunClaim): { ok: boolean; reason?: string } {
  const seconds = claim.durationMs / 1000;
  const ac = config.anticheat;

  const checks: [string, number, number][] = [
    ['score', claim.score / seconds, ac.maxScorePerSecond],
    ['kills', claim.kills / seconds, ac.maxKillsPerSecond],
    ['xp', claim.xpGained / seconds, ac.maxXpPerSecond],
    ['damage', claim.damageDealt / seconds, ac.maxDamagePerSecond],
    ['loot value', claim.lootValue / seconds, ac.maxLootValuePerSecond],
  ];

  for (const [label, rate, ceiling] of checks) {
    if (rate > ceiling) {
      return {
        ok: false,
        reason: `${label} density ${rate.toFixed(1)}/s exceeds the ${ceiling}/s ceiling`,
      };
    }
  }

  // Rewards must be proportional to the run, not to a number the client picked.
  // XP is bounded by score; scrap by loot value; plasma is mission-gated.
  if (claim.xpGained > claim.score * 0.5 + 500) {
    return { ok: false, reason: 'xpGained is disproportionate to score' };
  }
  if (claim.scrapGained > claim.lootValue * 1.5 + 250) {
    return { ok: false, reason: 'scrapGained is disproportionate to lootValue' };
  }
  if (claim.plasmaGained > 0 && claim.sectorReached < 3) {
    return { ok: false, reason: 'plasmaGained reported before sector 3' };
  }

  return { ok: true };
}

/**
 * Layer 4 — session validation.
 *
 * The session must exist, belong to this player, and the reported seed must
 * match the one the server issued. A client cannot invent a session.
 */
export function validateSession(
  claim: RunClaim,
  session: SessionRecord | null,
  playerId: string
): { ok: boolean; reason?: string } {
  if (!session) return { ok: false, reason: 'unknown or expired session' };
  if (session.playerId !== playerId) return { ok: false, reason: 'session belongs to another player' };
  if (session.seed !== claim.seed) return { ok: false, reason: 'seed does not match the issued session' };
  if (claim.sectorReached < session.acknowledgedSector) {
    return { ok: false, reason: 'sectorReached regressed below the acknowledged sector' };
  }
  return { ok: true };
}

/**
 * Runs every layer and produces a verdict.
 *
 * Rewards are computed only for a fully verified run, and are clamped to the
 * density ceilings so even a borderline run cannot over-reward.
 */
export function adjudicateRun(
  claim: RunClaim,
  session: SessionRecord | null,
  playerId: string
): Verdict {
  const canonical = canonicaliseRun(claim);

  if (!verifyRunMac(claim.sessionId, canonical, claim.signature)) {
    return { verified: false, flagged: true, reason: 'payload signature mismatch', layer: 'hmac', rewards: ZERO_REWARDS };
  }

  const sessionCheck = validateSession(claim, session, playerId);
  if (!sessionCheck.ok) {
    return { verified: false, flagged: true, reason: sessionCheck.reason, layer: 'session', rewards: ZERO_REWARDS };
  }

  const structure = validateStructure(claim);
  if (!structure.ok) {
    return { verified: false, flagged: true, reason: structure.reason, layer: 'structure', rewards: ZERO_REWARDS };
  }

  const density = validateDensity(claim);
  if (!density.ok) {
    return { verified: false, flagged: true, reason: density.reason, layer: 'density', rewards: ZERO_REWARDS };
  }

  // Verified. Clamp rewards to the ceilings so a run that squeaked past the
  // density check still cannot pay out more than the ceiling allows.
  const seconds = claim.durationMs / 1000;
  const ac = config.anticheat;

  const xp = Math.min(claim.xpGained, Math.floor(ac.maxXpPerSecond * seconds));
  const scrap = Math.min(claim.scrapGained, Math.floor(ac.maxLootValuePerSecond * seconds));
  const plasma = Math.min(claim.plasmaGained, Math.floor(seconds / 60) * 5);

  // Rift Crystals are the seasonal currency: only bosses pay them out.
  const riftCrystal = claim.bossKilled ? 1 + Math.floor(claim.sectorReached / 25) : 0;

  return { verified: true, flagged: false, rewards: { xp, scrap, plasma, riftCrystal } };
}

/**
 * Server-side ownership check helper.
 *
 * Used by the marketplace and trading modules: an asset may only be listed or
 * traded if the database says this player owns it, and it is not already
 * escrowed. The client's opinion is irrelevant.
 */
export function assertOwnership(ownerId: string | null, playerId: string, state: string): { ok: boolean; reason?: string } {
  if (!ownerId) return { ok: false, reason: 'asset not found' };
  if (ownerId !== playerId) return { ok: false, reason: 'you do not own this asset' };
  if (state === 'LOCKED') return { ok: false, reason: 'asset is locked to your account' };
  if (state === 'LISTED') return { ok: false, reason: 'asset is already listed' };
  return { ok: true };
}

/**
 * Server-side balance check helper.
 *
 * Currency spends are validated against the database value, never the client's.
 */
export function assertBalance(balance: number, cost: number, currency: string): { ok: boolean; reason?: string } {
  if (!Number.isFinite(cost) || cost < 0) return { ok: false, reason: 'invalid cost' };
  if (balance < cost) return { ok: false, reason: `insufficient ${currency}` };
  return { ok: true };
}
