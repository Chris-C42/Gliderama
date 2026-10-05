/**
 * Household appliances from Glider PRO's houses, drawn the Gliderama way: a television, a compact computer, a
 * microwave, a video recorder, a stereo, a coffee maker and a tower of CDs. Each stands on whatever it was put on
 * (x, y = top-left of its box; w, h = size, defaulting to Glider PRO's size in Gliderama pixels). Screens and clocks
 * glow when `on` is not false, so they show in a dark room.
 */

import { R } from '../../render/palette';
import type { Px } from '../../render/pixel';
import type { ItemDef } from '../types';
import type { KindDef } from './types';

const W = (it: ItemDef, d: number) => Math.round(it.w ?? d);
const H = (it: ItemDef, d: number) => Math.round(it.h ?? d);
const on = (it: ItemDef) => it.on !== false;
const box = (it: ItemDef, w: number, h: number) => [{ x: it.x, y: it.y, w: W(it, w), h: H(it, h) }];

/** A soft shadow where something stands on a surface. */
function standShadow(px: Px, x: number, y: number, w: number) {
  px.dither(x + 1, y, w - 2, 1, R.ink[1], 0.55);
}

/** A picture on a screen: a sky over two hills and a sun, kept inside the screen. */
function picture(px: Px, x: number, y: number, w: number, h: number) {
  px.vgrad(x, y, w, h, [R.sky[2], R.sky[3], R.sky[4]]);
  const hill = (i: number, c: number, r: number, k: number) => Math.max(0, k * h * (1 - ((i - c * w) / (r * w)) ** 2));
  for (let i = 0; i < w; i++) {
    const near = Math.round(hill(i, 0.3, 0.45, 0.42));
    const far = Math.round(hill(i, 0.78, 0.4, 0.32));
    if (far > near) px.vline(x + i, y + h - far, far - near, R.moss[4]);
    if (near > 0) px.vline(x + i, y + h - near, near, R.moss[3]);
  }
  px.ellipse(x + w * 0.75, y + h * 0.28, 2, 2, R.mustard[5]);
}

// ---------------------------------------------------------------------------------------------
// Television (Glider PRO 92 × 77): a wooden set with rabbit ears.

export const tvKind: KindDef = {
  z: 2,
  paint(px, it) {
    const w = W(it, 115);
    const h = H(it, 82);
    const { x, y } = it;
    const top = y + 14;
    standShadow(px, x, y + h, w);
    // rabbit ears
    px.line(x + w * 0.42, top, x + w * 0.28, y, R.steel[3]);
    px.line(x + w * 0.46, top, x + w * 0.62, y + 1, R.steel[3]);
    px.ellipse(x + w * 0.44, top - 1, 5, 2, R.ink[2]);
    // the cabinet
    px.box(x, top, w, h - 14, 4, R.walnut);
    // the screen: a rounded tube behind a dark bezel
    const sx = x + 8;
    const sy = top + 9;
    const sw = Math.round(w * 0.66);
    const sh = h - 14 - 18;
    px.rect(sx - 2, sy - 2, sw + 4, sh + 4, R.ink[1]);
    if (on(it)) picture(px, sx, sy, sw, sh);
    else px.vgrad(sx, sy, sw, sh, [R.ink[3], R.ink[2], R.ink[1]]);
    px.px(sx, sy, R.ink[1]);
    px.px(sx + sw - 1, sy, R.ink[1]);
    px.px(sx, sy + sh - 1, R.ink[1]);
    px.px(sx + sw - 1, sy + sh - 1, R.ink[1]);
    px.line(sx + 3, sy + 3, sx + 10, sy + 3, R.steel[6]);
    px.line(sx + 3, sy + 4, sx + 5, sy + 4, R.steel[5]);
    // knobs and the speaker grille
    const kx = sx + sw + 8;
    const kw = x + w - 6 - kx;
    for (const ky of [sy + 4, sy + 16]) {
      px.ellipse(kx + kw / 2, ky + 3, 4, 4, R.ink[2]);
      px.ellipse(kx + kw / 2 - 1, ky + 2, 2, 2, R.steel[4]);
    }
    for (let gy = sy + 28; gy < sy + sh; gy += 3) px.hline(kx, gy, kw, R.walnut[1]);
    // little legs
    px.rect(x + 6, y + h - 2, 4, 2, R.ink[2]);
    px.rect(x + w - 10, y + h - 2, 4, 2, R.ink[2]);
  },
  glow(px, it) {
    if (!on(it)) return;
    const w = W(it, 115);
    const h = H(it, 82);
    picture(px, it.x + 8, it.y + 23, Math.round(w * 0.66), h - 32);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 14, w: W(it, 115), h: H(it, 82) - 14 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Compact computer (Glider PRO's Macintosh Plus, 48 × 58): a beige all-in-one with a small screen.

export const computerKind: KindDef = {
  z: 2,
  paint(px, it) {
    const w = W(it, 60);
    const h = H(it, 62);
    const { x, y } = it;
    standShadow(px, x, y + h, w);
    // the case, a little narrower at the top, and its foot
    px.rect(x + 2, y, w - 4, h - 4, R.cream[2]);
    px.rect(x + 3, y + 1, w - 6, h - 6, R.cream[4]);
    px.vline(x + 3, y + 1, h - 6, R.cream[5]);
    px.vline(x + w - 4, y + 1, h - 6, R.cream[3]);
    px.rect(x, y + h - 5, w, 5, R.cream[3]);
    px.hline(x, y + h - 5, w, R.cream[4]);
    // the screen
    const sx = x + 9;
    const sy = y + 6;
    const sw = w - 18;
    const sh = Math.round(h * 0.45);
    px.rect(sx - 2, sy - 2, sw + 4, sh + 4, R.cream[2]);
    if (on(it)) {
      px.rect(sx, sy, sw, sh, R.steel[6]);
      for (let k = 0; k < 4; k++) px.hline(sx + 3, sy + 4 + k * 4, sw - 8 - (k % 2) * 6, R.ink[3]);
    } else px.vgrad(sx, sy, sw, sh, [R.ink[3], R.ink[2]]);
    // the floppy slot and some vents
    px.rect(x + w - 24, y + h - 18, 14, 2, R.ink[2]);
    for (let k = 0; k < 3; k++) px.hline(x + 8, y + h - 16 + k * 3, 10, R.cream[2]);
  },
  glow(px, it) {
    if (!on(it)) return;
    const w = W(it, 60);
    const h = H(it, 62);
    px.rect(it.x + 9, it.y + 6, w - 18, Math.round(h * 0.45), R.steel[5]);
  },
  colliders: (it) => box(it, 60, 62),
};

// ---------------------------------------------------------------------------------------------
// Microwave (Glider PRO 92 × 59): a window in the door and a keypad.

export const microwaveKind: KindDef = {
  z: 2,
  paint(px, it) {
    const w = W(it, 115);
    const h = H(it, 63);
    const { x, y } = it;
    standShadow(px, x, y + h, w);
    px.box(x, y, w, h, 3, R.steel);
    // the door and its window
    const dw = Math.round(w * 0.68);
    px.rect(x + 4, y + 6, dw, h - 11, R.steel[3]);
    px.rect(x + 9, y + 11, dw - 12, h - 21, R.ink[1]);
    px.dither(x + 9, y + 11, dw - 12, h - 21, R.ink[3], 0.35);
    px.ellipse(x + 9 + (dw - 12) / 2, y + h - 13, (dw - 12) / 3, 2, R.steel[2]);
    px.line(x + 12, y + 13, x + 20, y + 13, R.steel[5]);
    px.rect(x + dw - 1, y + 10, 3, h - 19, R.steel[5]);
    // the keypad and the display
    const kx = x + dw + 9;
    const kw = x + w - 6 - kx;
    px.rect(kx, y + 8, kw, 7, R.ink[1]);
    px.hline(kx + 2, y + 11, kw - 4, R.moss[5]);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) px.rect(kx + 1 + c * Math.floor(kw / 3), y + 20 + r * 6, Math.floor(kw / 3) - 2, 4, R.steel[5]);
  },
  glow(px, it) {
    const w = W(it, 115);
    const dw = Math.round(w * 0.68);
    const kx = it.x + dw + 9;
    px.hline(kx + 2, it.y + 11, it.x + w - 6 - kx - 4, R.moss[5]);
  },
  colliders: (it) => box(it, 115, 63),
};

// ---------------------------------------------------------------------------------------------
// Video recorder (Glider PRO 96 × 22): a slim black box with a blinking clock.

export const vcrKind: KindDef = {
  z: 2,
  paint(px, it) {
    const w = W(it, 120);
    const h = H(it, 23);
    const { x, y } = it;
    standShadow(px, x, y + h, w);
    px.rect(x, y, w, h, R.ink[1]);
    px.rect(x + 1, y + 1, w - 2, h - 2, R.ink[2]);
    px.hline(x + 1, y + 1, w - 2, R.ink[4]);
    // the tape slot, the clock and the buttons
    px.rect(x + 8, y + 6, Math.round(w * 0.42), 6, R.ink[0]);
    px.hline(x + 8, y + 12, Math.round(w * 0.42), R.ink[4]);
    px.rect(x + w - 40, y + 5, 22, 8, R.ink[0]);
    paintClock(px, x + w - 38, y + 7);
    for (let k = 0; k < 4; k++) px.rect(x + 8 + k * 9, y + h - 6, 6, 3, R.steel[3]);
    px.rect(x + w - 12, y + 6, 4, 4, R.red[3]);
  },
  glow(px, it) {
    const w = W(it, 120);
    paintClock(px, it.x + w - 38, it.y + 7);
  },
  colliders: (it) => box(it, 120, 23),
};

/** "12:00", forever. */
function paintClock(px: Px, x: number, y: number) {
  const c = R.moss[5];
  const digit = (dx: number, segs: string) => {
    // a three-by-five seven-segment digit
    if (segs.includes('a')) px.hline(x + dx, y, 3, c);
    if (segs.includes('g')) px.hline(x + dx, y + 2, 3, c);
    if (segs.includes('d')) px.hline(x + dx, y + 4, 3, c);
    if (segs.includes('f')) px.vline(x + dx, y, 3, c);
    if (segs.includes('b')) px.vline(x + dx + 2, y, 3, c);
    if (segs.includes('e')) px.vline(x + dx, y + 2, 3, c);
    if (segs.includes('c')) px.vline(x + dx + 2, y + 2, 3, c);
  };
  digit(0, 'bc');
  digit(4, 'abged');
  px.px(x + 8, y + 1, c);
  px.px(x + 8, y + 3, c);
  digit(10, 'abcdef');
  digit(14, 'abcdef');
}

// ---------------------------------------------------------------------------------------------
// Stereo (Glider PRO 128 × 53): a portable cassette player, a speaker either side.

export const stereoKind: KindDef = {
  z: 2,
  paint(px, it) {
    const w = W(it, 160);
    const h = H(it, 56);
    const { x, y } = it;
    standShadow(px, x, y + h, w);
    // the handle
    px.rect(x + w * 0.3, y, w * 0.4, 3, R.ink[2]);
    px.rect(x + w * 0.3, y, 3, 9, R.ink[2]);
    px.rect(x + w * 0.7 - 3, y, 3, 9, R.ink[2]);
    // the body
    const by = y + 8;
    const bh = h - 8;
    px.rect(x, by, w, bh, R.ink[1]);
    px.rect(x + 1, by + 1, w - 2, bh - 2, R.steel[2]);
    px.hline(x + 1, by + 1, w - 2, R.steel[4]);
    // the speakers
    const r = Math.min(bh / 2 - 4, w * 0.13);
    for (const cx of [x + 6 + r, x + w - 6 - r]) {
      px.ellipse(cx, by + bh / 2, r, r, R.ink[1]);
      px.ellipse(cx, by + bh / 2, r - 2, r - 2, R.steel[1]);
      for (let k = 0; k < 3; k++) px.ellipse(cx, by + bh / 2, Math.max(1, r - 4 - k * 4), Math.max(1, r - 4 - k * 4), k % 2 ? R.steel[1] : R.ink[2]);
      px.px(cx - r / 2, by + bh / 2 - r / 2, R.steel[4]);
    }
    // the cassette deck and the dial
    const dx = x + 12 + r * 2;
    const dw = w - 24 - r * 4;
    px.rect(dx, by + 5, dw, 8, R.mustard[4]);
    px.hline(dx + 2, by + 8, dw - 4, R.ink[2]);
    px.rect(dx + 4, by + 17, dw - 8, bh - 23, R.ink[2]);
    px.ellipse(dx + dw / 2 - 8, by + 17 + (bh - 23) / 2, 3, 3, R.steel[4]);
    px.ellipse(dx + dw / 2 + 8, by + 17 + (bh - 23) / 2, 3, 3, R.steel[4]);
    for (let k = 0; k < 5; k++) px.rect(dx + 2 + k * Math.floor(dw / 5), by + bh - 5, Math.floor(dw / 5) - 2, 3, R.steel[4]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y + 8, w: W(it, 160), h: H(it, 56) - 8 }];
  },
};

// ---------------------------------------------------------------------------------------------
// Coffee maker (Glider PRO 43 × 64): a filter on top, a glass jug on the hot plate.

export const coffeeKind: KindDef = {
  z: 2,
  paint(px, it) {
    const w = W(it, 54);
    const h = H(it, 68);
    const { x, y } = it;
    standShadow(px, x, y + h, w);
    // the tower at the back, the head over the jug, and the base
    px.rect(x + w - 16, y, 16, h, R.ink[1]);
    px.rect(x + w - 15, y + 1, 14, h - 2, R.ink[3]);
    px.vline(x + w - 15, y + 1, h - 2, R.ink[4]);
    px.rect(x + 2, y, w - 2, 14, R.ink[2]);
    px.hline(x + 2, y, w - 2, R.ink[4]);
    px.rect(x + 6, y + 14, w - 26, 3, R.ink[2]);
    px.rect(x, y + h - 7, w, 7, R.ink[2]);
    px.hline(x, y + h - 7, w, R.ink[4]);
    px.rect(x + w - 12, y + h - 5, 3, 2, R.red[4]);
    // the jug: glass with coffee in it
    const jx = x + 5;
    const jy = y + 22;
    const jw = w - 24;
    const jh = h - 29;
    px.rect(jx, jy, jw, jh, R.steel[5]);
    px.rect(jx + 1, jy + Math.round(jh * 0.45), jw - 2, jh - Math.round(jh * 0.45), R.walnut[2]);
    px.hline(jx + 1, jy + Math.round(jh * 0.45), jw - 2, R.walnut[4]);
    px.vline(jx + 2, jy + 2, jh - 4, R.steel[6]);
    px.rect(jx - 4, jy + 6, 4, 2, R.ink[2]);
    px.rect(jx - 4, jy + 6, 2, jh - 12, R.ink[2]);
    px.rect(jx + jw, jy - 2, 3, 3, R.ink[2]);
  },
  colliders: (it) => box(it, 54, 68),
};

// ---------------------------------------------------------------------------------------------
// A tower of CDs (Glider PRO 16 × 30).

export const cdsKind: KindDef = {
  z: 2,
  paint(px, it) {
    const w = W(it, 20);
    const h = H(it, 32);
    const { x, y } = it;
    standShadow(px, x, y + h, w);
    px.rect(x, y, w, h, R.ink[2]);
    const cols = [R.red[4], R.navy[5], R.mustard[5], R.moss[5], R.plum[4], R.steel[5], R.teal[5], R.rose[4]];
    for (let k = 0, cy = y + 2; cy < y + h - 3; k++, cy += 3) {
      px.hline(x + 2, cy, w - 4, cols[(k * 5 + it.x) % cols.length]);
      px.hline(x + 2, cy + 1, w - 4, R.ink[1]);
    }
    px.rect(x, y + h - 2, w, 2, R.ink[1]);
  },
  colliders: (it) => box(it, 20, 32),
};
