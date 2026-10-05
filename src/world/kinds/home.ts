/**
 * Home furniture & decor (bedroom, hall, bathroom, kitchen, living room).
 * Coordinates: x, y = top-left of the item's box in room pixels; w, h = size.
 */

import { R, type Ramp } from '../../render/palette';
import type { Px } from '../../render/pixel';
import type { ItemDef } from '../types';
import { LAYOUT } from '../types';
import type { KindDef } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const W = (it: ItemDef, d: number) => it.w ?? d;
const H = (it: ItemDef, d: number) => it.h ?? d;
const pickRamp = (it: ItemDef, options: readonly Ramp[]) => options[(it.v ?? 0) % options.length];

/** Contact shadow on the floor in front of / under a piece of furniture. */
export function floorShadow(px: Px, x: number, w: number, y = LAYOUT.floor) {
  px.dither(x - 2, y - 1, w + 4, 2, R.ink[1], 0.55);
  px.dither(x - 4, y + 1, w + 8, 2, R.ink[1], 0.25);
}

// ---------------------------------------------------------------------------------------------
// Window with curtains and an outdoor view

export function paintOutdoor(px: Px, x: number, y: number, w: number, h: number, night: boolean, seed: number) {
  if (night) {
    px.vgrad(x, y, w, h, [R.night[0], R.night[1], R.night[2], R.night[3]]);
    for (let i = 0; i < Math.floor((w * h) / 90); i++) {
      const sx = x + ((i * 37 + seed * 11) % w);
      const sy = y + ((i * 53 + seed * 7) % Math.max(1, Math.floor(h * 0.7)));
      px.px(sx, sy, i % 5 === 0 ? '#fff4c8' : R.night[5]);
    }
    px.ellipse(x + w * 0.72, y + h * 0.22, 5, 5, '#f4ecc8');
    px.ellipse(x + w * 0.72 + 2, y + h * 0.22 - 1, 4, 4, R.night[2]);
    // dark rooftops
    px.rect(x, y + h - 14, w, 14, R.night[0]);
    px.rect(x + 6, y + h - 22, 18, 10, R.night[0]);
    px.px(x + 12, y + h - 18, '#f8d46a');
  } else {
    px.vgrad(x, y, w, h, [R.sky[2], R.sky[3], R.sky[4], R.sky[5]]);
    // clouds
    for (let k = 0; k < 3; k++) {
      const cx = x + ((seed * 29 + k * 47) % Math.max(1, w - 20)) + 6;
      const cy = y + 8 + ((seed * 13 + k * 19) % Math.max(1, Math.floor(h * 0.4)));
      px.ellipse(cx, cy, 8, 3, '#ffffff');
      px.ellipse(cx + 6, cy - 2, 6, 3, '#ffffff');
      px.hline(cx - 6, cy + 2, 18, R.sky[4]);
    }
    // distant hills and a tree
    const hy = y + h - 22;
    px.poly(
      [
        [x, hy + 8],
        [x + w * 0.3, hy],
        [x + w * 0.6, hy + 6],
        [x + w, hy - 2],
        [x + w, y + h],
        [x, y + h],
      ],
      R.moss[4],
    );
    px.rect(x, y + h - 10, w, 10, R.moss[3]);
    px.dither(x, y + h - 10, w, 10, R.moss[2], 0.3);
    const tx = x + w * 0.25;
    px.rect(tx, y + h - 20, 3, 12, R.oak[2]);
    px.ellipse(tx + 1, y + h - 24, 9, 8, R.leaf[3]);
    px.ellipse(tx - 2, y + h - 27, 5, 4, R.leaf[4]);
  }
}

export const windowKind: KindDef = {
  z: 0,
  paint(px, it, room) {
    const w = W(it, 112);
    const h = H(it, 124);
    const { x, y } = it;
    const trim = R[room.wall.trim];
    // recess shadow
    px.rect(x - 2, y - 2, w + 4, h + 4, R.ink[2]);
    paintOutdoor(px, x, y, w, h, !!room.night, room.seed ?? 3);
    // frame + muntins
    px.frame(x, y, w, h, trim[trim.length - 2]);
    px.frame(x + 1, y + 1, w - 2, h - 2, trim[trim.length - 1]);
    px.rect(x + Math.floor(w / 2) - 1, y, 3, h, trim[trim.length - 2]);
    px.rect(x, y + Math.floor(h / 2) - 1, w, 3, trim[trim.length - 2]);
    px.vline(x + Math.floor(w / 2) + 1, y, h, trim[trim.length - 4]);
    // glass glints
    if (!room.night) {
      px.line(x + 6, y + 14, x + 14, y + 6, '#ffffff');
      px.line(x + 8, y + 18, x + 18, y + 8, R.sky[5]);
    }
    // sill
    px.rect(x - 8, y + h, w + 16, 6, trim[trim.length - 2]);
    px.hline(x - 8, y + h, w + 16, trim[trim.length - 1]);
    px.hline(x - 8, y + h + 5, w + 16, trim[trim.length - 4]);
    px.dither(x - 6, y + h + 6, w + 12, 3, R.ink[1], 0.4);
    // curtains
    const cur = pickRamp(it, [R.red, R.navy, R.mustard, R.teal, R.rose]);
    const cw = Math.round(w * 0.22);
    for (const side of [0, 1]) {
      const cx = side === 0 ? x - 10 : x + w - cw + 10;
      px.rect(cx, y - 10, cw, h + 26, cur[3]);
      for (let k = 0; k < cw; k += 5) {
        px.vline(cx + k, y - 10, h + 26, cur[2]);
        px.vline(cx + k + 2, y - 10, h + 26, cur[4]);
      }
      px.dither(cx, y + h + 6, cw, 10, cur[1], 0.35);
      // tie-back
      px.rect(cx, y + Math.round(h * 0.55), cw, 3, R.mustard[4]);
      px.frame(cx - 1, y - 10, cw + 2, h + 26, cur[0]);
    }
    // valance + rod
    px.rect(x - 16, y - 16, w + 32, 4, R.brass[3]);
    px.hline(x - 16, y - 16, w + 32, R.brass[5]);
    px.ellipse(x - 17, y - 14, 3, 3, R.brass[4]);
    px.ellipse(x + w + 17, y - 14, 3, 3, R.brass[4]);
  },
  glow(px, it, room) {
    if (room.night) return;
    px.rect(it.x + 2, it.y + 2, W(it, 112) - 4, H(it, 124) - 4, '#9fc4e6');
  },
  colliders(it) {
    const w = W(it, 112);
    const h = H(it, 124);
    return [{ x: it.x - 8, y: it.y + h, w: w + 16, h: 6 }];
  },
  lights(it, room) {
    if (room.night) return [{ x: it.x + W(it, 112) / 2, y: it.y + H(it, 124) / 2, r: 150, color: '#7f95c8', intensity: 0.35 }];
    return [{ x: it.x + W(it, 112) / 2, y: it.y + H(it, 124) / 2 + 20, r: 220, color: '#cfe0ff', intensity: 0.28 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Bed with patchwork quilt

export const bedKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 230);
    const h = H(it, 130);
    const { x, y } = it;
    const wood = R.pine;
    const quilt = pickRamp(it, [R.navy, R.red, R.teal, R.plum]);
    const mattTop = y + h - 70;
    floorShadow(px, x, w);
    // headboard with a rounded top (left)
    const hb = 22;
    px.rect(x, y + 10, hb, h - 10, wood[3]);
    px.ellipse(x + hb / 2, y + 12, hb / 2, 10, wood[3]);
    px.ellipse(x + hb / 2 - 2, y + 10, hb / 2 - 5, 5, wood[5]);
    px.vline(x + 2, y + 12, h - 14, wood[5]);
    px.vline(x + hb - 3, y + 12, h - 14, wood[2]);
    px.rect(x + 5, y + 26, hb - 10, h - 54, wood[4]);
    px.frame(x + 5, y + 26, hb - 10, h - 54, wood[2]);
    px.frame(x, y + 2, hb, h - 2, wood[1]);
    // footboard (right)
    const fb = 14;
    px.box(x + w - fb, y + 44, fb, h - 44, 4, wood);
    px.ellipse(x + w - fb / 2, y + 44, fb / 2, 4, wood[5]);
    // side rail under the mattress, and the dark space beneath the bed
    const inner = w - hb - fb;
    const rail = mattTop + 12;
    px.dither(x + hb, rail + 9, inner, y + h - rail - 9, R.ink[1], 0.5);
    px.rect(x + hb, rail, inner, 9, wood[3]);
    px.hline(x + hb, rail, inner, wood[5]);
    px.hline(x + hb, rail + 8, inner, wood[1]);
    // mattress: a white sheet with a crisp outline, so it reads against pale walls
    px.rect(x + hb, mattTop, inner, 12, '#f6f3ec');
    px.hline(x + hb, mattTop, inner, '#ffffff');
    px.hline(x + hb, mattTop + 11, inner, '#b8b0a2');
    px.dither(x + hb, mattTop + 8, inner, 3, '#d6d0c4', 0.5);
    // pillow
    px.ellipse(x + hb + 26, mattTop - 6, 24, 10, '#d9d2c6');
    px.ellipse(x + hb + 25, mattTop - 8, 22, 8, '#f8f4ec');
    px.dither(x + hb + 8, mattTop - 15, 30, 4, '#ffffff', 0.6);
    px.hline(x + hb + 6, mattTop + 1, 40, '#cfc7ba');
    // quilt drapes over the front
    const qx = x + hb + 44;
    const qw = w - hb - fb - 44;
    const qy = mattTop - 6;
    const qh = 66;
    const sq = 13;
    for (let j = 0; j * sq < qh; j++)
      for (let i = 0; i * sq < qw; i++) {
        const k = (i * 7 + j * 3) % 4;
        const col = [quilt[3], quilt[4], R.cream[4], R.mustard[4]][k];
        const cw = Math.min(sq, qw - i * sq);
        const ch = Math.min(sq, qh - j * sq);
        px.rect(qx + i * sq, qy + j * sq, cw, ch, col);
        px.hline(qx + i * sq + 2, qy + j * sq + sq - 1, cw - 4, quilt[1]);
      }
    // folded top edge of the quilt
    px.rect(qx, qy - 3, qw, 5, R.cream[5]);
    px.hline(qx, qy - 3, qw, '#ffffff');
    px.hline(qx, qy + 1, qw, R.cream[2]);
    px.dither(qx, qy + qh - 12, qw, 12, quilt[1], 0.3);
    for (let i = 0; i < qw; i += 6) px.ellipse(qx + i + 3, qy + qh, 3, 2, quilt[2]);
    px.vline(qx, qy - 3, qh + 3, quilt[1]);
    // legs
    px.rect(x + w - fb + 2, y + h - 6, 10, 6, wood[1]);
  },
  colliders(it) {
    const w = W(it, 230);
    const h = H(it, 130);
    return [
      { x: it.x, y: it.y + 4, w: 22, h: h - 4, kind: 'solid' },
      { x: it.x + w - 14, y: it.y + 44, w: 14, h: h - 44, kind: 'solid' },
      { x: it.x + 22, y: it.y + h - 76, w: w - 36, h: 76, kind: 'soft' },
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// Desk with drawers

export const deskKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 168);
    const h = H(it, 98);
    const { x, y } = it;
    const wood = pickRamp(it, [R.oak, R.walnut, R.pine]);
    floorShadow(px, x, w);
    // top slab with visible top surface
    px.box(x - 4, y, w + 8, 14, 6, wood);
    // pedestal with drawers on the right
    const pw = 56;
    const px0 = x + w - pw;
    px.box(px0, y + 14, pw, h - 14, 0, wood);
    for (let k = 0; k < 3; k++) {
      const dy = y + 18 + k * 25;
      px.rect(px0 + 4, dy, pw - 8, 21, wood[4]);
      px.frame(px0 + 4, dy, pw - 8, 21, wood[2]);
      px.hline(px0 + 5, dy + 1, pw - 10, wood[5]);
      px.rect(px0 + pw / 2 - 5, dy + 9, 10, 3, R.brass[4]);
      px.px(px0 + pw / 2 - 5, dy + 9, R.brass[5]);
    }
    // left leg + modesty panel
    px.box(x + 2, y + 14, 10, h - 14, 0, wood);
    px.rect(x + 12, y + 14, w - pw - 12, 24, wood[2]);
    px.dither(x + 12, y + 14, w - pw - 12, 24, R.ink[1], 0.4);
    // dark knee space
    px.dither(x + 12, y + 38, w - pw - 12, h - 38, R.ink[1], 0.25);
  },
  colliders(it) {
    const w = W(it, 168);
    const h = H(it, 98);
    return [
      { x: it.x - 4, y: it.y + 2, w: w + 8, h: 12 },
      { x: it.x + w - 56, y: it.y + 14, w: 56, h: h - 14 },
      { x: it.x + 2, y: it.y + 14, w: 10, h: h - 14 },
    ];
  },
};

export const chairKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 46);
    const h = H(it, 116);
    const { x, y } = it;
    const wood = pickRamp(it, [R.oak, R.walnut, R.pine]);
    const flip = !!it.flip; // backrest on the right
    const seatY = y + h - 50;
    floorShadow(px, x, w);
    // back post with a curved top rail
    const bx = flip ? x + w - 7 : x;
    px.rect(bx, y + 4, 7, h - 4, wood[3]);
    px.vline(flip ? bx : bx + 6, y + 4, h - 4, wood[1]);
    px.vline(flip ? bx + 6 : bx, y + 4, h - 4, wood[5]);
    px.ellipse(bx + 3, y + 5, 4, 3, wood[4]);
    // backrest slats seen edge-on
    for (let k = 0; k < 3; k++) px.rect(flip ? bx - 3 : bx + 7, y + 14 + k * 12, 3, 7, wood[2]);
    // seat with cushion
    px.box(x, seatY, w, 9, 4, wood);
    px.rect(x + 3, seatY - 3, w - 6, 4, R.red[3]);
    px.hline(x + 3, seatY - 3, w - 6, R.red[5]);
    // front leg + stretcher
    const lx = flip ? x + 1 : x + w - 6;
    px.rect(lx, seatY + 9, 5, h - (seatY - y) - 9, wood[2]);
    px.vline(lx, seatY + 9, h - (seatY - y) - 9, wood[4]);
    px.rect(x + 4, seatY + 30, w - 8, 3, wood[2]);
  },
  colliders(it) {
    const w = W(it, 46);
    const h = H(it, 116);
    const flip = !!it.flip;
    const seatY = it.y + h - 50;
    return [
      { x: flip ? it.x + w - 7 : it.x, y: it.y + 2, w: 7, h: h - 2 },
      { x: it.x, y: seatY - 3, w, h: 12 },
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// Lamps

export const deskLampKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it; // 40×48 box; base sits on the surface at y+48
    const c = pickRamp(it, [R.teal, R.red, R.mustard]);
    // base
    px.ellipse(x + 30, y + 46, 9, 2, R.ink[2]);
    px.rect(x + 22, y + 42, 16, 4, c[3]);
    px.hline(x + 22, y + 42, 16, c[5]);
    // arm: up-left then over
    px.line(x + 30, y + 42, x + 34, y + 22, R.steel[4]);
    px.line(x + 31, y + 42, x + 35, y + 22, R.steel[2]);
    px.line(x + 34, y + 22, x + 16, y + 8, R.steel[4]);
    px.line(x + 34, y + 23, x + 16, y + 9, R.steel[2]);
    px.ellipse(x + 34, y + 22, 2, 2, c[2]);
    // shade (cone opening downward-left)
    px.poly(
      [
        [x + 12, y + 4],
        [x + 22, y + 8],
        [x + 16, y + 24],
        [x + 2, y + 18],
      ],
      c[3],
    );
    px.line(x + 12, y + 4, x + 22, y + 8, c[5]);
    px.line(x + 12, y + 4, x + 2, y + 18, c[4]);
    px.line(x + 22, y + 8, x + 16, y + 24, c[1]);
    px.line(x + 2, y + 18, x + 16, y + 24, '#fff4c0');
    px.line(x + 3, y + 19, x + 15, y + 23, '#ffe6a0');
  },
  colliders(it) {
    return [
      { x: it.x + 2, y: it.y + 4, w: 20, h: 20 },
      { x: it.x + 22, y: it.y + 40, w: 16, h: 8 },
    ];
  },
  lights(it) {
    // a switched light has no glow: a lamp that is off must not shine in a dark room
    return [{ x: it.x + 10, y: it.y + 34, r: 90, color: '#ffd890', intensity: 0.9, switched: true }];
  },
};

export const pendantLampKind: KindDef = {
  z: 0,
  paint(px, it) {
    const { x } = it; // x = centre
    const len = num(it.len, 60);
    const y0 = LAYOUT.ceiling + 2;
    px.vline(x, y0, len, R.ink[3]);
    px.rect(x - 4, y0, 9, 3, R.brass[3]);
    const sy = y0 + len;
    const c = pickRamp(it, [R.mustard, R.teal, R.cream]);
    px.poly(
      [
        [x - 6, sy],
        [x + 6, sy],
        [x + 18, sy + 16],
        [x - 18, sy + 16],
      ],
      c[3],
    );
    px.line(x - 6, sy, x - 18, sy + 16, c[5]);
    px.line(x + 6, sy, x + 18, sy + 16, c[1]);
    px.hline(x - 18, sy + 16, 37, c[2]);
    px.ellipse(x, sy + 18, 4, 2, '#fff8d8');
  },
  colliders(it) {
    const sy = LAYOUT.ceiling + 2 + num(it.len, 60);
    return [{ x: it.x - 18, y: sy, w: 37, h: 17 }];
  },
  lights(it) {
    const sy = LAYOUT.ceiling + 2 + num(it.len, 60);
    // switched, so no glow (see the desk lamp)
    return [{ x: it.x, y: sy + 30, r: 230, color: '#ffe2a8', intensity: 1.0, switched: true }];
  },
};

// ---------------------------------------------------------------------------------------------
// Bookshelf

export const bookshelfKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 112);
    const h = H(it, 214);
    const { x, y } = it;
    const wood = pickRamp(it, [R.walnut, R.oak, R.pine]);
    floorShadow(px, x, w);
    px.box(x, y, w, h, 5, wood);
    const shelves = Math.max(2, Math.round((h - 20) / 46));
    const inner = (h - 20) / shelves;
    const spines = [R.red, R.navy, R.teal, R.mustard, R.plum, R.moss, R.rose, R.cream];
    for (let s = 0; s < shelves; s++) {
      const sy = Math.round(y + 8 + s * inner);
      const sh = Math.round(inner) - 6;
      // back of the shelf
      px.rect(x + 6, sy, w - 12, sh, wood[1]);
      px.dither(x + 6, sy, w - 12, sh, R.ink[0], 0.3);
      // books
      let bx = x + 7;
      while (bx < x + w - 12) {
        if (px.rand() < 0.08) {
          bx += px.ri(6, 14);
          continue;
        }
        const bw = px.ri(4, 9);
        const bh = px.ri(Math.floor(sh * 0.6), sh - 1);
        const sp = px.pick(spines);
        if (bx + bw > x + w - 7) break;
        const by = sy + sh - bh;
        px.rect(bx, by, bw, bh, sp[3]);
        px.vline(bx, by, bh, sp[4]);
        px.vline(bx + bw - 1, by, bh, sp[1]);
        if (bh > 14) {
          px.hline(bx + 1, by + 4, bw - 2, sp[5] ?? sp[4]);
          px.hline(bx + 1, by + bh - 6, bw - 2, R.brass[4]);
        }
        bx += bw;
      }
      // shelf plank
      px.rect(x + 4, sy + sh, w - 8, 6, wood[4]);
      px.hline(x + 4, sy + sh, w - 8, wood[5]);
      px.hline(x + 4, sy + sh + 5, w - 8, wood[2]);
    }
  },
  colliders(it) {
    const w = W(it, 112);
    const h = H(it, 214);
    const out = [
      { x: it.x, y: it.y, w: 6, h },
      { x: it.x + w - 6, y: it.y, w: 6, h },
      { x: it.x, y: it.y, w, h: 8 },
    ];
    const shelves = Math.max(2, Math.round((h - 20) / 46));
    const inner = (h - 20) / shelves;
    for (let s = 0; s < shelves; s++) {
      const sy = Math.round(it.y + 8 + s * inner);
      const sh = Math.round(inner) - 6;
      out.push({ x: it.x + 4, y: sy + sh - Math.floor(sh * 0.6), w: w - 8, h: Math.floor(sh * 0.6) + 6 });
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// Wall art

export const posterKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 60);
    const h = H(it, 80);
    const { x, y } = it;
    const variant = (it.v ?? 0) % 3;
    px.dither(x + 2, y + 2, w, h, R.ink[1], 0.5);
    if (variant === 0) {
      // rocket on a starry sky
      px.vgrad(x, y, w, h, [R.navy[1], R.navy[2], R.plum[2]]);
      for (let i = 0; i < 18; i++) px.px(x + ((i * 23) % w), y + ((i * 41) % h), '#fff6d0');
      const cx = x + w / 2;
      px.poly([[cx, y + 12], [cx + 8, y + 30], [cx + 8, y + 52], [cx - 8, y + 52], [cx - 8, y + 30]], R.stone[5]);
      px.ellipse(cx, y + 34, 3, 3, R.sky[3]);
      px.poly([[cx - 8, y + 44], [cx - 14, y + 56], [cx - 8, y + 54]], R.red[4]);
      px.poly([[cx + 8, y + 44], [cx + 14, y + 56], [cx + 8, y + 54]], R.red[4]);
      px.poly([[cx - 5, y + 53], [cx + 5, y + 53], [cx, y + 66]], R.flame[3]);
      px.poly([[cx - 2, y + 53], [cx + 2, y + 53], [cx, y + 60]], R.flame[5]);
    } else if (variant === 1) {
      // biplane over hills
      px.vgrad(x, y, w, h, [R.sky[3], R.sky[4], R.sky[5]]);
      px.rect(x, y + h - 16, w, 16, R.moss[4]);
      px.ellipse(x + w * 0.3, y + h - 16, 14, 6, R.moss[3]);
      const bx = x + 14;
      const by = y + 28;
      px.rect(bx, by, 26, 5, R.red[4]);
      px.rect(bx + 6, by - 8, 4, 20, R.mustard[4]);
      px.rect(bx + 2, by - 9, 20, 3, R.red[3]);
      px.rect(bx + 2, by + 9, 20, 3, R.red[3]);
      px.vline(bx + 26, by - 3, 11, R.ink[2]);
    } else {
      // world map-ish
      px.rect(x, y, w, h, R.cream[4]);
      px.ellipse(x + 18, y + 26, 12, 9, R.moss[4]);
      px.ellipse(x + 40, y + 46, 10, 14, R.moss[4]);
      px.ellipse(x + 20, y + 58, 8, 6, R.moss[3]);
      px.frame(x + 3, y + 3, w - 6, h - 6, R.navy[3]);
    }
    px.frame(x, y, w, h, R.ink[3]);
    // tape corners
    px.rect(x - 2, y - 2, 6, 4, R.cream[3]);
    px.rect(x + w - 4, y - 2, 6, 4, R.cream[3]);
  },
};

export const frameKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 64);
    const h = H(it, 48);
    const { x, y } = it;
    const fr = pickRamp(it, [R.brass, R.walnut, R.oak]);
    px.dither(x + 3, y + 3, w, h, R.ink[1], 0.5);
    px.rect(x, y, w, h, fr[3]);
    px.frame(x, y, w, h, fr[1]);
    px.hline(x + 1, y + 1, w - 2, fr[5]);
    px.vline(x + 1, y + 1, h - 2, fr[4]);
    const ix = x + 5;
    const iy = y + 5;
    const iw = w - 10;
    const ih = h - 10;
    // a little landscape painting
    px.vgrad(ix, iy, iw, ih, [R.sky[2], R.peach[4], R.peach[5]]);
    px.ellipse(ix + iw * 0.7, iy + ih * 0.45, 4, 4, R.mustard[5]);
    px.poly([[ix, iy + ih * 0.7], [ix + iw * 0.4, iy + ih * 0.45], [ix + iw * 0.8, iy + ih * 0.75], [ix + iw, iy + ih * 0.6], [ix + iw, iy + ih], [ix, iy + ih]], R.moss[3]);
    px.poly([[ix, iy + ih * 0.85], [ix + iw * 0.5, iy + ih * 0.7], [ix + iw, iy + ih * 0.9], [ix + iw, iy + ih], [ix, iy + ih]], R.moss[2]);
    px.frame(ix - 1, iy - 1, iw + 2, ih + 2, fr[2]);
    // hanging wire
    px.line(x + w / 2 - 10, y, x + w / 2, y - 8, R.ink[3]);
    px.line(x + w / 2 + 10, y, x + w / 2, y - 8, R.ink[3]);
  },
};

export const wallClockKind: KindDef = {
  z: 0,
  paint(px, it) {
    const r = num(it.r, 16);
    const cx = it.x;
    const cy = it.y;
    px.ellipse(cx + 2, cy + 2, r, r, R.ink[2]);
    px.ellipse(cx, cy, r, r, R.walnut[3]);
    px.ellipse(cx, cy, r - 3, r - 3, R.cream[5]);
    px.ellipse(cx - 1, cy - 1, r - 5, r - 5, '#fffdf4');
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      px.px(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6), R.ink[3]);
    }
    px.line(cx, cy, cx, cy - r + 7, R.ink[2]);
    px.line(cx, cy, cx + r - 9, cy + 2, R.ink[2]);
    px.px(cx, cy, R.red[3]);
  },
};

// ---------------------------------------------------------------------------------------------
// Toy box, rug, nightstand, dresser

export const toyBoxKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 84);
    const h = H(it, 54);
    const { x, y } = it;
    floorShadow(px, x, w);
    // toys poking out
    px.ellipse(x + 20, y + 4, 8, 8, R.red[4]);
    px.hline(x + 12, y + 2, 16, R.cream[5]);
    px.ellipse(x + 54, y + 2, 6, 6, R.peach[3]);
    px.ellipse(x + 50, y - 3, 3, 3, R.peach[3]);
    px.ellipse(x + 58, y - 3, 3, 3, R.peach[3]);
    px.px(x + 52, y + 1, R.ink[1]);
    px.px(x + 56, y + 1, R.ink[1]);
    px.box(x, y + 8, w, h - 8, 6, R.mustard);
    // letter blocks painted on
    const letters = [R.red, R.navy, R.teal];
    for (let k = 0; k < 3; k++) {
      const lx = x + 8 + k * 24;
      px.rect(lx, y + 24, 18, 18, letters[k][4]);
      px.frame(lx, y + 24, 18, 18, letters[k][2]);
      px.rect(lx + 6, y + 28, 6, 10, letters[k][5] ?? '#fff');
    }
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 8, w: W(it, 84), h: H(it, 54) - 8 }];
  },
};

export const rugKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 200);
    const cx = it.x + w / 2;
    const cy = it.y;
    const c = pickRamp(it, [R.rose, R.teal, R.mustard, R.navy]);
    const rings = [c[2], c[4], R.cream[4], c[3], c[5] ?? c[4]];
    for (let k = 0; k < rings.length; k++) {
      px.ellipse(cx, cy, w / 2 - k * 12, 14 - k * 2.6, rings[k]);
    }
    px.dither(cx - w / 2, cy - 2, w, 6, R.ink[1], 0.12);
  },
};

export const nightstandKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 54);
    const h = H(it, 66);
    const { x, y } = it;
    const wood = pickRamp(it, [R.pine, R.oak, R.walnut]);
    floorShadow(px, x, w);
    px.box(x, y, w, h - 6, 5, wood);
    px.rect(x + 5, y + 12, w - 10, 18, wood[4]);
    px.frame(x + 5, y + 12, w - 10, 18, wood[2]);
    px.rect(x + w / 2 - 3, y + 19, 6, 3, R.brass[4]);
    px.rect(x + 3, y + h - 6, 5, 6, wood[1]);
    px.rect(x + w - 8, y + h - 6, 5, 6, wood[1]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 1, w: W(it, 54), h: H(it, 66) - 1 }];
  },
};

export const dresserKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 132);
    const h = H(it, 104);
    const { x, y } = it;
    const wood = pickRamp(it, [R.walnut, R.oak, R.pine]);
    floorShadow(px, x, w);
    px.box(x, y, w, h - 6, 7, wood);
    const n = 3;
    const dh = (h - 22) / n;
    for (let k = 0; k < n; k++) {
      const dy = Math.round(y + 10 + k * dh);
      px.rect(x + 6, dy, w - 12, Math.round(dh) - 4, wood[4]);
      px.frame(x + 6, dy, w - 12, Math.round(dh) - 4, wood[2]);
      px.hline(x + 7, dy + 1, w - 14, wood[5]);
      for (const kx of [0.28, 0.72]) {
        px.rect(x + w * kx - 3, dy + dh / 2 - 3, 6, 3, R.brass[4]);
      }
    }
    px.rect(x + 4, y + h - 6, 8, 6, wood[1]);
    px.rect(x + w - 12, y + h - 6, 8, 6, wood[1]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 2, w: W(it, 132), h: H(it, 104) - 2 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Small things on surfaces

export const booksStackKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it; // bottom-left at (x, y)
    const cols = [R.red, R.navy, R.teal, R.mustard, R.plum];
    let yy = y;
    const n = num(it.n, 3);
    for (let k = 0; k < n; k++) {
      const c = cols[(k + (it.v ?? 0)) % cols.length];
      const bw = 26 - (k % 2) * 4 + ((k * 7) % 5);
      const bx = x + ((k * 3) % 5);
      px.rect(bx, yy - 6, bw, 6, c[3]);
      px.hline(bx, yy - 6, bw, c[5] ?? c[4]);
      px.rect(bx + bw - 3, yy - 5, 2, 4, R.cream[5]);
      yy -= 6;
    }
  },
  colliders(it) {
    const n = num(it.n, 3);
    return [{ x: it.x, y: it.y - 6 * n, w: 28, h: 6 * n }];
  },
};

export const pencilCupKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it; // bottom-left
    px.line(x + 3, y - 14, x + 1, y - 24, R.mustard[4]);
    px.px(x + 1, y - 25, R.ink[2]);
    px.line(x + 7, y - 14, x + 9, y - 26, R.red[4]);
    px.line(x + 5, y - 14, x + 5, y - 22, R.navy[4]);
    px.rect(x, y - 14, 11, 14, R.teal[3]);
    px.vline(x + 1, y - 14, 14, R.teal[5]);
    px.hline(x, y - 14, 11, R.teal[4]);
  },
};

export const switchKind: KindDef = {
  z: 0,
  paint(px, it) {
    const { x, y } = it;
    px.rect(x, y, 10, 16, R.cream[5]);
    px.frame(x, y, 10, 16, R.cream[2]);
    px.rect(x + 3, y + 4, 4, 8, R.cream[3]);
  },
  // a glow-in-the-dark rocker, so a dark room's switch can be found
  glow(px, it) {
    px.rect(it.x + 3, it.y + 4, 4, 8, '#8fd8a0');
    px.frame(it.x, it.y, 10, 16, '#3c6a4c');
  },
};

/** Where a `drip` object leaks from: a pipe joint and a damp stain on the ceiling (x = the drip's x). */
export const dripKind: KindDef = {
  z: 0,
  paint(px, it) {
    const { x } = it;
    const y = LAYOUT.ceiling;
    px.dither(x - 14, y + 1, 28, 8, R.ink[1], 0.25);
    px.ellipse(x, y + 4, 10, 3, 'rgba(60,90,120,0.25)');
    px.rect(x - 16, y, 32, 4, R.steel[2]);
    px.hline(x - 16, y, 32, R.steel[4]);
    px.rect(x - 3, y + 2, 6, 5, R.steel[3]);
    px.px(x, y + 7, R.sky[4]);
  },
};

export const floorVentKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 48);
    const { x } = it;
    const y = LAYOUT.floor - 6;
    // grille in perspective: back edge narrower than the front
    px.poly(
      [
        [x + 3, y],
        [x + w - 3, y],
        [x + w + 1, y + 9],
        [x - 1, y + 9],
      ],
      R.steel[3],
    );
    px.poly(
      [
        [x + 5, y + 2],
        [x + w - 5, y + 2],
        [x + w - 2, y + 7],
        [x + 2, y + 7],
      ],
      R.ink[0],
    );
    for (let k = 4; k < w - 3; k += 4) px.line(x + k + 1, y + 2, x + k, y + 7, R.steel[4]);
    px.hline(x + 3, y, w - 6, R.steel[5]);
    px.hline(x - 1, y + 9, w + 2, R.steel[1]);
  },
};

// ---------------------------------------------------------------------------------------------
// Tables, candles, fans

export const sideTableKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 96);
    const h = H(it, 84);
    const { x, y } = it;
    const wood = pickRamp(it, [R.walnut, R.oak, R.pine]);
    floorShadow(px, x + 6, w - 12);
    px.box(x, y, w, 12, 6, wood);
    // apron
    px.rect(x + 6, y + 12, w - 12, 10, wood[2]);
    px.hline(x + 6, y + 12, w - 12, wood[1]);
    // turned legs
    for (const lx of [x + 6, x + w - 12]) {
      px.rect(lx, y + 22, 6, h - 22, wood[3]);
      px.vline(lx, y + 22, h - 22, wood[5]);
      px.vline(lx + 5, y + 22, h - 22, wood[1]);
      px.rect(lx - 1, y + 34, 8, 3, wood[4]);
      px.rect(lx - 1, y + h - 14, 8, 3, wood[4]);
    }
  },
  colliders(it) {
    const w = W(it, 96);
    const h = H(it, 84);
    return [
      { x: it.x, y: it.y + 2, w, h: 20 },
      { x: it.x + 6, y: it.y + 22, w: 6, h: h - 22 },
      { x: it.x + w - 12, y: it.y + 22, w: 6, h: h - 22 },
    ];
  },
};

/** Candle stick (static wax + holder). The flame is the runtime `candle` object at (x, y). */
export const candleStickKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it; // x,y = wick top
    const hgt = num(it.wax, 18);
    px.rect(x + 1, y, 5, hgt, R.cream[5]);
    px.vline(x + 1, y, hgt, '#ffffff');
    px.vline(x + 5, y, hgt, R.cream[3]);
    px.px(x + 3, y - 1, R.ink[2]);
    px.rect(x + 2, y + 2, 1, 3, R.cream[4]);
    // holder
    px.ellipse(x + 3, y + hgt + 1, 7, 2, R.brass[3]);
    px.hline(x - 3, y + hgt, 13, R.brass[5]);
    px.rect(x + 1, y + hgt + 2, 5, 4, R.brass[2]);
    px.ellipse(x + 3, y + hgt + 6, 6, 2, R.brass[3]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 2, w: 7, h: num(it.wax, 18) + 6 }];
  },
};

/** Desk fan stand (the spinning head is the runtime `fan` object at the same x, y). */
export const fanStandKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it; // head top-left (head ~32×32)
    const base = y + num(it.stand, 30) + 32;
    px.rect(x + 14, y + 26, 4, base - y - 26, R.steel[3]);
    px.vline(x + 14, y + 26, base - y - 26, R.steel[5]);
    px.ellipse(x + 16, base - 2, 14, 4, R.steel[2]);
    px.ellipse(x + 16, base - 3, 13, 3, R.steel[4]);
    px.rect(x + 6, base - 6, 6, 2, R.red[4]);
  },
  colliders(it) {
    const base = it.y + num(it.stand, 30) + 32;
    return [
      { x: it.x + 13, y: it.y + 28, w: 6, h: base - it.y - 28 },
      { x: it.x + 2, y: base - 6, w: 28, h: 6 },
    ];
  },
};

/** An open front door with daylight beyond: the classic level exit. */
/**
 * The way out: an open door in the back wall. Its threshold sits where the wall meets the floor (whatever
 * `h` says), with a step and a doormat on the floor in front, so it lines up with the room around it.
 */
export function doorBottom(it: ItemDef): number {
  return Math.min(it.y + H(it, 226), LAYOUT.wallBase);
}

export const frontDoorKind: KindDef = {
  z: 0,
  paint(px, it, room) {
    const w = W(it, 96);
    const { x, y } = it;
    const bot = doorBottom(it);
    const h = bot - y;
    const trim = R[room.wall.trim];
    // casing: head and jambs, down to the floor
    px.rect(x - 8, y - 8, w + 16, h + 8, trim[trim.length - 2]);
    px.frame(x - 8, y - 8, w + 16, h + 8, trim[1]);
    px.hline(x - 8, y - 8, w + 16, trim[trim.length - 1]);
    px.vline(x - 1, y, h, trim[1]);
    px.vline(x + w, y, h, trim[1]);
    // daylight outside: sky, a lawn and the garden path running up to the step
    px.vgrad(x, y, w, h, [R.sky[3], R.sky[4], R.sky[5], '#fff6dc']);
    const lawn = Math.min(40, Math.round(h * 0.24));
    px.rect(x, bot - lawn, w, lawn, R.moss[4]);
    px.dither(x, bot - lawn, w, 3, R.moss[2], 0.4);
    px.poly([[x + w * 0.4, bot - lawn], [x + w * 0.6, bot - lawn], [x + w * 0.86, bot], [x + w * 0.14, bot]], R.cream[3]);
    px.ellipse(x + 20, bot - lawn - 6, 14, 10, R.leaf[3]);
    px.ellipse(x + 18, bot - lawn - 8, 9, 6, R.leaf[4]);
    // stone step across the threshold
    px.rect(x - 8, bot - 3, w + 16, 4, R.stone[3]);
    px.hline(x - 8, bot - 3, w + 16, R.stone[5]);
    px.hline(x - 8, bot, w + 16, R.stone[1]);
    // doormat on the floor in front, in perspective
    const my = LAYOUT.wallBase + 4;
    px.poly([[x + 12, my], [x + w - 12, my], [x + w - 6, my + 9], [x + 6, my + 9]], R.mustard[2]);
    px.poly([[x + 15, my + 2], [x + w - 15, my + 2], [x + w - 10, my + 7], [x + 10, my + 7]], R.mustard[3]);
    px.dither(x + 14, my + 2, w - 28, 5, R.mustard[1], 0.25);
    // open door leaf, hinged on the side away from the room (`flip` for doors on the left)
    const door = pickRamp(it, [R.red, R.teal, R.navy]);
    if (it.flip) {
      px.poly([[x + 4, y], [x - 10, y + 10], [x - 10, bot - 4], [x + 4, bot]], door[3]);
      px.line(x + 4, y, x - 10, y + 10, door[5]);
      px.line(x - 10, y + 10, x - 10, bot - 4, door[2]);
      px.rect(x - 7, y + h / 2, 3, 6, R.brass[4]);
    } else {
      px.poly([[x + w - 4, y], [x + w + 10, y + 10], [x + w + 10, bot - 4], [x + w - 4, bot]], door[3]);
      px.line(x + w - 4, y, x + w + 10, y + 10, door[5]);
      px.line(x + w + 10, y + 10, x + w + 10, bot - 4, door[2]);
      px.rect(x + w + 4, y + h / 2, 3, 6, R.brass[4]);
    }
  },
  glow(px, it) {
    px.rect(it.x, it.y, W(it, 96), doorBottom(it) - it.y, '#e8f2ff');
  },
  lights(it) {
    return [{ x: it.x + W(it, 96) / 2, y: (it.y + doorBottom(it)) / 2, r: 240, color: '#fff2d8', intensity: 0.8 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Bathroom & utility

export const bathtubKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 200);
    const h = H(it, 70);
    const { x, y } = it;
    floorShadow(px, x + 10, w - 20);
    // claw feet
    for (const fx of [x + 16, x + w - 26]) {
      px.ellipse(fx + 5, y + h - 3, 6, 3, R.brass[3]);
      px.rect(fx + 2, y + h - 10, 6, 8, R.brass[2]);
    }
    // tub body: rounded rim
    px.ellipse(x + w / 2, y + 8, w / 2, 8, '#f6f4ee');
    px.rect(x + 4, y + 8, w - 8, h - 22, '#eeece6');
    px.ellipse(x + w / 2, y + h - 14, w / 2 - 6, 10, '#e2dfd8');
    px.dither(x + 4, y + 30, w - 8, h - 44, '#c9c6c0', 0.35);
    px.hline(x + 6, y + 2, w - 12, '#ffffff');
    px.ellipse(x + w / 2, y + 8, w / 2 - 10, 4, '#9fc4e6');
    px.dither(x + 14, y + 6, w - 28, 3, '#ffffff', 0.4);
    // tap
    px.rect(x + w - 30, y - 18, 4, 20, R.steel[4]);
    px.rect(x + w - 40, y - 20, 14, 4, R.steel[4]);
    px.px(x + w - 40, y - 16, R.sky[4]);
  },
  colliders(it) {
    const w = W(it, 200);
    const h = H(it, 70);
    return [
      { x: it.x + 2, y: it.y + 4, w: w - 4, h: h - 4 },
      { x: it.x + w - 40, y: it.y - 20, w: 16, h: 22 },
    ];
  },
};

export const sinkKind: KindDef = {
  z: 1,
  paint(px, it) {
    const { x, y } = it; // basin top-left; pedestal down to the floor
    const w = W(it, 60);
    const floor = LAYOUT.floor;
    floorShadow(px, x + w / 2 - 10, 20);
    px.rect(x + w / 2 - 7, y + 16, 14, floor - y - 16, '#eceae4');
    px.vline(x + w / 2 - 7, y + 16, floor - y - 16, '#ffffff');
    px.vline(x + w / 2 + 6, y + 16, floor - y - 16, '#c9c6c0');
    px.ellipse(x + w / 2, y + 6, w / 2, 7, '#f6f4ee');
    px.rect(x, y + 6, w, 10, '#eeece6');
    px.ellipse(x + w / 2, y + 16, w / 2 - 4, 4, '#dedbd4');
    px.ellipse(x + w / 2, y + 5, w / 2 - 6, 3, '#c9dceb');
    // tap
    px.rect(x + w / 2 - 2, y - 10, 4, 12, R.steel[4]);
    px.rect(x + w / 2 - 2, y - 12, 12, 3, R.steel[4]);
    // mirror above
    if (it.mirror !== false) {
      const mx = x + w / 2 - 24;
      const my = y - 96;
      px.rect(mx - 3, my - 3, 54, 70, R.brass[3]);
      px.frame(mx - 3, my - 3, 54, 70, R.brass[1]);
      px.vgrad(mx, my, 48, 64, [R.sky[3], R.sky[4], R.sky[5]]);
      px.line(mx + 6, my + 30, mx + 22, my + 14, '#ffffff');
      px.line(mx + 10, my + 36, mx + 30, my + 16, '#eaf4fb');
    }
  },
  colliders(it) {
    const w = W(it, 60);
    return [
      { x: it.x, y: it.y, w, h: 16 },
      { x: it.x + w / 2 - 7, y: it.y + 16, w: 14, h: LAYOUT.floor - it.y - 16 },
    ];
  },
};

export const towelRailKind: KindDef = {
  z: 0,
  paint(px, it) {
    const { x, y } = it;
    const w = W(it, 54);
    const c = pickRamp(it, [R.teal, R.rose, R.mustard, R.navy]);
    px.rect(x, y, w, 3, R.steel[4]);
    px.rect(x - 2, y - 2, 4, 6, R.steel[3]);
    px.rect(x + w - 2, y - 2, 4, 6, R.steel[3]);
    px.rect(x + 6, y + 2, w - 12, 34, c[3]);
    for (let k = 0; k < w - 12; k += 4) px.vline(x + 6 + k, y + 2, 34, c[2]);
    px.rect(x + 6, y + 28, w - 12, 3, c[5] ?? c[4]);
    px.hline(x + 6, y + 36, w - 12, c[1]);
  },
};

export const radiatorKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 90);
    const h = H(it, 56);
    const { x, y } = it;
    floorShadow(px, x, w);
    px.rect(x, y, w, h, R.cream[4]);
    for (let k = 0; k < w; k += 10) {
      px.rect(x + k + 1, y + 2, 8, h - 6, R.cream[5]);
      px.vline(x + k + 8, y + 2, h - 6, R.cream[2]);
      px.vline(x + k + 1, y + 2, h - 6, '#ffffff');
    }
    px.rect(x, y + h - 4, w, 4, R.cream[2]);
    px.frame(x, y, w, h, R.cream[1]);
    px.rect(x + w - 4, y - 6, 6, 6, R.brass[3]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y, w: W(it, 90), h: H(it, 56) }];
  },
  lights(it) {
    return [{ x: it.x + W(it, 90) / 2, y: it.y, r: 60, color: '#ffb880', intensity: 0.14 }];
  },
};

export const ceilingVentKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 48);
    const { x } = it;
    const y = LAYOUT.ceiling - 2;
    px.rect(x - 2, y, w + 4, 8, R.steel[2]);
    px.rect(x, y + 2, w, 4, R.ink[0]);
    for (let k = 2; k < w - 1; k += 4) px.vline(x + k, y + 2, 4, R.steel[4]);
    px.hline(x - 2, y + 7, w + 4, R.steel[1]);
  },
  colliders(it) {
    return [{ x: it.x - 2, y: LAYOUT.ceiling - 2, w: W(it, 48) + 4, h: 8 }];
  },
};

export const plantKind: KindDef = {
  z: 1,
  paint(px, it) {
    const { x, y } = it; // pot top-left; pot ~30×26, leaves above
    const w = W(it, 30);
    const tall = num(it.tall, 50);
    const pot = pickRamp(it, [R.peach, R.teal, R.cream, R.red]);
    floorShadow(px, x, w);
    // leaves
    const leaf = R.leaf;
    for (let k = 0; k < 9; k++) {
      const a = -Math.PI / 2 + (k - 4) * 0.32;
      const len = tall * (0.6 + ((k * 37) % 10) / 25);
      const ex = x + w / 2 + Math.cos(a) * len * 0.55;
      const ey = y + Math.sin(a) * len;
      px.line(x + w / 2, y + 2, ex, ey, leaf[2]);
      px.ellipse(ex, ey, 4, 2.5, leaf[3 + (k % 2)]);
    }
    // pot
    px.poly([[x, y], [x + w, y], [x + w - 4, y + 26], [x + 4, y + 26]], pot[3]);
    px.rect(x - 2, y, w + 4, 5, pot[4]);
    px.hline(x - 2, y, w + 4, pot[5] ?? pot[4]);
    px.vline(x + w - 6, y + 5, 20, pot[2]);
  },
  colliders(it) {
    const w = W(it, 30);
    const tall = num(it.tall, 50);
    return [
      { x: it.x - 2, y: it.y, w: w + 4, h: 26 },
      { x: it.x + 2, y: it.y - tall * 0.8, w: w - 4, h: tall * 0.8, kind: 'soft' as const },
    ];
  },
};

export const shelfKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 110);
    const { x, y } = it;
    const wood = pickRamp(it, [R.oak, R.walnut, R.pine]);
    px.box(x, y, w, 8, 4, wood);
    px.poly([[x + 8, y + 8], [x + 14, y + 8], [x + 8, y + 18]], wood[2]);
    px.poly([[x + w - 14, y + 8], [x + w - 8, y + 8], [x + w - 8, y + 18]], wood[2]);
    px.dither(x + 2, y + 9, w - 4, 3, R.ink[1], 0.4);
    // little things on the shelf
    const cols = [R.red, R.teal, R.mustard, R.plum];
    let k = 0;
    for (let bx = x + 8; bx < x + w - 14; bx += 18 + ((k * 7) % 8), k++) {
      const c = cols[k % cols.length];
      if (k % 3 === 0) {
        px.rect(bx, y - 14, 10, 14, c[3]);
        px.rect(bx + 2, y - 16, 6, 2, c[4]);
      } else if (k % 3 === 1) {
        px.ellipse(bx + 5, y - 6, 6, 6, c[4]);
        px.px(bx + 3, y - 9, '#ffffff');
      } else {
        px.rect(bx, y - 20, 5, 20, c[3]);
        px.rect(bx + 5, y - 17, 5, 17, cols[(k + 1) % cols.length][3]);
      }
    }
  },
  colliders(it) {
    return [{ x: it.x, y: it.y, w: W(it, 110), h: 8 }];
  },
};

export const banisterKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 160);
    const h = H(it, 70);
    const { x, y } = it;
    const wood = pickRamp(it, [R.walnut, R.oak]);
    px.rect(x, y, w, 8, wood[3]);
    px.hline(x, y, w, wood[5]);
    px.hline(x, y + 7, w, wood[1]);
    for (let k = 6; k < w - 4; k += 14) {
      px.rect(x + k, y + 8, 4, h - 8, wood[3]);
      px.vline(x + k, y + 8, h - 8, wood[4]);
    }
    px.rect(x - 4, y - 8, 10, h + 8, wood[2]);
    px.rect(x + w - 6, y - 8, 10, h + 8, wood[2]);
    px.ellipse(x + 1, y - 9, 6, 4, wood[4]);
    px.ellipse(x + w - 1, y - 9, 6, 4, wood[4]);
  },
  colliders(it) {
    const w = W(it, 160);
    const h = H(it, 70);
    return [
      { x: it.x - 4, y: it.y - 12, w: w + 8, h: 12 },
      { x: it.x, y: it.y, w, h, kind: 'soft' as const },
    ];
  },
};

export const toasterKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it; // 36×24 body
    px.rect(x, y + 4, 36, 20, R.steel[4]);
    px.rect(x + 2, y + 2, 32, 4, R.steel[5]);
    px.hline(x + 2, y + 2, 32, '#ffffff');
    px.rect(x + 6, y, 10, 3, R.ink[1]);
    px.rect(x + 20, y, 10, 3, R.ink[1]);
    px.rect(x + 34, y + 10, 4, 6, R.ink[3]);
    px.frame(x, y + 2, 36, 22, R.steel[1]);
    px.vline(x + 30, y + 6, 16, R.steel[3]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 2, w: 36, h: 22 }];
  },
};
