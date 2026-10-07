/**
 * Helium gas (Glider PRO's helium canisters, in the Classic Houses): any plane that picks one up can hold the gadget
 * button, and a helium balloon takes it: a steady climb, level, drifting with the air, bumps that do no harm. Let go,
 * it flies on.
 */

import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../src/game/objects';
import type { ObjCtx, SessionApi } from '../src/game/objects/types';
import { buildSimRoom, simulateRoom } from '../src/game/sim';
import { analyzeDesign } from '../src/paper/aero';
import { buildMesh } from '../src/paper/build';
import { RECIPES } from '../src/paper/recipes';
import { PHYS, PX_PER_M, ROOM_H } from '../src/physics/config';
import { createPlane, idealThrowPower, launch, planePx, stepPlane, type FlightInput, type Plane, type WindFn } from '../src/physics/flight';
import { HALL } from '../src/world/levels/sample';
import { LAYOUT, type ItemDef, type RoomDef } from '../src/world/types';

const DT = 1 / 120;
const still: WindFn = () => ({ x: 0, y: 0 });

function thrown(id: string): Plane {
  const { aero } = analyzeDesign(RECIPES.find((r) => r.id === id)!.make());
  const p = createPlane(aero, { autoTrim: true });
  launch(p, 100, 150, 0.1, idealThrowPower(aero));
  return p;
}

/** Fly `secs` (real), with helium held while `held(t)`. */
function fly(p: Plane, secs: number, held: (t: number) => boolean, each?: (t: number) => void, wind: WindFn = still) {
  for (let t = 0; t < secs; t += DT) {
    const input: FlightInput = { dir: 0, pitch: 0, boost: false, helium: held(t) };
    stepPlane(p, input, wind, DT);
    each?.(t);
  }
}

/** A room for headless flights: the sample hall's walls and floor, with `items`. */
const room = (items: ItemDef[]): RoomDef => ({ ...HALL, id: 'test', name: 'Test', exits: {}, items });

describe('helium gas', () => {
  it('lifts every design at a steady climb, about Glider PRO helium speed, level and with no stall', () => {
    for (const r of RECIPES) {
      const p = thrown(r.id);
      p.gas = 100;
      let y0 = 0;
      let stalled = 0;
      let tilt = 0;
      fly(
        p,
        6,
        (t) => t > 1.5,
        (t) => {
          if (Math.abs(t - 3) < DT / 2) y0 = planePx(p).y;
          if (t > 1.5 && p.stall > 0.5) stalled++;
          if (t > 2.5) tilt = Math.max(tilt, Math.abs(p.theta));
        },
      );
      // px per real second (Glider PRO: 4 px a frame at 30 frames a second, in rooms a twentieth shorter)
      const rise = (y0 - planePx(p).y) / 3;
      expect(rise, r.id).toBeGreaterThan(95);
      expect(rise, r.id).toBeLessThan(135);
      expect(stalled, r.id).toBe(0);
      expect(tilt * (180 / Math.PI), r.id).toBeLessThan(6);
    }
  });

  it('drifts with the air it is in: a current across the plane carries it along', () => {
    const p = thrown('glider');
    p.gas = 100;
    const across: WindFn = () => ({ x: -3, y: 0 });
    let x0 = 0;
    fly(
      p,
      4,
      (t) => t > 0.5,
      (t) => {
        if (Math.abs(t - 2) < DT / 2) x0 = p.x;
      },
      across,
    );
    // flying on at three quarters of its best-glide speed, in air going the other way at 3 m/s
    const vx = (p.x - x0) / (2 * PHYS.timeScale);
    expect(vx).toBeCloseTo(-3 + PHYS.gasDrift * p.aero.perf.vBest, 0);
  });

  it('is used up only while held: a canister lasts its supply, then the balloon lets the plane go', () => {
    const p = thrown('dart');
    p.gas = PHYS.gasSupply;
    fly(p, 1, () => false);
    expect(p.gas).toBe(PHYS.gasSupply);
    const secs = PHYS.gasSupply / PHYS.timeScale;
    fly(p, secs - 0.2, () => true);
    expect(p.gas).toBeGreaterThan(0);
    expect(p.balloon).toBe(1);
    fly(p, 0.6, () => true);
    expect(p.gas).toBe(0);
    expect(p.balloon).toBe(0);
  });

  it('let go, the plane flies on: gliding again soon, without a long dive', () => {
    for (const r of RECIPES) {
      const p = thrown(r.id);
      p.gas = 100;
      fly(p, 4, (t) => t > 0.5 && t < 3);
      // (a second after letting go)
      const y = planePx(p).y;
      fly(p, 1.5, () => false);
      expect(p.V, r.id).toBeGreaterThan(0.75 * p.aero.perf.vBest);
      expect(planePx(p).y - y, r.id).toBeLessThan(110);
    }
  });

  it('a wall does the plane no harm while the balloon has it, and does not hold it back', () => {
    const { aero, build } = analyzeDesign(RECIPES.find((r) => r.id === 'dart')!.make());
    const mesh = buildMesh(build, aero.cg);
    const sim = buildSimRoom(room([{ t: 'current', dir: 'right', x: 0, y: 0, w: 640, h: 360, power: 3 } as ItemDef, { t: 'solid', x: 420, y: 0, w: 40, h: 360 } as ItemDef]));
    let given = false;
    let top = Infinity;
    const r = simulateRoom(
      sim,
      aero,
      mesh,
      { x: 300, y: 300, angle: 0, power: idealThrowPower(aero) },
      (p: Plane) => {
        if (!given) p.gas = PHYS.gasSupply;
        given = true;
        top = Math.min(top, ROOM_H - p.y * PX_PER_M);
        return { dir: 0, pitch: 0, boost: false, helium: true };
      },
      { maxT: 3 },
    );
    expect(r.damage).toBe(0);
    // up along the wall it was shoved against
    expect(top).toBeLessThan(120);
  });

  it('a canister gives any plane a canister of gas', () => {
    const got: [string, number][] = [];
    const api = {
      collectStar: () => {},
      addCharge: (k: string, n: number) => void got.push([k, n]),
      sfx: () => {},
      isCollected: () => false,
    } as unknown as SessionApi;
    const ctx: ObjCtx = { dt: 1 / 60, time: 0, particles: { spawn() {} }, api };
    const can = OBJECTS.helium({ t: 'helium', x: 300, y: 200 }, 'r:helium:0', null, { dark: false, night: false });
    expect(can.trigger!()).toEqual({ x: 291, y: 191, w: 18, h: 18 });
    can.onTouch!(ctx);
    expect(got).toEqual([['gas', PHYS.gasSupply]]);
    expect(can.trigger!()).toBeNull();
  });

  it('lifts a plane in a headless room flight too (as the house bot flies it)', () => {
    const sim = buildSimRoom(room([]));
    const { aero, build } = analyzeDesign(RECIPES.find((r) => r.id === 'dart')!.make());
    const mesh = buildMesh(build, aero.cg);
    const top = (held: boolean) => {
      let best = Infinity;
      let given = false;
      simulateRoom(
        sim,
        aero,
        mesh,
        { x: 120, y: 250, angle: 0.1, power: idealThrowPower(aero) },
        (p: Plane) => {
          if (!given) p.gas = PHYS.gasSupply;
          given = true;
          best = Math.min(best, ROOM_H - p.y * PX_PER_M);
          return { dir: 0, pitch: 0, boost: false, helium: held };
        },
        { maxT: 3 },
      );
      return best;
    };
    expect(top(true)).toBeLessThan(top(false) - 100);
    expect(top(true)).toBeGreaterThan(LAYOUT.ceiling);
  });
});
