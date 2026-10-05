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
import {
  DROPPED,
  GR,
  HOUSES,
  LOOKS,
  CUSTOM_LOOKS,
  BUILTIN,
  MISSING_ART,
  OBJECT_MAP,
  ORDER,
  OUTDOOR,
  OVERRIDES,
  STATUS,
  X,
  Y,
  floorSpan,
  hull,
  objectOpenings,
  shellOpenings,
  sideSpan,
  slugOf,
  startsDark,
  FULL_SIDE,
  FULL_WIDTH,
} from './glider-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src/world/classic/houses');
const CATALOG = path.join(ROOT, 'src/world/classic/catalog.json');

const keyOf = (room) => `${room.suite},${-room.floor || 0}`;
const inc = (o, k, n = 1) => (o[k] = (o[k] ?? 0) + n);

/** Convert one decoded house. Returns the level JSON (LevelDef + meta). */
export function convertHouse(name, house, rsrc, file = '') {
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
      const l = linkOf(ob);
      if (l?.target) switched.add(`${l.room.index}.${l.target.slot}`);
    }
  const groupName = (room, slot) => `gp${room.index}.${slot}`;

  // openings, in Glider PRO px
  const open = new Map();
  for (const r of live) open.set(r, { shell: shellOpenings(r, bnds), objs: objectOpenings(r) });
  const sides = new Map(live.map((r) => [r, { left: null, right: null, up: null, down: null }]));
  // the solid parts between openings merged into one (Gliderama has one opening per side): drawn as blocks
  const gapBlocks = new Map(live.map((r) => [r, []]));
  let multi = 0;
  let oneWay = 0;
  for (const a of live) {
    const oa = open.get(a);
    // left → right neighbours: either wall being open lets the glider through (Interactions.c CheckEscapeLeft/Right)
    const b = roomAt(a.floor, a.suite + 1);
    if (b) {
      const ob_ = open.get(b);
      const ra = oa.shell.right ? [FULL_SIDE] : oa.objs.right;
      const lb = ob_.shell.left ? [FULL_SIDE] : ob_.objs.left;
      const h = hull([...ra, ...lb]);
      if (h) {
        if (h.gaps.length) multi++;
        if (!ra.length || !lb.length) oneWay++;
        const span = sideSpan(h);
        sides.get(a).right = span;
        sides.get(b).left = { ...span };
        for (const [g0, g1] of h.gaps) {
          const y = Math.round(Y(g0));
          const hh = Math.round(Y(g1)) - y;
          gapBlocks.get(a).push({ t: 'block', x: GR.roomW - GR.sideWall, y, w: GR.sideWall, h: hh });
          gapBlocks.get(b).push({ t: 'block', x: 0, y, w: GR.sideWall, h: hh });
        }
      }
    }
    // the room below: the glider falls through wherever this room's floor is open (sky rooms, dirt tunnels,
    // manholes); rising from below only works there too (elsewhere it would die on this room's floor)
    const below = roomAt(a.floor - 1, a.suite);
    if (below) {
      const down = oa.shell.bottom ? [FULL_WIDTH] : [...oa.shell.down, ...oa.objs.down];
      const h = hull(down);
      if (h) {
        if (h.gaps.length) multi++;
        const span = floorSpan(h);
        sides.get(a).down = span;
        sides.get(below).up = { ...span };
        for (const [g0, g1] of h.gaps) {
          const x = Math.round(X(g0));
          const w = Math.round(X(g1)) - x;
          gapBlocks.get(a).push({ t: 'block', x, y: GR.floor, w, h: GR.roomH - GR.floor });
          gapBlocks.get(below).push({ t: 'block', x, y: 0, w, h: GR.ceiling });
        }
      }
    }
  }
  if (multi)
    notes.push(`${multi} walls or floors with two openings: one opening here, the wall between them drawn as a block (Gliderama has one opening per side)`);
  if (oneWay) notes.push(`${oneWay} doorways were one-way in the original (open on one side only); here they open both ways`);

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
  for (const r of live) {
    const key = keyOf(r);
    if (rooms[key]) {
      notes.push(`room ${r.index} "${r.name}" shares floor ${r.floor} suite ${r.suite} with another room: skipped`);
      continue;
    }
    const bgName = BUILTIN[r.background];
    const structure = r.background >= 3000 ? (r.bounds !== 0 ? (r.bounds & 32) === 32 : r.background < 3300) : true;
    const outdoorKind = bgName ? OUTDOOR[bgName] : structure ? undefined : open.get(r).shell.bottom ? 'sky' : 'ground';
    const look = outdoorKind ? LOOKS.outdoors : bgName ? LOOKS[bgName] : CUSTOM_LOOKS[r.background % CUSTOM_LOOKS.length];
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
      link: linkOf,
      groupName,
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
      // blowers that start switched off and that no switch ever turns on do nothing
      if (ob.family === 'blower' && !ob.initial && !switched.has(`${r.index}.${ob.slot}`)) {
        ctx.drop(ob.type, 'switched off and never switched on', true);
        continue;
      }
      // mapped = became items, or openings / lighting (doors, windows, manholes, invisible lights)
      const before = droppedHere;
      const n0 = items.length;
      const art0 = missingArt[ob.type] ?? 0;
      handler(ob, ctx);
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
    items.push(...gapBlocks.get(r));
    for (const it of items) if (['star', 'sheet', 'battery', 'bands', 'tape'].includes(it.t)) pickups++;
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
    } else if (startsDark(r)) def.dark = true;
    rooms[key] = def;
  }

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
  const banner = house.banner.replace(/\r+/g, ' ').replace(/\s+/g, ' ').trim();
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
    sheets: Math.max(6, Math.min(25, Math.round(6 + live.length / 12))),
    par: status.par ?? 0,
    intro: [banner || info.blurb || '', goal, by].filter(Boolean).join(' '),
    outro: house.trailer.replace(/\r+/g, '\n').trim(),
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
  return { t: 'block', x, y, w: Math.round(X(x1)) - x, h: GR.roomH - y };
}

/** Keep an item's anchor inside the room. */
function clampItem(it) {
  const c = { ...it };
  if (typeof c.x === 'number') c.x = Math.max(0, Math.min(GR.roomW, c.x));
  if (typeof c.y === 'number') c.y = Math.max(0, Math.min(GR.roomH, c.y));
  if (typeof c.w === 'number' && typeof c.x === 'number') c.w = Math.max(1, Math.min(c.w, GR.roomW - c.x));
  if (typeof c.h === 'number' && typeof c.y === 'number') c.h = Math.max(1, Math.min(c.h, GR.roomH - c.y));
  return c;
}

// ---------------------------------------------------------------------------------------------
// CLI

function main() {
  const dir = process.argv[2] ?? process.env.GLIDERPRO;
  if (!dir) {
    console.error('usage: node scripts/convert-glider-houses.mjs <GliderPRO folder> [house name...]');
    process.exit(1);
  }
  const only = process.argv.slice(3);
  const housesDir = path.join(dir, 'Houses');
  const files = fs.readdirSync(housesDir).filter((f) => f.endsWith('.binhex'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const catalog = fs.existsSync(CATALOG) ? JSON.parse(fs.readFileSync(CATALOG, 'utf8')) : [];
  for (const f of files) {
    const bh = decodeBinHex(fs.readFileSync(path.join(housesDir, f), 'latin1'));
    const name = bh.name;
    if (only.length && !only.includes(name)) continue;
    const house = parseHouse(bh.data);
    const level = convertHouse(name, house, parseResourceFork(bh.rsrc), `Houses/${f}`);
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

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
