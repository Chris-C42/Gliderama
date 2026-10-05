/**
 * Test Room model for the hangar builder.
 *
 * Pure data + pure functions, renderer-agnostic and free of the game's pixel frame: everything is
 * in hangar metres, x right, y UP, floor at y = 0. Every piece is an axis-aligned box whose
 * (x, y) is its BOTTOM-LEFT corner; what the box means depends on the kind:
 *
 *   wall         solid box.
 *   floorVent    grille box; an updraft column rises from its top face for `reach` metres.
 *   ceilingVent  grille box; a downdraft falls from its bottom face for `reach` metres.
 *   fan          solid housing box; blows along `dir` from the middle of the box for `reach` metres.
 *   candle       candle stick box (not solid); the flame sits on top of it. Thermal plume + fire hazard.
 *   target       landing zone (not solid): scores when the plane comes to rest inside it.
 *   hoop         a ring facing the flight direction, seen edge-on: a vertical gate of height `h` at
 *                x + w/2. Scores when the plane passes through it.
 *
 * Wind profiles replicate src/game/objects/air.ts and things.ts (which work in pixels, y down)
 * converted to metres at 128 px/m, with `power` the peak speed in m/s like the game's `power`.
 * Piece edit helpers are immutable (they return new rooms) so they drop straight into signals.
 */

export type PieceKind = 'wall' | 'floorVent' | 'ceilingVent' | 'fan' | 'candle' | 'target' | 'hoop';

export const PIECE_KINDS: readonly PieceKind[] = ['wall', 'floorVent', 'ceilingVent', 'fan', 'candle', 'target', 'hoop'];

export interface Piece {
  id: string;
  kind: PieceKind;
  /** Bottom-left corner, metres. */
  x: number;
  y: number;
  /** Box size, metres. */
  w: number;
  h: number;
  /** Peak air speed (m/s) for vents, fans and candles; 0 for pieces that move no air. */
  power: number;
  /** Fan blowing direction. */
  dir: 1 | -1;
  /** How far the air reaches from the piece (metres): vent column height, fan throw, candle plume. */
  reach: number;
}

export interface PieceSpec {
  label: string;
  /** Default box size (m). */
  w: number;
  h: number;
  /** Default peak air speed (m/s) and reach (m). */
  power: number;
  reach: number;
  /** Plane bounces off it. */
  solid: boolean;
  /** Which of power / reach / dir are meaningful (what a property editor should offer). */
  has: { power: boolean; reach: boolean; dir: boolean };
  /** Slider ranges for the editable parameters. */
  powerRange: readonly [number, number];
  reachRange: readonly [number, number];
}

export const PIECE_SPECS: Record<PieceKind, PieceSpec> = {
  wall: { label: 'Wall', w: 0.2, h: 1.2, power: 0, reach: 0, solid: true, has: { power: false, reach: false, dir: false }, powerRange: [0, 0], reachRange: [0, 0] },
  floorVent: { label: 'Floor vent', w: 0.375, h: 0.04, power: 3.2, reach: 2.5, solid: false, has: { power: true, reach: true, dir: false }, powerRange: [0.5, 6], reachRange: [0.5, 8] },
  ceilingVent: { label: 'Ceiling vent', w: 0.375, h: 0.04, power: 2.2, reach: 2.5, solid: false, has: { power: true, reach: true, dir: false }, powerRange: [0.5, 6], reachRange: [0.5, 8] },
  fan: { label: 'Fan', w: 0.21875, h: 0.21875, power: 3.2, reach: 2.1875, solid: true, has: { power: true, reach: true, dir: true }, powerRange: [0.5, 8], reachRange: [0.5, 6] },
  candle: { label: 'Candle', w: 0.04, h: 0.2, power: 1, reach: 1.09375, solid: false, has: { power: true, reach: true, dir: false }, powerRange: [0.3, 3], reachRange: [0.3, 3] },
  target: { label: 'Landing target', w: 0.6, h: 0.1, power: 0, reach: 0, solid: false, has: { power: false, reach: false, dir: false }, powerRange: [0, 0], reachRange: [0, 0] },
  hoop: { label: 'Hoop', w: 0.04, h: 0.5, power: 0, reach: 0, solid: false, has: { power: false, reach: false, dir: false }, powerRange: [0, 0], reachRange: [0, 0] },
};

export interface TestRoom {
  v: 1;
  name: string;
  /** Uniform ambient air movement, m/s (x right, y up). */
  wind: { x: number; y: number };
  /** Launcher: where it stands (m) and its aim (rad, 0 = right, +up). */
  launch: { x: number; y: number; angle: number };
  pieces: Piece[];
}

export const MAX_PIECES = 100;
export const SCORE_TARGET = 100;
export const SCORE_HOOP = 50;

/** Half-width of the vertical band (m) around a target's box the resting plane still counts in. */
const TARGET_MARGIN = 0.04;
/** The plane is resting if it moves slower than this at the end of the path (m/s). */
const REST_SPEED = 0.6;

// ---------------------------------------------------------------------------------------------
// Building rooms
// ---------------------------------------------------------------------------------------------

export function emptyRoom(name = 'Test room'): TestRoom {
  return { v: 1, name, wind: { x: 0, y: 0 }, launch: { x: 0, y: 2, angle: 0 }, pieces: [] };
}

/** The next free piece id (`p1`, `p2`, ...). */
export function nextPieceId(room: TestRoom): string {
  const used = new Set(room.pieces.map((p) => p.id));
  let n = room.pieces.length + 1;
  while (used.has(`p${n}`)) n++;
  return `p${n}`;
}

/** A piece of `kind` with the kind's default size and air settings, bottom-left at (x, y). */
export function makePiece(kind: PieceKind, x: number, y: number, overrides: Partial<Omit<Piece, 'id' | 'kind'>> = {}, id = ''): Piece {
  const s = PIECE_SPECS[kind];
  return { id, kind, x, y, w: s.w, h: s.h, power: s.power, dir: 1, reach: s.reach, ...overrides };
}

export function addPiece(room: TestRoom, kind: PieceKind, x: number, y: number, overrides: Partial<Omit<Piece, 'id' | 'kind'>> = {}): TestRoom {
  if (room.pieces.length >= MAX_PIECES) return room;
  const piece = makePiece(kind, x, y, overrides, nextPieceId(room));
  return { ...room, pieces: [...room.pieces, piece] };
}

export function removePiece(room: TestRoom, id: string): TestRoom {
  return { ...room, pieces: room.pieces.filter((p) => p.id !== id) };
}

export function updatePiece(room: TestRoom, id: string, patch: Partial<Omit<Piece, 'id' | 'kind'>>): TestRoom {
  return { ...room, pieces: room.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

export function pieceById(room: TestRoom, id: string): Piece | undefined {
  return room.pieces.find((p) => p.id === id);
}

/** The topmost piece containing the point (metres), for picking in the builder. */
export function pieceAt(room: TestRoom, x: number, y: number, slack = 0): Piece | undefined {
  for (let i = room.pieces.length - 1; i >= 0; i--) {
    const p = room.pieces[i];
    if (x >= p.x - slack && x <= p.x + p.w + slack && y >= p.y - slack && y <= p.y + p.h + slack) return p;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

export interface BoxM {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Solid boxes the plane collides with (walls and fan housings), in metres. */
export function solidBoxes(room: TestRoom): BoxM[] {
  const out: BoxM[] = [];
  for (const p of room.pieces) if (PIECE_SPECS[p.kind].solid) out.push({ x: p.x, y: p.y, w: p.w, h: p.h });
  return out;
}

/** The flame of a candle (a fire hazard), in metres, matching the game's 6 × 12 px trigger. */
export function flameBox(p: Piece): BoxM {
  const cx = p.x + p.w / 2;
  const wick = p.y + p.h;
  return { x: cx - 0.0234375, y: wick + 0.0078125, w: 0.046875, h: 0.09375 };
}

/** Every candle flame in the room. */
export function flameBoxes(room: TestRoom): BoxM[] {
  const out: BoxM[] = [];
  for (const p of room.pieces) if (p.kind === 'candle') out.push(flameBox(p));
  return out;
}

/** The gate of a hoop: x of the ring plane and its vertical extent, metres. */
export function hoopGate(p: Piece): { x: number; y0: number; y1: number } {
  return { x: p.x + p.w / 2, y0: p.y, y1: p.y + p.h };
}

// ---------------------------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------------------------

export interface WindVec {
  x: number;
  y: number;
}

/** Smooth bump: 1 in the middle of [a, b], easing to 0 at the edges (the game's gentle entry). */
function bump(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0;
  const t = (x - a) / (b - a);
  return Math.sin(Math.PI * t) ** 1.5;
}

/** Adds one piece's air movement at (x, y) into `out`. */
export function pieceWindInto(p: Piece, x: number, y: number, out: WindVec): void {
  switch (p.kind) {
    case 'floorVent': {
      const above = y - (p.y + p.h);
      if (above > p.reach || above < -0.046875) return;
      const h = Math.max(0, above);
      const spread = 0.234375 + h * 0.24;
      const k = bump(x, p.x - spread, p.x + p.w + spread);
      if (k <= 0) return;
      const decay = Math.max(0.35, 1 - (0.45 * h) / Math.max(0.3125, p.reach));
      out.y += p.power * k * decay;
      return;
    }
    case 'ceilingVent': {
      const below = p.y - y;
      if (below < 0 || below > p.reach) return;
      const spread = 0.046875 + below * 0.12;
      const k = bump(x, p.x - spread, p.x + p.w + spread);
      if (k <= 0) return;
      const decay = Math.max(0.25, 1 - (0.6 * below) / Math.max(0.3125, p.reach));
      out.y -= p.power * k * decay;
      return;
    }
    case 'fan': {
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const dx = (x - cx) * p.dir;
      if (dx < 0 || dx > p.reach) return;
      const half = 0.109375 + dx * 0.32;
      const dy = Math.abs(y - cy);
      if (dy > half) return;
      const k = (1 - dx / p.reach) * (1 - (dy / half) ** 2);
      out.x += p.dir * p.power * k;
      return;
    }
    case 'candle': {
      const dy = y - (p.y + p.h);
      if (dy < 0 || dy > p.reach) return;
      const half = 0.0390625 + dy * 0.1;
      const dx = Math.abs(x - (p.x + p.w / 2));
      if (dx > half) return;
      out.y += p.power * (1 - dx / half) * (1 - dy / (p.reach * (8 / 7)));
      return;
    }
    default:
      return;
  }
}

/** Air velocity (m/s, x right, y up) at a hangar point: ambient wind plus every air mover. */
export function windAt(room: TestRoom, x: number, y: number): WindVec {
  const out: WindVec = { x: room.wind.x, y: room.wind.y };
  for (const p of room.pieces) pieceWindInto(p, x, y, out);
  return out;
}

/** A wind function for the flight model, with the air movers picked out once. */
export function windFn(room: TestRoom): (x: number, y: number) => WindVec {
  const movers = room.pieces.filter((p) => p.kind === 'floorVent' || p.kind === 'ceilingVent' || p.kind === 'fan' || p.kind === 'candle');
  const wx = room.wind.x;
  const wy = room.wind.y;
  return (x, y) => {
    const out: WindVec = { x: wx, y: wy };
    for (const p of movers) pieceWindInto(p, x, y, out);
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

/** What the evaluation helpers need of a flight path sample (the open sim's path points qualify). */
export interface PathLike {
  t: number;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

export interface TargetHit {
  id: string;
  /** Real seconds since launch when the flight ended there. */
  t: number;
  x: number;
  y: number;
}

export interface HoopPass {
  id: string;
  /** Real seconds since launch at the moment of passing. */
  t: number;
  /** Direction of travel through the ring: +1 left to right, -1 right to left. */
  dir: 1 | -1;
}

function endedAtRest(path: readonly PathLike[]): boolean {
  const last = path[path.length - 1];
  if (!last) return false;
  if (last.vx !== undefined && last.vy !== undefined) return Math.hypot(last.vx, last.vy) <= REST_SPEED;
  return true;
}

/**
 * Landing targets the plane came to rest in. The flight's last sample is its resting place and must lie
 * inside the target's box (with 4 cm of slack above and below: the plane's centre rides about that high
 * over a surface). Pass `rested: false` (e.g. the flight timed out in the air) to score nothing; by
 * default the end of the path counts as resting unless it still carries a velocity above 0.6 m/s.
 */
export function hitTargets(path: readonly PathLike[], room: TestRoom, opts: { rested?: boolean } = {}): TargetHit[] {
  const last = path[path.length - 1];
  if (!last) return [];
  if (!(opts.rested ?? endedAtRest(path))) return [];
  const out: TargetHit[] = [];
  for (const p of room.pieces) {
    if (p.kind !== 'target') continue;
    if (last.x >= p.x && last.x <= p.x + p.w && last.y >= p.y - TARGET_MARGIN && last.y <= p.y + p.h + TARGET_MARGIN) {
      out.push({ id: p.id, t: last.t, x: last.x, y: last.y });
    }
  }
  return out;
}

/** Hoops the plane's path went through (either direction), first passage of each. */
export function hoopsPassed(path: readonly PathLike[], room: TestRoom): HoopPass[] {
  const out: HoopPass[] = [];
  for (const p of room.pieces) {
    if (p.kind !== 'hoop') continue;
    const g = hoopGate(p);
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      if ((a.x - g.x) * (b.x - g.x) > 0) continue; // same side
      if (a.x === b.x) continue; // grazing along the gate: not a crossing
      const u = (g.x - a.x) / (b.x - a.x);
      const y = a.y + u * (b.y - a.y);
      if (y < g.y0 || y > g.y1) continue;
      out.push({ id: p.id, t: a.t + u * (b.t - a.t), dir: b.x > a.x ? 1 : -1 });
      break;
    }
  }
  return out;
}

export interface RoomScore {
  targets: { hit: number; total: number };
  hoops: { passed: number; total: number };
  score: number;
  /** Everything there was to score was scored. */
  complete: boolean;
}

/** Targets and hoops together: counts and a simple score. */
export function evaluateRoom(path: readonly PathLike[], room: TestRoom, opts: { rested?: boolean } = {}): RoomScore {
  const total = { targets: 0, hoops: 0 };
  for (const p of room.pieces) {
    if (p.kind === 'target') total.targets++;
    if (p.kind === 'hoop') total.hoops++;
  }
  const hit = hitTargets(path, room, opts).length;
  const passed = hoopsPassed(path, room).length;
  return {
    targets: { hit, total: total.targets },
    hoops: { passed, total: total.hoops },
    score: hit * SCORE_TARGET + passed * SCORE_HOOP,
    complete: hit === total.targets && passed === total.hoops && total.targets + total.hoops > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

const LIMIT = { pos: 1000, size: [0.01, 100] as const, power: [0, 20] as const, reach: [0, 60] as const, wind: 30 };

function num(v: unknown, d: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}

/** Rounds to 0.01 mm: plenty, and the game's own sizes (multiples of 1/128 m) survive exactly. */
function round5(v: number): number {
  return Math.round(v * 100000) / 100000;
}

/** The room as a compact JSON string (what gets saved). */
export function serializeRoom(room: TestRoom): string {
  return JSON.stringify({
    v: 1,
    name: room.name,
    wind: [round5(room.wind.x), round5(room.wind.y)],
    launch: [round5(room.launch.x), round5(room.launch.y), round5(room.launch.angle)],
    pieces: room.pieces.map((p) => {
      const o: Record<string, unknown> = { id: p.id, k: p.kind, x: round5(p.x), y: round5(p.y), w: round5(p.w), h: round5(p.h) };
      const s = PIECE_SPECS[p.kind];
      if (s.has.power) o.power = round5(p.power);
      if (s.has.reach) o.reach = round5(p.reach);
      if (s.has.dir) o.dir = p.dir;
      return o;
    }),
  });
}

/**
 * Reads a saved room. Never throws: returns null for anything that is not a room, and repairs what
 * it can (unknown pieces are dropped, numbers are clamped, duplicate ids renumbered).
 */
export function parseRoom(text: string): TestRoom | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !Array.isArray(r.pieces)) return null;
  const room = emptyRoom(typeof r.name === 'string' ? r.name.slice(0, 60) : 'Test room');
  if (Array.isArray(r.wind)) room.wind = { x: num(r.wind[0], 0, -LIMIT.wind, LIMIT.wind), y: num(r.wind[1], 0, -LIMIT.wind, LIMIT.wind) };
  if (Array.isArray(r.launch)) {
    room.launch = { x: num(r.launch[0], 0, -LIMIT.pos, LIMIT.pos), y: num(r.launch[1], 2, 0, LIMIT.pos), angle: num(r.launch[2], 0, -Math.PI, Math.PI) };
  }
  const used = new Set<string>();
  for (const item of r.pieces.slice(0, MAX_PIECES)) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const kind = PIECE_KINDS.find((k) => k === o.k);
    if (!kind) continue;
    const s = PIECE_SPECS[kind];
    let id = typeof o.id === 'string' && o.id.length > 0 && o.id.length <= 24 ? o.id : '';
    if (!id || used.has(id)) {
      let n = used.size + 1;
      while (used.has(`p${n}`)) n++;
      id = `p${n}`;
    }
    used.add(id);
    room.pieces.push({
      id,
      kind,
      x: num(o.x, 0, -LIMIT.pos, LIMIT.pos),
      y: num(o.y, 0, -LIMIT.pos, LIMIT.pos),
      w: num(o.w, s.w, LIMIT.size[0], LIMIT.size[1]),
      h: num(o.h, s.h, LIMIT.size[0], LIMIT.size[1]),
      power: s.has.power ? num(o.power, s.power, LIMIT.power[0], LIMIT.power[1]) : s.power,
      reach: s.has.reach ? num(o.reach, s.reach, LIMIT.reach[0], LIMIT.reach[1]) : s.reach,
      dir: o.dir === -1 ? -1 : 1,
    });
  }
  return room;
}
