/** Small DOM helpers shared by the input modules. Safe to import in non-DOM (node) environments. */

/** Fallbacks for browsers / virtual keyboards that don't fill in `KeyboardEvent.code`. */
const KEY_TO_CODE = new Map<string, string>([
  ['ArrowLeft', 'ArrowLeft'],
  ['ArrowRight', 'ArrowRight'],
  ['ArrowUp', 'ArrowUp'],
  ['ArrowDown', 'ArrowDown'],
  ['Left', 'ArrowLeft'],
  ['Right', 'ArrowRight'],
  ['Up', 'ArrowUp'],
  ['Down', 'ArrowDown'],
  [' ', 'Space'],
  ['Spacebar', 'Space'],
  ['Escape', 'Escape'],
  ['Esc', 'Escape'],
  ['a', 'KeyA'],
  ['d', 'KeyD'],
  ['w', 'KeyW'],
  ['s', 'KeyS'],
  ['j', 'KeyJ'],
  ['p', 'KeyP'],
]);

/**
 * Physical-key identifier for a keyboard event: `event.code` ('ArrowLeft', 'KeyA', 'Space', ...),
 * which is layout independent (WASD stays WASD on AZERTY), or a best-effort mapping from
 * `event.key` when `code` is missing. Returns '' for keys we have no name for.
 */
export function keyCodeOf(e: { code?: string; key?: string }): string {
  if (e.code && e.code !== 'Unidentified') return e.code;
  const key = e.key ?? '';
  return KEY_TO_CODE.get(key) ?? KEY_TO_CODE.get(key.toLowerCase()) ?? '';
}

/** True when keyboard input is going to a text-entry control (so the game must stay out of the way). */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  const el = target as Partial<HTMLElement> | null | undefined;
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}

/**
 * Should the game ignore this keydown entirely? Yes for browser shortcuts (Ctrl / Cmd / Alt
 * combinations) and for keys typed into a text field. Key-ups are never filtered, so a key can't
 * get stuck if focus or a modifier changed while it was down.
 */
export function shouldIgnoreKeyDown(
  ev: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>,
): boolean {
  return ev.ctrlKey || ev.metaKey || ev.altKey || isEditableTarget(ev.target);
}

/** True when the event target is (inside) an element marked `[data-ui]`, i.e. on-screen UI chrome. */
export function isUiTarget(target: EventTarget | null | undefined): boolean {
  const el = target as Partial<Element> | null | undefined;
  return !!el && typeof el.closest === 'function' && el.closest('[data-ui]') !== null;
}
