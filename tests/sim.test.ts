import { describe, expect, it } from 'vitest';
import { analyzeDesign } from '../src/paper/aero';
import { buildMesh } from '../src/paper/build';
import { RECIPES } from '../src/paper/recipes';
import { buildSimRoom, simulateRoom } from '../src/game/sim';
import { BEDROOM, HALL } from '../src/world/levels/sample';

const plane = (id: string) => {
  const d = RECIPES.find((r) => r.id === id)!.make();
  const { build, aero } = analyzeDesign(d);
  return { aero, mesh: buildMesh(build, aero.cg) };
};

describe('headless room simulation', () => {
  it('a hands-off dart thrown left from the desk lands somewhere in the bedroom', () => {
    const { aero, mesh } = plane('dart');
    const r = simulateRoom(buildSimRoom(BEDROOM), aero, mesh, { x: 560, y: 150, angle: Math.PI - 0.1, power: 0.3 });
    expect(['grounded', 'crashed', 'left']).toContain(r.outcome);
    expect(r.path.length).toBeGreaterThan(10);
  });

  it('a glider carried by the hall vent climbs', () => {
    const { aero, mesh } = plane('glider');
    const room = buildSimRoom(HALL);
    // start low, right above the vent, flying slowly to the right
    const r = simulateRoom(room, aero, mesh, { x: 240, y: 250, vx: 1.2, vy: 0, facing: 1 }, undefined, { maxT: 2 });
    const minY = Math.min(...r.path.map((p) => p.y));
    expect(minY).toBeLessThan(240);
  });
});
