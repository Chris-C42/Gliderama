/** Air movers: floor & ceiling vents, desk fans, radiators. */

import { R } from '../../render/palette';
import { Px } from '../../render/pixel';
import { rgb } from '../../render/particles';
import { LAYOUT } from '../../world/types';
import type { ObjFactory } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
const wisp = rgb('#eaf2ff');
const warm = rgb('#ffe2b8');

/** Smooth bump: 1 in the middle of [a, b], 0 at the edges. */
function bump(x: number, a: number, b: number): number {
  if (x <= a || x >= b) return 0;
  const t = (x - a) / (b - a);
  return Math.sin(Math.PI * t) ** 0.6;
}

export const floorVent: ObjFactory = (def, id) => {
  const w = def.w ?? 48;
  const power = num(def.power, 2.6); // m/s at the grille
  const top = num(def.reach, LAYOUT.ceiling);
  const group = typeof def.group === 'string' ? def.group : null;
  const baseY = LAYOUT.floor - 4;
  let acc = 0;
  return {
    id,
    def,
    wind(x, y, out) {
      if (group && !this.on) return;
      if (y > baseY + 6 || y < top) return;
      const h = baseY - y;
      const spread = 6 + h * 0.12;
      const k = bump(x, def.x - spread, def.x + w + spread);
      if (k <= 0) return;
      const decay = Math.max(0.25, 1 - (0.6 * h) / Math.max(40, baseY - top));
      out.y += power * k * decay;
    },
    on: true,
    update(ctx) {
      if (group) this.on = ctx.api.switchOn(group);
      if (!this.on) return;
      acc += ctx.dt * (6 + w * 0.12) * Math.min(1.6, power / 2.6);
      while (acc > 1) {
        acc -= 1;
        const x = def.x + 4 + Math.random() * (w - 8);
        const life = 0.8 + Math.random() * 1.2;
        ctx.particles.spawn({
          x,
          y: baseY,
          vx: (Math.random() - 0.5) * 8,
          vy: -(60 + Math.random() * 50) * (power / 2.6),
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
  let acc = 0;
  return {
    id,
    def,
    wind(x, y, out) {
      if (y < y0 || y > bottom) return;
      const h = y - y0;
      const spread = 6 + h * 0.12;
      const k = bump(x, def.x - spread, def.x + w + spread);
      if (k <= 0) return;
      const decay = Math.max(0.25, 1 - (0.6 * h) / Math.max(40, bottom - y0));
      out.y -= power * k * decay;
    },
    update(ctx) {
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
export const deskFan: ObjFactory = (def, id, renderer) => {
  const dir = num(def.dir, 1) >= 0 ? 1 : -1;
  const power = num(def.power, 3.2);
  const reach = num(def.reach, 280);
  const group = typeof def.group === 'string' ? def.group : null;
  // fan head centre
  const cx = def.x + 16;
  const cy = def.y + 16;
  const sprite = renderer.createSprite(36, 36, 0, 8);
  const px = new Px(sprite.canvas, 3);
  let angle = 0;
  let frame = -1;
  let on = true;
  let acc = 0;
  const draw = (f: number) => {
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
  sprite.set(cx - 18, cy - 18);
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
    update(ctx) {
      if (group) on = ctx.api.switchOn(group);
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
      sprite.dispose();
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
