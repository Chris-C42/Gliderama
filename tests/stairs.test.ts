import { describe, expect, it } from 'vitest';
import { buildSimRoom, simulateRoom } from '../src/game/sim';
import { analyzeDesign } from '../src/paper/aero';
import { buildMesh } from '../src/paper/build';
import { RECIPES } from '../src/paper/recipes';
import { journeyLevels } from '../src/world/campaign';
import { stairsArrival, stairsDownGeom, stairsUpGeom } from '../src/world/stairs';
import type { ItemDef } from '../src/world/types';

const glider = () => {
  const { build, aero } = analyzeDesign(RECIPES.find((r) => r.id === 'glider')!.make());
  return { aero, mesh: buildMesh(build, aero.cg) };
};

describe('stairs', () => {
  it('the doorway sits on the landing, at the high end of the flight, either way round', () => {
    for (const dir of [1, -1]) {
      const it: ItemDef = { t: 'stairsUp', x: 300, y: 340, w: 200, top: 150, dir };
      const g = stairsUpGeom(it);
      expect(g.door.y + g.door.h).toBe(150);
      expect(g.door.x).toBeGreaterThanOrEqual(300);
      expect(g.door.x + g.door.w).toBeLessThanOrEqual(500);
      // the high end is the way it rises
      expect(Math.sign(g.door.x + g.door.w / 2 - 400)).toBe(dir);
      // you come out in front of the doorway, facing into the room, clear of the trigger
      expect(g.arrive.facing).toBe(-dir);
      expect(g.arrive.x < g.door.x || g.arrive.x > g.door.x + g.door.w).toBe(true);
    }
  });

  it('coming up out of a stairwell you start above it, clear of its trigger', () => {
    const it: ItemDef = { t: 'stairsDown', x: 40, y: 302, w: 150 };
    const g = stairsDownGeom(it);
    expect(g.arrive.y).toBeLessThan(g.trigger.y - 40);
    expect(stairsArrival([it], 'up')).toEqual(g.arrive);
    expect(stairsArrival([], 'up')).toEqual({ x: 320, y: 180, facing: 1 });
  });

  it('flying into the doorway (or down the well) ends a headless flight with a stairs outcome', () => {
    const { aero, mesh } = glider();
    const level = journeyLevels()
      .find((l) => l.id === 'cottage-2')!
      .build();
    const up = level.rooms['1,0'];
    const door = stairsUpGeom(up.items.find((i) => i.t === 'stairsUp')!).door;
    const r1 = simulateRoom(buildSimRoom(up), aero, mesh, { x: door.x - 50, y: door.y + door.h / 2, vx: 3, vy: 0, facing: 1 }, undefined, { maxT: 3 });
    expect(r1.outcome).toBe('stairsUp');
    const attic = level.rooms['1,-1'];
    const well = stairsDownGeom(attic.items.find((i) => i.t === 'stairsDown')!).trigger;
    const r2 = simulateRoom(buildSimRoom(attic), aero, mesh, { x: well.x + 20, y: well.y - 30, vx: 1, vy: -2, theta: -0.5, facing: 1 }, undefined, { maxT: 3 });
    expect(r2.outcome).toBe('stairsDown');
  });
});
