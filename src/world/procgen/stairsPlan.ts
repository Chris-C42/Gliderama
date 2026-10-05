/**
 * The stairs of a stairs link: where the flight (or the stairwell) goes in a room, what has to stay clear of it and where
 * the plane comes out. Decided before the air is planned (the lift has to lead to the doorway) and before the room is
 * dressed (furniture and decor keep off the floor and wall the stairs take up).
 *
 *   leaving a room upwards   a flight along the floor, rising towards the exit wall, its landing and doorway by that wall
 *   leaving it downwards     a stairwell in the floor on the exit side, to drop into
 *   coming out downwards     a flight rising towards the entry wall: the plane appears at its doorway, facing into the room
 *   coming out upwards       a stairwell near the entry wall: the plane appears above it
 *
 * The geometry itself (doorway, landing, arrival point) lives in `world/stairs.ts`, shared with the art and the game.
 */

import type { Rng } from '../../core/rng';
import { stairsDownGeom, stairsUpGeom } from '../stairs';
import { LAYOUT, type ItemDef } from '../types';
import { toX } from './geom';
import { leavesByStairs, stairsKindOf, type Box, type RoomIO } from './types';

export interface StairsPlan {
  kind: 'stairsUp' | 'stairsDown';
  /** The plane leaves the room by these stairs, or comes out of them. */
  role: 'exit' | 'entry';
  /** The room item. */
  item: ItemDef;
  /** The floor x-range nothing may stand on: the flight from its foot to its far end, or the stairwell. */
  floor: { x0: number; x1: number };
  /** Where a plane arriving by these stairs appears, and which way it faces. */
  arrive: { x: number; y: number; facing: 1 | -1 };
}

/** Gap between a flight's far end and the side wall (the landing is not built into the wall). */
const WALL_GAP = 14;

/**
 * Landing heights (the y of the landing's floor; the doorway stands on it). A flight the plane leaves by has a low landing:
 * the lower the doorway, the wider the range of lift that gets the plane up to it. One the plane comes out of has a high
 * landing: it starts at the doorway, and the height it starts with carries it across the room.
 */
const TOPS = { exit: [164, 172, 180, 188], entry: [124, 132, 140] } as const;
const FLIGHT_WIDTHS = [196, 204, 212, 222] as const;
const WELL_WIDTHS = [140, 150, 160] as const;
/** Centre of the stairwell, px from the entry wall: on the exit side of a room it is left by, near the entry wall when it is come out of. */
const WELL_U = { exit: [390, 470], entry: [100, 170] } as const;

export function planStairs(io: RoomIO, rng: Rng): StairsPlan | null {
  const kind = stairsKindOf(io);
  if (!kind) return null;
  const role = leavesByStairs(io) ? 'exit' : 'entry';
  const dirX = io.dirX;
  const v = io.stairsV ?? 0;
  let item: ItemDef;
  if (kind === 'stairsUp') {
    const w = rng.pick(FLIGHT_WIDTHS);
    const top = rng.pick(TOPS[role]);
    // it rises towards the wall the plane leaves by, or towards the one it came in at: the landing end is by that wall
    const dir = (role === 'exit' ? dirX : -dirX) as 1 | -1;
    const x = dir > 0 ? 640 - LAYOUT.sideWall - WALL_GAP - w : LAYOUT.sideWall + WALL_GAP;
    item = { t: 'stairsUp', x, y: LAYOUT.floor, w, top, dir, v };
  } else {
    const w = rng.pick(WELL_WIDTHS);
    const [u0, u1] = WELL_U[role];
    item = { t: 'stairsDown', x: Math.round(toX(dirX, rng.int(u0, u1)) - w / 2), y: LAYOUT.wallBase, w, dir: dirX, v };
  }
  return { kind, role, item, floor: stairsFloorSpan(item), arrive: stairsArrive(item) };
}

/** Where a plane arriving by these stairs appears. */
export function stairsArrive(it: ItemDef): StairsPlan['arrive'] {
  return it.t === 'stairsDown' ? stairsDownGeom(it).arrive : stairsUpGeom(it).arrive;
}

/** The floor x-range a flight of stairs or a stairwell takes up: furniture, vents and rugs stay out of it. */
export function stairsFloorSpan(it: ItemDef): { x0: number; x1: number } {
  if (it.t === 'stairsDown') {
    // (the gallery rail's newel posts stand a few px outside the well)
    const w = stairsDownGeom(it).well;
    return { x0: w.x - 8, x1: w.x + w.w + 8 };
  }
  return { x0: it.x, x1: it.x + (it.w ?? 190) };
}

/**
 * Wall that wall decor stays out of: the doorway of a flight, the landing under it and everything above, and the stretch
 * of wall above its handrail (which climbs to the landing; decor hangs a good way above it). The first box is the
 * doorway's column. A stairwell leaves the wall alone.
 */
export function stairsWallBoxes(it: ItemDef): Box[] {
  if (it.t !== 'stairsUp') return [];
  const g = stairsUpGeom(it);
  const top = g.landing.y;
  const boxes: Box[] = [{ x: g.door.x - 12, y: 0, w: g.door.w + 24, h: LAYOUT.dado }];
  // the handrail runs from beside the foot to the landing (see the painter)
  const rise = (LAYOUT.floor - top) / g.steps;
  const x0 = g.foot + g.dir * 6;
  const y0 = LAYOUT.floor - rise - 30;
  const railY = (x: number) => y0 + (top - 30 - y0) * ((x - x0) / (g.head - x0));
  const lo = Math.min(g.foot, g.head);
  const hi = Math.max(g.foot, g.head);
  const n = 6;
  for (let k = 0; k < n; k++) {
    const xa = Math.floor(lo + ((hi - lo) * k) / n);
    const xb = Math.ceil(lo + ((hi - lo) * (k + 1)) / n);
    // the rail is highest at the end nearer the landing
    const y = Math.max(0, Math.round(railY(g.dir > 0 ? xb : xa)) - 24);
    if (y < LAYOUT.dado) boxes.push({ x: xa, y, w: xb - xa, h: LAYOUT.dado - y });
  }
  return boxes;
}
