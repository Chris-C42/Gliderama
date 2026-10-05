/**
 * PWA plumbing: service worker registration with update signals, mobile browser guards, fullscreen.
 *
 * Nothing here runs on import. The app shell is expected to call, once at boot:
 *
 *   initPwa();                // registers the service worker (no-op in dev and where unsupported)
 *   installMobileGuards();    // no pinch / double-tap zoom, no pull-to-refresh, no rubber-banding, no canvas menu
 *
 * and to call `requestFullscreenLandscape()` from a user gesture (a tap or click handler).
 * UI binds to the `updateAvailable` / `offlineReady` signals and calls `applyUpdate()` from an "Update" button.
 */
import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';

// ---------------------------------------------------------------------------------------------------------------
// Service worker registration
// ---------------------------------------------------------------------------------------------------------------

/** True once a newer version of the app has been downloaded and is waiting. Show an "Update" prompt. */
export const updateAvailable = signal(false);
/** True once the whole app has been cached for the first time, i.e. it now works offline. */
export const offlineReady = signal(false);

/** How often a long-running session asks the server whether a newer service worker exists. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Never ask more often than this, even when the app keeps coming back to the foreground. */
const UPDATE_CHECK_MIN_GAP_MS = 10 * 60 * 1000;
/** If the swap-and-reload triggered by applyUpdate() has not happened by then, reload by hand. */
const APPLY_UPDATE_FALLBACK_MS = 4000;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let pwaStarted = false;

/**
 * Registers the service worker via `virtual:pwa-register` (registerType 'prompt': a new version waits until the
 * player accepts it, so an update never swaps code in the middle of a flight). Safe to call more than once.
 */
export function initPwa(): void {
  if (pwaStarted) return;
  pwaStarted = true;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    updateSW = registerSW({
      onNeedRefresh() {
        updateAvailable.value = true;
      },
      onOfflineReady() {
        offlineReady.value = true;
      },
      onRegisteredSW(_swUrl, registration) {
        if (registration) scheduleUpdateChecks(registration);
      },
      onRegisterError(error) {
        console.warn('[pwa] service worker registration failed', error);
      },
    });
  } catch (error) {
    console.warn('[pwa] could not start service worker registration', error);
  }
}

/**
 * Activates the waiting service worker; the page reloads itself once the new worker has taken control.
 * Without a registered worker (unsupported, dev) it just reloads.
 */
export async function applyUpdate(): Promise<void> {
  if (!updateSW) {
    reloadPage();
    return;
  }
  try {
    await updateSW(true);
  } catch (error) {
    console.warn('[pwa] applying the update failed', error);
    reloadPage();
    return;
  }
  // Normally the controllerchange reload fires long before this. It is a safety net for a stale
  // "update available" flag (nothing was actually waiting), so the button never looks dead.
  setTimeout(reloadPage, APPLY_UPDATE_FALLBACK_MS);
}

function reloadPage(): void {
  if (typeof location !== 'undefined') location.reload();
}

function scheduleUpdateChecks(registration: ServiceWorkerRegistration): void {
  let lastCheck = Date.now();
  const check = (): void => {
    const now = Date.now();
    if (now - lastCheck < UPDATE_CHECK_MIN_GAP_MS) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    lastCheck = now;
    registration.update().catch(() => {
      /* offline or the server is down: try again next time */
    });
  };
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Display mode helpers
// ---------------------------------------------------------------------------------------------------------------

function matches(query: string): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia(query).matches;
  } catch {
    return false;
  }
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;
  // iPadOS 13+ identifies itself as a Mac but has a touch screen.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * True when the game runs as an installed app (home-screen icon / installed PWA window) rather than in a
 * browser tab. Covers the manifest display modes, iOS `navigator.standalone` and Android trusted web activities.
 * A tab the page itself put into fullscreen with the Fullscreen API does not count.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  if (matches('(display-mode: standalone)') || matches('(display-mode: minimal-ui)')) return true;
  if (matches('(display-mode: window-controls-overlay)')) return true;
  // The manifest asks for `fullscreen`; an installed app then reports it, but so does API fullscreen in a tab.
  if (matches('(display-mode: fullscreen)') && !document.fullscreenElement) return true;
  return typeof document !== 'undefined' && document.referrer.startsWith('android-app://');
}

// ---------------------------------------------------------------------------------------------------------------
// Fullscreen + landscape
// ---------------------------------------------------------------------------------------------------------------

interface FullscreenCapable extends Element {
  webkitRequestFullscreen?: () => void | Promise<void>;
}

interface LockableOrientation {
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
}

/**
 * Enters fullscreen and locks the screen to landscape. Must be called from a user gesture (tap / click).
 * Every failure is swallowed: desktop browsers refuse the orientation lock, a denied request just stays windowed.
 * It does nothing on iOS, where neither fullscreen nor the lock is available to web pages.
 *
 * @param target element to fullscreen (default: the whole page)
 * @returns whether the page is in fullscreen afterwards
 */
export async function requestFullscreenLandscape(target?: Element): Promise<boolean> {
  if (typeof document === 'undefined' || isIOS()) return false;

  let fullscreen = !!document.fullscreenElement || matches('(display-mode: fullscreen)');
  if (!fullscreen) {
    const el = (target ?? document.documentElement) as FullscreenCapable;
    try {
      if (typeof el.requestFullscreen === 'function') {
        await el.requestFullscreen({ navigationUI: 'hide' });
        fullscreen = true;
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        await el.webkitRequestFullscreen();
        fullscreen = true;
      }
    } catch {
      /* denied, or not allowed right now: stay windowed */
    }
  }

  try {
    const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
    if (orientation && typeof orientation.lock === 'function') await orientation.lock('landscape');
  } catch {
    /* NotSupportedError on desktop, SecurityError outside fullscreen, ... */
  }
  return fullscreen;
}

/** Leaves fullscreen and releases the orientation lock again (the counterpart of requestFullscreenLandscape). */
export async function exitFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  try {
    const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as LockableOrientation | undefined;
    if (orientation && typeof orientation.unlock === 'function') orientation.unlock();
  } catch {
    /* nothing was locked */
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Mobile guards
// ---------------------------------------------------------------------------------------------------------------

export interface MobileGuardOptions {
  /** Elements matching this selector never show the browser context menu (right click / long press). */
  contextMenuSelector?: string;
}

/** Context menu is suppressed on the game canvas; opt more elements in with `data-no-contextmenu`. */
const DEFAULT_CONTEXT_MENU_SELECTOR = 'canvas, [data-no-contextmenu]';
/** Two taps whose ends are closer together than this count as a double-tap. */
const DOUBLE_TAP_MS = 350;
/** A touch that moves farther than this (CSS px) is a drag, not a tap. */
const TAP_SLOP_PX = 12;
/** A touch held longer than this is a press, not a tap. */
const TAP_MAX_MS = 500;
/** Touches starting here keep their native drag behaviour (slider thumbs); add `data-allow-touchmove` to opt out. */
const NATIVE_DRAG_SELECTOR = 'input[type="range"], [data-allow-touchmove]';
/** Double-taps on these are never swallowed, otherwise their second click would vanish. */
const TAPPABLE_SELECTOR =
  'a, button, input, select, textarea, label, summary, [role="button"], [contenteditable="true"], [data-allow-double-tap]';

let removeMobileGuards: (() => void) | null = null;

/**
 * Stops the browser from taking over the game's touches:
 *  - pinch zoom (iOS gesture events, multi-touch moves, trackpad ctrl+wheel) and double-tap zoom;
 *  - pull-to-refresh and the iOS rubber-band bounce: a touch drag that nothing scrollable under the finger
 *    could use is cancelled, while real scroll panels (overflow auto/scroll) keep working;
 *  - the context menu on the game canvas.
 *
 * Idempotent. Returns a function that removes everything again.
 */
export function installMobileGuards(options: MobileGuardOptions = {}): () => void {
  if (removeMobileGuards) return removeMobileGuards;
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};

  const doc = document;
  const win = window;
  const contextMenuSelector = options.contextMenuSelector ?? DEFAULT_CONTEXT_MENU_SELECTOR;
  const disposers: Array<() => void> = [];

  const on = (target: EventTarget, type: string, handler: (event: Event) => void, passive: boolean): void => {
    target.addEventListener(type, handler, { passive });
    disposers.push(() => target.removeEventListener(type, handler));
  };
  const cancel = (event: Event): void => {
    if (event.cancelable) event.preventDefault();
  };

  // iOS Safari ignores user-scalable=no: its pinch arrives as non-standard gesture events.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) on(doc, type, cancel, false);

  // Trackpad pinch on desktop browsers shows up as ctrl+wheel.
  on(win, 'wheel', (event) => {
    if ((event as WheelEvent).ctrlKey) cancel(event);
  }, false);

  // One finger on the screen: remember where it started, what could scroll under it, and whether it is still a tap.
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let scrollers: Element[] = [];
  let tapCandidate = false;
  let lastTapEnd = -Infinity;
  on(doc, 'touchstart', (event) => {
    const touches = (event as TouchEvent).touches;
    tapCandidate = touches.length === 1;
    if (touches.length !== 1) return;
    startX = touches[0].clientX;
    startY = touches[0].clientY;
    startTime = event.timeStamp;
    scrollers = findScrollers(event.target);
  }, true);

  // Touch drags: pinch, pull-to-refresh, rubber-banding.
  on(doc, 'touchmove', (event) => {
    const touchEvent = event as TouchEvent;
    const touch = touchEvent.touches[0];
    if (touchEvent.touches.length > 1 || (touch && Math.hypot(touch.clientX - startX, touch.clientY - startY) > TAP_SLOP_PX)) {
      tapCandidate = false; // a drag or pinch, not a tap
    }
    if (!touchEvent.cancelable) return; // the browser is already scrolling; cancelling would only log a warning
    if (touchEvent.touches.length > 1) {
      touchEvent.preventDefault(); // pinch
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest(NATIVE_DRAG_SELECTOR)) return;
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return; // no direction yet
    if (!canScrollTowards(scrollers, dx, dy)) touchEvent.preventDefault();
  }, false);

  // Double-tap zoom (older iOS honours touch-action only partly): the second of two quick taps is cancelled.
  // Only real taps count (one finger, barely moved, short), so swiping and then tapping is never mistaken for one.
  on(doc, 'touchend', (event) => {
    const isTap = tapCandidate && (event as TouchEvent).touches.length === 0 && event.timeStamp - startTime <= TAP_MAX_MS;
    tapCandidate = false;
    if (!isTap) {
      lastTapEnd = -Infinity;
      return;
    }
    const target = event.target;
    const tappable = target instanceof Element && target.closest(TAPPABLE_SELECTOR) !== null;
    if (event.timeStamp - lastTapEnd <= DOUBLE_TAP_MS && !tappable) cancel(event);
    lastTapEnd = event.timeStamp;
  }, false);

  // Context menu on the canvas (desktop right click, Android long press).
  on(doc, 'contextmenu', (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest(contextMenuSelector)) cancel(event);
  }, false);

  // CSS safety net for browsers that honour it (Chrome pull-to-refresh, Safari 16+ bounce, iOS long-press callout).
  const root = doc.documentElement;
  const previousRootOverscroll = root.style.overscrollBehavior;
  const previousBodyOverscroll = doc.body?.style.overscrollBehavior ?? '';
  const previousCallout = root.style.getPropertyValue('-webkit-touch-callout');
  root.style.overscrollBehavior = 'none';
  if (doc.body) doc.body.style.overscrollBehavior = 'none';
  root.style.setProperty('-webkit-touch-callout', 'none');

  const remove = (): void => {
    for (const dispose of disposers) dispose();
    disposers.length = 0;
    root.style.overscrollBehavior = previousRootOverscroll;
    if (doc.body) doc.body.style.overscrollBehavior = previousBodyOverscroll;
    if (previousCallout) root.style.setProperty('-webkit-touch-callout', previousCallout);
    else root.style.removeProperty('-webkit-touch-callout');
    removeMobileGuards = null;
  };
  removeMobileGuards = remove;
  return remove;
}

/** Ancestors of a touch target that can scroll on their own (overflow auto / scroll), nearest first. */
function findScrollers(target: EventTarget | null): Element[] {
  const found: Element[] = [];
  if (!(target instanceof Element)) return found;
  const scrollable = (value: string): boolean => value === 'auto' || value === 'scroll' || value === 'overlay';
  for (let el: Element | null = target; el && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (scrollable(style.overflowY) || scrollable(style.overflowX)) found.push(el);
  }
  // The page itself scrolls only if neither <html> nor <body> hides its overflow.
  const rootOverflow = getComputedStyle(document.documentElement).overflowY;
  const viewportOverflow = rootOverflow === 'visible' ? getComputedStyle(document.body).overflowY : rootOverflow;
  if (viewportOverflow !== 'hidden' && viewportOverflow !== 'clip' && document.scrollingElement) {
    found.push(document.scrollingElement);
  }
  return found;
}

/** Could any of these scrollers move in the direction the finger drags (dx, dy are the drag deltas)? */
function canScrollTowards(scrollers: Element[], dx: number, dy: number): boolean {
  const vertical = Math.abs(dy) >= Math.abs(dx);
  for (const el of scrollers) {
    if (vertical) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      // Finger moving down scrolls the content towards its top, and vice versa.
      if (dy > 0 && el.scrollTop > 0) return true;
      if (dy < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
    } else {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      if (dx > 0 && el.scrollLeft > 0) return true;
      if (dx < 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
    }
  }
  return false;
}
