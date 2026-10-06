/**
 * Plane-vs-room collisions. The plane is a convex hull of its side profile (room pixels), tested
 * against axis-aligned box colliders with the separating axis theorem.
 */

import type { PlaneMesh } from '../paper/build';
import { PX_PER_M } from '../physics/config';
import type { Collider } from '../world/types';

export interface V {
  x: number;
  y: number;
}

/** Convex hull (monotone chain) of points. */
export function hull(points: V[]): V[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: V, a: V, b: V) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: V[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: V[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/**
 * Side-profile hull of the plane in plane-local pixels (x forward, y UP), from the mesh.
 * Simplified to at most ~8 points.
 */
export function profileHull(mesh: PlaneMesh): V[] {
  const pts: V[] = [];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) pts.push({ x: p[i] * PX_PER_M, y: p[i + 1] * PX_PER_M });
  let h = hull(pts);
  // Simplify: drop points very close to their neighbours.
  while (h.length > 8) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < h.length; i++) {
      const a = h[(i + h.length - 1) % h.length];
      const b = h[i];
      const c = h[(i + 1) % h.length];
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (area < bestD) {
        bestD = area;
        best = i;
      }
    }
    h.splice(best, 1);
  }
  // keep a little thickness so very flat planes still collide
  const minY = Math.min(...h.map((q) => q.y));
  const maxY = Math.max(...h.map((q) => q.y));
  if (maxY - minY < 3) h = h.map((q) => ({ x: q.x, y: q.y < (minY + maxY) / 2 ? q.y - 1.5 : q.y + 1.5 }));
  return h;
}

/**
 * Transform the local hull into room pixels (y DOWN) for a given pose.
 * `squash` < 1 narrows the profile (during turnarounds the plane is seen end-on).
 */
export function worldHull(local: V[], x: number, y: number, theta: number, facing: number, squash = 1): V[] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return local.map((q) => {
    const lx = q.x * squash;
    const ly = q.y;
    const rx = lx * c - ly * s;
    const ry = lx * s + ly * c;
    return { x: x + rx * facing, y: y - ry };
  });
}

export interface Contact {
  /** Unit normal pointing out of the collider, towards the plane (room px, y down). */
  nx: number;
  ny: number;
  depth: number;
  /** Deepest plane point. */
  px: number;
  py: number;
  collider: Collider;
}

/** SAT test: convex polygon vs AABB. Returns the minimum translation contact or null. */
export function polyVsBox(poly: V[], box: Collider): Contact | null {
  const axes: V[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l = Math.hypot(ex, ey);
    if (l > 1e-6) axes.push({ x: -ey / l, y: ex / l });
  }
  const bc = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  let best = Infinity;
  let bn = { x: 0, y: 0 };
  for (const ax of axes) {
    let pmin = Infinity;
    let pmax = -Infinity;
    for (const p of poly) {
      const d = p.x * ax.x + p.y * ax.y;
      pmin = Math.min(pmin, d);
      pmax = Math.max(pmax, d);
    }
    const r = (box.w / 2) * Math.abs(ax.x) + (box.h / 2) * Math.abs(ax.y);
    const c = bc.x * ax.x + bc.y * ax.y;
    const bmin = c - r;
    const bmax = c + r;
    if (Math.min(pmax, bmax) - Math.max(pmin, bmin) <= 0) return null;
    // how far the polygon must move along the axis to be clear of the box, out of either side (where the polygon
    // lies within the box along it, that is past the nearer side, not just its own thickness: a thin hull deep in a
    // wall is pushed back out of the wall, not along it)
    const up = bmax - pmin;
    const down = pmax - bmin;
    const overlap = Math.min(up, down);
    if (overlap < best) {
      best = overlap;
      // normal points from box towards polygon
      bn = up <= down ? { x: ax.x, y: ax.y } : { x: -ax.x, y: -ax.y };
    }
  }
  // deepest point of the polygon against the normal
  let dp = poly[0];
  let dmin = Infinity;
  for (const p of poly) {
    const d = p.x * bn.x + p.y * bn.y;
    if (d < dmin) {
      dmin = d;
      dp = p;
    }
  }
  return { nx: bn.x, ny: bn.y, depth: best, px: dp.x, py: dp.y, collider: box };
}

export function bounds(poly: V[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

/** First surface top under (x, y) among colliders: used for the shadow. */
export function surfaceBelow(colliders: Collider[], x: number, y: number): number {
  let best = 400;
  for (const c of colliders) {
    if (x < c.x || x > c.x + c.w) continue;
    if (c.y >= y - 2 && c.y < best) best = c.y;
  }
  return best;
}
