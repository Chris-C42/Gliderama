/**
 * More of Glider PRO's furniture and wall clutter, drawn the Gliderama way: a filing cabinet, a waste basket, a
 * steamer trunk, a stool, a pedestal table, a bulletin board and a calendar. x, y = top-left of the item's box;
 * w, h default to Glider PRO's sizes in Gliderama pixels.
 */

import { R } from '../../render/palette';
import type { Px } from '../../render/pixel';
import type { ItemDef } from '../types';
import type { KindDef } from './types';

const W = (it: ItemDef, d: number) => Math.round(it.w ?? d);
const H = (it: ItemDef, d: number) => Math.round(it.h ?? d);
const pick = <T,>(it: ItemDef, options: readonly T[]) => options[(it.v ?? 0) % options.length];
const solid = (it: ItemDef, w: number, h: number) => [{ x: it.x, y: it.y, w: W(it, w), h: H(it, h) }];

function shadow(px: Px, x: number, y: number, w: number) {
  if (y >= 336) px.dither(x - 2, y - 1, w + 4, 2, R.ink[1], 0.55);
}

/** A steel filing cabinet (Glider PRO 74 × 107): four drawers with handles and label holders. */
export const filingCabinetKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 92);
    const h = H(it, 114);
    const { x, y } = it;
    const steel = pick(it, [R.steel, R.moss, R.stone]);
    shadow(px, x, y + h, w);
    px.box(x, y, w, h, 3, steel);
    const n = Math.max(2, Math.round(h / 28));
    const dh = (h - 8) / n;
    for (let k = 0; k < n; k++) {
      const dy = y + 5 + k * dh;
      px.rect(x + 4, dy, w - 8, dh - 3, steel[2]);
      px.rect(x + 5, dy + 1, w - 10, dh - 5, steel[3]);
      px.hline(x + 5, dy + 1, w - 10, steel[4]);
      px.rect(x + w / 2 - 6, dy + 5, 12, 3, steel[5]);
      px.hline(x + w / 2 - 6, dy + 8, 12, steel[1]);
      px.rect(x + w / 2 - 5, dy + dh * 0.55, 10, 4, R.cream[4]);
    }
  },
  colliders: (it) => solid(it, 92, 114),
};

/** A waste basket (Glider PRO 64 × 61): wire mesh (`v` 1: wicker), with crumpled paper over the rim. */
export const wasteBasketKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 80);
    const h = H(it, 65);
    const { x, y } = it;
    const wicker = (it.v ?? 0) % 2 === 1;
    const c = wicker ? R.mustard : R.steel;
    shadow(px, x + 6, y + h, w - 12);
    // what's in it: balls of paper (one of them was a paper plane)
    for (const [dx, dy, r] of [
      [0.3, 6, 8],
      [0.55, 4, 9],
      [0.75, 8, 7],
    ] as const) {
      px.ellipse(x + w * dx, y + dy, r, r * 0.8, R.cream[3]);
      px.ellipse(x + w * dx - 1, y + dy - 1, r - 2, r * 0.8 - 2, R.cream[5]);
      px.line(x + w * dx - r / 2, y + dy, x + w * dx + r / 3, y + dy - 2, R.cream[2]);
    }
    // the basket, narrower at the foot
    const t = 5;
    px.poly([[x, y + 10], [x + w, y + 10], [x + w - t * 2, y + h], [x + t * 2, y + h]], c[1]);
    px.poly([[x + 2, y + 11], [x + w - 2, y + 11], [x + w - t * 2 - 1, y + h - 1], [x + t * 2 + 1, y + h - 1]], wicker ? c[3] : c[2]);
    if (wicker) for (let j = y + 14; j < y + h - 2; j += 4) px.hline(x + 4 + ((j - y) * t * 2) / h, j, w - 8 - ((j - y) * t * 4) / h, c[4]);
    else
      for (let k = 1; k < 8; k++) {
        const fx = x + (w * k) / 8;
        px.line(fx, y + 11, x + t * 2 + ((w - t * 4) * k) / 8, y + h - 1, c[4]);
      }
    px.rect(x - 1, y + 9, w + 2, 3, c[4]);
    px.hline(x - 1, y + 9, w + 2, c[5]);
  },
  colliders(it) {
    const w = W(it, 80);
    const h = H(it, 65);
    return [{ x: it.x + 4, y: it.y + 9, w: w - 8, h: h - 9 }];
  },
};

/** A steamer trunk (Glider PRO 144 × 80): canvas over wood, leather straps and brass corners. */
export const trunkKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 180);
    const h = H(it, 85);
    const { x, y } = it;
    const cloth = pick(it, [R.navy, R.red, R.moss]);
    shadow(px, x, y + h, w);
    px.box(x, y, w, h, 6, cloth);
    // the lid's seam, the wooden slats, the straps, the corners and the lock
    px.hline(x + 1, y + h * 0.32, w - 2, cloth[1]);
    for (const fy of [y + 8, y + h * 0.32 + 3, y + h - 6]) px.rect(x + 1, fy, w - 2, 3, R.oak[3]);
    for (const sx of [x + w * 0.22, x + w * 0.78 - 8]) {
      px.rect(sx, y, 8, h, R.walnut[3]);
      px.vline(sx, y, h, R.walnut[4]);
      px.rect(sx + 1, y + h * 0.32 - 3, 6, 6, R.brass[4]);
    }
    for (const [cx, cy] of [
      [x, y],
      [x + w - 7, y],
      [x, y + h - 7],
      [x + w - 7, y + h - 7],
    ])
      px.rect(cx, cy, 7, 7, R.brass[3]);
    px.rect(x + w / 2 - 5, y + h * 0.32 - 4, 10, 9, R.brass[4]);
    px.px(x + w / 2, y + h * 0.32 + 1, R.ink[1]);
  },
  colliders: (it) => solid(it, 180, 85),
};

/** A kitchen stool (Glider PRO 48 × 38): a round seat on splayed legs with a rung. */
export const stoolKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 60);
    const h = H(it, 40);
    const { x, y } = it;
    const wood = pick(it, [R.pine, R.oak, R.walnut]);
    shadow(px, x + 4, y + h, w - 8);
    px.line(x + 8, y + 6, x + 2, y + h - 1, wood[2]);
    px.line(x + w - 8, y + 6, x + w - 2, y + h - 1, wood[2]);
    px.line(x + w / 2 - 4, y + 6, x + w / 2 - 6, y + h - 1, wood[3]);
    px.line(x + w / 2 + 4, y + 6, x + w / 2 + 6, y + h - 1, wood[3]);
    px.hline(x + 6, y + h * 0.62, w - 12, wood[2]);
    px.ellipse(x + w / 2, y + 3, w / 2, 3, wood[2]);
    px.ellipse(x + w / 2, y + 2, w / 2 - 1, 2, wood[4]);
    px.hline(x + 6, y + 6, w - 12, wood[1]);
  },
  colliders(it) {
    const w = W(it, 60);
    const h = H(it, 40);
    return [
      { x: it.x, y: it.y, w, h: 6 },
      { x: it.x + 2, y: it.y + 6, w: 6, h: h - 6 },
      { x: it.x + w - 8, y: it.y + 6, w: 6, h: h - 6 },
    ];
  },
};

/** A pedestal table (Glider PRO's table, any width): a top on a turned column and a spreading foot; `v` 2 a deck table. */
export const tableKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 100);
    const h = H(it, 80);
    const { x, y } = it;
    const deck = (it.v ?? 0) % 3 === 2;
    const wood = pick(it, [R.walnut, R.oak, R.pine]);
    const cx = x + w / 2;
    shadow(px, cx - w * 0.3, y + h, w * 0.6);
    // the foot and the column
    px.poly([[cx - w * 0.3, y + h], [cx + w * 0.3, y + h], [cx + 5, y + h - 9], [cx - 5, y + h - 9]], wood[2]);
    px.hline(cx - w * 0.3, y + h - 1, w * 0.6, wood[1]);
    px.rect(cx - 4, y + 7, 9, h - 15, wood[3]);
    px.vline(cx - 4, y + 7, h - 15, wood[5]);
    px.vline(cx + 4, y + 7, h - 15, wood[1]);
    px.rect(cx - 6, y + h * 0.45, 13, 4, wood[4]);
    // the top
    px.rect(x, y, w, 7, wood[2]);
    px.rect(x, y, w, 4, wood[4]);
    px.hline(x, y, w, wood[5]);
    if (deck) for (let sx = x + 8; sx < x + w; sx += 10) px.vline(sx, y, 7, wood[1]);
  },
  colliders(it) {
    const w = W(it, 100);
    const h = H(it, 80);
    return [
      { x: it.x, y: it.y, w, h: 7 },
      { x: it.x + w / 2 - 4, y: it.y + 7, w: 9, h: h - 7 },
    ];
  },
};

/** A cork bulletin board (Glider PRO 80 × 58) with notes pinned to it. */
export const bulletinKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 100);
    const h = H(it, 62);
    const { x, y } = it;
    px.dither(x + 2, y + 2, w, h, R.ink[1], 0.3);
    px.rect(x, y, w, h, R.oak[2]);
    px.rect(x + 1, y + 1, w - 2, h - 2, R.oak[4]);
    px.rect(x + 4, y + 4, w - 8, h - 8, R.peach[3]);
    px.speckle(x + 4, y + 4, w - 8, h - 8, [R.peach[2], R.peach[4], R.oak[3]], 0.25);
    const notes: [number, number, number, number, string][] = [
      [0.08, 0.12, 0.3, 0.42, R.cream[5]],
      [0.44, 0.1, 0.24, 0.32, R.mustard[5]],
      [0.72, 0.18, 0.2, 0.5, R.sky[5]],
      [0.2, 0.58, 0.34, 0.3, R.rose[5]],
      [0.6, 0.62, 0.26, 0.26, R.cream[5]],
    ];
    for (const [u, v, nw, nh, c] of notes) {
      const nx = Math.round(x + 4 + (w - 8) * u);
      const ny = Math.round(y + 4 + (h - 8) * v);
      const ww = Math.round((w - 8) * nw);
      const hh = Math.round((h - 8) * nh);
      px.rect(nx + 1, ny + 1, ww, hh, R.peach[1]);
      px.rect(nx, ny, ww, hh, c);
      for (let ly = ny + 4; ly < ny + hh - 2; ly += 3) px.hline(nx + 2, ly, ww - 4 - ((ly * 7) % 5), R.stone[3]);
      px.rect(nx + ww / 2 - 1, ny, 2, 2, R.red[3]);
    }
  },
};

/** A wall calendar (Glider PRO 63 × 92): a picture above the month, one day circled. */
export const calendarKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 79);
    const h = H(it, 98);
    const { x, y } = it;
    px.dither(x + 2, y + 2, w, h, R.ink[1], 0.3);
    // the nail, the picture and the binding
    px.px(x + w / 2, y - 3, R.steel[2]);
    px.line(x + w / 2, y - 3, x + 6, y, R.stone[3]);
    px.line(x + w / 2, y - 3, x + w - 6, y, R.stone[3]);
    px.rect(x, y, w, h, R.cream[3]);
    px.rect(x + 1, y + 1, w - 2, h - 2, R.cream[5]);
    const ph = Math.round(h * 0.45);
    px.vgrad(x + 4, y + 4, w - 8, ph - 4, [R.sky[2], R.sky[4]]);
    // a hill, kept inside the picture
    for (let i = 0; i < w - 8; i++) {
      const u = (i - (w - 8) * 0.3) / ((w - 8) * 0.45);
      const hh = Math.round(Math.max(0, 1 - u * u) * ph * 0.4);
      if (hh > 0) px.vline(x + 4 + i, y + ph - hh, hh, R.moss[3]);
    }
    px.rect(x + 4, y + ph - 1, w - 8, 1, R.moss[2]);
    px.rect(x + 1, y + ph + 1, w - 2, 3, R.red[3]);
    for (let k = 0; k < w - 6; k += 4) px.px(x + 3 + k, y + ph + 2, R.steel[5]);
    // the month: a header and five weeks of days
    const gx = x + 5;
    const gy = y + ph + 8;
    const cw = (w - 10) / 7;
    const ch = (h - ph - 12) / 6;
    px.hline(gx + 2, gy + 1, w - 14, R.red[3]);
    for (let r = 1; r < 6; r++)
      for (let c = 0; c < 7; c++) {
        px.rect(gx + c * cw + 1, gy + r * ch + 1, Math.max(1, cw - 3), 1, R.stone[3]);
        if (r === 3 && c === 4) px.frame(gx + c * cw - 1, gy + r * ch - 2, cw + 1, ch, R.red[3]);
      }
  },
};
