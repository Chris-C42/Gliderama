import { describe, expect, it } from 'vitest';
import {
  createRng,
  cyrb53,
  dailyKey,
  dailyNumber,
  dailySeed,
  hashString,
  type Rng,
} from '../src/core/rng';

const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.next());

describe('createRng: determinism and golden streams', () => {
  it('same seed gives the same stream; different seeds differ', () => {
    expect(take(createRng(123), 50)).toEqual(take(createRng(123), 50));
    expect(take(createRng(123), 5)).not.toEqual(take(createRng(124), 5));
  });

  // These pin the exact algorithm (sfc32 seeded via splitmix32, 12 warm-up draws). They were
  // cross-checked against an independent reference port. If one fails, the generator changed and
  // every Daily Flight / saved seed would change with it. Do not "fix" the numbers casually.
  it('golden: seed 42 floats', () => {
    expect(take(createRng(42), 5)).toEqual([
      0.8907801888417453, 0.4310670436825603, 0.3220651443116367, 0.2072944741230458, 0.6512069271411747,
    ]);
  });

  it('golden: seed 0 raw 32-bit outputs', () => {
    const r = createRng(0);
    expect([r.u32(), r.u32(), r.u32(), r.u32()]).toEqual([548183886, 1097162541, 2219297441, 1664216021]);
  });

  // Derived from the reference stream with the documented formulas (see each method's doc comment).
  it('golden: int / float / pick / weighted / shuffle', () => {
    const ints = createRng(7);
    expect(Array.from({ length: 10 }, () => ints.int(1, 6))).toEqual([6, 6, 4, 1, 1, 1, 4, 4, 4, 3]);

    const floats = createRng(7);
    expect([floats.float(10, 20), floats.float(10, 20), floats.float(10, 20)]).toEqual([
      19.80897915782407, 19.695635808166116, 16.09822355909273,
    ]);

    const letters = createRng(3);
    expect(Array.from({ length: 8 }, () => letters.pick(['a', 'b', 'c', 'd', 'e']))).toEqual([
      'c', 'e', 'd', 'e', 'd', 'c', 'd', 'c',
    ]);

    const items = [{ item: 'a', w: 1 }, { item: 'b', w: 3 }, { item: 'c', w: 0 }, { item: 'd', w: 2 }];
    const w = createRng(5);
    expect(Array.from({ length: 8 }, () => w.weighted(items))).toEqual(['d', 'b', 'd', 'a', 'b', 'a', 'd', 'b']);

    expect(createRng(12).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([6, 5, 10, 2, 7, 9, 8, 4, 3, 1]);
  });

  it('golden: fork derives its seed from hashString(`${seed}/${label}`)', () => {
    const f = createRng(100).fork('rooms');
    expect(f.seed).toBe(1870772086);
    expect(f.seed).toBe(hashString('100/rooms'));
    expect(take(f, 3)).toEqual([0.44490152201615274, 0.3193997093476355, 0.7854211546946317]);
  });

  it('exposes its 32-bit seed identity and keeps it while drawing', () => {
    const r = createRng(99);
    expect(r.seed).toBe(99);
    r.next();
    r.next();
    expect(r.seed).toBe(99);
  });
});

describe('seed normalisation', () => {
  it('small integers map to themselves; negatives and big integers are deterministic', () => {
    expect(createRng(5).seed).toBe(5);
    expect(createRng(-1).seed).toBe(4294967295);
    expect(take(createRng(-1), 4)).toEqual(take(createRng(-1), 4));
    expect(createRng(2 ** 40 + 5).seed).not.toBe(5); // high bits are not dropped
    expect(take(createRng(2 ** 40 + 5), 3)).not.toEqual(take(createRng(5), 3));
  });

  it('fractions, NaN and Infinity do not collapse onto one stream', () => {
    const a = take(createRng(0.25), 3);
    const b = take(createRng(0.75), 3);
    const z = take(createRng(0), 3);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(z);
    expect(() => createRng(NaN)).not.toThrow();
    expect(take(createRng(Infinity), 3)).not.toEqual(take(createRng(-Infinity), 3));
  });
});

describe('ranges and distribution', () => {
  it('next() is in [0, 1)', () => {
    const r = createRng(1);
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('u32() is an unsigned 32-bit integer', () => {
    const r = createRng(2);
    for (let i = 0; i < 2000; i++) {
      const v = r.u32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('float(a, b) stays in [a, b)', () => {
    const r = createRng(3);
    for (let i = 0; i < 5000; i++) {
      const v = r.float(-2.5, 7.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(7.5);
    }
  });

  it('int(a, b) is inclusive at both ends and covers the whole range', () => {
    const r = createRng(4);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 8);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8]);
    expect(r.int(5, 5)).toBe(5);
    expect(r.int(-2, -2)).toBe(-2);
    const swapped = r.int(8, 3);
    expect(swapped).toBeGreaterThanOrEqual(3);
    expect(swapped).toBeLessThanOrEqual(8);
  });

  it('is roughly uniform (fixed seed, so this is deterministic)', () => {
    const r = createRng(5);
    let sum = 0;
    const n = 30000;
    for (let i = 0; i < n; i++) sum += r.next();
    expect(sum / n).toBeGreaterThan(0.49);
    expect(sum / n).toBeLessThan(0.51);

    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) counts[r.int(1, 6) - 1]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(9500);
      expect(c).toBeLessThan(10500);
    }
  });
});

describe('chance / pick / weighted / shuffle', () => {
  it('chance(0) never, chance(1) always, chance(0.5) about half', () => {
    const r = createRng(6);
    for (let i = 0; i < 500; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
      expect(r.chance(-3)).toBe(false);
      expect(r.chance(3)).toBe(true);
    }
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (r.chance(0.5)) hits++;
    expect(hits).toBeGreaterThan(9700);
    expect(hits).toBeLessThan(10300);
  });

  it('every method consumes the documented number of draws', () => {
    const [first, second] = take(createRng(8), 2);
    /** The value drawn right after running `use` on a fresh generator. */
    const after = (use: (r: Rng) => unknown): number => {
      const r = createRng(8);
      use(r);
      return r.next();
    };
    expect(after((r) => r.chance(0))).toBe(second); // 1 draw even when p is 0
    expect(after((r) => r.chance(1))).toBe(second);
    expect(after((r) => r.pick([1]))).toBe(second); // 1 draw even for a single element
    expect(after((r) => r.int(4, 4))).toBe(second);
    expect(after((r) => r.float(1, 1))).toBe(second);
    expect(after((r) => r.weighted([{ item: 'a', w: 1 }]))).toBe(second);
    expect(after((r) => r.u32())).toBe(second);
    expect(after((r) => r.fork('x'))).toBe(first); // fork draws nothing
  });

  it('shuffle(n) consumes n - 1 draws', () => {
    for (const n of [0, 1, 2, 5, 9]) {
      const r = createRng(8);
      r.shuffle(Array.from({ length: n }, (_, i) => i));
      const expectedNext = take(createRng(8), Math.max(n - 1, 0) + 1)[Math.max(n - 1, 0)];
      expect(r.next()).toBe(expectedNext);
    }
  });

  it('pick', () => {
    const r = createRng(9);
    const arr = ['a', 'b', 'c', 'd'];
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(r.pick(arr));
    expect(seen.size).toBe(4);
    expect(() => r.pick([])).toThrow(RangeError);
  });

  it('weighted respects the weights', () => {
    const r = createRng(10);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 40000; i++) {
      counts[r.weighted([{ item: 'a', w: 1 }, { item: 'b', w: 3 }, { item: 'c', w: 0 }])]++;
    }
    expect(counts.c).toBe(0);
    expect(counts.a / 40000).toBeGreaterThan(0.24);
    expect(counts.a / 40000).toBeLessThan(0.26);
    expect(counts.b / 40000).toBeGreaterThan(0.74);
    expect(counts.b / 40000).toBeLessThan(0.76);
  });

  it('weighted ignores negative / NaN weights and rejects hopeless lists', () => {
    const r = createRng(11);
    for (let i = 0; i < 200; i++) {
      expect(r.weighted([{ item: 'bad', w: -5 }, { item: 'nan', w: NaN }, { item: 'ok', w: 2 }])).toBe('ok');
    }
    expect(() => r.weighted([])).toThrow(RangeError);
    expect(() => r.weighted([{ item: 'x', w: 0 }])).toThrow(RangeError);
    // only one item with weight, even if it is last
    expect(r.weighted([{ item: 'z', w: 0 }, { item: 'last', w: 0.0001 }])).toBe('last');
  });

  it('shuffle returns a new permutation and leaves the input alone', () => {
    const r = createRng(12);
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const frozen = input.slice();
    const out = r.shuffle(input);
    expect(input).toEqual(frozen);
    expect(out).not.toBe(input);
    expect([...out].sort((a, b) => a - b)).toEqual(frozen);
    expect(out).not.toEqual(frozen); // astronomically unlikely to be the identity for this fixed seed
    expect(createRng(12).shuffle(input)).toEqual(out); // deterministic
    expect(createRng(13).shuffle(input)).not.toEqual(out);
    expect(r.shuffle([])).toEqual([]);
    expect(r.shuffle(['only'])).toEqual(['only']);
  });

  it('shuffle is unbiased enough: every element reaches every slot', () => {
    const r = createRng(14);
    const slots = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    for (let i = 0; i < 8000; i++) r.shuffle([0, 1, 2, 3]).forEach((v, pos) => slots[v][pos]++);
    for (const row of slots) for (const c of row) expect(c).toBeGreaterThan(1800); // expected 2000
  });
});

describe('fork', () => {
  it('is deterministic and keyed by label', () => {
    const a1 = take(createRng(100).fork('rooms'), 20);
    const a2 = take(createRng(100).fork('rooms'), 20);
    const b = take(createRng(100).fork('twist'), 20);
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
    expect(take(createRng(101).fork('rooms'), 20)).not.toEqual(a1);
  });

  it('does not advance the parent and ignores how far the parent has advanced', () => {
    const untouched = take(createRng(100), 10);
    const parent = createRng(100);
    parent.fork('a');
    parent.fork('b');
    expect(take(parent, 10)).toEqual(untouched);

    const early = take(createRng(100).fork('x'), 10);
    const late = createRng(100);
    take(late, 1000);
    expect(take(late.fork('x'), 10)).toEqual(early);
  });

  it('children are independent of each other and of the parent', () => {
    const parent = take(createRng(7), 200);
    const a = take(createRng(7).fork('a'), 200);
    const b = take(createRng(7).fork('b'), 200);
    for (const [x, y] of [[parent, a], [parent, b], [a, b]] as const) {
      expect(x.filter((v, i) => v === y[i])).toHaveLength(0);
      // correlation of two independent uniform streams is ~0 (|r| < 0.2 for n = 200)
      const mx = x.reduce((s, v) => s + v, 0) / x.length;
      const my = y.reduce((s, v) => s + v, 0) / y.length;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (let i = 0; i < x.length; i++) {
        sxy += (x[i] - mx) * (y[i] - my);
        sxx += (x[i] - mx) ** 2;
        syy += (y[i] - my) ** 2;
      }
      expect(Math.abs(sxy / Math.sqrt(sxx * syy))).toBeLessThan(0.2);
    }
  });

  it('forks of forks work and stay distinct', () => {
    const root = createRng(5);
    const ab = take(root.fork('a').fork('b'), 5);
    expect(ab).toEqual(take(createRng(5).fork('a').fork('b'), 5));
    expect(ab).not.toEqual(take(root.fork('b').fork('a'), 5));
    expect(ab).not.toEqual(take(root.fork('a'), 5));
  });
});

describe('state save / restore', () => {
  it('restoring a snapshot replays the stream', () => {
    const r = createRng(21);
    take(r, 10);
    const snap = r.getState();
    const first = take(r, 25);
    r.setState(snap);
    expect(take(r, 25)).toEqual(first);
  });

  it('snapshots are plain JSON and restore into a different generator', () => {
    const r = createRng(22);
    take(r, 7);
    const json = JSON.stringify(r.getState());
    const expected = take(r, 10);
    const other = createRng(999);
    other.setState(JSON.parse(json));
    expect(take(other, 10)).toEqual(expected);
    expect(other.seed).toBe(22);
  });

  it('restores the identity too, so forks match', () => {
    const r = createRng(23);
    take(r, 3);
    const snap = r.getState();
    const other = createRng(5);
    other.setState(snap);
    expect(take(other.fork('f'), 5)).toEqual(take(r.fork('f'), 5));
  });

  it('the state accessor is equivalent to getState / setState', () => {
    const r = createRng(24);
    take(r, 4);
    expect(r.state).toEqual(r.getState());
    const snap = r.state;
    const first = take(r, 5);
    r.state = snap;
    expect(take(r, 5)).toEqual(first);
  });
});

describe('hashString', () => {
  it('cyrb53 matches the published test vectors', () => {
    expect(cyrb53('a')).toBe(7929297801672961);
    expect(cyrb53('b')).toBe(8684336938537663);
  });

  it('is stable: golden values', () => {
    expect(hashString('')).toBe(451236155);
    expect(hashString('a')).toBe(2195018406);
    expect(hashString('gliderama')).toBe(1392288783);
    expect(hashString('hello world')).toBe(3512108035);
  });

  it('returns unsigned 32-bit integers and is sensitive to every character', () => {
    const seen = new Set<number>();
    for (const s of ['a', 'b', 'ab', 'ba', 'abc', 'abd', 'héllo', 'hello', '✈', '']) {
      const h = hashString(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
      seen.add(h);
    }
    expect(seen.size).toBe(10);
  });
});

describe('daily helpers', () => {
  // All dates are built from LOCAL components, so these hold in any time zone.
  it('dailyKey formats the local date', () => {
    expect(dailyKey(new Date(2026, 0, 1, 12))).toBe('2026-01-01');
    expect(dailyKey(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
    expect(dailyKey(new Date(2026, 5, 7, 0, 30))).toBe('2026-06-07');
    expect(dailyKey(new Date(2027, 8, 9, 6))).toBe('2027-09-09');
    expect(dailyKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('dailyNumber counts days since 2026-01-01, starting at 1', () => {
    expect(dailyNumber(new Date(2026, 0, 1, 9))).toBe(1);
    expect(dailyNumber(new Date(2026, 0, 2, 9))).toBe(2);
    expect(dailyNumber(new Date(2026, 0, 31, 23, 59))).toBe(31);
    expect(dailyNumber(new Date(2026, 11, 31, 1))).toBe(365);
    expect(dailyNumber(new Date(2027, 0, 1, 1))).toBe(366);
    expect(dailyNumber(new Date(2025, 11, 31, 12))).toBe(0);
    expect(dailyNumber(new Date(2026, 9, 5, 12))).toBe(278);
  });

  it('dailyNumber advances by exactly 1 per calendar day, including across DST changes', () => {
    let prev = dailyNumber(new Date(2026, 0, 1, 12));
    for (let day = 2; day <= 800; day++) {
      const n = dailyNumber(new Date(2026, 0, day, 12));
      expect(n).toBe(prev + 1);
      prev = n;
    }
    // time of day never matters
    expect(dailyNumber(new Date(2026, 2, 8, 0, 0, 1))).toBe(dailyNumber(new Date(2026, 2, 8, 23, 59, 59)));
  });

  it('dailyNumber accepts a dailyKey string', () => {
    expect(dailyNumber('2026-01-01')).toBe(1);
    expect(dailyNumber('2026-10-05')).toBe(278);
    const d = new Date(2026, 3, 17, 15);
    expect(dailyNumber(dailyKey(d))).toBe(dailyNumber(d));
    expect(() => dailyNumber('2026/10/05')).toThrow(RangeError);
    expect(() => dailyNumber('nope')).toThrow(RangeError);
  });

  it('dailySeed hashes the namespaced key', () => {
    expect(dailySeed('2026-01-01')).toBe(hashString('gliderama-daily-2026-01-01'));
    expect(dailySeed('2026-01-01')).toBe(3923925312);
    expect(dailySeed('2026-10-05')).toBe(3169804701);
    expect(dailySeed('2026-01-01')).not.toBe(dailySeed('2026-01-02'));
  });
});
