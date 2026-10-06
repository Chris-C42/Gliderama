/** Objects for the Classic Houses (Glider PRO houses): transports. */

import { rgb } from '../../render/particles';
import { groupOn } from './air';
import type { ObjFactory } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);

/** Seconds after coming out of a transport before another one takes the plane (it may come out in one's mouth). */
export const TRANSPORT_REST = 0.6;
const glint = rgb('#e8f2ff');

/**
 * A transport (Glider PRO's ducts, mail slots and invisible transporters): fly into the rectangle x, y, w, h and
 * come out at (ax, ay) in room `to`, facing `facing`, gliding level again. `group` switches it on and off.
 */
export const transport: ObjFactory = (def, id) => {
  const w = def.w ?? 60;
  const h = def.h ?? 40;
  const to = typeof def.to === 'string' ? def.to : null;
  const ax = num(def.ax, 320);
  const ay = num(def.ay, 180);
  const facing: 1 | -1 = num(def.facing, 1) < 0 ? -1 : 1;
  const group = typeof def.group === 'string' ? def.group : null;
  // the plane has to be well inside, not just brush the edge
  const trig = {
    x: def.x + Math.min(8, w / 4),
    y: def.y + Math.min(6, h / 4),
    w: Math.max(8, w - Math.min(16, w / 2)),
    h: Math.max(8, h - Math.min(12, h / 2)),
  };
  let on = !group || !group.startsWith('!');
  let acc = 0;
  return {
    id,
    def,
    update(ctx) {
      if (group) on = groupOn(ctx.api, group);
      if (!on) return;
      // a faint shimmer marks the way in
      acc += ctx.dt * 3;
      while (acc > 1) {
        acc -= 1;
        ctx.particles.spawn({ x: def.x + Math.random() * w, y: def.y + Math.random() * h, vy: -8, life: 0.6, max: 0.6, ...glint, a: 0.5 });
      }
    },
    trigger() {
      return on && to ? trig : null;
    },
    onTouch(ctx) {
      if (on && to) ctx.api.transport(to, ax, ay, facing);
    },
  };
};
