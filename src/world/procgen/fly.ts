/**
 * Flying the reference pilot through rooms: entry points, the pass criteria and the result record.
 * Everything here is deterministic: the simulator's only randomness (which wing takes a bump) is fed from a fixed RNG.
 */

import { createRng } from '../../core/rng';
import { bounds, polyVsBox, profileHull, worldHull } from '../../game/collide';
import { turnSquash } from '../../game/flightTick';
import { simulateRoom, type SimOutcome, type SimRoom } from '../../game/sim';
import { PX_PER_M, ROOM_H } from '../../physics/config';
import { damagePct } from '../../physics/damage';
import type { Plane } from '../../physics/flight';
import { stairsDownGeom, stairsUpGeom } from '../stairs';
import type { ItemDef, Rect } from '../types';
import type { RefPlane } from './fleet';
import { makePilot, type PilotSpec } from './pilot';
import { entersByStairs, leavesByStairs, type FlightRun, type RoomIO } from './types';

/** Entry heights (px) used for validation: a high and a low arrival at a side doorway. */
export const ENTRY_HIGH = 130;
export const ENTRY_LOW = 215;
/** Altitude contract: a plane leaving a side exit is below this (px, y down) or the next room's low entry is a lie. */
export const EXIT_CONTRACT = 215;
/** x of the checkpoint just inside a side doorway. */
export const DOOR_X = 44;
/** Most damage (percent) a validation flight may pick up. */
export const MAX_DAMAGE = 18;
/** Longest flight (real s). */
export const MAX_FLIGHT = 24;

export interface Entry {
  id: string;
  x: number;
  y: number;
  /** Throw elevation above the heading (rad). */
  elev: number;
  dirX: 1 | -1;
  /** Arriving already in flight instead of thrown: velocity in m/s (y up). */
  v?: { x: number; y: number };
  /**
   * Arriving by stairs: reset level (no pitch, no turn) at the design's best-glide speed, as the session does. The speed
   * depends on the plane, so it cannot be a fixed `v`.
   */
  reset?: boolean;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export interface EntryExtras {
  /** Start point (room 0). */
  start?: { x: number; y: number };
  /** Where the plane is re-thrown after refolding at the workbench. */
  bench?: { x: number; y: number };
  /** Where the stairs bring the plane out (a room entered by stairs): see `stairsArrival`. */
  arrive?: { x: number; y: number; facing: 1 | -1 };
}

/** The entry points a room must be flyable from. */
export function entriesFor(io: RoomIO, extras: EntryExtras = {}): Entry[] {
  const out: Entry[] = [];
  const dirX = io.dirX;
  const span = io.entrySpan;
  if (io.entry === 'start') {
    const s = extras.start ?? { x: dirX > 0 ? 70 : 570, y: 160 };
    out.push({ id: 'start', x: s.x, y: s.y, elev: 0, dirX });
  } else if (io.entry === 'left' || io.entry === 'right') {
    const x = io.entry === 'left' ? DOOR_X : 640 - DOOR_X;
    const from = span?.from ?? 80;
    const to = span?.to ?? 335;
    out.push({ id: 'door-hi', x, y: clamp(ENTRY_HIGH, from + 28, to - 40), elev: 0, dirX });
    out.push({ id: 'door-lo', x, y: clamp(ENTRY_LOW, from + 28, to - 40), elev: 0, dirX });
  } else if (entersByStairs(io)) {
    // coming out of the stairs: 'above' = down from the room above (at its doorway), 'below' = up from the room below (over its well)
    const a = extras.arrive ?? { x: 320, y: 180, facing: dirX };
    out.push({ id: io.entry === 'up' ? 'above' : 'below', x: a.x, y: a.y, elev: 0, dirX: a.facing, reset: true });
  } else {
    const cx = span ? (span.from + span.to) / 2 : 320;
    // 'up': dropping in through the ceiling opening; 'down': rising through the floor opening
    if (io.entry === 'up') out.push({ id: 'above', x: cx, y: 60, elev: 0, dirX });
    // rising through the floor opening as the plane really arrives: at the edge of the room, slow,
    // carried by the air coming up from the room below
    else out.push({ id: 'below', x: cx, y: 352, elev: 0, dirX, v: { x: dirX * 1.5, y: 1.0 } });
  }
  if (extras.bench) out.push({ id: 'bench', x: extras.bench.x, y: extras.bench.y, elev: 0, dirX });
  return out;
}

/** The pilot has to reach the stairs doorway at least this far above its sill, so the doorway is hit rather than grazed. */
const DOOR_SILL = 12;

/** The pilot's brief for a room (which exit, which vents it may use). `stairs`: the room's stairs item, for a room left by stairs. */
export function pilotSpec(io: RoomIO, vents: PilotSpec['vents'], extras: { land?: PilotSpec['land']; stairs?: ItemDef } = {}): PilotSpec {
  const sideExit = io.exit === 'left' || io.exit === 'right';
  if (leavesByStairs(io) && extras.stairs) {
    const base = { dirX: io.dirX, vents, yc: EXIT_CONTRACT - 5, final: false, land: extras.land };
    if (io.exit === 'up') {
      // a doorway on a landing: its sill is the lowest the plane may arrive, its lintel the highest
      const door = stairsUpGeom(extras.stairs).door;
      return { ...base, exit: 'stairsUp', yc: door.y + door.h - DOOR_SILL, doorTop: door.y, holeCx: door.x + door.w / 2 };
    }
    const well = stairsDownGeom(extras.stairs).well;
    return { ...base, exit: 'stairsDown', doorTop: 0, holeCx: well.x + well.w / 2 };
  }
  return {
    dirX: io.dirX,
    exit: io.exit,
    vents,
    yc: EXIT_CONTRACT - 5,
    final: !!io.exitSpan.exit,
    doorTop: sideExit ? io.exitSpan.from : 0,
    holeCx: sideExit ? undefined : (io.exitSpan.from + io.exitSpan.to) / 2,
    land: extras.land,
  };
}

export interface FlyOptions {
  /** A trigger the flight must touch on its way (a light switch in a dark room). */
  touch?: Rect;
  /** Longest flight (real s); default `MAX_FLIGHT`. */
  maxT?: number;
}

function fixedRand(seed: number): () => number {
  const r = createRng(seed);
  return () => r.next();
}

/** Did the plane's hull overlap `rect` at this moment? */
function hits(hullLocal: ReturnType<typeof profileHull>, p: Plane, rect: Rect): boolean {
  const x = p.x * PX_PER_M;
  const y = ROOM_H - p.y * PX_PER_M;
  const hw = worldHull(hullLocal, x, y, p.theta, p.facing, turnSquash(p));
  const bb = bounds(hw);
  if (bb.x1 < rect.x || bb.x0 > rect.x + rect.w || bb.y1 < rect.y || bb.y0 > rect.y + rect.h) return false;
  return !!polyVsBox(hw, { ...rect });
}

function run(
  sim: SimRoom,
  plane: RefPlane,
  spec: PilotSpec,
  entry: Entry,
  elev: number,
  opts: { touch?: Rect; maxT: number; record: number },
): { outcome: SimOutcome; t: number; path: { x: number; y: number }[]; damage: number; end: { x: number; y: number }; touched: boolean } {
  const pilot = makePilot(plane, spec);
  const hullLocal = profileHull(plane.mesh);
  let touched = false;
  const ctl = (p: Plane, t: number) => {
    if (opts.touch && !touched && hits(hullLocal, p, opts.touch)) touched = true;
    return pilot(p, t);
  };
  const angle = entry.dirX > 0 ? elev : Math.PI - elev;
  const v = entry.reset ? { x: entry.dirX * plane.aero.perf.vBest, y: 0 } : entry.v;
  const start = v ? { x: entry.x, y: entry.y, vx: v.x, vy: v.y, facing: entry.dirX } : { x: entry.x, y: entry.y, angle, power: plane.power };
  const res = simulateRoom(sim, plane.aero, plane.mesh, start, ctl, {
    maxT: opts.maxT,
    record: opts.record,
    rand: fixedRand(0x5eed),
  });
  const end = { x: res.plane.x * PX_PER_M, y: ROOM_H - res.plane.y * PX_PER_M };
  return { outcome: res.outcome, t: res.t, path: res.path, damage: damagePct(res.plane.damage), end, touched };
}

/** Throw elevations to try so the first moments of the flight pass through `target`. */
function aimCandidates(entry: Entry, target: Rect): number[] {
  const tx = target.x + target.w / 2;
  const ty = target.y + target.h / 2;
  const dx = Math.max(20, Math.abs(tx - entry.x));
  const a0 = clamp((entry.y - ty) / dx + 0.04, -0.55, 0.55); // small-angle: tan(a) ~ a
  return [a0, a0 - 0.07, a0 + 0.07, a0 - 0.14, a0 + 0.14, a0 - 0.24, a0 + 0.24, a0 - 0.36, a0 + 0.36];
}

/** Fly one plane from one entry and judge it. */
export function flyRoom(sim: SimRoom, plane: RefPlane, spec: PilotSpec, entry: Entry, opts: FlyOptions = {}): FlightRun {
  let elev = entry.elev;
  if (opts.touch && !entry.v && !entry.reset) {
    // a pilot who has to flip the switch aims the throw at it
    for (const a of aimCandidates(entry, opts.touch)) {
      const probe = run(sim, plane, spec, entry, a, { touch: opts.touch, maxT: 1.6, record: 12 });
      if (probe.touched) {
        elev = a;
        break;
      }
    }
  }
  const r = run(sim, plane, spec, entry, elev, { touch: opts.touch, maxT: opts.maxT ?? MAX_FLIGHT, record: 3 });
  const sideExit = spec.exit === 'left' || spec.exit === 'right';
  let ok = true;
  let why = '';
  if (spec.land) {
    const { x0, x1, top } = spec.land;
    const inside = r.end.x > x0 + 6 && r.end.x < x1 - 6 && r.end.y > top - 30 && r.end.y < top + 12;
    if (r.outcome !== 'grounded' || !inside) {
      ok = false;
      why = `did not land on the bench (${r.outcome} at ${Math.round(r.end.x)},${Math.round(r.end.y)})`;
    }
  } else if (r.outcome !== spec.exit) {
    ok = false;
    why = `${r.outcome} at ${Math.round(r.end.x)},${Math.round(r.end.y)} after ${r.t.toFixed(1)}s`;
  }
  if (ok && r.damage > MAX_DAMAGE) {
    ok = false;
    why = `damaged ${r.damage}%`;
  }
  let exitY: number | undefined;
  // (the way out of the house can be reached at any height; every other exit has to leave the plane where the next room's entry is)
  if (ok && sideExit && !spec.land && !spec.final) {
    exitY = r.end.y;
    if (exitY > EXIT_CONTRACT + 6) {
      ok = false;
      why = `left too low (${Math.round(exitY)})`;
    }
  }
  if (ok && opts.touch && !r.touched) {
    ok = false;
    why = 'never touched the switch';
  }
  return { plane: plane.id, entry: entry.id, ok, outcome: r.outcome, why, t: r.t, damage: r.damage, end: r.end, exitY, path: r.path };
}

