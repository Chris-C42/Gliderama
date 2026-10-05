/**
 * Ghosts: compact recordings of past flights, replayed as translucent planes next to a new flight.
 *
 * Recording. A path is resampled to a uniform rate (20 per real second by default), quantised (x, y to
 * centimetres, the nose direction to whole degrees) and delta-encoded as zig-zag varints, then written
 * as base64: about 3 bytes per sample, so a 10 s flight is roughly 0.8 KB of text and the size is
 * capped (500 samples, under 4 KB even for the busiest flight) however long the flight runs.
 *
 * The orientation is stored as the direction the nose points in the room (phi = theta when facing right,
 * 180 deg - theta when facing left), which changes continuously through turnarounds and half-rolls; a
 * pose's facing and pitch are recovered from it. A plane that loops is therefore replayed upright and
 * mirrored while it is inverted, which is also what the flight model's auto-righting does.
 *
 * Storage. `GhostStore` keeps up to 8 recent ghosts per design and 40 in all in localStorage under
 * `gliderama.ghosts.v1`, through the same injectable backend as the save system.
 */

import { createMemoryBackend, type StorageBackend } from '../core/storage';

export const GHOSTS_KEY = 'gliderama.ghosts.v1';
export const MAX_GHOSTS_PER_DESIGN = 8;
export const MAX_GHOSTS_TOTAL = 40;
/** Default replay sample rate (per real second) and the cap on samples per ghost. */
export const GHOST_RATE = 20;
export const GHOST_MAX_SAMPLES = 500;

const DEG = Math.PI / 180;

export interface GhostMeta {
  designId: string;
  designName: string;
  /** CSS colour the ghost is drawn in. */
  color: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** What `recordGhost` needs of a path sample (the open sim's path points qualify). */
export interface GhostSample {
  t: number;
  x: number;
  y: number;
  theta: number;
  facing?: 1 | -1;
}

/** A stored ghost: metadata, a few summary numbers and the packed samples. JSON-serialisable. */
export interface Ghost extends GhostMeta {
  v: 1;
  id: string;
  /** Number of samples and the (uniform) real seconds between them. */
  n: number;
  dt: number;
  /** Real seconds the flight lasted. */
  duration: number;
  /** Horizontal distance flown, metres. */
  distance: number;
  /** Packed samples: base64 of zig-zag varint deltas of (x cm, y cm, nose direction deg). */
  data: string;
}

/** A decoded sample: the pose to draw the plane at. */
export interface GhostPose {
  /** Real seconds since launch. */
  t: number;
  x: number;
  y: number;
  /** Pitch relative to the horizontal in the direction it faces (rad), as the flight model's `theta`. */
  theta: number;
  facing: 1 | -1;
}

// ---------------------------------------------------------------------------------------------
// Byte packing
// ---------------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_INDEX[B64[i]] = i;

export function bytesToBase64(bytes: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 63];
  }
  return out;
}

/** Decodes base64 (padding optional). Returns null if the text is not base64. */
export function base64ToBytes(text: string): number[] | null {
  const s = text.replace(/=+$/, '');
  if (s.length % 4 === 1) return null;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64_INDEX[s[i + k]] : 0));
    if (c.some((v) => v === undefined)) return null;
    out.push((c[0] << 2) | (c[1] >> 4));
    if (i + 2 < s.length) out.push(((c[1] & 15) << 4) | (c[2] >> 2));
    if (i + 3 < s.length) out.push(((c[2] & 3) << 6) | c[3]);
  }
  return out;
}

const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const unzigzag = (z: number) => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

function pushVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 128) {
    out.push((v % 128) | 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

// ---------------------------------------------------------------------------------------------
// Recording and replay
// ---------------------------------------------------------------------------------------------

/** Nose direction in the room, degrees in [-180, 180). */
function noseDeg(theta: number, facing: 1 | -1): number {
  const phi = (facing >= 0 ? theta : Math.PI - theta) / DEG;
  return wrapDeg(Math.round(phi));
}

function wrapDeg(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface PoseLike {
  x: number;
  y: number;
  theta: number;
  facing?: 1 | -1;
}

/** An angle wrapped into [-PI, PI). */
function wrapPi(a: number): number {
  return a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
}

/**
 * The pose a fraction `u` of the way from `a` to `b`; the pitch takes the shortest arc. Across a
 * turnaround (the facing differs) the first pose's attitude is held until the second one arrives.
 */
function lerpPose(a: PoseLike, b: PoseLike, u: number): { x: number; y: number; theta: number; facing: 1 | -1 } {
  const x = a.x + (b.x - a.x) * u;
  const y = a.y + (b.y - a.y) * u;
  const fa = a.facing ?? 1;
  const fb = b.facing ?? 1;
  if (fa !== fb) return u < 1 ? { x, y, theta: a.theta, facing: fa } : { x, y, theta: b.theta, facing: fb };
  return { x, y, theta: a.theta + wrapPi(b.theta - a.theta) * u, facing: fa };
}

/** Linear interpolation of a path (sorted by t) at time `t`, advancing `cursor` along it. */
function sampleAt(path: readonly GhostSample[], t: number, cursor: { i: number }): { x: number; y: number; theta: number; facing: 1 | -1 } {
  const last = path.length - 1;
  while (cursor.i < last - 1 && path[cursor.i + 1].t <= t) cursor.i++;
  const a = path[Math.min(cursor.i, last)];
  const b = path[Math.min(cursor.i + 1, last)];
  const span = b.t - a.t;
  return lerpPose(a, b, span > 1e-9 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0);
}

export interface RecordOptions {
  /** Replay samples per real second (default 20). */
  rate?: number;
  /** Cap on the number of samples (default `GHOST_MAX_SAMPLES`); longer flights are stored at a lower rate. */
  maxSamples?: number;
}

/** Packs a flight path (sorted by time) into a ghost. Samples with non-finite numbers are skipped; an empty path gives an empty ghost. */
export function recordGhost(samples: readonly GhostSample[], meta: GhostMeta, opts: RecordOptions = {}): Ghost {
  const path = samples.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.theta));
  const rate = Math.max(1, opts.rate ?? GHOST_RATE);
  const maxSamples = Math.max(2, opts.maxSamples ?? GHOST_MAX_SAMPLES);
  const duration = path.length > 1 ? Math.max(0, path[path.length - 1].t - path[0].t) : 0;
  const t0 = path.length ? path[0].t : 0;
  // A uniform grid that lands exactly on the end of the flight.
  const steps = Math.min(maxSamples - 1, Math.max(duration > 0 ? 1 : 0, Math.ceil(duration * rate - 1e-9)));
  const dt = steps > 0 ? duration / steps : 1 / rate;

  const bytes: number[] = [];
  let px = 0;
  let py = 0;
  let pphi = 0;
  const cursor = { i: 0 };
  let firstX = 0;
  let lastX = 0;
  for (let i = 0; i <= steps && path.length > 0; i++) {
    const s = sampleAt(path, t0 + i * dt, cursor);
    const x = Math.round(s.x * 100);
    const y = Math.round(s.y * 100);
    const phi = noseDeg(s.theta, s.facing);
    if (i === 0) firstX = x;
    lastX = x;
    pushVarint(bytes, zigzag(x - px));
    pushVarint(bytes, zigzag(y - py));
    pushVarint(bytes, zigzag(wrapDeg(phi - pphi)));
    px = x;
    py = y;
    pphi = phi;
  }
  const data = bytesToBase64(bytes);
  return {
    v: 1,
    id: `${meta.createdAt.toString(36)}-${fnv1a(`${meta.designId}|${data}`).toString(36)}`,
    designId: meta.designId,
    designName: meta.designName,
    color: meta.color,
    createdAt: meta.createdAt,
    n: path.length ? steps + 1 : 0,
    dt,
    duration: path.length ? steps * dt : 0,
    distance: Math.abs(lastX - firstX) / 100,
    data,
  };
}

/** A ghost as text (for sharing or saving on its own). */
export function serializeGhost(ghost: Ghost): string {
  return JSON.stringify(ghost);
}

/** Reads a ghost back from text; null if it is not one. */
export function parseGhost(text: string): Ghost | null {
  try {
    const v: unknown = JSON.parse(text);
    return isGhost(v) ? v : null;
  } catch {
    return null;
  }
}

const decoded = new WeakMap<Ghost, GhostPose[]>();

/** Unpacks a ghost into poses (cached). Returns an empty array for a damaged ghost. */
export function decodeGhost(ghost: Ghost): GhostPose[] {
  const hit = decoded.get(ghost);
  if (hit) return hit;
  const poses: GhostPose[] = [];
  const bytes = base64ToBytes(ghost.data);
  if (bytes) {
    let pos = 0;
    const next = (): number | null => {
      let v = 0;
      let mul = 1;
      for (;;) {
        if (pos >= bytes.length) return null;
        const b = bytes[pos++];
        v += (b & 127) * mul;
        if (b < 128) return v;
        mul *= 128;
      }
    };
    let x = 0;
    let y = 0;
    let phi = 0;
    for (let i = 0; i < ghost.n; i++) {
      const dx = next();
      const dy = next();
      const dp = next();
      if (dx === null || dy === null || dp === null) break;
      x += unzigzag(dx);
      y += unzigzag(dy);
      phi = wrapDeg(phi + unzigzag(dp));
      const rad = phi * DEG;
      const facing: 1 | -1 = Math.cos(rad) >= 0 ? 1 : -1;
      const theta = facing > 0 ? rad : wrapDeg(180 - phi) * DEG;
      poses.push({ t: i * ghost.dt, x: x / 100, y: y / 100, theta, facing });
    }
  }
  decoded.set(ghost, poses);
  return poses;
}

export interface GhostFrame extends GhostPose {
  /** The flight is over: the pose is its final resting place. */
  done: boolean;
}

/** The interpolated pose of a ghost `t` real seconds after launch (clamped to its flight); null if it has no samples. */
export function ghostAt(ghost: Ghost, t: number): GhostFrame | null {
  const poses = decodeGhost(ghost);
  if (poses.length === 0) return null;
  const last = poses.length - 1;
  if (t <= 0 || poses.length === 1) return { ...poses[0], t: 0, done: poses.length === 1 };
  if (t >= poses[last].t) return { ...poses[last], done: true };
  const i = Math.min(last - 1, Math.floor(t / ghost.dt));
  const a = poses[i];
  const b = poses[i + 1];
  const u = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  return { t, ...lerpPose(a, b, u), done: false };
}

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

function isGhost(v: unknown): v is Ghost {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  const finite = (k: string) => typeof g[k] === 'number' && Number.isFinite(g[k] as number);
  return (
    g.v === 1 &&
    typeof g.id === 'string' &&
    typeof g.designId === 'string' &&
    typeof g.designName === 'string' &&
    typeof g.color === 'string' &&
    typeof g.data === 'string' &&
    finite('createdAt') &&
    finite('n') &&
    finite('dt') &&
    finite('duration') &&
    finite('distance') &&
    (g.n as number) >= 0 &&
    (g.n as number) <= GHOST_MAX_SAMPLES * 4
  );
}

function resolveBackend(): StorageBackend {
  try {
    // Merely touching `localStorage` throws when site data is blocked.
    const ls = (globalThis as { localStorage?: StorageBackend }).localStorage;
    if (ls) return ls;
  } catch {
    /* blocked: fall back to memory */
  }
  return createMemoryBackend();
}

export interface GhostStoreOptions {
  perDesign?: number;
  total?: number;
}

/** Newest first; ties keep their stored order. */
function byNewest(a: Ghost, b: Ghost): number {
  return b.createdAt - a.createdAt;
}

export class GhostStore {
  private ghosts: Ghost[] | null = null;
  private readonly backend: StorageBackend;
  private readonly perDesign: number;
  private readonly total: number;
  /** False after a write the storage refused (full or blocked); the ghosts then live in memory only. */
  persisted = true;

  /** `backend` defaults to localStorage (or memory if that is blocked); pass one in tests. */
  constructor(backend?: StorageBackend | null, opts: GhostStoreOptions = {}) {
    this.backend = backend ?? resolveBackend();
    this.perDesign = opts.perDesign ?? MAX_GHOSTS_PER_DESIGN;
    this.total = opts.total ?? MAX_GHOSTS_TOTAL;
  }

  private load(): Ghost[] {
    if (this.ghosts) return this.ghosts;
    let list: Ghost[] = [];
    try {
      const raw = this.backend.getItem(GHOSTS_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        const arr = typeof parsed === 'object' && parsed !== null ? (parsed as { ghosts?: unknown }).ghosts : null;
        if (Array.isArray(arr)) list = arr.filter(isGhost);
      }
    } catch {
      /* unreadable: start empty; the next write replaces it */
    }
    this.ghosts = this.prune(list);
    return this.ghosts;
  }

  /** Forget what is in memory and read the storage again. */
  reload(): void {
    this.ghosts = null;
  }

  private prune(list: Ghost[]): Ghost[] {
    const sorted = list.slice().sort(byNewest);
    const seen = new Map<string, number>();
    const kept: Ghost[] = [];
    for (const g of sorted) {
      const n = seen.get(g.designId) ?? 0;
      if (n >= this.perDesign) continue;
      seen.set(g.designId, n + 1);
      kept.push(g);
    }
    return kept.slice(0, this.total);
  }

  private save(): void {
    const list = this.ghosts ?? [];
    let attempt = list;
    for (;;) {
      try {
        this.backend.setItem(GHOSTS_KEY, JSON.stringify({ v: 1, ghosts: attempt }));
        this.persisted = true;
        return;
      } catch {
        // Storage full or blocked: shed the oldest ghost and try again, down to nothing.
        if (attempt.length === 0) break;
        attempt = attempt.slice(0, attempt.length - 1);
      }
    }
    this.persisted = false;
  }

  /** Every ghost, newest first. */
  all(): Ghost[] {
    return this.load().slice();
  }

  /** The ghosts of one design, newest first. */
  forDesign(designId: string): Ghost[] {
    return this.load().filter((g) => g.designId === designId);
  }

  get(id: string): Ghost | undefined {
    return this.load().find((g) => g.id === id);
  }

  /** Adds a ghost (replacing one with the same id), enforces the limits and saves. Returns false if the storage refused the write. */
  add(ghost: Ghost): boolean {
    // Newest first, so on equal timestamps the ghost just added counts as the most recent.
    const list = [ghost, ...this.load().filter((g) => g.id !== ghost.id)];
    this.ghosts = this.prune(list);
    this.save();
    return this.persisted;
  }

  remove(id: string): boolean {
    const list = this.load();
    const next = list.filter((g) => g.id !== id);
    if (next.length === list.length) return false;
    this.ghosts = next;
    this.save();
    return true;
  }

  /** Removes the ghosts of one design, or all of them when no design is given. */
  clear(designId?: string): void {
    this.ghosts = designId === undefined ? [] : this.load().filter((g) => g.designId !== designId);
    this.save();
  }
}
