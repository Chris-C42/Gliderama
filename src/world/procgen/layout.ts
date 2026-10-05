/**
 * Floor layout: a path of rooms on the grid ("gx,gy", gy grows downward), mostly horizontal progress in one direction
 * chosen by the seed, with the occasional storey change. Produces one `RoomIO` per room: where the plane comes in,
 * where it leaves and the exact spans of the openings (shared by the two rooms they connect).
 */

import type { Rng } from '../../core/rng';
import { roomKey } from '../../game/level';
import type { ExitSpan } from '../types';
import type { EntrySide, RoomIO, Side } from './types';

export interface RouteOptions {
  count: number;
  floor: number;
  /** The last transition is always horizontal; a vertical move never follows a vertical move. */
  allowVertical?: boolean;
}

/** Half width of a stairwell opening (ceiling or floor): wide enough that a plane hovering over it fits either way. */
export const HOLE_HALF = 65;

/** Probability that a transition changes storey: about 1 in 5, more on later floors. */
export function verticalChance(floor: number): number {
  return Math.min(0.42, 0.2 + 0.025 * floor);
}

/** A side doorway: top 60..84, bottom 330..340 (the floor line). */
function doorway(rng: Rng): ExitSpan {
  return { from: 60 + 6 * rng.int(0, 4), to: 330 + 5 * rng.int(0, 2) };
}

/** Centre x of a stairwell opening in a room entered from the `entrySide` wall; `lo`..`hi` px from that wall. */
function holeCentre(rng: Rng, dirX: 1 | -1, lo: number, hi: number): number {
  const u = rng.int(lo, hi);
  return dirX > 0 ? u : 640 - u;
}

function holeSpan(cx: number): ExitSpan {
  return { from: cx - HOLE_HALF, to: cx + HOLE_HALF };
}

export function planRoute(rng: Rng, opts: RouteOptions): RoomIO[] {
  const n = opts.count;
  const dirX: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const entrySide: Side = dirX > 0 ? 'left' : 'right';
  const exitSide: Side = dirX > 0 ? 'right' : 'left';
  const pv = opts.allowVertical === false ? 0 : verticalChance(opts.floor);

  // transitions[i]: how room i connects to room i + 1
  const kinds: ('side' | 'up' | 'down')[] = [];
  let level = 0; // storeys above the start (negative = below)
  for (let i = 0; i < n - 1; i++) {
    const last = i === n - 2;
    const prevVertical = i > 0 && kinds[i - 1] !== 'side';
    if (!last && !prevVertical && rng.chance(pv)) {
      // prefer to come back towards the starting storey
      const upBias = level < -1 ? 0.25 : level > 1 ? 0.75 : 0.5;
      const k = rng.chance(upBias) ? 'up' : 'down';
      kinds.push(k);
      level += k === 'up' ? -1 : 1;
    } else kinds.push('side');
  }

  // grid positions
  const cells: { gx: number; gy: number }[] = [{ gx: 0, gy: 0 }];
  for (let i = 0; i < n - 1; i++) {
    const c = cells[i];
    if (kinds[i] === 'side') cells.push({ gx: c.gx + dirX, gy: c.gy });
    else cells.push({ gx: c.gx, gy: c.gy + (kinds[i] === 'up' ? -1 : 1) });
  }
  const minX = Math.min(...cells.map((c) => c.gx));
  const minY = Math.min(...cells.map((c) => c.gy));

  const rooms: RoomIO[] = [];
  let incoming: { side: EntrySide; span: ExitSpan } | null = null;
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const gx = c.gx - minX;
    const gy = c.gy - minY;
    const k = i < n - 1 ? kinds[i] : 'final';
    let exit: Side;
    let exitSpan: ExitSpan;
    let next: { side: EntrySide; span: ExitSpan } | null = null;
    if (k === 'side') {
      exit = exitSide;
      exitSpan = doorway(rng);
      next = { side: entrySide as EntrySide, span: exitSpan };
    } else if (k === 'up') {
      exit = 'up';
      exitSpan = holeSpan(holeCentre(rng, dirX, 165, 235));
      next = { side: 'down', span: exitSpan };
    } else if (k === 'down') {
      exit = 'down';
      exitSpan = holeSpan(holeCentre(rng, dirX, 330, 470));
      next = { side: 'up', span: exitSpan };
    } else {
      exit = exitSide;
      const d = doorway(rng);
      exitSpan = { ...d, exit: true };
    }
    rooms.push({
      index: i,
      count: n,
      gx,
      gy,
      key: roomKey(gx, gy),
      dirX,
      entry: incoming ? incoming.side : 'start',
      entrySpan: incoming?.span,
      exit,
      exitSpan,
    });
    incoming = next;
  }
  return rooms;
}
