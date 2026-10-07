/**
 * A bot pilot for whole houses (the Classic Houses): it plays by the game's rules — throw from the checkpoint,
 * fly (turn or not, pitch, as a player can), and when a flight ends throw the next sheet from wherever the
 * session's checkpoint is by then — until it has collected every goal star (or reached an exit).
 *
 * Each flight is a beam search over short stretches of stick input. Flights are steered towards a target, room by
 * room along the house's map (side openings, floor and ceiling openings, stairs, transports): the nearest star
 * still to find, or, when the way to it is shut or needs air that is switched off, a switch that opens it (Glider
 * PRO houses switch transports and blowers on and off). A flight that dies leaves its checkpoint behind, and the
 * next sheet is thrown from the most promising checkpoint any flight reached; when no flight gets anywhere new, the
 * bot tries another target. Flights that stop getting anywhere (circling in an updraft) are given up. Things that
 * move (balloons, darts, a leaping fish...) are flown alongside, as they go from the moment the plane comes into
 * their room (or a sheet is thrown there: the play lab's autopilot makes the room afresh before each throw), and
 * touching one ends the flight. Helium canisters picked up give the plane gas, kept from flight to flight until it is
 * used, as in the game; while it has some, the bot can hold the gadget button to have a balloon take the plane up. If
 * the bot finds a way through, a player with the same controls can.
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
import { PHYS, PX_PER_M, ROOM_H, ROOM_W } from '../../src/physics/config';
import type { GameObject, ObjCtx, SessionApi, WindOut } from '../../src/game/objects/types';
import { OBJECTS, stillHazards } from '../../src/game/objects';
import { LAYOUT, type ItemDef, type Rect, type RoomDef } from '../../src/world/types';
import { stairsArrival, stairsDownGeom, stairsUpGeom } from '../../src/world/stairs';
import { spillWind, updateSpills } from '../../src/game/roomAir';
import { roomColliders } from '../../src/world/colliders';
import { SHREDDER } from '../../src/world/gliderpro';
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
  /**
   * Where a floor / ceiling opening can be gone through from the part of the room it leads out of (x from..to of the
   * plane's middle): two shafts down a Glider PRO room are one wide opening here (Gliderama rooms have one opening a
   * side), with a block between them.
   */
  spans?: [number, number][];
  /** Stairs doorway, transport mouth. */
  rect?: Rect;
  /** The switch group of a switched transport (`!g`: open while g is switched off). */
  gate?: string;
  /** Switch groups that must all be on for the way to be open (`!g`: g switched off): switched hazards in the way. */
  gates?: string[];
  /** Where in its room the plane goes out by it (room px): an edge's stretch, a doorway, a transport's mouth. */
  mouth?: Rect;
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
  /** The part of the room it is in (see `partMap`). */
  node: string;
  x: number;
  y: number;
  /** The group a switch target flips. */
  group?: string;
}

/** The stick input of one search step, linked back to the step before (a flight's whole input, cheaply shared). */
interface Steps {
  dir: -1 | 0 | 1;
  pitch: number;
  /** The gadget button held for helium (while the plane has gas). */
  helium?: boolean;
  prev: Steps | null;
}

/** A throw and the stick input that followed, one entry per search step (`stepTicks` game ticks each). */
export interface Flight {
  from: Checkpoint;
  angle: number;
  power: number;
  /** Game ticks the player waits before throwing, the room's moving hazards going round (timing a throw past them). */
  wait?: number;
  stepTicks: number;
  steps: { dir: -1 | 0 | 1; pitch: number; helium?: boolean }[];
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
  /** Helium canisters this flight has picked up (room|id; its gas is in the plane's). */
  cans: string[];
  /** The switches the plane is in (a switch flips once each time the plane comes through it, as in the game). */
  over: string[];
  /** Switches with a delay set off in this room, still to flip (group, flight time it flips at; in order). */
  armed: { g: string; at: number }[];
  trace: string[];
  thrown: { from: Checkpoint; angle: number; power: number; wait: number; stepTicks: number };
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
  /** The switches as the bot left them (group → on). */
  switches?: Record<string, boolean>;
  /** Helium gas left (sim s). */
  gas?: number;
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

/** How far round a moving hazard the plane keeps (px): a margin for a near miss to stay one in the game. */
const MOVER_PAD = 3;

/**
 * Where a room's moving hazards (and falling drops) are, tick by tick after the plane comes in (the game makes a
 * room's objects afresh then): fresh copies flown with the switches as they were then, their trigger rects recorded
 * (padded) as needed.
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
 * A room's free space on a grid of CELL px, in the parts a plane can fly between without leaving the room (a shelf
 * across a room, the walls of a maze or of two shafts side by side make several): the part of each cell, -1 where
 * something solid is (or within CLEAR px of it: gaps narrower than a plane is thick are shut).
 */
interface RoomParts {
  part: Int16Array;
  count: number;
  /**
   * Switched hazards that stay put (shredders): the cells they make deadly while on are not part of any part (-2);
   * each lump of such cells, the parts on either side of it and the groups that must be switched off to fly through.
   */
  through: { parts: number[]; groups: string[]; rect: Rect }[];
  /** The lump (index into `through`) of each such cell, else -1. */
  lump: Int16Array;
}
const CELL = 8;
const CLEAR = 3;
const COLS = ROOM_W / CELL;
const ROWS = ROOM_H / CELL;

function roomParts(room: RoomDef): RoomParts {
  const part = new Int16Array(COLS * ROWS);
  const mark = (c: Rect, v: number) => {
    const i0 = Math.max(0, Math.floor((c.x - CLEAR) / CELL));
    const i1 = Math.min(COLS - 1, Math.ceil((c.x + c.w + CLEAR) / CELL) - 1);
    const j0 = Math.max(0, Math.floor((c.y - CLEAR) / CELL));
    const j1 = Math.min(ROWS - 1, Math.ceil((c.y + c.h + CLEAR) / CELL) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (part[j * COLS + i] === 0 || v === -1) part[j * COLS + i] = v;
  };
  for (const c of roomColliders(room)) mark(c, -1);
  // a switched shredder: its body and the strip over its slot (src/game/objects/enemies.ts)
  const switched: { rect: Rect; group: string }[] = [];
  for (const it of room.items)
    if (it.t === 'shredder' && typeof it.group === 'string') {
      const rect = { x: it.x, y: it.y - 22, w: SHREDDER.w, h: SHREDDER.h + 22 };
      switched.push({ rect, group: it.group });
      mark(rect, -2);
    }
  // flood fill the free cells (0 until then) into parts 1, 2, ... (then counted from 0)
  let count = 0;
  const stack: number[] = [];
  for (let k = 0; k < part.length; k++) {
    if (part[k] !== 0) continue;
    count++;
    part[k] = count;
    stack.push(k);
    while (stack.length) {
      const q = stack.pop()!;
      const i = q % COLS;
      const j = (q - i) / COLS;
      for (const n of [i > 0 ? q - 1 : -1, i < COLS - 1 ? q + 1 : -1, j > 0 ? q - COLS : -1, j < ROWS - 1 ? q + COLS : -1])
        if (n >= 0 && part[n] === 0) {
          part[n] = count;
          stack.push(n);
        }
    }
  }
  for (let k = 0; k < part.length; k++) if (part[k] > 0) part[k]--;
  // the lumps of switched hazards' cells, what they lie between and what switches them
  const through: RoomParts['through'] = [];
  const lump = new Int16Array(COLS * ROWS).fill(-1);
  const seen = new Uint8Array(COLS * ROWS);
  for (let k = 0; k < part.length; k++) {
    if (part[k] !== -2 || seen[k]) continue;
    const parts = new Set<number>();
    const cells: number[] = [];
    seen[k] = 1;
    stack.push(k);
    while (stack.length) {
      const q = stack.pop()!;
      cells.push(q);
      const i = q % COLS;
      const j = (q - i) / COLS;
      for (const n of [i > 0 ? q - 1 : -1, i < COLS - 1 ? q + 1 : -1, j > 0 ? q - COLS : -1, j < ROWS - 1 ? q + COLS : -1]) {
        if (n < 0) continue;
        if (part[n] >= 0) parts.add(part[n]);
        else if (part[n] === -2 && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    for (const c of cells) lump[c] = through.length;
    const xs = cells.map((c) => c % COLS);
    const ys = cells.map((c) => Math.floor(c / COLS));
    const rect = {
      x: Math.min(...xs) * CELL,
      y: Math.min(...ys) * CELL,
      w: (Math.max(...xs) + 1 - Math.min(...xs)) * CELL,
      h: (Math.max(...ys) + 1 - Math.min(...ys)) * CELL,
    };
    const groups = [
      ...new Set(
        switched
          .filter((h) => h.rect.x < rect.x + rect.w && h.rect.x + h.rect.w > rect.x && h.rect.y < rect.y + rect.h && h.rect.y + h.rect.h > rect.y)
          .map((h) => h.group),
      ),
    ];
    through.push({ parts: [...parts], groups, rect });
  }
  return { part, count, through, lump };
}

/** What must be switched for hazards on these groups to be off (`g` → `!g`, `!g` → `g`). */
const offGates = (groups: string[]) => groups.map((g) => (g.startsWith('!') ? g.slice(1) : `!${g}`));

/** The cell a point is in, or the nearest free one (next to a wall); -1 if none is near. */
function cellAt(rp: RoomParts, x: number, y: number): number {
  const i0 = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
  const j0 = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
  for (let r = 0; r <= 4; r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= COLS || j >= ROWS) continue;
        if (rp.part[j * COLS + i] >= 0) return j * COLS + i;
      }
  return -1;
}

/** The part of a room a point is in: its cell's, or the nearest free cell's (next to a wall); 0 if none is near. */
function partAt(rp: RoomParts, x: number, y: number): number {
  const k = cellAt(rp, x, y);
  return k < 0 ? 0 : rp.part[k];
}

/**
 * The house as the parts of its rooms (`room#part`) and the ways between them: what the bot plans its routes on, so
 * that a way out of a room counts only from the part of the room it leads out of (Glider PRO houses are full of rooms
 * split by shelves and walls, the way on from one part of them often leading round through other rooms). `partOf`
 * says which part of a room a point is in.
 */
export function partMap(level: LevelDef): {
  map: Map<string, Way[]>;
  partOf: (room: string, x: number, y: number) => string;
  grid: (room: string) => RoomParts;
} {
  const parts = new Map<string, RoomParts>();
  const rp = (k: string) => parts.get(k) ?? parts.set(k, roomParts(level.rooms[k])).get(k)!;
  const partOf = (k: string, x: number, y: number) => `${k}#${partAt(rp(k), x, y)}`;
  const map = new Map<string, Way[]>();
  const add = (from: string, w: Way) => (map.get(from) ?? map.set(from, []).get(from)!).push(w);
  for (const [key, room] of Object.entries(level.rooms)) {
    const a = rp(key);
    for (let p = 0; p < a.count; p++) if (!map.has(`${key}#${p}`)) map.set(`${key}#${p}`, []);
    for (const side of ['left', 'right', 'up', 'down'] as const) {
      const span = room.exits[side];
      const to = span && neighbour(level, key, side);
      if (!span || !to) continue;
      const b = rp(to);
      // the cells along the edge here, and the ones they meet on the other side of it: a way for each two parts that
      // meet, over the stretch where they do
      const meet = new Map<string, { lo: number; hi: number }>();
      const n = side === 'left' || side === 'right' ? ROWS : COLS;
      for (let k = 0; k < n; k++) {
        const here = side === 'left' ? k * COLS : side === 'right' ? k * COLS + COLS - 1 : side === 'up' ? k : (ROWS - 1) * COLS + k;
        const there = side === 'left' ? k * COLS + COLS - 1 : side === 'right' ? k * COLS : side === 'up' ? (ROWS - 1) * COLS + k : k;
        const pa = a.part[here];
        const pb = b.part[there];
        if (pa < 0 || pb < 0) continue;
        const along = (k + 0.5) * CELL;
        if ((side === 'left' || side === 'right') && (along < span.from || along > span.to)) continue;
        if ((side === 'up' || side === 'down') && (along < span.from || along > span.to)) continue;
        const m = meet.get(`${pa}>${pb}`);
        if (m) m.hi = along;
        else meet.set(`${pa}>${pb}`, { lo: along, hi: along });
      }
      for (const [k, m] of meet) {
        const [pa, pb] = k.split('>');
        const target = `${to}#${pb}`;
        const from = `${key}#${pa}`;
        const x0 = m.lo - CELL / 2;
        const x1 = m.hi + CELL / 2;
        const mouth =
          side === 'left'
            ? { x: 0, y: x0, w: CELL, h: x1 - x0 }
            : side === 'right'
              ? { x: ROOM_W - CELL, y: x0, w: CELL, h: x1 - x0 }
              : side === 'up'
                ? { x: x0, y: 0, w: x1 - x0, h: CELL }
                : { x: x0, y: ROOM_H - CELL, w: x1 - x0, h: CELL };
        if (side === 'down') add(from, { to: target, kind: 'down', cx: (x0 + x1) / 2, spans: [[x0 + 12, Math.max(x0 + 12, x1 - 12)]], mouth });
        else if (side === 'up') {
          const lift = liftUnder(room, x0, x1);
          add(from, {
            to: target,
            kind: 'up',
            cx: (x0 + x1) / 2,
            spans: [[x0 + 12, Math.max(x0 + 12, x1 - 12)]],
            mouth,
            lift: lift === true,
            ...(lift !== true && lift.length ? { liftGates: lift } : {}),
          });
        } else add(from, { to: target, kind: 'side', side, from: Math.max(span.from, x0), mouth });
      }
    }
    // through switched hazards (a shaft of shredders): from each part beside them to the others, once they are all off
    for (const t of a.through)
      for (const p of t.parts)
        for (const q of t.parts) if (p !== q) add(`${key}#${p}`, { to: `${key}#${q}`, kind: 'rect', rect: t.rect, mouth: t.rect, gates: offGates(t.groups) });
    // stairs and transports: from the parts their mouths are in to the part where they come out
    for (const it of room.items) {
      let rect: Rect | null = null;
      let to: string | null = null;
      let out: { x: number; y: number } | null = null;
      if (it.t === 'stairsUp' || it.t === 'stairsDown') {
        const way = it.t === 'stairsUp' ? 'up' : 'down';
        to = neighbour(level, key, way);
        if (!to) continue;
        rect = it.t === 'stairsUp' ? stairsUpGeom(it).door : stairsDownGeom(it).trigger;
        out = stairsArrival(level.rooms[to].items, way);
      } else if (it.t === 'transport' && typeof it.to === 'string' && level.rooms[it.to]) {
        to = it.to;
        rect = { x: it.x, y: it.y, w: it.w ?? 60, h: it.h ?? 40 };
        out = { x: Number(it.ax ?? 320), y: Number(it.ay ?? 180) };
      } else continue;
      const target = partOf(to, out.x, out.y);
      const mouths = new Set<number>();
      // (a mouth among switched hazards, at the top of a shaft of shredders: from beside them, once they are off)
      const lumps = new Set<number>();
      for (let j = Math.max(0, Math.floor(rect.y / CELL)); j <= Math.min(ROWS - 1, Math.floor((rect.y + rect.h) / CELL)); j++)
        for (let i = Math.max(0, Math.floor(rect.x / CELL)); i <= Math.min(COLS - 1, Math.floor((rect.x + rect.w) / CELL)); i++) {
          if (a.part[j * COLS + i] >= 0) mouths.add(a.part[j * COLS + i]);
          if (a.lump[j * COLS + i] >= 0) lumps.add(a.lump[j * COLS + i]);
        }
      const gate = it.t === 'transport' && typeof it.group === 'string' ? { gate: it.group } : {};
      if (!mouths.size && lumps.size)
        for (const l of lumps) {
          const t = a.through[l];
          for (const p of t.parts) add(`${key}#${p}`, { to: target, kind: 'rect', rect: t.rect, mouth: t.rect, gates: offGates(t.groups), ...gate });
        }
      else if (!mouths.size) mouths.add(partAt(a, rect.x + rect.w / 2, rect.y + rect.h / 2));
      for (const p of mouths) add(`${key}#${p}`, { to: target, kind: 'rect', rect, mouth: rect, ...gate });
    }
  }
  return { map, partOf, grid: rp };
}

/**
 * How far it is from each cell of part `part` of a room to `mouth`, flying round what is in the way (px, through the
 * part's free cells; Infinity where the part doesn't reach).
 */
function fieldTo(rp: RoomParts, part: number, mouth: Rect): Float32Array {
  const d = new Float32Array(COLS * ROWS).fill(Infinity);
  const heap: number[] = [];
  const less = (a: number, b: number) => d[a] < d[b];
  const push = (k: number) => {
    heap.push(k);
    for (let i = heap.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (!less(heap[i], heap[up])) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        if (l >= heap.length) break;
        const m = l + 1 < heap.length && less(heap[l + 1], heap[l]) ? l + 1 : l;
        if (!less(heap[m], heap[i])) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const i0 = Math.max(0, Math.floor(mouth.x / CELL));
  const i1 = Math.min(COLS - 1, Math.floor((mouth.x + mouth.w - 0.01) / CELL));
  const j0 = Math.max(0, Math.floor(mouth.y / CELL));
  const j1 = Math.min(ROWS - 1, Math.floor((mouth.y + mouth.h - 0.01) / CELL));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      if (rp.part[j * COLS + i] === part) {
        d[j * COLS + i] = 0;
        push(j * COLS + i);
      }
  const D = CELL * Math.SQRT2;
  const done = new Uint8Array(COLS * ROWS);
  while (heap.length) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    const i = k % COLS;
    const j = (k - i) / COLS;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= COLS || jj >= ROWS) continue;
        const n = jj * COLS + ii;
        if (rp.part[n] !== part) continue;
        // (not diagonally between two blocked cells)
        if (di && dj && (rp.part[j * COLS + ii] !== part || rp.part[jj * COLS + i] !== part)) continue;
        const nd = d[k] + (di && dj ? D : CELL);
        if (nd < d[n]) {
          d[n] = nd;
          push(n);
        }
      }
  }
  return d;
}

/** Straight-line distance from (x, y) to a rectangle. */
function distToRect(r: Rect, x: number, y: number): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/**
 * Rising air up to `top` (by default the top of the room: what it takes to leave through the ceiling) somewhere
 * between x0 and x1: true when some always blows there, else the switch groups of what blows there only when
 * switched (none: no lift).
 */
function liftUnder(room: RoomDef, x0: number, x1: number, top = 30): true | string[] {
  const gated: string[] = [];
  for (const it of room.items) {
    const w = Number(it.w ?? 60);
    if (it.x > x1 || it.x + w < x0) continue;
    const up = it.t === 'floorVent' ? Number(it.reach ?? LAYOUT.floor) <= top : it.t === 'current' && (it.dir ?? 'up') === 'up' && it.y <= top;
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

/** Whether a way is open, as the switches are. */
function wayOpen(w: Way, switches: Map<string, boolean>): boolean {
  return (!w.gate || groupOn(w.gate, switches)) && (!w.gates || w.gates.every((g) => groupOn(g, switches)));
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
  if (w.kind === 'up') return 4 * (360 - y) - 0.6 * offOpening(w, x);
  if (w.kind === 'down') return 2 * y + 1200 - 2.5 * offOpening(w, x);
  const r = w.rect!;
  const dx = Math.max(0, Math.abs(x - (r.x + r.w / 2)) - r.w / 2);
  const below = Math.max(0, y - (r.y + r.h));
  return 1500 - dx - 3 * below + H * (340 - Math.max(y, r.y + 10));
}

/** How far x is from the open parts of a floor or ceiling opening (from its middle when nothing is known of them). */
function offOpening(w: Way, x: number): number {
  if (!w.spans?.length) return Math.abs(x - w.cx!);
  return Math.min(...w.spans.map(([a, b]) => (x < a ? a - x : x > b ? x - b : 0)));
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
  /**
   * When to go for a switch: 'early' (the default) as soon as the way to the nearest star needs one (it is shut, or
   * needs air that is switched off); 'late' only once every star still to find has got nowhere from here (the bot
   * tries the star itself first: a plane can often climb where the original's glider needed the air).
   */
  switches?: 'early' | 'late';
  /** How the switches are when the bot starts (flying a section of a house): group → on. */
  switchesAt?: Map<string, boolean>;
  /** Helium gas the plane has when the bot starts (sim s, as the game's `charges.gas`). */
  gas?: number;
}

export function solveHouse(level: LevelDef, design: Design, opts: HouseSolveOptions = {}): HouseSolveResult {
  const { build, aero } = analyzeDesign(design);
  const mesh = buildMesh(build, aero.cg);
  const hullLocal = profileHull(mesh);
  const halfLen = ((mesh.max.x - mesh.min.x) * PX_PER_M) / 2;
  const { map, partOf, grid } = partMap(level);
  const nodeOf = (k: string, x: number, y: number) => partOf(k, x, y);
  // how much further than straight there it is to a way out (or a target) from where the plane is, flying round what
  // is in the way: a way out right overhead counts for little with a shelf between
  const fields = new Map<string, Float32Array>();
  const detour = (room: string, mouth: Rect, x: number, y: number): number => {
    const rp = grid(room);
    const k = cellAt(rp, x, y);
    if (k < 0) return 0;
    const part = rp.part[k];
    const fk = `${room}|${part}|${mouth.x},${mouth.y},${mouth.w},${mouth.h}`;
    const f = fields.get(fk) ?? fields.set(fk, fieldTo(rp, part, mouth)).get(fk)!;
    const d = f[k];
    return d === Infinity ? 0 : Math.max(0, d - distToRect(mouth, x, y));
  };
  const DETOUR = 1.5;
  const rooms = new Map<string, SimRoom>();
  const roomOf = (k: string) => rooms.get(k) ?? rooms.set(k, buildSimRoom(level.rooms[k], { level, key: k })).get(k)!;
  // what moves about and must be missed: the moving hazards, and drops of water falling (a drop only soaks the plane
  // in the game, but a plan through them would not fly the same twice)
  const moving = new Map<string, GameObject[]>();
  const moversOf = (k: string) => moving.get(k) ?? moving.set(k, [...(roomOf(k).movers ?? []), ...roomOf(k).objects.filter((o) => o.def.t === 'drip')]).get(k)!;
  // one track of them per room and state of the switches they go by
  const tracks = new Map<string, MoverTrack | null>();
  const sigOf = (k: string, sw: Map<string, boolean>) =>
    moversOf(k)
      .map((o) => (typeof o.def.group === 'string' ? (groupOn(o.def.group, sw) ? 1 : 0) : '-'))
      .join('');
  const trackOf = (k: string, sig: string): MoverTrack | null => {
    const tk = `${k}|${sig}`;
    if (tracks.has(tk)) return tracks.get(tk)!;
    const defs = moversOf(k).map((o) => o.def);
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
  const gates = new Set<string>();
  for (const ways of map.values())
    for (const w of ways) {
      if (w.gate) gates.add(w.gate.replace(/^!/, ''));
      for (const g of w.gates ?? []) gates.add(g.replace(/^!/, ''));
      for (const g of w.liftGates ?? []) gates.add(g.replace(/^!/, ''));
    }
  // a star high up over rising air that only blows when switched: the switches count as gates of the way to it, and
  // while the air is off the star counts as far off
  const starGates = new Map<string, string[]>();
  for (const [k, r] of Object.entries(level.rooms))
    for (const it of r.items) {
      if (it.t !== 'star' || !it.goal || typeof it.id !== 'string') continue;
      stars.set(it.id, { key: it.id, kind: 'star', room: k, node: nodeOf(k, it.x, it.y), x: it.x, y: it.y });
      const lift = it.y < 200 ? liftUnder(r, it.x, it.x, it.y + 20) : true;
      if (lift === true || !lift.length) continue;
      starGates.set(it.id, lift);
      for (const g of lift) gates.add(g.replace(/^!/, ''));
    }
  const starCost = (t: Target, sw: Map<string, boolean>) => (starGates.get(t.key)?.some((g) => groupOn(g, sw)) === false ? NO_LIFT : 0);
  // the places to flip switches, room by room (switches in one place flip together: a trigger can be wired to
  // two things); one inside something solid (Glider PRO houses hide a few in their walls) can't be flown to
  const spots = new Map<string, { target: Target; groups: string[] }[]>();
  for (const [k, r] of Object.entries(level.rooms)) {
    const solid = roomColliders(r);
    r.items.forEach((it, i) => {
      if (it.t === 'switch' && typeof it.group === 'string' && gates.has(it.group)) {
        const w = it.hidden ? Number(it.w ?? 16) : 10;
        const h = it.hidden ? Number(it.h ?? 16) : 16;
        const x = it.x + w / 2;
        const y = it.y + h / 2;
        const s: Target = { key: `switch ${k}#${i}`, kind: 'switch', room: k, node: nodeOf(k, x, y), x, y, group: it.group };
        if (solid.some((c) => s.x > c.x && s.x < c.x + c.w && s.y > c.y && s.y < c.y + c.h)) return;
        const here = spots.get(s.node) ?? spots.set(s.node, []).get(s.node)!;
        const at = here.find((p) => Math.abs(p.target.x - s.x) < 8 && Math.abs(p.target.y - s.y) < 8);
        if (at) at.groups.push(it.group);
        else here.push({ target: s, groups: [it.group] });
      }
    });
  }

  const got = new Set<string>();
  const order: string[] = [];
  const visited: string[] = [level.start.room];
  const trace: string[] = [];
  let sheets = 0;
  let flying: Node[] | null = null;
  let checkpoint: Checkpoint = { ...level.start };
  let totalT = 0;
  // switch states carried from flight to flight (a switch stays flipped)
  let switchesNow = new Map<string, boolean>(opts.switchesAt ?? []);
  // helium gas carried from flight to flight (it is kept until it is used), and the canisters picked up (they stay
  // picked up)
  let gasNow = opts.gas ?? 0;
  const cans = new Set<string>();
  // switches the bot went for, as it wants them: a flight that flips one back (coming round through it again) is
  // given up, until the bot goes for that switch again
  const wanted = new Map<string, boolean>();
  const unwant = (t: Target | null) => {
    if (t?.kind === 'switch') wanted.delete(t.group!);
  };

  // distances to a part of a room, as the switches are (only the gates' states matter: switched transports, and
  // switched air up through ceiling openings): a ceiling opening without rising air counts as a long way round
  const distCache = new Map<string, Map<string, number>>();
  const open = (sw: Map<string, boolean>) => (w: Way) => wayOpen(w, sw);
  const distTo = (node: string, sw: Map<string, boolean>, plain = false) => {
    const k = `${node}|${[...gates].map((g) => (groupOn(g, sw) ? 1 : 0)).join('')}${plain ? '|plain' : ''}`;
    const cost = (w: Way) => (plain ? 1 : wayCost(w, sw));
    return distCache.get(k) ?? distCache.set(k, distancesTo(map, node, open(sw), cost)).get(k)!;
  };
  /** Distances to a part of a room with every way open (whatever the switches; how far it is at the least). */
  const allOpen = new Map<string, Map<string, number>>();
  const openTo = (node: string) => allOpen.get(node) ?? allOpen.set(node, distancesTo(map, node)).get(node)!;
  /**
   * What to fly to from `room` (a part of a room, see `partMap`): the nearest star still to find; when the way to it
   * is shut, or needs air that is switched off (a climb out through a ceiling, a star high up), a switch on the way
   * that makes the way to one shorter. `skip`: targets that got nowhere from here.
   */
  const late = opts.switches === 'late';
  const chooseTarget = (room: string, sw: Map<string, boolean>, skip: Set<string>): Target | null => {
    const all = goals.filter((id) => !got.has(id)).map((id) => stars.get(id)!);
    // a star with no way on from it to the others (in a room with no way out: the last room of Rainbow's End) is
    // for last
    const onward = (t: Target) => all.every((o) => o === t || (openTo(o.node).get(t.node) ?? Infinity) < Infinity);
    const toFind = all.some(onward) ? all.filter(onward) : all;
    const left = toFind.filter((t) => !skip.has(t.key));
    const cost = (t: Target, state: Map<string, boolean>, from: string) => (distTo(t.node, state).get(from) ?? Infinity) + starCost(t, state);
    let best: Target | null = null;
    let bd = Infinity;
    for (const t of left) {
      const d = cost(t, sw, room);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    // the way to the nearest star is clear (no rising air missing on it), or the star itself is to be tried first
    if (best && (late || bd <= (distTo(best.node, sw, true).get(room) ?? Infinity))) return best;
    // the first switch on a way that opens the way to a star or makes it shorter (late: any star still to find,
    // those that got nowhere from here too)
    const after = late ? toFind : left;
    if (late) bd = Math.min(...toFind.map((t) => cost(t, sw, room)), Infinity);
    const p = switchPlan(room, sw, after, skip);
    if (p.first && p.cost < bd) return p.first;
    if (best) return best;
    // no star can be got to as the switches are, and the search found no switches that would do (too many to flip:
    // Land of Illusion's shaft of four shredders, one switch in each star's room): the nearest switch for something
    // that shuts the shortest way to the nearest star there would be with every way open
    return gateSwitch(room, sw, after, skip);
  };

  /** The nearest switch (as the switches are) that opens something shut on the way to the nearest of `to` (see above). */
  const gateSwitch = (room: string, sw: Map<string, boolean>, to: Target[], skip: Set<string>): Target | null => {
    let star: Target | null = null;
    for (const t of to) if ((openTo(t.node).get(room) ?? Infinity) < (star ? openTo(star.node).get(room)! : Infinity)) star = t;
    if (!star) return null;
    const dist = openTo(star.node);
    // what has to be switched along that way
    const need = new Set<string>();
    for (let at = room, d = dist.get(room)!; d > 0; d--) {
      const w = (map.get(at) ?? []).find((v) => dist.get(v.to) === d - 1);
      if (!w) break;
      for (const g of [...(w.gate ? [w.gate] : []), ...(w.gates ?? [])]) if (!groupOn(g, sw)) need.add(g.replace(/^!/, ''));
      if (w.lift === false && w.liftGates?.length && !w.liftGates.some((g) => groupOn(g, sw))) need.add(w.liftGates[0].replace(/^!/, ''));
      at = w.to;
    }
    let best: Target | null = null;
    let bd = Infinity;
    for (const list of spots.values())
      for (const sp of list) {
        if (skip.has(sp.target.key) || !sp.groups.some((g) => need.has(g))) continue;
        const d = distTo(sp.target.node, sw).get(room) ?? Infinity;
        if (d < bd) {
          bd = d;
          best = sp.target;
        }
      }
    return best;
  };

  /**
   * The cheapest way from `room` to one of the stars `to`, switches on the way included: a search over the rooms and
   * the states of the switches (each flips its group: a switched transport opens or shuts, switched air comes on or
   * goes off), ways costing what they do in `distTo`, with a few switches at most. Returns the first switch on it
   * (null: none is needed, or there is no way) and its cost. (One switch is often not enough: in SpacePods the air
   * up a shaft needs a switch at the bottom of it, and then one in the room above.)
   */
  const switchPlan = (room: string, sw: Map<string, boolean>, to: Target[], skip: Set<string>): { first: Target | null; cost: number } => {
    const hs = to.map((t) => openTo(t.node));
    // (rooms to go at the least, every way open: the search heads for the stars)
    const near = (r: string) => Math.min(...hs.map((d) => d.get(r) ?? Infinity));
    const list = [...gates];
    const keyOf = (r: string, s: Map<string, boolean>) => `${r}|${list.map((g) => (groupOn(g, s) ? 1 : 0)).join('')}`;
    interface S {
      r: string;
      s: Map<string, boolean>;
      g: number;
      f: number;
      first: Target | null;
      flips: number;
    }
    const heap: S[] = [];
    const push = (x: S) => {
      if (x.f === Infinity) return;
      heap.push(x);
      for (let i = heap.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (heap[up].f <= heap[i].f) break;
        [heap[up], heap[i]] = [heap[i], heap[up]];
        i = up;
      }
    };
    const pop = (): S => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const m = l + 1 < heap.length && heap[l + 1].f < heap[l].f ? l + 1 : l;
          if (l >= heap.length || heap[i].f <= heap[m].f) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const done = new Set<string>();
    let best: { first: Target | null; cost: number } = { first: null, cost: Infinity };
    push({ r: room, s: sw, g: 0, f: near(room), first: null, flips: 0 });
    for (let budget = 50000; heap.length && budget > 0; budget--) {
      const x = pop();
      if (x.f >= best.cost) break;
      const k = keyOf(x.r, x.s);
      if (done.has(k)) continue;
      done.add(k);
      for (const t of to) if (t.node === x.r && x.g + starCost(t, x.s) < best.cost) best = { first: x.first, cost: x.g + starCost(t, x.s) };
      for (const w of map.get(x.r) ?? []) {
        if (!wayOpen(w, x.s)) continue;
        const g = x.g + wayCost(w, x.s);
        push({ r: w.to, s: x.s, g, f: g + near(w.to), first: x.first, flips: x.flips });
      }
      if (x.flips < 4)
        for (const sp of spots.get(x.r) ?? []) {
          if (skip.has(sp.target.key)) continue;
          const s = new Map(x.s);
          for (const g of sp.groups) s.set(g, !groupOn(g, s));
          // (a little for the detour: no switch is flown to for nothing)
          push({ r: x.r, s, g: x.g + 0.5, f: x.g + 0.5 + near(x.r), first: x.first ?? sp.target, flips: x.flips + 1 });
        }
    }
    return best;
  };

  const throwsFrom = (cp: Checkpoint): Node[] => {
    const out: Node[] = [];
    // where things move about (balloons rising, a fish leaping), the throw can be timed: now, or a second or two on
    const sig = sigOf(cp.room, switchesNow);
    const waits = trackOf(cp.room, sig) ? [0, 1, 2] : [0];
    for (const wait of waits)
      for (const facing of [cp.facing, -cp.facing as 1 | -1])
        for (const [angle, power] of [
          [0, 0.3],
          [0, 0.5],
          [0.15, 0.4],
          [0.3, 0.6],
          [-0.15, 0.35],
          [0.1, 0.75],
          [0.5, 0.8],
          // steeply down (a player aiming with the mouse can): down a shaft, nose first
          [-0.8, 0.3],
          [-1.3, 0.25],
        ]) {
          const plane = createPlane(aero);
          launch(plane, cp.x, cp.y, facing > 0 ? angle : Math.PI - angle, power);
          plane.gas = gasNow;
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
            roomTick: Math.round(wait / TICK),
            roomSig: sig,
            got: [],
            cans: [],
            over: [],
            armed: [],
            trace: [`throw ${facing > 0 ? '>' : '<'} a${angle} p${power}${wait ? ` after ${wait}s` : ''} from ${cp.room}`],
            thrown: { from: { ...cp }, angle: facing > 0 ? angle : Math.PI - angle, power, wait: Math.round(wait / TICK), stepTicks: tryNow.step },
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
      armed: n0.armed.slice(),
      checkpoint: { ...n0.checkpoint },
      steps: { dir: input.dir as -1 | 0 | 1, pitch: input.pitch, ...(input.helium ? { helium: true } : {}), prev: n0.steps },
    };
    const st: TickState = { plane: n.plane, aero, hullLocal, halfLen, groundT: n.groundT, stillT: n.stillT };
    let room = roomOf(n.key);
    const known: Partial<SessionApi> = {
      setSwitch: (g: string, on: boolean) => void n.switches.set(g, on),
      switchOn: (g: string) => n.switches.get(g) ?? true,
      lightsOn: () => true,
      plane: () => {
        const q = planePx(n.plane);
        return { x: q.x, y: q.y, vx: n.plane.vx, vy: n.plane.vy, alive: true };
      },
    };
    // (sounds and the like do nothing here)
    const api = new Proxy(known as SessionApi, { get: (t, k: string) => t[k as keyof SessionApi] ?? (() => {}) });
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
      if (key !== n.key) n.armed = [];
      n.key = key;
      room = roomOf(key);
      n.checkpoint = { room: key, x, y, facing };
      n.roomTick = 0;
      n.roomSig = sigOf(key, n.switches);
    };
    const die = (why: string) => {
      const q = planePx(n.plane);
      n.trace = [...n.trace, `lost (${why}) in ${n.key} @${Math.round(q.x)},${Math.round(q.y)}`];
      // (a flight the bot gives up as one of its own rules has it, the plane still flying in the game, a switch it
      // went for flipped back: no way on, the next sheet would not be thrown from there)
      if (why !== 'switched back' && why !== 'too long') onDeath(n);
      return null;
    };
    /** Flip a switch group; false when that flips back a switch the bot went for (the flight is given up). */
    const flip = (g: string): boolean => {
      const now = !(n.switches.get(g) ?? true);
      if (wanted.has(g) && wanted.get(g) !== now && !(target?.kind === 'switch' && target.group === g)) return false;
      n.switches.set(g, now);
      // (what it switches here goes by the new state from now on, as if it had been so since the plane came in)
      n.roomSig = sigOf(n.key, n.switches);
      n.got.push(`toggled:${g}`);
      n.trace = [...n.trace, `switch ${g} in ${n.key} @${(totalT + n.t).toFixed(1)}s`];
      return true;
    };
    for (let k = 0; k < n.thrown.stepTicks; k++) {
      ctx.time = n.t;
      // a switch set off a while ago flips now (as the game's does, before the plane flies on)
      while (n.armed.length && n.armed[0].at <= n.t + 1e-6) if (!flip(n.armed.shift()!.g)) return die('switched back');
      // (switched air and transports; moving hazards are flown on their own, see MoverTrack)
      for (const o of room.objects) if (typeof o.def.group === 'string' && !o.hazard) o.update?.(ctx);
      updateSpills(room.spills, ctx);
      const r = flightTick(st, input, wind, room.colliders, TICK, { rand: () => 0.5 }, {});
      opts.onTick?.(n.plane, wind(n.plane.x, n.plane.y), room.colliders.length);
      n.t += TICK;
      if (r === 'crashed' || r === 'grounded' || damagePct(n.plane.damage) >= 90) return die(r === 'ok' ? 'crumpled' : r);
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
        if (t !== 'switch' && t !== 'star' && t !== 'helium' && t !== 'stairsUp' && t !== 'stairsDown' && t !== 'transport' && t !== 'exit') continue;
        if (hurt && t !== 'switch' && t !== 'star') continue;
        const tr = o.trigger?.();
        if (!tr || bb.x1 < tr.x || bb.x0 > tr.x + tr.w || bb.y1 < tr.y || bb.y0 > tr.y + tr.h || !polyVsBox(hw, { ...tr })) continue;
        if (t === 'switch') {
          over.push(o.id);
          const g = typeof o.def.group === 'string' ? o.def.group : 'lights';
          if (g !== 'lights' && !n.over.includes(o.id)) {
            // (one with a delay flips that long after, the plane still in the room: from the start of the tick it
            // came through, as the game counts)
            const delay = Number(o.def.delay ?? 0);
            if (delay > 0) n.armed = [...n.armed, { g, at: n.t - TICK + delay }].sort((a, b) => a.at - b.at);
            else if (!flip(g)) return die('switched back');
          }
        } else if (t === 'star') {
          const id = o.def.id;
          if (typeof id === 'string' && o.def.goal && !n.got.includes(id)) {
            n.got.push(id);
            n.trace = [...n.trace, `star ${id} @${(totalT + n.t).toFixed(1)}s`];
          }
        } else if (t === 'helium') {
          // a canister of gas (once: it stays picked up, the next flights' too)
          const id = `${n.key}|${o.id}`;
          if (!cans.has(id) && !n.cans.includes(id)) {
            n.cans = [...n.cans, id];
            n.plane.gas += PHYS.gasSupply;
            n.trace = [...n.trace, `helium in ${n.key} @${(totalT + n.t).toFixed(1)}s`];
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
      if (hurt) return die('hazard');
      if (moved) continue;
      // (a target reached counts once the step is flown: a recorded flight is whole steps, the game flies them all)
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
          return die('out of the house');
        }
        if (side === 'left') n.plane.x += ROOM_W / PX_PER_M;
        if (side === 'right') n.plane.x -= ROOM_W / PX_PER_M;
        if (side === 'up') n.plane.y -= ROOM_H / PX_PER_M;
        if (side === 'down') n.plane.y += ROOM_H / PX_PER_M;
        const np = planePx(n.plane);
        const entry = ({ left: 'right', right: 'left', up: 'down', down: 'up' } as const)[side];
        room = roomOf(next);
        n.checkpoint = entryCheckpoint(level, next, entry, np.x, np.y, n.plane.facing, stillHazards(room.objects));
        n.key = next;
        n.armed = [];
        n.roomTick = 0;
        n.roomSig = sigOf(next, n.switches);
        n.trace = [...n.trace, `-> ${next} @${(totalT + n.t).toFixed(1)}s`];
      }
      if (n.t > maxFlight) return die('too long');
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
    plane.gas = opts.gas ?? 0;
    const sw = new Map(opts.switchesAt ?? []);
    let n: Node | null = {
      key: f.from.room,
      plane,
      groundT: 0,
      stillT: 0,
      t: 0,
      switches: sw,
      checkpoint: { ...f.from },
      score: 0,
      peak: -Infinity,
      peakT: 0,
      transT: -Infinity,
      roomTick: f.wait ?? 0,
      roomSig: sigOf(f.from.room, sw),
      got: [],
      cans: [],
      over: [],
      armed: [],
      trace: [],
      thrown: { ...f, wait: f.wait ?? 0, stepTicks: f.stepTicks ?? stepTicks },
      steps: null,
    };
    let lost = null as Node | null;
    for (const s of f.steps) {
      const prev: Node = n!;
      n = advance(prev, { dir: s.dir, pitch: s.pitch, boost: false, helium: !!s.helium }, null, (d) => (lost = d));
      opts.onReplay?.(n ?? prev, !n);
      if (!n) break;
    }
    // (how the flight ended, lost or not: the switches it left as they are for the next)
    const end = n ?? lost;
    return {
      solved: !!n,
      starsTotal: goals.length,
      stars: n?.got ?? [],
      sheetsUsed: 0,
      t: n?.t ?? 0,
      rooms: [],
      trace: end?.trace ?? [],
      flights: [],
      stepTicks,
      switches: end ? Object.fromEntries(end.switches) : undefined,
      gas: end?.plane.gas,
    };
  }

  /** Score a live node for the search towards `target`. */
  const scoreOf = (n: Node, target: Target): number => {
    const dist = distTo(target.node, n.switches);
    const q = planePx(n.plane);
    const node = nodeOf(n.key, q.x, q.y);
    const d = dist.get(node) ?? 999;
    let best = -1e9;
    if (node === target.node)
      best = toward(q.x, q.y, target.x, target.y) - DETOUR * detour(n.key, { x: target.x - 6, y: target.y - 6, w: 12, h: 12 }, q.x, q.y);
    else
      for (const w of map.get(node) ?? [])
        if (wayOpen(w, n.switches) && wayCost(w, n.switches) + (dist.get(w.to) ?? 999) <= d)
          best = Math.max(best, progress(w, q.x, q.y) - (w.mouth ? DETOUR * detour(n.key, w.mouth, q.x, q.y) : 0));
    // a flight in a steep dive or about to stall is worth less than its position suggests
    const dive = Math.max(0, -n.plane.vy - 0.9) * 60 + Math.max(0, -n.plane.theta - 0.5) * 80;
    const slow = n.plane.V < 1 ? (1 - n.plane.V) * 120 : 0;
    return -d * 10000 + best - damagePct(n.plane.damage) * 3 - dive - slow;
  };

  /** How good a checkpoint is to throw from, for `target` (with `gas` left: a little better with helium to spare). */
  const cpRank = (cp: Checkpoint, target: Target, sw: Map<string, boolean>, gas: number): number => {
    const node = nodeOf(cp.room, cp.x, cp.y);
    const d = distTo(target.node, sw).get(node) ?? 999;
    return -d * 10000 + (node === target.node ? toward(cp.x, cp.y, target.x, target.y) : 0) + 10 * Math.min(gas, 4 * PHYS.gasSupply);
  };

  /** The rooms a flight went into, from its trace. */
  const roomsOf = (lines: string[]) =>
    lines.filter((s) => s.startsWith('->') || s.startsWith('stairs') || s.startsWith('transport')).map((s) => s.split(' ').slice(-2)[0]);

  const flightOf = (n: Node): Flight => {
    const steps: Flight['steps'] = [];
    for (let s = n.steps; s; s = s.prev) steps.push({ dir: s.dir, pitch: s.pitch, ...(s.helium ? { helium: true } : {}) });
    const { wait, ...rest } = n.thrown;
    return { ...rest, ...(wait ? { wait } : {}), steps: steps.reverse() };
  };
  const flights: Flight[] = [];
  /** A flight of the way through (the time spent waiting to throw it counts as the player's). */
  const record = (n: Node) => {
    flights.push(flightOf(n));
    totalT += n.thrown.wait * TICK;
  };
  // the search is deterministic: from a checkpoint already thrown from (near enough) it would only fly the same
  // flights again, so each try searches differently; after the last, that checkpoint is used up for the target
  const tries = new Map<string, number>();
  // (with helium gas or without: a sheet thrown from there with some can fly where one without could not)
  const cpKey = (cp: Checkpoint, target: Target, gas: number) =>
    `${target.key}|${cp.room}@${Math.round(cp.x / 48)},${Math.round(cp.y / 40)},${cp.facing}${gas > 0 ? '|gas' : ''}`;
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
      target = chooseTarget(nodeOf(checkpoint.room, checkpoint.x, checkpoint.y), switchesNow, skip);
      unwant(target);
      if (!target || sheets > maxSheets) break;
      const k = cpKey(checkpoint, target, gasNow);
      const tried = tries.get(k) ?? 0;
      if (tried >= TRIES.length) {
        // thrown from here for it every way there is: another target
        skip.add(target.key);
        continue;
      }
      tryNow = TRIES[tried];
      tries.set(k, tried + 1);
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
      if (!got && (tries.get(cpKey(cp, tgt, n?.plane.gas ?? gasNow)) ?? 0) >= TRIES.length) return;
      gotIt ||= got;
      const rank = got ? Infinity : cpRank(cp, tgt, n?.switches ?? switchesNow, n?.plane.gas ?? gasNow);
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
          const dir = turn ? ((n.plane.facing > 0 ? -1 : 1) as -1 | 1) : 0;
          const inputs: FlightInput[] = tryNow.pitches.map((pitch) => ({ dir, pitch, boost: false }));
          // with gas, helium held too (the balloon hangs the plane level: the stick's pitch does next to nothing)
          if (n.plane.gas > 0) inputs.push({ dir, pitch: 0, boost: false, helium: true });
          for (const input of inputs) {
            const r = advance(n, input, tgt, onDeath);
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
        gasNow = done.plane.gas;
        for (const c of done.cans) cans.add(c);
        done.cans = [];
        if (done.got.includes('exit') || got.size >= goals.length) {
          record(done);
          break outer;
        }
        opts.log?.(`${tgt.kind} ${tgt.key} in ${tgt.room} after ${totalT.toFixed(1)}s, ${sheets} sheets`);
        // (the switch stays as it is now)
        if (tgt.kind === 'switch') wanted.set(tgt.group!, switchesNow.get(tgt.group!) ?? true);
        skip = new Set();
        // (the flight goes on, its clock started again from here: what it keeps time by goes with it, the last
        // transport it came out of and the switches set off still to flip)
        done.transT -= done.t;
        done.armed = done.armed.map((a) => ({ g: a.g, at: a.at - done.t }));
        done.t = 0;
        done.peak = -Infinity;
        done.peakT = 0;
        done.got = [];
        done.trace = [];
        const at = planePx(done.plane);
        target = chooseTarget(nodeOf(done.key, at.x, at.y), switchesNow, skip);
        unwant(target);
        if (!target) {
          record(done);
          break outer;
        }
        flying = [done];
        continue outer;
      }
      if (!next.length || gotIt) break;
      // keep the best, one per coarse state so the beam stays diverse; first the best at each height of each room
      // (a way on low down, under furniture that all the room above it scores better than, is kept going)
      next.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      const binOf = (n: Node) => {
        const q = planePx(n.plane);
        return `${n.key}|${Math.round(q.x / 20)}|${Math.round(q.y / 10)}|${n.plane.facing}|${n.plane.turn ? 1 : 0}`;
      };
      beam = [];
      const bands = new Set<string>();
      for (const n of next) {
        const band = `${n.key}|${Math.floor(planePx(n.plane).y / 90)}`;
        if (bands.has(band)) continue;
        bands.add(band);
        seen.add(binOf(n));
        beam.push(n);
      }
      for (const n of next) {
        if (beam.length >= tryNow.beam) break;
        const k = binOf(n);
        if (seen.has(k)) continue;
        seen.add(k);
        beam.push(n);
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
    opts.log?.(
      `sheet ${sheets} for ${tgt.key}: best flight ended in ${bd.at} -> next from ${cpKey(bd.cp, tgt, bd.node?.plane.gas ?? gasNow)} [${bd.trace.join(' | ')}]`,
    );
    // the flight that got there is part of the way (a checkpoint carried over from before needs none)
    if (bd.node) {
      record(bd.node);
      switchesNow = bd.node.switches;
      // (and the helium it had left, the canisters it picked up)
      gasNow = bd.node.plane.gas;
      for (const c of bd.node.cans) cans.add(c);
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
  const cpNode = nodeOf(checkpoint.room, checkpoint.x, checkpoint.y);
  const stuckTarget = solved ? null : chooseTarget(cpNode, switchesNow, new Set());
  const short = stuckTarget ? distancesTo(map, stuckTarget.node, open(switchesNow)).get(cpNode) : undefined;
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
    switches: Object.fromEntries(switchesNow),
    gas: gasNow,
  };
}
