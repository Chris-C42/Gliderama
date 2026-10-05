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

  it('a glider passing over the hall vent climbs', () => {
    const { aero, mesh } = plane('glider');
    const room = buildSimRoom(HALL);
    // thrown level just before the vent: the rising air lifts it above its start height
    const r = simulateRoom(room, aero, mesh, { x: 230, y: 250, angle: 0, power: 0.35 }, undefined, { maxT: 3 });
    const minY = Math.min(...r.path.map((p) => p.y));
    expect(minY).toBeLessThan(240);
  });
});

describe('thermalling', () => {
  it('turning back and forth over a vent climbs towards the ceiling', () => {
    const { aero, mesh } = plane('glider');
    const r = simulateRoom(
      buildSimRoom(HALL),
      aero,
      mesh,
      { x: 236, y: 230, angle: 0, power: 0.3 },
      (p) => {
        const px = p.x * 128;
        if (px > 296 && p.facing > 0 && !p.turn) return { dir: -1, pitch: 0, boost: false };
        if (px < 262 && p.facing < 0 && !p.turn) return { dir: 1, pitch: 0, boost: false };
        return { dir: 0, pitch: 0, boost: false };
      },
      { maxT: 8 },
    );
    expect(Math.min(...r.path.map((p) => p.y))).toBeLessThan(120);
  });
});
