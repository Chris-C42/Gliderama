import { describe, expect, it } from 'vitest';
import {
  TOUCH_PADS_IDLE,
  sliderKnobOffset,
  sliderPitch,
  touchPadsOutput,
  touchPadsReduce,
  type TouchPadsAction,
  type TouchPadsState,
} from '../src/input/touchPads';

const TRAVEL = 70;

const run = (actions: TouchPadsAction[], from: TouchPadsState = TOUCH_PADS_IDLE): TouchPadsState =>
  actions.reduce(touchPadsReduce, from);
const out = (s: TouchPadsState, travel = TRAVEL) => touchPadsOutput(s, travel);

const down = (side: 'left' | 'right', pointerId: number, x = 100, y = 300): TouchPadsAction => ({
  type: 'down',
  side,
  pointerId,
  x,
  y,
});
const move = (pointerId: number, y: number): TouchPadsAction => ({ type: 'move', pointerId, y });
const up = (pointerId: number): TouchPadsAction => ({ type: 'up', pointerId });

describe('sliderPitch: clamp(-dy / travel, -1, 1)', () => {
  it('up (negative dy) is nose up', () => {
    expect(sliderPitch(-35, 70)).toBe(0.5);
    expect(sliderPitch(-70, 70)).toBe(1);
    expect(sliderPitch(35, 70)).toBe(-0.5);
    expect(sliderPitch(70, 70)).toBe(-1);
  });

  it('is 0 at the touch-down point (and +0, never -0)', () => {
    expect(Object.is(sliderPitch(0, 70), 0)).toBe(true);
    expect(Object.is(sliderPitch(-0, 70), 0)).toBe(true);
  });

  it('clamps beyond the travel', () => {
    expect(sliderPitch(-500, 70)).toBe(1);
    expect(sliderPitch(500, 70)).toBe(-1);
  });

  it('a smaller travel is more sensitive', () => {
    expect(sliderPitch(-35, 35)).toBe(1);
    expect(sliderPitch(-35, 140)).toBe(0.25);
  });

  it('survives a nonsense travel', () => {
    expect(sliderPitch(-10, 0)).toBe(0);
    expect(sliderPitch(-10, -5)).toBe(0);
    expect(sliderPitch(-10, NaN)).toBe(0);
  });

  it('knob offset follows the finger but stops at the ends of the track', () => {
    expect(sliderKnobOffset(-20, 70)).toBe(-20);
    expect(sliderKnobOffset(-200, 70)).toBe(-70);
    expect(sliderKnobOffset(200, 70)).toBe(70);
    expect(Object.is(sliderKnobOffset(-0, 70), 0)).toBe(true);
  });
});

describe('one pad', () => {
  it('idle: no direction, no pitch', () => {
    expect(out(TOUCH_PADS_IDLE)).toEqual({ active: null, dir: 0, pitch: 0, leftHeld: false, rightHeld: false });
  });

  it('pressing a pad makes it the direction; neutral pitch is the touch-down point', () => {
    const s = run([down('left', 1, 80, 300)]);
    expect(out(s)).toEqual({ active: 'left', dir: -1, pitch: 0, leftHeld: true, rightHeld: false });
    expect(s.left).toMatchObject({ x: 80, y: 300, curY: 300, pointerId: 1 }); // slider is centred here
    expect(out(run([down('right', 7)])).dir).toBe(1);
  });

  it('dragging up / down moves the pitch (up = nose up)', () => {
    const s = run([down('right', 1, 500, 300)]);
    expect(out(run([move(1, 265)], s)).pitch).toBe(0.5);
    expect(out(run([move(1, 230)], s)).pitch).toBe(1);
    expect(out(run([move(1, 100)], s)).pitch).toBe(1); // far beyond the travel
    expect(out(run([move(1, 335)], s)).pitch).toBe(-0.5);
    expect(out(run([move(1, 370)], s)).pitch).toBe(-1);
    expect(out(run([move(1, 900)], s)).pitch).toBe(-1);
  });

  it('pitch follows the finger back through neutral', () => {
    let s = run([down('left', 1), move(1, 250)]);
    expect(out(s).pitch).toBeCloseTo(50 / 70, 12);
    s = run([move(1, 300)], s);
    expect(out(s).pitch).toBe(0);
    s = run([move(1, 340)], s);
    expect(out(s).pitch).toBeCloseTo(-40 / 70, 12);
  });

  it('the slider keeps its touch-down centre while the finger moves (drift does not cancel)', () => {
    const s = run([down('left', 1, 80, 300), move(1, 200), move(1, 320)]);
    expect(s.left).toMatchObject({ x: 80, y: 300, curY: 320 });
    expect(out(s).dir).toBe(-1);
  });

  it('releasing zeroes direction and pitch', () => {
    const s = run([down('left', 1), move(1, 240), up(1)]);
    expect(out(s)).toEqual({ active: null, dir: 0, pitch: 0, leftHeld: false, rightHeld: false });
  });

  it('a new press re-centres the neutral point where the finger lands', () => {
    let s = run([down('left', 1, 80, 300), move(1, 230), up(1)]);
    s = run([down('left', 2, 90, 250)], s);
    expect(out(s).pitch).toBe(0);
    expect(out(run([move(2, 215)], s)).pitch).toBe(0.5);
  });

  it('sensitivity comes from the travel argument', () => {
    const s = run([down('left', 1), move(1, 280)]);
    expect(out(s, 70).pitch).toBeCloseTo(20 / 70, 12);
    expect(out(s, 20).pitch).toBe(1);
    expect(out(s, 200).pitch).toBeCloseTo(0.1, 12);
  });
});

describe('two thumbs', () => {
  it('the most recent press is the active pad', () => {
    const s = run([down('left', 1, 80, 300), down('right', 2, 560, 310)]);
    expect(out(s)).toMatchObject({ active: 'right', dir: 1, leftHeld: true, rightHeld: true });
  });

  it('pitch comes from the active pad only; the other pad keeps tracking its own finger', () => {
    let s = run([down('left', 1, 80, 300), move(1, 265), down('right', 2, 560, 310)]);
    expect(out(s).pitch).toBe(0); // right pad's slider starts at neutral
    s = run([move(2, 275)], s);
    expect(out(s).pitch).toBe(0.5); // right finger moved up 35
    s = run([move(1, 230)], s); // left finger moves while not active
    expect(out(s).pitch).toBe(0.5); // output unchanged
    expect(out(s).dir).toBe(1);
  });

  it('releasing the active pad falls back to the other, using ITS slider', () => {
    let s = run([down('left', 1, 80, 300), move(1, 265), down('right', 2, 560, 310), move(2, 340)]);
    expect(out(s)).toMatchObject({ dir: 1, pitch: -30 / 70 });
    s = run([up(2)], s);
    expect(out(s)).toMatchObject({ active: 'left', dir: -1, leftHeld: true, rightHeld: false });
    expect(out(s).pitch).toBe(0.5); // left finger is still 35px above where it landed
    s = run([up(1)], s);
    expect(out(s)).toEqual({ active: null, dir: 0, pitch: 0, leftHeld: false, rightHeld: false });
  });

  it('releasing the older pad leaves the newer one in charge', () => {
    const s = run([down('left', 1), down('right', 2), up(1)]);
    expect(out(s)).toMatchObject({ active: 'right', dir: 1, leftHeld: false });
  });

  it('pressing the older side again makes it the active one again', () => {
    const s = run([down('left', 1), down('right', 2), up(1), down('left', 3)]);
    expect(out(s)).toMatchObject({ active: 'left', dir: -1, leftHeld: true, rightHeld: true });
  });
});

describe('robustness', () => {
  it('moves and releases from unknown pointers change nothing', () => {
    const s = run([down('left', 1)]);
    expect(touchPadsReduce(s, move(99, 10))).toBe(s);
    expect(touchPadsReduce(s, up(99))).toBe(s);
    expect(touchPadsReduce(TOUCH_PADS_IDLE, up(1))).toBe(TOUCH_PADS_IDLE);
  });

  it('a move to the same y is a no-op (no needless re-render)', () => {
    const s = run([down('left', 1, 80, 300), move(1, 280)]);
    expect(touchPadsReduce(s, move(1, 280))).toBe(s);
  });

  it('a new pointer taking over a held pad replaces the old one (recovers from a lost pointerup)', () => {
    let s = run([down('left', 1, 80, 300), down('left', 2, 90, 200)]);
    expect(s.left).toMatchObject({ pointerId: 2, y: 200 });
    s = run([up(1)], s); // the stale pointer lifting later must not release the pad
    expect(out(s)).toMatchObject({ leftHeld: true, dir: -1 });
    s = run([up(2)], s);
    expect(out(s).leftHeld).toBe(false);
  });

  it('one pointer cannot hold both pads', () => {
    const s = run([down('left', 1), down('right', 1)]);
    expect(out(s)).toMatchObject({ leftHeld: false, rightHeld: true, active: 'right' });
  });

  it('reset releases everything', () => {
    const s = run([down('left', 1), down('right', 2), { type: 'reset' }]);
    expect(out(s)).toEqual({ active: null, dir: 0, pitch: 0, leftHeld: false, rightHeld: false });
    expect(touchPadsReduce(TOUCH_PADS_IDLE, { type: 'reset' })).toBe(TOUCH_PADS_IDLE);
    // press order stays monotonic across a reset
    const again = run([down('left', 5), down('right', 6)], s);
    expect(out(again).active).toBe('right');
  });

  it('never mutates the state it is given', () => {
    const before = run([down('left', 1)]);
    const snapshot = JSON.stringify(before);
    touchPadsReduce(before, move(1, 5));
    touchPadsReduce(before, down('right', 2));
    touchPadsReduce(before, up(1));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
