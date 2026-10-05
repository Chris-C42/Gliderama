import { describe, expect, it } from 'vitest';
import {
  JOYSTICK_ENGAGE,
  JOYSTICK_IDLE,
  JOYSTICK_PITCH_DEADZONE,
  JOYSTICK_RELEASE,
  joystickDir,
  joystickKnob,
  joystickOutput,
  joystickPitch,
  joystickReduce,
  joystickView,
  type JoystickAction,
  type JoystickState,
} from '../src/input/joystick';

const R = 50; // px of travel for full deflection (the default sliderTravel)

const run = (actions: JoystickAction[], from: JoystickState = JOYSTICK_IDLE, radius = R): JoystickState =>
  actions.reduce((s, a) => joystickReduce(s, a, radius), from);
const down = (pointerId: number, x = 200, y = 300): JoystickAction => ({ type: 'down', pointerId, x, y });
const move = (pointerId: number, x: number, y: number): JoystickAction => ({ type: 'move', pointerId, x, y });
const up = (pointerId: number): JoystickAction => ({ type: 'up', pointerId });

describe('the tunables', () => {
  it('engage at 35 % of the radius, release at 22 %, pitch dead zone 8 %', () => {
    expect(JOYSTICK_ENGAGE).toBe(0.35);
    expect(JOYSTICK_RELEASE).toBe(0.22);
    expect(JOYSTICK_PITCH_DEADZONE).toBe(0.08);
    expect(JOYSTICK_RELEASE).toBeLessThan(JOYSTICK_ENGAGE); // the gap is the hysteresis
  });
});

describe('joystickDir: dead zone', () => {
  it('nothing engages up to the engage point, on either side', () => {
    expect(joystickDir(0, R)).toBe(0);
    expect(joystickDir(0.2 * R, R)).toBe(0);
    expect(joystickDir(-0.2 * R, R)).toBe(0);
    expect(joystickDir(JOYSTICK_ENGAGE * R, R)).toBe(0); // "engage when |dx| > 0.35 r": exactly on it is not enough
    expect(joystickDir(-JOYSTICK_ENGAGE * R, R)).toBe(0);
  });

  it('the sign of dx gives the side once it is past the engage point', () => {
    expect(joystickDir(0.36 * R, R)).toBe(1);
    expect(joystickDir(-0.36 * R, R)).toBe(-1);
    expect(joystickDir(R, R)).toBe(1);
    expect(joystickDir(-R, R)).toBe(-1);
    expect(joystickDir(5 * R, R)).toBe(1); // well beyond the ring
    expect(joystickDir(-5 * R, R)).toBe(-1);
  });

  it('the thresholds scale with the radius (the sliderTravel setting)', () => {
    expect(joystickDir(30, 100)).toBe(0); // 30 % of 100
    expect(joystickDir(36, 100)).toBe(1);
    expect(joystickDir(12, 30)).toBe(1); // 40 % of 30
    expect(joystickDir(9, 30)).toBe(0); // 30 % of 30
    expect(joystickDir(-36, 100)).toBe(-1);
  });

  it('defaults the previous direction to none', () => {
    expect(joystickDir(0.3 * R, R)).toBe(0);
  });

  it('a nonsense radius engages nothing', () => {
    for (const r of [0, -50, NaN]) {
      expect(joystickDir(30, r)).toBe(0);
      expect(joystickDir(-30, r, -1)).toBe(0);
    }
  });
});

describe('joystickDir: hysteresis', () => {
  it('once engaged it holds through the band between release and engage', () => {
    expect(joystickDir(0.4 * R, R, 0)).toBe(1);
    expect(joystickDir(0.3 * R, R, 1)).toBe(1); // below the engage point, above the release point
    expect(joystickDir(0.25 * R, R, 1)).toBe(1);
    expect(joystickDir(-0.4 * R, R, 0)).toBe(-1);
    expect(joystickDir(-0.3 * R, R, -1)).toBe(-1);
    expect(joystickDir(-0.25 * R, R, -1)).toBe(-1);
  });

  it('it lets go only below the release point ("release when |dx| < 0.22 r")', () => {
    expect(joystickDir(JOYSTICK_RELEASE * R, R, 1)).toBe(1); // exactly on it still holds
    expect(joystickDir(0.21 * R, R, 1)).toBe(0);
    expect(joystickDir(0, R, 1)).toBe(0);
    expect(joystickDir(-JOYSTICK_RELEASE * R, R, -1)).toBe(-1);
    expect(joystickDir(-0.21 * R, R, -1)).toBe(0);
  });

  it('after letting go it needs the full engage point again', () => {
    expect(joystickDir(0.3 * R, R, 0)).toBe(0); // same dx that held it a moment ago
    expect(joystickDir(0.36 * R, R, 0)).toBe(1);
  });

  it('a thumb jittering across the engage point engages once and does not flicker', () => {
    let dir: -1 | 0 | 1 = 0;
    const seen: number[] = [];
    for (const f of [0.3, 0.4, 0.3, 0.38, 0.3, 0.4, 0.28, 0.36, 0.3]) {
      dir = joystickDir(f * R, R, dir);
      seen.push(dir);
    }
    expect(seen).toEqual([0, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('a thumb jittering across the release point lets go once and does not flicker back', () => {
    let dir: -1 | 0 | 1 = joystickDir(0.5 * R, R, 0);
    const seen: number[] = [];
    for (const f of [0.25, 0.2, 0.25, 0.3, 0.2, 0.3]) {
      dir = joystickDir(f * R, R, dir);
      seen.push(dir);
    }
    expect(seen).toEqual([1, 0, 0, 0, 0, 0]);
  });

  it('the hysteresis is mirrored on the left', () => {
    let dir: -1 | 0 | 1 = 0;
    const seen: number[] = [];
    for (const f of [-0.3, -0.4, -0.3, -0.25, -0.2, -0.3, -0.4]) {
      dir = joystickDir(f * R, R, dir);
      seen.push(dir);
    }
    expect(seen).toEqual([0, -1, -1, -1, 0, 0, -1]);
  });

  it('swinging straight across to the far side switches the direction', () => {
    expect(joystickDir(-0.5 * R, R, 1)).toBe(-1);
    expect(joystickDir(0.5 * R, R, -1)).toBe(1);
  });

  it('swinging across to the near side of the other half does not keep the old direction', () => {
    expect(joystickDir(-0.3 * R, R, 1)).toBe(0); // on the left, but not yet engaged there
    expect(joystickDir(0.3 * R, R, -1)).toBe(0);
  });

  it('is idempotent: feeding the result back as the previous direction changes nothing', () => {
    for (const prev of [-1, 0, 1] as const) {
      for (let dx = -80; dx <= 80; dx += 1.5) {
        const once = joystickDir(dx, R, prev);
        expect(joystickDir(dx, R, once), `dx ${dx} prev ${prev}`).toBe(once);
      }
    }
  });
});

describe('joystickPitch: clamp(-dy / radius, -1, 1), dead zone, rescaled', () => {
  it('up (negative dy) is nose up, down is nose down, full deflection is exactly +-1', () => {
    expect(joystickPitch(-R, R)).toBe(1);
    expect(joystickPitch(R, R)).toBe(-1);
    expect(joystickPitch(-R / 2, R)).toBeGreaterThan(0);
    expect(joystickPitch(R / 2, R)).toBeLessThan(0);
  });

  it('is mirror-symmetric', () => {
    for (const dy of [10, 25, 40, 49, 70]) expect(joystickPitch(dy, R)).toBe(-joystickPitch(-dy, R));
  });

  it('a small dead zone around the centre gives no pitch (and +0, never -0)', () => {
    const dz = JOYSTICK_PITCH_DEADZONE * R; // 4 px
    expect(joystickPitch(0, R)).toBe(0);
    expect(joystickPitch(dz * 0.9, R)).toBe(0);
    expect(joystickPitch(-dz * 0.9, R)).toBe(0);
    expect(Object.is(joystickPitch(0, R), 0)).toBe(true);
    expect(Object.is(joystickPitch(-0, R), 0)).toBe(true);
    expect(Object.is(joystickPitch(dz * 0.5, R), 0)).toBe(true);
    expect(Object.is(joystickPitch(dz, R), 0)).toBe(true); // the dead zone's own edge rescales to 0, never -0
  });

  it('is rescaled so there is no jump at the dead zone edge and full deflection is still reached', () => {
    const dz = JOYSTICK_PITCH_DEADZONE * R;
    expect(joystickPitch(-(dz + 0.01), R)).toBeGreaterThan(0);
    expect(joystickPitch(-(dz + 0.01), R)).toBeLessThan(0.01); // starts from ~0, not from 0.08
    // halfway: (0.5 - 0.08) / (1 - 0.08)
    expect(joystickPitch(-R / 2, R)).toBeCloseTo(0.42 / 0.92, 12);
    expect(joystickPitch(R / 2, R)).toBeCloseTo(-0.42 / 0.92, 12);
    expect(joystickPitch(-R, R)).toBe(1);
  });

  it('never decreases as the thumb pushes further up', () => {
    let last = -Infinity;
    for (let dy = R; dy >= -R; dy -= 0.5) {
      const p = joystickPitch(dy, R);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });

  it('clamps beyond the ring', () => {
    expect(joystickPitch(-500, R)).toBe(1);
    expect(joystickPitch(500, R)).toBe(-1);
  });

  it('a smaller radius is more sensitive', () => {
    expect(joystickPitch(-25, 25)).toBe(1);
    expect(joystickPitch(-25, 100)).toBeCloseTo(0.17 / 0.92, 12);
    expect(joystickPitch(-25, 50)).toBeCloseTo(0.42 / 0.92, 12);
  });

  it('a nonsense radius gives no pitch', () => {
    for (const r of [0, -50, NaN]) expect(joystickPitch(-30, r)).toBe(0);
  });
});

describe('joystickKnob: the thumb offset clamped to a circle of the radius', () => {
  it('follows the thumb inside the ring', () => {
    expect(joystickKnob(10, -20, R)).toEqual({ x: 10, y: -20 });
    expect(joystickKnob(-30, 30, R)).toEqual({ x: -30, y: 30 });
    expect(joystickKnob(R, 0, R)).toEqual({ x: R, y: 0 }); // exactly on the ring
    expect(joystickKnob(0, -R, R)).toEqual({ x: 0, y: -R });
  });

  it('stops on the ring along the direction of the thumb', () => {
    expect(joystickKnob(60, 80, R)).toEqual({ x: 30, y: 40 }); // 3-4-5: the thumb is 100 px out, the ring is 50
    expect(joystickKnob(-60, 80, R)).toEqual({ x: -30, y: 40 });
    expect(joystickKnob(500, 0, R).x).toBeCloseTo(R, 12);
    expect(joystickKnob(500, 0, R).y).toBe(0);
    expect(joystickKnob(0, -500, R).x).toBe(0);
    expect(joystickKnob(0, -500, R).y).toBeCloseTo(-R, 12);
    const k = joystickKnob(300, -200, R);
    expect(Math.hypot(k.x, k.y)).toBeCloseTo(R, 12);
    expect(k.y / k.x).toBeCloseTo(-200 / 300, 12); // same bearing
  });

  it('is the true circle, not a square: a diagonal thumb stops short of the corner', () => {
    const k = joystickKnob(R, R, R);
    expect(k.x).toBeCloseTo(R / Math.SQRT2, 12);
    expect(k.y).toBeCloseTo(R / Math.SQRT2, 12);
  });

  it('is +0, never -0', () => {
    const k = joystickKnob(-0, -0, R);
    expect(Object.is(k.x, 0)).toBe(true);
    expect(Object.is(k.y, 0)).toBe(true);
  });

  it('a nonsense radius parks the knob in the centre', () => {
    expect(joystickKnob(30, 30, 0)).toEqual({ x: 0, y: 0 });
    expect(joystickKnob(30, 30, NaN)).toEqual({ x: 0, y: 0 });
  });
});

describe('joystickOutput', () => {
  it('centred: nothing engaged, no pitch, knob in the middle', () => {
    expect(joystickOutput(0, 0, R)).toEqual({ dir: 0, pitch: 0, knobX: 0, knobY: 0 });
  });

  it('right and left are mirror images (dir and knobX flip, pitch does not)', () => {
    const r = joystickOutput(0.6 * R, -0.5 * R, R);
    const l = joystickOutput(-0.6 * R, -0.5 * R, R);
    expect(r.dir).toBe(1);
    expect(l.dir).toBe(-1);
    expect(l.knobX).toBe(-r.knobX);
    expect(l.knobY).toBe(r.knobY);
    expect(l.pitch).toBe(r.pitch);
    expect(r.pitch).toBeCloseTo(0.42 / 0.92, 12);
  });

  it('pitch works whatever dir is: pushing straight up or down pitches without turning', () => {
    expect(joystickOutput(0, -R, R)).toEqual({ dir: 0, pitch: 1, knobX: 0, knobY: -R });
    expect(joystickOutput(0, R, R)).toEqual({ dir: 0, pitch: -1, knobX: 0, knobY: R });
    expect(joystickOutput(0.1 * R, -0.8 * R, R).dir).toBe(0); // a little sideways drift is inside the dead zone
    expect(joystickOutput(0.1 * R, -0.8 * R, R).pitch).toBeGreaterThan(0.7);
  });

  it('dir and pitch are independent: full right and full up at the same time', () => {
    const o = joystickOutput(R, -R, R);
    expect(o.dir).toBe(1);
    expect(o.pitch).toBe(1); // the corner reaches full pitch even though the knob stops on the ring
    expect(Math.hypot(o.knobX, o.knobY)).toBeCloseTo(R, 12);
  });

  it('uses the previous direction for the hysteresis', () => {
    expect(joystickOutput(0.3 * R, 0, R, 0).dir).toBe(0);
    expect(joystickOutput(0.3 * R, 0, R, 1).dir).toBe(1);
    expect(joystickOutput(0.3 * R, 0, R, -1).dir).toBe(0); // the other side's memory does not help
  });

  it('a nonsense radius reports a quiet stick', () => {
    expect(joystickOutput(40, -40, 0)).toEqual({ dir: 0, pitch: 0, knobX: 0, knobY: 0 });
  });
});

describe('one thumb on the stick (reducer)', () => {
  it('idle: nothing held, nothing reported', () => {
    expect(JOYSTICK_IDLE).toBeNull();
    expect(joystickView(JOYSTICK_IDLE, R)).toEqual({ held: false, x: 0, y: 0, dir: 0, pitch: 0, knobX: 0, knobY: 0 });
  });

  it('pressing plants the stick where the thumb landed, at neutral', () => {
    const s = run([down(1, 180, 310)]);
    expect(s).toMatchObject({ pointerId: 1, x: 180, y: 310, curX: 180, curY: 310, dir: 0 });
    expect(joystickView(s, R)).toEqual({ held: true, x: 180, y: 310, dir: 0, pitch: 0, knobX: 0, knobY: 0 });
  });

  it('the knob, dir and pitch follow the thumb, measured from the touch-down point', () => {
    const s = run([down(1, 180, 310), move(1, 180 + 30, 310 - 25)]); // 30 right, 25 up
    const v = joystickView(s, R);
    expect(v).toMatchObject({ held: true, x: 180, y: 310, dir: 1, knobX: 30, knobY: -25 });
    expect(v.pitch).toBeCloseTo(0.42 / 0.92, 12);
  });

  it('drifting off the ring keeps the knob on the ring; the stick does not move', () => {
    const s = run([down(1, 180, 310), move(1, 180 - 200, 310 + 10)]);
    const v = joystickView(s, R);
    expect(v).toMatchObject({ x: 180, y: 310, dir: -1 });
    expect(Math.hypot(v.knobX, v.knobY)).toBeCloseTo(R, 12);
    expect(v.knobX).toBeLessThan(0);
  });

  it('remembers the engaged direction between moves (hysteresis through the reducer)', () => {
    const dirAfter = (xs: number[]) => {
      let s = run([down(1, 100, 300)]);
      const seen: number[] = [];
      for (const x of xs) {
        s = run([move(1, 100 + x, 300)], s);
        seen.push(joystickView(s, R).dir);
      }
      return seen;
    };
    // engage at > 17.5 px, hold down to 11 px, let go below it, need 17.5 again
    expect(dirAfter([10, 20, 14, 11, 10, 14, 18])).toEqual([0, 1, 1, 1, 0, 0, 1]);
    expect(dirAfter([-10, -20, -14, -11, -10, -14, -18])).toEqual([0, -1, -1, -1, 0, 0, -1]);
  });

  it('the radius it is given sets the thresholds', () => {
    const s = run([down(1, 100, 300), move(1, 120, 300)], JOYSTICK_IDLE, 50); // 20 px: engaged at radius 50
    expect(joystickView(s, 50).dir).toBe(1);
    const t = run([down(1, 100, 300), move(1, 120, 300)], JOYSTICK_IDLE, 110); // 20 px: dead zone at radius 110
    expect(joystickView(t, 110).dir).toBe(0);
  });

  it('lifting the thumb releases everything', () => {
    const s = run([down(1, 100, 300), move(1, 140, 250), up(1)]);
    expect(s).toBeNull();
    expect(joystickView(s, R)).toEqual({ held: false, x: 0, y: 0, dir: 0, pitch: 0, knobX: 0, knobY: 0 });
  });

  it('a new press re-plants the stick where it lands, with fresh neutral and no remembered direction', () => {
    let s = run([down(1, 100, 300), move(1, 150, 300), up(1)]);
    s = run([down(2, 220, 200)], s);
    expect(joystickView(s, R)).toMatchObject({ held: true, x: 220, y: 200, dir: 0, pitch: 0, knobX: 0, knobY: 0 });
  });

  it('one pointer at a time: a second finger landing while the stick is held is ignored', () => {
    const s = run([down(1, 100, 300), move(1, 140, 300)]);
    expect(joystickReduce(s, down(2, 400, 100), R)).toBe(s);
    // and it cannot move or release it either
    expect(joystickReduce(s, move(2, 10, 10), R)).toBe(s);
    expect(joystickReduce(s, up(2), R)).toBe(s);
    expect(joystickView(s, R)).toMatchObject({ x: 100, y: 300, dir: 1 });
  });

  it('after the owner lets go, another finger can take the stick', () => {
    const s = run([down(1, 100, 300), down(2, 400, 100), up(1), down(2, 400, 100)]);
    expect(s).toMatchObject({ pointerId: 2, x: 400, y: 100 });
  });

  it('the same pointer pressing again takes over and re-centres (recovers from a lost pointerup)', () => {
    const s = run([down(1, 100, 300), move(1, 150, 250), down(1, 90, 280)]);
    expect(s).toMatchObject({ pointerId: 1, x: 90, y: 280, curX: 90, curY: 280, dir: 0 });
  });

  it('moves and releases from unknown pointers change nothing', () => {
    const s = run([down(1)]);
    expect(joystickReduce(s, move(9, 0, 0), R)).toBe(s);
    expect(joystickReduce(s, up(9), R)).toBe(s);
    expect(joystickReduce(JOYSTICK_IDLE, move(1, 0, 0), R)).toBeNull();
    expect(joystickReduce(JOYSTICK_IDLE, up(1), R)).toBeNull();
  });

  it('a move to the same spot is a no-op (no needless re-render)', () => {
    const s = run([down(1, 100, 300), move(1, 130, 280)]);
    expect(joystickReduce(s, move(1, 130, 280), R)).toBe(s);
  });

  it('reset releases the stick', () => {
    expect(run([down(1), { type: 'reset' }])).toBeNull();
    expect(joystickReduce(JOYSTICK_IDLE, { type: 'reset' }, R)).toBeNull();
  });

  it('never mutates the state it is given', () => {
    const before = run([down(1, 100, 300), move(1, 140, 250)]);
    const snapshot = JSON.stringify(before);
    joystickReduce(before, move(1, 5, 5), R);
    joystickReduce(before, down(1, 1, 1), R);
    joystickReduce(before, down(2, 1, 1), R);
    joystickReduce(before, up(1), R);
    joystickReduce(before, { type: 'reset' }, R);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('the idle view is one shared frozen object (no allocation per frame)', () => {
    expect(joystickView(null, R)).toBe(joystickView(null, 80));
    expect(Object.isFrozen(joystickView(null, R))).toBe(true);
  });
});
