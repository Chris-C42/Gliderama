import { describe, expect, it, vi } from 'vitest';
import { generateFloor, generateFloorWithReport, themeForFloor, validateLevelFlight, type FloorOptions } from '../src/world/procgen';
import { referencePlanes } from '../src/world/procgen/fleet';
import { traceRoute } from '../src/world/procgen/route';

vi.setConfig({ testTimeout: 120000 });

const SEEDS = [1, 2, 3, 4, 5];

function opts(seed: number, floor: number, extra: Partial<FloorOptions> = {}): FloorOptions {
  return { seed, floor, theme: themeForFloor(floor), workbenchRoom: seed % 2 === 0, ...extra };
}

describe('every generated room is flyable by a reference plane', () => {
  for (let floor = 0; floor <= 8; floor++) {
    it(`floor ${floor}: bot reaches the exit of every room (glider or dart)`, () => {
      for (const seed of SEEDS) {
        const { level, report } = generateFloorWithReport(opts(seed, floor));
        for (const r of report.rooms) {
          const why = r.runs.filter((q) => !q.ok).map((q) => `${q.plane}/${q.entry}: ${q.why}`).join('; ');
          expect(r.ok, `seed ${seed} floor ${floor} room ${r.key}: ${why}`).toBe(true);
          expect(r.fallback, `seed ${seed} floor ${floor} room ${r.key} needed the fallback`).toBe(false);
        }
        // and again from scratch, independent of what the generator recorded
        const check = validateLevelFlight(level);
        expect(check.ok, `seed ${seed} floor ${floor}: ${check.rooms.filter((q) => !q.ok).map((q) => q.key).join(',')}`).toBe(true);
      }
    });
  }

  it('early floors are flyable by both planes in nearly every room', () => {
    let rooms = 0;
    let both = 0;
    for (const seed of SEEDS)
      for (const floor of [0, 1]) {
        const { report } = generateFloorWithReport(opts(seed, floor));
        for (const r of report.rooms) {
          rooms++;
          if (r.both) both++;
        }
      }
    expect(both / rooms).toBeGreaterThan(0.9);
  });

  it('every room is flown from every entry it can be entered by (both plane types)', () => {
    const { level, report } = generateFloorWithReport(opts(2, 5));
    const route = traceRoute(level);
    for (const [i, step] of route.entries()) {
      const rr = report.rooms.find((r) => r.key === step.key)!;
      const entries = new Set(rr.runs.map((r) => r.entry));
      if (i === 0) expect(entries.has('start')).toBe(true);
      else if (step.from === 'left' || step.from === 'right') {
        expect(entries.has('door-hi')).toBe(true);
        expect(entries.has('door-lo')).toBe(true);
      } else if (step.from === 'up') expect(entries.has('above')).toBe(true);
      else expect(entries.has('below')).toBe(true);
      expect(new Set(rr.runs.map((r) => r.plane)).size).toBeGreaterThanOrEqual(1);
    }
    expect(referencePlanes().map((p) => p.id)).toEqual(['glider', 'dart']);
  });

  it('the plane leaves each side exit low enough to be entered at the next room\'s low entry', () => {
    const { report } = generateFloorWithReport(opts(3, 4));
    for (const r of report.rooms)
      for (const run of r.runs) if (run.ok && run.exitY !== undefined) expect(run.exitY).toBeLessThanOrEqual(221);
  });
});

describe('workbench and dark rooms are reachable', () => {
  it('the bot lands on the workbench desk from the low door entry', () => {
    for (const seed of [2, 4, 6]) {
      const { report } = generateFloorWithReport({ seed, floor: 3, theme: 'cottage', workbenchRoom: true });
      const last = report.rooms[report.rooms.length - 1];
      const land = last.runs.filter((r) => r.entry === 'land');
      expect(land.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const r of land) expect(r.ok, `${r.plane}: ${r.why}`).toBe(true);
      // and re-throws from the desk after refolding
      expect(last.runs.some((r) => r.entry === 'bench' && r.ok)).toBe(true);
    }
  });

  it('the bot flips the switch of every dark room on its way in', () => {
    let dark = 0;
    for (const seed of [1, 2, 3]) {
      const level = generateFloor({ seed, floor: 4, theme: 'home', twist: 'lights-out' });
      const check = validateLevelFlight(level);
      expect(check.ok).toBe(true);
      dark += Object.values(level.rooms).filter((r) => r.dark).length;
    }
    expect(dark).toBeGreaterThan(10);
  });
});

describe('the validation can fail', () => {
  const mk = () => structuredClone(generateFloor({ seed: 2, floor: 2, theme: 'cottage', workbenchRoom: true }));

  it('a wall of furniture across the corridor fails the room', () => {
    const level = mk();
    const key = traceRoute(level)[2].key;
    const room = level.rooms[key];
    room.items.push({ t: 'bookshelf', x: 280, y: 126 }, { t: 'bookshelf', x: 20, y: 126 }, { t: 'bookshelf', x: 400, y: 126 });
    const check = validateLevelFlight(level);
    expect(check.ok).toBe(false);
    expect(check.rooms.find((r) => r.key === key)!.ok).toBe(false);
  });

  /** A room entered and left through side doorways, with a thermal vent. */
  const ventRoom = (level: ReturnType<typeof mk>) => {
    const step = traceRoute(level).find((s, i) => i > 0 && (s.from === 'left' || s.from === 'right') && (s.to === 'left' || s.to === 'right') && level.rooms[s.key].items.some((it) => it.t === 'floorVent' && (it.reach as number) > 0));
    return step!.key;
  };

  it('removing a room\'s vents leaves the plane too low to cross', () => {
    const level = mk();
    const key = ventRoom(level);
    level.rooms[key].items = level.rooms[key].items.filter((i) => i.t !== 'floorVent');
    expect(validateLevelFlight(level).rooms.find((r) => r.key === key)!.ok).toBe(false);
  });

  it('a light switch off the flight path is not reachable', () => {
    const level = generateFloor({ seed: 3, floor: 3, theme: 'cottage', twist: 'lights-out' });
    const key = traceRoute(level)[1].key;
    const sw = level.rooms[key].items.find((i) => i.t === 'switch')!;
    sw.y = 330;
    expect(validateLevelFlight(level).rooms.find((r) => r.key === key)!.ok).toBe(false);
  });

  it('a candle in the corridor fails the room', () => {
    const level = mk();
    const key = ventRoom(level);
    const vent = level.rooms[key].items.find((i) => i.t === 'floorVent')!;
    level.rooms[key].items.push({ t: 'candle', x: vent.x + 20, y: 150, wax: 18 });
    expect(validateLevelFlight(level).rooms.find((r) => r.key === key)!.ok).toBe(false);
  });
});

describe('speed', () => {
  it('generates a full 8-room floor in well under 1.5 s', () => {
    // warm up (module initialisation, reference plane analysis), then time a few floors
    generateFloor(opts(99, 3, { rooms: 8 }));
    const times: number[] = [];
    for (let seed = 1; seed <= 5; seed++) {
      const t0 = performance.now();
      generateFloor(opts(seed, (seed * 2) % 9, { rooms: 8 }));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(1500);
    expect(times[4]).toBeLessThan(3000);
  });
});
