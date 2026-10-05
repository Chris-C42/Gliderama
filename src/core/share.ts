/**
 * Sharing helpers: import links for design codes, and "share sheet if there is one, else clipboard".
 * Everything here tolerates a non-browser environment (tests, SSR) and never throws.
 */

/** Matches `#/import/GLD1-<base64url>` (leading `#` and `/` optional, trailing `/`, `?query` and `&..` ignored). */
const IMPORT_HASH = /^#?\/?import\/(GLD\d+-[A-Za-z0-9_-]+)\/?(?:[?&].*)?$/;

/**
 * Link that opens the game and imports the design: `<origin><BASE_URL>#/import/<code>`.
 * Without a `location` (non-browser) the origin is left out and the result is a root-relative link.
 */
export function designShareUrl(code: string): string {
  const base = import.meta.env.BASE_URL || '/';
  let prefix = base;
  if (typeof location !== 'undefined') {
    try {
      // Resolves both absolute ("/Gliderama/") and relative ("./") bases against the page.
      prefix = new URL(base, location.href).href.replace(/[?#].*$/, '');
    } catch {
      prefix = (location.origin !== 'null' ? location.origin : '') + base;
    }
  }
  return `${prefix}#/import/${code}`;
}

/**
 * Pulls the design code out of a location hash such as `#/import/GLD1-AbC...`.
 * Returns null for any other hash (and for malformed codes). It does not check the code itself: pass it to decodeDesign.
 */
export function parseImportFromHash(hash: string): string | null {
  if (typeof hash !== 'string') return null;
  let text = hash.trim();
  try {
    text = decodeURIComponent(text);
  } catch {
    /* keep the raw text */
  }
  const match = IMPORT_HASH.exec(text);
  return match ? match[1] : null;
}

export interface SharePayload {
  title?: string;
  text?: string;
  url?: string;
}

/**
 * - 'shared'  the system share sheet took it
 * - 'copied'  no share sheet (or it failed): text and url were copied to the clipboard
 * - 'failed'  nothing happened - also when the player dismissed the share sheet, so don't show an error for it
 */
export type ShareResult = 'shared' | 'copied' | 'failed';

/** Opens the native share sheet where available (phones, some desktops); otherwise copies to the clipboard. */
export async function shareOrCopy(payload: SharePayload): Promise<ShareResult> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav && typeof nav.share === 'function') {
    try {
      if (typeof nav.canShare !== 'function' || nav.canShare(payload)) {
        await nav.share(payload);
        return 'shared';
      }
    } catch (error) {
      // Dismissing the sheet rejects with AbortError: respect that instead of copying behind the player's back.
      if (isAbortError(error)) return 'failed';
      // Anything else (no user gesture, blocked by policy, ...): fall back to the clipboard.
    }
  }
  const text = [payload.text, payload.url].filter((part): part is string => !!part).join('\n');
  return (await copyToClipboard(text)) ? 'copied' : 'failed';
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permission denied or insecure context: try the legacy route */
  }
  return legacyCopy(text);
}

/** `execCommand('copy')` through a throwaway textarea: works without the async clipboard API. */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  const selection = document.getSelection();
  const saved = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  document.body.appendChild(field);
  let ok = false;
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    field.remove();
    if (saved && selection) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }
  }
  return ok;
}
