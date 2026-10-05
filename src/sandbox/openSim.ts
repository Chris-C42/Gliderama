/**
 * Open-air simulator for the Test Hangar: the game's own `flightTick` in a long, tall room with no
 * walls, where the only fixed collider is the floor.
 *
 * Frames. The hangar uses metres with y UP and the floor at y = 0. The flight model already works
 * in exactly that frame (plane.x / plane.y are metres, y up, measured from the bottom edge of a room
 * `ROOM_H` pixels tall), so the plane needs no conversion at all: hangar (x, y) is plane (x, y).
 * Only the colliders live in pixels (y down), where hangar y = 0 is pixel row `ROOM_H`:
 *
 *     px = x * PX_PER_M          py = ROOM_H - y * PX_PER_M
 *
 * The floor is a huge box whose top face is at py = ROOM_H and which extends below it; it is
 * re-centred under the plane every tick so the hangar is unbounded in x. There is no ceiling: the
 * plane's y can be anything (py just goes negative).
 *
 * Time. `t` values are REAL seconds (the game clock, 120 ticks per second). The physics runs at
 * `PHYS.timeScale` of that, so sim seconds = real seconds x timeScale. Speeds, sink rates and
 * every other physical quantity are in sim (SI) units unless a name says otherwise.
 *
 * Use `simulateOpen` to run a whole flight at once (auto tests, sweeps), or `OpenSim` to step one
 * live, a tick at a time, with real input.
 */

import { createRng } from '../core/rng';
import { bounds, polyVsBox, profileHull } from '../game/collide';
import { flightTick, planeHull, type TickState } from '../game/flightTick';
import { coeffs, type AeroModel } from '../paper/aero';
import type { PlaneMesh } from '../paper/build';
import { PHYS, PX_PER_M, ROOM_H } from '../physics/config';
import { damagePct, ignite } from '../physics/damage';
import { createPlane, launch, type FlightInput, type Plane, type WindFn } from '../physics/flight';
import type { Collider } from '../world/types';
import { evaluateRoom, flameBoxes, solidBoxes, windFn, type BoxM, type RoomScore, type TestRoom } from './testRoom';

/** Real seconds per game tick. */
export const TICK_DT = 1 / 120;

/** Pixel row of the hangar floor (hangar y = 0). */
export const FLOOR_PX = ROOM_H;

/** The floor box is this many pixels wide either side of the plane, and this deep. */
const FLOOR_HALF = 20000;
const FLOOR_DEPTH = 20000;
/** The hull counts as touching the floor within this many pixels. */
const TOUCH_PX = 0.75;

/** Metres (y up) to a pixel-frame collider box. */
export function boxToPx(b: BoxM): Collider {
  return { x: b.x * PX_PER_M, y: ROOM_H - (b.y + b.h) * PX_PER_M, w: b.w * PX_PER_M, h: b.h * PX_PER_M };
}

export type OpenStart =
  /** Thrown from (x, y) metres: `angle` in radians (0 = right, +up), `power` 0..1. */
  | { x: number; y: number; angle: number; power: number }
  /** Released from (x, y) metres with a given velocity (m/s) and pitch (rad). */
  | { x: number; y: number; vx: number; vy: number; theta: number; facing?: 1 | -1 };

export type OpenOutcome = 'grounded' | 'crashed' | 'timeout';

export interface OpenSimOptions {
  /** Longest flight to simulate, real seconds (default 60); the flight then ends as a 'timeout'. */
  maxT?: number;
  /** Record a path sample every N ticks (default 3, i.e. 40 per real second). */
  every?: number;
  /** User-built obstacles, air movers, candles and ambient wind. */
  room?: TestRoom | null;
  /** The auto-trim assist. */
  autoTrim?: boolean;
  /** The slow-mo assist (physics slowed by PHYS.slowMoAssist). */
  slowMo?: boolean;
  /** Random source for which wing a bump hits (default: a fixed seed, so runs repeat exactly). */
  rand?: () => number;
}

/** One recorded sample of a flight. */
export interface PathPoint {
  /** Real seconds since launch. */
  t: number;
  /** Position of the plane's centre of gravity, metres. */
  x: number;
  y: number;
  /** Pitch of the nose relative to the horizontal in the direction it faces (rad). */
  theta: number;
  /** Which way the plane faces. */
  facing: 1 | -1;
  /** Airspeed (m/s), angle of attack (rad), lift and drag coefficients, stall fraction 0..1. */
  V: number;
  alpha: number;
  CL: number;
  CD: number;
  stall: number;
  /** Ground velocity (m/s, sim). */
  vx: number;
  vy: number;
}

export interface OpenSimResult {
  outcome: OpenOutcome;
  /** Total flight length, real seconds, and the same in sim seconds. */
  t: number;
  simT: number;
  path: PathPoint[];

  /** Horizontal distance from the launch to the first touchdown (or to the end, if it never touched the floor), metres. */
  distance: number;
  /** Real seconds from launch to that touchdown, and the sim-seconds equivalent. */
  timeAloft: number;
  timeAloftSim: number;
  /** Highest point reached (the plane's CG), metres above the floor. */
  maxHeight: number;
  /** Mean sink rate to touchdown (m/s of sim time; negative if it ended higher than it started). */
  avgSink: number;
  /** Times the wing stalled (airborne, counted on the way into the stall). */
  stallEvents: number;
  /** Best instantaneous lift-to-drag ratio seen in flight. */
  bestLD: number;
  /** Damage when the flight ended, 0..100 per cent. */
  finalDamage: number;
  /** Ground speed at launch, and just before first touchdown (m/s, sim). */
  launchSpeed: number;
  touchdownSpeed: number;

  /** Where it ended up, and where it first touched down. */
  finalX: number;
  finalY: number;
  touchdownX: number;
  touchdownY: number;
  /** The floor was touched at all (false: it landed on a platform, or timed out airborne). */
  touchedFloor: boolean;
  /** Targets and hoops scored in the test room (null when the flight had no room). */
  roomScore: RoomScore | null;
  /** The plane in its final state. */
  plane: Plane;
}

const HANDS_OFF: FlightInput = { dir: 0, pitch: 0, boost: false };

/**
 * A running open-air flight. Step it with `step()` (120 times per real second for live play) and read
 * `plane` for the pose and HUD numbers; `simulateOpen` just steps one to the end.
 */
export class OpenSim {
  readonly plane: Plane;
  readonly aero: AeroModel;
  readonly st: TickState;
  /** Ticks stepped so far. */
  ticks = 0;
  /** null while the flight is on, then the reason it ended. */
  outcome: OpenOutcome | null = null;

  /** Launch position, metres. */
  readonly x0: number;
  readonly y0: number;

  // running summary
  maxHeight: number;
  stallEvents = 0;
  bestLD = 0;
  touchedFloor = false;
  touchdownTick = -1;
  touchdownX = 0;
  touchdownY = 0;
  /** Ground speed just before first touching the floor (m/s). */
  touchdownSpeed = 0;
  /** Ground speed at launch (m/s). */
  readonly launchSpeed: number;

  private stalled = false;
  private lastSpeed = 0;
  private readonly wind: WindFn;
  private readonly floor: Collider;
  private readonly colliders: Collider[];
  private readonly flames: Collider[];
  private readonly room: TestRoom | null;
  private readonly rand: () => number;
  private readonly slowMo: boolean;
  private readonly timeScale: number;
  private readonly maxTicks: number;

  constructor(aero: AeroModel, mesh: PlaneMesh, start: OpenStart, opts: OpenSimOptions = {}) {
    this.aero = aero;
    const plane = createPlane(aero, { autoTrim: opts.autoTrim });
    if ('power' in start) {
      launch(plane, 0, ROOM_H, start.angle, start.power);
    } else {
      plane.vx = start.vx;
      plane.vy = start.vy;
      plane.facing = start.facing ?? (start.vx >= 0 ? 1 : -1);
      plane.theta = start.theta;
    }
    plane.x = start.x;
    plane.y = Math.max(0, start.y); // a plane released below the floor would be buried in it
    this.plane = plane;
    this.x0 = plane.x;
    this.y0 = plane.y;
    this.maxHeight = plane.y;
    this.launchSpeed = Math.hypot(plane.vx, plane.vy);
    this.lastSpeed = this.launchSpeed;

    this.slowMo = !!opts.slowMo;
    this.timeScale = PHYS.timeScale * (this.slowMo ? PHYS.slowMoAssist : 1);
    this.maxTicks = Math.round((opts.maxT ?? 60) / TICK_DT);
    this.rand = opts.rand ?? seededRand();
    const room = opts.room ?? null;
    this.room = room;
    this.wind = room ? windFn(room) : () => ({ x: 0, y: 0 });
    this.floor = { x: plane.x * PX_PER_M - FLOOR_HALF, y: FLOOR_PX, w: 2 * FLOOR_HALF, h: FLOOR_DEPTH, kind: 'solid' };
    this.colliders = [this.floor];
    this.flames = [];
    if (room) {
      for (const b of solidBoxes(room)) this.colliders.push({ ...boxToPx(b), kind: 'solid' });
      for (const b of flameBoxes(room)) this.flames.push(boxToPx(b));
    }
    this.st = {
      plane,
      aero,
      hullLocal: profileHull(mesh),
      halfLen: ((mesh.max.x - mesh.min.x) * PX_PER_M) / 2,
      groundT: 0,
      stillT: 0,
    };
    // Diagnostics for the very first sample (the model fills them in on the first tick).
    plane.V = Math.max(1e-3, Math.hypot(plane.vx, plane.vy));
    plane.alpha = 0;
    const c = coeffs(aero, 0, plane.ctrl, 0, plane.mods);
    plane.CL = c.CL;
    plane.CD = c.CD;
    plane.stall = c.stall;
  }

  /** Real seconds flown. */
  get t(): number {
    return this.ticks * TICK_DT;
  }

  /** Sim seconds flown. */
  get simT(): number {
    return this.t * this.timeScale;
  }

  /** The plane's current state as a path sample. */
  sample(): PathPoint {
    const p = this.plane;
    return {
      t: this.t,
      x: p.x,
      y: p.y,
      theta: p.theta,
      facing: p.facing,
      V: p.V,
      alpha: p.alpha,
      CL: p.CL,
      CD: p.CD,
      stall: p.stall,
      vx: p.vx,
      vy: p.vy,
    };
  }

  /** Advance one game tick (1/120 s real). Returns the outcome once the flight is over. */
  step(input: FlightInput = HANDS_OFF): OpenOutcome | null {
    if (this.outcome) return this.outcome;
    const p = this.plane;
    this.floor.x = p.x * PX_PER_M - FLOOR_HALF;
    const r = flightTick(this.st, input, this.wind, this.colliders, TICK_DT, { slowMo: this.slowMo, rand: this.rand });
    this.ticks++;

    const hull = planeHull(this.st);
    const bb = bounds(hull);
    const onFloor = bb.y1 >= FLOOR_PX - TOUCH_PX;
    if (onFloor && !this.touchedFloor) {
      this.touchedFloor = true;
      this.touchdownTick = this.ticks;
      this.touchdownX = p.x;
      this.touchdownY = p.y;
      this.touchdownSpeed = this.lastSpeed;
    }
    if (!this.touchedFloor) {
      this.lastSpeed = Math.hypot(p.vx, p.vy);
      // Airborne statistics.
      if (p.y > this.maxHeight) this.maxHeight = p.y;
      if (p.CD > 1e-4 && p.CL > 0) this.bestLD = Math.max(this.bestLD, p.CL / p.CD);
      if (!this.stalled && p.stall > 0.5) {
        this.stalled = true;
        this.stallEvents++;
      } else if (this.stalled && p.stall < 0.2) this.stalled = false;
    }

    // Candle flames set paper alight.
    for (const f of this.flames) {
      if (bb.x1 < f.x || bb.x0 > f.x + f.w || bb.y1 < f.y || bb.y0 > f.y + f.h) continue;
      if (polyVsBox(hull, f)) ignite(p.damage, this.aero);
    }

    if (r === 'crashed') this.outcome = 'crashed';
    else if (r === 'grounded') this.outcome = 'grounded';
    else if (this.ticks >= this.maxTicks) this.outcome = 'timeout';
    return this.outcome;
  }

  /** Summary of the flight so far, as `simulateOpen` returns it. */
  result(path: PathPoint[], outcome: OpenOutcome): OpenSimResult {
    const p = this.plane;
    const touchTicks = this.touchedFloor ? this.touchdownTick : this.ticks;
    const timeAloft = touchTicks * TICK_DT;
    const timeAloftSim = timeAloft * this.timeScale;
    const tdX = this.touchedFloor ? this.touchdownX : p.x;
    const tdY = this.touchedFloor ? this.touchdownY : p.y;
    return {
      outcome,
      t: this.t,
      simT: this.simT,
      path,
      distance: Math.abs(tdX - this.x0),
      timeAloft,
      timeAloftSim,
      maxHeight: this.maxHeight,
      avgSink: timeAloftSim > 0 ? (this.y0 - tdY) / timeAloftSim : 0,
      stallEvents: this.stallEvents,
      bestLD: this.bestLD,
      finalDamage: damagePct(p.damage),
      launchSpeed: this.launchSpeed,
      touchdownSpeed: this.touchedFloor ? this.touchdownSpeed : this.lastSpeed,
      finalX: p.x,
      finalY: p.y,
      touchdownX: tdX,
      touchdownY: tdY,
      touchedFloor: this.touchedFloor,
      roomScore: this.room ? evaluateRoom(path, this.room, { rested: outcome !== 'timeout' }) : null,
      plane: p,
    };
  }
}

function seededRand(): () => number {
  const rng = createRng(0x9e3779b1);
  return () => rng.next();
}

/**
 * Fly a design through the open hangar until it lands, is destroyed or times out. Hands-off unless a
 * `control` function steers it (`t` is real seconds since launch).
 */
export function simulateOpen(
  aero: AeroModel,
  mesh: PlaneMesh,
  start: OpenStart,
  control?: (p: Plane, t: number) => FlightInput,
  opts: OpenSimOptions = {},
): OpenSimResult {
  const sim = new OpenSim(aero, mesh, start, opts);
  const every = Math.max(1, Math.floor(opts.every ?? 3));
  const path: PathPoint[] = [sim.sample()];
  let outcome: OpenOutcome | null = null;
  while (outcome === null) {
    outcome = sim.step(control ? control(sim.plane, sim.t) : HANDS_OFF);
    // Always keep the final tick so the path ends where the plane did.
    if (sim.ticks % every === 0 || outcome !== null) path.push(sim.sample());
  }
  return sim.result(path, outcome);
}
