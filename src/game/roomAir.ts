/**
 * Air that crosses a ceiling or floor opening carries on in the room beyond it. A vent whose column
 * rises out of the top of its room keeps lifting the plane in the room above, inside the opening, so
 * climbing a stairwell is one continuous current rather than a wall of still air at the boundary.
 * Shared by the live Session and the headless simulator, so level validation flies the same air.
 */

import type { AirFlow, AirPoint } from '../render/airLines';
import { ROOM_H } from '../physics/config';
import type { ExitSpan, RoomDef } from '../world/types';
import { neighbour, type LevelDef } from './level';
import { OBJECTS } from './objects';
import type { GameObject, ObjCtx, WindOut } from './objects/types';

export interface Spill {
  /** The neighbouring room's air movers, built headless. */
  objects: GameObject[];
  /** This room's y + `dy` = the same point in the neighbour's coordinates. */
  dy: number;
  /** The opening in this room the air comes through (x range). */
  span: ExitSpan;
}

/** The air reaching this room through its floor and ceiling openings. */
export function spillsFor(level: Pick<LevelDef, 'rooms'>, key: string): Spill[] {
  const def = level.rooms[key];
  if (!def) return [];
  const out: Spill[] = [];
  for (const side of ['down', 'up'] as const) {
    const span = def.exits[side];
    if (!span) continue;
    const k = neighbour(level as LevelDef, key, side);
    if (!k) continue;
    const other = level.rooms[k];
    if (!other.exits[side === 'down' ? 'up' : 'down']) continue;
    const objects = airMovers(other, k);
    if (objects.length) out.push({ objects, dy: side === 'down' ? -ROOM_H : ROOM_H, span });
  }
  return out;
}

function airMovers(def: RoomDef, key: string): GameObject[] {
  const out: GameObject[] = [];
  let i = 0;
  for (const it of def.items) {
    const f = OBJECTS[it.t];
    if (!f) continue;
    const o = f(it, `${key}:spill:${it.t}:${i++}`, null, { dark: !!def.dark, night: !!def.night });
    if (o.wind) out.push(o);
    else o.dispose?.();
  }
  return out;
}

/** How far past each side of the opening the air has spread, `d` px beyond it (it widens as it leaves the hole). */
export const SPILL_SPREAD = 0.3;

/** The x range the air coming through an opening covers at room y. */
export function spillRange(s: Spill, y: number): { x0: number; x1: number } {
  const d = s.dy < 0 ? Math.max(0, ROOM_H - y) : Math.max(0, y);
  return { x0: s.span.from - d * SPILL_SPREAD, x1: s.span.to + d * SPILL_SPREAD };
}

/** Add the air coming through the openings at room pixel (x, y). */
export function spillWind(spills: Spill[], x: number, y: number, out: WindOut): void {
  for (const s of spills) {
    const r = spillRange(s, y);
    if (x < r.x0 || x > r.x1) continue;
    for (const o of s.objects) o.wind!(x, y + s.dy, out);
  }
}

/** Keep switch-driven air movers in step (a fan on a switch in the room below). */
export function updateSpills(spills: Spill[], ctx: ObjCtx): void {
  const quiet: ObjCtx = { ...ctx, particles: { spawn() {} } };
  for (const s of spills) for (const o of s.objects) o.update?.(quiet);
}

/** The neighbours' air lines, carried across the openings: the part of each line inside this room. */
export function spillFlows(spills: Spill[]): AirFlow[] {
  const out: AirFlow[] = [];
  for (const s of spills) {
    for (const o of s.objects) {
      for (const f of o.airflow?.() ?? []) {
        const lines: AirPoint[][] = [];
        for (const line of f.lines) {
          const clipped = clipToRoom(line.map((p) => ({ x: p.x, y: p.y - s.dy })));
          if (clipped && clipped[0].x >= s.span.from && clipped[0].x <= s.span.to) lines.push(clipped);
        }
        if (lines.length) out.push({ ...f, lines });
      }
    }
  }
  return out;
}

/** A room's own air lines, cut to the room (currents may run on past its floor or ceiling). */
export function clipFlows(flows: AirFlow[]): AirFlow[] {
  const out: AirFlow[] = [];
  for (const f of flows) {
    const lines = f.lines.map(clipToRoom).filter((l): l is AirPoint[] => !!l);
    if (lines.length) out.push({ ...f, lines });
  }
  return out;
}

/** The part of a straight two-point line between y = 0 and y = ROOM_H, or null when none of it is. */
function clipToRoom(line: AirPoint[]): AirPoint[] | null {
  const a = line[0];
  const b = line[line.length - 1];
  const at = (y: number): AirPoint => {
    const t = (y - a.y) / (b.y - a.y);
    return { x: a.x + (b.x - a.x) * t, y };
  };
  const inside = (p: AirPoint) => p.y >= 0 && p.y <= ROOM_H;
  if (a.y === b.y) return inside(a) ? [a, b] : null;
  const lo = Math.min(a.y, b.y);
  const hi = Math.max(a.y, b.y);
  if (hi < 0 || lo > ROOM_H) return null;
  const p = inside(a) ? a : at(a.y < 0 ? 0 : ROOM_H);
  const q = inside(b) ? b : at(b.y < 0 ? 0 : ROOM_H);
  return Math.hypot(q.x - p.x, q.y - p.y) > 8 ? [p, q] : null;
}
