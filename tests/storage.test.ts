import { effect } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import {
  CORRUPT_KEY_PREFIX,
  SAVE_KEY,
  SAVE_VERSION,
  WRITE_DEBOUNCE_MS,
  WRITE_MAX_WAIT_MS,
  WRITE_RETRY_MS,
  createDefaultSave,
  createLevelProgress,
  exportSave,
  flushSave,
  getSave,
  importSave,
  installFlushHooks,
  loadSave,
  migrateSave,
  resetSave,
  saveRevision,
  setStorageBackend,
  updateSave,
} from '../src/core/storage';
import type { Migration, StorageBackend } from '../src/core/storage';
import type { SaveData } from '../src/core/save-types';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { MAX_CLIPS, MAX_FOLDS, blankDesign } from '../src/paper/design';

// ---------------------------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------------------------

/** In-memory Web Storage stand-in that can fail on demand or enforce a size quota. */
class FakeBackend implements StorageBackend {
  readonly data = new Map<string, string>();
  /** Every attempt to write, including failed ones. */
  attempts = 0;
  /** Successful writes, with the time they happened. */
  readonly writes: Array<{ key: string; value: string; at: number }> = [];
  failWrites: unknown = null;
  failReads: unknown = null;
  /** Total of key + value lengths the store may hold; exceeding it throws QuotaExceededError. */
  quota = Infinity;

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, value);
  }

  getItem(key: string): string | null {
    if (this.failReads) throw this.failReads;
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.attempts++;
    if (this.failWrites) throw this.failWrites;
    const next = new Map(this.data).set(key, value);
    let size = 0;
    for (const [k, v] of next) size += k.length + v.length;
    if (size > this.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.data.set(key, value);
    this.writes.push({ key, value, at: Date.now() });
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  get length(): number {
    return this.data.size;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  saveWrites() {
    return this.writes.filter((w) => w.key === SAVE_KEY);
  }

  saved(): SaveData | null {
    const raw = this.data.get(SAVE_KEY);
    return raw === undefined ? null : (JSON.parse(raw) as SaveData);
  }

  corruptKeys(): string[] {
    return Array.from(this.data.keys()).filter((k) => k.startsWith(CORRUPT_KEY_PREFIX));
  }
}

/** Minimal window / document: records listeners so tests can fire events. */
class FakeEventTarget {
  visibilityState = 'visible';
  private readonly listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string): void {
    for (const listener of Array.from(this.listeners.get(type) ?? [])) listener();
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

let backend: FakeBackend;
let warn: MockInstance;
let error: MockInstance;
let removeHooks: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  backend = new FakeBackend();
  setStorageBackend(backend);
  removeHooks = installFlushHooks({}); // no real window in node; keeps tests independent of each other
});

afterEach(() => {
  removeHooks?.();
  removeHooks = null;
  setStorageBackend(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Pretends the page was reloaded: drops in-memory state and reads from the same backend again. */
function reload(): SaveData {
  setStorageBackend(backend);
  return getSave();
}

// ---------------------------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------------------------

describe('defaults', () => {
  it('creates a complete default save', () => {
    const save = createDefaultSave();
    expect(save.version).toBe(1);
    expect(SAVE_VERSION).toBe(1);
    expect(save.designs).toEqual([]);
    expect(save.activeDesignId).toBeNull();
    expect(save.settings).toEqual(DEFAULT_SETTINGS);
    expect(save.progress).toEqual({
      campaign: {},
      unlocks: { folds: [], papers: [], gadgets: [], cosmetics: [], recipes: [] },
      challenges: {},
      roguelike: { bestScore: 0, bestFloor: 0, runs: 0, totalStars: 0 },
      daily: {},
      stats: { flights: 0, crashes: 0, stars: 0, roomsFlown: 0, foldsMade: 0, playTimeSec: 0 },
    });
    expect(save.seen).toEqual({});
  });

  it('hands out independent copies', () => {
    const a = createDefaultSave();
    const b = createDefaultSave();
    a.settings.musicVolume = 0;
    a.progress.unlocks.folds.push('x');
    a.seen.x = true;
    expect(b.settings.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(b.progress.unlocks.folds).toEqual([]);
    expect(b.seen).toEqual({});
    expect(DEFAULT_SETTINGS.musicVolume).toBe(createDefaultSave().settings.musicVolume);
  });

  it('createLevelProgress is an untouched record', () => {
    expect(createLevelProgress()).toEqual({
      completed: false,
      medals: { escape: false, allStars: false, pristine: false, swift: false },
      bestTime: null,
      bestStars: 0,
      stamp: false,
    });
  });

  it('starts from the defaults when storage is empty, without writing anything', () => {
    expect(getSave()).toEqual(createDefaultSave());
    vi.advanceTimersByTime(10_000);
    flushSave();
    expect(backend.attempts).toBe(0);
  });

  it('returns the same live object every time', () => {
    expect(getSave()).toBe(getSave());
    expect(loadSave()).toBe(getSave());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Persistence, revision, debounce, flush
// ---------------------------------------------------------------------------------------------------------------

describe('updateSave', () => {
  it('mutates the live save, persists it, and survives a reload', () => {
    updateSave((s) => {
      s.progress.stats.flights = 3;
      s.seen.intro = true;
      s.designs.push(blankDesign());
    });
    expect(getSave().progress.stats.flights).toBe(3);
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(backend.saved()?.progress.stats.flights).toBe(3);

    const reloaded = reload();
    expect(reloaded.progress.stats.flights).toBe(3);
    expect(reloaded.seen).toEqual({ intro: true });
    expect(reloaded.designs).toHaveLength(1);
  });

  it('returns what the mutator returns', () => {
    const flights = updateSave((s) => ++s.progress.stats.flights);
    expect(flights).toBe(1);
    expect(updateSave(() => 'done')).toBe('done');
  });

  it('bumps saveRevision once per update', () => {
    const before = saveRevision.value;
    updateSave((s) => void s.progress.stats.flights++);
    updateSave((s) => void s.progress.stats.flights++);
    expect(saveRevision.value).toBe(before + 2);
  });

  it('notifies effects that read saveRevision, and does not subscribe the code calling it', () => {
    const seen: number[] = [];
    const stop = effect(() => {
      seen.push(saveRevision.value);
    });
    updateSave((s) => void s.progress.stats.flights++);
    expect(seen).toHaveLength(2);

    // An effect that itself calls updateSave must not re-run because of it (no feedback loop).
    let runs = 0;
    const stop2 = effect(() => {
      runs++;
      updateSave((s) => void s.progress.stats.crashes++);
    });
    expect(runs).toBe(1);
    stop();
    stop2();
  });

  it('still bumps the revision, schedules a write and rethrows when the mutator throws', () => {
    const before = saveRevision.value;
    expect(() =>
      updateSave((s) => {
        s.progress.stats.flights = 9;
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(saveRevision.value).toBe(before + 1);
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(backend.saved()?.progress.stats.flights).toBe(9);
  });
});

describe('write scheduling', () => {
  it('debounces by 300 ms', () => {
    expect(WRITE_DEBOUNCE_MS).toBe(300);
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(299);
    expect(backend.attempts).toBe(0);
    vi.advanceTimersByTime(1);
    expect(backend.saveWrites()).toHaveLength(1);
  });

  it('coalesces a burst of updates into one write, 300 ms after the last', () => {
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(200);
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(200);
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(299);
    expect(backend.attempts).toBe(0);
    vi.advanceTimersByTime(1);
    expect(backend.saveWrites()).toHaveLength(1);
    expect(backend.saved()?.progress.stats.flights).toBe(3);
    vi.advanceTimersByTime(10_000);
    expect(backend.saveWrites()).toHaveLength(1);
  });

  it('never holds a write back longer than the max wait, however busy the updates are', () => {
    for (let t = 0; t < 6500; t += 100) {
      updateSave((s) => void (s.progress.stats.playTimeSec += 0.1));
      vi.advanceTimersByTime(100);
    }
    const times = backend.saveWrites().map((w) => w.at);
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(WRITE_MAX_WAIT_MS);
  });

  it('flushSave writes immediately and cancels the pending timer', () => {
    updateSave((s) => void s.progress.stats.flights++);
    flushSave();
    expect(backend.saveWrites()).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(backend.saveWrites()).toHaveLength(1);
  });

  it('flushSave does nothing when nothing is pending', () => {
    getSave();
    flushSave();
    updateSave((s) => void s.progress.stats.flights++);
    flushSave();
    flushSave();
    expect(backend.saveWrites()).toHaveLength(1);
  });

  it('flushes when the page is hidden or closed', () => {
    const win = new FakeEventTarget();
    const doc = new FakeEventTarget();
    removeHooks = installFlushHooks({ window: win, document: doc });

    updateSave((s) => void s.progress.stats.flights++);
    doc.fire('visibilitychange'); // still visible: nothing yet
    expect(backend.attempts).toBe(0);

    doc.visibilityState = 'hidden';
    doc.fire('visibilitychange');
    expect(backend.saveWrites()).toHaveLength(1);

    updateSave((s) => void s.progress.stats.flights++);
    win.fire('pagehide');
    expect(backend.saveWrites()).toHaveLength(2);
    expect(backend.saved()?.progress.stats.flights).toBe(2);
  });

  it('removes its listeners again', () => {
    const win = new FakeEventTarget();
    const doc = new FakeEventTarget();
    const remove = installFlushHooks({ window: win, document: doc });
    expect([win.count('pagehide'), doc.count('visibilitychange')]).toEqual([1, 1]);
    remove();
    expect([win.count('pagehide'), doc.count('visibilitychange')]).toEqual([0, 0]);
    updateSave((s) => void s.progress.stats.flights++);
    win.fire('pagehide');
    expect(backend.attempts).toBe(0);
  });

  it('installing the hooks again replaces the previous ones', () => {
    const win = new FakeEventTarget();
    const doc = new FakeEventTarget();
    installFlushHooks({ window: win, document: doc });
    removeHooks = installFlushHooks({ window: win, document: doc });
    expect(win.count('pagehide')).toBe(1);
  });

  it('setStorageBackend drops a pending write instead of sending it to the new backend', () => {
    updateSave((s) => void s.progress.stats.flights++);
    const other = new FakeBackend();
    setStorageBackend(other);
    vi.advanceTimersByTime(10_000);
    expect(other.attempts).toBe(0);
    expect(backend.attempts).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------------------------------------------

describe('migrateSave', () => {
  const v1 = () => ({ version: 1, settings: { musicVolume: 0.5 }, stats: { flights: 4 } });
  const table: Record<number, Migration> = {
    1: (data) => {
      const stats = data.stats as { flights: number };
      return { ...data, totals: { flights: stats.flights }, stats: undefined };
    },
    2: (data) => ({ ...data, schema: 'three' }),
  };

  it('chains the steps from the document version up to the target', () => {
    const out = migrateSave(v1(), { migrations: table, target: 3 });
    expect(out).toEqual({ version: 3, settings: { musicVolume: 0.5 }, totals: { flights: 4 }, stats: undefined, schema: 'three' });
  });

  it('runs only the steps that are still missing', () => {
    const calls: number[] = [];
    const spy: Record<number, Migration> = {
      1: (d) => (calls.push(1), d),
      2: (d) => (calls.push(2), d),
    };
    expect(migrateSave({ version: 2 }, { migrations: spy, target: 3 })).toEqual({ version: 3 });
    expect(calls).toEqual([2]);
  });

  it('leaves a document of the target version alone (as a copy)', () => {
    const input = { version: 1, a: { b: 1 } };
    const out = migrateSave(input, { migrations: {}, target: 1 });
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(out?.a).not.toBe(input.a);
  });

  it('never modifies its input, even when a step mutates', () => {
    const input = v1();
    const snapshot = JSON.stringify(input);
    migrateSave(input, { migrations: { 1: (d) => ((d.settings as { musicVolume: number }).musicVolume = 0, d) }, target: 2 });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('gives up (null) on a gap in the chain, a failing step, or a step returning junk', () => {
    expect(migrateSave(v1(), { migrations: { 2: (d) => d }, target: 3 })).toBeNull();
    expect(migrateSave(v1(), { migrations: { 1: () => { throw new Error('bad'); } }, target: 2 })).toBeNull();
    expect(migrateSave(v1(), { migrations: { 1: () => null as unknown as Record<string, unknown> }, target: 2 })).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('gives up on documents without a usable version or from a newer app', () => {
    for (const doc of [null, undefined, 42, 'x', [], {}, { version: '1' }, { version: 0 }, { version: -1 }, { version: 1.5 }, { version: NaN }, { version: 2 }]) {
      expect(migrateSave(doc, { migrations: {}, target: 1 }), JSON.stringify(doc)).toBeNull();
    }
  });

  it('has no migrations registered yet, and accepts version 1', () => {
    expect(migrateSave(createDefaultSave())).toEqual(createDefaultSave());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Loading older / partial / odd data
// ---------------------------------------------------------------------------------------------------------------

describe('loading fills in missing fields', () => {
  const store = (doc: unknown) => {
    backend = new FakeBackend({ [SAVE_KEY]: JSON.stringify(doc) });
    return reload();
  };

  it('keeps what is there and defaults the rest', () => {
    const save = store({ version: 1, settings: { musicVolume: 0.2 }, progress: { stats: { flights: 5 } } });
    expect(save.settings).toEqual({ ...DEFAULT_SETTINGS, musicVolume: 0.2 });
    expect(save.progress.stats).toEqual({ ...createDefaultSave().progress.stats, flights: 5 });
    expect(save.progress.roguelike).toEqual(createDefaultSave().progress.roguelike);
    expect(save.progress.unlocks).toEqual(createDefaultSave().progress.unlocks);
    expect(save.designs).toEqual([]);
    expect(save.seen).toEqual({});
  });

  it('adds fields that a newer build introduced to a complete old save', () => {
    const old = createDefaultSave() as unknown as Record<string, any>;
    delete old.settings.haptics;
    delete old.progress.stats.foldsMade;
    delete old.progress.roguelike;
    old.progress.stats.flights = 12;
    const save = store(old);
    expect(save.settings.haptics).toBe(DEFAULT_SETTINGS.haptics);
    expect(save.progress.stats.foldsMade).toBe(0);
    expect(save.progress.stats.flights).toBe(12);
    expect(save.progress.roguelike).toEqual({ bestScore: 0, bestFloor: 0, runs: 0, totalStars: 0 });
  });

  it('replaces values of the wrong type with the defaults', () => {
    const save = store({
      version: 1,
      settings: { invertPitch: 'yes', sliderTravel: 'wide', musicVolume: null },
      progress: { stats: { flights: 'many', crashes: -2 }, unlocks: { folds: 'x', papers: [1, 'ok', 'ok', null] } },
      designs: 'none',
      activeDesignId: 7,
      seen: 'no',
    });
    expect(save.settings.invertPitch).toBe(DEFAULT_SETTINGS.invertPitch);
    expect(save.settings.sliderTravel).toBe(DEFAULT_SETTINGS.sliderTravel);
    expect(save.settings.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(save.progress.stats.flights).toBe(0);
    expect(save.progress.stats.crashes).toBe(-2); // a number is a number
    expect(save.progress.unlocks.folds).toEqual([]);
    expect(save.progress.unlocks.papers).toEqual(['ok']); // only strings, once each
    expect(save.designs).toEqual([]);
    expect(save.activeDesignId).toBeNull();
    expect(save.seen).toEqual({});
  });

  it('keeps unknown extra keys (forward compatibility)', () => {
    const save = store({ version: 1, settings: { futureFlag: true }, progress: { future: { a: 1 } }, extra: [1, 2] }) as unknown as Record<string, any>;
    expect(save.settings.futureFlag).toBe(true);
    expect(save.progress.future).toEqual({ a: 1 });
    expect(save.extra).toEqual([1, 2]);
  });

  it('clamps the volumes to 0..1', () => {
    const save = store({ version: 1, settings: { musicVolume: 5, sfxVolume: -1 } });
    expect(save.settings.musicVolume).toBe(1);
    expect(save.settings.sfxVolume).toBe(0);
  });

  it('fills campaign, challenge and daily entries individually', () => {
    const save = store({
      version: 1,
      progress: {
        campaign: {
          'home-1': { completed: true, medals: { escape: true } },
          'home-2': 'junk',
          'home-3': { bestTime: 'fast', bestStars: 2 },
        },
        challenges: { c1: { stars: 2 }, c2: { bestFolds: 4, bestTime: 'x' }, c3: 5 },
        daily: { '2026-10-05': { score: 900, roomResults: ['clear', 'banana', 'crash'] }, '2026-10-06': null },
      },
    });
    expect(save.progress.campaign['home-1']).toEqual({ ...createLevelProgress(), completed: true, medals: { escape: true, allStars: false, pristine: false, swift: false } });
    expect(save.progress.campaign['home-2']).toBeUndefined();
    expect(save.progress.campaign['home-3']).toEqual({ ...createLevelProgress(), bestStars: 2 });
    expect(save.progress.challenges).toEqual({
      c1: { stars: 2, bestFolds: null, bestTime: null },
      c2: { stars: 0, bestFolds: 4, bestTime: null },
    });
    expect(save.progress.daily['2026-10-05']).toMatchObject({ score: 900, roomsCleared: 0, official: false, practiceRuns: 0, roomResults: ['clear', 'crash'] });
    expect(save.progress.daily['2026-10-06']).toBeUndefined();
  });

  it('keeps only boolean "seen" flags', () => {
    const save = store({ version: 1, seen: { intro: true, tip: false, bad: 'yes', worse: 1 } });
    expect(save.seen).toEqual({ intro: true, tip: false });
  });

  it('is not fooled into polluting prototypes', () => {
    const raw = '{"version":1,"seen":{"__proto__":{"polluted":true},"ok":true},"__proto__":{"polluted":true},"settings":{"__proto__":{"polluted":true}}}';
    backend = new FakeBackend({ [SAVE_KEY]: raw });
    const save = reload();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((save as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(save.seen)).toEqual(['ok']);
    expect(Object.keys(save.settings)).not.toContain('__proto__');
  });

  describe('designs', () => {
    it('keeps valid designs untouched', () => {
      const d = blankDesign();
      d.name = 'Mine';
      d.folds = [{ a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, side: -1, mountain: true, flap: { x: 5, y: 6 } }];
      d.shape.winglet = { x: 70, angle: 30 };
      d.shape.elevator = { depth: 10, from: 0.2, to: 0.8, angle: 5 };
      d.extras.clips = [10, 20];
      d.look.sticker = 'star';
      const save = store({ version: 1, designs: [d], activeDesignId: d.id });
      expect(save.designs).toEqual([d]);
      expect(save.activeDesignId).toBe(d.id);
    });

    it('gives designs saved before a schema addition the new fields', () => {
      const d = JSON.parse(JSON.stringify(blankDesign())) as Record<string, any>;
      d.folds = [{ a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, side: 1, mountain: false }]; // no `flap` yet
      delete d.look.trail;
      delete d.shape.winglet;
      delete d.extras.tape;
      const save = store({ version: 1, designs: [d] });
      expect(save.designs[0].folds[0].flap).toBeNull();
      expect(save.designs[0].look.trail).toBeNull();
      expect(save.designs[0].shape.winglet).toBeNull();
      expect(save.designs[0].extras.tape).toBe(0);
    });

    it('drops junk entries and duplicate ids, and forgets an active id that no longer exists', () => {
      const d = blankDesign();
      const copy = { ...blankDesign(), id: d.id, name: 'duplicate' };
      const save = store({ version: 1, designs: [d, 'junk', null, 7, copy], activeDesignId: 'd_gone' });
      expect(save.designs).toHaveLength(1);
      expect(save.designs[0].name).toBe(d.name);
      expect(save.activeDesignId).toBeNull();
    });

    it('enforces the schema limits on folds and clips', () => {
      const d = blankDesign();
      const fold = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, side: 1 as const, mountain: false, flap: null };
      d.folds = Array.from({ length: 500 }, () => ({ ...fold }));
      d.extras.clips = Array.from({ length: 50 }, (_, i) => i);
      const save = store({ version: 1, designs: [d] });
      expect(save.designs[0].folds).toHaveLength(MAX_FOLDS);
      expect(save.designs[0].extras.clips).toEqual([0, 1, 2].slice(0, MAX_CLIPS));
    });

    it('repairs a design whose id is missing', () => {
      const d = JSON.parse(JSON.stringify(blankDesign())) as Record<string, any>;
      delete d.id;
      const save = store({ version: 1, designs: [d] });
      expect(save.designs[0].id).toMatch(/^d_/);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Corrupt data
// ---------------------------------------------------------------------------------------------------------------

describe('corrupt data recovery', () => {
  it('backs up invalid JSON under gliderama.save.corrupt.<timestamp> and starts fresh', () => {
    const raw = '{"version":1,"progress":{"stats":{"flights":4';
    backend = new FakeBackend({ [SAVE_KEY]: raw });
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const save = reload();

    expect(save).toEqual(createDefaultSave());
    const keys = backend.corruptKeys();
    expect(keys).toEqual([`gliderama.save.corrupt.${Date.now()}`]);
    expect(backend.data.get(keys[0])).toBe(raw);
    expect(backend.data.has(SAVE_KEY)).toBe(false); // so the next boot doesn't back it up again
    expect(warn).toHaveBeenCalled();

    // Booting again finds nothing to complain about.
    reload();
    expect(backend.corruptKeys()).toHaveLength(1);

    // The game goes on normally and writes a fresh save.
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(backend.saved()?.progress.stats.flights).toBe(1);
    expect(backend.data.get(keys[0])).toBe(raw);
  });

  it.each([
    ['not an object', 'null'],
    ['a number', '42'],
    ['an array', '[]'],
    ['a string', '"save"'],
    ['empty', ''],
    ['no version', '{"settings":{}}'],
    ['a version string', '{"version":"1"}'],
    ['a newer version', JSON.stringify({ ...createDefaultSave(), version: 2 })],
  ])('quarantines a save that is %s', (_label, raw) => {
    backend = new FakeBackend({ [SAVE_KEY]: raw });
    const save = reload();
    expect(save).toEqual(createDefaultSave());
    const keys = backend.corruptKeys();
    expect(keys).toHaveLength(1);
    expect(backend.data.get(keys[0])).toBe(raw);
    expect(backend.data.has(SAVE_KEY)).toBe(false);
  });

  it('keeps only the newest three quarantined documents', () => {
    for (let i = 1; i <= 5; i++) {
      backend.data.set(SAVE_KEY, `{broken ${i}`);
      reload();
      vi.advanceTimersByTime(10);
    }
    const keys = backend.corruptKeys();
    expect(keys).toHaveLength(3);
    expect(keys.map((k) => backend.data.get(k)).sort()).toEqual(['{broken 3', '{broken 4', '{broken 5']);
  });

  it('leaves the original in place if it cannot even be backed up', () => {
    backend = new FakeBackend({ [SAVE_KEY]: '{broken' });
    backend.quota = 5;
    const save = reload();
    expect(save).toEqual(createDefaultSave());
    expect(backend.data.get(SAVE_KEY)).toBe('{broken');
  });

  it('survives storage that throws on read', () => {
    backend.failReads = new DOMException('denied', 'SecurityError');
    expect(getSave()).toEqual(createDefaultSave());
    expect(() => updateSave((s) => void s.progress.stats.flights++)).not.toThrow();
    expect(getSave().progress.stats.flights).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Write failures
// ---------------------------------------------------------------------------------------------------------------

describe('write failures', () => {
  const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

  it('logs, keeps the data in memory, and does not throw', () => {
    backend.failWrites = quotaError();
    expect(() => updateSave((s) => void s.progress.stats.flights++)).not.toThrow();
    expect(() => vi.advanceTimersByTime(WRITE_DEBOUNCE_MS)).not.toThrow();
    expect(() => flushSave()).not.toThrow();
    expect(error).toHaveBeenCalled();
    expect(getSave().progress.stats.flights).toBe(1);
  });

  it('writes the pending data once storage works again', () => {
    backend.failWrites = quotaError();
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(backend.saved()).toBeNull();

    backend.failWrites = null;
    flushSave(); // e.g. the page is being hidden
    expect(backend.saved()?.progress.stats.flights).toBe(1);
  });

  it('retries on its own after the retry interval, and logs the failure only once per streak', () => {
    backend.failWrites = quotaError();
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(error).toHaveBeenCalledTimes(1);

    backend.failWrites = null;
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(WRITE_RETRY_MS);
    expect(backend.saved()?.progress.stats.flights).toBe(2);

    backend.failWrites = quotaError();
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(error).toHaveBeenCalledTimes(2); // a new streak
  });

  it('does not hammer a full storage while updates keep coming', () => {
    backend.failWrites = quotaError();
    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    const attemptsAfterFirstFailure = backend.attempts;
    for (let t = 0; t < 3000; t += 50) {
      updateSave((s) => void (s.progress.stats.playTimeSec += 0.05));
      vi.advanceTimersByTime(50);
    }
    expect(backend.attempts).toBe(attemptsAfterFirstFailure);
  });

  it('frees quarantined backups to make room, then retries once', () => {
    const size = JSON.stringify(createDefaultSave()).length;
    backend.data.set(`${CORRUPT_KEY_PREFIX}1`, 'x'.repeat(size));
    backend.data.set(`${CORRUPT_KEY_PREFIX}2`, 'x'.repeat(size));
    backend.quota = SAVE_KEY.length + size + 200; // room for the save, not for the save plus a backup

    updateSave((s) => void s.progress.stats.flights++);
    vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
    expect(backend.saved()?.progress.stats.flights).toBe(1);
    expect(backend.corruptKeys()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Export / import / reset
// ---------------------------------------------------------------------------------------------------------------

describe('exportSave / importSave', () => {
  it('exports the live save as JSON', () => {
    updateSave((s) => void s.progress.stats.flights++);
    const json = exportSave();
    expect(JSON.parse(json)).toEqual(getSave());
    expect(JSON.parse(json).version).toBe(1);
  });

  it('imports an export: replaces the save, persists immediately, bumps the revision', () => {
    const exported = (() => {
      updateSave((s) => {
        s.progress.stats.flights = 7;
        s.settings.musicVolume = 0.1;
        s.designs.push(blankDesign());
      });
      return exportSave();
    })();

    backend = new FakeBackend();
    setStorageBackend(backend);
    const before = saveRevision.value;
    expect(importSave(exported)).toBe(true);

    expect(getSave().progress.stats.flights).toBe(7);
    expect(getSave().settings.musicVolume).toBe(0.1);
    expect(getSave().designs).toHaveLength(1);
    expect(backend.saved()?.progress.stats.flights).toBe(7); // no waiting for the debounce
    expect(saveRevision.value).toBeGreaterThan(before);
    expect(reload().progress.stats.flights).toBe(7);
  });

  it('accepts and completes an older, partial export', () => {
    expect(importSave(JSON.stringify({ version: 1, designs: [], settings: { sfxVolume: 0.3 }, progress: { stats: { flights: 2 } } }))).toBe(true);
    expect(getSave().settings.sfxVolume).toBe(0.3);
    expect(getSave().settings.musicVolume).toBe(DEFAULT_SETTINGS.musicVolume);
    expect(getSave().progress.stats).toEqual({ ...createDefaultSave().progress.stats, flights: 2 });
  });

  it('rejects anything that is not a valid save, and changes nothing', () => {
    updateSave((s) => void (s.progress.stats.flights = 5));
    flushSave();
    const writes = backend.attempts;
    const before = JSON.stringify(getSave());
    const revision = saveRevision.value;

    const good = createDefaultSave();
    const bad: unknown[] = [
      '',
      'not json',
      '{"version":1',
      'null',
      '42',
      '[]',
      '"save"',
      '{}',
      '{"version":1}', // none of the core sections
      JSON.stringify({ ...good, version: 2 }),
      JSON.stringify({ ...good, version: 0 }),
      JSON.stringify({ ...good, version: '1' }),
      JSON.stringify({ ...good, designs: {} }),
      JSON.stringify({ ...good, settings: [] }),
      JSON.stringify({ ...good, progress: 'x' }),
      JSON.stringify({ ...good, version: undefined }),
      undefined,
      null,
      42,
    ];
    for (const json of bad) expect(importSave(json as string), String(json)).toBe(false);
    expect(importSave('x'.repeat(10_000_001))).toBe(false);

    expect(JSON.stringify(getSave())).toBe(before);
    expect(saveRevision.value).toBe(revision);
    expect(backend.attempts).toBe(writes);
  });

  it('normalises what it imports', () => {
    const doc = { ...createDefaultSave(), settings: { ...DEFAULT_SETTINGS, musicVolume: 9 }, seen: { ok: true, bad: 3 } };
    expect(importSave(JSON.stringify(doc))).toBe(true);
    expect(getSave().settings.musicVolume).toBe(1);
    expect(getSave().seen).toEqual({ ok: true });
  });

  it('keeps the new save in memory when it cannot be persisted', () => {
    backend.failWrites = new DOMException('full', 'QuotaExceededError');
    const doc = { ...createDefaultSave() };
    doc.progress = { ...doc.progress, stats: { ...doc.progress.stats, flights: 8 } };
    expect(importSave(JSON.stringify(doc))).toBe(true);
    expect(getSave().progress.stats.flights).toBe(8);
  });

  it('resetSave goes back to a fresh save and persists it', () => {
    updateSave((s) => void (s.progress.stats.flights = 5));
    flushSave();
    resetSave();
    expect(getSave()).toEqual(createDefaultSave());
    expect(backend.saved()).toEqual(createDefaultSave());
  });
});

// ---------------------------------------------------------------------------------------------------------------
// loadSave and backends
// ---------------------------------------------------------------------------------------------------------------

describe('loadSave', () => {
  it('re-reads storage and replaces the in-memory save', () => {
    getSave();
    backend.data.set(SAVE_KEY, JSON.stringify({ ...createDefaultSave(), progress: { ...createDefaultSave().progress, stats: { ...createDefaultSave().progress.stats, flights: 11 } } }));
    const before = saveRevision.value;
    const loaded = loadSave();
    expect(loaded.progress.stats.flights).toBe(11);
    expect(getSave()).toBe(loaded);
    expect(saveRevision.value).toBeGreaterThan(before);
  });

  it('writes pending changes first so they are not lost', () => {
    updateSave((s) => void (s.progress.stats.flights = 6));
    expect(backend.attempts).toBe(0);
    expect(loadSave().progress.stats.flights).toBe(6);
    expect(backend.saved()?.progress.stats.flights).toBe(6);
  });
});

describe('storage backends', () => {
  it('uses an in-memory fallback when there is no localStorage (as in node)', () => {
    vi.stubGlobal('localStorage', undefined); // newer Node versions ship a real one; keep the test hermetic
    try {
      setStorageBackend(null);
      expect(getSave()).toEqual(createDefaultSave());
      updateSave((s) => void s.progress.stats.flights++);
      flushSave();
      expect(getSave().progress.stats.flights).toBe(1);
      setStorageBackend(null); // a brand-new fallback starts empty: nothing was persisted anywhere shared
      expect(getSave().progress.stats.flights).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('survives a localStorage whose very access throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access is denied for this document.', 'SecurityError');
      },
    });
    try {
      setStorageBackend(null);
      expect(getSave()).toEqual(createDefaultSave());
      expect(() => updateSave((s) => void s.progress.stats.flights++)).not.toThrow();
      expect(() => flushSave()).not.toThrow();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('uses window.localStorage when it exists', () => {
    const store = new FakeBackend({ [SAVE_KEY]: JSON.stringify({ ...createDefaultSave(), seen: { fromLocalStorage: true } }) });
    vi.stubGlobal('localStorage', store);
    try {
      setStorageBackend(null);
      expect(getSave().seen).toEqual({ fromLocalStorage: true });
      updateSave((s) => void (s.seen.more = true));
      vi.advanceTimersByTime(WRITE_DEBOUNCE_MS);
      expect(store.saved()?.seen).toEqual({ fromLocalStorage: true, more: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
