/**
 * Small 2D geometry kit for the fold engine. Pure functions on plain {x, y} objects.
 * Convention: polygons are convex and wound with POSITIVE signed area (shoelace formula).
 */

export interface P2 {
  x: number;
  y: number;
}

export const EPS = 1e-7;
/** Geometric tolerance in millimetres for "on the line" tests. */
export const TOL = 1e-4;

export const p2 = (x: number, y: number): P2 => ({ x, y });
export const add = (a: P2, b: P2): P2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: P2, b: P2): P2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: P2, s: number): P2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: P2, b: P2): number => a.x * b.x + a.y * b.y;
export const cross = (a: P2, b: P2): number => a.x * b.y - a.y * b.x;
export const len = (a: P2): number => Math.hypot(a.x, a.y);
export const dist = (a: P2, b: P2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp2 = (a: P2, b: P2, t: number): P2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a: P2): P2 => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** Signed distance-like value: >0 if p is left of the directed line a→b (in shoelace orientation). */
export function sideValue(p: P2, a: P2, b: P2): number {
  const d = norm(sub(b, a));
  return cross(d, sub(p, a));
}

/** Reflect point p across the infinite line through a and b. */
export function reflect(p: P2, a: P2, b: P2): P2 {
  const d = norm(sub(b, a));
  const ap = sub(p, a);
  const t = dot(ap, d);
  const foot = add(a, mul(d, t));
  return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
}

export function signedArea(poly: P2[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function centroid(poly: P2[]): P2 {
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = a.x * b.y - b.x * a.y;
    a2 += c;
    cx += (a.x + b.x) * c;
    cy += (a.y + b.y) * c;
  }
  if (Math.abs(a2) < EPS) {
    // Degenerate: average of points.
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/**
 * Split a convex polygon (with a parallel array of attached points, e.g. source coords)
 * by the line a→b. Returns the parts left (>0) and right (<0) of the line.
 * Attached points are interpolated with the same parameter, so UVs stay consistent.
 */
export function splitConvex(
  poly: P2[],
  attached: P2[],
  a: P2,
  b: P2,
): { left: { pts: P2[]; att: P2[] } | null; right: { pts: P2[]; att: P2[] } | null } {
  const n = poly.length;
  const s = poly.map((p) => sideValue(p, a, b));
  const L: P2[] = [];
  const La: P2[] = [];
  const R: P2[] = [];
  const Ra: P2[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const pi = poly[i];
    const si = s[i];
    const sj = s[j];
    if (si >= -TOL) {
      L.push(pi);
      La.push(attached[i]);
    }
    if (si <= TOL) {
      R.push(pi);
      Ra.push(attached[i]);
    }
    if ((si > TOL && sj < -TOL) || (si < -TOL && sj > TOL)) {
      const t = si / (si - sj);
      const q = lerp2(pi, poly[j], t);
      const qa = lerp2(attached[i], attached[j], t);
      L.push(q);
      La.push(qa);
      R.push(q);
      Ra.push(qa);
    }
  }
  const okL = L.length >= 3 && Math.abs(signedArea(L)) > 1e-3;
  const okR = R.length >= 3 && Math.abs(signedArea(R)) > 1e-3;
  return {
    left: okL ? dedupe(L, La) : null,
    right: okR ? dedupe(R, Ra) : null,
  };
}

/** Remove consecutive duplicate points produced by points lying on the cut line. */
function dedupe(pts: P2[], att: P2[]): { pts: P2[]; att: P2[] } {
  const op: P2[] = [];
  const oa: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const prev = op[op.length - 1];
    if (prev && Math.abs(prev.x - p.x) < TOL && Math.abs(prev.y - p.y) < TOL) continue;
    op.push(p);
    oa.push(att[i]);
  }
  if (op.length > 1) {
    const f = op[0];
    const l = op[op.length - 1];
    if (Math.abs(f.x - l.x) < TOL && Math.abs(f.y - l.y) < TOL) {
      op.pop();
      oa.pop();
    }
  }
  return { pts: op, att: oa };
}

/** Intersection of infinite lines p1→p2 and p3→p4, or null if parallel. */
export function lineIntersect(p1: P2, p2_: P2, p3: P2, p4: P2): P2 | null {
  const d1 = sub(p2_, p1);
  const d2 = sub(p4, p3);
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(p3, p1), d2) / den;
  return add(p1, mul(d1, t));
}

/** Clip an infinite line to an axis-aligned box; returns the segment inside or null. */
export function clipLineToBox(a: P2, b: P2, minX: number, minY: number, maxX: number, maxY: number): [P2, P2] | null {
  const d = sub(b, a);
  let t0 = -Infinity;
  let t1 = Infinity;
  const check = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPS) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (
    check(-d.x, a.x - minX) &&
    check(d.x, maxX - a.x) &&
    check(-d.y, a.y - minY) &&
    check(d.y, maxY - a.y) &&
    t0 <= t1 &&
    Number.isFinite(t0) &&
    Number.isFinite(t1)
  ) {
    return [add(a, mul(d, t0)), add(a, mul(d, t1))];
  }
  return null;
}

/** Fan-triangulate a convex polygon into index triples. */
export function fan(n: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) out.push(0, i, i + 1);
  return out;
}

export function polyBounds(polys: P2[][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys)
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return { minX, minY, maxX, maxY };
}

/** Even-odd point in convex polygon test (positive winding). */
export function pointInConvex(p: P2, poly: P2[]): boolean {
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (cross(sub(b, a), sub(p, a)) < -TOL) return false;
  }
  return true;
}
