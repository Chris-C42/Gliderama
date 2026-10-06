/** Candles, switches, collectibles, drips, workbenches, exits. */

import * as THREE from 'three';
import { R } from '../../render/palette';
import { Px } from '../../render/pixel';
import { rgb } from '../../render/particles';
import { fanOut } from './airflow';
import type { ObjFactory } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);

// ---------------------------------------------------------------------------------------------
// Candle: flickering flame (emissive sprite + light), thermal updraft, fire hazard.

export const candle: ObjFactory = (def, id, gfx) => {
  // def.x, def.y = top-left of the wick area; flame sits above (x+2, y)
  const fx = def.x + 3;
  const fy = def.y;
  const sprite = gfx?.createSprite(8, 14, 1, 9) ?? null;
  const px = sprite ? new Px(sprite.canvas, 5) : null;
  let t = Math.random() * 10;
  let frame = -1;
  const col = new THREE.Color('#ffb860');
  const light = { x: fx, y: fy - 4, r: 70, color: col, intensity: 0.85 };
  const draw = (f: number) => {
    if (!px || !sprite) return;
    px.ctx.clearRect(0, 0, 8, 14);
    const lean = [0, 1, 0, -1][f % 4];
    px.ellipse(4 + lean * 0.5, 9, 2.5, 4, R.flame[3]);
    px.ellipse(4 + lean, 7, 1.5, 3, R.flame[4]);
    px.px(4 + lean, 3 + (f % 2), R.flame[4]);
    px.ellipse(4, 10, 1, 1.5, R.flame[5]);
    px.px(4, 12, R.navy[4]);
    sprite.refresh();
  };
  sprite?.set(fx - 4, fy - 13);
  let embers = 0;
  return {
    id,
    def,
    wind(x, y, out) {
      const dy = fy - y;
      if (dy < 0 || dy > 140) return;
      const half = 5 + dy * 0.1;
      const dx = Math.abs(x - fx);
      if (dx > half) return;
      out.y += 1.0 * (1 - dx / half) * (1 - dy / 160);
    },
    update(ctx) {
      t += ctx.dt;
      const f = Math.floor(t * 10) % 4;
      if (f !== frame) {
        frame = f;
        draw(f);
      }
      light.intensity = 0.75 + 0.15 * Math.sin(t * 13) + 0.08 * Math.sin(t * 31);
      embers += ctx.dt * 2;
      while (embers > 1) {
        embers -= 1;
        ctx.particles.spawn({ x: fx, y: fy - 12, vx: (Math.random() - 0.5) * 10, vy: -30 - Math.random() * 20, life: 0.6, max: 0.6, ...rgb('#ffcc66'), a: 0.8 });
      }
    },
    trigger() {
      return { x: fx - 3, y: fy - 13, w: 6, h: 12 };
    },
    onTouch(ctx) {
      ctx.api.ignite();
    },
    sound() {
      return { loop: 'fire', x: fx, y: fy - 6, vol: 0.4 };
    },
    airflow() {
      // a thin plume from above the flame, petering out 140 px up
      return [{ lines: fanOut(2, { x: fx - 2, y: fy - 15 }, { x: fx + 2, y: fy - 15 }, { x: fx - 6, y: fy - 140 }, { x: fx + 6, y: fy - 140 }), power: 1, warm: true, fade: 44 }];
    },
    lights() {
      return [light];
    },
    dispose() {
      sprite?.dispose();
    },
  };
};

/**
 * A switch, 10 × 16: `look` 'light' a light switch's toggle, 'thermostat' a dial, 'knife' a knife switch on its board,
 * 'power' a push button, 'machine' a machine's rocker (Glider PRO's switches).
 */
function paintSwitch(px: Px, look: string, on: boolean) {
  switch (look) {
    case 'thermostat':
      px.rect(0, 1, 10, 14, R.cream[4]);
      px.frame(0, 1, 10, 14, R.cream[2]);
      px.ellipse(5, 7, 3.5, 3.5, R.cream[2]);
      px.ellipse(5, 7, 2.5, 2.5, R.cream[5]);
      px.line(5, 7, on ? 7 : 3, 5, R.red[3]);
      px.hline(2, 12, 6, on ? R.red[3] : R.navy[4]);
      return;
    case 'knife':
      px.rect(0, 0, 10, 16, R.walnut[3]);
      px.frame(0, 0, 10, 16, R.walnut[1]);
      px.rect(3, 2, 4, 2, R.brass[3]);
      px.rect(3, 12, 4, 2, R.brass[3]);
      if (on) px.rect(4, 3, 2, 10, R.steel[5]);
      else px.line(5, 12, 9, 7, R.steel[5]);
      px.rect(on ? 3 : 7, on ? 1 : 5, on ? 4 : 3, 2, R.ink[1]);
      return;
    case 'power':
      px.rect(1, 3, 8, 10, R.ink[2]);
      px.frame(1, 3, 8, 10, R.ink[1]);
      px.ellipse(5, 8, 2.5, 2.5, on ? R.moss[5] : R.red[3]);
      return;
    case 'machine':
      px.rect(0, 0, 10, 16, R.steel[3]);
      px.frame(0, 0, 10, 16, R.steel[1]);
      px.rect(3, 3, 4, 10, R.ink[1]);
      if (on) px.rect(3, 3, 4, 5, R.red[4]);
      else px.rect(3, 8, 4, 5, R.red[2]);
      px.px(1, 1, R.steel[5]);
      px.px(8, 14, R.steel[5]);
      return;
    default:
      px.rect(0, 0, 10, 16, R.cream[5]);
      px.frame(0, 0, 10, 16, R.cream[2]);
      px.rect(3, 3, 4, 10, R.cream[2]);
      if (on) {
        px.rect(3, 3, 4, 5, '#ffffff');
        px.hline(3, 8, 4, R.cream[1]);
      } else {
        px.rect(3, 8, 4, 5, '#ffffff');
        px.hline(3, 7, 4, R.cream[1]);
      }
  }
}

// ---------------------------------------------------------------------------------------------
// Light switch: fly into it to flip the room lights (or a named group, e.g. a fan). `room` wires it to another
// room's lights; `hidden` makes it an invisible trigger of size w × h (Glider PRO's invisible switches). It flips once
// each time the plane comes through (lingering in a big trigger does not flip it back).

export const lightSwitch: ObjFactory = (def, id, gfx) => {
  const group = str(def.group, 'lights');
  const room = typeof def.room === 'string' ? def.room : undefined;
  const hidden = !!def.hidden;
  const sprite = hidden ? null : (gfx?.createSprite(10, 16, 0, 6) ?? null);
  const px = sprite ? new Px(sprite.canvas, 2) : null;
  let state: boolean | null = null;
  let cooldown = 0;
  // touched this tick / the tick before
  let over = false;
  let wasOver = false;
  const draw = (on: boolean) => {
    if (!px || !sprite) return;
    px.ctx.clearRect(0, 0, 10, 16);
    paintSwitch(px, str(def.look, 'light'), on);
    sprite.refresh();
  };
  sprite?.set(def.x, def.y);
  return {
    id,
    def,
    update(ctx) {
      cooldown = Math.max(0, cooldown - ctx.dt);
      wasOver = over;
      over = false;
      const on = group === 'lights' ? ctx.api.lightsOn(room) : ctx.api.switchOn(group);
      if (on !== state) {
        state = on;
        draw(on);
      }
    },
    trigger() {
      return hidden ? { x: def.x, y: def.y, w: def.w ?? 16, h: def.h ?? 16 } : { x: def.x - 4, y: def.y - 4, w: 18, h: 24 };
    },
    onTouch(ctx) {
      over = true;
      if (wasOver || cooldown > 0) return;
      cooldown = 0.8;
      if (group === 'lights') ctx.api.toggleLights(room);
      else ctx.api.setSwitch(group, !ctx.api.switchOn(group));
      ctx.api.sfx('switch');
    },
    dispose() {
      sprite?.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Collectibles

function starPixels(px: Px, cx: number, cy: number, sx: number, col: string, edge: string) {
  // 5-point star scaled horizontally by sx (spin)
  const pts: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 === 0 ? 6.5 : 2.8;
    pts.push([cx + Math.cos(a) * r * sx, cy + Math.sin(a) * r]);
  }
  px.poly(pts, edge);
  const inner = pts.map(([x, y]) => [cx + (x - cx) * 0.7, cy + (y - cy) * 0.7] as [number, number]);
  px.poly(inner, col);
}

/** Glider PRO's bonus clocks, collected like stars: an alarm clock (`v` 0 red, 1 blue, 2 yellow) ringing as it bobs. */
function clockPixels(px: Px, v: number, f: number) {
  const c = [R.red, R.navy, R.mustard][v % 3];
  const ring = f % 2 ? 1 : -1;
  // the bells and the hammer between them
  px.ellipse(4, 4 + (ring > 0 ? 0 : 1), 3, 2, R.brass[4]);
  px.ellipse(14, 4 + (ring > 0 ? 1 : 0), 3, 2, R.brass[4]);
  px.px(3, 3, R.brass[5]);
  px.px(13, 3, R.brass[5]);
  px.vline(9 + ring, 1, 4, R.steel[3]);
  // the case, the face and its hands
  px.ellipse(9, 10, 7, 7, c[1]);
  px.ellipse(9, 10, 6, 6, c[3]);
  px.ellipse(9, 10, 4, 4, R.cream[5]);
  px.vline(9, 7, 3, R.ink[1]);
  px.hline(9, 10, 3, R.ink[1]);
  px.px(7, 7, c[5]);
  // the feet
  px.px(4, 16, c[1]);
  px.px(14, 16, c[1]);
}

/** A cuckoo clock (Glider PRO's cuckoo bonus): the bird pops out of its door now and then. */
function cuckooPixels(px: Px, f: number) {
  px.poly([[1, 7], [9, 0], [17, 7]], R.walnut[2]);
  px.poly([[3, 7], [9, 2], [15, 7]], R.walnut[4]);
  px.rect(3, 7, 12, 12, R.oak[3]);
  px.vline(3, 7, 12, R.oak[5]);
  px.rect(7, 8, 4, 3, f === 1 ? R.ink[1] : R.oak[2]);
  if (f === 1) px.rect(8, 8, 3, 2, R.mustard[4]);
  px.ellipse(9, 14, 3, 3, R.cream[5]);
  px.px(9, 13, R.ink[1]);
  px.px(10, 14, R.ink[1]);
  px.vline(6, 19, 4, R.brass[3]);
  px.vline(12, 19, 6, R.brass[3]);
  px.rect(5, 23, 3, 3, R.brass[4]);
  px.rect(11, 25, 3, 3, R.brass[4]);
}

export const star: ObjFactory = (def, id, gfx) => {
  const look = def.look === 'clock' || def.look === 'cuckoo' ? def.look : 'star';
  const SW = look === 'star' ? 16 : 18;
  const SH = look === 'star' ? 16 : look === 'clock' ? 18 : 28;
  const sprite = gfx?.createSprite(SW, SH, 1, 7) ?? null;
  const px = sprite ? new Px(sprite.canvas, 4) : null;
  let t = Math.random() * 6;
  let frame = -1;
  let gone = false;
  const draw = (f: number) => {
    if (!px || !sprite) return;
    px.ctx.clearRect(0, 0, SW, SH);
    if (look === 'clock') clockPixels(px, def.v ?? 0, f);
    else if (look === 'cuckoo') cuckooPixels(px, f % 3 === 1 ? 1 : 0);
    else {
      const sx = [1, 0.8, 0.45, 0.8][f];
      starPixels(px, 8, 8.5, sx, R.mustard[5], R.brass[2]);
      if (f === 0) px.px(6, 6, '#ffffff');
    }
    sprite.refresh();
  };
  return {
    id,
    def,
    update(ctx) {
      if (gone) return;
      if (ctx.api.isCollected(id)) {
        gone = true;
        sprite?.set(0, 0, false);
        return;
      }
      t += ctx.dt;
      const f = Math.floor(t * 6) % 4;
      if (f !== frame) {
        frame = f;
        draw(f);
      }
      sprite?.set(def.x - SW / 2, def.y - SH / 2 + Math.round(Math.sin(t * 2.5) * 2));
      if (Math.random() < ctx.dt * 2) {
        ctx.particles.spawn({ x: def.x + (Math.random() - 0.5) * 14, y: def.y + (Math.random() - 0.5) * 14, vy: -6, life: 0.5, max: 0.5, ...rgb('#fff6c0'), a: 1 });
      }
    },
    trigger() {
      return gone ? null : { x: def.x - 9, y: def.y - 9, w: 18, h: 18 };
    },
    onTouch(ctx) {
      if (gone) return;
      gone = true;
      sprite?.set(0, 0, false);
      ctx.api.collectStar(id);
      ctx.api.sfx('star');
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        ctx.particles.spawn({ x: def.x, y: def.y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, life: 0.5, max: 0.5, ...rgb(k % 2 ? '#ffe070' : '#ffffff'), a: 1, drag: 3 });
      }
    },
    dispose() {
      sprite?.dispose();
    },
  };
};

type PickupKind = 'sheet' | 'tape' | 'battery' | 'bands';

function pickup(kind: PickupKind): ObjFactory {
  return (def, id, gfx) => {
    const sprite = gfx?.createSprite(18, 16, 0.4, 7) ?? null;
    const px = sprite ? new Px(sprite.canvas, 6) : null;
    let t = Math.random() * 6;
    let gone = false;
    if (px) px.ctx.clearRect(0, 0, 18, 16);
    if (!px) {
      // headless
    } else if (kind === 'sheet') {
      px.poly([[2, 4], [14, 2], [16, 12], [4, 14]], '#f8f4ea');
      px.line(2, 4, 14, 2, '#ffffff');
      px.line(4, 14, 16, 12, R.cream[2]);
      px.line(14, 2, 16, 12, R.cream[2]);
      px.line(5, 7, 13, 6, R.navy[4]);
      px.line(5, 10, 12, 9, R.navy[4]);
      px.rect(12, 9, 5, 5, R.moss[4]);
      px.hline(13, 11, 3, '#ffffff');
      px.vline(14, 10, 3, '#ffffff');
    } else if (kind === 'tape') {
      px.ellipse(9, 8, 7, 7, R.cream[3]);
      px.ellipse(9, 8, 6, 6, R.cream[4]);
      px.ellipse(9, 8, 3, 3, R.ink[2]);
      px.ellipse(9, 8, 2, 2, R.cream[2]);
      px.rect(11, 13, 6, 2, R.cream[4]);
    } else if (kind === 'battery') {
      px.rect(3, 4, 12, 8, R.ink[2]);
      px.rect(4, 5, 10, 6, R.moss[4]);
      px.rect(4, 5, 4, 6, R.brass[4]);
      px.rect(15, 6, 2, 4, R.steel[4]);
      px.px(10, 7, '#fff');
    } else {
      px.ellipse(9, 8, 6, 4, R.rose[3]);
      px.ellipse(9, 8, 4, 2, 'rgba(0,0,0,0)');
      px.ctx.clearRect(6, 7, 6, 2);
    }
    sprite?.refresh();
    return {
      id,
      def,
      update(ctx) {
        if (gone) return;
        if (ctx.api.isCollected(id)) {
          gone = true;
          sprite?.set(0, 0, false);
          return;
        }
        t += ctx.dt;
        sprite?.set(def.x - 9, def.y - 8 + Math.round(Math.sin(t * 2) * 2));
      },
      trigger() {
        return gone ? null : { x: def.x - 9, y: def.y - 9, w: 18, h: 18 };
      },
      onTouch(ctx) {
        if (gone) return;
        gone = true;
        sprite?.set(0, 0, false);
        ctx.api.collectStar(id); // marks as collected for this run
        if (kind === 'sheet') ctx.api.addSheet();
        if (kind === 'tape') ctx.api.repair(0.35);
        if (kind === 'battery') ctx.api.addCharge('boost', 1);
        if (kind === 'bands') ctx.api.addCharge('bands', 3);
        ctx.api.sfx(kind === 'sheet' ? 'sheet' : kind === 'tape' ? 'tape' : 'select');
      },
      dispose() {
        sprite?.dispose();
      },
    };
  };
}

export const sheetPickup = pickup('sheet');
export const tapePickup = pickup('tape');
export const batteryPickup = pickup('battery');
export const bandsPickup = pickup('bands');

// ---------------------------------------------------------------------------------------------
// Drip: water drops fall from (x, y) every `every` seconds.

export const drip: ObjFactory = (def, id, gfx) => {
  const every = num(def.every, 1.4);
  const floorY = num(def.floorY, 338);
  interface Drop {
    y: number;
    vy: number;
    s: { set(x: number, y: number, v?: boolean): void; dispose(): void } | null;
    live: boolean;
  }
  const drops: Drop[] = [];
  for (let k = 0; k < 3; k++) {
    const s = gfx?.createSprite(3, 5, 0.5, 8) ?? null;
    if (s) {
      const px = new Px(s.canvas, 1);
      px.rect(1, 0, 1, 1, R.sky[4]);
      px.rect(0, 1, 3, 3, R.sky[3]);
      px.px(0, 1, R.sky[5]);
      px.rect(1, 4, 1, 1, R.navy[4]);
      s.refresh();
      s.set(0, 0, false);
    }
    drops.push({ y: 0, vy: 0, s, live: false });
  }
  let timer = Math.random() * every;
  return {
    id,
    def,
    update(ctx) {
      timer -= ctx.dt;
      if (timer <= 0) {
        timer = every;
        const d = drops.find((q) => !q.live);
        if (d) {
          d.live = true;
          d.y = def.y;
          d.vy = 0;
        }
      }
      for (const d of drops) {
        if (!d.live) continue;
        d.vy += 420 * ctx.dt;
        d.y += d.vy * ctx.dt;
        if (d.y > floorY) {
          d.live = false;
          d.s?.set(0, 0, false);
          for (let k = 0; k < 5; k++)
            ctx.particles.spawn({ x: def.x, y: floorY, vx: (Math.random() - 0.5) * 60, vy: -40 - Math.random() * 40, grav: 300, life: 0.4, max: 0.4, ...rgb('#a9d4f0'), a: 0.9 });
          continue;
        }
        d.s?.set(def.x - 1, d.y - 2, true);
        const p = ctx.api.plane();
        if (p.alive && Math.abs(p.x - def.x) < 16 && Math.abs(p.y - d.y) < 10) {
          d.live = false;
          d.s?.set(0, 0, false);
          ctx.api.soak(0.18);
          ctx.api.sfx('splash');
          for (let k = 0; k < 6; k++)
            ctx.particles.spawn({ x: def.x, y: d.y, vx: (Math.random() - 0.5) * 80, vy: -30 - Math.random() * 40, grav: 300, life: 0.4, max: 0.4, ...rgb('#a9d4f0'), a: 0.9 });
        }
      }
    },
    dispose() {
      for (const d of drops) d.s?.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Workbench: land on it to refold / repair. Marked with a gentle sparkle.

export const workbench: ObjFactory = (def, id) => {
  const w = def.w ?? 120;
  let t = 0;
  return {
    id,
    def,
    update(ctx) {
      t += ctx.dt;
      if (Math.random() < ctx.dt * 3) {
        ctx.particles.spawn({ x: def.x + Math.random() * w, y: def.y - 4 - Math.random() * 10, vy: -12, life: 0.8, max: 0.8, ...rgb('#bfe8ff'), a: 0.9 });
      }
    },
    trigger() {
      return { x: def.x + 6, y: def.y - 10, w: w - 12, h: 12 };
    },
    onTouch(ctx) {
      const p = ctx.api.plane();
      // only when settling gently onto the bench
      if (Math.hypot(p.vx, p.vy) < 1.2) ctx.api.openWorkbench(id);
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Exit: fly through to finish the level.

export const exitPortal: ObjFactory = (def, id) => {
  const w = def.w ?? 40;
  const h = def.h ?? 60;
  let fired = false;
  return {
    id,
    def,
    update(ctx) {
      if (Math.random() < ctx.dt * 6) {
        ctx.particles.spawn({ x: def.x + Math.random() * w, y: def.y + Math.random() * h, vy: -10, life: 0.7, max: 0.7, ...rgb('#fff2b0'), a: 0.8 });
      }
    },
    trigger() {
      return { x: def.x, y: def.y, w, h };
    },
    onTouch(ctx) {
      if (fired) return;
      fired = true;
      ctx.api.completeLevel();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Goals: landing targets and hoops (sandbox & challenges).

export const target: ObjFactory = (def, id) => {
  const w = def.w ?? 90;
  return {
    id,
    def,
    trigger() {
      return { x: def.x, y: 300, w, h: 44 };
    },
  };
};

export const hoop: ObjFactory = (def, id) => {
  const r = num(def.r, 26);
  let passed = false;
  return {
    id,
    def,
    update(ctx) {
      // hoops count per flight: re-arm while the next sheet is being thrown
      if (passed && !ctx.api.plane().alive) passed = false;
    },
    trigger() {
      return passed ? null : { x: def.x - 3, y: def.y - r + 6, w: 6, h: 2 * r - 12 };
    },
    onTouch(ctx) {
      if (passed) return;
      passed = true;
      ctx.api.goal?.('hoop', id);
      ctx.api.sfx('star', { pitch: 5 });
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        ctx.particles.spawn({ x: def.x, y: def.y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 90, life: 0.5, max: 0.5, ...rgb('#f09a72'), a: 1, drag: 2 });
      }
    },
  };
};
