import { effect } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/types';
import type { Settings } from '../src/core/types';

type Storage = typeof import('../src/core/storage');
type SettingsModule = typeof import('../src/core/settings');

/** Fresh module instances on top of a backend holding `stored` (the settings module reads the save when imported). */
async function boot(stored?: unknown): Promise<{ storage: Storage; mod: SettingsModule; writes: () => number; saved: () => any }> {
  vi.resetModules();
  const storage = await import('../src/core/storage');
  const inner = storage.createMemoryBackend(stored === undefined ? {} : { [storage.SAVE_KEY]: JSON.stringify(stored) });
  let writes = 0;
  storage.setStorageBackend({
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => {
      writes++;
      inner.setItem(key, value);
    },
    removeItem: (key) => inner.removeItem(key),
  });
  const mod = await import('../src/core/settings');
  return {
    storage,
    mod,
    writes: () => writes,
    saved: () => {
      const raw = inner.getItem(storage.SAVE_KEY);
      return raw === null ? null : JSON.parse(raw);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('settings signal', () => {
  it('starts from the defaults on a fresh install', async () => {
    const { mod } = await boot();
    expect(mod.settings.value).toEqual(DEFAULT_SETTINGS);
  });

  it('is initialised from the stored save', async () => {
    const { mod } = await boot({ version: 1, settings: { musicVolume: 0.2, leftHanded: true } });
    expect(mod.settings.value).toEqual({ ...DEFAULT_SETTINGS, musicVolume: 0.2, leftHanded: true });
  });

  it('is a copy: editing it does not touch the save', async () => {
    const { storage, mod } = await boot();
    expect(mod.settings.value).not.toBe(storage.getSave().settings);
  });
});

describe('setSetting', () => {
  it('updates the signal at once and persists through the save', async () => {
    const { storage, mod, saved } = await boot();
    mod.setSetting('invertPitch', true);
    expect(mod.settings.value.invertPitch).toBe(true);
    expect(storage.getSave().settings.invertPitch).toBe(true);
    expect(saved()).toBeNull(); // debounced
    vi.advanceTimersByTime(storage.WRITE_DEBOUNCE_MS);
    expect(saved().settings.invertPitch).toBe(true);
  });

  it('keeps every other setting', async () => {
    const { mod, storage } = await boot({ version: 1, settings: { sfxVolume: 0.1 } });
    mod.setSetting('slowMo', true);
    expect(mod.settings.value).toEqual({ ...DEFAULT_SETTINGS, sfxVolume: 0.1, slowMo: true });
    expect(storage.getSave().settings).toEqual({ ...DEFAULT_SETTINGS, sfxVolume: 0.1, slowMo: true });
  });

  it('publishes a new object so subscribers re-run', async () => {
    const { mod } = await boot();
    const seen: Settings[] = [];
    const stop = effect(() => {
      seen.push(mod.settings.value);
    });
    mod.setSetting('haptics', false);
    mod.setSetting('sliderTravel', 120);
    stop();
    expect(seen).toHaveLength(3);
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[2].sliderTravel).toBe(120);
    expect(seen[2].haptics).toBe(false);
  });

  it('does nothing when the value does not change', async () => {
    const { mod, storage, writes } = await boot();
    const before = storage.saveRevision.value;
    const signalValue = mod.settings.value;
    mod.setSetting('musicVolume', DEFAULT_SETTINGS.musicVolume);
    mod.setSetting('invertPitch', false);
    vi.advanceTimersByTime(10_000);
    expect(storage.saveRevision.value).toBe(before);
    expect(mod.settings.value).toBe(signalValue);
    expect(writes()).toBe(0);
  });

  it('keeps volumes within 0..1', async () => {
    const { mod } = await boot();
    mod.setSetting('musicVolume', 3);
    mod.setSetting('sfxVolume', -0.5);
    expect(mod.settings.value.musicVolume).toBe(1);
    expect(mod.settings.value.sfxVolume).toBe(0);
  });

  it('ignores numbers that are not finite', async () => {
    const { mod } = await boot();
    mod.setSetting('sliderTravel', NaN);
    mod.setSetting('sliderTravel', Infinity);
    expect(mod.settings.value.sliderTravel).toBe(DEFAULT_SETTINGS.sliderTravel);
  });

  it('is typed per key', async () => {
    const { mod } = await boot();
    mod.setSetting('musicVolume', 0.5);
    mod.setSetting('leftHanded', true);
    // @ts-expect-error a boolean setting does not take a number
    mod.setSetting('leftHanded', 1);
    // @ts-expect-error a number setting does not take a boolean
    mod.setSetting('musicVolume', true);
    // @ts-expect-error unknown setting
    mod.setSetting('nope', 1);
    expect(true).toBe(true);
  });
});

describe('following the save', () => {
  it('picks up an imported save', async () => {
    const { storage, mod } = await boot();
    const doc = storage.createDefaultSave();
    doc.settings.sfxVolume = 0.05;
    doc.settings.engineerView = true;
    expect(storage.importSave(JSON.stringify(doc))).toBe(true);
    expect(mod.settings.value.sfxVolume).toBe(0.05);
    expect(mod.settings.value.engineerView).toBe(true);
  });

  it('writes on top of imported values instead of clobbering them with stale ones', async () => {
    const { storage, mod, saved } = await boot();
    const doc = storage.createDefaultSave();
    doc.settings.sfxVolume = 0.05;
    storage.importSave(JSON.stringify(doc));
    mod.setSetting('leftHanded', true);
    storage.flushSave();
    expect(saved().settings).toEqual({ ...DEFAULT_SETTINGS, sfxVolume: 0.05, leftHanded: true });
  });

  it('picks up resetSave', async () => {
    const { storage, mod } = await boot();
    mod.setSetting('musicVolume', 0.9);
    storage.resetSave();
    expect(mod.settings.value).toEqual(DEFAULT_SETTINGS);
  });

  it('picks up a reload from storage', async () => {
    const { storage, mod } = await boot();
    storage.flushSave();
    storage.setStorageBackend(
      storage.createMemoryBackend({ [storage.SAVE_KEY]: JSON.stringify({ version: 1, settings: { slowMo: true } }) }),
    );
    expect(mod.settings.value.slowMo).toBe(true);
  });

  it('picks up direct edits made through updateSave', async () => {
    const { storage, mod } = await boot();
    storage.updateSave((s) => {
      s.settings.autoTrim = true;
    });
    expect(mod.settings.value.autoTrim).toBe(true);
  });

  it('does not rewrite the signal for unrelated save updates', async () => {
    const { storage, mod } = await boot();
    const before = mod.settings.value;
    storage.updateSave((s) => {
      s.progress.stats.flights++;
    });
    expect(mod.settings.value).toBe(before);
  });
});
