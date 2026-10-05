/**
 * Flat-fold engine.
 *
 * We simulate the RIGHT HALF of the sheet lying on a table. The half-sheet frame:
 *   x = distance from the centre line (0 .. W/2), y = distance from the nose edge (0 .. L), millimetres.
 * The table frame never moves; folding reflects flaps across a fold line and stacks them on top
 * (valley) or underneath (mountain). Every facet remembers its source coordinates so printed
 * patterns follow the paper through any number of folds, and which side of the paper faces up.
 */

import type { FoldOp } from './design';
import { P2, centroid, polyBounds, reflect, sideValue, signedArea, splitConvex, TOL } from './geom';

export interface Facet {
  /** Current position on the table (convex, positive orientation). */
  pts: P2[];
  /** Matching source coordinates on the unfolded half-sheet. */
  src: P2[];
  /** Stacking order: larger is closer to the viewer. */
  layer: number;
  /** True if the paper's front side faces the viewer. */
  up: boolean;
}

export interface FlatState {
  /** Full sheet width and length (mm). The half-sheet spans x ∈ [0, width/2]. */
  width: number;
  length: number;
  facets: Facet[];
}

export type FoldResult =
  | { ok: true; state: FlatState; /** pieces that moved, in their pre-fold positions */ movedFrom: Facet[] }
  | { ok: false; reason: string };

/** How far past the centre line (mm) a flap may land before we call it invalid. */
const CENTRE_TOLERANCE = 1.0;

export function initialState(width: number, length: number): FlatState {
  const hw = width / 2;
  const pts: P2[] = [
    { x: 0, y: 0 },
    { x: 0, y: length },
    { x: hw, y: length },
    { x: hw, y: 0 },
  ];
  const oriented = signedArea(pts) > 0 ? pts : pts.slice().reverse();
  return {
    width,
    length,
    facets: [{ pts: oriented, src: oriented.map((p) => ({ ...p })), layer: 0, up: true }],
  };
}

function reversePoly(f: { pts: P2[]; src: P2[] }): { pts: P2[]; src: P2[] } {
  return { pts: f.pts.slice().reverse(), src: f.src.slice().reverse() };
}

export function applyFold(state: FlatState, op: FoldOp): FoldResult {
  const a = op.a;
  const b = op.b;
  if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-3) return { ok: false, reason: 'Fold line is too short.' };

  const stay: Facet[] = [];
  let move: Facet[] = [];
  for (const f of state.facets) {
    const parts = splitConvex(f.pts, f.src, a, b);
    const movingPart = op.side > 0 ? parts.left : parts.right;
    const stayingPart = op.side > 0 ? parts.right : parts.left;
    if (stayingPart) stay.push({ pts: stayingPart.pts, src: stayingPart.att, layer: f.layer, up: f.up });
    if (movingPart) move.push({ pts: movingPart.pts, src: movingPart.att, layer: f.layer, up: f.up });
  }

  // Flap folds lift only the flap under the grab point: the pieces physically joined to it on the
  // moving side (joined = sharing an edge in the unfolded sheet, other than along the fold line).
  let threshold = -Infinity;
  if (op.flap) {
    if (sideValue(op.flap, a, b) * op.side <= 0) return { ok: false, reason: 'Grab the flap on the side that folds.' };
    let seed = -1;
    for (let i = 0; i < move.length; i++) {
      if (pointIn(op.flap, move[i].pts) && (seed < 0 || move[i].layer > move[seed].layer)) seed = i;
    }
    if (seed < 0) return { ok: false, reason: 'There is no flap there to fold.' };
    const flapSet = connectedFlap(move, seed, a, b);
    const rest = move.filter((_, i) => !flapSet.has(i));
    move = move.filter((_, i) => flapSet.has(i));
    stay.push(...rest);
    threshold = Math.min(...move.map((f) => f.layer));
  }
  if (move.length === 0) return { ok: false, reason: 'That fold line misses the paper.' };
  if (stay.length === 0) return { ok: false, reason: 'That would just flip the whole sheet over.' };

  let maxL = -Infinity;
  let minL = Infinity;
  for (const f of state.facets) {
    maxL = Math.max(maxL, f.layer);
    minL = Math.min(minL, f.layer);
  }
  let maxM = -Infinity;
  let minM = Infinity;
  for (const f of move) {
    maxM = Math.max(maxM, f.layer);
    minM = Math.min(minM, f.layer);
  }

  const moved: Facet[] = move.map((f) => {
    const reflected = { pts: f.pts.map((p) => reflect(p, a, b)), src: f.src };
    const fixed = reversePoly(reflected); // reflection flips orientation
    // Folding a stack reverses its order. Valley: flap lands on top. Mountain: tucked underneath
    // (for flap folds: tucked just beneath the flap's own layer, above the rest of the paper).
    let layer: number;
    if (!op.mountain) layer = maxL + 1 + (maxM - f.layer);
    else if (op.flap) layer = threshold - 0.5 + (minM - f.layer) / (2 * (maxM - minM + 2));
    else layer = minL - 1 - (f.layer - minM);
    return { pts: fixed.pts, src: fixed.src, layer, up: !f.up };
  });

  for (const f of moved)
    for (const p of f.pts)
      if (p.x < -CENTRE_TOLERANCE) return { ok: false, reason: 'That flap would cross the centre line.' };

  const facets = normaliseLayers([...stay, ...moved]);
  return { ok: true, state: { width: state.width, length: state.length, facets }, movedFrom: move };
}

function pointIn(p: P2, poly: P2[]): boolean {
  for (let i = 0, n = poly.length; i < n; i++) {
    if (sideValue(p, poly[i], poly[(i + 1) % n]) < -TOL) return false;
  }
  return true;
}

/** Flood-fill the moving pieces joined to `seed` through edges that are not on the fold line. */
function connectedFlap(pieces: Facet[], seed: number, a: P2, b: P2): Set<number> {
  const onLine = (p: P2) => Math.abs(sideValue(p, a, b)) < 0.05;
  const joined = (i: number, j: number): boolean => {
    const m = pieces[i];
    const s = pieces[j];
    const n = m.src.length;
    const k = s.src.length;
    for (let e = 0; e < n; e++) {
      if (onLine(m.pts[e]) && onLine(m.pts[(e + 1) % n])) continue; // hinge edge
      for (let f = 0; f < k; f++) {
        if (sharesSegment(m.src[e], m.src[(e + 1) % n], s.src[f], s.src[(f + 1) % k])) return true;
      }
    }
    return false;
  };
  const set = new Set<number>([seed]);
  const queue = [seed];
  while (queue.length) {
    const i = queue.pop()!;
    for (let j = 0; j < pieces.length; j++) {
      if (set.has(j)) continue;
      if (joined(i, j)) {
        set.add(j);
        queue.push(j);
      }
    }
  }
  return set;
}

function sharesSegment(p: P2, q: P2, r: P2, s: P2): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return false;
  const ux = dx / L;
  const uy = dy / L;
  // r and s must lie on the line p→q
  const dr = Math.abs((r.x - p.x) * uy - (r.y - p.y) * ux);
  const ds = Math.abs((s.x - p.x) * uy - (s.y - p.y) * ux);
  if (dr > 0.02 || ds > 0.02) return false;
  const tr = (r.x - p.x) * ux + (r.y - p.y) * uy;
  const ts = (s.x - p.x) * ux + (s.y - p.y) * uy;
  const lo = Math.max(0, Math.min(tr, ts));
  const hi = Math.min(L, Math.max(tr, ts));
  return hi - lo > 0.05;
}

/** Re-number layers to 0..n-1 preserving order (stable). */
function normaliseLayers(facets: Facet[]): Facet[] {
  const distinct = Array.from(new Set(facets.map((f) => f.layer))).sort((x, y) => x - y);
  const map = new Map(distinct.map((l, i) => [l, i]));
  return facets.map((f) => ({ ...f, layer: map.get(f.layer)! }));
}

export interface FoldSequenceResult {
  state: FlatState;
  /** Index of the first fold that failed, or -1 if all applied. */
  failedAt: number;
  reason: string | null;
}

export function foldSequence(width: number, length: number, folds: FoldOp[]): FoldSequenceResult {
  let state = initialState(width, length);
  for (let i = 0; i < folds.length; i++) {
    const r = applyFold(state, folds[i]);
    if (!r.ok) return { state, failedAt: i, reason: r.reason };
    state = r.state;
  }
  return { state, failedAt: -1, reason: null };
}

/** Flip the whole flat state over (used for "flaps outside" centre folds). Geometry is unchanged. */
export function flipOver(state: FlatState): FlatState {
  const maxL = Math.max(...state.facets.map((f) => f.layer));
  return {
    ...state,
    facets: state.facets.map((f) => ({ ...f, layer: maxL - f.layer, up: !f.up })),
  };
}

/** Outline bounds of the folded half-sheet. */
export function stateBounds(state: FlatState) {
  return polyBounds(state.facets.map((f) => f.pts));
}

/** All distinct vertices on the current outline/creases — snapping targets for the workshop. */
export function stateVertices(state: FlatState): P2[] {
  const out: P2[] = [];
  for (const f of state.facets)
    for (const p of f.pts) {
      if (!out.some((q) => Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5)) out.push({ x: p.x, y: p.y });
    }
  return out;
}

/** Number of paper layers covering a table point. */
export function layersAt(state: FlatState, p: P2): number {
  let n = 0;
  for (const f of state.facets) {
    let inside = true;
    for (let i = 0, m = f.pts.length; i < m; i++) {
      const a = f.pts[i];
      const b = f.pts[(i + 1) % m];
      if (sideValue(p, a, b) < -TOL) {
        inside = false;
        break;
      }
    }
    if (inside) n++;
  }
  return n;
}

/** The facet that is visible from above at a point (highest layer), if any. */
export function topFacetAt(state: FlatState, p: P2): Facet | null {
  let best: Facet | null = null;
  for (const f of state.facets) {
    let inside = true;
    for (let i = 0, m = f.pts.length; i < m; i++) {
      if (sideValue(p, f.pts[i], f.pts[(i + 1) % m]) < -TOL) {
        inside = false;
        break;
      }
    }
    if (inside && (!best || f.layer > best.layer)) best = f;
  }
  return best;
}

export function facetCentroid(f: Facet): P2 {
  return centroid(f.pts);
}
