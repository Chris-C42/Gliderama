/**
 * Grandma's Cottage: hearth, clocks, dressers and knitting. Coordinates: x, y = top-left of the
 * item's box in room pixels (as in home.ts). Things that move (fire, pendulum, cat, steam, cuckoo)
 * are runtime objects in game/objects/cottage.ts at the same item.
 */

import { R, type Ramp } from '../../render/palette';
import type { Px } from '../../render/pixel';
import type { ItemDef } from '../types';
import { LAYOUT } from '../types';
import { floorShadow, paintOutdoor } from './home';
import type { KindDef } from './types';

const W = (it: ItemDef, d: number) => it.w ?? d;
const H = (it: ItemDef, d: number) => it.h ?? d;
const pickRamp = (it: ItemDef, options: readonly Ramp[]) => options[(it.v ?? 0) % options.length];

/** Running-bond brickwork. */
function bricks(px: Px, x: number, y: number, w: number, h: number, ramp: Ramp, mortar: string) {
  px.rect(x, y, w, h, ramp[2]);
  for (let row = 0, yy = y; yy < y + h; row++, yy += 7) {
    px.hline(x, yy, w, mortar);
    const off = row % 2 ? 7 : 0;
    for (let xx = x - off; xx < x + w; xx += 14) {
      if (xx > x) px.vline(xx, yy, Math.min(7, y + h - yy), mortar);
      // a little variety in the bricks
      const k = (row * 5 + Math.floor((xx - x) / 14) * 3) % 5;
      if (k === 0) px.rect(Math.max(x, xx + 1), yy + 1, Math.min(13, x + w - xx - 1), Math.min(6, y + h - yy - 1), ramp[3]);
      if (k === 3) px.rect(Math.max(x, xx + 1), yy + 1, Math.min(13, x + w - xx - 1), Math.min(6, y + h - yy - 1), ramp[1]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Fireplace: brick surround, mantel, firebox. The fire itself is the runtime `fireplace` object. `cold`: an unlit
// hearth, charred logs on a bed of ash (the Classic Houses: Glider PRO's fireplaces are scenery, nothing to burn on).

/**
 * A burnt-out fire on the grate (an unlit hearth): a pile of logs charred black-brown, pale ash along their tops and
 * on their cut ends, on a heaped bed of cold ash. Sized to the firebox.
 */
function charredLogs(px: Px, fx: number, fw: number, gy: number) {
  const t = Math.max(5, Math.min(9, Math.round(fw / 18)));
  const log = (x0: number, x1: number, y: number) => {
    px.rect(x0, y - t, x1 - x0, t, R.walnut[1]);
    px.hline(x0, y - t, x1 - x0, R.stone[2]);
    px.dither(x0, y - t + 1, x1 - x0, 2, R.stone[1], 0.45);
    px.hline(x0, y - 1, x1 - x0, R.ink[1]);
    for (let x = x0 + 5; x < x1 - 4; x += 9) px.vline(x, y - t + 2, t - 3, R.ink[1]);
    // the cut ends, ringed with ash
    px.ellipse(x0, y - t / 2, t / 2, t / 2, R.stone[3]);
    px.ellipse(x0, y - t / 2, t / 2 - 1.5, t / 2 - 1.5, R.walnut[0]);
    px.ellipse(x1, y - t / 2, t / 2, t / 2, R.stone[2]);
  };
  const mid = fx + fw / 2;
  // the ash bed, then two logs side by side and one across them
  px.ellipse(mid, gy + 2, fw / 2 - 8, 4, R.stone[2]);
  px.ellipse(mid, gy + 1, fw / 2 - 16, 3, R.stone[3]);
  log(fx + 14, mid - 3, gy);
  log(mid + 3, fx + fw - 14, gy);
  log(fx + fw * 0.28, fx + fw * 0.72, gy - t + 1);
  px.speckle(fx + 12, gy - 2, fw - 24, 5, [R.stone[4], R.stone[1]], 0.22);
}

export const fireplaceKind: KindDef = {
  z: 1,
  paint(px, it, room) {
    const w = W(it, 170);
    const h = H(it, 150);
    const { x, y } = it;
    const wood = R.walnut;
    floorShadow(px, x - 10, w + 20);
    // the chimney breast stands proud of the wall up to the ceiling: plain lime-washed plaster in the
    // wall's colour, lit on the left, a shadow cast down the right
    const top = LAYOUT.ceiling + 2;
    const b = R[room.wall.base];
    const bx = x + 10;
    const bw = w - 20;
    px.rect(bx, top, bw, y - top, b[b.length - 2]);
    px.speckle(bx, top, bw, y - top, [b[b.length - 3]], 0.02);
    px.dither(bx, top, bw, 8, R.ink[1], 0.3);
    px.vline(bx, top, y - top, b[b.length - 1]);
    px.dither(bx + 1, top, 2, y - top, b[b.length - 1], 0.5);
    px.vline(bx + bw - 1, top, y - top, b[Math.max(0, b.length - 4)]);
    px.dither(bx + bw, top, 5, y - top, R.ink[1], 0.4);
    // brick surround
    bricks(px, x, y + 10, w, h - 10, R.red, R.cream[1]);
    px.frame(x, y + 10, w, h - 10, R.red[0]);
    // firebox with an arched top
    const fx = x + 30;
    const fy = y + 46;
    const fw = w - 60;
    const fh = h - 52;
    px.rect(fx, fy + 10, fw, fh - 10, R.ink[0]);
    px.ellipse(fx + fw / 2, fy + 12, fw / 2, 12, R.ink[0]);
    // arch voussoirs
    for (let a = 0; a <= 12; a++) {
      const t = Math.PI + (a / 12) * Math.PI;
      px.rect(fx + fw / 2 + Math.cos(t) * (fw / 2 + 3) - 2, fy + 12 + Math.sin(t) * 15 - 2, 4, 4, a % 2 ? R.red[4] : R.red[3]);
    }
    // soot and back bricks
    px.dither(fx + 4, fy + 14, fw - 8, fh - 22, R.red[1], 0.35);
    px.dither(fx, fy + 4, fw, 18, '#000000', 0.5);
    // andirons + logs
    const gy = y + h - 16;
    px.rect(fx + 8, gy, fw - 16, 3, R.steel[1]);
    px.rect(fx + 10, gy - 6, 3, 9, R.steel[1]);
    px.rect(fx + fw - 13, gy - 6, 3, 9, R.steel[1]);
    px.ellipse(fx + 10, gy - 7, 2, 2, R.brass[3]);
    px.ellipse(fx + fw - 11, gy - 7, 2, 2, R.brass[3]);
    px.rect(fx + 14, gy - 7, fw - 28, 6, R.oak[2]);
    px.hline(fx + 14, gy - 7, fw - 28, R.oak[4]);
    px.ellipse(fx + 14, gy - 4, 3, 3, R.oak[5]);
    px.ellipse(fx + 14, gy - 4, 1, 1, R.oak[2]);
    px.rect(fx + 22, gy - 12, fw - 50, 5, R.oak[1]);
    px.ellipse(fx + fw - 28, gy - 10, 3, 3, R.oak[4]);
    if (it.cold) charredLogs(px, fx, fw, gy);
    // hearth stone
    px.rect(x - 14, y + h - 6, w + 28, 6, R.stone[3]);
    px.hline(x - 14, y + h - 6, w + 28, R.stone[5]);
    px.hline(x - 14, y + h - 1, w + 28, R.stone[1]);
    // mantel shelf with corbels
    px.box(x - 10, y, w + 20, 10, 5, wood);
    px.poly([[x + 4, y + 10], [x + 16, y + 10], [x + 4, y + 22]], wood[2]);
    px.poly([[x + w - 16, y + 10], [x + w - 4, y + 10], [x + w - 4, y + 22]], wood[2]);
    px.dither(x - 8, y + 11, w + 16, 3, R.ink[1], 0.45);
  },
  glow(px, it) {
    if (it.cold) return;
    const w = W(it, 170);
    const h = H(it, 150);
    const fx = it.x + 34;
    const fw = w - 68;
    px.dither(fx, it.y + h - 40, fw, 30, '#ff8a3c', 0.6);
    px.rect(fx + 8, it.y + h - 22, fw - 16, 8, '#ffb050');
  },
  colliders(it) {
    const w = W(it, 170);
    const h = H(it, 150);
    return [
      { x: it.x - 10, y: it.y, w: w + 20, h: 10 },
      { x: it.x, y: it.y + 10, w: 30, h: h - 10 },
      { x: it.x + w - 30, y: it.y + 10, w: 30, h: h - 10 },
    ];
  },
  lights(it) {
    if (it.cold) return [];
    const w = W(it, 170);
    const h = H(it, 150);
    return [{ x: it.x + w / 2, y: it.y + h - 24, r: 190, color: '#ff9a50', intensity: 1, flicker: 0.35 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Grandfather clock (the pendulum swings: runtime object)

export const grandfatherClockKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 46);
    const h = H(it, 214);
    const { x, y } = it;
    const wood = pickRamp(it, [R.walnut, R.oak]);
    floorShadow(px, x - 2, w + 4);
    // base plinth
    px.box(x - 2, y + 166, w + 4, h - 166, 0, wood);
    px.rect(x + 4, y + 176, w - 8, h - 186, wood[2]);
    px.frame(x + 4, y + 176, w - 8, h - 186, wood[1]);
    // waist with a glass door
    px.box(x + 4, y + 58, w - 8, 108, 0, wood);
    px.rect(x + 10, y + 66, w - 20, 92, R.ink[1]);
    px.dither(x + 10, y + 66, w - 20, 92, wood[1], 0.3);
    px.frame(x + 9, y + 65, w - 18, 94, R.brass[3]);
    // weights hanging behind the glass
    px.vline(x + 15, y + 66, 30, R.brass[2]);
    px.rect(x + 13, y + 96, 5, 14, R.brass[4]);
    px.vline(x + w - 16, y + 66, 22, R.brass[2]);
    px.rect(x + w - 18, y + 88, 5, 14, R.brass[4]);
    // hood
    px.box(x - 3, y + 8, w + 6, 50, 0, wood);
    px.poly([[x - 4, y + 10], [x + w / 2, y - 4], [x + w + 4, y + 10]], wood[3]);
    px.line(x - 4, y + 10, x + w / 2, y - 4, wood[5]);
    px.line(x + w / 2, y - 4, x + w + 4, y + 10, wood[1]);
    px.ellipse(x + w / 2, y - 6, 2, 3, R.brass[4]);
    // dial
    const cx = x + w / 2;
    const cy = y + 33;
    px.ellipse(cx, cy, 16, 16, R.brass[3]);
    px.ellipse(cx, cy, 14, 14, R.cream[5]);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      px.px(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11, k % 3 === 0 ? R.ink[1] : R.ink[3]);
    }
    px.line(cx, cy, cx + 5, cy - 6, R.ink[1]);
    px.line(cx, cy, cx - 1, cy + 8, R.ink[1]);
    px.px(cx, cy, R.brass[2]);
    // moon-phase arch
    px.ellipse(cx, cy - 15, 7, 3, R.navy[3]);
    px.px(cx - 3, cy - 16, R.cream[5]);
  },
  colliders(it) {
    const w = W(it, 46);
    const h = H(it, 214);
    return [
      { x: it.x - 3, y: it.y + 2, w: w + 6, h: 56 },
      { x: it.x + 4, y: it.y + 58, w: w - 8, h: 108 },
      { x: it.x - 2, y: it.y + 166, w: w + 4, h: h - 166 },
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// Wingback armchair with floral upholstery

export const armchairKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 96);
    const h = H(it, 110);
    const { x, y } = it;
    const c = pickRamp(it, [R.rose, R.moss, R.plum, R.mustard]);
    const flip = !!it.flip;
    floorShadow(px, x + 4, w - 8);
    const flowers = (fx: number, fy: number, fw: number, fh: number) => {
      for (let j = 3; j < fh - 2; j += 9)
        for (let i = (j / 9) % 2 ? 5 : 1; i < fw - 2; i += 10) {
          px.px(fx + i, fy + j, c[5]);
          px.px(fx + i - 1, fy + j + 1, c[4]);
          px.px(fx + i + 1, fy + j + 1, c[4]);
          px.px(fx + i, fy + j + 2, R.leaf[4]);
        }
    };
    // back with wings
    const bx = x + 10;
    px.rect(bx, y + 10, w - 20, 64, c[3]);
    px.ellipse(x + w / 2, y + 12, (w - 20) / 2, 12, c[3]);
    flowers(bx, y + 4, w - 20, 70);
    px.vline(bx, y + 12, 62, c[1]);
    px.vline(bx + w - 21, y + 12, 62, c[1]);
    // the wing nearest the viewer
    const wx = flip ? x + w - 22 : x + 4;
    px.rect(wx, y + 22, 18, 40, c[2]);
    px.ellipse(wx + 9, y + 22, 9, 6, c[2]);
    // seat cushion
    px.rect(x + 14, y + 66, w - 28, 14, c[4]);
    px.hline(x + 14, y + 66, w - 28, c[5]);
    px.hline(x + 14, y + 79, w - 28, c[2]);
    // arms (rolled)
    for (const ax of [x, x + w - 18]) {
      px.rect(ax, y + 56, 18, 32, c[3]);
      px.ellipse(ax + 9, y + 56, 9, 6, c[4]);
      px.ellipse(ax + 9, y + 56, 5, 3, c[3]);
      px.vline(ax + 17, y + 56, 32, c[1]);
    }
    // skirt and legs
    px.rect(x + 2, y + 86, w - 4, 12, c[2]);
    for (let k = 0; k < w - 4; k += 6) px.vline(x + 4 + k, y + 88, 10, c[1]);
    px.rect(x + 6, y + 98, 6, h - 98, R.walnut[2]);
    px.rect(x + w - 12, y + 98, 6, h - 98, R.walnut[2]);
  },
  colliders(it) {
    const w = W(it, 96);
    const h = H(it, 110);
    return [
      { x: it.x + 10, y: it.y + 2, w: w - 20, h: 64 },
      { x: it.x, y: it.y + 52, w: 18, h: h - 52 },
      { x: it.x + w - 18, y: it.y + 52, w: 18, h: h - 52 },
      { x: it.x + 18, y: it.y + 66, w: w - 36, h: h - 66, kind: 'soft' },
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// Kitchen range (cast iron) with a stovepipe to the ceiling

export const stoveKind: KindDef = {
  z: 1,
  paint(px, it, room) {
    const w = W(it, 124);
    const h = H(it, 96);
    const { x, y } = it;
    const iron = R.ink;
    floorShadow(px, x, w);
    // a short stovepipe with an elbow into the chimney behind
    const pxp = x + w - 30;
    px.rect(pxp, y - 46, 14, 46, iron[2]);
    px.vline(pxp + 2, y - 46, 46, iron[4]);
    px.vline(pxp + 12, y - 46, 46, iron[1]);
    px.rect(pxp - 1, y - 26, 16, 3, iron[3]);
    px.ellipse(pxp + 7, y - 48, 8, 5, iron[3]);
    px.ellipse(pxp + 7, y - 48, 5, 3, iron[0]);
    // body
    px.box(x, y, w, h, 6, [iron[0], iron[1], iron[2], iron[3], iron[4], iron[5]]);
    // top rail + hotplates
    px.rect(x - 4, y, w + 8, 6, iron[3]);
    px.hline(x - 4, y, w + 8, R.steel[4]);
    px.ellipse(x + 26, y + 2, 14, 2, iron[1]);
    px.ellipse(x + 64, y + 2, 14, 2, iron[1]);
    // oven door with a brass handle and a little window
    px.rect(x + 10, y + 16, w - 52, h - 30, iron[2]);
    px.frame(x + 10, y + 16, w - 52, h - 30, iron[4]);
    px.rect(x + 20, y + 30, w - 72, 18, R.flame[1]);
    px.dither(x + 20, y + 30, w - 72, 18, R.flame[3], 0.3);
    px.rect(x + 14, y + 20, w - 60, 3, R.brass[4]);
    // firebox door + vents
    px.rect(x + w - 38, y + 16, 30, 30, iron[2]);
    px.frame(x + w - 38, y + 16, 30, 30, iron[4]);
    for (let k = 0; k < 4; k++) px.rect(x + w - 34 + k * 7, y + 22, 4, 2, R.flame[2]);
    px.rect(x + w - 38, y + 52, 30, h - 66, iron[1]);
    // feet
    px.rect(x + 2, y + h - 4, 10, 4, iron[0]);
    px.rect(x + w - 12, y + h - 4, 10, 4, iron[0]);
    // its kettle (the steam is the runtime `stove` object); `kettle: false` for an empty hob
    if (it.kettle !== false) kettleKind.paint!(px, { t: 'kettle', x: x + 8, y: y - 22, v: it.v }, room);
  },
  glow(px, it) {
    const w = W(it, 124);
    px.rect(it.x + 20, it.y + 30, w - 72, 18, '#a8401c');
    for (let k = 0; k < 4; k++) px.rect(it.x + w - 34 + k * 7, it.y + 22, 4, 2, '#ff7a30');
  },
  colliders(it) {
    const w = W(it, 124);
    const h = H(it, 96);
    return [
      { x: it.x - 4, y: it.y, w: w + 8, h },
      { x: it.x + w - 31, y: it.y - 52, w: 16, h: 52 },
      ...(it.kettle !== false ? [{ x: it.x + 9, y: it.y - 17, w: 22, h: 17 }] : []),
    ];
  },
  lights(it) {
    return [{ x: it.x + 40, y: it.y + 40, r: 70, color: '#ff8040', intensity: 0.5, flicker: 0.2 }];
  },
};

/** Kettle on the hob (28×22 box). The steam is the runtime `kettle` object. */
export const kettleKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it;
    const c = pickRamp(it, [R.red, R.teal, R.mustard]);
    px.ellipse(x + 12, y + 14, 11, 9, c[3]);
    px.ellipse(x + 10, y + 11, 7, 5, c[4]);
    px.px(x + 7, y + 9, '#ffffff');
    px.rect(x + 2, y + 18, 20, 4, c[2]);
    // spout to the right
    px.line(x + 20, y + 14, x + 28, y + 6, c[3]);
    px.line(x + 21, y + 15, x + 28, y + 7, c[2]);
    // lid, knob and handle
    px.rect(x + 7, y + 4, 10, 2, c[2]);
    px.rect(x + 10, y + 1, 4, 3, R.ink[2]);
    px.line(x + 3, y + 8, x + 6, y + 1, R.ink[2]);
    px.line(x + 6, y + 1, x + 18, y + 1, R.ink[2]);
    px.line(x + 18, y + 1, x + 21, y + 8, R.ink[2]);
  },
  colliders(it) {
    return [{ x: it.x + 1, y: it.y + 5, w: 22, h: 17 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Welsh dresser with blue-and-white plates

export const dresserHutchKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 150);
    const h = H(it, 204);
    const { x, y } = it;
    const wood = pickRamp(it, [R.pine, R.oak]);
    floorShadow(px, x, w);
    // upper hutch back + sides + cornice
    px.rect(x + 6, y + 10, w - 12, 112, wood[2]);
    px.dither(x + 6, y + 10, w - 12, 112, R.ink[1], 0.2);
    px.box(x, y + 10, 6, 112, 0, wood);
    px.box(x + w - 6, y + 10, 6, 112, 0, wood);
    px.box(x - 4, y, w + 8, 10, 4, wood);
    // shelves with plates and cups
    const shelfY = [y + 46, y + 84];
    for (const sy of shelfY) {
      px.rect(x + 6, sy, w - 12, 4, wood[4]);
      px.hline(x + 6, sy, w - 12, wood[5]);
    }
    const plate = (cx: number, cy: number, r: number) => {
      px.ellipse(cx, cy, r, r, R.cream[5]);
      px.ellipse(cx, cy, r - 2, r - 2, R.navy[4]);
      px.ellipse(cx, cy, r - 4, r - 4, R.cream[5]);
      px.ellipse(cx, cy, 2, 2, R.navy[3]);
    };
    for (let k = 0; k < 4; k++) plate(x + 26 + k * 33, y + 31, 13);
    for (let k = 0; k < 5; k++) {
      const cx = x + 20 + k * 27;
      px.rect(cx - 5, y + 74, 10, 10, k % 2 ? R.navy[4] : R.cream[5]);
      px.rect(cx + 5, y + 76, 3, 5, R.cream[3]);
      px.hline(cx - 5, y + 74, 10, '#ffffff');
    }
    for (let k = 0; k < 3; k++) plate(x + 34 + k * 40, y + 108, 11);
    // counter
    px.box(x - 6, y + 122, w + 12, 9, 5, wood);
    // lower cupboard
    px.box(x, y + 131, w, h - 131, 0, wood);
    for (let k = 0; k < 2; k++) {
      const dx = x + 8 + k * ((w - 16) / 2);
      const dw = (w - 24) / 2;
      px.rect(dx, y + 138, dw, h - 150, wood[4]);
      px.frame(dx, y + 138, dw, h - 150, wood[2]);
      px.frame(dx + 5, y + 144, dw - 10, h - 162, wood[3]);
      px.ellipse(dx + (k === 0 ? dw - 6 : 6), y + 138 + (h - 150) / 2, 2, 2, R.brass[4]);
    }
  },
  colliders(it) {
    const w = W(it, 150);
    const h = H(it, 204);
    return [
      { x: it.x - 4, y: it.y, w: w + 8, h: 10 },
      { x: it.x, y: it.y + 10, w: 6, h: 112 },
      { x: it.x + w - 6, y: it.y + 10, w: 6, h: 112 },
      { x: it.x + 6, y: it.y + 46, w: w - 12, h: 4 },
      { x: it.x + 6, y: it.y + 84, w: w - 12, h: 4 },
      { x: it.x - 6, y: it.y + 122, w: w + 12, h: 9 },
      { x: it.x, y: it.y + 131, w, h: h - 131 },
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// Rocking chair

export const rockingChairKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 70);
    const h = H(it, 104);
    const { x, y } = it;
    const wood = pickRamp(it, [R.oak, R.walnut, R.pine]);
    // drawn in profile; the front faces left (or right when flipped)
    const flip = !!it.flip;
    const X = (dx: number) => (flip ? x + w - dx : x + dx);
    const seg = (x0: number, y0: number, x1: number, y1: number, c: string, t = 1) => {
      for (let k = 0; k < t; k++) px.line(X(x0) + (flip ? -k : k), y0, X(x1) + (flip ? -k : k), y1, c);
    };
    floorShadow(px, x, w);
    // rockers: a long shallow arc
    for (let i = -8; i <= w + 8; i++) {
      const t = (i - w / 2) / (w / 2 + 8);
      const yy = y + h - 4 - Math.round((1 - t * t) * 6);
      px.rect(X(i), yy, 1, 3, wood[3]);
      px.px(X(i), yy, wood[5]);
    }
    // legs
    seg(12, y + 64, 10, y + h - 8, wood[2], 3);
    seg(w - 18, y + 64, w - 16, y + h - 8, wood[2], 3);
    // seat with a cushion
    seg(6, y + 60, w - 8, y + 60, wood[4], 1);
    px.rect(Math.min(X(6), X(w - 8)), y + 61, w - 14, 4, wood[3]);
    px.rect(Math.min(X(10), X(w - 16)), y + 55, w - 26, 5, R.rose[4]);
    px.hline(Math.min(X(10), X(w - 16)), y + 55, w - 26, R.rose[5]);
    // the back post raked away from the front, with a crest rail and slats seen edge-on
    seg(w - 12, y + 62, w - 2, y + 4, wood[3], 4);
    seg(w - 12, y + 62, w - 2, y + 4, wood[5], 1);
    px.ellipse(X(w - 1), y + 3, 4, 3, wood[4]);
    for (let k = 0; k < 4; k++) {
      const ty = y + 14 + k * 11;
      const tx = w - 3 - ((ty - y - 4) / 58) * 10;
      seg(tx - 7, ty + 2, tx, ty, wood[2], 2);
    }
    // arm rest from the back post to the front, on a turned spindle
    seg(w - 8, y + 30, 8, y + 36, wood[4], 3);
    px.ellipse(X(8), y + 37, 3, 2, wood[5]);
    seg(10, y + 38, 12, y + 58, wood[2], 2);
  },
  colliders(it) {
    const w = W(it, 70);
    const h = H(it, 104);
    const flip = !!it.flip;
    return [
      { x: it.x + 6, y: it.y + 54, w: w - 14, h: 12 },
      { x: flip ? it.x : it.x + w - 12, y: it.y, w: 12, h: 62 },
      { x: it.x - 6, y: it.y + h - 10, w: w + 12, h: 10 },
    ];
  },
};

// ---------------------------------------------------------------------------------------------
// Cuckoo clock (the bird is a runtime object that pops out on the hour)

export const cuckooClockKind: KindDef = {
  z: 0,
  paint(px, it) {
    const { x, y } = it; // 44×64 box
    const wood = R.walnut;
    // chains and pine-cone weights
    px.vline(x + 14, y + 52, 40, R.brass[3]);
    px.vline(x + 30, y + 52, 26, R.brass[3]);
    for (const [wx, wy] of [
      [14, 92],
      [30, 78],
    ]) {
      px.ellipse(x + wx, y + wy, 3, 6, wood[2]);
      px.px(x + wx - 1, y + wy - 2, wood[4]);
      px.px(x + wx + 1, y + wy + 1, wood[4]);
    }
    // pendulum
    px.vline(x + 22, y + 52, 22, wood[1]);
    px.ellipse(x + 22, y + 76, 4, 4, wood[3]);
    // house
    px.rect(x + 4, y + 18, 36, 34, wood[3]);
    px.frame(x + 4, y + 18, 36, 34, wood[1]);
    px.poly([[x - 2, y + 20], [x + 22, y], [x + 46, y + 20]], wood[2]);
    px.line(x - 2, y + 20, x + 22, y, wood[4]);
    px.line(x + 22, y, x + 46, y + 20, wood[1]);
    for (let k = 0; k < 5; k++) px.line(x + 2 + k * 4, y + 18 - k * 3, x + 6 + k * 4, y + 18 - k * 3, R.leaf[3]);
    // the little door
    px.rect(x + 17, y + 8, 10, 10, wood[1]);
    px.frame(x + 17, y + 8, 10, 10, R.cream[3]);
    // dial
    px.ellipse(x + 22, y + 34, 9, 9, R.cream[5]);
    px.ellipse(x + 22, y + 34, 9, 9, R.cream[5]);
    px.line(x + 22, y + 34, x + 22, y + 28, R.ink[1]);
    px.line(x + 22, y + 34, x + 26, y + 36, R.ink[1]);
    // carved leaves
    px.ellipse(x + 6, y + 50, 5, 3, R.leaf[3]);
    px.ellipse(x + 38, y + 50, 5, 3, R.leaf[3]);
  },
  colliders(it) {
    return [{ x: it.x + 4, y: it.y + 6, w: 36, h: 46 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Tea table with teapot and cups

export const teaTableKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = W(it, 84);
    const h = H(it, 62);
    const { x, y } = it;
    const wood = pickRamp(it, [R.walnut, R.oak]);
    floorShadow(px, x + 16, w - 32);
    // pedestal + tripod feet
    px.rect(x + w / 2 - 3, y + 8, 6, h - 16, wood[3]);
    px.vline(x + w / 2 - 3, y + 8, h - 16, wood[5]);
    px.line(x + w / 2, y + h - 8, x + 14, y + h - 1, wood[2]);
    px.line(x + w / 2, y + h - 8, x + w - 14, y + h - 1, wood[2]);
    // round top with a lace cloth
    px.ellipse(x + w / 2, y + 5, w / 2, 5, wood[3]);
    px.ellipse(x + w / 2, y + 4, w / 2 - 6, 4, '#f8f4ec');
    for (let i = 8; i < w - 8; i += 6) px.ellipse(x + i, y + 9, 2, 2, '#f8f4ec');
    // teapot
    const tx = x + 18;
    const c = R.navy;
    px.ellipse(tx + 10, y - 7, 10, 8, c[4]);
    px.ellipse(tx + 8, y - 9, 5, 3, c[5]);
    px.line(tx + 19, y - 8, tx + 26, y - 14, c[3]);
    px.line(tx + 1, y - 11, tx - 3, y - 4, c[2]);
    px.rect(tx + 7, y - 16, 6, 2, c[3]);
    // cups
    for (const cx of [x + 52, x + 64]) {
      px.rect(cx, y - 6, 8, 6, '#f8f4ec');
      px.hline(cx, y - 6, 8, R.rose[4]);
      px.rect(cx + 8, y - 5, 2, 3, '#e8e0d4');
    }
  },
  colliders(it) {
    const w = W(it, 84);
    const h = H(it, 62);
    return [
      { x: it.x, y: it.y, w, h: 10 },
      { x: it.x + 16, y: it.y - 16, w: 22, h: 16 },
      { x: it.x + w / 2 - 3, y: it.y + 10, w: 6, h: h - 10 },
    ];
  },
};

/** Knitting basket with yarn and needles (floor). */
export const knittingBasketKind: KindDef = {
  z: 1,
  paint(px, it) {
    const { x, y } = it; // 44×28
    floorShadow(px, x + 2, 40);
    // yarn balls
    px.ellipse(x + 12, y + 8, 8, 8, R.red[4]);
    px.ellipse(x + 26, y + 9, 8, 8, R.teal[4]);
    px.line(x + 6, y + 4, x + 16, y + 12, R.red[2]);
    px.line(x + 22, y + 4, x + 30, y + 14, R.teal[2]);
    // needles
    px.line(x + 18, y - 6, x + 30, y + 10, R.steel[4]);
    px.line(x + 24, y - 8, x + 20, y + 10, R.steel[4]);
    px.ellipse(x + 18, y - 6, 1, 1, R.mustard[4]);
    // wicker
    px.rect(x, y + 10, 44, 18, R.pine[3]);
    for (let yy = y + 11; yy < y + 28; yy += 3) px.hline(x, yy, 44, R.pine[2]);
    for (let xx = x + 2; xx < x + 44; xx += 5) px.vline(xx, y + 10, 18, R.pine[4]);
    px.frame(x, y + 10, 44, 18, R.pine[1]);
    px.rect(x - 1, y + 9, 46, 3, R.pine[4]);
    // a strand trailing on the floor
    px.line(x + 44, y + 22, x + 60, y + 27, R.red[3]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 8, w: 44, h: 20 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Cottage window: small panes, lace curtains, a window box of geraniums

export const cottageWindowKind: KindDef = {
  z: 0,
  paint(px, it, room) {
    const w = W(it, 96);
    const h = H(it, 104);
    const { x, y } = it;
    const frame = R.cream;
    px.rect(x - 3, y - 3, w + 6, h + 6, R.ink[2]);
    paintOutdoor(px, x, y, w, h, !!room.night, room.seed ?? 5);
    // panes
    for (let i = 1; i < 3; i++) px.rect(x + Math.round((w * i) / 3) - 1, y, 2, h, frame[4]);
    for (let j = 1; j < 4; j++) px.rect(x, y + Math.round((h * j) / 4) - 1, w, 2, frame[4]);
    px.frame(x, y, w, h, frame[5]);
    px.frame(x + 1, y + 1, w - 2, h - 2, frame[3]);
    // lace curtains gathered to the sides, scalloped edge
    for (const side of [0, 1]) {
      const cx = side ? x + w - 24 : x;
      px.dither(cx, y, 24, h - 10, '#ffffff', 0.55);
      for (let yy = y + 4; yy < y + h - 12; yy += 6) px.px(cx + (side ? 4 : 18), yy, '#ffffff');
      for (let yy = y; yy < y + h - 10; yy += 4) px.px(side ? cx : cx + 23, yy, '#e8e4dc');
    }
    px.dither(x, y, w, 10, '#ffffff', 0.6);
    for (let i = 0; i < w; i += 6) px.ellipse(x + i + 3, y + 10, 3, 2, '#f8f6f0');
    // sill + window box with geraniums (`box: false` for a plain sill)
    px.rect(x - 8, y + h, w + 16, 5, frame[4]);
    px.hline(x - 8, y + h, w + 16, frame[5]);
    if (it.box === false) {
      px.dither(x - 6, y + h + 5, w + 12, 3, R.ink[1], 0.4);
      return;
    }
    px.rect(x - 4, y + h + 5, w + 8, 12, R.leaf[2]);
    px.frame(x - 4, y + h + 5, w + 8, 12, R.leaf[0]);
    for (let i = 0; i < w + 4; i += 7) {
      px.ellipse(x - 2 + i, y + h + 3, 4, 3, R.leaf[4]);
      if ((i / 7) % 2 === 0) {
        px.ellipse(x - 2 + i, y + h - 1, 2, 2, R.red[4]);
        px.px(x - 3 + i, y + h - 2, R.red[5]);
      }
    }
  },
  glow(px, it, room) {
    if (room.night) return;
    px.rect(it.x + 2, it.y + 2, W(it, 96) - 4, H(it, 104) - 4, '#9fc4e6');
  },
  colliders(it) {
    const w = W(it, 96);
    const h = H(it, 104);
    return [{ x: it.x - 8, y: it.y + h, w: w + 16, h: it.box === false ? 5 : 17 }];
  },
  lights(it, room) {
    const cx = it.x + W(it, 96) / 2;
    const cy = it.y + H(it, 104) / 2;
    if (room.night) return [{ x: cx, y: cy, r: 130, color: '#7f95c8', intensity: 0.3 }];
    return [{ x: cx, y: cy + 20, r: 200, color: '#fff0d0', intensity: 0.3 }];
  },
};

/** Brass oil lamp (stands on furniture; 18×34 box). Always lit. */
export const oilLampKind: KindDef = {
  z: 2,
  paint(px, it) {
    const { x, y } = it;
    // glass chimney
    px.rect(x + 6, y, 6, 14, '#e8f0f4');
    px.vline(x + 6, y, 14, '#ffffff');
    px.ellipse(x + 9, y + 18, 6, 5, '#f4f8fa');
    px.ellipse(x + 9, y + 15, 2, 3, '#ffd870');
    px.px(x + 9, y + 13, '#fff8d0');
    // brass font and foot
    px.ellipse(x + 9, y + 25, 8, 4, R.brass[3]);
    px.hline(x + 3, y + 23, 12, R.brass[5]);
    px.rect(x + 7, y + 28, 4, 3, R.brass[2]);
    px.rect(x + 3, y + 31, 12, 3, R.brass[3]);
  },
  glow(px, it) {
    px.ellipse(it.x + 9, it.y + 15, 3, 4, '#ffe080');
    px.dither(it.x + 4, it.y + 6, 10, 18, '#ffd060', 0.3);
  },
  colliders(it) {
    return [{ x: it.x + 2, y: it.y, w: 14, h: 34 }];
  },
  lights(it) {
    return [{ x: it.x + 9, y: it.y + 15, r: 110, color: '#ffc870', intensity: 0.8, flicker: 0.12 }];
  },
};

/** Exposed ceiling beam (full width, or `w`). */
export const beamKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 640);
    const h = H(it, 16);
    const { x, y } = it;
    const wood = R.oak;
    px.rect(x, y, w, h, wood[2]);
    px.hline(x, y + h - 1, w, wood[0]);
    px.hline(x, y + h - 3, w, wood[1]);
    for (let i = 7; i < w; i += 31) {
      px.hline(x + i, y + 4 + (i % 5), 14, wood[1]);
      if (i % 3 === 0) px.ellipse(x + i + 8, y + 7, 2, 1, wood[0]);
    }
    px.dither(x, y + h, w, 3, R.ink[1], 0.35);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y, w: W(it, 640), h: H(it, 16) }];
  },
};

/** Bunches of dried herbs hanging from strings (decor, `w` wide under a beam at y). */
export const herbsKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = W(it, 80);
    const { x, y } = it;
    for (let i = 6, k = 0; i < w; i += 18, k++) {
      const len = 8 + ((k * 7) % 9);
      px.vline(x + i, y, len, R.cream[2]);
      const c = [R.leaf, R.moss, R.mustard][k % 3];
      for (let j = 0; j < 9; j++) {
        const dx = ((j * 5) % 7) - 3;
        px.line(x + i, y + len, x + i + dx, y + len + 8 + (j % 3) * 2, c[3 + (j % 2)]);
      }
      px.rect(x + i - 2, y + len - 1, 5, 2, R.red[3]);
    }
  },
};
