import { describe, expect, it } from 'vitest';
import {
  CODE_PREFIX,
  COATINGS,
  ENUM_BITS,
  GADGETS,
  NAME_MAX_BYTES,
  PATTERNS,
  RECIPES,
  SIZES,
  STICKERS,
  STOCKS,
  TRAILS,
  decodeDesign,
  encodeDesign,
  quantizeDesign,
} from '../src/paper/codec';
import { blankDesign, MAX_CLIPS, MAX_FOLDS } from '../src/paper/design';
import type { Design, FoldOp } from '../src/paper/design';

/** Encoding of the design in the 'keeps the layout stable' test. Regenerate only with a format version bump. */
const GOLDEN_CODE =
  'GLD1-BkpLD_H-JZCWJYP8ZWFhJYWFvwMqVQyrfmaRIpuEOH-b9BYPGoRQA2U86enfxL_6LMKYhtjC5ubSxkCIwuToXw';

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

/** mulberry32: small, fast, seedable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A design with the identity fields pinned, for comparing decoded designs with expectations. */
function withoutIdentity(d: Design): Design {
  return { ...d, id: 'x', createdAt: 0, updatedAt: 0 };
}

const NAMES = [
  '',
  'Plane',
  'Classic Dart',
  'Ünïcödé flyer',
  '✈️ Jet',
  'A very long name that goes on and on',
  'タ紙飛行機の名前がとても長い',
  'tab\tand\nnewline',
  '😀😀😀😀😀😀😀',
  'x'.repeat(24),
  'y'.repeat(25),
  'lone\ud800surrogate',
  '﻿bom first',
];

function randomDesign(r: () => number): Design {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(r() * items.length)];
  const between = (min: number, max: number): number => min + r() * (max - min);
  const chance = (p: number): boolean => r() < p;
  // Mostly in range, sometimes exactly on the grid, sometimes far out of range (to exercise clamping).
  const wobble = (min: number, max: number): number => {
    const roll = r();
    if (roll < 0.06) return between(min - (max - min) * 0.4, max + (max - min) * 0.4);
    if (roll < 0.35) return Math.round(between(min, max) * 2) / 2;
    return between(min, max);
  };
  const hex = (): string => {
    const roll = r();
    if (roll < 0.04) return pick(['red', '', '#12', 'rgb(1,2,3)', '#gggggg']);
    const digits = roll < 0.12 ? 3 : 6;
    let out = '#';
    for (let i = 0; i < digits; i++) out += pick([...'0123456789abcdefABCDEF']);
    return out;
  };
  const point = () => ({ x: wobble(-150, 600), y: wobble(-150, 600) });

  const d = blankDesign();
  d.name = pick(NAMES);
  d.recipe = chance(0.6) ? pick([...RECIPES, 'custom-recipe']) : null;
  d.paper = { size: pick(SIZES), landscape: chance(0.5), stock: pick(STOCKS) };
  d.flapsOutside = chance(0.5);
  d.folds = Array.from({ length: Math.floor(r() * (MAX_FOLDS + 1)) }, (): FoldOp => ({
    a: point(),
    b: point(),
    side: chance(0.5) ? 1 : -1,
    mountain: chance(0.4),
    flap: chance(0.35) ? point() : null,
  }));
  d.wing = { d0: wobble(0, 255), d1: wobble(0, 255) };
  d.shape = {
    dihedral: wobble(-45, 60),
    winglet: chance(0.5) ? { x: wobble(0, 210), angle: wobble(-90, 90) } : null,
    elevator: chance(0.5)
      ? { depth: wobble(0, 80), from: wobble(0, 1), to: wobble(0, 1), angle: wobble(-45, 45) }
      : null,
  };
  d.extras = {
    clips: Array.from({ length: Math.floor(r() * (MAX_CLIPS + 1)) }, () => wobble(0, 420)),
    coating: pick(COATINGS),
    tape: Math.floor(r() * 4),
    gadget: pick(GADGETS),
  };
  const color = hex();
  d.look = {
    color,
    backColor: chance(0.5) ? color : hex(),
    pattern: pick(PATTERNS),
    ink: hex(),
    sticker: chance(0.5) ? pick([...STICKERS, 'banana']) : null,
    trail: chance(0.5) ? pick([...TRAILS, 'laser']) : null,
  };
  return d;
}

/** A design near the top of the size range: every optional part used, longest name. */
function maximalDesign(): Design {
  const d = blankDesign();
  d.name = 'n'.repeat(NAME_MAX_BYTES);
  d.recipe = 'hammerhead';
  const fold = (i: number): FoldOp => ({
    a: { x: -150 + i, y: 600 - i },
    b: { x: 600 - i, y: -150 + i },
    side: i % 2 ? 1 : -1,
    mountain: i % 3 === 0,
    flap: { x: 599.5 - i, y: -149.5 + i },
  });
  d.folds = Array.from({ length: MAX_FOLDS }, (_, i) => fold(i));
  d.shape = {
    dihedral: -45,
    winglet: { x: 255.5, angle: -90 },
    elevator: { depth: 80, from: 0, to: 1, angle: 45 },
  };
  d.extras = { clips: [1, 2, 511.5].slice(0, MAX_CLIPS), coating: 'foil', tape: 3, gadget: 'helium' };
  d.look = { color: '#123456', backColor: '#abcdef', pattern: 'flames', ink: '#fedcba', sticker: 'eye', trail: 'confetti' };
  return d;
}

/** A plausible everyday design: a five-fold dart with a clip and a short name. */
function typicalDesign(): Design {
  const d = blankDesign();
  d.name = 'Classic Dart';
  d.recipe = 'dart';
  d.folds = [
    { a: { x: 0, y: 105 }, b: { x: 105, y: 0 }, side: 1, mountain: false, flap: null },
    { a: { x: 0, y: 150 }, b: { x: 105, y: 52.5 }, side: 1, mountain: false, flap: null },
    { a: { x: 26.5, y: 0 }, b: { x: 26.5, y: 297 }, side: -1, mountain: false, flap: null },
    { a: { x: 52.5, y: 20 }, b: { x: 52.5, y: 297 }, side: -1, mountain: true, flap: null },
    { a: { x: 70, y: 120 }, b: { x: 105, y: 297 }, side: 1, mountain: false, flap: null },
  ];
  d.wing = { d0: 22, d1: 30 };
  d.shape.dihedral = 8;
  d.extras.clips = [40];
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// An independent description of the wire format, used to build and inspect codes by hand
// ---------------------------------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bodyBytes(code: string): number[] {
  const bits = [...code.slice(CODE_PREFIX.length)].flatMap((c) => B64.indexOf(c).toString(2).padStart(6, '0').split(''));
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return bytes;
}

function bytesToCode(bytes: number[]): string {
  const bits = bytes.map((b) => b.toString(2).padStart(8, '0')).join('');
  let out = '';
  for (let i = 0; i < bits.length; i += 6) out += B64[parseInt(bits.slice(i, i + 6).padEnd(6, '0'), 2)];
  return CODE_PREFIX + out;
}

/** CRC-8, polynomial 0x07, initial value 0xff, no final xor. */
function crc8(bytes: number[]): number {
  let crc = 0xff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** Overwrites `width` bits at `bitOffset` in the payload, then fixes the checksum. */
function patchBits(code: string, bitOffset: number, width: number, value: number): string {
  const bytes = bodyBytes(code);
  const payload = bytes.slice(0, -1);
  for (let i = 0; i < width; i++) {
    const bit = (value >> (width - 1 - i)) & 1;
    const pos = bitOffset + i;
    const mask = 0x80 >> (pos & 7);
    payload[pos >> 3] = bit ? payload[pos >> 3] | mask : payload[pos >> 3] & ~mask;
  }
  return bytesToCode([...payload, crc8(payload)]);
}

/** Bit offsets for a design with no folds, winglet, elevator or clips and back colour = front colour. */
const PLAIN_LAYOUT = {
  recipe: 7,
  foldCount: 11,
  stickerBits: 104,
  trailBits: 108,
  nameLength: 111,
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------

describe('format capacity', () => {
  it('fits every enum table (nullable ones need one extra code for "none")', () => {
    expect(SIZES.length).toBeLessThanOrEqual(2 ** ENUM_BITS.size);
    expect(STOCKS.length).toBeLessThanOrEqual(2 ** ENUM_BITS.stock);
    expect(COATINGS.length).toBeLessThanOrEqual(2 ** ENUM_BITS.coating);
    expect(GADGETS.length).toBeLessThanOrEqual(2 ** ENUM_BITS.gadget);
    expect(PATTERNS.length).toBeLessThanOrEqual(2 ** ENUM_BITS.pattern);
    expect(RECIPES.length + 1).toBeLessThanOrEqual(2 ** ENUM_BITS.recipe);
    expect(STICKERS.length + 1).toBeLessThanOrEqual(2 ** ENUM_BITS.sticker);
    expect(TRAILS.length + 1).toBeLessThanOrEqual(2 ** ENUM_BITS.trail);
  });

  it('has no duplicate table entries', () => {
    for (const table of [SIZES, STOCKS, COATINGS, GADGETS, PATTERNS, STICKERS, TRAILS, RECIPES]) {
      expect(new Set(table).size).toBe(table.length);
    }
  });

  it('fits the fold and clip limits of the design schema', () => {
    expect(MAX_FOLDS).toBeLessThanOrEqual(15);
    expect(MAX_CLIPS).toBeLessThanOrEqual(3);
  });

  it('uses the documented tables', () => {
    expect([...STICKERS]).toEqual(['star', 'heart', 'bolt', 'smile', 'skull', 'flower', 'moon', 'eye']);
    expect([...TRAILS]).toEqual(['dots', 'sparkle', 'rainbow', 'smoke', 'hearts', 'confetti']);
    expect([...RECIPES]).toEqual(['dart', 'glider', 'nakamura', 'delta', 'hammerhead', 'square']);
  });
});

describe('round trips', () => {
  it('survives 300 seeded random designs: decode(encode(d)) === quantize(d)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const original = randomDesign(seeded(seed));
      const quantized = quantizeDesign(original);
      const code = encodeDesign(original);

      const decoded = decodeDesign(code);
      expect(decoded, `seed ${seed}: ${code}`).not.toBeNull();
      expect(withoutIdentity(decoded as Design), `seed ${seed}`).toEqual(withoutIdentity(quantized));

      // Quantising first changes nothing, and quantising is idempotent.
      expect(encodeDesign(quantized), `seed ${seed}`).toBe(code);
      expect(quantizeDesign(quantized), `seed ${seed}`).toEqual(quantized);
    }
  });

  it('round-trips the extremes of every range', () => {
    const d = maximalDesign();
    const decoded = decodeDesign(encodeDesign(d)) as Design;
    expect(withoutIdentity(decoded)).toEqual(withoutIdentity(d)); // already on the grid: nothing is lost
    expect(decoded.folds).toHaveLength(MAX_FOLDS);
    expect(decoded.folds[0].a).toEqual({ x: -150, y: 600 });
    expect(decoded.shape.winglet).toEqual({ x: 255.5, angle: -90 });
    expect(decoded.extras.clips).toEqual([1, 2, 511.5]);
  });

  it('round-trips a blank design and a design with every optional part switched off', () => {
    const blank = blankDesign();
    expect(withoutIdentity(decodeDesign(encodeDesign(blank)) as Design)).toEqual(withoutIdentity(quantizeDesign(blank)));
  });

  it('gives the decoded design a fresh id and timestamps', () => {
    const original = typicalDesign();
    const before = Date.now();
    const decoded = decodeDesign(encodeDesign(original)) as Design;
    expect(decoded.v).toBe(1);
    expect(decoded.id).toMatch(/^d_/);
    expect(decoded.id).not.toBe(original.id);
    expect(decoded.createdAt).toBeGreaterThanOrEqual(before);
    expect(decoded.updatedAt).toBe(decoded.createdAt);
    expect(decodeDesign(encodeDesign(original))?.id).not.toBe(decoded.id);
  });

  it('does not modify its input', () => {
    const original = randomDesign(seeded(7));
    const snapshot = JSON.stringify(original);
    encodeDesign(original);
    quantizeDesign(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
});

describe('quantisation', () => {
  const base = (): Design => {
    const d = blankDesign();
    d.folds = [{ a: { x: 12.3, y: -150.4 }, b: { x: 700, y: -400 }, side: 1, mountain: false, flap: { x: 33.26, y: 599.8 } }];
    return d;
  };

  it('snaps fold coordinates to 0.5 mm and clamps them to -150..600', () => {
    const [fold] = quantizeDesign(base()).folds;
    expect(fold.a).toEqual({ x: 12.5, y: -150 });
    expect(fold.b).toEqual({ x: 600, y: -150 });
    expect(fold.flap).toEqual({ x: 33.5, y: 600 });
  });

  it('snaps wing depths, dihedral, winglet, elevator and clips', () => {
    const d = base();
    d.wing = { d0: 20.24, d1: 300 };
    d.shape = {
      dihedral: 100,
      winglet: { x: 99.76, angle: 45.4 },
      elevator: { depth: 12.3, from: 0.3, to: 1.7, angle: -60 },
    };
    d.extras.clips = [100.26, -5, 300.74, 12, 13];
    const q = quantizeDesign(d);
    expect(q.wing).toEqual({ d0: 20, d1: 255.5 });
    expect(q.shape.dihedral).toBe(60);
    expect(q.shape.winglet).toEqual({ x: 100, angle: 45 });
    expect(q.shape.elevator).toEqual({ depth: 12.5, from: 38 / 128, to: 1, angle: -45 });
    expect(q.extras.clips).toEqual([100.5, 0, 300.5]); // at most MAX_CLIPS (3)
  });

  it('keeps at most MAX_FOLDS folds', () => {
    const d = base();
    d.folds = Array.from({ length: MAX_FOLDS + 5 }, () => d.folds[0]);
    expect(quantizeDesign(d).folds).toHaveLength(MAX_FOLDS);
  });

  it('turns NaN and infinities into in-range numbers', () => {
    const d = base();
    d.wing = { d0: NaN, d1: Infinity };
    d.shape.dihedral = -Infinity;
    const q = quantizeDesign(d);
    expect(q.wing).toEqual({ d0: 0, d1: 255.5 });
    expect(q.shape.dihedral).toBe(-45);
    expect(decodeDesign(encodeDesign(d))).not.toBeNull();
  });

  it('never produces negative zero', () => {
    const d = base();
    d.folds[0].a = { x: -0.2, y: -0 };
    d.shape.dihedral = -0.1;
    const q = quantizeDesign(d);
    expect(Object.is(q.folds[0].a.x, 0)).toBe(true);
    expect(Object.is(q.folds[0].a.y, 0)).toBe(true);
    expect(Object.is(q.shape.dihedral, 0)).toBe(true);
  });

  it('validates enums: unknown ids fall back, or become null for recipe / sticker / trail', () => {
    const d = blankDesign();
    d.recipe = 'made-up';
    d.look.sticker = 'banana';
    d.look.trail = 'laser';
    (d.paper as { size: string }).size = 'a0';
    (d.paper as { stock: string }).stock = 'granite';
    (d.look as { pattern: string }).pattern = 'tartan';
    (d.extras as { coating: string }).coating = 'gold';
    (d.extras as { gadget: string }).gadget = 'jetpack';
    d.extras.tape = 9;
    const q = quantizeDesign(d);
    expect(q.recipe).toBeNull();
    expect(q.look.sticker).toBeNull();
    expect(q.look.trail).toBeNull();
    expect(q.paper).toMatchObject({ size: 'a4', stock: 'printer' });
    expect(q.look.pattern).toBe('plain');
    expect(q.extras).toMatchObject({ coating: 'none', gadget: 'none', tape: 3 });
  });

  it('round-trips every table entry', () => {
    const fields: Array<{ table: readonly string[]; set: (d: Design, v: string) => void; get: (d: Design) => unknown }> = [
      { table: SIZES, set: (d, v) => void ((d.paper as { size: string }).size = v), get: (d) => d.paper.size },
      { table: STOCKS, set: (d, v) => void ((d.paper as { stock: string }).stock = v), get: (d) => d.paper.stock },
      { table: COATINGS, set: (d, v) => void ((d.extras as { coating: string }).coating = v), get: (d) => d.extras.coating },
      { table: GADGETS, set: (d, v) => void ((d.extras as { gadget: string }).gadget = v), get: (d) => d.extras.gadget },
      { table: PATTERNS, set: (d, v) => void ((d.look as { pattern: string }).pattern = v), get: (d) => d.look.pattern },
      { table: STICKERS, set: (d, v) => void (d.look.sticker = v), get: (d) => d.look.sticker },
      { table: TRAILS, set: (d, v) => void (d.look.trail = v), get: (d) => d.look.trail },
      { table: RECIPES, set: (d, v) => void (d.recipe = v), get: (d) => d.recipe },
    ];
    for (const { table, set, get } of fields) {
      for (const value of table) {
        const d = blankDesign();
        set(d, value);
        const decoded = decodeDesign(encodeDesign(d)) as Design;
        expect(get(decoded), value).toBe(value);
        expect(withoutIdentity(decoded)).toEqual(withoutIdentity(quantizeDesign(d)));
      }
    }
  });

  it('normalises colours to lowercase #rrggbb, back colour follows front when invalid', () => {
    const d = blankDesign();
    d.look.color = '#ABC';
    d.look.backColor = 'not a colour';
    d.look.ink = '#0A0B0C';
    const q = quantizeDesign(d);
    expect(q.look).toMatchObject({ color: '#aabbcc', backColor: '#aabbcc', ink: '#0a0b0c' });
    const decoded = decodeDesign(encodeDesign(d)) as Design;
    expect(decoded.look).toMatchObject({ color: '#aabbcc', backColor: '#aabbcc', ink: '#0a0b0c' });
  });

  it('keeps distinct front and back colours', () => {
    const d = blankDesign();
    d.look.color = '#112233';
    d.look.backColor = '#445566';
    const decoded = decodeDesign(encodeDesign(d)) as Design;
    expect(decoded.look).toMatchObject({ color: '#112233', backColor: '#445566' });
  });

  it('keeps a flap point only when there is one', () => {
    const d = blankDesign();
    d.folds = [
      { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, side: 1, mountain: false, flap: null },
      { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, side: -1, mountain: true, flap: { x: 7.5, y: -20 } },
    ];
    const decoded = decodeDesign(encodeDesign(d)) as Design;
    expect(decoded.folds.map((f) => f.flap)).toEqual([null, { x: 7.5, y: -20 }]);
    expect(decoded.folds.map((f) => [f.side, f.mountain])).toEqual([[1, false], [-1, true]]);
  });

  it('treats a missing flap field (designs saved before it existed) as no flap', () => {
    const d = blankDesign();
    const legacy = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, side: 1, mountain: false } as unknown as FoldOp;
    d.folds = [legacy];
    expect(quantizeDesign(d).folds[0].flap).toBeNull();
    expect((decodeDesign(encodeDesign(d)) as Design).folds[0].flap).toBeNull();
  });
});

describe('names', () => {
  const nameAfterRoundTrip = (name: string): string => {
    const d = blankDesign();
    d.name = name;
    const decoded = decodeDesign(encodeDesign(d)) as Design;
    expect(decoded.name).toBe(quantizeDesign(d).name);
    return decoded.name;
  };
  const utf8Length = (s: string): number => new TextEncoder().encode(s).length;

  it('keeps names up to 24 UTF-8 bytes intact', () => {
    expect(nameAfterRoundTrip('')).toBe('');
    expect(nameAfterRoundTrip('Classic Dart')).toBe('Classic Dart');
    expect(nameAfterRoundTrip('x'.repeat(24))).toBe('x'.repeat(24));
    expect(nameAfterRoundTrip('Ünïcödé flyer')).toBe('Ünïcödé flyer');
    expect(nameAfterRoundTrip('紙飛行機')).toBe('紙飛行機');
  });

  it('cuts longer names at a character boundary, never inside a multi-byte character', () => {
    expect(nameAfterRoundTrip('y'.repeat(30))).toBe('y'.repeat(24));
    const accents = nameAfterRoundTrip('é'.repeat(20)); // 2 bytes each -> 12 characters fit
    expect(accents).toBe('é'.repeat(12));
    const emoji = nameAfterRoundTrip('😀'.repeat(10)); // 4 bytes each -> 6 fit
    expect(emoji).toBe('😀'.repeat(6));
    const kana = nameAfterRoundTrip('あ'.repeat(10)); // 3 bytes each -> 8 fit
    expect(kana).toBe('あ'.repeat(8));
    for (const name of [accents, emoji, kana]) expect(utf8Length(name)).toBeLessThanOrEqual(NAME_MAX_BYTES);
  });

  it('drops control characters and replaces lone surrogates', () => {
    expect(nameAfterRoundTrip('tab\tand\nnewline\u0000')).toBe('tabandnewline');
    expect(nameAfterRoundTrip('lone\ud800surrogate')).toBe('lone�surrogate');
  });

  it('keeps a leading byte-order mark', () => {
    expect(nameAfterRoundTrip('﻿bom')).toBe('﻿bom');
  });
});

describe('malformed codes decode to null', () => {
  const good = encodeDesign(typicalDesign());

  it('rejects empty input and wrong prefixes', () => {
    for (const code of ['', ' ', '\n', 'GLD1', 'GLD1-', 'GLD2-' + good.slice(5), 'gld1-' + good.slice(5), good.slice(5), 'XGLD1-' + good.slice(5), 'hello world']) {
      expect(decodeDesign(code), JSON.stringify(code)).toBeNull();
    }
  });

  it('rejects non-strings without throwing', () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expect(decodeDesign(value as unknown as string)).toBeNull();
    }
  });

  it('rejects characters outside the URL-safe alphabet', () => {
    expect(decodeDesign(good + '=')).toBeNull();
    expect(decodeDesign(good.slice(0, 20) + '+' + good.slice(21))).toBeNull();
    expect(decodeDesign(good.slice(0, 20) + '/' + good.slice(21))).toBeNull();
    expect(decodeDesign(good.slice(0, 20) + '!' + good.slice(21))).toBeNull();
    expect(decodeDesign(good.slice(0, 20) + 'é' + good.slice(21))).toBeNull();
  });

  it('rejects absurdly long input', () => {
    expect(decodeDesign(good + 'A'.repeat(5000))).toBeNull();
    expect(decodeDesign(CODE_PREFIX + 'A'.repeat(400))).toBeNull();
  });

  it('rejects 300 seeded random strings with a valid prefix', () => {
    const r = seeded(99);
    for (let i = 0; i < 300; i++) {
      const length = 1 + Math.floor(r() * 160);
      let body = '';
      for (let j = 0; j < length; j++) body += B64[Math.floor(r() * 64)];
      expect(decodeDesign(CODE_PREFIX + body), CODE_PREFIX + body).toBeNull();
    }
  });

  it('rejects every truncation of a valid code', () => {
    for (const design of [typicalDesign(), maximalDesign(), blankDesign(), randomDesign(seeded(5))]) {
      const code = encodeDesign(design);
      for (let length = 0; length < code.length; length++) {
        expect(decodeDesign(code.slice(0, length)), `${length}/${code.length} of ${code}`).toBeNull();
      }
    }
  });

  it('rejects every single-character substitution (the checksum catches any burst of up to 8 bits)', () => {
    for (const design of [typicalDesign(), maximalDesign(), blankDesign()]) {
      const code = encodeDesign(design);
      for (let i = CODE_PREFIX.length; i < code.length; i++) {
        for (const replacement of B64) {
          if (replacement === code[i]) continue;
          const tampered = code.slice(0, i) + replacement + code.slice(i + 1);
          expect(decodeDesign(tampered), `${i}:${replacement} of ${code}`).toBeNull();
        }
      }
    }
  });

  it('rejects inserted and removed characters', () => {
    const code = encodeDesign(typicalDesign());
    for (let i = CODE_PREFIX.length; i <= code.length; i++) {
      expect(decodeDesign(code.slice(0, i) + 'A' + code.slice(i)), `insert at ${i}`).toBeNull();
    }
    for (let i = CODE_PREFIX.length; i < code.length; i++) {
      expect(decodeDesign(code.slice(0, i) + code.slice(i + 1)), `remove at ${i}`).toBeNull();
    }
  });

  it('rejects appended data, even with a recomputed checksum', () => {
    const code = encodeDesign(typicalDesign());
    const bytes = bodyBytes(code);
    const payload = [...bytes.slice(0, -1), 0x00]; // one extra byte
    expect(decodeDesign(bytesToCode([...payload, crc8(payload)]))).toBeNull();
  });

  it('rejects out-of-range counts and enum indices written with a valid checksum', () => {
    const plain = encodeDesign({ ...blankDesign(), name: 'plain' });
    expect(decodeDesign(plain)).not.toBeNull(); // the hand-built layout below must match the real one
    // 13..15 folds, an impossible size index, a name longer than 24 bytes
    expect(decodeDesign(patchBits(plain, PLAIN_LAYOUT.foldCount, 4, MAX_FOLDS + 1))).toBeNull();
    expect(decodeDesign(patchBits(plain, 0, 3, 7))).toBeNull();
    expect(decodeDesign(patchBits(plain, PLAIN_LAYOUT.nameLength, 5, 25))).toBeNull();
  });

  it('rejects invalid UTF-8 in the name', () => {
    const named = encodeDesign({ ...blankDesign(), name: 'ab' });
    // name: length 2 at bit 111, first byte at bit 116 -> make it 0xff, which is never valid UTF-8
    expect(decodeDesign(patchBits(named, 116, 8, 0xff))).toBeNull();
  });

  it('ignores whitespace around and inside a valid code', () => {
    const d = typicalDesign();
    const code = encodeDesign(d);
    const reference = withoutIdentity(decodeDesign(code) as Design);
    expect(withoutIdentity(decodeDesign(`  ${code}\n`) as Design)).toEqual(reference);
    expect(withoutIdentity(decodeDesign(`${code.slice(0, 30)}\n${code.slice(30, 60)} ${code.slice(60)}`) as Design)).toEqual(reference);
  });
});

describe('forward compatibility', () => {
  it('reads recipe / sticker / trail indices this build does not know as "none"', () => {
    const d = { ...blankDesign(), name: 'x', recipe: 'dart', look: { ...blankDesign().look, sticker: 'star', trail: 'dots' } };
    let code = encodeDesign(d);
    expect((decodeDesign(code) as Design).recipe).toBe('dart');
    code = patchBits(code, PLAIN_LAYOUT.recipe, 3, 7); // 7 > RECIPES.length
    code = patchBits(code, PLAIN_LAYOUT.stickerBits, 4, 15);
    code = patchBits(code, PLAIN_LAYOUT.trailBits, 3, 7);
    const decoded = decodeDesign(code) as Design;
    expect(decoded).not.toBeNull();
    expect(decoded.recipe).toBeNull();
    expect(decoded.look.sticker).toBeNull();
    expect(decoded.look.trail).toBeNull();
  });

  it('clamps numbers that are outside the grid\'s range instead of failing', () => {
    // dihedral is 8 bits at offset 33 in a design without folds; 255 is far above the 210 levels in use
    const code = patchBits(encodeDesign({ ...blankDesign(), name: 'x' }), 33, 8, 255);
    expect((decodeDesign(code) as Design).shape.dihedral).toBe(60);
  });
});

describe('wire format', () => {
  it('is GLD1- plus URL-safe base64 without padding', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const code = encodeDesign(randomDesign(seeded(seed)));
      expect(code).toMatch(/^GLD1-[A-Za-z0-9_-]+$/);
      expect(encodeURIComponent(code)).toBe(code);
    }
  });

  it('ends with the CRC-8 of the payload', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const bytes = bodyBytes(encodeDesign(randomDesign(seeded(seed))));
      const payload = bytes.slice(0, -1);
      expect(bytes[bytes.length - 1]).toBe(crc8(payload));
    }
  });

  it('is deterministic', () => {
    const d = typicalDesign();
    expect(encodeDesign(d)).toBe(encodeDesign(structuredClone(d)));
  });

  /** Reads the payload bits the way the format description in codec.ts lays them out. */
  const fieldReader = (code: string) => {
    const bits = bodyBytes(code).map((b) => b.toString(2).padStart(8, '0')).join('');
    return (offset: number, width: number): number => parseInt(bits.slice(offset, offset + width), 2);
  };

  it('lays out a fold as documented', () => {
    const d = blankDesign();
    d.folds = [{ a: { x: -150, y: 600 }, b: { x: 0.5, y: 12 }, side: -1, mountain: true, flap: { x: 100, y: 200.5 } }];
    const read = fieldReader(encodeDesign(d));
    expect(read(11, 4)).toBe(1); // fold count
    expect(read(15, 11)).toBe(0); // a.x = -150 mm -> level 0
    expect(read(26, 11)).toBe(1500); // a.y = 600 mm -> top level
    expect(read(37, 11)).toBe(301); // b.x = 0.5 mm -> (0.5 + 150) / 0.5
    expect(read(48, 11)).toBe(324); // b.y = 12 mm
    expect(read(59, 1)).toBe(0); // side -1
    expect(read(60, 1)).toBe(1); // mountain
    expect(read(61, 1)).toBe(1); // flap present
    expect(read(62, 11)).toBe(500); // flap.x = 100 mm
    expect(read(73, 11)).toBe(701); // flap.y = 200.5 mm
    expect(read(84, 9)).toBe(40); // wing.d0 = 20 mm follows the fold
  });

  it('lays out winglet, elevator and clips as documented', () => {
    const d = blankDesign();
    d.wing = { d0: 12.5, d1: 255.5 };
    d.shape = {
      dihedral: 7,
      winglet: { x: 100, angle: 30 },
      elevator: { depth: 12, from: 0.25, to: 0.75, angle: -10 },
    };
    d.extras.clips = [10, 20];
    const read = fieldReader(encodeDesign(d));
    expect(read(15, 9)).toBe(25); // wing.d0
    expect(read(24, 9)).toBe(511); // wing.d1
    expect(read(33, 8)).toBe(104); // dihedral 7 deg -> (7 + 45) / 0.5
    expect(read(41, 1)).toBe(1); // winglet present
    expect(read(42, 9)).toBe(200); // winglet.x = 100 mm
    expect(read(51, 8)).toBe(120); // winglet.angle = 30 deg -> 30 + 90
    expect(read(59, 1)).toBe(1); // elevator present
    expect(read(60, 8)).toBe(24); // depth = 12 mm
    expect(read(68, 8)).toBe(32); // from = 0.25 -> 32 / 128
    expect(read(76, 8)).toBe(96); // to = 0.75 -> 96 / 128
    expect(read(84, 8)).toBe(70); // angle = -10 deg -> (-10 + 45) / 0.5
    expect(read(92, 2)).toBe(2); // clip count
    expect(read(94, 10)).toBe(20); // clip at 10 mm
    expect(read(104, 10)).toBe(40); // clip at 20 mm
  });

  it('keeps the layout stable (golden code)', () => {
    // If this fails, shared codes in the wild stop decoding: change the prefix (GLD2-) instead of the layout.
    const d = typicalDesign();
    d.id = 'd_golden';
    d.look = { color: '#d94f3a', backColor: '#f4efe2', pattern: 'stars', ink: '#ffd166', sticker: 'star', trail: 'sparkle' };
    d.folds[3].flap = { x: 60, y: 140.5 };
    expect(encodeDesign(d)).toBe(GOLDEN_CODE);

    const decoded = decodeDesign(GOLDEN_CODE) as Design;
    expect(withoutIdentity(decoded)).toEqual(withoutIdentity(quantizeDesign(d)));
    expect(decoded.name).toBe('Classic Dart');
    expect(decoded.folds).toHaveLength(5);
    expect(decoded.folds[3]).toEqual({ a: { x: 52.5, y: 20 }, b: { x: 52.5, y: 297 }, side: -1, mountain: true, flap: { x: 60, y: 140.5 } });
  });
});

describe('code length', () => {
  it('stays short', () => {
    const rows: Array<[string, number]> = [
      ['blank sheet, no folds', encodeDesign(blankDesign()).length],
      ['typical: 5-fold dart, clip, name', encodeDesign(typicalDesign()).length],
      ['maximal: 12 folds with flaps, every part, 24-byte name', encodeDesign(maximalDesign()).length],
    ];
    for (const [label, length] of rows) console.info(`[codec] ${label}: ${length} characters`);
    const [blank, typical, maximal] = rows.map(([, length]) => length);
    expect(blank).toBeLessThan(60);
    expect(typical).toBeLessThan(100);
    expect(maximal).toBeLessThan(230);
  });
});

