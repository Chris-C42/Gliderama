/**
 * The Classic Houses (Glider PRO houses converted by scripts/convert-glider-houses.mjs): every converted house
 * is sound data, and the Demo House can be flown from the start to its star by the bot pilot.
 */

import { describe, expect, it } from 'vitest';
import { KINDS } from '../src/world/kinds';
import { OBJECTS } from '../src/game/objects';
import { goalStarIds, neighbour } from '../src/game/level';
import { CLASSIC_HOUSES, loadClassicHouse, type ClassicLevel } from '../src/world/classic';
import { journeyLevels, levelById } from '../src/world/campaign';
import { RECIPES } from '../src/paper/recipes';
import { houseMap, partMap, solveHouse } from './helpers/houseSolver';

const files = import.meta.glob<{ default: ClassicLevel }>('../src/world/classic/houses/*.json', { eager: true });
const houses = Object.entries(files).map(([file, m]) => ({ file, level: m.default }));
const OPPOSITE = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;

/** Rooms a plane can get to from the start (openings, stairs, transports). */
function reachable(level: ClassicLevel): Set<string> {
  const map = houseMap(level);
  const seen = new Set([level.start.room]);
  const queue = [level.start.room];
  while (queue.length)
    for (const w of map.get(queue.shift()!) ?? []) {
      if (seen.has(w.to)) continue;
      seen.add(w.to);
      queue.push(w.to);
    }
  return seen;
}

describe('Classic Houses data', () => {
  it('every house in the catalog has its rooms, and every house file is in the catalog', () => {
    expect(houses.length).toBeGreaterThan(0);
    expect(new Set(houses.map((h) => h.level.id))).toEqual(new Set(CLASSIC_HOUSES.map((c) => c.id)));
    for (const c of CLASSIC_HOUSES) {
      const h = houses.find((x) => x.level.id === c.id)!.level;
      expect(h.name, c.id).toBe(c.name);
      expect(Object.keys(h.rooms).length, c.id).toBe(c.rooms);
      expect(goalStarIds(h).length, c.id).toBe(c.stars);
      expect(h.meta.authors, c.id).toEqual(c.authors);
      // the campaign offers each house, open from the start, with its credit
      const cl = levelById(c.id)!;
      expect(cl.blurb, c.id).toContain(c.credit ? `by ${c.credit}` : 'not credited');
    }
    expect(journeyLevels().some((l) => l.id.startsWith('classic-'))).toBe(false);
  });

  for (const { level } of houses) {
    describe(level.name, () => {
      it('starts in a room, inside it', () => {
        const r = level.rooms[level.start.room];
        expect(r).toBeDefined();
        expect(level.start.x).toBeGreaterThan(0);
        expect(level.start.x).toBeLessThan(640);
        expect(level.start.y).toBeGreaterThan(16);
        expect(level.start.y).toBeLessThan(340);
        expect(level.place).toBe('classic');
        expect(level.sheets).toBeGreaterThan(0);
        expect(level.intro).toBeTruthy();
      });

      it('has openings that match their neighbours', () => {
        for (const [key, room] of Object.entries(level.rooms))
          for (const side of ['left', 'right', 'up', 'down'] as const) {
            const span = room.exits[side];
            if (!span) continue;
            const next = neighbour(level, key, side);
            expect(next, `${key} ${side}: a room beyond`).not.toBeNull();
            const back = level.rooms[next!].exits[OPPOSITE[side]];
            expect(back, `${key} ${side}: ${next} opens back`).toEqual(span);
            expect(span.from, `${key} ${side}`).toBeLessThan(span.to);
            const max = side === 'left' || side === 'right' ? 360 : 640;
            expect(span.from).toBeGreaterThanOrEqual(0);
            expect(span.to).toBeLessThanOrEqual(max);
          }
      });

      it('keeps its items inside their rooms, and knows every kind', () => {
        for (const [key, room] of Object.entries(level.rooms))
          for (const it of room.items) {
            expect(KINDS[it.t] || OBJECTS[it.t], `${key}: kind ${it.t}`).toBeTruthy();
            // (a block at an edge carries on 40 px past it, as the room's own walls do; a column of air at a wall is
            // partly past it, and rising air carries on through a ceiling opening)
            const mx = it.t === 'solid' ? 40 : it.t === 'current' ? 70 : 0;
            const my = it.t === 'solid' || it.t === 'current' ? 40 : 0;
            expect(it.x, `${key} ${it.t} x`).toBeGreaterThanOrEqual(-mx);
            expect(it.x, `${key} ${it.t} x`).toBeLessThanOrEqual(640);
            if (typeof it.y === 'number') {
              expect(it.y, `${key} ${it.t} y`).toBeGreaterThanOrEqual(-my);
              expect(it.y, `${key} ${it.t} y`).toBeLessThanOrEqual(360);
            }
            // a transport leads to a room; one without `to` is the far end of another, drawn as a duct
            if (it.t === 'transport')
              expect(it.to === undefined ? typeof it.look === 'string' : !!level.rooms[it.to as string], `${key}: transport to ${it.to}`).toBe(true);
            if (it.t === 'stairsUp' || it.t === 'stairsDown')
              expect(neighbour(level, key, it.t === 'stairsUp' ? 'up' : 'down'), `${key}: ${it.t} lead somewhere`).not.toBeNull();
          }
      });

      it('can reach its stars from the start', () => {
        const can = reachable(level);
        const goals = goalStarIds(level);
        expect(goals.length).toBe(level.meta.stars);
        expect(level.goal).toBe(goals.length ? 'stars' : 'none');
        for (const id of goals) expect(can.has(id.split(':')[0]), `star ${id} reachable`).toBe(true);
        // houses keep a few rooms only a level editor could get into; most are on the map (a house without stars
        // is an unfinished one: free flight, its map is whatever its author left)
        if (goals.length) expect(can.size / Object.keys(level.rooms).length, 'share of rooms reachable').toBeGreaterThan(0.5);
      });

      it('can reach its stars through the free space of its rooms', () => {
        // what the bot plans with: rooms split where walls, shelves and furniture leave no way through (so nothing
        // solid here, where the original has nothing in the way, may shut a house's way on)
        const { map, partOf } = partMap(level);
        const from = partOf(level.start.room, level.start.x, level.start.y);
        const seen = new Set([from]);
        const queue = [from];
        while (queue.length)
          for (const w of map.get(queue.shift()!) ?? []) {
            if (seen.has(w.to)) continue;
            seen.add(w.to);
            queue.push(w.to);
          }
        for (const id of goalStarIds(level)) {
          const room = id.split(':')[0];
          const star = level.rooms[room].items.find((it) => it.id === id)!;
          expect(seen.has(partOf(room, star.x, Number(star.y))), `star ${id} reachable`).toBe(true);
        }
      });
    });
  }
});

describe('Demo House flight', () => {
  it('the bot pilot finds the star from the start', async () => {
    const level = await loadClassicHouse('demo-house');
    const r = solveHouse(level, RECIPES.find((q) => q.id === 'glider')!.make());
    expect(r.solved, `stuck at ${r.stuck}`).toBe(true);
    expect(r.stars).toEqual(['70,-4:star:0']);
    // the route of the original: along the ground floor, up the stairs, out of the window, up the updrafts
    for (const room of ['64,-1', '67,-1', '67,-2', '70,-1', '70,-4']) expect(r.rooms).toContain(room);
    expect(r.sheetsUsed).toBeLessThan(level.sheets);
    // and its recorded flight flies the same way again (what the browser replay relies on)
    const again = solveHouse(level, RECIPES.find((q) => q.id === 'glider')!.make(), { replay: r.flights[r.flights.length - 1] });
    expect(again.stars.length > 0 || r.flights.length > 1).toBe(true);
  }, 300_000);
});

describe('Land of Illusion flight', () => {
  it('the bot pilot picks up the helium coming out of the vortex, and climbs on it to the last star', async () => {
    const level = structuredClone(await loadClassicHouse('land-of-illusion'));
    // from the top of the vortex ("Center Of The Vortex"), the last star the only one to find
    level.start = { room: '58,-7', x: 320, y: 40, facing: 1 };
    for (const r of Object.values(level.rooms)) for (const it of r.items) if (it.t === 'star' && it.id !== '62,-16:star:0') delete it.goal;
    const glider = RECIPES.find((q) => q.id === 'glider')!.make();
    const r = solveHouse(level, glider, { maxSteps: 2000 });
    expect(r.solved, `stuck at ${r.stuck}`).toBe(true);
    expect(r.sheetsUsed).toBe(0);
    // the four canisters in "Transformation", coming out of the transport there, then seven rooms up on them (with no
    // rising air)
    expect(r.trace.filter((l) => l.startsWith('helium in 62,-9')).length).toBe(4);
    for (const room of ['62,-9', '62,-10', '62,-13', '62,-16']) expect(r.rooms).toContain(room);
    const f = r.flights[0];
    expect(f.steps.some((s) => s.helium)).toBe(true);
    // and the flight flies the same way again
    const again = solveHouse(level, glider, { replay: f });
    expect(again.stars).toContain('62,-16:star:0');
  }, 300_000);
});
