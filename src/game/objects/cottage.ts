/** Cottage objects: the hearth fire, the clock's pendulum, the cat, the kettle's steam and the cuckoo. */

import { R } from '../../render/palette';
import { Px } from '../../render/pixel';
import { rgb } from '../../render/particles';
import { LAYOUT } from '../../world/types';
import { fanOut, lerp } from './airflow';
import type { AirFlow, ObjFactory } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const smoke = rgb('#cfc8c0');
const steamCol = rgb('#f4f8fc');

function bump(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0;
  return Math.sin(Math.PI * ((x - a) / (b - a))) ** 1.5;
}

// ---------------------------------------------------------------------------------------------
// Fireplace: flames in the firebox (a hazard), and a strong warm updraft rising off the mantel.

export const fireplace: ObjFactory = (def, id, gfx) => {
  const w = def.w ?? 170;
  const h = def.h ?? 150;
  const power = num(def.power, 2.8);
  const fx = def.x + 38;
  const fw = w - 76;
  const fh = 40;
  const fy = def.y + h - 14 - fh;
  const sprite = gfx?.createSprite(fw, fh, 1, 6) ?? null;
  const px = sprite ? new Px(sprite.canvas, 9) : null;
  let t = Math.random() * 10;
  let frame = -1;
  let acc = 0;
  const draw = (f: number) => {
    if (!px || !sprite) return;
    px.ctx.clearRect(0, 0, fw, fh);
    const tongues = Math.max(3, Math.floor(fw / 14));
    for (let k = 0; k < tongues; k++) {
      const cx = 6 + ((fw - 12) * (k + 0.5)) / tongues;
      const tall = 18 + (((k * 7 + f * 5) % 9) - 2) * 2;
      const lean = [0, 1, 0, -1][(f + k) % 4];
      px.ellipse(cx + lean, fh - tall / 2 - 2, 6, tall / 2, R.flame[2]);
      px.ellipse(cx + lean * 1.5, fh - tall / 2, 4, tall / 2 - 3, R.flame[3]);
      px.ellipse(cx + lean, fh - tall / 3, 3, tall / 3, R.flame[4]);
      px.px(cx + lean * 2, fh - tall - 1 + (f % 2), R.flame[4]);
    }
    px.rect(2, fh - 5, fw - 4, 5, R.flame[5]);
    px.dither(0, fh - 8, fw, 3, R.flame[3], 0.5);
    sprite.refresh();
  };
  sprite?.set(fx, fy);
  return {
    id,
    def,
    wind(x, y, out) {
      // the warm air off the chimney breast, from the mantel up to the ceiling
      if (y > def.y + 2 || y < LAYOUT.ceiling) return;
      const k = bump(x, def.x - 14, def.x + w + 14);
      if (k <= 0) return;
      out.y += power * k * Math.max(0.45, 1 - (def.y - y) / 320);
    },
    update(ctx) {
      t += ctx.dt;
      const f = Math.floor(t * 9) % 4;
      if (f !== frame) {
        frame = f;
        draw(f);
      }
      acc += ctx.dt * 7;
      while (acc > 1) {
        acc -= 1;
        if (Math.random() < 0.6) {
          ctx.particles.spawn({ x: fx + Math.random() * fw, y: fy + 6, vx: (Math.random() - 0.5) * 14, vy: -50 - Math.random() * 40, life: 0.7, max: 0.7, ...rgb(Math.random() < 0.5 ? '#ffcc66' : '#ff8a3c'), a: 1 });
        } else {
          const life = 1.4 + Math.random();
          ctx.particles.spawn({ x: def.x + 20 + Math.random() * (w - 40), y: def.y - 4, vx: (Math.random() - 0.5) * 6, vy: -36 - Math.random() * 20, life, max: life, ...smoke, a: 0.25, drag: 0.3 });
        }
      }
    },
    trigger() {
      return { x: fx - 4, y: fy + 8, w: fw + 8, h: fh };
    },
    onTouch(ctx) {
      ctx.api.ignite();
    },
    sound() {
      return { loop: 'fire', x: def.x + w / 2, y: fy + fh / 2, vol: 0.85 };
    },
    airflow() {
      // warm air off the whole chimney breast, from the mantel shelf to the ceiling
      const a = def.x - 14;
      const b = def.x + w + 14;
      return [{ lines: fanOut(5, { x: lerp(a, b, 0.16), y: def.y - 1 }, { x: lerp(a, b, 0.84), y: def.y - 1 }, { x: lerp(a, b, 0.16), y: LAYOUT.ceiling }, { x: lerp(a, b, 0.84), y: LAYOUT.ceiling }), power, warm: true }];
    },
    dispose() {
      sprite?.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Grandfather clock: the pendulum swings behind the glass and ticks when you are close.

export const grandfatherClock: ObjFactory = (def, id, gfx) => {
  const w = def.w ?? 46;
  const sw = w - 20;
  const sh = 92;
  const sprite = gfx?.createSprite(sw, sh, 0, 2) ?? null;
  const px = sprite ? new Px(sprite.canvas, 3) : null;
  let t = Math.random() * 2;
  let frame = -99;
  let side = 1;
  const draw = (q: number) => {
    if (!px || !sprite) return;
    px.ctx.clearRect(0, 0, sw, sh);
    const a = q * 0.045;
    const ox = sw / 2;
    const bx = ox + Math.sin(a) * 66;
    const by = 4 + Math.cos(a) * 66;
    px.line(ox, 4, bx, by, R.brass[2]);
    px.line(ox + 1, 4, bx + 1, by, R.brass[3]);
    px.ellipse(bx, by + 4, 7, 7, R.brass[3]);
    px.ellipse(bx - 2, by + 2, 3, 3, R.brass[5]);
    px.rect(ox - 2, 1, 5, 4, R.brass[4]);
    sprite.refresh();
  };
  sprite?.set(def.x + 10, def.y + 66);
  return {
    id,
    def,
    update(ctx) {
      t += ctx.dt;
      const s = Math.sin((t * Math.PI * 2) / 2.2);
      const q = Math.round(s * 6);
      if (q !== frame) {
        frame = q;
        draw(q);
      }
      const nside = s >= 0 ? 1 : -1;
      if (nside !== side) {
        side = nside;
        const p = ctx.api.plane();
        if (Math.hypot(p.x - def.x - w / 2, p.y - def.y - 100) < 240) ctx.api.sfx('click', { vol: 0.12, pitch: nside > 0 ? -14 : -12 });
      }
    },
    dispose() {
      sprite?.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// The cat: dozes on the furniture, wakes as you come near, and swats anything that flies too close.

type CatState = 'sleep' | 'alert' | 'swat';

export const cat: ObjFactory = (def, id, gfx) => {
  const SW = 64;
  const SH = 40;
  const ax = def.x; // bottom centre where it sits
  const ay = def.y;
  const fur = [
    [R.peach[1], R.peach[3], R.peach[4], R.mustard[4]],
    [R.stone[1], R.stone[2], R.stone[3], R.stone[4]],
    [R.ink[0], R.ink[1], R.ink[2], R.ink[3]],
  ][(def.v ?? 0) % 3];
  const eye = (def.v ?? 0) % 3 === 2 ? R.mustard[5] : R.leaf[5];
  const sprite = gfx?.createSprite(SW, SH, 0, 7) ?? null;
  const px = sprite ? new Px(sprite.canvas, 13) : null;
  let state: CatState = 'sleep';
  let stateT = 0;
  let cooldown = 0;
  let quiet = 0;
  let lookDir = 1;
  let paw = 0; // 0..1 extension
  let t = Math.random() * 4;
  let key = '';
  let hit = false;
  let zzz = 0;

  const draw = (k: string) => {
    if (!px || !sprite) return;
    const c = px;
    c.ctx.clearRect(0, 0, SW, SH);
    const bx = SW / 2;
    const by = SH - 1;
    const breathe = state === 'sleep' && Math.floor(t * 1.2) % 2 ? 1 : 0;
    // tail
    if (state === 'sleep') {
      c.ellipse(bx + 14, by - 3, 10, 3, fur[1]);
      c.ellipse(bx + 14, by - 4, 9, 2, fur[2]);
    } else {
      const flick = Math.floor(t * 6) % 2;
      c.line(bx + 14, by - 4, bx + 22, by - 14, fur[1]);
      c.line(bx + 15, by - 4, bx + 23, by - 14, fur[2]);
      c.line(bx + 22, by - 14, bx + 20 + flick * 4, by - 22, fur[2]);
    }
    // body (a loaf)
    c.ellipse(bx, by - 8 + breathe, 17, 9 - breathe, fur[2]);
    c.ellipse(bx - 2, by - 11 + breathe, 12, 5, fur[3]);
    for (let s = -10; s <= 8; s += 6) c.line(bx + s, by - 15 + breathe, bx + s + 2, by - 9, fur[1]);
    c.hline(bx - 15, by - 1, 30, fur[0]);
    // head
    const hx = state === 'sleep' ? bx - 13 : bx - 12 + lookDir * 2;
    const hy = state === 'sleep' ? by - 9 : by - 20;
    c.ellipse(hx, hy, 8, 7, fur[2]);
    c.ellipse(hx - 1, hy + 2, 5, 3, fur[3]);
    // ears
    const ear = state === 'sleep' ? 3 : 6;
    c.poly([[hx - 7, hy - 3], [hx - 5, hy - 3 - ear], [hx - 2, hy - 5]], fur[1]);
    c.poly([[hx + 2, hy - 5], [hx + 5, hy - 3 - ear], [hx + 7, hy - 3]], fur[1]);
    c.px(hx - 5, hy - 4, R.rose[4]);
    c.px(hx + 5, hy - 4, R.rose[4]);
    // face
    if (state === 'sleep') {
      c.hline(hx - 5, hy, 3, fur[0]);
      c.hline(hx + 2, hy, 3, fur[0]);
    } else {
      c.rect(hx - 5, hy - 1, 3, 3, eye);
      c.rect(hx + 2, hy - 1, 3, 3, eye);
      c.px(hx - 4 + lookDir, hy, R.ink[0]);
      c.px(hx + 3 + lookDir, hy, R.ink[0]);
      if (state === 'swat') {
        c.px(hx - 5, hy - 2, fur[0]);
        c.px(hx + 4, hy - 2, fur[0]);
      }
    }
    c.px(hx, hy + 2, R.rose[3]);
    c.px(hx - 6, hy + 3, '#ffffff');
    c.px(hx + 6, hy + 3, '#ffffff');
    // the paw
    if (state === 'swat' || paw > 0) {
      const reach = 6 + paw * 18;
      const px0 = hx + lookDir * 4;
      const py0 = by - 8;
      const ex = px0 + lookDir * reach;
      const ey = py0 - paw * 14;
      c.line(px0, py0, ex, ey, fur[2]);
      c.line(px0, py0 + 1, ex, ey + 1, fur[1]);
      c.ellipse(ex, ey, 3, 2, fur[3]);
      if (paw > 0.6) {
        c.px(ex + lookDir * 3, ey - 1, '#ffffff');
        c.px(ex + lookDir * 3, ey + 1, '#ffffff');
      }
    } else {
      c.ellipse(hx + 4, by - 2, 4, 2, fur[3]);
    }
    void k;
    sprite.refresh();
  };
  sprite?.set(ax - SW / 2, ay - SH);
  return {
    id,
    def,
    update(ctx) {
      t += ctx.dt;
      stateT += ctx.dt;
      cooldown = Math.max(0, cooldown - ctx.dt);
      const p = ctx.api.plane();
      const dx = p.x - ax;
      const dy = p.y - (ay - 14);
      const d = Math.hypot(dx, dy);
      const near = p.alive && d < 150;
      if (near) {
        quiet = 0;
        lookDir = dx < 0 ? -1 : 1;
      } else quiet += ctx.dt;
      if (state === 'sleep' && near) {
        state = 'alert';
        stateT = 0;
      } else if (state === 'alert') {
        if (p.alive && d < 50 && cooldown <= 0) {
          state = 'swat';
          stateT = 0;
          hit = false;
        } else if (quiet > 3) {
          state = 'sleep';
          stateT = 0;
        }
      } else if (state === 'swat') {
        paw = Math.min(1, stateT / 0.12);
        if (!hit && paw > 0.6 && p.alive) {
          const ex = ax - 12 + lookDir * (10 + paw * 18);
          const ey = ay - 8 - paw * 14;
          if (Math.abs(p.x - ex) < 18 && Math.abs(p.y - ey) < 14) {
            hit = true;
            ctx.api.tear(0.14);
            ctx.api.shake(0.35);
            ctx.api.sfx('meow');
            for (let k = 0; k < 8; k++) ctx.particles.spawn({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 90, vy: -Math.random() * 60, grav: 240, life: 0.6, max: 0.6, ...rgb('#f4efe2'), a: 1 });
          }
        }
        if (stateT > 0.4) {
          state = 'alert';
          stateT = 0;
          paw = 0;
          cooldown = 1.4;
          if (!hit) ctx.api.sfx('meow', { vol: 0.5, pitch: 3 });
        }
      }
      if (state === 'sleep') {
        zzz += ctx.dt;
        if (zzz > 1.6) {
          zzz = 0;
          ctx.particles.spawn({ x: ax - 18, y: ay - 22, vx: -6, vy: -14, life: 1.4, max: 1.4, size: 2, ...rgb('#e8f0ff'), a: 0.7 });
        }
      }
      const k = `${state}:${lookDir}:${Math.round(paw * 4)}:${state === 'sleep' ? Math.floor(t * 1.2) % 2 : Math.floor(t * 6) % 2}`;
      if (k !== key) {
        key = k;
        draw(k);
      }
    },
    colliders() {
      return [{ x: ax - 16, y: ay - 16, w: 32, h: 16 }];
    },
    dispose() {
      sprite?.dispose();
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Kettle: a jet of steam from the spout. It lifts you, and it makes paper soggy.

export const kettle: ObjFactory = (def, id) => {
  const sx = def.x + 28;
  const sy = def.y + 6;
  const power = num(def.power, 4.5);
  const reach = num(def.reach, 200);
  let acc = 0;
  return {
    id,
    def,
    wind(x, y, out) {
      const dy = sy - y;
      if (dy < 0 || dy > reach) return;
      const cx = sx + dy * 0.12;
      const half = 9 + dy * 0.3;
      const dx = x - cx;
      if (Math.abs(dx) > half) return;
      out.y += power * (1 - dy / reach) * (1 - (dx / half) ** 2);
    },
    update(ctx) {
      acc += ctx.dt * 16;
      while (acc > 1) {
        acc -= 1;
        const life = 0.7 + Math.random() * 0.6;
        ctx.particles.spawn({ x: sx + Math.random() * 3, y: sy, vx: 10 + Math.random() * 14, vy: -70 - Math.random() * 40, life, max: life, size: Math.random() < 0.4 ? 2 : 1, ...steamCol, a: 0.5, drag: 1.1 });
      }
    },
    trigger() {
      return { x: sx - 8, y: sy - 80, w: 30, h: 80 };
    },
    onTouch(ctx) {
      ctx.api.soak(0.35 * ctx.dt);
    },
    sound() {
      return { loop: 'vent', x: sx, y: sy - 30, vol: 0.35 };
    },
    airflow() {
      // the jet leans away from the spout as it rises and dies away at `reach`
      const yEnd = Math.max(sy - reach, 0);
      const d1 = sy - yEnd;
      const h0 = 0.5 * (9 + 2 * 0.3);
      const h1 = 0.5 * (9 + d1 * 0.3);
      const c0 = sx + 2 * 0.12;
      const c1 = sx + d1 * 0.12;
      return [{ lines: fanOut(3, { x: c0 - h0, y: sy - 2 }, { x: c0 + h0, y: sy - 2 }, { x: c1 - h1, y: yEnd }, { x: c1 + h1, y: yEnd }), power, fade: 50 }];
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Cuckoo clock: every few seconds the doors open and the bird shoots out sideways (it blocks the way).

export const cuckooClock: ObjFactory = (def, id, gfx) => {
  const every = num(def.every, 6);
  const dir = num(def.dir, 1) >= 0 ? 1 : -1;
  const sprite = gfx?.createSprite(30, 14, 0, 5) ?? null;
  const px = sprite ? new Px(sprite.canvas, 5) : null;
  let timer = num(def.phase, 2);
  let out = 0; // 0..1 how far the bird is out
  let showing = 0;
  let frame = -1;
  const doorX = def.x + 22;
  const doorY = def.y + 13;
  const draw = (f: number) => {
    if (!px || !sprite) return;
    px.ctx.clearRect(0, 0, 30, 14);
    // the arm (a spring) and the bird
    const bx = dir > 0 ? 4 + f * 3 : 26 - f * 3;
    px.hline(dir > 0 ? 0 : bx, 7, Math.abs(bx - (dir > 0 ? 0 : 30)), R.brass[3]);
    px.ellipse(bx, 7, 5, 4, R.leaf[3]);
    px.ellipse(bx + dir * 4, 5, 3, 3, R.leaf[4]);
    px.px(bx + dir * 5, 4, R.ink[0]);
    px.rect(bx + dir * 7 - (dir < 0 ? 2 : 0), 5, 3, 2, R.mustard[4]);
    px.ellipse(bx - dir * 4, 8, 3, 2, R.leaf[2]);
    sprite.refresh();
  };
  return {
    id,
    def,
    update(ctx) {
      timer -= ctx.dt;
      if (timer <= 0 && showing <= 0) {
        showing = 1.6;
        ctx.api.sfx('cuckoo');
      }
      if (showing > 0) {
        showing -= ctx.dt;
        out = Math.min(1, out + ctx.dt * 8);
        if (showing <= 0) timer = every;
      } else out = Math.max(0, out - ctx.dt * 6);
      const f = Math.round(out * 6);
      if (f !== frame) {
        frame = f;
        if (f === 0) sprite?.set(0, 0, false);
        else {
          draw(f);
          sprite?.set(dir > 0 ? doorX : doorX - 30, doorY - 7, true);
        }
      }
    },
    colliders() {
      if (out < 0.3) return [];
      const len = 8 + out * 18;
      return [{ x: dir > 0 ? doorX : doorX - len, y: doorY - 5, w: len, h: 10 }];
    },
    dispose() {
      sprite?.dispose();
    },
  };
};

/** The kitchen range: warm air rises off the whole hob, and its kettle steams (unless `kettle: false`). */
export const stove: ObjFactory = (def, id, gfx, room) => {
  const w = def.w ?? 124;
  const power = num(def.power, 2.6);
  const steam = def.kettle === false ? null : kettle({ ...def, t: 'kettle', x: def.x + 8, y: def.y - 22 }, id, gfx, room);
  return {
    id,
    def,
    wind(x, y, out) {
      if (y < def.y - 2 && y > LAYOUT.ceiling) {
        const k = bump(x, def.x - 12, def.x + w + 12);
        if (k > 0) out.y += power * k * Math.max(0.5, 1 - (def.y - y) / 300);
      }
      steam?.wind?.(x, y, out);
    },
    update: steam?.update,
    trigger: steam?.trigger,
    onTouch: steam?.onTouch,
    sound: () => ({ loop: 'vent', x: def.x + w / 2, y: def.y - 20, vol: 0.4 }),
    airflow() {
      // warm air off the hob; lines start above the kettle and the stovepipe rather than through them
      const a = def.x - 12;
      const b = def.x + w + 12;
      const lines = [0.18, 0.39, 0.61, 0.82].map((u) => {
        const x = lerp(a, b, u);
        let y0 = def.y - 3;
        if (steam && x > def.x + 4 && x < def.x + 40) y0 = def.y - 30;
        if (x > def.x + w - 32 && x < def.x + w - 13) y0 = def.y - 56;
        return [
          { x, y: y0 },
          { x, y: LAYOUT.ceiling },
        ];
      });
      const flows: AirFlow[] = [{ lines, power, warm: true }];
      return steam?.airflow ? flows.concat(steam.airflow()) : flows;
    },
  };
};
