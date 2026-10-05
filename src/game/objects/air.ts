/** Air movers: floor & ceiling vents, desk fans, radiators. */

import { R } from '../../render/palette';
import { Px } from '../../render/pixel';
import { rgb } from '../../render/particles';
import { LAYOUT } from '../../world/types';
import { fanOut, lerp, lineCount } from './airflow';
import type { ObjFactory, SessionApi } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const wisp = rgb('#eaf2ff');
const warm = rgb('#ffe2b8');

/**
 * Whether an air mover on switch group `group` is running. A group starting with '!' runs while its switch is
 * off (Glider PRO blowers that start off and are switched on).
 */
export function groupOn(api: SessionApi, group: string): boolean {
  return group.startsWith('!') ? !api.switchOn(group.slice(1)) : api.switchOn(group);
}

/** The initial state of a group (switches start on). */
const groupStartsOn = (group: string | null) => !group || !group.startsWith('!');

/** Smooth bump: 1 in the middle of [a, b], easing to 0 at the edges (gentle entry). */
function bump(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0;
  const t = (x - a) / (b - a);
  return Math.sin(Math.PI * t) ** 1.5;
}

export const floorVent: ObjFactory = (def, id) => {
  const w = def.w ?? 48;
  const power = num(def.power, 3.2); // m/s at the grille
  const top = num(def.reach, LAYOUT.ceiling);
  const group = typeof def.group === 'string' ? def.group : null;
  const baseY = LAYOUT.floor - 4;
  /** How fast the column widens with height (chimney-like when small). */
  const flare = num(def.spread, 0.22);
  let acc = 0;
  return {
    id,
    def,
    wind(x, y, out) {
      if (group && !this.on) return;
      if (y > baseY + 6 || y < top) return;
      const h = baseY - y;
      const spread = 30 + h * flare;
      const k = bump(x, def.x - spread, def.x + w + spread);
      if (k <= 0) return;
      const decay = Math.max(0.35, 1 - (0.45 * h) / Math.max(40, baseY - top));
      out.y += power * k * decay;
    },
    on: groupStartsOn(group),
    sound() {
      return this.on ? { loop: 'vent', x: def.x + w / 2, y: baseY, vol: Math.min(1, 0.45 + power / 8) } : null;
    },
    airflow() {
      // from the grille up to `reach`, widening like the column does (past the top of the room, the air
      // carries on through a ceiling opening: see game/roomAir)
      const yEnd = top;
      const sp = 30 + (baseY - yEnd) * flare;
      const a = def.x - sp;
      const b = def.x + w + sp;
      const n = lineCount((w * 0.76 + (b - a) * 0.5) / 2, 30, 2, 6);
      const lines = fanOut(n, { x: def.x + w * 0.12, y: baseY }, { x: def.x + w * 0.88, y: baseY }, { x: lerp(a, b, 0.25), y: yEnd }, { x: lerp(a, b, 0.75), y: yEnd });
      return [{ lines, power, on: group ? () => this.on : undefined }];
    },
    update(ctx) {
      if (group) this.on = groupOn(ctx.api, group);
      if (!this.on) return;
      acc += ctx.dt * (6 + w * 0.12) * Math.min(1.6, power / 3.6);
      while (acc > 1) {
        acc -= 1;
        const x = def.x + 4 + Math.random() * (w - 8);
        const life = 0.8 + Math.random() * 1.2;
        ctx.particles.spawn({
          x,
          y: baseY,
          vx: (Math.random() - 0.5) * 8,
          vy: -(60 + Math.random() * 50) * (power / 3.2),
          life,
          max: life,
          size: Math.random() < 0.25 ? 2 : 1,
          ...wisp,
          a: 0.55,
          drag: 0.5,
        });
      }
    },
  } as ReturnType<ObjFactory> & { on: boolean };
};

export const ceilingVent: ObjFactory = (def, id) => {
  const w = def.w ?? 48;
  const power = num(def.power, 2.2);
  const bottom = num(def.reach, LAYOUT.floor);
  const y0 = LAYOUT.ceiling + 2;
  const group = typeof def.group === 'string' ? def.group : null;
  let on = groupStartsOn(group);
  let acc = 0;
  return {
    id,
    def,
    wind(x, y, out) {
      if (!on || y < y0 || y > bottom) return;
      const h = y - y0;
      const spread = 6 + h * 0.12;
      const k = bump(x, def.x - spread, def.x + w + spread);
      if (k <= 0) return;
      const decay = Math.max(0.25, 1 - (0.6 * h) / Math.max(40, bottom - y0));
      out.y -= power * k * decay;
    },
    sound() {
      return on ? { loop: 'vent', x: def.x + w / 2, y: y0, vol: 0.5 } : null;
    },
    airflow() {
      const yEnd = bottom;
      const sp = 6 + (yEnd - y0) * 0.12;
      const a = def.x - sp;
      const b = def.x + w + sp;
      const n = lineCount((w * 0.76 + (b - a) * 0.6) / 2, 26, 2, 5);
      const lines = fanOut(
        n,
        { x: def.x + w * 0.12, y: y0 + 5 },
        { x: def.x + w * 0.88, y: y0 + 5 },
        { x: lerp(a, b, 0.2), y: yEnd },
        { x: lerp(a, b, 0.8), y: yEnd },
      );
      return [{ lines, power, on: group ? () => on : undefined }];
    },
    update(ctx) {
      if (group) on = groupOn(ctx.api, group);
      if (!on) return;
      acc += ctx.dt * (5 + w * 0.1);
      while (acc > 1) {
        acc -= 1;
        const life = 0.8 + Math.random();
        ctx.particles.spawn({
          x: def.x + 4 + Math.random() * (w - 8),
          y: y0 + 4,
          vx: (Math.random() - 0.5) * 6,
          vy: 60 + Math.random() * 40,
          life,
          max: life,
          ...wisp,
          a: 0.3,
          drag: 0.4,
        });
      }
    },
  };
};

/** Desk fan: animated blades; blows horizontally in direction `dir` (default +1). */
export const deskFan: ObjFactory = (def, id, gfx) => {
  const dir = num(def.dir, 1) >= 0 ? 1 : -1;
  const power = num(def.power, 3.2);
  const reach = num(def.reach, 280);
  const group = typeof def.group === 'string' ? def.group : null;
  // fan head centre
  const cx = def.x + 16;
  const cy = def.y + 16;
  const sprite = gfx?.createSprite(36, 36, 0, 8) ?? null;
  const px = sprite ? new Px(sprite.canvas, 3) : null;
  let angle = 0;
  let frame = -1;
  let on = groupStartsOn(group);
  let acc = 0;
  const draw = (f: number) => {
    if (!px || !sprite) return;
    px.ctx.clearRect(0, 0, 36, 36);
    const c = 18;
    // blades
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + f * (Math.PI / 6);
      const bx = c + Math.cos(a) * 8;
      const by = c + Math.sin(a) * 8;
      px.ellipse(bx, by, 5, 3, R.sky[3]);
    }
    px.ellipse(c, c, 3, 3, R.steel[2]);
    // cage rings and spokes
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      px.px(c + Math.cos(a) * 14, c + Math.sin(a) * 14, R.steel[4]);
      px.px(c + Math.cos(a) * 15, c + Math.sin(a) * 15, R.steel[2]);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      px.line(c + Math.cos(a) * 4, c + Math.sin(a) * 4, c + Math.cos(a) * 14, c + Math.sin(a) * 14, R.steel[3]);
    }
    sprite.refresh();
  };
  draw(0);
  sprite?.set(cx - 18, cy - 18);
  return {
    id,
    def,
    wind(x, y, out) {
      if (!on) return;
      const dx = (x - cx) * dir;
      if (dx < 0 || dx > reach) return;
      const half = 14 + dx * 0.32;
      const dy = Math.abs(y - cy);
      if (dy > half) return;
      const k = (1 - dx / reach) * (1 - (dy / half) ** 2);
      out.x += dir * power * k;
    },
    sound() {
      return on ? { loop: 'fan', x: cx, y: cy, vol: Math.min(1, 0.5 + power / 8) } : null;
    },
    airflow() {
      // a widening cone from the blades out to `reach` (or the edge of the room); it dies away towards the end
      const dxEnd = Math.min(reach, dir > 0 ? 640 - cx : cx);
      const h0 = 0.55 * (14 + 15 * 0.32);
      const h1 = 0.55 * (14 + dxEnd * 0.32);
      const n = lineCount(h1 * 1.2, 30, 3, 5);
      const x0 = cx + dir * 15;
      const x1 = cx + dir * dxEnd;
      const lines = fanOut(n, { x: x0, y: cy - h0 }, { x: x0, y: cy + h0 }, { x: x1, y: cy - h1 }, { x: x1, y: cy + h1 });
      return [{ lines, power, fade: dxEnd < reach ? 0 : Math.min(48, reach * 0.2), on: group ? () => on : undefined }];
    },
    update(ctx) {
      if (group) on = groupOn(ctx.api, group);
      if (on) angle += ctx.dt * 30;
      const f = Math.floor(angle) % 4;
      if (f !== frame) {
        frame = f;
        draw(f);
      }
      if (!on) return;
      acc += ctx.dt * 14;
      while (acc > 1) {
        acc -= 1;
        const life = 0.5 + Math.random() * 0.6;
        ctx.particles.spawn({
          x: cx + dir * 16,
          y: cy + (Math.random() - 0.5) * 22,
          vx: dir * (140 + Math.random() * 80) * (power / 3.2),
          vy: (Math.random() - 0.5) * 30,
          life,
          max: life,
          size: 1,
          ...wisp,
          a: 0.3,
          drag: 1.2,
        });
      }
    },
    colliders() {
      return [{ x: cx - 14, y: cy - 14, w: 28, h: 28 }];
    },
    dispose() {
      sprite?.dispose();
    },
  };
};

/** Radiator: a wide, gentle thermal (warm air shimmer). */
export const radiator: ObjFactory = (def, id) => {
  const w = def.w ?? 90;
  const power = num(def.power, 1.2);
  const baseY = def.y;
  let acc = 0;
  return {
    id,
    def,
    wind(x, y, out) {
      if (y > baseY + 4 || y < LAYOUT.ceiling) return;
      const h = baseY - y;
      const k = bump(x, def.x - 4 - h * 0.08, def.x + w + 4 + h * 0.08);
      if (k <= 0) return;
      out.y += power * k * Math.max(0.3, 1 - h / 280);
    },
    sound() {
      return { loop: 'vent', x: def.x + w / 2, y: baseY, vol: 0.22 };
    },
    airflow() {
      const yEnd = LAYOUT.ceiling;
      const g = (baseY - yEnd) * 0.08;
      const n = lineCount(w * 0.7, 32, 2, 5);
      const lines = fanOut(n, { x: lerp(def.x - 4, def.x + w + 4, 0.16), y: baseY - 2 }, { x: lerp(def.x - 4, def.x + w + 4, 0.84), y: baseY - 2 }, { x: lerp(def.x - 4 - g, def.x + w + 4 + g, 0.2), y: yEnd }, { x: lerp(def.x - 4 - g, def.x + w + 4 + g, 0.8), y: yEnd });
      return [{ lines, power, warm: true }];
    },
    update(ctx) {
      acc += ctx.dt * 5;
      while (acc > 1) {
        acc -= 1;
        const life = 1 + Math.random();
        ctx.particles.spawn({ x: def.x + Math.random() * w, y: baseY, vx: 0, vy: -40 - Math.random() * 20, life, max: life, ...warm, a: 0.22 });
      }
    },
  };
};

/** An invisible rising draft (warm air coming up a shaft): a soft-edged vertical column, no fixture. */
export const draft: ObjFactory = (def, id) => {
  const w = def.w ?? 100;
  const power = num(def.power, 2.4);
  const y0 = def.y;
  const top = num(def.top, 0);
  let acc = 0;
  return {
    id,
    def,
    wind(x, y, out) {
      if (y > y0 || y < top) return;
      const k = bump(x, def.x - 12, def.x + w + 12);
      if (k <= 0) return;
      out.y += power * k * Math.min(1, (y - top) / 70);
    },
    sound() {
      return { loop: 'vent', x: def.x + w / 2, y: Math.min(y0, 330), vol: 0.3 };
    },
    airflow() {
      // no fixture: the lines rise out of the floor (or the room below) and fade where the draft tapers off
      const yStart = y0;
      const yEnd = top;
      const a = def.x - 12;
      const b = def.x + w + 12;
      const n = lineCount((b - a) * 0.64, 34, 2, 5);
      const lines = fanOut(n, { x: lerp(a, b, 0.18), y: yStart }, { x: lerp(a, b, 0.82), y: yStart }, { x: lerp(a, b, 0.18), y: yEnd }, { x: lerp(a, b, 0.82), y: yEnd });
      return [{ lines, power, warm: true, fade: top > 0 ? 56 : 0 }];
    },
    update(ctx) {
      acc += ctx.dt * w * 0.08;
      while (acc > 1) {
        acc -= 1;
        const life = 1 + Math.random();
        ctx.particles.spawn({ x: def.x + Math.random() * w, y: Math.min(y0, 352), vx: (Math.random() - 0.5) * 6, vy: -50 - Math.random() * 30, life, max: life, ...wisp, a: 0.3, drag: 0.3 });
      }
    },
  };
};

/**
 * An invisible current: air moving one way (`dir` up / down / left / right) through the rectangle x, y, w, h,
 * strongest along the middle and dying away over the last stretch downstream. Stands for Glider PRO's
 * invisible blowers and lift areas, and the rising air above its candles. `group` as for vents.
 */
export const current: ObjFactory = (def, id) => {
  const dir = def.dir === 'down' || def.dir === 'left' || def.dir === 'right' ? def.dir : 'up';
  const w = Math.max(4, def.w ?? 60);
  const h = Math.max(4, def.h ?? 200);
  const power = num(def.power, 3);
  const group = typeof def.group === 'string' ? def.group : null;
  const vertical = dir === 'up' || dir === 'down';
  // across the flow: a soft-edged band; along it: full strength until the last `fade` px
  const across = vertical ? w : h;
  const along = vertical ? h : w;
  const fade = Math.min(48, along * 0.3);
  let on = groupStartsOn(group);
  let acc = 0;
  const strength = (x: number, y: number): number => {
    if (x < def.x || x > def.x + w || y < def.y || y > def.y + h) return 0;
    const k = bump(vertical ? x - def.x : y - def.y, -across * 0.08, across * 1.08);
    const d = dir === 'up' ? y - def.y : dir === 'down' ? def.y + h - y : dir === 'left' ? x - def.x : def.x + w - x;
    return k * Math.min(1, d / fade);
  };
  return {
    id,
    def,
    wind(x, y, out) {
      if (!on) return;
      const k = strength(x, y);
      if (k <= 0) return;
      if (dir === 'up') out.y += power * k;
      else if (dir === 'down') out.y -= power * k;
      else if (dir === 'left') out.x -= power * k;
      else out.x += power * k;
    },
    sound() {
      return on && power > 2 ? { loop: 'vent', x: def.x + w / 2, y: def.y + h / 2, vol: 0.2 } : null;
    },
    airflow() {
      // straight lines from the upstream edge to just short of the downstream one, across the middle of the band
      const n = lineCount(across * 0.6, 34, 2, 5);
      const e = 2;
      const L = def.x + e;
      const R = def.x + w - e;
      const T = def.y + e;
      const B = def.y + h - e;
      const a = (k: number) => (vertical ? def.x + w * k : def.y + h * k);
      const lines =
        dir === 'up'
          ? fanOut(n, { x: a(0.2), y: B }, { x: a(0.8), y: B }, { x: a(0.2), y: T }, { x: a(0.8), y: T })
          : dir === 'down'
            ? fanOut(n, { x: a(0.2), y: T }, { x: a(0.8), y: T }, { x: a(0.2), y: B }, { x: a(0.8), y: B })
            : dir === 'right'
              ? fanOut(n, { x: L, y: a(0.2) }, { x: L, y: a(0.8) }, { x: R, y: a(0.2) }, { x: R, y: a(0.8) })
              : fanOut(n, { x: R, y: a(0.2) }, { x: R, y: a(0.8) }, { x: L, y: a(0.2) }, { x: L, y: a(0.8) });
      return [{ lines, power, fade: fade * 0.8, on: group ? () => on : undefined }];
    },
    update(ctx) {
      if (group) on = groupOn(ctx.api, group);
      if (!on) return;
      acc += ctx.dt * across * along * 0.00012;
      while (acc > 1) {
        acc -= 1;
        const life = 0.8 + Math.random() * 0.6;
        const sp = 40 + Math.random() * 30;
        const vx = dir === 'left' ? -sp : dir === 'right' ? sp : (Math.random() - 0.5) * 6;
        const vy = dir === 'up' ? -sp : dir === 'down' ? sp : (Math.random() - 0.5) * 6;
        const x = vertical ? def.x + w * (0.2 + Math.random() * 0.6) : dir === 'right' ? def.x + 2 : def.x + w - 2;
        const y = vertical ? (dir === 'up' ? def.y + h - 2 : def.y + 2) : def.y + h * (0.2 + Math.random() * 0.6);
        ctx.particles.spawn({ x, y: Math.min(352, y), vx, vy, life, max: life, ...wisp, a: 0.22, drag: 0.3 });
      }
    },
  };
};
