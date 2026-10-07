/** The climb assist: steadier in rising air (fewer stalls, a better climb), and no different anywhere else. */

import { describe, expect, it } from 'vitest';
import { HoverPilot } from '../src/game/hover';
import { buildSimRoom, simulateRoom } from '../src/game/sim';
import { analyzeDesign } from '../src/paper/aero';
import { buildMesh } from '../src/paper/build';
import { RECIPES } from '../src/paper/recipes';
import { PX_PER_M, ROOM_H } from '../src/physics/config';
import { createPlane, stepPlane, type Plane, type WindFn } from '../src/physics/flight';
import { HALL } from '../src/world/levels/sample';

const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function design(id: string) {
  const { build, aero } = analyzeDesign(RECIPES.find((r) => r.id === id)!.make());
  return { aero, mesh: buildMesh(build, aero.cg) };
}

describe('climb assist', () => {
  it('changes nothing out of rising air', () => {
    const { aero } = design('glider');
    const fly = (assist: boolean) => {
      const p: Plane = createPlane(aero);
      p.x = 1;
      p.y = 2;
      p.vx = aero.perf.vBest;
      for (let k = 0; k < 400; k++) stepPlane(p, { dir: k > 200 && k < 210 ? -1 : 0, pitch: k < 100 ? 0.8 : -0.4, boost: false, assist }, () => ({ x: 0, y: 0 }), 1 / 120);
      return p;
    };
    const a = fly(false);
    const b = fly(true);
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
    expect(b.theta).toBe(a.theta);
  });

  it('circling over a vent and pulling up, the plane stalls less and climbs at least as high', () => {
    const room = buildSimRoom(HALL);
    const wind: WindFn = (xm, ym) => {
      const out = { x: 0, y: 0 };
      for (const o of room.objects) o.wind?.(xm * PX_PER_M, ROOM_H - ym * PX_PER_M, out);
      return out;
    };
    for (const id of ['glider', 'nakamura', 'hammerhead']) {
      const { aero, mesh } = design(id);
      const run = (assist: boolean) => {
        let stalled = 0;
        let ticks = 0;
        let climb = 0;
        for (const sx of [190, 205, 220, 330, 345, 360]) {
          let pilot: HoverPilot | null = null;
          const r = simulateRoom(
            room,
            aero,
            mesh,
            { x: sx, y: 240, angle: 0, power: 0.3 },
            (p: Plane) => {
              pilot ??= new HoverPilot(p, wind);
              ticks++;
              if (p.stall > 0.5) stalled++;
              return { dir: pilot.step(p, wind, 1 / 120), pitch: 0.5, boost: false, assist };
            },
            { maxT: 6, rand: seeded(sx) },
          );
          climb += 240 - Math.min(...r.path.map((q) => q.y));
        }
        return { stall: stalled / ticks, climb: climb / 6 };
      };
      const off = run(false);
      const on = run(true);
      expect(on.stall, id).toBeLessThan(off.stall * 0.85);
      expect(on.climb, id).toBeGreaterThanOrEqual(off.climb * 0.98);
    }
  });
});
