/** Reading the route back out of a finished level: which room follows which, and how each is entered and left. */

import { neighbour, parseKey, type LevelDef } from '../../game/level';
import type { ExitSpan, RoomDef } from '../types';
import { OPPOSITE, type EntrySide, type RoomIO, type Side } from './types';

const SIDES: Side[] = ['left', 'right', 'up', 'down'];

export interface RouteStep {
  key: string;
  /** The side this room was entered through (the side facing the previous room); null for the first room. */
  from: Side | null;
  /** The side it is left through (null only if the route is broken). */
  to: Side | null;
}

/**
 * Follow the openings from the start room. Returns the rooms in order; stops at the room whose far opening is the
 * level exit (or where the route breaks).
 */
export function traceRoute(level: LevelDef): RouteStep[] {
  const steps: RouteStep[] = [];
  const seen = new Set<string>();
  let key: string | null = level.start.room;
  let from: Side | null = null;
  while (key && !seen.has(key)) {
    seen.add(key);
    const room: RoomDef | undefined = level.rooms[key];
    if (!room) break;
    let to: Side | null = null;
    let next: string | null = null;
    for (const side of SIDES) {
      if (!room.exits[side] || side === from) continue;
      const n = neighbour(level, key, side);
      if (n && !seen.has(n)) {
        to = side;
        next = n;
        break;
      }
      if (!n && room.exits[side]!.exit) {
        to = side;
        next = null;
        break;
      }
    }
    steps.push({ key, from, to });
    if (!next) break;
    from = OPPOSITE[to as Side];
    key = next;
  }
  return steps;
}

/** The `RoomIO` of every room on the route, as the generator would have planned it. */
export function routeIO(level: LevelDef): RoomIO[] {
  const steps = traceRoute(level);
  // direction of progress: the side of the first horizontal exit
  let dirX: 1 | -1 = 1;
  for (const s of steps) {
    if (s.to === 'right') {
      dirX = 1;
      break;
    }
    if (s.to === 'left') {
      dirX = -1;
      break;
    }
  }
  return steps.map((s, i) => {
    const room = level.rooms[s.key];
    const [gx, gy] = parseKey(s.key);
    const exitSide = (s.to ?? (dirX > 0 ? 'right' : 'left')) as Side;
    const entrySpan: ExitSpan | undefined = s.from ? room.exits[s.from] : undefined;
    return {
      index: i,
      count: steps.length,
      gx,
      gy,
      key: s.key,
      dirX,
      entry: (s.from ?? 'start') as EntrySide,
      entrySpan,
      exit: exitSide,
      exitSpan: room.exits[exitSide] ?? { from: 80, to: 335 },
    };
  });
}
