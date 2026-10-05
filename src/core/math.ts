/**
 * Math utilities: scalars, 2D vectors, AABB / segment queries and easings.
 *
 * Everything here is a pure function. Vectors are plain `{ x, y }` objects and are never
 * mutated; functions that return a vector allocate a fresh one. Angles are radians.
 *
 * The vector helpers are coordinate-system agnostic. "Counter-clockwise" below means "from +x
 * towards +y", which looks clockwise on screen when y points down (as it does in room pixels).
 */

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------------------------

/** Clamp `v` into [lo, hi]. Requires lo <= hi. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation; `t` is not clamped. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inverse of `lerp`: where does `v` sit between `a` and `b`? Not clamped; 0 when a === b. */
export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

/** Map `v` from [inLo, inHi] onto [outLo, outHi]. Not clamped. */
export function remap(v: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  return lerp(outLo, outHi, invLerp(inLo, inHi, v));
}

/** Hermite smoothstep (GLSL semantics). Degenerates to a step when the edges are equal. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Move `cur` towards `target` by at most `maxDelta` (never overshoots). */
export function approach(cur: number, target: number, maxDelta: number): number {
  const d = target - cur;
  const m = Math.abs(maxDelta);
  return Math.abs(d) <= m ? target : cur + (d > 0 ? m : -m);
}

/**
 * Wrap an angle into [-PI, PI]. Angles already in range are returned unchanged (bit-exact);
 * out-of-range angles land in [-PI, PI).
 */
export function wrapAngle(a: number): number {
  if (a >= -Math.PI && a <= Math.PI) return a;
  return a - TAU * Math.floor((a + Math.PI) / TAU);
}

/** Shortest signed rotation (radians, in [-PI, PI]) that takes angle `from` to angle `to`. */
export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** -1, 0 or 1. Returns 0 for 0, -0 and NaN. */
export function sign(x: number): -1 | 0 | 1 {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Vec2
// ---------------------------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

export function v2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 2D cross product (the z component of the 3D cross): positive when `b` is counter-clockwise of `a`. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Squared length (no sqrt). */
export function len2(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

/** Length. Uses sqrt (correctly rounded everywhere) rather than Math.hypot (implementation-defined). */
export function len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

/** Unit vector in the direction of `a`; the zero vector maps to the zero vector (never NaN). */
export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Rotate counter-clockwise (+x towards +y) by `angle` radians. */
export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** `a` rotated +90 degrees counter-clockwise: (x, y) -> (-y, x). */
export function perp(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x };
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

export function lerpV(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ---------------------------------------------------------------------------------------------
// AABB & segments
// ---------------------------------------------------------------------------------------------

/** Axis-aligned box: (x, y) is the minimum corner, w and h are extents (>= 0). */
export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Point-in-box. Half-open: includes the min edges, excludes the max edges (tiles never overlap). */
export function aabbContains(box: AABB, p: Vec2): boolean {
  return p.x >= box.x && p.x < box.x + box.w && p.y >= box.y && p.y < box.y + box.h;
}

/** Box-box overlap with positive area (boxes that merely touch do not intersect). */
export function aabbIntersects(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export { aabbContains as contains, aabbIntersects as intersects };

export interface SegmentHit {
  /** Fraction along p0 -> p1 (0..1) where the segment enters the box. */
  t: number;
  /** Unit, axis-aligned outward normal of the face that was entered. */
  normal: Vec2;
}

/**
 * Sweep the segment p0 -> p1 against `box` (slab method).
 *
 * - Returns the first entry: `t` in [0, 1] and the outward normal of the face entered. Normals are
 *   in the box's own coordinates (in y-down room pixels, hitting the top face gives (0, -1)).
 * - A segment that starts inside the box reports `t = 0` with the normal of the nearest face, i.e.
 *   the direction that pushes `p0` back out.
 * - A segment that starts on the boundary and moves away, or that merely slides along a face or
 *   touches a corner, is not a hit. Reaching a face exactly at p1 (`t = 1`) is a hit.
 * - Callers resolving a collision should still ignore hits where `dot(p1 - p0, normal) >= 0`.
 */
export function segmentAABB(p0: Vec2, p1: Vec2, box: AABB): SegmentHit | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  let tNear = -Infinity;
  let tFar = Infinity;
  let nx = 0;
  let ny = 0;

  if (dx === 0) {
    if (p0.x <= box.x || p0.x >= box.x + box.w) return null;
  } else {
    let t1 = (box.x - p0.x) / dx;
    let t2 = (box.x + box.w - p0.x) / dx;
    let n = -1; // moving +x enters through the min-x face, whose normal is -x
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
      n = 1;
    }
    if (t1 > tNear) {
      tNear = t1;
      nx = n;
      ny = 0;
    }
    if (t2 < tFar) tFar = t2;
  }

  if (dy === 0) {
    if (p0.y <= box.y || p0.y >= box.y + box.h) return null;
  } else {
    let t1 = (box.y - p0.y) / dy;
    let t2 = (box.y + box.h - p0.y) / dy;
    let n = -1;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
      n = 1;
    }
    if (t1 > tNear) {
      tNear = t1;
      nx = 0;
      ny = n;
    }
    if (t2 < tFar) tFar = t2;
  }

  if (tNear >= tFar || tFar <= 0 || tNear > 1) return null;
  if (tNear < 0) return { t: 0, normal: nearestFaceNormal(p0, box) };
  return { t: tNear + 0, normal: { x: nx, y: ny } }; // "+ 0" turns -0 into 0
}

/** Outward normal of the box face closest to `p` (p is inside or on the box). */
function nearestFaceNormal(p: Vec2, box: AABB): Vec2 {
  const toMinX = p.x - box.x;
  const toMaxX = box.x + box.w - p.x;
  const toMinY = p.y - box.y;
  const toMaxY = box.y + box.h - p.y;
  const m = Math.min(toMinX, toMaxX, toMinY, toMaxY);
  if (m === toMinX) return { x: -1, y: 0 };
  if (m === toMaxX) return { x: 1, y: 0 };
  if (m === toMinY) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

/** Parameter (0..1) of the point on segment a-b that is closest to `p`. */
function closestParam(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  if (l2 === 0) return 0;
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** The point on segment a-b nearest to `p`. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const t = closestParam(p, a, b);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Shortest distance from point `p` to segment a-b (allocation free). */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const t = closestParam(p, a, b);
  const dx = p.x - (a.x + (b.x - a.x) * t);
  const dy = p.y - (a.y + (b.y - a.y) * t);
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------------------------
// Easings (input is clamped to [0, 1])
// ---------------------------------------------------------------------------------------------

export function easeInQuad(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u;
}

export function easeOutCubic(t: number): number {
  const u = 1 - clamp(t, 0, 1);
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  const u = clamp(t, 0, 1);
  if (u < 0.5) return 4 * u * u * u;
  const v = -2 * u + 2;
  return 1 - (v * v * v) / 2;
}

/** Overshoots past 1 and settles back. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = clamp(t, 0, 1) - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/** Springy overshoot that rings down to 1. */
export function easeOutElastic(t: number): number {
  const u = clamp(t, 0, 1);
  if (u === 0) return 0;
  if (u === 1) return 1;
  const c4 = TAU / 3;
  return Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * c4) + 1;
}
