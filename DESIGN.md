# ROCKET RIFT: FRONTIER — Design Document

## 1. Pillars

1. **Playable first.** The game is complete and fun with no wallet, no network and
   no purchase. Web3 is an *optional* layer on top.
2. **Skill over spend.** Rarity is a cosmetic + sidegrade axis. It never gates
   content, and a level-1 pilot in the starter hull can out-fly a maxed one.
3. **The server is the truth.** Anything that pays out is decided server-side.

---

## 2. The game loop

```
        ┌──────────────────────────────────────────────────────┐
        │                                                      │
   LAUNCH ──▶ FLY SECTOR ──▶ KILL / LOOT ──▶ CLEAR SECTOR ──▶ BOSS (every 5th)
        ▲          │              │               │              │
        │          │              ▼               │              ▼
        │          │         SCRAP + XP           │        PLASMA + RIFT CRYSTAL
        │          │              │               │              │
        │          ▼              ▼               ▼              ▼
        │      DIE / EXTRACT ──▶ VERIFIED RUN ──▶ MISSIONS ──▶ REWARDS
        │                             │
        │                             ▼
        └──────────── HANGAR: UPGRADE · CRAFT · EQUIP ◀──────────┘
                                      │
                                      ▼
                              MARKET / P2P TRADE
```

**A run** is a chain of sectors. Each sector spawns a wave scaled by
`difficultyPerSector`; clearing `killsToClear` opens the next. Every 5th sector is
a boss with multi-phase behaviour. Dying ends the run; the summary is signed and
submitted for adjudication.

**Between runs** the player spends what they earned: upgrade points into hull
stats, materials into crafting recipes, and currency into the market.

### Progression curves

| System | Curve |
|---|---|
| Player level | `xpForLevel(n) = 120 · n^1.45`, cap 60 |
| Ship level | +6% health, +5% shield/damage, +2% fire rate, +1% speed per level |
| Upgrade cost | `base · (points+1)^exponent` — superlinear, so specialising is a real choice |
| Season tier | 2,500 season XP per tier |

Growth is deliberately gentle: a level-60 hull is strong but never invalidates
another player's skill.

---

## 3. Economy — three layers

The economy is stratified so that **gameplay, premium and blockchain value never
leak into each other**. Each layer has its own source, sink and failure mode.

### Layer 1 — Gameplay resources (earned, non-transferable)

| Currency | Source | Sink |
|---|---|---|
| **Scrap** | kills, loot, dismantling | common upgrades, crafting fees |
| **XP** | kills, missions, runs | levels (never spent, only accumulated) |
| **Materials** | loot drops, mission rewards | crafting inputs |

Scrap is the workhorse: earned constantly, spent constantly. It is *not*
tradeable, which keeps the market from becoming a Scrap exchange.

### Layer 2 — Premium currency (earned slowly, or bought)

| Currency | Source | Sink |
|---|---|---|
| **Plasma** | bosses, missions, dismantling | rare crafting, P2P trades |
| **Rift Crystals** | boss kills, season tiers | cosmetics, season pass |

Plasma is the mid-tier: scarce enough to matter, earnable enough that a
free-to-play pilot is never locked out. Rift Crystals are the seasonal currency —
**only bosses pay them out**, which ties the premium layer to the hardest content
rather than to a store page.

### Layer 3 — Blockchain assets (owned, transferable)

| Asset | Standard | Notes |
|---|---|---|
| **Ships** | ERC-721 `ShipNFT` | stat struct stored on-chain, x100 fixed-point |
| **Items** | ERC-721 `ItemNFT` | weapons, skins, equipment, collectibles |
| **Listings** | `Marketplace` | escrowed sale, 2.5% fee |

The chain is the source of truth for **the token**; the database is the source of
truth for **in-game ownership**. A listing escrows the asset (`state = LISTED`),
so it cannot be equipped, dismantled or traded while it is for sale. Settlement is
a single transaction that moves ownership and records the fee.

**Anti-inflation rule:** nothing in Layer 1 or 2 can be converted into Layer 3
without a deliberate, priced action. Rewards are clamped to density ceilings
server-side, so a compromised client cannot mint value.

---

## 4. Season 01 — "THE VOID WAR"

**Premise.** The Rift opened six months ago. Something on the other side has been
*counting* — and it has finished. The Void Titan's vanguard is pouring through the
frontier, and the only thing standing between it and the core worlds is a fleet of
salvage pilots flying hulls held together with scrap and stubbornness.

**Arc — three acts, ten weeks.**

| Act | Weeks | Beat |
|---|---|---|
| **I — The Breach** | 1–3 | Vanguard scouts appear in the outer sectors. Pilots are hired to map the incursion. The Void Reaver hull is first salvaged here. |
| **II — The Counting** | 4–7 | The Titan's *tally* is discovered: it is cataloguing every pilot it kills. Bosses gain phases. The Chronos prototype is fielded. |
| **III — The Rift Cascade** | 8–10 | The Titan itself enters the frontier. Seasonal missions culminate in a server-wide kill objective. |

**Seasonal reward track.** 2,500 season XP per tier. Every 5th tier pays Rift
Crystals; every tier pays Scrap and Plasma. The track is **earn-only** — no tier
is purchasable, so the season measures play, not spend.

**Seasonal missions** (server-defined, so a client cannot invent a reward):

| Key | Target | Reward |
|---|---|---|
| `season_void_war_1` | 50 kills | 5,000 XP · 2,000 Scrap · 100 Plasma · 5 RC |
| `season_void_war_2` | 10 bosses | 8,000 XP · 3,000 Scrap · 150 Plasma · 10 RC |
| `season_void_war_3` | reach sector 50 | 15,000 XP · 5,000 Scrap · 250 Plasma · 25 RC |

**Narrative delivery.** No cutscenes. The story is told through mission
descriptions, boss phase names, and the salvage logs attached to the hulls you
recover — the frontier is characterised by what it leaves behind.

---

## 5. Anti-cheat design

The governing principle: **the client is never trusted**. See README §Architecture
for the four layers. The design consequence is that the client can be fully
open-source and fully inspectable without weakening the economy — there is nothing
in it worth stealing, because it holds no authority.

## 6. Accessibility & performance

- Keyboard, mouse and touch (virtual joystick) input, all rebindable.
- `reducedMotion` and `screenShake` toggles; damage numbers can be disabled.
- Fixed 1280×720 logical resolution with a camera that follows the player, so the
  playfield is wider than the viewport without a resolution-dependent ruleset.
- Procedural textures (no image assets) keep the initial bundle small.
