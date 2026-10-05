import { describe, expect, it } from 'vitest';
import { isEditableTarget, isUiTarget, keyCodeOf, shouldIgnoreKeyDown } from '../src/input/dom';
import {
  KEYBOARD_IDLE,
  PITCH_RAMP_RATE,
  PITCH_RETURN_RATE,
  isGameKey,
  keyboardDir,
  keyboardGadget,
  keyboardKeyDown,
  keyboardKeyUp,
  keyboardPitchTarget,
  keyboardTick,
  shouldPreventDefault,
  type KeyboardState,
} from '../src/input/keyboard';

const down = (s: KeyboardState, ...codes: string[]): KeyboardState =>
  codes.reduce((st, c) => keyboardKeyDown(st, c).state, s);
const up = (s: KeyboardState, ...codes: string[]): KeyboardState => codes.reduce((st, c) => keyboardKeyUp(st, c), s);
/** Run `steps` fixed steps of `dt`. */
const run = (s: KeyboardState, steps: number, dt = 1 / 120): KeyboardState => {
  let st = s;
  for (let i = 0; i < steps; i++) st = keyboardTick(st, dt);
  return st;
};

describe('keyboard direction: most recent press wins, with fallback', () => {
  it('idle', () => {
    expect(keyboardDir(KEYBOARD_IDLE)).toBe(0);
  });

  it('single keys, arrows and A / D', () => {
    expect(keyboardDir(down(KEYBOARD_IDLE, 'ArrowLeft'))).toBe(-1);
    expect(keyboardDir(down(KEYBOARD_IDLE, 'ArrowRight'))).toBe(1);
    expect(keyboardDir(down(KEYBOARD_IDLE, 'KeyA'))).toBe(-1);
    expect(keyboardDir(down(KEYBOARD_IDLE, 'KeyD'))).toBe(1);
  });

  it('the later press wins, and releasing it falls back to the other key if still held', () => {
    let s = down(KEYBOARD_IDLE, 'ArrowLeft');
    s = down(s, 'ArrowRight');
    expect(keyboardDir(s)).toBe(1);
    s = up(s, 'ArrowRight');
    expect(keyboardDir(s)).toBe(-1); // fell back to Left, which is still held
    s = up(s, 'ArrowLeft');
    expect(keyboardDir(s)).toBe(0);
  });

  it('releasing the OLDER key leaves the newer one in charge', () => {
    let s = down(KEYBOARD_IDLE, 'ArrowLeft', 'ArrowRight');
    s = up(s, 'ArrowLeft');
    expect(keyboardDir(s)).toBe(1);
    s = up(s, 'ArrowRight');
    expect(keyboardDir(s)).toBe(0);
  });

  it('works the other way round too', () => {
    let s = down(KEYBOARD_IDLE, 'KeyD', 'KeyA');
    expect(keyboardDir(s)).toBe(-1);
    s = up(s, 'KeyA');
    expect(keyboardDir(s)).toBe(1);
  });

  it('arrow and letter keys for the same direction hold it together', () => {
    let s = down(KEYBOARD_IDLE, 'ArrowLeft', 'KeyA');
    expect(keyboardDir(s)).toBe(-1);
    s = up(s, 'ArrowLeft');
    expect(keyboardDir(s)).toBe(-1); // A is still down
    s = up(s, 'KeyA');
    expect(keyboardDir(s)).toBe(0);
  });

  it('mixed layouts: A then ArrowRight', () => {
    let s = down(KEYBOARD_IDLE, 'KeyA', 'ArrowRight');
    expect(keyboardDir(s)).toBe(1);
    s = up(s, 'ArrowRight');
    expect(keyboardDir(s)).toBe(-1);
  });

  it('a repeated keydown for a key already held changes nothing (auto-repeat safe)', () => {
    const s1 = down(KEYBOARD_IDLE, 'ArrowLeft', 'ArrowRight');
    const s2 = keyboardKeyDown(s1, 'ArrowLeft').state; // Left "repeats" while Right is the newest
    expect(s2).toBe(s1);
    expect(keyboardDir(s2)).toBe(1);
  });

  it('releasing a key that is not held is a no-op', () => {
    const s = down(KEYBOARD_IDLE, 'ArrowLeft');
    expect(keyboardKeyUp(s, 'ArrowRight')).toBe(s);
    expect(keyboardKeyUp(s, 'KeyQ')).toBe(s);
  });
});

describe('keyboard pitch ramp', () => {
  it('target follows the most recently pressed pitch key', () => {
    expect(keyboardPitchTarget(KEYBOARD_IDLE)).toBe(0);
    expect(keyboardPitchTarget(down(KEYBOARD_IDLE, 'ArrowUp'))).toBe(1);
    expect(keyboardPitchTarget(down(KEYBOARD_IDLE, 'KeyW'))).toBe(1);
    expect(keyboardPitchTarget(down(KEYBOARD_IDLE, 'ArrowDown'))).toBe(-1);
    expect(keyboardPitchTarget(down(KEYBOARD_IDLE, 'KeyS'))).toBe(-1);
    let s = down(KEYBOARD_IDLE, 'ArrowUp', 'ArrowDown');
    expect(keyboardPitchTarget(s)).toBe(-1);
    s = up(s, 'ArrowDown');
    expect(keyboardPitchTarget(s)).toBe(1); // falls back to Up
  });

  it('ramps up at 4 per second and saturates at 1', () => {
    expect(PITCH_RAMP_RATE).toBe(4);
    let s = down(KEYBOARD_IDLE, 'ArrowUp');
    s = keyboardTick(s, 0.1);
    expect(s.pitch).toBeCloseTo(0.4, 12);
    s = keyboardTick(s, 0.1);
    expect(s.pitch).toBeCloseTo(0.8, 12);
    s = keyboardTick(s, 0.1);
    expect(s.pitch).toBe(1);
    s = keyboardTick(s, 5);
    expect(s.pitch).toBe(1);
  });

  it('ramps down (nose down) symmetrically', () => {
    const s = keyboardTick(down(KEYBOARD_IDLE, 'KeyS'), 0.25);
    expect(s.pitch).toBeCloseTo(-1, 12);
  });

  it('returns to 0 at 6 per second after release, without overshooting', () => {
    expect(PITCH_RETURN_RATE).toBe(6);
    let s = run(down(KEYBOARD_IDLE, 'ArrowUp'), 60); // 0.5 s: fully up
    expect(s.pitch).toBe(1);
    s = up(s, 'ArrowUp');
    s = keyboardTick(s, 0.1);
    expect(s.pitch).toBeCloseTo(0.4, 12);
    s = keyboardTick(s, 0.1);
    expect(s.pitch).toBe(0);
    s = keyboardTick(s, 1);
    expect(s.pitch).toBe(0);
  });

  it('is frame-rate independent for the ramp up (fixed steps)', () => {
    const coarse = run(down(KEYBOARD_IDLE, 'ArrowUp'), 12, 1 / 60); // 0.2 s
    const fine = run(down(KEYBOARD_IDLE, 'ArrowUp'), 24, 1 / 120); // 0.2 s
    expect(coarse.pitch).toBeCloseTo(0.8, 9);
    expect(fine.pitch).toBeCloseTo(0.8, 9);
  });

  it('reversing direction heads straight for the new target', () => {
    let s = keyboardTick(down(KEYBOARD_IDLE, 'ArrowUp'), 0.125); // 0.5
    expect(s.pitch).toBeCloseTo(0.5, 12);
    s = up(s, 'ArrowUp');
    s = down(s, 'ArrowDown');
    s = keyboardTick(s, 0.1);
    expect(s.pitch).toBeCloseTo(0.1, 12);
    s = keyboardTick(s, 0.1);
    expect(s.pitch).toBeCloseTo(-0.3, 12);
  });

  it('ignores non-positive or NaN dt', () => {
    const s = down(KEYBOARD_IDLE, 'ArrowUp');
    expect(keyboardTick(s, 0)).toBe(s);
    expect(keyboardTick(s, -1)).toBe(s);
    expect(keyboardTick(s, NaN)).toBe(s);
  });

  it('does not change the pitch of an idle keyboard', () => {
    expect(keyboardTick(KEYBOARD_IDLE, 1)).toBe(KEYBOARD_IDLE);
  });
});

describe('keyboard gadget and pause', () => {
  it('the first gadget key down is an edge; holding more keys is not', () => {
    const a = keyboardKeyDown(KEYBOARD_IDLE, 'Space');
    expect(a.gadgetPressed).toBe(true);
    expect(keyboardGadget(a.state)).toBe(true);
    const b = keyboardKeyDown(a.state, 'KeyJ');
    expect(b.gadgetPressed).toBe(false);
    const c = keyboardKeyDown(b.state, 'Space'); // repeat
    expect(c.gadgetPressed).toBe(false);
    expect(c.state).toBe(b.state);
  });

  it('gadget stays held until every gadget key is up; a new press after release is a new edge', () => {
    let s = down(KEYBOARD_IDLE, 'Space', 'KeyJ');
    s = up(s, 'Space');
    expect(keyboardGadget(s)).toBe(true);
    s = up(s, 'KeyJ');
    expect(keyboardGadget(s)).toBe(false);
    expect(keyboardKeyDown(s, 'KeyJ').gadgetPressed).toBe(true);
  });

  it('Escape and P are pause edges and change no state', () => {
    for (const k of ['Escape', 'KeyP']) {
      const r = keyboardKeyDown(KEYBOARD_IDLE, k);
      expect(r.pausePressed).toBe(true);
      expect(r.gadgetPressed).toBe(false);
      expect(r.state).toBe(KEYBOARD_IDLE);
    }
  });

  it('unrelated keys do nothing', () => {
    const r = keyboardKeyDown(KEYBOARD_IDLE, 'KeyQ');
    expect(r).toEqual({ state: KEYBOARD_IDLE, gadgetPressed: false, pausePressed: false, hoverPressed: false });
  });

  it('H toggles hover (an edge, like pause)', () => {
    const r = keyboardKeyDown(KEYBOARD_IDLE, 'KeyH');
    expect(r).toEqual({ state: KEYBOARD_IDLE, gadgetPressed: false, pausePressed: false, hoverPressed: true });
    expect(isGameKey('KeyH')).toBe(true);
  });
});

describe('key tables', () => {
  it('isGameKey', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'KeyJ', 'Escape', 'KeyP']) {
      expect(isGameKey(k), k).toBe(true);
    }
    for (const k of ['KeyQ', 'Enter', 'Tab', 'ShiftLeft', '']) expect(isGameKey(k), k).toBe(false);
  });

  it('only scrolling keys are preventDefault-ed', () => {
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']) expect(shouldPreventDefault(k)).toBe(true);
    for (const k of ['KeyA', 'KeyW', 'KeyJ', 'Escape', 'KeyP', 'Enter']) expect(shouldPreventDefault(k)).toBe(false);
  });
});

describe('dom helpers', () => {
  it('keyCodeOf prefers event.code and falls back to event.key', () => {
    expect(keyCodeOf({ code: 'KeyA', key: 'q' })).toBe('KeyA'); // AZERTY: physical A position
    expect(keyCodeOf({ code: 'ArrowLeft' })).toBe('ArrowLeft');
    expect(keyCodeOf({ code: '', key: ' ' })).toBe('Space');
    expect(keyCodeOf({ code: 'Unidentified', key: 'ArrowUp' })).toBe('ArrowUp');
    expect(keyCodeOf({ key: 'D' })).toBe('KeyD');
    expect(keyCodeOf({ key: 'Esc' })).toBe('Escape');
    expect(keyCodeOf({ key: 'Left' })).toBe('ArrowLeft');
    expect(keyCodeOf({ key: 'F13' })).toBe('');
    expect(keyCodeOf({})).toBe('');
  });

  it('isEditableTarget', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(new EventTarget())).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
  });

  it('isUiTarget', () => {
    const inside = { closest: (sel: string) => (sel === '[data-ui]' ? {} : null) };
    const outside = { closest: () => null };
    expect(isUiTarget(inside as unknown as EventTarget)).toBe(true);
    expect(isUiTarget(outside as unknown as EventTarget)).toBe(false);
    expect(isUiTarget(new EventTarget())).toBe(false); // no closest()
    expect(isUiTarget(null)).toBe(false);
  });

  it('shouldIgnoreKeyDown: modifiers and text fields', () => {
    const plain = { ctrlKey: false, metaKey: false, altKey: false, target: null };
    expect(shouldIgnoreKeyDown(plain)).toBe(false);
    expect(shouldIgnoreKeyDown({ ...plain, ctrlKey: true })).toBe(true);
    expect(shouldIgnoreKeyDown({ ...plain, metaKey: true })).toBe(true);
    expect(shouldIgnoreKeyDown({ ...plain, altKey: true })).toBe(true);
    expect(shouldIgnoreKeyDown({ ...plain, target: { tagName: 'INPUT' } as unknown as EventTarget })).toBe(true);
    expect(shouldIgnoreKeyDown({ ...plain, target: { tagName: 'BODY' } as unknown as EventTarget })).toBe(false);
  });
});
