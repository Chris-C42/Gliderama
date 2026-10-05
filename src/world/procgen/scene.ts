/**
 * The scene a room is dressed in: placed items with their real colliders, free floor, free wall, and the flight
 * band that nothing solid may enter. All the "where does this fit" logic lives here; the templates only say what.
 */

import type { Rng } from '../../core/rng';
import { KINDS } from '../kinds';
import { LAYOUT, type ItemDef, type RoomDef } from '../types';
import { CATALOG, CANDLE, boxOf, floorY, surfaceOf, wallAboveOf } from './catalog';
import { Band, overlaps, translate, unionX } from './geom';
import type { Where } from './themes';
import type { Box } from './types';

export interface Placed {
  item: ItemDef;
  /** Which template slot or planner made it. */
  tag: string;
  /** Real colliders from the kind's painter module (empty for decor). */
  boxes: Box[];
  /** Visual box (for wall decor overlap and bounds). */
  box: Box;
  /** x-range on the floor (floor furniture only). */
  span?: { x0: number; x1: number };
  /** Surface items standing on this host, and the host they stand on. */
  children: Placed[];
  host?: Placed;
  /** The generator may remove it to repair a failing flight. */
  removable: boolean;
}

export interface Surface {
  host: Placed;
  x0: number;
  x1: number;
  top: number;
  used: { x0: number; x1: number }[];
}

export interface FloorSpec {
  kind: string;
  tag: string;
  w?: number;
  h?: number;
  v?: number;
  extra?: Record<string, unknown>;
  where?: Where;
  /** Stand right next to this placed item. */
  near?: Placed;
  againstWall?: boolean;
  /** Bounds for the left edge of the item's colliders. */
  xMin?: number;
  xMax?: number;
  /** Clearance below the flight band (px). */
  margin?: number;
  removable?: boolean;
  /** Fixed position: the left edge of the item's colliders. */
  at?: number;
}

export interface WallSpec {
  kind: string;
  tag: string;
  w?: number;
  h?: number;
  v?: number;
  extra?: Record<string, unknown>;
  /** Prefer positions above this furniture (frames over a dresser). */
  over?: Placed[];
  yMin?: number;
  yMax?: number;
  removable?: boolean;
}

export const WALL_Y_MIN = 40;
/** Wall decor hangs between y 40 and 200 (windows end at 190: their curtains hang 16 px lower). */
export const WALL_Y_MAX = 200;
const X_MIN = 16;
const X_MAX = 624;
const FLOOR_GAP = 8;
const NEVER = Infinity;

/** Monotone weight for a score (polynomial: no transcendental functions in seeded code). */
function weight(s: number): number {
  const t = 1 + Math.max(s, -0.9);
  return t * t;
}

export class Scene {
  readonly placed: Placed[] = [];
  readonly surfaces: Surface[] = [];
  /** Wall regions that are taken (door art, switch plates ...), besides the decor itself. */
  readonly reservedWall: Box[] = [];
  /** Floor x-ranges that must stay free (vents, stairwells). */
  readonly reservedFloor: { x0: number; x1: number }[] = [];
  /** Wall things (switch plates) that furniture tops must stay below. */
  readonly keepClear: Box[] = [];
  /** Columns a plane comes down through to land (the workbench desk): nothing solid may hang into them. */
  readonly landing: Box[] = [];

  constructor(
    readonly stub: RoomDef,
    readonly band: Band,
    readonly rng: Rng,
    readonly dirX: 1 | -1,
  ) {}

  // ---- queries

  boxesOf(it: ItemDef): Box[] {
    const k = KINDS[it.t];
    if (!k?.colliders) return [];
    return k.colliders(it, this.stub).map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));
  }

  find(tag: string): Placed | undefined {
    return this.placed.find((p) => p.tag === tag);
  }

  /** Does a collider reach up into a wall thing that has to stay visible? */
  private hitsKeepClear(b: Box): boolean {
    for (const k of this.keepClear) if (b.x < k.x + k.w + 6 && k.x < b.x + b.w + 6 && b.y < k.y + k.h + 6) return true;
    return false;
  }

  /** Would a solid part of this item hang into a landing column? */
  private hitsLanding(item: ItemDef): boolean {
    return this.landing.length > 0 && this.boxesOf(item).some((b) => this.landing.some((l) => overlaps(b, l, 0)));
  }

  floorFree(x0: number, x1: number, gap = FLOOR_GAP): boolean {
    for (const p of this.placed) if (p.span && x0 < p.span.x1 + gap && p.span.x0 < x1 + gap) return false;
    for (const r of this.reservedFloor) if (x0 < r.x1 + 4 && r.x0 < x1 + 4) return false;
    return true;
  }

  /** y of the highest solid surface under (x, y): where a drip splashes. */
  surfaceBelow(x: number, y: number): number {
    let best = LAYOUT.floor - 2;
    for (const p of this.placed)
      for (const b of p.boxes) if (x >= b.x && x <= b.x + b.w && b.y >= y - 2 && b.y < best) best = b.y;
    return best;
  }

  /** Tops of everything that stands up from the floor (furniture and what is on it), with their x-ranges. */
  furnitureTops(): { x0: number; x1: number; top: number }[] {
    const out: { x0: number; x1: number; top: number }[] = [];
    for (const p of this.placed) {
      if (!p.span && !p.host) continue;
      const boxes = p.boxes.length ? p.boxes : [p.box];
      let top = Infinity;
      for (const b of boxes) if (b.y < top) top = b.y;
      const u = unionX(boxes);
      out.push({ x0: p.span ? p.span.x0 : u.x0, x1: p.span ? p.span.x1 : u.x1, top });
    }
    return out;
  }

  // ---- registration

  private register(item: ItemDef, tag: string, extra: Partial<Placed>): Placed {
    const boxes = this.boxesOf(item);
    const p: Placed = { item, tag, boxes, box: boxOf(item), children: [], removable: true, ...extra };
    this.placed.push(p);
    return p;
  }

  /** Add an item at a fixed place without any fit test (planner-made things: fans, the door). */
  addFixed(item: ItemDef, tag: string, opts: { span?: boolean; removable?: boolean } = {}): Placed {
    const p = this.register(item, tag, { removable: opts.removable ?? false });
    if (opts.span) {
      const u = unionX(p.boxes.length ? p.boxes : [p.box]);
      p.span = { x0: u.x0, x1: u.x1 };
    }
    return p;
  }

  remove(p: Placed): void {
    for (const c of [...p.children]) this.remove(c);
    p.children = [];
    const i = this.placed.indexOf(p);
    if (i >= 0) this.placed.splice(i, 1);
    if (p.host) {
      p.host.children = p.host.children.filter((c) => c !== p);
      const s = this.surfaces.find((q) => q.host === p.host);
      if (s) s.used = s.used.filter((u) => !(u.x0 === p.box.x && u.x1 === p.box.x + p.box.w));
    }
    const si = this.surfaces.findIndex((s) => s.host === p);
    if (si >= 0) this.surfaces.splice(si, 1);
  }

  /** Stop carrying things on this host (the workbench top stays clear). */
  clearSurface(host: Placed): void {
    for (const c of [...host.children]) this.remove(c);
    const si = this.surfaces.findIndex((s) => s.host === host);
    if (si >= 0) this.surfaces.splice(si, 1);
  }

  // ---- floor furniture

  placeFloor(spec: FloorSpec): Placed | null {
    const e = CATALOG[spec.kind];
    const item: ItemDef = { t: spec.kind, x: 0, y: floorY(spec.h ?? e.h) };
    if (spec.w !== undefined) item.w = spec.w;
    if (spec.h !== undefined) item.h = spec.h;
    if (spec.v !== undefined) item.v = spec.v;
    if (spec.extra) Object.assign(item, spec.extra);
    const boxes0 = this.boxesOf(item);
    if (boxes0.length === 0) return null;
    const u0 = unionX(boxes0);
    const width = u0.x1 - u0.x0;
    const margin = spec.margin ?? 16;

    const lo = Math.max(spec.xMin ?? X_MIN, X_MIN);
    const hi = Math.min(spec.xMax ?? X_MAX, X_MAX) - width;
    const cands: { x: number; w: number }[] = [];
    const tryX = (left: number) => {
      if (left < lo - 0.001 || left > hi + 0.001) return;
      if (!this.floorFree(left, left + width, spec.near ? 2 : FLOOR_GAP)) return;
      const dx = left - u0.x0;
      for (const b of boxes0) if (!this.band.clear(translate(b, dx), margin, NEVER) || this.hitsKeepClear(translate(b, dx))) return;
      // a chimney breast would hide a switch plate on the wall above
      const breast = wallAboveOf({ ...item, x: dx });
      if (breast && this.keepClear.some((k) => overlaps(breast, k, 6))) return;
      cands.push({ x: left, w: this.scoreFloor(left, width, spec) });
    };
    if (spec.at !== undefined) tryX(spec.at);
    else if (spec.near?.span) {
      const t = spec.near.span;
      for (const gap of [6, 10, 16]) {
        tryX(t.x1 + gap);
        tryX(t.x0 - gap - width);
      }
    } else for (let left = Math.ceil(lo / 4) * 4; left <= hi; left += 4) tryX(left);
    if (cands.length === 0) return null;
    const pick = this.rng.weighted(cands.map((c) => ({ item: c, w: c.w })));
    item.x = pick.x - u0.x0; // the collider union then starts at pick.x
    const p = this.register(item, spec.tag, { removable: spec.removable ?? true });
    const above = wallAboveOf(item);
    if (above) this.reservedWall.push(above);
    p.span = { x0: pick.x, x1: pick.x + width };
    const s = surfaceOf(item);
    if (s) this.surfaces.push({ host: p, x0: s.x0, x1: s.x1, top: s.top, used: [] });
    return p;
  }

  private scoreFloor(left: number, width: number, spec: FloorSpec): number {
    const centre = left + width / 2;
    const u = this.dirX > 0 ? centre : 640 - centre;
    let s = this.rng.float(0, 0.8);
    if (spec.where === 'entry') s += (1 - u / 320) * 1.6;
    else if (spec.where === 'exit') s += (u / 320 - 1) * 1.6 + 1.6;
    else if (spec.where === 'mid') s += 1.6 - Math.abs(u - 320) / 110;
    if (spec.againstWall && Math.min(left - X_MIN, X_MAX - (left + width)) <= 24) s += 2.2;
    return weight(s);
  }

  // ---- surface items

  /** Put a small item on top of a host. Returns null when nothing fits. */
  placeOn(host: Placed, spec: { kind: string; tag: string; v?: number; extra?: Record<string, unknown>; margin?: number }): Placed | null {
    const surf = this.surfaces.find((s) => s.host === host);
    if (!surf) return null;
    const e = CATALOG[spec.kind];
    const probe: ItemDef = { t: spec.kind, x: 0, y: 0, ...(spec.extra ?? {}) };
    if (spec.v !== undefined) probe.v = spec.v;
    const rest = spec.kind === 'candle' ? (typeof probe.wax === 'number' ? probe.wax : 18) + CANDLE.holder : (e.rest ?? 0);
    probe.y = surf.top - rest;
    const off = boxOf(probe); // visual box at x = 0: its x is the offset of the box from item.x
    const margin = spec.margin ?? 14;
    const cands: { x: number; w: number }[] = [];
    for (let left = Math.ceil((surf.x0 + 4) / 2) * 2; left + off.w <= surf.x1 - 4; left += 2) {
      if (surf.used.some((u) => left < u.x1 + 4 && u.x0 < left + off.w + 4)) continue;
      const item: ItemDef = { ...probe, x: left - off.x };
      let ok = this.boxesOf(item).every((b) => this.band.clear(b, margin, NEVER) && !this.hitsKeepClear(b));
      if (ok && spec.kind === 'candle') {
        const flame: Box = { x: item.x, y: item.y - CANDLE.flameUp, w: 6, h: CANDLE.flameUp };
        ok = this.band.clear(flame, margin, NEVER);
      }
      if (ok) cands.push({ x: left, w: this.rng.float(0.2, 1) });
    }
    if (cands.length === 0) return null;
    const pick = this.rng.weighted(cands.map((c) => ({ item: c, w: c.w })));
    const item: ItemDef = { ...probe, x: pick.x - off.x };
    const p = this.register(item, spec.tag, { host, removable: true });
    host.children.push(p);
    surf.used.push({ x0: p.box.x, x1: p.box.x + p.box.w });
    return p;
  }

  // ---- wall decor

  placeWall(spec: WallSpec): Placed | null {
    const e = CATALOG[spec.kind];
    const w = spec.w ?? e.w;
    const h = spec.h ?? e.h;
    const base: ItemDef = { t: spec.kind, x: 0, y: 0 };
    if (spec.w !== undefined) base.w = spec.w;
    if (spec.h !== undefined) base.h = spec.h;
    if (spec.v !== undefined) base.v = spec.v;
    if (spec.extra) Object.assign(base, spec.extra);
    const isClock = spec.kind === 'wallClock';
    const r = typeof base.r === 'number' ? base.r : 16;
    const at = (x: number, y: number): ItemDef => ({ ...base, x: isClock ? x + r : x, y: isClock ? y + r : y });
    const tops = this.furnitureTops();
    const wallPlaced = this.placed.filter((p) => CATALOG[p.item.t]?.placement === 'wall');
    const cands: { x: number; y: number; w: number }[] = [];
    const yMin = spec.yMin ?? WALL_Y_MIN;
    const yMax = spec.yMax ?? WALL_Y_MAX;
    for (let y = Math.ceil(yMin / 4) * 4; y + h <= yMax; y += 4) {
      for (let x = 24; x + w <= 616; x += 6) {
        const item = at(x, y);
        const box = boxOf(item);
        if (box.x < 20 || box.x + box.w > 620 || box.y < yMin - 12 || box.y + box.h > LAYOUT.dado - 2) continue;
        if (wallPlaced.some((p) => overlaps(box, p.box, 6))) continue;
        if (this.reservedWall.some((rw) => overlaps(box, rw, 4))) continue;
        // clear of tall furniture (and what stands on it) by 6 px
        if (tops.some((t) => box.x < t.x1 + 6 && t.x0 < box.x + box.w + 6 && box.y + box.h > t.top - 6)) continue;
        // anything solid on the wall (a window's sill, a cottage window's flower box) must be out of the plane's way
        if (!this.boxesOf(item).every((b) => this.band.clear(b, 14, 14))) continue;
        if (this.hitsLanding(item)) continue;
        cands.push({ x, y, w: this.scoreWall(box, spec, tops) });
      }
    }
    if (cands.length === 0) return null;
    const pick = this.rng.weighted(cands.map((c) => ({ item: c, w: c.w })));
    return this.register(at(pick.x, pick.y), spec.tag, { removable: spec.removable ?? true });
  }

  private scoreWall(box: Box, spec: WallSpec, tops: { x0: number; x1: number; top: number }[]): number {
    let s = this.rng.float(0, 1);
    const cx = box.x + box.w / 2;
    // hang things over furniture, and near a common eye line
    if ((spec.over ?? []).some((p) => p.span && cx > p.span.x0 + 4 && cx < p.span.x1 - 4)) s += 1.4;
    else if (tops.some((t) => cx > t.x0 && cx < t.x1)) s += 0.5;
    if (spec.kind === 'frame' || spec.kind === 'poster') s += 0.8 - Math.abs(box.y + box.h / 2 - 96) / 80;
    return weight(s);
  }

  // ---- ceiling

  placeCeiling(spec: { kind: string; tag: string; v?: number; extra?: Record<string, unknown>; margin?: number }): Placed | null {
    const base: ItemDef = { t: spec.kind, x: 0, y: 0, ...(spec.extra ?? {}) };
    if (spec.v !== undefined) base.v = spec.v;
    const cands: { x: number; w: number }[] = [];
    for (let x = 60; x <= 580; x += 8) {
      const item = { ...base, x };
      const box = boxOf(item);
      if (box.x < 30 || box.x + box.w > 610) continue;
      if (!this.boxesOf(item).every((b) => this.band.clear(b, NEVER, spec.margin ?? 16))) continue;
      if (this.hitsLanding(item)) continue;
      if (this.placed.some((p) => p.item.t === spec.kind && Math.abs(p.item.x - x) < 90)) continue;
      cands.push({ x, w: this.rng.float(0.2, 1) });
    }
    if (cands.length === 0) return null;
    const pick = this.rng.weighted(cands.map((c) => ({ item: c, w: c.w })));
    return this.register({ ...base, x: pick.x }, spec.tag, { removable: true });
  }

  // ---- rugs

  placeRug(spec: { tag: string; w: number; v: number; y?: number; around?: number }): Placed | null {
    const y = spec.y ?? 326;
    const cands: { x: number; w: number }[] = [];
    for (let left = 24; left + spec.w <= 616; left += 8) {
      const x1 = left + spec.w;
      if (this.reservedFloor.some((r) => left < r.x1 + 6 && r.x0 < x1 + 6)) continue;
      if (this.placed.some((p) => p.item.t === 'rug' && left < p.box.x + p.box.w + 16 && p.box.x < x1 + 16)) continue;
      const s = spec.around !== undefined ? 1.6 - Math.abs(left + spec.w / 2 - spec.around) / 120 : this.rng.float(0, 1.2);
      cands.push({ x: left, w: weight(s) });
    }
    if (cands.length === 0) return null;
    const pick = this.rng.weighted(cands.map((c) => ({ item: c, w: c.w })));
    return this.register({ t: 'rug', x: pick.x, y, w: spec.w, v: spec.v }, spec.tag, { removable: true });
  }
}
