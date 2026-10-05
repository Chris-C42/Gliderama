/** Shapes for the air-current lines, read straight off each object's own wind field. */

import type { AirPoint } from '../../render/airLines';

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * `n` straight streamlines fanning from the source span (s0 to s1) out to the end span (e0 to e1),
 * both spans given in the same order across the current.
 */
export function fanOut(n: number, s0: AirPoint, s1: AirPoint, e0: AirPoint, e1: AirPoint): AirPoint[][] {
  const out: AirPoint[][] = [];
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    out.push([
      { x: lerp(s0.x, s1.x, u), y: lerp(s0.y, s1.y, u) },
      { x: lerp(e0.x, e1.x, u), y: lerp(e0.y, e1.y, u) },
    ]);
  }
  return out;
}

/** How many lines suit a current about `width` px across. */
export function lineCount(width: number, gap: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(width / gap) + 1));
}
