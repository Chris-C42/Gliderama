/**
 * A bot pilot for whole houses (the Classic Houses): it plays by the game's rules — throw from the checkpoint,
 * fly (turn or not, pitch, as a player can), and when a flight ends throw the next sheet from wherever the
 * session's checkpoint is by then — until it has collected every goal star (or reached an exit).
 *
 * Each flight is a beam search over short stretches of stick input. Flights are steered towards a target, room by
 * room along the house's map (side openings, floor and ceiling openings, stairs, transports): the nearest star
 * still to find, or, when the way to every star is shut, a switch that opens one (Glider PRO houses switch
 * transports on and off). A flight that dies leaves its checkpoint behind, and the next sheet is thrown from the
 * most promising checkpoint any flight reached; when no flight gets anywhere new, the bot tries another target.
 * Flights that stop getting anywhere (circling in an updraft) are given up. Things that move (balloons, darts, a
 * leaping fish...) are flown alongside, as they go from the moment the plane comes into their room (or a sheet is
 * thrown there: the play lab's autopilot makes the room afresh before each throw), and touching one ends the flight.
 * If the bot finds a way through, a player with the same controls can.
 */

import { analyzeDesign } from '../../src/paper/aero';
import { buildMesh } from '../../src/paper/build';
import type { Design } from '../../src/paper/design';
import { buildSimRoom, type SimRoom } from '../../src/game/sim';
import { flightTick, planeHull, type TickState } from '../../src/game/flightTick';
import { bounds, polyVsBox, profileHull } from '../../src/game/collide';
import { entryCheckpoint, goalStarIds, neighbour, type LevelDef } from '../../src/game/level';
import { createPlane, launch, planePx, type FlightInput, type Plane } from '../../src/physics/flight';
import { damagePct } from '../../src/physics/damage';
import { PX_PER_M, ROOM_H, ROOM_W } from '../../src/physics/config';
import type { GameObject, ObjCtx, SessionApi, WindOut } from '../../src/game/objects/types';
import { OBJECTS } from '../../src/game/objects';
import { LAYOUT, type ItemDef, type Rect, type RoomDef } from '../../src/world/types';
import { stairsArrival, stairsDownGeom, stairsUpGeom } from '../../src/world/stairs';
import { spillWind, updateSpills } from '../../src/game/roomAir';
import { TRANSPORT_REST } from '../../src/game/objects/classic';

const TICK = 1 / 120;
type Side = 'left' | 'right' | 'up' | 'down';

interface Checkpoint {
  room: string;
  x: number;
  y: number;
  facing: 1 | -1;
}

/** One way out of a room: a side / floor / ceiling opening, stairs or a transport. */
export interface Way {
  to: string;
  kind: 'side' | 'up' | 'down' | 'rect';
  side?: 'left' | 'right';
  /** Top of a side opening (being above it at the wall is no use). */
  from?: number;
  /** Middle of a floor / ceiling opening. */
  cx?: number;
  /** Stairs doorway, transport mouth. */
  rect?: Rect;
  /** The switch group of a switched transport (`!g`: open while g is switched off). */
  gate?: string;
  /** A ceiling opening with rising air up to it (false: no plane can glide up there)... */
  lift?: boolean;
  /** ...or with rising air only while one of these switch groups is on. */
  liftGates?: string[];
}

/** Something to fly to: a goal star, or a switch (that opens the way to one). */
interface Target {
  key: string;
  kind: 'star' | 'switch';
  room: string;
  x: number;
  y: number;
  /** The group a switch target flips. */
  group?: string;
}

/** The stick input of one search step, linked back to the step before (a flight's whole input, cheaply shared). */
interface Steps {
  dir: -1 | 0 | 1;
  pitch: number;
  prev: Steps | null;
}

/** A throw and the stick input that followed, one entry per search step (`stepTicks` game ticks each). */
export interface Flight {
  from: Checkpoint;
  angle: number;
  power: number;
  stepTicks: number;
  steps: { dir: -1 | 0 | 1; pitch: number }[];
}

interface Node {
  key: string;
  plane: Plane;
  groundT: number;
  stillT: number;
  t: number;
  switches: Map<string, boolean>;
  checkpoint: Checkpoint;
  score: number;
  /** Best score so far, and when: a flight that stops improving is given up. */
  peak: number;
  peakT: number;
  /** When the flight last came out of a transport. */
  transT: number;
  /** Game ticks since the plane came into this room, and the switches its moving hazards went by then (MoverTrack). */
  roomTick: number;
  roomSig: string;
  /** Goal stars this flight has collected ('toggled:<group>' for switches flipped). */
  got: string[];
  /** The switches the plane is in (a switch flips once each time the plane comes through it, as in the game). */
  over: string[];
  trace: string[];
  thrown: { from: Checkpoint; angle: number; power: number; stepTicks: number };
  steps: Steps | null;
}

export interface HouseSolveResult {
  solved: boolean;
  starsTotal: number;
  /** Goal stars collected, in order. */
  stars: string[];
  /** Sheets thrown after the first (each lost flight costs one). */
  sheetsUsed: number;
  /** Seconds of flying (game time), the lost flights' too. */
  t: number;
  /** Rooms flown through, in order. */
  rooms: string[];
  /** Where the bot gave up (room @x,y), when not solved. */
  stuck?: string;
  /** Closest it got to the next star, in rooms. */
  roomsShort?: number;
  trace: string[];
  /** Every flight of the solution, in order (the lost ones too: they are how the player gets to the next checkpoint). */
  flights: Flight[];
  /** Game ticks (1/120 s) per entry of a flight's `steps` (the first try's; each flight says its own). */
  stepTicks: number;
  /** Search steps used (of `maxSteps`). */
  steps?: number;
}

function clonePlane(p: Plane): Plane {
  return { ...p, damage: { ...p.damage }, mods: { ...p.mods }, turn: p.turn ? { ...p.turn } : null };
}

/** A session API for things flown on their own: the switches as given, everything else does nothing. */
function quietApi(switches: Map<string, boolean>): SessionApi {
  const api: Partial<SessionApi> = {
    switchOn: (g) => switches.get(g) ?? true,
    lightsOn: () => true,
    isCollected: () => false,
    plane: () => ({ x: -1000, y: -1000, vx: 0, vy: 0, alive: false }),
  };
  return new Proxy(api as SessionApi, { get: (t, k: string) => t[k as keyof SessionApi] ?? (() => {}) });
}

/** How far round a moving hazard the plane keeps (px): a balloon sways a couple of pixels at random. */
const MOVER_PAD = 3;

/**
 * Where a room's moving hazards are, tick by tick after the plane comes in (the game makes a room's objects afresh
 * then): fresh copies flown with the switches as they were then, their trigger rects recorded (padded) as needed.
 */
class MoverTrack {
  private readonly objs: GameObject[];
  private readonly ctx: ObjCtx;
  private readonly ticks: Rect[][] = [[]];
  constructor(defs: ItemDef[], key: string, switches: Map<string, boolean>) {
    this.objs = defs.map((d, i) => OBJECTS[d.t](d, `${key}:mover:${i}`, null, { dark: false, night: false }));
    this.ctx = { dt: TICK, time: 0, particles: { spawn() {} }, api: quietApi(switches) };
  }
  /** The hazards' rects after `tick` ticks in the room. */
  at(tick: number): Rect[] {
    while (this.ticks.length <= tick) {
      this.ctx.time += TICK;
      for (const o of this.objs) o.update?.(this.ctx);
      const out: Rect[] = [];
      for (const o of this.objs) {
        const r = o.trigger?.();
        if (r) out.push({ x: r.x - MOVER_PAD, y: r.y - MOVER_PAD, w: r.w + 2 * MOVER_PAD, h: r.h + 2 * MOVER_PAD });
      }
      this.ticks.push(out);
    }
    return this.ticks[tick];
  }
}

/** Every way out of every room. */
export function houseMap(level: LevelDef): Map<string, Way[]> {
  const out = new Map<string, Way[]>();
  for (const [key, room] of Object.entries(level.rooms)) {
    const ways: Way[] = [];
    for (const side of ['left', 'right', 'up', 'down'] as const) {
      const span = room.exits[side];
      const to = span && neighbour(level, key, side);
      if (!span || !to) continue;
      if (side === 'down') ways.push({ to, kind: side, cx: (span.from + span.to) / 2 });
      else if (side === 'up') {
        const lift = liftUnder(room, span.from, span.to);
        ways.push({ to, kind: side, cx: (span.from + span.to) / 2, lift: lift === true, ...(lift !== true && lift.length ? { liftGates: lift } : {}) });
      } else ways.push({ to, kind: 'side', side, from: span.from });
    }
    for (const it of room.items) {
      if (it.t === 'stairsUp' || it.t === 'stairsDown') {
        const to = neighbour(level, key, it.t === 'stairsUp' ? 'up' : 'down');
        if (to) ways.push({ to, kind: 'rect', rect: it.t === 'stairsUp' ? stairsUpGeom(it).door : stairsDownGeom(it).trigger });
      }
      if (it.t === 'transport' && typeof it.to === 'string' && level.rooms[it.to]) {
        const rect = { x: it.x, y: it.y, w: it.w ?? 60, h: it.h ?? 40 };
        ways.push({ to: it.to, kind: 'rect', rect, ...(typeof it.group === 'string' ? { gate: it.group } : {}) });
      }
    }
    out.set(key, ways);
  }
  return out;
}

/**
 * Rising air up to the top of a room somewhere between x0 and x1 (what it takes to leave through the ceiling): true
 * when some always blows there, else the switch groups of what blows there only when switched (none: no lift).
 */
function liftUnder(room: RoomDef, x0: number, x1: number): true | string[] {
  const gated: string[] = [];
  for (const it of room.items) {
    const w = Number(it.w ?? 60);
    if (it.x > x1 || it.x + w < x0) continue;
    const up = it.t === 'floorVent' ? Number(it.reach ?? LAYOUT.floor) <= 30 : it.t === 'current' && (it.dir ?? 'up') === 'up' && it.y <= 30;
    if (!up) continue;
    if (typeof it.group !== 'string') return true;
    gated.push(it.group);
  }
  return gated;
}

/** Whether a switch group is on (`!g`: on while g is switched off; switches start on). */
function groupOn(group: string, switches: Map<string, boolean>): boolean {
  return group.startsWith('!') ? !(switches.get(group.slice(1)) ?? true) : (switches.get(group) ?? true);
}

/**
 * Rooms → how far from `target` (following the ways in that `open` allows, each costing `cost`, 1 room by
 * default); missing = can't get there.
 */
export function distancesTo(
  map: Map<string, Way[]>,
  target: string,
  open: (w: Way) => boolean = () => true,
  cost: (w: Way) => number = () => 1,
): Map<string, number> {
  const back = new Map<string, { from: string; c: number }[]>();
  for (const [k, ways] of map) for (const w of ways) if (open(w)) (back.get(w.to) ?? back.set(w.to, []).get(w.to)!).push({ from: k, c: cost(w) });
  const dist = new Map<string, number>([[target, 0]]);
  const done = new Set<string>();
  // Dijkstra, small integer costs: a plain scan for the nearest room is quick enough for a few hundred rooms
  for (;;) {
    let k: string | null = null;
    for (const [r, d] of dist) if (!done.has(r) && (k === null || d < dist.get(k)!)) k = r;
    if (k === null) break;
    done.add(k);
    for (const { from, c } of back.get(k) ?? []) {
      const d = dist.get(k)! + c;
      if (d < (dist.get(from) ?? Infinity)) dist.set(from, d);
    }
  }
  return dist;
}

/** What an up way without rising air costs the planner, in rooms (a plane would need luck to get up there). */
const NO_LIFT = 10;
const wayCost = (w: Way, sw: Map<string, boolean>) => (w.lift !== false || (w.liftGates ?? []).some((g) => groupOn(g, sw)) ? 1 : 1 + NO_LIFT);

/** How promising a position is for leaving through `w`: distance made good, height counted at about a glide ratio. */
function progress(w: Way, x: number, y: number): number {
  const H = 4.5;
  if (w.kind === 'side') return (w.side === 'right' ? x : 640 - x) + H * (340 - Math.max(y, (w.from ?? 16) + 12));
  if (w.kind === 'up') return 4 * (360 - y) - 0.6 * Math.abs(x - w.cx!);
  if (w.kind === 'down') return 2 * y + 1200 - 2.5 * Math.abs(x - w.cx!);
  const r = w.rect!;
  const dx = Math.max(0, Math.abs(x - (r.x + r.w / 2)) - r.w / 2);
  const below = Math.max(0, y - (r.y + r.h));
  return 1500 - dx - 3 * below + H * (340 - Math.max(y, r.y + 10));
}

/** Closing in on a target at (sx, sy): being below it is worse than being above (a plane can always glide down). */
function toward(x: number, y: number, sx: number, sy: number): number {
  return 2500 - Math.abs(x - sx) - 3 * Math.max(0, y - sy) - 0.4 * Math.max(0, sy - y);
}

export interface HouseSolveOptions {
  beam?: number;
  /** Seconds of stick input per search step. */
  step?: number;
  /** Longest single flight (game seconds). */
  maxFlight?: number;
  /** A flight whose score has not improved for this long (game seconds) is given up. */
  stall?: number;
  /** Sheets the bot may throw in all. */
  maxSheets?: number;
  /** Give up after this many search steps in all (time budget). */
  maxSteps?: number;
  log?: (line: string) => void;
  /** Instead of searching, fly this recorded flight and report the plane after each step. */
  replay?: Flight;
  onReplay?: (n: { key: string; plane: Plane; t: number }, over: boolean) => void;
  /** Every game tick of the search (debugging). */
  onTick?: (p: Plane, wind: { x: number; y: number }, colliders: number) => void;
}

export function solveHouse(level: LevelDef, design: Design, opts: HouseSolveOptions = {}): HouseSolveResult {
  const { build, aero } = analyzeDesign(design);
  const mesh = buildMesh(build, aero.cg);
  const hullLocal = profileHull(mesh);
  const halfLen = ((mesh.max.x - mesh.min.x) * PX_PER_M) / 2;
  const map = houseMap(level);
  const rooms = new Map<string, SimRoom>();
  const roomOf = (k: string) => rooms.get(k) ?? rooms.set(k, buildSimRoom(level.rooms[k], { level, key: k })).get(k)!;
  // moving hazards: one track per room and state of the switches they go by
  const tracks = new Map<string, MoverTrack | null>();
  const sigOf = (k: string, sw: Map<string, boolean>) =>
    (roomOf(k).movers ?? []).map((o) => (typeof o.def.group === 'string' ? (groupOn(o.def.group, sw) ? 1 : 0) : '-')).join('');
  const trackOf = (k: string, sig: string): MoverTrack | null => {
    const tk = `${k}|${sig}`;
    if (tracks.has(tk)) return tracks.get(tk)!;
    const defs = (roomOf(k).movers ?? []).map((o) => o.def);
    // (the switches they go by, as the signature has them)
    const sw = new Map<string, boolean>();
    defs.forEach((d, i) => typeof d.group === 'string' && sw.set(d.group.replace(/^!/, ''), (sig[i] === '1') !== d.group.startsWith('!')));
    const t = defs.length ? new MoverTrack(defs, k, sw) : null;
    tracks.set(tk, t);
    return t;
  };
  const beamW = opts.beam ?? 50;
  const stepTicks = Math.round((opts.step ?? 0.35) / TICK);
  // throwing from the same checkpoint again searches differently (finer steps, a wider beam, more pitches)
  const TRIES = [
    { beam: beamW, step: stepTicks, pitches: [-0.8, -0.3, 0, 0.4, 0.9] },
    { beam: Math.round(beamW * 1.6), step: Math.round(0.25 / TICK), pitches: [-0.8, -0.3, 0, 0.4, 0.9] },
    { beam: Math.round(beamW * 2.4), step: stepTicks, pitches: [-1, -0.55, -0.2, 0, 0.25, 0.6, 1] },
  ];
  let tryNow = TRIES[0];
  const maxFlight = opts.maxFlight ?? 150;
  const stall = opts.stall ?? 15;
  const maxSheets = opts.maxSheets ?? 60;
  const budget = opts.maxSteps ?? 4000;
  let stepsLeft = budget;
  const goals = goalStarIds(level);

  // what there is to fly to: goal stars, and the switches of switched transports
  const stars = new Map<string, Target>();
  const switchesOf = new Map<string, Target[]>();
  const gates = new Set<string>();
  for (const ways of map.values())
    for (const w of ways) {
      if (w.gate) gates.add(w.gate.replace(/^!/, ''));
      for (const g of w.liftGates ?? []) gates.add(g.replace(/^!/, ''));
    }
  for (const [k, r] of Object.entries(level.rooms))
    r.items.forEach((it, i) => {
      if (it.t === 'star' && it.goal && typeof it.id === 'string') stars.set(it.id, { key: it.id, kind: 'star', room: k, x: it.x, y: it.y });
      if (it.t === 'switch' && typeof it.group === 'string' && gates.has(it.group)) {
        const w = it.hidden ? Number(it.w ?? 16) : 10;
        const h = it.hidden ? Number(it.h ?? 16) : 16;
        const s: Target = { key: `switch ${k}#${i}`, kind: 'switch', room: k, x: it.x + w / 2, y: it.y + h / 2, group: it.group };
        (switchesOf.get(it.group) ?? switchesOf.set(it.group, []).get(it.group)!).push(s);
      }
    });

  const got = new Set<string>();
  const order: string[] = [];
  const visited: string[] = [level.start.room];
  const trace: string[] = [];
  let sheets = 0;
  let flying: Node[] | null = null;
  let checkpoint: Checkpoint = { ...level.start };
  let totalT = 0;
  // switch states carried from flight to flight (a switch stays flipped)
  let switchesNow = new Map<string, boolean>();

  // distances to a room, as the switches are (only the gates' states matter: switched transports, and switched air
  // up through ceiling openings): a ceiling opening without rising air counts as a long way round
  const distCache = new Map<string, Map<string, number>>();
  const open = (sw: Map<string, boolean>) => (w: Way) => !w.gate || groupOn(w.gate, sw);
  const distTo = (room: string, sw: Map<string, boolean>) => {
    const k = `${room}|${[...gates].map((g) => (groupOn(g, sw) ? 1 : 0)).join('')}`;
    const cost = (w: Way) => wayCost(w, sw);
    return distCache.get(k) ?? distCache.set(k, distancesTo(map, room, open(sw), cost)).get(k)!;
  };
  /**
   * What to fly to from `room`: the nearest star still to find, or a switch on the way when flipping it makes the
   * way to one shorter (or opens it at all). `skip`: targets that got nowhere from here.
   */
  const chooseTarget = (room: string, sw: Map<string, boolean>, skip: Set<string>): Target | null => {
    const left = goals.filter((id) => !got.has(id) && !skip.has(id)).map((id) => stars.get(id)!);
    let best: Target | null = null;
    let bd = Infinity;
    for (const s of left) {
      const d = distTo(s.room, sw).get(room) ?? Infinity;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    for (const [group, list] of switchesOf) {
      const flipped = new Map(sw).set(group, !(sw.get(group) ?? true));
      for (const s of list) {
        if (skip.has(s.key)) continue;
        const toSwitch = distTo(s.room, sw).get(room) ?? Infinity;
        if (toSwitch === Infinity) continue;
        const after = Math.min(...left.map((t) => distTo(t.room, flipped).get(s.room) ?? Infinity), Infinity);
        if (after < Infinity && toSwitch + after < bd) {
          bd = toSwitch + after;
          best = s;
        }
      }
    }
    return best;
  };

  const throwsFrom = (cp: Checkpoint): Node[] => {
    const out: Node[] = [];
    for (const facing of [cp.facing, -cp.facing as 1 | -1])
      for (const [angle, power] of [
        [0, 0.3],
        [0, 0.5],
        [0.15, 0.4],
        [0.3, 0.6],
        [-0.15, 0.35],
        [0.1, 0.75],
        [0.5, 0.8],
      ]) {
        const plane = createPlane(aero);
        launch(plane, cp.x, cp.y, facing > 0 ? angle : Math.PI - angle, power);
        out.push({
          key: cp.room,
          plane,
          groundT: 0,
          stillT: 0,
          t: 0,
          switches: new Map(switchesNow),
          checkpoint: { ...cp },
          score: 0,
          peak: -Infinity,
          peakT: 0,
          transT: -Infinity,
          roomTick: 0,
          roomSig: sigOf(cp.room, switchesNow),
          got: [],
          over: [],
          trace: [`throw ${facing > 0 ? '>' : '<'} a${angle} p${power} from ${cp.room}`],
          thrown: { from: { ...cp }, angle: facing > 0 ? angle : Math.PI - angle, power, stepTicks: tryNow.step },
          steps: null,
        });
      }
    return out;
  };

  /** Whether a flight has reached `target` (or an exit). */
  const reached = (n: Node, target: Target | null) =>
    !!target && (n.got.includes(target.kind === 'star' ? target.key : `toggled:${target.group}`) || n.got.includes('exit'));

  /** Advance a node by one stretch of input; null when its flight is over. `onDeath` hears about it. */
  const advance = (n0: Node, input: FlightInput, target: Target | null, onDeath: (n: Node) => void): Node | null => {
    const n: Node = {
      ...n0,
      plane: clonePlane(n0.plane),
      switches: new Map(n0.switches),
      got: n0.got.slice(),
      checkpoint: { ...n0.checkpoint },
      steps: { dir: input.dir as -1 | 0 | 1, pitch: input.pitch, prev: n0.steps },
    };
    const st: TickState = { plane: n.plane, aero, hullLocal, halfLen, groundT: n.groundT, stillT: n.stillT };
    let room = roomOf(n.key);
    const api = {
      setSwitch: (g: string, on: boolean) => void n.switches.set(g, on),
      switchOn: (g: string) => n.switches.get(g) ?? true,
      lightsOn: () => true,
      plane: () => {
        const q = planePx(n.plane);
        return { x: q.x, y: q.y, vx: n.plane.vx, vy: n.plane.vy, alive: true };
      },
    } as unknown as SessionApi;
    const ctx: ObjCtx = { dt: TICK, time: 0, particles: { spawn() {} }, api };
    const out: WindOut = { x: 0, y: 0 };
    const wind = (xm: number, ym: number) => {
      out.x = 0;
      out.y = 0;
      const x = xm * PX_PER_M;
      const y = ROOM_H - ym * PX_PER_M;
      for (const o of room.objects) o.wind?.(x, y, out);
      spillWind(room.spills, x, y, out);
      return { x: out.x, y: out.y };
    };
    const arrive = (key: string, x: number, y: number, facing: 1 | -1) => {
      const p = n.plane;
      p.x = x / PX_PER_M;
      p.y = (ROOM_H - y) / PX_PER_M;
      p.facing = facing;
      p.turn = null;
      p.theta = 0;
      p.q = 0;
      p.vx = facing * aero.perf.vBest;
      p.vy = 0;
      p.liftT = 0;
      p.exitPending = false;
      p.exitBoost = 0;
      n.key = key;
      room = roomOf(key);
      n.checkpoint = { room: key, x, y, facing };
      n.roomTick = 0;
      n.roomSig = sigOf(key, n.switches);
    };
    const die = () => {
      onDeath(n);
      return null;
    };
    for (let k = 0; k < n.thrown.stepTicks; k++) {
      ctx.time = n.t;
      // (switched air and transports; moving hazards are flown on their own, see MoverTrack)
      for (const o of room.objects) if (typeof o.def.group === 'string' && !o.hazard) o.update?.(ctx);
      updateSpills(room.spills, ctx);
      const r = flightTick(st, input, wind, room.colliders, TICK, { rand: () => 0.5 }, {});
      opts.onTick?.(n.plane, wind(n.plane.x, n.plane.y), room.colliders.length);
      n.t += TICK;
      if (r === 'crashed' || r === 'grounded' || damagePct(n.plane.damage) >= 90) return die();
      const hw = planeHull(st);
      const bb = bounds(hw);
      // touching a hazard loses the plane, but what else it touches as it does counts (the game goes through all of
      // a tick's triggers first: a star over a shredder can be had for a sheet)
      let hurt = false;
      for (const h of room.hazards) {
        if (bb.x1 < h.x || bb.x0 > h.x + h.w || bb.y1 < h.y || bb.y0 > h.y + h.h) continue;
        if ((hurt = !!polyVsBox(hw, { ...h }))) break;
      }
      n.roomTick++;
      if (!hurt)
        for (const h of trackOf(n.key, n.roomSig)?.at(n.roomTick) ?? []) {
          if (bb.x1 < h.x || bb.x0 > h.x + h.w || bb.y1 < h.y || bb.y0 > h.y + h.h) continue;
          if ((hurt = !!polyVsBox(hw, { ...h }))) break;
        }
      let moved = false;
      const over: string[] = [];
      for (const o of room.objects) {
        const t = o.def.t;
        if (t !== 'switch' && t !== 'star' && t !== 'stairsUp' && t !== 'stairsDown' && t !== 'transport' && t !== 'exit') continue;
        if (hurt && t !== 'switch' && t !== 'star') continue;
        const tr = o.trigger?.();
        if (!tr || bb.x1 < tr.x || bb.x0 > tr.x + tr.w || bb.y1 < tr.y || bb.y0 > tr.y + tr.h || !polyVsBox(hw, { ...tr })) continue;
        if (t === 'switch') {
          over.push(o.id);
          const g = typeof o.def.group === 'string' ? o.def.group : 'lights';
          if (g !== 'lights' && !n.over.includes(o.id)) {
            n.switches.set(g, !(n.switches.get(g) ?? true));
            // (what it switches here goes by the new state from now on, as if it had been so since the plane came in)
            n.roomSig = sigOf(n.key, n.switches);
            n.got.push(`toggled:${g}`);
            n.trace = [...n.trace, `switch ${g} in ${n.key} @${(totalT + n.t).toFixed(1)}s`];
          }
        } else if (t === 'star') {
          const id = o.def.id;
          if (typeof id === 'string' && o.def.goal && !n.got.includes(id)) {
            n.got.push(id);
            n.trace = [...n.trace, `star ${id} @${(totalT + n.t).toFixed(1)}s`];
          }
        } else if (t === 'exit') {
          n.trace = [...n.trace, `exit in ${n.key}`];
          n.got.push('exit');
        } else if (t === 'stairsUp' || t === 'stairsDown') {
          const way = t === 'stairsUp' ? 'up' : 'down';
          const next = neighbour(level, n.key, way);
          if (!next) continue;
          const a = stairsArrival(level.rooms[next].items, way);
          n.trace = [...n.trace, `stairs ${way} -> ${next} @${(totalT + n.t).toFixed(1)}s`];
          arrive(next, a.x, a.y, a.facing);
          moved = true;
          break;
        } else if (t === 'transport' && typeof o.def.to === 'string' && level.rooms[o.def.to]) {
          if (typeof o.def.group === 'string' && !groupOn(o.def.group, n.switches)) continue;
          if (n.t - n.transT < TRANSPORT_REST) continue;
          n.transT = n.t;
          n.trace = [...n.trace, `transport -> ${o.def.to} @${(totalT + n.t).toFixed(1)}s`];
          arrive(o.def.to, Number(o.def.ax), Number(o.def.ay), Number(o.def.facing) < 0 ? -1 : 1);
          moved = true;
          break;
        }
      }
      n.over = over;
      if (hurt) return die();
      if (moved) continue;
      if (reached(n, target)) return n;
      const pos = planePx(n.plane);
      let side: Side | null = null;
      if (pos.x < -2) side = 'left';
      else if (pos.x > ROOM_W + 2) side = 'right';
      else if (pos.y < -2) side = 'up';
      else if (pos.y > ROOM_H + 2) side = 'down';
      if (side) {
        const def = level.rooms[n.key];
        const span = def.exits[side];
        const next = neighbour(level, n.key, side);
        if (!next) {
          if (span?.exit) {
            n.got.push('exit');
            return n;
          }
          return die();
        }
        if (side === 'left') n.plane.x += ROOM_W / PX_PER_M;
        if (side === 'right') n.plane.x -= ROOM_W / PX_PER_M;
        if (side === 'up') n.plane.y -= ROOM_H / PX_PER_M;
        if (side === 'down') n.plane.y += ROOM_H / PX_PER_M;
        const np = planePx(n.plane);
        const entry = ({ left: 'right', right: 'left', up: 'down', down: 'up' } as const)[side];
        n.checkpoint = entryCheckpoint(level, next, entry, np.x, np.y, n.plane.facing);
        n.key = next;
        room = roomOf(next);
        n.roomTick = 0;
        n.roomSig = sigOf(next, n.switches);
        n.trace = [...n.trace, `-> ${next} @${(totalT + n.t).toFixed(1)}s`];
      }
      if (n.t > maxFlight) return die();
    }
    n.groundT = st.groundT;
    n.stillT = st.stillT;
    return n;
  };

  /** Replay a recorded flight from its throw (`opts.replay`), reporting the plane each tick. */
  if (opts.replay) {
    const f = opts.replay;
    const plane = createPlane(aero);
    launch(plane, f.from.x, f.from.y, f.angle, f.power);
    let n: Node | null = {
      key: f.from.room,
      plane,
      groundT: 0,
      stillT: 0,
      t: 0,
      switches: new Map(),
      checkpoint: { ...f.from },
      score: 0,
      peak: -Infinity,
      peakT: 0,
      transT: -Infinity,
      roomTick: 0,
      roomSig: sigOf(f.from.room, new Map()),
      got: [],
      over: [],
      trace: [],
      thrown: { ...f, stepTicks: f.stepTicks ?? stepTicks },
      steps: null,
    };
    for (const s of f.steps) {
      const prev: Node = n!;
      n = advance(prev, { dir: s.dir, pitch: s.pitch, boost: false }, null, () => {});
      opts.onReplay?.(n ?? prev, !n);
      if (!n) break;
    }
    return {
      solved: !!n,
      starsTotal: goals.length,
      stars: n?.got ?? [],
      sheetsUsed: 0,
      t: n?.t ?? 0,
      rooms: [],
      trace: n?.trace ?? [],
      flights: [],
      stepTicks,
    };
  }

  /** Score a live node for the search towards `target`. */
  const scoreOf = (n: Node, target: Target): number => {
    const dist = distTo(target.room, n.switches);
    const d = dist.get(n.key) ?? 999;
    const q = planePx(n.plane);
    let best = -1e9;
    if (n.key === target.room) best = toward(q.x, q.y, target.x, target.y);
    else
      for (const w of map.get(n.key) ?? [])
        if ((!w.gate || groupOn(w.gate, n.switches)) && wayCost(w, n.switches) + (dist.get(w.to) ?? 999) <= d) best = Math.max(best, progress(w, q.x, q.y));
    // a flight in a steep dive or about to stall is worth less than its position suggests
    const dive = Math.max(0, -n.plane.vy - 0.9) * 60 + Math.max(0, -n.plane.theta - 0.5) * 80;
    const slow = n.plane.V < 1 ? (1 - n.plane.V) * 120 : 0;
    return -d * 10000 + best - damagePct(n.plane.damage) * 3 - dive - slow;
  };

  /** How good a checkpoint is to throw from, for `target`. */
  const cpRank = (cp: Checkpoint, target: Target, sw: Map<string, boolean>): number => {
    const d = distTo(target.room, sw).get(cp.room) ?? 999;
    return -d * 10000 + (cp.room === target.room ? toward(cp.x, cp.y, target.x, target.y) : 0);
  };

  /** The rooms a flight went into, from its trace. */
  const roomsOf = (lines: string[]) =>
    lines.filter((s) => s.startsWith('->') || s.startsWith('stairs') || s.startsWith('transport')).map((s) => s.split(' ').slice(-2)[0]);

  const flightOf = (n: Node): Flight => {
    const steps: Flight['steps'] = [];
    for (let s = n.steps; s; s = s.prev) steps.push({ dir: s.dir, pitch: s.pitch });
    return { ...n.thrown, steps: steps.reverse() };
  };
  const flights: Flight[] = [];
  // the search is deterministic: from a checkpoint already thrown from (near enough) it would only fly the same
  // flights again, so each try searches differently; after the last, that checkpoint is used up for the target
  const tries = new Map<string, number>();
  const cpKey = (cp: Checkpoint, target: Target) => `${target.key}|${cp.room}@${Math.round(cp.x / 48)},${Math.round(cp.y / 40)},${cp.facing}`;
  // targets that got nowhere from the checkpoint's room (tried again once the bot is somewhere else)
  let skip = new Set<string>();
  let skipRoom = checkpoint.room;
  let target: Target | null = null;
  outer: while (got.size < goals.length) {
    if (checkpoint.room !== skipRoom) {
      skip = new Set();
      skipRoom = checkpoint.room;
    }
    if (!flying) {
      target = chooseTarget(checkpoint.room, switchesNow, skip);
      if (!target || sheets > maxSheets) break;
      const k = cpKey(checkpoint, target);
      tryNow = TRIES[tries.get(k) ?? 0];
      tries.set(k, (tries.get(k) ?? 0) + 1);
      flying = throwsFrom(checkpoint);
      if (sheets > 0 || got.size > 0)
        trace.push(`sheet ${sheets} from ${checkpoint.room} (${Math.round(checkpoint.x)},${Math.round(checkpoint.y)}) for ${target.key}`);
    }
    const tgt = target!;
    let beam = flying;
    flying = null;
    // where the flights that end leave the checkpoint: the best one not used up yet is where the next sheet goes
    let bestDeath: { cp: Checkpoint; rank: number; trace: string[]; at: string; node?: Node } | null = null;
    // a flight lost as it got the target (into a hazard) got it all the same: that is the way on
    let gotIt = false;
    const consider = (cp: Checkpoint, n?: Node) => {
      const got = !!n && reached(n, tgt);
      if (!got && (tries.get(cpKey(cp, tgt)) ?? 0) >= TRIES.length) return;
      gotIt ||= got;
      const rank = got ? Infinity : cpRank(cp, tgt, n?.switches ?? switchesNow);
      if (!bestDeath || rank > bestDeath.rank) {
        const q = n ? planePx(n.plane) : { x: cp.x, y: cp.y };
        bestDeath = { cp, rank, trace: n?.trace ?? [], at: `${n?.key ?? cp.room} @${Math.round(q.x)},${Math.round(q.y)} t${(n?.t ?? 0).toFixed(1)}`, node: n };
      }
    };
    const onDeath = (n: Node) => consider(n.checkpoint, n);
    for (;;) {
      if (stepsLeft-- <= 0) break outer;
      const next: Node[] = [];
      let done: Node | null = null;
      for (const n of beam) {
        for (const turn of [false, true]) {
          if (turn && n.plane.turn) continue;
          for (const pitch of tryNow.pitches) {
            const r = advance(n, { dir: turn ? ((n.plane.facing > 0 ? -1 : 1) as -1 | 1) : 0, pitch, boost: false }, tgt, onDeath);
            if (!r) continue;
            if (reached(r, tgt)) {
              done = r;
              break;
            }
            r.score = scoreOf(r, tgt);
            // getting nowhere (circling in an updraft that leads nowhere): give the flight up
            if (r.score > r.peak + 40) {
              r.peak = r.score;
              r.peakT = r.t;
            } else if (r.t - r.peakT > stall) {
              onDeath(r);
              continue;
            }
            next.push(r);
          }
          if (done) break;
        }
        if (done) break;
      }
      if (done) {
        // found it: carry on flying from here (the flight goes on after a star or a switch)
        for (const id of done.got)
          if (goals.includes(id) && !got.has(id)) {
            got.add(id);
            order.push(id);
          }
        totalT += done.t;
        visited.push(...roomsOf(done.trace));
        trace.push(...done.trace);
        checkpoint = done.checkpoint;
        switchesNow = done.switches;
        if (done.got.includes('exit') || got.size >= goals.length) {
          flights.push(flightOf(done));
          break outer;
        }
        opts.log?.(`${tgt.kind} ${tgt.key} in ${tgt.room} after ${totalT.toFixed(1)}s, ${sheets} sheets`);
        skip = new Set();
        done.t = 0;
        done.peak = -Infinity;
        done.peakT = 0;
        done.got = [];
        done.trace = [];
        target = chooseTarget(done.key, switchesNow, skip);
        if (!target) {
          flights.push(flightOf(done));
          break outer;
        }
        flying = [done];
        continue outer;
      }
      if (!next.length || gotIt) break;
      // keep the best, one per coarse state so the beam stays diverse
      next.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      beam = [];
      for (const n of next) {
        const q = planePx(n.plane);
        const k = `${n.key}|${Math.round(q.x / 20)}|${Math.round(q.y / 10)}|${n.plane.facing}|${n.plane.turn ? 1 : 0}`;
        if (seen.has(k)) continue;
        seen.add(k);
        beam.push(n);
        if (beam.length >= tryNow.beam) break;
      }
    }
    // every flight of this sheet is over: the next one is thrown from the best new checkpoint any of them reached
    const bd = bestDeath as { cp: Checkpoint; rank: number; trace: string[]; at: string; node?: Node } | null;
    if (!bd) {
      // nowhere new to throw from for this target: try another one from here
      opts.log?.(`no way on to ${tgt.key} from ${checkpoint.room}: another target`);
      skip.add(tgt.key);
      continue;
    }
    opts.log?.(`sheet ${sheets} for ${tgt.key}: best flight ended in ${bd.at} -> next from ${cpKey(bd.cp, tgt)} [${bd.trace.join(' | ')}]`);
    // the flight that got there is part of the way (a checkpoint carried over from before needs none)
    if (bd.node) {
      flights.push(flightOf(bd.node));
      switchesNow = bd.node.switches;
      // its time and rooms count too (the player flies it)
      totalT += bd.node.t;
      visited.push(...roomsOf(bd.node.trace));
      for (const id of bd.node.got)
        if (goals.includes(id) && !got.has(id)) {
          got.add(id);
          order.push(id);
        }
    }
    checkpoint = bd.cp;
    if (!visited.includes(checkpoint.room)) visited.push(checkpoint.room);
    sheets++;
  }
  const solved = got.size >= goals.length;
  const stuckTarget = solved ? null : chooseTarget(checkpoint.room, switchesNow, new Set());
  const short = stuckTarget ? distancesTo(map, stuckTarget.room, open(switchesNow)).get(checkpoint.room) : undefined;
  return {
    solved,
    starsTotal: goals.length,
    stars: order,
    sheetsUsed: sheets,
    t: totalT,
    rooms: [...new Set(visited)],
    stuck: solved ? undefined : `${checkpoint.room} @${Math.round(checkpoint.x)},${Math.round(checkpoint.y)}`,
    roomsShort: solved ? 0 : short,
    trace,
    flights,
    stepTicks,
    steps: budget - Math.max(0, stepsLeft),
  };
}
