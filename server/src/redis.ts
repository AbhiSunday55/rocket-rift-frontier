import Redis from 'ioredis';
import { config } from './config.js';

/**
 * Redis client.
 *
 * Used for: auth nonces, rate-limit counters, live session state, and the
 * pub/sub channel that fans game events out to WebSocket subscribers.
 *
 * The client is created lazily and degrades to a no-op shim when Redis is not
 * reachable, so a developer can run the API without Redis installed.
 */

let client: Redis | null = null;
let available = false;

function create(): Redis {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => (times > 5 ? null : Math.min(times * 200, 2000)),
  });

  redis.on('ready', () => {
    available = true;
    console.log('[redis] connected');
  });
  redis.on('error', (err) => {
    if (available) console.warn('[redis] error', err.message);
    available = false;
  });
  redis.on('end', () => {
    available = false;
  });

  return redis;
}

export function getRedis(): Redis {
  if (!client) client = create();
  return client;
}

export async function initRedis(): Promise<boolean> {
  const redis = getRedis();
  try {
    if (redis.status === 'wait') await redis.connect();
    await redis.ping();
    available = true;
    return true;
  } catch {
    available = false;
    console.warn('[redis] unavailable — falling back to in-memory stores');
    return false;
  }
}

export function isRedisAvailable(): boolean {
  return available;
}

/**
 * In-memory fallback so the API still works without Redis. It is intentionally
 * simple: single-process only, and it expires entries on read.
 */
const memory = new Map<string, { value: string; expiresAt: number }>();

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlSeconds: number): void {
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memoryDel(key: string): void {
  memory.delete(key);
}

/** Sets a value with a TTL, using Redis when available. */
export async function kvSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (available) {
    await getRedis().set(key, value, 'EX', ttlSeconds);
    return;
  }
  memorySet(key, value, ttlSeconds);
}

/** Gets a value, or null when missing/expired. */
export async function kvGet(key: string): Promise<string | null> {
  if (available) return getRedis().get(key);
  return memoryGet(key);
}

/** Deletes a value. */
export async function kvDel(key: string): Promise<void> {
  if (available) {
    await getRedis().del(key);
    return;
  }
  memoryDel(key);
}

/**
 * Atomically increments a counter and returns the new value. Used for rate
 * limiting and for per-session event counters.
 */
export async function kvIncr(key: string, ttlSeconds: number): Promise<number> {
  if (available) {
    const redis = getRedis();
    const value = await redis.incr(key);
    if (value === 1) await redis.expire(key, ttlSeconds);
    return value;
  }
  const current = Number(memoryGet(key) ?? '0') + 1;
  memorySet(key, String(current), ttlSeconds);
  return current;
}

/** Publishes a JSON message on a channel (no-op without Redis). */
export async function publish(channel: string, payload: unknown): Promise<void> {
  if (!available) return;
  await getRedis().publish(channel, JSON.stringify(payload));
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
    available = false;
  }
}
