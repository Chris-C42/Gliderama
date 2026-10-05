/**
 * On-screen touch controls: two big direction pads (bottom-left / bottom-right) that turn into
 * vertical pitch sliders while held, two small gadget buttons, and a pause button.
 *
 *   <TouchControls input={inputManager} settings={() => settings} />
 *
 * Wiring: the component never reads the game; it pushes its state into the `InputManager`
 * (`setTouchState({ dir, pitch, gadget })` whenever anything changes, `pressPause()` for the pause
 * button). Pitch is reported raw (up = +); the manager applies `Settings.invertPitch`.
 *
 * Behaviour (logic lives in `touchPads.ts`, which is unit tested):
 *  - Pressing a pad makes it the active direction (the most recent wins when both are down) and
 *    turns it into a slider: a track of `2 * sliderTravel` px appears centred on the touch-down
 *    point, a knob follows the finger's vertical offset, pitch = clamp(-dy / sliderTravel, -1, 1).
 *  - The pointer is captured, so horizontal drift never cancels, and each thumb has its own pointer
 *    id, so two-thumb play works. Releasing the active pad falls back to the other pad if it is
 *    still held (using its own slider), else dir = 0 and pitch = 0.
 *  - Both gadget buttons trigger the gadget. Haptics: `navigator.vibrate(8)` on a pad press.
 *  - Shown only on touch devices ((pointer: coarse), or after the first touch) unless `force` says
 *    otherwise. The root ignores pointer events itself; every interactive element carries
 *    `data-ui` so the throw gesture knows to leave it alone.
 *
 * Styling hooks (see touch.css): .tc-root (.tc-root--left-handed), .tc-pad (.tc-pad--left/--right,
 * --held, --active), .tc-slider (.tc-slider--left/--right, --active), .tc-slider__track,
 * .tc-slider__knob, .tc-gadget (.tc-gadget--left/--right, --active), .tc-pause.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { Settings } from '../core/types';
import { TOUCH_IDLE, type InputManager } from './InputManager';
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
  /** Pointer id holding each gadget button, or null. */
  gadget: Record<PadSide, number | null>;
  /** Cached bounds of the root, taken at pointer-down (the root is fixed, so it can't move mid-hold). */
  originX: number;
  originY: number;
  settings: Settings;
  input: InputManager;
  onPause: (() => void) | undefined;
}

export function TouchControls(props: TouchControlsProps) {
  const settings = typeof props.settings === 'function' ? props.settings() : props.settings;
  const visible = useTouchDevice(props.force);

  const rootRef = useRef<HTMLDivElement>(null);
  const [pads, setPads] = useState<TouchPadsState>(TOUCH_PADS_IDLE);
  const [gadgetHeld, setGadgetHeld] = useState<Record<PadSide, boolean>>({ left: false, right: false });

  // The single source of truth for event handlers; React-style state above is only for rendering.
  const live = useRef<Live>({
    pads: TOUCH_PADS_IDLE,
    gadget: { left: null, right: null },
    originX: 0,
    originY: 0,
    settings,
    input: props.input,
    onPause: props.onPause,
  });
  live.current.settings = settings;
  live.current.input = props.input;
  live.current.onPause = props.onPause;

  /** Push the current pads + gadget state to the InputManager. */
  const sync = (): void => {
    const l = live.current;
    const out = touchPadsOutput(l.pads, l.settings.sliderTravel);
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
    sync();
  };

  // Hiding the controls while a thumb is down (say `force` flips) must not leave the manager stuck.
  useEffect(() => {
    const l = live.current;
    const holding = l.pads.left || l.pads.right || l.gadget.left !== null || l.gadget.right !== null;
    if (!visible && holding) releaseAll();
    // Only reacts to visibility; `releaseAll` just reads `live`.
  }, [visible]);

  // Let go of everything when the window loses focus or the component goes away.
  useEffect(() => {
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('blur', releaseAll);
      live.current.pads = TOUCH_PADS_IDLE;
      live.current.gadget.left = null;
      live.current.gadget.right = null;
      live.current.input.setTouchState(TOUCH_IDLE);
    };
    // Intentionally empty deps: the handlers only read `live`, which never changes identity.
  }, []);

  if (!visible) return null;

  const travel = settings.sliderTravel;
  const out = touchPadsOutput(pads, travel);

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

  return (
    <div
      ref={rootRef}
      class={cx('tc-root', settings.leftHanded && 'tc-root--left-handed')}
      role="group"
      aria-label="Touch controls"
      onContextMenu={preventDefault}
    >
      {sides.map((side) => {
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

      {sides.map((side) => (
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

      {sides.map((side) => {
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
