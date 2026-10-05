import type { RoomDef } from '../world/types';

export interface LevelDef {
  id: string;
  name: string;
  /** Place (campaign chapter) this level belongs to. */
  place: string;
  /** Rooms keyed by grid position "gx,gy" (gy grows downward). */
  rooms: Record<string, RoomDef>;
  start: { room: string; x: number; y: number; facing: 1 | -1 };
  /** Spare sheets at the start. */
  sheets: number;
  /** Par time (s) for the Swift medal. */
  par: number;
  /** Intro text shown before the first throw. */
  intro?: string;
  /** Daily / roguelike twist id. */
  twist?: string;
}

export function roomKey(gx: number, gy: number): string {
  return `${gx},${gy}`;
}

export function parseKey(key: string): [number, number] {
  const [a, b] = key.split(',').map(Number);
  return [a, b];
}

export function neighbour(level: LevelDef, key: string, side: 'left' | 'right' | 'up' | 'down'): string | null {
  const [gx, gy] = parseKey(key);
  const k =
    side === 'left' ? roomKey(gx - 1, gy) : side === 'right' ? roomKey(gx + 1, gy) : side === 'up' ? roomKey(gx, gy - 1) : roomKey(gx, gy + 1);
  return level.rooms[k] ? k : null;
}

/** Total collectible stars in a level (for medals). */
export function countStars(level: LevelDef): number {
  let n = 0;
  for (const r of Object.values(level.rooms)) for (const it of r.items) if (it.t === 'star') n++;
  return n;
}
