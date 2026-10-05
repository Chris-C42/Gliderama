/**
 * The air of a room: floor vents (lift), ceiling vents and desk fans. These decide how the plane can cross the room, so
 * they are planned first, flown with the reference pilot, and only then is the room furnished around the flight.
 *
 * Altitude budget: a glider loses about 0.14..0.2 px per px flown, a dart about 0.27..0.3. Entering low at the door
 * (y = ENTRY_LOW) the plane must reach a vent within ~300 px, climb to where the updraft tops out (`top`, a knob:
 * lower `top` = weaker lift) and then still reach the far doorway below EXIT_CONTRACT. Hence the position windows below.
 */

import type { Rng } from '../../core/rng';
import { stairsDownGeom, stairsUpGeom } from '../stairs';
import type { ItemDef } from '../types';
import { EXIT_CONTRACT } from './fly';
import { toX } from './geom';
import { HOLE_HALF } from './layout';
import type { StairsPlan } from './stairsPlan';
import { entersByStairs, leavesByStairs, type Difficulty, type RoomIO } from './types';

export interface VentPlan {
  /** Left edge (px). */
  x: number;
  w: number;
  /** m/s at the grille. */
  power: number;
  /** y (px) the updraft tops out at; negative = continues through a ceiling opening. */
  top: number;
  /** `stair`: just beyond a floor opening or a stairwell; `landing`: in front of a flight of stairs, lifting the plane to its doorway. */
  role: 'thermal' | 'hole' | 'stair' | 'landing';
}

export interface CeilVentPlan {
  x: number;
  w: number;
  power: number;
}

export interface FanPlan {
  /** Head top-left. */
  x: number;
  y: number;
  dir: 1 | -1;
  power: number;
  reach: number;
  stand: number;
  /** The table the fan stands on. */
  host: { kind: string; x: number; w: number; h: number; top: number };
}

export interface BenchPlan {
  /** Desk left edge and width (the desk item's x and w). */
  x: number;
  w: number;
}

export interface AirPlan {
  vents: VentPlan[];
  ceilVents: CeilVentPlan[];
  fans: FanPlan[];
  bench?: BenchPlan;
}

export const VENT_W = [48, 56, 64] as const;

function ventPower(rng: Rng, floor: number): number {
  return Math.min(4.7, Math.max(3.4, 4.45 - 0.07 * Math.min(floor, 9) + rng.float(-0.35, 0.3)));
}

/** How weak (0 = as strong as allowed .. 1 = as weak as allowed) a vent's lift ceiling is: weaker on later floors. */
function ventFrac(rng: Rng, floor: number): number {
  return Math.min(1, Math.max(0, 0.2 + 0.07 * Math.min(floor, 9) + rng.float(-0.15, 0.15)));
}

function ventWidth(rng: Rng, floor: number): number {
  return floor >= 5 ? rng.pick([48, 56, 56, 64]) : rng.pick([56, 64, 64, 48]);
}

/**
 * The window a vent's `top` (the height its updraft stops at) has to fall in, for a vent `centreU` px from the entry wall,
 * `D = 640 - centreU` px from the far wall. Measured on the pilot's flights (see tests/procgen.flight.test.ts): the height
 * it leaves a side doorway at is about  -32 + 0.96 * top + 0.44 * D  for the dart and  -54 + 0.6 * top + 0.44 * D  for the
 * glider. The dart must arrive below the altitude contract (`hi`: the strongest vent is lowest `top`), the glider
 * must not arrive above the doorway's lintel (`lo`).
 */
export function topWindow(doorTop: number, centreU: number): { lo: number; hi: number } {
  const D = 640 - centreU;
  const hi = Math.floor((EXIT_CONTRACT - 12 + 32 - 0.444 * D) / 0.96);
  const lo = Math.max(60, Math.ceil((doorTop + 30 + 54 - 0.443 * D) / 0.595));
  return { lo, hi: Math.max(hi, lo) };
}

/** Farthest (px) a landing vent may be from the doorway it lifts the plane to: beyond that the glide loses too much height. */
export const STAIRS_REACH = 323;

/**
 * The window a landing vent's `top` has to fall in, for a doorway whose middle is `doorMid` (y) and `D` px from the vent's
 * centre (the pilot glides to the doorway's middle after leaving the updraft). Measured on the pilot's flights, like
 * `topWindow`: the dart has to arrive above the doorway's sill (`hi`: a weaker updraft leaves it too low), the glider must
 * not overshoot the lintel (`lo`). The lower the doorway, the more room between the two (a doorway at head height needs
 * the vent within about 25 px; one on a low landing about 45).
 */
export function stairsTopWindow(doorMid: number, D: number): { lo: number; hi: number } {
  const lo = Math.round(45 + 0.3 * (STAIRS_REACH - D));
  return { lo, hi: lo + Math.max(10, Math.round(0.9 * (doorMid - 94))) };
}

/** `frac` picks a point in the vent's allowed `top` window (see `topWindow`). */
export function mkVent(dirX: 1 | -1, centreU: number, w: number, power: number, frac: number, role: VentPlan['role'], doorTop: number): VentPlan {
  const { lo, hi } = topWindow(doorTop, centreU);
  return { x: Math.round(toX(dirX, centreU) - w / 2), w, power: Math.round(power * 10) / 10, top: lo + Math.round((hi - lo) * frac), role };
}

export function ventCentre(v: VentPlan): number {
  return v.x + v.w / 2;
}

export interface AirOptions {
  difficulty: Difficulty;
  /** 0 = first try; later attempts fall back to the safest windows. */
  attempt: number;
  calm: boolean;
  /** Where the start throw is (room 0), px from the entry wall. */
  startU?: number;
  workbench: boolean;
  /** Hazard counts decided by the room planner. */
  fans: number;
  ceilVents: number;
  /** The stairs of a stairs link in this room. */
  stairs?: StairsPlan;
}

export function planAir(io: RoomIO, rng: Rng, o: AirOptions): AirPlan {
  const { dirX } = io;
  const floor = o.difficulty.floor;
  const safe = o.attempt >= 2;
  const plan: AirPlan = { vents: [], ceilVents: [], fans: [] };

  // ---- up the stairs: a vent in front of the flight lifts the plane to the doorway on its landing
  const st = o.stairs;
  if (st && leavesByStairs(io)) {
    if (io.exit === 'up') plan.vents.push(landingVent(io, rng, o, st));
    // (down the stairs there is nothing to climb: the plane drops into the well)
    return finish(plan, io, rng, o);
  }

  // ---- rooms with a stairwell
  if (io.exit === 'up') {
    const cx = (io.exitSpan.from + io.exitSpan.to) / 2;
    // its air carries on through the opening and well up into the room above (see game/roomAir)
    plan.vents.push({ x: cx - 32, w: 64, power: Math.round(rng.float(4.4, 4.9) * 10) / 10, top: -170, role: 'hole' });
    return finish(plan, io, rng, o);
  }
  if (io.exit === 'down') return finish(plan, io, rng, o);

  // ---- the workbench room: a catch vent before the desk, the desk, a vent after it
  if (o.workbench) {
    // (the vent after the desk must stay >= 300 px from the exit or the climb leaves the plane too high at the lintel)
    const w1 = 48;
    const deskW = rng.pick([140, 150, 156]);
    const u1 = rng.int(92, 104);
    const deskU0 = u1 + w1 / 2 + 36;
    const deskU1 = deskU0 + deskW + 8;
    const u2 = deskU1 + 26 + 32;
    plan.vents.push(mkVent(dirX, u1, w1, 4.4, 0.4, 'thermal', io.exitSpan.from));
    plan.vents.push(mkVent(dirX, u2, 64, 4.4, 0.4, 'thermal', io.exitSpan.from));
    const deskX = dirX > 0 ? deskU0 + 4 : 640 - (deskU0 + 4) - deskW;
    plan.bench = { x: Math.round(deskX), w: deskW };
    return plan;
  }

  // ---- coming out of the stairs: from the stairwell below, a stair draught just beyond the well; from the doorway above (a
  // flight rising to the entry wall) there is plenty of height already
  if (st && entersByStairs(io)) {
    if (io.entry === 'down') {
      const well = stairsDownGeom(st.item).well;
      const cu = toX(dirX, well.x + well.w / 2);
      const u = cu + well.w / 2 + 24 + 32 + rng.int(0, 40);
      plan.vents.push(mkVent(dirX, u, 64, rng.float(4.4, 4.9), 0.35, 'stair', io.exitSpan.from));
    }
    return finish(plan, io, rng, o);
  }

  // ---- rising through a floor opening: a stair draught just beyond it
  if (io.entry === 'down') {
    const cx = (io.entrySpan!.from + io.entrySpan!.to) / 2;
    const cu = dirX > 0 ? cx : 640 - cx;
    const u = cu + HOLE_HALF + 34 + 30 + rng.int(0, 34);
    plan.vents.push(mkVent(dirX, u, 64, rng.float(4.4, 4.9), 0.35, 'stair', io.exitSpan.from));
    return finish(plan, io, rng, o);
  }

  // ---- dropping in through a ceiling opening: plenty of height already, no vent needed
  if (io.entry === 'up') return finish(plan, io, rng, o);

  // ---- an ordinary room: one or two thermals
  const p2 = floor <= 1 ? 0.4 : floor <= 4 ? 0.25 : 0.12;
  const two = !safe && rng.chance(p2);
  const minU1 = Math.max(190, (o.startU ?? 0) + 130);
  if (!two) {
    const u = safe ? rng.int(250, 285) : rng.int(Math.max(240, minU1), 320);
    plan.vents.push(mkVent(dirX, u, safe ? 64 : ventWidth(rng, floor), ventPower(rng, floor), safe ? 0.5 : ventFrac(rng, floor), 'thermal', io.exitSpan.from));
  } else {
    const u1 = rng.int(Math.max(175, minU1), Math.max(Math.max(175, minU1) + 1, 225));
    const u2 = rng.int(Math.max(u1 + 150, 250), Math.max(u1 + 151, 250, 330));
    plan.vents.push(mkVent(dirX, u1, ventWidth(rng, floor), ventPower(rng, floor), ventFrac(rng, floor), 'thermal', io.exitSpan.from));
    plan.vents.push(mkVent(dirX, u2, ventWidth(rng, floor), ventPower(rng, floor), ventFrac(rng, floor), 'thermal', io.exitSpan.from));
  }
  return finish(plan, io, rng, o);
}

/**
 * The vent in front of a flight of stairs the plane leaves by: clear of the foot, near enough to the doorway that the glide
 * reaches it, and after the start throw if this is the first room.
 */
function landingVent(io: RoomIO, rng: Rng, o: AirOptions, st: StairsPlan): VentPlan {
  const { dirX } = io;
  const safe = o.attempt >= 2;
  const floor = o.difficulty.floor;
  const door = stairsUpGeom(st.item).door;
  const doorU = toX(dirX, door.x + door.w / 2);
  const footU = dirX > 0 ? st.floor.x0 : 640 - st.floor.x1;
  const w = safe ? 64 : ventWidth(rng, floor);
  const hi = footU - 16 - w / 2;
  const lo = Math.min(hi, Math.max(doorU - STAIRS_REACH, 190, (o.startU ?? 0) + 130));
  const u = safe ? Math.round((lo + hi) / 2) : rng.int(Math.round(lo), Math.round(hi));
  const { lo: tLo, hi: tHi } = stairsTopWindow(door.y + door.h / 2, doorU - u);
  // weaker lift on later floors, but within the window (the dart gives out towards the top of it, the glider is happy anywhere)
  const frac = safe ? 0.5 : Math.min(0.7, Math.max(0.1, ventFrac(rng, floor)));
  return {
    x: Math.round(toX(dirX, u) - w / 2),
    w,
    power: Math.round(rng.float(4.2, 4.7) * 10) / 10,
    top: tLo + Math.round((tHi - tLo) * frac),
    role: 'landing',
  };
}

/** Ceiling vents and fans, which only ever go where the plane is already high (after the last thermal). */
function finish(plan: AirPlan, io: RoomIO, rng: Rng, o: AirOptions): AirPlan {
  const { dirX } = io;
  const thermals = plan.vents.filter((v) => v.role !== 'hole');
  const lastU = thermals.length
    ? Math.max(...thermals.map((v) => (dirX > 0 ? ventCentre(v) : 640 - ventCentre(v))))
    : io.entry === 'up' && io.entrySpan
      ? ((dirX > 0 ? (io.entrySpan.from + io.entrySpan.to) / 2 : 640 - (io.entrySpan.from + io.entrySpan.to) / 2))
      : 200;
  const safe = o.attempt >= 3;
  if (!safe && !o.calm) {
    for (let i = 0; i < o.ceilVents; i++) {
      const u = rng.int(Math.min(520, lastU + 120), 560);
      const w = rng.pick([48, 56]);
      plan.ceilVents.push({ x: Math.round(toX(dirX, u) - w / 2), w, power: Math.round(rng.float(1.8, 2.5) * 10) / 10 });
    }
    for (let i = 0; i < o.fans; i++) {
      const fan = planFan(io, rng, lastU, o.difficulty.floor, plan.fans.length);
      if (fan) plan.fans.push(fan);
    }
  }
  return plan;
}

const FAN_HOSTS = [
  { kind: 'sideTable', w: 84, h: 84, top: 258, weight: 3 },
  { kind: 'dresser', w: 120, h: 104, top: 238, weight: 2 },
  { kind: 'desk', w: 150, h: 98, top: 244, weight: 1 },
  { kind: 'nightstand', w: 54, h: 66, top: 275, weight: 1 },
] as const;

function planFan(io: RoomIO, rng: Rng, lastU: number, floor: number, index: number): FanPlan | null {
  const { dirX } = io;
  const host = rng.weighted(FAN_HOSTS.map((h) => ({ item: h, w: h.weight })));
  const stand = 30;
  // across the thermal (blowing at the column) or against the glide out
  const across = floor >= 5 && rng.chance(0.4);
  const u = across ? lastU + (index % 2 === 0 ? 150 : -150) : rng.int(Math.min(500, lastU + 130), 540);
  if (u < 90 || u > 560) return null;
  const hostX = Math.round(toX(dirX, u) - host.w / 2);
  const dir: 1 | -1 = across ? ((dirX * (index % 2 === 0 ? -1 : 1)) as 1 | -1) : ((-dirX) as 1 | -1);
  return {
    x: hostX + Math.round(host.w / 2) - 16,
    y: host.top - 32 - stand,
    dir,
    power: Math.round((1.5 + Math.min(1.7, 0.2 * floor) + rng.float(-0.2, 0.3)) * 10) / 10,
    reach: rng.int(200, 270),
    stand,
    host: { kind: host.kind, x: hostX, w: host.w, h: host.h, top: host.top },
  };
}

/** The runtime items of an air plan (what the headless simulator and the game build objects from). */
export function airItems(plan: AirPlan): ItemDef[] {
  const out: ItemDef[] = [];
  for (const v of plan.vents) out.push({ t: 'floorVent', x: v.x, y: 330, w: v.w, power: v.power, reach: v.top });
  for (const c of plan.ceilVents) out.push({ t: 'ceilingVent', x: c.x, y: 14, w: c.w, power: c.power });
  for (const f of plan.fans) out.push({ t: 'fan', x: f.x, y: f.y, dir: f.dir, stand: f.stand, power: f.power, reach: f.reach });
  return out;
}

/** The vents the pilot may climb in. */
export function pilotVents(plan: AirPlan): { cx: number; w: number; top: number }[] {
  return plan.vents.filter((v) => v.role !== 'hole').map((v) => ({ cx: ventCentre(v), w: v.w, top: v.top }));
}
