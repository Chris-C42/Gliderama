import { describe, expect, it } from 'vitest';
import { bounds } from '../src/game/collide';
import { planeHull } from '../src/game/flightTick';
import { OBJECTS } from '../src/game/objects';
import { simulateRoom, type SimRoom } from '../src/game/sim';
import { analyzeDesign, glideSpeed, type AeroModel } from '../src/paper/aero';
import { buildMesh, type PlaneMesh } from '../src/paper/build';
import { RECIPES } from '../src/paper/recipes';
import { PHYS, PX_PER_M, ROOM_H } from '../src/physics/config';
import { idealThrowPower } from '../src/physics/flight';
import { BEDROOM } from '../src/world/levels/sample';
import {
  FLOOR_PX,
  GHOSTS_KEY,
  GhostStore,
  MAX_GHOSTS_PER_DESIGN,
  MAX_GHOSTS_TOTAL,
  OpenSim,
  addPiece,
  base64ToBytes,
  boxToPx,
  bytesToBase64,
  compare,
  decodeGhost,
  emptyRoom,
  evaluateRoom,
  flameBox,
  ghostAt,
  glideTest,
  hitTargets,
  hoopsPassed,
  makePiece,
  nextPieceId,
  parseGhost,
  parseRoom,
  pieceAt,
  polar,
  recordGhost,
  removePiece,
  reportCard,
  serializeGhost,
  serializeRoom,
  simulateOpen,
  throwSweep,
  updatePiece,
  windAt,
  windFn,
  type Ghost,
  type GhostSample,
  type PathPoint,
  type Piece,
  type TestRoom,
} from '../src/sandbox';
import { createMemoryBackend, type StorageBackend } from '../src/core/storage';

const DEG = Math.PI / 180;

interface Plane {
  id: string;
  name: string;
  aero: AeroModel;
  mesh: PlaneMesh;
}

const planes: Plane[] = RECIPES.map((r) => {
  const { build, aero } = analyzeDesign(r.make());
  return { id: r.id, name: r.name, aero, mesh: buildMesh(build, aero.cg) };
});
const plane = (id: string): Plane => planes.find((p) => p.id === id)!;
const glider = plane('glider');

// ---------------------------------------------------------------------------------------------
// Open-air simulator
// ---------------------------------------------------------------------------------------------

describe('open-air simulator', () => {
  for (const p of planes) {
    it(`${p.id}: a hands-off throw lands on the floor and rests on it`, () => {
      const sim = new OpenSim(p.aero, p.mesh, { x: 0, y: 2, angle: 0, power: idealThrowPower(p.aero) });
      let deepest = -Infinity;
      for (let i = 0; i < 60 * 120 && sim.step() === null; i++) deepest = Math.max(deepest, bounds(planeHull(sim.st)).y1);
      expect(sim.outcome).toBe('grounded');
      expect(sim.touchedFloor).toBe(true);
      // The lowest point of the hull never sinks more than a couple of pixels into the floor...
      expect(deepest).toBeLessThan(FLOOR_PX + 2);
      // ...and it ends resting on it.
      expect(Math.abs(bounds(planeHull(sim.st)).y1 - FLOOR_PX)).toBeLessThan(1.5);
      // The centre of gravity is a hull half-thickness above y = 0 metres.
      expect(sim.plane.y).toBeGreaterThan(0);
      expect(sim.plane.y).toBeLessThan(0.12);
    });
  }

  it('uses the same frame as the game: a floor row at ROOM_H pixels is y = 0 metres', () => {
    expect(FLOOR_PX).toBe(ROOM_H);
    const box = boxToPx({ x: 1, y: 0.5, w: 0.25, h: 0.75 });
    expect(box).toEqual({ x: PX_PER_M, y: ROOM_H - 1.25 * PX_PER_M, w: 0.25 * PX_PER_M, h: 0.75 * PX_PER_M });
  });

  it('reproduces the game room simulation when the room floor sits at y = 0', () => {
    // A bare room (no walls) with a floor whose top is the hangar floor line: both simulators must agree to the bit.
    const room: SimRoom = {
      def: BEDROOM,
      colliders: [{ x: -1e5, y: ROOM_H, w: 2e5, h: 1e4, kind: 'solid' }],
      objects: [],
      hazards: [],
      spills: [],
    };
    const rand = () => 0.25;
    for (const id of ['dart', 'glider']) {
      const p = plane(id);
      const game = simulateRoom(room, p.aero, p.mesh, { x: 20, y: ROOM_H - 0.8 * PX_PER_M, angle: 0.05, power: 0.1 }, undefined, { rand });
      const open = simulateOpen(p.aero, p.mesh, { x: 20 / PX_PER_M, y: 0.8, angle: 0.05, power: 0.1 }, undefined, { rand });
      expect(game.outcome).toBe('grounded');
      expect(open.outcome).toBe('grounded');
      expect(open.plane.x).toBeCloseTo(game.plane.x, 9);
      expect(open.plane.y).toBeCloseTo(game.plane.y, 9);
      expect(open.t).toBeCloseTo(game.t, 9);
    }
  });

  it('has no ceiling: it flies from a great height', () => {
    const r = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 12, angle: 0, power: 0.3 });
    expect(r.outcome).toBe('grounded');
    expect(r.maxHeight).toBeGreaterThanOrEqual(12);
    const low = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: 0, power: 0.3 });
    expect(r.distance).toBeGreaterThan(low.distance * 2);
  });

  it('is unbounded in x and mirror-symmetric', () => {
    const power = 0.4;
    const base = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: 0, power });
    const far = simulateOpen(glider.aero, glider.mesh, { x: 5000, y: 2, angle: 0, power });
    const left = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: Math.PI, power });
    const negative = simulateOpen(glider.aero, glider.mesh, { x: -300, y: 2, angle: 0, power });
    expect(far.outcome).toBe('grounded');
    expect(far.distance).toBeCloseTo(base.distance, 2);
    expect(negative.distance).toBeCloseTo(base.distance, 2);
    expect(left.finalX).toBeLessThan(0);
    expect(left.distance).toBeCloseTo(base.distance, 1);
  });

  it('never buries a plane released below the floor', () => {
    const r = simulateOpen(glider.aero, glider.mesh, { x: 3, y: -2, angle: 0, power: 0.3 });
    expect(r.outcome).toBe('grounded');
    expect(r.path[0].y).toBe(0);
    expect(r.finalY).toBeGreaterThanOrEqual(0);
    expect(r.finalY).toBeLessThan(0.12);
    expect(Math.abs(r.finalX - 3)).toBeLessThan(5);
  });

  it('is deterministic and the stepping API matches the batch run', () => {
    const start = { x: 0, y: 1.5, angle: 0.1, power: 0.35 };
    const a = simulateOpen(glider.aero, glider.mesh, start);
    const b = simulateOpen(glider.aero, glider.mesh, start);
    expect(b.path).toEqual(a.path);
    const sim = new OpenSim(glider.aero, glider.mesh, start);
    while (sim.step() === null);
    expect(sim.plane.x).toBe(a.plane.x);
    expect(sim.plane.y).toBe(a.plane.y);
    expect(sim.ticks / 120).toBeCloseTo(a.t, 9);
  });

  it('samples the path every N ticks, starts at launch and ends at the final tick', () => {
    const r = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: 0, power: 0.37 });
    expect(r.path[0].t).toBe(0);
    expect(r.path[0].x).toBe(0);
    expect(r.path[0].y).toBe(2);
    expect(r.path[1].t).toBeCloseTo(3 / 120, 9);
    expect(r.path[r.path.length - 1].t).toBeCloseTo(r.t, 9);
    for (let i = 1; i < r.path.length; i++) expect(r.path[i].t).toBeGreaterThan(r.path[i - 1].t);
    const coarse = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: 0, power: 0.37 }, undefined, { every: 12 });
    expect(coarse.path.length).toBeLessThan(r.path.length / 3);
    const sample = r.path[40];
    for (const k of ['t', 'x', 'y', 'theta', 'V', 'alpha', 'CL', 'CD', 'stall', 'facing', 'vx', 'vy'] as const) expect(Number.isFinite(sample[k])).toBe(true);
  });

  it('reports a sensible summary', () => {
    const r = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: 0, power: idealThrowPower(glider.aero) });
    expect(r.maxHeight).toBeGreaterThanOrEqual(2);
    expect(r.distance).toBeCloseTo(Math.abs(r.touchdownX), 9);
    expect(r.timeAloft).toBeLessThanOrEqual(r.t);
    expect(r.timeAloftSim).toBeCloseTo(r.timeAloft * PHYS.timeScale, 9);
    expect(r.avgSink).toBeCloseTo((2 - r.touchdownY) / r.timeAloftSim, 9);
    expect(r.bestLD).toBeGreaterThan(3);
    expect(r.bestLD).toBeLessThanOrEqual(glider.aero.perf.LDmax + 0.5);
    expect(r.finalDamage).toBeLessThan(5);
    expect(r.stallEvents).toBe(0);
    expect(r.launchSpeed).toBeCloseTo(Math.hypot(r.path[0].vx, r.path[0].vy), 6);
  });

  it('can be released from a given velocity and pitch', () => {
    const r = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, vx: 3, vy: 0, theta: 0.1 });
    expect(r.outcome).toBe('grounded');
    expect(r.path[0].vx).toBe(3);
    expect(r.path[0].theta).toBeCloseTo(0.1, 9);
  });

  it('times out when the plane stays airborne', () => {
    const r = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: 0, power: 0.37 }, undefined, { maxT: 1 });
    expect(r.outcome).toBe('timeout');
    expect(r.t).toBeCloseTo(1, 6);
    expect(r.touchedFloor).toBe(false);
  });

  it('runs slower in real time under the slow-mo assist but flies the same flight', () => {
    const start = { x: 0, y: 2, angle: 0, power: 0.4 };
    const base = simulateOpen(glider.aero, glider.mesh, start);
    const slow = simulateOpen(glider.aero, glider.mesh, start, undefined, { slowMo: true });
    expect(slow.timeAloft / base.timeAloft).toBeCloseTo(1 / PHYS.slowMoAssist, 2);
    expect(slow.timeAloftSim).toBeCloseTo(base.timeAloftSim, 1);
    expect(slow.distance).toBeCloseTo(base.distance, 1);
  });

  it('steers when given a control function', () => {
    const calm = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: 0, power: 0.37 });
    const diving = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 2, angle: 0, power: 0.37 }, () => ({ dir: 0, pitch: -1, boost: false }));
    expect(diving.distance).toBeLessThan(calm.distance);
  });

  describe('with a test room', () => {
    it('a wall stops the plane and it falls to the floor', () => {
      const room = addPiece(emptyRoom(), 'wall', 3, 0, { w: 0.2, h: 3 });
      const r = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 1.5, angle: 0, power: 0.4 }, undefined, { room });
      expect(r.outcome).toBe('grounded');
      expect(r.finalX).toBeLessThan(3);
      expect(r.touchedFloor).toBe(true);
    });

    it('lands on a platform instead of the floor', () => {
      const room = addPiece(emptyRoom(), 'wall', 2, 0, { w: 4, h: 0.8 });
      const r = simulateOpen(glider.aero, glider.mesh, { x: 0, y: 1.6, angle: 0, power: 0.3 }, undefined, { room });
      expect(r.outcome).toBe('grounded');
      expect(r.touchedFloor).toBe(false);
      expect(r.finalY).toBeGreaterThan(0.8);
      expect(r.finalX).toBeGreaterThan(2);
      expect(r.finalX).toBeLessThan(6);
    });

    it('a floor vent carries the plane further than still air', () => {
      const start = { x: 0, y: 1.0, angle: 0.05, power: 0.5 };
      const room = addPiece(emptyRoom(), 'floorVent', 2.4, 0);
      const still = simulateOpen(glider.aero, glider.mesh, start);
      const lifted = simulateOpen(glider.aero, glider.mesh, start, undefined, { room });
      expect(lifted.distance).toBeGreaterThan(still.distance + 0.5);
      expect(lifted.maxHeight).toBeGreaterThan(still.maxHeight);
    });

    it('a tailwind helps and a headwind hurts', () => {
      const start = { x: 0, y: 2, angle: 0, power: 0.37 };
      const calm = simulateOpen(glider.aero, glider.mesh, start);
      const tail = simulateOpen(glider.aero, glider.mesh, start, undefined, { room: { ...emptyRoom(), wind: { x: 1, y: 0 } } });
      const head = simulateOpen(glider.aero, glider.mesh, start, undefined, { room: { ...emptyRoom(), wind: { x: -1, y: 0 } } });
      expect(tail.distance).toBeGreaterThan(calm.distance + 0.5);
      expect(head.distance).toBeLessThan(calm.distance - 0.5);
    });

    it('a candle flame in the path sets the plane alight', () => {
      const start = { x: 0, y: 2, angle: 0, power: 0.37 };
      const clear = simulateOpen(glider.aero, glider.mesh, start);
      const at = clear.path.find((q) => q.x > 2.5)!;
      // Wick just under the plane's path so the flame (a few cm above it) overlaps the hull.
      const room = addPiece(emptyRoom(), 'candle', at.x - 0.02, at.y - 0.2 - 0.02);
      const burnt = simulateOpen(glider.aero, glider.mesh, start, undefined, { room });
      expect(clear.finalDamage).toBeLessThan(5);
      expect(burnt.plane.damage.scorch).toBeGreaterThan(0.1);
      expect(burnt.finalDamage).toBeGreaterThan(clear.finalDamage + 15);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Glide test
// ---------------------------------------------------------------------------------------------

describe('glide test', () => {
  for (const p of planes) {
    it(`${p.id}: achieved glide ratio is close to the trim L/D`, () => {
      const g = glideTest(p.aero, p.mesh);
      const trim = p.aero.perf.trim!;
      expect(trim).toBeTruthy();
      expect(g.outcome).toBe('grounded');
      expect(g.predicted).toEqual({ LD: trim.LD, V: trim.v, sink: trim.sink });
      // Distance over height flatters the plane a little: the throw adds energy on top of the height.
      expect(g.glideRatio).toBeGreaterThan(trim.LD * 0.8);
      expect(g.glideRatio).toBeLessThan(trim.LD * 1.6);
      // Counting that energy, the plane flies the L/D the analysis predicts.
      expect(g.glideRatioEnergy).toBeGreaterThan(trim.LD * 0.85);
      expect(g.glideRatioEnergy).toBeLessThan(trim.LD * 1.15);
      // The sink rate is no worse than the steady trim sink, and not absurdly better.
      expect(g.avgSink).toBeLessThan(trim.sink * 1.1);
      expect(g.avgSink).toBeGreaterThan(trim.sink * 0.5);
      // The best instantaneous L/D seen stays inside what the coefficients allow.
      expect(g.bestLD).toBeGreaterThan(trim.LD * 0.9);
      expect(g.bestLD).toBeLessThan(p.aero.perf.LDmax * 1.05);
    });
  }

  it('reports real and sim time, per-second sink and the launch used', () => {
    const g = glideTest(glider.aero, glider.mesh);
    expect(g.height).toBe(2);
    expect(g.angle).toBe(0);
    expect(g.power).toBeCloseTo(idealThrowPower(glider.aero), 9);
    expect(g.timeAloft).toBeGreaterThan(g.timeAloftSim);
    expect(g.timeAloftSim / g.timeAloft).toBeCloseTo(PHYS.timeScale, 9);
    expect(g.avgSinkReal).toBeCloseTo(g.avgSink * PHYS.timeScale, 9);
    expect(g.glideRatio).toBeCloseTo(g.distance / 2, 9);
    expect(g.path.length).toBeGreaterThan(100);
    expect(g.maxHeight).toBeGreaterThanOrEqual(2);
  });

  it('honours height, power and angle', () => {
    const base = glideTest(glider.aero, glider.mesh);
    const tall = glideTest(glider.aero, glider.mesh, { height: 4 });
    const hard = glideTest(glider.aero, glider.mesh, { power: 0.8 });
    const up = glideTest(glider.aero, glider.mesh, { angle: 30 * DEG });
    expect(tall.distance).toBeGreaterThan(base.distance * 1.5);
    expect(tall.height).toBe(4);
    expect(hard.power).toBe(0.8);
    expect(hard.launchSpeed).toBeGreaterThan(base.launchSpeed);
    expect(up.maxHeight).toBeGreaterThan(base.maxHeight);
  });
});

// ---------------------------------------------------------------------------------------------
// Throw sweep
// ---------------------------------------------------------------------------------------------

describe('throw sweep', () => {
  for (const id of ['dart', 'glider', 'delta']) {
    it(`${id}: curves cover the ranges and meet at the best throw`, () => {
      const p = plane(id);
      const sw = throwSweep(p.aero, p.mesh);
      expect(sw.byPower.length).toBe(19);
      expect(sw.byPower[0].power).toBeCloseTo(0.1, 9);
      expect(sw.byPower[18].power).toBeCloseTo(1, 9);
      expect(sw.byAngle.length).toBe(25);
      expect(sw.byAngle[0].angleDeg).toBe(-20);
      expect(sw.byAngle[24].angleDeg).toBe(40);
      for (const pt of [...sw.byPower, ...sw.byAngle]) {
        expect(Number.isFinite(pt.distance)).toBe(true);
        expect(pt.distance).toBeGreaterThanOrEqual(0);
        expect(pt.distance).toBeLessThanOrEqual(sw.best.distance + 1e-9);
      }
      // The best throw lies on both slices.
      expect(sw.byPower.some((pt) => pt.power === sw.best.power && pt.angleDeg === sw.best.angleDeg)).toBe(true);
      expect(sw.byAngle.some((pt) => pt.power === sw.best.power && pt.angleDeg === sw.best.angleDeg)).toBe(true);
      expect(sw.ideal.power).toBe(idealThrowPower(p.aero));
      expect(sw.ideal.angleDeg).toBe(0);
      expect(sw.best.distance).toBeGreaterThanOrEqual(sw.ideal.distance * 0.98);
    });
  }

  it('a steep climbing throw stalls and falls short', () => {
    const sw = throwSweep(glider.aero, glider.mesh);
    const at = (a: number) => sw.byAngle.find((pt) => pt.angleDeg === a)!;
    expect(at(40).distance).toBeLessThan(at(0).distance * 0.5);
    expect(at(40).stallEvents).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Polar
// ---------------------------------------------------------------------------------------------

describe('polar', () => {
  for (const p of planes) {
    it(`${p.id}: arrays are monotonic where the physics says so`, () => {
      const pol = polar(p.aero);
      const n = pol.alphaDeg.length;
      expect(pol.alphaDeg[0]).toBe(-6);
      expect(pol.alphaDeg[n - 1]).toBe(40);
      for (const arr of [pol.CL, pol.CD, pol.Cm, pol.LD, pol.stall]) expect(arr.length).toBe(n);
      const stallDeg = p.aero.alphaStall / DEG;
      for (let i = 1; i < n; i++) {
        expect(pol.alphaDeg[i]).toBeGreaterThan(pol.alphaDeg[i - 1]);
        if (pol.alphaDeg[i] <= stallDeg) {
          // Attached flow: lift rises, the plane pitches nose-down with angle (static stability).
          expect(pol.CL[i]).toBeGreaterThan(pol.CL[i - 1]);
          expect(pol.Cm[i]).toBeLessThan(pol.Cm[i - 1]);
          expect(pol.stall[i]).toBe(0);
          // Drag grows away from zero angle of attack.
          if (pol.alphaDeg[i - 1] >= 0) expect(pol.CD[i]).toBeGreaterThanOrEqual(pol.CD[i - 1]);
        }
      }
      expect(pol.stall[n - 1]).toBe(1);
    });

    it(`${p.id}: the steady-glide polar slows down as the angle rises, with a sink-rate knee`, () => {
      const pol = polar(p.aero);
      const g = pol.glide;
      expect(g.V.length).toBeGreaterThan(10);
      for (let i = 1; i < g.V.length; i++) {
        expect(g.alphaDeg[i]).toBeGreaterThan(g.alphaDeg[i - 1]);
        expect(g.V[i]).toBeLessThan(g.V[i - 1]);
      }
      expect(pol.minSink.sink).toBeLessThanOrEqual(Math.min(...g.sink) + 1e-6);
      expect(pol.bestLD.LD).toBeGreaterThanOrEqual(Math.max(...g.LD) - 1e-6);
      // The minimum-sink point flies slower and at a higher angle than the best-glide point.
      expect(pol.minSink.V).toBeLessThanOrEqual(pol.bestLD.V + 1e-9);
      expect(pol.minSink.alphaDeg).toBeGreaterThanOrEqual(pol.bestLD.alphaDeg - 1e-9);
      // What the polar says matches glideSpeed.
      const mid = pol.bestLD;
      expect(mid.V).toBeCloseTo(glideSpeed(p.aero, mid.CL, mid.CD), 9);
      expect(mid.sink).toBeCloseTo((mid.V * mid.CD) / Math.hypot(mid.CL, mid.CD), 9);
      // Stalling needs less speed than flying the best glide.
      expect(pol.vStall).toBeLessThan(pol.bestLD.V);
      expect(pol.vStall).toBeLessThan(pol.minSink.V + 1e-9);
      // Flying with the elevators flat can only help (what aero.perf quotes).
      expect(pol.bestLD.LD).toBeLessThanOrEqual(pol.potential.LDmax + 0.05);
    });

    it(`${p.id}: the trim point is where the pitching moment crosses zero`, () => {
      const pol = polar(p.aero);
      const t = pol.trim!;
      const ref = p.aero.perf.trim!;
      expect(t.alphaDeg).toBeCloseTo(ref.alpha / DEG, 9);
      expect(t.V).toBeCloseTo(ref.v, 9);
      expect(t.LD).toBeCloseTo(ref.LD, 9);
      expect(t.sink).toBeCloseTo(ref.sink, 9);
      // Cm is positive before it and negative after it.
      const below = pol.alphaDeg.findLastIndex((a) => a < t.alphaDeg);
      expect(pol.Cm[below]).toBeGreaterThan(0);
      expect(pol.Cm[below + 1]).toBeLessThanOrEqual(1e-9);
      // The trim is below the stall.
      expect(t.alphaDeg).toBeLessThan(pol.alphaStallDeg);
    });
  }

  it('has no trim point for a plane that cannot find one', () => {
    const noTrim: AeroModel = { ...glider.aero, perf: { ...glider.aero.perf, trim: null } };
    expect(polar(noTrim).trim).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Report card and compare
// ---------------------------------------------------------------------------------------------

describe('report card', () => {
  it('shows the six friendly stats with remarks and the measured glide', () => {
    const g = glideTest(glider.aero, glider.mesh);
    const card = reportCard(glider.aero, g, 'Simple Glider');
    expect(card.name).toBe('Simple Glider');
    expect(card.lines.map((l) => l.key)).toEqual(['glide', 'speed', 'float', 'stability', 'agility', 'toughness']);
    for (const l of card.lines) {
      expect(l.score).toBe(glider.aero.friendly[l.key]);
      expect(l.remark.length).toBeGreaterThan(8);
      expect(l.remark.length).toBeLessThan(140);
      if (l.key === 'speed') expect(l.tone).toBe('ok');
      else expect(l.tone).toBe(l.score >= 6.5 ? 'good' : l.score >= 3.5 ? 'ok' : 'poor');
    }
    expect(card.measured?.distance).toBe(g.distance);
    expect(card.measured?.timeAloft).toBe(g.timeAloft);
    expect(card.measured?.glideRatio).toBe(g.glideRatio);
    expect(card.facts.massG).toBeCloseTo(glider.aero.mass * 1000, 9);
    expect(reportCard(glider.aero).measured).toBeNull();
    // A good glider is called one, and its remark quotes the measured ratio.
    const glide = card.lines.find((l) => l.key === 'glide')!;
    expect(glide.tone).toBe('good');
    expect(glide.remark).toContain(g.glideRatioEnergy.toFixed(1));
  });

  it('tells the truth about a design that dives, tumbles or is nose-heavy', () => {
    const dives: AeroModel = { ...glider.aero, perf: { ...glider.aero.perf, trim: null } };
    expect(reportCard(dives).notes.map((n) => n.text).join(' ')).toContain('Dives when hands-off: bend the elevators up');
    const unstable: AeroModel = { ...glider.aero, SM: -0.05, friendly: { ...glider.aero.friendly, stability: 0 } };
    const card = reportCard(unstable);
    expect(card.lines.find((l) => l.key === 'stability')!.remark).toContain('Unstable');
    expect(card.lines.find((l) => l.key === 'stability')!.tone).toBe('poor');
    expect(card.notes[0].tone).toBe('bad');
    const heavy: AeroModel = { ...glider.aero, SM: 0.35 };
    expect(reportCard(heavy).lines.find((l) => l.key === 'stability')!.remark).toContain('nose-heavy');
  });

  it('floats beautifully only when the wing loading says so', () => {
    const light: AeroModel = { ...glider.aero, wingLoading: 0.7, friendly: { ...glider.aero.friendly, float: 9.5 } };
    const heavy: AeroModel = { ...glider.aero, wingLoading: 5, friendly: { ...glider.aero.friendly, float: 1 } };
    expect(reportCard(light).lines.find((l) => l.key === 'float')!.remark).toContain('Floats beautifully in drafts');
    expect(reportCard(heavy).lines.find((l) => l.key === 'float')!.remark).toContain('barely move it');
  });

  it('reports stalls from the glide test and what to do about them', () => {
    const g = glideTest(glider.aero, glider.mesh);
    const soft = { ...g, stallEvents: 2, power: idealThrowPower(glider.aero) * 0.5 };
    expect(reportCard(glider.aero, soft).notes.some((n) => n.text.includes('Stalls easily: throw a little harder'))).toBe(true);
    const ideal = { ...g, stallEvents: 1 };
    const text = reportCard(glider.aero, ideal).notes.map((n) => n.text).join(' ');
    expect(text).toContain('even with its ideal throw');
    expect(text).not.toContain('throw a little harder');
    expect(reportCard(glider.aero, g).notes.some((n) => n.tone === 'good')).toBe(true);
  });
});

describe('compare', () => {
  const cardOf = (p: Plane) => reportCard(p.aero, glideTest(p.aero, p.mesh), p.name);

  it('gives deltas as b minus a and says which is better', () => {
    const a = cardOf(glider);
    const b = cardOf(plane('dart'));
    const cmp = compare(a, b);
    expect(cmp.a).toBe('Simple Glider');
    expect(cmp.b).toBe('Classic Dart');
    const row = (k: string) => cmp.rows.find((r) => r.key === k)!;
    expect(row('distance').delta).toBeCloseTo(b.measured!.distance - a.measured!.distance, 9);
    expect(row('distance').better).toBe('a');
    expect(row('avgSink').better).toBe('a'); // lower sink is better
    expect(row('speed').better).toBe('b');
    expect(row('massG').better).toBe('tie'); // a matter of taste
    expect(cmp.summary[0]).toContain('Simple Glider glides');
    // Swapping the designs flips the sign and the verdict.
    const rev = compare(b, a);
    expect(rev.rows.find((r) => r.key === 'distance')!.delta).toBeCloseTo(-row('distance').delta, 9);
    expect(rev.rows.find((r) => r.key === 'distance')!.better).toBe('b');
  });

  it('calls identical designs identical', () => {
    const a = cardOf(glider);
    const cmp = compare(a, a);
    expect(cmp.rows.every((r) => r.delta === 0 && r.better === 'tie')).toBe(true);
    expect(cmp.summary).toEqual(['These two fly almost identically.']);
  });

  it('skips the measured rows when a design has not been tested', () => {
    const cmp = compare(reportCard(glider.aero, null, 'A'), reportCard(plane('dart').aero, null, 'B'));
    expect(cmp.rows.some((r) => r.key === 'distance')).toBe(false);
    expect(cmp.rows.some((r) => r.key === 'glide')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Ghosts
// ---------------------------------------------------------------------------------------------

const META = { designId: 'd1', designName: 'Test plane', color: '#d0533d', createdAt: 1_700_000_000_000 };

/** A synthetic path sampled exactly on the ghost grid (20 per second). */
function syntheticPath(n: number, facing: 1 | -1 = 1): GhostSample[] {
  const out: GhostSample[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: i * 0.05, x: facing * (0.123 + i * 0.0613), y: 2 - i * 0.0171 + 0.0004 * i * i, theta: (0.2 * Math.sin(i / 7)) * facing, facing });
  }
  return out;
}

describe('ghosts', () => {
  it('base64 round-trips bytes of every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Array.from({ length: n }, (_, i) => (i * 37 + n * 11) % 256);
      const text = bytesToBase64(bytes);
      expect(text).toMatch(/^[A-Za-z0-9+/]*$/);
      expect(base64ToBytes(text)).toEqual(bytes);
    }
    expect(bytesToBase64([77, 97, 110])).toBe('TWFu');
    expect(base64ToBytes('TWFu==')).toEqual([77, 97, 110]);
    expect(base64ToBytes('!!!!')).toBeNull();
    expect(base64ToBytes('A')).toBeNull();
  });

  it('encodes and decodes within the quantisation (1 cm, 1 degree)', () => {
    const path = syntheticPath(120);
    const ghost = recordGhost(path, META);
    expect(ghost.n).toBe(120);
    expect(ghost.dt).toBeCloseTo(0.05, 9);
    expect(ghost.duration).toBeCloseTo(119 * 0.05, 9);
    expect(ghost.designId).toBe('d1');
    expect(ghost.color).toBe('#d0533d');
    const back = decodeGhost(ghost);
    expect(back.length).toBe(120);
    path.forEach((s, i) => {
      expect(Math.abs(back[i].x - s.x)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(back[i].y - s.y)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(back[i].theta - s.theta)).toBeLessThanOrEqual(0.5 * DEG + 1e-9);
      expect(back[i].facing).toBe(1);
      expect(back[i].t).toBeCloseTo(i * 0.05, 9);
    });
  });

  it('keeps leftward flight facing left with the same pitch', () => {
    const path = syntheticPath(60, -1);
    const back = decodeGhost(recordGhost(path, META));
    path.forEach((s, i) => {
      expect(back[i].facing).toBe(-1);
      expect(Math.abs(back[i].theta - s.theta)).toBeLessThanOrEqual(0.5 * DEG + 1e-9);
      expect(Math.abs(back[i].x - s.x)).toBeLessThanOrEqual(0.005 + 1e-9);
    });
  });

  it('survives turnarounds and angles that wrap around', () => {
    const wrapRad = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const path: GhostSample[] = [];
    for (let i = 0; i < 40; i++) {
      const facing: 1 | -1 = i < 20 ? 1 : -1;
      // The pitch spins through +-180 degrees (a loop) and the plane turns around half way.
      path.push({ t: i * 0.05, x: i * 0.05, y: 1, theta: wrapRad(i * 20 * DEG), facing });
    }
    const back = decodeGhost(recordGhost(path, META));
    // The direction the nose points is what is preserved (a looping plane is replayed upright and mirrored).
    const nose = (theta: number, facing: number) => (facing > 0 ? theta : Math.PI - theta);
    path.forEach((s, i) => {
      const d = wrapRad(nose(back[i].theta, back[i].facing) - nose(s.theta, s.facing ?? 1));
      expect(Math.abs(d)).toBeLessThanOrEqual(0.5 * DEG + 1e-9);
    });
    // Away from the vertical, facing is recovered exactly.
    expect(back[2].facing).toBe(1);
    expect(back[38].facing).toBe(-1);
  });

  it('resamples a real 40 Hz flight to 20 Hz and replays it within a centimetre', () => {
    const g = glideTest(glider.aero, glider.mesh);
    const path = g.path;
    const ghost = recordGhost(path, META);
    expect(ghost.duration).toBeCloseTo(path[path.length - 1].t, 6);
    const at = (t: number) => {
      let i = 0;
      while (i + 2 < path.length && path[i + 1].t < t) i++;
      const a = path[i];
      const b = path[i + 1];
      const u = (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, theta: a.theta + (b.theta - a.theta) * u };
    };
    for (const t of [0, 0.37, 1.5, 3.14159, 6.02, 9.9, g.timeAloft - 0.01]) {
      const pose = ghostAt(ghost, t)!;
      const ref = at(t);
      expect(Math.abs(pose.x - ref.x)).toBeLessThan(0.012);
      expect(Math.abs(pose.y - ref.y)).toBeLessThan(0.012);
      expect(Math.abs(pose.theta - ref.theta)).toBeLessThan(1.6 * DEG);
    }
    // It ends where the flight ended.
    const end = ghostAt(ghost, 1e9)!;
    expect(end.done).toBe(true);
    expect(Math.abs(end.x - path[path.length - 1].x)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(ghost.distance).toBeCloseTo(path[path.length - 1].x - path[0].x, 1);
  });

  it('stays under 4 KB for a 10 s flight and is capped for long ones', () => {
    const g = glideTest(glider.aero, glider.mesh);
    expect(g.timeAloft).toBeGreaterThan(9.5); // a real 10 s flight
    const ghost = recordGhost(g.path, META);
    expect(JSON.stringify(ghost).length).toBeLessThan(4096);
    expect(ghost.data.length).toBeLessThan(1500);
    // A 90 s flight of busy, fast-changing samples still fits: the sample count is capped.
    const long: GhostSample[] = [];
    for (let i = 0; i <= 3600; i++) long.push({ t: i * 0.025, x: 3 * Math.sin(i / 9), y: 2 + Math.cos(i / 5), theta: Math.sin(i / 3), facing: 1 });
    const big = recordGhost(long, META);
    expect(big.n).toBeLessThanOrEqual(500);
    expect(JSON.stringify(big).length).toBeLessThan(4096);
    expect(big.duration).toBeCloseTo(90, 6);
  });

  it('interpolates, clamps and flags the end', () => {
    const ghost = recordGhost(
      [
        { t: 0, x: 0, y: 1, theta: 0 },
        { t: 1, x: 1, y: 0.5, theta: 0.2 },
        { t: 2, x: 3, y: 0.1, theta: -0.1 },
      ],
      META,
    );
    const mid = ghostAt(ghost, 0.5)!;
    expect(mid.x).toBeCloseTo(0.5, 2);
    expect(mid.y).toBeCloseTo(0.75, 2);
    expect(mid.theta).toBeCloseTo(0.1, 1);
    expect(mid.done).toBe(false);
    expect(ghostAt(ghost, -3)!.x).toBe(0);
    expect(ghostAt(ghost, 2)!.done).toBe(true);
    expect(ghostAt(ghost, 99)!.x).toBeCloseTo(3, 2);
  });

  it('turns into text and back', () => {
    const ghost = recordGhost(syntheticPath(30), META);
    const text = serializeGhost(ghost);
    expect(parseGhost(text)).toEqual(ghost);
    expect(ghostAt(parseGhost(text)!, 0.7)).toEqual(ghostAt(ghost, 0.7));
    for (const bad of ['', '{', 'null', '[]', '{"v":1}', JSON.stringify({ ...ghost, data: 5 }), JSON.stringify({ ...ghost, v: 2 })]) expect(parseGhost(bad)).toBeNull();
  });

  it('skips samples with broken numbers', () => {
    const path = syntheticPath(10);
    const dirty: GhostSample[] = [...path.slice(0, 5), { t: 0.26, x: NaN, y: 1, theta: 0 }, { t: 0.27, x: 1, y: Infinity, theta: 0 }, ...path.slice(5)];
    const a = recordGhost(path, META);
    const b = recordGhost(dirty, META);
    expect(b.data).toBe(a.data);
    expect(b.n).toBe(a.n);
  });

  it('copes with empty, single-sample and damaged ghosts', () => {
    expect(ghostAt(recordGhost([], META), 1)).toBeNull();
    const one = recordGhost([{ t: 0, x: 4, y: 1, theta: 0.1 }], META);
    expect(one.n).toBe(1);
    expect(ghostAt(one, 5)!.x).toBeCloseTo(4, 2);
    const broken: Ghost = { ...one, data: '!!!' };
    expect(decodeGhost(broken)).toEqual([]);
    expect(ghostAt(broken, 0)).toBeNull();
    const truncated: Ghost = { ...recordGhost(syntheticPath(30), META) };
    truncated.data = truncated.data.slice(0, 10);
    expect(decodeGhost(truncated).length).toBeLessThan(30);
  });

  describe('GhostStore', () => {
    const make = (designId: string, createdAt: number, n = 8): Ghost => recordGhost(syntheticPath(n), { ...META, designId, createdAt });

    it('uses the documented storage key and limits', () => {
      expect(GHOSTS_KEY).toBe('gliderama.ghosts.v1');
      expect(MAX_GHOSTS_PER_DESIGN).toBe(8);
      expect(MAX_GHOSTS_TOTAL).toBe(40);
    });

    it('keeps the 8 most recent ghosts per design', () => {
      const store = new GhostStore(createMemoryBackend());
      for (let i = 0; i < 12; i++) store.add(make('a', 1000 + i));
      const list = store.forDesign('a');
      expect(list.length).toBe(8);
      expect(list.map((g) => g.createdAt)).toEqual([1011, 1010, 1009, 1008, 1007, 1006, 1005, 1004]);
    });

    it('keeps at most 40 ghosts in all, dropping the oldest', () => {
      const store = new GhostStore(createMemoryBackend());
      let t = 1000;
      for (let round = 0; round < 8; round++) for (let d = 0; d < 10; d++) store.add(make(`d${d}`, t++));
      const all = store.all();
      expect(all.length).toBe(40);
      for (let d = 0; d < 10; d++) expect(store.forDesign(`d${d}`).length).toBeLessThanOrEqual(8);
      // Newest first, and the survivors are the 40 newest.
      expect(all[0].createdAt).toBe(1079);
      expect(all[39].createdAt).toBe(1040);
      for (let i = 1; i < all.length; i++) expect(all[i].createdAt).toBeLessThanOrEqual(all[i - 1].createdAt);
    });

    it('persists to the backend and reads it back', () => {
      const backend = createMemoryBackend();
      const a = new GhostStore(backend);
      const g = make('a', 5);
      expect(a.add(g)).toBe(true);
      expect(backend.getItem('gliderama.ghosts.v1')).toContain(g.id);
      const b = new GhostStore(backend);
      expect(b.all()).toEqual([g]);
      expect(b.get(g.id)).toEqual(g);
      expect(ghostAt(b.all()[0], 0.2)!.x).toBeCloseTo(ghostAt(g, 0.2)!.x, 9);
    });

    it('replaces a ghost with the same id and prefers the newer on equal timestamps', () => {
      const store = new GhostStore(createMemoryBackend(), { perDesign: 2 });
      const g1 = make('a', 7);
      store.add(g1);
      store.add(g1);
      expect(store.all().length).toBe(1);
      const g2 = make('a', 7, 9);
      const g3 = make('a', 7, 11);
      store.add(g2);
      store.add(g3);
      expect(store.forDesign('a').map((g) => g.id)).toEqual([g3.id, g2.id]);
    });

    it('removes and clears', () => {
      const store = new GhostStore(createMemoryBackend());
      const a1 = make('a', 1);
      store.add(a1);
      store.add(make('a', 2));
      store.add(make('b', 3));
      expect(store.remove(a1.id)).toBe(true);
      expect(store.remove('nope')).toBe(false);
      expect(store.forDesign('a').length).toBe(1);
      store.clear('a');
      expect(store.all().map((g) => g.designId)).toEqual(['b']);
      store.clear();
      expect(store.all()).toEqual([]);
      expect(new GhostStore(store['backend']).all()).toEqual([]);
    });

    it('shrugs off unreadable storage', () => {
      for (const raw of ['{not json', '[]', '{"v":1,"ghosts":5}', '{"v":1,"ghosts":[1,"x",{"v":1}]}', 'null']) {
        const store = new GhostStore(createMemoryBackend({ [GHOSTS_KEY]: raw }));
        expect(store.all()).toEqual([]);
        expect(store.add(make('a', 1))).toBe(true);
        expect(store.all().length).toBe(1);
      }
      // One good ghost among bad ones survives.
      const good = make('a', 9);
      const mixed = JSON.stringify({ v: 1, ghosts: [{ junk: true }, good, 7] });
      expect(new GhostStore(createMemoryBackend({ [GHOSTS_KEY]: mixed })).all()).toEqual([good]);
    });

    it('works when the storage throws, keeping ghosts in memory', () => {
      const blocked: StorageBackend = {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      };
      const store = new GhostStore(blocked);
      expect(store.all()).toEqual([]);
      expect(store.add(make('a', 1))).toBe(false);
      expect(store.persisted).toBe(false);
      expect(store.all().length).toBe(1);
    });

    it('sheds the oldest ghosts when the storage is full', () => {
      const inner = createMemoryBackend();
      const tight: StorageBackend = {
        getItem: (k) => inner.getItem(k),
        removeItem: (k) => inner.removeItem(k),
        setItem: (k, v) => {
          if (v.length > 3500) throw new Error('QuotaExceededError');
          inner.setItem(k, v);
        },
      };
      const store = new GhostStore(tight);
      for (let i = 0; i < 10; i++) store.add(make('a', 100 + i, 120));
      // Memory holds all 8, storage holds as many of the newest as fit.
      expect(store.forDesign('a').length).toBe(8);
      const saved = new GhostStore(inner).all();
      expect(saved.length).toBeGreaterThan(0);
      expect(saved.length).toBeLessThan(8);
      expect(saved[0].createdAt).toBe(109);
      expect(store.persisted).toBe(true);
    });

    it('defaults to localStorage when it exists and to memory when it does not', () => {
      const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      try {
        const fake = createMemoryBackend();
        Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
        const store = new GhostStore();
        store.add(make('a', 1));
        expect(fake.getItem(GHOSTS_KEY)).toBeTruthy();
        Object.defineProperty(globalThis, 'localStorage', {
          get() {
            throw new Error('SecurityError');
          },
          configurable: true,
        });
        const safe = new GhostStore();
        safe.add(make('a', 2));
        expect(safe.all().length).toBe(1);
      } finally {
        if (had) Object.defineProperty(globalThis, 'localStorage', had);
        else delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Test room
// ---------------------------------------------------------------------------------------------

/** The game's own air objects, built headless, to check the metre profiles against them. */
function gameWind(t: string, def: Record<string, unknown>, xPx: number, yPx: number): { x: number; y: number } {
  const o = OBJECTS[t]({ t, ...def } as never, 'cmp', null, { dark: false, night: false });
  const out = { x: 0, y: 0 };
  o.wind?.(xPx, yPx, out);
  return out;
}
const mx = (px: number) => px / PX_PER_M;
const my = (py: number) => (ROOM_H - py) / PX_PER_M;

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe('test room wind', () => {
  it('floor vent matches the game object in metres', () => {
    const rnd = lcg(1);
    const room = addPiece(emptyRoom(), 'floorVent', mx(200), my(336) - 0.04, { w: 48 / PX_PER_M, power: 3.2, reach: (336 - 14) / PX_PER_M });
    for (let i = 0; i < 400; i++) {
      const x = 90 + rnd() * 340;
      const y = 14 + rnd() * 322;
      const g = gameWind('floorVent', { x: 200, y: 340, w: 48, power: 3.2 }, x, y);
      const w = windAt(room, mx(x), my(y));
      expect(w.y).toBeCloseTo(g.y, 9);
      expect(w.x).toBe(0);
    }
  });

  it('ceiling vent matches the game object in metres', () => {
    const rnd = lcg(2);
    const room = addPiece(emptyRoom(), 'ceilingVent', mx(300), my(16), { w: 60 / PX_PER_M, power: 2.2, reach: (340 - 16) / PX_PER_M });
    for (let i = 0; i < 400; i++) {
      const x = 250 + rnd() * 160;
      const y = 10 + rnd() * 340;
      const g = gameWind('ceilingVent', { x: 300, y: 14, w: 60, power: 2.2 }, x, y);
      expect(windAt(room, mx(x), my(y)).y).toBeCloseTo(g.y, 9);
    }
  });

  it('fans match the game object in metres, blowing either way', () => {
    const rnd = lcg(3);
    for (const dir of [1, -1] as const) {
      // The game's fan head centre is (x + 16, y + 16) px.
      const cx = mx(300 + 16);
      const cy = my(200 + 16);
      const room = addPiece(emptyRoom(), 'fan', cx - 0.109375, cy - 0.109375, { dir, power: 3.2, reach: 280 / PX_PER_M });
      for (let i = 0; i < 400; i++) {
        const x = 20 + rnd() * 600;
        const y = 120 + rnd() * 200;
        const g = gameWind('fan', { x: 300, y: 200, dir, power: 3.2 }, x, y);
        const w = windAt(room, mx(x), my(y));
        expect(w.x).toBeCloseTo(g.x, 9);
        expect(w.y).toBe(0);
      }
    }
  });

  it('candle plume and flame match the game object in metres', () => {
    const rnd = lcg(4);
    const fx = 403;
    const room = addPiece(emptyRoom(), 'candle', mx(fx) - 0.02, my(250) - 0.2, { power: 1, reach: 140 / PX_PER_M });
    for (let i = 0; i < 400; i++) {
      const x = fx - 30 + rnd() * 60;
      const y = 90 + rnd() * 180;
      const g = gameWind('candle', { x: 400, y: 250 }, x, y);
      expect(windAt(room, mx(x), my(y)).y).toBeCloseTo(g.y, 9);
    }
    // The flame is the game's 6 x 12 px trigger.
    const o = OBJECTS.candle({ t: 'candle', x: 400, y: 250 }, 'c', null, { dark: false, night: false });
    const trig = o.trigger!()!;
    const f = boxToPx(flameBox(room.pieces[0]));
    expect(f.x).toBeCloseTo(trig.x, 9);
    expect(f.y).toBeCloseTo(trig.y, 9);
    expect(f.w).toBeCloseTo(trig.w, 9);
    expect(f.h).toBeCloseTo(trig.h, 9);
  });

  it('the fan housing is the game collider', () => {
    const o = OBJECTS.fan({ t: 'fan', x: 300, y: 200 }, 'f', null, { dark: false, night: false });
    const col = o.colliders!()[0];
    const room = addPiece(emptyRoom(), 'fan', mx(300 + 16) - 0.109375, my(200 + 16) - 0.109375);
    const mine = boxToPx(room.pieces[0]);
    expect(mine.x).toBeCloseTo(col.x, 9);
    expect(mine.y).toBeCloseTo(col.y, 9);
    expect(mine.w).toBeCloseTo(col.w, 9);
    expect(mine.h).toBeCloseTo(col.h, 9);
  });

  it('floor vent: a hand-computed value, and the shape of the column', () => {
    const room = addPiece(emptyRoom(), 'floorVent', 1, 0);
    const v = room.pieces[0];
    const cx = v.x + v.w / 2;
    // Mid-column, 0.5 m above the grille: bump = 1, spread 0.354, decay 1 - 0.45 * 0.5 / 2.5.
    expect(windAt(room, cx, v.h + 0.5).y).toBeCloseTo(3.2 * (1 - (0.45 * 0.5) / 2.5), 3);
    // Weaker higher up, and gone above the reach and far to the side.
    const up = [0.1, 0.5, 1, 1.5, 2, 2.4].map((h) => windAt(room, cx, v.h + h).y);
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeLessThan(up[i - 1]);
    expect(up[up.length - 1]).toBeGreaterThan(3.2 * 0.35 - 1e-9);
    expect(windAt(room, cx, v.h + 2.6).y).toBe(0);
    expect(windAt(room, cx + 3, 0.5)).toEqual({ x: 0, y: 0 });
    expect(windAt(room, cx - 0.9, 0.5).y).toBeCloseTo(windAt(room, cx + 0.9, 0.5).y, 9);
    // Below the floor line there is nothing.
    expect(windAt(room, cx, -0.5).y).toBe(0);
  });

  it('ceiling vent blows down, fans blow along their direction only, candles rise', () => {
    const ceil = addPiece(emptyRoom(), 'ceilingVent', 0, 3);
    expect(windAt(ceil, 0.19, 2.5).y).toBeLessThan(-1);
    expect(windAt(ceil, 0.19, 3.5).y).toBe(0);
    const fan = addPiece(emptyRoom(), 'fan', 0, 1, { dir: 1 });
    const cy = 1 + fan.pieces[0].h / 2;
    expect(windAt(fan, 1, cy).x).toBeGreaterThan(1.5);
    expect(windAt(fan, -1, cy).x).toBe(0); // behind it
    expect(windAt(fan, 1, cy + 1.5).x).toBe(0); // far off the axis
    expect(windAt(fan, 0.5, cy).x).toBeGreaterThan(windAt(fan, 1.5, cy).x); // weaker with distance
    const left = addPiece(emptyRoom(), 'fan', 0, 1, { dir: -1 });
    expect(windAt(left, -1, cy).x).toBeLessThan(-1.5);
    expect(windAt(left, 1, cy).x).toBe(0);
    const candle = addPiece(emptyRoom(), 'candle', 0, 0);
    const wick = candle.pieces[0].y + candle.pieces[0].h;
    expect(windAt(candle, 0.02, wick + 0.3).y).toBeGreaterThan(0.5);
    expect(windAt(candle, 0.02, wick - 0.1).y).toBe(0);
    expect(windAt(candle, 1, wick + 0.3).y).toBe(0);
    expect(windAt(candle, 0.02, wick + 1.5).y).toBe(0);
  });

  it('adds ambient wind and the air movers together', () => {
    let room = { ...emptyRoom(), wind: { x: 0.5, y: -0.25 } };
    room = addPiece(room, 'floorVent', 0, 0);
    const w = windAt(room, 0.19, 0.5);
    expect(w.x).toBe(0.5);
    expect(w.y).toBeCloseTo(-0.25 + windAt(addPiece(emptyRoom(), 'floorVent', 0, 0), 0.19, 0.5).y, 9);
    const fn = windFn(room);
    expect(fn(0.19, 0.5)).toEqual(w);
    expect(fn(40, 40)).toEqual({ x: 0.5, y: -0.25 });
    expect(windAt(emptyRoom(), 3, 3)).toEqual({ x: 0, y: 0 });
  });
});

describe('test room evaluation', () => {
  const pt = (t: number, x: number, y: number, vx = 0, vy = 0): PathPoint =>
    ({ t, x, y, theta: 0, facing: 1, V: 0, alpha: 0, CL: 0, CD: 0, stall: 0, vx, vy }) as PathPoint;

  it('a plane that comes to rest inside a target scores it', () => {
    const room = addPiece(addPiece(emptyRoom(), 'target', 5, 0, { w: 1 }), 'target', 8, 0.8, { w: 1, h: 0.1 });
    const [t1, t2] = room.pieces;
    expect(hitTargets([pt(0, 0, 2, 3), pt(5, 5.5, 0.03)], room)).toEqual([{ id: t1.id, t: 5, x: 5.5, y: 0.03 }]);
    expect(hitTargets([pt(5, 4.9, 0.03)], room)).toEqual([]); // just short
    expect(hitTargets([pt(5, 6.1, 0.03)], room)).toEqual([]); // just long
    expect(hitTargets([pt(5, 5.5, 0.9)], room)).toEqual([]); // above it, in the air
    // A target on a platform.
    expect(hitTargets([pt(6, 8.5, 0.84)], room).map((h) => h.id)).toEqual([t2.id]);
    // Still flying fast, or flagged as not at rest: no score.
    expect(hitTargets([pt(4, 5.5, 0.03, 2, 0)], room)).toEqual([]);
    expect(hitTargets([pt(5, 5.5, 0.03)], room, { rested: false })).toEqual([]);
    expect(hitTargets([], room)).toEqual([]);
  });

  it('a plane that flies through a hoop passes it, either way round', () => {
    const room = addPiece(addPiece(emptyRoom(), 'hoop', 3, 1, { h: 0.6 }), 'hoop', 6, 1, { h: 0.6 });
    const [h1, h2] = room.pieces;
    const gateX = 3 + 0.04 / 2;
    const through = [pt(0, 0, 1.4), pt(1, 2, 1.3), pt(2, 4, 1.1), pt(3, 5, 0.9)];
    const r = hoopsPassed(through, room);
    expect(r.length).toBe(1);
    expect(r[0].id).toBe(h1.id);
    expect(r[0].dir).toBe(1);
    // Time is interpolated to the moment of crossing.
    expect(r[0].t).toBeCloseTo(1 + (gateX - 2) / 2, 9);
    // Flying the other way.
    const back = hoopsPassed([pt(0, 5, 1.2), pt(1, 2, 1.2)], room);
    expect(back.map((p) => [p.id, p.dir])).toEqual([[h1.id, -1]]);
    // Over it, under it, short of it.
    expect(hoopsPassed([pt(0, 2, 1.8), pt(1, 4, 1.8)], room)).toEqual([]);
    expect(hoopsPassed([pt(0, 2, 0.5), pt(1, 4, 0.5)], room)).toEqual([]);
    expect(hoopsPassed([pt(0, 0, 1.2), pt(1, 2.9, 1.2)], room)).toEqual([]);
    // Both hoops, and each counts once even if flown through twice.
    const both = hoopsPassed([pt(0, 2, 1.3), pt(1, 7, 1.3), pt(2, 2, 1.3), pt(3, 7, 1.3)], room);
    expect(both.map((p) => p.id).sort()).toEqual([h1.id, h2.id].sort());
    // The crossing is found however coarse the samples are (it is a segment test, not a point test).
    expect(hoopsPassed([pt(0, 0, 1.2), pt(1, 100, 1.2)], room).length).toBe(2);
  });

  it('scores the room', () => {
    let room = addPiece(emptyRoom(), 'hoop', 3, 1, { h: 0.6 });
    room = addPiece(room, 'target', 5, 0, { w: 1 });
    const flown = [pt(0, 0, 1.4, 3), pt(1, 2, 1.3, 3), pt(2, 4, 1.1, 3), pt(3, 5.5, 0.03)];
    const s = evaluateRoom(flown, room);
    expect(s.hoops).toEqual({ passed: 1, total: 1 });
    expect(s.targets).toEqual({ hit: 1, total: 1 });
    expect(s.score).toBe(150);
    expect(s.complete).toBe(true);
    const miss = evaluateRoom([pt(0, 0, 1.4, 3), pt(1, 2, 1.3), pt(2, 4.4, 0.03)], room);
    expect(miss.targets.hit).toBe(0);
    expect(miss.complete).toBe(false);
    expect(evaluateRoom(flown, emptyRoom()).complete).toBe(false);
  });

  it('scores a real flight through a test room', () => {
    // Fly the empty hangar first to see where the glider goes, then build a room around that flight.
    const start = { x: 0, y: 2, angle: 0, power: 0.37 };
    const clear = simulateOpen(glider.aero, glider.mesh, start);
    const at = clear.path.find((q) => q.x > 5)!;
    let room = addPiece(emptyRoom(), 'hoop', at.x, at.y - 0.3, { h: 0.6 });
    room = addPiece(room, 'target', clear.finalX - 0.5, 0, { w: 1 });
    const r = simulateOpen(glider.aero, glider.mesh, start, undefined, { room });
    const s = evaluateRoom(r.path, room, { rested: r.outcome !== 'timeout' });
    expect(s.hoops.passed).toBe(1);
    expect(s.targets.hit).toBe(1);
    expect(s.complete).toBe(true);
    // The simulator scores it too, and says nothing when there is no room.
    expect(r.roomScore).toEqual(s);
    expect(clear.roomScore).toBeNull();
  });
});

describe('test room model', () => {
  it('builds rooms without touching the old ones', () => {
    const empty = emptyRoom('Hangar');
    const one = addPiece(empty, 'wall', 1, 0);
    expect(empty.pieces.length).toBe(0);
    expect(one.pieces.length).toBe(1);
    expect(one.pieces[0]).toMatchObject({ kind: 'wall', x: 1, y: 0, w: 0.2, h: 1.2 });
    const two = addPiece(one, 'fan', 2, 1, { dir: -1 });
    expect(two.pieces.map((p) => p.id)).toEqual(['p1', 'p2']);
    // Ids stay unique after removals.
    const removed = removePiece(two, 'p1');
    const three = addPiece(removed, 'candle', 3, 0);
    expect(three.pieces.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(nextPieceId(three)).toBe('p4');
    expect(updatePiece(three, 'p2', { power: 5 }).pieces[0].power).toBe(5);
    expect(three.pieces[0].power).toBe(3.2);
    expect(makePiece('hoop', 1, 1).h).toBe(0.5);
  });

  it('picks the topmost piece at a point', () => {
    let room = addPiece(emptyRoom(), 'wall', 0, 0, { w: 2, h: 2 });
    room = addPiece(room, 'target', 0.5, 0, { w: 1, h: 0.2 });
    expect(pieceAt(room, 0.7, 0.1)!.kind).toBe('target');
    expect(pieceAt(room, 1.9, 1.9)!.kind).toBe('wall');
    expect(pieceAt(room, 5, 5)).toBeUndefined();
    expect(pieceAt(room, 2.05, 1, 0.1)!.kind).toBe('wall');
  });

  it('serialises and parses a room', () => {
    let room: TestRoom = { ...emptyRoom('Gale'), wind: { x: 0.5, y: 0 }, launch: { x: -1, y: 2.5, angle: 0.2 } };
    room = addPiece(room, 'wall', 4, 0, { h: 2 });
    room = addPiece(room, 'floorVent', 1.234567, 0, { power: 4.5, reach: 3 });
    room = addPiece(room, 'fan', 0, 1, { dir: -1 });
    room = addPiece(room, 'hoop', 6, 1);
    room = addPiece(room, 'target', 7, 0);
    room = addPiece(room, 'candle', 2, 0);
    room = addPiece(room, 'ceilingVent', 3, 5);
    const text = serializeRoom(room);
    expect(typeof text).toBe('string');
    expect(text.length).toBeLessThan(1500);
    const back = parseRoom(text)!;
    expect(back.name).toBe('Gale');
    expect(back.wind).toEqual({ x: 0.5, y: 0 });
    expect(back.launch).toEqual({ x: -1, y: 2.5, angle: 0.2 });
    expect(back.pieces.length).toBe(room.pieces.length);
    room.pieces.forEach((p, i) => {
      const q = back.pieces[i];
      expect(q.id).toBe(p.id);
      expect(q.kind).toBe(p.kind);
      for (const k of ['x', 'y', 'w', 'h', 'power', 'reach'] as const) expect(q[k]).toBeCloseTo(p[k], 4);
      if (p.kind === 'fan') expect(q.dir).toBe(p.dir);
    });
    // Saving the parsed room again gives the same text.
    expect(serializeRoom(back)).toBe(text);
  });

  it('refuses what is not a room and repairs what is nearly one', () => {
    for (const bad of ['', 'nope', '{', '[]', '{"v":2,"pieces":[]}', '{"v":1}', 'null', '{"v":1,"pieces":"x"}']) expect(parseRoom(bad)).toBeNull();
    const nasty = JSON.stringify({
      v: 1,
      name: 'x'.repeat(200),
      wind: [1e9, 'a'],
      launch: [1e9, -5, 99],
      pieces: [
        { id: 'a', k: 'wall', x: 1, y: 0, w: -3, h: 1e9 },
        { id: 'a', k: 'fan', x: 'q', y: NaN, power: 1e9, reach: -1, dir: -1 },
        { id: '', k: 'laser', x: 0, y: 0 },
        7,
        null,
        { k: 'target', x: 2, y: 0 },
      ],
    });
    const room = parseRoom(nasty)!;
    expect(room.name.length).toBe(60);
    expect(room.wind).toEqual({ x: 30, y: 0 });
    expect(room.launch.x).toBe(1000);
    expect(room.launch.y).toBe(0);
    expect(room.launch.angle).toBeCloseTo(Math.PI, 9);
    expect(room.pieces.map((p) => p.kind)).toEqual(['wall', 'fan', 'target']);
    expect(new Set(room.pieces.map((p) => p.id)).size).toBe(3);
    const wall = room.pieces[0];
    expect(wall.w).toBe(0.01);
    expect(wall.h).toBe(100);
    const fan = room.pieces[1] as Piece;
    expect(fan.x).toBe(0);
    expect(fan.y).toBe(0);
    expect(fan.power).toBe(20);
    expect(fan.reach).toBe(0);
    expect(fan.dir).toBe(-1);
    // A hundred pieces at most.
    const many = JSON.stringify({ v: 1, pieces: Array.from({ length: 300 }, (_, i) => ({ id: `w${i}`, k: 'wall', x: i, y: 0 })) });
    expect(parseRoom(many)!.pieces.length).toBe(100);
  });
});
