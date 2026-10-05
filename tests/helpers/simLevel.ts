/** Headless multi-room flight: follows the plane through a level's rooms (tests and tuning). */

import { analyzeDesign } from '../../src/paper/aero';
import { buildMesh } from '../../src/paper/build';
import type { Design } from '../../src/paper/design';
import { buildSimRoom, simulateRoom, type SimOutcome, type SimStart } from '../../src/game/sim';
import { neighbour, type LevelDef } from '../../src/game/level';
import type { FlightInput, Plane } from '../../src/physics/flight';

export type Ctl = (p: Plane, t: number, room: string) => FlightInput;

export interface LevelSim {
  outcome: SimOutcome | 'exit';
  t: number;
  path: { x: number; y: number }[];
  damage: number;
  plane: Plane | null;
  room: string;
}

export function simLevel(level: LevelDef, d: Design, angle: number, power: number, ctl: Ctl = () => ({ dir: 0, pitch: 0, boost: false }), maxT = 40): LevelSim {
  const { build, aero } = analyzeDesign(d);
  const mesh = buildMesh(build, aero.cg);
  let key = level.start.room;
  let start: SimStart = { x: level.start.x, y: level.start.y, angle, power };
  const path: { x: number; y: number }[] = [];
  let t0 = 0;
  for (let hop = 0; hop < 12; hop++) {
    const def = level.rooms[key];
    const [gx, gy] = key.split(',').map(Number);
    const r = simulateRoom(buildSimRoom(def), aero, mesh, start, (p, t) => ctl(p, t + t0, key), { maxT: maxT - t0, record: 2 });
    for (const q of r.path) path.push({ x: gx * 640 + q.x, y: gy * 360 + q.y });
    t0 += r.t;
    const out = r.outcome;
    if (out === 'left' || out === 'right' || out === 'up' || out === 'down') {
      const span = def.exits[out] as { exit?: boolean } | undefined;
      const next = neighbour(level, key, out);
      if (!next) return { outcome: span?.exit ? 'exit' : 'crashed', t: t0, path, damage: r.damage, plane: r.plane, room: key };
      const p = r.plane;
      let x = p.x * 128;
      let y = 360 - p.y * 128;
      if (out === 'left') x += 640;
      if (out === 'right') x -= 640;
      if (out === 'up') y += 360;
      if (out === 'down') y -= 360;
      start = { x, y, vx: p.vx, vy: p.vy, theta: p.theta, facing: p.facing };
      key = next;
      continue;
    }
    return { outcome: out, t: t0, path, damage: r.damage, plane: r.plane, room: key };
  }
  return { outcome: 'timeout', t: t0, path, damage: 0, plane: null, room: key };
}

/** How many of the hoops a path flew through (crossing the hoop's x within its opening). */
export function hoopsPassed(path: { x: number; y: number }[], hoops: { x: number; y: number; r: number }[]): number {
  let n = 0;
  for (const h of hoops) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if ((a.x - h.x) * (b.x - h.x) > 0) continue;
      const y = a.y + ((b.y - a.y) * (h.x - a.x)) / (b.x - a.x || 1);
      if (Math.abs(y - h.y) < h.r - 8) {
        n++;
        break;
      }
    }
  }
  return n;
}
