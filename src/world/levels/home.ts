/** Campaign place 1: Home. Hand-built levels (room pixels, floor at y = 340). */

import type { LevelDef } from '../../game/level';
import type { CampaignLevel } from '../campaign';
import type { RoomDef } from '../types';

const star = (room: string, n: number, x: number, y: number) => ({ t: 'star', id: `${room}:star:${n}`, x, y });

// ---------------------------------------------------------------------------------------------
// Level 1 — Bedtime Launch: throw, glide, ride a vent, collect stars, find the door.

const L1_BEDROOM: RoomDef = {
  id: 'l1-bedroom',
  name: "Kid's Bedroom",
  wall: { pattern: 'planes', base: 'sky', accent: 'navy', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  exits: { right: { from: 70, to: 340 } },
  seed: 11,
  items: [
    { t: 'rug', x: 232, y: 326, w: 150, v: 1 },
    { t: 'wallClock', x: 150, y: 74 },
    { t: 'window', x: 236, y: 56, v: 0 },
    { t: 'poster', x: 412, y: 66, v: 0 },
    { t: 'frame', x: 506, y: 92, v: 0 },
    { t: 'pendant', x: 384, y: 0, len: 30 },
    { t: 'desk', x: 26, y: 242 },
    { t: 'books', x: 32, y: 242, n: 3 },
    { t: 'pencils', x: 70, y: 242 },
    { t: 'deskLamp', x: 140, y: 194, v: 1 },
    { t: 'floorVent', x: 238, y: 330, w: 56, power: 3.4 },
    { t: 'nightstand', x: 316, y: 274 },
    { t: 'bed', x: 380, y: 210, w: 200, v: 0 },
    { t: 'switch', x: 606, y: 182 },
    star('l1a', 0, 266, 118),
    star('l1a', 1, 470, 168),
    star('l1a', 2, 560, 62),
  ],
};

const L1_HALL: RoomDef = {
  id: 'l1-hall',
  name: 'Upstairs Hall',
  wall: { pattern: 'damask', base: 'mustard', accent: 'oak', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'walnut' },
  exits: { left: { from: 70, to: 340 }, right: { from: 80, to: 340, exit: true } },
  seed: 23,
  items: [
    { t: 'frame', x: 92, y: 70, v: 1, w: 70, h: 54 },
    { t: 'frame', x: 388, y: 64, v: 2, w: 48, h: 60 },
    { t: 'shelf', x: 470, y: 120, w: 100 },
    { t: 'pendant', x: 300, y: 0, len: 46, v: 2 },
    { t: 'sideTable', x: 112, y: 256, v: 0 },
    { t: 'candle', x: 142, y: 232, wax: 18 },
    { t: 'floorVent', x: 250, y: 330, w: 56 },
    { t: 'drip', x: 340, y: 18, every: 1.4 },
    { t: 'plant', x: 410, y: 314, tall: 46, v: 1 },
    { t: 'radiator', x: 470, y: 284 },
    { t: 'exit', x: 600, y: 80, w: 40, h: 260 },
    star('l1b', 0, 280, 92),
    star('l1b', 1, 420, 168),
    star('l1b', 2, 560, 216),
    { t: 'tape', id: 'l1b:tape', x: 196, y: 176 },
  ],
};

export function level1(): LevelDef {
  return {
    id: 'home-1',
    name: 'Bedtime Launch',
    place: 'home',
    rooms: { '0,0': L1_BEDROOM, '1,0': L1_HALL },
    start: { room: '0,0', x: 112, y: 170, facing: 1 },
    sheets: 6,
    par: 26,
    intro: 'Drag back from the plane and let go to throw!',
  };
}

// ---------------------------------------------------------------------------------------------
// Level 2 — Lights Out: a dark study (find the switch), then ride the landing vent up to the attic.

const L2_STUDY: RoomDef = {
  id: 'l2-study',
  name: "Dad's Study",
  wall: { pattern: 'plaid', base: 'moss', accent: 'teal', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'carpet', ramp: 'plum' },
  dark: true,
  night: true,
  exits: { right: { from: 70, to: 340 } },
  seed: 31,
  items: [
    { t: 'window', x: 256, y: 56, v: 1 },
    { t: 'frame', x: 470, y: 80, v: 1 },
    { t: 'bookshelf', x: 20, y: 126 },
    { t: 'switch', x: 160, y: 150 },
    { t: 'floorVent', x: 180, y: 330, w: 52 },
    { t: 'chair', x: 380, y: 224, flip: true, v: 1 },
    { t: 'desk', x: 424, y: 242, v: 1 },
    { t: 'books', x: 430, y: 242, n: 4, v: 2 },
    { t: 'deskLamp', x: 540, y: 194, v: 0 },
    { t: 'pendant', x: 330, y: 0, len: 40, v: 0 },
    star('l2a', 0, 168, 104),
    star('l2a', 1, 320, 210),
    star('l2a', 2, 520, 150),
  ],
};

const L2_LANDING: RoomDef = {
  id: 'l2-landing',
  name: 'The Landing',
  wall: { pattern: 'stripes', base: 'rose', accent: 'plum', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  night: true,
  exits: { left: { from: 70, to: 340 }, up: { from: 380, to: 470 } },
  seed: 41,
  items: [
    { t: 'frame', x: 120, y: 80, v: 2, w: 54, h: 66 },
    { t: 'wallClock', x: 260, y: 90 },
    { t: 'banister', x: 40, y: 272, w: 230, h: 68 },
    { t: 'plant', x: 300, y: 314, tall: 56, v: 2 },
    { t: 'floorVent', x: 394, y: 330, w: 62, power: 4.4, reach: -60 },
    { t: 'radiator', x: 520, y: 284, w: 80 },
    star('l2b', 0, 425, 250),
    star('l2b', 1, 425, 150),
    star('l2b', 2, 425, 60),
  ],
};

const L2_ATTIC: RoomDef = {
  id: 'l2-attic',
  name: 'The Attic',
  wall: { pattern: 'boards', base: 'pine', accent: 'oak', wainscot: null, trim: 'oak' },
  floor: { kind: 'planks', ramp: 'pine' },
  night: true,
  exits: { down: { from: 380, to: 470 }, right: { from: 70, to: 220, exit: true } },
  seed: 53,
  items: [
    { t: 'window', x: 150, y: 70, v: 2, w: 90, h: 90 },
    { t: 'poster', x: 300, y: 60, v: 1 },
    { t: 'toyBox', x: 40, y: 286 },
    { t: 'shelf', x: 480, y: 250, w: 120 },
    { t: 'ceilingVent', x: 300, y: 0, w: 48 },
    { t: 'drip', x: 250, y: 20, every: 1.8 },
    // warm air keeps rising out of the stairwell
    { t: 'draft', x: 376, y: 372, w: 98, top: 96, power: 3.2 },
    { t: 'exit', x: 604, y: 70, w: 36, h: 150 },
    star('l2c', 0, 520, 120),
    star('l2c', 1, 200, 220),
    { t: 'sheet', id: 'l2c:sheet', x: 90, y: 200 },
  ],
};

export function level2(): LevelDef {
  return {
    id: 'home-2',
    name: 'Lights Out',
    place: 'home',
    rooms: { '0,0': L2_STUDY, '1,0': L2_LANDING, '1,-1': L2_ATTIC },
    start: { room: '0,0', x: 84, y: 106, facing: 1 },
    sheets: 6,
    par: 40,
    intro: 'Pitch black! Fly into the light switch.',
  };
}

// ---------------------------------------------------------------------------------------------
// Level 3 — Splash Zone: drips soak paper (heavy!), candles set it alight, fans push back.

const L3_BATH: RoomDef = {
  id: 'l3-bath',
  name: 'Bathroom',
  wall: { pattern: 'tile', base: 'teal', accent: 'stone', wainscot: null, trim: 'cream' },
  floor: { kind: 'checker', ramp: 'stone', accent: 'navy' },
  exits: { right: { from: 70, to: 340 } },
  seed: 61,
  items: [
    { t: 'towelRail', x: 70, y: 120, v: 0 },
    { t: 'radiator', x: 30, y: 284, w: 80 },
    { t: 'sink', x: 190, y: 252 },
    { t: 'drip', x: 220, y: 246, every: 0.9, floorY: 252 },
    { t: 'floorVent', x: 290, y: 330, w: 52 },
    { t: 'bathtub', x: 380, y: 270, w: 200 },
    { t: 'drip', x: 470, y: 18, every: 1.1, floorY: 274 },
    { t: 'shelf', x: 400, y: 130, w: 120 },
    { t: 'pendant', x: 300, y: 0, len: 30, v: 2 },
    star('l3a', 0, 316, 120),
    star('l3a', 1, 470, 210),
    star('l3a', 2, 590, 120),
    { t: 'tape', id: 'l3a:tape', x: 140, y: 80 },
  ],
};

const L3_HALL: RoomDef = {
  id: 'l3-hall',
  name: 'Back Hall',
  wall: { pattern: 'diamonds', base: 'cream', accent: 'red', wainscot: 'oak', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  exits: { left: { from: 70, to: 340 }, right: { from: 80, to: 340, exit: true } },
  seed: 71,
  items: [
    { t: 'frame', x: 70, y: 70, v: 0, w: 60, h: 46 },
    { t: 'frame', x: 360, y: 64, v: 1, w: 66, h: 52 },
    { t: 'sideTable', x: 140, y: 256, v: 1 },
    { t: 'candle', x: 160, y: 232, wax: 18 },
    { t: 'candle', x: 196, y: 236, wax: 14 },
    { t: 'floorVent', x: 270, y: 330, w: 56 },
    { t: 'sideTable', x: 430, y: 276, w: 80, h: 64, v: 0 },
    { t: 'fan', x: 460, y: 214, dir: -1, stand: 30, power: 2.4 },
    { t: 'plant', x: 560, y: 314, tall: 40, v: 0 },
    { t: 'exit', x: 600, y: 80, w: 40, h: 260 },
    star('l3b', 0, 300, 100),
    star('l3b', 1, 400, 180),
    star('l3b', 2, 560, 120),
  ],
};

export function level3(): LevelDef {
  return {
    id: 'home-3',
    name: 'Splash Zone',
    place: 'home',
    rooms: { '0,0': L3_BATH, '1,0': L3_HALL },
    start: { room: '0,0', x: 110, y: 160, facing: 1 },
    sheets: 5,
    par: 30,
    intro: 'Wet paper gets heavy. Dodge the drips!',
  };
}

export const HOME_LEVELS: CampaignLevel[] = [
  {
    id: 'home-1',
    name: 'Bedtime Launch',
    blurb: 'Out of the bedroom, along the hall.',
    build: level1,
    unlocks: [
      { kind: 'recipes', id: 'nakamura', label: 'Nakamura Lock recipe' },
      { kind: 'folds', id: 'winglets', label: 'Winglets' },
      { kind: 'cosmetics', id: 'dots', label: 'Polka-dot print' },
    ],
  },
  {
    id: 'home-2',
    name: 'Lights Out',
    blurb: 'A dark study and a vent up to the attic.',
    build: level2,
    unlocks: [
      { kind: 'folds', id: 'mountain', label: 'Mountain folds' },
      { kind: 'folds', id: 'flap', label: 'Top-flap folds' },
      { kind: 'papers', id: 'square', label: 'Square paper' },
      { kind: 'papers', id: 'origami', label: 'Origami stock' },
      { kind: 'recipes', id: 'square', label: 'Square Glider recipe' },
      { kind: 'cosmetics', id: 'stars', label: 'Starry print' },
    ],
  },
  {
    id: 'home-3',
    name: 'Splash Zone',
    blurb: 'Drips, candles and a headwind.',
    build: level3,
    unlocks: [
      { kind: 'folds', id: 'wax', label: 'Wax coating' },
      { kind: 'folds', id: 'tape', label: 'Tape reinforcement' },
      { kind: 'papers', id: 'tissue', label: 'Tissue paper' },
      { kind: 'papers', id: 'cardstock', label: 'Cardstock' },
      { kind: 'recipes', id: 'delta', label: 'Delta recipe' },
      { kind: 'gadgets', id: 'battery', label: 'Battery prop' },
    ],
  },
];
