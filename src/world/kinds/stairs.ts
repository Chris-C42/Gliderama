/** Stairs between floors: a flight up to a doorway on a landing, and a stairwell going down (see world/stairs). */

import { R, type Ramp } from '../../render/palette';
import type { ItemDef } from '../types';
import { LAYOUT } from '../types';
import { stairsDownGeom, stairsUpGeom } from '../stairs';
import { floorShadow } from './home';
import type { KindDef } from './types';

/** Wood and a stair runner: v 0 walnut / red, 1 oak / moss, 2 pine / navy. */
function look(it: ItemDef): { wood: Ramp; runner: Ramp } {
  const v = (it.v ?? 0) % 3;
  return v === 1 ? { wood: R.oak, runner: R.moss } : v === 2 ? { wood: R.pine, runner: R.navy } : { wood: R.walnut, runner: R.red };
}

export const stairsUpKind: KindDef = {
  z: 1,
  paint(px, it) {
    const g = stairsUpGeom(it);
    const { wood, runner } = look(it);
    const floor = LAYOUT.floor;
    const top = g.landing.y;
    const dir = g.dir;
    const run = (g.head - g.foot) / g.steps; // signed
    const rise = (floor - top) / g.steps;
    const far = dir > 0 ? g.landing.x1 : g.landing.x0;
    floorShadow(px, Math.min(g.foot, far), Math.abs(far - g.foot));

    // the closed side of the flight and the wall under the landing, panelled
    const body: [number, number][] = [[g.foot, floor]];
    for (let i = 0; i < g.steps; i++) {
      const xa = g.foot + run * i;
      const ya = floor - rise * (i + 1);
      body.push([xa, ya], [xa + run, ya]);
    }
    body.push([far, top], [far, floor]);
    px.poly(body, wood[3]);
    // a long moulded panel along the slope
    const inset: [number, number][] = [
      [g.foot + dir * 30, floor - 6],
      [g.head - dir * 6, top + 30],
      [g.head - dir * 6, floor - 6],
    ];
    px.poly(inset, wood[2]);
    px.line(inset[0][0], inset[0][1], inset[1][0], inset[1][1], wood[4]);
    px.vline(Math.round(inset[1][0]), Math.round(inset[1][1]), Math.round(floor - 6 - inset[1][1]), wood[1]);

    // treads, risers and the runner
    for (let i = 0; i < g.steps; i++) {
      const x0 = Math.min(g.foot + run * i, g.foot + run * (i + 1));
      const w = Math.abs(run);
      const y = Math.round(floor - rise * (i + 1));
      const rx = dir > 0 ? x0 : x0 + w - 1; // the riser is on the foot side of each tread
      px.vline(rx, y, Math.ceil(rise), wood[2]);
      px.rect(x0, y, w + 1, 3, wood[4]);
      px.hline(x0, y, w + 1, wood[5]);
      px.rect(x0 + 2, y - 1, w - 3, 2, runner[3]);
      px.hline(x0 + 2, y - 1, w - 3, runner[4]);
    }
    // the landing
    px.rect(g.landing.x0, top, g.landing.x1 - g.landing.x0, 5, wood[4]);
    px.hline(g.landing.x0, top, g.landing.x1 - g.landing.x0, wood[5]);
    px.hline(g.landing.x0, top + 5, g.landing.x1 - g.landing.x0, wood[1]);

    // the way up: a dark doorway with the next flight just showing inside
    const d = g.door;
    px.rect(d.x - 5, d.y - 7, d.w + 10, d.h + 7, wood[4]);
    px.hline(d.x - 7, d.y - 8, d.w + 14, wood[5]);
    px.rect(d.x - 7, d.y - 7, d.w + 14, 3, wood[3]);
    px.vgrad(d.x, d.y, d.w, d.h, [R.ink[0], R.ink[1], R.ink[2]]);
    for (let k = 0; k < 4; k++) {
      const sx = dir > 0 ? d.x + 6 + k * 10 : d.x + d.w - 16 - k * 10;
      const sy = d.y + d.h - 10 - k * 11;
      px.hline(sx, sy, 10, R.ink[3 + (k < 2 ? 1 : 0)]);
    }

    // handrail, balusters and newel posts
    const railUp = 30;
    const rail0 = { x: g.foot + dir * 6, y: floor - rise - railUp };
    const rail1 = { x: g.head, y: top - railUp };
    for (let i = 1; i < g.steps; i += 1) {
      const bx = Math.round(g.foot + run * (i + 0.5));
      const by = Math.round(floor - rise * (i + 1));
      const t = (bx - rail0.x) / (rail1.x - rail0.x);
      const ry = Math.round(rail0.y + (rail1.y - rail0.y) * t);
      if (ry < by) px.vline(bx, ry, by - ry, wood[3]);
    }
    px.line(rail0.x, rail0.y, rail1.x, rail1.y, wood[4]);
    px.line(rail0.x, rail0.y - 1, rail1.x, rail1.y - 1, wood[5]);
    px.line(rail0.x, rail0.y + 1, rail1.x, rail1.y + 1, wood[2]);
    const post = (x: number, y0: number, y1: number) => {
      px.rect(x - 3, y0, 7, y1 - y0, wood[3]);
      px.vline(x - 3, y0, y1 - y0, wood[5]);
      px.vline(x + 3, y0, y1 - y0, wood[1]);
      px.ellipse(x, y0 - 1, 4, 3, wood[4]);
    };
    post(g.foot + dir * 4, floor - rise - railUp - 4, floor);
    post(g.head, top - railUp - 4, top);
  },
};

export const stairsDownKind: KindDef = {
  z: 1,
  paint(px, it) {
    const g = stairsDownGeom(it);
    const { wood, runner } = look(it);
    const { x, w } = g.well;
    const y0 = LAYOUT.wallBase;
    const H = 360;
    // the stairwell: dark, darker further down
    px.rect(x, y0 + 2, w, H - y0 - 2, R.ink[0]);
    px.vgrad(x + 2, y0 + 2, w - 4, H - y0 - 2, [R.ink[2], R.ink[1], R.ink[0]]);
    // the first steps going down, fading into the dark
    const steps = 5;
    const run = (w - 8) / steps;
    for (let i = 0; i < steps; i++) {
      const sx = g.dir > 0 ? x + 4 + run * i : x + w - 4 - run * (i + 1);
      const sy = y0 + 6 + i * 11;
      if (sy > H - 4) break;
      const k = Math.max(0, 4 - i);
      px.rect(sx, sy, run + 1, 3, wood[Math.min(k + 1, wood.length - 1)]);
      if (i < 3) px.rect(sx + 2, sy - 1, run - 3, 2, runner[Math.max(1, 3 - i)]);
      px.vline(g.dir > 0 ? sx : sx + run, sy, 11, wood[Math.max(0, k - 1)]);
    }
    px.dither(x + 2, y0 + 30, w - 4, H - y0 - 30, R.ink[0], 0.5);
    // a low gallery rail along the back of the well, with newel posts at the ends
    const ry = y0 - 22;
    for (let bx = x + 8; bx < x + w - 6; bx += 9) px.rect(bx, ry + 4, 2, y0 - ry - 2, wood[3]);
    px.rect(x - 2, ry, w + 4, 4, wood[4]);
    px.hline(x - 2, ry, w + 4, wood[5]);
    for (const nx of [x - 4, x + w - 3]) {
      px.rect(nx, ry - 8, 7, y0 - ry + 10, wood[3]);
      px.vline(nx, ry - 8, y0 - ry + 10, wood[5]);
      px.ellipse(nx + 3, ry - 9, 4, 3, wood[4]);
    }
  },
};
