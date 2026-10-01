import Phaser from 'phaser';

/**
 * Unified input.
 *
 * Keyboard + gamepad + a virtual joystick for touch, all normalised into one
 * `InputState` the player entity reads. The virtual joystick is drawn with
 * Phaser graphics (no DOM overlay) so it works identically in fullscreen and
 * inside an iframe.
 */

export interface InputState {
  /** Normalised movement vector, magnitude 0..1. */
  moveX: number;
  moveY: number;
  /** Aim vector (defaults to movement direction when no explicit aim). */
  aimX: number;
  aimY: number;
  firing: boolean;
  ability: boolean;
  dash: boolean;
  pause: boolean;
}

export interface InputSystemOptions {
  /** Force the virtual joystick on/off; AUTO shows it only on touch devices. */
  joystick: 'AUTO' | 'ALWAYS' | 'NEVER';
  /** Called when the player presses ESC / the pause button. */
  onPause: () => void;
}

export class InputSystem {
  private scene: Phaser.Scene;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private state: InputState = {
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0,
    firing: false,
    ability: false,
    dash: false,
    pause: false,
  };

  private joystickActive = false;
  private joystickBase = new Phaser.Math.Vector2(0, 0);
  private joystickKnob = new Phaser.Math.Vector2(0, 0);
  private joystickPointerId: number | null = null;
  private readonly joystickRadius = 64;

  private gfx?: Phaser.GameObjects.Graphics;
  private buttons: { key: 'fire' | 'ability' | 'dash'; x: number; y: number; r: number; pressed: boolean }[] = [];
  private buttonPointerIds = new Map<number, 'fire' | 'ability' | 'dash'>();

  private enabled = true;
  private touchMode: boolean;

  constructor(scene: Phaser.Scene, private opts: InputSystemOptions) {
    this.scene = scene;
    this.touchMode =
      opts.joystick === 'ALWAYS' ||
      (opts.joystick === 'AUTO' && scene.sys.game.device.input.touch && !scene.sys.game.device.os.desktop);

    this.setupKeyboard();
    if (this.touchMode) this.setupTouch();
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────
  private setupKeyboard(): void {
    const kb = this.scene.input.keyboard;
    if (!kb) return;

    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE,
      E: Phaser.Input.Keyboard.KeyCodes.E,
      SHIFT: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      ESC: Phaser.Input.Keyboard.KeyCodes.ESC,
      P: Phaser.Input.Keyboard.KeyCodes.P,
    }) as Record<string, Phaser.Input.Keyboard.Key>;

    // ESC/P pause is edge-triggered, not held.
    this.keys.ESC?.on('down', () => this.opts.onPause());
    this.keys.P?.on('down', () => this.opts.onPause());
  }

  // ── Touch ────────────────────────────────────────────────────────────────
  private setupTouch(): void {
    const { width, height } = this.scene.scale;
    this.gfx = this.scene.add.graphics().setScrollFactor(0).setDepth(1000);

    // Left half = joystick zone, right side = action buttons.
    this.joystickBase.set(width * 0.18, height * 0.72);
    this.joystickKnob.copy(this.joystickBase);

    const bx = width - 96;
    const by = height - 110;
    this.buttons = [
      { key: 'fire', x: bx - 96, y: by + 26, r: 44, pressed: false },
      { key: 'ability', x: bx - 6, y: by - 44, r: 36, pressed: false },
      { key: 'dash', x: bx + 4, y: by + 62, r: 36, pressed: false },
    ];

    this.scene.input.addPointer(3);

    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.scene.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, (p: Phaser.Input.Pointer) => this.onPointerUp(p));

    this.drawTouchUi();
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    // Buttons take priority over the joystick zone.
    for (const b of this.buttons) {
      if (Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) <= b.r + 12) {
        b.pressed = true;
        this.buttonPointerIds.set(p.id, b.key);
        this.drawTouchUi();
        return;
      }
    }
    if (this.joystickPointerId === null) {
      this.joystickPointerId = p.id;
      this.joystickActive = true;
      // Re-anchor the stick where the thumb landed — far more comfortable.
      this.joystickBase.set(p.x, p.y);
      this.joystickKnob.copy(this.joystickBase);
      this.drawTouchUi();
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (p.id !== this.joystickPointerId) return;
    const dx = p.x - this.joystickBase.x;
    const dy = p.y - this.joystickBase.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, this.joystickRadius);
    const angle = Math.atan2(dy, dx);
    this.joystickKnob.set(
      this.joystickBase.x + Math.cos(angle) * clamped,
      this.joystickBase.y + Math.sin(angle) * clamped
    );
    this.drawTouchUi();
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.joystickPointerId) {
      this.joystickPointerId = null;
      this.joystickActive = false;
      this.joystickKnob.copy(this.joystickBase);
      this.drawTouchUi();
    }
    const btn = this.buttonPointerIds.get(p.id);
    if (btn) {
      const b = this.buttons.find((x) => x.key === btn);
      if (b) b.pressed = false;
      this.buttonPointerIds.delete(p.id);
      this.drawTouchUi();
    }
  }

  private drawTouchUi(): void {
    const g = this.gfx;
    if (!g) return;
    g.clear();

    // Joystick
    g.fillStyle(0x0b1020, 0.35);
    g.fillCircle(this.joystickBase.x, this.joystickBase.y, this.joystickRadius);
    g.lineStyle(2, 0x4fd1ff, this.joystickActive ? 0.9 : 0.4);
    g.strokeCircle(this.joystickBase.x, this.joystickBase.y, this.joystickRadius);
    g.fillStyle(0x4fd1ff, this.joystickActive ? 0.75 : 0.4);
    g.fillCircle(this.joystickKnob.x, this.joystickKnob.y, 26);

    // Buttons
    for (const b of this.buttons) {
      const tint = b.key === 'fire' ? 0xff5d73 : b.key === 'ability' ? 0xb14aff : 0x3ddc97;
      g.fillStyle(tint, b.pressed ? 0.55 : 0.22);
      g.fillCircle(b.x, b.y, b.r);
      g.lineStyle(2, tint, 0.85);
      g.strokeCircle(b.x, b.y, b.r);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────
  update(): InputState {
    if (!this.enabled) return this.state;

    let mx = 0;
    let my = 0;

    // Keyboard
    const k = this.keys;
    const c = this.cursors;
    if (k.A?.isDown || c?.left?.isDown) mx -= 1;
    if (k.D?.isDown || c?.right?.isDown) mx += 1;
    if (k.W?.isDown || c?.up?.isDown) my -= 1;
    if (k.S?.isDown || c?.down?.isDown) my += 1;

    // Gamepad (first connected pad, left stick + face buttons)
    const pads = this.scene.input.gamepad;
    const pad = pads?.getPad(0);
    if (pad) {
      const ax = pad.axes[0]?.getValue() ?? 0;
      const ay = pad.axes[1]?.getValue() ?? 0;
      if (Math.abs(ax) > 0.18) mx += ax;
      if (Math.abs(ay) > 0.18) my += ay;
    }

    // Virtual joystick
    if (this.joystickActive) {
      const dx = this.joystickKnob.x - this.joystickBase.x;
      const dy = this.joystickKnob.y - this.joystickBase.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 6) {
        const norm = Math.min(1, dist / this.joystickRadius);
        mx += (dx / dist) * norm;
        my += (dy / dist) * norm;
      }
    }

    // Normalise so diagonals are not faster than cardinals.
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }

    this.state.moveX = mx;
    this.state.moveY = my;

    // Aim: movement direction, or the last non-zero direction when idle.
    if (Math.abs(mx) > 0.01 || Math.abs(my) > 0.01) {
      const m = Math.hypot(mx, my) || 1;
      this.state.aimX = mx / m;
      this.state.aimY = my / m;
    }

    const btn = (key: 'fire' | 'ability' | 'dash') => this.buttons.find((b) => b.key === key)?.pressed ?? false;

    this.state.firing = !!(k.SPACE?.isDown || pad?.buttons[0]?.pressed || btn('fire'));
    this.state.ability = !!(k.E?.isDown || pad?.buttons[2]?.pressed || btn('ability'));
    this.state.dash = !!(k.SHIFT?.isDown || pad?.buttons[1]?.pressed || btn('dash'));

    return this.state;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.state.firing = false;
      this.state.ability = false;
      this.state.dash = false;
      this.state.moveX = 0;
      this.state.moveY = 0;
    }
  }

  destroy(): void {
    this.gfx?.destroy();
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN);
    this.scene.input.off(Phaser.Input.Events.POINTER_MOVE);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP);
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE);
  }
}
