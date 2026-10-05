/**
 * Room shell painter: ceiling, wallpaper, trim, wainscot, floor, side walls and openings.
 * Front-on view like Glider PRO, with a sliver of floor in perspective.
 */

import { Px } from '../pixel';
import { R, type Ramp } from '../palette';
import { LAYOUT, type RoomDef, type WallStyle } from '../../world/types';

const W = 640;
const H = 360;

function ramp(name: keyof typeof R): Ramp {
  return R[name];
}

export function paintWallpaper(px: Px, x0: number, y0: number, w: number, h: number, st: WallStyle): void {
  const b = ramp(st.base);
  const a = ramp(st.accent);
  const bg = b[b.length - 2];
  px.rect(x0, y0, w, h, bg);
  const x1 = x0 + w;
  const y1 = y0 + h;
  switch (st.pattern) {
    case 'stripes': {
      for (let x = x0; x < x1; x += 24) {
        px.rect(x, y0, 10, h, b[b.length - 3]);
        px.vline(x + 10, y0, h, a[a.length - 2]);
      }
      break;
    }
    case 'pinstripe': {
      for (let x = x0 + 4; x < x1; x += 12) px.dither(x, y0, 1, h, a[a.length - 3], 0.75);
      break;
    }
    case 'dots': {
      for (let y = y0 + 6, r = 0; y < y1; y += 14, r++)
        for (let x = x0 + (r % 2 ? 10 : 3); x < x1; x += 14) {
          px.rect(x, y, 2, 2, a[a.length - 3]);
          px.px(x, y, a[a.length - 2]);
        }
      break;
    }
    case 'planes': {
      // tiny folded paper planes scattered on the wallpaper
      for (let y = y0 + 10, r = 0; y < y1 - 6; y += 30, r++)
        for (let x = x0 + (r % 2 ? 22 : 6); x < x1 - 8; x += 34) {
          const c = a[a.length - 2];
          const d = a[a.length - 4];
          px.hline(x, y + 3, 7, c);
          px.hline(x + 2, y + 2, 4, c);
          px.hline(x + 4, y + 1, 2, c);
          px.hline(x + 1, y + 4, 4, d);
          px.px(x + 7, y + 3, c);
        }
      break;
    }
    case 'damask': {
      for (let y = y0 + 4, r = 0; y < y1; y += 26, r++)
        for (let x = x0 + (r % 2 ? 16 : 0); x < x1; x += 32) {
          const c = a[a.length - 3];
          px.px(x + 8, y, c);
          px.hline(x + 7, y + 1, 3, c);
          px.hline(x + 5, y + 3, 7, c);
          px.hline(x + 4, y + 4, 2, c);
          px.hline(x + 11, y + 4, 2, c);
          px.hline(x + 6, y + 5, 5, c);
          px.hline(x + 7, y + 7, 3, c);
          px.px(x + 8, y + 9, c);
          px.px(x + 8, y + 11, c);
          px.dither(x + 2, y + 13, 13, 1, c, 0.5);
        }
      break;
    }
    case 'plaid': {
      for (let x = x0; x < x1; x += 28) px.dither(x, y0, 8, h, a[a.length - 3], 0.5);
      for (let y = y0; y < y1; y += 28) px.dither(x0, y, w, 8, a[a.length - 3], 0.5);
      for (let x = x0 + 18; x < x1; x += 28) px.vline(x, y0, h, a[a.length - 2]);
      break;
    }
    case 'floral': {
      for (let y = y0 + 8, r = 0; y < y1; y += 22, r++)
        for (let x = x0 + (r % 2 ? 14 : 2); x < x1; x += 26) {
          const petal = a[a.length - 3];
          const ctr = R.mustard[4];
          px.px(x + 2, y, petal);
          px.px(x, y + 2, petal);
          px.px(x + 4, y + 2, petal);
          px.px(x + 2, y + 4, petal);
          px.px(x + 1, y + 1, petal);
          px.px(x + 3, y + 3, petal);
          px.px(x + 3, y + 1, petal);
          px.px(x + 1, y + 3, petal);
          px.px(x + 2, y + 2, ctr);
          px.px(x + 6, y + 6, R.leaf[3]);
          px.px(x + 7, y + 5, R.leaf[4]);
        }
      break;
    }
    case 'diamonds': {
      for (let y = y0, r = 0; y < y1; y += 12, r++)
        for (let x = x0 + (r % 2 ? 8 : 0); x < x1; x += 16) {
          px.px(x + 8, y + 2, a[a.length - 3]);
          px.hline(x + 7, y + 3, 3, a[a.length - 3]);
          px.px(x + 8, y + 4, a[a.length - 3]);
        }
      break;
    }
    case 'tile': {
      const t = 16;
      for (let y = y0; y < y1; y += t)
        for (let x = x0; x < x1; x += t) {
          px.rect(x, y, t, t, b[b.length - 1]);
          px.hline(x, y + t - 1, t, b[b.length - 3]);
          px.vline(x + t - 1, y, t, b[b.length - 3]);
          px.px(x + 2, y + 2, '#ffffff');
        }
      break;
    }
    case 'brick': {
      const bh = 10;
      for (let y = y0, r = 0; y < y1; y += bh, r++) {
        px.hline(x0, y + bh - 1, w, b[1]);
        for (let x = x0 + (r % 2 ? 12 : 0); x < x1; x += 24) {
          px.vline(x, y, bh - 1, b[1]);
          px.dither(x + 1, y, 22, bh - 1, b[b.length - 3], 0.2 + px.rand() * 0.3);
        }
      }
      break;
    }
    case 'boards': {
      for (let x = x0; x < x1; x += 20) {
        px.vline(x, y0, h, b[1]);
        px.vline(x + 1, y0, h, b[b.length - 1]);
        for (let k = 0; k < 6; k++) px.vline(x + 4 + px.ri(0, 13), y0 + px.ri(0, h - 20), px.ri(6, 20), b[b.length - 3]);
      }
      break;
    }
    default:
      px.speckle(x0, y0, w, h, [b[b.length - 3]], 0.01);
  }
}

function paintTrimRail(px: Px, y: number, h: number, t: Ramp): void {
  px.rect(0, y, W, h, t[t.length - 2]);
  px.hline(0, y, W, t[t.length - 1]);
  px.hline(0, y + h - 2, W, t[t.length - 3]);
  px.hline(0, y + h - 1, W, t[t.length - 4]);
}

function paintWainscot(px: Px, y0: number, y1: number, wr: Ramp): void {
  px.rect(0, y0, W, y1 - y0, wr[wr.length - 2]);
  const panelW = 76;
  for (let x = 6; x < W - 10; x += panelW + 8) {
    const pw = Math.min(panelW, W - 6 - x);
    if (pw < 20) break;
    const py = y0 + 10;
    const ph = y1 - y0 - 20;
    px.rect(x, py, pw, ph, wr[wr.length - 3]);
    px.hline(x, py, pw, wr[wr.length - 4]);
    px.vline(x, py, ph, wr[wr.length - 4]);
    px.hline(x + 1, py + ph - 1, pw - 1, wr[wr.length - 1]);
    px.vline(x + pw - 1, py + 1, ph - 1, wr[wr.length - 1]);
    px.rect(x + 3, py + 3, pw - 6, ph - 6, wr[wr.length - 2]);
  }
}

function paintFloor(px: Px, room: RoomDef): void {
  const f = room.floor;
  const r = ramp(f.ramp);
  const y0 = LAYOUT.wallBase;
  // perspective rows: narrow at the back, wider at the front
  const rows: number[] = [y0];
  let y = y0;
  let step = 4;
  while (y < H) {
    y += step;
    rows.push(Math.min(H, y));
    step += 1.6;
  }
  if (f.kind === 'planks') {
    for (let i = 0; i < rows.length - 1; i++) {
      const ya = Math.round(rows[i]);
      const yb = Math.round(rows[i + 1]);
      const shadeI = Math.min(r.length - 2, 2 + Math.floor((i / rows.length) * 3));
      px.rect(0, ya, W, yb - ya, r[shadeI]);
      px.hline(0, ya, W, r[Math.max(0, shadeI - 2)]);
      if (yb - ya > 3) px.hline(0, ya + 1, W, r[Math.min(r.length - 1, shadeI + 1)]);
      // staggered joints
      let jx = -((i * 97) % 150);
      while (jx < W) {
        px.vline(jx, ya, yb - ya, r[Math.max(0, shadeI - 2)]);
        px.vline(jx + 1, ya, yb - ya, r[Math.min(r.length - 1, shadeI + 1)]);
        jx += 96 + ((i * 53 + Math.floor(jx)) % 90);
      }
      // grain
      px.speckle(0, ya + 1, W, Math.max(1, yb - ya - 1), [r[Math.max(0, shadeI - 1)]], 0.02);
    }
  } else if (f.kind === 'carpet') {
    px.vgrad(0, y0, W, H - y0, [r[2], r[3], r[3], r[4]]);
    px.speckle(0, y0, W, H - y0, [r[2], r[4]], 0.08);
  } else if (f.kind === 'tiles' || f.kind === 'checker' || f.kind === 'stone') {
    const a = ramp(f.accent ?? f.ramp);
    for (let i = 0; i < rows.length - 1; i++) {
      const ya = Math.round(rows[i]);
      const yb = Math.round(rows[i + 1]);
      const tw = 18 + i * 6;
      for (let x = -((i * tw) / 2) % tw, k = 0; x < W; x += tw, k++) {
        const odd = (k + i) % 2 === 1;
        const col = f.kind === 'checker' ? (odd ? a[a.length - 2] : r[r.length - 2]) : r[r.length - 2 - (odd ? 1 : 0)];
        px.rect(x, ya, tw, yb - ya, col);
        px.vline(x, ya, yb - ya, r[1]);
      }
      px.hline(0, ya, W, r[1]);
      if (f.kind === 'stone') px.speckle(0, ya, W, yb - ya, [r[2], r[3]], 0.05);
    }
  }
  // depth shading: darker at the back of the floor
  px.dither(0, y0, W, 6, R.ink[1], 0.45);
  px.dither(0, y0 + 6, W, 6, R.ink[1], 0.2);
}

function paintSideWalls(px: Px, room: RoomDef, wallTop: number): void {
  const sw = LAYOUT.sideWall;
  const b = ramp(room.wall.base);
  const t = ramp(room.wall.trim);
  for (const side of ['left', 'right'] as const) {
    const ex = room.exits[side];
    const left = side === 'left';
    const x0 = left ? 0 : W - sw;
    const wallCol = b[Math.max(0, b.length - 4)];
    const inner = left ? sw - 1 : W - sw; // edge towards the room
    // side wall seen edge-on, in shadow
    px.rect(x0, wallTop - 2, sw, H - wallTop + 2, wallCol);
    px.dither(x0, wallTop - 2, sw, H - wallTop + 2, R.ink[1], 0.5);
    if (ex) {
      // doorway: a dark opening framed by a casing
      const top = Math.max(wallTop, ex.from);
      const bot = Math.min(H, ex.to);
      px.vgrad(x0, top, sw, bot - top, [R.ink[1], R.ink[2], R.ink[3]]);
      const cx = left ? sw - 4 : W - sw;
      px.rect(cx, top - 6, 4, bot - top + 6, t[t.length - 2]);
      px.vline(left ? cx + 3 : cx, top - 6, bot - top + 6, t[t.length - 4]);
      px.vline(left ? cx : cx + 3, top - 6, bot - top + 6, t[t.length - 1]);
      px.rect(x0, top - 6, sw, 4, t[t.length - 2]);
      px.hline(x0, top - 6, sw, t[t.length - 1]);
    }
    px.vline(inner, wallTop - 2, (ex ? Math.max(wallTop, ex.from) - 6 : H) - wallTop + 2, b[1]);
  }
}

function paintCeiling(px: Px, room: RoomDef): void {
  const c = LAYOUT.ceiling;
  const t = ramp(room.wall.trim);
  const b = ramp(room.wall.base);
  // ceiling underside: a calm band, darker towards the top edge
  px.rect(0, 0, W, c, b[Math.max(0, b.length - 4)]);
  px.dither(0, 0, W, 4, R.ink[2], 0.5);
  px.dither(0, 4, W, 4, R.ink[2], 0.2);
  // crown moulding: highlight, body, cove shadow
  px.rect(0, c - 5, W, 7, t[t.length - 2]);
  px.hline(0, c - 5, W, t[t.length - 1]);
  px.hline(0, c - 2, W, t[t.length - 3]);
  px.hline(0, c + 1, W, t[t.length - 4]);
  for (let x = 3; x < W; x += 6) px.px(x, c - 3, t[t.length - 3]);
  // opening in the ceiling
  const up = room.exits.up;
  if (up) {
    px.rect(up.from, 0, up.to - up.from, c + 2, R.ink[1]);
    px.vgrad(up.from + 2, 0, up.to - up.from - 4, c, [R.ink[0], R.ink[2]]);
    px.vline(up.from, 0, c + 2, t[t.length - 2]);
    px.vline(up.to - 1, 0, c + 2, t[t.length - 4]);
  }
}

function paintFloorOpening(px: Px, room: RoomDef): void {
  const dn = room.exits.down;
  if (!dn) return;
  const y0 = LAYOUT.wallBase;
  // a stairwell / hole down: dark pit with a railing post at each side
  px.rect(dn.from, y0 + 4, dn.to - dn.from, H - y0 - 4, R.ink[0]);
  px.vgrad(dn.from + 2, y0 + 4, dn.to - dn.from - 4, H - y0 - 4, [R.ink[2], R.ink[0]]);
  const t = ramp(room.wall.trim);
  px.rect(dn.from - 3, y0 - 30, 4, H - y0 + 30, t[t.length - 3]);
  px.rect(dn.to - 1, y0 - 30, 4, H - y0 + 30, t[t.length - 3]);
  px.hline(dn.from - 3, y0 - 30, dn.to - dn.from + 7, t[t.length - 1]);
  px.rect(dn.from - 3, y0 - 30, dn.to - dn.from + 7, 3, t[t.length - 2]);
  for (let x = dn.from + 6; x < dn.to - 4; x += 10) px.vline(x, y0 - 27, 26, t[t.length - 3]);
}

/** Paint the static room shell (no items). */
export function paintRoomShell(px: Px, room: RoomDef): void {
  const st = room.wall;
  const top = LAYOUT.ceiling + 2;
  const wainTop = st.wainscot ? LAYOUT.dado : LAYOUT.baseboard;
  paintWallpaper(px, 0, top, W, wainTop - top, st);
  // soft shadow under the crown moulding
  px.dither(0, top, W, 6, R.ink[1], 0.35);
  px.dither(0, top + 6, W, 8, R.ink[1], 0.15);
  if (st.wainscot) {
    paintTrimRail(px, LAYOUT.dado - 2, 7, ramp(st.trim));
    paintWainscot(px, LAYOUT.dado + 5, LAYOUT.baseboard, ramp(st.wainscot));
  }
  // baseboard
  const t = ramp(st.trim);
  px.rect(0, LAYOUT.baseboard, W, LAYOUT.wallBase - LAYOUT.baseboard, t[t.length - 2]);
  px.hline(0, LAYOUT.baseboard, W, t[t.length - 1]);
  px.hline(0, LAYOUT.baseboard + 1, W, t[t.length - 3]);
  px.hline(0, LAYOUT.wallBase - 1, W, t[t.length - 4]);
  paintFloor(px, room);
  paintCeiling(px, room);
  paintFloorOpening(px, room);
  paintSideWalls(px, room, top);
}
