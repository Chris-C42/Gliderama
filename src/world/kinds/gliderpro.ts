/**
 * Pieces from Glider PRO's houses drawn the Gliderama way: the still parts of its hazards (the goldfish's bowl, a
 * cobweb, an electric outlet, a paper shredder; what moves is drawn by the runtime objects in game/objects/enemies),
 * and its furniture and clutter (clouds, mirrors, crates, cupboards, a teddy bear, a guitar, wind chimes...).
 * Appliances are in ./appliances.
 */

import { R } from '../../render/palette';
import { BOWL, SHREDDER } from '../gliderpro';
import type { ItemDef } from '../types';
import type { KindDef } from './types';

/** The goldfish's bowl, standing on a table top at y + 36. */
export const fishBowlKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it;
    const cx = x + BOWL.w / 2;
    const cy = y + 21;
    // a soft shadow on the table
    px.dither(cx - 16, y + BOWL.h - 1, 32, 1, R.ink[1], 0.5);
    // the glass, the water below its surface and the air above it
    px.ellipse(cx, cy, 22, 15, R.sky[4]);
    px.ellipse(cx, cy, 21, 14, R.sky[5]);
    for (let j = 0; j < 30; j++) {
      const yy = cy - 14 + j;
      const v = (yy - cy) / 14;
      const half = Math.round(Math.sqrt(Math.max(0, 1 - v * v)) * 20);
      if (yy < y + 10) px.dither(cx - half, yy, half * 2, 1, R.sky[4], 0.25);
      else px.hline(cx - half, yy, half * 2, yy < y + 22 ? R.sky[3] : R.sky[2]);
    }
    px.dither(cx - 20, y + 20, 40, 3, R.sky[2], 0.5);
    px.hline(cx - 19, y + 10, 38, R.sky[4]);
    // gravel and a sprig of weed
    for (let j = 0; j < 4; j++) {
      const half = Math.round(17 - j * 3.5);
      px.hline(cx - half, y + 31 + j, half * 2, j % 2 ? R.mustard[2] : R.stone[3]);
    }
    px.speckle(cx - 16, y + 30, 32, 3, [R.mustard[4], R.stone[4], R.red[3]], 0.25);
    for (const [dx, h] of [
      [-11, 12],
      [-8, 16],
      [-5, 10],
    ] as const) {
      px.line(cx + dx, y + 31, cx + dx + 2, y + 31 - h, R.leaf[3]);
      px.px(cx + dx + 1, y + 31 - h * 0.6, R.leaf[5]);
    }
    // the rim of the opening, and the glints on the glass
    px.ellipse(cx, y + 6, 12, 2, R.sky[5]);
    px.hline(cx - 12, y + 6, 25, R.steel[6]);
    px.hline(cx - 11, y + 7, 23, R.sky[4]);
    px.vline(cx - 17, cy - 6, 9, R.steel[6]);
    px.px(cx - 16, cy - 8, R.steel[6]);
    px.vline(cx + 16, cy + 2, 4, R.sky[5]);
  },
  colliders(it) {
    return [{ x: it.x + 3, y: it.y + 8, w: BOWL.w - 6, h: BOWL.h - 8 }];
  },
};

/** A cobweb strung across a corner or under the ceiling: radial threads and a sagging spiral. */
export const cobwebKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = it.w ?? 68;
    const h = it.h ?? 48;
    const hx = it.x + w * 0.5;
    const hy = it.y + h * 0.42;
    // where each thread is tied to the edge of the web's box
    const ties: [number, number][] = [];
    const N = 9;
    for (let k = 0; k < N; k++) {
      const a = -Math.PI / 2 + (k / N) * Math.PI * 2 + 0.2;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const tx = dx > 0 ? (it.x + w - hx) / dx : dx < 0 ? (it.x - hx) / dx : Infinity;
      const ty = dy > 0 ? (it.y + h - hy) / dy : dy < 0 ? (it.y - hy) / dy : Infinity;
      const t = Math.min(tx, ty);
      ties.push([hx + dx * t, hy + dy * t]);
    }
    for (const [tx, ty] of ties) px.line(hx, hy, tx, ty, R.stone[3]);
    // the spiral, each span sagging a little between its threads
    for (const f of [0.22, 0.4, 0.58, 0.76, 0.92]) {
      for (let k = 0; k < N; k++) {
        if ((k + Math.round(f * 10)) % 7 === 0) continue; // a broken span here and there
        const a = ties[k];
        const b = ties[(k + 1) % N];
        const ax = hx + (a[0] - hx) * f;
        const ay = hy + (a[1] - hy) * f;
        const bx = hx + (b[0] - hx) * f;
        const by = hy + (b[1] - hy) * f;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2 + 1.5 * f;
        px.line(ax, ay, mx, my, R.stone[4]);
        px.line(mx, my, bx, by, R.stone[4]);
      }
    }
    px.px(hx, hy, R.stone[5]);
    px.ellipse(hx, hy, 1, 1, R.stone[4]);
  },
};

/** A wall outlet (18 × 24): a cream plate with two sockets. The sparks are the `outlet` object. */
export const outletKind: KindDef = {
  z: 0,
  paint(px, it) {
    const { x, y } = it;
    px.dither(x + 2, y + 2, 18, 24, R.ink[1], 0.3);
    px.rect(x, y, 18, 24, R.cream[2]);
    px.rect(x + 1, y + 1, 16, 22, R.cream[4]);
    px.hline(x + 1, y + 1, 16, R.cream[5]);
    px.hline(x + 1, y + 22, 16, R.cream[3]);
    px.vline(x + 16, y + 2, 20, R.cream[3]);
    for (const sy of [y + 4, y + 14]) {
      px.rect(x + 4, sy, 10, 6, R.cream[3]);
      px.rect(x + 5, sy, 8, 5, R.cream[5]);
      px.vline(x + 6, sy + 1, 3, R.ink[2]);
      px.vline(x + 11, sy + 1, 3, R.ink[2]);
      px.px(x + 9, sy + 4, R.ink[2]);
    }
    px.px(x + 9, y + 11, R.stone[2]);
  },
};

/** An office paper shredder: a slot across its lid and a grille down its front. */
export const shredderKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it;
    const { w, h } = SHREDDER;
    px.dither(x + 2, y + h - 1, w - 4, 2, R.ink[1], 0.5);
    // the body
    px.rect(x, y + 4, w, h - 4, R.steel[2]);
    px.rect(x + 1, y + 5, w - 2, h - 7, R.steel[3]);
    px.vline(x + 1, y + 5, h - 7, R.steel[4]);
    px.vline(x + w - 2, y + 5, h - 7, R.steel[1]);
    px.hline(x, y + h - 1, w, R.steel[0]);
    // the lid and its slot
    px.rect(x + 2, y, w - 4, 5, R.steel[4]);
    px.hline(x + 2, y, w - 4, R.steel[5]);
    px.rect(x + 9, y + 2, w - 18, 2, R.ink[0]);
    px.hline(x + 9, y + 1, w - 18, R.steel[6]);
    // the grille, a label and the power light
    for (let gx = x + 8; gx < x + w - 24; gx += 4) px.vline(gx, y + 8, h - 12, R.steel[1]);
    px.rect(x + w - 20, y + 9, 12, 6, R.cream[4]);
    px.hline(x + w - 18, y + 11, 8, R.steel[2]);
    px.rect(x + w - 15, y + 17, 2, 2, R.moss[5]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 2, w: SHREDDER.w, h: SHREDDER.h - 2 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Furniture and clutter. x, y = top-left of the item's box; w, h default to Glider PRO's size in Gliderama pixels.

const W = (it: ItemDef, d: number) => Math.round(it.w ?? d);
const H = (it: ItemDef, d: number) => Math.round(it.h ?? d);
const pick = <T,>(it: ItemDef, options: readonly T[]) => options[(it.v ?? 0) % options.length];

/** A cloud in an outdoor room's sky (Glider PRO 128 × 30). */
export const cloudKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 160);
    const h = H(it, 32);
    const { x, y } = it;
    const puffs: [number, number, number, number][] = [
      [0.13, 0.74, 0.1, 0.32],
      [0.3, 0.6, 0.17, 0.42],
      [0.5, 0.5, 0.22, 0.52],
      [0.7, 0.58, 0.18, 0.44],
      [0.88, 0.72, 0.1, 0.32],
    ];
    // the shaded underside, the body, then the sunlit tops
    for (const [u, v, rx, ry] of puffs) px.ellipse(x + w * u, y + h * v + 2, w * rx, h * ry, R.sky[4]);
    px.rect(x + w * 0.12, y + h * 0.72, w * 0.76, h * 0.28, R.sky[4]);
    for (const [u, v, rx, ry] of puffs) px.ellipse(x + w * u, y + h * v, w * rx - 1, h * ry - 1, R.sky[5]);
    for (const [u, v, rx, ry] of puffs) px.ellipse(x + w * u - w * rx * 0.25, y + h * v - h * ry * 0.35, w * rx * 0.55, h * ry * 0.45, '#ffffff');
    px.dither(x + w * 0.14, y + h - 3, w * 0.72, 3, R.sky[3], 0.35);
  },
};

/** A wall mirror (Glider PRO 64 × 64, any size): a gilt or oak frame round a glinting glass. */
export const mirrorKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 80);
    const h = H(it, 68);
    const { x, y } = it;
    const frame = pick(it, [R.brass, R.oak, R.walnut]);
    px.dither(x + 2, y + 2, w, h, R.ink[1], 0.3);
    px.rect(x, y, w, h, frame[1]);
    px.rect(x + 1, y + 1, w - 2, h - 2, frame[4]);
    px.rect(x + 3, y + 3, w - 6, h - 6, frame[2]);
    px.hline(x + 1, y + 1, w - 2, frame[5]);
    px.vline(x + 1, y + 1, h - 2, frame[5]);
    // the glass, and two glints across it
    px.vgrad(x + 5, y + 5, w - 10, h - 10, [R.steel[6], R.sky[5], R.sky[4], R.steel[5]]);
    for (const [o, len] of [
      [0.18, 0.4],
      [0.3, 0.22],
    ] as const) {
      const sx = x + 5 + (w - 10) * o;
      const sy = y + 6;
      const n = Math.round(Math.min(w, h) * len);
      px.line(sx + n, sy, sx, sy + n, '#ffffff');
      px.line(sx + n + 1, sy, sx + 1, sy + n, R.steel[6]);
    }
  },
};

/** A plastic milk crate (Glider PRO 64 × 58): a rim, two rows of holes and a hand slot. */
export const milkCrateKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 80);
    const h = H(it, 62);
    const { x, y } = it;
    const c = pick(it, [R.red, R.navy, R.moss, R.mustard]);
    if (y + h >= 336) px.dither(x - 2, y + h - 1, w + 4, 2, R.ink[1], 0.55);
    px.rect(x, y, w, h, c[1]);
    px.rect(x + 1, y + 1, w - 2, h - 2, c[3]);
    px.rect(x + 1, y + 1, w - 2, 6, c[4]);
    px.hline(x + 1, y + 1, w - 2, c[5]);
    px.rect(x + w / 2 - 9, y + 3, 18, 3, c[1]);
    // two rows of holes, the contents dark inside
    const cols = Math.max(2, Math.round(w / 18));
    const hw = (w - 6) / cols;
    for (const [ry, rh] of [
      [y + 11, (h - 19) / 2 - 2],
      [y + 11 + (h - 19) / 2 + 2, (h - 19) / 2 - 2],
    ])
      for (let k = 0; k < cols; k++) {
        const hx = x + 3 + k * hw + 2;
        px.rect(hx, ry, hw - 4, rh, c[1]);
        px.hline(hx, ry + rh - 1, hw - 4, c[2]);
      }
    px.rect(x + 1, y + h - 5, w - 2, 4, c[2]);
    px.vline(x + w - 2, y + 7, h - 12, c[2]);
  },
  colliders: (it) => [{ x: it.x, y: it.y, w: W(it, 80), h: H(it, 62) }],
};

/** A mouse hole in the skirting (Glider PRO 10 × 11); `v` 1: somebody is home. */
export const mouseholeKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 14);
    const h = H(it, 13);
    const { x, y } = it;
    const r = w / 2;
    px.ellipse(x + r, y + r, r + 1, r + 1, R.ink[2]);
    px.rect(x - 1, y + r, w + 2, h - r, R.ink[2]);
    px.ellipse(x + r, y + r, r - 0.5, r - 0.5, R.ink[0]);
    px.rect(x, y + r, w, h - r, R.ink[0]);
    if ((it.v ?? 0) % 2 === 1) {
      px.px(x + r - 2, y + r + 1, R.mustard[5]);
      px.px(x + r + 1, y + r + 1, R.mustard[5]);
    }
  },
};

/** A teddy bear sitting up (Glider PRO 56 × 58). */
export const bearKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 70);
    const h = H(it, 62);
    const s = Math.min(w / 70, h / 62);
    const cx = it.x + w / 2;
    const by = it.y + h;
    const fur = pick(it, [R.oak, R.pine, R.peach]);
    const P = (dx: number, dy: number): [number, number] => [cx + dx * s, by - 62 * s + dy * s];
    const blob = (dx: number, dy: number, rx: number, ry: number, c: string) => {
      const [ex, ey] = P(dx, dy);
      px.ellipse(ex, ey, rx * s, ry * s, c);
    };
    if (by >= 336) px.dither(cx - 26 * s, by - 1, 52 * s, 2, R.ink[1], 0.55);
    // arms and legs behind, the body, then the head
    blob(-17, 41, 6, 10, fur[2]);
    blob(17, 41, 6, 10, fur[2]);
    blob(0, 44, 18, 16, fur[2]);
    blob(-2, 42, 15, 13, fur[3]);
    blob(0, 47, 9, 9, fur[4]);
    blob(-12, 55, 10, 7, fur[2]);
    blob(12, 55, 10, 7, fur[2]);
    blob(-14, 56, 5, 4, R.cream[3]);
    blob(14, 56, 5, 4, R.cream[3]);
    blob(-11, 9, 6, 6, fur[2]);
    blob(11, 9, 6, 6, fur[2]);
    blob(-11, 9, 3, 3, R.peach[4]);
    blob(11, 9, 3, 3, R.peach[4]);
    blob(0, 20, 14, 13, fur[2]);
    blob(-2, 18, 12, 10, fur[3]);
    blob(0, 25, 6, 4, R.cream[4]);
    // the face and a bow
    const [nx, ny] = P(0, 22);
    px.rect(nx - 2, ny, 4, 2, R.ink[1]);
    px.px(nx, ny + 3, R.ink[2]);
    for (const ex of [-5, 5]) {
      const [qx, qy] = P(ex, 17);
      px.rect(qx - 1, qy - 1, 2, 2, R.ink[0]);
      px.px(qx - 1, qy - 1, R.steel[6]);
    }
    const [tx, ty] = P(0, 33);
    px.poly([[tx, ty], [tx - 6 * s, ty - 3 * s], [tx - 6 * s, ty + 3 * s]], R.red[3]);
    px.poly([[tx, ty], [tx + 6 * s, ty - 3 * s], [tx + 6 * s, ty + 3 * s]], R.red[3]);
    px.rect(tx - 1, ty - 1, 3, 3, R.red[4]);
  },
  colliders(it) {
    const w = W(it, 70);
    const h = H(it, 62);
    return [{ x: it.x + w * 0.2, y: it.y + h * 0.1, w: w * 0.6, h: h * 0.9, kind: 'soft' }];
  },
};

/** A cupboard (Glider PRO's cabinet, 64 × 64, any size): panelled doors with brass knobs. */
export const cabinetKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 80);
    const h = H(it, 68);
    const { x, y } = it;
    const wood = pick(it, [R.oak, R.pine, R.walnut]);
    if (y + h >= 336) px.dither(x - 2, y + h - 1, w + 4, 2, R.ink[1], 0.55);
    px.box(x, y, w, h, 4, wood);
    const n = Math.max(1, Math.round(w / 44));
    const dw = (w - 6) / n;
    for (let k = 0; k < n; k++) {
      const dx = x + 3 + k * dw;
      px.rect(dx + 1, y + 7, dw - 2, h - 11, wood[2]);
      px.rect(dx + 2, y + 8, dw - 4, h - 13, wood[3]);
      px.rect(dx + 5, y + 11, dw - 10, h - 19, wood[2]);
      px.rect(dx + 6, y + 12, dw - 12, h - 21, wood[3]);
      px.hline(dx + 6, y + 12, dw - 12, wood[4]);
      const kx = n === 1 ? dx + dw - 8 : k % 2 === 0 ? dx + dw - 7 : dx + 5;
      px.ellipse(kx, y + h / 2, 1.5, 1.5, R.brass[4]);
    }
  },
  colliders: (it) => [{ x: it.x, y: it.y, w: W(it, 80), h: H(it, 68) }],
};

/** A kitchen counter (Glider PRO 128 × 64, any size): a worktop over drawers and cupboards. */
export const counterKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 160);
    const h = H(it, 68);
    const { x, y } = it;
    const wood = pick(it, [R.pine, R.oak, R.teal]);
    const top = pick(it, [R.cream, R.stone, R.cream]);
    if (y + h >= 336) px.dither(x - 2, y + h - 1, w + 4, 2, R.ink[1], 0.55);
    // the worktop, a little proud of the cupboards
    px.rect(x - 3, y, w + 6, 6, top[2]);
    px.rect(x - 3, y, w + 6, 4, top[4]);
    px.hline(x - 3, y, w + 6, top[5]);
    // drawers, cupboards and the kick board
    px.rect(x, y + 6, w, h - 6, wood[1]);
    const n = Math.max(1, Math.round(w / 40));
    const cw = w / n;
    for (let k = 0; k < n; k++) {
      const cx = x + k * cw;
      px.rect(cx + 2, y + 8, cw - 4, 9, wood[3]);
      px.hline(cx + 2, y + 8, cw - 4, wood[4]);
      px.rect(cx + cw / 2 - 5, y + 12, 10, 2, R.steel[4]);
      px.rect(cx + 2, y + 19, cw - 4, h - 27, wood[3]);
      px.rect(cx + 5, y + 22, cw - 10, h - 33, wood[2]);
      px.hline(cx + 2, y + 19, cw - 4, wood[4]);
      px.rect(k % 2 ? cx + 6 : cx + cw - 9, y + 24, 2, 8, R.steel[4]);
    }
    px.rect(x + 2, y + h - 6, w - 4, 6, R.ink[2]);
  },
  colliders(it) {
    const w = W(it, 160);
    return [
      { x: it.x - 3, y: it.y, w: w + 6, h: 6 },
      { x: it.x, y: it.y + 6, w, h: H(it, 68) - 6 },
    ];
  },
};

/** An acoustic guitar standing on its end (Glider PRO 64 × 172). The `guitar` object strums it. */
export const guitarKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 80);
    const h = H(it, 183);
    const cx = it.x + w / 2;
    const y = it.y;
    const body = R.pine;
    const lower = { y: y + h - w * 0.42, r: w * 0.42 };
    const upper = { y: lower.y - w * 0.5, r: w * 0.32 };
    if (y + h >= 336) px.dither(cx - w * 0.35, y + h - 1, w * 0.7, 2, R.ink[1], 0.55);
    // the neck and the head
    const nw = Math.max(5, Math.round(w * 0.1));
    px.rect(cx - nw / 2, y + 22, nw, upper.y - y - 22, R.walnut[3]);
    px.vline(cx - nw / 2, y + 22, upper.y - y - 22, R.walnut[4]);
    for (let fy = y + 30; fy < upper.y - upper.r * 0.6; fy += 9) px.hline(cx - nw / 2, fy, nw, R.steel[4]);
    px.rect(cx - nw / 2 - 2, y, nw + 4, 24, R.walnut[2]);
    px.rect(cx - nw / 2 - 1, y + 1, nw + 2, 22, R.walnut[3]);
    for (let k = 0; k < 3; k++) {
      px.rect(cx - nw / 2 - 5, y + 4 + k * 7, 3, 2, R.steel[5]);
      px.rect(cx + nw / 2 + 2, y + 4 + k * 7, 3, 2, R.steel[5]);
    }
    // the body: a sunburst, the rosette and sound hole, the bridge and a pickguard
    for (const b of [lower, upper]) px.ellipse(cx, b.y, b.r, b.r * 0.92, body[1]);
    for (const b of [lower, upper]) px.ellipse(cx, b.y, b.r - 1, b.r * 0.92 - 1, body[2]);
    for (const b of [lower, upper]) px.ellipse(cx, b.y, b.r - 4, b.r * 0.92 - 4, body[3]);
    px.ellipse(cx - 2, lower.y - lower.r * 0.1, lower.r * 0.6, lower.r * 0.55, body[4]);
    const hole = (lower.y + upper.y) / 2 + 2;
    px.ellipse(cx, hole, w * 0.14, w * 0.14, body[1]);
    px.ellipse(cx, hole, w * 0.11, w * 0.11, R.ink[0]);
    px.poly([[cx + w * 0.12, hole + 2], [cx + w * 0.25, hole + 6], [cx + w * 0.16, hole + w * 0.2]], R.walnut[2]);
    px.rect(cx - w * 0.17, lower.y + lower.r * 0.35, w * 0.34, 4, R.walnut[1]);
    // the strings
    for (const dx of [-1, 1]) px.line(cx + dx, y + 20, cx + dx, lower.y + lower.r * 0.37, R.steel[5]);
  },
  colliders(it) {
    const w = W(it, 80);
    const h = H(it, 183);
    return [
      { x: it.x + w * 0.08, y: it.y + h - w * 1.2, w: w * 0.84, h: w * 1.2, kind: 'soft' },
      { x: it.x + w * 0.4, y: it.y, w: w * 0.2, h: h - w * 1.2 },
    ];
  },
};

/** Wind chimes on a string from the ceiling (Glider PRO 28 × 74). The `chimes` object rings them. */
export const chimesKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 35);
    const h = H(it, 79);
    const cx = it.x + w / 2;
    const y = it.y;
    px.vline(cx, y, 12, R.stone[2]);
    px.ellipse(cx, y + 13, w / 2, 2, R.walnut[2]);
    px.hline(cx - w / 2 + 1, y + 12, w - 2, R.walnut[4]);
    const tubes = 5;
    for (let k = 0; k < tubes; k++) {
      const tx = cx - w / 2 + 3 + (k * (w - 6)) / (tubes - 1);
      const len = h * (0.36 + 0.09 * ((k * 3) % tubes));
      px.vline(tx, y + 14, 4, R.stone[2]);
      px.rect(tx - 1, y + 18, 3, len, R.brass[3]);
      px.vline(tx - 1, y + 18, len, R.brass[5]);
      px.vline(tx + 1, y + 18, len, R.brass[1]);
    }
    // the striker and the sail
    px.vline(cx, y + 14, h * 0.62, R.stone[2]);
    px.ellipse(cx, y + h * 0.58, 4, 1.5, R.walnut[3]);
    px.poly([[cx, y + h * 0.76], [cx - 5, y + h * 0.86], [cx, y + h], [cx + 5, y + h * 0.86]], R.walnut[3]);
    px.line(cx, y + h * 0.78, cx, y + h - 2, R.walnut[1]);
  },
};

/** A tap on the wall (Glider PRO 56 × 18): a chrome spout with a cross handle. */
export const faucetKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 70);
    const h = H(it, 19);
    const { x, y } = it;
    const right = !(typeof it.dir === 'number' && it.dir < 0);
    const X = (dx: number) => (right ? x + dx : x + w - dx);
    const c = R.steel;
    // the wall plate, the body and the spout curving down
    px.rect(Math.min(X(0), X(6)), y + 2, 6, h - 4, c[2]);
    px.rect(Math.min(X(6), X(w * 0.55)), y + 6, w * 0.5, 6, c[4]);
    px.hline(Math.min(X(6), X(w * 0.55)), y + 6, w * 0.5, c[6]);
    px.hline(Math.min(X(6), X(w * 0.55)), y + 11, w * 0.5, c[2]);
    px.rect(Math.min(X(w * 0.55), X(w - 4)), y + 8, w * 0.45 - 4, 4, c[4]);
    px.rect(Math.min(X(w - 8), X(w - 2)), y + 8, 6, h - 8, c[4]);
    px.hline(Math.min(X(w * 0.55), X(w - 2)), y + 8, w * 0.45 - 2, c[6]);
    // the handle
    px.rect(Math.min(X(w * 0.3 - 1), X(w * 0.3 + 2)), y + 1, 3, 5, c[3]);
    px.rect(Math.min(X(w * 0.3 - 7), X(w * 0.3 + 8)), y, 15, 2, c[5]);
  },
};

/** A floor lamp (Glider PRO's deco lamp 64 × 212, hip lamp 72 × 276): `v` 0 a fringed shade, 1 a torchière bowl. */
export const floorLampKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 80);
    const h = H(it, 226);
    const cx = it.x + w / 2;
    const y = it.y;
    const v = (it.v ?? 0) % 2;
    const shadeH = v === 0 ? Math.max(28, h * 0.17) : 14;
    if (y + h >= 336) px.dither(cx - 18, y + h - 1, 36, 2, R.ink[1], 0.55);
    // the base and the pole
    px.ellipse(cx, y + h - 3, 16, 3, R.brass[2]);
    px.ellipse(cx, y + h - 4, 14, 2, R.brass[4]);
    px.rect(cx - 1, y + shadeH - 2, 3, h - shadeH - 3, R.brass[3]);
    px.vline(cx - 1, y + shadeH - 2, h - shadeH - 3, R.brass[5]);
    px.rect(cx - 3, y + h * 0.55, 7, 4, R.brass[4]);
    if (v === 0) {
      // a fabric shade with a fringe
      const sw = Math.min(w, 70);
      px.poly([[cx - sw * 0.32, y], [cx + sw * 0.32, y], [cx + sw / 2, y + shadeH], [cx - sw / 2, y + shadeH]], R.cream[3]);
      px.poly([[cx - sw * 0.3, y + 1], [cx + sw * 0.3, y + 1], [cx + sw / 2 - 2, y + shadeH - 1], [cx - sw / 2 + 2, y + shadeH - 1]], R.cream[4]);
      px.dither(cx - sw * 0.3, y + 2, sw * 0.6, shadeH - 3, R.cream[5], 0.3);
      for (let fx = cx - sw / 2 + 1; fx < cx + sw / 2; fx += 2) px.vline(fx, y + shadeH, 3, R.mustard[3]);
    } else {
      // an up-lighting bowl
      px.poly([[cx - w * 0.4, y], [cx + w * 0.4, y], [cx + 4, y + shadeH], [cx - 4, y + shadeH]], R.brass[3]);
      px.hline(cx - w * 0.4, y, w * 0.8, R.brass[5]);
      px.poly([[cx - w * 0.36, y + 2], [cx - 2, y + 2], [cx - 2, y + shadeH - 2]], R.brass[4]);
    }
  },
  lights(it) {
    const w = W(it, 80);
    const v = (it.v ?? 0) % 2;
    return [{ x: it.x + w / 2, y: it.y + (v === 0 ? 14 : -6), r: 120, color: '#ffd890', intensity: 0.9, switched: true }];
  },
  colliders(it) {
    const w = W(it, 80);
    const h = H(it, 226);
    return [
      { x: it.x + w / 2 - 2, y: it.y + 12, w: 5, h: h - 12 },
      { x: it.x + w * 0.15, y: it.y, w: w * 0.7, h: 14 },
    ];
  },
};
