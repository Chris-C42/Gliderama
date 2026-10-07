/**
 * Glider PRO → Gliderama mapping: every decision about how a Glider PRO house becomes a Gliderama level lives
 * here, as data and small functions (the converter in convert-glider-houses.mjs only reads files and writes
 * JSON). See docs/classic-houses.md for the tables in prose.
 *
 * Geometry. A Glider PRO room is 512 × 322 px; the glider (48 × 20, positions are its top-left corner) dies
 * when its bottom passes y = 312 (the floor) or bumps its top on y = 8 (the ceiling). A Gliderama room is
 * 640 × 360 with the plane's floor line at y = 340 and the ceiling at 16. x scales by 640 / 512 = 1.25 and y
 * maps the floor line onto the floor line and the ceiling onto the ceiling (× 1.066), so rooms keep their
 * proportions within ~15 % and every original height has a Gliderama height.
 */

import fs from 'node:fs';

// ---------------------------------------------------------------------------------------------
// Geometry

export const GP = { roomW: 512, roomH: 322, floor: 312, ceiling: 8, tileW: 64 };
export const GR = { roomW: 640, roomH: 360, floor: 340, ceiling: 16, wallBase: 302, sideWall: 12 };
export const SX = GR.roomW / GP.roomW;
export const SY = (GR.floor - GR.ceiling) / (GP.floor - GP.ceiling);

const r1 = (v) => Math.round(v);
const r2 = (v) => Math.round(v * 100) / 100;
export const X = (h) => h * SX;
export const Y = (v) => GR.floor - (GP.floor - v) * SY;
/** A furniture bottom this low (GP y) stands on the floor: it is stretched down to the Gliderama floor line. */
export const FLOOR_SNAP = 284;

/** A GP rect (top, left, bottom, right) in Gliderama px, optionally standing on the floor. */
function rectOf(b, snap = false) {
  const x = X(b.left);
  const y = Y(b.top);
  const bottom = snap && b.bottom >= FLOOR_SNAP ? GR.floor : Y(b.bottom);
  return { x: r1(x), y: r1(y), w: r1(X(b.right) - x), h: r1(bottom - y) };
}

// ---------------------------------------------------------------------------------------------
// Air tuning (global). Glider PRO air is binary: inside a column the glider rises at 6 px/frame (a third of its
// top speed), ceiling vents push it down at 8, fans shove it sideways at 12; it can hover by letting go of the
// controls. A paper plane can't stop, so it climbs by weaving through a plume: the columns are made wide and
// strong enough for that, and their tops sit where the original columns end.

export const AIR = {
  /** Floor vents and other blowers rising from the floor (m/s at the grille). */
  ventPower: (distance) => r2(Math.min(4.6, 3.2 + distance / 260)),
  /** How fast a floor vent's plume widens with height (Gliderama default 0.22). */
  ventSpread: 0.12,
  /** Ceiling vents push down (m/s). */
  ceilingPower: 2.6,
  /** Fans and sideways air. */
  fanPower: 3.4,
  sidePower: 3.0,
  /** Invisible rising air (invisible blowers, lift areas, the lift above a candle). */
  upPower: (distance) => r2(Math.min(4.6, 3.4 + distance / 300)),
  downPower: 2.6,
  /** Width (px) of the invisible columns that stand for Glider PRO's 4-px blower columns (the glider is 48 wide). */
  columnW: 140,
  /** Height (px) of the invisible sideways bands (GP: 16 px plus the glider's 20). */
  bandH: 46,
  /** A column that reaches this close to the top of its room carries on through a ceiling opening (px). */
  carryOn: 40,
};

// ---------------------------------------------------------------------------------------------
// Backgrounds → looks. The built-in backgrounds 2000-2017 have a look each, after the game's own pictures
// (PICT 2000-2017 in Glider PRO.r). A house's own background pictures (>= 3000) get the closest look to their
// colours (pictureLook below); without the picture, an indoor look picked by the picture's id, or the outdoors
// when the room is not a structure. `solid`: the colour of the room's obstacles (unless the picture says).

const wall = (pattern, base, accent, wainscot, trim) => ({ pattern, base, accent, wainscot, trim });

export const LOOKS = {
  simpleRoom: { wall: wall('plain', 'cream', 'mustard', null, 'cream'), floor: { kind: 'planks', ramp: 'oak' }, solid: 'oak' },
  paneledRoom: { wall: wall('plain', 'stone', 'stone', 'walnut', 'oak'), floor: { kind: 'planks', ramp: 'oak' }, solid: 'walnut' },
  basement: { wall: wall('brick', 'ink', 'stone', null, 'stone'), floor: { kind: 'concrete', ramp: 'stone' }, solid: 'stone' },
  childsRoom: { wall: wall('planes', 'sky', 'mustard', null, 'cream'), floor: { kind: 'carpet', ramp: 'navy' }, solid: 'pine' },
  asianRoom: { wall: wall('floral', 'cream', 'leaf', null, 'walnut'), floor: { kind: 'carpet', ramp: 'moss' }, solid: 'walnut' },
  unfinishedRoom: { wall: wall('boards', 'pine', 'oak', null, 'pine'), floor: { kind: 'planks', ramp: 'pine' }, solid: 'pine' },
  swingersRoom: { wall: wall('damask', 'red', 'red', null, 'cream'), floor: { kind: 'carpet', ramp: 'red' }, solid: 'walnut' },
  bathroom: { wall: wall('tile', 'stone', 'sky', null, 'cream'), floor: { kind: 'checker', ramp: 'stone', accent: 'navy' }, solid: 'stone' },
  library: { wall: wall('boards', 'oak', 'walnut', 'walnut', 'oak'), floor: { kind: 'carpet', ramp: 'navy' }, solid: 'walnut' },
  // a covered walkway: windows above, wood below
  skywalk: { wall: wall('plain', 'sky', 'sky', 'oak', 'oak'), floor: { kind: 'planks', ramp: 'oak' }, solid: 'oak' },
  dirt: { wall: wall('plain', 'walnut', 'oak', null, 'walnut'), floor: { kind: 'stone', ramp: 'walnut' }, solid: 'walnut' },
  /** Outdoors: the wall is hidden behind the sky backdrop; the floor is grass. */
  outdoors: { wall: wall('plain', 'sky', 'sky', null, 'cream'), floor: { kind: 'carpet', ramp: 'moss' }, solid: 'stone' },
};

/** The roof (built-in background 2014) is red clay tiles. */
export const ROOF_RAMP = 'red';

/** Indoor looks for custom backgrounds without their picture, chosen by background id so rooms sharing a picture share a look. */
export const CUSTOM_LOOKS = [
  { wall: wall('stripes', 'cream', 'rose', null, 'cream'), floor: { kind: 'planks', ramp: 'oak' } },
  { wall: wall('pinstripe', 'cream', 'teal', 'walnut', 'cream'), floor: { kind: 'planks', ramp: 'oak' } },
  { wall: wall('damask', 'mustard', 'oak', 'walnut', 'cream'), floor: { kind: 'planks', ramp: 'walnut' } },
  { wall: wall('dots', 'teal', 'cream', 'cream', 'cream'), floor: { kind: 'planks', ramp: 'pine' } },
  { wall: wall('plaid', 'moss', 'teal', 'walnut', 'cream'), floor: { kind: 'carpet', ramp: 'plum' } },
  { wall: wall('floral', 'rose', 'leaf', 'walnut', 'cream'), floor: { kind: 'planks', ramp: 'pine' } },
  { wall: wall('diamonds', 'cream', 'red', 'oak', 'cream'), floor: { kind: 'planks', ramp: 'oak' } },
  { wall: wall('tile', 'cream', 'teal', null, 'oak'), floor: { kind: 'stone', ramp: 'stone' } },
  { wall: wall('boards', 'pine', 'oak', null, 'oak'), floor: { kind: 'planks', ramp: 'pine' } },
  { wall: wall('brick', 'red', 'red', null, 'stone'), floor: { kind: 'concrete', ramp: 'stone' } },
];

export const BUILTIN = {
  2000: 'simpleRoom',
  2001: 'paneledRoom',
  2002: 'basement',
  2003: 'childsRoom',
  2004: 'asianRoom',
  2005: 'unfinishedRoom',
  2006: 'swingersRoom',
  2007: 'bathroom',
  2008: 'library',
  2009: 'garden',
  2010: 'skywalk',
  2011: 'dirt',
  2012: 'meadow',
  2013: 'field',
  2014: 'roof',
  2015: 'sky',
  2016: 'stratosphere',
  2017: 'stars',
};

/** Built-in outdoor backgrounds and how they are drawn: ground = sky with hills and grass, sky = open sky, space = night sky. */
export const OUTDOOR = { garden: 'ground', meadow: 'ground', field: 'ground', roof: 'sky', sky: 'sky', stratosphere: 'space', stars: 'space' };

/** Gliderama's colour ramps, read from the game's palette (src/render/palette.ts) so the match is with what is drawn. */
const PALETTE = (() => {
  const text = fs.readFileSync(new URL('../src/render/palette.ts', import.meta.url), 'utf8');
  const body = text.slice(text.indexOf('export const R = {'), text.indexOf('} as const;'));
  const out = {};
  for (const m of body.matchAll(/(\w+): \[([^\]]*)\]/g))
    out[m[1]] = [...m[2].matchAll(/'#([0-9a-f]{6})'/gi)].map(([, h]) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
  return out;
})();
const WALL_RAMPS = 'stone cream oak walnut pine red rose plum navy teal moss mustard peach sky night steel leaf ink'.split(' ');

/** sRGB → CIE L*a*b* (D65). */
function lab([r, g, b]) {
  const lin = (v) => ((v /= 255) > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** How colourful a colour is (L*a*b* chroma). */
const chroma = (rgb) => Math.hypot(...lab(rgb).slice(1));
const NEUTRAL = ['stone', 'steel', 'ink', 'cream'];

/** The shades rooms are painted with (wallpaper, its pattern, floors): a ramp's two lightest but one. */
const PAINTED = Object.fromEntries(Object.entries(PALETTE).map(([n, r]) => [n, r.slice(-3, -1).map(lab)]));

/**
 * The ramp whose painted shades are closest to `rgb`. Hue counts more than lightness (Gliderama paints in light
 * shades: a deep red wall becomes a light red one, not brown), except for greys.
 */
export function rampFor(rgb, names = WALL_RAMPS) {
  const [L, a, b] = lab(rgb);
  const c = Math.hypot(a, b);
  const kL = 0.5 + 0.5 * Math.max(0, 1 - c / 30);
  // greys go to the greys (and white to cream)
  const pool = c < 8 ? names.filter((n) => NEUTRAL.includes(n)) : names;
  let best = pool[0];
  let bd = Infinity;
  for (const n of pool)
    for (const [L2, a2, b2] of PAINTED[n] ?? []) {
      const d = Math.hypot(kL * (L - L2), a - a2, b - b2);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
  return best;
}

/**
 * The closest look to a room's own picture (its summary from the converter's pictureSummary): a sky behind it
 * (Glider PRO skies are bright blue) or a starry night is the outdoors; otherwise the wallpaper takes the
 * picture's main colour (of two about as common, the more colourful, the other making its pattern), a lower wall
 * of another colour a wainscot, the floor strip the floor. Wood is boards; anything else plain (the pictures are
 * of whole rooms, so their texture says little about the wallpaper).
 */
export function pictureLook(pic, floorOpen) {
  if (pic.sky >= 0.4) return { look: LOOKS.outdoors, outdoor: floorOpen ? 'sky' : 'ground', solid: 'stone' };
  // black with stars (isolated bright specks), not a dark room with things drawn in it
  if (pic.dark >= 0.45 && pic.specks >= 0.003) return { look: LOOKS.outdoors, outdoor: 'space', solid: 'steel' };
  // two colours about as common (red flock on black): the more colourful one is the wallpaper, the other its pattern
  const sec = pic.wall2;
  const two = !!sec && pic.wall.share < 0.5 && sec.share >= 0.15;
  const [main, other] = two && chroma(sec.rgb) > chroma(pic.wall.rgb) ? [sec, pic.wall] : [pic.wall, sec];
  const base = rampFor(main.rgb);
  const second = other && other.share >= 0.12 ? rampFor(other.rgb) : null;
  const reds = ['red', 'rose'].includes(base);
  const pattern = ['oak', 'walnut', 'pine'].includes(base) ? 'boards' : two ? (reds ? 'damask' : 'pinstripe') : 'plain';
  // a lower wall of its own colour (panelling): a wainscot
  const lower = pic.lower && pic.lower.share >= 0.25 ? rampFor(pic.lower.rgb) : null;
  const wainscot = lower && lower !== base && lower !== rampFor(pic.wall.rgb) ? lower : null;
  const trim = ['ink', 'night', 'walnut'].includes(base) ? 'walnut' : 'cream';
  const fr = pic.floor ? rampFor(pic.floor.rgb) : 'oak';
  return { look: { wall: wall(pattern, base, second ?? base, wainscot, trim), floor: { kind: floorKind(fr), ramp: fr } }, solid: base };
}

/** What a floor of each colour is made of (the rest are carpets). */
const FLOOR_KINDS = { planks: 'oak walnut pine mustard', stone: 'stone steel ink night', tiles: 'cream sky peach' };
const floorKind = (ramp) => Object.keys(FLOOR_KINDS).find((k) => FLOOR_KINDS[k].split(' ').includes(ramp)) ?? 'carpet';

/** A room's look: { look, outdoor?, solid } from its background (and its picture's summary, when there is one). */
export function roomLook(room, pic, floorOpen) {
  const name = BUILTIN[room.background];
  if (name)
    return OUTDOOR[name] ? { look: LOOKS.outdoors, outdoor: OUTDOOR[name], solid: LOOKS.outdoors.solid } : { look: LOOKS[name], solid: LOOKS[name].solid };
  if (pic?.wall) return pictureLook(pic, floorOpen);
  // no picture to go by: structures are indoors, the rest outdoors (Sources/Room.c IsRoomAStructure)
  const structure = room.bounds !== 0 ? (room.bounds & 32) === 32 : room.background < 3300;
  if (!structure) return { look: LOOKS.outdoors, outdoor: floorOpen ? 'sky' : 'ground', solid: 'stone' };
  return { look: CUSTOM_LOOKS[room.background % CUSTOM_LOOKS.length], solid: 'oak' };
}

/** The colour of an obstacle that stands for something drawn in the picture (`rgb`, if known), else the room's. */
export function solidRamp(rgb, fallback) {
  if (!rgb) return fallback;
  const r = rampFor(rgb);
  // an invisible wall in the open air: drawn like the room's own obstacles
  return r === 'sky' || r === 'night' ? fallback : r;
}

// ---------------------------------------------------------------------------------------------
// Openings (Sources/Room.c DetermineRoomOpenings, DoesRoomHaveFloor/Ceiling, Interactions.c CheckEscape*).
// Side openings are y ranges, floor/ceiling openings x ranges, all in Glider PRO px.

const FULL_SIDE = [0, GP.roomH];
const FULL_WIDTH = [0, GP.roomW];

/** Which walls / floor / ceiling of a room are open, from its background, tiles and bounds code. */
export function shellOpenings(room, bnds) {
  const bg = room.background;
  const t = room.tiles;
  const o = { left: false, right: false, top: false, bottom: false, up: [], down: [] };
  if (bg >= 3000) {
    // custom backgrounds: the room's bounds (v2 houses) or the picture's 'bnds' resource
    const code = room.bounds !== 0 ? room.bounds >> 1 : (bnds[bg] ?? 0);
    o.left = !!(code & 1);
    o.top = !!(code & 2);
    o.right = !!(code & 4);
    o.bottom = !!(code & 8);
    return o;
  }
  const name = BUILTIN[bg];
  switch (name) {
    case 'dirt':
      // the walls are where tile 1 / tile 7 stand; tunnels up where tiles 5-6, down where tiles 2-3
      o.left = t[0] !== 1;
      o.right = t[7] !== 7;
      o.up = tileRuns(t, (k) => k === 5 || k === 6);
      o.down = tileRuns(t, (k) => k === 2 || k === 3);
      return o;
    case 'meadow':
      o.left = t[0] !== 6;
      o.right = t[7] !== 7;
      break;
    case 'garden':
    case 'skywalk':
    case 'field':
    case 'stratosphere':
    case 'stars':
      o.left = true;
      o.right = true;
      break;
    default:
      // rooms, roof, sky: tile 0 is the left wall and tile 7 the right wall
      o.left = t[0] !== 0;
      o.right = t[7] !== 7;
  }
  o.bottom = name === 'sky' || name === 'stratosphere' || name === 'stars';
  o.top = ['garden', 'meadow', 'field', 'roof', 'sky', 'stratosphere', 'stars'].includes(name);
  return o;
}

/** Contiguous runs of tiles matching `ok`, as x ranges (a glider needs both of its edges over such tiles). */
function tileRuns(tiles, ok) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= tiles.length; i++) {
    const hit = i < tiles.length && ok(tiles[i]);
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      out.push([start * GP.tileW, i * GP.tileW]);
      start = -1;
    }
  }
  return out;
}

/** The openings a room's objects add: doors and windows in the side walls, manholes in the floor. */
export function objectOpenings(room) {
  const o = { left: [], right: [], down: [] };
  for (const ob of room.objects) {
    const v = ob.topLeft?.v ?? 0;
    switch (ob.type) {
      // kIgnoreLeftWall / kIgnoreRightWall hot spots (Sources/ObjectRects.c)
      case 'doorInLf':
      case 'doorExLf':
        o.left.push([v + 52, v + 292]);
        break;
      case 'doorInRt':
      case 'doorExRt':
        o.right.push([v + 52, v + 292]);
        break;
      case 'windowInLf':
      case 'windowExLf':
        o.left.push([v + 96, v + 140]);
        break;
      case 'windowInRt':
      case 'windowExRt':
        o.right.push([v + 96, v + 140]);
        break;
      case 'manhole':
        // the glider may sink through while over the middle of the manhole: the whole lid is the opening here
        o.down.push([ob.bounds.left, ob.bounds.right]);
        break;
    }
  }
  return o;
}

/**
 * Walls of invisible obstacles: Glider PRO houses close a room's open sides (sky rooms, mostly) with invisible
 * obstacles, which the glider cannot get past. The y ranges they cover at the left and right edges, and the x ranges
 * at the floor and the ceiling (GP px): an obstacle within WALL_REACH of an edge blocks it there.
 */
export const WALL_REACH = 24;
/** The least gap a glider gets through: its height (and a little) through a side, its width through a floor or ceiling. */
export const MIN_GAP = { side: 28, floor: 48 };

export function obstacleWalls(room) {
  const o = { left: [], right: [], up: [], down: [] };
  for (const ob of room.objects) {
    if (ob.type !== 'invisObstacle' && ob.type !== 'invisBounce') continue;
    const b = ob.bounds;
    if (b.right <= b.left || b.bottom <= b.top) continue;
    if (b.left < WALL_REACH) o.left.push([b.top, b.bottom]);
    if (b.right > GP.roomW - WALL_REACH) o.right.push([b.top, b.bottom]);
    if (b.top < GP.ceiling + WALL_REACH / 2) o.up.push([b.left, b.right]);
    if (b.bottom > GP.floor - WALL_REACH / 2) o.down.push([b.left, b.right]);
  }
  return o;
}

/** Overlapping or touching intervals merged, in order. */
export function merge(intervals) {
  const out = [];
  for (const [a, b] of intervals.filter(([p, q]) => q > p).sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** What is left of `intervals` once `cuts` are taken out, the pieces at least `min` long. */
export function subtract(intervals, cuts, min = 0) {
  let out = merge(intervals);
  for (const [c0, c1] of cuts)
    out = out.flatMap(([a, b]) => {
      if (c1 <= a || c0 >= b) return [[a, b]];
      const below = [a, Math.min(b, c0)];
      const above = [Math.max(a, c1), b];
      return [below, above].filter(([p, q]) => q > p);
    });
  return out.filter(([a, b]) => b - a >= min);
}

/** Merge intervals: their hull (from, to), and the gaps between the merged pieces. */
export function hull(intervals) {
  if (!intervals.length) return null;
  const s = intervals.slice().sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let end = s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (s[i][0] > end) gaps.push([end, s[i][0]]);
    end = Math.max(end, s[i][1]);
  }
  return { from: s[0][0], to: end, gaps };
}

export const sideSpan = (h) => ({ from: Math.max(GR.ceiling, r1(Y(h.from))), to: Math.min(GR.floor, r1(Y(h.to))) });
export const floorSpan = (h) => ({ from: Math.max(0, r1(X(h.from))), to: Math.min(GR.roomW, r1(X(h.to))) });
export { FULL_SIDE, FULL_WIDTH };

// ---------------------------------------------------------------------------------------------
// Darkness (Sources/Room.c GetNumberOfLights): outdoor rooms and plain dirt are lit; otherwise a room needs a
// window, a door to the outside or a light that starts switched on.

const LIGHT_TYPES = ['ceilingLight', 'lightBulb', 'tableLamp', 'hipLamp', 'decoLamp', 'flourescent', 'trackLight', 'invisLight'];

export function startsDark(room) {
  const name = BUILTIN[room.background];
  if (['garden', 'skywalk', 'meadow', 'field', 'roof', 'sky', 'stratosphere', 'stars'].includes(name)) return false;
  if (name === 'dirt' && room.tiles.every((k) => k === 0)) return false;
  for (const ob of room.objects) {
    if (['doorInLf', 'doorInRt', 'windowInLf', 'windowInRt', 'wallWindow'].includes(ob.type)) return false;
    if (LIGHT_TYPES.includes(ob.type) && ob.initial) return false;
  }
  return true;
}

export { LIGHT_TYPES };

// ---------------------------------------------------------------------------------------------
// Object rects (Sources/StructuresInit2.c srcRects, Sources/ObjectRects.c GetObjectRect)

export const SRC = {
  floorVent: [48, 11],
  ceilingVent: [48, 11],
  floorBlower: [48, 15],
  ceilingBlower: [48, 15],
  sewerGrate: [48, 17],
  leftFan: [40, 55],
  rightFan: [40, 55],
  taper: [20, 59],
  candle: [32, 30],
  stubby: [20, 36],
  tiki: [27, 28],
  bbq: [64, 33],
  invisBlower: [24, 24],
  grecoVent: [48, 18],
  sewerBlower: [32, 12],
  redClock: [28, 17],
  blueClock: [28, 25],
  yellowClock: [28, 28],
  cuckoo: [40, 80],
  paper: [48, 21],
  battery: [16, 25],
  bands: [28, 23],
  greaseRt: [32, 27],
  greaseLf: [32, 27],
  foil: [55, 15],
  invisBonus: [24, 24],
  star: [32, 31],
  sparkle: [20, 19],
  helium: [56, 16],
  slider: [64, 16],
  upStairs: [160, 267],
  downStairs: [160, 267],
  mailboxLf: [94, 80],
  mailboxRt: [94, 80],
  floorTrans: [56, 15],
  ceilingTrans: [56, 15],
  doorInLf: [144, 322],
  doorInRt: [144, 322],
  doorExRt: [16, 322],
  doorExLf: [16, 322],
  windowInLf: [20, 170],
  windowInRt: [20, 170],
  windowExRt: [16, 170],
  windowExLf: [16, 170],
  invisTrans: [64, 32],
  deluxeTrans: [64, 64],
  lightSwitch: [15, 24],
  machineSwitch: [16, 24],
  thermostat: [15, 24],
  powerSwitch: [8, 8],
  knifeSwitch: [16, 24],
  invisSwitch: [12, 12],
  trigger: [12, 12],
  lgTrigger: [48, 48],
  soundTrigger: [32, 32],
  ceilingLight: [64, 20],
  lightBulb: [16, 28],
  tableLamp: [48, 70],
  hipLamp: [72, 276],
  decoLamp: [64, 212],
  flourescent: [64, 12],
  trackLight: [64, 24],
  invisLight: [16, 16],
  shredder: [73, 22],
  toaster: [48, 27],
  macPlus: [48, 58],
  guitar: [64, 172],
  tv: [92, 77],
  coffee: [43, 64],
  outlet: [16, 24],
  vcr: [96, 22],
  stereo: [128, 53],
  microwave: [92, 59],
  cinderBlock: [40, 62],
  flowerBox: [80, 32],
  cds: [16, 30],
  customPict: [72, 34],
  balloon: [24, 30],
  copterLf: [32, 30],
  copterRt: [32, 30],
  dartLf: [64, 19],
  dartRt: [64, 19],
  ball: [32, 32],
  drip: [16, 12],
  fish: [36, 33],
  cobweb: [54, 45],
};

/** The object's rectangle in GP px (top, left, bottom, right). */
export function objectRect(ob) {
  if (ob.bounds) return ob.bounds;
  const [w, h] = SRC[ob.type] ?? [16, 16];
  const { v, h: left } = ob.topLeft;
  switch (ob.type) {
    case 'liftArea':
      return { top: v, left, bottom: v + ob.tall * 2, right: left + ob.distance };
    case 'invisTrans':
      return { top: v, left, bottom: v + ob.tall, right: left + 64 + ob.wide };
    case 'deluxeTrans':
      return { top: v, left, bottom: v + (ob.tall & 0xff) * 4, right: left + ((ob.tall >> 8) & 0xff) * 4 };
    case 'flourescent':
    case 'trackLight':
      return { top: v, left, bottom: v + h, right: left + ob.length };
    default:
      return { top: v, left, bottom: v + h, right: left + w };
  }
}

// ---------------------------------------------------------------------------------------------
// Objects. Each handler turns one Glider PRO object into Gliderama items (or none, saying why). `c` is the room
// context: { room, key, emit(item), drop(type, why), missing(type, how) (drawn as something else), approx(type, how)
// (not quite as the original works), link(ob) → link info, group(ob) → switch group, ... } (see the converter).

const center = (b) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

/** A GP bottom this low stands on the floor (fixed-size art is moved down onto the Gliderama floor line). */
const onFloor = (bottom) => bottom >= FLOOR_SNAP;

/**
 * Where fixed-size art goes (Gliderama's kinds default to the Glider PRO size scaled): its left edge where the
 * original's is, its top where the original's is, or standing on the floor line when the original stands on the floor.
 */
function placed(ob) {
  const [w, h] = SRC[ob.type];
  const { h: left, v: top } = ob.topLeft;
  const hh = r1(h * SY);
  return { x: r1(X(left)), y: onFloor(top + h) ? GR.floor - hh : r1(Y(top)), w: r1(X(w)), h: hh };
}

/** Glider PRO's delays count 3 frames at 30 a second: tenths of a second (Sources/Dynamics3.c AddDynamicObject). */
const seconds = (delay) => r2(delay / 10);

/** On a switch group when some switch turns it on and off, otherwise on or off for good as the house starts it. */
function poweredBy(ob, c) {
  const g = c.group(ob);
  return g.group ? g : ob.initial ? {} : { on: false };
}

/** The look of each blower's grille (paintVentGrille in src/world/kinds/home.ts); plain vents have the default. */
const VENT_LOOK = { sewerGrate: 'grate', sewerBlower: 'grate', floorBlower: 'blower', grecoVent: 'greco' };

/** Floor-standing blowers (vents, grates). */
function floorBlower(ob, c) {
  const [w, h] = SRC[ob.type];
  const top = ob.topLeft.v - ob.distance;
  const cx = ob.topLeft.h + w / 2;
  const group = c.group(ob);
  const look = VENT_LOOK[ob.type] ? { look: VENT_LOOK[ob.type] } : {};
  if (ob.topLeft.v >= FLOOR_SNAP) {
    let reach = Y(top);
    if (top <= GP.ceiling + 16 && c.opensUpAt(cx)) reach = -AIR.carryOn;
    c.emit({
      t: 'floorVent',
      x: r1(X(ob.topLeft.h)),
      y: GR.floor - 4,
      w: r1(X(w)),
      power: AIR.ventPower(ob.distance),
      reach: r1(reach),
      spread: AIR.ventSpread,
      ...look,
      ...group,
    });
  } else {
    // a vent standing on furniture: its grille there (the top of what it stands on 6 px below the grille's top), and
    // invisible rising air from it
    c.emit({ t: 'grille', x: r1(X(ob.topLeft.h)), y: r1(Y(ob.topLeft.v + h) - 6), w: r1(X(w)), ...look });
    c.emit(current('up', cx, ob.topLeft.v, top, AIR.ventPower(ob.distance), group, c));
  }
}

/** An invisible rising / sinking column in Gliderama px from GP coordinates (a rising one that reaches the top of
 * the room carries on through a ceiling opening above it, as vents do). */
function current(dir, cx, from, to, power, group = {}, c = null) {
  let y0 = Y(Math.min(from, to));
  const y1 = Y(Math.max(from, to));
  if (dir === 'up' && Math.min(from, to) <= GP.ceiling + 16 && c?.opensUpAt(cx)) y0 = -AIR.carryOn;
  return { t: 'current', dir, x: r1(X(cx) - AIR.columnW / 2), y: r1(y0), w: AIR.columnW, h: r1(Math.max(12, y1 - y0)), power, ...group };
}

function band(dir, x0, x1, cy, power, group = {}) {
  const gx0 = X(Math.min(x0, x1));
  const gx1 = X(Math.max(x0, x1));
  return { t: 'current', dir, x: r1(gx0), y: r1(Y(cy) - AIR.bandH / 2), w: r1(Math.max(12, gx1 - gx0)), h: AIR.bandH, power, ...group };
}

/**
 * Candles, tapers, tiki torches, barbecues: a flame (hazard + small thermal) and the lift above it. The deadly 24 px
 * above the object's top are the flame (Sources/ObjectRects.c); a tiki torch's pole goes down to the ground
 * (ObjectDraw.c DrawTiki), a barbecue stands on its legs.
 */
function flame(ob, c) {
  const [w, h] = SRC[ob.type];
  const { h: left, v: top } = ob.topLeft;
  const cx = left + w / 2 - (ob.type === 'candle' ? 2 : ob.type === 'stubby' ? 1 : 0);
  const fy = r1(Y(top));
  // (the candle object's x is 3 px left of its flame)
  if (ob.type === 'tiki') c.emit({ t: 'tiki', x: r1(X(cx) - 3), y: fy, wax: GR.floor - 8 - fy });
  else if (ob.type === 'bbq') c.emit({ t: 'bbq', x: r1(X(cx) - 3), y: fy, wax: Math.max(20, r1((onFloor(top + h) ? GR.floor : Y(top + h)) - fy - 6)) });
  else c.emit({ t: 'candle', x: r1(X(cx) - 3), y: fy, wax: Math.max(8, r1(Y(top + h) - fy - 8)) });
  // above the 24 deadly pixels over the flame the column lifts the glider (a few pixels of it are not worth having)
  if (ob.distance >= 64) c.emit(current('up', cx, top - 24, top - ob.distance, AIR.upPower(ob.distance), {}, c));
}

function fan(ob, c) {
  const dir = ob.type === 'leftFan' ? -1 : 1;
  const hx = X(ob.topLeft.h + 20);
  const hy = Y(ob.topLeft.v + 28);
  const bottom = ob.topLeft.v + 55 >= FLOOR_SNAP ? GR.floor : Y(ob.topLeft.v + 55);
  const y = r1(hy - 16);
  c.emit({ t: 'fan', x: r1(hx - 16), y, dir, power: AIR.fanPower, reach: r1(X(ob.distance) + 25), stand: Math.max(0, r1(bottom - y - 32)), ...c.group(ob) });
}

function invisBlower(ob, c) {
  const { h, v } = ob.topLeft;
  const d = ob.distance;
  const g = c.group(ob);
  switch (ob.vector & 0x0f) {
    case 1:
      return c.emit(current('up', h + 12, v + 24, v - d, AIR.upPower(d), g, c));
    case 4:
      return c.emit(current('down', h + 12, v, v + d + 24, AIR.downPower, g));
    case 2:
      return c.emit(band('right', h, h + d + 24, v + 12, AIR.sidePower, g));
    case 8:
      return c.emit(band('left', h - d, h + 24, v + 12, AIR.sidePower, g));
    default:
      c.drop(ob.type, `unknown direction ${ob.vector}`);
  }
}

function liftArea(ob, c) {
  const b = objectRect(ob);
  const g = c.group(ob);
  const dir = { 1: 'up', 2: 'right', 4: 'down', 8: 'left' }[ob.vector & 0x0f];
  if (!dir) return c.drop(ob.type, `unknown direction ${ob.vector}`);
  const r = rectOf(b);
  const power = dir === 'up' ? AIR.upPower(r.h) : dir === 'down' ? AIR.downPower : AIR.sidePower;
  // rising air up to the ceiling carries on through an opening there, as from a vent
  if (dir === 'up' && b.top <= GP.ceiling + 16 && c.opensUpAt((b.left + b.right) / 2)) {
    r.h += r.y + AIR.carryOn;
    r.y = -AIR.carryOn;
  }
  // as wide as the invisible columns (a plane weaves to climb), as tall as the sideways bands
  if (dir === 'up' || dir === 'down') {
    const w = Math.max(r.w, AIR.columnW);
    r.x = r1(r.x + r.w / 2 - w / 2);
    r.w = w;
  } else {
    const h = Math.max(r.h, AIR.bandH);
    r.y = r1(r.y + r.h / 2 - h / 2);
    r.h = h;
  }
  c.emit({ t: 'current', dir, x: r.x, y: r.y, w: Math.max(12, r.w), h: Math.max(12, r.h), power, ...g });
}

function ceilingBlower(ob, c) {
  const [w] = SRC[ob.type];
  c.emit({
    t: 'ceilingVent',
    x: r1(X(ob.topLeft.h)),
    y: GR.ceiling,
    w: r1(X(w)),
    power: AIR.ceilingPower,
    reach: r1(Math.min(GR.floor, Y(ob.topLeft.v + ob.distance))),
    ...c.group(ob),
  });
  if (ob.type === 'ceilingBlower') c.missing(ob.type, 'drawn as a ceiling vent');
}

/** Furniture and clutter drawn by `kind` over the original's rect (standing on the floor when the original does). */
const standing =
  (kind, extra = {}) =>
  (ob, c) => {
    const r = rectOf(objectRect(ob), true);
    c.emit({ t: kind, ...r, ...extra });
  };

/**
 * A table top on a pedestal, the bounds being the top (Sources/ObjectDraw.c DrawTable: the pedestal goes down to
 * the floor); a stool is its seat on a pole down to the floor (DrawStool).
 */
const pedestal =
  (kind, extra = {}) =>
  (ob, c) => {
    const top = rectOf(ob.bounds);
    c.emit({ t: kind, x: top.x, y: top.y, w: top.w, h: Math.max(top.h, GR.floor - top.y), ...extra });
  };

/** Fixed-size art (appliances, the guitar...) where the original stands. */
const fixed =
  (kind, extra = {}) =>
  (ob, c) => {
    const { x, y } = placed(ob);
    c.emit({ t: kind, x, y, ...(typeof extra === 'function' ? extra(ob, c) : extra) });
  };

/** How far past a room's edge a block at that edge carries on (as the room's own walls do, see src/world/colliders). */
export const EDGE = 40;

/**
 * Invisible obstacles stand for things drawn into the original's pictures (walls, pipes, ledges): without the
 * picture they are drawn as plain blocks in its colour there, so that nothing in a room is solid unseen. One that
 * reaches an edge of the room (up past the ceiling line or down past the floor line too: the glider could not get
 * between it and the edge there) carries on past it, like a wall: a block in the room above or next door meets it
 * there, with no seam between the rooms to slip along.
 */
function obstacle(ob, c) {
  const r = rectOf(ob.bounds);
  if (r.w <= 0 || r.h <= 0) return c.drop(ob.type, 'empty rectangle');
  const b = ob.bounds;
  if (b.top <= GP.ceiling) {
    r.h += r.y + EDGE;
    r.y = -EDGE;
  }
  if (b.bottom >= GP.floor) r.h = GR.roomH + EDGE - r.y;
  if (b.left <= 0) {
    r.w += r.x + EDGE;
    r.x = -EDGE;
  }
  if (b.right >= GP.roomW) r.w = GR.roomW + EDGE - r.x;
  c.emit({ t: 'solid', ...r, ramp: c.solidRamp(ob) });
}

function books(ob, c) {
  const b = ob.bounds;
  const x0 = X(b.left);
  const w = X(b.right) - x0;
  const n = Math.max(2, Math.min(9, Math.round((Y(b.bottom) - Y(b.top)) / 6)));
  const stacks = Math.max(1, Math.round(w / 30));
  for (let k = 0; k < stacks; k++) c.emit({ t: 'books', x: r1(x0 + k * (w / stacks)), y: r1(Y(b.bottom)), n: Math.max(2, n - (k % 2)), v: k });
}

/** A prize: Gliderama pickups sit at the prize's centre (the stars that finish the house get explicit ids). */
const prize =
  (t, extra = {}) =>
  (ob, c) => {
    const p = center(objectRect(ob));
    c.emit({ t, x: r1(X(p.x)), y: r1(Y(p.y)), ...extra, ...(extra.goal ? { id: c.pickupId(t) } : {}) });
  };

function stairsUp(ob, c) {
  // GP stairs rise to the left: the way up is the doorway at the top-left of the flight
  c.emit({ t: 'stairsUp', x: r1(X(ob.topLeft.h)), y: GR.floor, w: r1(X(160)), dir: -1, top: STAIRS_TOP, v: c.seed % 3 });
}
/** Landing height of a flight of stairs (the doorway above it reaches up to the top of the room). */
export const STAIRS_TOP = 112;

function stairsDown(ob, c) {
  c.emit({ t: 'stairsDown', x: r1(X(ob.topLeft.h)), y: GR.wallBase, w: r1(X(160)), dir: 1, v: c.seed % 3 });
}

/** Transport trigger rects (Sources/ObjectRects.c CreateActiveRects). */
export function transportTrigger(ob) {
  const { h, v } = ob.topLeft;
  switch (ob.type) {
    case 'mailboxLf':
      return { top: v + 16, left: h - 42, bottom: v + 56, right: h + 30 };
    case 'mailboxRt':
      return { top: v + 16, left: h + 79, bottom: v + 56, right: h + 151 };
    case 'floorTrans':
      return { top: v - 33, left: h - 8, bottom: v + 15, right: h + 68 };
    case 'ceilingTrans':
      return { top: v, left: h - 8, bottom: v + 48, right: h + 68 };
    default:
      return objectRect(ob);
  }
}

/** Where a glider coming out of `dest` appears (Sources/Transit.c ReadyGliderFromTransit), Gliderama px. */
export function transportArrival(dest) {
  const b = objectRect(dest);
  const cx = (b.left + b.right) / 2;
  switch (dest.type) {
    case 'mailboxLf':
      return { x: r1(X(b.right - 64 - 24)), y: r1(Y(b.bottom - 39)), facing: -1 };
    case 'mailboxRt':
      return { x: r1(X(b.left + 79 + 24)), y: r1(Y(b.bottom - 39)), facing: 1 };
    case 'ceilingTrans':
      return { x: r1(X(cx)), y: r1(Y(b.bottom) + 24), facing: 1 };
    case 'floorTrans':
      // out of a floor duct: a little above it, so the plane is not on the floor already
      return { x: r1(X(cx)), y: r1(Y(b.top) - 44), facing: 1 };
    default:
      return { x: r1(X(cx)), y: r1(Y((b.top + b.bottom) / 2)), facing: 1 };
  }
}

function transport(ob, c) {
  const link = c.link(ob);
  const r = rectOf(transportTrigger(ob));
  const look = ob.type === 'floorTrans' ? 'floorDuct' : ob.type === 'ceilingTrans' ? 'ceilingDuct' : undefined;
  // a mailbox is drawn whichever end of the journey it is (the plane goes in and comes out of its open door)
  const mailbox = ob.type === 'mailboxLf' || ob.type === 'mailboxRt';
  const box = () => (mailbox ? c.emit({ t: 'mailbox', ...placed(ob), dir: ob.type === 'mailboxLf' ? -1 : 1 }) : null);
  if (!link || !link.target) {
    // the far end of another transport: the glider only comes out of it (a duct is still drawn)
    if (c.isArrival(ob)) {
      if (look) c.emit({ t: 'transport', ...r, look });
      box();
      return;
    }
    return c.drop(ob.type, link ? 'linked to a missing room or object' : 'not linked to another transport');
  }
  const a = transportArrival(link.target);
  // deluxe transports carry their on/off state in the low nibble of `wide` (initial state in the high nibble)
  const off = ob.type === 'deluxeTrans' && !((ob.wide >> 4) & 0x0f);
  box();
  c.emit({ t: 'transport', ...r, to: link.key, ax: a.x, ay: a.y, facing: a.facing, ...(look ? { look } : {}), ...c.group(ob, !off) });
}

/** The switches the glider can see, and how each is drawn (the `switch` object's looks; a light switch is the default). */
export const SWITCH_LOOKS = { lightSwitch: null, machineSwitch: 'machine', thermostat: 'thermostat', powerSwitch: 'power', knifeSwitch: 'knife' };
export const TRIGGERS = ['trigger', 'lgTrigger'];

/**
 * What a switch flips: the object it is linked to ({ room, key, target }, see the converter's link), or null. A
 * trigger flips nothing itself: it fires what it is linked to a moment later (Sources/Triggers.c FireTrigger), and
 * when that is another switch, it is as if the glider had flown through that one; a grease can it spills.
 */
export function flipped(ob, link) {
  const l = link(ob);
  if (!l?.target) return null;
  if (!TRIGGERS.includes(ob.type)) return l;
  const t = l.target;
  if (GREASE.includes(t.type)) return l;
  if (t.family !== 'switch' || TRIGGERS.includes(t.type) || t.type === 'soundTrigger') return null;
  const l2 = link(t);
  return l2?.target ? l2 : null;
}

const GREASE = ['greaseRt', 'greaseLf'];
/**
 * Things Gliderama can switch on and off besides the lights (their `group`): air, switched transports, the menagerie,
 * and grease cans, which a switch spills (Sources/Interactions.c, Triggers.c).
 */
const SWITCHABLE = new Set(['deluxeTrans', 'balloon', 'copterLf', 'copterRt', 'dartLf', 'dartRt', 'ball', 'fish', 'outlet', 'shredder', ...GREASE]);
/** Things Glider PRO's switches cannot change either (Sources/Objects.c SetObjectState). */
const UNSWITCHABLE = new Set('taper candle stubby tiki bbq cinderBlock flowerBox cds customPict guitar cobweb slider invisTrans'.split(' '));

/** Why a switch has nothing to switch here. */
function idleSwitch(ob, c) {
  const l = c.link(ob);
  const t = l?.target;
  if (!l) return 'not linked to anything';
  if (!t) return 'linked to a missing object';
  const what = (f) => {
    if (f.family === 'bonus') return `takes the ${f.type} away (it stays here)`;
    if (UNSWITCHABLE.has(f.type) || ['furniture', 'clutter', 'switch'].includes(f.family) || (f.family === 'transport' && f.type !== 'deluxeTrans'))
      return `switches the ${f.type} (which does nothing, as in Glider PRO)`;
    return `switches the ${f.type} on and off (no effect here)`;
  };
  if (!TRIGGERS.includes(ob.type)) return what(t);
  if (t.family !== 'switch') return `sets off the ${t.type} (it goes off by itself here)`;
  const f = flipped(ob, c.link)?.target;
  return f ? `fires the ${t.type}, which ${what(f)}` : `fires the ${t.type} (which does nothing)`;
}

function switchObj(ob, c) {
  const visible = ob.type in SWITCH_LOOKS;
  const [w, h] = SRC[ob.type];
  const x = r1(X(ob.topLeft.h + (w - 12) / 2));
  const y = r1(Y(ob.topLeft.v + 2));
  const look = SWITCH_LOOKS[ob.type] ? { look: SWITCH_LOOKS[ob.type] } : {};
  const hidden = visible ? {} : { hidden: true, w: r1(X(w)), h: r1(SY * h) };
  // a trigger fires `delay` × 3 frames (at 30 a second) after the glider goes through, if it is still in the room
  // (Sources/Triggers.c ArmTrigger; RoomGraphics.c DrawLocale zeroes the triggers in a new room)
  const delay = TRIGGERS.includes(ob.type) && ob.delay > 0 ? { delay: ob.delay / 10 } : {};
  const l = flipped(ob, c.link);
  const t = l?.target;
  if (t?.family === 'light') {
    // a light switch: the lights of the room the light is in
    c.emit({ t: 'switch', x, y, ...look, ...(l.key !== c.key ? { room: l.key } : {}), ...hidden, ...delay });
  } else if (t && (t.family === 'blower' || SWITCHABLE.has(t.type))) {
    c.emit({ t: 'switch', x, y, ...look, group: c.groupName(l.room, t.slot), ...hidden, ...delay });
  } else if (visible) {
    // nothing here for it to switch: it still flips (a group of its own, that nothing listens to)
    c.emit({ t: 'switch', x, y, ...look, group: c.groupName(c.room, ob.slot) });
    return c.approx(ob.type, idleSwitch(ob, c));
  } else return c.drop(ob.type, idleSwitch(ob, c), true);
}

function light(ob, c) {
  const b = objectRect(ob);
  const cx = r1(X((b.left + b.right) / 2));
  switch (ob.type) {
    case 'ceilingLight':
      c.emit({ t: 'pendant', x: cx, len: 6, v: 2 });
      return;
    case 'flourescent':
    case 'trackLight':
      c.emit({ t: ob.type === 'flourescent' ? 'tubeLight' : 'trackLight', x: r1(X(b.left)), y: r1(Y(b.top)), w: r1(X(b.right) - X(b.left)) });
      return;
    case 'lightBulb':
      c.emit({ t: 'pendant', x: cx, len: Math.max(6, r1(Y(b.top) - GR.ceiling)), v: 2 });
      return;
    case 'tableLamp':
      c.emit({ t: 'deskLamp', x: r1(X(b.left + 4)), y: r1(Y(b.bottom) - 48), v: c.seed % 3 });
      return;
    case 'hipLamp':
    case 'decoLamp':
      // floor lamps: a torchiere bowl (hip lamp) or a fringed shade (deco lamp)
      c.emit({ t: 'floorLamp', ...placed(ob), v: ob.type === 'hipLamp' ? 1 : 0 });
  }
}

function drip(ob, c) {
  const b = objectRect(ob);
  const x = r1(X((b.left + b.right) / 2));
  const floorY = Math.min(GR.floor - 2, r1(Y(b.top + ob.length)));
  c.emit({ t: 'drip', x, y: r1(Y(b.top + 6)), every: r2(Math.max(0.8, Math.min(3, 0.6 + ob.delay * 0.1))), floorY });
}

function clutterAs(kind, extra = {}) {
  return (ob, c) => {
    const r = rectOf(ob.bounds);
    c.emit({ t: kind, ...r, ...extra });
  };
}

// The menagerie (src/game/objects/enemies.ts): what moves starts where Glider PRO's does (Sources/Dynamics3.c
// AddDynamicObject), centred where the art is a different size, and keeps its delay; a switch turns it on and off.

/** A balloon rises from the floor (x is its left: the original's centre less half its 26 px). */
function balloon(ob, c) {
  c.emit({ t: 'balloon', x: r1(X(ob.topLeft.h + 12) - 13), y: GR.floor, delay: seconds(ob.delay), v: 0, ...poweredBy(ob, c) });
}

/** Toy helicopters set off from under the ceiling, paper darts from the wall behind them at the original's height. */
const flier = (t, dir) => (ob, c) =>
  c.emit({ t, x: r1(X(ob.topLeft.h)), y: t === 'copter' ? GR.ceiling : r1(Y(ob.topLeft.v)), dir, delay: seconds(ob.delay), ...poweredBy(ob, c) });

/** A ball bounces `height` up from where its bottom is. */
function ball(ob, c) {
  const { h: left, v: top } = ob.topLeft;
  c.emit({ t: 'ball', x: r1(X(left + 16) - 17), y: onFloor(top + 32) ? GR.floor : r1(Y(top + 32)), height: r1(ob.length * SY), v: 0, ...poweredBy(ob, c) });
}

/** A goldfish in its bowl (46 × 36 here, centred on the original's, standing where it stands) leaps `height` out of it. */
function fish(ob, c) {
  const { h: left, v: top } = ob.topLeft;
  const bottom = onFloor(top + 33) ? GR.floor : r1(Y(top + 33));
  c.emit({ t: 'fish', x: r1(X(left + 18) - 23), y: bottom - 36, height: r1(ob.length * SY), delay: seconds(ob.delay), ...poweredBy(ob, c) });
}

/** An electric outlet (an 18 × 24 plate on the original's centre) sparks every `delay`. */
function outlet(ob, c) {
  const { h: left, v: top } = ob.topLeft;
  c.emit({ t: 'outlet', x: r1(X(left + 8) - 9), y: r1(Y(top + 12) - 12), delay: seconds(ob.delay), ...poweredBy(ob, c) });
}

/** A paper shredder (90 × 24, centred on the original, on what it stands on): deadly while it is on. */
function shredder(ob, c) {
  const { h: left, v: top } = ob.topLeft;
  c.emit({ t: 'shredder', x: r1(X(left + 36.5) - 45), y: (onFloor(top + 22) ? GR.floor : r1(Y(top + 22))) - 24, ...poweredBy(ob, c) });
}

/**
 * A grease can (its foot where the original's is) tips over when clipped, spilling a slick `length` long (or lies
 * spilt); a switch or trigger wired to it spills it too (its `group`).
 */
function grease(ob, c) {
  const { h: left, v: top } = ob.topLeft;
  const reach = ob.length > 5 ? { reach: r1(X(ob.length)) } : {};
  const y = onFloor(top + 27) ? GR.floor - 29 : r1(Y(top));
  const state = ob.initial ? c.group(ob, true) : { spilled: true };
  c.emit({ t: 'grease', x: r1(X(left)), y, h: 29, dir: ob.type === 'greaseRt' ? 1 : -1, ...reach, ...state });
}

function plantFrom(ob, c) {
  const b = ob.bounds;
  // flowers standing in a vase: the vase's plant has the leaves already
  const inVase =
    ob.type === 'flower' &&
    c.room.objects.some(
      (v) => (v.type === 'vase1' || v.type === 'vase2') && v.bounds.left < b.right && v.bounds.right > b.left && Math.abs(v.bounds.top - b.bottom) <= 14,
    );
  if (inVase) return c.missing('flower', 'in a vase: part of the vase plant');
  const w = Math.max(16, Math.min(40, r1(X(b.right - b.left) * 0.6)));
  const cx = X((b.left + b.right) / 2);
  const bottom = b.bottom >= FLOOR_SNAP + 10 ? GR.floor : Y(b.bottom);
  const pot = Math.min(22, Math.max(12, r1((Y(b.bottom) - Y(b.top)) * 0.4)));
  c.emit({ t: 'plant', x: r1(cx - w / 2), y: r1(bottom - pot), w, tall: Math.max(16, r1(Y(b.bottom) - Y(b.top) - pot)), v: c.seed % 4 });
}

/**
 * Things Glider PRO draws but the glider flies through (Sources/ObjectRects.c gives them nothing to touch: pictures,
 * plants, windows, the teddy bear, the fireplace, the lamps). The Gliderama kinds they are drawn as that are solid
 * are marked `solid: false` here: nothing to bump into (a fireplace in Leviathan has a transport in its hearth).
 */
const PICTURES = 'ozma mirror mousehole fireplace flower wallWindow bear calendar vase1 vase2 bulletin cloud faucet rug';
const LAMPS = 'ceilingLight lightBulb tableLamp hipLamp decoLamp flourescent trackLight';
export const SCENERY = new Set(`${PICTURES} ${LAMPS}`.split(' '));
/** The Gliderama kinds scenery is drawn as that are solid in Gliderama's own rooms. */
export const SOLID_SCENERY = new Set(['fireplace', 'window', 'bear', 'plant', 'pendant', 'floorLamp', 'deskLamp']);

/** Handlers by Glider PRO object type. `null` = dropped with the reason given. */
export const OBJECT_MAP = {
  floorVent: floorBlower,
  floorBlower: floorBlower,
  sewerGrate: floorBlower,
  grecoVent: floorBlower,
  sewerBlower: floorBlower,
  ceilingVent: ceilingBlower,
  ceilingBlower: ceilingBlower,
  leftFan: fan,
  rightFan: fan,
  taper: flame,
  candle: flame,
  stubby: flame,
  tiki: flame,
  bbq: flame,
  invisBlower,
  liftArea,

  table: pedestal('table', { v: 0 }),
  deckTable: pedestal('table', { v: 2 }),
  stool: pedestal('stool'),
  shelf: (ob, c) => c.emit({ t: 'shelf', x: r1(X(ob.bounds.left)), y: r1(Y(ob.bounds.top)), w: r1(X(ob.bounds.right - ob.bounds.left)), v: c.seed % 3 }),
  cabinet: standing('cabinet'),
  filingCabinet: standing('filingCabinet'),
  counter: standing('counter'),
  dresser: standing('dresser', { v: 1 }),
  wasteBasket: standing('wasteBasket'),
  milkCrate: standing('milkCrate'),
  trunk: standing('trunk'),
  books,
  invisObstacle: obstacle,
  invisBounce: obstacle,
  manhole: () => {}, // an opening in the floor (objectOpenings)

  // bonus clocks are collected like stars (not the goal stars)
  redClock: prize('star', { look: 'clock', v: 0 }),
  blueClock: prize('star', { look: 'clock', v: 1 }),
  yellowClock: prize('star', { look: 'clock', v: 2 }),
  cuckoo: prize('star', { look: 'cuckoo' }),
  invisBonus: prize('star'),
  star: prize('star', { goal: true }),
  paper: prize('sheet'),
  battery: prize('battery'),
  helium: prize('helium'),
  bands: prize('bands'),
  foil: prize('tape'),
  greaseRt: grease,
  greaseLf: grease,
  sparkle: (ob, c) => c.emit({ t: 'sparkle', x: r1(X(ob.topLeft.h + 10)), y: r1(Y(ob.topLeft.v + 9.5)) }),
  slider: null,

  upStairs: stairsUp,
  downStairs: stairsDown,
  mailboxLf: transport,
  mailboxRt: transport,
  floorTrans: transport,
  ceilingTrans: transport,
  invisTrans: transport,
  deluxeTrans: transport,
  // doors and windows in the side walls are openings (objectOpenings); the room shell draws their casings
  doorInLf: () => {},
  doorInRt: () => {},
  doorExRt: () => {},
  doorExLf: () => {},
  windowInLf: () => {},
  windowInRt: () => {},
  windowExRt: () => {},
  windowExLf: () => {},

  lightSwitch: switchObj,
  machineSwitch: switchObj,
  thermostat: switchObj,
  powerSwitch: switchObj,
  knifeSwitch: switchObj,
  invisSwitch: switchObj,
  trigger: switchObj,
  lgTrigger: switchObj,
  soundTrigger: null,

  ceilingLight: light,
  lightBulb: light,
  tableLamp: light,
  hipLamp: light,
  decoLamp: light,
  flourescent: light,
  trackLight: light,
  invisLight: () => {}, // lighting only (startsDark)

  shredder,
  toaster: (ob, c) => c.emit({ t: 'toaster', x: r1(X(ob.topLeft.h + 4)), y: r1(Y(ob.topLeft.v + 27) - 24) }),
  macPlus: fixed('computer', (ob) => (ob.initial ? {} : { on: false })),
  guitar: fixed('guitar', { w: 80, h: 183 }),
  tv: fixed('tv', (ob) => (ob.initial ? {} : { on: false })),
  coffee: fixed('coffee'),
  outlet,
  vcr: fixed('vcr'),
  stereo: fixed('stereo'),
  microwave: fixed('microwave'),
  cinderBlock: fixed('cinderBlock'),
  flowerBox: fixed('flowerBox'),
  cds: fixed('cds'),
  customPict: null,

  balloon,
  copterLf: flier('copter', -1),
  copterRt: flier('copter', 1),
  dartLf: flier('dart', -1),
  dartRt: flier('dart', 1),
  ball,
  drip,
  fish,
  cobweb: (ob, c) => c.emit({ t: 'cobweb', x: r1(X(ob.topLeft.h)), y: r1(Y(ob.topLeft.v)), w: r1(X(54)), h: r1(45 * SY) }),

  ozma: clutterAs('frame', { v: 1 }),
  mirror: clutterAs('mirror', { v: 0 }),
  // a mouse hole is in the skirting, its foot where the wall meets the floor
  mousehole: (ob, c) => {
    const r = rectOf(ob.bounds);
    c.emit({ t: 'mousehole', x: r.x, y: GR.wallBase - r.h, w: r.w, h: r.h });
  },
  fireplace: (ob, c) => {
    const r = rectOf(ob.bounds);
    c.emit({ t: 'fireplace', x: r.x, y: r.y, w: Math.max(120, r.w), h: GR.floor - r.y });
  },
  flower: plantFrom,
  wallWindow: clutterAs('window'),
  bear: standing('bear'),
  calendar: clutterAs('calendar'),
  vase1: plantFrom,
  vase2: plantFrom,
  bulletin: clutterAs('bulletin'),
  cloud: clutterAs('cloud'),
  faucet: clutterAs('faucet'),
  rug: (ob, c) => c.emit({ t: 'rug', x: r1(X(ob.bounds.left)), y: GR.floor - 12, w: r1(X(ob.bounds.right - ob.bounds.left)), v: c.seed % 4 }),
  chimes: clutterAs('chimes'),
};

/**
 * Things that do nothing to be seen while switched off (Sources/Play.c SetObjectsToDefaults starts each as its
 * `initial` says): dropped when they start off and no switch ever turns them on, like the blowers.
 */
export const GONE_WHEN_OFF = ['balloon', 'copterLf', 'copterRt', 'dartLf', 'dartRt', 'drip', 'sparkle'];

/** Why each dropped type is dropped. */
export const DROPPED = {
  slider: 'invisible sliding surface (Gliderama surfaces are solid anyway)',
  soundTrigger: 'plays a sound only',
  customPict: "a picture from the house's own resources: not converted",
};

/**
 * Types whose art Gliderama is missing (for the art list): drawn with the art of something else (a ceiling blower
 * as a ceiling vent, foil as tape). Invisible objects and custom pictures aside.
 */
export const MISSING_ART = new Set('ceilingBlower foil ozma flower vase1 vase2'.split(' '));

// ---------------------------------------------------------------------------------------------
// Houses: credits and per-house settings. Authors are as credited in the Glider PRO release (README.md), or
// in the house's own banner / 'vers' resource where the release says nothing.

export const HOUSES = {
  'Demo House': { authors: ['John Calhoun', 'Kim Money'], blurb: 'A small beginner house that acts as a tutorial.' },
  'CD Demo House': { authors: ['John Calhoun', 'Kim Money'], blurb: 'Sample rooms from the CD houses.' },
  'Davis Station': { authors: ['Jonathan Chin (alias Paul Finn)', 'John Calhoun'] },
  Metropolis: { authors: ['Jonathan Chin (alias Paul Finn)', 'John Calhoun'], blurb: 'Home of a thousand drips, darts and ducts.' },
  Titanic: { authors: ['Jonathan Chin (alias Paul Finn)', 'John Calhoun'], blurb: 'Find the front of the ship.' },
  'Grand Prix': { authors: ['Jonathan Chin (alias Paul Finn)'] },
  Leviathan: { authors: ['Jonathan Chin (alias Paul Finn)'] },
  'ImagineHouse PRO II': { authors: ['Jonathan Chin (alias Paul Finn)'] },
  'In The Mirror': { authors: ['Jonathan Chin (alias Paul Finn)'] },
  'Land of Illusion': { authors: ['Ward Hartenstein'] },
  "Nemo's Market": { authors: ['Ward Hartenstein'] },
  "Rainbow's End": { authors: ['Ward Hartenstein'] },
  SpacePods: { authors: ['Ward Hartenstein'] },
  Slumberland: {
    authors: ['John Calhoun', 'Jonathan Chin (alias Paul Finn)', 'Steve Sullivan', 'Ward Hartenstein'],
    credit:
      'John Calhoun (first house and top of fourth house), Jonathan Chin (second house), Steve Sullivan (third house), Ward Hartenstein (bottom of fourth house)',
  },
  'Teddy World': { authors: ['Shawn Brenneman'] },
  'The Asylum Pro': { authors: ['Steve Sullivan'] },
  "Castle o' the Air": { authors: ['John Calhoun'], creditSource: "the house's own banner" },
  'Art Museum': { authors: [], creditSource: 'not credited in the Glider PRO release' },
  'California or Bust!': { authors: [], creditSource: 'not credited in the Glider PRO release' },
  'Fun House': { authors: [], creditSource: 'not credited in the Glider PRO release' },
  'Empty House': { authors: [], creditSource: 'not credited in the Glider PRO release (an empty template house)' },
  Sampler: { authors: [], creditSource: 'not credited in the Glider PRO release (its banner reads "Welcome to Omid\'s Happy Home.")' },
};

/** House order on the Classic Houses card: the beginner houses first, then by size. */
export const ORDER = ['Demo House', 'Sampler', 'California or Bust!', 'Fun House', "Castle o' the Air", 'Empty House'];

export function slugOf(name) {
  return name
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Per-room fixes, applied after conversion: { [slug]: { [roomKey]: { add?: items[], remove?: (item) => bool,
 * air?: number (multiplies the room's air), note: why } } }. Prefer the global AIR tuning above.
 */
export const OVERRIDES = {};

/**
 * What the flight check (tests/classicReport.test.ts, see docs/classic-houses.md) found for each house:
 * { flyable: the bot pilot collected every star, reached: how far it got, par: seconds for the Swift medal (the
 * bot's time with some to spare), lost: sheets the bot lost on the way (the house gives half as many again, and
 * a few), note }.
 */
export const STATUS = {
  'Demo House': { flyable: true, reached: 'the star, through 13 rooms', par: 60, lost: 0, note: 'bot pilot: 36 s of flying, no sheet lost' },
  Sampler: { flyable: true, reached: 'the star, through 1 room', par: 15, lost: 0, note: 'bot pilot: 2 s of flying, no sheet lost' },
  'California or Bust!': { flyable: true, reached: 'the star, through 14 rooms', par: 75, lost: 0, note: 'bot pilot: 50 s of flying, no sheet lost' },
  'Fun House': { flyable: false, reached: 'no stars to find (free flight)', note: 'the house has no stars, as in Glider PRO' },
  "Castle o' the Air": { flyable: true, reached: 'all 4 stars, through 31 rooms', par: 345, lost: 4, note: 'bot pilot: 233 s of flying, 4 sheets lost' },
  'Empty House': { flyable: true, reached: 'the star, through 12 rooms', par: 60, lost: 0, note: 'bot pilot: 38 s of flying, no sheet lost' },
  'Davis Station': { flyable: true, reached: 'all 4 stars, through 43 rooms', par: 380, lost: 13, note: 'bot pilot: 208 s of flying, 13 sheets lost' },
  'In The Mirror': { flyable: true, reached: 'the star, through 24 rooms', par: 125, lost: 1, note: 'bot pilot: 82 s of flying, 1 sheet lost' },
  'Art Museum': { flyable: true, reached: 'all 6 stars, through 46 rooms', par: 295, lost: 2, note: 'bot pilot: 206 s of flying, 2 sheets lost' },
  "Nemo's Market": { flyable: true, reached: 'all 5 stars, through 32 rooms', par: 290, lost: 6, note: 'bot pilot: 177 s of flying, 6 sheets lost' },
  Metropolis: { flyable: true, reached: 'all 4 stars, through 39 rooms', par: 285, lost: 6, note: 'bot pilot: 174 s of flying, 6 sheets lost' },
  'The Asylum Pro': { flyable: true, reached: 'the star, through 15 rooms', par: 95, lost: 1, note: 'bot pilot: 60 s of flying, 1 sheet lost' },
  'Grand Prix': { flyable: true, reached: 'all 3 stars, through 49 rooms', par: 300, lost: 1, note: 'bot pilot: 215 s of flying, 1 sheet lost' },
  'CD Demo House': { flyable: true, reached: 'all 9 stars, through 50 rooms', par: 1200, lost: 44, note: 'bot pilot: 653 s of flying, 44 sheets lost' },
  Titanic: { flyable: true, reached: 'the star, through 21 rooms', par: 160, lost: 6, note: 'bot pilot: 80 s of flying, 6 sheets lost' },
  "Rainbow's End": { flyable: true, reached: 'all 5 stars, through 62 rooms', par: 555, lost: 8, note: 'bot pilot: 370 s of flying, 8 sheets lost' },
  'ImagineHouse PRO II': { flyable: true, reached: 'all 3 stars, through 39 rooms', par: 250, lost: 7, note: 'bot pilot: 142 s of flying, 7 sheets lost' },
  'Land of Illusion': {
    flyable: false,
    reached: '4 of 5 stars, through 64 rooms; stuck in "Transformation" (62,-9), 7 rooms from the next star',
    lost: 26,
    note: 'bot pilot: 572 s of flying, 26 sheets lost; the last star is seven rooms up, a climb made on helium in Glider PRO, with no rising air here',
  },
  Slumberland: { flyable: true, reached: 'all 6 stars, through 123 rooms', par: 1175, lost: 30, note: 'bot pilot: 718 s of flying, 30 sheets lost' },
  SpacePods: { flyable: true, reached: 'the star, through 11 rooms', par: 295, lost: 17, note: 'bot pilot: 117 s of flying, 17 sheets lost' },
  Leviathan: { flyable: true, reached: 'all 6 stars, through 149 rooms', par: 1350, lost: 27, note: 'bot pilot: 867 s of flying, 27 sheets lost' },
  'Teddy World': { flyable: true, reached: 'the star, through 7 rooms', par: 40, lost: 0, note: 'bot pilot: 23 s of flying, no sheet lost' },
};
