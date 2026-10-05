/**
 * Challenge rooms: small, single-purpose puzzles in the Paper Lab. Each one asks a specific thing of
 * a design (see modes/challenges.ts for goals, limits and star tiers). Room px, floor at y = 340.
 */

import type { LevelDef } from '../../game/level';
import type { ItemDef, RoomDef, WallStyle } from '../types';

const LAB_WALL: WallStyle = { pattern: 'corrugated', base: 'stone', accent: 'steel', wainscot: null, trim: 'steel' };

function lab(id: string, name: string, items: ItemDef[], o: { exits?: RoomDef['exits']; wall?: Partial<WallStyle>; seed?: number; dark?: boolean } = {}): RoomDef {
  return {
    id: `ch-${id}`,
    name,
    wall: { ...LAB_WALL, ...o.wall },
    floor: { kind: 'concrete', ramp: 'stone' },
    exits: o.exits ?? {},
    dark: o.dark,
    seed: o.seed ?? 700,
    items: [{ t: 'hazardStripe', x: 0, y: 0 }, ...items],
  };
}

/** Launch platform: the plane sits 24 px above its deck, 36 px in. */
const launcher = (x: number, y: number): ItemDef => ({ t: 'launcher', x, y });
const fromLauncher = (x: number, y: number, room = '0,0') => ({ room, x: x + 36, y: y - 24, facing: 1 as const });
const mat = (id: string, x: number, w = 100): ItemDef[] => [
  { t: 'targetMat', id: `${id}-mat`, x, y: 330, w },
  { t: 'target', id, x, y: 330, w },
];
const hoop = (id: string, x: number, y: number, r = 26): ItemDef => ({ t: 'hoop', id, x, y, r });
const windows = (...xs: number[]): ItemDef[] => xs.map((x) => ({ t: 'hangarWindow', x, y: 74, w: 150, h: 70 }));

function level(id: string, name: string, rooms: Record<string, RoomDef>, start: LevelDef['start'], intro: string): LevelDef {
  return { id: `challenge-${id}`, name, place: 'lab', rooms, start, sheets: 99, par: 0, intro };
}

// ---------------------------------------------------------------------------------------------

/** Land on the mat tucked in behind a crate. */
export function binIt(): LevelDef {
  return level(
    'bin-it',
    'Bin It',
    {
      '0,0': lab('bin-it', 'Paper Lab · Drop Zone', [
        ...windows(110, 400),
        launcher(40, 200),
        { t: 'block', x: 300, y: 232, w: 44, h: 108 },
        ...mat('bin-it', 376, 130),
        { t: 'baySign', x: 560, y: 176, label: 'BIN' },
      ]),
    },
    fromLauncher(40, 200),
    'Land on the target behind the crate.',
  );
}

/** Three hoops in a single flight. */
export function threadTheNeedle(): LevelDef {
  return level(
    'needle',
    'Thread the Needle',
    {
      '0,0': lab(
        'needle',
        'Paper Lab · Hoop Range',
        [...windows(110, 400), launcher(40, 160), hoop('h1', 230, 156), hoop('h2', 360, 178), hoop('h3', 490, 206)],
        { wall: { base: 'sky', accent: 'navy' }, seed: 711 },
      ),
    },
    fromLauncher(40, 160),
    'Fly through all three hoops in one flight.',
  );
}

/** Distance: a 20 m hall with gentle radiator thermals. */
export function longHall(): LevelDef {
  const rooms: Record<string, RoomDef> = {};
  const start = fromLauncher(30, 110);
  for (let i = 0; i < 4; i++) {
    // the markers count metres from the launch point, as the distance goal does
    const items: ItemDef[] = [...windows(110, 400), { t: 'markers', x: 0, y: 0, startM: i * 5, offset: -start.x }];
    if (i === 0) items.push(launcher(30, 110));
    if (i === 1 || i === 2) items.push({ t: 'radiator', x: 270, y: 284, w: 110 });
    rooms[`${i},0`] = lab(`hall-${i}`, `Paper Lab · Long Hall ${i + 1}`, items, {
      exits: { left: i > 0 ? { from: 16, to: 340 } : undefined, right: i < 3 ? { from: 16, to: 340 } : undefined },
      wall: { base: 'moss', accent: 'leaf' },
      seed: 720 + i,
    });
  }
  return level('long-hall', 'Long Hall', rooms, start, 'Glide as far down the hall as you can.');
}

/** Endurance: stay up over two vents. */
export function hangTime(): LevelDef {
  return level(
    'hang-time',
    'Hang Time',
    {
      '0,0': lab(
        'hang-time',
        'Paper Lab · Updraft Room',
        [
          ...windows(110, 400),
          launcher(14, 226),
          { t: 'floorVent', x: 170, y: 330, w: 50, power: 3 },
          { t: 'floorVent', x: 420, y: 330, w: 50, power: 3 },
          { t: 'baySign', x: 290, y: 176, label: 'HOVER' },
        ],
        { wall: { base: 'plum', accent: 'rose' }, seed: 731 },
      ),
    },
    fromLauncher(14, 226),
    'Stay in the air: turn back over the vents to climb.',
  );
}

/** Headwind: a big fan guards the exit. */
export function galeForce(): LevelDef {
  return level(
    'gale',
    'Gale Force',
    {
      '0,0': lab(
        'gale',
        'Paper Lab · Wind Tunnel',
        [
          ...windows(110, 380),
          launcher(30, 200),
          { t: 'fan', x: 470, y: 150, stand: 158, dir: -1, power: 5.2, reach: 460 },
          { t: 'exit', x: 600, y: 40, w: 40, h: 300 },
          { t: 'baySign', x: 556, y: 230, label: 'EXIT' },
        ],
        { exits: { right: { from: 40, to: 340, exit: true } }, wall: { base: 'navy', accent: 'sky' }, seed: 741 },
      ),
    },
    fromLauncher(30, 200),
    'Punch through the fan to the exit.',
  );
}

/** Fold budget: three folds, two rooms. */
export function minimalist(): LevelDef {
  return level(
    'minimalist',
    'Minimalist',
    {
      '0,0': lab('min-0', 'Paper Lab · Plain Room', [...windows(110, 400), launcher(30, 130)], { exits: { right: { from: 16, to: 340 } }, seed: 751 }),
      '1,0': lab(
        'min-1',
        'Paper Lab · Plain Room 2',
        [...windows(110, 400), { t: 'radiator', x: 200, y: 284, w: 110 }, { t: 'exit', x: 600, y: 40, w: 40, h: 300 }, { t: 'baySign', x: 556, y: 230, label: 'EXIT' }],
        { exits: { left: { from: 16, to: 340 }, right: { from: 40, to: 340, exit: true } }, seed: 752 },
      ),
    },
    fromLauncher(30, 130),
    'Reach the exit with a plane of three folds or fewer.',
  );
}

/** Hazards: a row of candles under a low shelf. */
export function hotStuff(): LevelDef {
  const items: ItemDef[] = [...windows(110, 400), launcher(30, 200), { t: 'shelf', x: 170, y: 150, w: 360 }];
  for (const x of [190, 310, 430]) {
    items.push({ t: 'sideTable', x, y: 256, v: 1 }, { t: 'candle', x: x + 30, y: 232, wax: 18 });
  }
  items.push({ t: 'exit', x: 600, y: 40, w: 40, h: 300 }, { t: 'baySign', x: 556, y: 286, label: 'EXIT' });
  return level(
    'hot-stuff',
    'Hot Stuff',
    { '0,0': lab('hot-stuff', 'Paper Lab · Candle Run', items, { exits: { right: { from: 40, to: 340, exit: true } }, wall: { base: 'red', accent: 'peach' }, seed: 761 }) },
    fromLauncher(30, 200),
    'Slip between the shelf and the flames.',
  );
}

/** Square paper: land on a small mat under a low ceiling. */
export function squareDeal(): LevelDef {
  return level(
    'square-deal',
    'Square Deal',
    {
      '0,0': lab(
        'square-deal',
        'Paper Lab · Low Bay',
        [...windows(110, 400), launcher(30, 200), { t: 'block', x: 300, y: 150, w: 340, h: 26 }, ...mat('square-deal', 470, 80)],
        { wall: { base: 'teal', accent: 'moss' }, seed: 771 },
      ),
    },
    fromLauncher(30, 200),
    'Origami squares only. Land on the mat under the low ceiling.',
  );
}

/** Tissue paper: no air movers at all; float down from the top shelf for as long as you can. */
export function featherweight(): LevelDef {
  return level(
    'feather',
    'Featherweight',
    {
      '0,0': lab(
        'feather',
        'Paper Lab · Still Room',
        [...windows(150, 400), { t: 'shelf', x: 12, y: 84, w: 110 }, { t: 'baySign', x: 290, y: 176, label: 'FLOAT' }],
        { wall: { base: 'cream', accent: 'mustard' }, seed: 781 },
      ),
    },
    { room: '0,0', x: 64, y: 62, facing: 1 },
    'Tissue only, and not a breath of air. Float down from the top shelf as slowly as you can.',
  );
}

/** Agility: the exit is behind you. */
export function aboutFace(): LevelDef {
  return level(
    'about-face',
    'About Face',
    {
      '0,0': lab(
        'about-face',
        'Paper Lab · Dead End',
        [...windows(110, 400), { t: 'shelf', x: 170, y: 200, w: 100 }, { t: 'exit', x: 0, y: 210, w: 30, h: 130 }, { t: 'baySign', x: 470, y: 176, label: 'TURN!' }, { t: 'baySign', x: 30, y: 176, label: '< EXIT' }],
        { exits: { left: { from: 210, to: 340, exit: true } }, wall: { base: 'mustard', accent: 'brass' }, seed: 791 },
      ),
    },
    { room: '0,0', x: 206, y: 176, facing: 1 },
    'The exit is behind you: turn around and fly under the shelf.',
  );
}
