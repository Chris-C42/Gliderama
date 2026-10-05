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
  /** Text shown on the end card when the level is finished. */
  outro?: string;
  /** Daily / roguelike twist id. */
  twist?: string;
  /**
   * How the level is finished, besides an exit: 'stars' = collecting every goal star (`star` items with
   * `goal: true`) finishes it, as in Glider PRO; 'none' = it has no finish (free flight).
   */
  goal?: 'stars' | 'none';
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

/** The ids of the stars that finish a `goal: 'stars'` level (they carry explicit ids). */
export function goalStarIds(level: LevelDef): string[] {
  const out: string[] = [];
  for (const r of Object.values(level.rooms)) for (const it of r.items) if (it.t === 'star' && it.goal && typeof it.id === 'string') out.push(it.id);
  return out;
}

/**
 * Where a plane that has just flown into room `next` through its `entry` side gets thrown from next time: just
 * inside the entry edge (shared by the session and the level checks).
 */
export function entryCheckpoint(level: LevelDef, next: string, entry: 'left' | 'right' | 'up' | 'down', x: number, y: number, facing: 1 | -1) {
  const ex = level.rooms[next].exits[entry];
  let cx = Math.max(40, Math.min(640 - 40, x));
  let cy = Math.max(40, Math.min(300, y));
  if (entry === 'left') cx = 44;
  if (entry === 'right') cx = 640 - 44;
  if (ex && (entry === 'left' || entry === 'right')) cy = Math.max(ex.from + 16, Math.min(ex.to - 30, y));
  if (entry === 'down') cy = 280;
  if (entry === 'up') cy = 60;
  return { room: next, x: cx, y: cy, facing };
}
