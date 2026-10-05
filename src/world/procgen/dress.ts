/**
 * Dressing a room: fit a template's furniture, decor and hazards into the space the flight corridor leaves free.
 * Everything is placed through `Scene`, which refuses positions that would cross the corridor.
 */

import type { Rng } from '../../core/rng';
import { LAYOUT, type ItemDef, type RoomDef } from '../types';
import { variantIndex, surfaceOf } from './catalog';
import type { AirPlan } from './air';
import type { Band } from './geom';
import { Scene, type Placed } from './scene';
import type { FloorSlot, Perch, RoomLook, RoomTemplate } from './themes';
import type { RoomIO } from './types';

export interface StartPlan {
  /** Throw point. */
  x: number;
  y: number;
  perch: Perch;
  /** For a bookshelf perch: the shelf height. */
  shelfH?: number;
}

export interface HazardPlan {
  candles: number;
  drips: number;
  tallShelf: boolean;
  /** Clearance (px) a candle flame keeps from the flight corridor. */
  flameMargin: number;
  /** Clearance (px) furniture keeps from the corridor. */
  margin: number;
}

export interface DressInput {
  io: RoomIO;
  template: RoomTemplate;
  look: RoomLook;
  air: AirPlan;
  band: Band;
  stub: RoomDef;
  rng: Rng;
  start?: StartPlan;
  workbench: boolean;
  hazards: HazardPlan;
  /** Light switch position (dark rooms): plate and runtime object share it. */
  switchAt?: { x: number; y: number };
  /** The last room: where the front door goes. */
  frontDoor: boolean;
  /** Essentials only (door, bench, switch): the fallback when the full recipe could not be flown. */
  minimal?: boolean;
}

const rint = (rng: Rng, r: readonly [number, number] | undefined, d?: number) => (r ? rng.int(r[0], r[1]) : d);

export function dress(inp: DressInput): Scene {
  const { io, template, look, air, band, rng } = inp;
  const dirX = io.dirX;
  const scene = new Scene(inp.stub, band, rng.fork('scene'), dirX);
  const woodV = (kind: string) => variantIndex(kind, look.wood);

  // ---- light switch (dark rooms)
  if (inp.switchAt) {
    const { x, y } = inp.switchAt;
    scene.addFixed({ t: 'switchPlate', x, y }, 'switchPlate');
    scene.addFixed({ t: 'switch', x, y }, 'switch');
    scene.reservedWall.push({ x: x - 12, y: y - 8, w: 34, h: 34 });
    scene.keepClear.push({ x: x - 2, y: y - 2, w: 14, h: 20 });
  }

  // ---- air movers and stairwells are already decided: register them so nothing is placed on top of them
  for (const v of air.vents) {
    scene.reservedFloor.push({ x0: v.x - 2, x1: v.x + v.w + 2 });
  }
  const floorHole = io.entry === 'down' ? io.entrySpan : io.exit === 'down' ? io.exitSpan : undefined;
  if (floorHole) scene.reservedFloor.push({ x0: floorHole.from - 12, x1: floorHole.to + 12 });
  for (const f of air.fans) {
    const host = scene.placeFloor({ kind: f.host.kind, tag: 'fanHost', w: f.host.kind === 'nightstand' ? undefined : f.host.w, at: f.host.x, v: woodV(f.host.kind), removable: false, margin: 10 });
    if (host) {
      scene.addFixed({ t: 'fan', x: f.x, y: f.y, dir: f.dir, stand: f.stand, power: f.power, reach: f.reach }, 'fan', { removable: true });
      scene.reservedWall.push({ x: f.x - 6, y: f.y - 6, w: 44, h: f.stand + 44 });
    }
  }

  // ---- the way out of the house
  if (inp.frontDoor) {
    const span = io.exitSpan;
    const w = rng.pick([80, 88, 96]);
    const y = span.from + 8;
    // clear of the side wall: the casing is 8 px wide and the open leaf swings 10 px out
    const x = dirX > 0 ? 628 - w - 14 : 12 + 14;
    const door: ItemDef = { t: 'frontDoor', x, y, w, h: span.to - y };
    if (dirX < 0) door.flip = true;
    scene.addFixed(door, 'frontDoor');
    scene.reservedWall.push({ x: x - 14, y: y - 12, w: w + 28, h: 240 });
    // and nothing stands in front of it
    scene.reservedFloor.push({ x0: x - 14, x1: x + w + 14 });
  }

  // ---- the first room: furniture under the launch point
  const deskSlot = template.floorPlan.find((s) => s.kind === 'desk');
  let perchPlaced: Placed | null = null;
  if (inp.start) perchPlaced = placePerch(scene, inp.start, look, rng, deskSlot);

  // ---- the workbench
  if (inp.workbench && air.bench) {
    const desk = scene.placeFloor({ kind: 'desk', tag: 'desk', w: air.bench.w, at: air.bench.x - 4, v: woodV('desk'), removable: false, margin: 10 });
    if (desk) {
      const top = surfaceOf(desk.item)!.top;
      scene.addFixed({ t: 'workbench', x: desk.item.x, y: top, w: air.bench.w }, 'workbench');
      scene.clearSurface(desk); // the top stays clear for landing
      // ... and so does the air above it: no window sill or lamp to land on instead
      if (desk.span) scene.landing.push({ x: desk.span.x0 - 6, y: 0, w: desk.span.x1 - desk.span.x0 + 12, h: top });
    }
  }

  // ---- the template's floor plan
  const placedBySlot = new Map<string, Placed>();
  if (perchPlaced) placedBySlot.set(perchPlaced.item.t === 'desk' ? 'desk' : perchPlaced.item.t === 'bed' ? 'bed' : 'shelf', perchPlaced);
  const bench = scene.find('desk');
  if (bench && inp.workbench) placedBySlot.set('desk', bench);
  for (const slot of template.floorPlan) {
    if (placedBySlot.has(slot.id) || (inp.workbench && slot.kind === 'desk')) continue;
    if (!rng.chance(slot.chance)) continue;
    const p = placeSlot(scene, slot, look, rng, placedBySlot, inp.hazards.margin);
    if (p) placedBySlot.set(slot.id, p);
  }

  // ---- never leave a room bare: fill in from the template (and, failing that, a table) until it has two pieces
  const pieces = () => scene.placed.filter((p) => p.span && p.tag !== 'fanHost').length;
  if (!inp.minimal && pieces() < 2) {
    for (const slot of template.floorPlan) {
      if (pieces() >= 2) break;
      if (placedBySlot.has(slot.id) || (inp.workbench && slot.kind === 'desk')) continue;
      const p = placeSlot(scene, slot, look, rng, placedBySlot, inp.hazards.margin);
      if (p) placedBySlot.set(slot.id, p);
    }
    for (const kind of ['sideTable', 'nightstand', 'dresser'] as const) {
      if (pieces() >= 2) break;
      scene.placeFloor({ kind, tag: `filler-${kind}`, v: variantIndex(kind, look.wood), margin: inp.hazards.margin });
    }
  }

  // ---- hazard furniture: a tall bookshelf that narrows the corridor
  if (inp.hazards.tallShelf) {
    scene.placeFloor({ kind: 'bookshelf', tag: 'tallShelf', h: rng.int(196, 214), w: rng.int(88, 112), v: woodV('bookshelf'), where: 'exit', margin: 9 });
  }

  // ---- candles on tables near the path (fire)
  for (let i = 0; i < inp.hazards.candles; i++) placeCandle(scene, inp.hazards.flameMargin, rng, i);

  // ---- drips from the ceiling (water)
  for (let i = 0; i < inp.hazards.drips; i++) placeDrip(scene, air, io, rng, i);

  // ---- rug
  if (rng.chance(template.rug) && !inp.workbench) {
    const furn = scene.placed.filter((p) => p.span && p.tag !== 'fanHost');
    const around = furn.length ? furn.reduce((a, p) => a + (p.span!.x0 + p.span!.x1) / 2, 0) / furn.length : undefined;
    scene.placeRug({ tag: 'rug', w: rng.int(160, 230), v: variantIndex('rug', look.rug), around });
  } else if (inp.workbench && rng.chance(0.6)) {
    scene.placeRug({ tag: 'rug', w: rng.int(150, 200), v: variantIndex('rug', look.rug) });
  }

  // ---- hanging lamp
  if (rng.chance(template.pendant)) scene.placeCeiling({ kind: 'pendant', tag: 'pendant', v: variantIndex('pendant', look.pendant), extra: { len: rng.int(22, 46) } });

  // ---- wall decor
  const furniture = scene.placed.filter((p) => p.span);
  for (const slot of template.wallPlan) {
    if (!rng.chance(slot.chance)) continue;
    const n = rng.int(slot.n[0], slot.n[1]);
    for (let i = 0; i < n; i++) {
      const spec = wallSpec(slot.kind, slot, look, rng);
      scene.placeWall({ ...spec, over: furniture });
    }
  }
  return scene;
}

function wallSpec(kind: string, slot: { w?: readonly [number, number]; h?: readonly [number, number]; v?: readonly number[] }, look: RoomLook, rng: Rng) {
  const base = { kind, tag: kind };
  switch (kind) {
    case 'window':
      return { ...base, w: rng.int(84, 112), h: rng.int(84, 124), v: variantIndex('window', look.curtain), yMin: 48, yMax: 190 };
    case 'frame': {
      const w = rint(rng, slot.w, rng.int(48, 76))!;
      return { ...base, w, h: rint(rng, slot.h, Math.round(w * rng.float(0.7, 0.95)))!, v: variantIndex('frame', look.frame) };
    }
    case 'poster':
      return { ...base, v: slot.v ? rng.pick(slot.v) : rng.int(0, 2) };
    default:
      return { ...base };
  }
}

function placePerch(scene: Scene, start: StartPlan, look: RoomLook, rng: Rng, deskSlot: FloorSlot | undefined): Placed | null {
  const woodV = (kind: string) => variantIndex(kind, look.wood);
  const dirX = scene.dirX;
  if (start.perch === 'desk') {
    const w = rint(rng, deskSlot?.w, 160)!;
    const left = start.x - rng.int(36, w - 36);
    const p = scene.placeFloor({ kind: 'desk', tag: 'desk', w, at: left - 4, v: woodV('desk'), margin: 10 });
    if (p) {
      const slot = deskSlot?.on ?? [];
      for (const o of slot) if (rng.chance(o.chance)) scene.placeOn(p, onSpec(o.kind, look, rng, o.n));
    }
    return p;
  }
  if (start.perch === 'bed') {
    const w = rng.int(200, 224);
    const at = dirX > 0 ? 16 : 624 - w;
    return scene.placeFloor({ kind: 'bed', tag: 'bed', w, at, v: variantIndex('bed', look.quilt), margin: 10 });
  }
  if (start.perch === 'shelf') {
    const h = start.shelfH ?? 176;
    const w = rng.int(92, 112);
    const left = start.x - rng.int(30, w - 30);
    return scene.placeFloor({ kind: 'bookshelf', tag: 'shelf', w, h, at: left, v: woodV('bookshelf'), margin: 10 });
  }
  return null;
}

function onSpec(kind: string, look: RoomLook, rng: Rng, n?: readonly [number, number]) {
  const base = { kind, tag: kind };
  if (kind === 'deskLamp') return { ...base, v: variantIndex('deskLamp', look.lamp) };
  if (kind === 'books') return { ...base, extra: { n: n ? rng.int(n[0], n[1]) : 3, v: rng.int(0, 4) } };
  return base;
}

function placeSlot(scene: Scene, slot: FloorSlot, look: RoomLook, rng: Rng, bySlot: Map<string, Placed>, margin: number): Placed | null {
  const near = slot.near ? bySlot.get(slot.near) : undefined;
  if (slot.near && !near) return null;
  const woodV = variantIndex(slot.kind, look.wood);
  const v = slot.kind === 'bed' ? variantIndex('bed', look.quilt) : slot.kind === 'toyBox' ? undefined : woodV;
  const base = { kind: slot.kind, tag: slot.id, w: rint(rng, slot.w), h: rint(rng, slot.h), v, where: slot.where, againstWall: slot.againstWall, margin };
  let p: Placed | null;
  if (slot.kind === 'chair' && near?.span) {
    // a chair faces its desk: the backrest is on the side away from it (`flip` = backrest on the right)
    const rightFirst = rng.chance(0.5);
    const tries = rightFirst ? ['right', 'left'] : ['left', 'right'];
    p = null;
    for (const side of tries) {
      const right = side === 'right';
      const at = right ? near.span.x1 + 6 : near.span.x0 - 6 - 46;
      p = scene.placeFloor({ ...base, near, at, extra: { flip: right } });
      if (p) break;
    }
  } else p = scene.placeFloor({ ...base, near });
  if (!p) return null;
  if (slot.on) for (const o of slot.on) if (rng.chance(o.chance)) scene.placeOn(p, onSpec(o.kind, look, rng, o.n));
  return p;
}

function placeCandle(scene: Scene, flameMargin: number, rng: Rng, index: number): void {
  const hosts = scene.surfaces.filter((s) => s.host.item.t === 'sideTable' || s.host.item.t === 'nightstand' || s.host.item.t === 'dresser');
  const order = rng.shuffle(hosts);
  for (const s of order) {
    const wax = rng.int(14, 24);
    if (scene.placeOn(s.host, { kind: 'candle', tag: `candle${index}`, extra: { wax }, margin: flameMargin })) return;
  }
  // no suitable table: stand a side table (with the candle) somewhere the flame stays clear
  const t = scene.placeFloor({ kind: 'sideTable', tag: `candleTable${index}`, w: rng.int(76, 92), v: variantIndex('sideTable', 'walnut'), margin: 10 });
  if (t) {
    const wax = rng.int(14, 24);
    if (!scene.placeOn(t, { kind: 'candle', tag: `candle${index}`, extra: { wax }, margin: flameMargin })) scene.remove(t);
  }
}

function placeDrip(scene: Scene, air: AirPlan, io: RoomIO, rng: Rng, index: number): void {
  // where the plane crosses once, at speed: after the last thermal, never over a thermal column
  const cols = air.vents.map((v) => ({ x0: v.x - 70, x1: v.x + v.w + 70 }));
  const lo = io.dirX > 0 ? 330 : 80;
  const hi = io.dirX > 0 ? 580 : 330;
  const xs: number[] = [];
  for (let x = lo; x <= hi; x += 10) if (!cols.some((c) => x > c.x0 && x < c.x1) && !scene.placed.some((p) => p.item.t === 'drip' && Math.abs(p.item.x - x) < 90)) xs.push(x);
  if (xs.length === 0) return;
  const x = rng.pick(xs);
  const floorY = scene.surfaceBelow(x, 24);
  scene.addFixed({ t: 'drip', x, y: 20, every: Math.round(rng.float(1.3, 2.0) * 10) / 10, floorY: Math.min(LAYOUT.floor - 2, floorY) }, `drip${index}`, { removable: true });
}
