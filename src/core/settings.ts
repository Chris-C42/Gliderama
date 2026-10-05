/**
 * Player settings as a signal, backed by the save (`SaveData.settings`).
 *
 *   settings.value.invertPitch          // read (subscribes the component / effect)
 *   setSetting('musicVolume', 0.3)      // updates the signal and persists through updateSave()
 *
 * The signal also follows the save when something else rewrites it (importSave, resetSave, loadSave, or code that
 * edits `getSave().settings` inside `updateSave`), so the UI never shows stale values.
 */
import { effect, signal } from '@preact/signals';
import { DEFAULT_SETTINGS, isTouchLayout } from './types';
import type { Settings } from './types';
import { getSave, saveRevision, updateSave } from './storage';

export const settings = signal<Settings>({ ...getSave().settings });

function sameSettings(a: Settings, b: Settings): boolean {
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/** Keeps values inside the ranges `Settings` documents. Returns undefined for values that must be ignored. */
function sanitize<K extends keyof Settings>(key: K, value: Settings[K]): Settings[K] | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    if (key === 'musicVolume' || key === 'sfxVolume') return Math.min(1, Math.max(0, value)) as Settings[K];
  }
  if (key === 'touchLayout' && !isTouchLayout(value)) return undefined;
  return value;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  const next = sanitize(key, value);
  if (next === undefined) return;
  if (!Object.is(settings.peek()[key], next)) {
    settings.value = { ...settings.peek(), [key]: next };
  }
  // Written even when the signal already matched, so a stale save can't keep an outdated value.
  if (!Object.is(getSave().settings[key], next)) {
    updateSave((save) => {
      save.settings[key] = next;
    });
  }
}

// Follow whole-save replacement and direct edits (see the header comment).
effect(() => {
  void saveRevision.value;
  const fromSave = getSave().settings;
  if (!sameSettings(fromSave, settings.peek())) settings.value = { ...fromSave };
});
