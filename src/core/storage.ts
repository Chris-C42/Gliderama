/**
 * Save system: one versioned JSON document in localStorage (`gliderama.save.v1`).
 *
 *  - `getSave()` returns the live in-memory save (loaded lazily on first use). Mutate it only through
 *    `updateSave()`, which bumps the `saveRevision` signal and schedules a debounced write.
 *  - Writes are debounced by 300 ms (and never held back longer than 2 s), and flushed when the page is
 *    hidden or closed, so a tab swipe-away on a phone does not lose progress.
 *  - Loading never throws: unreadable data is quarantined under `gliderama.save.corrupt.<timestamp>` and the
 *    game starts fresh; saves from older versions are migrated, and missing fields are filled from the defaults.
 *  - All storage access goes through an injectable backend (`setStorageBackend`), so this runs in node tests.
 *
 * Don't hold on to sub-objects of the save (`const stats = getSave().progress.stats`) across `loadSave()`,
 * `importSave()` or `resetSave()`: those replace the whole document.
 *
 * Components re-render on save changes by reading `saveRevision.value`. It changes on every `updateSave()`,
 * so batch high-frequency updates (e.g. play time) instead of calling `updateSave()` every frame.
 */
import { signal } from '@preact/signals';
import { MAX_CLIPS, MAX_FOLDS, blankDesign, newDesignId } from '../paper/design';
import type { Design, ElevatorSpec, FoldOp, WingletSpec } from '../paper/design';
import type { DailyResult, LevelProgress, SaveData } from './save-types';
import { DEFAULT_SETTINGS, isTouchLayout } from './types';

/** localStorage key of the save document. The `v1` is the key's own generation, not the schema version. */
export const SAVE_KEY = 'gliderama.save.v1';
/** Unreadable saves are copied to `<prefix><Date.now()>` before the game starts fresh. */
export const CORRUPT_KEY_PREFIX = 'gliderama.save.corrupt.';
/** Current schema version (`SaveData.version`). Bump it together with a registered migration. */
export const SAVE_VERSION = 1 as const;
/** Quiet period after the last update before the save is written. */
export const WRITE_DEBOUNCE_MS = 300;
/** Upper bound on how long continuous updates can postpone a write. */
export const WRITE_MAX_WAIT_MS = 2000;
/** Spacing of retries while writes are failing (storage full or blocked). */
export const WRITE_RETRY_MS = 5000;

const MAX_CORRUPT_BACKUPS = 3;
const MAX_IMPORT_CHARS = 10_000_000;

export type ChallengeProgress = SaveData['progress']['challenges'][string];

// ---------------------------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------------------------

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    designs: [],
    activeDesignId: null,
    settings: { ...DEFAULT_SETTINGS },
    progress: {
      campaign: {},
      unlocks: { folds: [], papers: [], gadgets: [], cosmetics: [], recipes: [] },
      challenges: {},
      roguelike: { bestScore: 0, bestFloor: 0, runs: 0, totalStars: 0 },
      daily: {},
      stats: { flights: 0, crashes: 0, stars: 0, roomsFlown: 0, foldsMade: 0, playTimeSec: 0 },
    },
    seen: {},
  };
}

/** A fresh, untouched campaign record: `getSave().progress.campaign[id] ??= createLevelProgress()`. */
export function createLevelProgress(): LevelProgress {
  return {
    completed: false,
    medals: { escape: false, allStars: false, pristine: false, swift: false },
    bestTime: null,
    bestStars: 0,
    stamp: false,
  };
}

export function createChallengeProgress(): ChallengeProgress {
  return { stars: 0, bestFolds: null, bestTime: null };
}

function createDailyResult(): DailyResult {
  return {
    score: 0,
    roomsCleared: 0,
    roomsTotal: 0,
    stars: 0,
    starsTotal: 0,
    timeSec: 0,
    damagePct: 0,
    roomResults: [],
    practiceRuns: 0,
    official: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------------------------------------------

/** The slice of the Web Storage API this module uses. `localStorage` satisfies it. */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Optional enumeration (localStorage has it). Used only to prune old corrupt-save backups. */
  readonly length?: number;
  key?(index: number): string | null;
}

/** A volatile backend: the fallback when localStorage is unavailable, and handy in tests. */
export function createMemoryBackend(initial: Record<string, string> = {}): StorageBackend {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    get length() {
      return map.size;
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
  };
}

function resolveDefaultBackend(): StorageBackend {
  try {
    // Merely touching `localStorage` throws when site data is blocked.
    const ls = (globalThis as { localStorage?: StorageBackend }).localStorage;
    if (ls) return ls;
  } catch {
    /* blocked: fall back to memory */
  }
  return createMemoryBackend();
}

let backend: StorageBackend | null = null;

function getBackend(): StorageBackend {
  backend ??= resolveDefaultBackend();
  return backend;
}

function readRaw(key: string): string | null {
  try {
    return getBackend().getItem(key);
  } catch (error) {
    console.warn(`[save] could not read "${key}"`, error);
    return null;
  }
}

/** Returns the error if the write failed. */
function tryWrite(key: string, value: string): unknown {
  try {
    getBackend().setItem(key, value);
    return null;
  } catch (error) {
    return error ?? new Error('write failed');
  }
}

function removeRaw(key: string): void {
  try {
    getBackend().removeItem(key);
  } catch {
    /* nothing sensible to do */
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------------------------------------------

/** Upgrades a save document by exactly one version (it receives a private copy and may mutate it). */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[n]` upgrades a version-n document to version n + 1. Loading chains them until `SAVE_VERSION`.
 * When bumping the schema: raise `SAVE_VERSION` (and `SaveData.version`), then add the step here, e.g.
 *
 *   1: (data) => { data.progress.stats.rooms = data.progress.stats.roomsFlown; return data; },   // v1 -> v2
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export interface MigrateOptions {
  /** Defaults to MIGRATIONS. */
  migrations?: Readonly<Record<number, Migration>>;
  /** Defaults to SAVE_VERSION. */
  target?: number;
}

/**
 * Runs the migration chain from the document's `version` up to the target version.
 * Returns the upgraded copy, or null if the input isn't a versioned object, comes from a newer app version,
 * has a gap in the chain, or a step throws. The input is never modified.
 */
export function migrateSave(raw: unknown, options: MigrateOptions = {}): Record<string, unknown> | null {
  const table = options.migrations ?? MIGRATIONS;
  const target = options.target ?? SAVE_VERSION;
  if (!isPlainObject(raw)) return null;
  let version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > target) return null;
  let data = cloneJson(raw);
  while (version < target) {
    const step = table[version];
    if (!step) return null;
    try {
      data = step(data);
    } catch (error) {
      console.warn(`[save] migration from version ${version} failed`, error);
      return null;
    }
    if (!isPlainObject(data)) return null;
    version += 1;
    data.version = version;
  }
  return data;
}

// ---------------------------------------------------------------------------------------------------------------
// Normalisation: fill missing fields from the defaults, drop what has the wrong shape
// ---------------------------------------------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Deep copy of JSON-like data. Skips `__proto__` keys so untrusted input can't smuggle a prototype in. */
function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (key !== '__proto__') out[key] = cloneJson(value[key]);
    }
    return out as T;
  }
  return value;
}

/**
 * Deep-merges `value` over `defaults`, guided by the defaults' shape:
 *  - plain objects merge key by key; keys only `value` has are kept (that's how id-keyed records survive);
 *  - a value of the wrong type (number where a boolean belongs, NaN, ...) is replaced by the default;
 *  - arrays are taken as they are when `value` has one; `null` defaults mean "nullable": anything goes.
 */
function mergeDefaults<T>(defaults: T, value: unknown): T {
  if (Array.isArray(defaults)) return (Array.isArray(value) ? cloneJson(value) : cloneJson(defaults)) as unknown as T;
  if (isPlainObject(defaults)) {
    if (!isPlainObject(value)) return cloneJson(defaults);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) out[key] = mergeDefaults(defaults[key], hasOwn(value, key) ? value[key] : undefined);
    for (const key of Object.keys(value)) {
      if (key !== '__proto__' && !hasOwn(out, key)) out[key] = cloneJson(value[key]);
    }
    return out as T;
  }
  if (defaults === null) return (value === undefined ? null : cloneJson(value)) as T;
  if (typeof defaults === 'number') return (typeof value === 'number' && Number.isFinite(value) ? value : defaults) as T;
  if (typeof value === typeof defaults) return value as T;
  return defaults;
}

const FOLD_TEMPLATE: FoldOp = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, side: 1, mountain: false, flap: null };
const WINGLET_TEMPLATE: WingletSpec = { x: 0, angle: 0 };
const ELEVATOR_TEMPLATE: ElevatorSpec = { depth: 0, from: 0, to: 1, angle: 0 };
const DAILY_ROOM_RESULTS: readonly string[] = ['clear', 'damaged', 'crash', 'skip'];

/** Repairs one persisted design against the current schema (older saves gain new fields). */
function normalizeDesign(raw: unknown): Design | null {
  if (!isPlainObject(raw)) return null;
  const design = mergeDefaults(blankDesign(), raw);
  design.v = 1;
  if (!design.id) design.id = newDesignId();
  // The schema's own limits also bound what a corrupted or hand-edited save can hand to the fold engine.
  design.folds = design.folds.filter(isPlainObject).slice(0, MAX_FOLDS).map((fold) => {
    const merged = mergeDefaults(FOLD_TEMPLATE, fold);
    if (!isPlainObject(merged.flap)) merged.flap = null;
    else merged.flap = mergeDefaults({ x: 0, y: 0 }, merged.flap);
    return merged;
  });
  design.shape.winglet = isPlainObject(design.shape.winglet) ? mergeDefaults(WINGLET_TEMPLATE, design.shape.winglet) : null;
  design.shape.elevator = isPlainObject(design.shape.elevator) ? mergeDefaults(ELEVATOR_TEMPLATE, design.shape.elevator) : null;
  design.extras.clips = design.extras.clips.filter((c) => typeof c === 'number' && Number.isFinite(c)).slice(0, MAX_CLIPS);
  if (typeof design.recipe !== 'string') design.recipe = null;
  if (typeof design.look.sticker !== 'string') design.look.sticker = null;
  if (typeof design.look.trail !== 'string') design.look.trail = null;
  return design;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string')));
}

function normalizeRecord<T>(value: unknown, create: () => T, repair: (entry: T) => void): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isPlainObject(value)) return out;
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || !isPlainObject(value[key])) continue;
    const entry = mergeDefaults(create(), value[key]);
    repair(entry);
    out[key] = entry;
  }
  return out;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Turns a migrated document into a complete, well-shaped SaveData. Never throws, never returns shared state. */
function normalizeSave(data: Record<string, unknown>): SaveData {
  const save = mergeDefaults(createDefaultSave(), data);
  save.version = SAVE_VERSION;

  save.settings.musicVolume = clamp01(save.settings.musicVolume);
  save.settings.sfxVolume = clamp01(save.settings.sfxVolume);
  // Any string passes the type-guided merge above, so an unknown layout (hand edit, newer build) is caught here.
  if (!isTouchLayout(save.settings.touchLayout)) save.settings.touchLayout = DEFAULT_SETTINGS.touchLayout;

  const seenIds = new Set<string>();
  save.designs = (Array.isArray(data.designs) ? data.designs : [])
    .map(normalizeDesign)
    .filter((design): design is Design => {
      if (!design || seenIds.has(design.id)) return false;
      seenIds.add(design.id);
      return true;
    });
  if (typeof save.activeDesignId !== 'string' || !seenIds.has(save.activeDesignId)) save.activeDesignId = null;

  const progress = save.progress;
  progress.campaign = normalizeRecord(progress.campaign, createLevelProgress, (entry) => {
    entry.bestTime = numberOrNull(entry.bestTime);
  });
  progress.challenges = normalizeRecord(progress.challenges, createChallengeProgress, (entry) => {
    entry.bestFolds = numberOrNull(entry.bestFolds);
    entry.bestTime = numberOrNull(entry.bestTime);
  });
  progress.daily = normalizeRecord(progress.daily, createDailyResult, (entry) => {
    entry.roomResults = entry.roomResults.filter((r): r is DailyResult['roomResults'][number] => DAILY_ROOM_RESULTS.includes(r));
  });
  for (const key of ['folds', 'papers', 'gadgets', 'cosmetics', 'recipes'] as const) {
    progress.unlocks[key] = stringList(progress.unlocks[key]);
  }

  const seen: Record<string, boolean> = {};
  for (const key of Object.keys(save.seen)) {
    if (key !== '__proto__' && typeof save.seen[key] === 'boolean') seen[key] = save.seen[key];
  }
  save.seen = seen;
  return save;
}

/** The minimum a document must have to be accepted by importSave (stricter than loading, which self-heals). */
function looksLikeSave(data: Record<string, unknown>): boolean {
  return Array.isArray(data.designs) && isPlainObject(data.settings) && isPlainObject(data.progress);
}

// ---------------------------------------------------------------------------------------------------------------
// Runtime state
// ---------------------------------------------------------------------------------------------------------------

/** Bumped on every `updateSave()` and whenever the whole save is replaced. Read `.value` to subscribe. */
export const saveRevision = signal(0);

let current: SaveData | null = null;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let firstDirtyAt = 0;
let writeFailing = false;

function bumpRevision(): void {
  // peek(): bumping from inside an effect or component must not subscribe it to the revision.
  saveRevision.value = saveRevision.peek() + 1;
}

/** Copies an unreadable document aside and removes it, so the next boot doesn't trip over it again. */
function quarantine(raw: string, reason: string): void {
  const key = `${CORRUPT_KEY_PREFIX}${Date.now()}`;
  const error = tryWrite(key, raw);
  if (error) {
    console.warn(`[save] ${reason}; could not back it up either, leaving it in place`, error);
    return;
  }
  console.warn(`[save] ${reason}; copied to "${key}" and starting fresh`);
  removeRaw(SAVE_KEY);
  pruneCorruptBackups(MAX_CORRUPT_BACKUPS);
}

/** Keeps only the newest `keep` quarantined documents. */
function pruneCorruptBackups(keep: number): void {
  try {
    const b = getBackend();
    if (typeof b.length !== 'number' || typeof b.key !== 'function') return;
    const keys: string[] = [];
    for (let i = 0; i < b.length; i++) {
      const key = b.key(i);
      if (key && key.startsWith(CORRUPT_KEY_PREFIX)) keys.push(key);
    }
    const stamp = (key: string): number => Number(key.slice(CORRUPT_KEY_PREFIX.length)) || 0;
    keys.sort((x, y) => stamp(y) - stamp(x));
    for (const key of keys.slice(keep)) removeRaw(key);
  } catch {
    /* best effort */
  }
}

function loadFromBackend(): SaveData {
  const raw = readRaw(SAVE_KEY);
  if (raw === null) return createDefaultSave();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(raw, 'save is not valid JSON');
    return createDefaultSave();
  }
  const migrated = migrateSave(parsed);
  if (!migrated) {
    quarantine(raw, 'save is unusable (wrong shape, unknown or newer version)');
    return createDefaultSave();
  }
  return normalizeSave(migrated);
}

function ensureLoaded(): SaveData {
  if (current === null) {
    current = loadFromBackend();
    dirty = false;
    ensureFlushHooks();
  }
  return current;
}

/** Writes the save now. On failure (quota, blocked storage) it keeps the data in memory and reports false. */
function writeNow(): boolean {
  if (current === null) return false;
  let json: string;
  try {
    json = JSON.stringify(current);
  } catch (error) {
    console.error('[save] could not serialise the save', error);
    return false;
  }
  let error = tryWrite(SAVE_KEY, json);
  if (error) {
    // Quarantined backups are the only thing we can free up: drop them and retry once.
    pruneCorruptBackups(0);
    error = tryWrite(SAVE_KEY, json);
  }
  if (error) {
    if (!writeFailing) console.error('[save] could not write the save (storage full or blocked); progress is kept in memory only', error);
    writeFailing = true;
    return false;
  }
  writeFailing = false;
  return true;
}

function scheduleWrite(): void {
  const now = Date.now();
  if (!dirty) {
    dirty = true;
    firstDirtyAt = now;
  }
  if (timer !== null) clearTimeout(timer);
  // While writes keep failing (storage full / blocked) retry rarely instead of re-serialising on every update.
  const quiet = writeFailing ? WRITE_RETRY_MS : WRITE_DEBOUNCE_MS;
  const maxWait = writeFailing ? WRITE_RETRY_MS : WRITE_MAX_WAIT_MS;
  const wait = Math.min(quiet, Math.max(0, firstDirtyAt + maxWait - now));
  timer = setTimeout(flushSave, wait);
}

// ---------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------

/**
 * Swaps the storage backend (tests; `null` goes back to localStorage) and forgets all in-memory state, including
 * any pending write. The next `getSave()` loads from the new backend.
 */
export function setStorageBackend(next: StorageBackend | null): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  dirty = false;
  writeFailing = false;
  current = null;
  backend = next;
  bumpRevision();
}

/** (Re)reads the save from storage, replacing the in-memory copy. Pending changes are written first. */
export function loadSave(): SaveData {
  flushSave();
  current = loadFromBackend();
  dirty = false;
  ensureFlushHooks();
  bumpRevision();
  return current;
}

/** The live save. Loads it on first use. Mutate through `updateSave()` only. */
export function getSave(): SaveData {
  return ensureLoaded();
}

/**
 * Runs `mutator` on the live save, then bumps `saveRevision` and schedules the debounced write.
 * Returns whatever the mutator returns. If it throws, the revision is still bumped and the error propagates.
 */
export function updateSave<T = void>(mutator: (save: SaveData) => T): T {
  const save = ensureLoaded();
  try {
    return mutator(save);
  } finally {
    bumpRevision();
    scheduleWrite();
  }
}

/** Writes any pending change immediately. Called automatically when the page is hidden or closed. */
export function flushSave(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty || current === null) return;
  if (writeNow()) dirty = false;
  else firstDirtyAt = Date.now(); // restart the max-wait window so retries are spaced out
}

/** The save as a JSON string, for a backup file or clipboard. */
export function exportSave(): string {
  return JSON.stringify(ensureLoaded());
}

/**
 * Replaces the whole save with an exported one (older versions are migrated, missing fields filled in) and
 * persists it right away. Returns false, changing nothing, if `json` isn't a valid save.
 */
export function importSave(json: string): boolean {
  if (typeof json !== 'string' || json.length === 0 || json.length > MAX_IMPORT_CHARS) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  const migrated = migrateSave(parsed);
  if (!migrated || !looksLikeSave(migrated)) return false;
  replaceSave(normalizeSave(migrated));
  return true;
}

/** Wipes all progress, settings and designs back to a fresh save and persists it. */
export function resetSave(): void {
  replaceSave(createDefaultSave());
}

function replaceSave(next: SaveData): void {
  ensureFlushHooks();
  current = next;
  dirty = true;
  flushSave();
  bumpRevision();
}

// ---------------------------------------------------------------------------------------------------------------
// Flush when the page goes away
// ---------------------------------------------------------------------------------------------------------------

interface ListenerTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface FlushTargets {
  window?: ListenerTarget;
  document?: ListenerTarget & { visibilityState?: string };
}

let removeFlushHooks: (() => void) | null = null;

/**
 * Flushes pending changes on `pagehide` and when `visibilitychange` reports the page hidden (the reliable
 * moments on mobile, where a backgrounded tab may be killed without further notice). Installed automatically
 * on first use; call it yourself only to point it at other targets (tests). Returns an uninstaller.
 */
export function installFlushHooks(targets?: FlushTargets): () => void {
  removeFlushHooks?.();
  const win = targets ? targets.window : typeof window !== 'undefined' ? window : undefined;
  const doc = targets ? targets.document : typeof document !== 'undefined' ? document : undefined;
  const onPageHide = (): void => flushSave();
  const onVisibilityChange = (): void => {
    if (doc?.visibilityState === 'hidden') flushSave();
  };
  win?.addEventListener('pagehide', onPageHide);
  doc?.addEventListener('visibilitychange', onVisibilityChange);
  const remove = (): void => {
    win?.removeEventListener('pagehide', onPageHide);
    doc?.removeEventListener('visibilitychange', onVisibilityChange);
    if (removeFlushHooks === remove) removeFlushHooks = null;
  };
  removeFlushHooks = remove;
  return remove;
}

function ensureFlushHooks(): void {
  if (!removeFlushHooks) installFlushHooks();
}
