/**
 * Deterministic random numbers and the date-seeded "daily" helpers.
 *
 * - Generator: sfc32 (Small Fast Counter), seeded by running splitmix32 four times.
 * - Everything is built from 32-bit integer ops (`Math.imul`, shifts, `|0`, `>>> 0`) plus
 *   IEEE-754 +, -, * and division by powers of two, so a given seed produces exactly the same
 *   stream in every JS engine. Never use `Math.random`, `Math.sin` etc. in seeded code paths.
 * - The golden-value tests in tests/rng.test.ts pin the exact streams: changing the algorithm
 *   would change every player's Daily Flight and every saved roguelike seed.
 *
 * Draw accounting (so streams stay in step when you refactor): `next`, `u32`, `float`, `int`,
 * `chance`, `pick` and `weighted` each consume exactly one draw, `shuffle` consumes `n - 1`, and
 * `fork` consumes none.
 */

const TWO_32 = 4294967296;

/** JSON-serialisable snapshot of a generator, for save/restore. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
  /** Identity of the stream (what `fork` derives children from); restored along with the position. */
  seed: number;
}

export interface Rng {
  /** The 32-bit identity this stream was created with (unchanged by drawing). */
  readonly seed: number;
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform unsigned 32-bit integer. */
  u32(): number;
  /** Uniform float in [a, b). */
  float(a: number, b: number): number;
  /** Uniform integer in [a, b], both ends inclusive. Arguments are swapped if a > b. */
  int(a: number, b: number): number;
  /** True with probability p (p <= 0 never, p >= 1 always). Always consumes one draw. */
  chance(p: number): boolean;
  /** Uniformly pick an element. Throws on an empty array. */
  pick<T>(arr: readonly T[]): T;
  /**
   * Pick an item with probability proportional to its weight `w` (non-finite and non-positive
   * weights count as 0). Throws if the list is empty or no weight is positive.
   */
  weighted<T>(items: readonly { item: T; w: number }[]): T;
  /** Fisher-Yates shuffle; returns a new array and leaves the input untouched. */
  shuffle<T>(arr: readonly T[]): T[];
  /**
   * Derive an independent child stream named `label`. Deterministic and keyed by (this stream's
   * seed, label) only: it does not consume draws from the parent, and it does not matter how many
   * values the parent has produced before or after the fork. Forking the same label twice returns
   * two identical streams, so use distinct labels (e.g. `room-${i}`) for distinct purposes.
   */
  fork(label: string): Rng;
  /** Snapshot the generator (position + identity). */
  getState(): RngState;
  /** Restore a snapshot taken with `getState`. */
  setState(state: RngState): void;
  /** Accessor form of getState / setState. */
  state: RngState;
}

// ---------------------------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------------------------

/**
 * cyrb53 (public domain, by bryc): a fast 53-bit string hash. Iterates over UTF-16 code units.
 * Prefer `hashString` unless you specifically need 53 bits.
 */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return TWO_32 * (2097151 & h2) + (h1 >>> 0);
}

/** cyrb53 folded to an unsigned 32-bit integer (low 32 bits XOR the high 21 bits). */
export function hashString(s: string): number {
  const h = cyrb53(s);
  const lo = h >>> 0;
  const hi = Math.floor(h / TWO_32);
  return (lo ^ hi) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------------------------

/**
 * Reduce any number to an unsigned 32-bit seed. Integers in the 32-bit range keep their value
 * (`-1` is 4294967295, exactly what `>>> 0` gives); bigger integers (timestamps...) have their
 * high bits mixed in; NaN, +-Infinity and fractions are hashed, since `>>> 0` would collapse them.
 */
function normalizeSeed(seed: number): number {
  if (!Number.isInteger(seed)) return hashString('seed:' + String(seed));
  if (seed >= -2147483648 && seed <= 4294967295) return seed >>> 0;
  const lo = seed >>> 0; // ToUint32: the low 32 bits, exact for any integer double
  const hi = Math.floor(seed / TWO_32) | 0;
  return (lo ^ Math.imul(hi, 0x9e3779b1)) >>> 0;
}

class Sfc32 implements Rng {
  private _seed: number;
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    this._seed = seed >>> 0;

    // splitmix32 expands the 32-bit seed into the 128-bit sfc32 state.
    let s = this._seed | 0;
    const split = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
      return (z ^ (z >>> 15)) | 0;
    };
    this.a = split();
    this.b = split();
    this.c = split();
    this.d = split();

    // Discard the first outputs, as the sfc authors recommend.
    for (let i = 0; i < 12; i++) this.u32();
  }

  get seed(): number {
    return this._seed;
  }

  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  next(): number {
    return this.u32() / TWO_32;
  }

  float(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  int(a: number, b: number): number {
    if (b < a) {
      const t = a;
      a = b;
      b = t;
    }
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new RangeError('rng.pick: empty array');
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted<T>(items: readonly { item: T; w: number }[]): T {
    let total = 0;
    for (const it of items) if (it.w > 0 && Number.isFinite(it.w)) total += it.w;
    if (!(total > 0)) throw new RangeError('rng.weighted: no item has a positive weight');
    let r = this.next() * total;
    let last = items[0].item;
    for (const it of items) {
      if (!(it.w > 0 && Number.isFinite(it.w))) continue;
      last = it.item;
      r -= it.w;
      if (r < 0) return it.item;
    }
    return last; // floating-point slack: fall back to the last positive-weight item
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  fork(label: string): Rng {
    return new Sfc32(hashString(this._seed + '/' + label));
  }

  getState(): RngState {
    return { a: this.a >>> 0, b: this.b >>> 0, c: this.c >>> 0, d: this.d >>> 0, seed: this._seed };
  }

  setState(s: RngState): void {
    this.a = s.a | 0;
    this.b = s.b | 0;
    this.c = s.c | 0;
    this.d = s.d | 0;
    this._seed = s.seed >>> 0;
  }

  get state(): RngState {
    return this.getState();
  }

  set state(s: RngState) {
    this.setState(s);
  }
}

/** Create a seeded generator. The same seed always yields the same stream, in every engine. */
export function createRng(seed: number): Rng {
  return new Sfc32(normalizeSeed(seed));
}

// ---------------------------------------------------------------------------------------------
// Daily Flight helpers
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86400000;
const DAILY_EPOCH_UTC = Date.UTC(2026, 0, 1);

/** 'YYYY-MM-DD' for the given moment in the player's local time zone. */
export function dailyKey(date: Date = new Date()): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The Daily Flight number: 1 on 2026-01-01, 2 on 2026-01-02, ... Counts local calendar days (so DST
 * shifts and time zones never skew it). Accepts a Date or a 'YYYY-MM-DD' key from `dailyKey`.
 */
export function dailyNumber(date: Date | string = new Date()): number {
  let y: number;
  let m: number;
  let d: number;
  if (typeof date === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) throw new RangeError(`dailyNumber: expected 'YYYY-MM-DD', got '${date}'`);
    y = Number(match[1]);
    m = Number(match[2]) - 1;
    d = Number(match[3]);
  } else {
    y = date.getFullYear();
    m = date.getMonth();
    d = date.getDate();
  }
  return Math.round((Date.UTC(y, m, d) - DAILY_EPOCH_UTC) / DAY_MS) + 1;
}

/** Seed for a given daily key (see `dailyKey`). Same key, same house, for everyone. */
export function dailySeed(key: string): number {
  return hashString('gliderama-daily-' + key);
}
