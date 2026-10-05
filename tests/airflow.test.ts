/**
 * The air-current lines must tell the truth: every line lies inside its object's air (blowing along
 * the line) and stops where the air stops, unless it runs off the edge of the room.
 */

import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../src/game/objects';
import type { GameObject } from '../src/game/objects/types';
import { CHALLENGES } from '../src/modes/challenges';
import { allLevels } from '../src/world/campaign';
import { generateFloor, themeForFloor } from '../src/world/procgen';
import { spillFlows, spillsFor, spillWind } from '../src/game/roomAir';
import type { ItemDef, RoomDef } from '../src/world/types';

const ROOM = { dark: false, night: false };

function make(it: ItemDef): GameObject {
  return OBJECTS[it.t](it, `test:${it.t}`, null, ROOM);
}

function windAt(o: GameObject, x: number, y: number): { x: number; y: number } {
  const out = { x: 0, y: 0 };
  o.wind?.(x, y, out);
  // wind is y-up; lines are in room px (y down)
  return { x: out.x, y: -out.y };
}

function checkObject(o: GameObject, label: string): number {
  const flows = o.airflow?.() ?? [];
  let lines = 0;
  flows.forEach((f, fi) => {
    expect(f.lines.length, `${label}: flow ${fi} has lines`).toBeGreaterThan(0);
    for (const line of f.lines) {
      const a = line[0];
      const b = line[line.length - 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      expect(len, `${label}: line length`).toBeGreaterThan(8);
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      for (const t of [0.03, 0.25, 0.5, 0.75, 0.97]) {
        const w = windAt(o, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        expect(w.x * dx + w.y * dy, `${label}: air blows along the line at ${t}`).toBeGreaterThan(0);
      }
      // a combined object (the stove's hob and its kettle) can only be judged on its first current;
      // the kettle on its own is checked separately
      const atEdge = b.y <= 0.5 || b.y >= 359.5 || b.x <= 0.5 || b.x >= 639.5;
      if (!atEdge && (flows.length === 1 || fi === 0)) {
        const w = windAt(o, b.x + dx * 4, b.y + dy * 4);
        expect(Math.hypot(w.x, w.y), `${label}: no air past the end of the line`).toBeLessThan(1e-9);
      }
      lines++;
    }
  });
  return lines;
}

const AIR = ['floorVent', 'ceilingVent', 'fan', 'radiator', 'draft', 'candle', 'fireplace', 'kettle', 'stove'];

function airItems(rooms: Record<string, RoomDef>): { key: string; it: ItemDef }[] {
  const out: { key: string; it: ItemDef }[] = [];
  for (const [key, r] of Object.entries(rooms)) for (const it of r.items) if (AIR.includes(it.t)) out.push({ key, it });
  return out;
}

describe('air-current lines', () => {
  it('every air object draws lines, with default settings', () => {
    const defaults: ItemDef[] = [
      { t: 'floorVent', x: 200, y: 336 },
      { t: 'floorVent', x: 200, y: 336, reach: 120, spread: 0.1 },
      { t: 'floorVent', x: 200, y: 336, reach: -60 },
      { t: 'ceilingVent', x: 300, y: 14 },
      { t: 'ceilingVent', x: 300, y: 14, reach: 200 },
      { t: 'fan', x: 300, y: 200 },
      { t: 'fan', x: 300, y: 200, dir: -1, reach: 120 },
      { t: 'fan', x: 560, y: 200, reach: 400 },
      { t: 'radiator', x: 200, y: 284, w: 120 },
      { t: 'draft', x: 380, y: 340, w: 160, top: -40 },
      { t: 'draft', x: 380, y: 372, w: 160, top: 120 },
      { t: 'candle', x: 140, y: 240 },
      { t: 'fireplace', x: 190, y: 190 },
      { t: 'kettle', x: 300, y: 222 },
      { t: 'stove', x: 150, y: 244 },
      { t: 'stove', x: 150, y: 244, kettle: false },
    ];
    for (const it of defaults) expect(checkObject(make(it), JSON.stringify(it))).toBeGreaterThan(0);
  });

  it('campaign and challenge rooms', () => {
    let n = 0;
    for (const l of allLevels()) for (const { key, it } of airItems(l.build().rooms)) n += checkObject(make(it), `${l.id} ${key} ${it.t}`);
    for (const c of CHALLENGES) for (const { key, it } of airItems(c.level().rooms)) n += checkObject(make(it), `${c.id} ${key} ${it.t}`);
    expect(n).toBeGreaterThan(40);
  });

  it('air carried through floor and ceiling openings', () => {
    let n = 0;
    const levels = [...allLevels().map((l) => l.build())];
    for (let seed = 1; seed <= 12; seed++) levels.push(generateFloor({ seed, floor: seed % 9, theme: themeForFloor(seed % 9) }));
    for (const level of levels)
      for (const key of Object.keys(level.rooms)) {
        const spills = spillsFor(level, key);
        for (const f of spillFlows(spills))
          for (const line of f.lines) {
            const a = line[0];
            const b = line[line.length - 1];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const dx = (b.x - a.x) / len;
            const dy = (b.y - a.y) / len;
            const at = (x: number, y: number) => {
              const out = { x: 0, y: 0 };
              spillWind(spills, x, y, out);
              return { x: out.x, y: -out.y };
            };
            for (const t of [0.03, 0.5, 0.97]) {
              const w = at(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
              expect(w.x * dx + w.y * dy, `${level.id} ${key}: carried air blows along the line`).toBeGreaterThan(0);
            }
            const edge = b.y <= 0.5 || b.y >= 359.5;
            if (!edge) {
              const w = at(b.x + dx * 4, b.y + dy * 4);
              expect(Math.hypot(w.x, w.y), `${level.id} ${key}: no carried air past the end`).toBeLessThan(1e-9);
            }
            n++;
          }
      }
    expect(n).toBeGreaterThan(10);
    // (generates a dozen floors: a few seconds, more on a busy machine)
  }, 20000);

  it('generated floors', () => {
    let n = 0;
    for (const theme of ['home', 'cottage'] as const)
      for (const seed of [1, 7, 42])
        for (const twist of ['none', 'windy', 'gusty'] as const) {
          const level = generateFloor({ seed, floor: 3, theme, twist });
          for (const { key, it } of airItems(level.rooms)) n += checkObject(make(it), `${theme}/${seed}/${twist} ${key} ${it.t}`);
        }
    expect(n).toBeGreaterThan(20);
  }, 20000);
});
