import { describe, expect, it, vi } from 'vitest';
import type { LevelDef } from '../src/game/level';
import { RECIPES } from '../src/paper/recipes';
import { PHYS, PX_PER_M } from '../src/physics/config';
import { buildSimRoom } from '../src/game/sim';
import { generateFloorWithReport, themeForFloor, validateLevelFlight, type FloorOptions } from '../src/world/procgen';
import { entriesFor, flyRoom, pilotSpec } from '../src/world/procgen/fly';
import { referencePlanes } from '../src/world/procgen/fleet';
import { routeIO } from '../src/world/procgen/route';
import { stairsArrive } from '../src/world/procgen/stairsPlan';
import { entersByStairs, leavesByStairs, stairsKindOf, type FlightRun, type RoomIO } from '../src/world/procgen/types';
import type { ItemDef, RoomDef } from '../src/world/types';
import { solveLevel } from './helpers/solver';

vi.setConfig({ testTimeout: 180000 });

const isStairs = (i: ItemDef) => i.t === 'stairsUp' || i.t === 'stairsDown';
const hasStairs = (l: LevelDef) => Object.values(l.rooms).some((r) => r.items.some(isStairs));

interface Found {
  seed: number;
  floor: number;
  level: LevelDef;
  report: ReturnType<typeof generateFloorWithReport>['report'];
}

/** The first floors (seed by seed, floor 0..3, the way the roguelike builds them) that have stairs, with their reports. */
const cache = new Map<string, Found[]>();
function floorsWithStairs(n: number, extra: Partial<FloorOptions> = {}): Found[] {
  const key = JSON.stringify([n, extra]);
  const hit = cache.get(key);
  if (hit) return hit;
  const out: Found[] = [];
  for (let seed = 1; out.length < n && seed <= 60; seed++)
    for (const floor of [0, 1, 2, 3]) {
      if (out.length >= n) break;
      const { level, report } = generateFloorWithReport({ seed, floor, theme: themeForFloor(floor), workbenchRoom: seed % 2 === 0, ...extra });
      if (hasStairs(level)) out.push({ seed, floor, level, report });
    }
  cache.set(key, out);
  return out;
}

/** One floor's rooms with the stairs they hold, and the route's view of how each is entered and left. */
function stairsRooms(level: LevelDef): { io: RoomIO; room: RoomDef; stairs: ItemDef }[] {
  return routeIO(level).flatMap((io) => {
    const kind = stairsKindOf(io);
    const room = level.rooms[io.key];
    const stairs = kind ? room.items.find((i) => i.t === kind) : undefined;
    return stairs ? [{ io, room, stairs }] : [];
  });
}

describe('the reference pilot takes the stairs', () => {
  it('rooms left by stairs end in the stairs trigger, rooms entered by them are flown from where they come out', () => {
    const left = { up: 0, down: 0 };
    const entered = { above: 0, below: 0 };
    for (const { seed, floor, level, report } of floorsWithStairs(8)) {
      for (const { io, stairs } of stairsRooms(level)) {
        const rr = report.rooms.find((r) => r.key === io.key)!;
        const where = `seed ${seed} floor ${floor} room ${io.key}`;
        expect(rr.ok, where).toBe(true);
        expect(rr.fallback, where).toBe(false);
        if (leavesByStairs(io)) {
          // the flights that passed all flew into the stairs (up the doorway, down the well) and nothing else counted
          const want = io.exit === 'up' ? 'stairsUp' : 'stairsDown';
          const ok = rr.runs.filter((r) => r.ok);
          expect(ok.length, where).toBeGreaterThan(0);
          for (const r of ok) expect(r.outcome, where).toBe(want);
          // (and a flight that ended anywhere else did not pass)
          for (const r of rr.runs.filter((q) => q.outcome !== want)) expect(r.ok, where).toBe(false);
          left[io.exit as 'up' | 'down']++;
        }
        if (entersByStairs(io)) {
          const id = io.entry === 'up' ? 'above' : 'below';
          const runs = rr.runs.filter((r: FlightRun) => r.entry === id);
          expect(runs.length, where).toBeGreaterThan(0);
          // the flight starts at the stairs' arrival point (the first sample is a tick or two later)
          const a = stairsArrive(stairs);
          for (const r of runs) expect(Math.hypot(r.path[0].x - a.x, r.path[0].y - a.y), where).toBeLessThan(6);
          // and nothing else is flown into the room: no throw from a doorway
          expect(rr.runs.some((r) => r.entry === 'door-hi' || r.entry === 'door-lo'), where).toBe(false);
          entered[id]++;
        }
      }
      // judged again from scratch, independent of what the generator recorded
      expect(validateLevelFlight(level).ok, `seed ${seed} floor ${floor}`).toBe(true);
    }
    expect(left.up).toBeGreaterThan(1);
    expect(left.down).toBeGreaterThan(1);
    expect(entered.above).toBeGreaterThan(1);
    expect(entered.below).toBeGreaterThan(1);
  });

  it('a plane comes out of the stairs level, at the best-glide speed of its own design', () => {
    const planes = referencePlanes();
    // an empty room entered by stairs from below (over its well) and one entered by stairs from above (at its doorway)
    const wall = { pattern: 'plain', base: 'cream', accent: 'cream', wainscot: null, trim: 'cream' } as const;
    const room = (items: ItemDef[]): RoomDef => ({
      id: 'x',
      name: 'x',
      wall,
      floor: { kind: 'planks', ramp: 'oak' },
      exits: { right: { from: 60, to: 335 } },
      items,
    });
    const cases: { entry: 'down' | 'up'; item: ItemDef; id: string }[] = [
      { entry: 'down', item: { t: 'stairsDown', x: 40, y: 302, w: 150, dir: 1, v: 0 }, id: 'below' },
      { entry: 'up', item: { t: 'stairsUp', x: 26, y: 340, w: 200, top: 132, dir: -1, v: 0 }, id: 'above' },
    ];
    for (const c of cases) {
      const io: RoomIO = {
        index: 1,
        count: 3,
        gx: 0,
        gy: 0,
        key: '0,0',
        dirX: 1,
        entry: c.entry,
        exit: 'right',
        exitSpan: { from: 60, to: 335 },
        link: 'stairs',
      };
      const a = stairsArrive(c.item);
      const [e] = entriesFor(io, { arrive: a });
      expect(e).toMatchObject({ id: c.id, x: a.x, y: a.y, dirX: 1, reset: true });
      for (const p of planes) {
        const run = flyRoom(buildSimRoom(room([c.item])), p, pilotSpec(io, []), e);
        // the path is sampled every 3 ticks of 1/120 s (in slow motion): how far the plane goes between two samples
        const step = run.path[1].x - run.path[0].x;
        const want = (p.aero.perf.vBest * PX_PER_M * PHYS.timeScale * 3) / 120;
        expect(step, `${p.id} ${c.id}`).toBeGreaterThan(want * 0.85);
        expect(step, `${p.id} ${c.id}`).toBeLessThan(want * 1.15);
      }
    }
    // the two designs really do glide at different speeds, so one fixed arrival velocity would not do
    expect(planes[0].aero.perf.vBest).not.toBeCloseTo(planes[1].aero.perf.vBest, 1);
  });

  it('early floors are flown by both planes in nearly every stairs room', () => {
    let rooms = 0;
    let both = 0;
    for (const { floor, level, report } of floorsWithStairs(8)) {
      if (floor > 1) continue;
      for (const { io } of stairsRooms(level)) {
        rooms++;
        if (report.rooms.find((r) => r.key === io.key)!.both) both++;
      }
    }
    expect(rooms).toBeGreaterThan(3);
    expect(both / rooms).toBeGreaterThan(0.9);
  });

  it('holds on the harder floors, under the twists and with stairs everywhere', () => {
    let n = 0;
    for (const twist of ['lights-out', 'windy', 'gusty'] as const)
      for (const { level } of floorsWithStairs(2, { twist, stairsChance: 1 })) {
        const check = validateLevelFlight(level);
        expect(check.ok, `${twist} ${level.id}: ${check.rooms.filter((r) => !r.ok).map((r) => r.key).join(',')}`).toBe(true);
        n++;
      }
    expect(n).toBe(6);
  });
});

describe('the validation of stairs rooms can fail', () => {
  const pick = (kind: string, role: 'leaves' | 'enters') => {
    for (const f of floorsWithStairs(8, { stairsChance: 1 }))
      for (const s of stairsRooms(f.level)) {
        const wanted = role === 'leaves' ? leavesByStairs(s.io) : entersByStairs(s.io);
        if (s.stairs.t === kind && wanted) return { level: structuredClone(f.level), ...s };
      }
    throw new Error(`no ${role} ${kind} found`);
  };
  const roomOk = (level: LevelDef, key: string) => validateLevelFlight(level).rooms.find((r) => r.key === key)!.ok;

  it('a flight of stairs with no lift in front of it cannot be reached', () => {
    const { level, io } = pick('stairsUp', 'leaves');
    expect(roomOk(level, io.key)).toBe(true);
    level.rooms[io.key].items = level.rooms[io.key].items.filter((i) => i.t !== 'floorVent');
    expect(roomOk(level, io.key)).toBe(false);
  });

  it('a stairwell the room has lost leaves the plane nowhere to go', () => {
    const { level, io } = pick('stairsDown', 'leaves');
    expect(roomOk(level, io.key)).toBe(true);
    level.rooms[io.key].items = level.rooms[io.key].items.filter((i) => i.t !== 'stairsDown');
    expect(roomOk(level, io.key)).toBe(false);
  });

  it('a wall across the way out of the stairs fails the room they lead into', () => {
    for (const kind of ['stairsDown', 'stairsUp'] as const) {
      const { level, io } = pick(kind, 'enters');
      expect(roomOk(level, io.key)).toBe(true);
      const a = stairsArrive(level.rooms[io.key].items.find((i) => i.t === kind)!);
      // a solid block right in front of where the plane appears
      level.rooms[io.key].items.push({ t: 'block', x: a.x + io.dirX * 50 - 20, y: a.y - 60, w: 40, h: 160 });
      expect(roomOk(level, io.key), kind).toBe(false);
    }
  });
});

describe('floors with stairs can be flown end to end', () => {
  it('the beam-search pilot solves generated floors through their stairs with the glider recipe', () => {
    const floors = floorsWithStairs(3, { workbenchRoom: false });
    expect(floors.length).toBe(3);
    const via = new Set<string>();
    for (const { seed, floor, level } of floors) {
      const r = solveLevel(level, RECIPES.find((q) => q.id === 'glider')!.make());
      expect(r.solved, `seed ${seed} floor ${floor}: stuck in ${r.stuck}`).toBe(true);
      expect(r.damage).toBeLessThan(80);
      // it really did go up or down the stairs on its way
      const taken = r.trace.filter((t) => t.startsWith('stairs'));
      expect(taken.length, `seed ${seed} floor ${floor}`).toBeGreaterThan(0);
      for (const t of taken) via.add(t.split(' ')[1]);
    }
    expect(via).toEqual(new Set(['up', 'down']));
  });
});
