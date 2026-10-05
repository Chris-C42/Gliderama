/**
 * Logic of the two on-screen direction pads as a pure reducer (no DOM), used by `TouchControls`.
 *
 * Each pad can be held by one pointer. Holding a pad makes it a vertical slider whose neutral
 * point is where the finger landed. With two thumbs down, the most recently pressed pad is the
 * *active* one: it supplies the direction and the pitch. When it lets go the other pad (still
 * held, and still tracking its own finger) takes over; with neither held, dir and pitch are 0.
 */

import { clamp } from '../core/math';

export type PadSide = 'left' | 'right';

export interface PadHold {
  /** Pointer that owns this pad. */
  pointerId: number;
  /** Touch-down point (slider centre), in the coordinate space of the controls root, px. */
  x: number;
  y: number;
  /** Current finger y in the same space, px. */
  curY: number;
  /** Press order; bigger = more recent. */
  order: number;
}

export interface TouchPadsState {
  readonly left: PadHold | null;
  readonly right: PadHold | null;
  /** Number of presses so far (source of `order`). */
  readonly presses: number;
}

export const TOUCH_PADS_IDLE: TouchPadsState = Object.freeze({ left: null, right: null, presses: 0 });

export type TouchPadsAction =
  | { type: 'down'; side: PadSide; pointerId: number; x: number; y: number }
  | { type: 'move'; pointerId: number; y: number }
  | { type: 'up'; pointerId: number }
  | { type: 'reset' };

/**
 * Slider maths: pitch from the finger's vertical offset `dy` (px, screen y-down) relative to the
 * touch-down point. Up (negative dy) = nose up (+). `travel` px of travel = full deflection.
 * This is the raw value; `InputManager` applies `invertPitch`.
 */
export function sliderPitch(dy: number, travel: number): number {
  if (!(travel > 0)) return 0;
  return clamp(-dy / travel, -1, 1) + 0; // "+ 0" turns -0 into 0
}

/** Knob offset in px from the slider centre (clamped to the track), y-down like the screen. */
export function sliderKnobOffset(dy: number, travel: number): number {
  return clamp(dy, -travel, travel) + 0;
}

export function touchPadsReduce(state: TouchPadsState, action: TouchPadsAction): TouchPadsState {
  switch (action.type) {
    case 'down': {
      // A pointer can only hold one pad, and a fresh press on a held pad takes it over (this also
      // recovers from a lost pointerup).
      const cleared = releasePointer(state, action.pointerId);
      const presses = cleared.presses + 1;
      const hold: PadHold = {
        pointerId: action.pointerId,
        x: action.x,
        y: action.y,
        curY: action.y,
        order: presses,
      };
      return action.side === 'left' ? { ...cleared, left: hold, presses } : { ...cleared, right: hold, presses };
    }
    case 'move': {
      const { left, right } = state;
      if (left && left.pointerId === action.pointerId) {
        return left.curY === action.y ? state : { ...state, left: { ...left, curY: action.y } };
      }
      if (right && right.pointerId === action.pointerId) {
        return right.curY === action.y ? state : { ...state, right: { ...right, curY: action.y } };
      }
      return state;
    }
    case 'up':
      return releasePointer(state, action.pointerId);
    case 'reset':
      return state.left || state.right ? { ...TOUCH_PADS_IDLE, presses: state.presses } : state;
  }
}

function releasePointer(state: TouchPadsState, pointerId: number): TouchPadsState {
  let { left, right } = state;
  if (left && left.pointerId === pointerId) left = null;
  if (right && right.pointerId === pointerId) right = null;
  return left === state.left && right === state.right ? state : { ...state, left, right };
}

export interface TouchPadsOutput {
  /** Which pad currently supplies dir + pitch (the most recently pressed held pad), if any. */
  active: PadSide | null;
  dir: -1 | 0 | 1;
  /** Slider deflection of the active pad, -1..1, up = +; 0 when no pad is held. */
  pitch: number;
  leftHeld: boolean;
  rightHeld: boolean;
}

export function touchPadsOutput(state: TouchPadsState, travel: number): TouchPadsOutput {
  const { left, right } = state;
  let active: PadSide | null = null;
  if (left && right) active = left.order > right.order ? 'left' : 'right';
  else if (left) active = 'left';
  else if (right) active = 'right';

  const hold = active === 'left' ? left : active === 'right' ? right : null;
  return {
    active,
    dir: active === 'left' ? -1 : active === 'right' ? 1 : 0,
    pitch: hold ? sliderPitch(hold.curY - hold.y, travel) : 0,
    leftHeld: left !== null,
    rightHeld: right !== null,
  };
}
