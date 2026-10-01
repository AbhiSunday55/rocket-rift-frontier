import { LIMITS } from '../config/constants';
import type { RunResult, RunState } from './types';

/**
 * CLIENT-SIDE anti-cheat pre-check.
 *
 * ⚠️ This is a *courtesy* layer, not a security boundary. It exists so an honest
 * client can tell the player "this run looks invalid" before submitting, and so
 * obviously-broken runs never reach the server. The server re-runs every one of
 * these checks independently and is the only authority on rewards.
 *
 * The HMAC below is computed with a per-session key handed out by the server at
 * session start. It proves the payload was produced by *this* session — it does
 * NOT prove the numbers are honest, which is why the server also applies the
 * density/threshold checks.
 */

export interface AntiCheatVerdict {
  ok: boolean;
  reasons: string[];
}

/**
 * Score-density check: no second of play may produce more than
 * `maxScorePerSecond`. Catches the classic "set score = 999999999" edit.
 */
export function checkScoreDensity(state: RunState): AntiCheatVerdict {
  const reasons: string[] = [];
  const buckets = state.scoreBuckets;
  if (buckets.length > 0) {
    const peak = Math.max(...buckets);
    if (peak > LIMITS.maxScorePerSecond) {
      reasons.push(`score density ${peak}/s exceeds ${LIMITS.maxScorePerSecond}/s`);
    }
  }
  if (state.score > LIMITS.maxSessionScore) {
    reasons.push(`session score ${state.score} exceeds ceiling ${LIMITS.maxSessionScore}`);
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Kill-rate check: a player cannot physically kill more than
 * `maxKillsPerSecond` enemies per second, sustained.
 */
export function checkKillRate(state: RunState): AntiCheatVerdict {
  const reasons: string[] = [];
  const buckets = state.killBuckets;
  if (buckets.length > 0) {
    const peak = Math.max(...buckets);
    if (peak > LIMITS.maxKillsPerSecond) {
      reasons.push(`kill rate ${peak}/s exceeds ${LIMITS.maxKillsPerSecond}/s`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Internal-consistency check: the reported totals must agree with the sum of
 * the per-second buckets. A tampered total with untouched buckets fails here.
 */
export function checkConsistency(state: RunState): AntiCheatVerdict {
  const reasons: string[] = [];
  const bucketScore = state.scoreBuckets.reduce((a, b) => a + b, 0);
  const bucketKills = state.killBuckets.reduce((a, b) => a + b, 0);

  // Allow a small tolerance for the in-flight second.
  if (state.scoreBuckets.length > 0 && Math.abs(bucketScore - state.score) > LIMITS.maxScorePerSecond) {
    reasons.push(`score ${state.score} inconsistent with bucket sum ${bucketScore}`);
  }
  if (state.killBuckets.length > 0 && Math.abs(bucketKills - state.kills) > LIMITS.maxKillsPerSecond) {
    reasons.push(`kills ${state.kills} inconsistent with bucket sum ${bucketKills}`);
  }
  if (state.xpGained > LIMITS.maxSessionXp) {
    reasons.push(`xp ${state.xpGained} exceeds ceiling ${LIMITS.maxSessionXp}`);
  }
  if (state.damageDealt < 0 || state.damageTaken < 0 || state.lootValue < 0) {
    reasons.push('negative counters');
  }
  return { ok: reasons.length === 0, reasons };
}

/** Runs every client-side check. */
export function validateRun(state: RunState): AntiCheatVerdict {
  const verdicts = [checkScoreDensity(state), checkKillRate(state), checkConsistency(state)];
  const reasons = verdicts.flatMap((v) => v.reasons);
  return { ok: reasons.length === 0, reasons };
}

/**
 * Canonical serialisation of a run result.
 *
 * Field order is FIXED and must match the server's `canonicalizeRunResult`
 * byte-for-byte, or the HMAC will not verify. Never reorder these keys.
 */
export function canonicalizeRunResult(result: Omit<RunResult, 'signature' | 'payload' | 'clientFlagged' | 'clientFlagReason'>): string {
  return JSON.stringify({
    sessionId: result.sessionId,
    seed: result.seed,
    sectorReached: result.sectorReached,
    score: result.score,
    kills: result.kills,
    damageDealt: result.damageDealt,
    damageTaken: result.damageTaken,
    lootValue: result.lootValue,
    xpGained: result.xpGained,
    scrapGained: result.scrapGained,
    plasmaGained: result.plasmaGained,
    durationMs: result.durationMs,
    bossKilled: result.bossKilled,
  });
}

/**
 * HMAC-SHA256 over the canonical payload, using the session key.
 *
 * Uses WebCrypto when available (browsers) and falls back to a deterministic
 * non-cryptographic digest in non-secure contexts so the game still runs — the
 * server rejects unsigned/weakly-signed payloads in production either way.
 */
export async function signRunResult(payload: string, sessionKey: string): Promise<string> {
  const enc = new TextEncoder();
  const subtle = globalThis.crypto?.subtle;

  if (subtle) {
    try {
      const key = await subtle.importKey(
        'raw',
        enc.encode(sessionKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await subtle.sign('HMAC', key, enc.encode(payload));
      return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // fall through to the weak digest
    }
  }

  return weakDigest(payload + sessionKey);
}

/**
 * Non-cryptographic fallback digest (FNV-1a based). Only used when WebCrypto is
 * unavailable; the server treats such signatures as untrusted.
 */
function weakDigest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `weak_${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Builds the final, submittable run result.
 * Clamps every counter to its ceiling so a tampered client cannot even *report*
 * an impossible value — the server would reject it anyway, but this keeps the
 * failure local and legible.
 */
export async function buildRunResult(
  state: RunState,
  sessionKey: string,
  bossKilled: boolean
): Promise<RunResult> {
  const durationMs = Math.max(0, Date.now() - state.startedAt);

  const clamped = {
    sessionId: state.sessionId,
    seed: state.seed,
    sectorReached: state.sectorIndex,
    score: Math.min(state.score, LIMITS.maxSessionScore),
    kills: state.kills,
    damageDealt: state.damageDealt,
    damageTaken: state.damageTaken,
    lootValue: state.lootValue,
    xpGained: Math.min(state.xpGained, LIMITS.maxSessionXp),
    scrapGained: state.scrapGained,
    plasmaGained: state.plasmaGained,
    durationMs,
    bossKilled,
  };

  const verdict = validateRun(state);
  const payload = canonicalizeRunResult(clamped);
  const signature = await signRunResult(payload, sessionKey);

  return {
    ...clamped,
    signature,
    payload,
    clientFlagged: !verdict.ok,
    clientFlagReason: verdict.ok ? undefined : verdict.reasons.join('; '),
  };
}

/**
 * Rolling per-second buckets. Call once per second from the game loop.
 */
export class RunTracker {
  private lastScore = 0;
  private lastKills = 0;
  private lastTick = Date.now();

  constructor(private state: RunState) {}

  tick(now = Date.now()): void {
    const elapsed = now - this.lastTick;
    if (elapsed < 1000) return;

    const scoreDelta = this.state.score - this.lastScore;
    const killDelta = this.state.kills - this.lastKills;

    this.state.scoreBuckets.push(scoreDelta);
    this.state.killBuckets.push(killDelta);

    // Keep a bounded window (5 minutes) so memory stays flat on long runs.
    if (this.state.scoreBuckets.length > 300) this.state.scoreBuckets.shift();
    if (this.state.killBuckets.length > 300) this.state.killBuckets.shift();

    this.lastScore = this.state.score;
    this.lastKills = this.state.kills;
    this.lastTick = now;
  }
}
