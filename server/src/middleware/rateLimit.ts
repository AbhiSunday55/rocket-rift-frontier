import type { Request, Response, NextFunction } from 'express';
import { kvIncr } from '../redis.js';

/**
 * Rate limiting.
 *
 * Backed by Redis when available so limits hold across processes; falls back to
 * the in-memory counter otherwise. Keyed by authenticated player when we have
 * one, and by IP otherwise.
 */

export function rateLimit(opts: { name: string; limit: number; windowSeconds: number }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = (req as Request & { auth?: { playerId: string } }).auth;
    const identity = auth?.playerId ?? req.ip ?? 'unknown';
    const key = `rl:${opts.name}:${identity}`;

    try {
      const count = await kvIncr(key, opts.windowSeconds);
      res.setHeader('X-RateLimit-Limit', String(opts.limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, opts.limit - count)));

      if (count > opts.limit) {
        res.status(429).json({ error: 'Too many requests — slow down.' });
        return;
      }
    } catch {
      // Never let a limiter outage take the API down.
    }

    next();
  };
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
