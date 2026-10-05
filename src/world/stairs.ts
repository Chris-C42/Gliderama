/**
 * Stairs between floors, the Glider way: fly into the doorway at the top of a flight of stairs (or down
 * into a stairwell) and you are taken to the matching stairs in the room above (or below), gliding
 * level again: a reset rather than a continuous climb. Geometry shared by the art, the runtime object
 * (its trigger) and the session (where the plane comes out).
 *
 *   stairsUp    x = foot of the flight, w = total width, dir = the way it rises (+1 = to the right),
 *               top = y of the landing at the top (the doorway stands on it)
 *   stairsDown  x .. x + w = the opening in the floor, dir = the way the steps go down
 */

import { LAYOUT, type ItemDef, type Rect } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

export interface StairsUpGeom {
  dir: 1 | -1;
  /** The way up: a doorway on the landing (the trigger). */
  door: Rect;
  /** Landing at the top of the flight (x range, floor y). */
  landing: { x0: number; x1: number; y: number };
  /** The flight itself, foot to head: x of the foot and of the head, rise per step. */
  foot: number;
  head: number;
  steps: number;
  /** Where a plane coming down from the room above appears, and which way it faces. */
  arrive: { x: number; y: number; facing: 1 | -1 };
}

export function stairsUpGeom(it: ItemDef): StairsUpGeom {
  const dir: 1 | -1 = num(it.dir, 1) >= 0 ? 1 : -1;
  const w = it.w ?? 190;
  const top = num(it.top, 160);
  const dw = 46;
  const dh = 72;
  const landW = dw + 16;
  // mirrored for a flight rising to the left
  const X = (dx: number) => (dir > 0 ? it.x + dx : it.x + w - dx);
  const doorX = Math.min(X(w - 8 - dw), X(w - 8));
  const lx0 = Math.min(X(w - landW), X(w));
  const steps = Math.max(4, Math.round((LAYOUT.floor - top) / 13));
  return {
    dir,
    door: { x: doorX, y: top - dh, w: dw, h: dh },
    landing: { x0: lx0, x1: lx0 + landW, y: top },
    foot: X(0),
    head: X(w - landW),
    steps,
    arrive: { x: doorX + dw / 2 - dir * 44, y: top - 40, facing: dir > 0 ? -1 : 1 },
  };
}

export interface StairsDownGeom {
  dir: 1 | -1;
  /** The opening in the floor (the trigger is its upper part). */
  well: Rect;
  trigger: Rect;
  arrive: { x: number; y: number; facing: 1 | -1 };
}

export function stairsDownGeom(it: ItemDef): StairsDownGeom {
  const dir: 1 | -1 = num(it.dir, 1) >= 0 ? 1 : -1;
  const w = it.w ?? 150;
  const well = { x: it.x, y: LAYOUT.wallBase, w, h: 360 - LAYOUT.wallBase };
  const cx = it.x + w / 2;
  return {
    dir,
    well,
    trigger: { x: it.x + 14, y: LAYOUT.floor - 34, w: w - 28, h: 34 },
    // coming up from below: out over the top of the flight, gliding away from it into the room
    arrive: { x: cx, y: 206, facing: cx < 320 ? 1 : -1 },
  };
}

/** Where a plane taking the stairs `way` comes out in `room`: at the matching stairs, else mid-room. */
export function stairsArrival(items: readonly ItemDef[], way: 'up' | 'down'): { x: number; y: number; facing: 1 | -1 } {
  const t = way === 'up' ? 'stairsDown' : 'stairsUp';
  const it = items.find((i) => i.t === t);
  if (!it) return { x: 320, y: 180, facing: 1 };
  return t === 'stairsDown' ? stairsDownGeom(it).arrive : stairsUpGeom(it).arrive;
}
