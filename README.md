# ROCKET RIFT: FRONTIER

A free-to-play Web3 rocket shooter. Fly, loot, craft and trade across a procedurally
generated frontier — with **optional** NFT ownership. The game is fully playable with
no wallet and no network; the chain is an enhancement, never a gate.

```
rocket-rift-frontier/
├── client/      Phaser 3 game + React shell (Vite)
├── server/      Express + WebSocket API (authoritative)
├── contracts/   Solidity: ShipNFT, ItemNFT, Marketplace (Hardhat)
└── database/    PostgreSQL schema
```

---

## ▶ Play it now

**https://static.teamily.ai/sites/26501da1-61d8-4a2d-9182-c9472b68f8a2/webpages/rocket-rift-frontier/index.html**

Open it in any modern browser and press **LAUNCH RUN**. No wallet, no install, no
backend required.

The published build runs in **standalone guest mode**: it makes no network calls at
all, progress saves to `localStorage`, and every server-backed surface (marketplace,
trading, leaderboard) degrades to clearly-labelled local/demo data instead of hanging
on a dead request. The top bar reads `○ GUEST MODE` to say so honestly.

| Control | Key |
|---|---|
| Move | `WASD` / arrow keys |
| Fire | `Space` |
| Special ability | `E` |
| Dash | `Shift` |
| Secondary | `Q` |
| Ultimate | `R` |
| Pause | `Esc` |
| Mobile | on-screen virtual joystick + fire / ability / dash buttons |

---

## Quick start

### 0. Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 20 |
| PostgreSQL | ≥ 14 |
| Redis | optional (in-memory fallback ships with the server) |

### 1. Install

```bash
npm install                      # root + all workspaces
```

### 2. Configure

```bash
cp .env.example .env             # server + contracts
cp client/.env.example client/.env
cp server/.env.example server/.env
```

The server boots with safe development defaults, so `.env` is optional locally.
In production `JWT_SECRET` and `SESSION_HMAC_SECRET` are **required** and the
server refuses to start without them.

### 3. Database

```bash
createdb rocket_rift
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/rocket_rift"

npm run db:migrate               # applies database/schema.sql (idempotent)
npm run seed --workspace server  # optional: 6 demo pilots + 12 listings
```

> The schema is written to be re-runnable — `CREATE TABLE IF NOT EXISTS` and
> `CREATE INDEX IF NOT EXISTS` throughout. Applying it twice is safe.

### 4. Run

```bash
npm run dev:server               # API on http://localhost:4000  (ws://localhost:4000/ws)
npm run dev                      # game on http://localhost:5173
```

Open <http://localhost:5173>. The game is playable immediately in **local mode**;
connect a wallet from the top bar to sync progress to the server.

### 5. Build

```bash
npm run build:all                # client bundle + server tsc
npm run typecheck                # both workspaces
```

To reproduce the published standalone build:

```bash
cd client && VITE_API_URL= VITE_STANDALONE=true npx vite build
# then serve client/dist/ from any static host
```

---

## Sepolia deployment

The contract suite is **ready to deploy in one command** but is **not yet deployed**,
because deployment requires a credential this environment does not have.

### Status

| Item | Value |
|---|---|
| Network | Sepolia (chainId `11155111`) |
| RPC | `https://ethereum-sepolia-rpc.publicnode.com` (live, no API key) |
| ShipNFT | `0x0000000000000000000000000000000000000000` — **pending** |
| ItemNFT | `0x0000000000000000000000000000000000000000` — **pending** |
| Marketplace | `0x0000000000000000000000000000000000000000` — **pending** |
| Blocker | **`DEPLOYER_PRIVATE_KEY` — a funded Sepolia key is required** |

### ⚠️ The missing credential

Deploying needs **one** thing that cannot be generated here: a **private key for an
account holding Sepolia ETH** (to pay gas). No funded key exists in this environment,
and no credential profile is connected, so the deployment cannot be completed.

Everything else is done and proven. The pipeline was verified end-to-end against a
local Hardhat node — **21/21 read-back checks pass** (owner, name, symbol, fee,
treasury, allow-list, bytecode present at every address). Against Sepolia the same
script connects, derives the account, and stops cleanly at the balance guard:

```
Network      : sepolia (chainId 11155111)
Deployer     : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Balance      : 0.0 ETH
✖ Deployer 0x7099…79C8 has 0 ETH on sepolia — it cannot pay gas.
  Fund it, then re-run this command.
  Sepolia ETH faucets: https://sepoliafaucet.com  |  https://www.alchemy.com/faucets/ethereum-sepolia
```

**To finish the deployment:** fund an account from a Sepolia faucet, put its key in
`.env` as `DEPLOYER_PRIVATE_KEY`, and run the command below. The addresses are then
written into `client/.env` and `server/.env` automatically — no hand-editing.

### Deploy (one command)

```bash
DEPLOYER_PRIVATE_KEY=<funded-key> WRITE_ENV=1 npm run deploy:sepolia --workspace contracts \
  && npm run verify:sepolia --workspace contracts
```

`WRITE_ENV=1` rewrites `CHAIN_ID` / `SHIP_NFT_ADDRESS` / `ITEM_NFT_ADDRESS` /
`MARKETPLACE_ADDRESS` in `.env` and `server/.env`, and the `VITE_*` equivalents in
`client/.env`, preserving every other line. Rebuild the client afterwards so Vite
inlines the new addresses.

The deploy writes a machine-readable record to `contracts/deployments/<network>.json`
and prints the exact `.env` block. `verify:sepolia` re-reads the chain and asserts the
wiring independently of the deploy script's own output — it exits non-zero on any
mismatch, so it is safe in CI.

### Local dry run (no credentials needed)

```bash
npx hardhat node --config contracts/hardhat.config.ts   # terminal 1
npm run deploy:local --workspace contracts              # terminal 2
npm run verify:deployment --workspace contracts -- --network localhost
```

### Note on the RPC default

The previous default, `https://rpc.sepolia.org`, is **dead** — it returns an Apache
404, which Hardhat surfaces as `HH110: Invalid JSON-RPC response`. The default is now
`https://ethereum-sepolia-rpc.publicnode.com`, which is live and needs no API key.
Override with `RPC_URL` for a dedicated provider (Alchemy/Infura) in production.

---

## Architecture

### The client is a renderer, never an authority

Every number that pays out — currency, ownership, mission completion, run rewards —
is decided by the server. The client's save file is a **cache** of server state so
the game works offline; on any conflict the server wins.

### Anti-cheat: four layers

Run submissions are treated as *claims*, and every claim is checked independently:

1. **HMAC** — the run summary is signed with a per-session key derived from the
   server secret. A tampered payload fails the MAC.
2. **Structure** — the numbers must be internally consistent (kills ≤ damage,
   sectors reachable in the elapsed time, boss kill implies a boss sector).
3. **Density** — score/kill/XP/damage/loot rates must be physically plausible for
   the elapsed time. This is what catches `score: 999999999`.
4. **Ownership & balance** — rewards are only granted for assets the server can
   prove the player owns; spends are re-validated inside a transaction.

A flagged run is recorded as evidence but **never rewarded**.

### Server-authoritative sessions

`POST /api/runs/start` issues the seed and session id — the client never picks its
own seed, so it cannot pre-compute a favourable galaxy. `POST /api/runs/submit`
adjudicates and pays out atomically.

---

## API surface

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | db / redis / ws status |
| `GET` | `/api/auth/nonce?address=` | one-time sign-in nonce |
| `POST` | `/api/auth/verify` | wallet signature → JWT |
| `GET` | `/api/players/me` | profile + fleet + inventory |
| `PATCH` | `/api/players/me` | display name |
| `GET` | `/api/players/leaderboard` | season ranking |
| `GET` | `/api/inventory` | owned items |
| `POST` | `/api/inventory/:id/dismantle` | → Scrap |
| `POST` | `/api/inventory/:id/equip` | one per category |
| `GET` | `/api/missions` | current-period progress |
| `POST` | `/api/missions/:key/claim` | re-verified server-side |
| `POST` | `/api/runs/start` | server issues seed + session |
| `POST` | `/api/runs/submit` | adjudicated payout |
| `GET` | `/api/marketplace/listings` | public browse |
| `POST` | `/api/marketplace/listings` | escrows the asset |
| `DELETE` | `/api/marketplace/listings/:id` | releases escrow |
| `POST` | `/api/marketplace/listings/:id/buy` | settles + records fee |
| `GET`/`POST` | `/api/trades` | P2P offers |
| `POST` | `/api/trades/:id/confirm` | both sides must confirm |
| `DELETE` | `/api/trades/:id` | cancel |
| `WS` | `/ws` | live events + presence |

---

## Contracts

```bash
npm run contracts:compile
npm run contracts:test
npm run deploy:sepolia --workspace contracts     # requires a funded DEPLOYER_PRIVATE_KEY
npm run verify:sepolia --workspace contracts     # read-back assertions
```

> The Hardhat config pins Solidity **0.8.24** with `evmVersion: 'cancun'` and
> `viaIR: true`. All three are required, not stylistic: OpenZeppelin v5 declares
> `^0.8.24`, uses the Cancun `mcopy` opcode, and `ShipNFT`'s stat-struct mint
> path overflows the legacy codegen's stack.

`ShipNFT` and `ItemNFT` are ERC-721 with on-chain stat structs; `Marketplace`
handles escrowed sales with a configurable fee (default 2.5%). The database
remains the source of truth for in-game ownership; the chain is the source of
truth for the token.

---

## Verification status

Verified locally, end to end:

| Check | Result |
|---|---|
| `database/schema.sql` applies to Postgres | ✅ applied + re-applied (idempotent), seeded with 6 pilots / 12 listings |
| Server API smoke test (21 assertions) | ✅ all pass — wallet auth, profile, missions, run submit, anti-cheat rejection, marketplace escrow |
| Client production build (`tsc` + `vite build`) | ✅ succeeds |
| Server typecheck | ✅ clean |
| `hardhat compile` + `hardhat test` | ✅ 45 files compiled, 4/4 tests pass |
| Deploy + read-back verify (local Hardhat node) | ✅ 21/21 checks pass |
| Published web build loads and plays in a real browser | ✅ command centre + live run render, HUD shows Raptor-X stats |
| Sepolia deployment | ⛔ **blocked — needs a funded `DEPLOYER_PRIVATE_KEY`** |

The API smoke test ships with the repo — with the server and Postgres running:

```bash
node server/scripts/e2e-smoke.mjs      # 21 assertions, prints PASS/FAIL per line
```

---

## Design

See **[DESIGN.md](./DESIGN.md)** for the game loop, the three-layer economy, and
the Season 01 "THE VOID WAR" arc.

## License

MIT
