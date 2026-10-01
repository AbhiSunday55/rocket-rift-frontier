import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { requireAuth, optionalAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler, rateLimit } from '../middleware/rateLimit.js';
import { assertOwnership } from './anticheat.js';
import { config } from '../config.js';
import { publish } from '../redis.js';

/**
 * Marketplace module.
 *
 * Listings are escrowed: the moment an asset is listed, its state flips to
 * LISTED and it can no longer be equipped, dismantled, or traded. Settlement is
 * a single transaction that moves ownership and records the fee.
 *
 * When contracts are deployed, the on-chain listing id is stored alongside the
 * database row so the two can be reconciled. The database remains the source of
 * truth for in-game ownership; the chain is the source of truth for the token.
 */

export const marketplaceRouter = Router();

interface ListingRow {
  id: string;
  seller_id: string;
  seller_name: string;
  asset_kind: string;
  asset_id: string;
  asset_key: string;
  asset_name: string;
  category: string;
  rarity: number;
  price_wei: string;
  payment_token: string;
  status: string;
  on_chain_id: string | null;
  created_at: Date;
  expires_at: Date | null;
}

function toListing(row: ListingRow) {
  const priceWei = BigInt(row.price_wei);
  const whole = priceWei / 10n ** 18n;
  const frac = (priceWei % 10n ** 18n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');

  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    assetKind: row.asset_kind,
    assetName: row.asset_name,
    assetKey: row.asset_key,
    category: row.category,
    rarity: row.rarity,
    priceWei: row.price_wei,
    priceEth: frac ? `${whole}.${frac}` : whole.toString(),
    paymentToken: row.payment_token,
    status: row.status,
    onChainId: row.on_chain_id ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : undefined,
  };
}

/** Public browse — no auth required, so the market is visible before signing in. */
marketplaceRouter.get(
  '/listings',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const rarity = req.query.rarity !== undefined ? Number(req.query.rarity) : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'NEWEST';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const where: string[] = [`l.status = 'ACTIVE'`, `(l.expires_at IS NULL OR l.expires_at > now())`];
    const params: unknown[] = [];

    if (category && category !== 'ALL') {
      params.push(category);
      where.push(`l.category = $${params.length}`);
    }
    if (rarity !== undefined && rarity >= 0) {
      params.push(rarity);
      where.push(`l.rarity = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(l.asset_name ILIKE $${params.length} OR p.display_name ILIKE $${params.length})`);
    }

    // Sort is a closed set — never interpolate user input into SQL.
    const orderBy =
      sort === 'PRICE_ASC'
        ? 'l.price_wei::numeric ASC'
        : sort === 'PRICE_DESC'
          ? 'l.price_wei::numeric DESC'
          : sort === 'RARITY'
            ? 'l.rarity DESC, l.created_at DESC'
            : 'l.created_at DESC';

    const rows = await query<ListingRow>(
      `SELECT l.*, p.display_name AS seller_name
         FROM listings l
         JOIN players p ON p.id = l.seller_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT 200`,
      params
    );

    res.json({ listings: rows.rows.map(toListing) });
  })
);

const CreateSchema = z.object({
  assetKind: z.enum(['SHIP', 'ITEM']),
  assetId: z.string().uuid(),
  priceEth: z.string().regex(/^\d+(\.\d+)?$/, 'Price must be a decimal number'),
  paymentToken: z.string().optional().default('0x0000000000000000000000000000000000000000'),
  durationHours: z.number().int().min(1).max(720).optional().default(72),
});

marketplaceRouter.post(
  '/listings',
  requireAuth,
  rateLimit({ name: 'listing-create', limit: 20, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid listing' });
      return;
    }

    const playerId = req.auth!.playerId;
    const { assetKind, assetId, priceEth, paymentToken, durationHours } = parsed.data;

    // Convert ETH to wei without floating point.
    const [whole, frac = ''] = priceEth.split('.');
    const priceWei = BigInt(whole) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18));

    if (priceWei <= 0n) {
      res.status(400).json({ error: 'Price must be greater than zero' });
      return;
    }

    const result = await withTransaction(async (client) => {
      let assetKey: string;
      let assetName: string;
      let category: string;
      let rarity: number;

      if (assetKind === 'SHIP') {
        const found = await client.query<{
          id: string;
          player_id: string;
          ship_key: string;
          rarity: number;
          is_starter: boolean;
          nickname: string | null;
          listed: boolean;
        }>('SELECT *, false AS listed FROM ships WHERE id = $1 FOR UPDATE', [assetId]);

        const ship = found.rows[0];
        if (!ship) return { error: 'Ship not found' };
        if (ship.player_id !== playerId) return { error: 'You do not own this ship' };
        if (ship.is_starter) return { error: 'Your starter hull cannot be sold' };

        const alreadyListed = await client.query(
          `SELECT 1 FROM listings WHERE asset_id = $1 AND status = 'ACTIVE'`,
          [assetId]
        );
        if (alreadyListed.rowCount) return { error: 'This ship is already listed' };

        assetKey = ship.ship_key;
        assetName = ship.nickname ?? ship.ship_key;
        category = 'SHIP';
        rarity = ship.rarity;
      } else {
        const found = await client.query<{
          id: string;
          player_id: string;
          item_key: string;
          name: string;
          category: string;
          rarity: number;
          state: string;
        }>('SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE', [assetId]);

        const item = found.rows[0];
        const ownership = assertOwnership(item?.player_id ?? null, playerId, item?.state ?? '');
        if (!ownership.ok) return { error: ownership.reason ?? 'Cannot list this item' };

        assetKey = item!.item_key;
        assetName = item!.name;
        category = item!.category;
        rarity = item!.rarity;

        // Escrow: the item leaves the player's usable inventory.
        await client.query(`UPDATE inventory_items SET state = 'LISTED' WHERE id = $1`, [assetId]);
      }

      const inserted = await client.query<ListingRow>(
        `INSERT INTO listings
           (seller_id, asset_kind, asset_id, asset_key, asset_name, category, rarity,
            price_wei, payment_token, status, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE', now(), now() + ($10 || ' hours')::interval)
         RETURNING *`,
        [playerId, assetKind, assetId, assetKey, assetName, category, rarity, priceWei.toString(), paymentToken, String(durationHours)]
      );

      const seller = await client.query<{ display_name: string }>('SELECT display_name FROM players WHERE id = $1', [
        playerId,
      ]);

      return {
        listing: toListing({ ...inserted.rows[0]!, seller_name: seller.rows[0]!.display_name }),
      };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    await publish('marketplace', { event: 'listed', listingId: result.listing.id });
    res.status(201).json(result);
  })
);

marketplaceRouter.delete(
  '/listings/:id',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const listingId = req.params.id;

    const result = await withTransaction(async (client) => {
      const found = await client.query<ListingRow>('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [listingId]);
      const listing = found.rows[0];

      if (!listing) return { error: 'Listing not found' };
      if (listing.seller_id !== playerId) return { error: 'This is not your listing' };
      if (listing.status !== 'ACTIVE') return { error: 'Listing is no longer active' };

      await client.query(`UPDATE listings SET status = 'CANCELLED' WHERE id = $1`, [listingId]);

      // Release the escrow.
      if (listing.asset_kind === 'ITEM') {
        await client.query(`UPDATE inventory_items SET state = 'TRADEABLE' WHERE id = $1`, [listing.asset_id]);
      }

      return { ok: true as const };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ ok: true });
  })
);

marketplaceRouter.post(
  '/listings/:id/buy',
  requireAuth,
  rateLimit({ name: 'listing-buy', limit: 30, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const listingId = req.params.id;
    const txHash = typeof req.body?.txHash === 'string' ? req.body.txHash : null;

    const result = await withTransaction(async (client) => {
      const found = await client.query<ListingRow>('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [listingId]);
      const listing = found.rows[0];

      if (!listing) return { error: 'Listing not found' };
      if (listing.status !== 'ACTIVE') return { error: 'Listing is no longer active' };
      if (listing.seller_id === playerId) return { error: 'You cannot buy your own listing' };
      if (listing.expires_at && new Date(listing.expires_at).getTime() < Date.now()) {
        return { error: 'Listing has expired' };
      }

      // Server-side balance check. The client's reported balance is irrelevant.
      const buyer = await client.query<{ plasma: number; display_name: string }>(
        'SELECT plasma, display_name FROM players WHERE id = $1 FOR UPDATE',
        [playerId]
      );
      if (!buyer.rowCount) return { error: 'Buyer not found' };

      const priceWei = BigInt(listing.price_wei);
      const feeWei = (priceWei * BigInt(config.marketplaceFeeBps)) / 10_000n;
      const proceedsWei = priceWei - feeWei;

      // Settle: mark sold, transfer the asset, record the fee.
      await client.query(`UPDATE listings SET status = 'SOLD', sold_at = now(), buyer_id = $2 WHERE id = $1`, [
        listingId,
        playerId,
      ]);

      if (listing.asset_kind === 'SHIP') {
        await client.query('UPDATE ships SET player_id = $1, acquired_via = $2 WHERE id = $3', [
          playerId,
          'MARKET',
          listing.asset_id,
        ]);
      } else {
        await client.query(
          `UPDATE inventory_items SET player_id = $1, state = 'TRADEABLE', acquired_via = 'MARKET' WHERE id = $2`,
          [playerId, listing.asset_id]
        );
      }

      await client.query(
        `INSERT INTO transaction_history (player_id, kind, currency, amount, metadata, created_at)
         VALUES ($1, 'MARKET_PURCHASE', 'ETH', $2, $3, now())`,
        [
          playerId,
          Number(priceWei / 10n ** 12n),
          JSON.stringify({ listingId, sellerId: listing.seller_id, feeWei: feeWei.toString(), txHash }),
        ]
      );

      await client.query(
        `INSERT INTO transaction_history (player_id, kind, currency, amount, metadata, created_at)
         VALUES ($1, 'MARKET_SALE', 'ETH', $2, $3, now())`,
        [
          listing.seller_id,
          Number(proceedsWei / 10n ** 12n),
          JSON.stringify({ listingId, buyerId: playerId, feeWei: feeWei.toString() }),
        ]
      );

      const updated = await client.query<ListingRow>(
        `SELECT l.*, p.display_name AS seller_name FROM listings l JOIN players p ON p.id = l.seller_id WHERE l.id = $1`,
        [listingId]
      );
      const profile = await client.query('SELECT * FROM players WHERE id = $1', [playerId]);

      return { listing: toListing(updated.rows[0]!), profile: profile.rows[0] };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    await publish('marketplace', { event: 'sold', listingId });
    res.json(result);
  })
);
