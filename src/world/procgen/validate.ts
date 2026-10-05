/**
 * Structural checks of a generated level (no flight simulation: see `flightCheck.ts` for that): openings line up,
 * ids are unique, items are in bounds, floor furniture does not overlap, surface items sit on something, wall decor
 * has room to breathe, dark rooms have their switch, the workbench stands on a desk.
 */

import { neighbour, parseKey, type LevelDef } from '../../game/level';
import { roomColliders } from '../colliders';
import { LAYOUT, type ExitSpan, type ItemDef } from '../types';
import { CANDLE, CATALOG, boxOf, sizeOf, surfaceOf, wallAboveOf } from './catalog';
import { overlaps, unionX } from './geom';
import { routeIO, traceRoute } from './route';
import { KINDS } from '../kinds';
import { OPPOSITE, type Side } from './types';

const SIDES: Side[] = ['left', 'right', 'up', 'down'];
const RUNTIME_ONLY = new Set(['star', 'tape', 'sheet', 'drip', 'switch', 'workbench', 'ceilingVent', 'exit', 'battery', 'bands', 'radiator']);

export interface Validation {
  ok: boolean;
  problems: string[];
}

function sameSpan(a: ExitSpan, b: ExitSpan): boolean {
  return a.from === b.from && a.to === b.to;
}

export function validateLevel(level: LevelDef): Validation {
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(msg);
  const keys = Object.keys(level.rooms);
  if (keys.length === 0) return { ok: false, problems: ['level has no rooms'] };

  // ---- grid keys and the start
  for (const k of keys) {
    const [gx, gy] = parseKey(k);
    if (!Number.isInteger(gx) || !Number.isInteger(gy) || `${gx},${gy}` !== k) bad(`room key '${k}' is not a grid key`);
  }
  const startRoom = level.rooms[level.start.room];
  if (!startRoom) bad(`start room '${level.start.room}' does not exist`);
  if (level.start.facing !== 1 && level.start.facing !== -1) bad('start.facing must be 1 or -1');
  if (!(level.sheets >= 3 && level.sheets <= 5)) bad(`sheets ${level.sheets} outside 3..5`);
  if (!(level.par > 0)) bad('par must be positive');

  // ---- openings
  let exits = 0;
  for (const k of keys) {
    const room = level.rooms[k];
    for (const side of SIDES) {
      const span = room.exits[side];
      if (!span) continue;
      const horizontal = side === 'left' || side === 'right';
      const max = horizontal ? 360 : 640;
      if (!(span.from >= 0 && span.to <= max && span.to - span.from >= (horizontal ? 150 : 100))) bad(`${k}: ${side} opening ${span.from}..${span.to} is out of range or too small`);
      const n = neighbour(level, k, side);
      if (n) {
        const back = level.rooms[n].exits[OPPOSITE[side]];
        if (!back) bad(`${k}: ${side} opening has no matching ${OPPOSITE[side]} opening in ${n}`);
        else if (!sameSpan(span, back)) bad(`${k}: ${side} opening ${span.from}..${span.to} differs from ${n}'s ${back.from}..${back.to}`);
        if (span.exit) bad(`${k}: an exit opening must not connect to ${n}`);
      } else if (span.exit) {
        exits++;
        if (side !== 'left' && side !== 'right') bad(`${k}: the level exit is on the ${side} side`);
      } else bad(`${k}: ${side} opening leads nowhere`);
    }
  }
  if (exits !== 1) bad(`expected exactly one level exit, found ${exits}`);

  // ---- the route
  const steps = traceRoute(level);
  if (steps.length !== keys.length) bad(`route visits ${steps.length} of ${keys.length} rooms`);
  const last = steps[steps.length - 1];
  if (last && !(last.to && level.rooms[last.key].exits[last.to]?.exit)) bad('the last room on the route has no exit opening');
  const io = routeIO(level);
  const dirX = io[0]?.dirX ?? 1;
  if (level.start.facing !== dirX) bad('start faces away from the exit');
  for (const r of io) {
    if (r.entry !== 'start' && r.dirX !== dirX) bad(`${r.key}: direction of progress changes`);
  }

  // ---- the start point
  if (startRoom) {
    const { x, y } = level.start;
    if (!(x >= 0 && x <= 640 && y >= 0 && y <= 360)) bad(`start (${x}, ${y}) is outside the room`);
    const fromWall = dirX > 0 ? x : 640 - x;
    if (fromWall < 36 || fromWall > 124) bad(`start is ${fromWall}px from the entry wall (want about 40..120)`);
    if (y < 118 || y > 202) bad(`start y ${y} outside 120..200`);
    for (const c of roomColliders(startRoom))
      if (x > c.x - 8 && x < c.x + c.w + 8 && y > c.y - 8 && y < c.y + c.h + 8) bad('the start point is inside furniture or a wall');
  }

  // ---- ids
  const ids = new Map<string, string>();
  for (const k of keys) {
    for (const it of level.rooms[k].items) {
      if (typeof it.id !== 'string') {
        if (it.t === 'star' || it.t === 'tape' || it.t === 'sheet') bad(`${k}: ${it.t} without an id`);
        continue;
      }
      if (ids.has(it.id)) bad(`duplicate id '${it.id}' (${ids.get(it.id)} and ${k})`);
      ids.set(it.id, k);
      const m = /^(-?\d+,-?\d+):(\w+):(\d+)$/.exec(it.id);
      if (!m || m[1] !== k || m[2] !== it.t) bad(`${k}: id '${it.id}' does not look like '${k}:${it.t}:n'`);
    }
  }

  for (const k of keys) problems.push(...validateRoom(level, k));
  return { ok: problems.length === 0, problems };
}

/** The visual extent used for bounds checks (kind-specific for runtime-only items). */
function extent(it: ItemDef) {
  if (CATALOG[it.t]) return boxOf(it);
  const { w, h } = sizeOf(it);
  if (it.t === 'star' || it.t === 'tape' || it.t === 'sheet') return { x: it.x - 9, y: it.y - 9, w: 18, h: 18 };
  if (it.t === 'switch') return { x: it.x, y: it.y, w: 10, h: 16 };
  if (it.t === 'drip') return { x: it.x - 2, y: it.y, w: 4, h: 4 };
  if (it.t === 'workbench') return { x: it.x, y: it.y - 4, w: it.w ?? 120, h: 4 };
  if (it.t === 'ceilingVent') return { x: it.x, y: 14, w: it.w ?? 48, h: 4 };
  return { x: it.x, y: it.y, w, h };
}

function validateRoom(level: LevelDef, key: string): string[] {
  const room = level.rooms[key];
  const out: string[] = [];
  const bad = (msg: string) => out.push(`${key}: ${msg}`);
  const items = room.items;

  const unknown = items.filter((i) => !CATALOG[i.t] && !RUNTIME_ONLY.has(i.t));
  for (const u of unknown) bad(`unknown item kind '${u.t}'`);

  // ---- bounds
  for (const it of items) {
    const b = extent(it);
    if (b.x < 0 || b.y < 0 || b.x + b.w > 640 || b.y + b.h > 360) bad(`${it.t} at (${it.x}, ${it.y}) leaves the room`);
  }

  // ---- floor furniture
  const floorItems = items.filter((i) => CATALOG[i.t]?.placement === 'floor');
  for (const it of floorItems) {
    const { h } = sizeOf(it);
    if (it.y + h !== LAYOUT.floor) bad(`${it.t} at x=${it.x} does not stand on the floor (bottom ${it.y + h})`);
  }
  const spans = floorItems.map((it) => {
    const boxes = (KINDS[it.t]?.colliders?.(it, room) ?? []).map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
    return { it, ...unionX(boxes.length ? boxes : [boxOf(it)]) };
  });
  const vents = items.filter((i) => i.t === 'floorVent').map((it) => ({ it, x0: it.x, x1: it.x + (it.w ?? 48) }));
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++)
      if (spans[i].x0 < spans[j].x1 && spans[j].x0 < spans[i].x1) bad(`${spans[i].it.t} and ${spans[j].it.t} overlap on the floor`);
    for (const v of vents) if (spans[i].x0 < v.x1 && v.x0 < spans[i].x1) bad(`${spans[i].it.t} stands on a floor vent`);
  }

  // ---- surface items
  for (const it of items.filter((i) => CATALOG[i.t]?.placement === 'surface')) {
    const e = CATALOG[it.t];
    const b = boxOf(it);
    const rest = it.t === 'candle' ? (typeof it.wax === 'number' ? it.wax : 18) + CANDLE.holder : (e.rest ?? 0);
    const bottom = it.y + rest;
    const host = items.find((h) => {
      const s = surfaceOf(h);
      return !!s && b.x >= s.x0 - 1 && b.x + b.w <= s.x1 + 1 && Math.abs(bottom - s.top) <= 1;
    });
    if (!host) bad(`${it.t} at (${it.x}, ${it.y}) does not stand on a table top`);
  }

  // ---- wall decor
  const wall = items.filter((i) => CATALOG[i.t]?.placement === 'wall');
  // the real solid parts of the furniture (a bed's tall headboard is not a tall bed)
  const tops = spans.flatMap((s) => {
    const cols = KINDS[s.it.t]?.colliders?.(s.it, room) ?? [];
    return cols.length ? cols.map((c) => ({ x0: c.x, x1: c.x + c.w, top: c.y })) : [{ x0: s.x0, x1: s.x1, top: s.it.y }];
  });
  for (let i = 0; i < wall.length; i++) {
    const a = boxOf(wall[i]);
    if (wall[i].t !== 'frontDoor' && wall[i].t !== 'switchPlate' && (a.y < 26 || a.y + a.h > LAYOUT.dado + 2)) bad(`${wall[i].t} at (${wall[i].x}, ${wall[i].y}) is outside the wall band`);
    for (let j = i + 1; j < wall.length; j++) if (overlaps(a, boxOf(wall[j]), 0)) bad(`${wall[i].t} overlaps ${wall[j].t}`);
    for (const t of tops) if (a.x < t.x1 + 4 && t.x0 < a.x + a.w + 4 && a.y + a.h > t.top - 5 && wall[i].t !== 'frontDoor') bad(`${wall[i].t} hangs into the top of a piece of furniture`);
    for (const it of items) {
      const breast = wallAboveOf(it);
      if (breast && overlaps(a, breast, 2)) bad(`${wall[i].t} is hidden by the chimney breast of the ${it.t}`);
    }
  }

  // ---- dark rooms and their switch
  const sw = items.filter((i) => i.t === 'switch');
  const plates = items.filter((i) => i.t === 'switchPlate');
  if (room.dark) {
    if (sw.length !== 1) bad(`dark room has ${sw.length} switches`);
    else if (!plates.some((p) => p.x === sw[0].x && p.y === sw[0].y)) bad('the switch has no switchPlate at the same position');
  } else if (sw.length) bad('light switch in a room that is not dark');

  // ---- workbench
  for (const wb of items.filter((i) => i.t === 'workbench')) {
    const desk = items.find((d) => d.t === 'desk' && d.x === wb.x && sizeOf(d).w === (wb.w ?? 0) && wb.y === d.y + 2);
    if (!desk) bad('workbench is not on a desk top');
  }
  return out;
}
