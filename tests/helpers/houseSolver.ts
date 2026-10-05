/**
 * A bot pilot for whole houses (the Classic Houses): it plays by the game's rules — throw from the checkpoint,
 * fly (turn or not, pitch, as a player can), and when a flight ends throw the next sheet from wherever the
 * session's checkpoint is by then — until it has collected every goal star (or reached an exit).
 *
 * Each flight is a beam search over short stretches of stick input. Flights are steered towards the nearest star
 * still to find, room by room along the house's map (side openings, floor and ceiling openings, stairs,
 * transports); a flight that dies leaves its checkpoint behind, and the next sheet is thrown from the most
 * promising checkpoint any flight reached. If the bot finds a way through, a player with the same controls can.
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
import type { ObjCtx, SessionApi, WindOut } from '../../src/game/objects/types';
import type { ItemDef, Rect } from '../../src/world/types';
import { stairsArrival, stairsDownGeom, stairsUpGeom } from '../../src/world/stairs';
import { spillWind, updateSpills } from '../../src/game/roomAir';

const TICK = 1 / 120;
type Side = 'left' | 'right' | 'up' | 'down';

interface Checkpoint {
  room: string;
  x: number;
  y: number;
  facing: 1 | -1;
}

/** One way out of a room: a side / floor / ceiling opening, stairs or a transport. */
interface Way {
  to: string;
  kind: 'side' | 'up' | 'down' | 'rect';
  side?: 'left' | 'right';
  /** Top of a side opening (being above it at the wall is no use). */
  from?: number;
  /** Middle of a floor / ceiling opening. */
  cx?: number;
  /** Stairs doorway, transport mouth. */
  rect?: Rect;
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
  /** Goal stars this flight has collected. */
  got: string[];
  trace: string[];
  thrown: { from: Checkpoint; angle: number; power: number };
  steps: Steps | null;
}

export interface HouseSolveResult {
  solved: boolean;
  starsTotal: number;
  /** Goal stars collected, in order. */
  stars: string[];
  /** Sheets thrown after the first (each lost flight costs one). */
  sheetsUsed: number;
  /** Seconds of flying (game time). */
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
  /** Game ticks (1/120 s) per entry of a flight's `steps`. */
  stepTicks: number;
  /** Search steps used (of `maxSteps`). */
  steps?: number;
}

function clonePlane(p: Plane): Plane {
  return { ...p, damage: { ...p.damage }, mods: { ...p.mods }, turn: p.turn ? { ...p.turn } : null };
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
      if (side === 'up' || side === 'down') ways.push({ to, kind: side, cx: (span.from + span.to) / 2 });
      else ways.push({ to, kind: 'side', side, from: span.from });
    }
    for (const it of room.items) {
      if (it.t === 'stairsUp' || it.t === 'stairsDown') {
        const to = neighbour(level, key, it.t === 'stairsUp' ? 'up' : 'down');
        if (to) ways.push({ to, kind: 'rect', rect: it.t === 'stairsUp' ? stairsUpGeom(it).door : stairsDownGeom(it).trigger });
      }
      if (it.t === 'transport' && typeof it.to === 'string' && level.rooms[it.to])
        ways.push({ to: it.to, kind: 'rect', rect: { x: it.x, y: it.y, w: it.w ?? 60, h: it.h ?? 40 } });
    }
    out.set(key, ways);
  }
  return out;
}

/** Rooms → how many rooms away from `target` (following the ways in), Infinity when it can't be reached. */
export function distancesTo(map: Map<string, Way[]>, target: string): Map<string, number> {
  const back = new Map<string, string[]>();
  for (const [k, ways] of map) for (const w of ways) (back.get(w.to) ?? back.set(w.to, []).get(w.to)!).push(k);
  const dist = new Map<string, number>([[target, 0]]);
  const queue = [target];
  while (queue.length) {
    const k = queue.shift()!;
    for (const p of back.get(k) ?? []) {
      if (dist.has(p)) continue;
      dist.set(p, dist.get(k)! + 1);
      queue.push(p);
    }
  }
  return dist;
}

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

/** Closing in on a star at (sx, sy): being below it is worse than being above (a plane can always glide down). */
function towardStar(x: number, y: number, sx: number, sy: number): number {
  return 2500 - Math.abs(x - sx) - 3 * Math.max(0, y - sy) - 0.4 * Math.max(0, sy - y);
}

export interface HouseSolveOptions {
  beam?: number;
  /** Seconds of stick input per search step. */
  step?: number;
  /** Longest single flight (game seconds). */
  maxFlight?: number;
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
  const beamW = opts.beam ?? 50;
  const stepTicks = Math.round((opts.step ?? 0.35) / TICK);
  const maxFlight = opts.maxFlight ?? 90;
  const maxSheets = opts.maxSheets ?? 60;
  const budget = opts.maxSteps ?? 4000;
  let stepsLeft = budget;
  const pitches = [-0.8, -0.3, 0, 0.4, 0.9];
  const goals = goalStarIds(level);
  const starAt = new Map<string, { room: string; it: ItemDef }>();
  for (const [k, r] of Object.entries(level.rooms))
    for (const it of r.items) if (it.t === 'star' && it.goal && typeof it.id === 'string') starAt.set(it.id, { room: k, it });
  const got = new Set<string>();
  const order: string[] = [];
  const visited: string[] = [level.start.room];
  const trace: string[] = [];
  let sheets = 0;
  let flying: Node[] | null = null;
  let checkpoint: Checkpoint = { ...level.start };
  let totalT = 0;
  const distCache = new Map<string, Map<string, number>>();
  const distTo = (room: string) => distCache.get(room) ?? distCache.set(room, distancesTo(map, room)).get(room)!;
  /** The star still to find that is fewest rooms away from `room`. */
  const nextStar = (room: string, have: Set<string>) => {
    let best: string | null = null;
    let bd = Infinity;
    for (const id of goals) {
      if (have.has(id)) continue;
      const d = distTo(starAt.get(id)!.room).get(room) ?? Infinity;
      if (d < bd) {
        bd = d;
        best = id;
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
          got: [],
          trace: [`throw ${facing > 0 ? '>' : '<'} a${angle} p${power} from ${cp.room}`],
          thrown: { from: { ...cp }, angle: facing > 0 ? angle : Math.PI - angle, power },
          steps: null,
        });
      }
    return out;
  };
  // switch states carried from flight to flight (a switch stays flipped)
  let switchesNow = new Map<string, boolean>();

  /** Advance a node by one stretch of input; null when its flight is over. `onDeath` hears about it. */
  const advance = (n0: Node, input: FlightInput, target: string | null, onDeath: (n: Node) => void): Node | null => {
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
    };
    const die = () => {
      onDeath(n);
      return null;
    };
    for (let k = 0; k < stepTicks; k++) {
      ctx.time = n.t;
      for (const o of room.objects) if (typeof o.def.group === 'string') o.update?.(ctx);
      updateSpills(room.spills, ctx);
      const r = flightTick(st, input, wind, room.colliders, TICK, { rand: () => 0.5 }, {});
      opts.onTick?.(n.plane, wind(n.plane.x, n.plane.y), room.colliders.length);
      n.t += TICK;
      if (r === 'crashed' || r === 'grounded' || damagePct(n.plane.damage) >= 90) return die();
      const hw = planeHull(st);
      const bb = bounds(hw);
      for (const h of room.hazards) {
        if (bb.x1 < h.x || bb.x0 > h.x + h.w || bb.y1 < h.y || bb.y0 > h.y + h.h) continue;
        if (polyVsBox(hw, { ...h })) return die();
      }
      let moved = false;
      for (const o of room.objects) {
        const t = o.def.t;
        if (t !== 'switch' && t !== 'star' && t !== 'stairsUp' && t !== 'stairsDown' && t !== 'transport' && t !== 'exit') continue;
        const tr = o.trigger?.();
        if (!tr || bb.x1 < tr.x || bb.x0 > tr.x + tr.w || bb.y1 < tr.y || bb.y0 > tr.y + tr.h || !polyVsBox(hw, { ...tr })) continue;
        if (t === 'switch') {
          const g = typeof o.def.group === 'string' ? o.def.group : 'lights';
          if (g !== 'lights' && !n.switches.has(`touched:${o.id}`)) {
            n.switches.set(`touched:${o.id}`, true);
            n.switches.set(g, !(n.switches.get(g) ?? true));
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
          if (typeof o.def.group === 'string') {
            const g = o.def.group;
            const on = g.startsWith('!') ? !(n.switches.get(g.slice(1)) ?? true) : (n.switches.get(g) ?? true);
            if (!on) continue;
          }
          n.trace = [...n.trace, `transport -> ${o.def.to} @${(totalT + n.t).toFixed(1)}s`];
          arrive(o.def.to, Number(o.def.ax), Number(o.def.ay), Number(o.def.facing) < 0 ? -1 : 1);
          moved = true;
          break;
        }
      }
      if (moved) continue;
      if (target && (n.got.includes(target) || n.got.includes('exit'))) return n;
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
      got: [],
      trace: [],
      thrown: f,
      steps: null,
    };
    for (const s of f.steps) {
      const prev: Node = n!;
      n = advance(prev, { dir: s.dir, pitch: s.pitch, boost: false }, '-', () => {});
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
  const scoreOf = (n: Node, target: string): number => {
    const star = starAt.get(target)!;
    const dist = distTo(star.room);
    const d = dist.get(n.key) ?? 99;
    const q = planePx(n.plane);
    let best = -1e9;
    if (n.key === star.room) best = towardStar(q.x, q.y, star.it.x, star.it.y);
    else for (const w of map.get(n.key) ?? []) if ((dist.get(w.to) ?? 99) < d) best = Math.max(best, progress(w, q.x, q.y));
    // a flight in a steep dive or about to stall is worth less than its position suggests
    const dive = Math.max(0, -n.plane.vy - 0.9) * 60 + Math.max(0, -n.plane.theta - 0.5) * 80;
    const slow = n.plane.V < 1 ? (1 - n.plane.V) * 120 : 0;
    return -d * 10000 + best - damagePct(n.plane.damage) * 3 - dive - slow;
  };

  /** How good a checkpoint is to throw from, for `target`. */
  const cpRank = (cp: Checkpoint, target: string): number => {
    const star = starAt.get(target)!;
    const d = distTo(star.room).get(cp.room) ?? 99;
    return -d * 10000 + (cp.room === star.room ? towardStar(cp.x, cp.y, star.it.x, star.it.y) : 0);
  };

  const flightOf = (n: Node): Flight => {
    const steps: Flight['steps'] = [];
    for (let s = n.steps; s; s = s.prev) steps.push({ dir: s.dir, pitch: s.pitch });
    return { ...n.thrown, steps: steps.reverse() };
  };
  const flights: Flight[] = [];
  // the search is deterministic: a checkpoint already thrown from would only fly the same flights again
  const thrownFrom = new Set<string>();
  const cpKey = (cp: Checkpoint, target: string) => `${target}|${cp.room}@${Math.round(cp.x)},${Math.round(cp.y)},${cp.facing}`;
  outer: while (got.size < goals.length) {
    const target = nextStar(flying?.[0]?.key ?? checkpoint.room, got);
    if (!target) break;
    if (!flying) {
      if (sheets > maxSheets) break;
      thrownFrom.add(cpKey(checkpoint, target));
      flying = throwsFrom(checkpoint);
      if (sheets > 0 || got.size > 0) trace.push(`sheet ${sheets} from ${checkpoint.room} (${Math.round(checkpoint.x)},${Math.round(checkpoint.y)})`);
    }
    let beam = flying;
    flying = null;
    // where the flights that end leave the checkpoint: the best one not thrown from yet is where the next sheet goes
    let bestDeath: { cp: Checkpoint; rank: number; trace: string[]; at: string; node?: Node } | null = null;
    const consider = (cp: Checkpoint, n?: Node) => {
      if (thrownFrom.has(cpKey(cp, target))) return;
      const rank = cpRank(cp, target);
      if (!bestDeath || rank > bestDeath.rank) {
        const q = n ? planePx(n.plane) : { x: cp.x, y: cp.y };
        bestDeath = { cp, rank, trace: n?.trace ?? [], at: `${n?.key ?? cp.room} @${Math.round(q.x)},${Math.round(q.y)} t${(n?.t ?? 0).toFixed(1)}`, node: n };
      }
    };
    consider(checkpoint);
    const onDeath = (n: Node) => consider(n.checkpoint, n);
    for (;;) {
      if (stepsLeft-- <= 0) break outer;
      const next: Node[] = [];
      let done: Node | null = null;
      for (const n of beam) {
        for (const turn of [false, true]) {
          if (turn && n.plane.turn) continue;
          for (const pitch of pitches) {
            const r = advance(n, { dir: turn ? ((n.plane.facing > 0 ? -1 : 1) as -1 | 1) : 0, pitch, boost: false }, target, onDeath);
            if (!r) continue;
            if (r.got.includes(target) || r.got.includes('exit')) {
              done = r;
              break;
            }
            r.score = scoreOf(r, target);
            next.push(r);
          }
          if (done) break;
        }
        if (done) break;
      }
      if (done) {
        // found it: carry on flying from here (the flight goes on after a star)
        for (const id of done.got)
          if (id !== 'exit' && !got.has(id)) {
            got.add(id);
            order.push(id);
          }
        totalT += done.t;
        for (const s of done.trace.filter((s) => s.startsWith('->') || s.startsWith('stairs') || s.startsWith('transport')))
          visited.push(s.split(' ').slice(-2)[0]);
        trace.push(...done.trace);
        checkpoint = done.checkpoint;
        switchesNow = done.switches;
        if (done.got.includes('exit') || got.size >= goals.length) {
          flights.push(flightOf(done));
          break outer;
        }
        opts.log?.(`star ${target} in ${starAt.get(target)!.room} after ${totalT.toFixed(1)}s, ${sheets} sheets`);
        done.t = 0;
        done.got = [];
        done.trace = [];
        flying = [done];
        continue outer;
      }
      if (!next.length) break;
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
        if (beam.length >= beamW) break;
      }
    }
    // every flight of this sheet is over: the next one is thrown from the best new checkpoint any of them reached
    const bd = bestDeath as { cp: Checkpoint; rank: number; trace: string[]; at: string; node?: Node } | null;
    if (!bd) break;
    opts.log?.(`sheet ${sheets} for ${target}: best flight ended in ${bd.at} -> next from ${cpKey(bd.cp, target)} [${bd.trace.join(' | ')}]`);
    // the flight that got there is part of the way (a checkpoint carried over from before needs none)
    if (bd.node) {
      flights.push(flightOf(bd.node));
      switchesNow = bd.node.switches;
    }
    checkpoint = bd.cp;
    if (!visited.includes(checkpoint.room)) visited.push(checkpoint.room);
    sheets++;
  }
  const solved = got.size >= goals.length;
  const stuckTarget = nextStar(checkpoint.room, got);
  const short = stuckTarget ? distTo(starAt.get(stuckTarget)!.room).get(checkpoint.room) : undefined;
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
