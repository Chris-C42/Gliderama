/** The Test Hangar: a long, open warehouse made of 640-px bays. */

import type { LevelDef } from '../../game/level';
import type { ItemDef, RoomDef } from '../types';

export const HANGAR_BAYS = 8;

export function hangarBay(i: number, extra: ItemDef[] = []): RoomDef {
  const items: ItemDef[] = [
    { t: 'hazardStripe', x: 0, y: 0 },
    { t: 'girder', x: 0, y: 34 },
    { t: 'hangarWindow', x: 70, y: 74, w: 200, h: 74 },
    { t: 'hangarWindow', x: 370, y: 74, w: 200, h: 74 },
    { t: 'baySign', x: 290, y: 176, label: `BAY ${i + 1}` },
    { t: 'markers', x: 0, y: 0, startM: i * 5 },
  ];
  if (i === 0) items.push({ t: 'launcher', x: 40, y: 200 });
  return {
    id: `hangar-${i}`,
    name: `Test Hangar · Bay ${i + 1}`,
    wall: { pattern: 'corrugated', base: 'stone', accent: 'steel', wainscot: null, trim: 'steel' },
    floor: { kind: 'concrete', ramp: 'stone' },
    open: true,
    exits: {
      left: i > 0 ? { from: 16, to: 340 } : undefined,
      right: i < HANGAR_BAYS - 1 ? { from: 16, to: 340 } : undefined,
    },
    seed: 100 + i,
    items: [...items, ...extra],
  };
}

export function hangarLevel(extras: Record<number, ItemDef[]> = {}): LevelDef {
  const rooms: Record<string, RoomDef> = {};
  for (let i = 0; i < HANGAR_BAYS; i++) rooms[`${i},0`] = hangarBay(i, extras[i] ?? []);
  return {
    id: 'hangar',
    name: 'Test Hangar',
    place: 'hangar',
    rooms,
    start: { room: '0,0', x: 76, y: 176, facing: 1 },
    sheets: 99,
    par: 0,
  };
}
