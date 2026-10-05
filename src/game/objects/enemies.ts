/**
 * Glider PRO's menagerie, for the Classic Houses: balloons rising from the floor, toy helicopters and paper darts
 * crossing the room, a bouncing ball, a goldfish leaping out of its bowl, cobwebs, sparking outlets and a paper
 * shredder. Speeds and timings follow Glider PRO (Sources/Dynamics*.c: 30 frames a second) scaled to Gliderama rooms.
 * Things that move come and go in a twinkle, as they did there. Touching one crumples the plane (a second knock is
 * usually the end of it), and a rubber band brings a balloon, a helicopter or a dart down.
 *
 * Item fields: `x`, `y` (room px), `dir` (+1 = to the right), `delay` (s between appearances), `height` (px a ball
 * bounces or a fish leaps), `v` (colourway), `group` (a switch group that turns it on and off).
 */

import * as THREE from 'three';
import { R, type Ramp } from '../../render/palette';
import { Px } from '../../render/pixel';
import { rgb } from '../../render/particles';
import { BOWL, SHREDDER } from '../../world/gliderpro';
import { LAYOUT, type ItemDef, type Rect } from '../../world/types';
import type { Gfx, ObjCtx, ObjFactory } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

/** px/s and px/s² (Glider PRO: balloons and helicopters 2 px a frame, darts 6, things falling 8, gravity 1/2 px per frame²). */
const RISE = 64;
const DRIFT = 37;
const DART = 225;
const DROP = 256;
const G = 480;

const FLOOR = LAYOUT.floor;
const CEILING = LAYOUT.ceiling + 2;

/** A switch group can turn a thing on and off; without one it is always on. */
const isOn = (def: ItemDef, ctx: ObjCtx) => (typeof def.group === 'string' ? ctx.api.switchOn(def.group) : def.on !== false);

/** A sprite repainted only when what it shows changes. */
function spriteOf(gfx: Gfx | null, w: number, h: number, emissive = 0, z = 8) {
  const s = gfx?.createSprite(w, h, emissive, z) ?? null;
  const px = s ? new Px(s.canvas, 7) : null;
  let key = '';
  s?.set(0, 0, false);
  return {
    show(k: string, paint: (px: Px) => void, x: number, y: number) {
      if (!s || !px) return;
      if (k !== key) {
        key = k;
        px.ctx.clearRect(0, 0, w, h);
        paint(px);
        s.refresh();
      }
      s.set(x, y, true);
    },
    hide() {
      s?.set(0, 0, false);
    },
    dispose() {
      s?.dispose();
    },
  };
}

/** The twinkle a thing appears and vanishes in. */
function twinkle(ctx: ObjCtx, x: number, y: number) {
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const v = 40 + (k % 3) * 18;
    ctx.particles.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.45, max: 0.45, ...rgb(k % 2 ? '#fff4b8' : '#bfe8ff'), a: 1 });
  }
  ctx.api.sfx('sparkle', { vol: 0.5 });
}

function bits(ctx: ObjCtx, x: number, y: number, cols: readonly string[], n: number, grav = 300) {
  for (let k = 0; k < n; k++)
    ctx.particles.spawn({ x, y, vx: (Math.random() - 0.5) * 140, vy: (Math.random() - 0.7) * 120, grav, life: 0.6, max: 0.6, ...rgb(cols[k % cols.length]), a: 1 });
}

const inRect = (r: Rect, x: number, y: number, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

// ---------------------------------------------------------------------------------------------
// Balloon: rises from the floor to the ceiling and vanishes there; back after `delay`.

const BALLOONS: readonly Ramp[] = [R.red, R.mustard, R.navy, R.plum, R.moss];

function paintBalloon(px: Px, ramp: Ramp, wiggle: number, popped: boolean) {
  const cx = 13;
  if (popped) {
    // the burst rubber, falling with its knot and string
    px.poly([[cx - 7, 22], [cx - 3, 14], [cx, 19], [cx + 4, 13], [cx + 7, 23], [cx, 27]], ramp[2]);
    px.poly([[cx - 4, 22], [cx - 2, 17], [cx + 1, 21], [cx + 4, 17], [cx + 5, 23], [cx, 25]], ramp[3]);
    px.px(cx - 2, 18, ramp[4]);
  } else {
    // the body, a little narrower at the knot
    px.sphere(cx, 15, 11, 14, ramp);
    px.ellipse(cx, 26, 5, 3, ramp[2]);
    px.ellipse(cx, 25, 4, 2, ramp[3]);
  }
  // the knot and the string
  px.poly([[cx - 2, 29], [cx + 2, 29], [cx, 32]], ramp[2]);
  px.hline(cx - 1, 32, 3, ramp[1]);
  for (let j = 0; j < 13; j++) {
    const f = j / 13;
    px.px(cx + Math.round(Math.sin(f * Math.PI * 2 + wiggle) * 1.6 * f), 33 + j, j % 4 === 3 ? R.stone[3] : R.stone[4]);
  }
}

export const balloon: ObjFactory = (def, id, gfx) => {
  const W = 26;
  const H = 46;
  const ramp = BALLOONS[(def.v ?? 0) % BALLOONS.length];
  const delay = Math.max(0.3, num(def.delay, 2));
  const sp = spriteOf(gfx, W, H);
  let state: 'wait' | 'rise' | 'drop' = 'wait';
  let timer = delay;
  let y = FLOOR - H;
  let t = Math.random() * 6;
  const sway = () => (state === 'rise' ? Math.round(Math.sin(t * 1.7) * 2.5) : 0);
  const body = (): Rect => ({ x: def.x + sway() + 2, y: y + 1, w: W - 4, h: 30 });
  const vanish = (ctx: ObjCtx) => {
    twinkle(ctx, def.x + W / 2, y + 15);
    state = 'wait';
    timer = delay;
    sp.hide();
  };
  const pop = (ctx: ObjCtx) => {
    ctx.api.sfx('pop');
    bits(ctx, def.x + W / 2, y + 15, [ramp[2], ramp[3], ramp[4]], 10);
  };
  return {
    id,
    def,
    hazard: true,
    update(ctx) {
      t += ctx.dt;
      if (state === 'wait') {
        if (!isOn(def, ctx)) return;
        timer -= ctx.dt;
        if (timer > 0) return;
        state = 'rise';
        y = FLOOR - H;
        twinkle(ctx, def.x + W / 2, y + 15);
      } else if (state === 'rise') {
        y -= RISE * ctx.dt;
        if (y <= CEILING) return vanish(ctx);
      } else {
        y += DROP * ctx.dt;
        if (y + 30 >= FLOOR) return vanish(ctx);
      }
      const wiggle = Math.floor(t * 5) % 4;
      sp.show(`${state}${wiggle}`, (px) => paintBalloon(px, ramp, (wiggle * Math.PI) / 2, state === 'drop'), def.x + sway(), y);
    },
    trigger() {
      return state === 'rise' ? body() : null;
    },
    onTouch(ctx) {
      // the plane bursts it, and is knocked about by the bang
      const b = body();
      ctx.api.strike(0.5, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
      pop(ctx);
      state = 'wait';
      timer = delay;
      sp.hide();
    },
    shot(x, y0, ctx) {
      if (state !== 'rise' || !inRect(body(), x, y0, 3)) return false;
      state = 'drop';
      pop(ctx);
      return true;
    },
    dispose() {
      sp.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Toy helicopter: from the ceiling down across the room on a slant; back at the top after `delay`.

function paintCopter(px: Px, dir: 1 | -1, rotor: number, tail: number, shot: boolean) {
  const X = (dx: number) => (dir > 0 ? dx : 39 - dx);
  const body = R.red;
  // skids and struts
  px.hline(Math.min(X(11), X(30)), 29, 20, R.steel[2]);
  px.px(X(dir > 0 ? 31 : 31), 28, R.steel[2]);
  px.vline(X(15), 25, 4, R.steel[3]);
  px.vline(X(26), 25, 4, R.steel[3]);
  // tail boom, fin and tail rotor (behind the cabin)
  px.rect(Math.min(X(2), X(14)), 15, 13, 3, body[3]);
  px.hline(Math.min(X(2), X(14)), 17, 13, body[1]);
  px.poly([[X(1), 17], [X(3), 9], [X(6), 9], [X(6), 17]], R.mustard[3]);
  px.vline(X(3), 10, 6, R.mustard[4]);
  if (tail) px.vline(X(4), 6, 9, R.steel[4]);
  else px.hline(Math.min(X(0), X(8)), 10, 9, R.steel[4]);
  // the cabin, its bubble window and a stripe
  px.ellipse(X(24), 19, 10, 7, body[1]);
  px.ellipse(X(24), 19, 9, 6, body[3]);
  px.ellipse(X(23), 17, 7, 3, body[4]);
  px.hline(Math.min(X(16), X(33)), 22, 18, R.mustard[4]);
  px.ellipse(X(29), 16, 4, 4, R.sky[2]);
  px.ellipse(X(29), 16, 3, 3, R.sky[3]);
  px.px(X(28), 14, R.sky[5]);
  px.px(X(27), 15, R.sky[4]);
  // the mast and the main rotor, a blur of three lengths
  px.vline(X(23), 7, 5, R.steel[2]);
  px.rect(Math.min(X(21), X(25)), 6, 5, 2, R.steel[1]);
  const half = shot ? [4, 4, 4][rotor] : [19, 13, 6][rotor];
  px.hline(X(23) - half, 5, half * 2 + 1, R.steel[4]);
  px.hline(X(23) - half + 2, 4, half * 2 - 3, R.steel[5]);
  if (!shot && rotor > 0) px.dither(X(23) - 19, 4, 39, 2, R.steel[5], 0.25);
}

export const copter: ObjFactory = (def, id, gfx) => {
  const W = 40;
  const H = 32;
  const dir: 1 | -1 = num(def.dir, -1) >= 0 ? 1 : -1;
  const delay = Math.max(0.3, num(def.delay, 2));
  const sp = spriteOf(gfx, W, H);
  let state: 'wait' | 'fly' | 'drop' = 'wait';
  let timer = delay;
  let x = def.x;
  let y = CEILING;
  let t = 0;
  const body = (): Rect => ({ x: x + 5, y: y + 8, w: W - 10, h: H - 11 });
  const vanish = (ctx: ObjCtx) => {
    twinkle(ctx, x + W / 2, y + H / 2);
    state = 'wait';
    timer = delay;
    sp.hide();
  };
  return {
    id,
    def,
    hazard: true,
    update(ctx) {
      t += ctx.dt;
      if (state === 'wait') {
        if (!isOn(def, ctx)) return;
        timer -= ctx.dt;
        if (timer > 0) return;
        state = 'fly';
        x = def.x;
        y = CEILING;
        twinkle(ctx, x + W / 2, y + H / 2);
      } else if (state === 'fly') {
        x += dir * DRIFT * ctx.dt;
        y += RISE * ctx.dt;
        if (y + H >= FLOOR - 2 || x + W < 0 || x > 640) return vanish(ctx);
      } else {
        y += DROP * ctx.dt;
        if (y + H >= FLOOR) {
          ctx.api.sfx('crumple', { vol: 0.4 });
          return vanish(ctx);
        }
      }
      const rotor = Math.floor(t * 24) % 3;
      const tail = Math.floor(t * 18) % 2;
      sp.show(`${state}${rotor}${tail}`, (px) => paintCopter(px, dir, rotor, tail, state === 'drop'), x, y);
    },
    trigger() {
      return state === 'fly' ? body() : null;
    },
    onTouch(ctx) {
      const b = body();
      ctx.api.strike(0.55, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
      ctx.api.sfx('bump', { vol: 0.6, pitch: 5 });
      bits(ctx, b.x + b.w / 2, b.y + b.h / 2, [R.red[3], R.mustard[4], R.steel[4]], 6);
      vanish(ctx);
    },
    shot(bx, by, ctx) {
      if (state !== 'fly' || !inRect(body(), bx, by, 3)) return false;
      state = 'drop';
      ctx.api.sfx('bump', { vol: 0.4, pitch: 7 });
      return true;
    },
    dispose() {
      sp.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Paper dart: someone else's, sailing in from one wall to the other, sinking a little; again after `delay`.

function paintDart(px: Px, dir: 1 | -1, crumpled: boolean) {
  const X = (dx: number) => (dir > 0 ? dx : 77 - dx);
  if (crumpled) {
    px.ellipse(X(38), 11, 9, 7, R.cream[2]);
    px.ellipse(X(37), 10, 8, 6, R.cream[4]);
    px.line(X(32), 7, X(41), 13, R.cream[2]);
    px.line(X(34), 14, X(42), 8, R.cream[3]);
    px.hline(Math.min(X(31), X(43)), 10, 12, R.navy[5]);
    return;
  }
  // the near wing (lit) above the fold and the keel below it, nose to the right
  const nose: [number, number] = [X(77), 9];
  px.poly([nose, [X(1), 2], [X(4), 9]], R.cream[1]);
  px.poly([nose, [X(2), 3], [X(5), 9]], R.cream[5]);
  px.poly([nose, [X(4), 9], [X(9), 17]], R.cream[1]);
  px.poly([nose, [X(5), 9], [X(9), 16]], R.cream[3]);
  // notebook paper: a blue rule along the wing and one on the keel, the red margin by the tail
  px.line(X(14), 5, X(64), 9, R.navy[5]);
  px.line(X(14), 13, X(56), 11, R.navy[5]);
  px.vline(X(11), 4, 4, R.rose[4]);
  px.vline(X(11), 10, 5, R.rose[4]);
  // the fold
  px.line(X(4), 9, X(77), 9, R.cream[2]);
}

export const dart: ObjFactory = (def, id, gfx) => {
  const W = 78;
  const H = 20;
  const dir: 1 | -1 = num(def.dir, -1) >= 0 ? 1 : -1;
  const delay = Math.max(0.3, num(def.delay, 2));
  const sp = spriteOf(gfx, W, H);
  const startX = dir > 0 ? LAYOUT.sideWall : 640 - LAYOUT.sideWall - W;
  let state: 'wait' | 'fly' | 'drop' = 'wait';
  let timer = delay;
  let x = startX;
  let y = def.y;
  const body = (): Rect => ({ x: x + 4, y: y + 4, w: W - 8, h: H - 8 });
  const vanish = (ctx: ObjCtx) => {
    twinkle(ctx, x + W / 2, y + H / 2);
    state = 'wait';
    timer = delay;
    sp.hide();
  };
  return {
    id,
    def,
    hazard: true,
    update(ctx) {
      if (state === 'wait') {
        if (!isOn(def, ctx)) return;
        timer -= ctx.dt;
        if (timer > 0) return;
        state = 'fly';
        x = startX;
        y = def.y;
        twinkle(ctx, x + (dir > 0 ? 8 : W - 8), y + H / 2);
      } else if (state === 'fly') {
        x += dir * DART * ctx.dt;
        y += RISE * ctx.dt;
        if (x + W < LAYOUT.sideWall || x > 640 - LAYOUT.sideWall || y + H >= FLOOR) return vanish(ctx);
      } else {
        y += DROP * ctx.dt;
        if (y + H >= FLOOR) return vanish(ctx);
      }
      sp.show(state, (px) => paintDart(px, dir, state === 'drop'), x, y);
    },
    trigger() {
      return state === 'fly' ? body() : null;
    },
    onTouch(ctx) {
      const b = body();
      ctx.api.strike(0.6, { x: dir > 0 ? b.x + b.w : b.x, y: b.y + b.h / 2 });
      bits(ctx, b.x + b.w / 2, b.y + b.h / 2, [R.cream[4], R.cream[5], R.navy[5]], 8, 200);
      vanish(ctx);
    },
    shot(bx, by, ctx) {
      if (state !== 'fly' || !inRect(body(), bx, by, 3)) return false;
      state = 'drop';
      ctx.api.sfx('crumple', { vol: 0.4 });
      return true;
    },
    dispose() {
      sp.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Rubber ball: bounces on the spot to `height`; with its switch off it bounces itself out and comes to rest.

const BALLS: readonly Ramp[] = [R.red, R.navy, R.mustard, R.moss];

function paintBall(px: Px, ramp: Ramp, squash: boolean) {
  const rx = squash ? 17 : 15;
  const ry = squash ? 12 : 15;
  const cy = 33 - ry;
  px.sphere(17, cy, rx, ry, ramp);
  // a cream band round its middle, following the curve
  for (let i = -rx + 2; i <= rx - 2; i++) {
    const yy = Math.round(cy + 1 + (i * i) / (rx * rx) * -2);
    const f = 1 - (i * i) / (rx * rx);
    px.px(17 + i, yy, f > 0.5 ? R.cream[5] : R.cream[3]);
    px.px(17 + i, yy + 1, f > 0.5 ? R.cream[4] : R.cream[2]);
  }
}

export const ball: ObjFactory = (def, id, gfx) => {
  const D = 34;
  const ramp = BALLS[(def.v ?? 0) % BALLS.length];
  const base = num(def.y, FLOOR);
  const v0 = Math.sqrt(2 * G * Math.max(16, num(def.height, 120)));
  const sp = spriteOf(gfx, D, D);
  let moving = false;
  let bottom = base;
  let vy = 0;
  let squash = 0;
  let cool = 0;
  const body = (): Rect => ({ x: def.x + 4, y: bottom - 30, w: D - 8, h: 28 });
  return {
    id,
    def,
    hazard: true,
    update(ctx) {
      cool -= ctx.dt;
      squash -= ctx.dt;
      const on = isOn(def, ctx);
      if (!moving && on) {
        moving = true;
        vy = -v0;
      }
      if (moving) {
        vy += G * ctx.dt;
        bottom += vy * ctx.dt;
        if (bottom >= base) {
          bottom = base;
          vy = on ? -v0 : -vy * 0.75;
          if (Math.abs(vy) < 60) {
            vy = 0;
            moving = false;
          } else {
            squash = 0.07;
            ctx.api.sfx('boing', { vol: 0.35 });
          }
        }
      }
      const sq = squash > 0;
      sp.show(sq ? 'squash' : 'round', (px) => paintBall(px, ramp, sq), def.x, bottom - D + 1);
    },
    trigger() {
      return cool > 0 ? null : body();
    },
    onTouch(ctx) {
      const b = body();
      ctx.api.strike(0.45, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
      ctx.api.sfx('boing', { vol: 0.6, pitch: -3 });
      cool = 1.2;
    },
    dispose() {
      sp.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Goldfish: swims round its bowl (the `fish` kind draws the bowl) and every `delay` leaps `height` out of it.


function paintFish(px: Px, pose: 'swim' | 'up' | 'down', facing: 1 | -1, wag: number) {
  // painted head to the right on a 22 × 22 canvas, then turned
  const c = Px.create(22, 22);
  const fl = R.flame;
  c.poly([[3, 11 - 4 - wag], [8, 11], [3, 11 + 4 - wag]], fl[2]);
  c.poly([[4, 11 - 3 - wag], [8, 11], [4, 11 + 3 - wag]], fl[3]);
  c.ellipse(13, 11, 6, 4, fl[2]);
  c.ellipse(13, 10, 5, 3, fl[3]);
  c.ellipse(14, 9, 3, 1, fl[4]);
  c.poly([[11, 7], [14, 4], [15, 7]], fl[2]);
  c.poly([[12, 14], [14, 16], [15, 14]], fl[3]);
  c.px(17, 10, R.ink[0]);
  c.px(19, 12, fl[1]);
  const ctx = px.ctx;
  ctx.save();
  ctx.translate(11, 11);
  if (pose === 'up') ctx.rotate(-Math.PI / 2);
  else if (pose === 'down') ctx.rotate(Math.PI / 2);
  if (facing < 0 && pose === 'swim') ctx.scale(-1, 1);
  ctx.drawImage(c.canvas, -11, -11);
  ctx.restore();
}

export const fish: ObjFactory = (def, id, gfx) => {
  const S = 22;
  const cx = def.x + BOWL.w / 2;
  const surface = def.y + BOWL.surface;
  const delay = Math.max(0.6, num(def.delay, 3));
  const v0 = Math.sqrt(2 * G * Math.max(20, num(def.height, 110)));
  const sp = spriteOf(gfx, S, S, 0, 7);
  let state: 'swim' | 'leap' = 'swim';
  let timer = delay;
  let t = Math.random() * 6;
  let fx = cx;
  let fy = surface + 12;
  let vy = 0;
  let cool = 0;
  const splash = (ctx: ObjCtx) => {
    ctx.api.sfx('splash', { vol: 0.4 });
    for (let k = 0; k < 6; k++)
      ctx.particles.spawn({ x: cx + (Math.random() - 0.5) * 14, y: surface, vx: (Math.random() - 0.5) * 70, vy: -50 - Math.random() * 50, grav: 300, life: 0.4, max: 0.4, ...rgb('#a9d4f0'), a: 0.9 });
  };
  return {
    id,
    def,
    hazard: true,
    update(ctx) {
      t += ctx.dt;
      cool -= ctx.dt;
      if (state === 'swim') {
        fx = cx + Math.sin(t * 1.3) * 9;
        fy = surface + 13 + Math.sin(t * 2.1) * 2;
        timer -= ctx.dt;
        if (timer <= 0 && isOn(def, ctx)) {
          state = 'leap';
          fx = cx;
          fy = surface;
          vy = -v0;
          splash(ctx);
        }
        const facing: 1 | -1 = Math.cos(t * 1.3) >= 0 ? 1 : -1;
        const wag = Math.floor(t * 6) % 2;
        sp.show(`s${facing}${wag}`, (px) => paintFish(px, 'swim', facing, wag), fx - S / 2, fy - S / 2);
        return;
      }
      vy += G * ctx.dt;
      fy += vy * ctx.dt;
      if (vy > 0 && fy >= surface) {
        state = 'swim';
        timer = delay;
        splash(ctx);
      }
      const pose = vy < -110 ? 'up' : vy > 110 ? 'down' : 'swim';
      const wag = Math.floor(t * 10) % 2;
      sp.show(`l${pose}${wag}`, (px) => paintFish(px, pose, 1, wag), fx - S / 2, fy - S / 2);
    },
    trigger() {
      if (state !== 'leap' || cool > 0 || fy > surface - 4) return null;
      return { x: fx - 7, y: fy - 9, w: 14, h: 18 };
    },
    onTouch(ctx) {
      ctx.api.strike(0.4, { x: fx, y: fy });
      ctx.api.soak(0.2);
      ctx.api.sfx('splash', { vol: 0.5 });
      cool = 1;
    },
    dispose() {
      sp.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Cobweb (drawn by the `cobweb` kind): catches the plane and holds it a moment before it drops out of it.

export const cobweb: ObjFactory = (def, id) => {
  const w = def.w ?? 68;
  const h = def.h ?? 48;
  let cool = 0;
  return {
    id,
    def,
    hazard: true,
    update(ctx) {
      cool -= ctx.dt;
    },
    trigger() {
      return cool > 0 ? null : { x: def.x - 10, y: def.y - 4, w: w + 20, h: h + 8 };
    },
    onTouch(ctx) {
      ctx.api.snag(def.x + w / 2, def.y + h * 0.45);
      cool = 2.6;
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Electric outlet (the plate is the `outlet` kind): every `delay` it crackles with sparks for a second.

const ZAP = 1;

export const outlet: ObjFactory = (def, id, gfx) => {
  const SW = 52;
  const SH = 46;
  const cx = def.x + 9;
  const cy = def.y + 12;
  const delay = Math.max(0.5, num(def.delay, 3));
  const sp = spriteOf(gfx, SW, SH, 1, 9);
  const light = { x: cx, y: cy, r: 80, color: new THREE.Color('#bfe0ff'), intensity: 0 };
  let timer = delay;
  let zap = 0;
  let crackle = 0;
  let cool = 0;
  let seed = 1;
  const arcs = (px: Px, s: number) => {
    const rnd = (k: number) => {
      const v = Math.sin(s * 91.7 + k * 12.9) * 43758.5;
      return v - Math.floor(v);
    };
    for (let a = 0; a < 4; a++) {
      let x = SW / 2 + (rnd(a) - 0.5) * 6;
      let y = SH / 2 + (rnd(a + 9) - 0.5) * 6;
      const ang = rnd(a + 20) * Math.PI * 2;
      for (let k = 0; k < 6; k++) {
        const nx = x + Math.cos(ang + (rnd(a * 7 + k) - 0.5) * 1.6) * 4;
        const ny = y + Math.sin(ang + (rnd(a * 5 + k + 3) - 0.5) * 1.6) * 4;
        px.line(x, y, nx, ny, k < 3 ? '#ffffff' : '#bfe0ff');
        x = nx;
        y = ny;
      }
    }
    px.ellipse(SW / 2, SH / 2, 2, 2, '#ffffff');
  };
  return {
    id,
    def,
    hazard: true,
    update(ctx) {
      cool -= ctx.dt;
      if (zap > 0) {
        zap -= ctx.dt;
        crackle -= ctx.dt;
        if (crackle <= 0) {
          crackle = 0.17;
          ctx.api.sfx('zap', { vol: 0.5 });
        }
        const f = Math.floor(zap * 20);
        if (f !== seed) seed = f;
        light.intensity = 0.6 + Math.random() * 0.5;
        sp.show(`z${seed}`, (px) => arcs(px, seed), cx - SW / 2, cy - SH / 2);
        if (Math.random() < ctx.dt * 20) ctx.particles.spawn({ x: cx + (Math.random() - 0.5) * 20, y: cy + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 120, vy: (Math.random() - 0.5) * 120, life: 0.2, max: 0.2, ...rgb('#ffffff'), a: 1 });
        if (zap <= 0) {
          timer = delay;
          light.intensity = 0;
          sp.hide();
        }
        return;
      }
      if (!isOn(def, ctx)) return;
      timer -= ctx.dt;
      if (timer <= 0) {
        zap = ZAP;
        crackle = 0;
      }
    },
    trigger() {
      return zap > 0 && cool <= 0 ? { x: cx - 22, y: cy - 20, w: 44, h: 40 } : null;
    },
    onTouch(ctx) {
      ctx.api.strike(0.3, { x: cx, y: cy });
      ctx.api.burnDamage(0.12);
      ctx.api.shake(0.5);
      cool = 0.8;
    },
    lights() {
      return light.intensity > 0 ? [light] : [];
    },
    dispose() {
      sp.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Paper shredder (drawn by the `shredder` kind): fly low over its slot while it is on and the plane is shredded.

export const shredder: ObjFactory = (def, id) => {
  const { w } = SHREDDER;
  let strips = 0;
  let on = def.on !== false;
  return {
    id,
    def,
    hazard: true,
    update(ctx) {
      on = isOn(def, ctx);
      if (strips <= 0) return;
      strips -= ctx.dt;
      // ribbons of paper out of the bottom
      if (Math.random() < ctx.dt * 40)
        ctx.particles.spawn({
          x: def.x + 12 + Math.random() * (w - 24),
          y: def.y + SHREDDER.h,
          vx: (Math.random() - 0.5) * 20,
          vy: 30 + Math.random() * 30,
          grav: 200,
          life: 0.7,
          max: 0.7,
          ...rgb(Math.random() < 0.5 ? '#f4f0e6' : '#ddd6c6'),
          a: 1,
        });
    },
    trigger() {
      return on && strips <= 0 ? { x: def.x + 8, y: def.y - 22, w: w - 16, h: 26 } : null;
    },
    onTouch(ctx) {
      ctx.api.sfx('shred');
      strips = 1.2;
      ctx.api.strike(1, { x: def.x + w / 2, y: def.y });
    },
  };
};
