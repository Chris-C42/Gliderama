/**
 * Gamepad ("standard" mapping) to game controls, as pure functions over a structural `PadLike`
 * (the DOM `Gamepad` satisfies it), so everything except `readNavigatorPads` runs in node.
 *
 *   Left stick X            dir, deadzone 0.35 (|x| must be strictly greater to count)
 *   Left stick Y            pitch, inverted so stick up = +, deadzone 0.12, rescaled to a smooth 0..1
 *   D-pad                   digital dir / pitch (wins over the stick when pressed)
 *   Button 0 (A)            gadget
 *   Button 9 (Start)        pause
 */

import { clamp, sign } from '../core/math';

export const PAD_BUTTON = {
  A: 0,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

/** Stick X deadzone for left / right. */
export const DIR_DEADZONE = 0.35;
/** Stick Y deadzone for pitch. */
export const PITCH_DEADZONE = 0.12;

export interface PadButtonLike {
  readonly pressed: boolean;
  readonly value?: number;
}

export interface PadLike {
  readonly axes: readonly number[];
  readonly buttons: readonly PadButtonLike[];
  readonly mapping?: string;
  readonly connected?: boolean;
}

/** Raw, normalised reading of one pad. `y` is already flipped so that stick up = positive. */
export interface PadRaw {
  x: number;
  y: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  a: boolean;
  start: boolean;
}

export const PAD_RAW_IDLE: PadRaw = Object.freeze({
  x: 0,
  y: 0,
  up: false,
  down: false,
  left: false,
  right: false,
  a: false,
  start: false,
});

/** Controls derived from a pad, in the same conventions as `ControlState` (pitch is pre-`invertPitch`). */
export interface PadInput {
  dir: -1 | 0 | 1;
  pitch: number;
  gadget: boolean;
  pause: boolean;
}

export const PAD_IDLE: PadInput = Object.freeze({ dir: 0, pitch: 0, gadget: false, pause: false });

/**
 * Remove a deadzone and rescale the rest so the output still spans 0..1 smoothly:
 * |v| <= dz -> 0, |v| = 1 -> +-1.
 */
export function rescaleDeadzone(v: number, deadzone: number): number {
  const m = Math.abs(v);
  if (m <= deadzone) return 0;
  return sign(v) * Math.min(1, (m - deadzone) / (1 - deadzone));
}

/** Read the buttons / sticks we care about from a pad. Missing axes / buttons read as neutral. */
export function readPad(pad: PadLike): PadRaw {
  const axis = (i: number): number => {
    const v = pad.axes[i];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, -1, 1) : 0;
  };
  const button = (i: number): boolean => {
    const b = pad.buttons[i];
    return !!b && (b.pressed || (b.value ?? 0) > 0.5);
  };
  return {
    x: axis(0) + 0,
    y: -axis(1) + 0, // Gamepad API: stick down = +1. Flip so up = +. ("+ 0" avoids -0.)
    up: button(PAD_BUTTON.DPAD_UP),
    down: button(PAD_BUTTON.DPAD_DOWN),
    left: button(PAD_BUTTON.DPAD_LEFT),
    right: button(PAD_BUTTON.DPAD_RIGHT),
    a: button(PAD_BUTTON.A),
    start: button(PAD_BUTTON.START),
  };
}

/** Merge several pads: buttons are OR-ed, the stick with the biggest deflection wins. */
export function combinePadRaw(list: readonly PadRaw[]): PadRaw {
  if (list.length === 0) return PAD_RAW_IDLE;
  if (list.length === 1) return list[0];
  let best = list[0];
  let bestMag = -1;
  const out: PadRaw = { x: 0, y: 0, up: false, down: false, left: false, right: false, a: false, start: false };
  for (const r of list) {
    const mag = r.x * r.x + r.y * r.y;
    if (mag > bestMag) {
      best = r;
      bestMag = mag;
    }
    out.up ||= r.up;
    out.down ||= r.down;
    out.left ||= r.left;
    out.right ||= r.right;
    out.a ||= r.a;
    out.start ||= r.start;
  }
  out.x = best.x;
  out.y = best.y;
  return out;
}

/** Raw pad reading -> game controls. */
export function mapPadRaw(raw: PadRaw): PadInput {
  let dir: -1 | 0 | 1 = raw.x < -DIR_DEADZONE ? -1 : raw.x > DIR_DEADZONE ? 1 : 0;
  const dpadX = (raw.right ? 1 : 0) - (raw.left ? 1 : 0);
  if (dpadX !== 0) dir = dpadX > 0 ? 1 : -1;

  let pitch = rescaleDeadzone(raw.y, PITCH_DEADZONE);
  const dpadY = (raw.up ? 1 : 0) - (raw.down ? 1 : 0);
  if (dpadY !== 0) pitch = dpadY;

  return { dir, pitch: pitch + 0, gadget: raw.a, pause: raw.start };
}

/** Convenience: one pad -> game controls. */
export function mapPad(pad: PadLike): PadInput {
  return mapPadRaw(readPad(pad));
}

/** Rising edges between two successive polls. */
export function padEdges(prev: PadInput, next: PadInput): { gadget: boolean; pause: boolean } {
  return { gadget: !prev.gadget && next.gadget, pause: !prev.pause && next.pause };
}

/**
 * Pick the pads to listen to: connected ones only, and if any report the "standard" mapping, only
 * those (other devices may use a different button layout). Null / undefined slots are skipped.
 */
export function selectPads(list: ArrayLike<PadLike | null | undefined>): PadLike[] {
  const connected: PadLike[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p && p.connected !== false) connected.push(p);
  }
  const standard = connected.filter((p) => p.mapping === 'standard');
  return standard.length > 0 ? standard : connected;
}

/** Currently connected pads from `navigator.getGamepads()` (empty when unsupported or blocked). */
export function readNavigatorPads(): PadLike[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  try {
    return selectPads(navigator.getGamepads());
  } catch {
    return []; // SecurityError in insecure contexts / when blocked by permissions policy
  }
}
