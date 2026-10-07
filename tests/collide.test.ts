/** Plane-vs-room collisions: the separating axis test's way out of a box. */

import { describe, expect, it } from 'vitest';
import { polyVsBox } from '../src/game/collide';

/** A thin hull (as a plane seen side on): 40 × 4 px with its top-left at (x, y). */
const thin = (x: number, y: number) => [
  { x, y },
  { x: x + 40, y },
  { x: x + 40, y: y + 4 },
  { x, y: y + 4 },
];

describe('polyVsBox', () => {
  it('pushes a hull resting on a box straight up out of it', () => {
    const c = polyVsBox(thin(10, 98), { x: 0, y: 100, w: 200, h: 50 })!;
    expect(c.ny).toBe(-1);
    expect(c.depth).toBeCloseTo(2);
  });

  it('pushes a thin hull that has gone deep into a wall back out of the wall, not along it', () => {
    // 20 px into a wall 360 px tall: out of its side, not 4 px (the hull's thickness) up or down inside it
    const c = polyVsBox(thin(80, 100), { x: 0, y: 0, w: 100, h: 360 })!;
    expect(c.nx).toBe(1);
    expect(c.ny).toBe(0);
    expect(c.depth).toBeCloseTo(20);
  });

  it('finds nothing when the hull is clear of the box', () => {
    expect(polyVsBox(thin(120, 100), { x: 0, y: 0, w: 100, h: 360 })).toBeNull();
  });
});
