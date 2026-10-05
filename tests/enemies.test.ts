/** Glider PRO's enemies and hazards: how they move, what touching them does, rubber bands, and the headless judge. */

import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../src/game/objects';
import type { GameObject, ObjCtx, SessionApi } from '../src/game/objects/types';
import { buildSimRoom, simulateRoom } from '../src/game/sim';
import { analyzeDesign } from '../src/paper/aero';
import { buildMesh } from '../src/paper/build';
import { RECIPES } from '../src/paper/recipes';
import { crumple, freshDamage, structural } from '../src/physics/damage';
import { LAYOUT, type ItemDef, type RoomDef } from '../src/world/types';

interface Calls {
  strike: { amount: number; from: { x: number; y: number } }[];
  snag: { x: number; y: number }[];
  soak: number[];
  burn: number[];
  sfx: string[];
}

function harness(switches: Record<string, boolean> = {}) {
  const calls: Calls = { strike: [], snag: [], soak: [], burn: [], sfx: [] };
  const api = {
    strike: (amount: number, from: { x: number; y: number }) => void calls.strike.push({ amount, from }),
    snag: (x: number, y: number) => void calls.snag.push({ x, y }),
    soak: (a: number) => void calls.soak.push(a),
    burnDamage: (a: number) => void calls.burn.push(a),
    sfx: (n: string) => void calls.sfx.push(n),
    shake: () => {},
    switchOn: (g: string) => switches[g] ?? true,
  } as unknown as SessionApi;
  const ctx: ObjCtx = { dt: 1 / 60, time: 0, particles: { spawn() {} }, api };
  return { calls, ctx };
}

const make = (it: ItemDef): GameObject => OBJECTS[it.t](it, `test:${it.t}`, null, { dark: false, night: false });

/** Run an object for `secs`, calling `each` after every tick. */
function run(o: GameObject, ctx: ObjCtx, secs: number, each?: (t: number) => void) {
  for (let t = 0; t < secs; t += ctx.dt) {
    o.update?.(ctx);
    each?.(t);
  }
}

describe('enemies', () => {
  it('a balloon waits out its delay, rises from the floor to the ceiling at Glider PRO speed, and comes back', () => {
    const { ctx } = harness();
    const b = make({ t: 'balloon', x: 200, y: 340, delay: 1 });
    expect(b.trigger!()).toBeNull();
    const seen: { t: number; y: number }[] = [];
    run(b, ctx, 12, (t) => {
      const r = b.trigger!();
      if (r) seen.push({ t, y: r.y });
    });
    expect(seen.length).toBeGreaterThan(0);
    // first seen after about its delay, near the floor
    expect(seen[0].t).toBeGreaterThan(0.9);
    expect(seen[0].t).toBeLessThan(1.1);
    expect(seen[0].y + 30).toBeGreaterThan(LAYOUT.floor - 60);
    // rises about 64 px/s, up to the ceiling
    const a = seen[0];
    const z = seen.find((s) => s.t > a.t + 1)!;
    expect((a.y - z.y) / (z.t - a.t)).toBeCloseTo(64, 0);
    expect(Math.min(...seen.map((s) => s.y))).toBeLessThan(LAYOUT.ceiling + 12);
    // and it comes round again
    const gaps = seen.filter((s, i) => i > 0 && s.t - seen[i - 1].t > 0.5);
    expect(gaps.length).toBeGreaterThan(0);
  });

  it('flying into a balloon crumples the plane by half and bursts it; a rubber band bursts it harmlessly', () => {
    const { calls, ctx } = harness();
    const b = make({ t: 'balloon', x: 200, y: 340, delay: 0.3 });
    run(b, ctx, 1);
    expect(b.trigger!()).not.toBeNull();
    b.onTouch!(ctx);
    expect(calls.strike).toHaveLength(1);
    expect(calls.strike[0].amount).toBe(0.5);
    expect(calls.sfx).toContain('pop');
    expect(b.trigger!()).toBeNull();
    // the next one, shot down
    run(b, ctx, 1);
    const r = b.trigger!()!;
    expect(b.shot!(r.x + r.w / 2, r.y + r.h / 2, ctx)).toBe(true);
    expect(b.trigger!()).toBeNull();
    expect(calls.strike).toHaveLength(1);
    // a band that misses
    expect(b.shot!(10, 10, ctx)).toBe(false);
  });

  it('a switched-off balloon never comes', () => {
    const { ctx } = harness({ g1: false });
    const b = make({ t: 'balloon', x: 200, y: 340, delay: 0.3, group: 'g1' });
    let seen = false;
    run(b, ctx, 5, () => (seen ||= !!b.trigger!()));
    expect(seen).toBe(false);
  });

  it('a toy helicopter comes down on a slant, the way it faces', () => {
    const { ctx } = harness();
    for (const dir of [1, -1]) {
      const c = make({ t: 'copter', x: 300, y: 16, dir, delay: 0.2 });
      const seen: { x: number; y: number }[] = [];
      run(c, ctx, 4, () => {
        const r = c.trigger!();
        if (r) seen.push({ x: r.x, y: r.y });
      });
      const a = seen[0];
      const z = seen[seen.length - 1];
      expect(z.y).toBeGreaterThan(a.y + 200);
      expect(Math.sign(z.x - a.x)).toBe(dir);
      // twice as fast down as across, as in Glider PRO
      expect((z.y - a.y) / Math.abs(z.x - a.x)).toBeCloseTo(64 / 37, 1);
    }
  });

  it('a dart sails in from one wall and right across the room, sinking a little', () => {
    const { ctx } = harness();
    const d = make({ t: 'dart', x: 600, y: 80, dir: -1, delay: 0.2 });
    const seen: { x: number; y: number }[] = [];
    run(d, ctx, 3, () => {
      const r = d.trigger!();
      if (r) seen.push({ x: r.x, y: r.y });
    });
    expect(seen[0].x).toBeGreaterThan(500);
    expect(Math.min(...seen.map((s) => s.x))).toBeLessThan(40);
    expect(seen[seen.length - 1].y).toBeGreaterThan(seen[0].y + 50);
  });

  it('a ball bounces to the height it was given', () => {
    const { ctx } = harness();
    const b = make({ t: 'ball', x: 300, y: 340, height: 120 });
    let top = 999;
    run(b, ctx, 4, () => (top = Math.min(top, b.trigger!()!.y + 30)));
    // the ball's bottom rises to about 120 px above the floor
    expect(340 - top).toBeGreaterThan(110);
    expect(340 - top).toBeLessThan(130);
  });

  it('a goldfish leaps out of its bowl and soaks the plane it hits', () => {
    const { calls, ctx } = harness();
    const f = make({ t: 'fish', x: 100, y: 220, height: 100, delay: 0.5 });
    let top = 999;
    run(f, ctx, 3, () => {
      const r = f.trigger!();
      if (r) top = Math.min(top, r.y + 9);
    });
    // the water line is 10 px below the bowl's top: the fish clears it by about the height
    expect(230 - top).toBeGreaterThan(85);
    expect(230 - top).toBeLessThan(110);
    run(f, ctx, 3, () => {
      if (f.trigger!() && !calls.strike.length) f.onTouch!(ctx);
    });
    expect(calls.strike).toHaveLength(1);
    expect(calls.soak).toHaveLength(1);
  });

  it('a cobweb snags the plane, then lets it be for a moment', () => {
    const { calls, ctx } = harness();
    const w = make({ t: 'cobweb', x: 20, y: 20, w: 60, h: 40 });
    expect(w.trigger!()).not.toBeNull();
    w.onTouch!(ctx);
    expect(calls.snag).toHaveLength(1);
    expect(w.trigger!()).toBeNull();
    run(w, ctx, 3);
    expect(w.trigger!()).not.toBeNull();
  });

  it('an outlet is only dangerous while it sparks', () => {
    const { calls, ctx } = harness();
    const o = make({ t: 'outlet', x: 300, y: 250, delay: 1 });
    let sparking = 0;
    let quiet = 0;
    run(o, ctx, 4.2, () => (o.trigger!() ? sparking++ : quiet++));
    // a second of sparks every second and a bit
    expect(sparking * ctx.dt).toBeGreaterThan(1.5);
    expect(quiet * ctx.dt).toBeGreaterThan(1.5);
    expect(calls.sfx).toContain('zap');
  });

  it('a shredder that is on destroys the plane; one that is off does nothing', () => {
    const { calls, ctx } = harness({ off: false });
    const s = make({ t: 'shredder', x: 400, y: 218 });
    run(s, ctx, 0.1);
    expect(s.trigger!()).not.toBeNull();
    s.onTouch!(ctx);
    expect(calls.strike[0].amount).toBe(1);
    const off = make({ t: 'shredder', x: 400, y: 218, group: 'off' });
    run(off, ctx, 0.1);
    expect(off.trigger!()).toBeNull();
  });
});

describe('clutter', () => {
  it('a grease can tips over once, and does the plane no harm', () => {
    const { calls, ctx } = harness();
    const g = make({ t: 'grease', x: 300, y: 243, dir: -1 });
    run(g, ctx, 0.1);
    expect(g.trigger!()).not.toBeNull();
    g.onTouch!(ctx);
    run(g, ctx, 1);
    expect(g.trigger!()).toBeNull();
    expect(calls.strike).toHaveLength(0);
  });

  it('a guitar strums and chimes ring once each time the plane comes through', () => {
    for (const [t, sound] of [
      ['guitar', 'strum'],
      ['chimes', 'chime'],
    ] as const) {
      const { calls, ctx } = harness();
      const o = make({ t, x: 400, y: 100 });
      for (let k = 0; k < 10; k++) {
        o.update!(ctx);
        o.onTouch!(ctx);
      }
      expect(calls.sfx.filter((n) => n === sound)).toHaveLength(1);
      o.update!(ctx);
      o.update!(ctx);
      o.onTouch!(ctx);
      expect(calls.sfx.filter((n) => n === sound)).toHaveLength(2);
    }
  });
});

describe('crumpling', () => {
  it('a blow takes its amount off the structure, and a full one destroys the plane', () => {
    for (const part of ['nose', 'wingL', 'tail', 'body'] as const) {
      const d = freshDamage();
      crumple(d, part, 0.3);
      expect(structural(d)).toBeCloseTo(0.3, 5);
      crumple(d, part, 0.3);
      expect(structural(d)).toBeCloseTo(0.6, 5);
      const e = freshDamage();
      crumple(e, part, 1);
      expect(structural(e)).toBe(1);
    }
  });
});

describe('the headless judge', () => {
  it('fails a flight that meets a balloon on its way up', () => {
    const { build, aero } = analyzeDesign(RECIPES.find((r) => r.id === 'glider')!.make());
    const mesh = buildMesh(build, aero.cg);
    const room: RoomDef = {
      id: 'test',
      name: 'Test',
      wall: { pattern: 'plain', base: 'cream', accent: 'cream', wainscot: null, trim: 'cream' },
      floor: { kind: 'planks', ramp: 'oak' },
      exits: { right: { from: 0, to: 340 } },
      seed: 1,
      items: [{ t: 'balloon', x: 300, y: 340, delay: 0.1 }],
    } as RoomDef;
    // drifting slowly right over the balloon's path as it comes up
    const start = { x: 305, y: 290, vx: 1, vy: 0, facing: 1 as const };
    const r = simulateRoom(buildSimRoom(room), aero, mesh, start, undefined, { maxT: 4 });
    expect(r.outcome).toBe('hazard');
    // without the balloon the same flight carries on
    const clear = simulateRoom(buildSimRoom({ ...room, items: [] }), aero, mesh, start, undefined, { maxT: 4 });
    expect(clear.outcome).not.toBe('hazard');
  });
});
