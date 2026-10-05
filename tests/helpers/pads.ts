import type { PadLike } from '../../src/input/gamepad';

/**
 * A "standard" pad reading: `axes` = [leftX, leftY, rightX, rightY] (Gamepad API convention: stick
 * DOWN is +1), `pressed` = indices of pressed buttons (0 = A, 9 = Start, 12..15 = D-pad up / down /
 * left / right).
 */
export function pad(axes: number[] = [0, 0, 0, 0], pressed: number[] = [], extra: Partial<PadLike> = {}): PadLike {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: pressed.includes(i),
      value: pressed.includes(i) ? 1 : 0,
    })),
    mapping: 'standard',
    connected: true,
    ...extra,
  };
}

export const A = 0;
export const START = 9;
export const DPAD_UP = 12;
export const DPAD_DOWN = 13;
export const DPAD_LEFT = 14;
export const DPAD_RIGHT = 15;
