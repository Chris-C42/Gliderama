import { describe, expect, it } from 'vitest';
import { finalizePitch, mergeDir, mergePitch } from '../src/input/merge';

describe('mergeDir', () => {
  it('nothing held -> 0', () => {
    expect(mergeDir([])).toBe(0);
    expect(mergeDir([{ dir: 0, stamp: 5 }, { dir: 0, stamp: 9 }])).toBe(0);
  });

  it('a lone source decides', () => {
    expect(mergeDir([{ dir: 1, stamp: 1 }, { dir: 0, stamp: 0 }])).toBe(1);
    expect(mergeDir([{ dir: 0, stamp: 0 }, { dir: -1, stamp: 3 }])).toBe(-1);
  });

  it('the most recent change wins', () => {
    expect(mergeDir([{ dir: 1, stamp: 4 }, { dir: -1, stamp: 7 }])).toBe(-1);
    expect(mergeDir([{ dir: 1, stamp: 9 }, { dir: -1, stamp: 7 }])).toBe(1);
    expect(mergeDir([{ dir: 1, stamp: 2 }, { dir: -1, stamp: 8 }, { dir: 1, stamp: 5 }])).toBe(-1);
  });

  it('a newer source that has let go does not count', () => {
    expect(mergeDir([{ dir: 1, stamp: 4 }, { dir: 0, stamp: 99 }])).toBe(1);
  });

  it('on equal stamps the later entry wins', () => {
    expect(mergeDir([{ dir: 1, stamp: 3 }, { dir: -1, stamp: 3 }])).toBe(-1);
  });
});

describe('mergePitch', () => {
  it('touch wins while a pad is held, even at neutral', () => {
    expect(mergePitch({ touchActive: true, touch: 0.5, pad: -0.7, keyboard: 1 })).toBe(0.5);
    expect(mergePitch({ touchActive: true, touch: 0, pad: -0.7, keyboard: 1 })).toBe(0);
  });

  it('otherwise the gamepad wins when its stick is out of the deadzone', () => {
    expect(mergePitch({ touchActive: false, touch: 0.5, pad: -0.7, keyboard: 1 })).toBe(-0.7);
    expect(mergePitch({ touchActive: false, touch: 0, pad: 0.2, keyboard: -1 })).toBe(0.2);
  });

  it('otherwise the keyboard', () => {
    expect(mergePitch({ touchActive: false, touch: 0.5, pad: 0, keyboard: 0.4 })).toBe(0.4);
    expect(mergePitch({ touchActive: false, touch: 0, pad: 0, keyboard: 0 })).toBe(0);
  });
});

describe('finalizePitch', () => {
  it('inverts on request', () => {
    expect(finalizePitch(0.5, false)).toBe(0.5);
    expect(finalizePitch(0.5, true)).toBe(-0.5);
    expect(finalizePitch(-1, true)).toBe(1);
  });

  it('clamps and normalises -0', () => {
    expect(finalizePitch(3, false)).toBe(1);
    expect(finalizePitch(-3, false)).toBe(-1);
    expect(finalizePitch(3, true)).toBe(-1);
    expect(Object.is(finalizePitch(0, true), 0)).toBe(true);
    expect(Object.is(finalizePitch(-0, false), 0)).toBe(true);
  });
});
