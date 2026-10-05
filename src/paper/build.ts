/**
 * From a Design to a 3D paper plane.
 *
 * Pipeline:
 *   1. Flat folds on the right half-sheet (fold.ts).
 *   2. "Fold in half": implicit — the centre line becomes the bottom of the keel. Flaps outside =
 *      flip the flat state over first.
 *   3. Wing fold along the root line (keel depth d0 at the nose edge → d1 at the tail edge):
 *      everything inside the line hangs down as the keel, everything outside becomes the wing.
 *   4. Shaping: dihedral, winglets (hinge parallel to the centre line), elevator flaps (hinge
 *      parallel to the trailing edge, with chordwise cuts at their ends).
 *
 * Plane-local 3D frame (millimetres): +X forward (nose), +Y up, +Z towards the right wingtip.
 * Only the right half is built here; the mesh builder mirrors it.
 */

import type { Design } from './design';
import { sheetDims } from './design';
import { FlatState, flipOver, foldSequence } from './fold';
import { P2, centroid, dot, norm, splitConvex, sub } from './geom';

export type Region = 'keel' | 'wing' | 'winglet' | 'flap';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Piece {
  pts: P2[];
  src: P2[];
  layer: number;
  up: boolean;
  region: Region;
  /** Per-vertex (u, v): u along the root line from the nose, v outward from the root line. */
  uv: P2[];
  /** Per-vertex 3D position of the right-half piece (mm). */
  p3: V3[];
}

export interface PlaneBuild {
  errors: string[];
  width: number;
  length: number;
  flat: FlatState;
  pieces: Piece[];
  root: { r0: P2; r1: P2; dir: P2; out: P2 };
  dihedral: number;
  maxLayer: number;
  minLayer: number;
  /** Half-span of the flat wing (max v), mm. */
  vMax: number;
  /** Trailing-edge position of the wing in table y, mm. */
  yTE: number;
  winglet: { x: number; angle: number } | null;
  elevator: { yh: number; v0: number; v1: number; angle: number } | null;
}

/** Visual gap between the two keel plies, and per-layer offset (mm). */
export const KEEL_Z = 0.35;
export const LAYER_T = 0.22;

const deg = Math.PI / 180;

function rotateAbout(p: V3, a: V3, b: V3, angle: number): V3 {
  let kx = b.x - a.x;
  let ky = b.y - a.y;
  let kz = b.z - a.z;
  const kl = Math.hypot(kx, ky, kz) || 1;
  kx /= kl;
  ky /= kl;
  kz /= kl;
  const vx = p.x - a.x;
  const vy = p.y - a.y;
  const vz = p.z - a.z;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kdv = kx * vx + ky * vy + kz * vz;
  // Rodrigues: v' = v c + (k × v) s + k (k·v)(1 − c)
  const cx = ky * vz - kz * vy;
  const cy = kz * vx - kx * vz;
  const cz = kx * vy - ky * vx;
  return {
    x: a.x + vx * c + cx * s + kx * kdv * (1 - c),
    y: a.y + vy * c + cy * s + ky * kdv * (1 - c),
    z: a.z + vz * c + cz * s + kz * kdv * (1 - c),
  };
}

interface Raw {
  pts: P2[];
  src: P2[];
  layer: number;
  up: boolean;
}

function splitAll(list: Raw[], a: P2, b: P2): { left: Raw[]; right: Raw[] } {
  const left: Raw[] = [];
  const right: Raw[] = [];
  for (const f of list) {
    const s = splitConvex(f.pts, f.src, a, b);
    if (s.left) left.push({ pts: s.left.pts, src: s.left.att, layer: f.layer, up: f.up });
    if (s.right) right.push({ pts: s.right.pts, src: s.right.att, layer: f.layer, up: f.up });
  }
  return { left, right };
}

export function buildPlane(design: Design): PlaneBuild {
  const errors: string[] = [];
  const { width, length } = sheetDims(design);
  const seq = foldSequence(width, length, design.folds);
  if (seq.failedAt >= 0) errors.push(`Fold ${seq.failedAt + 1}: ${seq.reason}`);
  let flat = seq.state;
  if (design.flapsOutside) flat = flipOver(flat);

  let maxLayer = 0;
  let minLayer = 0;
  for (const f of flat.facets) {
    maxLayer = Math.max(maxLayer, f.layer);
    minLayer = Math.min(minLayer, f.layer);
  }

  // Root (wing fold) line.
  const hw = width / 2;
  const d0 = Math.max(0, Math.min(design.wing.d0, hw - 5));
  const d1 = Math.max(0, Math.min(design.wing.d1, hw - 5));
  const r0: P2 = { x: d0, y: 0 };
  const r1: P2 = { x: d1, y: length };
  const dir = norm(sub(r1, r0));
  const out: P2 = { x: dir.y, y: -dir.x }; // perpendicular pointing towards +x (outboard)
  const uOf = (p: P2) => dot(sub(p, r0), dir);
  const vOf = (p: P2) => dot(sub(p, r0), out);

  // 1) Split by the root line into keel / wing.
  const split = splitAll(flat.facets, r0, r1);
  // Decide which side is the wing by testing a point far outboard.
  const probe: P2 = { x: hw * 4, y: length / 2 };
  const wingIsLeft = (r1.x - r0.x) * (probe.y - r0.y) - (r1.y - r0.y) * (probe.x - r0.x) > 0;
  let wingRaw = wingIsLeft ? split.left : split.right;
  const keelRaw = wingIsLeft ? split.right : split.left;
  if (wingRaw.length === 0) errors.push('No wing area: the wing fold line is outside the paper.');
  if (keelRaw.length === 0) errors.push('No keel: move the wing fold line outward.');

  let vMax = 0;
  let yTE = 0;
  for (const f of wingRaw)
    for (const p of f.pts) {
      vMax = Math.max(vMax, vOf(p));
      yTE = Math.max(yTE, p.y);
    }
  let xMaxWing = 0;
  for (const f of wingRaw) for (const p of f.pts) xMaxWing = Math.max(xMaxWing, p.x);

  // 2) Winglets.
  let wingletRaw: Raw[] = [];
  let winglet: PlaneBuild['winglet'] = null;
  const wl = design.shape.winglet;
  if (wl && Math.abs(wl.angle) > 0.5) {
    const minX = Math.max(d0, d1) + 8;
    const maxX = xMaxWing - 6;
    if (wl.x < minX || wl.x > maxX) {
      errors.push('Winglet fold is too close to the wing root or the tip.');
    } else {
      const a: P2 = { x: wl.x, y: 0 };
      const b: P2 = { x: wl.x, y: length };
      const s = splitAll(wingRaw, a, b);
      // left of upward line x=const: points with smaller x? Determine by probe.
      const probeOut: P2 = { x: wl.x + 10, y: length / 2 };
      const outIsLeft = (b.x - a.x) * (probeOut.y - a.y) - (b.y - a.y) * (probeOut.x - a.x) > 0;
      wingletRaw = outIsLeft ? s.left : s.right;
      wingRaw = outIsLeft ? s.right : s.left;
      winglet = { x: wl.x, angle: wl.angle };
    }
  }

  // 3) Elevator flaps (on the main wing only).
  let flapRaw: Raw[] = [];
  let elevator: PlaneBuild['elevator'] = null;
  const el = design.shape.elevator;
  if (el && Math.abs(el.angle) > 0.05 && el.depth > 1) {
    const depth = Math.min(Math.max(el.depth, 3), 80);
    const yh = yTE - depth;
    let vLimit = vMax;
    if (winglet) {
      // flap cannot extend into the winglet: limit to the winglet line's v at the trailing edge
      vLimit = Math.min(vMax, vOf({ x: winglet.x, y: yTE }) - 1);
    }
    const v0 = Math.max(0.5, Math.min(el.from, el.to) * vMax);
    const v1 = Math.min(vLimit, Math.max(el.from, el.to) * vMax);
    if (v1 - v0 < 4) {
      errors.push('Elevator flaps are too narrow.');
    } else {
      const hingeA: P2 = { x: 0, y: yh };
      const hingeB: P2 = { x: 10, y: yh };
      const sh = splitAll(wingRaw, hingeA, hingeB);
      const aftProbe: P2 = { x: 5, y: yh + 5 };
      const aftIsLeft = (hingeB.x - hingeA.x) * (aftProbe.y - hingeA.y) - (hingeB.y - hingeA.y) * (aftProbe.x - hingeA.x) > 0;
      const aft = aftIsLeft ? sh.left : sh.right;
      const fwd = aftIsLeft ? sh.right : sh.left;
      // Chordwise cuts at v0 and v1 (lines parallel to the root line).
      const c0a: P2 = { x: r0.x + out.x * v0, y: r0.y + out.y * v0 };
      const c0b: P2 = { x: c0a.x + dir.x, y: c0a.y + dir.y };
      const c1a: P2 = { x: r0.x + out.x * v1, y: r0.y + out.y * v1 };
      const c1b: P2 = { x: c1a.x + dir.x, y: c1a.y + dir.y };
      const s0 = splitAll(aft, c0a, c0b);
      const all0 = [...s0.left, ...s0.right];
      const s1 = splitAll(all0, c1a, c1b);
      const aftPieces = [...s1.left, ...s1.right];
      const keepWing: Raw[] = [...fwd];
      for (const f of aftPieces) {
        const v = vOf(centroid(f.pts));
        if (v > v0 && v < v1) flapRaw.push(f);
        else keepWing.push(f);
      }
      wingRaw = keepWing;
      elevator = { yh, v0, v1, angle: el.angle };
      if (flapRaw.length === 0) elevator = null;
    }
  }

  const G = design.shape.dihedral * deg;
  const sinG = Math.sin(G);
  const cosG = Math.cos(G);
  const upN: V3 = { x: 0, y: cosG, z: -sinG };
  const keelZ = (l: number) => KEEL_Z + (maxLayer - l) * LAYER_T;

  const wingPoint = (p: P2, layer: number): V3 => {
    const u = uOf(p);
    const v = vOf(p);
    const off = (layer - minLayer) * LAYER_T;
    return {
      x: -u,
      y: v * sinG + upN.y * off,
      z: KEEL_Z + v * cosG + upN.z * off,
    };
  };
  const keelPoint = (p: P2, layer: number): V3 => ({ x: -uOf(p), y: Math.min(0, vOf(p)), z: keelZ(layer) });

  // Hinges in 3D (no layer offsets).
  let wingletHinge: [V3, V3] | null = null;
  if (winglet) {
    const a = wingPoint({ x: winglet.x, y: 0 }, minLayer);
    const b = wingPoint({ x: winglet.x, y: length }, minLayer);
    wingletHinge = [a, b];
  }
  let flapHinge: [V3, V3] | null = null;
  if (elevator) {
    flapHinge = [wingPoint({ x: 0, y: elevator.yh }, minLayer), wingPoint({ x: hw, y: elevator.yh }, minLayer)];
  }

  const pieces: Piece[] = [];
  const pushPieces = (list: Raw[], region: Region) => {
    for (const f of list) {
      const uv = f.pts.map((p) => ({ x: uOf(p), y: vOf(p) }));
      let p3: V3[];
      if (region === 'keel') {
        p3 = f.pts.map((p) => keelPoint(p, f.layer));
      } else {
        p3 = f.pts.map((p) => wingPoint(p, f.layer));
        if (region === 'winglet' && wingletHinge && winglet) {
          const [a, b] = wingletHinge;
          // choose sign so a point further outboard moves "up" (along upN)
          const test = wingPoint({ x: winglet.x + 20, y: length / 2 }, minLayer);
          const ang = winglet.angle * deg;
          const t1 = rotateAbout(test, a, b, ang);
          const rise = (t1.x - test.x) * upN.x + (t1.y - test.y) * upN.y + (t1.z - test.z) * upN.z;
          const sgn = rise >= 0 === ang >= 0 ? 1 : -1;
          p3 = p3.map((q) => rotateAbout(q, a, b, ang * sgn));
        }
        if (region === 'flap' && flapHinge && elevator) {
          const [a, b] = flapHinge;
          const test = wingPoint({ x: hw * 0.5, y: elevator.yh + 15 }, minLayer);
          const ang = elevator.angle * deg;
          const t1 = rotateAbout(test, a, b, ang);
          const rise = t1.y - test.y;
          const sgn = rise >= 0 === ang >= 0 ? 1 : -1;
          p3 = p3.map((q) => rotateAbout(q, a, b, ang * sgn));
        }
      }
      pieces.push({ pts: f.pts, src: f.src, layer: f.layer, up: f.up, region, uv, p3 });
    }
  };
  pushPieces(keelRaw, 'keel');
  pushPieces(wingRaw, 'wing');
  pushPieces(wingletRaw, 'winglet');
  pushPieces(flapRaw, 'flap');

  return {
    errors,
    width,
    length,
    flat,
    pieces,
    root: { r0, r1, dir, out },
    dihedral: G,
    maxLayer,
    minLayer,
    vMax,
    yTE,
    winglet,
    elevator,
  };
}

// ---------------------------------------------------------------------------------------------
// Mesh

export const PART_NOSE = 0;
export const PART_WING_L = 1;
export const PART_WING_R = 2;
export const PART_TAIL = 3;
export const PART_BODY = 4;

export interface PlaneMesh {
  /** xyz per vertex, metres, centred so the CG is at the origin. */
  positions: Float32Array;
  /** Full-sheet paper coordinates (0..1) per vertex, for printed patterns. */
  uvs: Float32Array;
  /** Part id per vertex (for damage effects). */
  parts: Float32Array;
  /** Layer index normalised 0..1 per vertex (for subtle shading). */
  layers: Float32Array;
  indices: Uint32Array;
  /** Bounding box in metres (after centring). */
  min: V3;
  max: V3;
  /** Plane length (nose to tail) in metres. */
  length: number;
}

/**
 * Build a renderable mesh of both halves. Triangle winding is chosen so that the geometric
 * front face is the paper's FRONT side (shader picks front/back colours with gl_FrontFacing).
 * `cg` is the centre of gravity in plane-local millimetres (from the aero analysis); the mesh
 * is translated so the CG is at the origin.
 */
export function buildMesh(build: PlaneBuild, cg: V3 = { x: 0, y: 0, z: 0 }): PlaneMesh {
  const pos: number[] = [];
  const uvs: number[] = [];
  const parts: number[] = [];
  const layers: number[] = [];
  const idx: number[] = [];
  const W = build.width;
  const L = build.length;
  const hw = W / 2;
  const lspan = Math.max(1, build.maxLayer - build.minLayer);
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const p of build.pieces)
    for (const q of p.uv) {
      uMin = Math.min(uMin, q.x);
      uMax = Math.max(uMax, q.x);
    }
  const noseLimit = uMin + (uMax - uMin) * 0.22;

  for (const piece of build.pieces) {
    const c = centroid(piece.uv);
    let partR: number;
    let partL: number;
    if (piece.region === 'flap') partR = partL = PART_TAIL;
    else if (c.x < noseLimit) partR = partL = PART_NOSE;
    else if (piece.region === 'keel') partR = partL = PART_BODY;
    else {
      partR = PART_WING_R;
      partL = PART_WING_L;
    }
    const n = piece.p3.length;
    for (const mirror of [false, true]) {
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const p = piece.p3[i];
        pos.push((p.x - cg.x) / 1000, (p.y - cg.y) / 1000, ((mirror ? -p.z : p.z) - cg.z) / 1000);
        const s = piece.src[i];
        uvs.push(mirror ? (hw - s.x) / W : (hw + s.x) / W, 1 - s.y / L);
        parts.push(mirror ? partL : partR);
        layers.push((piece.layer - build.minLayer) / lspan);
      }
      // Positive table orientation → geometric front = table-DOWN side (see docs in fold.ts).
      // Paper front faces table-up iff piece.up, so reverse when up. Mirroring reverses again.
      const reverse = piece.up !== mirror;
      for (let i = 1; i < n - 1; i++) {
        if (reverse) idx.push(base, base + i + 1, base + i);
        else idx.push(base, base + i, base + i + 1);
      }
    }
  }
  const positions = new Float32Array(pos);
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i]);
    min.y = Math.min(min.y, positions[i + 1]);
    min.z = Math.min(min.z, positions[i + 2]);
    max.x = Math.max(max.x, positions[i]);
    max.y = Math.max(max.y, positions[i + 1]);
    max.z = Math.max(max.z, positions[i + 2]);
  }
  return {
    positions,
    uvs: new Float32Array(uvs),
    parts: new Float32Array(parts),
    layers: new Float32Array(layers),
    indices: new Uint32Array(idx),
    min,
    max,
    length: (max.x - min.x),
  };
}
