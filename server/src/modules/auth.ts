import { Router } from 'express';
import { verifyMessage } from 'ethers';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';
import { kvDel, kvGet, kvSet } from '../redis.js';
import { signToken } from '../middleware/auth.js';
import { asyncHandler, rateLimit } from '../middleware/rateLimit.js';

/**
 * Auth module — wallet signature verification.
 *
 * Flow:
 *   1. GET  /api/auth/nonce?address=0x…  → a one-time nonce + the exact message
 *   2. The wallet signs that message (personal_sign).
 *   3. POST /api/auth/verify             → the server recovers the signer and
 *                                          checks it matches the claimed address.
 *
 * 🚨 The server NEVER asks for a seed phrase or private key, and never stores
 * one. It only ever sees a public address and a signature.
 */

export const authRouter = Router();

const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address');

const VerifySchema = z.object({
  address: AddressSchema,
  signature: z.string().min(10),
  nonce: z.string().min(8),
});

function buildMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    'ROCKET RIFT: FRONTIER — Sign-in request',
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    '',
    'Signing this message proves you control this wallet. It costs no gas and',
    'authorises no transaction. We will never ask for your seed phrase or',
    'private key — anyone who does is trying to steal from you.',
  ].join('\n');
}

authRouter.get(
  '/nonce',
  rateLimit({ name: 'auth-nonce', limit: 30, windowSeconds: 60 }),
  asyncHandler(async (req, res) => {
    const parsed = AddressSchema.safeParse(req.query.address);
    if (!parsed.success) {
      res.status(400).json({ error: 'A valid EVM address is required' });
      return;
    }

    const address = parsed.data.toLowerCase();
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const message = buildMessage(address, nonce, issuedAt);

    await kvSet(`nonce:${address}`, JSON.stringify({ nonce, message }), config.nonceTtlSeconds);

    res.json({ nonce, message, expiresIn: config.nonceTtlSeconds });
  })
);

authRouter.post(
  '/verify',
  rateLimit({ name: 'auth-verify', limit: 20, windowSeconds: 60 }),
  asyncHandler(async (req, res) => {
    const parsed = VerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
      return;
    }

    const { signature, nonce } = parsed.data;
    const address = parsed.data.address.toLowerCase();

    // 1. The nonce must be one we issued, and still live.
    const stored = await kvGet(`nonce:${address}`);
    if (!stored) {
      res.status(401).json({ error: 'Nonce expired or never issued — request a new one.' });
      return;
    }

    const { nonce: expectedNonce, message } = JSON.parse(stored) as { nonce: string; message: string };
    if (expectedNonce !== nonce) {
      res.status(401).json({ error: 'Nonce mismatch' });
      return;
    }

    // 2. Recover the signer and require an exact address match.
    let recovered: string;
    try {
      recovered = verifyMessage(message, signature).toLowerCase();
    } catch {
      res.status(401).json({ error: 'Signature could not be verified' });
      return;
    }

    if (recovered !== address) {
      res.status(401).json({ error: 'Signature does not match the claimed address' });
      return;
    }

    // 3. Burn the nonce — it is single-use.
    await kvDel(`nonce:${address}`);

    // 4. Upsert the player and issue a session token.
    const existing = await query<{ id: string }>('SELECT id FROM players WHERE wallet_address = $1', [address]);

    let playerId: string;
    if (existing.rowCount && existing.rows[0]) {
      playerId = existing.rows[0].id;
      await query('UPDATE players SET last_seen_at = now() WHERE id = $1', [playerId]);
    } else {
      const created = await query<{ id: string }>(
        `INSERT INTO players (wallet_address, display_name, created_at, last_seen_at)
         VALUES ($1, $2, now(), now())
         RETURNING id`,
        [address, `Pilot ${address.slice(2, 8)}`]
      );
      playerId = created.rows[0]!.id;

      // Every new pilot gets the free starter hull — the game is playable from
      // the first second, with no purchase and no wallet requirement.
      await query(
        `INSERT INTO ships (player_id, ship_key, rarity, level, is_starter, acquired_via, created_at)
         VALUES ($1, 'raptor_x', 0, 1, true, 'STARTER', now())`,
        [playerId]
      );
    }

    const { token, expiresAt } = signToken({ playerId, address });

    res.json({ token, address, playerId, expiresAt });
  })
);
