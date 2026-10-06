/** Where the plane is thrown from again after a crash: high up at the room's entry side, not where it flew in. */

import { describe, expect, it } from 'vitest';
import { entryCheckpoint, type LevelDef } from '../src/game/level';
import type { ItemDef, RoomDef } from '../src/world/types';

function level(items: ItemDef[], startY = 110): LevelDef {
  const room = (id: string, extra: ItemDef[] = []): RoomDef =>
    ({
      id,
      name: id,
      wall: { pattern: 'plain', base: 'cream', accent: 'cream', wainscot: null, trim: 'cream' },
      floor: { kind: 'planks', ramp: 'oak' },
      exits: { left: { from: 40, to: 340 }, right: { from: 40, to: 340 }, down: { from: 280, to: 380 } },
      seed: 1,
      items: extra,
    }) as RoomDef;
  return { id: 't', name: 't', place: 'home', rooms: { '0,0': room('a'), '1,0': room('b', items) }, start: { room: '0,0', x: 60, y: startY, facing: 1 }, sheets: 3, par: 30 };
}

describe('relaunch checkpoints', () => {
  it('a plane that came in low is thrown again from up at the starting height of the level', () => {
    const cp = entryCheckpoint(level([]), '1,0', 'left', 4, 290, 1);
    expect(cp.x).toBe(44);
    expect(cp.y).toBe(110);
    // whichever side it came in by, and a level that starts lower still relaunches high
    expect(entryCheckpoint(level([]), '1,0', 'right', 636, 280, -1).y).toBe(110);
    expect(entryCheckpoint(level([], 260), '1,0', 'left', 4, 300, 1).y).toBe(180);
  });

  it('coming up through the floor, it is thrown from high above the opening', () => {
    const cp = entryCheckpoint(level([]), '1,0', 'down', 330, 355, 1);
    expect(cp.x).toBe(330);
    expect(cp.y).toBe(110);
  });

  it('it never goes up past something solid above where it came in', () => {
    // a shelf over the entry side at y 200..208: the relaunch stays under it
    const cp = entryCheckpoint(level([{ t: 'shelf', x: 12, y: 200, w: 120 }]), '1,0', 'left', 4, 290, 1);
    expect(cp.y).toBeGreaterThan(208);
    expect(cp.y).toBeLessThan(290);
  });

  it('dropping in through the ceiling still starts just under it', () => {
    expect(entryCheckpoint(level([]), '1,0', 'up', 320, 2, 1).y).toBe(60);
  });

  it('up or down a shaft, it is thrown from inside the shaft, clear of its walls', () => {
    // the opening in the floor is a shaft x 280..380 between blocks: a plane that came up it close to one wall is
    // thrown from just off that wall
    const shaft: ItemDef[] = [
      { t: 'solid', x: 0, y: 0, w: 280, h: 360 },
      { t: 'solid', x: 380, y: 0, w: 260, h: 360 },
    ];
    const up = entryCheckpoint(level(shaft), '1,0', 'down', 375, 355, 1);
    expect(up.x).toBeGreaterThanOrEqual(350);
    expect(up.x).toBeLessThanOrEqual(358);
    expect(up.y).toBe(110);
    const down = entryCheckpoint(level(shaft), '1,0', 'up', 284, 2, -1);
    expect(down.x).toBeGreaterThanOrEqual(302);
    expect(down.x).toBeLessThanOrEqual(310);
  });
});
