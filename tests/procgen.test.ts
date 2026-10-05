import { describe, expect, it } from 'vitest';
import { createRng, dailySeed } from '../src/core/rng';
import { countStars, neighbour, type LevelDef } from '../src/game/level';
import { KINDS } from '../src/world/kinds';
import { LAYOUT, type ItemDef, type RoomDef } from '../src/world/types';
import {
  dailyOptions,
  generateFloor,
  generateFloorWithReport,
  themeForFloor,
  validateLevel,
  type FloorOptions,
  type TwistId,
} from '../src/world/procgen';
import { CATALOG, CANDLE, floorY, sizeOf, surfaceOf } from '../src/world/procgen/catalog';
import { HOLE_HALF, planRoute } from '../src/world/procgen/layout';
import { traceRoute } from '../src/world/procgen/route';
import { THEMES } from '../src/world/procgen/themes';

const SEEDS = [1, 2, 3, 4];
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

const stubRoom: RoomDef = {
  id: 'stub',
  name: 'stub',
  wall: { pattern: 'plain', base: 'cream', accent: 'cream', wainscot: null, trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  exits: {},
  items: [],
};

const allItems = (level: LevelDef) => Object.values(level.rooms).flatMap((r) => r.items);

describe('themeForFloor', () => {
  it('rotates themes every two floors', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(themeForFloor)).toEqual(['home', 'home', 'cottage', 'cottage', 'home', 'home', 'cottage', 'cottage']);
  });
});

describe('determinism', () => {
  it('the same options give a deep-equal level (and a different seed a different one)', () => {
    for (const floor of [0, 3, 6]) {
      const a = generateFloor(opts(7, floor));
      const b = generateFloor(opts(7, floor));
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(generateFloor(opts(8, floor))).not.toEqual(a);
    }
  });

  it('floor, theme, twist and room count all change the house', () => {
    const base = generateFloor(opts(11, 2));
    expect(generateFloor(opts(11, 3))).not.toEqual(base);
    expect(generateFloor(opts(11, 2, { theme: 'home' }))).not.toEqual(base);
    expect(generateFloor(opts(11, 2, { rooms: 7 }))).not.toEqual(base);
  });

  it('does not depend on Math.random (the headless objects only use it for particles)', () => {
    const run = (seed: number) => {
      const orig = Math.random;
      const r = createRng(seed);
      Math.random = () => r.next();
      try {
        return generateFloor(opts(5, 4));
      } finally {
        Math.random = orig;
      }
    };
    expect(run(1)).toEqual(run(2));
  });
});

describe('daily options', () => {
  it('are stable for a date key and differ between dates', () => {
    const a = dailyOptions('2026-03-14');
    expect(dailyOptions('2026-03-14')).toEqual(a);
    expect(a.seed).toBe(dailySeed('2026-03-14'));
    expect(a.rooms).toBe(8);
    expect(a.twist).not.toBe('none');
    expect(a.workbenchRoom).toBe(false);
    expect(a.floor).toBeGreaterThanOrEqual(2);
    expect(a.floor).toBeLessThanOrEqual(5);
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d++) seen.add(JSON.stringify(dailyOptions(`2026-02-${String(d).padStart(2, '0')}`)));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('pin the options of a fixed date (changing the algorithm changes every player\'s daily house)', () => {
    expect(dailyOptions('2026-01-01')).toEqual({
      seed: 3923925312,
      floor: 4,
      theme: 'home',
      rooms: 8,
      twist: 'night',
      workbenchRoom: false,
    });
  });

  it('give the same house for everyone', () => {
    const o = dailyOptions('2026-05-05');
    const a = generateFloor(o);
    expect(generateFloor(dailyOptions('2026-05-05'))).toEqual(a);
    expect(Object.keys(a.rooms).length).toBe(8);
    expect(a.twist).toBe(o.twist === 'none' ? undefined : o.twist);
  });
});

describe('catalog', () => {
  it('lists the kinds the painters know', () => {
    for (const k of Object.keys(CATALOG)) expect(KINDS[k], `kind ${k} has art`).toBeDefined();
  });

  it('floor furniture stands on the floor line and its colliders end there', () => {
    for (const e of Object.values(CATALOG).filter((c) => c.placement === 'floor')) {
      const it: ItemDef = { t: e.kind, x: 0, y: floorY(e.h) };
      const boxes = KINDS[e.kind].colliders!(it, stubRoom);
      expect(boxes.length, e.kind).toBeGreaterThan(0);
      expect(Math.max(...boxes.map((b) => b.y + b.h)), `${e.kind} collider bottom`).toBe(LAYOUT.floor);
    }
  });

  it('surface tops match the real colliders', () => {
    for (const e of Object.values(CATALOG).filter((c) => c.surface)) {
      const it: ItemDef = { t: e.kind, x: 100, y: 100 };
      const boxes = KINDS[e.kind].colliders!(it, stubRoom);
      const s = surfaceOf(it)!;
      const slab = boxes.reduce((a, b) => (b.y < a.y ? b : a));
      expect(slab.y, `${e.kind} top`).toBe(s.top);
      expect(slab.x, `${e.kind} slab x`).toBe(s.x0);
      expect(slab.x + slab.w, `${e.kind} slab right`).toBe(s.x1);
    }
  });

  it('surface items rest on the collider top', () => {
    for (const e of Object.values(CATALOG).filter((c) => c.placement === 'surface')) {
      const it: ItemDef = { t: e.kind, x: 100, y: 100 };
      if (e.kind === 'candle') it.wax = 18;
      const boxes = KINDS[e.kind].colliders?.(it, stubRoom) ?? [];
      if (boxes.length === 0) continue;
      const bottom = Math.max(...boxes.map((b) => b.y + b.h));
      const rest = e.kind === 'candle' ? 18 + CANDLE.holder : e.rest!;
      // the lowest collider ends within a pixel or two of the painted base
      expect(Math.abs(bottom - (100 + rest)), `${e.kind} rest`).toBeLessThanOrEqual(2);
    }
  });

  it('default sizes are what the painters use', () => {
    expect(sizeOf({ t: 'bed', x: 0, y: 0 })).toEqual({ w: 230, h: 130 });
    expect(sizeOf({ t: 'desk', x: 0, y: 0, w: 150 })).toEqual({ w: 150, h: 98 });
    expect(sizeOf({ t: 'bookshelf', x: 0, y: 0 })).toEqual({ w: 112, h: 214 });
  });

  it('every kind a template names exists in the catalog', () => {
    for (const theme of Object.values(THEMES))
      for (const t of theme.templates) {
        for (const s of t.floorPlan) {
          expect(CATALOG[s.kind], s.kind).toBeDefined();
          for (const o of s.on ?? []) expect(CATALOG[o.kind], o.kind).toBeDefined();
        }
        for (const w of t.wallPlan) expect(CATALOG[w.kind], w.kind).toBeDefined();
      }
  });
});

describe('layout', () => {
  it('plans a connected path with matching spans, one exit and mostly horizontal moves', () => {
    let vertical = 0;
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const route = planRoute(createRng(seed), { count: 8, floor: seed % 9 });
      expect(route.length).toBe(8);
      const keys = new Set(route.map((r) => r.key));
      expect(keys.size).toBe(8);
      expect(route[0].entry).toBe('start');
      expect(route[7].exitSpan.exit).toBe(true);
      for (let i = 0; i < 7; i++) {
        expect(route[i + 1].entrySpan).toEqual(route[i].exitSpan);
        total++;
        if (route[i].exit === 'up' || route[i].exit === 'down') vertical++;
        // never two vertical moves in a row, never vertical into the last room
        if (route[i].exit === 'up' || route[i].exit === 'down') {
          expect(route[i + 1].exit === 'up' || route[i + 1].exit === 'down').toBe(false);
          expect(i + 1).toBeLessThan(7);
        }
      }
      for (const r of route) {
        expect(r.gx).toBeGreaterThanOrEqual(0);
        expect(r.gy).toBeGreaterThanOrEqual(0);
        if (r.exit === 'up' || r.exit === 'down') expect(r.exitSpan.to - r.exitSpan.from).toBe(2 * HOLE_HALF);
      }
    }
    // about one transition in five (a bit more on later floors)
    expect(vertical / total).toBeGreaterThan(0.12);
    expect(vertical / total).toBeLessThan(0.4);
  });

  it('chooses the direction of progress from the seed', () => {
    const dirs = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) dirs.add(planRoute(createRng(seed), { count: 6, floor: 0 })[0].dirX);
    expect(dirs).toEqual(new Set([1, -1]));
  });
});

describe('generated levels are structurally valid', () => {
  for (const floor of FLOORS) {
    it(`floor ${floor}`, () => {
      for (const seed of SEEDS) {
        const level = gen(opts(seed, floor));
        const v = validateLevel(level);
        expect(v.problems, `seed ${seed} floor ${floor}`).toEqual([]);
        expect(v.ok).toBe(true);
      }
    }, 30000);
  }

  it('honours the room count (workbench room included) and rejects tiny ones gracefully', () => {
    expect(Object.keys(gen({ seed: 1, floor: 0, theme: 'home', rooms: 5 }).rooms).length).toBe(5);
    expect(Object.keys(gen({ seed: 1, floor: 0, theme: 'home', rooms: 8, workbenchRoom: true }).rooms).length).toBe(8);
    expect(Object.keys(gen({ seed: 1, floor: 0, theme: 'home', rooms: 2 }).rooms).length).toBe(2);
    const dflt = Object.keys(gen({ seed: 3, floor: 0, theme: 'home' }).rooms).length;
    expect(dflt).toBeGreaterThanOrEqual(6);
    expect(dflt).toBeLessThanOrEqual(8);
  });

  it('starts in the first room with the right facing, sheets and par', () => {
    for (let floor = 0; floor <= 8; floor++) {
      const level = gen(opts(3, floor));
      const route = traceRoute(level);
      expect(route[0].key).toBe(level.start.room);
      expect(level.sheets).toBe(floor <= 1 ? 5 : floor <= 3 ? 4 : 3);
      expect(level.par).toBe(Object.keys(level.rooms).length * 9);
      const fromWall = level.start.facing > 0 ? level.start.x : 640 - level.start.x;
      expect(fromWall).toBeGreaterThanOrEqual(40);
      expect(fromWall).toBeLessThanOrEqual(120);
      expect(level.start.y).toBeGreaterThanOrEqual(120);
      expect(level.start.y).toBeLessThanOrEqual(200);
    }
  });

  it('the last room has the exit and a front door beside it', () => {
    for (const seed of SEEDS) {
      const level = gen(opts(seed, 2));
      const route = traceRoute(level);
      const last = route[route.length - 1];
      const room = level.rooms[last.key];
      expect(room.exits[last.to!]!.exit).toBe(true);
      expect(neighbour(level, last.key, last.to!)).toBeNull();
      const door = room.items.find((i) => i.t === 'frontDoor');
      expect(door).toBeDefined();
      expect(door!.y).toBe(room.exits[last.to!]!.from + 8);
      expect(door!.y + (door!.h ?? 0)).toBe(room.exits[last.to!]!.to);
      // closed walls elsewhere: only the side(s) the route uses have openings (a flight of stairs is a way in or out too)
      for (const k of Object.keys(level.rooms)) {
        const sides = (['left', 'right', 'up', 'down'] as const).filter((s) => level.rooms[k].exits[s]);
        const stairs = level.rooms[k].items.filter((i) => i.t === 'stairsUp' || i.t === 'stairsDown');
        expect(sides.length + stairs.length).toBeGreaterThanOrEqual(1);
        expect(sides.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('openings that connect two rooms have identical spans', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const level = gen(opts(seed, 6));
      for (const [key, room] of Object.entries(level.rooms))
        for (const side of ['left', 'right', 'up', 'down'] as const) {
          const span = room.exits[side];
          const n = neighbour(level, key, side);
          if (!span || !n) continue;
          const back = level.rooms[n].exits[{ left: 'right', right: 'left', up: 'down', down: 'up' }[side] as 'left'];
          expect(back).toEqual(span);
        }
    }
  });

  // (floors whose storeys are all joined by openings: the stairs have no opening, see tests/procgen.stairs.test.ts)
  const holes = (seed: number) => gen(opts(seed, 5, { stairsChance: 0 }));

  it('up openings sit above a strong floor vent whose updraft goes through the ceiling', () => {
    let seen = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const level = holes(seed);
      const route = traceRoute(level);
      for (const step of route) {
        if (step.to !== 'up') continue;
        seen++;
        const room = level.rooms[step.key];
        const up = room.exits.up!;
        const vent = room.items.find((i) => i.t === 'floorVent' && i.x + (i.w ?? 48) / 2 > up.from && i.x + (i.w ?? 48) / 2 < up.to);
        expect(vent, `room ${step.key}`).toBeDefined();
        expect((vent!.power as number) ?? 3.2).toBeGreaterThanOrEqual(4.2);
        expect(vent!.reach as number).toBeLessThan(0);
        // the room above has the matching floor opening
        const above = neighbour(level, step.key, 'up')!;
        expect(level.rooms[above].exits.down).toEqual(up);
      }
    }
    expect(seen).toBeGreaterThan(3);
  });

  it('floor openings have a ceiling opening in the room below', () => {
    let seen = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const level = holes(seed);
      for (const step of traceRoute(level)) {
        if (step.to !== 'down') continue;
        seen++;
        const below = neighbour(level, step.key, 'down')!;
        expect(level.rooms[below].exits.up).toEqual(level.rooms[step.key].exits.down);
      }
    }
    expect(seen).toBeGreaterThan(3);
  });
});

describe('items', () => {
  it('floor furniture stands on the floor with disjoint x-ranges (rugs aside)', () => {
    for (const seed of SEEDS)
      for (const floor of [1, 4, 7]) {
        const level = gen(opts(seed, floor));
        for (const room of Object.values(level.rooms)) {
          const spans: [number, number][] = [];
          for (const it of room.items) {
            if (CATALOG[it.t]?.placement !== 'floor') continue;
            expect(it.y + sizeOf(it).h).toBe(LAYOUT.floor);
            const boxes = KINDS[it.t].colliders!(it, room);
            spans.push([Math.min(...boxes.map((b) => b.x)), Math.max(...boxes.map((b) => b.x + b.w))]);
          }
          spans.sort((a, b) => a[0] - b[0]);
          for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
        }
      }
  });

  it('every star has a stable id of the form roomKey:star:n; ids are unique', () => {
    for (const seed of SEEDS)
      for (const floor of [0, 3, 8]) {
        const level = gen(opts(seed, floor));
        const ids = new Set<string>();
        for (const [key, room] of Object.entries(level.rooms)) {
          const stars = room.items.filter((i) => i.t === 'star');
          expect(stars.length, `${key} stars`).toBeGreaterThanOrEqual(1);
          expect(stars.length).toBeLessThanOrEqual(3);
          stars.forEach((s, n) => expect(s.id).toBe(`${key}:star:${n}`));
          for (const it of room.items) if (typeof it.id === 'string') {
            expect(ids.has(it.id), it.id).toBe(false);
            ids.add(it.id);
          }
          for (const it of room.items) if (it.t === 'tape' || it.t === 'sheet') expect(String(it.id)).not.toContain(':star:');
        }
        expect(countStars(level)).toBeGreaterThanOrEqual(Object.keys(level.rooms).length);
      }
  });

  it('wall decor stays on the wall band and out of the way of tall furniture', () => {
    const level = gen(opts(2, 3));
    for (const room of Object.values(level.rooms))
      for (const it of room.items) {
        if (it.t === 'frame' || it.t === 'poster' || it.t === 'wallClock') expect(it.y).toBeGreaterThanOrEqual(34);
      }
  });

  it('tape and spare sheets are occasional, never in the first room', () => {
    let tapes = 0;
    let sheets = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const level = gen(opts(seed, 4));
      for (const [key, room] of Object.entries(level.rooms)) {
        for (const it of room.items) {
          if (it.t === 'tape') tapes++;
          if (it.t === 'sheet') sheets++;
          if ((it.t === 'tape' || it.t === 'sheet') && key === level.start.room) throw new Error('pickup in the first room');
        }
      }
    }
    expect(tapes).toBeGreaterThan(0);
    expect(sheets).toBeLessThan(tapes + 6);
  });
});

describe('workbench room', () => {
  it('is calm, last, and has a workbench on a desk', () => {
    for (const seed of [1, 2, 3]) {
      const level = gen({ seed, floor: 5, theme: themeForFloor(5), workbenchRoom: true });
      const route = traceRoute(level);
      const last = level.rooms[route[route.length - 1].key];
      const wb = last.items.find((i) => i.t === 'workbench')!;
      expect(wb).toBeDefined();
      const desk = last.items.find((i) => i.t === 'desk' && i.x === wb.x)!;
      expect(desk).toBeDefined();
      expect(wb.w).toBe(sizeOf(desk).w);
      expect(wb.y).toBe(desk.y + 2);
      expect(surfaceOf(desk)!.top).toBe(wb.y);
      // nothing stands on the bench, no hazards in the calm room
      for (const it of last.items) {
        if (CATALOG[it.t]?.placement === 'surface') {
          const s = surfaceOf(desk)!;
          expect(it.x + 14 < s.x0 || it.x > s.x1).toBe(true);
        }
        expect(['candle', 'fan', 'drip', 'ceilingVent']).not.toContain(it.t);
      }
      expect(last.dark).toBeUndefined();
      // exactly one workbench per floor
      expect(allItems(level).filter((i) => i.t === 'workbench').length).toBe(1);
    }
  });

  it('keeps the air above the desk free: no window sill or lamp to land on instead', () => {
    for (const seed of [2, 4, 6, 8])
      for (const floor of [3, 6]) {
        const level = gen({ seed, floor, theme: themeForFloor(floor), workbenchRoom: true });
        const route = traceRoute(level);
        const last = level.rooms[route[route.length - 1].key];
        const bench = last.items.find((i) => i.t === 'workbench')!;
        const x1 = bench.x + (bench.w ?? 0);
        for (const it of last.items) {
          if (it.t === 'desk') continue;
          for (const c of KINDS[it.t]?.colliders?.(it, last) ?? []) {
            const hangsOver = c.y + c.h <= bench.y && c.x < x1 && bench.x < c.x + c.w;
            expect(hangsOver, `${it.t} over the bench (seed ${seed}, floor ${floor})`).toBe(false);
          }
        }
      }
  });

  it('is absent when not requested', () => {
    expect(allItems(gen({ seed: 1, floor: 0, theme: 'home' })).some((i) => i.t === 'workbench')).toBe(false);
  });
});

describe('hazards scale with the floor', () => {
  const count = (floor: number, kind: string, extra: Partial<FloorOptions> = {}) => {
    let n = 0;
    for (let seed = 1; seed <= 8; seed++) n += allItems(gen({ seed, floor, theme: themeForFloor(floor), ...extra })).filter((i) => i.t === kind).length;
    return n;
  };

  it('floor 0 has no hazards besides a few candles', () => {
    for (const k of ['fan', 'drip', 'ceilingVent', 'switch']) expect(count(0, k)).toBe(0);
    for (let seed = 1; seed <= 8; seed++) for (const r of Object.values(gen({ seed, floor: 0, theme: 'home' }).rooms)) expect(r.dark || r.night).toBeFalsy();
  });

  it('later floors have more of everything', () => {
    for (const k of ['candle', 'fan', 'drip', 'switch']) expect(count(8, k)).toBeGreaterThan(count(1, k));
    expect(count(8, 'ceilingVent')).toBeGreaterThan(0);
  });

  it('vents are generous early and fewer later', () => {
    expect(count(0, 'floorVent')).toBeGreaterThan(count(8, 'floorVent'));
  });

  it('dark rooms have a switch and a matching switch plate; lit rooms have neither', () => {
    let dark = 0;
    for (let seed = 1; seed <= 12; seed++)
      for (const room of Object.values(gen(opts(seed, 8)).rooms)) {
        const sw = room.items.filter((i) => i.t === 'switch');
        const plates = room.items.filter((i) => i.t === 'switchPlate');
        if (room.dark) {
          dark++;
          expect(sw.length).toBe(1);
          expect(plates.length).toBe(1);
          expect([plates[0].x, plates[0].y]).toEqual([sw[0].x, sw[0].y]);
        } else {
          expect(sw.length + plates.length).toBe(0);
        }
      }
    expect(dark).toBeGreaterThan(5);
  });

  it('candles come with a static stand at the same position as the flame object', () => {
    for (let seed = 1; seed <= 6; seed++)
      for (const room of Object.values(gen(opts(seed, 6)).rooms))
        for (const c of room.items.filter((i) => i.t === 'candle')) {
          // a single item serves as both the art and the flame; it stands on a table top
          expect(typeof c.wax).toBe('number');
          const bottom = c.y + (c.wax as number) + CANDLE.holder;
          expect(room.items.some((h) => surfaceOf(h) && Math.abs(surfaceOf(h)!.top - bottom) <= 1)).toBe(true);
        }
  });

  it('fans stand on a table (stand + head height) and blow along the corridor', () => {
    let fans = 0;
    for (let seed = 1; seed <= 12; seed++)
      for (const room of Object.values(gen(opts(seed, 8)).rooms))
        for (const f of room.items.filter((i) => i.t === 'fan')) {
          fans++;
          const base = f.y + (f.stand as number) + 32;
          expect(room.items.some((h) => surfaceOf(h) && surfaceOf(h)!.top === base && f.x + 16 > surfaceOf(h)!.x0 && f.x + 16 < surfaceOf(h)!.x1)).toBe(true);
          expect([1, -1]).toContain(f.dir);
        }
    expect(fans).toBeGreaterThan(3);
  });
});

describe('twists', () => {
  const house = (twist: TwistId, floor = 3, seed = 4) => gen({ seed, floor, theme: themeForFloor(floor), twist });

  it('lights-out darkens every room and gives each a switch', () => {
    const level = house('lights-out');
    expect(level.twist).toBe('lights-out');
    for (const room of Object.values(level.rooms)) {
      expect(room.dark).toBe(true);
      expect(room.items.filter((i) => i.t === 'switch').length).toBe(1);
    }
    expect(validateLevel(level).problems).toEqual([]);
  });

  it('night puts night outside every window', () => {
    const level = house('night');
    for (const room of Object.values(level.rooms)) expect(room.night).toBe(true);
  });

  it('windy and gusty add fans', () => {
    const fans = (t: TwistId) => {
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) n += allItems(house(t, 3, seed)).filter((i) => i.t === 'fan').length;
      return n;
    };
    const none = fans('none');
    expect(fans('windy')).toBeGreaterThan(none);
    expect(fans('gusty')).toBeGreaterThan(none);
  });

  it('the other twists leave the house as it is, except for the twist tag', () => {
    const base = house('none');
    for (const t of ['tissue', 'cardstock', 'heavy-nose', 'fold-budget', 'one-sheet'] as TwistId[]) {
      const level = house(t);
      expect(level.twist).toBe(t);
      expect({ ...level, twist: undefined }).toEqual({ ...base, twist: undefined });
    }
    expect(base.twist).toBeUndefined();
  });
});

describe('validateLevel catches broken levels', () => {
  const good = () => structuredClone(gen({ seed: 2, floor: 4, theme: 'home', workbenchRoom: true }));

  it('accepts the generated level', () => {
    expect(validateLevel(good())).toEqual({ ok: true, problems: [] });
  });

  it('finds an opening that does not line up', () => {
    const level = good();
    const room = Object.values(level.rooms).find((r) => r.exits.right && !r.exits.right.exit && r.exits.right)!;
    room.exits.right = { ...room.exits.right!, from: room.exits.right!.from + 8 };
    expect(validateLevel(level).ok).toBe(false);
  });

  it('finds duplicate ids, items outside the room and overlapping furniture', () => {
    const level = good();
    const rooms = Object.values(level.rooms);
    const withStars = rooms.filter((r) => r.items.some((i) => i.t === 'star'));
    const first = withStars[0].items.find((i) => i.t === 'star')!;
    const second = withStars[1].items.find((i) => i.t === 'star')!;
    second.id = first.id;
    expect(validateLevel(level).problems.some((p) => p.includes('duplicate id') || p.includes('does not look like'))).toBe(true);

    const l2 = good();
    const r2 = Object.values(l2.rooms)[1];
    r2.items.push({ t: 'frame', x: 630, y: 80 });
    expect(validateLevel(l2).problems.some((p) => p.includes('leaves the room'))).toBe(true);

    const l3 = good();
    const r3 = Object.values(l3.rooms).find((r) => r.items.filter((i) => CATALOG[i.t]?.placement === 'floor').length >= 2)!;
    const [a, b] = r3.items.filter((i) => CATALOG[i.t]?.placement === 'floor');
    b.x = a.x;
    expect(validateLevel(l3).problems.some((p) => p.includes('overlap') || p.includes('stands on'))).toBe(true);
  });

  it('finds a floating lamp, a missing exit and a switch in a lit room', () => {
    const l1 = good();
    const r1 = Object.values(l1.rooms).find((r) => r.items.some((i) => i.t === 'deskLamp'))!;
    r1.items.find((i) => i.t === 'deskLamp')!.y -= 30;
    expect(validateLevel(l1).problems.some((p) => p.includes('table top'))).toBe(true);

    const l2 = good();
    for (const r of Object.values(l2.rooms)) for (const s of ['left', 'right'] as const) if (r.exits[s]?.exit) delete r.exits[s]!.exit;
    expect(validateLevel(l2).ok).toBe(false);

    const l3 = good();
    Object.values(l3.rooms)[0].items.push({ t: 'switch', x: 100, y: 150 });
    expect(validateLevel(l3).problems.some((p) => p.includes('not dark'))).toBe(true);
  });

  it('finds a start that faces away from the exit', () => {
    const level = good();
    level.start.facing = (level.start.facing * -1) as 1 | -1;
    expect(validateLevel(level).problems.some((p) => p.includes('faces away'))).toBe(true);
  });

  it('finds wall decor hanging into the top of furniture, but judges a bed by its real solid parts', () => {
    const hangs = (level: LevelDef) => validateLevel(level).problems.filter((p) => p.includes('hangs into the top'));
    expect(hangs(good())).toEqual([]);

    // a frame dipping into a desk top
    const l1 = good();
    const r1 = Object.values(l1.rooms).find((r) => r.items.some((i) => i.t === 'desk'))!;
    const desk = r1.items.find((i) => i.t === 'desk')!;
    r1.items = r1.items.filter((i) => CATALOG[i.t]?.placement !== 'wall');
    r1.items.push({ t: 'frame', x: desk.x + 20, y: desk.y - 30, w: 50, h: 40 });
    expect(hangs(l1).length).toBeGreaterThan(0);

    // a switch plate over the middle of a bed is far above the mattress: only the headboard end is tall
    const l2 = good();
    const r2 = Object.values(l2.rooms)[0];
    r2.items = [{ t: 'bed', x: 16, y: 210, w: 201, v: 0 }, { t: 'switchPlate', x: 120, y: 193 }];
    expect(hangs(l2)).toEqual([]);
    r2.items = [{ t: 'bed', x: 16, y: 210, w: 201, v: 0 }, { t: 'switchPlate', x: 22, y: 193 }];
    expect(hangs(l2).length).toBeGreaterThan(0);
  });
});

describe('report', () => {
  it('describes every room and carries the validation flights', () => {
    const { level, report } = generateFloorWithReport(opts(2, 3));
    expect(report.rooms.length).toBe(Object.keys(level.rooms).length);
    for (const r of report.rooms) {
      expect(r.ok).toBe(true);
      expect(r.runs.length).toBeGreaterThan(0);
      expect(r.attempts).toBeGreaterThanOrEqual(1);
    }
    expect(report.ms).toBeGreaterThan(0);
  });
});
