import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * Authentication middleware.
 *
 * The JWT is issued only after a wallet signature has been verified against a
 * server-issued nonce. It carries the player id and the wallet address — never
 * anything the client could forge into a privilege.
 */

export interface AuthClaims {
  playerId: string;
  address: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthClaims;
}

export function signToken(claims: AuthClaims): { token: string; expiresAt: number } {
  const token = jwt.sign(claims, config.jwtSecret, { expiresIn: config.jwtTtlSeconds });
  return { token, expiresAt: Date.now() + config.jwtTtlSeconds * 1000 };
}

export function verifyToken(token: string): AuthClaims | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthClaims & { iat: number; exp: number };
    return { playerId: decoded.playerId, address: decoded.address };
  } catch {
    return null;
  }
}

/** Rejects the request unless a valid bearer token is present. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const claims = verifyToken(header.slice(7));
  if (!claims) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }

  req.auth = claims;
  next();
}

/** Attaches claims when present, but never rejects. */
export function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const claims = verifyToken(header.slice(7));
    if (claims) req.auth = claims;
  }
  next();
}
