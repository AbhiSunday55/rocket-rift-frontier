import { randomUUID } from 'node:crypto';
import { pool, closePool } from '../db.js';

/**
 * Seed script.
 *
 * Creates a handful of demo pilots with listings and inventory so the
 * marketplace and leaderboard are not empty on a fresh install. It is safe to
 * run repeatedly — everything is keyed on a deterministic wallet address.
 */

const DEMO_PILOTS = [
  { address: '0x1111111111111111111111111111111111111111', name: 'Vex', level: 24, seasonXp: 18_400 },
  { address: '0x2222222222222222222222222222222222222222', name: 'Nova', level: 31, seasonXp: 24_900 },
  { address: '0x3333333333333333333333333333333333333333', name: 'Kestrel', level: 18, seasonXp: 11_200 },
  { address: '0x4444444444444444444444444444444444444444', name: 'Orin', level: 42, seasonXp: 38_600 },
  { address: '0x5555555555555555555555555555555555555555', name: 'Sable', level: 12, seasonXp: 6_100 },
  { address: '0x6666666666666666666666666666666666666666', name: 'Rook', level: 27, seasonXp: 21_050 },
];

const DEMO_LISTINGS: [string, string, string, number, string][] = [
  ['void_reaver', 'Void Reaver', 'SHIP', 5, '2.4'],
  ['chronos', 'Chronos', 'SHIP', 4, '1.15'],
  ['rail_lance', 'Rail Lance', 'WEAPON', 3, '0.42'],
  ['void_needler', 'Void Needler', 'WEAPON', 4, '0.88'],
  ['skin_void', 'Void Etch', 'SKIN', 3, '0.19'],
  ['titan_sigil', 'Titan Sigil', 'COLLECTIBLE', 3, '0.31'],
  ['scatter_blaster', 'Scatter Blaster', 'WEAPON', 2, '0.12'],
  ['lucky_charm', 'Lucky Charm', 'ACCESSORY', 2, '0.09'],
  ['bulwark', 'Bulwark', 'SHIP', 2, '0.55'],
  ['targeting_chip', 'Targeting Chip', 'EQUIPMENT', 2, '0.07'],
  ['skin_gilded', 'Gilded Plate', 'SKIN', 4, '0.64'],
  ['mender', 'Mender', 'SHIP', 2, '0.48'],
];

function toWei(eth: string): string {
  const [whole, frac = ''] = eth.split('.');
  return (BigInt(whole) * 10n ** 18n + BigInt((frac + '0'.repeat(18)).slice(0, 18))).toString();
}

async function main(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const playerIds: string[] = [];

    for (const pilot of DEMO_PILOTS) {
      const existing = await client.query<{ id: string }>('SELECT id FROM players WHERE wallet_address = $1', [
        pilot.address,
      ]);

      if (existing.rowCount) {
        playerIds.push(existing.rows[0]!.id);
        continue;
      }

      const created = await client.query<{ id: string }>(
        `INSERT INTO players
           (wallet_address, display_name, level, xp, scrap, plasma, rift_crystal, season_id, season_xp,
            runs_played, best_score, best_sector, total_kills, total_bosses_killed, created_at, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,$11,$12,$13, now(), now())
         RETURNING id`,
        [
          pilot.address,
          pilot.name,
          pilot.level,
          pilot.level * 400,
          pilot.level * 250,
          pilot.level * 12,
          Math.floor(pilot.level / 5),
          pilot.seasonXp,
          pilot.level * 3,
          pilot.level * 4200,
          Math.floor(pilot.level / 3),
          pilot.level * 180,
          Math.floor(pilot.level / 4),
        ]
      );

      const playerId = created.rows[0]!.id;
      playerIds.push(playerId);

      await client.query(
        `INSERT INTO ships (player_id, ship_key, rarity, level, is_starter, acquired_via, created_at)
         VALUES ($1, 'raptor_x', 0, 1, true, 'STARTER', now())`,
        [playerId]
      );
    }

    // Give each pilot a couple of tradeable items so P2P trading has material.
    const starterItems: [string, string, string, number][] = [
      ['pulse_cannon', 'Pulse Cannon', 'WEAPON', 0],
      ['scatter_blaster', 'Scatter Blaster', 'WEAPON', 2],
      ['targeting_chip', 'Targeting Chip', 'EQUIPMENT', 2],
      ['lucky_charm', 'Lucky Charm', 'ACCESSORY', 2],
    ];

    for (const playerId of playerIds) {
      for (const [key, name, category, rarity] of starterItems) {
        const exists = await client.query(
          `SELECT 1 FROM inventory_items WHERE player_id = $1 AND item_key = $2 LIMIT 1`,
          [playerId, key]
        );
        if (exists.rowCount) continue;

        await client.query(
          `INSERT INTO inventory_items
             (id, player_id, item_key, name, category, rarity, state, quantity, level, stats, acquired_via, acquired_at)
           VALUES ($1,$2,$3,$4,$5,$6,'TRADEABLE',1,1,'{}'::jsonb,'LOOT', now())`,
          [randomUUID(), playerId, key, name, category, rarity]
        );
      }
    }

    // Demo listings, spread across sellers.
    for (let i = 0; i < DEMO_LISTINGS.length; i++) {
      const [key, name, category, rarity, price] = DEMO_LISTINGS[i]!;
      const sellerId = playerIds[i % playerIds.length]!;

      const exists = await client.query(
        `SELECT 1 FROM listings WHERE asset_key = $1 AND seller_id = $2 AND status = 'ACTIVE' LIMIT 1`,
        [key, sellerId]
      );
      if (exists.rowCount) continue;

      // A listing needs a backing asset row.
      const assetId = randomUUID();
      await client.query(
        `INSERT INTO inventory_items
           (id, player_id, item_key, name, category, rarity, state, quantity, level, stats, acquired_via, acquired_at)
         VALUES ($1,$2,$3,$4,$5,$6,'LISTED',1,1,'{}'::jsonb,'MARKET', now())`,
        [assetId, sellerId, key, name, category, rarity]
      );

      await client.query(
        `INSERT INTO listings
           (seller_id, asset_kind, asset_id, asset_key, asset_name, category, rarity,
            price_wei, payment_token, status, created_at, expires_at)
         VALUES ($1,'ITEM',$2,$3,$4,$5,$6,$7,'0x0000000000000000000000000000000000000000','ACTIVE', now(), now() + interval '72 hours')`,
        [sellerId, assetId, key, name, category, rarity, toWei(price)]
      );
    }

    await client.query('COMMIT');
    console.log(`[seed] created ${playerIds.length} demo pilots and ${DEMO_LISTINGS.length} listings`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
