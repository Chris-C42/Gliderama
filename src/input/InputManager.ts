/**
 * InputManager: merges keyboard, gamepad and on-screen touch controls into one `ControlState`.
 *
 * Typical use:
 *
 *   const input = new InputManager(() => settings);
 *   input.attach(window);
 *   // fixed-step update:
 *   input.update(dt);               // polls the gamepad, ramps the keyboard pitch
 *   const c = input.getControls();  // read (non-destructive, may be called any number of times)
 *   input.consumeEdges();           // then acknowledge the one-shot edges
 *   flight.step(c, dt);
 *
 * ## Edge semantics (gadgetPressed, pausePressed)
 *
 * Input events arrive between animation frames, but the simulation runs in fixed steps: a frame can
 * contain zero, one or several steps. So edges are *latched*, not tied to a frame:
 *
 *  - An edge is latched the moment it happens (key down, touch button down, gamepad button going
 *    from released to pressed as seen by `update`) and stays set in `getControls()` until
 *    `consumeEdges()` is called.
 *  - Reading never clears anything. `consumeEdges()` clears both latches and returns what it cleared.
 *  - Therefore, if the game calls `getControls()` then `consumeEdges()` exactly once per fixed step:
 *      * an edge is never lost: a press that lands in a frame with no step is delivered by the next
 *        step, and a tap shorter than one step is still seen even though `gadget` is already false;
 *      * an edge is never duplicated: it is visible to exactly one step; later steps of the same
 *        frame (and later frames) see `false` until a new press occurs.
 *  - Edges are per source (a gamepad A press and a Space press are two edges, even if the other
 *    source is already holding the gadget). Auto-repeat and held buttons never re-latch.
 *  - A latch is a flag, not a counter: presses that land before the same step collapse into one
 *    edge. At 120 Hz that window is 8 ms, so it can only happen across different devices.
 *  - Keyboard and touch are event driven, so nothing is missed. The gamepad is *polled* by
 *    `update()`; a button must stay down across one `update()` call to be seen (any physical press
 *    does, since a step is 8 ms), and a pad press made while `update()` is not being called is seen
 *    on the next call as long as the button is still down.
 *  - Consume unconditionally, every step, in every game state, including steps where the gadget
 *    can't be used, so a press made in a menu or during the throw phase does not fire later. If the
 *    simulation is not stepping (e.g. paused) but you still need Esc / P / Start to resume, keep
 *    calling `getControls()` + `consumeEdges()` once per rendered frame instead.
 *    `reset()` also drops any latched edges (use it when switching screens).
 *
 * `gadget` (held) is level-triggered: it is true while any source holds the gadget.
 *
 * ## Merging
 *
 *  - dir: each source has its own direction (keyboard: most recently pressed arrow / A / D still held;
 *    touch: most recently pressed pad still held; gamepad: D-pad, else the left stick). The source
 *    whose direction changed most recently wins; when it lets go, the next most recent held source
 *    takes over; nothing held = 0.
 *  - pitch: touch slider while any pad is held; otherwise the gamepad if its stick is out of the
 *    deadzone (or the D-pad is pressed); otherwise the keyboard ramp. `Settings.invertPitch` is
 *    applied once, to the merged result, for every source. Sources report "up = +".
 *  - gadget: any source. Pause: any source.
 *
 * Everything with a DOM dependency is confined to `attach` / `detach` and the private listeners;
 * the `feed*` methods take already-decoded input, which is what the unit tests drive.
 */

import { clamp } from '../core/math';
import type { ControlState, Settings } from '../core/types';
import { keyCodeOf, shouldIgnoreKeyDown } from './dom';
import {
  PAD_IDLE,
  combinePadRaw,
  mapPadRaw,
  padEdges,
  readNavigatorPads,
  readPad,
  type PadInput,
  type PadLike,
} from './gamepad';
import {
  KEYBOARD_IDLE,
  isGameKey,
  keyboardDir,
  keyboardGadget,
  keyboardKeyDown,
  keyboardKeyUp,
  keyboardTick,
  shouldPreventDefault,
  type KeyboardState,
} from './keyboard';
import { finalizePitch, mergeDir, mergePitch } from './merge';

/** What the on-screen controls report. Sent by `TouchControls` whenever something changes. */
export interface TouchInputState {
  /** Direction of the active pad: -1 left, +1 right, 0 when no pad is held. */
  dir: -1 | 0 | 1;
  /** Slider deflection of the active pad, -1..1, up = +, *not* inverted. Ignored when `dir` is 0. */
  pitch: number;
  /** True while either on-screen gadget button is held. */
  gadget: boolean;
}

export const TOUCH_IDLE: TouchInputState = Object.freeze({ dir: 0, pitch: 0, gadget: false });

export class InputManager {
  private readonly getSettings: () => Settings;

  private target: EventTarget | null = null;
  private kb: KeyboardState = KEYBOARD_IDLE;
  private touch: TouchInputState = TOUCH_IDLE;
  private pad: PadInput = PAD_IDLE;
  private padConnected = false;

  /** Source of the "most recent change" stamps used to merge directions. */
  private seq = 0;
  private kbStamp = 0;
  private touchStamp = 0;
  private padStamp = 0;

  private gadgetLatch = false;
  private pauseLatch = false;

  /** Called when the first gamepad appears (true) or the last one goes away (false). */
  onGamepadChange: ((connected: boolean) => void) | null = null;

  constructor(getSettings: () => Settings) {
    this.getSettings = getSettings;
  }

  // -------------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------------

  /**
   * Start listening. Keyboard events are listened for on `target` (use `window`, the default; an
   * element only receives keys while it is focused). Also listens on `window` for blur and gamepad
   * connect / disconnect. Calling it again re-attaches.
   */
  attach(target: HTMLElement | Window = window): void {
    this.detach();
    const t: EventTarget = target;
    t.addEventListener('keydown', this.onKeyDown);
    t.addEventListener('keyup', this.onKeyUp);
    this.target = t;
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('gamepadconnected', this.onPadChange);
    window.addEventListener('gamepaddisconnected', this.onPadChange);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Remove every listener and release everything that was held. Safe to call repeatedly. */
  detach(): void {
    if (this.target) {
      this.target.removeEventListener('keydown', this.onKeyDown);
      this.target.removeEventListener('keyup', this.onKeyUp);
      this.target = null;
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('gamepadconnected', this.onPadChange);
      window.removeEventListener('gamepaddisconnected', this.onPadChange);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.reset();
  }

  /**
   * Release held keys and touch controls and drop latched edges. Use it when switching screens so
   * nothing leaks from one context into the next. The gamepad is deliberately left alone: it is
   * re-polled every `update`, and a button that is still physically held must not turn into a
   * fresh "press" just because we reset.
   */
  reset(): void {
    this.kb = KEYBOARD_IDLE;
    this.touch = TOUCH_IDLE;
    this.gadgetLatch = false;
    this.pauseLatch = false;
  }

  // -------------------------------------------------------------------------------------------
  // Per-step API
  // -------------------------------------------------------------------------------------------

  /** Call once per fixed step *before* `getControls()`: polls the gamepad and ramps keyboard pitch. */
  update(dt: number): void {
    this.feedGamepads(readNavigatorPads());
    this.kb = keyboardTick(this.kb, dt);
  }

  /** The merged controls right now. Non-destructive; edges stay latched until `consumeEdges()`. */
  getControls(): ControlState {
    const dir = mergeDir([
      { dir: this.touch.dir, stamp: this.touchStamp },
      { dir: this.pad.dir, stamp: this.padStamp },
      { dir: keyboardDir(this.kb), stamp: this.kbStamp },
    ]);
    const raw = mergePitch({
      touchActive: this.touch.dir !== 0,
      touch: this.touch.pitch,
      pad: this.pad.pitch,
      keyboard: this.kb.pitch,
    });
    return {
      dir,
      pitch: finalizePitch(raw, this.getSettings().invertPitch),
      gadget: keyboardGadget(this.kb) || this.touch.gadget || this.pad.gadget,
      gadgetPressed: this.gadgetLatch,
      pausePressed: this.pauseLatch,
    };
  }

  /**
   * Acknowledge the latched edges (`gadgetPressed`, `pausePressed`). Call once per fixed step,
   * after `getControls()`. Returns the edges that were just cleared.
   */
  consumeEdges(): { gadgetPressed: boolean; pausePressed: boolean } {
    const out = { gadgetPressed: this.gadgetLatch, pausePressed: this.pauseLatch };
    this.gadgetLatch = false;
    this.pauseLatch = false;
    return out;
  }

  // -------------------------------------------------------------------------------------------
  // Touch bridge (used by TouchControls)
  // -------------------------------------------------------------------------------------------

  /**
   * Report the on-screen controls' state. A rising `gadget` latches `gadgetPressed`; a change of
   * `dir` counts as this source "changing" for the most-recent-wins direction merge.
   */
  setTouchState(next: TouchInputState): void {
    const prev = this.touch;
    const dir = next.dir;
    if (dir !== prev.dir) this.touchStamp = ++this.seq;
    if (next.gadget && !prev.gadget) this.gadgetLatch = true;
    this.touch = { dir, pitch: dir === 0 ? 0 : clamp(next.pitch, -1, 1), gadget: next.gadget };
  }

  /** Latch a pause request (the on-screen pause button; also handy for any other UI). */
  pressPause(): void {
    this.pauseLatch = true;
  }

  // -------------------------------------------------------------------------------------------
  // Decoded-input entry points (what the DOM listeners call; also what the tests drive)
  // -------------------------------------------------------------------------------------------

  /** A physical key (`KeyboardEvent.code`) went down. Ignore auto-repeat before calling. */
  feedKeyDown(code: string): void {
    const before = keyboardDir(this.kb);
    const res = keyboardKeyDown(this.kb, code);
    this.kb = res.state;
    if (res.gadgetPressed) this.gadgetLatch = true;
    if (res.pausePressed) this.pauseLatch = true;
    if (keyboardDir(this.kb) !== before) this.kbStamp = ++this.seq;
  }

  feedKeyUp(code: string): void {
    const before = keyboardDir(this.kb);
    this.kb = keyboardKeyUp(this.kb, code);
    if (keyboardDir(this.kb) !== before) this.kbStamp = ++this.seq;
  }

  /** Latest readings of the connected gamepads (usually `readNavigatorPads()`; empty = none). */
  feedGamepads(pads: readonly PadLike[]): void {
    const connected = pads.length > 0;
    if (!connected && !this.padConnected && this.pad === PAD_IDLE) return; // nothing to do, no allocation

    const next = connected ? mapPadRaw(combinePadRaw(pads.map(readPad))) : PAD_IDLE;
    const edges = padEdges(this.pad, next);
    if (edges.gadget) this.gadgetLatch = true;
    if (edges.pause) this.pauseLatch = true;
    if (next.dir !== this.pad.dir) this.padStamp = ++this.seq;
    this.pad = next;

    if (connected !== this.padConnected) {
      this.padConnected = connected;
      this.onGamepadChange?.(connected);
    }
  }

  /** Is a gamepad currently connected (as of the last poll)? */
  get gamepadConnected(): boolean {
    return this.padConnected;
  }

  // -------------------------------------------------------------------------------------------
  // DOM listeners
  // -------------------------------------------------------------------------------------------

  private onKeyDown = (e: Event): void => {
    const ev = e as KeyboardEvent;
    if (shouldIgnoreKeyDown(ev)) return; // browser shortcuts, or typing in a field
    const code = keyCodeOf(ev);
    if (!isGameKey(code)) return;
    if (shouldPreventDefault(code)) ev.preventDefault(); // arrows / space would scroll the page
    if (ev.repeat) return; // OS auto-repeat: not a new press
    this.feedKeyDown(code);
  };

  /** Key-ups are always honoured (even from a text field or with modifiers) so keys can't stick. */
  private onKeyUp = (e: Event): void => {
    const code = keyCodeOf(e as KeyboardEvent);
    if (code) this.feedKeyUp(code);
  };

  /** Focus loss swallows key-ups: release the keyboard so nothing is stuck on return. */
  private onBlur = (): void => {
    this.releaseKeys();
  };

  private onVisibility = (): void => {
    if (document.hidden) this.releaseKeys();
  };

  private onPadChange = (): void => {
    this.feedGamepads(readNavigatorPads());
  };

  private releaseKeys(): void {
    const before = keyboardDir(this.kb);
    this.kb = KEYBOARD_IDLE;
    if (before !== 0) this.kbStamp = ++this.seq;
  }
}
