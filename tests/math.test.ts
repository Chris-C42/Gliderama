import { describe, expect, it } from 'vitest';
import {
  TAU,
  add,
  aabbContains,
  aabbIntersects,
  angleDiff,
  approach,
  clamp,
  closestPointOnSegment,
  contains,
  cross,
  degToRad,
  dist,
  dist2,
  dot,
  easeInOutCubic,
  easeInQuad,
  easeOutBack,
  easeOutCubic,
  easeOutElastic,
  intersects,
  invLerp,
  len,
  len2,
  lerp,
  lerpV,
  norm,
  perp,
  pointSegmentDistance,
  radToDeg,
  remap,
  rotate,
  scale,
  segmentAABB,
  sign,
  smoothstep,
  sub,
  v2,
  wrapAngle,
  type AABB,
} from '../src/core/math';

describe('scalar helpers', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(3, 3, 3)).toBe(3);
  });

  it('lerp / invLerp / remap', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 2)).toBe(30); // not clamped
    expect(invLerp(10, 20, 15)).toBe(0.5);
    expect(invLerp(10, 20, 30)).toBe(2); // not clamped
    expect(invLerp(5, 5, 99)).toBe(0); // degenerate range
    expect(remap(5, 0, 10, 100, 200)).toBe(150);
    expect(remap(0, 0, 10, 200, 100)).toBe(200); // reversed output
    expect(remap(20, 0, 10, 0, 1)).toBe(2); // not clamped
  });

  it('smoothstep', () => {
    expect(smoothstep(0, 1, -5)).toBe(0);
    expect(smoothstep(0, 1, 0)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 1)).toBe(1);
    expect(smoothstep(0, 1, 7)).toBe(1);
    expect(smoothstep(2, 4, 3)).toBe(0.5);
    // monotonic
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = smoothstep(0, 1, i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // degenerate edges act as a step
    expect(smoothstep(1, 1, 0.5)).toBe(0);
    expect(smoothstep(1, 1, 1)).toBe(1);
  });

  it('approach never overshoots', () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(10, 10, 3)).toBe(10);
    expect(approach(0, -10, 3)).toBe(-3);
    expect(approach(-9, -10, 3)).toBe(-10);
    expect(approach(0, 10, -3)).toBe(3); // sign of maxDelta is ignored
    expect(approach(0, 10, 0)).toBe(0);
  });

  it('wrapAngle returns [-PI, PI] and keeps in-range values exactly', () => {
    for (const a of [0, 1, -1, 3, -3, Math.PI, -Math.PI, 0.123456789]) expect(wrapAngle(a)).toBe(a);
    expect(wrapAngle(TAU)).toBeCloseTo(0, 12);
    expect(wrapAngle(-TAU)).toBeCloseTo(0, 12);
    expect(wrapAngle((3 * Math.PI) / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapAngle((-3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(Math.abs(wrapAngle(3 * Math.PI))).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(100 * TAU + 0.5)).toBeCloseTo(0.5, 9);
    expect(wrapAngle(-100 * TAU - 0.5)).toBeCloseTo(-0.5, 9);

    // Sweep: always inside the range and equal to the input modulo a full turn.
    for (let a = -50; a <= 50; a += 0.37) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThanOrEqual(Math.PI);
      expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9);
    }
  });

  it('angleDiff takes the short way round', () => {
    const d = degToRad;
    expect(angleDiff(d(350), d(10))).toBeCloseTo(d(20), 12);
    expect(angleDiff(d(10), d(350))).toBeCloseTo(d(-20), 12);
    expect(angleDiff(0, d(90))).toBeCloseTo(d(90), 12);
    expect(angleDiff(d(90), 0)).toBeCloseTo(d(-90), 12);
    expect(Math.abs(angleDiff(0, Math.PI))).toBeCloseTo(Math.PI, 12);
    expect(angleDiff(1, 1)).toBe(0);
  });

  it('degToRad / radToDeg', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 12);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12);
    expect(radToDeg(degToRad(37.5))).toBeCloseTo(37.5, 12);
  });

  it('sign is always -1, 0 or 1 (never -0 or NaN)', () => {
    expect(sign(5)).toBe(1);
    expect(sign(-0.001)).toBe(-1);
    expect(sign(0)).toBe(0);
    expect(Object.is(sign(-0), 0)).toBe(true);
    expect(sign(NaN)).toBe(0);
  });
});

describe('Vec2 helpers', () => {
  it('v2 defaults to the origin', () => {
    expect(v2()).toEqual({ x: 0, y: 0 });
    expect(v2(3, 4)).toEqual({ x: 3, y: 4 });
  });

  it('arithmetic is non-mutating', () => {
    const a = v2(1, 2);
    const b = v2(10, 20);
    expect(add(a, b)).toEqual({ x: 11, y: 22 });
    expect(sub(b, a)).toEqual({ x: 9, y: 18 });
    expect(scale(a, 3)).toEqual({ x: 3, y: 6 });
    expect(lerpV(a, b, 0.5)).toEqual({ x: 5.5, y: 11 });
    expect(a).toEqual({ x: 1, y: 2 });
    expect(b).toEqual({ x: 10, y: 20 });
  });

  it('dot / cross', () => {
    expect(dot(v2(1, 2), v2(3, 4))).toBe(11);
    expect(cross(v2(1, 0), v2(0, 1))).toBe(1);
    expect(cross(v2(0, 1), v2(1, 0))).toBe(-1);
    expect(cross(v2(2, 2), v2(4, 4))).toBe(0);
  });

  it('len / len2 / dist / dist2', () => {
    expect(len(v2(3, 4))).toBe(5);
    expect(len2(v2(3, 4))).toBe(25);
    expect(dist(v2(1, 1), v2(4, 5))).toBe(5);
    expect(dist2(v2(1, 1), v2(4, 5))).toBe(25);
  });

  it('norm gives unit vectors and never NaN', () => {
    const n = norm(v2(3, 4));
    expect(n.x).toBeCloseTo(0.6, 12);
    expect(n.y).toBeCloseTo(0.8, 12);
    expect(len(n)).toBeCloseTo(1, 12);
    expect(norm(v2(0, 0))).toEqual({ x: 0, y: 0 });
  });

  it('rotate / perp', () => {
    const r = rotate(v2(1, 0), Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.y).toBeCloseTo(1, 12);
    const back = rotate(rotate(v2(2, 3), 1.234), -1.234);
    expect(back.x).toBeCloseTo(2, 12);
    expect(back.y).toBeCloseTo(3, 12);
    const p = perp(v2(1, 0));
    expect(p.x).toBeCloseTo(0, 12);
    expect(p.y).toBe(1);
    expect(perp(v2(3, 4))).toEqual({ x: -4, y: 3 });
    expect(dot(v2(3, 4), perp(v2(3, 4)))).toBe(0);
  });
});

describe('AABB', () => {
  const box: AABB = { x: 10, y: 0, w: 10, h: 10 };

  it('contains is half-open (min edge in, max edge out)', () => {
    expect(aabbContains(box, v2(15, 5))).toBe(true);
    expect(aabbContains(box, v2(10, 0))).toBe(true);
    expect(aabbContains(box, v2(20, 5))).toBe(false);
    expect(aabbContains(box, v2(15, 10))).toBe(false);
    expect(aabbContains(box, v2(9.99, 5))).toBe(false);
    expect(contains).toBe(aabbContains);
  });

  it('intersects needs positive-area overlap', () => {
    expect(aabbIntersects(box, { x: 15, y: 5, w: 10, h: 10 })).toBe(true);
    expect(aabbIntersects(box, { x: 12, y: 2, w: 2, h: 2 })).toBe(true); // contained
    expect(aabbIntersects(box, { x: 20, y: 0, w: 5, h: 5 })).toBe(false); // touching edges
    expect(aabbIntersects(box, { x: 30, y: 30, w: 5, h: 5 })).toBe(false);
    expect(aabbIntersects({ x: 12, y: 2, w: 2, h: 2 }, box)).toBe(true); // symmetric
    expect(intersects).toBe(aabbIntersects);
  });
});

describe('segmentAABB', () => {
  const box: AABB = { x: 10, y: 0, w: 10, h: 10 };

  it('enters through the left face', () => {
    const hit = segmentAABB(v2(0, 5), v2(30, 5), box)!;
    expect(hit.t).toBeCloseTo(1 / 3, 12);
    expect(hit.normal).toEqual({ x: -1, y: 0 });
  });

  it('enters through the right face', () => {
    const hit = segmentAABB(v2(30, 5), v2(0, 5), box)!;
    expect(hit.t).toBeCloseTo(1 / 3, 12);
    expect(hit.normal).toEqual({ x: 1, y: 0 });
  });

  it('enters through the top face (y-down: normal points to -y)', () => {
    const hit = segmentAABB(v2(15, -10), v2(15, 20), box)!;
    expect(hit.t).toBeCloseTo(1 / 3, 12);
    expect(hit.normal).toEqual({ x: 0, y: -1 });
  });

  it('enters through the bottom face', () => {
    const hit = segmentAABB(v2(15, 20), v2(15, -10), box)!;
    expect(hit.t).toBeCloseTo(1 / 3, 12);
    expect(hit.normal).toEqual({ x: 0, y: 1 });
  });

  it('reports the face actually entered first on a diagonal', () => {
    // Crosses y = 0 at t = 0.25 (x = 5, left of the box), then x = 10 at t = 0.5 (y = 5).
    const hit = segmentAABB(v2(0, -5), v2(20, 15), box)!;
    expect(hit.t).toBeCloseTo(0.5, 12);
    expect(hit.normal).toEqual({ x: -1, y: 0 });
  });

  it('misses: beside, short of, or pointing away from the box', () => {
    expect(segmentAABB(v2(0, 20), v2(30, 20), box)).toBeNull(); // passes below
    expect(segmentAABB(v2(0, 5), v2(5, 5), box)).toBeNull(); // ends before it
    expect(segmentAABB(v2(0, 5), v2(-10, 5), box)).toBeNull(); // moving away
    expect(segmentAABB(v2(25, 5), v2(40, 5), box)).toBeNull(); // starts beyond it
    expect(segmentAABB(v2(0, -5), v2(8, 30), box)).toBeNull(); // diagonal that clears the corner
  });

  it('a segment ending exactly on a face hits at t = 1', () => {
    const hit = segmentAABB(v2(0, 5), v2(10, 5), box)!;
    expect(hit.t).toBeCloseTo(1, 12);
    expect(hit.normal).toEqual({ x: -1, y: 0 });
  });

  it('a segment starting inside reports t = 0 and the nearest face as the push-out normal', () => {
    expect(segmentAABB(v2(12, 5), v2(15, 5), box)).toEqual({ t: 0, normal: { x: -1, y: 0 } });
    expect(segmentAABB(v2(18, 5), v2(15, 5), box)).toEqual({ t: 0, normal: { x: 1, y: 0 } });
    expect(segmentAABB(v2(15, 1), v2(15, 5), box)).toEqual({ t: 0, normal: { x: 0, y: -1 } });
    expect(segmentAABB(v2(15, 9), v2(15, 5), box)).toEqual({ t: 0, normal: { x: 0, y: 1 } });
    // a degenerate (zero-length) segment inside counts too
    expect(segmentAABB(v2(12, 5), v2(12, 5), box)).toEqual({ t: 0, normal: { x: -1, y: 0 } });
    expect(segmentAABB(v2(0, 0), v2(0, 0), box)).toBeNull();
  });

  it('starting on the boundary: hit when entering, no hit when leaving', () => {
    const entering = segmentAABB(v2(10, 5), v2(15, 5), box)!;
    expect(Object.is(entering.t, 0)).toBe(true); // +0, never -0
    expect(entering.normal).toEqual({ x: -1, y: 0 });
    expect(segmentAABB(v2(10, 5), v2(0, 5), box)).toBeNull();
  });

  it('sliding along a face or touching a single corner is not a hit', () => {
    expect(segmentAABB(v2(0, 0), v2(30, 0), box)).toBeNull(); // along the top face
    expect(segmentAABB(v2(0, 10), v2(30, 10), box)).toBeNull(); // along the bottom face
    expect(segmentAABB(v2(10, -5), v2(10, 15), box)).toBeNull(); // along the left face
    expect(segmentAABB(v2(5, 5), v2(10, 0), box)).toBeNull(); // touches only the corner (10, 0)
  });

  it('a segment through two opposite corners enters at the first one', () => {
    const hit = segmentAABB(v2(0, -10), v2(20, 10), box)!;
    expect(hit.t).toBeCloseTo(0.5, 12);
  });
});

describe('point-segment distance', () => {
  const a = v2(0, 0);
  const b = v2(10, 0);

  it('perpendicular distance in the middle', () => {
    expect(pointSegmentDistance(v2(5, 3), a, b)).toBe(3);
    expect(pointSegmentDistance(v2(5, -4), a, b)).toBe(4);
  });

  it('clamps to the end points', () => {
    expect(pointSegmentDistance(v2(-3, 4), a, b)).toBe(5);
    expect(pointSegmentDistance(v2(13, 4), a, b)).toBe(5);
  });

  it('is 0 on the segment, and handles a degenerate segment', () => {
    expect(pointSegmentDistance(v2(4, 0), a, b)).toBe(0);
    expect(pointSegmentDistance(v2(3, 4), a, a)).toBe(5);
  });

  it('closestPointOnSegment', () => {
    expect(closestPointOnSegment(v2(5, 3), a, b)).toEqual({ x: 5, y: 0 });
    expect(closestPointOnSegment(v2(-3, 4), a, b)).toEqual({ x: 0, y: 0 });
    expect(closestPointOnSegment(v2(30, 4), a, b)).toEqual({ x: 10, y: 0 });
  });
});

describe('easings', () => {
  const all = { easeInOutCubic, easeOutCubic, easeOutBack, easeOutElastic, easeInQuad };

  it('all start at 0 and end at 1 (and clamp their input)', () => {
    for (const [name, fn] of Object.entries(all)) {
      expect(fn(0), name).toBeCloseTo(0, 12);
      expect(fn(1), name).toBeCloseTo(1, 12);
      expect(fn(-3), name).toBeCloseTo(0, 12);
      expect(fn(9), name).toBeCloseTo(1, 12);
    }
  });

  it('known mid-points', () => {
    expect(easeInQuad(0.5)).toBe(0.25);
    expect(easeOutCubic(0.5)).toBe(0.875);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 12);
    expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375, 12);
    expect(easeOutBack(0.5)).toBeCloseTo(1.0877, 4);
    expect(easeOutElastic(0.5)).toBeCloseTo(1.015625, 9);
  });

  it('quad / cubic are monotonic and stay within [0, 1]', () => {
    for (const fn of [easeInQuad, easeOutCubic, easeInOutCubic]) {
      let prev = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const v = fn(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1 + 1e-12);
        prev = v;
      }
    }
  });

  it('back and elastic overshoot 1 on the way', () => {
    let maxBack = 0;
    let maxElastic = 0;
    for (let i = 0; i <= 200; i++) {
      maxBack = Math.max(maxBack, easeOutBack(i / 200));
      maxElastic = Math.max(maxElastic, easeOutElastic(i / 200));
    }
    expect(maxBack).toBeGreaterThan(1.05);
    expect(maxElastic).toBeGreaterThan(1.05);
  });
});
