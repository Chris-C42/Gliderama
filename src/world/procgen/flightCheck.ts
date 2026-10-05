/**
 * Flight validation of a finished level, independent of how it was generated: fly the reference pilots through every
 * room, from every entry, and report. Used by the tests and the dev lab; the generator runs the same flights while
 * it builds each room.
 */

import { buildSimRoom } from '../../game/sim';
import type { LevelDef } from '../../game/level';
import type { ItemDef, RoomDef } from '../types';
import { entriesFor, flyRoom, pilotSpec } from './fly';
import { referencePlanes } from './fleet';
import { routeIO } from './route';
import { stairsArrive } from './stairsPlan';
import { entersByStairs, stairsKindOf, type FlightRun, type RoomIO } from './types';

export interface RoomFlight {
  key: string;
  ok: boolean;
  both: boolean;
  planeOk: Record<string, boolean>;
  runs: FlightRun[];
}

export interface LevelFlightReport {
  ok: boolean;
  both: boolean;
  rooms: RoomFlight[];
  ms: number;
}

function ventsOf(room: RoomDef): { cx: number; w: number; top: number }[] {
  return room.items
    .filter((i) => i.t === 'floorVent')
    .map((i) => {
      const reach = typeof i.reach === 'number' ? i.reach : 14;
      return { cx: i.x + (i.w ?? 48) / 2, w: i.w ?? 48, top: reach };
    })
    .filter((v) => v.top >= 0);
}

/** Fly one room of a level. */
export function flyLevelRoom(level: LevelDef, io: RoomIO, opts: { needBoth?: boolean } = {}): RoomFlight {
  const room = level.rooms[io.key];
  const planes = referencePlanes();
  const sim = buildSimRoom(room, { level, key: io.key });
  const vents = ventsOf(room);
  // a room left by stairs has to be flown to them; one entered by stairs is flown from where they bring the plane out
  const kind = stairsKindOf(io);
  const stairs = kind ? room.items.find((i: ItemDef) => i.t === kind) : undefined;
  const spec = pilotSpec(io, vents, { stairs });
  const sw = room.items.find((i: ItemDef) => i.t === 'switch');
  const touch = sw ? { x: sw.x - 4, y: sw.y - 4, w: 18, h: 24 } : undefined;
  const bench = room.items.find((i: ItemDef) => i.t === 'workbench');
  const benchRestart = bench ? { x: bench.x + (bench.w ?? 120) / 2, y: bench.y - 16 } : undefined;
  const arrive = stairs && entersByStairs(io) ? stairsArrive(stairs) : undefined;
  const entries = entriesFor(io, { start: io.index === 0 ? { x: level.start.x, y: level.start.y } : undefined, bench: benchRestart, arrive });
  const runs: FlightRun[] = [];
  const planeOk: Record<string, boolean> = {};
  for (const plane of planes) {
    let ok = true;
    for (const e of entries) {
      const r = flyRoom(sim, plane, spec, e, { touch: e.id === 'bench' ? undefined : touch });
      runs.push(r);
      if (!r.ok) {
        ok = false;
        break;
      }
    }
    if (ok && bench) {
      const lowEntry = entries.find((e) => e.id === 'door-lo');
      if (lowEntry) {
        const land = { x0: bench.x + 6, x1: bench.x + (bench.w ?? 120) - 6, top: bench.y };
        const r = flyRoom(sim, plane, pilotSpec(io, vents, { land, stairs }), { ...lowEntry, id: 'land' });
        runs.push(r);
        if (!r.ok) ok = false;
      }
    }
    planeOk[plane.id] = ok;
  }
  const both = planes.every((p) => planeOk[p.id]);
  const some = planes.some((p) => planeOk[p.id]);
  return { key: io.key, ok: opts.needBoth ? both : some, both, planeOk, runs };
}

/** Does every room of the level pass (with at least one reference plane, or with both if `needBoth`)? */
export function validateLevelFlight(level: LevelDef, opts: { needBoth?: boolean } = {}): LevelFlightReport {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const rooms = routeIO(level).map((io) => flyLevelRoom(level, io, opts));
  return {
    ok: rooms.every((r) => r.ok),
    both: rooms.every((r) => r.both),
    rooms,
    ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
  };
}
