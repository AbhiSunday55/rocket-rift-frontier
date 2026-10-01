import { STORAGE_KEYS } from '../config/constants';
import { RAPTOR_X } from '../config/ships';
import { Rarity } from '../config/rarity';
import { DEFAULT_LOADOUT } from '../config/weapons';
import type { GameSettings, PlayerProfile, SaveData } from './types';

/**
 * Local persistence.
 *
 * The save is a *cache* of server state, never the authority. When the player is
 * authenticated the server's copy wins on every conflict; offline play uses this
 * so the game is fully playable with no wallet and no network.
 */

const SAVE_VERSION = 1;

export const DEFAULT_SETTINGS: GameSettings = {
  musicVolume: 0.5,
  sfxVolume: 0.7,
  screenShake: true,
  showDamageNumbers: true,
  reducedMotion: false,
  virtualJoystick: 'AUTO',
};

export function createDefaultProfile(): PlayerProfile {
  const now = Date.now();
  return {
    id: `local_${Math.random().toString(36).slice(2, 10)}`,
    displayName: 'Frontier Pilot',
    level: 1,
    xp: 0,
    scrap: 0,
    plasma: 0,
    riftCrystal: 0,
    seasonId: 1,
    seasonXp: 0,
    equippedShipId: 'ship_starter',
    ships: [
      {
        id: 'ship_starter',
        shipKey: RAPTOR_X.key,
        nickname: 'Raptor-X',
        rarity: Rarity.COMMON,
        level: 1,
        stats: { ...RAPTOR_X.stats },
        upgradePoints: 0,
        isStarter: true,
      },
    ],
    inventory: [],
    loadout: { ...DEFAULT_LOADOUT, equipment: [], accessory: [] },
    stats: {
      runsPlayed: 0,
      bestScore: 0,
      bestSector: 0,
      totalKills: 0,
      totalBossesKilled: 0,
      totalPlaytimeMs: 0,
      totalLootValue: 0,
    },
    createdAt: now,
  };
}

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    profile: createDefaultProfile(),
    missions: [],
    settings: { ...DEFAULT_SETTINGS },
    crafting: [],
    lastSavedAt: Date.now(),
  };
}

function isStorageAvailable(): boolean {
  try {
    const k = '__rrf_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/** In-memory fallback for private-browsing / sandboxed iframes. */
let memorySave: SaveData | null = null;

export const SaveSystem = {
  load(): SaveData {
    if (!isStorageAvailable()) {
      return memorySave ?? (memorySave = createDefaultSave());
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.SAVE);
      if (!raw) return createDefaultSave();
      const parsed = JSON.parse(raw) as SaveData;
      return migrate(parsed);
    } catch (err) {
      console.warn('[SaveSystem] corrupt save, starting fresh:', err);
      return createDefaultSave();
    }
  },

  save(data: SaveData): void {
    data.lastSavedAt = Date.now();
    if (!isStorageAvailable()) {
      memorySave = data;
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEYS.SAVE, JSON.stringify(data));
    } catch (err) {
      console.warn('[SaveSystem] write failed:', err);
    }
  },

  reset(): SaveData {
    const fresh = createDefaultSave();
    SaveSystem.save(fresh);
    return fresh;
  },

  export(data: SaveData): string {
    return JSON.stringify(data, null, 2);
  },

  import(json: string): SaveData {
    const parsed = JSON.parse(json) as SaveData;
    const migrated = migrate(parsed);
    SaveSystem.save(migrated);
    return migrated;
  },
};

/**
 * Forward-migrates an older save. Each step is additive so a v1 save always
 * survives a schema bump without losing progress.
 */
function migrate(data: Partial<SaveData>): SaveData {
  const base = createDefaultSave();
  const merged: SaveData = {
    version: SAVE_VERSION,
    profile: { ...base.profile, ...(data.profile ?? {}) },
    missions: data.missions ?? [],
    settings: { ...base.settings, ...(data.settings ?? {}) },
    crafting: data.crafting ?? [],
    lastSavedAt: data.lastSavedAt ?? Date.now(),
  };

  // Guarantee the starter ship always exists — a save without a flyable hull
  // would soft-lock the player.
  if (!merged.profile.ships?.length) {
    merged.profile.ships = base.profile.ships;
    merged.profile.equippedShipId = base.profile.equippedShipId;
  }
  if (!merged.profile.loadout) merged.profile.loadout = base.profile.loadout;
  if (!merged.profile.stats) merged.profile.stats = base.profile.stats;
  if (!merged.profile.inventory) merged.profile.inventory = [];

  return merged;
}
