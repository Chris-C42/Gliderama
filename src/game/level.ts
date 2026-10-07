import { roomColliders } from '../world/colliders';
import type { Rect, RoomDef } from '../world/types';

export interface LevelDef {
  id: string;
  name: string;
  /** Place (campaign chapter) this level belongs to. */
  place: string;
  /** Rooms keyed by grid position "gx,gy" (gy grows downward). */
  rooms: Record<string, RoomDef>;
  start: { room: string; x: number; y: number; facing: 1 | -1 };
  /** Spare sheets at the start. */
  sheets: number;
  /** Par time (s) for the Swift medal. */
  par: number;
  /** Intro text shown before the first throw. */
  intro?: string;
  /** Text shown on the end card when the level is finished. */
  outro?: string;
  /** Daily / roguelike twist id. */
  twist?: string;
  /**
   * How the level is finished, besides an exit: 'stars' = collecting every goal star (`star` items with
   * `goal: true`) finishes it, as in Glider PRO; 'none' = it has no finish (free flight).
   */
  goal?: 'stars' | 'none';
}

export function roomKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function parseKey(key: string): [number, number] {
  const [a, b] = key.split(',').map(Number);
  return [a, b];
}

export function neighbour(level: LevelDef, key: string, side: 'left' | 'right' | 'up' | 'down'): string | null {
  const [gx, gy] = parseKey(key);
  const k =
    side === 'left' ? roomKey(gx - 1, gy) : side === 'right' ? roomKey(gx + 1, gy) : side === 'up' ? roomKey(gx, gy - 1) : roomKey(gx, gy + 1);
  return level.rooms[k] ? k : null;
}

/** Total collectible stars in a level (for medals). */
export function countStars(level: LevelDef): number {
  let n = 0;
  for (const r of Object.values(level.rooms)) for (const it of r.items) if (it.t === 'star') n++;
  return n;
}

/** The ids of the stars that finish a `goal: 'stars'` level (they carry explicit ids). */
export function goalStarIds(level: LevelDef): string[] {
  const out: string[] = [];
  for (const r of Object.values(level.rooms)) for (const it of r.items) if (it.t === 'star' && it.goal && typeof it.id === 'string') out.push(it.id);
  return out;
}

/**
 * Where a plane that has just flown into room `next` through its `entry` side gets thrown from next time (after a
 * crash): just inside the entry edge (where a plane fits, through a floor or a ceiling: clear of the walls of a
 * shaft), up at the height the level starts at (near the ceiling) rather than wherever it happened to come in. It
 * goes up from where it came in only as far as the room is clear straight above that point, so it never ends up over
 * a ledge, or in a part of the room it could not have flown to. `avoid`: what else it is kept out of (a flame or a
 * cobweb by the entry: see stillHazards in game/objects). Shared by the session and the level checks.
 */
export function entryCheckpoint(
  level: LevelDef,
  next: string,
  entry: 'left' | 'right' | 'up' | 'down',
  x: number,
  y: number,
  facing: 1 | -1,
  avoid: readonly Rect[] = [],
) {
  const room = level.rooms[next];
  const ex = room.exits[entry];
  let cx = Math.max(40, Math.min(640 - 40, x));
  let cy = Math.max(40, Math.min(300, y));
  if (entry === 'left') cx = 44;
  if (entry === 'right') cx = 640 - 44;
  if (ex && (entry === 'left' || entry === 'right')) cy = Math.max(ex.from + 16, Math.min(ex.to - 30, y));
  if (entry === 'down') cy = 280;
  if (entry === 'up') cy = 60;
  const cols: Rect[] = [...roomColliders(room), ...avoid];
  // somewhere it fits (up or down a shaft, a plane flies through where one thrown level would not: it is longer
  // than it is tall)
  ({ x: cx, y: cy } = fit(cols, cx, cy, entry));
  const high = Math.max(RELAUNCH_TOP, Math.min(RELAUNCH_LOW, level.start.y));
  if (entry !== 'up' && cy > high) cy = climb(cols, cx, cy, high);
  return { room: next, x: cx, y: cy, facing };
}

/** A relaunch goes no higher than this (room px): room to throw upwards under the ceiling. */
const RELAUNCH_TOP = 60;
/** ...and is lifted at least this high, whatever height the level itself starts at. */
const RELAUNCH_LOW = 180;
/** The room a plane at a launch point takes up (px either side of it). */
const PLANE_HALF = { w: 22, h: 9 };

/** How far from where it came in a relaunch may be moved to find room for the plane (px). */
const FIT_REACH = 100;

/** Whether a plane at (x, y) would touch any of `cols`. */
const blockedAt = (cols: Rect[], x: number, y: number) =>
  cols.some((c) => x + PLANE_HALF.w > c.x && x - PLANE_HALF.w < c.x + c.w && y + PLANE_HALF.h > c.y && y - PLANE_HALF.h < c.y + c.h);

/** Moves to try a relaunch with, nearest first (per entry side; worked out once). */
const fitOrders = new Map<string, [number, number][]>();

/** Moves (dx, dy) within FIT_REACH, nearest first: along the edge the plane came in by before further in from it. */
function fitOrder(entry: 'left' | 'right' | 'up' | 'down'): [number, number][] {
  const known = fitOrders.get(entry);
  if (known) return known;
  const [ux, uy] = entry === 'up' || entry === 'down' ? [1, 0] : [0, 1];
  const [ix, iy] = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }[entry];
  const moves: { d: [number, number]; cost: number }[] = [];
  for (let a = -FIT_REACH; a <= FIT_REACH; a += 2)
    for (let c = -FIT_REACH; c <= FIT_REACH; c += 2) {
      // (a: along the edge, c: in from it; back out towards the edge is the last way to go)
      const cost = Math.abs(a) + 1.25 * Math.max(0, c) + 2 * Math.max(0, -c) + (a > 0 ? 0.01 : 0);
      moves.push({ d: [a * ux + c * ix, a * uy + c * iy], cost });
    }
  const order = moves.sort((p, q) => p.cost - q.cost).map((m) => m.d);
  fitOrders.set(entry, order);
  return order;
}

/** The nearest spot to (x, y) where the plane fits (see fitOrder); (x, y) if nothing near does. */
function fit(cols: Rect[], x: number, y: number, entry: 'left' | 'right' | 'up' | 'down'): { x: number; y: number } {
  if (!blockedAt(cols, x, y)) return { x, y };
  for (const [dx, dy] of fitOrder(entry)) {
    const xx = x + dx;
    const yy = y + dy;
    if (xx >= 40 && xx <= 640 - 40 && yy >= 40 && yy <= 300 && !blockedAt(cols, xx, yy)) return { x: xx, y: yy };
  }
  return { x, y };
}

/** As far up from (x, y) towards `top` as the plane fits without touching anything (y stays put if it doesn't fit there). */
function climb(cols: Rect[], x: number, y: number, top: number): number {
  const blocked = (yy: number) => blockedAt(cols, x, yy);
  if (blocked(y)) return y;
  let best = y;
  for (let yy = y - 4; yy >= top; yy -= 4) {
    if (blocked(yy)) break;
    best = yy;
  }
  if (best - top < 4 && !blocked(top)) best = top;
  return best;
}
