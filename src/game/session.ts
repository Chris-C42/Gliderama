/**
 * A flight session through one level: throw → fly → (crash / ground / workbench / exit).
 * Owns the physics plane, the current room's runtime state and drives the renderer.
 */

import * as THREE from 'three';
import type { Design } from '../paper/design';
import { analyzeDesign, type AeroModel } from '../paper/aero';
import { buildMesh, type PlaneBuild, type PlaneMesh } from '../paper/build';
import { PHYS, PX_PER_M, ROOM_H, ROOM_W } from '../physics/config';
import { createPlane, launch, planePx, stepPlane, idealThrowPower, type Plane } from '../physics/flight';
import { flightTick, planeHull, type TickState } from './flightTick';
import { crumple, damagePct, ignite, repair, soakUp, structural, type PartName } from '../physics/damage';
import type { ControlState, ThrowState } from '../core/types';
import { paintRoom, type RoomArt } from '../render/roomArt';
import type { ActiveLight, GameRenderer, SpriteHandle } from '../render/GameRenderer';
import { rgb } from '../render/particles';
import { Px } from '../render/pixel';
import { R } from '../render/palette';
import { Slingshot, pulledBack } from '../render/slingshot';
import { HeliumBalloon } from '../render/balloon';
import { OBJECTS, stillHazards } from './objects';
import { TRANSPORT_REST } from './objects/classic';
import type { AirFlow, GameObject, ObjCtx, SessionApi, WindOut } from './objects/types';
import { bounds, polyVsBox, profileHull, surfaceBelow, type V } from './collide';
import { countStars, entryCheckpoint, goalStarIds, neighbour, type LevelDef } from './level';
import { HoverPilot } from './hover';
import { stairsArrival } from '../world/stairs';
import { clipFlows, spillFlows, spillsFor, spillWind, updateSpills, type Spill } from './roomAir';
import type { Collider, ItemDef, RoomDef } from '../world/types';

export type Phase = 'aim' | 'fly' | 'down' | 'workbench' | 'complete' | 'failed';

export interface SessionOptions {
  autoTrim: boolean;
  slowMo: boolean;
  /** Multiplier on vent / fan strength (roguelike perks). */
  airMul?: number;
  /** Extra sheets on top of the level's. */
  bonusSheets?: number;
  /** Charges for gadgets at the start. */
  charges?: Partial<Charges>;
  /** Stars already collected (e.g. resuming). */
  collected?: string[];
  /** Never run out of sheets (sandbox). */
  infiniteSheets?: boolean;
  /** Record the flight path (for ghosts / reports). */
  record?: boolean;
  /** Every throw starts from the level start: rooms passed are not checkpoints (challenges). */
  fixedStart?: boolean;
  /** The hover assist may be switched on (it circles the plane in rising air). */
  hover?: boolean;
  /** The climb assist: steadier in rising air (see `climbAssist` in physics/flight). */
  climbAssist?: boolean;
  /** Random source for collision damage (which wing takes a knock); a fixed one makes flights replayable. */
  rand?: () => number;
  /** Switch groups as they are at the start (a lab starting part way through a house): group → on. */
  switches?: [string, boolean][];
}

export interface FlightStats {
  reason: 'grounded' | 'crashed' | 'target';
  /** Horizontal distance from the launch point (m), across rooms. */
  distance: number;
  /** Real seconds in the air. */
  timeAloft: number;
  /** Highest point above the floor (m). */
  maxHeight: number;
  /** Height lost from launch to landing (m). */
  heightLost: number;
  /** Global path samples (room grid aware): x = gx*640 + px, y = gy*360 + py. */
  path: { x: number; y: number }[];
  damage: number;
  landedRoom: string;
  landedX: number;
  targetId: string | null;
}

export interface Charges {
  boost: number;
  bands: number;
  helium: number;
  /**
   * Helium gas from the Classic Houses' canisters (sim s of rising, see PHYS.gasRise). While there is some, the
   * gadget button is the helium's, whatever the design's own gadget: held, it lifts the plane (as in Glider PRO,
   * where helium takes the battery's place). It is kept from sheet to sheet until it is used.
   */
  gas: number;
}

export interface HudState {
  phase: Phase;
  sheets: number;
  stars: number;
  starsTotal: number;
  time: number;
  damage: number;
  burning: boolean;
  soak: number;
  charges: Charges;
  gadget: Design['extras']['gadget'];
  roomName: string;
  lightsOn: boolean;
  message: string | null;
  speed: number;
  alpha: number;
  ld: number;
  stall: number;
  power: number;
  idealPower: number;
  infiniteSheets: boolean;
  /** The hover assist is circling the plane. */
  hovering: boolean;
  /** Mode goal progress shown in the HUD (set by the play screen), e.g. "Hoops 1/3". */
  goal?: string;
}

/** What the ambient mixer needs each frame (all 0..1 except speed). */
export interface Ambience {
  flying: boolean;
  /** Airspeed in m/s while flying, else 0. */
  speed: number;
  vent: number;
  fan: number;
  fire: number;
}

export interface LevelResult {
  levelId: string;
  time: number;
  stars: number;
  starsTotal: number;
  damage: number;
  sheetsUsed: number;
  crashes: number;
  roomsVisited: number;
  /** Per-room outcome in visit order (for the daily share card). */
  roomLog: ('clear' | 'damaged' | 'crash')[];
  /** Throws made. */
  flights: number;
  /** Best single flight (m, real s). */
  best: { distance: number; timeAloft: number };
}

export interface SessionCallbacks {
  hud?(h: HudState): void;
  complete?(r: LevelResult): void;
  failed?(r: LevelResult): void;
  workbench?(): void;
  room?(key: string, def: RoomDef): void;
  sfx?(name: string, opts?: { vol?: number; pitch?: number }): void;
  /** A flight ended (landing / crash / target), with stats. */
  flightEnded?(stats: FlightStats): void;
  /** A goal object fired (hoop passed, target hit...). */
  goal?(kind: string, id: string): void;
}

const DEG = Math.PI / 180;

class RoomRuntime {
  objects: GameObject[] = [];
  /** Air from the rooms above and below that comes through the floor and ceiling openings. */
  readonly spills: Spill[];
  lightsOn: boolean;
  constructor(
    readonly key: string,
    readonly def: RoomDef,
    readonly art: RoomArt,
    renderer: GameRenderer,
    readonly switches: Map<string, boolean>,
    level: LevelDef,
  ) {
    this.spills = spillsFor(level, key);
    this.lightsOn = !def.dark;
    let i = 0;
    for (const it of def.items) {
      const f = OBJECTS[it.t];
      if (!f) continue;
      const id = typeof it.id === 'string' ? it.id : `${key}:${it.t}:${i++}`;
      this.objects.push(f(it, id, renderer, { dark: !!def.dark, night: !!def.night }));
    }
  }

  colliders(): Collider[] {
    const out = this.art.colliders.slice();
    for (const o of this.objects) if (o.colliders) out.push(...o.colliders());
    return out;
  }

  airflows(): AirFlow[] {
    return clipFlows(this.objects.flatMap((o) => o.airflow?.() ?? [])).concat(spillFlows(this.spills));
  }

  lights(): ActiveLight[] {
    const out: ActiveLight[] = [];
    for (const l of this.art.lights) {
      if (l.switched && !this.lightsOn) continue;
      out.push({ x: l.x, y: l.y, r: l.r, color: new THREE.Color(l.color), intensity: l.intensity });
    }
    for (const o of this.objects) if (o.lights) out.push(...o.lights());
    return out;
  }

  ambient(): THREE.Color {
    const night = !!this.def.night;
    if (!this.lightsOn) return night ? new THREE.Color(0.1, 0.11, 0.2) : new THREE.Color(0.2, 0.21, 0.3);
    return night ? new THREE.Color(0.5, 0.47, 0.46) : new THREE.Color(0.74, 0.73, 0.74);
  }

  dispose(): void {
    for (const o of this.objects) o.dispose?.();
    for (const sp of this.spills) for (const o of sp.objects) o.dispose?.();
    this.objects = [];
  }
}

export class Session {
  phase: Phase = 'aim';
  plane!: Plane;
  aero!: AeroModel;
  build!: PlaneBuild;
  mesh!: PlaneMesh;
  hullLocal: V[] = [];
  tick!: TickState;
  room!: RoomRuntime;
  sheets: number;
  time = 0;
  collected = new Set<string>();
  starsTotal: number;
  /** Stars that finish a `goal: 'stars'` level. */
  readonly goalStars: Set<string>;
  charges: Charges;
  crashes = 0;
  sheetsUsed = 0;
  flights = 0;
  best = { distance: 0, timeAloft: 0 };
  roomLog: ('clear' | 'damaged' | 'crash')[] = [];
  roomsVisited = new Set<string>();
  checkpoint: { room: string; x: number; y: number; facing: 1 | -1 };
  aim = { angle: 0.15, power: 0.5 };
  message: string | null = null;
  private artCache = new Map<string, RoomArt>();
  private switches = new Map<string, boolean>();
  private downT = 0;
  private flash = 0;
  private shakeAmt = 0;
  private hudT = 0;
  private realTime = 0;
  private roomDamage0 = 0;
  private triggeredThisTick = new Set<string>();
  private flight = { x0: 0, y0: 0, t0: 0, maxH: 0, path: [] as { x: number; y: number }[], k: 0 };
  /** The hover assist, while it is circling the plane. */
  private hover: HoverPilot | null = null;
  /** When the plane last came out of a transport (it may come out inside another one's mouth). */
  private transportedAt = -Infinity;
  /** Caught in a cobweb: seconds left, and where. */
  private snagT = 0;
  private snagAt = { x: 0, y: 0 };
  /** Rubber bands in flight (room px, px/s). */
  private bands: { x: number; y: number; vx: number; vy: number; t: number; s: SpriteHandle }[] = [];
  /** The slingshot drawn at the launch point while aiming, and what the throw input was doing this frame. */
  private sling: Slingshot;
  private balloon: HeliumBalloon;
  /** Real s until the helium's next hiss while it is held. */
  private hissT = 0;
  private pulling = { aiming: false, power: 0, dt: 0 };

  constructor(
    readonly renderer: GameRenderer,
    readonly level: LevelDef,
    public design: Design,
    readonly opts: SessionOptions,
    readonly cb: SessionCallbacks = {},
  ) {
    this.sling = new Slingshot(renderer);
    this.balloon = new HeliumBalloon(renderer);
    this.sheets = level.sheets + (opts.bonusSheets ?? 0);
    this.starsTotal = countStars(level);
    this.goalStars = new Set(level.goal === 'stars' ? goalStarIds(level) : []);
    this.charges = { boost: 0, bands: 0, helium: 0, gas: 0, ...opts.charges };
    for (const id of opts.collected ?? []) this.collected.add(id);
    for (const [g, on] of opts.switches ?? []) this.switches.set(g, on);
    this.checkpoint = { ...level.start };
    this.setDesign(design, true);
    this.enterRoom(level.start.room);
    this.beginAim();
    if (level.intro) this.message = level.intro;
  }

  // ------------------------------------------------------------------------------------------
  // Design / plane

  setDesign(design: Design, fresh: boolean): void {
    this.design = design;
    const { build, aero } = analyzeDesign(design);
    this.build = build;
    this.aero = aero;
    this.mesh = buildMesh(build, aero.cg);
    this.hullLocal = profileHull(this.mesh);
    const damage = !fresh && this.plane ? this.plane.damage : undefined;
    this.plane = createPlane(aero, { autoTrim: this.opts.autoTrim });
    if (damage) this.plane.damage = damage;
    this.tick = { plane: this.plane, aero, hullLocal: this.hullLocal, halfLen: ((this.mesh.max.x - this.mesh.min.x) * PX_PER_M) / 2, groundT: 0, stillT: 0 };
    this.renderer.plane.setMesh(this.mesh, design.look, { width: build.width, length: build.length });
    if (design.extras.gadget === 'battery') this.charges.boost = Math.max(this.charges.boost, 2);
    if (design.extras.gadget === 'helium') this.charges.helium = Math.max(this.charges.helium, 1);
    if (design.extras.gadget === 'bands') this.charges.bands = Math.max(this.charges.bands, 3);
  }

  // ------------------------------------------------------------------------------------------
  // Rooms

  private artFor(key: string): RoomArt {
    let a = this.artCache.get(key);
    if (!a) {
      a = paintRoom(this.level.rooms[key]);
      this.artCache.set(key, a);
    }
    return a;
  }

  private enterRoom(key: string): void {
    this.clearBands();
    this.snagT = 0;
    if (this.room) {
      this.room.dispose();
      this.renderer.clearSprites();
      this.sling.reset();
      this.balloon.reset();
      this.logRoom();
    }
    const def = this.level.rooms[key];
    const art = this.artFor(key);
    this.renderer.setRoom(art);
    this.renderer.particles.clear();
    this.room = new RoomRuntime(key, def, art, this.renderer, this.switches, this.level);
    this.renderer.setAir(this.room.airflows());
    if (this.switches.get(`lights:${key}`) !== undefined) this.room.lightsOn = this.switches.get(`lights:${key}`)!;
    this.roomsVisited.add(key);
    this.roomDamage0 = this.plane ? structural(this.plane.damage) : 0;
    if (def.dark && !this.room.lightsOn) this.message = 'Too dark to see! Find the light switch.';
    this.cb.room?.(key, def);
  }

  private logRoom(): void {
    const d = structural(this.plane.damage) - this.roomDamage0;
    this.roomLog.push(d > 0.05 ? 'damaged' : 'clear');
  }

  // ------------------------------------------------------------------------------------------
  // API for objects

  private api: SessionApi = {
    collectStar: (id) => {
      this.collected.add(id);
      // the Glider PRO rule: the house is finished when its last star is collected
      if (this.goalStars.has(id) && [...this.goalStars].every((g) => this.collected.has(g))) {
        this.message = this.level.goal === 'stars' && this.goalStars.size > 1 ? 'All the stars! House complete.' : 'You found the star! House complete.';
        this.complete();
      } else if (this.goalStars.has(id)) this.message = `Star found! ${this.goalLeft()} to go.`;
    },
    addSheet: () => {
      this.sheets++;
      this.message = '+1 spare sheet';
    },
    repair: (a) => {
      repair(this.plane.damage, a);
      this.message = 'Patched up with tape';
    },
    addCharge: (k, n) => {
      this.charges[k] += n;
    },
    toggleLights: (room) => {
      // a switch may work the lights of another room (Glider PRO links switches to lights anywhere in the house)
      if (room && room !== this.room.key && this.level.rooms[room]) {
        this.switches.set(`lights:${room}`, !this.lightsOnIn(room));
        return;
      }
      this.room.lightsOn = !this.room.lightsOn;
      this.switches.set(`lights:${this.room.key}`, this.room.lightsOn);
      this.message = null;
    },
    setSwitch: (g, on) => {
      this.switches.set(g, on);
    },
    switchOn: (g) => this.switches.get(g) ?? true,
    soak: (a) => soakUp(this.plane.damage, a, this.aero),
    ignite: () => {
      if (ignite(this.plane.damage, this.aero)) this.sfx('burn');
    },
    burnDamage: (a) => {
      this.plane.damage.scorch = Math.min(1, this.plane.damage.scorch + a);
    },
    tear: (a) => {
      this.plane.damage.body = Math.min(1, this.plane.damage.body + a);
    },
    strike: (amount, from) => {
      if (this.phase !== 'fly') return;
      const p = this.plane;
      const q = planePx(p);
      // the part facing whatever hit it takes the blow
      const ahead = (from.x - q.x) * p.facing;
      const part: PartName = ahead > 12 ? 'nose' : ahead < -16 ? 'tail' : Math.random() < 0.5 ? 'wingL' : 'wingR';
      crumple(p.damage, part, amount);
      // knocked away from it, but still flying the way it was
      const dx = q.x - from.x;
      const dy = q.y - from.y;
      const n = Math.hypot(dx, dy) || 1;
      p.vx += (dx / n) * 1.4;
      p.vy -= (dy / n) * 1.4;
      if (p.vx * p.facing < 0.3) p.vx = p.facing * 0.3;
      p.turn = null;
      this.hover = null;
      this.flash = Math.min(1, amount * 2);
      this.shakeAmt = Math.max(this.shakeAmt, Math.min(1, amount * 1.6));
      this.sfx('crumple', { vol: 0.7 });
    },
    snag: (x, y) => {
      if (this.phase !== 'fly' || this.snagT > 0) return;
      this.snagT = 1.1;
      this.snagAt = { x, y };
      this.hover = null;
      this.plane.turn = null;
      this.sfx('twang');
    },
    completeLevel: () => this.complete(),
    openWorkbench: () => {
      if (this.phase !== 'fly') return;
      this.phase = 'workbench';
      const p = planePx(this.plane);
      this.checkpoint = { room: this.room.key, x: p.x, y: p.y - 12, facing: this.plane.facing };
      this.cb.workbench?.();
    },
    takeStairs: (way) => {
      if (this.phase !== 'fly') return;
      const next = neighbour(this.level, this.room.key, way);
      if (!next) return;
      const arrive = stairsArrival(this.level.rooms[next].items, way);
      this.arriveAt(next, arrive.x, arrive.y, arrive.facing);
      this.sfx(way === 'up' ? 'stairsUp' : 'stairsDown');
    },
    transport: (toRoom, x, y, facing) => {
      if (this.phase !== 'fly' || !this.level.rooms[toRoom]) return;
      // just out of one: not straight back into the next (linked transports often face each other)
      if (this.time - this.transportedAt < TRANSPORT_REST) return;
      this.transportedAt = this.time;
      this.arriveAt(toRoom, x, y, facing);
      this.sfx('stairsUp', { pitch: 4 });
    },
    teleport: (toRoom, x, y, facing) => {
      if (toRoom !== this.room.key) this.enterRoom(toRoom);
      this.plane.x = x / PX_PER_M;
      this.plane.y = (ROOM_H - y) / PX_PER_M;
      if (facing) this.plane.facing = facing;
    },
    sfx: (n, o) => this.sfx(n, o),
    shake: (a) => {
      this.shakeAmt = Math.max(this.shakeAmt, a);
    },
    plane: () => {
      const p = planePx(this.plane);
      return { x: p.x, y: p.y, vx: this.plane.vx, vy: this.plane.vy, alive: this.phase === 'fly' };
    },
    isCollected: (id) => this.collected.has(id),
    lightsOn: (room) => (room && room !== this.room.key ? this.lightsOnIn(room) : this.room.lightsOn),
    goal: (kind: string, id: string) => {
      this.cb.goal?.(kind, id);
    },
  };

  /** Come out somewhere else (stairs, transports): a reset, Glider style, gliding level at a comfortable speed. */
  private arriveAt(room: string, x: number, y: number, facing: 1 | -1): void {
    if (room !== this.room.key) this.enterRoom(room);
    this.hover = null;
    const p = this.plane;
    p.x = x / PX_PER_M;
    p.y = (ROOM_H - y) / PX_PER_M;
    p.facing = facing;
    p.turn = null;
    p.theta = 0;
    p.q = 0;
    p.vx = facing * this.aero.perf.vBest;
    p.vy = 0;
    p.liftT = 0;
    p.exitPending = false;
    p.exitBoost = 0;
    if (!this.opts.fixedStart) this.checkpoint = { room, x, y, facing };
  }

  /** Whether a room's lights are on (switched, or as it starts). */
  private lightsOnIn(room: string): boolean {
    return this.switches.get(`lights:${room}`) ?? !this.level.rooms[room]?.dark;
  }

  /** Goal stars still to find. */
  private goalLeft(): number {
    let n = 0;
    for (const g of this.goalStars) if (!this.collected.has(g)) n++;
    return n;
  }

  private sfx(name: string, opts?: { vol?: number; pitch?: number }): void {
    this.cb.sfx?.(name, opts);
  }

  // ------------------------------------------------------------------------------------------
  // Wind

  private windOut: WindOut = { x: 0, y: 0 };
  windAt = (xm: number, ym: number): { x: number; y: number } => {
    const out = this.windOut;
    out.x = 0;
    out.y = 0;
    const x = xm * PX_PER_M;
    const y = ROOM_H - ym * PX_PER_M;
    for (const o of this.room.objects) o.wind?.(x, y, out);
    spillWind(this.room.spills, x, y, out);
    const m = this.opts.airMul ?? 1;
    return { x: out.x * m, y: out.y * m };
  };

  // ------------------------------------------------------------------------------------------
  // Phases

  beginAim(): void {
    this.phase = 'aim';
    if (this.checkpoint.room !== this.room.key) this.enterRoom(this.checkpoint.room);
    const facing = this.checkpoint.facing;
    this.aim.angle = facing > 0 ? 8 * DEG : Math.PI - 8 * DEG;
    this.aim.power = idealThrowPower(this.aero);
  }

  /** Called by the UI after the workbench screen closes. */
  resumeFromWorkbench(design: Design | null, repaired: boolean): void {
    if (design) this.setDesign(design, false);
    if (repaired) repair(this.plane.damage, 1);
    this.beginAim();
  }

  throwNow(angle: number, power: number): void {
    if (this.phase !== 'aim') return;
    const cp = this.checkpoint;
    this.sling.release();
    launch(this.plane, cp.x, cp.y, angle, power);
    this.phase = 'fly';
    this.tick.groundT = 0;
    this.tick.stillT = 0;
    this.message = null;
    const g = this.globalPos(cp.x, cp.y);
    this.flight = { x0: g.x, y0: g.y, t0: this.time, maxH: 0, path: [g], k: 0 };
    this.flights++;
    this.sfx('throw', { vol: 0.5 + power * 0.5 });
  }

  /** End the level as a success (mode goals: targets, hoops, distance...). */
  finish(): void {
    this.complete();
  }

  /** Last flight's stats (for goal evaluation by modes). */
  lastFlight(): FlightStats {
    return this.flightStats('grounded', null);
  }

  private noteBest(st: FlightStats): void {
    this.best.distance = Math.max(this.best.distance, st.distance);
    this.best.timeAloft = Math.max(this.best.timeAloft, st.timeAloft);
  }

  private complete(): void {
    if (this.phase === 'complete') return;
    this.hover = null;
    this.snagT = 0;
    this.clearBands();
    if (this.phase === 'fly') this.noteBest(this.flightStats('grounded', null));
    this.logRoom();
    this.phase = 'complete';
    this.sfx('win');
    this.cb.complete?.(this.result());
  }

  result(): LevelResult {
    return {
      levelId: this.level.id,
      time: this.time,
      stars: [...this.collected].filter((id) => id.includes(':star:') || id.startsWith('star')).length,
      starsTotal: this.starsTotal,
      damage: damagePct(this.plane.damage),
      sheetsUsed: this.sheetsUsed,
      crashes: this.crashes,
      roomsVisited: this.roomsVisited.size,
      roomLog: this.roomLog,
      flights: this.flights,
      best: { ...this.best },
    };
  }

  private flightOver(reason: 'grounded' | 'crashed'): void {
    if (this.phase !== 'fly') return;
    this.hover = null;
    this.snagT = 0;
    this.clearBands();
    // landed in a target zone?
    let targetId: string | null = null;
    if (reason === 'grounded') {
      const q = planePx(this.plane);
      for (const o of this.room.objects) {
        if (o.def.t !== 'target') continue;
        const r = o.trigger?.();
        if (r && q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y - 30 && q.y <= r.y + r.h + 10) targetId = o.id;
      }
    }
    const stats = this.flightStats(targetId ? 'target' : reason, targetId);
    this.noteBest(stats);
    this.cb.flightEnded?.(stats);
    if (targetId) {
      this.cb.goal?.('target', targetId);
      this.sfx('win');
    }
    this.phase = 'down';
    this.downT = 0;
    // (a trigger the lost plane set off goes dead with it: the next sheet starts the room's clock afresh)
    for (const o of this.room.objects) o.planeLost?.();
    if (this.opts.infiniteSheets) {
      this.message = targetId ? 'Bullseye!' : reason === 'crashed' ? 'Crumpled!' : 'Landed.';
      return;
    }
    this.crashes++;
    this.sheetsUsed++;
    this.sheets--;
    this.roomLog.push('crash');
    this.roomDamage0 = 0;
    const p = planePx(this.plane);
    this.sfx(reason === 'crashed' ? 'crumple' : 'bump');
    const paper = rgb(this.design.look.color);
    for (let k = 0; k < (reason === 'crashed' ? 26 : 8); k++) {
      this.renderer.particles.spawn({
        x: p.x,
        y: p.y,
        vx: (Math.random() - 0.5) * 120,
        vy: -Math.random() * 100,
        grav: 260,
        life: 0.8,
        max: 0.8,
        size: Math.random() < 0.3 ? 2 : 1,
        ...paper,
        a: 1,
      });
    }
    this.message = reason === 'crashed' ? 'Crumpled!' : 'Landed.';
  }

  // ------------------------------------------------------------------------------------------
  // Update

  update(dt: number, input: ControlState, thr: ThrowState): void {
    this.realTime += dt;
    this.triggeredThisTick.clear();
    const ctx: ObjCtx = { dt, time: this.realTime, particles: this.renderer.particles, api: this.api };
    for (const o of this.room.objects) o.early?.(ctx);
    for (const o of this.room.objects) o.update?.(ctx);
    updateSpills(this.room.spills, ctx);

    this.pulling = { aiming: thr.aiming, power: thr.power, dt };
    if (this.phase === 'aim') {
      this.time += dt;
      if (thr.aiming || thr.released) {
        this.aim.angle = thr.angle;
        this.aim.power = thr.power;
      }
      if (thr.released) this.throwNow(thr.angle, thr.power);
    } else if (this.phase === 'fly') {
      this.time += dt;
      this.flyStep(dt, input, ctx);
    } else if (this.phase === 'down') {
      this.downT += dt;
      if (this.downT > 1.3) {
        if (this.sheets <= 0) {
          this.phase = 'failed';
          this.sfx('lose');
          this.cb.failed?.(this.result());
        } else {
          // a fresh sheet folded to the same design
          const keep = this.design;
          this.setDesign(keep, true);
          this.beginAim();
        }
      }
    }
    this.renderer.particles.update(dt);
    this.flash = Math.max(0, this.flash - dt * 4);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3);
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      this.cb.hud?.(this.hud());
    }
  }

  /** A rubber band shot forward from the nose. */
  private fireBand(): void {
    const p = this.plane;
    const q = planePx(p);
    const s = this.renderer.createSprite(8, 5, 0, 9);
    const px = new Px(s.canvas, 1);
    px.hline(1, 0, 6, R.peach[4]);
    px.hline(1, 4, 6, R.peach[2]);
    px.vline(0, 1, 3, R.peach[3]);
    px.vline(7, 1, 3, R.peach[3]);
    s.refresh();
    const nose = this.tick.halfLen * 0.9;
    this.bands.push({
      x: q.x + Math.cos(p.theta) * nose * p.facing,
      y: q.y - Math.sin(p.theta) * nose,
      vx: p.facing * 520 + p.vx * PX_PER_M * 0.5,
      vy: -p.vy * PX_PER_M * 0.3,
      t: 0,
      s,
    });
    this.sfx('twang', { pitch: 5, vol: 0.5 });
  }

  /** Rubber bands fly on, dropping a little, until they hit something (and knock it down if they can) or leave the room. */
  private flyBands(dt: number, ctx: ObjCtx): void {
    if (!this.bands.length) return;
    const cols = this.room.colliders();
    this.bands = this.bands.filter((b) => {
      b.t += dt;
      b.vy += 160 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let gone = b.t > 2.5 || b.x < -8 || b.x > ROOM_W + 8 || b.y < -8 || b.y > ROOM_H + 8;
      if (!gone)
        for (const o of this.room.objects)
          if (o.shot?.(b.x, b.y, ctx)) {
            gone = true;
            break;
          }
      if (!gone)
        for (const c of cols)
          if (b.x >= c.x && b.x <= c.x + c.w && b.y >= c.y && b.y <= c.y + c.h) {
            gone = true;
            this.sfx('bump', { vol: 0.15, pitch: 9 });
            for (let k = 0; k < 3; k++) ctx.particles.spawn({ x: b.x, y: b.y, vx: -Math.sign(b.vx) * 40 + (Math.random() - 0.5) * 40, vy: -30 - Math.random() * 30, grav: 300, life: 0.3, max: 0.3, ...rgb(R.peach[3]), a: 1 });
            break;
          }
      if (gone) {
        b.s.dispose();
        return false;
      }
      b.s.set(b.x - 4, b.y - 2);
      return true;
    });
  }

  private clearBands(): void {
    for (const b of this.bands) b.s.dispose();
    this.bands = [];
  }

  private flyStep(dt: number, input: ControlState, ctx: ObjCtx): void {
    const p = this.plane;
    // helium gas (from a Classic House's canister) has the gadget button while there is some: held, it lifts
    const gas = this.charges.gas > 0;
    const helium = gas && input.gadget;
    // gadgets
    const boost = !gas && input.gadget && this.design.extras.gadget === 'battery' && (this.charges.boost > 0 || p.boostLeft > 0);
    if (input.gadgetPressed && !gas) {
      if (this.design.extras.gadget === 'battery' && this.charges.boost > 0 && p.boostLeft <= 0) {
        this.charges.boost--;
        p.boostLeft = PHYS.boostTime;
        this.sfx('boost');
      } else if (this.design.extras.gadget === 'helium' && this.charges.helium > 0 && p.heliumLeft <= 0) {
        this.charges.helium--;
        p.heliumLeft = PHYS.heliumTime;
        this.sfx('pop', { pitch: 7 });
      } else if (this.design.extras.gadget === 'bands' && this.charges.bands > 0 && this.snagT <= 0) {
        this.charges.bands--;
        this.fireBand();
      }
    }
    this.flyBands(dt, ctx);
    // caught in a cobweb: held towards its middle, shivering, then let go to fall out of it
    if (this.snagT > 0) {
      this.snagT -= dt;
      const q = planePx(p);
      const k = 1 - Math.exp(-dt * 6);
      p.x += ((this.snagAt.x + (Math.random() - 0.5) * 2 - q.x) * k) / PX_PER_M;
      p.y -= ((this.snagAt.y - q.y) * k) / PX_PER_M;
      p.theta += (-0.35 - p.theta) * k;
      p.vx = 0;
      p.vy = 0;
      p.q = 0;
      if (this.snagT <= 0) p.vx = p.facing * 0.4;
      this.recordPath();
      return;
    }
    // hover: toggled by its button / key; any direction from the player takes over again
    if (input.hoverPressed && this.opts.hover) {
      this.hover = this.hover ? null : new HoverPilot(p, this.windAt);
      this.sfx(this.hover ? 'hoverOn' : 'hoverOff');
    }
    if (this.hover && input.dir !== 0) this.hover = null;
    const dir = this.hover ? this.hover.step(p, this.windAt, dt) : input.dir;
    p.gas = this.charges.gas;
    if (helium) {
      this.hissT -= dt;
      if (this.hissT <= 0) {
        this.sfx('hiss', { vol: 0.5 });
        this.hissT = 0.22;
      }
    } else this.hissT = 0;
    const outcome = flightTick(
      this.tick,
      { dir, pitch: input.pitch, boost, helium, assist: !!this.opts.climbAssist },
      this.windAt,
      this.room.colliders(),
      dt,
      { slowMo: this.opts.slowMo, rand: this.opts.rand },
      {
        impact: (_part, impact, added) => {
          if (added > 0.02) {
            this.flash = Math.min(1, added * 3);
            this.shakeAmt = Math.max(this.shakeAmt, Math.min(1, added * 4));
            this.sfx('bump', { vol: Math.min(1, 0.3 + added * 2) });
          } else if (impact > 0.4) this.sfx('bump', { vol: 0.2 });
        },
        water: () => this.sfx('splash'),
        fire: () => this.sfx('burn'),
        slide: () => {
          this.sfx('skid');
          if (Math.random() < 0.3) {
            const q = planePx(this.plane);
            this.renderer.particles.spawn({ x: q.x - this.plane.facing * 8, y: q.y + 4, vx: -this.plane.vx * 20, vy: -20 - Math.random() * 20, grav: 300, life: 0.35, max: 0.35, ...rgb(R.ink[2]), a: 1 });
          }
        },
      },
    );
    if (gas) {
      // (the helium running out under the player's finger: Glider PRO's fizzle)
      if (helium && p.gas <= 0) this.sfx('fizzle');
      this.charges.gas = p.gas;
    }

    // burning plane: fire particles
    if (p.damage.burning > 0) {
      const q = planePx(p);
      if (Math.random() < 0.7)
        this.renderer.particles.spawn({ x: q.x + (Math.random() - 0.5) * 16, y: q.y + (Math.random() - 0.5) * 6, vy: -40, life: 0.4, max: 0.4, ...rgb(Math.random() < 0.5 ? '#ffb040' : '#ff6020'), a: 1 });
    }
    if (outcome === 'crashed') {
      this.flightOver('crashed');
      return;
    }
    if (outcome === 'grounded') {
      // resting on a workbench is not a crash
      const q = planePx(p);
      for (const o of this.room.objects) {
        if (o.def.t !== 'workbench') continue;
        const r = o.trigger?.();
        if (r && q.x > r.x && q.x < r.x + r.w && q.y > r.y - 20 && q.y < r.y + r.h + 10) {
          this.api.openWorkbench(o.id);
          return;
        }
      }
      this.flightOver('grounded');
      return;
    }

    // triggers
    const pos = planePx(p);
    const hullW = planeHull(this.tick);
    const bb = bounds(hullW);
    const roomNow = this.room;
    for (const o of roomNow.objects) {
      const r = o.trigger?.();
      if (!r) continue;
      if (bb.x1 < r.x || bb.x0 > r.x + r.w || bb.y1 < r.y || bb.y0 > r.y + r.h) continue;
      if (!polyVsBox(hullW, { ...r })) continue;
      o.onTouch?.(ctx);
      // landed, crashed, or taken the stairs to another room
      if (this.phase !== 'fly' || this.room !== roomNow) return;
    }

    if (structural(p.damage) >= 1) {
      this.flightOver('crashed');
      return;
    }

    this.recordPath();
    // room transitions
    this.edges(pos);
  }

  private edges(pos: { x: number; y: number }): void {
    const def = this.room.def;
    const p = this.plane;
    let side: 'left' | 'right' | 'up' | 'down' | null = null;
    if (pos.x < -2) side = 'left';
    else if (pos.x > ROOM_W + 2) side = 'right';
    else if (pos.y < -2) side = 'up';
    else if (pos.y > ROOM_H + 2) side = 'down';
    if (!side) return;
    const span = def.exits[side];
    const next = neighbour(this.level, this.room.key, side);
    if (!next) {
      if (span && (span as { exit?: boolean }).exit) this.complete();
      else this.flightOver('crashed');
      return;
    }
    this.enterRoom(next);
    if (side === 'left' || side === 'right') this.hover = null;
    if (side === 'left') p.x += ROOM_W / PX_PER_M;
    if (side === 'right') p.x -= ROOM_W / PX_PER_M;
    if (side === 'up') p.y -= ROOM_H / PX_PER_M;
    if (side === 'down') p.y += ROOM_H / PX_PER_M;
    const np = planePx(p);
    // checkpoint: just inside the entry edge
    const entry = { left: 'right', right: 'left', up: 'down', down: 'up' }[side] as 'left' | 'right' | 'up' | 'down';
    if (!this.opts.fixedStart) this.checkpoint = entryCheckpoint(this.level, next, entry, np.x, np.y, p.facing, stillHazards(this.room.objects));
  }

  /** Room-grid-aware global pixel position. */
  globalPos(x: number, y: number): { x: number; y: number } {
    const [gx, gy] = this.room.key.split(',').map(Number);
    return { x: gx * ROOM_W + x, y: gy * ROOM_H + y };
  }

  private recordPath(): void {
    const q = planePx(this.plane);
    const g = this.globalPos(q.x, q.y);
    const f = this.flight;
    f.maxH = Math.max(f.maxH, (340 - q.y) / PX_PER_M);
    if (this.opts.record && f.k++ % 4 === 0) {
      f.path.push(g);
      if (f.path.length > 3000) f.path.shift();
    }
  }

  private flightStats(reason: FlightStats['reason'], targetId: string | null): FlightStats {
    const q = planePx(this.plane);
    const g = this.globalPos(q.x, q.y);
    const f = this.flight;
    if (this.opts.record) f.path.push(g);
    return {
      reason,
      distance: Math.abs(g.x - f.x0) / PX_PER_M,
      timeAloft: this.time - f.t0,
      maxHeight: f.maxH,
      heightLost: (g.y - f.y0) / PX_PER_M,
      path: f.path,
      damage: damagePct(this.plane.damage),
      landedRoom: this.room.key,
      landedX: q.x,
      targetId,
    };
  }

  /**
   * Put the plane down where it is (the play lab's autopilot, where the bot pilot's plan gave up a flight that was
   * getting nowhere: a player would fly it into the floor there).
   */
  giveUp(): void {
    this.flightOver('crashed');
  }

  /**
   * Make the current room afresh, its objects as when the plane flies in (balloons waiting to rise...): the play
   * lab's autopilot throws into a fresh room, as the bot pilot's plans assume.
   */
  restartRoom(): void {
    this.enterRoom(this.room.key);
  }

  /** Swap in edited rooms (sandbox builder): clears cached art and rebuilds the current room. */
  reloadRooms(rooms: LevelDef['rooms']): void {
    (this.level as { rooms: LevelDef['rooms'] }).rooms = rooms;
    this.artCache.clear();
    const key = this.room.key;
    this.room.dispose();
    this.renderer.clearSprites();
    const def = this.level.rooms[key];
    const art = this.artFor(key);
    this.renderer.setRoom(art);
    this.room = new RoomRuntime(key, def, art, this.renderer, this.switches, this.level);
    this.renderer.setAir(this.room.airflows());
  }

  // ------------------------------------------------------------------------------------------
  // HUD & render

  /** Loudness of the room's ambient loops as heard from the plane (falls off with distance). */
  ambience(): Ambience {
    const q = planePx(this.plane);
    const mix = { vent: 0, fan: 0, fire: 0 };
    for (const o of this.room.objects) {
      const snd = o.sound?.();
      if (!snd) continue;
      const g = Math.max(0, 1 - Math.hypot(snd.x - q.x, snd.y - q.y) / 340);
      const v = snd.vol * (0.16 + 0.84 * g * g);
      mix[snd.loop] = 1 - (1 - mix[snd.loop]) * (1 - v);
    }
    if (this.plane.damage.burning > 0) mix.fire = Math.max(mix.fire, 0.85);
    const flying = this.phase === 'fly';
    return { flying, speed: flying ? this.plane.V : 0, ...mix };
  }

  hud(): HudState {
    const p = this.plane;
    return {
      phase: this.phase,
      sheets: this.sheets,
      stars: [...this.collected].filter((id) => id.includes(':star:') || id.startsWith('star')).length,
      starsTotal: this.starsTotal,
      time: this.time,
      damage: damagePct(p.damage),
      burning: p.damage.burning > 0,
      soak: p.damage.soak,
      charges: { ...this.charges },
      gadget: this.design.extras.gadget,
      roomName: this.room.def.name,
      lightsOn: this.room.lightsOn,
      message: this.message,
      speed: p.V,
      alpha: p.alpha / DEG,
      ld: p.CD > 0 ? p.CL / p.CD : 0,
      stall: p.stall,
      power: this.aim.power,
      idealPower: idealThrowPower(this.aero),
      infiniteSheets: !!this.opts.infiniteSheets,
      hovering: !!this.hover,
      ...(this.goalStars.size ? { goal: `Goal ★ ${this.goalStars.size - this.goalLeft()}/${this.goalStars.size}` } : {}),
    };
  }

  render(): void {
    const r = this.renderer;
    const p = this.plane;
    const lights = this.room.lights();
    r.setLights(lights, this.room.ambient());
    r.setGlow(this.room.lightsOn ? 0 : 1);

    // plane lighting: ambient + nearest strong light
    let best: ActiveLight | undefined;
    let bestScore = 0;
    const pos = this.phase === 'aim' ? { x: this.checkpoint.x, y: this.checkpoint.y } : planePx(p);
    for (const l of lights) {
      const d = Math.hypot(l.x - pos.x, l.y - pos.y);
      const s = Math.max(0, 1 - d / l.r) * l.intensity;
      if (s > bestScore) {
        bestScore = s;
        best = l;
      }
    }
    const amb = this.room.ambient();
    r.plane.setLighting(
      new THREE.Color(amb.r * 0.82, amb.g * 0.82, amb.b * 0.86),
      new THREE.Color(amb.r * 0.5, amb.g * 0.48, amb.b * 0.44),
      best ? { x: best.x - pos.x, y: pos.y - best.y, color: best.color.clone().multiplyScalar(best.intensity), range: best.r } : undefined,
    );
    const d = p.damage;
    r.plane.setDamage([d.nose, d.wingL, d.wingR, d.tail, d.body], [d.scorch, d.scorch, d.scorch, d.scorch, d.scorch], [d.soak, d.soak, d.soak, d.soak, d.soak]);
    r.plane.setFlash(this.flash);

    if (this.phase === 'aim') {
      const a = this.aim.angle;
      const facing: 1 | -1 = Math.cos(a) >= 0 ? 1 : -1;
      const theta = Math.atan2(Math.sin(a), Math.abs(Math.cos(a)));
      // the slingshot at the launch point: the plane sits in its band, drawn back as far as the player pulls
      const pull = this.pulling.aiming ? this.pulling.power : 0;
      const back = pulledBack(a, pull);
      this.sling.aim(pos.x, pos.y, a, pull, !this.pulling.aiming, this.tick.halfLen * 0.85, this.pulling.dt);
      this.balloon.update(pos.x, pos.y, 0, 0, this.pulling.dt);
      r.plane.pose({ x: pos.x + back.dx, y: pos.y + back.dy, theta, facing, turn: null, bank: 0, roll: 0, righting: 0, visible: true });
      this.previewTrajectory();
    } else {
      this.sling.update(this.pulling.dt);
      const visible = this.phase === 'fly' || this.phase === 'workbench' || this.phase === 'complete' || (this.phase === 'down' && this.downT < 0.15);
      // the helium balloon, full while helium lifts the plane (the sticker's lift too), going down as it fades
      const fill = Math.max(p.balloon, Math.min(1, p.heliumLeft / 0.25));
      this.balloon.update(pos.x, pos.y - 2, visible ? fill : 0, p.vx * PX_PER_M * PHYS.timeScale, this.pulling.dt);
      r.setGuide([]);
      r.plane.pose({
        x: pos.x,
        y: pos.y,
        theta: p.theta,
        facing: p.facing,
        turn: p.turn ? { s: p.turn.t / p.turn.dur, from: p.turn.from } : null,
        bank: p.bank,
        roll: p.roll,
        righting: p.righting,
        visible,
      });
    }
    // shadow on the surface below
    const cols = this.room.colliders();
    const sy = surfaceBelow(cols, pos.x, pos.y + 4);
    const h = Math.max(0, sy - pos.y);
    const len = (this.mesh.max.x - this.mesh.min.x) * PX_PER_M;
    r.plane.placeShadow(pos.x, sy, len * (1.0 - Math.min(0.5, h / 600)), Math.max(0, 0.75 - h / 420));
    // screen shake via camera offset
    const s = this.shakeAmt * 3;
    r.camera.position.x = s ? (Math.random() - 0.5) * s : 0;
    r.camera.position.y = s ? (Math.random() - 0.5) * s : 0;
    r.render(this.realTime);
  }

  /** Dotted trajectory preview during aiming (first ~1.5 s of flight, ignoring collisions). */
  private previewTrajectory(): void {
    const sim = createPlane(this.aero, { autoTrim: this.opts.autoTrim });
    launch(sim, this.checkpoint.x, this.checkpoint.y, this.aim.angle, this.aim.power);
    const dots = 22;
    const pts: { x: number; y: number; a: number }[] = [];
    for (let k = 0; k < dots; k++) {
      for (let s = 0; s < 6; s++) stepPlane(sim, { dir: 0, pitch: 0, boost: false }, this.windAt, 1 / 120, { slowMo: this.opts.slowMo });
      const q = planePx(sim);
      if (q.x < 0 || q.x > ROOM_W || q.y < 0 || q.y > ROOM_H) break;
      pts.push({ x: q.x, y: q.y, a: 0.95 - (k / dots) * 0.75 });
    }
    this.renderer.setGuide(pts);
  }

  /** Items of the current room (for debug overlays). */
  roomItems(): ItemDef[] {
    return this.room.def.items;
  }

  dispose(): void {
    this.room?.dispose();
    this.renderer.clearSprites();
  }
}
