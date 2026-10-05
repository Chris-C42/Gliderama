/** Campaign place 2: Grandma's Cottage. Hand-built levels (room pixels, floor at y = 340). */

import type { LevelDef } from '../../game/level';
import type { CampaignLevel } from '../campaign';
import type { RoomDef } from '../types';

const star = (room: string, n: number, x: number, y: number) => ({ t: 'star', id: `${room}:star:${n}`, x, y });

// ---------------------------------------------------------------------------------------------
// Level 1 — Tea for Two: ride the fire's warm air over the grandfather clock, mind the cat,
// then use the kettle's steam to climb over the dresser and out of the back door.

const C1_PARLOUR: RoomDef = {
  id: 'c1-parlour',
  name: 'The Parlour',
  wall: { pattern: 'floral', base: 'rose', accent: 'leaf', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'pine' },
  exits: { right: { from: 70, to: 340 } },
  seed: 61,
  items: [
    { t: 'rug', x: 190, y: 326, w: 200, v: 2 },
    { t: 'frame', x: 150, y: 58, v: 2, w: 48, h: 60 },
    { t: 'cottageWindow', x: 470, y: 60 },
    { t: 'bookshelf', x: 14, y: 126, v: 1 },
    { t: 'fireplace', x: 190, y: 190 },
    { t: 'oilLamp', x: 206, y: 156 },
    { t: 'grandfatherClock', x: 392, y: 126 },
    { t: 'armchair', x: 452, y: 230, v: 0 },
    { t: 'cat', x: 500, y: 296, v: 0 },
    { t: 'teaTable', x: 560, y: 278, w: 70 },
    star('c1a', 0, 275, 96),
    star('c1a', 1, 415, 86),
    star('c1a', 2, 520, 238),
  ],
};

const C1_KITCHEN: RoomDef = {
  id: 'c1-kitchen',
  name: 'The Kitchen',
  wall: { pattern: 'tile', base: 'cream', accent: 'teal', wainscot: null, trim: 'oak' },
  floor: { kind: 'stone', ramp: 'stone' },
  exits: { left: { from: 70, to: 340 } },
  seed: 71,
  items: [
    { t: 'beam', x: 0, y: 14 },
    { t: 'herbs', x: 40, y: 30, w: 100 },
    { t: 'herbs', x: 470, y: 30, w: 60 },
    { t: 'stove', x: 100, y: 244 },
    { t: 'kettle', x: 108, y: 222 },
    { t: 'dresserHutch', x: 296, y: 136 },
    { t: 'cuckooClock', x: 470, y: 50, dir: -1, every: 5 },
    { t: 'frontDoor', x: 534, y: 114 },
    { t: 'exit', x: 556, y: 130, w: 64, h: 210 },
    star('c1b', 0, 140, 130),
    star('c1b', 1, 372, 162),
    star('c1b', 2, 470, 116),
    { t: 'tape', id: 'c1b:tape', x: 250, y: 200 },
  ],
};

export function cottage1(): LevelDef {
  return {
    id: 'cottage-1',
    name: 'Tea for Two',
    place: 'cottage',
    rooms: { '0,0': C1_PARLOUR, '1,0': C1_KITCHEN },
    start: { room: '0,0', x: 64, y: 102, facing: 1 },
    sheets: 6,
    par: 30,
    intro: 'The fire’s warm air rises above the mantel. Ride it over the clock!',
  };
}

// ---------------------------------------------------------------------------------------------
// Level 2 — Knitting by Lamplight: a dark sitting room, then warm air rising up the stairwell
// into the sewing attic, and out through the gable window.

const C2_SITTING: RoomDef = {
  id: 'c2-sitting',
  name: 'The Sitting Room',
  wall: { pattern: 'diamonds', base: 'moss', accent: 'mustard', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  dark: true,
  night: true,
  exits: { right: { from: 70, to: 340 } },
  seed: 81,
  items: [
    { t: 'rug', x: 150, y: 326, w: 180, v: 1 },
    { t: 'cottageWindow', x: 196, y: 58 },
    { t: 'shelf', x: 14, y: 150, w: 100 },
    { t: 'oilLamp', x: 88, y: 116 },
    { t: 'switch', x: 150, y: 168 },
    { t: 'pendant', x: 300, y: 0, len: 36, v: 1 },
    { t: 'rockingChair', x: 150, y: 236 },
    { t: 'knittingBasket', x: 246, y: 312 },
    { t: 'fireplace', x: 346, y: 190, power: 2.2 },
    { t: 'oilLamp', x: 488, y: 156 },
    { t: 'armchair', x: 540, y: 230, v: 2, flip: true },
    { t: 'cat', x: 588, y: 296, v: 2 },
    star('c2a', 0, 196, 206),
    star('c2a', 1, 430, 96),
    star('c2a', 2, 600, 236),
  ],
};

const C2_STAIRS: RoomDef = {
  id: 'c2-stairs',
  name: 'The Stairwell',
  wall: { pattern: 'boards', base: 'pine', accent: 'oak', wainscot: null, trim: 'oak' },
  floor: { kind: 'planks', ramp: 'walnut' },
  night: true,
  exits: { left: { from: 70, to: 340 }, up: { from: 380, to: 540 } },
  seed: 91,
  items: [
    { t: 'frame', x: 120, y: 70, v: 1, w: 54, h: 66 },
    { t: 'frame', x: 210, y: 92, v: 0, w: 40, h: 50 },
    { t: 'grandfatherClock', x: 80, y: 126, v: 1 },
    { t: 'sideTable', x: 200, y: 256, v: 0 },
    { t: 'oilLamp', x: 230, y: 222 },
    { t: 'banister', x: 290, y: 272, w: 300, h: 68 },
    { t: 'draft', x: 390, y: 340, w: 140, top: -40, power: 2.9 },
    star('c2b', 0, 460, 220),
    star('c2b', 1, 460, 110),
    star('c2b', 2, 104, 96),
  ],
};

const C2_ATTIC: RoomDef = {
  id: 'c2-attic',
  name: 'The Sewing Attic',
  wall: { pattern: 'boards', base: 'cream', accent: 'pine', wainscot: null, trim: 'pine' },
  floor: { kind: 'planks', ramp: 'pine' },
  night: true,
  exits: { down: { from: 380, to: 540 }, right: { from: 96, to: 230, exit: true } },
  seed: 101,
  items: [
    { t: 'beam', x: 0, y: 14 },
    { t: 'herbs', x: 100, y: 30, w: 90 },
    { t: 'dresser', x: 30, y: 236, v: 1 },
    { t: 'oilLamp', x: 70, y: 202 },
    { t: 'knittingBasket', x: 180, y: 312 },
    { t: 'cuckooClock', x: 270, y: 44, dir: 1, every: 6, phase: 3 },
    { t: 'draft', x: 390, y: 372, w: 140, top: 130, power: 3 },
    { t: 'exit', x: 604, y: 96, w: 36, h: 134 },
    star('c2c', 0, 460, 240),
    star('c2c', 1, 330, 120),
    star('c2c', 2, 580, 110),
  ],
};

export function cottage2(): LevelDef {
  return {
    id: 'cottage-2',
    name: 'Knitting by Lamplight',
    place: 'cottage',
    rooms: { '0,0': C2_SITTING, '1,0': C2_STAIRS, '1,-1': C2_ATTIC },
    start: { room: '0,0', x: 52, y: 126, facing: 1 },
    sheets: 6,
    par: 38,
    intro: 'Lights out at Grandma’s. Find the switch, and let the warm air carry you upstairs.',
  };
}

// ---------------------------------------------------------------------------------------------
// Level 3 — Garden Door: a dripping pantry, then the conservatory's big fan (find its switch!)
// and the cat on the windowsill, out through the garden door.

const C3_PANTRY: RoomDef = {
  id: 'c3-pantry',
  name: 'The Pantry',
  wall: { pattern: 'tile', base: 'sky', accent: 'navy', wainscot: null, trim: 'cream' },
  floor: { kind: 'checker', ramp: 'cream', accent: 'red' },
  exits: { right: { from: 70, to: 340 } },
  seed: 111,
  items: [
    { t: 'shelf', x: 14, y: 140, w: 110 },
    { t: 'shelf', x: 160, y: 96, w: 120 },
    { t: 'shelf', x: 330, y: 150, w: 110 },
    { t: 'sink', x: 470, y: 246 },
    { t: 'drip', x: 498, y: 30, every: 1.1 },
    { t: 'drip', x: 250, y: 30, every: 1.7 },
    { t: 'dresser', x: 200, y: 236, v: 2 },
    { t: 'teaTable', x: 380, y: 278, w: 64 },
    { t: 'plant', x: 560, y: 314, tall: 60, v: 0 },
    star('c3a', 0, 220, 70),
    star('c3a', 1, 385, 124),
    star('c3a', 2, 498, 160),
    { t: 'sheet', id: 'c3a:sheet', x: 120, y: 260 },
  ],
};

const C3_CONSERVATORY: RoomDef = {
  id: 'c3-conservatory',
  name: 'The Conservatory',
  wall: { pattern: 'diamonds', base: 'sky', accent: 'leaf', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'tiles', ramp: 'stone' },
  exits: { left: { from: 70, to: 340 } },
  seed: 121,
  items: [
    { t: 'cottageWindow', x: 60, y: 54, w: 110 },
    { t: 'cottageWindow', x: 230, y: 54, w: 110 },
    { t: 'cat', x: 286, y: 158, v: 1 },
    { t: 'plant', x: 40, y: 314, tall: 70, v: 1 },
    { t: 'plant', x: 120, y: 314, tall: 40, v: 2 },
    { t: 'sideTable', x: 330, y: 256, v: 2 },
    { t: 'fan', x: 360, y: 200, stand: 24, dir: -1, power: 4.6, reach: 360, group: 'fan' },
    { t: 'switch', x: 186, y: 196, group: 'fan' },
    { t: 'rockingChair', x: 450, y: 236, flip: true },
    { t: 'frontDoor', x: 534, y: 114, v: 1 },
    { t: 'exit', x: 556, y: 130, w: 64, h: 210 },
    star('c3b', 0, 200, 130),
    star('c3b', 1, 390, 150),
    star('c3b', 2, 470, 200),
  ],
};

export function cottage3(): LevelDef {
  return {
    id: 'cottage-3',
    name: 'Garden Door',
    place: 'cottage',
    rooms: { '0,0': C3_PANTRY, '1,0': C3_CONSERVATORY },
    start: { room: '0,0', x: 64, y: 116, facing: 1 },
    sheets: 6,
    par: 30,
    intro: 'Mind the drips. That fan in the conservatory has a switch somewhere…',
  };
}

export const COTTAGE_LEVELS: CampaignLevel[] = [
  {
    id: 'cottage-1',
    name: 'Tea for Two',
    blurb: 'Fire, a grandfather clock and a cat who hates paper.',
    build: cottage1,
    unlocks: [
      { kind: 'recipes', id: 'hammerhead', label: 'Hammerhead recipe' },
      { kind: 'folds', id: 'foil', label: 'Foil coating' },
      { kind: 'cosmetics', id: 'kraft', label: 'Kraft paper print' },
    ],
  },
  {
    id: 'cottage-2',
    name: 'Knitting by Lamplight',
    blurb: 'A dark sitting room and the warm stairwell.',
    build: cottage2,
    unlocks: [
      { kind: 'gadgets', id: 'helium', label: 'Helium sticker' },
      { kind: 'papers', id: 'newsprint', label: 'Newsprint' },
      { kind: 'cosmetics', id: 'waves', label: 'Wave print' },
    ],
  },
  {
    id: 'cottage-3',
    name: 'Garden Door',
    blurb: 'Drips, a gale of a fan, and the way out to the garden.',
    build: cottage3,
    unlocks: [
      { kind: 'gadgets', id: 'bands', label: 'Rubber-band launcher' },
      { kind: 'papers', id: 'a3', label: 'A3 sheets' },
      { kind: 'papers', id: 'legal', label: 'Legal sheets' },
      { kind: 'cosmetics', id: 'flames', label: 'Flame print' },
    ],
  },
];
