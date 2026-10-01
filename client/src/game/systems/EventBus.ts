/**
 * A tiny typed event bus.
 *
 * Phaser scenes are torn down and rebuilt constantly; a module-level bus lets
 * the React shell (HUD, toasts, mission tracker) subscribe to game events
 * without holding a reference to a scene that may no longer exist.
 */

export type GameEventMap = {
  'run:start': { sessionId: string; seed: number; sectorIndex: number };
  'run:end': { result: unknown };
  'sector:enter': { index: number; biome: string; designation: string; isBoss: boolean };
  'sector:clear': { index: number; score: number };
  'boss:spawn': { key: string; name: string; title: string; health: number };
  'boss:phase': { key: string; name: string; description: string; index: number };
  'boss:defeated': { key: string; name: string };
  'player:damaged': { amount: number; health: number; shield: number };
  'player:healed': { amount: number; health: number };
  'player:died': { sectorIndex: number; score: number };
  'player:levelup': { level: number };
  'player:xp': { xp: number; level: number; xpToNext: number };
  'enemy:killed': { key: string; name: string; xp: number; scrap: number };
  'loot:drop': { itemKey: string; name: string; rarity: number; value: number };
  'loot:pickup': { itemKey: string; name: string; rarity: number; value: number };
  'powerup:pickup': { kind: string; name: string };
  'ability:used': { key: string; name: string };
  'ability:ready': { key: string; name: string };
  'dash:used': Record<string, never>;
  'currency:changed': { scrap: number; plasma: number; riftCrystal: number };
  'mission:progress': { missionKey: string; progress: number; target: number; completed: boolean };
  'mission:completed': { missionKey: string; name: string };
  'mission:claimed': { missionKey: string; name: string };
  'inventory:changed': Record<string, never>;
  'craft:started': { recipeKey: string; completesAt: number };
  'craft:completed': { recipeKey: string; itemKey: string };
  'toast': { message: string; tone: 'info' | 'success' | 'warn' | 'danger' };
  'pause': Record<string, never>;
  'resume': Record<string, never>;
  'hud:update': Record<string, never>;
};

type Handler<T> = (payload: T) => void;

class EventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): () => void {
    const key = event as string;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler as Handler<unknown>);
    return () => this.off(event, handler);
  }

  once<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof GameEventMap>(event: K, handler: Handler<GameEventMap[K]>): void {
    this.handlers.get(event as string)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    const set = this.handlers.get(event as string);
    if (!set) return;
    // Copy first: a handler may unsubscribe during dispatch.
    for (const handler of Array.from(set)) {
      try {
        (handler as Handler<GameEventMap[K]>)(payload);
      } catch (err) {
        // A broken listener must never take down the game loop.
        console.error(`[EventBus] handler for "${String(event)}" threw:`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
export type EventBusType = EventBus;
