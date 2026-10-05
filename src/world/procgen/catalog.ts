/**
 * Data-driven catalog of the item kinds the generator can place: default size (read off the painters in
 * `world/kinds`), placement type, collider-top of surfaces and tags. Adding a kind to the generator means adding
 * one entry here (plus listing it in a template in `themes.ts`); `tests/procgen.test.ts` cross-checks every entry
 * against the real collider code so the numbers cannot silently drift.
 */

import { LAYOUT, type ItemDef } from '../types';
import type { Box } from './types';

/**
 * - `floor`: stands on the floor line (`y = LAYOUT.floor - h`).
 * - `wall`: hangs on the back wall (free wall area between the ceiling and the dado rail).
 * - `surface`: stands on the collider top of a host (desk, table, nightstand ...).
 * - `ceiling`: hangs from the ceiling.
 * - `rug`: floor decor with no collider, may overlap furniture.
 * - `vent`: floor grille (air mover), occupies a floor x-range.
 */
export type Placement = 'floor' | 'wall' | 'surface' | 'ceiling' | 'rug' | 'vent';

export interface SurfaceDef {
  /** x of the walkable top relative to the host's x. */
  dx: number;
  /** Extra width on top of the host's `w`. */
  extra: number;
  /** y of the collider top relative to the host's y. */
  top: number;
}

export interface Pad {
  l: number;
  r: number;
  t: number;
  b: number;
}

export interface CatalogEntry {
  /** Item kind id (`ItemDef.t`). */
  kind: string;
  placement: Placement;
  /** Default size in px (what the painter draws when the item has no `w` / `h`). */
  w: number;
  h: number;
  /** Size ranges the generator may pick from (inclusive). */
  wRange?: readonly [number, number];
  hRange?: readonly [number, number];
  /** Present on furniture that carries things on its top. */
  surface?: SurfaceDef;
  /** Surface items: `item.y = surfaceTop - rest` (the painted bottom touches the collider top). */
  rest?: number;
  /** Visual padding around the item box (curtains, hanging wires, drop shadows) for wall decor overlap tests. */
  pad?: Pad;
  /** Names of the `v` variants in the order the painter indexes them. */
  variants?: readonly string[];
  tags: readonly string[];
}

const WOOD3 = ['oak', 'walnut', 'pine'] as const;

export const CATALOG: Record<string, CatalogEntry> = {
  // ---- floor-standing furniture
  bed: {
    kind: 'bed',
    placement: 'floor',
    w: 230,
    h: 130,
    wRange: [196, 230],
    variants: ['navy', 'red', 'teal', 'plum'],
    tags: ['sleep', 'tall-end', 'furniture'],
  },
  desk: {
    kind: 'desk',
    placement: 'floor',
    w: 168,
    h: 98,
    wRange: [140, 196],
    surface: { dx: -4, extra: 8, top: 2 },
    variants: WOOD3,
    tags: ['work', 'furniture', 'table'],
  },
  chair: { kind: 'chair', placement: 'floor', w: 46, h: 116, variants: WOOD3, tags: ['seat', 'furniture', 'tall-back'] },
  bookshelf: {
    kind: 'bookshelf',
    placement: 'floor',
    w: 112,
    h: 214,
    wRange: [84, 124],
    hRange: [150, 214],
    variants: ['walnut', 'oak', 'pine'],
    tags: ['storage', 'books', 'tall', 'furniture'],
  },
  toyBox: { kind: 'toyBox', placement: 'floor', w: 84, h: 54, wRange: [70, 96], tags: ['kids', 'low', 'furniture'] },
  nightstand: {
    kind: 'nightstand',
    placement: 'floor',
    w: 54,
    h: 66,
    wRange: [44, 60],
    hRange: [60, 72],
    surface: { dx: 0, extra: 0, top: 1 },
    variants: ['pine', 'oak', 'walnut'],
    tags: ['low', 'furniture', 'table'],
  },
  dresser: {
    kind: 'dresser',
    placement: 'floor',
    w: 132,
    h: 104,
    wRange: [108, 150],
    hRange: [96, 110],
    surface: { dx: 0, extra: 0, top: 2 },
    variants: ['walnut', 'oak', 'pine'],
    tags: ['storage', 'furniture', 'table'],
  },
  sideTable: {
    kind: 'sideTable',
    placement: 'floor',
    w: 96,
    h: 84,
    wRange: [72, 100],
    hRange: [78, 90],
    surface: { dx: 0, extra: 0, top: 2 },
    variants: ['walnut', 'oak', 'pine'],
    tags: ['furniture', 'table'],
  },

  // ---- air movers
  // ---- cottage furniture
  fireplace: {
    kind: 'fireplace',
    placement: 'floor',
    w: 170,
    h: 150,
    surface: { dx: -10, extra: 20, top: 0 },
    tags: ['furniture', 'table', 'fire', 'lift', 'cottage'],
  },
  armchair: { kind: 'armchair', placement: 'floor', w: 96, h: 110, variants: ['rose', 'moss', 'plum', 'mustard'], tags: ['seat', 'furniture', 'cottage'] },
  grandfatherClock: { kind: 'grandfatherClock', placement: 'floor', w: 46, h: 214, variants: ['walnut', 'oak'], tags: ['tall', 'furniture', 'clock', 'cottage'] },
  dresserHutch: { kind: 'dresserHutch', placement: 'floor', w: 150, h: 204, variants: ['pine', 'oak'], tags: ['storage', 'tall', 'furniture', 'cottage'] },
  rockingChair: { kind: 'rockingChair', placement: 'floor', w: 70, h: 104, variants: WOOD3, tags: ['seat', 'furniture', 'cottage'] },
  teaTable: { kind: 'teaTable', placement: 'floor', w: 84, h: 62, wRange: [70, 90], variants: ['walnut', 'oak'], tags: ['low', 'furniture', 'cottage'] },
  knittingBasket: { kind: 'knittingBasket', placement: 'floor', w: 44, h: 28, tags: ['low', 'furniture', 'small', 'cottage'] },
  stove: { kind: 'stove', placement: 'floor', w: 124, h: 96, tags: ['furniture', 'air', 'cottage'] },
  cottageWindow: {
    kind: 'cottageWindow',
    placement: 'wall',
    w: 96,
    h: 104,
    pad: { l: 8, r: 8, t: 3, b: 17 },
    tags: ['wall', 'window', 'light', 'cottage'],
  },
  oilLamp: { kind: 'oilLamp', placement: 'surface', w: 18, h: 34, rest: 34, tags: ['light', 'small', 'cottage'] },

  floorVent: { kind: 'floorVent', placement: 'vent', w: 56, h: 9, wRange: [48, 64], tags: ['air', 'lift'] },

  // ---- decor on the floor
  rug: {
    kind: 'rug',
    placement: 'rug',
    w: 200,
    h: 28,
    wRange: [150, 250],
    variants: ['rose', 'teal', 'mustard', 'navy'],
    tags: ['decor'],
  },

  // ---- wall decor (x, y = top-left unless noted)
  window: {
    kind: 'window',
    placement: 'wall',
    w: 112,
    h: 124,
    wRange: [80, 120],
    hRange: [72, 132],
    pad: { l: 17, r: 17, t: 17, b: 17 },
    variants: ['red', 'navy', 'mustard', 'teal', 'rose'],
    tags: ['wall', 'window', 'light'],
  },
  frame: {
    kind: 'frame',
    placement: 'wall',
    w: 64,
    h: 48,
    wRange: [44, 80],
    hRange: [38, 64],
    pad: { l: 1, r: 4, t: 9, b: 4 },
    variants: ['brass', 'walnut', 'oak'],
    tags: ['wall', 'art'],
  },
  poster: {
    kind: 'poster',
    placement: 'wall',
    w: 60,
    h: 80,
    pad: { l: 3, r: 4, t: 3, b: 4 },
    variants: ['rocket', 'biplane', 'map'],
    tags: ['wall', 'art', 'kids'],
  },
  /** Circle: x, y = centre; radius `r` (default 16). */
  wallClock: { kind: 'wallClock', placement: 'wall', w: 36, h: 36, pad: { l: 0, r: 0, t: 0, b: 0 }, tags: ['wall', 'clock'] },
  switchPlate: { kind: 'switchPlate', placement: 'wall', w: 10, h: 16, pad: { l: 2, r: 2, t: 2, b: 2 }, tags: ['wall', 'switch'] },
  frontDoor: {
    kind: 'frontDoor',
    placement: 'wall',
    w: 80,
    h: 226,
    wRange: [76, 96],
    pad: { l: 8, r: 10, t: 8, b: 0 },
    tags: ['wall', 'exit'],
  },

  // ---- ceiling (x = centre of the lamp)
  pendant: {
    kind: 'pendant',
    placement: 'ceiling',
    w: 37,
    h: 60,
    pad: { l: 0, r: 0, t: 0, b: 0 },
    variants: ['mustard', 'teal', 'cream'],
    tags: ['ceiling', 'light'],
  },

  // ---- surface items
  deskLamp: { kind: 'deskLamp', placement: 'surface', w: 40, h: 48, rest: 48, variants: ['teal', 'red', 'mustard'], tags: ['light', 'small'] },
  books: { kind: 'books', placement: 'surface', w: 28, h: 18, rest: 0, tags: ['books', 'small'] },
  pencils: { kind: 'pencils', placement: 'surface', w: 12, h: 26, rest: 0, tags: ['small'] },
  /** x, y = wick top; the painted holder bottom is at `y + wax + 8`. */
  candle: { kind: 'candle', placement: 'surface', w: 13, h: 40, rest: 26, tags: ['fire', 'small'] },
  /** Desk fan: x, y = head top-left (32 x 32); stand base at `y + stand + 32`. */
  fan: { kind: 'fan', placement: 'surface', w: 32, h: 62, rest: 62, tags: ['air', 'small'] },
};

export function entryOf(kind: string): CatalogEntry {
  const e = CATALOG[kind];
  if (!e) throw new Error(`procgen: unknown catalog kind '${kind}'`);
  return e;
}

/** `ItemDef.w` / `ItemDef.h` with the catalog default as fallback. */
export function sizeOf(it: ItemDef): { w: number; h: number } {
  const e = CATALOG[it.t];
  return { w: it.w ?? e?.w ?? 0, h: it.h ?? e?.h ?? 0 };
}

/** The y a floor-standing item of height `h` gets so its bottom rests on the floor line. */
export function floorY(h: number): number {
  return LAYOUT.floor - h;
}

/** Variant index for a colour / wood name in a kind's variant table (0 when the kind has no such variant). */
export function variantIndex(kind: string, name: string): number {
  const i = CATALOG[kind]?.variants?.indexOf(name) ?? -1;
  return i < 0 ? 0 : i;
}

/** The top surface of a host item: x-range and collider top y. */
export function surfaceOf(it: ItemDef): { x0: number; x1: number; top: number } | null {
  const e = CATALOG[it.t];
  if (!e?.surface) return null;
  const { w } = sizeOf(it);
  return { x0: it.x + e.surface.dx, x1: it.x + e.surface.dx + w + e.surface.extra, top: it.y + e.surface.top };
}

/** Candle geometry: the painted holder bottom touches the surface; the flame hazard sits above the wick. */
export const CANDLE = { holder: 8, flameUp: 13 };

/**
 * Visual bounding box of an item in room pixels (what it paints, padding included for wall decor). Used for bounds
 * checks and wall-decor overlap tests, not for physics (physics uses the real colliders from `world/kinds`).
 */
export function boxOf(it: ItemDef): Box {
  const e = CATALOG[it.t];
  const { w, h } = sizeOf(it);
  switch (it.t) {
    case 'pendant': {
      const len = typeof it.len === 'number' ? it.len : 60;
      return { x: it.x - 18, y: LAYOUT.ceiling, w: 37, h: len + 22 };
    }
    case 'wallClock': {
      const r = typeof it.r === 'number' ? it.r : 16;
      return { x: it.x - r - 1, y: it.y - r - 1, w: 2 * r + 4, h: 2 * r + 4 };
    }
    case 'rug':
      return { x: it.x, y: it.y - 14, w, h: 28 };
    case 'floorVent':
      return { x: it.x - 1, y: LAYOUT.floor - 6, w: w + 2, h: 9 };
    case 'books': {
      const n = typeof it.n === 'number' ? it.n : 3;
      return { x: it.x, y: it.y - 6 * n, w: 28, h: 6 * n };
    }
    case 'pencils':
      return { x: it.x, y: it.y - 26, w: 12, h: 26 };
    case 'candle': {
      const wax = typeof it.wax === 'number' ? it.wax : 18;
      return { x: it.x - 3, y: it.y - CANDLE.flameUp, w: 13, h: CANDLE.flameUp + wax + CANDLE.holder };
    }
    case 'fan': {
      const stand = typeof it.stand === 'number' ? it.stand : 30;
      return { x: it.x, y: it.y, w: 32, h: stand + 32 };
    }
    case 'deskLamp':
      return { x: it.x, y: it.y, w: 40, h: 48 };
    default: {
      const p = e?.pad ?? { l: 0, r: 0, t: 0, b: 0 };
      return { x: it.x - p.l, y: it.y - p.t, w: w + p.l + p.r, h: h + p.t + p.b };
    }
  }
}

export function hasTag(kind: string, tag: string): boolean {
  return CATALOG[kind]?.tags.includes(tag) ?? false;
}
