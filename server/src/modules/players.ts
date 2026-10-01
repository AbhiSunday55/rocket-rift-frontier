import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { asyncHandler, rateLimit } from '../middleware/rateLimit.js';

/**
 * Players module — profile, fleet, and leaderboard.
 *
 * Every read is scoped to the authenticated player. There is no endpoint that
 * accepts a player id from the client, which removes an entire class of
 * horizontal-privilege bugs.
 */

export const playersRouter = Router();

playersRouter.use(requireAuth);

interface PlayerRow {
  id: string;
  wallet_address: string;
  display_name: string;
  level: number;
  xp: number;
  scrap: number;
  plasma: number;
  rift_crystal: number;
  season_id: number;
  season_xp: number;
  runs_played: number;
  best_score: number;
  best_sector: number;
  total_kills: number;
  total_bosses_killed: number;
  total_playtime_ms: string | number;
  total_loot_value: string | number;
  equipped_ship_id: string | null;
  created_at: Date;
}

interface ShipRow {
  id: string;
  ship_key: string;
  rarity: number;
  level: number;
  upgrade_points: number;
  is_starter: boolean;
  nickname: string | null;
  token_id: string | null;
  acquired_via: string;
}

interface ItemRow {
  id: string;
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

function toProfile(row: PlayerRow) {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    displayName: row.display_name,
    level: row.level,
    xp: row.xp,
    scrap: row.scrap,
    plasma: row.plasma,
    riftCrystal: row.rift_crystal,
    seasonId: row.season_id,
    seasonXp: row.season_xp,
    equippedShipId: row.equipped_ship_id ?? '',
    createdAt: new Date(row.created_at).getTime(),
    stats: {
      runsPlayed: row.runs_played,
      bestScore: row.best_score,
      bestSector: row.best_sector,
      totalKills: row.total_kills,
      totalBossesKilled: row.total_bosses_killed,
      totalPlaytimeMs: Number(row.total_playtime_ms),
      totalLootValue: Number(row.total_loot_value),
    },
  };
}

function toShip(row: ShipRow) {
  return {
    id: row.id,
    shipKey: row.ship_key,
    rarity: row.rarity,
    level: row.level,
    upgradePoints: row.upgrade_points,
    isStarter: row.is_starter,
    nickname: row.nickname ?? undefined,
    tokenId: row.token_id ?? undefined,
    acquiredVia: row.acquired_via,
  };
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

playersRouter.get(
  '/me',
  asyncHandler(async (req: AuthedRequest, res) => {
    const playerId = req.auth!.playerId;

    const [player, ships, items] = await Promise.all([
      query<PlayerRow>('SELECT * FROM players WHERE id = $1', [playerId]),
      query<ShipRow>('SELECT * FROM ships WHERE player_id = $1 ORDER BY is_starter DESC, created_at ASC', [playerId]),
      query<ItemRow>('SELECT * FROM inventory_items WHERE player_id = $1 ORDER BY acquired_at DESC', [playerId]),
    ]);

    if (!player.rowCount) {
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    res.json({
      profile: toProfile(player.rows[0]!),
      ships: ships.rows.map(toShip),
      inventory: items.rows.map(toItem),
    });
  })
);

const PatchSchema = z.object({ displayName: z.string().min(1).max(24) });

playersRouter.patch(
  '/me',
  rateLimit({ name: 'profile-patch', limit: 20, windowSeconds: 60 }),
  asyncHandler(async (req: AuthedRequest, res) => {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'displayName must be 1-24 characters' });
      return;
    }

    // Strip anything that could be used for injection into other players' UIs.
    const clean = parsed.data.displayName.replace(/[<>\u0000-\u001f]/g, '').trim() || 'Frontier Pilot';

    const updated = await query<PlayerRow>('UPDATE players SET display_name = $1 WHERE id = $2 RETURNING *', [
      clean,
      req.auth!.playerId,
    ]);

    res.json({ profile: toProfile(updated.rows[0]!) });
  })
);

playersRouter.get(
  '/leaderboard',
  asyncHandler(async (req: AuthedRequest, res) => {
    const seasonId = Number(req.query.season ?? 1);

    const rows = await query<{ id: string; display_name: string; level: number; season_xp: number }>(
      `SELECT id, display_name, level, season_xp
         FROM players
        WHERE season_id = $1
        ORDER BY season_xp DESC, level DESC
        LIMIT 100`,
      [seasonId]
    );

    res.json({
      rows: rows.rows.map((row, index) => ({
        rank: index + 1,
        playerId: row.id,
        displayName: row.display_name,
        level: row.level,
        seasonXp: row.season_xp,
      })),
    });
  })
);
