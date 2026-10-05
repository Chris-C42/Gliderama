/**
 * Throw input: turns a slingshot drag, the keyboard or a gamepad into a `ThrowState`
 * (aiming / angle / power / released). Used while the game waits for the player to throw.
 *
 *   Pointer   Drag anywhere on the play surface (ignoring elements marked `[data-ui]`). The aim is
 *             the OPPOSITE of the drag, like pulling back a slingshot. power = drag length (CSS px)
 *             / 160, clamped. Releasing with power >= 0.08 throws; releasing with less cancels.
 *   Keyboard  Up / Down (or W / S) change the elevation at 1.5 rad/s, clamped to -60..+75 degrees
 *             relative to the facing direction. Holding Space (or J) charges a golf-style meter that
 *             oscillates 0 -> 1 -> 0 every 1.6 s; releasing throws (same 0.08 minimum).
 *   Gamepad   Left stick aims (stick direction = aim, same clamp; the aim holds when the stick is
 *             released), D-pad up / down nudge it. Hold A to charge, release to throw.
 *
 * Angles are room-space radians with 0 = right and +PI/2 = up (room pixels are y-down, so y is
 * flipped). The pure helpers at the top are exported for tests; the class below is DOM-free except
 * `attach` / `detach`, so its `pointer*` / `key*` / `feedPad` methods can be driven directly.
 *
 * ## Release contract
 *
 * `released` latches when a throw fires and stays set until `consume()`:
 *
 *   const t = throwCtl.consume();            // ThrowState with released: true, or null
 *   if (t) launch(t.angle, t.power);
 *
 * `getState()` / `getView()` never change anything, so UI code can read them freely. A pending
 * release blocks all further input until it is consumed, so one gesture can never throw twice.
 */

import { clamp, degToRad, wrapAngle, type Vec2 } from '../core/math';
import type { Facing, ThrowState } from '../core/types';
import { isUiTarget, keyCodeOf, shouldIgnoreKeyDown } from './dom';
import { combinePadRaw, readNavigatorPads, readPad, type PadLike, type PadRaw } from './gamepad';
import { DOWN_KEYS, GADGET_KEYS, UP_KEYS, shouldPreventDefault } from './keyboard';

// ---------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------

/** Drag length (CSS px) that gives full power. */
export const DEFAULT_MAX_DRAG_PX = 160;
/** Smallest power that still counts as a throw. */
export const MIN_THROW_POWER = 0.08;
/** Keyboard / D-pad aim speed, rad/s. */
export const AIM_RATE = 1.5;
/** Elevation limits relative to the facing direction (down / up). */
export const MIN_ELEVATION = degToRad(-60);
export const MAX_ELEVATION = degToRad(75);
/** Seconds for the charge meter to go 0 -> 1 -> 0. */
export const CHARGE_PERIOD = 1.6;
/** Where the keyboard / gamepad aim starts: a gentle upward lob. */
export const DEFAULT_ELEVATION = degToRad(15);
/** Radial deadzone of the aiming stick. */
export const STICK_AIM_DEADZONE = 0.3;

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** Slingshot power from the drag length in CSS px: length / maxDragPx clamped to 0..1. */
export function dragPower(dragLenPx: number, maxDragPx: number = DEFAULT_MAX_DRAG_PX): number {
  if (!(maxDragPx > 0)) return 0;
  return clamp(dragLenPx / maxDragPx, 0, 1);
}

/**
 * Aim angle for a drag vector given in room space (y-down pixels). The aim is opposite to the drag,
 * and y is flipped so that up is positive: dragging down-left aims up-right (+45 degrees). A zero
 * vector returns 0.
 */
export function aimFromDrag(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(dy + 0, -dx);
}

/** Elevation (up = +, relative to the facing direction) -> room angle (0 = right, +PI/2 = up). */
export function elevationToAngle(elevation: number, facing: Facing): number {
  return facing === 1 ? wrapAngle(elevation) : wrapAngle(Math.PI - elevation);
}

/** Inverse of `elevationToAngle`. */
export function angleToElevation(angle: number, facing: Facing): number {
  return facing === 1 ? wrapAngle(angle) : wrapAngle(Math.PI - angle);
}

/** Advance the elevation by `input` (-1 down .. +1 up) for `dt` seconds, clamped to the limits. */
export function stepElevation(
  elevation: number,
  input: number,
  dt: number,
  rate: number = AIM_RATE,
  min: number = MIN_ELEVATION,
  max: number = MAX_ELEVATION,
): number {
  return clamp(elevation + input * rate * dt, min, max);
}

/**
 * Golf-meter charge: a triangle wave in 0..1 with period `period`. 0 at t = 0, 1 at half a period,
 * back to 0 after a full period, then repeating.
 */
export function chargeMeter(elapsed: number, period: number = CHARGE_PERIOD): number {
  if (!(period > 0)) return 0;
  const cycles = elapsed / period;
  const phase = cycles - Math.floor(cycles); // 0..1 within the current cycle (also right for t < 0)
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

/**
 * Elevation chosen by the aiming stick (x right, y UP), or null while it is inside the radial
 * deadzone. The stick direction is mirrored for a left-facing thrower and clamped to the limits,
 * so pushing "behind" the thrower just clamps to the nearest limit.
 */
export function stickElevation(
  x: number,
  yUp: number,
  facing: Facing,
  deadzone: number = STICK_AIM_DEADZONE,
  min: number = MIN_ELEVATION,
  max: number = MAX_ELEVATION,
): number | null {
  if (x * x + yUp * yUp <= deadzone * deadzone) return null;
  return clamp(angleToElevation(Math.atan2(yUp, x), facing), min, max);
}

// ---------------------------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------------------------

export interface ThrowOptions {
  /** Client (CSS px) -> room coordinates (y-down pixels). */
  screenToRoom: (clientX: number, clientY: number) => Vec2;
  /** The hand: where the plane is released, in room coordinates. Read on demand. */
  getAnchor: () => Vec2;
  /** Which way the thrower faces. Read on demand. */
  getFacing: () => Facing;
  /** Drag length for full power, CSS px. Default 160. */
  maxDragPx?: number;
  /** Minimum power that throws. Default 0.08. */
  minPower?: number;
  /** Keyboard / D-pad aim speed, rad/s. Default 1.5. */
  aimRate?: number;
  /** Elevation limits in radians relative to the facing direction. Defaults -60 / +75 degrees. */
  minElevation?: number;
  maxElevation?: number;
  /** Charge-meter period in seconds. Default 1.6. */
  chargePeriod?: number;
  /** Starting keyboard / gamepad elevation in radians. Default +15 degrees. */
  defaultElevation?: number;
  /** Gamepad source; defaults to `navigator.getGamepads()`. Mainly a test hook. */
  readPads?: () => readonly PadLike[];
}

export type ThrowMode = 'none' | 'pointer' | 'keyboard' | 'gamepad';

/** Everything the aiming visuals need, beyond the `ThrowState` the game consumes. */
export interface ThrowView {
  /** Which device is aiming right now ('none' when nothing has been touched since the last throw). */
  mode: ThrowMode;
  /** The hand, in room coordinates. */
  anchor: Vec2;
  /** Slingshot drag start / current point in room coordinates; null when not dragging. */
  dragStart: Vec2 | null;
  dragCurrent: Vec2 | null;
  /** The same two points in client (CSS px) coordinates; null when not dragging. */
  dragStartClient: Vec2 | null;
  dragCurrentClient: Vec2 | null;
  /** Current aim angle (room space, y up). Always meaningful: the idle keyboard aim when not engaged. */
  angle: number;
  /** Current power 0..1 (drag power, charge meter, or the pending release's power). */
  power: number;
  /** True while Space / J / A is held and the meter is running. */
  charging: boolean;
  /** Keyboard / gamepad elevation relative to the facing direction, radians. */
  elevation: number;
  /** Drag length that gives full power, CSS px. */
  maxDragPx: number;
  /** Power below which a release cancels instead of throwing. */
  minPower: number;
}

interface DragState {
  id: number;
  sx: number;
  sy: number;
  cx: number;
  cy: number;
}

const UP_SET: ReadonlySet<string> = new Set(UP_KEYS);
const DOWN_SET: ReadonlySet<string> = new Set(DOWN_KEYS);
const CHARGE_SET: ReadonlySet<string> = new Set(GADGET_KEYS);
const THROW_KEYS: ReadonlySet<string> = new Set([...UP_KEYS, ...DOWN_KEYS, ...GADGET_KEYS]);

export class ThrowController {
  private readonly screenToRoom: ThrowOptions['screenToRoom'];
  private readonly getAnchor: ThrowOptions['getAnchor'];
  private readonly getFacing: ThrowOptions['getFacing'];
  private readonly maxDragPx: number;
  private readonly minPower: number;
  private readonly aimRate: number;
  private readonly minElev: number;
  private readonly maxElev: number;
  private readonly chargePeriod: number;
  private readonly readPads: () => readonly PadLike[];

  private enabled = true;
  private surface: HTMLElement | null = null;

  private drag: DragState | null = null;

  private elevation: number;
  private engaged = false;
  private device: 'keyboard' | 'gamepad' | null = null;
  private readonly aimUp = new Set<string>();
  private readonly aimDown = new Set<string>();
  /** Who is holding the charge button: 'key:Space', 'key:KeyJ', 'pad'. The meter runs while non-empty. */
  private readonly chargeHolders = new Set<string>();
  private chargeTime = 0;
  private padSeen = false;
  private padPrevA = false;

  private pending: { angle: number; power: number } | null = null;

  constructor(options: ThrowOptions) {
    this.screenToRoom = options.screenToRoom;
    this.getAnchor = options.getAnchor;
    this.getFacing = options.getFacing;
    this.maxDragPx = options.maxDragPx ?? DEFAULT_MAX_DRAG_PX;
    this.minPower = options.minPower ?? MIN_THROW_POWER;
    this.aimRate = options.aimRate ?? AIM_RATE;
    this.minElev = options.minElevation ?? MIN_ELEVATION;
    this.maxElev = options.maxElevation ?? MAX_ELEVATION;
    this.chargePeriod = options.chargePeriod ?? CHARGE_PERIOD;
    this.readPads = options.readPads ?? readNavigatorPads;
    this.elevation = clamp(options.defaultElevation ?? DEFAULT_ELEVATION, this.minElev, this.maxElev);
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  /**
   * Listen for slingshot drags that start on `surface` (the play area), and for keyboard input on
   * `window`. Drags starting on an element inside `[data-ui]` (on-screen buttons) are ignored.
   */
  attach(surface: HTMLElement): void {
    this.detach();
    this.surface = surface;
    surface.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach(): void {
    if (this.surface) {
      this.surface.removeEventListener('pointerdown', this.onPointerDown);
      this.surface = null;
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerCancel);
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.reset();
  }

  /** Enable / disable input (disable it while the plane is in flight). Changing it resets. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.reset();
  }

  /**
   * Cancel whatever is in progress (drag, charge, pending release) without throwing. The remembered
   * keyboard elevation is kept so the next throw starts where the last one aimed.
   */
  reset(): void {
    this.clearTransient();
    this.padSeen = false;
  }

  private clearTransient(): void {
    this.pending = null;
    this.drag = null;
    this.chargeHolders.clear();
    this.chargeTime = 0;
    this.aimUp.clear();
    this.aimDown.clear();
    this.engaged = false;
    this.device = null;
  }

  // -------------------------------------------------------------------------------------------
  // Per-step API
  // -------------------------------------------------------------------------------------------

  /** Call once per fixed step (or per frame): polls the gamepad, moves the aim, runs the meter. */
  update(dt: number): void {
    if (!this.enabled || this.pending || !(dt > 0)) return;

    const pads = this.readPads();
    if (pads.length === 0) {
      this.padLost();
    } else {
      this.feedPad(combinePadRaw(pads.map(readPad)), dt);
      if (this.pending) return;
    }

    const aim = (this.aimUp.size > 0 ? 1 : 0) - (this.aimDown.size > 0 ? 1 : 0);
    if (aim !== 0) this.elevation = stepElevation(this.elevation, aim, dt, this.aimRate, this.minElev, this.maxElev);
    if (this.chargeHolders.size > 0) this.chargeTime += dt;
  }

  /** The current throw state. Pure read; see the release contract in the file header. */
  getState(): ThrowState {
    if (this.pending) {
      return { aiming: false, angle: this.pending.angle, power: this.pending.power, released: true };
    }
    if (this.drag) {
      const a = this.dragAim(this.drag);
      return { aiming: true, angle: a.angle, power: a.power, released: false };
    }
    return {
      aiming: this.engaged,
      angle: this.keyAngle(),
      power: this.charging ? chargeMeter(this.chargeTime, this.chargePeriod) : 0,
      released: false,
    };
  }

  /** Extra data for drawing the aim: anchor, drag points, charge state. Pure read. */
  getView(): ThrowView {
    const state = this.getState();
    const d = this.drag;
    let mode: ThrowMode = 'none';
    if (d) mode = 'pointer';
    else if (this.engaged && this.device) mode = this.device;
    return {
      mode,
      anchor: this.getAnchor(),
      dragStart: d ? this.screenToRoom(d.sx, d.sy) : null,
      dragCurrent: d ? this.screenToRoom(d.cx, d.cy) : null,
      dragStartClient: d ? { x: d.sx, y: d.sy } : null,
      dragCurrentClient: d ? { x: d.cx, y: d.cy } : null,
      angle: state.angle,
      power: state.power,
      charging: this.charging,
      elevation: this.elevation,
      maxDragPx: this.maxDragPx,
      minPower: this.minPower,
    };
  }

  /**
   * Take the pending release, if any: returns a `ThrowState` with `released: true` (final angle and
   * power) exactly once per throw, then returns null until the next one. Also clears the aiming
   * state, keeping only the remembered keyboard elevation.
   */
  consume(): ThrowState | null {
    const p = this.pending;
    if (!p) return null;
    const out: ThrowState = { aiming: false, angle: p.angle, power: p.power, released: true };
    this.clearTransient();
    return out;
  }

  private get charging(): boolean {
    return this.chargeHolders.size > 0;
  }

  private keyAngle(): number {
    return elevationToAngle(this.elevation, this.getFacing());
  }

  private dragAim(d: DragState): { angle: number; power: number } {
    const s = this.screenToRoom(d.sx, d.sy);
    const c = this.screenToRoom(d.cx, d.cy);
    const lenPx = Math.sqrt((d.cx - d.sx) * (d.cx - d.sx) + (d.cy - d.sy) * (d.cy - d.sy));
    return { angle: aimFromDrag(c.x - s.x, c.y - s.y), power: dragPower(lenPx, this.maxDragPx) };
  }

  // -------------------------------------------------------------------------------------------
  // Decoded-input entry points (what the DOM listeners call; also what the tests drive)
  // -------------------------------------------------------------------------------------------

  /** A drag starts at client position (x, y). Returns false when ignored (disabled / busy). */
  pointerDown(x: number, y: number, pointerId: number): boolean {
    if (!this.enabled || this.pending || this.drag) return false;
    this.drag = { id: pointerId, sx: x, sy: y, cx: x, cy: y };
    return true;
  }

  pointerMove(x: number, y: number, pointerId: number): void {
    const d = this.drag;
    if (d && d.id === pointerId) {
      d.cx = x;
      d.cy = y;
    }
  }

  /** Release: throws if the power reaches the minimum, otherwise just cancels the drag. */
  pointerUp(x: number, y: number, pointerId: number): void {
    const d = this.drag;
    if (!d || d.id !== pointerId) return;
    d.cx = x;
    d.cy = y;
    this.drag = null;
    const aim = this.dragAim(d);
    if (aim.power >= this.minPower) this.release(aim.angle, aim.power);
  }

  pointerCancel(pointerId: number): void {
    if (this.drag && this.drag.id === pointerId) this.drag = null;
  }

  /** A physical key went down (auto-repeat already filtered out). */
  keyDown(code: string): void {
    if (!this.enabled || this.pending) return;
    if (UP_SET.has(code)) {
      this.aimUp.add(code);
      this.engage('keyboard');
    } else if (DOWN_SET.has(code)) {
      this.aimDown.add(code);
      this.engage('keyboard');
    } else if (CHARGE_SET.has(code)) {
      this.beginCharge('key:' + code, 'keyboard');
    }
  }

  keyUp(code: string): void {
    this.aimUp.delete(code);
    this.aimDown.delete(code);
    if (CHARGE_SET.has(code)) this.endCharge('key:' + code, true);
  }

  /**
   * One gamepad sample (`dt` is the time since the previous one). The first sample after the
   * controller is enabled / reset only records the button state, so a button that was already held
   * (say A, used to start the level) does not count as a press.
   */
  feedPad(raw: PadRaw, dt: number): void {
    if (!this.enabled || this.pending) return;
    if (!this.padSeen) {
      this.padSeen = true;
      this.padPrevA = raw.a;
    }

    const stick = stickElevation(raw.x, raw.y, this.getFacing(), STICK_AIM_DEADZONE, this.minElev, this.maxElev);
    if (stick !== null) {
      this.elevation = stick;
      this.engage('gamepad');
    }
    const dpad = (raw.up ? 1 : 0) - (raw.down ? 1 : 0);
    if (dpad !== 0) {
      this.elevation = stepElevation(this.elevation, dpad, dt, this.aimRate, this.minElev, this.maxElev);
      this.engage('gamepad');
    }

    if (raw.a && !this.padPrevA) this.beginCharge('pad', 'gamepad');
    else if (!raw.a && this.padPrevA) this.endCharge('pad', true);
    this.padPrevA = raw.a;
  }

  /** The last gamepad went away: forget its button state and abandon a pad-driven charge. */
  private padLost(): void {
    this.padSeen = false;
    this.padPrevA = false;
    this.endCharge('pad', false);
  }

  private engage(device: 'keyboard' | 'gamepad'): void {
    this.engaged = true;
    this.device = device;
  }

  private beginCharge(holder: string, device: 'keyboard' | 'gamepad'): void {
    if (this.chargeHolders.has(holder)) return;
    if (this.chargeHolders.size === 0) this.chargeTime = 0;
    this.chargeHolders.add(holder);
    this.engage(device);
  }

  /** `holder` let go. When the last holder lets go: throw if `fire` and the power is high enough. */
  private endCharge(holder: string, fire: boolean): void {
    if (!this.chargeHolders.delete(holder) || this.chargeHolders.size > 0) return;
    const power = chargeMeter(this.chargeTime, this.chargePeriod);
    this.chargeTime = 0;
    if (fire && power >= this.minPower) this.release(this.keyAngle(), power);
  }

  /**
   * A throw fires. Whatever else was in progress (another drag, a charge on a second device) is
   * abandoned so that exactly one throw comes out of one `consume()`.
   */
  private release(angle: number, power: number): void {
    this.pending = { angle, power };
    this.drag = null;
    this.chargeHolders.clear();
    this.chargeTime = 0;
  }

  // -------------------------------------------------------------------------------------------
  // DOM listeners
  // -------------------------------------------------------------------------------------------

  private onPointerDown = (e: Event): void => {
    const ev = e as PointerEvent;
    if (ev.button !== 0) return; // mouse: primary button only (touch / pen contact are button 0)
    if (isUiTarget(ev.target)) return; // on-screen buttons and pads
    if (!this.pointerDown(ev.clientX, ev.clientY, ev.pointerId)) return;
    try {
      this.surface?.setPointerCapture(ev.pointerId); // keep receiving moves / the release off-element
    } catch {
      /* the pointer is already gone */
    }
  };

  private onPointerMove = (e: Event): void => {
    const ev = e as PointerEvent;
    this.pointerMove(ev.clientX, ev.clientY, ev.pointerId);
  };

  private onPointerUp = (e: Event): void => {
    const ev = e as PointerEvent;
    this.pointerUp(ev.clientX, ev.clientY, ev.pointerId);
  };

  private onPointerCancel = (e: Event): void => {
    this.pointerCancel((e as PointerEvent).pointerId);
  };

  private onKeyDown = (e: Event): void => {
    const ev = e as KeyboardEvent;
    if (!this.enabled || shouldIgnoreKeyDown(ev)) return;
    const code = keyCodeOf(ev);
    if (!THROW_KEYS.has(code)) return;
    if (shouldPreventDefault(code)) ev.preventDefault();
    if (ev.repeat) return;
    this.keyDown(code);
  };

  private onKeyUp = (e: Event): void => {
    const code = keyCodeOf(e as KeyboardEvent);
    if (code) this.keyUp(code);
  };

  /**
   * Losing focus (or hiding the tab) swallows pointer / key releases, so abandon the gestures in
   * progress rather than guess. A throw that has already fired is kept: it was complete, and the
   * game will still `consume()` it.
   */
  private onBlur = (): void => {
    this.drag = null;
    this.chargeHolders.clear();
    this.chargeTime = 0;
    this.aimUp.clear();
    this.aimDown.clear();
    this.padSeen = false;
  };

  private onVisibility = (): void => {
    if (document.hidden) this.onBlur();
  };
}
