import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SCENE_KEYS } from './config/constants';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { BossScene } from './scenes/BossScene';
import { GameOverScene } from './scenes/GameOverScene';

/**
 * GameHost — owns the single Phaser.Game instance.
 *
 * The React shell never reaches into a scene directly. It observes which scene
 * is active (so it knows whether to show the command centre or the in-run HUD)
 * and drives scene transitions through `startScene`.
 */

export type ShellMode = 'boot' | 'menu' | 'playing' | 'gameover';

export interface GameHost {
  game: Phaser.Game;
  /** Which shell surface should be visible right now. */
  getMode(): ShellMode;
  /** Starts a run from the command centre. */
  launchRun(opts?: { sectorIndex?: number; seed?: number; sessionKey?: string; sessionId?: string }): void;
  /** Returns to the command centre. */
  returnToMenu(): void;
  /** Pauses / resumes the active gameplay scene. */
  setPaused(paused: boolean): void;
  /** Subscribes to shell-mode changes. Returns an unsubscribe fn. */
  onModeChange(handler: (mode: ShellMode) => void): () => void;
  destroy(): void;
}

export function createGameHost(parent: HTMLElement): GameHost {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: '#02030a',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    render: {
      antialias: true,
      powerPreference: 'high-performance',
    },
    scene: [BootScene, MenuScene, GameScene, BossScene, GameOverScene],
  });

  const listeners = new Set<(mode: ShellMode) => void>();
  let lastMode: ShellMode = 'boot';

  function computeMode(): ShellMode {
    if (game.scene.isActive(SCENE_KEYS.GAME) || game.scene.isActive(SCENE_KEYS.BOSS)) return 'playing';
    if (game.scene.isActive(SCENE_KEYS.GAME_OVER)) return 'gameover';
    if (game.scene.isActive(SCENE_KEYS.MENU)) return 'menu';
    return 'boot';
  }

  // Phaser has no single global "scene changed" event, so we poll at a rate that
  // is imperceptible to the player and only notify React on an actual change.
  const poll = window.setInterval(() => {
    const mode = computeMode();
    if (mode !== lastMode) {
      lastMode = mode;
      for (const l of Array.from(listeners)) l(mode);
    }
  }, 180);

  return {
    game,
    getMode: computeMode,

    launchRun(opts) {
      const data = {
        sectorIndex: opts?.sectorIndex ?? 1,
        seed: opts?.seed ?? Math.floor(Math.random() * 1e9),
        sessionKey: opts?.sessionKey,
        sessionId: opts?.sessionId,
      };
      const active = game.scene.isActive(SCENE_KEYS.MENU) ? SCENE_KEYS.MENU : SCENE_KEYS.GAME_OVER;
      game.scene.stop(active);
      game.scene.start(SCENE_KEYS.GAME, data);
    },

    returnToMenu() {
      for (const key of [SCENE_KEYS.GAME, SCENE_KEYS.BOSS, SCENE_KEYS.GAME_OVER]) {
        if (game.scene.isActive(key)) game.scene.stop(key);
      }
      game.scene.start(SCENE_KEYS.MENU);
    },

    setPaused(paused) {
      const key = game.scene.isActive(SCENE_KEYS.BOSS) ? SCENE_KEYS.BOSS : SCENE_KEYS.GAME;
      if (!game.scene.isActive(key)) return;
      const scene = game.scene.getScene(key) as Phaser.Scene & { togglePause?: () => void };
      // Scenes expose their own pause toggle; fall back to the scene manager.
      if (typeof scene.togglePause === 'function') {
        scene.togglePause();
      } else if (paused) {
        game.scene.pause(key);
      } else {
        game.scene.resume(key);
      }
    },

    onModeChange(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },

    destroy() {
      window.clearInterval(poll);
      listeners.clear();
      game.destroy(true);
    },
  };
}
