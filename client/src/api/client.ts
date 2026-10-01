/**
 * API client.
 *
 * Every call degrades gracefully: if the server is unreachable the game stays
 * fully playable in local mode, and the UI labels the data as local rather than
 * pretending it is authoritative.
 */

import type { InventoryItem, MissionProgress, OwnedShip, PlayerProfile } from '../game/systems/types';

const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000').trim();

/**
 * Standalone guest mode.
 *
 * The published static build ships with no backend attached. When the API URL is
 * blank (or VITE_STANDALONE=true) the client makes NO network calls at all: the
 * game boots straight into local play, progress saves to localStorage, and every
 * server-backed surface (marketplace, trading, leaderboard) degrades to clearly
 * labelled local/demo data instead of hanging on a dead request.
 */
export const STANDALONE = API_URL === '' || import.meta.env.VITE_STANDALONE === 'true';

export interface Listing {
  id: string;
  sellerId: string;
  sellerName: string;
  assetKind: 'SHIP' | 'ITEM';
  assetName: string;
  assetKey: string;
  category: string;
  rarity: number;
  priceWei: string;
  priceEth: string;
  paymentToken: string;
  status: 'ACTIVE' | 'SOLD' | 'CANCELLED' | 'EXPIRED';
  onChainId?: string;
  createdAt: number;
  expiresAt?: number;
  /** True when the listing is a local demo entry (server unreachable). */
  demo?: boolean;
}

export interface TradeOffer {
  id: string;
  initiatorId: string;
  initiatorName: string;
  counterpartyId: string;
  counterpartyName: string;
  offeredAssets: { itemKey: string; name: string; rarity: number; quantity: number }[];
  requestedAssets: { itemKey: string; name: string; rarity: number; quantity: number }[];
  offeredPlasma: number;
  requestedPlasma: number;
  status: 'PENDING' | 'AWAITING_COUNTERPARTY' | 'CONFIRMED' | 'SETTLED' | 'CANCELLED' | 'EXPIRED';
  initiatorConfirmed: boolean;
  counterpartyConfirmed: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  displayName: string;
  level: number;
  seasonXp: number;
}

export interface RunSubmission {
  sessionId: string;
  seed: number;
  sectorReached: number;
  score: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  lootValue: number;
  xpGained: number;
  scrapGained: number;
  plasmaGained: number;
  durationMs: number;
  bossKilled: boolean;
  signature: string;
  payload: string;
}

export interface RunVerdict {
  verified: boolean;
  flagged: boolean;
  reason?: string;
  rewards: { xp: number; scrap: number; plasma: number; riftCrystal: number };
  profile?: PlayerProfile;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error ?? body.message ?? detail;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(detail, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  baseUrl: API_URL,

  async health(): Promise<boolean> {
    if (STANDALONE) return false;
    try {
      const res = await fetch(`${API_URL}/api/health`);
      return res.ok;
    } catch {
      return false;
    }
  },

  // ── Auth ────────────────────────────────────────────────────────────────
  nonce: (address: string) =>
    request<{ nonce: string; message: string }>(`/api/auth/nonce?address=${encodeURIComponent(address)}`),

  verify: (address: string, signature: string, nonce: string) =>
    request<{ token: string; address: string; playerId: string; expiresAt: number }>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ address, signature, nonce }),
    }),

  // ── Player ──────────────────────────────────────────────────────────────
  me: () => request<{ profile: PlayerProfile; ships: OwnedShip[]; inventory: InventoryItem[] }>('/api/players/me'),

  updateProfile: (patch: { displayName?: string }) =>
    request<{ profile: PlayerProfile }>('/api/players/me', { method: 'PATCH', body: JSON.stringify(patch) }),

  leaderboard: (seasonId = 1) =>
    request<{ rows: LeaderboardRow[] }>(`/api/players/leaderboard?season=${seasonId}`),

  // ── Inventory ───────────────────────────────────────────────────────────
  inventory: () => request<{ items: InventoryItem[] }>('/api/inventory'),

  dismantle: (itemId: string) =>
    request<{ scrap: number; items: InventoryItem[] }>(`/api/inventory/${itemId}/dismantle`, { method: 'POST' }),

  equip: (itemId: string, slot: string) =>
    request<{ items: InventoryItem[] }>(`/api/inventory/${itemId}/equip`, {
      method: 'POST',
      body: JSON.stringify({ slot }),
    }),

  // ── Missions ────────────────────────────────────────────────────────────
  missions: () => request<{ missions: MissionProgress[] }>('/api/missions'),

  claimMission: (missionKey: string) =>
    request<{ profile: PlayerProfile; missions: MissionProgress[] }>(`/api/missions/${missionKey}/claim`, {
      method: 'POST',
    }),

  // ── Runs ────────────────────────────────────────────────────────────────
  submitRun: (run: RunSubmission) =>
    request<RunVerdict>('/api/runs/submit', { method: 'POST', body: JSON.stringify(run) }),

  // ── Marketplace ─────────────────────────────────────────────────────────
  listings: (params?: { category?: string; rarity?: number; sort?: string; q?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category && params.category !== 'ALL') qs.set('category', params.category);
    if (params?.rarity !== undefined && params.rarity >= 0) qs.set('rarity', String(params.rarity));
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.q) qs.set('q', params.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ listings: Listing[] }>(`/api/marketplace/listings${suffix}`);
  },

  createListing: (body: {
    assetKind: 'SHIP' | 'ITEM';
    assetId: string;
    priceEth: string;
    paymentToken?: string;
    durationHours?: number;
  }) => request<{ listing: Listing }>('/api/marketplace/listings', { method: 'POST', body: JSON.stringify(body) }),

  cancelListing: (id: string) =>
    request<{ ok: true }>(`/api/marketplace/listings/${id}`, { method: 'DELETE' }),

  buyListing: (id: string, txHash?: string) =>
    request<{ listing: Listing; profile: PlayerProfile }>(`/api/marketplace/listings/${id}/buy`, {
      method: 'POST',
      body: JSON.stringify({ txHash }),
    }),

  // ── P2P trading ─────────────────────────────────────────────────────────
  trades: () => request<{ trades: TradeOffer[] }>('/api/trades'),

  createTrade: (body: {
    counterpartyId: string;
    offeredAssets: { itemKey: string; quantity: number }[];
    requestedAssets: { itemKey: string; quantity: number }[];
    offeredPlasma: number;
    requestedPlasma: number;
  }) => request<{ trade: TradeOffer }>('/api/trades', { method: 'POST', body: JSON.stringify(body) }),

  confirmTrade: (id: string, signature?: string) =>
    request<{ trade: TradeOffer; profile?: PlayerProfile }>(`/api/trades/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ signature }),
    }),

  cancelTrade: (id: string) => request<{ ok: true }>(`/api/trades/${id}`, { method: 'DELETE' }),
};

export { ApiError };
