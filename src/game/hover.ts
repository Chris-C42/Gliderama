/**
 * Hover assist: keeps the plane circling over the strongest rising air near it, turning round by
 * itself so a vent can be climbed without flopping back and forth by hand. In still air it holds
 * the plane around where hover was switched on. The player's pitch still works; pressing a
 * direction hands control straight back (the session switches hover off).
 */

import { PX_PER_M } from '../physics/config';
import type { Plane, WindFn } from '../physics/flight';

/** How far past the centre of the circle the plane flies before turning round (room px). */
const SWING = 14;
/** How far either side the plane looks for rising air when hover starts, and as it climbs (px). */
const SEARCH = 120;
const FOLLOW = 48;
/** Rising air (m/s) worth circling in. */
const MIN_LIFT = 0.5;

export class HoverPilot {
  /** Centre of the circle (room px). */
  centre: number;
  private retarget = 0;

  constructor(p: Plane, wind: WindFn) {
    const x = p.x * PX_PER_M;
    this.centre = core(p, wind, x, SEARCH) ?? x;
  }

  /** The direction to hold this tick (0 while a turnaround is under way). */
  step(p: Plane, wind: WindFn, dt: number): -1 | 0 | 1 {
    // follow the core of the column as the plane climbs (columns lean and widen)
    this.retarget -= dt;
    if (this.retarget <= 0) {
      this.retarget = 0.25;
      const c = core(p, wind, this.centre, FOLLOW);
      if (c !== null) this.centre += (c - this.centre) * 0.5;
    }
    if (p.turn) return 0;
    const x = p.x * PX_PER_M;
    if (p.facing > 0 && x > this.centre + SWING) return -1;
    if (p.facing < 0 && x < this.centre - SWING) return 1;
    return 0;
  }
}

/** The x (room px) of the strongest rising air within `range` of `around`, at the plane's height. */
function core(p: Plane, wind: WindFn, around: number, range: number): number | null {
  const ym = p.y;
  let best = MIN_LIFT;
  let at: number | null = null;
  for (let dx = -range; dx <= range; dx += 6) {
    const x = around + dx;
    if (x < 8 || x > 632) continue;
    const w = wind(x / PX_PER_M, ym).y;
    // prefer the nearer of two equal columns
    const score = w - Math.abs(dx) * 0.002;
    if (score > best) {
      best = score;
      at = x;
    }
  }
  return at;
}
