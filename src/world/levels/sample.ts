import type { RoomDef } from '../types';
import type { LevelDef } from '../../game/level';

/** The kid's bedroom: the very first room of the game. */
export const BEDROOM: RoomDef = {
  id: 'home-bedroom',
  name: "Kid's Bedroom",
  wall: { pattern: 'planes', base: 'sky', accent: 'navy', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  exits: { right: { from: 70, to: 340 } },
  seed: 11,
  items: [
    { t: 'rug', x: 236, y: 326, w: 210, v: 1 },
    { t: 'poster', x: 70, y: 66, v: 0 },
    { t: 'frame', x: 470, y: 92, v: 0 },
    { t: 'wallClock', x: 412, y: 66 },
    { t: 'window', x: 262, y: 56, v: 0 },
    { t: 'switchPlate', x: 604, y: 182 },
    { t: 'pendant', x: 196, y: 0, len: 40 },
    { t: 'bed', x: 18, y: 210, v: 0 },
    { t: 'nightstand', x: 252, y: 274 },
    { t: 'floorVent', x: 336, y: 330, w: 52 },
    { t: 'chair', x: 404, y: 224, flip: true },
    { t: 'desk', x: 446, y: 242 },
    { t: 'books', x: 452, y: 242, n: 3 },
    { t: 'pencils', x: 488, y: 242 },
    { t: 'deskLamp', x: 562, y: 194, v: 1 },
    { t: 'star', x: 362, y: 120 },
    { t: 'star', x: 520, y: 60 },
  ],
};

export const HALL: RoomDef = {
  id: 'home-hall',
  name: 'Upstairs Hall',
  wall: { pattern: 'damask', base: 'mustard', accent: 'oak', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'walnut' },
  exits: { left: { from: 70, to: 340 }, right: { from: 96, to: 330, exit: true } },
  seed: 23,
  items: [
    { t: 'frame', x: 90, y: 70, v: 1, w: 70, h: 54 },
    { t: 'frame', x: 380, y: 60, v: 2, w: 48, h: 60 },
    { t: 'pendant', x: 300, y: 0, len: 50, v: 2 },
    { t: 'sideTable', x: 120, y: 256, v: 0 },
    { t: 'candle', x: 150, y: 232, wax: 18 },
    { t: 'floorVent', x: 250, y: 330, w: 56, power: 3.0 },
    { t: 'fan', x: 470, y: 214, dir: -1, stand: 30, power: 2.2 },
    { t: 'sideTable', x: 440, y: 276, w: 80, h: 64, v: 1 },
    { t: 'frontDoor', x: 548, y: 104, w: 80, h: 226 },
    { t: 'drip', x: 330, y: 20, every: 1.2 },
    { t: 'star', x: 278, y: 90 },
    { t: 'star', x: 420, y: 160 },
    { t: 'tape', x: 200, y: 180 },
  ],
};

export const SAMPLE_LEVEL: LevelDef = {
  id: 'sample',
  name: 'Test Flight',
  place: 'home',
  rooms: { '0,0': BEDROOM, '1,0': HALL },
  start: { room: '0,0', x: 560, y: 150, facing: -1 },
  sheets: 5,
  par: 40,
  intro: 'Drag back and release to throw!',
};
