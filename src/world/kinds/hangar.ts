/** Test Hangar kit: girders, hangar windows, distance markers, launcher, bay signs, wall blocks, targets, hoops. */

import { R } from '../../render/palette';
import { pixelText, pixelTextWidth } from '../../render/pixelFont';
import { LAYOUT } from '../types';
import type { KindDef } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

export const girderKind: KindDef = {
  z: 0,
  paint(px, it) {
    const y = it.y;
    const c = R.navy;
    px.rect(0, y, 640, 4, c[3]);
    px.rect(0, y + 14, 640, 4, c[3]);
    px.hline(0, y, 640, c[5]);
    px.hline(0, y + 17, 640, c[1]);
    for (let x = 0; x < 640; x += 28) {
      px.line(x, y + 4, x + 14, y + 14, c[2]);
      px.line(x + 14, y + 4, x + 28, y + 14, c[2]);
    }
    px.dither(0, y + 18, 640, 3, R.ink[1], 0.4);
  },
  colliders(it) {
    return [{ x: 0, y: it.y, w: 640, h: 18 }];
  },
};

export const hangarWindowKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = it.w ?? 200;
    const h = it.h ?? 70;
    const { x, y } = it;
    px.rect(x - 3, y - 3, w + 6, h + 6, R.steel[2]);
    px.vgrad(x, y, w, h, [R.sky[2], R.sky[3], R.sky[4]]);
    for (let k = 1; k < 5; k++) px.vline(x + Math.round((w * k) / 5), y, h, R.steel[3]);
    px.hline(x, y + Math.round(h / 2), w, R.steel[3]);
    px.line(x + 10, y + h - 8, x + 30, y + 8, '#ffffff');
    px.ellipse(x + w * 0.7, y + 18, 10, 3, '#ffffff');
  },
  glow(px, it) {
    px.rect(it.x, it.y, it.w ?? 200, it.h ?? 70, '#cfe2f4');
  },
  lights(it) {
    return [{ x: it.x + (it.w ?? 200) / 2, y: it.y + 80, r: 240, color: '#dfeeff', intensity: 0.4 }];
  },
};

/** Floor distance markers every metre (128 px), numbered from the launch line. */
export const markersKind: KindDef = {
  z: 0,
  paint(px, it) {
    const startM = num(it.startM, 0);
    const y0 = LAYOUT.wallBase + 6;
    for (let k = 0; k < 6; k++) {
      const x = Math.round(k * 128 - (num(it.offset, 0) % 128));
      if (x < 0 || x > 640) continue;
      const m = startM + k;
      px.line(x, y0, x - 6, 358, '#f4efe2');
      px.line(x + 1, y0, x - 5, 358, '#f4efe2');
      const label = `${m}M`;
      pixelText(px, x + 4, 344, label, '#f4efe2', 2);
    }
  },
};

export const baySignKind: KindDef = {
  z: 0,
  paint(px, it) {
    const label = String(it.label ?? 'BAY');
    const w = pixelTextWidth(label, 2) + 12;
    px.rect(it.x, it.y, w, 18, R.mustard[4]);
    px.frame(it.x, it.y, w, 18, R.ink[1]);
    pixelText(px, it.x + 6, it.y + 4, label, R.ink[1], 2);
  },
};

export const hazardStripeKind: KindDef = {
  z: 0,
  paint(px) {
    const y = LAYOUT.baseboard;
    for (let x = 0; x < 640; x += 16) {
      px.poly([[x, y], [x + 8, y], [x + 18, y + 10], [x + 10, y + 10]], R.mustard[4]);
      px.poly([[x + 8, y], [x + 16, y], [x + 26, y + 10], [x + 18, y + 10]], R.ink[1]);
    }
  },
};

export const launcherKind: KindDef = {
  z: 1,
  paint(px, it) {
    const { x, y } = it; // platform top-left; platform 70 wide, legs to the floor
    const floor = LAYOUT.floor;
    px.rect(x + 6, y + 8, 6, floor - y - 8, R.steel[3]);
    px.rect(x + 58, y + 8, 6, floor - y - 8, R.steel[3]);
    for (let yy = y + 20; yy < floor - 10; yy += 26) {
      px.line(x + 12, yy, x + 58, yy + 20, R.steel[2]);
      px.line(x + 58, yy, x + 12, yy + 20, R.steel[2]);
    }
    px.box(x, y, 70, 10, 5, R.steel);
    px.rect(x + 4, y - 2, 62, 3, R.mustard[4]);
    for (let k = 0; k < 62; k += 8) px.rect(x + 4 + k, y - 2, 4, 3, R.ink[1]);
  },
  colliders(it) {
    return [
      { x: it.x, y: it.y, w: 70, h: 10 },
      { x: it.x + 6, y: it.y + 10, w: 6, h: LAYOUT.floor - it.y - 10 },
      { x: it.x + 58, y: it.y + 10, w: 6, h: LAYOUT.floor - it.y - 10 },
    ];
  },
};

/** A plain wall block (sandbox builder). */
export const blockKind: KindDef = {
  z: 1,
  paint(px, it) {
    const w = it.w ?? 40;
    const h = it.h ?? 80;
    px.box(it.x, it.y, w, h, 5, R.oak);
    for (let k = 10; k < h - 4; k += 14) px.hline(it.x + 3, it.y + k, w - 6, R.oak[2]);
  },
  colliders(it) {
    return [{ x: it.x, y: it.y, w: it.w ?? 40, h: it.h ?? 80 }];
  },
};

/** Landing target mat on the floor (sandbox / challenges). */
export const targetMatKind: KindDef = {
  z: 0,
  paint(px, it) {
    const w = it.w ?? 90;
    const cx = it.x + w / 2;
    const cy = LAYOUT.floor - 2;
    px.ellipse(cx, cy, w / 2, 7, R.red[3]);
    px.ellipse(cx, cy, w / 2 - 10, 5, '#f4efe2');
    px.ellipse(cx, cy, w / 2 - 20, 3, R.red[3]);
    px.ellipse(cx, cy, 6, 2, '#f4efe2');
  },
};

/** A paper hoop to fly through (sandbox / challenges). Pure decoration here; logic in objects. */
export const hoopKind: KindDef = {
  z: 3,
  paint(px, it) {
    const r = num(it.r, 26);
    const cx = it.x;
    const cy = it.y;
    for (let a = 0; a < Math.PI * 2; a += 0.04) {
      const x = cx + Math.cos(a) * 6;
      const y = cy + Math.sin(a) * r;
      px.px(x, y, a > Math.PI / 2 && a < (Math.PI * 3) / 2 ? R.red[2] : R.red[4]);
      px.px(x + 1, y, R.red[3]);
    }
  },
};
