/** A two-room level for looking at Glider PRO's enemies and hazards in the play lab (`/play.html?menagerie`). */

import type { LevelDef } from '../game/level';
import type { RoomDef } from '../world/types';

const AIRBORNE: RoomDef = {
  id: 'lab-airborne',
  name: 'Things in the Air',
  wall: { pattern: 'pinstripe', base: 'cream', accent: 'stone', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  exits: { right: { from: 70, to: 340 } },
  seed: 5,
  items: [
    { t: 'window', x: 262, y: 56, v: 0 },
    { t: 'floorVent', x: 100, y: 330, w: 56 },
    { t: 'balloon', x: 210, y: 340, delay: 0.5, v: 0 },
    { t: 'balloon', x: 300, y: 340, delay: 1.6, v: 1 },
    { t: 'balloon', x: 390, y: 340, delay: 2.7, v: 2 },
    { t: 'copter', x: 560, y: 16, dir: -1, delay: 1 },
    { t: 'dart', x: 550, y: 70, dir: -1, delay: 1.5 },
    { t: 'ball', x: 480, y: 340, height: 140, v: 0 },
    { t: 'bands', x: 150, y: 150 },
  ],
};

const INDOORS: RoomDef = {
  id: 'lab-indoors',
  name: 'Household Hazards',
  wall: { pattern: 'damask', base: 'mustard', accent: 'oak', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'walnut' },
  exits: { left: { from: 70, to: 340 }, right: { from: 96, to: 330, exit: true } },
  seed: 9,
  items: [
    { t: 'cobweb', x: 12, y: 14, w: 76, h: 54 },
    { t: 'outlet', x: 300, y: 250, delay: 2 },
    { t: 'sideTable', x: 120, y: 256, v: 0 },
    { t: 'fish', x: 146, y: 220, height: 130, delay: 2 },
    { t: 'desk', x: 400, y: 242 },
    { t: 'shredder', x: 420, y: 218 },
    { t: 'floorVent', x: 260, y: 330, w: 56 },
    { t: 'star', x: 330, y: 120 },
  ],
};

export const MENAGERIE: LevelDef = {
  id: 'lab-menagerie',
  name: 'Menagerie',
  place: 'home',
  rooms: { '0,0': AIRBORNE, '1,0': INDOORS },
  start: { room: '0,0', x: 60, y: 120, facing: 1 },
  sheets: 9,
  par: 60,
};
