/**
 * Glider PRO's garden and street pieces, drawn the Gliderama way: a tiki torch and a kettle barbecue (each burns
 * with a `candle` flame at its top: x, y = where the flame stands, `wax` = how far below it the ground is), a
 * mailbox on its post, a window box of flowers and a cinder block.
 */

import { R } from '../../render/palette';
import type { ItemDef } from '../types';
import type { KindDef } from './types';

const W = (it: ItemDef, d: number) => Math.round(it.w ?? d);
const H = (it: ItemDef, d: number) => Math.round(it.h ?? d);
const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

/** A bamboo tiki torch: a wicker cup on a tall pole, the flame (a `candle`) at (x + 3, y). */
export const tikiKind: KindDef = {
  z: 1,
  paint(px, it) {
    const cx = it.x + 3;
    const y = it.y;
    const len = num(it.wax, 120);
    // the pole, its joints and a bit of shadow where it meets the ground
    px.rect(cx - 2, y + 12, 5, len - 4, R.pine[3]);
    px.vline(cx - 2, y + 12, len - 4, R.pine[5]);
    px.vline(cx + 2, y + 12, len - 4, R.pine[1]);
    for (let j = y + 30; j < y + len; j += 22) px.hline(cx - 2, j, 5, R.pine[1]);
    px.dither(cx - 6, y + len + 6, 13, 2, R.ink[1], 0.5);
    // the wicker cup the flame burns in
    px.poly([[cx - 7, y + 2], [cx + 8, y + 2], [cx + 5, y + 14], [cx - 4, y + 14]], R.mustard[2]);
    for (let j = y + 3; j < y + 14; j += 3) px.hline(cx - 6 + (j - y) / 5, j, 13 - (2 * (j - y)) / 5, R.mustard[4]);
    px.hline(cx - 7, y + 2, 16, R.mustard[5]);
  },
};

/** A kettle barbecue on three legs, coals glowing under the flame (a `candle` at (x + 3, y)). */
export const bbqKind: KindDef = {
  z: 1,
  paint(px, it) {
    const cx = it.x + 3;
    const y = it.y;
    const len = num(it.wax, 50);
    const bowl = y + 8;
    // the legs and the wheels
    px.line(cx - 14, bowl + 10, cx - 20, y + len + 6, R.ink[2]);
    px.line(cx + 14, bowl + 10, cx + 20, y + len + 6, R.ink[2]);
    px.line(cx, bowl + 14, cx, y + len + 6, R.ink[2]);
    px.ellipse(cx + 20, y + len + 4, 3, 3, R.ink[1]);
    px.dither(cx - 24, y + len + 6, 50, 2, R.ink[1], 0.5);
    // the kettle (the lower half of a ball), the grill and the coals
    const half = (rx: number, ry: number, dx = 0): [number, number][] => {
      const pts: [number, number][] = [];
      for (let k = 0; k <= 16; k++) pts.push([cx + dx + Math.cos((k / 16) * Math.PI) * rx, bowl + Math.sin((k / 16) * Math.PI) * ry]);
      return pts;
    };
    px.poly(half(22, 15), R.ink[1]);
    px.poly(half(21, 14), R.ink[2]);
    px.poly(half(9, 9, -7), R.ink[3]);
    px.hline(cx - 21, bowl - 1, 43, R.steel[4]);
    px.speckle(cx - 16, bowl - 3, 33, 2, [R.flame[2], R.flame[3], R.red[3]], 0.5);
    px.rect(cx - 25, bowl - 2, 3, 3, R.ink[3]);
    px.rect(cx + 23, bowl - 2, 3, 3, R.ink[3]);
  },
  colliders(it) {
    const cx = it.x + 3;
    return [{ x: cx - 22, y: it.y + 4, w: 44, h: 18 }];
  },
};

/** A mailbox on a post (Glider PRO 94 × 80): its door hangs open on the side it faces (`dir`), the flag up. */
export const mailboxKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 118);
    const h = H(it, 85);
    const { x, y } = it;
    const open = num(it.dir, -1) >= 0 ? 1 : -1;
    const X = (dx: number) => (open > 0 ? x + w - dx : x + dx);
    const lo = (a: number, b: number) => Math.min(X(a), X(b));
    // the post
    const postX = X(w * 0.55);
    px.rect(postX - 4, y + 34, 9, h - 34, R.oak[3]);
    px.vline(postX - 4, y + 34, h - 34, R.oak[5]);
    px.vline(postX + 4, y + 34, h - 34, R.oak[1]);
    px.dither(postX - 8, y + h - 1, 17, 2, R.ink[1], 0.5);
    // the box: a rounded steel tunnel seen from the side
    const bx0 = w * 0.18;
    const bx1 = w * 0.92;
    px.rect(lo(bx0, bx1), y + 12, bx1 - bx0, 22, R.steel[2]);
    px.rect(lo(bx0, bx1), y + 13, bx1 - bx0, 18, R.steel[4]);
    px.ellipse((X(bx0) + X(bx1)) / 2, y + 13, (bx1 - bx0) / 2, 6, R.steel[4]);
    px.hline(lo(bx0 + 2, bx1 - 2), y + 8, bx1 - bx0 - 4, R.steel[6]);
    px.hline(lo(bx0, bx1), y + 30, bx1 - bx0, R.steel[2]);
    // the open door: the dark inside, the door flat on its hinge
    px.ellipse(X(bx0), y + 21, 3, 12, R.ink[0]);
    px.rect(lo(bx0 - 22, bx0 - 1), y + 30, 21, 4, R.steel[3]);
    px.hline(lo(bx0 - 22, bx0 - 1), y + 30, 21, R.steel[5]);
    // the flag, up: there is post
    const fx = X(bx1 - 10);
    px.vline(fx, y + 2, 20, R.red[2]);
    px.rect(lo(bx1 - 10, bx1 - 22), y + 2, 12, 7, R.red[3]);
    px.hline(lo(bx1 - 10, bx1 - 22), y + 2, 12, R.red[4]);
  },
  colliders(it) {
    const w = W(it, 118);
    const h = H(it, 85);
    const open = num(it.dir, -1) >= 0 ? 1 : -1;
    const x0 = open > 0 ? it.x + w * 0.08 : it.x + w * 0.18;
    return [
      { x: x0, y: it.y + 8, w: w * 0.74, h: 4 },
      { x: x0, y: it.y + 30, w: w * 0.74, h: 4 },
      { x: (open > 0 ? it.x + w * 0.45 : it.x + w * 0.55) - 4, y: it.y + 34, w: 9, h: h - 34 },
    ];
  },
};

/** A window box of flowers (Glider PRO 80 × 32). */
export const flowerBoxKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 100);
    const h = H(it, 34);
    const { x, y } = it;
    const box = y + h * 0.5;
    // a bank of leaves, stems, then the flowers
    const n = Math.floor(w / 8);
    for (let k = 0; k < n; k++) {
      const fx = x + 4 + k * 8 + ((k * 7) % 3);
      px.ellipse(fx, box - 3, 5, 4, k % 2 ? R.leaf[3] : R.leaf[4]);
    }
    for (let k = 0; k < n; k++) {
      const fx = x + 5 + k * 8 + ((k * 7) % 4);
      const top = y + 4 + ((k * 5) % 6);
      px.line(fx, box - 2, fx + ((k % 3) - 1), top + 3, R.leaf[2]);
    }
    for (let k = 0; k < n; k++) {
      const fx = x + 5 + k * 8 + ((k * 7) % 4) + ((k % 3) - 1);
      const top = y + 4 + ((k * 5) % 6);
      const petal = [R.red, R.mustard, R.rose, R.plum][k % 4];
      px.ellipse(fx, top + 2, 4, 3, petal[3]);
      px.ellipse(fx - 1, top + 1, 2, 2, petal[5]);
      px.px(fx, top + 2, R.mustard[5]);
    }
    // the box
    px.rect(x, box, w, h - (box - y), R.walnut[2]);
    px.rect(x + 1, box + 1, w - 2, h - (box - y) - 2, R.walnut[4]);
    px.hline(x, box, w, R.walnut[5]);
    px.dither(x + 1, box + 1, w - 2, 2, R.leaf[2], 0.5);
  },
  colliders(it) {
    const h = H(it, 34);
    return [{ x: it.x, y: it.y + h * 0.5, w: W(it, 100), h: h * 0.5 }];
  },
};

/** A cinder block (Glider PRO 40 × 62): rough grey concrete with its two hollows. */
export const cinderBlockKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 50);
    const h = H(it, 66);
    const { x, y } = it;
    px.rect(x, y, w, h, R.stone[1]);
    px.rect(x + 1, y + 1, w - 2, h - 2, R.stone[3]);
    px.speckle(x + 1, y + 1, w - 2, h - 2, [R.stone[2], R.stone[4]], 0.18);
    px.hline(x + 1, y + 1, w - 2, R.stone[4]);
    // the two hollows, shallow and shadowed at the top
    const hh = Math.max(6, (h - 20) / 2);
    for (const hy of [y + 7, y + h - 7 - hh]) {
      px.rect(x + 9, hy, w - 18, hh, R.stone[2]);
      px.hline(x + 9, hy, w - 18, R.stone[1]);
      px.vline(x + 9, hy, hh, R.stone[1]);
      px.dither(x + 10, hy + 1, w - 20, hh - 1, R.stone[1], 0.3);
    }
  },
  colliders: (it) => [{ x: it.x, y: it.y, w: W(it, 50), h: H(it, 66) }],
};
