import 'dotenv/config';

/**
 * Server configuration.
 *
 * Every secret is read from the environment with a safe development default, so
 * the stack boots locally with zero setup while still refusing to run in
 * production with placeholder secrets.
 */

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProd = NODE_ENV === 'production';

const DEV_JWT_SECRET = 'dev-only-jwt-secret-change-me';
const DEV_SESSION_SECRET = 'dev-only-session-hmac-secret-change-me';

if (isProd) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be set in production');
  if (!process.env.SESSION_HMAC_SECRET) throw new Error('SESSION_HMAC_SECRET must be set in production');
}

export const config = {
  env: NODE_ENV,
  isProd,
  port: Number(process.env.PORT ?? 4000),

  databaseUrl: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/rocket_rift'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',

  jwtSecret: process.env.JWT_SECRET ?? DEV_JWT_SECRET,
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 60 * 60 * 12),

  /**
   * HMAC key used to sign run payloads. The client signs its run summary with a
   * key issued at session start; the server re-computes the HMAC and rejects any
   * payload that does not match. This is the first line of anti-cheat.
   */
  sessionHmacSecret: process.env.SESSION_HMAC_SECRET ?? DEV_SESSION_SECRET,

  /** Nonce lifetime for wallet auth, in seconds. */
  nonceTtlSeconds: Number(process.env.NONCE_TTL_SECONDS ?? 300),

  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  chainId: Number(process.env.CHAIN_ID ?? 11155111),

  contracts: {
    shipNft: process.env.SHIP_NFT_ADDRESS ?? '',
    itemNft: process.env.ITEM_NFT_ADDRESS ?? '',
    marketplace: process.env.MARKETPLACE_ADDRESS ?? '',
  },

  marketplaceFeeBps: Number(process.env.MARKETPLACE_FEE_BPS ?? 250),

  /** Anti-cheat thresholds — see modules/anticheat.ts for how they are applied. */
  anticheat: {
    /** Max score per second of play. Above this, a run is flagged. */
    maxScorePerSecond: Number(process.env.AC_MAX_SCORE_PER_SECOND ?? 900),
    /** Max kills per second. */
    maxKillsPerSecond: Number(process.env.AC_MAX_KILLS_PER_SECOND ?? 6),
    /** Max XP per second. */
    maxXpPerSecond: Number(process.env.AC_MAX_XP_PER_SECOND ?? 120),
    /** Max damage dealt per second. */
    maxDamagePerSecond: Number(process.env.AC_MAX_DAMAGE_PER_SECOND ?? 4000),
    /** Minimum plausible run duration, in ms. */
    minRunDurationMs: Number(process.env.AC_MIN_RUN_DURATION_MS ?? 15_000),
    /** Max sectors a single run may report. */
    maxSectorsPerRun: Number(process.env.AC_MAX_SECTORS_PER_RUN ?? 200),
    /** Max loot value per second. */
    maxLootValuePerSecond: Number(process.env.AC_MAX_LOOT_PER_SECOND ?? 500),
  },
} as const;

export type Config = typeof config;
