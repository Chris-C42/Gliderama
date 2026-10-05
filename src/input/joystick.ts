/**
 * Logic of the one-thumb floating joystick as pure functions and a small reducer (no DOM), used by
 * `TouchControls` when `Settings.touchLayout` is `'joystick'`.
 *
 * The thumb can land anywhere in the joystick zone; that touch-down point is the stick's centre. The
 * thumb's offset from it, `(dx, dy)` in CSS px (screen y-down), and the stick's `radius`
 * (`Settings.sliderTravel`: px of travel for full deflection) give:
 *
 *  - dir    -1 / 0 / +1 from the horizontal offset. It engages once |dx| passes 35 % of the radius and
 *           stays engaged until |dx| falls under 22 % (hysteresis, so a thumb resting near the edge
 *           doesn't flicker). Like the pads it is the direction *held*: the side the plane already
 *           faces only lets you pitch, the other side turns it round. Swinging straight across the
 *           centre switches sides.
 *  - pitch  -1 (nose down) .. +1 (nose up): clamp(-dy / radius, -1, 1) with an 8 % dead zone around
 *           the centre, rescaled so full deflection still gives exactly +-1. Raw value (up = +);
 *           `InputManager` applies `invertPitch`. It does not depend on `dir`, so pushing straight up
 *           or down pitches without turning.
 *  - knob   the offset clamped to a circle of `radius`, for drawing.
 *
 * `joystickOutput` is the stateless core. `joystickReduce` / `joystickView` add the touch bookkeeping
 * the component needs: which pointer owns the stick (one at a time) and the hysteresis memory.
 */

import { clamp } from '../core/math';

/** |dx| / radius above which a direction engages. */
export const JOYSTICK_ENGAGE = 0.35;
/** |dx| / radius below which an engaged direction lets go (lower than the engage point on purpose). */
export const JOYSTICK_RELEASE = 0.22;
/** |dy| / radius around the centre that gives no pitch. */
export const JOYSTICK_PITCH_DEADZONE = 0.08;

export interface JoystickOutput {
  dir: -1 | 0 | 1;
  /** Elevator deflection, -1..1, up = +, *not* inverted. */
  pitch: number;
  /** Knob offset from the stick centre in px (y-down): the thumb offset clamped to a circle of `radius`. */
  knobX: number;
  knobY: number;
}

/**
 * Direction from the horizontal offset `dx` (px; right = +), given the direction engaged a moment ago.
 * `radius` <= 0 (nonsense travel) engages nothing.
 */
export function joystickDir(dx: number, radius: number, prevDir: -1 | 0 | 1 = 0): -1 | 0 | 1 {
  if (!(radius > 0)) return 0;
  const release = JOYSTICK_RELEASE * radius;
  // Still on the engaged side and not yet back inside the release band: keep it.
  if (prevDir === 1 && dx >= release) return 1;
  if (prevDir === -1 && dx <= -release) return -1;
  // Nothing engaged, just released, or swung across to the other side: the engage point decides.
  const engage = JOYSTICK_ENGAGE * radius;
  if (dx > engage) return 1;
  if (dx < -engage) return -1;
  return 0;
}

/**
 * Pitch from the vertical offset `dy` (px, screen y-down: up is negative, nose up). The dead zone is
 * taken off both ends of the range and the rest stretched back to +-1, so there is no jump when the
 * thumb leaves the dead zone and full deflection is still exactly +-1.
 */
export function joystickPitch(dy: number, radius: number): number {
  if (!(radius > 0)) return 0;
  const v = clamp(-dy / radius, -1, 1);
  const a = Math.abs(v);
  if (a < JOYSTICK_PITCH_DEADZONE) return 0;
  return Math.sign(v) * ((a - JOYSTICK_PITCH_DEADZONE) / (1 - JOYSTICK_PITCH_DEADZONE)) + 0; // "+ 0" turns -0 into 0
}

/** Knob position: the offset `(dx, dy)` pulled back onto the circle of `radius` when it is outside. */
export function joystickKnob(dx: number, dy: number, radius: number): { x: number; y: number } {
  if (!(radius > 0)) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  if (len <= radius) return { x: dx + 0, y: dy + 0 };
  const k = radius / len;
  return { x: dx * k + 0, y: dy * k + 0 };
}

/** Everything the stick reports for a thumb at offset `(dx, dy)` from its centre. `prevDir` feeds the hysteresis. */
export function joystickOutput(dx: number, dy: number, radius: number, prevDir: -1 | 0 | 1 = 0): JoystickOutput {
  const knob = joystickKnob(dx, dy, radius);
  return { dir: joystickDir(dx, radius, prevDir), pitch: joystickPitch(dy, radius), knobX: knob.x, knobY: knob.y };
}

// ---------------------------------------------------------------------------------------------
// Touch bookkeeping
// ---------------------------------------------------------------------------------------------

export interface JoystickHold {
  /** Pointer that owns the stick. */
  pointerId: number;
  /** Touch-down point (stick centre), in the coordinate space of the controls root, px. */
  x: number;
  y: number;
  /** Current thumb position in the same space, px. */
  curX: number;
  curY: number;
  /** Direction engaged so far: the hysteresis memory. */
  dir: -1 | 0 | 1;
}

/** `null` while no thumb is on the stick. */
export type JoystickState = JoystickHold | null;

export const JOYSTICK_IDLE: JoystickState = null;

export type JoystickAction =
  | { type: 'down'; pointerId: number; x: number; y: number }
  | { type: 'move'; pointerId: number; x: number; y: number }
  | { type: 'up'; pointerId: number }
  | { type: 'reset' };

/**
 * One pointer at a time: a second finger landing while the stick is held is ignored. The same pointer
 * pressing again takes the stick over and re-centres it (this also recovers from a lost pointerup).
 * `radius` is only used to track the hysteresis on moves.
 */
export function joystickReduce(state: JoystickState, action: JoystickAction, radius: number): JoystickState {
  switch (action.type) {
    case 'down':
      if (state && state.pointerId !== action.pointerId) return state;
      return { pointerId: action.pointerId, x: action.x, y: action.y, curX: action.x, curY: action.y, dir: 0 };
    case 'move': {
      if (!state || state.pointerId !== action.pointerId) return state;
      if (state.curX === action.x && state.curY === action.y) return state;
      const dir = joystickDir(action.x - state.x, radius, state.dir);
      return { ...state, curX: action.x, curY: action.y, dir };
    }
    case 'up':
      return state && state.pointerId === action.pointerId ? null : state;
    case 'reset':
      return null;
  }
}

export interface JoystickView extends JoystickOutput {
  /** A thumb is on the stick. */
  held: boolean;
  /** Stick centre (the touch-down point) in the coordinate space of the actions; 0 when not held. */
  x: number;
  y: number;
}

const IDLE_VIEW: JoystickView = Object.freeze({ held: false, x: 0, y: 0, dir: 0, pitch: 0, knobX: 0, knobY: 0 });

/** What to report and draw for the state: idle gives dir 0, pitch 0 and no stick. */
export function joystickView(state: JoystickState, radius: number): JoystickView {
  if (!state) return IDLE_VIEW;
  const out = joystickOutput(state.curX - state.x, state.curY - state.y, radius, state.dir);
  return { held: true, x: state.x, y: state.y, ...out };
}
