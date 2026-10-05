/**
 * Keyboard controls as a pure reducer (no DOM, no time source) so the logic is unit-testable.
 * `InputManager` feeds it key events (`keyboardKeyDown` / `keyboardKeyUp`) and fixed steps
 * (`keyboardTick`), and reads the result with `keyboardDir` / `keyboardPitchTarget` / `keyboardGadget`.
 *
 *   Fly left / right   ArrowLeft, KeyA   /  ArrowRight, KeyD
 *   Pitch up / down    ArrowUp,   KeyW   /  ArrowDown,  KeyS
 *   Gadget             Space, KeyJ
 *   Pause              Escape, KeyP
 *
 * Keys are physical key codes (`KeyboardEvent.code`), so the layout is the same on AZERTY etc.
 */

import { approach } from '../core/math';

export const LEFT_KEYS = ['ArrowLeft', 'KeyA'] as const;
export const RIGHT_KEYS = ['ArrowRight', 'KeyD'] as const;
export const UP_KEYS = ['ArrowUp', 'KeyW'] as const;
export const DOWN_KEYS = ['ArrowDown', 'KeyS'] as const;
export const GADGET_KEYS = ['Space', 'KeyJ'] as const;
export const PAUSE_KEYS = ['Escape', 'KeyP'] as const;

/** Pitch ramps towards +-1 at this rate (units per second) while a pitch key is held... */
export const PITCH_RAMP_RATE = 4;
/** ...and returns to 0 at this rate once released. */
export const PITCH_RETURN_RATE = 6;

const DIR_OF = new Map<string, -1 | 1>([
  ...LEFT_KEYS.map((k) => [k, -1] as [string, -1]),
  ...RIGHT_KEYS.map((k) => [k, 1] as [string, 1]),
]);
const PITCH_OF = new Map<string, -1 | 1>([
  ...UP_KEYS.map((k) => [k, 1] as [string, 1]),
  ...DOWN_KEYS.map((k) => [k, -1] as [string, -1]),
]);
const GADGET_SET: ReadonlySet<string> = new Set(GADGET_KEYS);
const PAUSE_SET: ReadonlySet<string> = new Set(PAUSE_KEYS);
/** Keys whose default action (page scroll) must be suppressed while the game has focus. */
const SCROLL_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

export interface KeyboardState {
  /** Held direction keys in press order (oldest first). The newest decides the direction. */
  readonly dirKeys: readonly string[];
  /** Held pitch keys in press order (oldest first). The newest decides the pitch target. */
  readonly pitchKeys: readonly string[];
  /** Held gadget keys. */
  readonly gadgetKeys: readonly string[];
  /** Ramped analog pitch in [-1, 1], +1 = nose up. NOT yet affected by `invertPitch`. */
  readonly pitch: number;
}

export const KEYBOARD_IDLE: KeyboardState = Object.freeze({
  dirKeys: [],
  pitchKeys: [],
  gadgetKeys: [],
  pitch: 0,
});

/** Is this one of the keys the game listens to? */
export function isGameKey(code: string): boolean {
  return DIR_OF.has(code) || PITCH_OF.has(code) || GADGET_SET.has(code) || PAUSE_SET.has(code);
}

/** Should the browser's default action for this key be prevented (arrows / space would scroll)? */
export function shouldPreventDefault(code: string): boolean {
  return SCROLL_KEYS.has(code);
}

export interface KeyDownResult {
  state: KeyboardState;
  /** The first gadget key just went down (rising edge of the keyboard's gadget state). */
  gadgetPressed: boolean;
  /** A pause key went down. */
  pausePressed: boolean;
}

/**
 * A key went down. Idempotent for keys that are already held, so OS auto-repeat can never reorder
 * keys or re-trigger an edge (the DOM layer additionally drops `event.repeat`).
 */
export function keyboardKeyDown(s: KeyboardState, code: string): KeyDownResult {
  if (DIR_OF.has(code)) {
    const state = s.dirKeys.includes(code) ? s : { ...s, dirKeys: [...s.dirKeys, code] };
    return { state, gadgetPressed: false, pausePressed: false };
  }
  if (PITCH_OF.has(code)) {
    const state = s.pitchKeys.includes(code) ? s : { ...s, pitchKeys: [...s.pitchKeys, code] };
    return { state, gadgetPressed: false, pausePressed: false };
  }
  if (GADGET_SET.has(code)) {
    if (s.gadgetKeys.includes(code)) return { state: s, gadgetPressed: false, pausePressed: false };
    return {
      state: { ...s, gadgetKeys: [...s.gadgetKeys, code] },
      gadgetPressed: s.gadgetKeys.length === 0,
      pausePressed: false,
    };
  }
  if (PAUSE_SET.has(code)) return { state: s, gadgetPressed: false, pausePressed: true };
  return { state: s, gadgetPressed: false, pausePressed: false };
}

/** A key went up. Releasing the newest direction key falls back to an older one that is still held. */
export function keyboardKeyUp(s: KeyboardState, code: string): KeyboardState {
  if (s.dirKeys.includes(code)) return { ...s, dirKeys: s.dirKeys.filter((k) => k !== code) };
  if (s.pitchKeys.includes(code)) return { ...s, pitchKeys: s.pitchKeys.filter((k) => k !== code) };
  if (s.gadgetKeys.includes(code)) return { ...s, gadgetKeys: s.gadgetKeys.filter((k) => k !== code) };
  return s;
}

/** Advance the analog pitch ramp by `dt` seconds (call once per fixed step). */
export function keyboardTick(s: KeyboardState, dt: number): KeyboardState {
  if (!(dt > 0)) return s;
  const target = keyboardPitchTarget(s);
  const rate = target !== 0 ? PITCH_RAMP_RATE : PITCH_RETURN_RATE;
  const pitch = approach(s.pitch, target, rate * dt);
  return pitch === s.pitch ? s : { ...s, pitch };
}

/** Direction from the most recently pressed direction key still held (0 = none). */
export function keyboardDir(s: KeyboardState): -1 | 0 | 1 {
  if (s.dirKeys.length === 0) return 0;
  return DIR_OF.get(s.dirKeys[s.dirKeys.length - 1]) ?? 0;
}

/** Pitch the ramp is heading for: +1 / -1 from the most recently pressed pitch key, 0 if none held. */
export function keyboardPitchTarget(s: KeyboardState): -1 | 0 | 1 {
  if (s.pitchKeys.length === 0) return 0;
  return PITCH_OF.get(s.pitchKeys[s.pitchKeys.length - 1]) ?? 0;
}

/** Is any gadget key held? */
export function keyboardGadget(s: KeyboardState): boolean {
  return s.gadgetKeys.length > 0;
}
