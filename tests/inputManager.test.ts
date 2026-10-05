import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/types';
import { InputManager } from '../src/input/InputManager';
import { FakeEl, fire, installFakeGlobals, type FakeGlobals } from './helpers/fakeDom';
import { A, DPAD_LEFT, START, pad } from './helpers/pads';

function setup(over: Partial<Settings> = {}) {
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over };
  const input = new InputManager(() => settings);
  return { input, settings };
}

/** One fixed step the way the game should drive it: update, read, then acknowledge the edges. */
function step(input: InputManager, dt = 1 / 120) {
  input.update(dt);
  const c = input.getControls();
  input.consumeEdges();
  return c;
}

const touch = (dir: -1 | 0 | 1, pitch = 0, gadget = false) => ({ dir, pitch, gadget });

describe('direction merging: the most recent source to change wins', () => {
  it('keyboard alone', () => {
    const { input } = setup();
    expect(input.getControls().dir).toBe(0);
    input.feedKeyDown('ArrowLeft');
    expect(input.getControls().dir).toBe(-1);
    input.feedKeyUp('ArrowLeft');
    expect(input.getControls().dir).toBe(0);
  });

  it('keyboard Left, then touch Right: touch wins; releasing touch falls back to the keyboard', () => {
    const { input } = setup();
    input.feedKeyDown('ArrowLeft');
    input.setTouchState(touch(1));
    expect(input.getControls().dir).toBe(1);
    input.setTouchState(touch(0));
    expect(input.getControls().dir).toBe(-1);
  });

  it('touch Right, then keyboard Left: keyboard wins; releasing it falls back to touch', () => {
    const { input } = setup();
    input.setTouchState(touch(1));
    input.feedKeyDown('KeyA');
    expect(input.getControls().dir).toBe(-1);
    input.feedKeyUp('KeyA');
    expect(input.getControls().dir).toBe(1);
  });

  it('gamepad stick then keyboard, and back', () => {
    const { input } = setup();
    input.feedGamepads([pad([0.9, 0])]);
    expect(input.getControls().dir).toBe(1);
    input.feedKeyDown('ArrowLeft');
    expect(input.getControls().dir).toBe(-1);
    input.feedKeyUp('ArrowLeft');
    expect(input.getControls().dir).toBe(1);
    input.feedGamepads([pad([0, 0])]);
    expect(input.getControls().dir).toBe(0);
  });

  it('three sources unwind in reverse order of arrival', () => {
    const { input } = setup();
    input.feedKeyDown('ArrowLeft'); //          oldest: keyboard  -1
    input.feedGamepads([pad([0.9, 0])]); //     then gamepad      +1
    input.setTouchState(touch(-1)); //          newest: touch     -1
    expect(input.getControls().dir).toBe(-1);
    input.setTouchState(touch(0));
    expect(input.getControls().dir).toBe(1); // gamepad
    input.feedGamepads([pad()]);
    expect(input.getControls().dir).toBe(-1); // keyboard
    input.feedKeyUp('ArrowLeft');
    expect(input.getControls().dir).toBe(0);
  });

  it('a source that keeps its direction does not steal priority back', () => {
    const { input } = setup();
    input.feedGamepads([pad([0.9, 0])]);
    input.feedKeyDown('ArrowLeft'); // newer than the pad
    input.feedGamepads([pad([0.95, 0.2])]); // pad wiggles but its dir is still +1: no new "change"
    expect(input.getControls().dir).toBe(-1);
  });

  it('D-pad counts as the gamepad direction', () => {
    const { input } = setup();
    input.feedGamepads([pad([0, 0], [DPAD_LEFT])]);
    expect(input.getControls().dir).toBe(-1);
  });
});

describe('pitch merging and invertPitch', () => {
  it('keyboard pitch ramps with update()', () => {
    const { input } = setup();
    input.feedKeyDown('ArrowUp');
    input.update(0.1);
    expect(input.getControls().pitch).toBeCloseTo(0.4, 12);
    input.update(0.2);
    expect(input.getControls().pitch).toBe(1);
    input.feedKeyUp('ArrowUp');
    input.update(0.1);
    expect(input.getControls().pitch).toBeCloseTo(0.4, 12);
  });

  it('priority: touch (while a pad is held) > gamepad (out of deadzone) > keyboard', () => {
    const { input } = setup();
    input.feedKeyDown('ArrowDown');
    input.update(0.25); // keyboard fully down: -1
    expect(input.getControls().pitch).toBe(-1);

    input.feedGamepads([pad([0, -1])]); // stick fully up
    expect(input.getControls().pitch).toBe(1); // gamepad beats keyboard

    input.setTouchState(touch(1, 0.25));
    expect(input.getControls().pitch).toBe(0.25); // touch beats gamepad

    input.setTouchState(touch(1, 0)); // pad held at neutral still owns the pitch
    expect(input.getControls().pitch).toBe(0);

    input.setTouchState(touch(0));
    expect(input.getControls().pitch).toBe(1); // back to gamepad

    input.feedGamepads([pad([0, -0.05])]); // inside the deadzone
    expect(input.getControls().pitch).toBe(-1); // back to the keyboard
  });

  it('touch pitch is ignored when no pad is held', () => {
    const { input } = setup();
    input.setTouchState(touch(0, 0.9)); // dir 0 means no pad: pitch must not leak through
    expect(input.getControls().pitch).toBe(0);
  });

  it('invertPitch applies once, to the merged result, for every source', () => {
    const { input, settings } = setup({ invertPitch: true });

    input.feedKeyDown('ArrowUp');
    input.update(0.25);
    expect(input.getControls().pitch).toBe(-1);
    input.feedKeyUp('ArrowUp');
    input.update(1);

    input.feedGamepads([pad([0, -1])]);
    expect(input.getControls().pitch).toBe(-1);
    input.feedGamepads([pad()]);

    input.setTouchState(touch(-1, 0.5));
    expect(input.getControls().pitch).toBe(-0.5);

    settings.invertPitch = false; // settings are read live
    expect(input.getControls().pitch).toBe(0.5);
  });

  it('pitch is never -0 and always within [-1, 1]', () => {
    const { input } = setup({ invertPitch: true });
    expect(Object.is(input.getControls().pitch, 0)).toBe(true);
    input.setTouchState(touch(1, 7));
    expect(input.getControls().pitch).toBe(-1);
    input.setTouchState(touch(1, -7));
    expect(input.getControls().pitch).toBe(1);
  });
});

describe('gadget (held) and edges (latched)', () => {
  it('gadget is true while any source holds it', () => {
    const { input } = setup();
    expect(input.getControls().gadget).toBe(false);
    input.feedKeyDown('Space');
    expect(input.getControls().gadget).toBe(true);
    input.setTouchState(touch(0, 0, true));
    input.feedKeyUp('Space');
    expect(input.getControls().gadget).toBe(true); // touch still holds
    input.setTouchState(touch(0, 0, false));
    input.feedGamepads([pad([0, 0], [A])]);
    expect(input.getControls().gadget).toBe(true);
    input.feedGamepads([pad()]);
    expect(input.getControls().gadget).toBe(false);
  });

  it('an edge latches and survives any number of reads until consumeEdges()', () => {
    const { input } = setup();
    input.feedKeyDown('Space');
    for (let i = 0; i < 5; i++) expect(input.getControls().gadgetPressed).toBe(true);
    expect(input.consumeEdges()).toEqual({ gadgetPressed: true, pausePressed: false });
    expect(input.getControls().gadgetPressed).toBe(false);
    expect(input.getControls().gadget).toBe(true); // still held
    expect(input.consumeEdges()).toEqual({ gadgetPressed: false, pausePressed: false });
  });

  it('a tap shorter than a step still produces its edge, even though gadget is already false', () => {
    const { input } = setup();
    input.feedKeyDown('Space');
    input.feedKeyUp('Space');
    const c = input.getControls();
    expect(c.gadget).toBe(false);
    expect(c.gadgetPressed).toBe(true);
  });

  it('held keys and OS auto-repeat do not re-latch', () => {
    const { input } = setup();
    input.feedKeyDown('Space');
    input.consumeEdges();
    input.feedKeyDown('Space'); // auto-repeat that slipped through
    input.feedKeyDown('KeyJ'); // second gadget key while the first is held
    expect(input.getControls().gadgetPressed).toBe(false);
    input.feedKeyUp('Space');
    input.feedKeyUp('KeyJ');
    input.feedKeyDown('Space'); // a genuine new press
    expect(input.getControls().gadgetPressed).toBe(true);
  });

  it('pause edges come from the keyboard, the gamepad Start button and pressPause()', () => {
    const { input } = setup();
    input.feedKeyDown('Escape');
    expect(input.consumeEdges().pausePressed).toBe(true);
    input.feedKeyUp('Escape');
    input.feedKeyDown('KeyP');
    expect(input.consumeEdges().pausePressed).toBe(true);
    input.feedGamepads([pad([0, 0], [START])]);
    expect(input.consumeEdges().pausePressed).toBe(true);
    input.feedGamepads([pad([0, 0], [START])]); // held: no new edge
    expect(input.getControls().pausePressed).toBe(false);
    input.pressPause();
    expect(input.getControls().pausePressed).toBe(true);
    expect(input.getControls().gadgetPressed).toBe(false);
  });

  it('gamepad A: edge on the press only; releasing and pressing again is a new edge', () => {
    const { input } = setup();
    input.feedGamepads([pad([0, 0], [A])]);
    expect(input.consumeEdges().gadgetPressed).toBe(true);
    input.feedGamepads([pad([0, 0], [A])]);
    expect(input.getControls().gadgetPressed).toBe(false);
    input.feedGamepads([pad()]);
    input.feedGamepads([pad([0, 0], [A])]);
    expect(input.getControls().gadgetPressed).toBe(true);
  });

  it('touch gadget: rising edge of the aggregate only', () => {
    const { input } = setup();
    input.setTouchState(touch(0, 0, true));
    expect(input.consumeEdges().gadgetPressed).toBe(true);
    input.setTouchState(touch(-1, 0.3, true)); // still held while a pad goes down
    expect(input.getControls().gadgetPressed).toBe(false);
    input.setTouchState(touch(-1, 0.3, false));
    input.setTouchState(touch(-1, 0.3, true));
    expect(input.getControls().gadgetPressed).toBe(true);
  });

  it('edges are per source: a press on another device while the gadget is held still counts', () => {
    const { input } = setup();
    input.feedKeyDown('Space');
    input.consumeEdges();
    input.feedGamepads([pad([0, 0], [A])]);
    expect(input.getControls().gadgetPressed).toBe(true);
  });

  it('reset() releases held keys and touch and drops latched edges', () => {
    const { input } = setup();
    input.feedKeyDown('ArrowLeft');
    input.feedKeyDown('Space');
    input.setTouchState(touch(1, 0.5, true));
    input.pressPause();
    input.reset();
    expect(input.getControls()).toEqual({ dir: 0, pitch: 0, gadget: false, gadgetPressed: false, pausePressed: false });
  });

  it('reset() does not turn a still-held gamepad button into a new press', () => {
    const { input } = setup();
    input.feedGamepads([pad([0, 0], [A])]);
    input.consumeEdges();
    input.reset();
    input.feedGamepads([pad([0, 0], [A])]);
    expect(input.getControls().gadgetPressed).toBe(false);
  });
});

describe('edge contract: never lost, never duplicated between frames and fixed steps', () => {
  it('a frame with several steps delivers the edge to exactly one of them', () => {
    const { input } = setup();
    input.feedKeyDown('Space');
    input.feedKeyUp('Space');
    // one rendered frame containing three fixed steps:
    const seen = [step(input), step(input), step(input)].map((c) => c.gadgetPressed);
    expect(seen).toEqual([true, false, false]);
  });

  it('a frame with no steps keeps the edge for the next frame', () => {
    const { input } = setup();
    input.feedKeyDown('Space');
    input.feedKeyUp('Space');
    // frame A: zero steps (reads only render-side state, never consumes)
    expect(input.getControls().gadgetPressed).toBe(true);
    // frame B: first step sees it
    expect(step(input).gadgetPressed).toBe(true);
    expect(step(input).gadgetPressed).toBe(false);
  });

  it('randomised frames: every press is seen by the very next step, and by only that step', () => {
    const rng = createRng(777);
    const { input } = setup();
    let pendingPress = false;
    let presses = 0;
    let observed = 0;
    for (let frame = 0; frame < 3000; frame++) {
      // 0..2 input events between frames
      const events = rng.int(0, 2);
      for (let e = 0; e < events; e++) {
        const kind = rng.int(0, 3);
        if (kind === 0 && !pendingPress) {
          input.feedKeyDown('Space');
          input.feedKeyUp('Space');
          pendingPress = true;
          presses++;
        } else if (kind === 1 && !pendingPress) {
          input.setTouchState(touch(0, 0, true));
          input.setTouchState(touch(0, 0, false));
          pendingPress = true;
          presses++;
        } else if (kind === 2 && !pendingPress) {
          input.feedGamepads([pad([0, 0], [A])]);
          input.feedGamepads([pad()]);
          pendingPress = true;
          presses++;
        } else {
          input.feedKeyDown('ArrowLeft'); // unrelated input noise
          input.feedKeyUp('ArrowLeft');
        }
      }
      // 0..3 fixed steps in this frame (0 happens when a frame is shorter than a step)
      const steps = rng.int(0, 3);
      for (let s = 0; s < steps; s++) {
        input.update(1 / 120);
        const c = input.getControls();
        if (pendingPress) {
          expect(c.gadgetPressed, 'a pending press must be delivered by the next step').toBe(true);
          observed++;
          pendingPress = false;
        } else {
          expect(c.gadgetPressed, 'no phantom / duplicate edge').toBe(false);
        }
        input.consumeEdges();
      }
    }
    expect(presses).toBeGreaterThan(300);
    expect(observed).toBeLessThanOrEqual(presses);
    expect(observed).toBeGreaterThan(presses - 2); // at most the final unseen press is outstanding
  });
});

describe('gamepad connection', () => {
  it('reports connect / disconnect once each and drops its inputs on disconnect', () => {
    const { input } = setup();
    const events: boolean[] = [];
    input.onGamepadChange = (c) => events.push(c);
    expect(input.gamepadConnected).toBe(false);

    input.feedGamepads([]);
    expect(events).toEqual([]);

    input.feedGamepads([pad([0.9, 0])]);
    input.feedGamepads([pad([0.9, 0])]);
    expect(events).toEqual([true]);
    expect(input.gamepadConnected).toBe(true);
    expect(input.getControls().dir).toBe(1);

    input.feedGamepads([]); // unplugged with the stick held
    expect(events).toEqual([true, false]);
    expect(input.gamepadConnected).toBe(false);
    expect(input.getControls().dir).toBe(0);
    expect(input.getControls().gadgetPressed).toBe(false); // disconnecting is not a press
  });
});

describe('DOM listeners (fake window / document)', () => {
  let g: FakeGlobals;
  beforeEach(() => {
    g = installFakeGlobals();
  });
  afterEach(() => {
    g.restore();
  });

  const key = (type: 'keydown' | 'keyup', code: string, props: Record<string, unknown> = {}) =>
    fire(g.window, type, { code, repeat: false, ...props });

  it('arrow / A / D set the direction; arrows and space are preventDefault-ed, letters are not', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);

    expect(key('keydown', 'ArrowLeft').defaultPrevented).toBe(true);
    expect(input.getControls().dir).toBe(-1);
    key('keyup', 'ArrowLeft');
    expect(input.getControls().dir).toBe(0);

    expect(key('keydown', 'KeyD').defaultPrevented).toBe(false);
    expect(input.getControls().dir).toBe(1);
    key('keyup', 'KeyD');

    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(input.getControls()).toMatchObject({ gadget: true, gadgetPressed: true });
    key('keyup', 'Space');
    expect(input.getControls().gadget).toBe(false);
  });

  it('ignores auto-repeat (but still stops the page scrolling)', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);
    key('keydown', 'Space');
    input.consumeEdges();
    const repeated = key('keydown', 'Space', { repeat: true });
    expect(repeated.defaultPrevented).toBe(true);
    expect(input.getControls().gadgetPressed).toBe(false);

    key('keydown', 'ArrowLeft');
    key('keydown', 'ArrowRight');
    key('keydown', 'ArrowLeft', { repeat: true }); // OS repeats the older key
    expect(input.getControls().dir).toBe(1);
  });

  it('Escape and P raise pause edges', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);
    key('keydown', 'Escape');
    expect(input.consumeEdges().pausePressed).toBe(true);
    key('keydown', 'KeyP');
    expect(input.consumeEdges().pausePressed).toBe(true);
  });

  it('ignores browser shortcuts and typing in text fields', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);

    expect(key('keydown', 'ArrowLeft', { ctrlKey: true }).defaultPrevented).toBe(false);
    key('keydown', 'KeyA', { metaKey: true });
    key('keydown', 'KeyD', { altKey: true });
    expect(input.getControls().dir).toBe(0);

    const textbox = new FakeEl('INPUT');
    expect(key('keydown', 'Space', { target: textbox }).defaultPrevented).toBe(false);
    key('keydown', 'ArrowLeft', { target: new FakeEl('TEXTAREA') });
    const editable = new FakeEl('DIV');
    editable.isContentEditable = true;
    key('keydown', 'ArrowRight', { target: editable });
    expect(input.getControls()).toMatchObject({ dir: 0, gadget: false, gadgetPressed: false });
  });

  it('key-ups are always honoured, even from a text field, so keys cannot stick', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);
    key('keydown', 'ArrowLeft');
    expect(input.getControls().dir).toBe(-1);
    key('keyup', 'ArrowLeft', { target: new FakeEl('INPUT'), ctrlKey: true });
    expect(input.getControls().dir).toBe(0);
  });

  it('works from event.key when event.code is missing', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);
    fire(g.window, 'keydown', { code: '', key: 'ArrowRight', repeat: false });
    expect(input.getControls().dir).toBe(1);
    fire(g.window, 'keyup', { code: '', key: 'ArrowRight' });
    expect(input.getControls().dir).toBe(0);
  });

  it('releases held keys when the window loses focus or the tab is hidden', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);
    key('keydown', 'ArrowLeft');
    key('keydown', 'Space');
    fire(g.window, 'blur');
    expect(input.getControls()).toMatchObject({ dir: 0, gadget: false });

    key('keydown', 'ArrowRight');
    g.document.hidden = true;
    fire(g.document, 'visibilitychange');
    expect(input.getControls().dir).toBe(0);
  });

  it('can listen on an element instead of window', () => {
    const { input } = setup();
    const el = new FakeEl('DIV');
    input.attach(el as unknown as HTMLElement);
    fire(el, 'keydown', { code: 'KeyA', repeat: false });
    expect(input.getControls().dir).toBe(-1);
    key('keydown', 'KeyD'); // not our target
    expect(input.getControls().dir).toBe(-1);
  });

  it('detach() removes every listener and releases input; attach() again re-attaches', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);
    key('keydown', 'ArrowLeft');
    input.detach();
    expect(input.getControls().dir).toBe(0);
    key('keydown', 'ArrowRight');
    expect(input.getControls().dir).toBe(0);
    input.detach(); // idempotent

    input.attach(g.window as unknown as Window);
    key('keydown', 'ArrowRight');
    expect(input.getControls().dir).toBe(1);
    input.attach(g.window as unknown as Window); // double attach must not double-register
    key('keyup', 'ArrowRight');
    expect(input.getControls().dir).toBe(0);
  });

  it('polls navigator.getGamepads() in update() and tracks connect / disconnect events', () => {
    const { input } = setup();
    input.attach(g.window as unknown as Window);
    const events: boolean[] = [];
    input.onGamepadChange = (c) => events.push(c);

    g.setGamepads([null, pad([0.9, 0], [A])]);
    fire(g.window, 'gamepadconnected');
    expect(input.gamepadConnected).toBe(true);
    expect(events).toEqual([true]);
    input.update(1 / 120);
    expect(input.getControls()).toMatchObject({ dir: 1, gadget: true, gadgetPressed: true });

    g.setGamepads([null, null]);
    fire(g.window, 'gamepaddisconnected');
    expect(input.gamepadConnected).toBe(false);
    expect(events).toEqual([true, false]);
    expect(input.getControls()).toMatchObject({ dir: 0, gadget: false });
  });

  it('update() with no gamepad API is harmless', () => {
    g.restore(); // plain node: no window / navigator.getGamepads
    const { input } = setup();
    expect(() => input.update(1 / 120)).not.toThrow();
    expect(input.getControls().dir).toBe(0);
  });
});
