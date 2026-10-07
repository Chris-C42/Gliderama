#!/usr/bin/env node
/**
 * Convert John Calhoun's Glider PRO houses (GPL v2, https://github.com/softdorothy/GliderPRO) into Gliderama
 * levels: one JSON file per house in src/world/classic/houses/<slug>.json plus src/world/classic/catalog.json.
 *
 *   git clone https://github.com/softdorothy/GliderPRO /tmp/GliderPRO
 *   node scripts/convert-glider-houses.mjs /tmp/GliderPRO            # every house in GliderPRO/Houses
 *   node scripts/convert-glider-houses.mjs /tmp/GliderPRO "Demo House" # just one (by name)
 *
 * The GliderPRO folder may also be given as the GLIDERPRO environment variable. Plain Node, no dependencies:
 *   scripts/glider/binhex.mjs   BinHex 4.0 decoding (with CRC checks) and the resource fork reader
 *   scripts/glider/house.mjs    the house data fork, following Headers/GliderStructs.h
 *   scripts/glider-map.mjs      every mapping decision (geometry, air tuning, looks, objects, credits, fixes)
 * See docs/classic-houses.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBinHex, parseResourceFork } from './glider/binhex.mjs';
import { extractFloorSuite, parseHouse } from './glider/house.mjs';
import { colourStats, decodePict } from './glider/pict.mjs';
import { parseRez } from './glider/rez.mjs';
import {
  AIR,
  DROPPED,
  EDGE,
  GONE_WHEN_OFF,
  GR,
  HOUSES,
  BUILTIN,
  MISSING_ART,
  OBJECT_MAP,
  SCENERY,
  SOLID_SCENERY,
  ORDER,
  OVERRIDES,
  ROOF_RAMP,
  STATUS,
  X,
  Y,
  flipped,
  floorSpan,
  hull,
  MIN_GAP,
  obstacleWalls,
  subtract,
  objectOpenings,
  shellOpenings,
  sideSpan,
  roomLook,
  slugOf,
  solidRamp,
  startsDark,
  FULL_SIDE,
  FULL_WIDTH,
} from './glider-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src/world/classic/houses');
const CATALOG = path.join(ROOT, 'src/world/classic/catalog.json');

const keyOf = (room) => `${room.suite},${-room.floor || 0}`;
const inc = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);

/** An e-mail address in a house's text. */
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;

/**
 * A house's banner or trailer without the sentences asking players to write to its author: a 1990s address that is
 * no use to anyone now. Text without an address is kept exactly as it was (line breaks and all).
 */
function withoutContacts(text) {
  if (!EMAIL.test(text)) return text;
  return text
    // (an address often ends its sentence without a full stop)
    .replace(new RegExp(`(${EMAIL.source})\\s+(?=[A-Z])`, 'g'), '$1. ')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !EMAIL.test(sentence))
    .join(' ')
    .trim();
}

// ---------------------------------------------------------------------------------------------
// The original pictures, in a few numbers

/**
 * A room as Glider PRO draws it (Sources/RoomGraphics.c DrawRoomBackground): eight 64-px columns, each a slice
 * of the background picture chosen by the room's tiles, and the house's own pictures (customPict objects) on
 * top. `mask` marks what was drawn (the game's built-in backgrounds are only there when Glider PRO.r is).
 */
function composeRoom(room, pictOf) {
  const W = 512;
  const H = 322;
  const img = { width: W, height: H, rgb: new Uint8Array(W * H * 3), mask: new Uint8Array(W * H) };
  let drawn = false;
  const blit = (src, sx0, sy0, dx0, dy0, w, h) => {
    for (let y = 0; y < h; y++) {
      const sy = sy0 + y;
      const dy = dy0 + y;
      if (sy < 0 || sy >= src.height || dy < 0 || dy >= H) continue;
      for (let x = 0; x < w; x++) {
        const sx = sx0 + x;
        const dx = dx0 + x;
        if (sx < 0 || sx >= src.width || dx < 0 || dx >= W) continue;
        const s = (sy * src.width + sx) * 3;
        const d = dy * W + dx;
        img.rgb[d * 3] = src.rgb[s];
        img.rgb[d * 3 + 1] = src.rgb[s + 1];
        img.rgb[d * 3 + 2] = src.rgb[s + 2];
        img.mask[d] = 1;
        drawn = true;
      }
    }
  };
  const bg = pictOf(room.background);
  if (bg) for (let i = 0; i < 8; i++) blit(bg, (room.tiles[i] ?? i) * 64, 0, i * 64, 0, 64, H);
  for (const ob of room.objects) {
    if (ob.type !== 'customPict') continue;
    const p = pictOf(ob.height);
    if (p) blit(p, 0, 0, ob.topLeft.h, ob.topLeft.v, p.width, p.height);
  }
  return drawn ? img : null;
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * What each room of a house looks like in the original, in a few numbers ({ [room index]: summary }): the
 * converter picks the closest Gliderama look from them (glider-map.mjs pictureLook) and colours the obstacles
 * that stand for things drawn in the picture. `builtin`: the game's own resources (Glider PRO.r), for the
 * built-in backgrounds.
 */
export function pictureSummary(house, rsrc, builtin = {}) {
  const cache = new Map();
  const pictOf = (id) => {
    if (cache.has(id)) return cache.get(id);
    const res = (rsrc.PICT ?? []).find((p) => p.id === id) ?? (builtin.PICT ?? []).find((p) => p.id === id);
    const img = res ? decodePict(res.data) : null;
    cache.set(id, img);
    return img;
  };
  const main = (st, k = 0) => (st.colours[k] ? { rgb: st.colours[k].rgb, share: round3(st.colours[k].share) } : null);
  const out = {};
  for (const room of house.rooms) {
    if (room.deleted) continue;
    const img = composeRoom(room, pictOf);
    if (!img) continue;
    const s = {};
    // the backdrop: the upper part of the room (sky, wallpaper), its lower wall, and the floor strip
    const up = colourStats(img, 0, 12, 512, 200);
    if (up.n > 200) {
      Object.assign(s, { sky: round3(up.sky), dark: round3(up.dark), specks: round3(up.specks), wall: main(up), wall2: main(up, 1) });
      const low = colourStats(img, 0, 210, 512, 296);
      s.lower = main(low);
      s.floor = main(colourStats(img, 0, 304, 512, 322));
    }
    // obstacles stand for something drawn there: its colour
    for (const ob of room.objects) {
      if (ob.type !== 'invisObstacle' && ob.type !== 'invisBounce') continue;
      const b = ob.bounds;
      const st = colourStats(img, b.left, b.top, b.right, b.bottom);
      if (st.n >= 2) (s.objects ??= {})[ob.slot] = main(st).rgb;
    }
    out[room.index] = s;
  }
  return out;
}

/** Convert one decoded house. Returns the level JSON (LevelDef + meta). */
export function convertHouse(name, house, rsrc, file = '', pictures = null) {
  const info = HOUSES[name] ?? { authors: [], creditSource: 'not credited in the Glider PRO release' };
  const slug = slugOf(name);
  const bnds = {};
  for (const r of rsrc.bnds ?? []) bnds[r.id] = (r.data[0] ? 1 : 0) | (r.data[1] ? 2 : 0) | (r.data[2] ? 4 : 0) | (r.data[3] ? 8 : 0);

  // rooms by floor/suite (the first live room wins, like Sources/Room.c RoomExists)
  const live = house.rooms.filter((r) => !r.deleted);
  const at = new Map();
  for (const r of live) if (!at.has(`${r.floor},${r.suite}`)) at.set(`${r.floor},${r.suite}`, r);
  const roomAt = (floor, suite) => at.get(`${floor},${suite}`) ?? null;
  const notes = [];
  const dropped = {};
  const approximated = {};
  const missingArt = {};
  let mapped = 0;
  let total = 0;

  // switch targets: which (room, slot) objects some switch toggles, so they get a switch group
  const switched = new Set();
  const linkOf = (ob) => {
    if (ob.where === undefined || ob.where === -1 || ob.who === 255) return null;
    const fs_ = extractFloorSuite(ob.where, house.version);
    const room = fs_ && roomAt(fs_.floor, fs_.suite);
    if (!room) return { room: null, key: null, target: null };
    return { room, key: keyOf(room), target: room.objects.find((o) => o.slot === ob.who) ?? null };
  };
  for (const r of live)
    for (const ob of r.objects) {
      if (ob.family !== 'switch') continue;
      const l = flipped(ob, linkOf);
      if (l) switched.add(`${l.room.index}.${l.target.slot}`);
    }
  const groupName = (room, slot) => `gp${room.index}.${slot}`;
  // the far ends of transports (the objects a transport takes the glider to)
  const arrivals = new Set();
  for (const r of live)
    for (const ob of r.objects) {
      if (ob.family !== 'transport') continue;
      const l = linkOf(ob);
      if (l?.target) arrivals.add(`${l.room.index}.${l.target.slot}`);
    }

  // openings, in Glider PRO px
  const open = new Map();
  for (const r of live) open.set(r, { shell: shellOpenings(r, bnds), objs: objectOpenings(r) });
  const sides = new Map(live.map((r) => [r, { left: null, right: null, up: null, down: null }]));
  // the solid parts between openings merged into one (Gliderama has one opening per side): drawn as blocks
  const gapBlocks = new Map(live.map((r) => [r, []]));
  // the walls of invisible obstacles at the rooms' edges close (or narrow) those openings
  const walls = new Map(live.map((r) => [r, obstacleWalls(r)]));
  let multi = 0;
  let oneWay = 0;
  const walled = { closed: 0, narrowed: 0 };
  const wallsCount = (before, after) => {
    if (before && !after) walled.closed++;
    else if (before && (after.from !== before.from || after.to !== before.to)) walled.narrowed++;
  };
  for (const a of live) {
    const oa = open.get(a);
    // left → right neighbours: either wall being open lets the glider through (Interactions.c CheckEscapeLeft/Right)
    const b = roomAt(a.floor, a.suite + 1);
    if (b) {
      const ob_ = open.get(b);
      const ra = oa.shell.right ? [FULL_SIDE] : oa.objs.right;
      const lb = ob_.shell.left ? [FULL_SIDE] : ob_.objs.left;
      const blocked = [...walls.get(a).right, ...walls.get(b).left];
      const h = hull(subtract([...ra, ...lb], blocked, MIN_GAP.side));
      wallsCount(hull([...ra, ...lb]), h);
      if (h) {
        if (h.gaps.length) multi++;
        if (!ra.length || !lb.length) oneWay++;
        const span = sideSpan(h);
        sides.get(a).right = span;
        sides.get(b).left = { ...span };
        // (the obstacles are drawn already)
        for (const [g0, g1] of subtract(h.gaps, blocked)) {
          const y = Math.round(Y(g0));
          const hh = Math.round(Y(g1)) - y;
          gapBlocks.get(a).push({ t: 'solid', x: GR.roomW - GR.sideWall, y, w: GR.sideWall + EDGE, h: hh });
          gapBlocks.get(b).push({ t: 'solid', x: -EDGE, y, w: GR.sideWall + EDGE, h: hh });
        }
      }
    }
    // the room below: the glider falls through wherever this room's floor is open (sky rooms, dirt tunnels,
    // manholes); rising from below only works there too (elsewhere it would die on this room's floor)
    const below = roomAt(a.floor - 1, a.suite);
    if (below) {
      const down = oa.shell.bottom ? [FULL_WIDTH] : [...oa.shell.down, ...oa.objs.down];
      const blocked = [...walls.get(a).down, ...walls.get(below).up];
      const h = hull(subtract(down, blocked, MIN_GAP.floor));
      wallsCount(hull(down), h);
      if (h) {
        if (h.gaps.length) multi++;
        const span = floorSpan(h);
        sides.get(a).down = span;
        sides.get(below).up = { ...span };
        for (const [g0, g1] of subtract(h.gaps, blocked)) {
          const x = Math.round(X(g0));
          const w = Math.round(X(g1)) - x;
          gapBlocks.get(a).push({ t: 'solid', x, y: GR.floor, w, h: GR.roomH - GR.floor + EDGE });
          gapBlocks.get(below).push({ t: 'solid', x, y: -EDGE, w, h: GR.ceiling + EDGE });
        }
      }
    }
  }
  if (multi)
    notes.push(`${multi} walls or floors with two openings: one opening here, the wall between them drawn as a block (Gliderama has one opening per side)`);
  if (oneWay) notes.push(`${oneWay} doorways were one-way in the original (open on one side only); here they open both ways`);
  if (walled.closed || walled.narrowed)
    notes.push(`${walled.closed} openings closed and ${walled.narrowed} narrowed by walls of invisible obstacles at the rooms' edges`);

  // the start (Sources/House.c WhereDoesGliderBegin): the glider's top-left in the first room
  const first = house.rooms[house.firstRoom] && !house.rooms[house.firstRoom].deleted ? house.rooms[house.firstRoom] : live[0];
  const start = {
    room: keyOf(first),
    x: Math.round(Math.max(40, Math.min(600, X(house.initial.h + 24)))),
    y: Math.round(Math.max(40, Math.min(300, Y(house.initial.v + 10)))),
    facing: 1,
  };

  const rooms = {};
  let goalStars = 0;
  let pickups = 0;
  let chained = 0;
  for (const r of live) {
    const key = keyOf(r);
    if (rooms[key]) {
      notes.push(`room ${r.index} "${r.name}" shares floor ${r.floor} suite ${r.suite} with another room: skipped`);
      continue;
    }
    const bgName = BUILTIN[r.background];
    const pic = pictures?.[r.index];
    const { look, outdoor: outdoorKind, solid } = roomLook(r, pic, open.get(r).shell.bottom);
    const s = sides.get(r);
    const exits = {};
    for (const side of ['left', 'right', 'up', 'down']) if (s[side]) exits[side] = s[side];
    const items = [];
    const counters = {};
    const ctx = {
      room: r,
      key,
      seed: r.index,
      emit(it) {
        items.push(it);
      },
      drop(type, why, quiet = false) {
        inc(dropped, `${type}: ${why}`);
        if (!quiet && MISSING_ART.has(type)) inc(missingArt, type);
      },
      missing(type, how) {
        inc(approximated, `${type}: ${how}`);
        inc(missingArt, type);
      },
      /** Converted, but not quite as the original works. */
      approx(type, how) {
        inc(approximated, `${type}: ${how}`);
      },
      link: linkOf,
      /** Whether some switch turns this object (in that room) on and off. */
      switchedAt: (room, ob) => switched.has(`${room.index}.${ob.slot}`),
      /** A transport that puts the glider down inside another one, which takes it straight on (see transportChain). */
      chained() {
        chained++;
      },
      groupName,
      /** The far end of some transport. */
      isArrival: (ob) => arrivals.has(`${r.index}.${ob.slot}`),
      /** An obstacle's colour: what the original's picture shows there. */
      solidRamp: (ob) => solidRamp(pic?.objects?.[ob.slot], solid),
      /** The switch group of an object some switch toggles ('!' = off until switched). */
      group(ob, initial = ob.initial ?? true) {
        if (!switched.has(`${r.index}.${ob.slot}`)) return {};
        const g = groupName(r, ob.slot);
        return { group: initial ? g : `!${g}` };
      },
      opensUpAt(gpx) {
        const up = s.up;
        const x = X(gpx);
        return !!up && x >= up.from && x <= up.to;
      },
      pickupId(t) {
        const n = (counters[t] = (counters[t] ?? -1) + 1);
        return `${key}:${t}:${n}`;
      },
    };
    let droppedHere = 0;
    const countDrop = ctx.drop;
    ctx.drop = (...args) => {
      droppedHere++;
      countDrop(...args);
    };
    for (const ob of r.objects) {
      total++;
      const handler = OBJECT_MAP[ob.type];
      if (handler === undefined) {
        ctx.drop(ob.type, 'unknown object type');
        continue;
      }
      if (handler === null) {
        ctx.drop(ob.type, DROPPED[ob.type] ?? 'no equivalent');
        continue;
      }
      // blowers (and things that come and go) that start switched off and that no switch ever turns on do nothing
      if ((ob.family === 'blower' || GONE_WHEN_OFF.includes(ob.type)) && !ob.initial && !switched.has(`${r.index}.${ob.slot}`)) {
        ctx.drop(ob.type, 'switched off and never switched on', true);
        continue;
      }
      // mapped = became items, or openings / lighting (doors, windows, manholes, invisible lights)
      const before = droppedHere;
      const n0 = items.length;
      const art0 = missingArt[ob.type] ?? 0;
      handler(ob, ctx);
      // (scenery is nothing to bump into, as in Glider PRO)
      if (SCENERY.has(ob.type)) for (const it of items.slice(n0)) if (SOLID_SCENERY.has(it.t)) it.solid = false;
      if (droppedHere === before) {
        mapped++;
        // drawn with the art of something else (unless the handler said how already)
        if (MISSING_ART.has(ob.type) && (missingArt[ob.type] ?? 0) === art0) {
          const kinds = [...new Set(items.slice(n0).map((it) => it.t))];
          ctx.missing(ob.type, kinds.length ? `drawn as ${kinds.join(' + ')}` : 'not drawn');
        }
      }
      if (ob.type === 'star') goalStars++;
    }
    items.push(...gapBlocks.get(r).map((g) => ({ ...g, ramp: solid })));
    for (const it of items) if (['star', 'sheet', 'battery', 'bands', 'helium', 'tape'].includes(it.t)) pickups++;
    // roof rooms: the roof is a solid mass under its surface line (Interactions.c CheckRoofCollision)
    if (bgName === 'roof') items.unshift(...roofBlocks(r.tiles));
    const def = {
      id: `${slug}-${r.index}`,
      name: r.name || `Room ${r.index}`,
      wall: look.wall,
      floor: look.floor,
      exits,
      items: items.map(clampItem),
      seed: (r.index * 7 + 3) % 97,
    };
    if (outdoorKind) {
      def.outdoor = outdoorKind;
      def.open = true;
      if (outdoorKind === 'space') def.night = true;
    }
    // a room without a window, an open door or a light switched on is black (Sources/RoomGraphics.c DrawRoomBackground)
    if (startsDark(r)) def.dark = true;
    rooms[key] = def;
  }

  if (chained)
    notes.push(
      `${chained} transports put the glider down inside another one, which takes it straight on (as in Glider PRO): here they take the plane to the end of the chain`,
    );

  // per-room fixes
  for (const [key, fix] of Object.entries(OVERRIDES[slug] ?? {})) {
    const def = rooms[key];
    if (!def) continue;
    if (fix.remove) def.items = def.items.filter((it) => !fix.remove(it));
    if (fix.add) def.items.push(...fix.add);
    if (fix.air) for (const it of def.items) if (typeof it.power === 'number') it.power = Math.round(it.power * fix.air * 100) / 100;
    if (fix.exits) Object.assign(def.exits, fix.exits);
    notes.push(`room ${key} "${def.name}": ${fix.note}`);
  }

  const authors = info.authors;
  const credit = info.credit ?? (authors.length ? authors.join(' & ') : null);
  const status = STATUS[name] ?? { flyable: false, note: 'not checked yet' };
  const banner = withoutContacts(house.banner.replace(/\r+/g, ' ').replace(/\s+/g, ' ').trim());
  const goal =
    goalStars > 0
      ? `Find the ${goalStars === 1 ? 'star' : `${goalStars} stars`} to finish the house.`
      : 'This house has no stars (it cannot be finished in Glider PRO either): fly freely.';
  const by = credit ? `House by ${credit}.` : '';
  const level = {
    id: `classic-${slug}`,
    name,
    place: 'classic',
    rooms,
    start,
    // a sheet per dozen rooms, 6 to 25, but half as many again as the bot pilot lost on its way, and a few (and at
    // least the house's own floor, where a player is likely to lose more than the bot)
    sheets: Math.max(Math.max(6, Math.min(25, Math.round(6 + live.length / 12))), status.lost ? Math.ceil(status.lost * 1.5) + 3 : 0, status.minSheets ?? 0),
    par: status.par ?? 0,
    intro: [banner || info.blurb || '', goal, by].filter(Boolean).join(' '),
    outro: withoutContacts(house.trailer.replace(/\r+/g, '\n').trim()),
    goal: goalStars > 0 ? 'stars' : 'none',
    meta: {
      original: name,
      file,
      source: 'Glider PRO (Casady & Greene, 1994), GNU GPL v2: https://github.com/softdorothy/GliderPRO',
      authors,
      credit,
      creditSource: info.creditSource ?? 'Glider PRO README',
      rooms: live.length,
      roomsConverted: Object.keys(rooms).length,
      stars: goalStars,
      pickups,
      objects: { total, mapped, dropped: Object.values(dropped).reduce((a, b) => a + b, 0) },
      dropped,
      approximated,
      missingArt,
      notes,
      status,
    },
  };
  return level;
}

/** The roof as solid blocks under its surface line: flat tiles at GP y 122, slopes as 16-px steps. */
function roofBlocks(tiles) {
  const out = [];
  const surface = (tile, dx) => (tile === 1 ? 250 - dx : tile === 2 ? 186 - dx : tile === 5 ? 122 + dx : tile === 6 ? 186 + dx : 122);
  let run = null;
  const flush = () => {
    if (run) out.push(block(run.x0, run.x1, run.top));
    run = null;
  };
  for (let i = 0; i < tiles.length; i++) {
    for (let k = 0; k < 4; k++) {
      const x0 = i * 64 + k * 16;
      // the lower end of the step, so the block never stands where the original's roof leaves air
      const top = Math.max(surface(tiles[i], k * 16), surface(tiles[i], k * 16 + 16));
      if (run && run.top === top) run.x1 = x0 + 16;
      else {
        flush();
        run = { x0, x1: x0 + 16, top };
      }
    }
  }
  flush();
  return out;
}

function block(x0, x1, top) {
  const x = Math.round(X(x0));
  const y = Math.round(Y(top));
  return { t: 'solid', x, y, w: Math.round(X(x1)) - x, h: GR.roomH - y, ramp: ROOF_RAMP };
}

/** Keep an item's anchor inside the room. */
function clampItem(it) {
  const c = { ...it };
  // (blocks at an edge carry on past it, as the room's walls do; invisible air keeps its place and size, a column at
  // a wall partly past it, a rising one up to the top carrying on through the ceiling)
  const air = it.t === 'current';
  const mx = it.t === 'solid' ? EDGE : air ? AIR.columnW / 2 : 0;
  const my = it.t === 'solid' ? EDGE : air ? AIR.carryOn : 0;
  if (typeof c.x === 'number') c.x = Math.max(-mx, Math.min(GR.roomW, c.x));
  if (typeof c.y === 'number') c.y = Math.max(-my, Math.min(GR.roomH, c.y));
  if (typeof c.w === 'number' && typeof c.x === 'number') c.w = Math.max(1, Math.min(c.w, GR.roomW + mx - c.x));
  if (typeof c.h === 'number' && typeof c.y === 'number') c.h = Math.max(1, Math.min(c.h, GR.roomH + (air ? 0 : my) - c.y));
  return c;
}

// ---------------------------------------------------------------------------------------------
// CLI

function main() {
  const args = process.argv.slice(2);
  const fixtures = args.includes('--fixtures');
  const [dir = process.env.GLIDERPRO, ...only] = args.filter((a) => a !== '--fixtures');
  if (!dir) {
    console.error('usage: node scripts/convert-glider-houses.mjs <GliderPRO folder> [house name...] [--fixtures]');
    process.exit(1);
  }
  const housesDir = path.join(dir, 'Houses');
  const files = fs.readdirSync(housesDir).filter((f) => f.endsWith('.binhex'));
  // the game's own pictures (the built-in backgrounds), when the folder has them
  const rez = path.join(dir, 'Glider PRO.r');
  const builtin = fs.existsSync(rez) ? parseRez(fs.readFileSync(rez, 'latin1'), ['PICT']) : {};
  if (!builtin.PICT) console.warn(`no ${rez}: obstacles in rooms with built-in backgrounds get their room's colour`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const catalog = fs.existsSync(CATALOG) ? JSON.parse(fs.readFileSync(CATALOG, 'utf8')) : [];
  for (const f of files) {
    const bh = decodeBinHex(fs.readFileSync(path.join(housesDir, f), 'latin1'));
    const name = bh.name;
    if (only.length && !only.includes(name)) continue;
    const house = parseHouse(bh.data);
    const rsrc = parseResourceFork(bh.rsrc);
    const pictures = pictureSummary(house, rsrc, builtin);
    const level = convertHouse(name, house, rsrc, `Houses/${f}`, pictures);
    // the Demo House is the converter's test case (tests/classicFormat.test.ts)
    if (fixtures && name === 'Demo House') writeFixtures(bh, rsrc, pictures);
    const slug = slugOf(name);
    fs.writeFileSync(path.join(OUT_DIR, `${slug}.json`), JSON.stringify(level) + '\n');
    const m = level.meta;
    const entry = {
      slug,
      id: level.id,
      name,
      authors: m.authors,
      credit: m.credit,
      rooms: m.roomsConverted,
      stars: m.stars,
      goal: level.goal,
      blurb: (HOUSES[name] ?? {}).blurb ?? null,
      status: m.status,
    };
    const i = catalog.findIndex((c) => c.slug === slug);
    if (i >= 0) catalog[i] = entry;
    else catalog.push(entry);
    const size = fs.statSync(path.join(OUT_DIR, `${slug}.json`)).size;
    console.log(
      `${name}: ${m.roomsConverted}/${m.rooms} rooms, ${m.objects.mapped}/${m.objects.total} objects mapped, ${m.objects.dropped} dropped, ${m.stars} stars, ${(size / 1024).toFixed(0)} KB`,
    );
    for (const n of m.notes) console.log(`  - ${n}`);
  }
  const rank = (c) => {
    const k = ORDER.indexOf(c.name);
    return k >= 0 ? k : ORDER.length;
  };
  catalog.sort((a, b) => rank(a) - rank(b) || a.rooms - b.rooms || a.name.localeCompare(b.name));
  fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 1) + '\n');
}

/** The Demo House's data fork, room bounds and picture summary, for the tests (the whole file is 650 KB). */
function writeFixtures(bh, rsrc, pictures) {
  const dir = path.join(ROOT, 'tests/fixtures/glider');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo-house.dat'), bh.data);
  fs.writeFileSync(path.join(dir, 'demo-house-bnds.json'), JSON.stringify((rsrc.bnds ?? []).map((r) => ({ id: r.id, data: Array.from(r.data) }))) + '\n');
  fs.writeFileSync(path.join(dir, 'demo-house-pictures.json'), JSON.stringify(pictures) + '\n');
  console.log(`fixtures written to ${path.relative(ROOT, dir)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
