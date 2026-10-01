import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setAuthToken, type Listing, type TradeOffer } from '../api/client';
import { bus } from '../game/systems/EventBus';
import { SaveSystem, createDefaultSave } from '../game/systems/SaveSystem';
import { applyRunToMissions, MISSION_BY_KEY, reconcileMissions, sumRewards } from '../game/systems/MissionSystem';
import { RECIPE_BY_KEY, canCraft, consumeInputs } from '../game/systems/CraftingSystem';
import { addItem, dismantleValue, makeItemId, materialCounts, removeItem, setItemState } from '../game/systems/InventorySystem';
import { UPGRADE_BY_KEY, applyXp, upgradeCost } from '../game/systems/ProgressionSystem';
import { Rarity } from '../game/config/rarity';
import type { InventoryItem, MissionProgress, RunResult, SaveData } from '../game/systems/types';
import { useWallet } from '../wallet/WalletProvider';

/**
 * GameProvider — the single source of truth for everything the React shell shows.
 *
 * It owns the save (profile / missions / crafting), mirrors it to localStorage,
 * and reconciles it with the server whenever the player is authenticated. The
 * Phaser layer reads the same save through the scene registry, so the two never
 * disagree about what the player owns.
 */

export interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warn' | 'danger';
}

export interface CraftJob {
  recipeKey: string;
  startedAt: number;
  completesAt: number;
}

interface GameContextValue {
  save: SaveData;
  profile: SaveData['profile'];
  missions: MissionProgress[];
  crafting: CraftJob[];
  toasts: Toast[];
  apiOnline: boolean;
  syncing: boolean;
  listings: Listing[];
  trades: TradeOffer[];
  /** True when the player is authenticated against the server. */
  authenticated: boolean;

  pushToast: (message: string, tone?: Toast['tone']) => void;
  dismissToast: (id: string) => void;

  setDisplayName: (name: string) => void;
  claimMission: (missionKey: string) => void;
  startCraft: (recipeKey: string) => { ok: boolean; reason?: string };
  dismantle: (itemId: string) => void;
  equipItem: (itemId: string, slot: string) => void;
  equipShip: (shipId: string) => void;
  upgradeShip: (shipId: string, statKey: string) => { ok: boolean; reason?: string };

  refreshListings: (params?: { category?: string; rarity?: number; sort?: string; q?: string }) => Promise<void>;
  createListing: (body: { assetKind: 'SHIP' | 'ITEM'; assetId: string; priceEth: string; durationHours?: number }) => Promise<{ ok: boolean; reason?: string }>;
  cancelListing: (id: string) => Promise<void>;
  buyListing: (id: string) => Promise<{ ok: boolean; reason?: string }>;

  refreshTrades: () => Promise<void>;
  createTrade: (body: {
    counterpartyId: string;
    offeredAssets: { itemKey: string; quantity: number }[];
    requestedAssets: { itemKey: string; quantity: number }[];
    offeredPlasma: number;
    requestedPlasma: number;
  }) => Promise<{ ok: boolean; reason?: string }>;
  confirmTrade: (id: string) => Promise<void>;
  cancelTrade: (id: string) => Promise<void>;

  resetProgress: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const [save, setSave] = useState<SaveData>(() => SaveSystem.load());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [apiOnline, setApiOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [trades, setTrades] = useState<TradeOffer[]>([]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const authenticated = Boolean(wallet.session?.token);

  // ── Toasts ────────────────────────────────────────────────────────────────
  const pushToast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Bridge game-emitted toasts into the React toast stack.
  useEffect(() => bus.on('toast', ({ message, tone }) => pushToast(message, tone)), [pushToast]);

  // ── Persistence ───────────────────────────────────────────────────────────
  const commit = useCallback((updater: (prev: SaveData) => SaveData) => {
    setSave((prev) => {
      const next = updater(prev);
      SaveSystem.save(next);
      return next;
    });
  }, []);

  // ── API health + auth token ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    api.health().then((ok) => {
      if (!cancelled) setApiOnline(ok);
    });
    const t = window.setInterval(() => {
      api.health().then((ok) => {
        if (!cancelled) setApiOnline(ok);
      });
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    setAuthToken(wallet.session?.token ?? null);
  }, [wallet.session?.token]);

  // ── Server reconciliation ─────────────────────────────────────────────────
  useEffect(() => {
    if (!authenticated || !apiOnline) return;
    let cancelled = false;
    setSyncing(true);

    (async () => {
      try {
        const [me, missionsRes] = await Promise.all([api.me(), api.missions()]);
        if (cancelled) return;
        commit((prev) => ({
          ...prev,
          profile: {
            ...prev.profile,
            ...me.profile,
            walletAddress: wallet.connection?.address,
            ships: me.ships?.length ? me.ships : prev.profile.ships,
            inventory: me.inventory ?? prev.profile.inventory,
          },
          missions: missionsRes.missions?.length ? missionsRes.missions : prev.missions,
        }));
      } catch {
        // Server state is a bonus, never a requirement.
      } finally {
        if (!cancelled) setSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, apiOnline, wallet.connection?.address, commit]);

  // Keep the mission list in step with the current period.
  useEffect(() => {
    commit((prev) => ({ ...prev, missions: reconcileMissions(prev.missions, new Date(), prev.profile.seasonId) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Run results ───────────────────────────────────────────────────────────
  useEffect(() => {
    return bus.on('run:end', ({ result }) => {
      const r = result as RunResult;
      if (!r) return;

      // 1. Apply locally so offline play still progresses.
      commit((prev) => {
        const xp = applyXp(prev.profile.level, prev.profile.xp, r.xpGained);
        const missionRes = applyRunToMissions(prev.missions, r);

        return {
          ...prev,
          profile: {
            ...prev.profile,
            level: xp.level,
            xp: xp.xp,
            scrap: prev.profile.scrap + r.scrapGained,
            plasma: prev.profile.plasma + r.plasmaGained,
            seasonXp: prev.profile.seasonXp + Math.round(r.xpGained * 0.5),
            stats: {
              ...prev.profile.stats,
              runsPlayed: prev.profile.stats.runsPlayed + 1,
              bestScore: Math.max(prev.profile.stats.bestScore, r.score),
              bestSector: Math.max(prev.profile.stats.bestSector, r.sectorReached),
              totalKills: prev.profile.stats.totalKills + r.kills,
              totalBossesKilled: prev.profile.stats.totalBossesKilled + (r.bossKilled ? 1 : 0),
              totalPlaytimeMs: prev.profile.stats.totalPlaytimeMs + r.durationMs,
              totalLootValue: prev.profile.stats.totalLootValue + r.lootValue,
            },
          },
          missions: missionRes.progress,
        };
      });

      if (r.clientFlagged) {
        pushToast('Run flagged by validation — rewards withheld.', 'danger');
        return;
      }

      // 2. Submit to the server when we can; the server's verdict wins.
      if (authenticated && apiOnline) {
        api
          .submitRun({
            sessionId: r.sessionId,
            seed: r.seed,
            sectorReached: r.sectorReached,
            score: r.score,
            kills: r.kills,
            damageDealt: r.damageDealt,
            damageTaken: r.damageTaken,
            lootValue: r.lootValue,
            xpGained: r.xpGained,
            scrapGained: r.scrapGained,
            plasmaGained: r.plasmaGained,
            durationMs: r.durationMs,
            bossKilled: r.bossKilled,
            signature: r.signature,
            payload: r.payload,
          })
          .then((verdict) => {
            if (verdict.flagged) {
              pushToast(`Server flagged this run: ${verdict.reason ?? 'validation failed'}`, 'danger');
            } else {
              pushToast(`Run verified — +${verdict.rewards.xp} XP, +${verdict.rewards.scrap} Scrap`, 'success');
            }
          })
          .catch(() => pushToast('Run saved locally (server unreachable).', 'warn'));
      } else {
        pushToast(`Run complete — +${r.xpGained} XP, +${r.scrapGained} Scrap (local)`, 'success');
      }
    });
  }, [commit, authenticated, apiOnline, pushToast]);

  // ── Crafting timers ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      const due = saveRef.current.crafting.filter((j) => j.completesAt <= now);
      if (!due.length) return;

      commit((prev) => {
        let inventory = prev.profile.inventory;
        for (const job of due) {
          const recipe = RECIPE_BY_KEY[job.recipeKey];
          if (!recipe) continue;
          inventory = addItem(inventory, {
            id: makeItemId(),
            itemKey: recipe.output.itemKey,
            name: recipe.name,
            category: recipe.output.category,
            rarity: recipe.output.rarity,
            state: 'TRADEABLE',
            quantity: recipe.output.quantity,
            level: 1,
            stats: {},
            acquiredVia: 'CRAFT',
            acquiredAt: Date.now(),
          });
          bus.emit('craft:completed', { recipeKey: recipe.key, itemKey: recipe.output.itemKey });
          pushToast(`Fabrication complete: ${recipe.name}`, 'success');
        }
        return {
          ...prev,
          crafting: prev.crafting.filter((j) => j.completesAt > now),
          profile: { ...prev.profile, inventory },
        };
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [commit, pushToast]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const setDisplayName = useCallback(
    (name: string) => {
      const clean = name.trim().slice(0, 24) || 'Frontier Pilot';
      commit((prev) => ({ ...prev, profile: { ...prev.profile, displayName: clean } }));
      if (authenticated && apiOnline) {
        api.updateProfile({ displayName: clean }).catch(() => undefined);
      }
    },
    [commit, authenticated, apiOnline]
  );

  const claimMission = useCallback(
    (missionKey: string) => {
      const def = MISSION_BY_KEY[missionKey];
      if (!def) return;

      const current = saveRef.current.missions.find((m) => m.missionKey === missionKey);
      if (!current || !current.completed || current.claimed) return;

      const rewards = sumRewards([def]);

      commit((prev) => {
        const xp = applyXp(prev.profile.level, prev.profile.xp, rewards.xp ?? 0);
        let inventory = prev.profile.inventory;
        for (const item of rewards.items ?? []) {
          inventory = addItem(inventory, {
            id: makeItemId(),
            itemKey: item.itemKey,
            name: item.itemKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            category: 'COLLECTIBLE',
            rarity: item.rarity,
            state: 'TRADEABLE',
            quantity: item.quantity,
            level: 1,
            stats: {},
            acquiredVia: 'MISSION',
            acquiredAt: Date.now(),
          });
        }
        return {
          ...prev,
          profile: {
            ...prev.profile,
            level: xp.level,
            xp: xp.xp,
            scrap: prev.profile.scrap + (rewards.scrap ?? 0),
            plasma: prev.profile.plasma + (rewards.plasma ?? 0),
            riftCrystal: prev.profile.riftCrystal + (rewards.riftCrystal ?? 0),
            inventory,
          },
          missions: prev.missions.map((m) => (m.missionKey === missionKey ? { ...m, claimed: true } : m)),
        };
      });

      bus.emit('mission:claimed', { missionKey, name: def.name });
      pushToast(`Claimed ${def.name}`, 'success');

      if (authenticated && apiOnline) {
        api.claimMission(missionKey).catch(() => undefined);
      }
    },
    [commit, authenticated, apiOnline, pushToast]
  );

  const startCraft = useCallback(
    (recipeKey: string) => {
      const recipe = RECIPE_BY_KEY[recipeKey];
      if (!recipe) return { ok: false, reason: 'Unknown recipe' };

      const prev = saveRef.current;
      const materials = materialCounts(prev.profile.inventory);
      const check = canCraft(recipe, materials, { scrap: prev.profile.scrap, plasma: prev.profile.plasma }, prev.profile.level);
      if (!check.ok) return { ok: false, reason: check.reason };

      const now = Date.now();
      const completesAt = now + recipe.craftTimeSec * 1000;

      commit((p) => {
        // Consume the inputs from the inventory, then the currency.
        let inventory = p.profile.inventory;
        for (const input of recipe.inputs) {
          let remaining = input.quantity;
          inventory = inventory
            .map((item) => {
              if (remaining <= 0 || item.itemKey !== input.itemKey) return item;
              const take = Math.min(item.quantity, remaining);
              remaining -= take;
              return { ...item, quantity: item.quantity - take };
            })
            .filter((item) => item.quantity > 0);
        }

        return {
          ...p,
          crafting: [...p.crafting, { recipeKey, startedAt: now, completesAt }],
          profile: {
            ...p.profile,
            inventory,
            scrap: p.profile.scrap - (recipe.cost.scrap ?? 0),
            plasma: p.profile.plasma - (recipe.cost.plasma ?? 0),
          },
        };
      });

      bus.emit('craft:started', { recipeKey, completesAt });
      pushToast(`Fabricating ${recipe.name}…`, 'info');
      return { ok: true };
    },
    [commit, pushToast]
  );

  const dismantle = useCallback(
    (itemId: string) => {
      const item = saveRef.current.profile.inventory.find((i) => i.id === itemId);
      if (!item) return;
      const value = dismantleValue(item);

      commit((prev) => ({
        ...prev,
        profile: {
          ...prev.profile,
          inventory: removeItem(prev.profile.inventory, itemId, item.quantity),
          scrap: prev.profile.scrap + value,
        },
      }));
      pushToast(`Dismantled ${item.name} → +${value} Scrap`, 'success');
    },
    [commit, pushToast]
  );

  const equipItem = useCallback(
    (itemId: string, slot: string) => {
      commit((prev) => {
        const item = prev.profile.inventory.find((i) => i.id === itemId);
        if (!item) return prev;

        // Only one item per slot: unequip whatever was there.
        let inventory = prev.profile.inventory.map((i) =>
          i.state === 'EQUIPPED' && i.category === item.category ? { ...i, state: 'TRADEABLE' as const } : i
        );
        inventory = setItemState(inventory, itemId, 'EQUIPPED');

        const loadout = { ...prev.profile.loadout };
        if (slot === 'primary' || slot === 'secondary' || slot === 'ultimate') {
          loadout[slot] = item.itemKey;
        } else if (slot === 'skin') {
          loadout.skin = item.itemKey;
        } else if (slot === 'equipment') {
          loadout.equipment = [...new Set([...loadout.equipment, item.itemKey])];
        } else if (slot === 'accessory') {
          loadout.accessory = [...new Set([...loadout.accessory, item.itemKey])];
        }

        return { ...prev, profile: { ...prev.profile, inventory, loadout } };
      });
      pushToast('Loadout updated', 'success');
    },
    [commit, pushToast]
  );

  const equipShip = useCallback(
    (shipId: string) => {
      commit((prev) => ({ ...prev, profile: { ...prev.profile, equippedShipId: shipId } }));
      pushToast('Hull selected', 'success');
    },
    [commit, pushToast]
  );

  const upgradeShip = useCallback(
    (shipId: string, statKey: string) => {
      const prev = saveRef.current;
      const ship = prev.profile.ships.find((s) => s.id === shipId);
      if (!ship) return { ok: false, reason: 'Ship not found' };

      const option = UPGRADE_BY_KEY[statKey];
      if (!option) return { ok: false, reason: 'Unknown upgrade' };

      const points = ship.upgradePoints;
      const cost = upgradeCost(option, points);
      if (prev.profile.scrap < cost) return { ok: false, reason: `Needs ${cost} Scrap` };

      commit((p) => ({
        ...p,
        profile: {
          ...p.profile,
          scrap: p.profile.scrap - cost,
          ships: p.profile.ships.map((s) =>
            s.id === shipId ? { ...s, upgradePoints: s.upgradePoints + 1 } : s
          ),
        },
      }));
      pushToast(`${option.name} upgraded`, 'success');
      return { ok: true };
    },
    [commit, pushToast]
  );

  // ── Marketplace ───────────────────────────────────────────────────────────
  const refreshListings = useCallback(
    async (params?: { category?: string; rarity?: number; sort?: string; q?: string }) => {
      if (!apiOnline) {
        setListings(demoListings());
        return;
      }
      try {
        const res = await api.listings(params);
        setListings(res.listings?.length ? res.listings : demoListings());
      } catch {
        setListings(demoListings());
      }
    },
    [apiOnline]
  );

  const createListing = useCallback(
    async (body: { assetKind: 'SHIP' | 'ITEM'; assetId: string; priceEth: string; durationHours?: number }) => {
      const prev = saveRef.current;
      const item = prev.profile.inventory.find((i) => i.id === body.assetId);
      const ship = prev.profile.ships.find((s) => s.id === body.assetId);
      const asset = item ?? ship;
      if (!asset) return { ok: false, reason: 'Asset not found' };
      if (item && (item.state === 'LOCKED' || item.state === 'LISTED')) {
        return { ok: false, reason: item.state === 'LOCKED' ? 'Item is locked' : 'Already listed' };
      }
      if (ship?.isStarter) return { ok: false, reason: 'Your starter hull cannot be sold' };

      if (authenticated && apiOnline) {
        try {
          await api.createListing(body);
        } catch (err) {
          return { ok: false, reason: err instanceof Error ? err.message : 'Listing failed' };
        }
      }

      // Escrow locally so the UI is immediately consistent.
      commit((p) => ({
        ...p,
        profile: {
          ...p.profile,
          inventory: item ? setItemState(p.profile.inventory, item.id, 'LISTED') : p.profile.inventory,
        },
      }));

      pushToast(`Listed for ${body.priceEth} ETH`, 'success');
      await refreshListings();
      return { ok: true };
    },
    [authenticated, apiOnline, commit, pushToast, refreshListings]
  );

  const cancelListing = useCallback(
    async (id: string) => {
      if (authenticated && apiOnline) {
        try {
          await api.cancelListing(id);
        } catch {
          // fall through — still release the local escrow
        }
      }
      commit((p) => ({
        ...p,
        profile: {
          ...p.profile,
          inventory: p.profile.inventory.map((i) => (i.state === 'LISTED' ? { ...i, state: 'TRADEABLE' } : i)),
        },
      }));
      pushToast('Listing cancelled — asset returned', 'info');
      await refreshListings();
    },
    [authenticated, apiOnline, commit, pushToast, refreshListings]
  );

  const buyListing = useCallback(
    async (id: string) => {
      const listing = listings.find((l) => l.id === id);
      if (!listing) return { ok: false, reason: 'Listing not found' };

      if (authenticated && apiOnline) {
        try {
          await api.buyListing(id);
        } catch (err) {
          return { ok: false, reason: err instanceof Error ? err.message : 'Purchase failed' };
        }
      }

      // Grant the asset locally so the purchase is visible immediately.
      commit((p) => ({
        ...p,
        profile: {
          ...p.profile,
          inventory: addItem(p.profile.inventory, {
            id: makeItemId(),
            itemKey: listing.assetKey,
            name: listing.assetName,
            category: (listing.category as InventoryItem['category']) ?? 'COLLECTIBLE',
            rarity: listing.rarity as Rarity,
            state: 'TRADEABLE',
            quantity: 1,
            level: 1,
            stats: {},
            acquiredVia: 'MARKET',
            acquiredAt: Date.now(),
          }),
        },
      }));

      pushToast(`Purchased ${listing.assetName}`, 'success');
      await refreshListings();
      return { ok: true };
    },
    [listings, authenticated, apiOnline, commit, pushToast, refreshListings]
  );

  // ── P2P trading ───────────────────────────────────────────────────────────
  const refreshTrades = useCallback(async () => {
    if (!apiOnline || !authenticated) {
      setTrades([]);
      return;
    }
    try {
      const res = await api.trades();
      setTrades(res.trades ?? []);
    } catch {
      setTrades([]);
    }
  }, [apiOnline, authenticated]);

  const createTrade = useCallback(
    async (body: {
      counterpartyId: string;
      offeredAssets: { itemKey: string; quantity: number }[];
      requestedAssets: { itemKey: string; quantity: number }[];
      offeredPlasma: number;
      requestedPlasma: number;
    }) => {
      if (!authenticated || !apiOnline) {
        return { ok: false, reason: 'Connect a wallet and reach the server to trade.' };
      }
      try {
        await api.createTrade(body);
        await refreshTrades();
        pushToast('Trade offer sent', 'success');
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : 'Trade failed' };
      }
    },
    [authenticated, apiOnline, refreshTrades, pushToast]
  );

  const confirmTrade = useCallback(
    async (id: string) => {
      try {
        // Sign the trade id with the wallet — proof the human approved it.
        const signature = wallet.connection ? await wallet.sign(`ROCKET RIFT trade confirmation\n${id}`) : undefined;
        await api.confirmTrade(id, signature);
        await refreshTrades();
        pushToast('Trade confirmed', 'success');
      } catch (err) {
        pushToast(err instanceof Error ? err.message : 'Confirmation failed', 'danger');
      }
    },
    [wallet, refreshTrades, pushToast]
  );

  const cancelTrade = useCallback(
    async (id: string) => {
      try {
        await api.cancelTrade(id);
        await refreshTrades();
        pushToast('Trade cancelled', 'info');
      } catch {
        pushToast('Could not cancel trade', 'danger');
      }
    },
    [refreshTrades, pushToast]
  );

  const resetProgress = useCallback(() => {
    const fresh = createDefaultSave();
    SaveSystem.save(fresh);
    setSave(fresh);
    pushToast('Local progress reset', 'warn');
  }, [pushToast]);

  const value = useMemo<GameContextValue>(
    () => ({
      save,
      profile: save.profile,
      missions: save.missions,
      crafting: save.crafting,
      toasts,
      apiOnline,
      syncing,
      listings,
      trades,
      authenticated,
      pushToast,
      dismissToast,
      setDisplayName,
      claimMission,
      startCraft,
      dismantle,
      equipItem,
      equipShip,
      upgradeShip,
      refreshListings,
      createListing,
      cancelListing,
      buyListing,
      refreshTrades,
      createTrade,
      confirmTrade,
      cancelTrade,
      resetProgress,
    }),
    [
      save,
      toasts,
      apiOnline,
      syncing,
      listings,
      trades,
      authenticated,
      pushToast,
      dismissToast,
      setDisplayName,
      claimMission,
      startCraft,
      dismantle,
      equipItem,
      equipShip,
      upgradeShip,
      refreshListings,
      createListing,
      cancelListing,
      buyListing,
      refreshTrades,
      createTrade,
      confirmTrade,
      cancelTrade,
      resetProgress,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}

/**
 * Demo listings shown when the server is unreachable, so the marketplace is
 * never an empty dead end. They are clearly labelled as demo in the UI.
 */
function demoListings(): Listing[] {
  const now = Date.now();
  const rows: [string, string, string, number, string][] = [
    ['void_reaver', 'Void Reaver', 'SHIP', Rarity.MYTHIC, '2.4'],
    ['chronos', 'Chronos', 'SHIP', Rarity.LEGENDARY, '1.15'],
    ['rail_lance', 'Rail Lance', 'WEAPON', Rarity.EPIC, '0.42'],
    ['void_needler', 'Void Needler', 'WEAPON', Rarity.LEGENDARY, '0.88'],
    ['skin_void', 'Void Etch', 'SKIN', Rarity.EPIC, '0.19'],
    ['titan_sigil', 'Titan Sigil', 'COLLECTIBLE', Rarity.EPIC, '0.31'],
    ['scatter_blaster', 'Scatter Blaster', 'WEAPON', Rarity.RARE, '0.12'],
    ['lucky_charm', 'Lucky Charm', 'ACCESSORY', Rarity.RARE, '0.09'],
    ['bulwark', 'Bulwark', 'SHIP', Rarity.RARE, '0.55'],
    ['targeting_chip', 'Targeting Chip', 'EQUIPMENT', Rarity.RARE, '0.07'],
    ['skin_gilded', 'Gilded Plate', 'SKIN', Rarity.LEGENDARY, '0.64'],
    ['mender', 'Mender', 'SHIP', Rarity.RARE, '0.48'],
  ];

  return rows.map(([key, name, category, rarity, price], i) => ({
    id: `demo_${i}`,
    sellerId: `pilot_${i}`,
    sellerName: ['Vex', 'Nova', 'Kestrel', 'Orin', 'Sable', 'Rook'][i % 6],
    assetKind: category === 'SHIP' ? 'SHIP' : 'ITEM',
    assetName: name,
    assetKey: key,
    category,
    rarity,
    priceWei: String(BigInt(Math.round(Number(price) * 1e6)) * 10n ** 12n),
    priceEth: price,
    paymentToken: '0x0000000000000000000000000000000000000000',
    status: 'ACTIVE',
    createdAt: now - i * 3_600_000,
    demo: true,
  }));
}
