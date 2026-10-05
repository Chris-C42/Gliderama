/**
 * A beam-search pilot for hand-built levels: tries short stretches of stick input (turn or not, pitch),
 * keeps the most promising flights and carries on, room by room. If it finds a way to the exit, a person
 * with the same controls can too. Used to check that campaign levels are passable.
 */

import { analyzeDesign } from '../../src/paper/aero';
import { buildMesh } from '../../src/paper/build';
import type { Design } from '../../src/paper/design';
import { buildSimRoom, type SimRoom } from '../../src/game/sim';
import { flightTick, planeHull, type TickState } from '../../src/game/flightTick';
import { bounds, polyVsBox, profileHull } from '../../src/game/collide';
import { neighbour, parseKey, type LevelDef } from '../../src/game/level';
import { createPlane, launch, planePx, type FlightInput, type Plane } from '../../src/physics/flight';
import { damagePct } from '../../src/physics/damage';
import { PX_PER_M, ROOM_H, ROOM_W } from '../../src/physics/config';
import type { ObjCtx, SessionApi, WindOut } from '../../src/game/objects/types';
import type { Rect } from '../../src/world/types';
import { stairsArrival, stairsDownGeom, stairsUpGeom } from '../../src/world/stairs';
import { spillWind } from '../../src/game/roomAir';

const TICK = 1 / 120;

interface Goal {
  kind: 'side' | 'up' | 'down' | 'rect' | 'stairs';
  side?: 'left' | 'right';
  /** Top of the doorway for side exits (being higher than this at the wall is no use). */
  from?: number;
  rect?: Rect;
  holeCx?: number;
}

interface Node {
  key: string;
  plane: Plane;
  groundT: number;
  stillT: number;
  t: number;
  switches: Map<string, boolean>;
  route: number;
  score: number;
  trace: string[];
}

export interface SolveResult {
  solved: boolean;
  t: number;
  damage: number;
  rooms: string[];
  /** Best node's room and position when it failed. */
  stuck?: string;
  trace: string[];
}

function clonePlane(p: Plane): Plane {
  return { ...p, damage: { ...p.damage }, mods: { ...p.mods }, turn: p.turn ? { ...p.turn } : null };
}

/** The rooms from the start to the exit, and how each one is left. */
function routeOf(level: LevelDef): { key: string; goal: Goal }[] {
  const out: { key: string; goal: Goal }[] = [];
  const seen = new Set<string>();
  let key = level.start.room;
  for (let n = 0; n < 20; n++) {
    seen.add(key);
    const room = level.rooms[key];
    const ex = room.items.find((i) => i.t === 'exit');
    if (ex) {
      out.push({ key, goal: { kind: 'rect', rect: { x: ex.x, y: ex.y, w: ex.w ?? 40, h: ex.h ?? 60 } } });
      return out;
    }
    let moved = false;
    for (const side of ['right', 'left', 'up', 'down'] as const) {
      const span = room.exits[side];
      if (!span) continue;
      const next = neighbour(level, key, side);
      const goal: Goal =
        side === 'up' || side === 'down' ? { kind: side, holeCx: (span.from + span.to) / 2 } : { kind: 'side', side, from: span.from };
      if (!next && (span as { exit?: boolean }).exit) {
        out.push({ key, goal });
        return out;
      }
      if (next && !seen.has(next)) {
        out.push({ key, goal });
        key = next;
        moved = true;
        break;
      }
    }
    // stairs to a room not visited yet
    if (!moved)
      for (const it of room.items) {
        if (it.t !== 'stairsUp' && it.t !== 'stairsDown') continue;
        const way = it.t === 'stairsUp' ? 'up' : 'down';
        const next = neighbour(level, key, way);
        if (!next || seen.has(next)) continue;
        out.push({ key, goal: { kind: 'stairs', rect: it.t === 'stairsUp' ? stairsUpGeom(it).door : stairsDownGeom(it).trigger } });
        key = next;
        moved = true;
        break;
      }
    if (!moved) return out;
  }
  return out;
}

/** How promising a position is: distance made good, with height counted at about a glide ratio. */
function progress(goal: Goal, x: number, y: number): number {
  const H = 4.5;
  if (goal.kind === 'side') return (goal.side === 'right' ? x : 640 - x) + H * (340 - Math.max(y, (goal.from ?? 16) + 12));
  if (goal.kind === 'up') return 4 * (360 - y) - 0.6 * Math.abs(x - goal.holeCx!);
  if (goal.kind === 'down') return 2 * y + 1200 - 2.5 * Math.abs(x - goal.holeCx!);
  const r = goal.rect!; // the exit door, or the stairs to the next floor
  const cx = r.x + r.w / 2;
  const dx = Math.max(0, Math.abs(x - cx) - r.w / 2);
  const below = Math.max(0, y - (r.y + r.h));
  return 1500 - dx - 3 * below + H * (340 - Math.max(y, r.y + 10));
}

export function solveLevel(
  level: LevelDef,
  design: Design,
  opts: { beam?: number; step?: number; maxT?: number; throws?: { angle: number; power: number }[]; onDeath?: (key: string, why: string, x: number, y: number) => void } = {},
): SolveResult {
  const { build, aero } = analyzeDesign(design);
  const mesh = buildMesh(build, aero.cg);
  const hullLocal = profileHull(mesh);
  const halfLen = ((mesh.max.x - mesh.min.x) * PX_PER_M) / 2;
  const route = routeOf(level);
  const routeIndex = new Map(route.map((r, i) => [r.key, i]));
  const rooms = new Map<string, SimRoom>();
  const roomOf = (k: string) => {
    let r = rooms.get(k);
    if (!r) rooms.set(k, (r = buildSimRoom(level.rooms[k], { level, key: k })));
    return r;
  };
  const beamW = opts.beam ?? 60;
  const stepTicks = Math.round((opts.step ?? 0.35) / TICK);
  const maxT = opts.maxT ?? 70;
  const pitches = [-0.8, -0.3, 0, 0.4, 0.9];
  let solved: Node | null = null;
  let best: Node | null = null;

  const throws = opts.throws ?? [
    { angle: 0, power: 0.3 },
    { angle: 0, power: 0.5 },
    { angle: 0.15, power: 0.4 },
    { angle: 0.3, power: 0.6 },
    { angle: -0.15, power: 0.35 },
    { angle: 0.1, power: 0.75 },
  ];
  let beam: Node[] = throws.map(({ angle, power }) => {
    const plane = createPlane(aero);
    launch(plane, level.start.x, level.start.y, level.start.facing > 0 ? angle : Math.PI - angle, power);
    return { key: level.start.room, plane, groundT: 0, stillT: 0, t: 0, switches: new Map(), route: 0, score: 0, trace: [`throw a${angle} p${power}`] };
  });

  /** Advance one node by one stretch of input; null when the flight is over (crash, landing, hazard). */
  const advance = (n0: Node, input: FlightInput): Node | null => {
    const n: Node = { ...n0, plane: clonePlane(n0.plane), switches: new Map(n0.switches), trace: n0.trace };
    const st: TickState = { plane: n.plane, aero, hullLocal, halfLen, groundT: n.groundT, stillT: n.stillT };
    let room = roomOf(n.key);
    const api = {
      setSwitch: (g: string, on: boolean) => void n.switches.set(g, on),
      switchOn: (g: string) => n.switches.get(g) ?? true,
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
    for (let k = 0; k < stepTicks; k++) {
      ctx.time = n.t;
      for (const o of room.objects) if (o.def.t === 'fan' || o.def.t === 'floorVent') o.update?.(ctx);
      const r = flightTick(st, input, wind, room.colliders, TICK, { rand: () => 0.5 }, {});
      n.t += TICK;
      const pos = planePx(n.plane);
      const goal = route[routeIndex.get(n.key) ?? 0]?.goal;
      // the exit door
      if (goal?.kind === 'rect') {
        const g = goal.rect!;
        if (pos.x >= g.x && pos.x <= g.x + g.w && pos.y >= g.y && pos.y <= g.y + g.h) {
          solved = n;
          return n;
        }
      }
      if (r === 'crashed' || r === 'grounded' || damagePct(n.plane.damage) >= 90) {
        opts.onDeath?.(n.key, r === 'crashed' ? 'crashed' : r === 'grounded' ? 'grounded' : 'damage', pos.x, pos.y);
        return null;
      }
      const hw = planeHull(st);
      const bb = bounds(hw);
      for (const h of room.hazards) {
        if (bb.x1 < h.x || bb.x0 > h.x + h.w || bb.y1 < h.y || bb.y0 > h.y + h.h) continue;
        if (polyVsBox(hw, { ...h })) {
          opts.onDeath?.(n.key, 'hazard', pos.x, pos.y);
          return null;
        }
      }
      for (const o of room.objects) {
        if (o.def.t !== 'switch' || !o.trigger) continue;
        const tr = o.trigger();
        if (tr && polyVsBox(hw, { ...tr })) {
          const g = typeof o.def.group === 'string' ? o.def.group : 'lights';
          if (!n.switches.has(`touched:${o.id}`)) {
            n.switches.set(`touched:${o.id}`, true);
            n.switches.set(g, !(n.switches.get(g) ?? true));
          }
        }
      }
      // stairs: out at the matching stairs on the next floor, gliding level (as the session does)
      let tookStairs = false;
      for (const o of room.objects) {
        if ((o.def.t !== 'stairsUp' && o.def.t !== 'stairsDown') || !o.trigger) continue;
        const tr = o.trigger();
        if (!tr || !polyVsBox(hw, { ...tr })) continue;
        const way = o.def.t === 'stairsUp' ? 'up' : 'down';
        const next = neighbour(level, n.key, way);
        if (!next) continue;
        const a = stairsArrival(level.rooms[next].items, way);
        const p = n.plane;
        p.x = a.x / PX_PER_M;
        p.y = (ROOM_H - a.y) / PX_PER_M;
        p.facing = a.facing;
        p.turn = null;
        p.theta = 0;
        p.q = 0;
        p.vx = a.facing * aero.perf.vBest;
        p.vy = 0;
        p.liftT = 0;
        p.exitPending = false;
        p.exitBoost = 0;
        n.key = next;
        room = roomOf(next);
        n.trace = [...n.trace, `stairs ${way} -> ${next} @${n.t.toFixed(1)}s`];
        tookStairs = true;
        break;
      }
      if (tookStairs) continue;
      let side: 'left' | 'right' | 'up' | 'down' | null = null;
      if (pos.x < -2) side = 'left';
      else if (pos.x > ROOM_W + 2) side = 'right';
      else if (pos.y < -2) side = 'up';
      else if (pos.y > ROOM_H + 2) side = 'down';
      if (side) {
        const def = level.rooms[n.key];
        const span = def.exits[side];
        const next = neighbour(level, n.key, side);
        if (!next) {
          if (span && (span as { exit?: boolean }).exit) {
            solved = n;
            return n;
          }
          return null;
        }
        if (side === 'left') n.plane.x += ROOM_W / PX_PER_M;
        if (side === 'right') n.plane.x -= ROOM_W / PX_PER_M;
        if (side === 'up') n.plane.y -= ROOM_H / PX_PER_M;
        if (side === 'down') n.plane.y += ROOM_H / PX_PER_M;
        n.key = next;
        room = roomOf(next);
        n.trace = [...n.trace, `-> ${next} @${n.t.toFixed(1)}s`];
      }
      if (n.t > maxT) return null;
    }
    n.groundT = st.groundT;
    n.stillT = st.stillT;
    const q = planePx(n.plane);
    const ri = routeIndex.get(n.key) ?? 0;
    n.route = ri;
    // a flight in a steep dive or about to stall is worth less than its position suggests
    const dive = Math.max(0, -n.plane.vy - 0.9) * 60 + Math.max(0, -n.plane.theta - 0.5) * 80;
    const slow = n.plane.V < 1 ? (1 - n.plane.V) * 120 : 0;
    n.score = ri * 10000 + progress(route[ri].goal, q.x, q.y) - damagePct(n.plane.damage) * 3 - dive - slow;
    return n;
  };

  for (let step = 0; step < Math.ceil(maxT / (stepTicks * TICK)) && !solved; step++) {
    const next: Node[] = [];
    for (const n of beam) {
      for (const turn of [false, true]) {
        if (turn && n.plane.turn) continue;
        for (const pitch of pitches) {
          const input: FlightInput = { dir: turn ? ((n.plane.facing > 0 ? -1 : 1) as -1 | 1) : 0, pitch, boost: false };
          const r = advance(n, input);
          if (solved) break;
          if (r) next.push({ ...r, trace: r.trace.length > 40 ? r.trace : r.trace });
        }
        if (solved) break;
      }
      if (solved) break;
    }
    if (solved || next.length === 0) break;
    // keep the best, one per coarse state so the beam stays diverse, and keep some flights in the rooms
    // behind the frontier: a flight that has just entered the next room may be doomed
    next.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    beam = [];
    const front = next[0].route;
    let atFront = 0;
    for (const n of next) {
      const q = planePx(n.plane);
      const k = `${n.key}|${Math.round(q.x / 20)}|${Math.round(q.y / 10)}|${n.plane.facing}|${n.plane.turn ? 1 : 0}`;
      if (seen.has(k)) continue;
      if (n.route === front && atFront >= Math.ceil(beamW * 0.6)) continue;
      seen.add(k);
      if (n.route === front) atFront++;
      beam.push(n);
      if (beam.length >= beamW) break;
    }
    if (!best || beam[0].score > best.score) best = beam[0];
  }
  const fin = (solved ?? best) as Node | null;
  const visited = fin ? [...new Set([level.start.room, ...fin.trace.filter((s) => s.startsWith('->')).map((s) => s.split(' ')[1])])] : [];
  if (solved) {
    const s = solved as Node;
    return { solved: true, t: s.t, damage: damagePct(s.plane.damage), rooms: visited, trace: s.trace };
  }
  const b = best as Node | null;
  const q = b ? planePx(b.plane) : { x: 0, y: 0 };
  return { solved: false, t: b?.t ?? 0, damage: b ? damagePct(b.plane.damage) : 0, rooms: visited, stuck: b ? `${b.key} @${Math.round(q.x)},${Math.round(q.y)}` : 'nowhere', trace: b?.trace ?? [] };
}

export { parseKey };
