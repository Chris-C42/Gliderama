/**
 * Merging the three input sources (touch, keyboard, gamepad) into one set of controls.
 * Pure functions; `InputManager` supplies the data.
 */

import { clamp } from '../core/math';

export interface DirSource {
  /** The source's own direction: -1, 0 or +1. */
  dir: -1 | 0 | 1;
  /**
   * Monotonic stamp of the moment this source's `dir` last changed (bigger = more recent). A
   * sequence counter works as well as a timestamp and is immune to clock quirks.
   */
  stamp: number;
}

/**
 * Direction: the source whose direction changed most recently wins, among sources that currently
 * have a direction. When it lets go, the next most recent still-held source takes over; with
 * nothing held the result is 0. On equal stamps the later entry in `sources` wins.
 */
export function mergeDir(sources: readonly DirSource[]): -1 | 0 | 1 {
  let best: -1 | 0 | 1 = 0;
  let bestStamp = -Infinity;
  for (const s of sources) {
    if (s.dir !== 0 && s.stamp >= bestStamp) {
      best = s.dir;
      bestStamp = s.stamp;
    }
  }
  return best;
}

export interface PitchSources {
  /** True while any touch direction pad is held. */
  touchActive: boolean;
  /** Touch slider deflection, -1..1, up = +. */
  touch: number;
  /** Gamepad pitch with its deadzone already removed (exactly 0 inside the deadzone), -1..1. */
  pad: number;
  /** Ramped keyboard pitch, -1..1. */
  keyboard: number;
}

/**
 * Pitch priority: the touch slider while a pad is held (even when it sits at neutral), else the
 * gamepad when its stick is out of the deadzone, else the keyboard. Raw convention: up = +.
 */
export function mergePitch(s: PitchSources): number {
  if (s.touchActive) return s.touch;
  if (s.pad !== 0) return s.pad;
  return s.keyboard;
}

/** Apply `invertPitch`, clamp to [-1, 1] and normalise -0 to 0. */
export function finalizePitch(raw: number, invert: boolean): number {
  return clamp(invert ? -raw : raw, -1, 1) + 0;
}
