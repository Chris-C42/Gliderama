/**
 * Headless flight simulation through a single room: used to validate generated levels (can a
 * reference plane get from the entry to the exit?) and for sandbox auto-tests.
 */

import type { AeroModel } from '../paper/aero';
import type { PlaneMesh } from '../paper/build';
import { PX_PER_M, ROOM_H, ROOM_W } from '../physics/config';
import { createPlane, launch, planePx, type FlightInput, type Plane } from '../physics/flight';
import { damagePct } from '../physics/damage';
import { roomColliders } from '../world/colliders';
import type { Collider, Rect, RoomDef } from '../world/types';
import { profileHull, bounds, polyVsBox } from './collide';
import { flightTick, planeHull, type TickState } from './flightTick';
import { OBJECTS } from './objects';
import type { GameObject, ObjCtx, SessionApi, WindOut } from './objects/types';
import type { LevelDef } from './level';
import { spillsFor, spillWind, updateSpills, type Spill } from './roomAir';

export interface SimRoom {
  def: RoomDef;
  colliders: Collider[];
  objects: GameObject[];
  /** Areas the plane must not touch (flames etc.). */
  hazards: Rect[];
  /** Air from the rooms above and below, through the floor and ceiling openings. */
  spills: Spill[];
}

/** A room ready to fly headless. Pass the level and the room's key so air from the rooms above and below counts. */
export function buildSimRoom(def: RoomDef, where?: { level: Pick<LevelDef, 'rooms'>; key: string }): SimRoom {
  const objects: GameObject[] = [];
  let i = 0;
  for (const it of def.items) {
    const f = OBJECTS[it.t];
    if (f) objects.push(f(it, `${def.id}:${it.t}:${i++}`, null, { dark: !!def.dark, night: !!def.night }));
  }
  const hazards: Rect[] = [];
  for (const o of objects) if ((o.def.t === 'candle' || o.def.t === 'fireplace') && o.trigger) {
    const r = o.trigger();
    if (r) hazards.push(r);
  }
  const colliders = roomColliders(def);
  for (const o of objects) if (o.colliders) colliders.push(...o.colliders());
  return { def, colliders, objects, hazards, spills: where ? spillsFor(where.level, where.key) : [] };
}

export type SimOutcome = 'left' | 'right' | 'up' | 'down' | 'grounded' | 'crashed' | 'hazard' | 'timeout' | 'stairsUp' | 'stairsDown';

export interface SimResult {
  outcome: SimOutcome;
  /** Real seconds. */
  t: number;
  path: { x: number; y: number }[];
  damage: number;
  plane: Plane;
}

export interface SimStart {
  x: number;
  y: number;
  /** Either a throw (angle/power) or an initial velocity in m/s (room frame, y up). */
  angle?: number;
  power?: number;
  vx?: number;
  vy?: number;
  theta?: number;
  facing?: 1 | -1;
}

const noopApi = (plane: () => Plane, switches = new Map<string, boolean>()): SessionApi => ({
  collectStar() {},
  addSheet() {},
  repair() {},
  addCharge() {},
  toggleLights() {},
  setSwitch: (g, on) => void switches.set(g, on),
  switchOn: (g) => switches.get(g) ?? true,
  soak() {},
  ignite() {},
  burnDamage() {},
  tear() {},
  completeLevel() {},
  openWorkbench() {},
  teleport() {},
  takeStairs() {},
  transport() {},
  sfx() {},
  shake() {},
  plane: () => {
    const p = planePx(plane());
    return { x: p.x, y: p.y, vx: plane().vx, vy: plane().vy, alive: true };
  },
  isCollected: () => false,
  lightsOn: () => true,
});

/**
 * Fly through a room. `control` may steer the plane (a bot); by default hands-off.
 * Stops when the plane leaves the room, lands, crashes, touches a hazard or times out.
 */
export function simulateRoom(
  room: SimRoom,
  aero: AeroModel,
  mesh: PlaneMesh,
  start: SimStart,
  control: (p: Plane, t: number) => FlightInput = () => ({ dir: 0, pitch: 0, boost: false }),
  opts: { maxT?: number; airMul?: number; record?: number; rand?: () => number } = {},
): SimResult {
  const plane = createPlane(aero);
  if (start.vx !== undefined || start.vy !== undefined) {
    plane.x = start.x / PX_PER_M;
    plane.y = (ROOM_H - start.y) / PX_PER_M;
    plane.vx = start.vx ?? 0;
    plane.vy = start.vy ?? 0;
    plane.facing = start.facing ?? (plane.vx >= 0 ? 1 : -1);
    plane.theta = start.theta ?? Math.atan2(plane.vy, Math.abs(plane.vx));
  } else {
    launch(plane, start.x, start.y, start.angle ?? 0, start.power ?? 0.4);
  }
  const st: TickState = {
    plane,
    aero,
    hullLocal: profileHull(mesh),
    halfLen: ((mesh.max.x - mesh.min.x) * PX_PER_M) / 2,
    groundT: 0,
    stillT: 0,
  };
  const out: WindOut = { x: 0, y: 0 };
  const airMul = opts.airMul ?? 1;
  const wind = (xm: number, ym: number) => {
    out.x = 0;
    out.y = 0;
    const x = xm * PX_PER_M;
    const y = ROOM_H - ym * PX_PER_M;
    for (const o of room.objects) o.wind?.(x, y, out);
    spillWind(room.spills, x, y, out);
    return { x: out.x * airMul, y: out.y * airMul };
  };
  const ctx: ObjCtx = { dt: 1 / 120, time: 0, particles: { spawn() {} }, api: noopApi(() => plane) };
  const dt = 1 / 120;
  const maxT = opts.maxT ?? 20;
  const recordEvery = opts.record ?? 6;
  const path: { x: number; y: number }[] = [];
  let t = 0;
  let k = 0;
  for (;;) {
    ctx.time = t;
    for (const o of room.objects) o.update?.(ctx);
    updateSpills(room.spills, ctx);
    const r = flightTick(st, control(plane, t), wind, room.colliders, dt, { rand: opts.rand }, {});
    t += dt;
    const pos = planePx(plane);
    if (k++ % recordEvery === 0) path.push({ x: pos.x, y: pos.y });
    const done = (outcome: SimOutcome): SimResult => ({ outcome, t, path, damage: damagePct(plane.damage), plane });
    if (r === 'crashed') return done('crashed');
    if (r === 'grounded') return done('grounded');
    // switches are mechanisms the flight can use (a fan switched off), so they work headless too
    for (const o of room.objects) {
      if (o.def.t !== 'switch' || !o.trigger) continue;
      const tr = o.trigger();
      if (!tr) continue;
      const hw = planeHull(st);
      if (polyVsBox(hw, { ...tr })) o.onTouch?.(ctx);
    }
    if (room.hazards.length) {
      const hw = planeHull(st);
      const bb = bounds(hw);
      for (const h of room.hazards) {
        if (bb.x1 < h.x || bb.x0 > h.x + h.w || bb.y1 < h.y || bb.y0 > h.y + h.h) continue;
        if (polyVsBox(hw, { ...h })) return done('hazard');
      }
    }
    // stairs: the flight carries on in the room above / below (the caller takes it from there)
    for (const o of room.objects) {
      if ((o.def.t !== 'stairsUp' && o.def.t !== 'stairsDown') || !o.trigger) continue;
      const tr = o.trigger();
      if (tr && polyVsBox(planeHull(st), { ...tr })) return done(o.def.t);
    }
    if (pos.x < -2) return done('left');
    if (pos.x > ROOM_W + 2) return done('right');
    if (pos.y < -2) return done('up');
    if (pos.y > ROOM_H + 2) return done('down');
    if (t > maxT) return done('timeout');
  }
}
