import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler, rateLimit } from '../middleware/rateLimit.js';
import { assertBalance, assertOwnership } from './anticheat.js';
import { publish } from '../redis.js';

/**
 * Trading module — player-to-player swaps.
 *
 * A trade is a two-party state machine:
 *
 *   PENDING → (both confirm) → SETTLED
 *           → (either cancels) → CANCELLED
 *
 * Nothing moves until BOTH sides have confirmed. Settlement re-validates every
 * asset and every currency balance inside a single transaction, so a trade can
 * never half-execute or move an asset the player no longer owns.
 */

export const tradingRouter = Router();

tradingRouter.use(requireAuth);

interface TradeRow {
  id: string;
  initiator_id: string;
  counterparty_id: string;
  offered_assets: { itemKey: string; quantity: number }[];
  requested_assets: { itemKey: string; quantity: number }[];
  offered_plasma: number;
  requested_plasma: number;
  status: string;
  initiator_confirmed: boolean;
  counterparty_confirmed: boolean;
  created_at: Date;
  expires_at: Date;
}

async function hydrateTrade(row: TradeRow) {
  const names = await query<{ id: string; display_name: string }>(
    'SELECT id, display_name FROM players WHERE id = ANY($1::uuid[])',
    [[row.initiator_id, row.counterparty_id]]
  );
  const nameOf = new Map(names.rows.map((r) => [r.id, r.display_name]));

  // Resolve display names for the item keys involved.
  const keys = [...row.offered_assets, ...row.requested_assets].map((a) => a.itemKey);
  const items = keys.length
    ? await query<{ item_key: string; name: string; rarity: number }>(
        'SELECT DISTINCT ON (item_key) item_key, name, rarity FROM inventory_items WHERE item_key = ANY($1::text[])',
        [keys]
      )
    : { rows: [] as { item_key: string; name: string; rarity: number }[] };

  const metaOf = new Map(items.rows.map((r) => [r.item_key, r]));
  const decorate = (assets: { itemKey: string; quantity: number }[]) =>
    assets.map((a) => ({
      itemKey: a.itemKey,
      quantity: a.quantity,
      name: metaOf.get(a.itemKey)?.name ?? a.itemKey.replace(/_/g, ' '),
      rarity: metaOf.get(a.itemKey)?.rarity ?? 0,
    }));

  return {
    id: row.id,
    initiatorId: row.initiator_id,
    initiatorName: nameOf.get(row.initiator_id) ?? 'Unknown',
    counterpartyId: row.counterparty_id,
    counterpartyName: nameOf.get(row.counterparty_id) ?? 'Unknown',
    offeredAssets: decorate(row.offered_assets),
    requestedAssets: decorate(row.requested_assets),
    offeredPlasma: row.offered_plasma,
    requestedPlasma: row.requested_plasma,
    status: row.status,
    initiatorConfirmed: row.initiator_confirmed,
    counterpartyConfirmed: row.counterparty_confirmed,
    createdAt: new Date(row.created_at).getTime(),
    expiresAt: new Date(row.expires_at).getTime(),
  };
}

tradingRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;

    const rows = await query<TradeRow>(
      `SELECT * FROM p2p_trades
        WHERE (initiator_id = $1 OR counterparty_id = $1)
          AND status NOT IN ('CANCELLED')
        ORDER BY created_at DESC
        LIMIT 100`,
      [playerId]
    );

    res.json({ trades: await Promise.all(rows.rows.map(hydrateTrade)) });
  })
);

const CreateTradeSchema = z.object({
  counterpartyId: z.string().min(1),
  offeredAssets: z.array(z.object({ itemKey: z.string(), quantity: z.number().int().positive() })).max(20),
  requestedAssets: z.array(z.object({ itemKey: z.string(), quantity: z.number().int().positive() })).max(20),
  offeredPlasma: z.number().int().nonnegative().max(1_000_000),
  requestedPlasma: z.number().int().nonnegative().max(1_000_000),
});

tradingRouter.post(
  '/',
  rateLimit({ name: 'trade-create', limit: 20, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = CreateTradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid trade' });
      return;
    }

    const playerId = req.auth!.playerId;
    const body = parsed.data;

    // Resolve the counterparty by id or wallet address — never trust a raw id.
    const counterparty = await query<{ id: string }>(
      `SELECT id FROM players WHERE id::text = $1 OR wallet_address = $2 LIMIT 1`,
      [body.counterpartyId, body.counterpartyId.toLowerCase()]
    );

    if (!counterparty.rowCount) {
      res.status(404).json({ error: 'No pilot found with that id or wallet address' });
      return;
    }

    const counterpartyId = counterparty.rows[0]!.id;
    if (counterpartyId === playerId) {
      res.status(400).json({ error: 'You cannot trade with yourself' });
      return;
    }

    const result = await withTransaction(async (client) => {
      // Verify the initiator actually owns everything they are offering.
      const initiator = await client.query<{ plasma: number }>('SELECT plasma FROM players WHERE id = $1 FOR UPDATE', [
        playerId,
      ]);

      const balance = assertBalance(initiator.rows[0]!.plasma, body.offeredPlasma, 'Plasma');
      if (!balance.ok) return { error: balance.reason ?? 'Insufficient Plasma' };

      for (const asset of body.offeredAssets) {
        const owned = await client.query<{ id: string; state: string; quantity: number }>(
          `SELECT id, state, quantity FROM inventory_items
            WHERE player_id = $1 AND item_key = $2 AND state = 'TRADEABLE'
            ORDER BY acquired_at ASC LIMIT 1`,
          [playerId, asset.itemKey]
        );

        const item = owned.rows[0];
        const check = assertOwnership(item ? playerId : null, playerId, item?.state ?? '');
        if (!check.ok || !item || item.quantity < asset.quantity) {
          return { error: `You do not have ${asset.quantity}× ${asset.itemKey} available to trade` };
        }
      }

      const inserted = await client.query<TradeRow>(
        `INSERT INTO p2p_trades
           (initiator_id, counterparty_id, offered_assets, requested_assets, offered_plasma,
            requested_plasma, status, initiator_confirmed, counterparty_confirmed, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING', true, false, now(), now() + interval '48 hours')
         RETURNING *`,
        [
          playerId,
          counterpartyId,
          JSON.stringify(body.offeredAssets),
          JSON.stringify(body.requestedAssets),
          body.offeredPlasma,
          body.requestedPlasma,
        ]
      );

      return { trade: await hydrateTrade(inserted.rows[0]!) };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    await publish('trade', { event: 'created', tradeId: result.trade.id, counterpartyId });
    res.status(201).json(result);
  })
);

tradingRouter.post(
  '/:id/confirm',
  rateLimit({ name: 'trade-confirm', limit: 40, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const tradeId = req.params.id;
    const signature = typeof req.body?.signature === 'string' ? req.body.signature : null;

    const result = await withTransaction(async (client) => {
      const found = await client.query<TradeRow>('SELECT * FROM p2p_trades WHERE id = $1 FOR UPDATE', [tradeId]);
      const trade = found.rows[0];

      if (!trade) return { error: 'Trade not found' };
      if (trade.status === 'SETTLED') return { error: 'Trade already settled' };
      if (trade.status === 'CANCELLED') return { error: 'Trade was cancelled' };
      if (new Date(trade.expires_at).getTime() < Date.now()) return { error: 'Trade has expired' };

      const isInitiator = trade.initiator_id === playerId;
      const isCounterparty = trade.counterparty_id === playerId;
      if (!isInitiator && !isCounterparty) return { error: 'You are not part of this trade' };

      // Record the confirmation (and the wallet signature, when supplied).
      await client.query(
        isInitiator
          ? `UPDATE p2p_trades SET initiator_confirmed = true, initiator_signature = $2 WHERE id = $1`
          : `UPDATE p2p_trades SET counterparty_confirmed = true, counterparty_signature = $2 WHERE id = $1`,
        [tradeId, signature]
      );

      const refreshed = await client.query<TradeRow>('SELECT * FROM p2p_trades WHERE id = $1', [tradeId]);
      const current = refreshed.rows[0]!;

      // Not both confirmed yet — nothing moves.
      if (!current.initiator_confirmed || !current.counterparty_confirmed) {
        return { trade: await hydrateTrade(current) };
      }

      // ── Settlement ────────────────────────────────────────────────────────
      // Re-validate EVERYTHING against the database before moving anything.
      const initiator = await client.query<{ plasma: number }>(
        'SELECT plasma FROM players WHERE id = $1 FOR UPDATE',
        [current.initiator_id]
      );
      const counterparty = await client.query<{ plasma: number }>(
        'SELECT plasma FROM players WHERE id = $1 FOR UPDATE',
        [current.counterparty_id]
      );

      const initiatorBalance = assertBalance(initiator.rows[0]!.plasma, current.offered_plasma, 'Plasma');
      if (!initiatorBalance.ok) return { error: `Initiator: ${initiatorBalance.reason}` };

      const counterpartyBalance = assertBalance(counterparty.rows[0]!.plasma, current.requested_plasma, 'Plasma');
      if (!counterpartyBalance.ok) return { error: `Counterparty: ${counterpartyBalance.reason}` };

      // Move items: initiator → counterparty.
      for (const asset of current.offered_assets) {
        const moved = await client.query(
          `UPDATE inventory_items
              SET player_id = $1, state = 'TRADEABLE', acquired_via = 'TRADE'
            WHERE id = (
              SELECT id FROM inventory_items
               WHERE player_id = $2 AND item_key = $3 AND state = 'TRADEABLE'
               ORDER BY acquired_at ASC LIMIT 1
            )
            RETURNING id`,
          [current.counterparty_id, current.initiator_id, asset.itemKey]
        );
        if (!moved.rowCount) return { error: `Initiator no longer owns ${asset.itemKey}` };
      }

      // Move items: counterparty → initiator.
      for (const asset of current.requested_assets) {
        const moved = await client.query(
          `UPDATE inventory_items
              SET player_id = $1, state = 'TRADEABLE', acquired_via = 'TRADE'
            WHERE id = (
              SELECT id FROM inventory_items
               WHERE player_id = $2 AND item_key = $3 AND state = 'TRADEABLE'
               ORDER BY acquired_at ASC LIMIT 1
            )
            RETURNING id`,
          [current.initiator_id, current.counterparty_id, asset.itemKey]
        );
        if (!moved.rowCount) return { error: `Counterparty no longer owns ${asset.itemKey}` };
      }

      // Move Plasma.
      if (current.offered_plasma > 0) {
        await client.query('UPDATE players SET plasma = plasma - $1 WHERE id = $2', [
          current.offered_plasma,
          current.initiator_id,
        ]);
        await client.query('UPDATE players SET plasma = plasma + $1 WHERE id = $2', [
          current.offered_plasma,
          current.counterparty_id,
        ]);
      }
      if (current.requested_plasma > 0) {
        await client.query('UPDATE players SET plasma = plasma - $1 WHERE id = $2', [
          current.requested_plasma,
          current.counterparty_id,
        ]);
        await client.query('UPDATE players SET plasma = plasma + $1 WHERE id = $2', [
          current.requested_plasma,
          current.initiator_id,
        ]);
      }

      await client.query(`UPDATE p2p_trades SET status = 'SETTLED', settled_at = now() WHERE id = $1`, [tradeId]);

      await client.query(
        `INSERT INTO transaction_history (player_id, kind, currency, amount, metadata, created_at)
         VALUES ($1, 'P2P_TRADE', 'MIXED', $2, $3, now()), ($4, 'P2P_TRADE', 'MIXED', $5, $3, now())`,
        [
          current.initiator_id,
          current.offered_plasma,
          JSON.stringify({ tradeId, role: 'initiator' }),
          current.counterparty_id,
          current.requested_plasma,
        ]
      );

      const settled = await client.query<TradeRow>('SELECT * FROM p2p_trades WHERE id = $1', [tradeId]);
      const profile = await client.query('SELECT * FROM players WHERE id = $1', [playerId]);

      return { trade: await hydrateTrade(settled.rows[0]!), profile: profile.rows[0] };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    await publish('trade', { event: 'updated', tradeId });
    res.json(result);
  })
);

tradingRouter.delete(
  '/:id',
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const tradeId = req.params.id;

    const result = await withTransaction(async (client) => {
      const found = await client.query<TradeRow>('SELECT * FROM p2p_trades WHERE id = $1 FOR UPDATE', [tradeId]);
      const trade = found.rows[0];

      if (!trade) return { error: 'Trade not found' };
      if (trade.status === 'SETTLED') return { error: 'Settled trades cannot be cancelled' };
      if (trade.initiator_id !== playerId && trade.counterparty_id !== playerId) {
        return { error: 'You are not part of this trade' };
      }

      await client.query(`UPDATE p2p_trades SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`, [tradeId]);
      return { ok: true as const };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ ok: true });
  })
);
