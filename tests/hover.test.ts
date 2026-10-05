import { describe, expect, it } from 'vitest';
import { HoverPilot } from '../src/game/hover';
import { buildSimRoom, simulateRoom, type SimRoom } from '../src/game/sim';
import { analyzeDesign } from '../src/paper/aero';
import { buildMesh } from '../src/paper/build';
import { RECIPES } from '../src/paper/recipes';
import { PX_PER_M, ROOM_H } from '../src/physics/config';
import type { Plane, WindFn } from '../src/physics/flight';
import { HALL } from '../src/world/levels/sample';
import type { RoomDef } from '../src/world/types';

function plane(id: string) {
  const { build, aero } = analyzeDesign(RECIPES.find((r) => r.id === id)!.make());
  return { aero, mesh: buildMesh(build, aero.cg) };
}

function windOf(room: SimRoom): WindFn {
  return (xm, ym) => {
    const out = { x: 0, y: 0 };
    for (const o of room.objects) o.wind?.(xm * PX_PER_M, ROOM_H - ym * PX_PER_M, out);
    return out;
  };
}

/** Hands off, hover on from the first tick. */
function hoverFlight(room: SimRoom, id: string, start: { x: number; y: number }, maxT: number) {
  const { aero, mesh } = plane(id);
  const wind = windOf(room);
  let pilot: HoverPilot | null = null;
  return simulateRoom(
    room,
    aero,
    mesh,
    { ...start, angle: 0, power: 0.3 },
    (p: Plane) => {
      pilot ??= new HoverPilot(p, wind);
      return { dir: pilot.step(p, wind, 1 / 120), pitch: 0, boost: false };
    },
    { maxT },
  );
}

describe('hover assist', () => {
  it('climbs a vent hands-free, starting off to one side of it', () => {
    for (const id of ['glider', 'nakamura']) {
      const r = hoverFlight(buildSimRoom(HALL), id, { x: 200, y: 230 }, 10);
      const top = Math.min(...r.path.map((p) => p.y));
      expect(top, id).toBeLessThan(140);
      // and it stays over the vent (250..306) rather than wandering off
      const late = r.path.slice(Math.floor(r.path.length / 2));
      for (const q of late) expect(Math.abs(q.x - 278), id).toBeLessThan(110);
    }
  });

  it('holds the plane around where it was switched on in still air', () => {
    const still: RoomDef = { ...HALL, items: [] };
    const r = hoverFlight(buildSimRoom(still), 'glider', { x: 320, y: 120 }, 4);
    for (const q of r.path) expect(Math.abs(q.x - 320)).toBeLessThan(130);
  });
});
