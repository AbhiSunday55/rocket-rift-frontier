import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler, rateLimit } from '../middleware/rateLimit.js';
import { assertOwnership } from './anticheat.js';

/**
 * Inventory module.
 *
 * Every mutation re-reads the row inside a transaction and re-checks ownership
 * and state server-side. The client's view of its own inventory is a cache, not
 * an authority.
 */

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

interface ItemRow {
  id: string;
  player_id: string;
  item_key: string;
  name: string;
  category: string;
  rarity: number;
  state: string;
  quantity: number;
  level: number;
  stats: Record<string, number> | null;
  token_id: string | null;
  acquired_via: string;
  acquired_at: Date;
}

function toItem(row: ItemRow) {
  return {
    id: row.id,
    itemKey: row.item_key,
    name: row.name,
    category: row.category,
    rarity: row.rarity,
    state: row.state,
    quantity: row.quantity,
    level: row.level,
    stats: row.stats ?? {},
    tokenId: row.token_id ?? undefined,
    acquiredVia: row.acquired_via,
    acquiredAt: new Date(row.acquired_at).getTime(),
  };
}

/** Scrap returned by dismantling, mirroring the client's curve. */
function dismantleValue(rarity: number, level: number, quantity: number): number {
  const base = [5, 12, 30, 75, 180, 450][Math.min(rarity, 5)] ?? 5;
  return Math.floor(base * (1 + (level - 1) * 0.15)) * quantity;
}

inventoryRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const rows = await query<ItemRow>(
      'SELECT * FROM inventory_items WHERE player_id = $1 ORDER BY acquired_at DESC',
      [req.auth!.playerId]
    );
    res.json({ items: rows.rows.map(toItem) });
  })
);

inventoryRouter.post(
  '/:id/dismantle',
  rateLimit({ name: 'dismantle', limit: 60, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;
    const itemId = req.params.id;

    const result = await withTransaction(async (client) => {
      // Lock the row so two concurrent dismantles cannot double-pay.
      const found = await client.query<ItemRow>('SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE', [itemId]);
      const item = found.rows[0];

      const ownership = assertOwnership(item?.player_id ?? null, playerId, item?.state ?? '');
      if (!ownership.ok) return { error: ownership.reason ?? 'Cannot dismantle' };

      const value = dismantleValue(item!.rarity, item!.level, item!.quantity);

      await client.query('DELETE FROM inventory_items WHERE id = $1', [itemId]);
      await client.query('UPDATE players SET scrap = scrap + $1 WHERE id = $2', [value, playerId]);
      await client.query(
        `INSERT INTO transaction_history (player_id, kind, currency, amount, metadata, created_at)
         VALUES ($1, 'DISMANTLE', 'SCRAP', $2, $3, now())`,
        [playerId, value, JSON.stringify({ itemKey: item!.item_key, rarity: item!.rarity })]
      );

      const remaining = await client.query<ItemRow>(
        'SELECT * FROM inventory_items WHERE player_id = $1 ORDER BY acquired_at DESC',
        [playerId]
      );

      return { scrap: value, items: remaining.rows.map(toItem) };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json(result);
  })
);

const EquipSchema = z.object({ slot: z.enum(['primary', 'secondary', 'ultimate', 'skin', 'equipment', 'accessory']) });

inventoryRouter.post(
  '/:id/equip',
  rateLimit({ name: 'equip', limit: 120, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = EquipSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid slot' });
      return;
    }

    const playerId = req.auth!.playerId;
    const itemId = req.params.id;

    const result = await withTransaction(async (client) => {
      const found = await client.query<ItemRow>('SELECT * FROM inventory_items WHERE id = $1 FOR UPDATE', [itemId]);
      const item = found.rows[0];

      if (!item || item.player_id !== playerId) return { error: 'You do not own this item' };
      if (item.state === 'LISTED') return { error: 'Item is escrowed in a listing' };

      // One equipped item per category — unequip the previous holder first.
      await client.query(
        `UPDATE inventory_items SET state = 'TRADEABLE'
          WHERE player_id = $1 AND category = $2 AND state = 'EQUIPPED'`,
        [playerId, item.category]
      );
      await client.query(`UPDATE inventory_items SET state = 'EQUIPPED' WHERE id = $1`, [itemId]);

      const remaining = await client.query<ItemRow>(
        'SELECT * FROM inventory_items WHERE player_id = $1 ORDER BY acquired_at DESC',
        [playerId]
      );

      return { items: remaining.rows.map(toItem) };
    });

    if ('error' in result) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json(result);
  })
);
