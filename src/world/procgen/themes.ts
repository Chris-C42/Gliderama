/**
 * Themes and room templates: pure data. A template says what a kind of room is made of (which looks go together,
 * which furniture it holds, what hangs on its walls); the generator fits it into whatever space the flight corridor
 * leaves. To add a theme or a room type, add data here; to add an item kind, add a catalog entry first.
 */

import type { WallStyle, FloorStyle } from '../types';
import type { ThemeId } from './types';

/** A colour scheme for one room: wallpaper, floor and the variants of the furniture that go with them. */
export interface RoomLook {
  wall: WallStyle;
  floor: FloorStyle;
  wood: 'oak' | 'walnut' | 'pine';
  curtain: 'red' | 'navy' | 'mustard' | 'teal' | 'rose';
  rug: 'rose' | 'teal' | 'mustard' | 'navy';
  lamp: 'teal' | 'red' | 'mustard';
  quilt: 'navy' | 'red' | 'teal' | 'plum';
  pendant: 'mustard' | 'teal' | 'cream';
  frame: 'brass' | 'walnut' | 'oak';
}

/** Where in the room (relative to the entry wall) a piece of furniture likes to stand. */
export type Where = 'any' | 'entry' | 'exit' | 'mid';

export interface OnTop {
  kind: string;
  chance: number;
  /** For `books`: stack height range. */
  n?: readonly [number, number];
}

export interface FloorSlot {
  id: string;
  kind: string;
  chance: number;
  w?: readonly [number, number];
  h?: readonly [number, number];
  where?: Where;
  /** Stand right next to the item placed by this earlier slot. */
  near?: string;
  /** Things that go on its top surface. */
  on?: readonly OnTop[];
  /** Headboard against a wall etc.: prefer positions touching a side wall. */
  againstWall?: boolean;
}

export interface WallSlot {
  kind: string;
  chance: number;
  /** How many to hang. */
  n: readonly [number, number];
  w?: readonly [number, number];
  h?: readonly [number, number];
  /** Variant picks (`v`). */
  v?: readonly number[];
}

export type TemplateId = 'bedroom' | 'hall' | 'study' | 'kids' | 'landing';

export type Perch = 'desk' | 'bed' | 'shelf' | 'wall';

export interface RoomTemplate {
  id: TemplateId;
  names: readonly string[];
  looks: readonly RoomLook[];
  floorPlan: readonly FloorSlot[];
  wallPlan: readonly WallSlot[];
  /** Chance of a hanging lamp / of a rug. */
  pendant: number;
  rug: number;
  /** Where a throw from the start of the floor can come from, if this is the first room. */
  perches: readonly Perch[];
  /** Relative frequency among a floor's rooms. */
  weight: number;
}

export interface ThemeDef {
  id: ThemeId;
  name: string;
  /** `LevelDef.place`. */
  place: string;
  templates: readonly RoomTemplate[];
  /**
   * The colourways (`v` of the stairs kinds: 0 walnut with a red runner, 1 oak with moss, 2 pine with navy) a flight of stairs
   * may have in this theme, with their relative weights. One is picked per flight and kept at both its ends.
   */
  stairs: readonly { v: number; w: number }[];
}

// ---------------------------------------------------------------------------------------------
// Home

const planesBoy: RoomLook = {
  wall: { pattern: 'planes', base: 'sky', accent: 'navy', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  wood: 'pine',
  curtain: 'navy',
  rug: 'navy',
  lamp: 'teal',
  quilt: 'navy',
  pendant: 'mustard',
  frame: 'brass',
};

const roseStripes: RoomLook = {
  wall: { pattern: 'stripes', base: 'cream', accent: 'rose', wainscot: null, trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  wood: 'walnut',
  curtain: 'rose',
  rug: 'rose',
  lamp: 'red',
  quilt: 'red',
  pendant: 'cream',
  frame: 'walnut',
};

const mintDots: RoomLook = {
  wall: { pattern: 'dots', base: 'teal', accent: 'cream', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'pine' },
  wood: 'pine',
  curtain: 'mustard',
  rug: 'mustard',
  lamp: 'mustard',
  quilt: 'teal',
  pendant: 'teal',
  frame: 'oak',
};

const sunnyDamask: RoomLook = {
  wall: { pattern: 'damask', base: 'mustard', accent: 'oak', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'walnut' },
  wood: 'walnut',
  curtain: 'red',
  rug: 'mustard',
  lamp: 'red',
  quilt: 'red',
  pendant: 'mustard',
  frame: 'brass',
};

const creamTeal: RoomLook = {
  wall: { pattern: 'pinstripe', base: 'cream', accent: 'teal', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  wood: 'walnut',
  curtain: 'teal',
  rug: 'teal',
  lamp: 'teal',
  quilt: 'teal',
  pendant: 'teal',
  frame: 'walnut',
};

const skyDiamonds: RoomLook = {
  wall: { pattern: 'diamonds', base: 'sky', accent: 'navy', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'walnut' },
  wood: 'oak',
  curtain: 'navy',
  rug: 'navy',
  lamp: 'mustard',
  quilt: 'navy',
  pendant: 'cream',
  frame: 'oak',
};

const mossStudy: RoomLook = {
  wall: { pattern: 'stripes', base: 'moss', accent: 'teal', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'walnut' },
  wood: 'walnut',
  curtain: 'mustard',
  rug: 'mustard',
  lamp: 'mustard',
  quilt: 'teal',
  pendant: 'mustard',
  frame: 'brass',
};

const roseDiamonds: RoomLook = {
  wall: { pattern: 'diamonds', base: 'rose', accent: 'plum', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  wood: 'oak',
  curtain: 'rose',
  rug: 'rose',
  lamp: 'red',
  quilt: 'plum',
  pendant: 'cream',
  frame: 'brass',
};

const checkerHall: RoomLook = {
  wall: { pattern: 'pinstripe', base: 'cream', accent: 'navy', wainscot: 'walnut', trim: 'cream' },
  floor: { kind: 'checker', ramp: 'cream', accent: 'navy' },
  wood: 'walnut',
  curtain: 'navy',
  rug: 'navy',
  lamp: 'teal',
  quilt: 'navy',
  pendant: 'mustard',
  frame: 'brass',
};

const sunKids: RoomLook = {
  wall: { pattern: 'dots', base: 'mustard', accent: 'red', wainscot: null, trim: 'cream' },
  floor: { kind: 'carpet', ramp: 'rose' },
  wood: 'pine',
  curtain: 'red',
  rug: 'teal',
  lamp: 'red',
  quilt: 'red',
  pendant: 'teal',
  frame: 'oak',
};

const homeBedroom: RoomTemplate = {
  id: 'bedroom',
  names: ['Bedroom', 'Guest Bedroom', 'Spare Bedroom'],
  looks: [planesBoy, roseStripes, mintDots, roseDiamonds],
  floorPlan: [
    { id: 'bed', kind: 'bed', chance: 1, w: [200, 230], where: 'any', againstWall: true },
    { id: 'night', kind: 'nightstand', chance: 0.85, near: 'bed', on: [{ kind: 'deskLamp', chance: 0.75 }, { kind: 'books', chance: 0.3, n: [2, 3] }] },
    { id: 'dresser', kind: 'dresser', chance: 0.7, where: 'any', on: [{ kind: 'books', chance: 0.3, n: [2, 3] }] },
    { id: 'shelf', kind: 'bookshelf', chance: 0.3, w: [84, 104], h: [150, 190], where: 'exit' },
    { id: 'chair', kind: 'chair', chance: 0.3, where: 'any' },
  ],
  wallPlan: [
    { kind: 'window', chance: 0.75, n: [1, 1] },
    { kind: 'frame', chance: 0.9, n: [1, 2], v: [0, 1, 2] },
    { kind: 'poster', chance: 0.25, n: [1, 1] },
    { kind: 'wallClock', chance: 0.3, n: [1, 1] },
  ],
  pendant: 0.5,
  rug: 0.7,
  perches: ['bed', 'desk', 'wall'],
  weight: 1.2,
};

const homeHall: RoomTemplate = {
  id: 'hall',
  names: ['Upstairs Hall', 'Hall', 'Long Hall'],
  looks: [sunnyDamask, creamTeal, checkerHall, skyDiamonds],
  floorPlan: [
    { id: 'tableA', kind: 'sideTable', chance: 0.9, w: [78, 96], where: 'any', on: [{ kind: 'deskLamp', chance: 0.4 }, { kind: 'books', chance: 0.25, n: [2, 3] }] },
    { id: 'tableB', kind: 'sideTable', chance: 0.55, w: [72, 88], where: 'any', on: [{ kind: 'books', chance: 0.3, n: [2, 3] }] },
    { id: 'dresser', kind: 'dresser', chance: 0.35, where: 'any' },
    { id: 'shelf', kind: 'bookshelf', chance: 0.3, w: [84, 100], where: 'exit' },
  ],
  wallPlan: [
    { kind: 'frame', chance: 1, n: [2, 4], v: [0, 1, 2] },
    { kind: 'wallClock', chance: 0.5, n: [1, 1] },
    { kind: 'window', chance: 0.35, n: [1, 1] },
  ],
  pendant: 0.6,
  rug: 0.5,
  perches: ['wall'],
  weight: 1,
};

const homeStudy: RoomTemplate = {
  id: 'study',
  names: ['Study', 'Home Office', 'Den'],
  looks: [mossStudy, creamTeal, skyDiamonds, sunnyDamask],
  floorPlan: [
    { id: 'desk', kind: 'desk', chance: 1, w: [150, 190], where: 'any', on: [{ kind: 'deskLamp', chance: 0.85 }, { kind: 'books', chance: 0.7, n: [2, 4] }, { kind: 'pencils', chance: 0.55 }] },
    { id: 'chair', kind: 'chair', chance: 0.9, near: 'desk' },
    { id: 'shelf', kind: 'bookshelf', chance: 0.85, w: [90, 124], where: 'any' },
    { id: 'shelf2', kind: 'bookshelf', chance: 0.35, w: [84, 104], h: [150, 190], where: 'any' },
    { id: 'table', kind: 'sideTable', chance: 0.3, w: [72, 88], where: 'any' },
  ],
  wallPlan: [
    { kind: 'window', chance: 0.65, n: [1, 1] },
    { kind: 'frame', chance: 0.9, n: [1, 2], v: [0, 1, 2] },
    { kind: 'wallClock', chance: 0.4, n: [1, 1] },
  ],
  pendant: 0.4,
  rug: 0.6,
  perches: ['desk', 'shelf', 'wall'],
  weight: 1,
};

const homeKids: RoomTemplate = {
  id: 'kids',
  names: ["Kid's Room", 'Playroom', 'Nursery'],
  looks: [planesBoy, sunKids, mintDots, skyDiamonds],
  floorPlan: [
    { id: 'toys', kind: 'toyBox', chance: 0.9, w: [72, 92], where: 'any' },
    { id: 'bed', kind: 'bed', chance: 0.45, w: [196, 210], where: 'any', againstWall: true },
    { id: 'desk', kind: 'desk', chance: 0.5, w: [140, 170], where: 'any', on: [{ kind: 'books', chance: 0.6, n: [2, 3] }, { kind: 'pencils', chance: 0.6 }, { kind: 'deskLamp', chance: 0.4 }] },
    { id: 'chair', kind: 'chair', chance: 0.7, near: 'desk' },
    { id: 'night', kind: 'nightstand', chance: 0.3, where: 'any' },
  ],
  wallPlan: [
    { kind: 'poster', chance: 1, n: [1, 3], v: [0, 1, 2] },
    { kind: 'window', chance: 0.5, n: [1, 1] },
    { kind: 'wallClock', chance: 0.3, n: [1, 1] },
    { kind: 'frame', chance: 0.25, n: [1, 1], v: [2] },
  ],
  pendant: 0.45,
  rug: 0.9,
  perches: ['desk', 'bed', 'shelf', 'wall'],
  weight: 1,
};

const homeLanding: RoomTemplate = {
  id: 'landing',
  names: ['Landing', 'Stair Landing', 'Upstairs Landing'],
  looks: [creamTeal, sunnyDamask, checkerHall, skyDiamonds],
  floorPlan: [
    { id: 'tableA', kind: 'sideTable', chance: 0.75, w: [76, 94], where: 'any', on: [{ kind: 'deskLamp', chance: 0.5 }, { kind: 'books', chance: 0.25, n: [2, 3] }] },
    { id: 'dresser', kind: 'dresser', chance: 0.3, where: 'any' },
    { id: 'night', kind: 'nightstand', chance: 0.35, where: 'any', on: [{ kind: 'deskLamp', chance: 0.4 }] },
  ],
  wallPlan: [
    { kind: 'window', chance: 0.85, n: [1, 1] },
    { kind: 'frame', chance: 1, n: [1, 3], v: [0, 1, 2] },
    { kind: 'wallClock', chance: 0.4, n: [1, 1] },
  ],
  pendant: 0.5,
  rug: 0.4,
  perches: ['wall'],
  weight: 0.8,
};

// ---------------------------------------------------------------------------------------------
// Cottage: the same furniture kinds in cottage colours, until cottage-specific kinds exist

const cottagePosies: RoomLook = {
  wall: { pattern: 'floral', base: 'cream', accent: 'rose', wainscot: 'pine', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'pine' },
  wood: 'pine',
  curtain: 'rose',
  rug: 'rose',
  lamp: 'red',
  quilt: 'red',
  pendant: 'cream',
  frame: 'oak',
};

const cottagePlaid: RoomLook = {
  wall: { pattern: 'plaid', base: 'moss', accent: 'cream', wainscot: 'oak', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  wood: 'oak',
  curtain: 'mustard',
  rug: 'mustard',
  lamp: 'mustard',
  quilt: 'teal',
  pendant: 'mustard',
  frame: 'walnut',
};

const cottageBoards: RoomLook = {
  wall: { pattern: 'boards', base: 'cream', accent: 'oak', wainscot: null, trim: 'cream' },
  floor: { kind: 'stone', ramp: 'stone' },
  wood: 'walnut',
  curtain: 'red',
  rug: 'teal',
  lamp: 'red',
  quilt: 'red',
  pendant: 'mustard',
  frame: 'walnut',
};

const cottageBlue: RoomLook = {
  wall: { pattern: 'stripes', base: 'sky', accent: 'navy', wainscot: 'cream', trim: 'cream' },
  floor: { kind: 'planks', ramp: 'oak' },
  wood: 'pine',
  curtain: 'navy',
  rug: 'navy',
  lamp: 'teal',
  quilt: 'navy',
  pendant: 'cream',
  frame: 'brass',
};

const cottageTiles: RoomLook = {
  wall: { pattern: 'dots', base: 'cream', accent: 'teal', wainscot: 'teal', trim: 'cream' },
  floor: { kind: 'tiles', ramp: 'stone' },
  wood: 'pine',
  curtain: 'teal',
  rug: 'teal',
  lamp: 'teal',
  quilt: 'teal',
  pendant: 'teal',
  frame: 'oak',
};

function cottage(t: RoomTemplate, names: readonly string[], looks: readonly RoomLook[]): RoomTemplate {
  return { ...t, names, looks };
}

const HOME: ThemeDef = {
  id: 'home',
  name: 'Home',
  place: 'home',
  templates: [homeBedroom, homeHall, homeStudy, homeKids, homeLanding],
  // dark polished stairs with the classic red runner most often
  stairs: [
    { v: 0, w: 3 },
    { v: 1, w: 2 },
    { v: 2, w: 2 },
  ],
};

const cottageGuest: RoomTemplate = {
  id: 'bedroom',
  names: ['Guest Room', 'Attic Bedroom', 'Little Bedroom'],
  looks: [cottagePosies, cottageBlue, cottagePlaid],
  floorPlan: [
    { id: 'bed', kind: 'bed', chance: 1, w: [196, 224], where: 'any', againstWall: true },
    { id: 'night', kind: 'nightstand', chance: 0.85, near: 'bed', on: [{ kind: 'oilLamp', chance: 0.7 }, { kind: 'books', chance: 0.25, n: [2, 3] }] },
    { id: 'dresser', kind: 'dresser', chance: 0.6, where: 'any', on: [{ kind: 'oilLamp', chance: 0.3 }] },
    { id: 'rocker', kind: 'rockingChair', chance: 0.45, where: 'any' },
    { id: 'basket', kind: 'knittingBasket', chance: 0.4, where: 'any' },
  ],
  wallPlan: [
    { kind: 'cottageWindow', chance: 0.8, n: [1, 1] },
    { kind: 'frame', chance: 0.9, n: [1, 2], v: [0, 1, 2] },
    { kind: 'wallClock', chance: 0.25, n: [1, 1] },
  ],
  pendant: 0.35,
  rug: 0.8,
  perches: ['bed', 'desk', 'wall'],
  weight: 1.1,
};

const cottageHall: RoomTemplate = {
  id: 'hall',
  names: ['Cottage Hall', 'Narrow Hall', 'Passage'],
  looks: [cottagePlaid, cottagePosies, cottageBoards],
  floorPlan: [
    { id: 'clock', kind: 'grandfatherClock', chance: 0.6, where: 'any' },
    { id: 'tableA', kind: 'sideTable', chance: 0.8, w: [78, 96], where: 'any', on: [{ kind: 'oilLamp', chance: 0.5 }, { kind: 'books', chance: 0.2, n: [2, 3] }] },
    { id: 'chair', kind: 'armchair', chance: 0.3, where: 'any' },
    { id: 'shelf', kind: 'bookshelf', chance: 0.25, w: [84, 100], where: 'exit' },
  ],
  wallPlan: [
    { kind: 'frame', chance: 1, n: [2, 3], v: [0, 1, 2] },
    { kind: 'wallClock', chance: 0.3, n: [1, 1] },
    { kind: 'cottageWindow', chance: 0.35, n: [1, 1] },
  ],
  pendant: 0.5,
  rug: 0.6,
  perches: ['wall'],
  weight: 1,
};

const cottageParlour: RoomTemplate = {
  id: 'study',
  names: ['Parlour', 'Sitting Room', 'Front Room'],
  looks: [cottagePosies, cottagePlaid, cottageBlue],
  floorPlan: [
    { id: 'fire', kind: 'fireplace', chance: 0.85, where: 'any', on: [{ kind: 'oilLamp', chance: 0.6 }] },
    { id: 'chair', kind: 'armchair', chance: 0.85, where: 'any' },
    { id: 'rocker', kind: 'rockingChair', chance: 0.4, where: 'any' },
    { id: 'tea', kind: 'teaTable', chance: 0.5, where: 'any' },
    { id: 'basket', kind: 'knittingBasket', chance: 0.45, where: 'any' },
    { id: 'shelf', kind: 'bookshelf', chance: 0.3, w: [84, 104], h: [150, 190], where: 'any' },
  ],
  wallPlan: [
    { kind: 'cottageWindow', chance: 0.7, n: [1, 1] },
    { kind: 'frame', chance: 0.9, n: [1, 2], v: [0, 1, 2] },
    { kind: 'wallClock', chance: 0.2, n: [1, 1] },
  ],
  pendant: 0.3,
  rug: 0.8,
  perches: ['shelf', 'wall'],
  weight: 1.2,
};

const cottageKitchen: RoomTemplate = {
  id: 'kids',
  names: ['Kitchen', 'Scullery', 'Back Kitchen'],
  looks: [cottageTiles, cottageBoards, cottageBlue],
  floorPlan: [
    { id: 'stove', kind: 'stove', chance: 0.9, where: 'any' },
    { id: 'hutch', kind: 'dresserHutch', chance: 0.65, where: 'any' },
    { id: 'tea', kind: 'teaTable', chance: 0.4, where: 'any' },
    { id: 'table', kind: 'sideTable', chance: 0.35, w: [72, 90], where: 'any', on: [{ kind: 'oilLamp', chance: 0.4 }] },
  ],
  wallPlan: [
    { kind: 'cottageWindow', chance: 0.7, n: [1, 1] },
    { kind: 'wallClock', chance: 0.45, n: [1, 1] },
    { kind: 'frame', chance: 0.3, n: [1, 1], v: [2] },
  ],
  pendant: 0.4,
  rug: 0.3,
  perches: ['shelf', 'wall'],
  weight: 1,
};

const COTTAGE: ThemeDef = {
  id: 'cottage',
  name: "Grandma's Cottage",
  place: 'cottage',
  templates: [
    cottageGuest,
    cottageHall,
    cottageParlour,
    cottageKitchen,
    cottage(homeLanding, ['Stairs', 'Landing', 'Staircase'], [cottagePosies, cottageBoards, cottageBlue]),
  ],
  // plain scrubbed pine and oak, a moss or navy runner
  stairs: [
    { v: 0, w: 2 },
    { v: 1, w: 3 },
    { v: 2, w: 3 },
  ],
};

export const THEMES: Record<ThemeId, ThemeDef> = { home: HOME, cottage: COTTAGE };

/** Theme ids in rotation order (floors 0-1 use the first, 2-3 the second ...). */
export const THEME_ROTATION: readonly ThemeId[] = ['home', 'cottage'];
