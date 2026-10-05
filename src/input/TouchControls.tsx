/**
 * On-screen touch controls, in one of two layouts (`Settings.touchLayout`):
 *
 *  - 'pads' (default): two big direction pads (bottom-left / bottom-right) that turn into vertical
 *    pitch sliders while held, two small gadget buttons, and a pause button.
 *  - 'joystick': one floating thumb joystick, a single gadget button, and the pause button.
 *
 *   <TouchControls input={inputManager} settings={() => settings} stickEnabled={phase === 'fly'} />
 *
 * Wiring: the component never reads the game; it pushes its state into the `InputManager`
 * (`setTouchState({ dir, pitch, gadget })` whenever anything changes, `pressPause()` for the pause
 * button). Pitch is reported raw (up = +); the manager applies `Settings.invertPitch`.
 *
 * Pads (logic lives in `touchPads.ts`, which is unit tested):
 *  - Pressing a pad makes it the active direction (the most recent wins when both are down) and
 *    turns it into a slider: a track of `2 * sliderTravel` px appears centred on the touch-down
 *    point, a knob follows the finger's vertical offset, pitch = clamp(-dy / sliderTravel, -1, 1).
 *  - The pointer is captured, so horizontal drift never cancels, and each thumb has its own pointer
 *    id, so two-thumb play works. Releasing the active pad falls back to the other pad if it is
 *    still held (using its own slider), else dir = 0 and pitch = 0.
 *  - Both gadget buttons trigger the gadget. Haptics: `navigator.vibrate(8)` on a pad press.
 *
 * Joystick (logic lives in `joystick.ts`, which is unit tested):
 *  - Touching anywhere in the stick zone (the left 55 % of the screen, the right 55 % when
 *    left-handed) plants the stick's base where the thumb landed. The knob follows the thumb, clamped
 *    to a ring of radius `sliderTravel` px. The horizontal offset gives dir (with a dead zone and
 *    hysteresis), the vertical one gives pitch, independently: pushing straight up or down pitches
 *    without turning. Lifting the thumb hides the stick and sends dir 0 / pitch 0.
 *  - One pointer owns the stick at a time, captured like the pads. A second finger landing in the
 *    zone is ignored.
 *  - While the plane waits to be thrown the zone must not swallow the throw drag, so the owner
 *    passes `stickEnabled={false}` then: the zone stops catching pointers (`pointer-events: none`) and
 *    a held stick is let go. The gadget and pause buttons keep working.
 *  - While the zone is on and no thumb is down, a faint ghost of the ring near the bottom of the zone
 *    shows where to put the thumb. The single gadget button sits bottom-right (bottom-left when
 *    left-handed). Haptics: `navigator.vibrate(8)` whenever a direction engages.
 *
 * Shown only on touch devices ((pointer: coarse), or after the first touch) unless `force` says
 * otherwise. The root ignores pointer events itself; every interactive element carries `data-ui` so
 * the throw gesture knows to leave it alone.
 *
 * Styling hooks (see touch.css): .tc-root (.tc-root--left-handed, .tc-root--joystick), .tc-pad
 * (.tc-pad--left/--right, --held, --active), .tc-slider (.tc-slider--left/--right, --active),
 * .tc-slider__track, .tc-slider__knob, .tc-stick-zone (.tc-stick-zone--off), .tc-stick
 * (.tc-stick--ghost), .tc-stick__ring, .tc-stick__chev (.tc-stick__chev--left/--right, --active),
 * .tc-stick__knob, .tc-gadget (.tc-gadget--left/--right, --active), .tc-pause.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../core/types';
import { TOUCH_IDLE, type InputManager } from './InputManager';
import { JOYSTICK_IDLE, joystickReduce, joystickView, type JoystickAction, type JoystickState } from './joystick';
import {
  TOUCH_PADS_IDLE,
  sliderKnobOffset,
  touchPadsOutput,
  touchPadsReduce,
  type PadSide,
  type TouchPadsAction,
  type TouchPadsState,
} from './touchPads';
import './touch.css';

export interface TouchControlsProps {
  /** Receives the touch state. */
  input: InputManager;
  /** Current settings, or a getter for them (read on every render and event, so changes apply live). */
  settings: Settings | (() => Settings);
  /** `true` always shows the controls (desktop testing), `false` never does; omit to auto-detect. */
  force?: boolean;
  /** Extra callback when the pause button is tapped (the manager's `pausePressed` edge fires either way). */
  onPause?: () => void;
  /**
   * Joystick layout only: is the stick zone live? Pass `false` while the plane waits to be thrown so
   * the throw drag works anywhere on the screen (the zone then ignores pointers and a held stick is
   * let go). Defaults to true. The pads and the buttons are not affected.
   */
  stickEnabled?: boolean;
}

function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Touch device detection: coarse primary pointer, or the first touch we ever see. */
function useTouchDevice(force: boolean | undefined): boolean {
  const [touch, setTouch] = useState(isCoarsePointer);
  useEffect(() => {
    if (force !== undefined || typeof window === 'undefined') return;
    const mq = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
    const onMedia = (): void => {
      if (mq?.matches) setTouch(true);
    };
    const onContact = (e: Event): void => {
      if (e.type === 'touchstart' || (e as PointerEvent).pointerType === 'touch') setTouch(true);
    };
    mq?.addEventListener?.('change', onMedia);
    window.addEventListener('touchstart', onContact, { passive: true, capture: true });
    window.addEventListener('pointerdown', onContact, { passive: true, capture: true });
    return () => {
      mq?.removeEventListener?.('change', onMedia);
      window.removeEventListener('touchstart', onContact, { capture: true });
      window.removeEventListener('pointerdown', onContact, { capture: true });
    };
  }, [force]);
  return force ?? touch;
}

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function buzz(settings: Settings): void {
  if (!settings.haptics) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(8);
  } catch {
    /* haptics are best effort */
  }
}

function capture(e: PointerEvent): void {
  try {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  } catch {
    /* the pointer is already gone */
  }
}

const preventDefault = (e: Event): void => e.preventDefault();

interface Live {
  pads: TouchPadsState;
  stick: JoystickState;
  /** Pointer id holding each gadget button, or null. */
  gadget: Record<PadSide, number | null>;
  /** Cached bounds of the root, taken at pointer-down (the root is fixed, so it can't move mid-hold). */
  originX: number;
  originY: number;
  settings: Settings;
  stickEnabled: boolean;
  input: InputManager;
  onPause: (() => void) | undefined;
}

interface StickProps {
  /** Ring radius, which is also how far the knob travels, px. */
  radius: number;
  dir: -1 | 0 | 1;
  /** Knob offset from the centre, px (y-down). */
  knobX: number;
  knobY: number;
  /** Where the base is centred (root coordinates, px). Omitted for the idle ghost, which CSS places. */
  at?: { x: number; y: number };
}

/** The joystick drawing: base ring with the two turn zones, pitch-neutral tick, and the knob. Purely visual. */
function Stick(props: StickProps) {
  const { radius, dir, knobX, knobY, at } = props;
  return (
    <div
      class={cx('tc-stick', !at && 'tc-stick--ghost')}
      style={{ '--tc-stick-radius': `${radius}px`, ...(at ? { left: at.x, top: at.y } : null) }}
      aria-hidden="true"
    >
      <div class="tc-stick__ring" />
      <div class="tc-stick__knob" style={{ transform: `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))` }} />
      {/* After the knob so the lit chevron stays crisp when the knob sits on it at full deflection. */}
      <span class={cx('tc-stick__chev', 'tc-stick__chev--left', dir < 0 && 'tc-stick__chev--active')} />
      <span class={cx('tc-stick__chev', 'tc-stick__chev--right', dir > 0 && 'tc-stick__chev--active')} />
    </div>
  );
}

export function TouchControls(props: TouchControlsProps) {
  const settings = typeof props.settings === 'function' ? props.settings() : props.settings;
  const visible = useTouchDevice(props.force);
  const joystick = settings.touchLayout === 'joystick';
  const stickEnabled = props.stickEnabled ?? true;

  const rootRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [pads, setPads] = useState<TouchPadsState>(TOUCH_PADS_IDLE);
  const [stick, setStick] = useState<JoystickState>(JOYSTICK_IDLE);
  const [gadgetHeld, setGadgetHeld] = useState<Record<PadSide, boolean>>({ left: false, right: false });

  // The single source of truth for event handlers; React-style state above is only for rendering.
  const live = useRef<Live>({
    pads: TOUCH_PADS_IDLE,
    stick: JOYSTICK_IDLE,
    gadget: { left: null, right: null },
    originX: 0,
    originY: 0,
    settings,
    stickEnabled,
    input: props.input,
    onPause: props.onPause,
  });
  live.current.settings = settings;
  live.current.stickEnabled = stickEnabled;
  live.current.input = props.input;
  live.current.onPause = props.onPause;

  /** Push the current pads / stick + gadget state to the InputManager. */
  const sync = (): void => {
    const l = live.current;
    // Only one layout is ever live, so take whichever has a thumb down.
    const stickOut = joystickView(l.stick, l.settings.sliderTravel);
    const out = stickOut.held ? stickOut : touchPadsOutput(l.pads, l.settings.sliderTravel);
    l.input.setTouchState({
      dir: out.dir,
      pitch: out.pitch,
      gadget: l.gadget.left !== null || l.gadget.right !== null,
    });
  };

  const dispatch = (action: TouchPadsAction): void => {
    const l = live.current;
    const next = touchPadsReduce(l.pads, action);
    if (next === l.pads) return;
    l.pads = next;
    setPads(next);
    sync();
  };

  const stickDispatch = (action: JoystickAction): void => {
    const l = live.current;
    const prev = l.stick;
    const next = joystickReduce(prev, action, l.settings.sliderTravel);
    if (next === prev) return;
    l.stick = next;
    setStick(next);
    sync();
    // A tick whenever a direction engages (including a swing straight across to the other side).
    const dir = next?.dir ?? 0;
    if (dir !== 0 && dir !== (prev?.dir ?? 0)) buzz(l.settings);
  };

  const releaseGadget = (side: PadSide, pointerId: number): void => {
    const l = live.current;
    if (l.gadget[side] !== pointerId) return;
    l.gadget[side] = null;
    setGadgetHeld((h) => ({ ...h, [side]: false }));
    sync();
  };

  const releaseAll = (): void => {
    const l = live.current;
    l.gadget.left = null;
    l.gadget.right = null;
    setGadgetHeld({ left: false, right: false });
    dispatch({ type: 'reset' });
    stickDispatch({ type: 'reset' });
    sync();
  };

  // Hiding the controls while a thumb is down (say `force` flips) must not leave the manager stuck.
  useEffect(() => {
    const l = live.current;
    const holding = l.pads.left || l.pads.right || l.stick || l.gadget.left !== null || l.gadget.right !== null;
    if (!visible && holding) releaseAll();
    // Only reacts to visibility; `releaseAll` just reads `live`.
  }, [visible]);

  // The zone goes off while the plane waits to be thrown: let go of a held stick, and of its pointer,
  // so the next touch starts a clean throw drag.
  useEffect(() => {
    const held = live.current.stick;
    if (stickEnabled || !held) return;
    try {
      zoneRef.current?.releasePointerCapture(held.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    stickDispatch({ type: 'reset' });
    // Only reacts to the zone being switched off; `stickDispatch` just reads `live`.
  }, [stickEnabled]);

  // Let go of everything when the window loses focus or the component goes away.
  useEffect(() => {
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('blur', releaseAll);
      live.current.pads = TOUCH_PADS_IDLE;
      live.current.stick = JOYSTICK_IDLE;
      live.current.gadget.left = null;
      live.current.gadget.right = null;
      live.current.input.setTouchState(TOUCH_IDLE);
    };
    // Intentionally empty deps: the handlers only read `live`, which never changes identity.
  }, []);

  if (!visible) return null;

  const travel = settings.sliderTravel;
  const out = touchPadsOutput(pads, travel);
  const stickView = joystickView(stick, travel);

  const padProps = (side: PadSide) => ({
    onPointerDown: (e: PointerEvent): void => {
      e.preventDefault();
      capture(e);
      const rect = rootRef.current?.getBoundingClientRect();
      live.current.originX = rect?.left ?? 0;
      live.current.originY = rect?.top ?? 0;
      dispatch({
        type: 'down',
        side,
        pointerId: e.pointerId,
        x: e.clientX - live.current.originX,
        y: e.clientY - live.current.originY,
      });
      buzz(live.current.settings);
    },
    onPointerMove: (e: PointerEvent): void => {
      dispatch({ type: 'move', pointerId: e.pointerId, y: e.clientY - live.current.originY });
    },
    onPointerUp: (e: PointerEvent): void => dispatch({ type: 'up', pointerId: e.pointerId }),
    onPointerCancel: (e: PointerEvent): void => dispatch({ type: 'up', pointerId: e.pointerId }),
    onLostPointerCapture: (e: PointerEvent): void => dispatch({ type: 'up', pointerId: e.pointerId }),
  });

  const stickProps = {
    onPointerDown: (e: PointerEvent): void => {
      const l = live.current;
      if (!l.stickEnabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const rect = rootRef.current?.getBoundingClientRect();
      l.originX = rect?.left ?? 0;
      l.originY = rect?.top ?? 0;
      stickDispatch({ type: 'down', pointerId: e.pointerId, x: e.clientX - l.originX, y: e.clientY - l.originY });
      if (l.stick?.pointerId !== e.pointerId) return; // another thumb already owns the stick
      e.preventDefault();
      capture(e);
    },
    onPointerMove: (e: PointerEvent): void => {
      const l = live.current;
      stickDispatch({ type: 'move', pointerId: e.pointerId, x: e.clientX - l.originX, y: e.clientY - l.originY });
    },
    onPointerUp: (e: PointerEvent): void => stickDispatch({ type: 'up', pointerId: e.pointerId }),
    onPointerCancel: (e: PointerEvent): void => stickDispatch({ type: 'up', pointerId: e.pointerId }),
    onLostPointerCapture: (e: PointerEvent): void => stickDispatch({ type: 'up', pointerId: e.pointerId }),
  };

  const gadgetProps = (side: PadSide) => ({
    onPointerDown: (e: PointerEvent): void => {
      e.preventDefault();
      capture(e);
      live.current.gadget[side] = e.pointerId;
      setGadgetHeld((h) => ({ ...h, [side]: true }));
      sync();
    },
    onPointerUp: (e: PointerEvent): void => releaseGadget(side, e.pointerId),
    onPointerCancel: (e: PointerEvent): void => releaseGadget(side, e.pointerId),
    onLostPointerCapture: (e: PointerEvent): void => releaseGadget(side, e.pointerId),
  });

  const sides: PadSide[] = ['left', 'right'];
  // The joystick layout has no pads, and its single gadget button goes to the hand that is not on the stick.
  const padSides: PadSide[] = joystick ? [] : sides;
  const gadgetSides: PadSide[] = joystick ? [settings.leftHanded ? 'left' : 'right'] : sides;

  return (
    <div
      ref={rootRef}
      class={cx('tc-root', settings.leftHanded && 'tc-root--left-handed', joystick && 'tc-root--joystick')}
      role="group"
      aria-label="Touch controls"
      onContextMenu={preventDefault}
    >
      {joystick && (
        <div
          key="stick-zone"
          ref={zoneRef}
          class={cx('tc-stick-zone', !stickEnabled && 'tc-stick-zone--off')}
          data-ui=""
          role="group"
          aria-label="Flight stick"
          {...stickProps}
        />
      )}

      {joystick && stickView.held && (
        <Stick key="stick" radius={travel} dir={stickView.dir} knobX={stickView.knobX} knobY={stickView.knobY} at={stickView} />
      )}
      {joystick && stickEnabled && !stickView.held && <Stick key="stick-ghost" radius={travel} dir={0} knobX={0} knobY={0} />}

      {padSides.map((side) => {
        const held = side === 'left' ? out.leftHeld : out.rightHeld;
        return (
          <div
            key={`pad-${side}`}
            class={cx('tc-pad', `tc-pad--${side}`, held && 'tc-pad--held', out.active === side && 'tc-pad--active')}
            data-ui=""
            role="button"
            aria-label={side === 'left' ? 'Fly left' : 'Fly right'}
            aria-pressed={held}
            {...padProps(side)}
          >
            <span class="tc-pad__icon" aria-hidden="true" />
          </div>
        );
      })}

      {gadgetSides.map((side) => (
        <div
          key={`gadget-${side}`}
          class={cx('tc-gadget', `tc-gadget--${side}`, gadgetHeld[side] && 'tc-gadget--active')}
          data-ui=""
          role="button"
          aria-label="Gadget"
          aria-pressed={gadgetHeld[side]}
          {...gadgetProps(side)}
        >
          <span class="tc-gadget__icon" aria-hidden="true" />
        </div>
      ))}

      <button
        type="button"
        class="tc-pause"
        data-ui=""
        aria-label="Pause"
        tabIndex={-1}
        onPointerDown={preventDefault}
        onClick={() => {
          live.current.input.pressPause();
          live.current.onPause?.();
        }}
      >
        <span class="tc-pause__bar" aria-hidden="true" />
        <span class="tc-pause__bar" aria-hidden="true" />
      </button>

      {padSides.map((side) => {
        const hold = pads[side];
        if (!hold) return null;
        const offset = sliderKnobOffset(hold.curY - hold.y, travel);
        return (
          <div
            key={`slider-${side}`}
            class={cx('tc-slider', `tc-slider--${side}`, out.active === side && 'tc-slider--active')}
            style={{ left: hold.x, top: hold.y, height: travel * 2 }}
          >
            <div class="tc-slider__track" />
            <div class="tc-slider__knob" style={{ transform: `translate(-50%, calc(-50% + ${offset}px))` }} />
          </div>
        );
      })}
    </div>
  );
}
