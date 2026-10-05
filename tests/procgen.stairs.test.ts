import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../src/core/rng';
import { neighbour, type LevelDef } from '../src/game/level';
import { roomColliders } from '../src/world/colliders';
import { allLevels } from '../src/world/campaign';
import { KINDS } from '../src/world/kinds';
import { stairsUpGeom } from '../src/world/stairs';
import { LAYOUT, type ItemDef, type RoomDef } from '../src/world/types';
import { generateFloor, themeForFloor, validateLevel, type FloorOptions } from '../src/world/procgen';
import { STAIRS_REACH, stairsTopWindow } from '../src/world/procgen/air';
import { CATALOG, boxOf } from '../src/world/procgen/catalog';
import { planRoute, STAIRS_CHANCE } from '../src/world/procgen/layout';
import { routeIO, traceRoute } from '../src/world/procgen/route';
import { stairsArrive, stairsFloorSpan, stairsWallBoxes } from '../src/world/procgen/stairsPlan';
import { THEMES } from '../src/world/procgen/themes';
import { entersByStairs, leavesByStairs, OPPOSITE } from '../src/world/procgen/types';

vi.setConfig({ testTimeout: 120000 });

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const FLOORS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

function opts(seed: number, floor: number, extra: Partial<FloorOptions> = {}): FloorOptions {
  return { seed, floor, theme: themeForFloor(floor), workbenchRoom: seed % 2 === 0, ...extra };
}

/** Floors are deterministic, so tests that only inspect a level share one generation per option set. */
const memo = new Map<string, LevelDef>();
function gen(o: FloorOptions): LevelDef {
  const k = JSON.stringify(o);
  let l = memo.get(k);
  if (!l) {
    l = generateFloor(o);
    memo.set(k, l);
  }
  return l;
}

interface Sample {
  seed: number;
  floor: number;
  level: LevelDef;
}

/** Ten seeds on every floor (both themes), as the generator makes them by default. */
const sweep = (): Sample[] => SEEDS.flatMap((seed) => FLOORS.map((floor) => ({ seed, floor, level: gen(opts(seed, floor)) })));
/** The same with every change of storey a flight of stairs: far more stairs per floor generated. */
const allStairs = (): Sample[] => [1, 2, 3, 4].flatMap((seed) => FLOORS.map((floor) => ({ seed, floor, level: gen(opts(seed, floor, { stairsChance: 1 })) })));

const isStairs = (i: ItemDef) => i.t === 'stairsUp' || i.t === 'stairsDown';
const stairsOf = (r: RoomDef) => r.items.filter(isStairs);
const hasStairs = (l: LevelDef) => Object.values(l.rooms).some((r) => stairsOf(r).length > 0);
const label = (s: Sample) => `seed ${s.seed} floor ${s.floor}`;

describe('layout: stairs links', () => {
  const plan = (seed: number, extra: { stairsChance?: number } = {}) => planRoute(createRng(seed), { count: 8, floor: seed % 9, ...extra });
  const vertical = (r: { entry: string; exit: string }) => r.entry === 'up' || r.entry === 'down' || r.exit === 'up' || r.exit === 'down';

  it('makes about half of the changes of storey stairs, and never changes the route itself', () => {
    let stairs = 0;
    let holes = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const mixed = plan(seed);
      const bare = plan(seed, { stairsChance: 0 });
      const all = plan(seed, { stairsChance: 1 });
      const route = (rooms: typeof mixed) => rooms.map((r) => [r.key, r.entry, r.exit, r.entrySpan, r.exitSpan]);
      expect(route(mixed)).toEqual(route(bare));
      expect(route(all)).toEqual(route(bare));
      for (const r of mixed) expect(r.link !== undefined, `${seed}/${r.key}`).toBe(vertical(r));
      for (const r of bare) expect(r.link).toBe(vertical(r) ? 'hole' : undefined);
      for (const r of all) expect(r.link).toBe(vertical(r) ? 'stairs' : undefined);
      for (let i = 0; i < mixed.length - 1; i++) {
        if (mixed[i].exit !== 'up' && mixed[i].exit !== 'down') continue;
        // both ends of a link agree on how it is made (and on where it is: an opening's span, or where the stairs would sit)
        expect(mixed[i + 1].link).toBe(mixed[i].link);
        expect(mixed[i + 1].entry).toBe(OPPOSITE[mixed[i].exit]);
        expect(mixed[i + 1].entrySpan).toEqual(mixed[i].exitSpan);
        if (mixed[i].link === 'stairs') stairs++;
        else holes++;
      }
    }
    expect(stairs + holes).toBeGreaterThan(100);
    expect(Math.abs(stairs / (stairs + holes) - STAIRS_CHANCE)).toBeLessThan(0.1);
  });
});

describe('generated floors have stairs', () => {
  it('some floors do: about half, on both themes, going up and going down', () => {
    const seen = { up: 0, down: 0 };
    const themes = new Set<string>();
    let floors = 0;
    for (const s of sweep()) {
      floors++;
      if (!hasStairs(s.level)) continue;
      themes.add(s.level.place);
      for (const r of Object.values(s.level.rooms)) {
        if (r.items.some((i) => i.t === 'stairsUp')) seen.up++;
        if (r.items.some((i) => i.t === 'stairsDown')) seen.down++;
      }
    }
    expect(themes).toEqual(new Set(['home', 'cottage']));
    // every flight shows up as a stairsUp in one room and a stairsDown in the other
    expect(seen.up).toBe(seen.down);
    expect(seen.up).toBeGreaterThan(30);
    const withStairs = sweep().filter((s) => hasStairs(s.level)).length;
    expect(withStairs / floors).toBeGreaterThan(0.3);
    expect(withStairs / floors).toBeLessThan(0.8);
  });

  it('are deterministic like everything else', () => {
    const o = opts(7, 2);
    expect(hasStairs(gen(o))).toBe(true);
    expect(JSON.stringify(generateFloor(o))).toBe(JSON.stringify(gen(o)));
  });

  it('with stairsChance 0 have none (and only openings join the storeys); with 1, nothing but stairs does', () => {
    for (let seed = 1; seed <= 4; seed++)
      for (const floor of [4, 7]) {
        const bare = gen(opts(seed, floor, { stairsChance: 0 }));
        expect(hasStairs(bare), `${seed}/${floor}`).toBe(false);
        for (const s of traceRoute(bare)) expect(s.link === 'stairs').toBe(false);
        const all = gen(opts(seed, floor, { stairsChance: 1 }));
        for (const r of Object.values(all.rooms)) expect(r.exits.up || r.exits.down).toBeUndefined();
      }
    // some of the all-stairs floors do change storey
    expect(allStairs().filter((s) => hasStairs(s.level)).length).toBeGreaterThan(15);
  });
});

describe('stairs pairs are consistent', () => {
  it('a stairsUp has a stairsDown in the room above (and the other way round), with no opening between them', () => {
    let pairs = 0;
    for (const s of [...sweep(), ...allStairs()]) {
      const { level } = s;
      for (const [key, room] of Object.entries(level.rooms)) {
        const mine = stairsOf(room);
        expect(mine.length, `${label(s)} ${key}`).toBeLessThanOrEqual(1);
        for (const it of mine) {
          const way = it.t === 'stairsUp' ? 'up' : 'down';
          const other = neighbour(level, key, way);
          expect(other, `${label(s)} ${key}: nothing ${way}`).not.toBeNull();
          const there = stairsOf(level.rooms[other!]);
          expect(there.map((i) => i.t), `${label(s)} ${other}`).toEqual([it.t === 'stairsUp' ? 'stairsDown' : 'stairsUp']);
          // one flight of stairs, one look: the same wood and runner at both ends
          expect(there[0].v).toBe(it.v);
          expect([0, 1, 2]).toContain(it.v);
          // and no opening cut between the two rooms
          expect(room.exits[way]).toBeUndefined();
          expect(level.rooms[other!].exits[OPPOSITE[way]]).toBeUndefined();
          pairs++;
        }
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });

  it('the route runs through them: traceRoute and routeIO see a stairs link where the stairs are', () => {
    for (const s of [...sweep(), ...allStairs()].filter((q) => hasStairs(q.level))) {
      const steps = traceRoute(s.level);
      const ios = routeIO(s.level);
      expect(steps.length, label(s)).toBe(Object.keys(s.level.rooms).length);
      ios.forEach((io, i) => {
        const room = s.level.rooms[io.key];
        const stairs = stairsOf(room);
        // a room has stairs exactly when its way in or its way out is a flight of them
        expect(stairs.length > 0, `${label(s)} ${io.key}`).toBe(entersByStairs(io) || leavesByStairs(io));
        expect(steps[i].link === 'stairs').toBe(io.link === 'stairs');
        if (leavesByStairs(io)) {
          expect(stairs[0].t).toBe(io.exit === 'up' ? 'stairsUp' : 'stairsDown');
          // and the next room is entered from the other end
          expect(ios[i + 1].entry).toBe(OPPOSITE[io.exit]);
          expect(entersByStairs(ios[i + 1])).toBe(true);
        }
        if (entersByStairs(io)) {
          expect(stairs[0].t).toBe(io.entry === 'up' ? 'stairsUp' : 'stairsDown');
          // the plane comes out facing along the route, into the room
          expect(stairsArrive(stairs[0]).facing, `${label(s)} ${io.key}`).toBe(io.dirX);
        }
      });
    }
  });

  it('works on hand-built levels too: Knitting by Lamplight climbs its stairs to the attic', () => {
    const level = allLevels().find((l) => l.id === 'cottage-2')!.build();
    const steps = traceRoute(level);
    expect(steps.map((q) => q.key)).toEqual(['0,0', '1,0', '1,-1']);
    expect(steps.map((q) => [q.from, q.to, q.link])).toEqual([
      [null, 'right', undefined],
      ['left', 'up', 'stairs'],
      ['down', 'right', 'stairs'],
    ]);
    const ios = routeIO(level);
    expect(ios.map((io) => [leavesByStairs(io), entersByStairs(io)])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ]);
  });
});

describe('stairs take their own floor and wall', () => {
  /** Where the handrail of a flight runs (y at x), from the painter's own numbers. */
  function railAt(it: ItemDef, x: number): number | null {
    const g = stairsUpGeom(it);
    const rise = (LAYOUT.floor - g.landing.y) / g.steps;
    const x0 = g.foot + g.dir * 6;
    const t = (x - x0) / (g.head - x0);
    return t < 0 || t > 1 ? null : LAYOUT.floor - rise - 30 + (g.landing.y - 30 - (LAYOUT.floor - rise - 30)) * t;
  }

  it('furniture, vents, rugs and wall decor stay off them; the doorway, the landing and the handrail are free wall', () => {
    let rooms = 0;
    for (const s of [...sweep(), ...allStairs()]) {
      for (const [key, room] of Object.entries(s.level.rooms)) {
        for (const st of stairsOf(room)) {
          rooms++;
          const f = stairsFloorSpan(st);
          const where = `${label(s)} ${key} ${st.t}`;
          // inside the room, clear of the side walls
          expect(f.x0, where).toBeGreaterThanOrEqual(LAYOUT.sideWall);
          expect(f.x1, where).toBeLessThanOrEqual(640 - LAYOUT.sideWall);
          for (const it of room.items) {
            if (isStairs(it) || it.t === 'star' || it.t === 'tape' || it.t === 'sheet') continue;
            if (CATALOG[it.t]?.placement === 'floor') {
              const boxes = KINDS[it.t].colliders!(it, room);
              const x0 = Math.min(...boxes.map((b) => b.x));
              const x1 = Math.max(...boxes.map((b) => b.x + b.w));
              expect(x1 <= f.x0 || x0 >= f.x1, `${where}: ${it.t} at ${it.x}`).toBe(true);
            }
            if (it.t === 'floorVent') expect((it.x + (it.w ?? 48) <= f.x0) || it.x >= f.x1, `${where}: vent`).toBe(true);
            if (it.t === 'rug') expect(it.x + (it.w ?? 200) <= f.x0 || it.x >= f.x1, `${where}: rug`).toBe(true);
            if (CATALOG[it.t]?.placement === 'wall' && st.t === 'stairsUp') {
              const b = boxOf(it);
              const g = stairsUpGeom(st);
              // not over the doorway and its casing, nor the landing under it
              expect(b.x + b.w <= g.door.x - 7 || b.x >= g.door.x + g.door.w + 7, `${where}: ${it.t} over the doorway`).toBe(true);
              // and at least a hand's breadth above the rail wherever it hangs over the flight
              for (let x = Math.ceil(b.x); x <= b.x + b.w; x += 4) {
                const rail = railAt(st, x);
                if (rail !== null) expect(b.y + b.h, `${where}: ${it.t} at ${it.x},${it.y} against the handrail`).toBeLessThan(rail - 10);
              }
            }
          }
          // the plane comes out of the stairs in free air
          const a = stairsArrive(st);
          expect(a.x > 0 && a.x < 640 && a.y > 0 && a.y < LAYOUT.floor, where).toBe(true);
          for (const c of roomColliders(room)) {
            const inside = a.x > c.x - 6 && a.x < c.x + c.w + 6 && a.y > c.y - 6 && a.y < c.y + c.h + 6;
            expect(inside, `${where}: arrival in a collider`).toBe(false);
          }
        }
      }
    }
    expect(rooms).toBeGreaterThan(150);
  });

  it('the flight rises towards the exit wall when it is left by, towards the entry wall when it is come out of', () => {
    for (const s of allStairs().filter((q) => hasStairs(q.level)))
      for (const io of routeIO(s.level)) {
        const st = stairsOf(s.level.rooms[io.key]).find((i) => i.t === 'stairsUp');
        if (!st) continue;
        expect(st.dir, `${label(s)} ${io.key}`).toBe(leavesByStairs(io) ? io.dirX : -io.dirX);
        // its high end (the doorway) is by the wall it rises towards
        const g = stairsUpGeom(st);
        expect(Math.sign(g.door.x + g.door.w / 2 - 320), `${label(s)} ${io.key}`).toBe(st.dir);
      }
  });

  it('a stairwell is on the exit side of a room it is dropped into and near the entry wall of one it is come out of', () => {
    for (const s of allStairs().filter((q) => hasStairs(q.level)))
      for (const io of routeIO(s.level)) {
        const st = stairsOf(s.level.rooms[io.key]).find((i) => i.t === 'stairsDown');
        if (!st) continue;
        const cx = st.x + (st.w ?? 150) / 2;
        const u = io.dirX > 0 ? cx : 640 - cx;
        if (leavesByStairs(io)) expect(u, `${label(s)} ${io.key}`).toBeGreaterThanOrEqual(385);
        else expect(u, `${label(s)} ${io.key}`).toBeLessThanOrEqual(175);
      }
  });
});

describe('the wall and floor a flight of stairs takes', () => {
  const up: ItemDef = { t: 'stairsUp', x: 392, y: 340, w: 222, top: 172, dir: 1, v: 0 };
  const down: ItemDef = { t: 'stairsDown', x: 40, y: 302, w: 150, dir: 1, v: 0 };

  it('a flight takes the floor from its foot to its far end; a stairwell its width and a little more', () => {
    expect(stairsFloorSpan(up)).toEqual({ x0: 392, x1: 614 });
    expect(stairsFloorSpan({ ...up, x: 26, dir: -1 })).toEqual({ x0: 26, x1: 248 });
    const f = stairsFloorSpan(down);
    expect(f.x0).toBeLessThan(40);
    expect(f.x1).toBeGreaterThan(190);
  });

  it('and the wall: the doorway\'s column first (up to the ceiling, down to the dado), then steps above the handrail', () => {
    const g = stairsUpGeom(up);
    const [column, ...steps] = stairsWallBoxes(up);
    expect(column.y).toBe(0);
    expect(column.y + column.h).toBe(LAYOUT.dado);
    expect(column.x).toBeLessThan(g.door.x);
    expect(column.x + column.w).toBeGreaterThan(g.door.x + g.door.w);
    // the steps follow the flight up to the landing, higher and higher (the low end of the rail is below any decor)
    expect(steps.length).toBeGreaterThan(2);
    for (let i = 1; i < steps.length; i++) {
      expect(Math.abs(steps[i].x - (steps[i - 1].x + steps[i - 1].w))).toBeLessThanOrEqual(1);
      expect(steps[i].y).toBeLessThan(steps[i - 1].y);
    }
    expect(steps[0].x).toBeGreaterThanOrEqual(g.foot);
    expect(steps[steps.length - 1].x + steps[steps.length - 1].w).toBe(g.head);
    // mirrored flights mirror their boxes
    const m = stairsWallBoxes({ ...up, x: 26, dir: -1 });
    expect(m[0].y).toBe(0);
    expect(m.length).toBe(steps.length + 1);
    expect(stairsWallBoxes(down)).toEqual([]);
  });
});

describe('the lift in front of a flight of stairs', () => {
  it('has a window for the top of the updraft that is wider for a lower doorway and sits lower the farther the vent is', () => {
    for (const mid of [128, 140, 152]) {
      for (let D = 220; D < STAIRS_REACH; D += 20) {
        const w = stairsTopWindow(mid, D);
        const farther = stairsTopWindow(mid, D + 20);
        expect(w.hi).toBeGreaterThanOrEqual(w.lo);
        // a vent 20 px farther from the doorway has to lift the plane higher (a smaller y)
        expect(farther.lo).toBeLessThan(w.lo);
        expect(farther.hi).toBeLessThan(w.hi);
        // a lower doorway (a larger y) leaves more room
        expect(stairsTopWindow(mid + 12, D).hi - stairsTopWindow(mid + 12, D).lo).toBeGreaterThan(w.hi - w.lo);
      }
    }
  });

  it('is one vent, clear of the foot, within reach of the doorway and with its top inside the window', () => {
    let rooms = 0;
    for (const s of [...sweep(), ...allStairs()])
      for (const io of routeIO(s.level)) {
        if (!leavesByStairs(io) || io.exit !== 'up') continue;
        rooms++;
        const room = s.level.rooms[io.key];
        const st = stairsOf(room)[0];
        const vents = room.items.filter((i) => i.t === 'floorVent');
        const where = `${label(s)} ${io.key}`;
        expect(vents.length, where).toBe(1);
        const g = stairsUpGeom(st);
        const [vx0, vx1] = [vents[0].x, vents[0].x + (vents[0].w ?? 48)];
        // in front of the foot: the vent's far edge is a good way from the first step
        const footGap = io.dirX > 0 ? g.foot - vx1 : vx0 - g.foot;
        expect(footGap, where).toBeGreaterThanOrEqual(16);
        // near enough the doorway for the glide to reach it, and the updraft tops out where a plane can still make the door
        const D = Math.abs(g.door.x + g.door.w / 2 - (vx0 + vx1) / 2);
        expect(D, where).toBeLessThanOrEqual(STAIRS_REACH);
        const win = stairsTopWindow(g.door.y + g.door.h / 2, D);
        expect(vents[0].reach as number, where).toBeGreaterThanOrEqual(win.lo);
        expect(vents[0].reach as number, where).toBeLessThanOrEqual(win.hi);
      }
    expect(rooms).toBeGreaterThan(30);
  });
});

describe('stairs look like their house', () => {
  it('take the wood and runner of the theme, one per flight, and vary', () => {
    const seen = { home: new Set<number>(), cottage: new Set<number>() };
    for (const s of [...sweep(), ...allStairs()]) {
      const theme = THEMES[s.level.place as 'home' | 'cottage'];
      for (const room of Object.values(s.level.rooms))
        for (const st of stairsOf(room)) {
          expect(theme.stairs.map((q) => q.v), `${label(s)}`).toContain(st.v);
          seen[theme.id].add(st.v as number);
        }
    }
    expect(seen.home.size).toBeGreaterThanOrEqual(2);
    expect(seen.cottage.size).toBeGreaterThanOrEqual(2);
  });
});

describe('generated levels with stairs are structurally valid', () => {
  it('10 seeds on every floor, by default', () => {
    let withStairs = 0;
    for (const s of sweep()) {
      const v = validateLevel(s.level);
      expect(v.problems, label(s)).toEqual([]);
      if (hasStairs(s.level)) withStairs++;
    }
    expect(withStairs).toBeGreaterThan(30);
  });

  it('4 seeds on every floor with every change of storey a flight of stairs', () => {
    for (const s of allStairs()) expect(validateLevel(s.level).problems, label(s)).toEqual([]);
  });

  it('also under the twists that change the rooms (dark houses, wind)', () => {
    let rooms = 0;
    for (const twist of ['lights-out', 'windy', 'night'] as const)
      for (const seed of [1, 2, 3, 4])
        for (const floor of [3, 6]) {
          const level = gen({ seed, floor, theme: themeForFloor(floor), twist, stairsChance: 1 });
          expect(validateLevel(level).problems, `${twist} ${seed}/${floor}`).toEqual([]);
          rooms += Object.values(level.rooms).filter((r) => stairsOf(r).length).length;
        }
    expect(rooms).toBeGreaterThan(8);
  });
});

describe('validateLevel catches broken stairs', () => {
  /** A level with a flight going up from one room to the next, and the rooms it joins. */
  function withStairs(): { level: LevelDef; below: string; above: string } {
    for (const seed of SEEDS)
      for (const floor of [3, 4, 5]) {
        const level = structuredClone(gen(opts(seed, floor, { stairsChance: 1 })));
        for (const [key, room] of Object.entries(level.rooms))
          if (room.items.some((i) => i.t === 'stairsUp')) return { level, below: key, above: neighbour(level, key, 'up')! };
      }
    throw new Error('no floor with stairs found');
  }
  const problems = (l: LevelDef) => validateLevel(l).problems;

  it('accepts the generated level', () => {
    expect(problems(withStairs().level)).toEqual([]);
  });

  it('finds stairs with no matching stairs in the room beyond, or leading nowhere', () => {
    const { level, above } = withStairs();
    level.rooms[above].items = level.rooms[above].items.filter((i) => i.t !== 'stairsDown');
    expect(problems(level).some((p) => p.includes('no matching stairsDown'))).toBe(true);

    // a second flight in the same room (this one leads down, to a room that has no stairs up)
    const l2 = withStairs();
    const up = l2.level.rooms[l2.below].items.find((i) => i.t === 'stairsUp')!;
    l2.level.rooms[l2.below].items.push({ ...up, t: 'stairsDown', y: LAYOUT.wallBase });
    expect(problems(l2.level).some((p) => p.includes('stairsDown'))).toBe(true);
  });

  it('finds an opening and stairs joining the same two rooms', () => {
    const { level, below, above } = withStairs();
    level.rooms[below].exits.up = { from: 200, to: 330 };
    level.rooms[above].exits.down = { from: 200, to: 330 };
    expect(problems(level).some((p) => p.includes('stairs and an opening'))).toBe(true);
  });

  it('finds furniture, a vent or a rug on the stairs, and decor over the doorway', () => {
    const base = withStairs();
    const room = base.level.rooms[base.below];
    const st = room.items.find((i) => i.t === 'stairsUp')!;
    const f = stairsFloorSpan(st);
    const g = stairsUpGeom(st);

    const l1 = structuredClone(base.level);
    l1.rooms[base.below].items.push({ t: 'sideTable', x: f.x0 + 40, y: LAYOUT.floor - 84, w: 80, v: 0 });
    expect(problems(l1).some((p) => p.includes('stands on the stairsUp'))).toBe(true);

    const l2 = structuredClone(base.level);
    l2.rooms[base.below].items.push({ t: 'floorVent', x: f.x0 + 60, y: 330, w: 48, power: 4, reach: 80 });
    expect(problems(l2).some((p) => p.includes('floor vent is inside the stairsUp'))).toBe(true);

    const l3 = structuredClone(base.level);
    l3.rooms[base.below].items.push({ t: 'rug', x: f.x0 + 20, y: 326, w: 150, v: 0 });
    expect(problems(l3).some((p) => p.includes('rug runs under the stairsUp'))).toBe(true);

    const l4 = structuredClone(base.level);
    l4.rooms[base.below].items.push({ t: 'frame', x: g.door.x + 2, y: g.door.y - 40, w: 40, h: 30, v: 0 });
    expect(problems(l4).some((p) => p.includes('hangs over the stairsUp'))).toBe(true);
  });

  it('finds stairs that are not on the floor, or a plane that would come out inside furniture', () => {
    const base = withStairs();
    const l1 = structuredClone(base.level);
    l1.rooms[base.below].items.find((i) => i.t === 'stairsUp')!.y = 300;
    expect(problems(l1).some((p) => p.includes('must stand on the floor'))).toBe(true);

    const l2 = structuredClone(base.level);
    const a = stairsArrive(l2.rooms[base.above].items.find((i) => i.t === 'stairsDown')!);
    l2.rooms[base.above].items.push({ t: 'bookshelf', x: a.x - 40, y: LAYOUT.floor - 214, w: 100, h: 214, v: 0 });
    expect(problems(l2).some((p) => p.includes('brings the plane out inside furniture or a wall'))).toBe(true);
  });
});
