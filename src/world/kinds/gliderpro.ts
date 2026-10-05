/**
 * Pieces from Glider PRO's houses drawn the Gliderama way: the still parts of its hazards (the goldfish's bowl, a
 * cobweb, an electric outlet, a paper shredder). What moves is drawn by the runtime objects (game/objects/enemies).
 */

import { R } from '../../render/palette';
import { BOWL, SHREDDER } from '../gliderpro';
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
