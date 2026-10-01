-- ═══════════════════════════════════════════════════════════════════════════
-- ROCKET RIFT: FRONTIER — PostgreSQL schema
-- Server-authoritative. The client is NEVER trusted for balances,
-- ownership, or progression.
--
-- This schema is the contract the API in `server/src/modules/*` is written
-- against. Every table, column and type below is referenced by real queries —
-- keep the two in lockstep when either changes.
--
-- Conventions:
--   * Primary keys are UUIDs (`gen_random_uuid()`), matching the string ids the
--     API hands to the client and the `id::text` / `ANY($1::uuid[])` casts the
--     server uses.
--   * `rarity` is a SMALLINT (0..5) mirroring the client's numeric `Rarity`
--     enum and the on-chain `uint8 rarity` — never a Postgres enum, which would
--     come back from node-pg as a string.
--   * `currency` is free-form VARCHAR because the ledger records non-currency
--     kinds too ('MIXED', 'ETH').
--
-- ⚠️  Existing development databases created from an earlier revision of this
--     file must be recreated (the id types changed from BIGSERIAL to UUID):
--         DROP SCHEMA public CASCADE; CREATE SCHEMA public;
--     then re-run `npm run db:migrate`.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────
-- Only the enums the server actually round-trips as strings live here. Rarity
-- is deliberately NOT an enum (see the header note).

DO $$ BEGIN
  CREATE TYPE item_state AS ENUM ('LOCKED','TRADEABLE','LISTED','EQUIPPED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE item_category AS ENUM ('SHIP','WEAPON','SKIN','EQUIPMENT','COLLECTIBLE','ACCESSORY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('ACTIVE','SOLD','CANCELLED','EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE trade_status AS ENUM ('PENDING','AWAITING_COUNTERPARTY','CONFIRMED','SETTLED','CANCELLED','EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mission_kind AS ENUM ('DAILY','WEEKLY','SPECIAL','SEASONAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── players ─────────────────────────────────────────────────────────────────
-- One row per wallet. `id` is the UUID the JWT carries and every module scopes
-- its reads to. The aggregate stat columns are maintained by the runs module.
CREATE TABLE IF NOT EXISTS players (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address        VARCHAR(42) NOT NULL UNIQUE,
  display_name          VARCHAR(32),
  level                 INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp                    BIGINT  NOT NULL DEFAULT 0 CHECK (xp >= 0),
  scrap                 BIGINT  NOT NULL DEFAULT 0 CHECK (scrap >= 0),
  plasma                BIGINT  NOT NULL DEFAULT 0 CHECK (plasma >= 0),
  rift_crystal          BIGINT  NOT NULL DEFAULT 0 CHECK (rift_crystal >= 0),
  equipped_ship_id      UUID,
  season_id             INTEGER NOT NULL DEFAULT 1,
  season_xp             BIGINT  NOT NULL DEFAULT 0 CHECK (season_xp >= 0),
  -- Aggregate career stats, updated on every verified run.
  runs_played           INTEGER NOT NULL DEFAULT 0,
  best_score            BIGINT  NOT NULL DEFAULT 0,
  best_sector           INTEGER NOT NULL DEFAULT 0,
  total_kills           BIGINT  NOT NULL DEFAULT 0,
  total_bosses_killed   BIGINT  NOT NULL DEFAULT 0,
  total_playtime_ms     BIGINT  NOT NULL DEFAULT 0,
  total_loot_value      BIGINT  NOT NULL DEFAULT 0,
  -- Anti-cheat bookkeeping.
  cheat_flags           INTEGER NOT NULL DEFAULT 0,
  banned                BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_players_wallet      ON players (wallet_address);
CREATE INDEX IF NOT EXISTS idx_players_level       ON players (level DESC);
CREATE INDEX IF NOT EXISTS idx_players_season_xp   ON players (season_id, season_xp DESC);

-- ── ships ───────────────────────────────────────────────────────────────────
-- Owned hulls. Stats are denormalised into columns (not JSONB) because the
-- progression system recomputes them server-side and the marketplace reads
-- them directly. `rarity` is the numeric ladder index.
CREATE TABLE IF NOT EXISTS ships (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  ship_key       VARCHAR(48) NOT NULL,          -- e.g. 'raptor_x'
  nickname       VARCHAR(32),
  rarity         SMALLINT NOT NULL DEFAULT 0 CHECK (rarity BETWEEN 0 AND 5),
  level          INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  -- Stat block, defaulted to the Raptor-X starter hull.
  health         INTEGER NOT NULL DEFAULT 100,
  shield         INTEGER NOT NULL DEFAULT 50,
  damage         INTEGER NOT NULL DEFAULT 10,
  speed          NUMERIC(6,2) NOT NULL DEFAULT 7.00,
  fire_rate      NUMERIC(6,2) NOT NULL DEFAULT 1.00,
  crit_chance    NUMERIC(5,4) NOT NULL DEFAULT 0.0500,
  cargo          INTEGER NOT NULL DEFAULT 10,
  upgrade_points INTEGER NOT NULL DEFAULT 0,
  token_id       NUMERIC(78,0),                 -- on-chain ShipNFT id, NULL if off-chain
  chain_id       INTEGER,
  is_starter     BOOLEAN NOT NULL DEFAULT FALSE,
  acquired_via   VARCHAR(32) NOT NULL DEFAULT 'STARTER', -- STARTER|PROGRESSION|MISSION|CRAFT|MARKET|MINT
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ships_player      ON ships (player_id);
CREATE INDEX IF NOT EXISTS idx_ships_token       ON ships (chain_id, token_id);
CREATE INDEX IF NOT EXISTS idx_ships_rarity      ON ships (rarity);

-- The equipped-ship pointer is a deferred-ish FK: ships must exist before the
-- constraint can be added, and a player row is created before their first hull.
ALTER TABLE players
  DROP CONSTRAINT IF EXISTS fk_players_equipped_ship;
ALTER TABLE players
  ADD CONSTRAINT fk_players_equipped_ship
  FOREIGN KEY (equipped_ship_id) REFERENCES ships(id) ON DELETE SET NULL;

-- ── inventory_items ─────────────────────────────────────────────────────────
-- Every owned item. `state` drives escrow: LISTED items are locked out of
-- equipping, dismantling and trading until the listing is cancelled or sold.
CREATE TABLE IF NOT EXISTS inventory_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_key      VARCHAR(64) NOT NULL,           -- e.g. 'plasma_lance_mk2'
  name          VARCHAR(64) NOT NULL DEFAULT '',
  category      item_category NOT NULL,
  rarity        SMALLINT NOT NULL DEFAULT 0 CHECK (rarity BETWEEN 0 AND 5),
  state         item_state NOT NULL DEFAULT 'TRADEABLE',
  quantity      INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  level         INTEGER NOT NULL DEFAULT 1,
  stats         JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_id      NUMERIC(78,0),
  chain_id      INTEGER,
  acquired_via  VARCHAR(32) NOT NULL DEFAULT 'LOOT', -- LOOT|CRAFT|MISSION|MARKET|TRADE|MINT
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_items_player    ON inventory_items (player_id);
CREATE INDEX IF NOT EXISTS idx_items_category  ON inventory_items (player_id, category);
CREATE INDEX IF NOT EXISTS idx_items_state     ON inventory_items (state);
CREATE INDEX IF NOT EXISTS idx_items_rarity    ON inventory_items (rarity);
CREATE INDEX IF NOT EXISTS idx_items_token     ON inventory_items (chain_id, token_id);
CREATE INDEX IF NOT EXISTS idx_items_key       ON inventory_items (item_key);
CREATE INDEX IF NOT EXISTS idx_items_stats_gin ON inventory_items USING GIN (stats);

-- ── game_sessions ───────────────────────────────────────────────────────────
-- One row per run. Created at /api/runs/start (status ACTIVE) and completed at
-- /api/runs/submit. Flagged runs are retained as evidence, never rewarded.
CREATE TABLE IF NOT EXISTS game_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  seed              BIGINT NOT NULL DEFAULT 0,   -- server-issued; the client never picks it
  sector_index      INTEGER NOT NULL DEFAULT 0,
  sector_biome      VARCHAR(32) NOT NULL DEFAULT 'NEBULA',
  is_boss           BOOLEAN NOT NULL DEFAULT FALSE,
  sector_reached    INTEGER NOT NULL DEFAULT 0,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  duration_ms       BIGINT,
  score             BIGINT NOT NULL DEFAULT 0,
  kills             INTEGER NOT NULL DEFAULT 0,
  damage_dealt      BIGINT NOT NULL DEFAULT 0,
  damage_taken      BIGINT NOT NULL DEFAULT 0,
  loot_value        BIGINT NOT NULL DEFAULT 0,
  xp_gained         BIGINT NOT NULL DEFAULT 0,
  scrap_gained      BIGINT NOT NULL DEFAULT 0,
  plasma_gained     BIGINT NOT NULL DEFAULT 0,
  boss_killed       BOOLEAN NOT NULL DEFAULT FALSE,
  hmac_payload      TEXT,                        -- signed session envelope
  hmac_signature    VARCHAR(128),
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  flagged           BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason       TEXT,
  status            VARCHAR(16) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE|COMPLETED|FLAGGED
  client_version    VARCHAR(24),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_player   ON game_sessions (player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_flagged  ON game_sessions (flagged) WHERE flagged = TRUE;
CREATE INDEX IF NOT EXISTS idx_sessions_score    ON game_sessions (score DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON game_sessions (status);

-- ── listings (marketplace) ──────────────────────────────────────────────────
-- `asset_id` is polymorphic: a ships.id when asset_kind = 'SHIP', an
-- inventory_items.id when 'ITEM'. It is intentionally not a foreign key.
CREATE TABLE IF NOT EXISTS listings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  asset_kind       VARCHAR(16) NOT NULL,          -- SHIP | ITEM
  asset_id         UUID NOT NULL,
  asset_key        VARCHAR(64) NOT NULL,
  asset_name       VARCHAR(64) NOT NULL,
  category         item_category NOT NULL,
  rarity           SMALLINT NOT NULL CHECK (rarity BETWEEN 0 AND 5),
  price_wei        NUMERIC(78,0) NOT NULL CHECK (price_wei > 0),
  payment_token    VARCHAR(42) NOT NULL DEFAULT '0x0000000000000000000000000000000000000000',
  status           listing_status NOT NULL DEFAULT 'ACTIVE',
  on_chain_id      NUMERIC(78,0),
  views            INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ,
  sold_at          TIMESTAMPTZ,
  buyer_id         UUID REFERENCES players(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_status   ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_seller   ON listings (seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_asset    ON listings (asset_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings (category, status);
CREATE INDEX IF NOT EXISTS idx_listings_rarity   ON listings (rarity, status);
CREATE INDEX IF NOT EXISTS idx_listings_price    ON listings (price_wei);
CREATE INDEX IF NOT EXISTS idx_listings_token    ON listings (on_chain_id);

-- ── p2p_trades ──────────────────────────────────────────────────────────────
-- A two-party state machine. Nothing moves until BOTH sides have confirmed;
-- settlement re-validates every asset and balance inside one transaction.
CREATE TABLE IF NOT EXISTS p2p_trades (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id           UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  counterparty_id        UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  offered_assets         JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_assets       JSONB NOT NULL DEFAULT '[]'::jsonb,
  offered_plasma         BIGINT NOT NULL DEFAULT 0,
  requested_plasma       BIGINT NOT NULL DEFAULT 0,
  status                 trade_status NOT NULL DEFAULT 'PENDING',
  initiator_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,
  counterparty_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  initiator_signature    TEXT,
  counterparty_signature TEXT,
  settled_at             TIMESTAMPTZ,
  cancelled_at           TIMESTAMPTZ,
  tx_hash                VARCHAR(66),
  expires_at             TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (initiator_id <> counterparty_id)
);
CREATE INDEX IF NOT EXISTS idx_trades_initiator    ON p2p_trades (initiator_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_counterparty ON p2p_trades (counterparty_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_status       ON p2p_trades (status, created_at DESC);

-- ── transaction_history ─────────────────────────────────────────────────────
-- Append-only ledger. `currency` is free-form because rows record 'MIXED'
-- (multi-currency rewards) and 'ETH' (marketplace settlement) as well as the
-- three in-game currencies.
CREATE TABLE IF NOT EXISTS transaction_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind          VARCHAR(32) NOT NULL,   -- DISMANTLE|MISSION_REWARD|RUN_REWARD|MARKET_PURCHASE|MARKET_SALE|P2P_TRADE|MINT|FEE
  currency      VARCHAR(16),            -- SCRAP|PLASMA|RIFT_CRYSTAL|MIXED|ETH
  amount        BIGINT NOT NULL DEFAULT 0,
  asset_kind    VARCHAR(16),
  asset_ref     VARCHAR(64),
  counterparty  VARCHAR(42),
  tx_hash       VARCHAR(66),
  chain_id      INTEGER,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_player   ON transaction_history (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_kind     ON transaction_history (kind);
CREATE INDEX IF NOT EXISTS idx_tx_hash     ON transaction_history (tx_hash);

-- ── missions ────────────────────────────────────────────────────────────────
-- Per-player, per-period mission progress. The unique key is what makes the
-- runs module's `ON CONFLICT (player_id, mission_key, period_key)` upsert work.
CREATE TABLE IF NOT EXISTS missions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  mission_key   VARCHAR(64) NOT NULL,
  kind          mission_kind NOT NULL,
  progress      INTEGER NOT NULL DEFAULT 0,
  target        INTEGER NOT NULL,
  completed     BOOLEAN NOT NULL DEFAULT FALSE,
  claimed       BOOLEAN NOT NULL DEFAULT FALSE,
  period_key    VARCHAR(16) NOT NULL,   -- '2026-09-30' | '2026-W40' | 'S01' | 'PERMANENT'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (player_id, mission_key, period_key)
);
CREATE INDEX IF NOT EXISTS idx_mission_player ON missions (player_id, kind, period_key);

-- ── auth_nonces (durable replay-protection fallback) ────────────────────────
-- The auth module keeps live nonces in Redis; this table is the durable
-- fallback for deployments without Redis and for post-incident auditing.
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce          VARCHAR(64) PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes')
);
CREATE INDEX IF NOT EXISTS idx_nonce_wallet ON auth_nonces (wallet_address);

-- ── leaderboard view ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW leaderboard_season AS
SELECT p.id,
       p.wallet_address,
       p.display_name,
       p.level,
       p.season_id,
       p.season_xp,
       RANK() OVER (PARTITION BY p.season_id ORDER BY p.season_xp DESC) AS rank
FROM players p
WHERE p.banned = FALSE;

-- ── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['players','ships','inventory_items','p2p_trades','missions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON %1$s', t);
    EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t);
  END LOOP;
END $$;
