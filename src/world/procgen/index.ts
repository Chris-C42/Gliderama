/**
 * Procedural houses for the endless roguelike ("Paper Trail") and the Daily Flight.
 *
 *   generateFloor({ seed, floor, theme, twist?, rooms?, workbenchRoom? })  ->  LevelDef
 *
 * Deterministic: the same options give a deep-equal level (all randomness is forked from `createRng(seed)`).
 * Every room is validated by flying two reference paper planes (glider, dart) through it with a small autopilot in the
 * headless simulator.
 *
 * How a room is made (`room.ts` drives it):
 *   layout.ts      the route of rooms on the grid and the openings between them
 *   air.ts         the lift the altitude budget needs: vents, stairwell holes, fans
 *   pilot.ts       the autopilot; fly.ts: entry points and pass criteria; fleet.ts: the reference planes
 *   dress.ts       furniture, decor and hazards, placed through scene.ts around the corridor the flights measured
 *                  (templates and looks in themes.ts, sizes and placement rules in catalog.ts)
 *   validate.ts    structural checks of a finished level; flightCheck.ts: the same flights, run on any level
 */

import { createRng, dailySeed, type Rng } from '../../core/rng';
import type { LevelDef } from '../../game/level';
import { buildRoom } from './room';
import { planRoute } from './layout';
import { THEMES, THEME_ROTATION, type RoomTemplate, type ThemeDef } from './themes';
import {
  TWIST_IDS,
  type FloorOptions,
  type FloorReport,
  type GeneratedFloor,
  type RoomIO,
  type RoomReport,
  type ThemeId,
  type TwistId,
} from './types';

export { TWIST_IDS } from './types';
export type { FloorOptions, ThemeId, TwistId, GeneratedFloor, FloorReport, RoomReport } from './types';
export { validateLevel } from './validate';
export { validateLevelFlight, type LevelFlightReport } from './flightCheck';

/** Themes rotate every two floors. */
export function themeForFloor(floor: number): ThemeId {
  const f = Math.max(0, Math.floor(floor));
  return THEME_ROTATION[Math.floor(f / 2) % THEME_ROTATION.length];
}

/** The Daily Flight: same house for everyone on a given date key ('YYYY-MM-DD'), with a twist. */
export function dailyOptions(dateKey: string): FloorOptions & { twist: TwistId } {
  const seed = dailySeed(dateKey);
  const rng = createRng(seed).fork('daily');
  const twists = TWIST_IDS.filter((t) => t !== 'none');
  return {
    seed,
    floor: rng.int(2, 5),
    theme: rng.pick(THEME_ROTATION),
    rooms: 8,
    twist: rng.pick(twists),
    workbenchRoom: false,
  };
}

function pickTemplates(theme: ThemeDef, route: RoomIO[], workbench: boolean, rng: Rng): RoomTemplate[] {
  const out: RoomTemplate[] = [];
  const byId = (id: string) => theme.templates.find((t) => t.id === id)!;
  for (const io of route) {
    const last = io.index === io.count - 1;
    const vertical = io.entry === 'up' || io.entry === 'down' || io.exit === 'up' || io.exit === 'down';
    const prev = out[out.length - 1];
    const weighted = theme.templates
      .filter((t) => {
        if (workbench && last) return t.id === 'study' || t.id === 'kids';
        if (io.index === 0) return t.id === 'bedroom' || t.id === 'kids' || t.id === 'study';
        return true;
      })
      .map((t) => {
        let w = t.weight;
        if (prev && prev.id === t.id) w *= 0.15;
        if (vertical) w *= t.id === 'landing' ? 6 : t.id === 'hall' ? 1.5 : 0.5;
        else if (t.id === 'landing') w *= 0.25;
        return { item: t, w };
      });
    out.push(weighted.length ? rng.weighted(weighted) : byId('hall'));
  }
  return out;
}

export function generateFloorWithReport(opts: FloorOptions): GeneratedFloor {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const twist: TwistId = opts.twist ?? 'none';
  const theme = THEMES[opts.theme];
  const floor = Math.max(0, Math.floor(opts.floor));
  const root = createRng(opts.seed).fork(`floor-${floor}-${opts.theme}`);
  const workbench = !!opts.workbenchRoom;
  const count = Math.max(workbench ? 3 : 2, opts.rooms ?? 6 + root.fork('count').int(0, 2) + (workbench ? 1 : 0));

  const route = planRoute(root.fork('layout'), { count, floor });
  const templates = pickTemplates(theme, route, workbench, root.fork('templates'));
  const levelId = `${opts.theme}-s${opts.seed}-f${floor}`;

  const rooms: LevelDef['rooms'] = {};
  const ctx = { difficulty: { floor, twist }, workbench, rooms };
  const reports: RoomReport[] = [];
  let start: LevelDef['start'] | undefined;
  for (const io of route) {
    const template = templates[io.index];
    const rr = root.fork(`room-${io.index}`);
    const name = rr.fork('name').pick(template.names);
    const built = buildRoom(ctx, io, template, name, `${opts.theme}-${template.id}-${io.index}`, rr);
    rooms[io.key] = built.def;
    reports.push(built.report);
    if (built.start) start = { room: io.key, x: built.start.x, y: built.start.y, facing: built.start.facing };
  }
  if (!start) throw new Error('procgen: the first room produced no start point');

  const level: LevelDef = {
    id: levelId,
    name: `${theme.name}, floor ${floor + 1}`,
    place: theme.place,
    rooms,
    start,
    sheets: Math.max(3, Math.min(5, 5 - Math.floor(floor / 2))),
    par: count * 9,
    intro: floor === 0 ? 'Drag back and release to throw!' : `${theme.name}, floor ${floor + 1}. Find the way out!`,
  };
  if (twist !== 'none') level.twist = twist;
  const report: FloorReport = { rooms: reports, ms: typeof performance !== 'undefined' ? performance.now() - t0 : 0 };
  return { level, report };
}

export function generateFloor(opts: FloorOptions): LevelDef {
  return generateFloorWithReport(opts).level;
}
