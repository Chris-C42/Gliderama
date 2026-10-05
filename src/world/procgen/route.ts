/** Reading the route back out of a finished level: which room follows which, and how each is entered and left. */

import { neighbour, parseKey, type LevelDef } from '../../game/level';
import type { ExitSpan, RoomDef } from '../types';
import { OPPOSITE, type EntrySide, type RoomIO, type Side, type VerticalLink } from './types';

const SIDES: Side[] = ['left', 'right', 'up', 'down'];

export interface RouteStep {
  key: string;
  /** The side this room was entered through (the side facing the previous room); null for the first room. */
  from: Side | null;
  /** The side it is left through (null only if the route is broken). */
  to: Side | null;
  /** How the change of storey is made when `from` or `to` is 'up' / 'down': an opening, or a flight of stairs. */
  link?: VerticalLink;
}

/**
 * Follow the openings (and the stairs) from the start room. Returns the rooms in order; stops at the room whose far
 * opening is the level exit (or where the route breaks). A flight of stairs counts as leaving through the ceiling
 * (`stairsUp`) or the floor (`stairsDown`) into the room that lies there.
 */
export function traceRoute(level: LevelDef): RouteStep[] {
  const steps: RouteStep[] = [];
  const seen = new Set<string>();
  let key: string | null = level.start.room;
  let from: Side | null = null;
  let fromLink: VerticalLink | undefined;
  while (key && !seen.has(key)) {
    seen.add(key);
    const room: RoomDef | undefined = level.rooms[key];
    if (!room) break;
    let to: Side | null = null;
    let next: string | null = null;
    let toLink: VerticalLink | undefined;
    for (const side of SIDES) {
      if (!room.exits[side] || side === from) continue;
      const n = neighbour(level, key, side);
      if (n && !seen.has(n)) {
        to = side;
        next = n;
        if (side === 'up' || side === 'down') toLink = 'hole';
        break;
      }
      if (!n && room.exits[side]!.exit) {
        to = side;
        next = null;
        break;
      }
    }
    // no opening leads on: a flight of stairs to a room that has not been visited
    if (!to)
      for (const it of room.items) {
        if (it.t !== 'stairsUp' && it.t !== 'stairsDown') continue;
        const side = it.t === 'stairsUp' ? 'up' : 'down';
        const n = neighbour(level, key, side);
        if (!n || seen.has(n)) continue;
        to = side;
        next = n;
        toLink = 'stairs';
        break;
      }
    const link = toLink ?? fromLink;
    steps.push({ key, from, to, ...(link ? { link } : {}) });
    if (!next) break;
    from = OPPOSITE[to as Side];
    fromLink = toLink;
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
      ...(s.link ? { link: s.link } : {}),
    };
  });
}
