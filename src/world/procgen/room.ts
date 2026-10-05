/**
 * Building one room: plan the air, fly the reference pilots through the bare shell, measure where they flew, dress the
 * room around that corridor, fly again, repair if needed and finally add the collectibles along the flown path.
 */

import type { Rng } from '../../core/rng';
import { buildSimRoom } from '../../game/sim';
import { LAYOUT, type ItemDef, type RoomDef } from '../types';
import { airItems, pilotVents, planAir, toX, type AirPlan } from './air';
import { dress, type HazardPlan, type StartPlan } from './dress';
import { entriesFor, flyRoom, pilotSpec, ENTRY_HIGH, ENTRY_LOW } from './fly';
import { referencePlanes } from './fleet';
import { Band } from './geom';
import type { Scene, Placed } from './scene';
import type { Perch, RoomLook, RoomTemplate } from './themes';
import type { Difficulty, FlightRun, RoomIO, RoomReport, Side } from './types';

export interface RoomContext {
  difficulty: Difficulty;
  workbench: boolean;
  /** The floor's rooms built so far: air rising from the room below carries on through a floor opening. */
  rooms?: Record<string, RoomDef>;
}

export interface BuiltRoom {
  def: RoomDef;
  report: RoomReport;
  start?: { x: number; y: number; facing: 1 | -1 };
}

const MAX_ATTEMPTS = 8;

/** Collider top of a default desk (y = 242, slab at +2): the surface the workbench sits on. */
const BENCH_TOP = 244;

// ---------------------------------------------------------------------------------------------
// Planning

interface RoomFlags {
  dark: boolean;
  night: boolean;
  calm: boolean;
}

function hazardCounts(d: Difficulty, io: RoomIO, calm: boolean, rng: Rng, vertical: boolean) {
  const f = d.floor;
  const none = { candles: 0, drips: 0, fans: 0, ceilVents: 0, tallShelf: false, dark: false, night: false };
  if (calm) return { ...none, night: d.twist === 'night' };
  const first = io.index === 0 ? 0.5 : 1;
  const windy = d.twist === 'windy' || d.twist === 'gusty';
  const pick = (p: number) => rng.chance(p * first);
  let candles = f === 0 ? (pick(0.25) ? 1 : 0) : pick(Math.min(0.65, 0.3 + 0.04 * f)) ? (f >= 5 && rng.chance(0.3) ? 2 : 1) : 0;
  let drips = f < 2 ? 0 : pick(Math.min(0.4, 0.1 * (f - 1))) ? 1 : 0;
  let fans = f < 3 && !windy ? 0 : pick(Math.min(0.5, 0.1 * (f - 2) + 0.1) + (windy ? 0.35 : 0)) ? (windy && f >= 4 && rng.chance(0.4) ? 2 : 1) : 0;
  let ceilVents = f < 3 ? 0 : pick(Math.min(0.35, 0.06 * (f - 2) + 0.05)) ? 1 : 0;
  let tallShelf = f < 1 ? false : pick(Math.min(0.45, 0.07 * f + 0.1));
  if (vertical) {
    // stairwell rooms stay open: no fans or ceiling vents blowing around the opening
    fans = 0;
    ceilVents = 0;
    tallShelf = false;
  }
  const dark = d.twist === 'lights-out' || (f >= 2 && pick(Math.min(0.35, 0.06 * (f - 1))) && io.entry !== 'up' && io.entry !== 'down');
  const night = d.twist === 'night' || (f >= 2 && rng.chance(Math.min(0.3, 0.05 * f)));
  // at most two hazards per room (three on later floors)
  const cap = f >= 6 ? 3 : 2;
  const hazards: ('candles' | 'drips' | 'fans' | 'ceilVents' | 'tallShelf')[] = [];
  if (candles) hazards.push('candles');
  if (drips) hazards.push('drips');
  if (fans) hazards.push('fans');
  if (ceilVents) hazards.push('ceilVents');
  if (tallShelf) hazards.push('tallShelf');
  const keep = new Set(rng.shuffle(hazards).slice(0, cap));
  if (!keep.has('candles')) candles = 0;
  if (!keep.has('drips')) drips = 0;
  if (!keep.has('fans')) fans = 0;
  if (!keep.has('ceilVents')) ceilVents = 0;
  if (!keep.has('tallShelf')) tallShelf = false;
  return { candles, drips, fans, ceilVents, tallShelf, dark, night };
}

function startPlan(io: RoomIO, template: RoomTemplate, rng: Rng): StartPlan {
  const dirX = io.dirX;
  const perches = template.perches.filter((p) => p !== 'bed' || dirX > 0);
  const perch: Perch = perches.length ? rng.pick(perches) : 'wall';
  const u = rng.int(52, 108);
  const x = toX(dirX, u);
  if (perch === 'desk') return { x, y: 188, perch };
  if (perch === 'bed') return { x, y: 190, perch };
  if (perch === 'shelf') {
    const shelfH = rng.int(150, 180);
    return { x, y: LAYOUT.floor - shelfH - 26, perch, shelfH };
  }
  return { x, y: rng.int(128, 170), perch };
}

function shellExits(io: RoomIO): RoomDef['exits'] {
  const ex: RoomDef['exits'] = {};
  if (io.entry !== 'start' && io.entrySpan) ex[io.entry as Side] = { from: io.entrySpan.from, to: io.entrySpan.to };
  ex[io.exit] = { ...io.exitSpan };
  return ex;
}

interface Plan {
  look: RoomLook;
  flags: RoomFlags;
  air: AirPlan;
  hazards: HazardPlan;
  counts: { candles: number; drips: number; tallShelf: boolean };
  start?: StartPlan;
}

function planRoom(ctx: RoomContext, io: RoomIO, template: RoomTemplate, rng: Rng, attempt: number): Plan {
  const d = ctx.difficulty;
  const calm = ctx.workbench && io.index === io.count - 1;
  const vertical = io.entry === 'up' || io.entry === 'down' || io.exit === 'up' || io.exit === 'down';
  const safe = attempt >= 4;
  const hz = safe ? { candles: 0, drips: 0, fans: 0, ceilVents: 0, tallShelf: false, dark: d.twist === 'lights-out', night: d.twist === 'night' } : hazardCounts(d, io, calm, rng.fork('hazards'), vertical);
  const look = rng.fork('look').pick(template.looks);
  const start = io.index === 0 ? startPlan(io, template, rng.fork('start')) : undefined;
  const air = planAir(io, rng.fork('air'), {
    difficulty: d,
    attempt,
    calm,
    workbench: calm,
    startU: start ? (io.dirX > 0 ? start.x : 640 - start.x) : undefined,
    fans: hz.fans,
    ceilVents: hz.ceilVents,
  });
  const flameMargin = d.floor === 0 ? 46 : Math.max(20, 38 - 3 * d.floor);
  const margin = attempt >= 2 ? 22 : 16;
  return {
    look,
    flags: { dark: hz.dark, night: hz.night, calm },
    air,
    hazards: { candles: hz.candles, drips: hz.drips, tallShelf: hz.tallShelf, flameMargin, margin },
    counts: { candles: hz.candles, drips: hz.drips, tallShelf: hz.tallShelf },
    start,
  };
}

// ---------------------------------------------------------------------------------------------
// Flying

interface FlightSet {
  runs: FlightRun[];
  /** Per plane: every entry passed. */
  planeOk: Record<string, boolean>;
  ok: boolean;
  both: boolean;
}

function benchRestart(air: AirPlan, io: RoomIO): { x: number; y: number } | undefined {
  if (!air.bench) return undefined;
  const top = BENCH_TOP;
  void io;
  return { x: air.bench.x + air.bench.w / 2, y: top - 16 };
}

interface FlyInput {
  def: RoomDef;
  /** The rooms built so far (for the air coming up through a floor opening). */
  rooms?: Record<string, RoomDef>;
  io: RoomIO;
  air: AirPlan;
  start?: { x: number; y: number };
  /** Light switch trigger every ordinary entry has to touch. */
  touch?: { x: number; y: number; w: number; h: number };
  /** Workbench desk to land on (item x, w, top y). */
  bench?: { x0: number; x1: number; top: number };
  needBoth: boolean;
}

function flyAll(inp: FlyInput): FlightSet {
  const planes = referencePlanes();
  const sim = buildSimRoom(inp.def, inp.rooms ? { level: { rooms: { ...inp.rooms, [inp.io.key]: inp.def } }, key: inp.io.key } : undefined);
  const spec = pilotSpec(inp.io, pilotVents(inp.air));
  const entries = entriesFor(inp.io, { start: inp.start, bench: benchRestart(inp.air, inp.io) });
  const runs: FlightRun[] = [];
  const planeOk: Record<string, boolean> = {};
  for (const plane of planes) {
    let ok = true;
    for (const e of entries) {
      const touch = e.id === 'bench' ? undefined : inp.touch;
      const r = flyRoom(sim, plane, spec, e, { touch });
      runs.push(r);
      if (!r.ok) {
        ok = false;
        break;
      }
    }
    if (ok && inp.bench) {
      // reachable workbench: from the low door entry, climb if needed, then hover down onto the desk
      const lowEntry = entries.find((e) => e.id === 'door-lo');
      if (lowEntry) {
        const landSpec = pilotSpec(inp.io, pilotVents(inp.air), { land: inp.bench });
        const r = flyRoom(sim, plane, landSpec, { ...lowEntry, id: 'land' });
        runs.push(r);
        if (!r.ok) ok = false;
      }
    }
    planeOk[plane.id] = ok;
  }
  const both = planes.every((p) => planeOk[p.id]);
  const some = planes.some((p) => planeOk[p.id]);
  return { runs, planeOk, ok: inp.needBoth ? both : some, both };
}

function nominalPath(runs: FlightRun[], plane?: string): { x: number; y: number }[] {
  const prefer = ['door-lo', 'start', 'above', 'below'];
  for (const id of prefer) {
    const r = runs.find((q) => q.ok && q.entry === id && (!plane || q.plane === plane));
    if (r) return r.path;
  }
  return runs.find((q) => q.ok)?.path ?? [];
}

// ---------------------------------------------------------------------------------------------
// The flight band

function buildBand(runs: FlightRun[], planeOk: Record<string, boolean>, io: RoomIO, air: AirPlan): Band {
  const band = new Band();
  // (the restart from the workbench starts on the desk itself, so its first moments say nothing about free air)
  for (const r of runs) if (r.ok && planeOk[r.plane] && r.entry !== 'bench' && r.entry !== 'land') band.addPath(r.path, 13, 13);
  // thermal columns and openings: reserve the whole shaft
  for (const v of air.vents) {
    if (v.role === 'hole') band.addBox(v.x - 40, v.x + v.w + 40, 0, 340);
    else band.addBox(v.x - 12, v.x + v.w + 12, 24, 340);
  }
  if (io.exit === 'up' || io.exit === 'down' || io.entry === 'up' || io.entry === 'down') {
    const span = io.exit === 'up' || io.exit === 'down' ? io.exitSpan : io.entrySpan!;
    band.addBox(span.from - 14, span.to + 14, io.entry === 'up' || io.exit === 'up' ? 0 : 200, io.entry === 'up' || io.exit === 'up' ? 150 : 340);
  }
  // the doorway the plane comes through
  if (io.entry === 'left' || io.entry === 'right') {
    const x0 = io.entry === 'left' ? 0 : 560;
    band.addBox(x0, x0 + 80, ENTRY_HIGH - 14, ENTRY_LOW + 14);
  }
  const exitSide = io.exit === 'left' || io.exit === 'right';
  if (exitSide) {
    const x0 = io.exit === 'left' ? 0 : 580;
    band.addBox(x0, x0 + 60, Math.max(io.exitSpan.from, 60), 215 + 14);
  }
  return band;
}

// ---------------------------------------------------------------------------------------------
// Collectibles

interface StarSpot {
  x: number;
  y: number;
}

function clearOfSolids(scene: Scene, x: number, y: number, m: number): boolean {
  if (x < 28 || x > 612 || y < 28 || y > 318) return false;
  for (const p of scene.placed) for (const b of p.boxes) if (x > b.x - m && x < b.x + b.w + m && y > b.y - m && y < b.y + b.h + m) return false;
  // keep off flames and fan heads' danger zones
  for (const p of scene.placed) if (p.item.t === 'candle' && Math.abs(x - (p.item.x + 3)) < 26 && y > p.item.y - 40 && y < p.item.y + 6) return false;
  return true;
}

/** Evenly spread points along the path (by x progress), skipping thermalling loops. */
function alongPath(path: { x: number; y: number }[], io: RoomIO, fractions: number[]): StarSpot[] {
  if (path.length === 0) return [];
  const dirX = io.dirX;
  // keep points that make forward progress (drop the zigzag inside a thermal)
  const prog: { x: number; y: number }[] = [];
  let best = -Infinity;
  for (const p of path) {
    const u = dirX > 0 ? p.x : 640 - p.x;
    if (u > best + 6) {
      prog.push(p);
      best = u;
    }
  }
  if (prog.length === 0) return [];
  const u0 = dirX > 0 ? prog[0].x : 640 - prog[0].x;
  const u1 = dirX > 0 ? prog[prog.length - 1].x : 640 - prog[prog.length - 1].x;
  return fractions.map((f) => {
    const target = u0 + (u1 - u0) * f;
    let bestP = prog[0];
    let bd = Infinity;
    for (const p of prog) {
      const u = dirX > 0 ? p.x : 640 - p.x;
      const dd = Math.abs(u - target);
      if (dd < bd) {
        bd = dd;
        bestP = p;
      }
    }
    return { x: bestP.x, y: bestP.y };
  });
}

function collectibles(scene: Scene, io: RoomIO, path: { x: number; y: number }[], rng: Rng, d: Difficulty, calm: boolean, key: string): ItemDef[] {
  const out: ItemDef[] = [];
  const f = d.floor;
  const nStars = calm ? rng.int(1, 2) : f === 0 ? rng.int(2, 3) : rng.int(1, 3);
  const fr = nStars === 1 ? [0.5] : nStars === 2 ? [0.35, 0.72] : [0.25, 0.5, 0.78];
  const spots = alongPath(path, io, fr.map((q) => q + rng.float(-0.06, 0.06)));
  let n = 0;
  for (let i = 0; i < spots.length; i++) {
    const risky = !calm && f >= 1 && i > 0 && rng.chance(Math.min(0.6, 0.2 + 0.07 * f));
    let placed: StarSpot | null = null;
    const tries = risky ? [[0, 34], [0, -30], [18, 40], [-18, 40], [0, 24]] : [[0, 0], [0, 10], [0, -10], [10, 0], [-10, 0]];
    for (const [dx, dy] of tries) {
      const x = Math.round(spots[i].x + dx);
      const y = Math.round(spots[i].y + dy);
      if (clearOfSolids(scene, x, y, 16)) {
        placed = { x, y };
        break;
      }
    }
    if (!placed) continue;
    out.push({ t: 'star', id: `${key}:star:${n++}`, x: placed.x, y: placed.y });
  }
  // a roll of tape (repair) and, rarely, a spare sheet
  const extras: { kind: 'tape' | 'sheet'; chance: number }[] = [
    { kind: 'tape', chance: calm ? 0.5 : f === 0 ? 0.15 : 0.25 },
    { kind: 'sheet', chance: calm ? 0.2 : 0.08 },
  ];
  let m = 0;
  for (const ex of extras) {
    if (!rng.chance(ex.chance) || io.index === 0) continue;
    const s = alongPath(path, io, [rng.float(0.3, 0.8)])[0];
    if (!s) continue;
    for (const [dx, dy] of [[0, 14], [0, -14], [14, 0], [-14, 0]]) {
      const x = Math.round(s.x + dx);
      const y = Math.round(s.y + dy);
      if (clearOfSolids(scene, x, y, 14) && !out.some((o) => (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y) < 24 * 24)) {
        out.push({ t: ex.kind, id: `${key}:${ex.kind}:${m++}`, x, y });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Assembling a RoomDef

const ITEM_ORDER = ['rug', 'frontDoor', 'window', 'frame', 'poster', 'wallClock', 'switchPlate', 'pendant'];

function compose(base: RoomDef, scene: Scene, air: AirPlan, extra: ItemDef[]): RoomDef {
  const wallish: ItemDef[] = [];
  const floorish: ItemDef[] = [];
  const small: ItemDef[] = [];
  const runtime: ItemDef[] = [];
  for (const p of scene.placed) {
    const t = p.item.t;
    if (ITEM_ORDER.includes(t)) wallish.push(p.item);
    else if (p.host) small.push(p.item);
    else if (t === 'fan' || t === 'drip' || t === 'switch' || t === 'workbench') runtime.push(p.item);
    else floorish.push(p.item);
  }
  wallish.sort((a, b) => ITEM_ORDER.indexOf(a.t) - ITEM_ORDER.indexOf(b.t));
  const vents = airItems({ ...air, fans: [] }).filter((i) => i.t === 'floorVent' || i.t === 'ceilingVent');
  return { ...base, items: [...wallish, ...floorish, ...vents, ...small, ...runtime, ...extra] };
}

// ---------------------------------------------------------------------------------------------
// The attempt loop
function blame(scene: Scene, runs: FlightRun[]): Placed | null {
  let best: Placed | null = null;
  let bestD = 26;
  for (const r of runs) {
    if (r.ok) continue;
    const pts = [...r.path.slice(-10), r.end];
    for (const p of scene.placed) {
      if (!p.removable) continue;
      const boxes = p.boxes.length ? p.boxes : [p.box];
      for (const b of boxes)
        for (const q of pts) {
          const dx = Math.max(b.x - q.x, 0, q.x - (b.x + b.w));
          const dy = Math.max(b.y - q.y, 0, q.y - (b.y + b.h));
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bestD) {
            bestD = dist;
            best = p;
          }
        }
    }
  }
  return best;
}

/** Everything one attempt decided before dressing. */
interface Attempt {
  io: RoomIO;
  rooms?: Record<string, RoomDef>;
  template: RoomTemplate;
  plan: Plan;
  baseDef: RoomDef;
  start?: { x: number; y: number };
  bench?: { x0: number; x1: number; top: number };
  needBoth: boolean;
}

interface Dressed {
  def: RoomDef;
  scene: Scene;
  flights: FlightSet;
  touch?: { x: number; y: number; w: number; h: number };
}

/** Furnish the room around the corridor the skeleton flights measured, fly it again and repair what the plane hits. */
function dressAndFly(a: Attempt, sk: FlightSet, rng: Rng, minimal: boolean): Dressed | null {
  const { io, plan, baseDef } = a;
  const band = buildBand(sk.runs, sk.planeOk, io, plan.air);
  let switchAt: { x: number; y: number } | undefined;
  if (plan.flags.dark) switchAt = switchSpot(nominalPath(sk.runs), io, a.start);
  const template: RoomTemplate = minimal ? { ...a.template, floorPlan: [], wallPlan: [], pendant: 0, rug: 0 } : a.template;
  const scene = dress({
    io,
    template,
    look: plan.look,
    air: plan.air,
    band,
    stub: { ...baseDef },
    rng: rng.fork('dress'),
    start: minimal ? undefined : plan.start,
    workbench: plan.flags.calm,
    hazards: minimal ? { candles: 0, drips: 0, tallShelf: false, flameMargin: 40, margin: 24 } : plan.hazards,
    switchAt,
    frontDoor: io.index === io.count - 1,
    minimal,
  });
  const touch = switchAt ? { x: switchAt.x - 4, y: switchAt.y - 4, w: 18, h: 24 } : undefined;
  const fly = () => flyAll({ def: compose(baseDef, scene, plan.air, []), rooms: a.rooms, io, air: plan.air, start: a.start, touch, bench: a.bench, needBoth: a.needBoth });
  let flights = fly();
  for (let fix = 0; fix < 4 && !flights.ok; fix++) {
    const victim = blame(scene, flights.runs);
    if (!victim) break;
    scene.remove(victim);
    flights = fly();
  }
  if (!flights.ok) return null;
  return { def: compose(baseDef, scene, plan.air, []), scene, flights, touch };
}

export function buildRoom(ctx: RoomContext, io: RoomIO, template: RoomTemplate, name: string, id: string, rng: Rng): BuiltRoom {
  const d = ctx.difficulty;
  const needBothBase = d.floor <= 1;
  /** The most recent plan whose bare shell could be flown: the fallback's starting point. */
  let passing: { a: Attempt; sk: FlightSet; r: Rng } | null = null;
  let lastAttempt: { a: Attempt; sk: FlightSet } | null = null;

  const finish = (a: Attempt, dressed: Dressed, r: Rng, attempts: number, fallback: boolean): BuiltRoom => {
    const path = nominalPath(dressed.flights.runs);
    const extra = collectibles(dressed.scene, io, path, r.fork('stars'), d, a.plan.flags.calm, io.key);
    const def = compose(a.baseDef, dressed.scene, a.plan.air, extra);
    const start = a.plan.start ? { x: a.plan.start.x, y: a.plan.start.y, facing: io.dirX } : undefined;
    return { def, report: summarize(io, template, attempts, fallback, dressed.flights), start };
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const r = rng.fork(`attempt-${attempt}`);
    const plan = planRoom(ctx, io, template, r, attempt);
    const baseDef: RoomDef = {
      id,
      name,
      wall: plan.look.wall,
      floor: plan.look.floor,
      exits: shellExits(io),
      seed: r.fork('seed').int(1, 9999),
      items: [],
    };
    if (plan.flags.dark) baseDef.dark = true;
    if (plan.flags.night) baseDef.night = true;
    const a: Attempt = {
      io,
      rooms: ctx.rooms,
      template,
      plan,
      baseDef,
      start: plan.start ? { x: plan.start.x, y: plan.start.y } : undefined,
      bench: plan.air.bench ? { x0: plan.air.bench.x + 4, x1: plan.air.bench.x + plan.air.bench.w - 4, top: BENCH_TOP } : undefined,
      needBoth: needBothBase && attempt < 3,
    };

    // 1) fly the bare shell
    const sk = flyAll({ def: { ...baseDef, items: airItems(plan.air) }, rooms: a.rooms, io, air: plan.air, start: a.start, needBoth: a.needBoth });
    lastAttempt = { a, sk };
    if (!sk.ok) continue;
    passing = { a, sk, r };

    // 2) furnish around the corridor, fly again, repair
    const dressed = dressAndFly(a, sk, r, false);
    if (dressed) return finish(a, dressed, r, attempt + 1, false);
  }

  // The full recipe did not work out: the last bare shell that could be flown, with the essentials only
  if (passing) {
    const dressed = dressAndFly(passing.a, passing.sk, passing.r, true);
    if (dressed) return finish(passing.a, dressed, passing.r, MAX_ATTEMPTS, true);
  }
  const bare = lastAttempt!;
  const def: RoomDef = { ...bare.a.baseDef, items: airItems(bare.a.plan.air) };
  const start = bare.a.plan.start ? { x: bare.a.plan.start.x, y: bare.a.plan.start.y, facing: io.dirX } : undefined;
  return { def, report: summarize(io, template, MAX_ATTEMPTS, true, bare.sk), start };
}

function summarize(io: RoomIO, template: RoomTemplate, attempts: number, fallback: boolean, fl: FlightSet): RoomReport {
  return { key: io.key, template: template.id, attempts, fallback, both: fl.both, ok: fl.ok, runs: fl.runs };
}

/** A light switch on the wall near the entry, level with where the plane flies. */
function switchSpot(path: { x: number; y: number }[], io: RoomIO, start?: { x: number; y: number }): { x: number; y: number } {
  const dirX = io.dirX;
  const x0 = start ? start.x : io.entry === 'left' ? 44 : io.entry === 'right' ? 596 : 320;
  const want = x0 + dirX * 84;
  let p = path.length ? path[0] : { x: want, y: 170 };
  let bd = Infinity;
  for (const q of path) {
    const dd = Math.abs(q.x - want);
    if (dd < bd) {
      bd = dd;
      p = q;
    }
  }
  const y = Math.max(64, Math.min(200, Math.round(p.y - 8)));
  const x = Math.max(34, Math.min(596, Math.round(p.x - 5)));
  return { x, y };
}
