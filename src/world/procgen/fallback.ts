/**
 * Fallback floor builder: stitches hand-made rooms into a row. Used until (or if) the full
 * procedural generator is unavailable.
 */

import type { LevelDef } from '../../game/level';
import { createRng } from '../../core/rng';
import type { ItemDef, RoomDef } from '../types';
import { level1, level2, level3 } from '../levels/home';

export type ThemeId = 'home' | 'cottage';
export type TwistId = 'none' | 'tissue' | 'cardstock' | 'lights-out' | 'windy' | 'heavy-nose' | 'fold-budget' | 'night' | 'gusty' | 'one-sheet';

export interface FloorOptions {
  seed: number;
  floor: number;
  theme: ThemeId;
  rooms?: number;
  twist?: TwistId;
  workbenchRoom?: boolean;
}

function pool(): RoomDef[] {
  const out: RoomDef[] = [];
  for (const l of [level1(), level2(), level3()]) for (const r of Object.values(l.rooms)) if (!r.exits.up && !r.exits.down) out.push(r);
  return out;
}

export function fallbackFloor(opts: FloorOptions): LevelDef {
  const rng = createRng(opts.seed);
  const n = opts.rooms ?? 4 + Math.min(3, Math.floor(opts.floor / 2));
  const src = pool();
  const rooms: Record<string, RoomDef> = {};
  for (let i = 0; i < n; i++) {
    const base = rng.pick(src);
    const key = `${i},0`;
    let star = 0;
    const items: ItemDef[] = base.items
      .filter((it) => it.t !== 'exit' && it.t !== 'frontDoor')
      .map((it) => {
        const c = { ...it };
        if (c.t === 'star') c.id = `${key}:star:${star++}`;
        else if (typeof c.id === 'string') c.id = `${key}:${c.t}:${i}`;
        return c;
      })
      // keep the doorways clear
      .filter((it) => !(i > 0 && it.x < 40 && it.y > 60) && !(it.x > 600 && it.y > 60 && it.t !== 'switch'));
    const last = i === n - 1;
    if (last) items.push({ t: 'exit', x: 600, y: 80, w: 40, h: 260 });
    if (opts.workbenchRoom && last) items.push({ t: 'workbench', x: 300, y: 242, w: 120 });
    const dark = opts.twist === 'lights-out' || (!!base.dark && rng.chance(0.5));
    if (dark && !items.some((it) => it.t === 'switch')) items.push({ t: 'switch', x: 60, y: 160 });
    rooms[key] = {
      ...base,
      id: `trail-${opts.seed}-${i}`,
      dark,
      night: opts.twist === 'night' || opts.twist === 'lights-out' ? true : base.night,
      exits: {
        left: i > 0 ? { from: 70, to: 340 } : undefined,
        right: { from: 80, to: 340, exit: last ? true : undefined },
      },
      items,
      seed: rng.int(1, 9999),
    };
  }
  return {
    id: `trail-${opts.seed}-${opts.floor}`,
    name: `Floor ${opts.floor + 1}`,
    place: opts.theme,
    rooms,
    start: { room: '0,0', x: 90, y: 150, facing: 1 },
    sheets: Math.max(2, 4 - Math.floor(opts.floor / 3)),
    par: n * 10,
  };
}
