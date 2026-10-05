/**
 * Tiny stand-ins for the DOM so the event-listener glue can be tested under the node environment.
 * Node ships `EventTarget` and `Event`; we add the few element / window properties the input code
 * touches.
 */
import { vi } from 'vitest';

/** An element-ish EventTarget. */
export class FakeEl extends EventTarget {
  tagName: string;
  isContentEditable = false;
  /** Pretend to sit inside a `[data-ui]` element. */
  insideUi = false;
  captured: number[] = [];

  constructor(tagName = 'DIV') {
    super();
    this.tagName = tagName;
  }

  closest(selector: string): FakeEl | null {
    return selector === '[data-ui]' && this.insideUi ? this : null;
  }

  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId);
  }
}

/**
 * Build an Event whose extra properties (code, repeat, clientX, ... and even `target`) are defined
 * as own properties, shadowing the prototype accessors. Cancelable, so `defaultPrevented` works.
 */
export function makeEvent(type: string, props: Record<string, unknown> = {}): Event {
  const ev = new Event(type, { cancelable: true, bubbles: true });
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(ev, key, { value, configurable: true });
  }
  return ev;
}

/** Dispatch a fabricated event on `target` and return it (so tests can inspect `defaultPrevented`). */
export function fire(target: EventTarget, type: string, props: Record<string, unknown> = {}): Event {
  const ev = makeEvent(type, props);
  target.dispatchEvent(ev);
  return ev;
}

export interface FakeGlobals {
  window: EventTarget;
  document: EventTarget & { hidden: boolean };
  /** Replace what `navigator.getGamepads()` returns. */
  setGamepads(list: unknown[]): void;
  restore(): void;
}

/** Install fake `window`, `document` and `navigator.getGamepads` globals. Call `restore()` after. */
export function installFakeGlobals(): FakeGlobals {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  let pads: unknown[] = [];
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  return {
    window: win,
    document: doc,
    setGamepads(list) {
      pads = list;
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}
