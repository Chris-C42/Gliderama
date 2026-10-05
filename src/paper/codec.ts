/**
 * Share codec: a `Design` <-> a short text code, `GLD1-<base64url>`.
 *
 * The payload is bit-packed (MSB first) and ends with a one-byte CRC-8 over everything before it. Field order
 * (v1 - never reorder or resize; a layout change means a new prefix, e.g. GLD2-):
 *
 *   paper        size:3  landscape:1  stock:3
 *   recipe:3  flapsOutside:1
 *   folds        count:4, then per fold:
 *                  a.x a.y b.x b.y   4 x 11 bits   -150..600 mm in 0.5 mm steps
 *                  side:1 (1 = +1)   mountain:1
 *                  flap present:1, then if set flap.x flap.y   2 x 11 bits (same grid)
 *   wing         d0:9 d1:9           0..255.5 mm in 0.5 mm steps
 *   shape        dihedral:8          -45..60 deg in 0.5 deg steps
 *                winglet present:1, then x:9 (0..255.5 mm, 0.5 mm)  angle:8 (-90..90 deg, 1 deg)
 *                elevator present:1, then depth:8 (0..80 mm, 0.5 mm)  from:8  to:8 (0..1 in 1/128)
 *                                         angle:8 (-45..45 deg, 0.5 deg)
 *   extras       clips count:2, then per clip pos:10 (0..511.5 mm, 0.5 mm)
 *                coating:2  tape:2 (0..3)  gadget:2
 *   look         color:24  back same as front:1 (else backColor:24)  pattern:4  ink:24  sticker:4  trail:3
 *   name         byte length:5 (0..24), then that many UTF-8 bytes
 *   <zero padding to a byte boundary>  crc8:8
 *
 * Enums are indices into the tables below. recipe/sticker/trail store index + 1 and use 0 for "none / unknown",
 * so an id this build doesn't know decodes to null instead of failing. Append to a table only while the new index
 * still fits the field's width (tests check it); anything else needs a new format prefix.
 *
 * Numbers are snapped to the grids above (and clamped to their ranges): `quantizeDesign(d)` is exactly what
 * `decodeDesign(encodeDesign(d))` returns, apart from `id` and the timestamps, which a decoded design gets fresh.
 */
import { DEFAULT_LOOK, MAX_CLIPS, MAX_FOLDS, newDesignId } from './design';
import type { CoatingId, Design, FoldOp, GadgetId, PaperSizeId, PaperStockId, PatternId } from './design';

export const CODE_PREFIX = 'GLD1-';

// ---------------------------------------------------------------------------------------------------------------
// Enum tables
// ---------------------------------------------------------------------------------------------------------------

export const SIZES = ['a4', 'letter', 'square', 'a5', 'legal', 'a3'] as const satisfies readonly PaperSizeId[];
export const STOCKS = ['tissue', 'newsprint', 'origami', 'printer', 'cardstock'] as const satisfies readonly PaperStockId[];
export const COATINGS = ['none', 'wax', 'foil'] as const satisfies readonly CoatingId[];
export const GADGETS = ['none', 'battery', 'bands', 'helium'] as const satisfies readonly GadgetId[];
export const PATTERNS = [
  'plain',
  'lined',
  'graph',
  'newspaper',
  'kraft',
  'stars',
  'waves',
  'chevron',
  'dots',
  'camo',
  'blueprint',
  'flames',
] as const satisfies readonly PatternId[];
export const STICKERS = ['star', 'heart', 'bolt', 'smile', 'skull', 'flower', 'moon', 'eye'] as const;
export const TRAILS = ['dots', 'sparkle', 'rainbow', 'smoke', 'hearts', 'confetti'] as const;
export const RECIPES = ['dart', 'glider', 'nakamura', 'delta', 'hammerhead', 'square'] as const;

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** Compile-time guard: stops type-checking if design.ts gains an enum member the tables above don't list. */
export type EnumTablesAreComplete = [
  Assert<Same<(typeof SIZES)[number], PaperSizeId>>,
  Assert<Same<(typeof STOCKS)[number], PaperStockId>>,
  Assert<Same<(typeof COATINGS)[number], CoatingId>>,
  Assert<Same<(typeof GADGETS)[number], GadgetId>>,
  Assert<Same<(typeof PATTERNS)[number], PatternId>>,
];

/** Field widths in bits. The tables must fit (nullable ones need one extra code for "none"). */
export const ENUM_BITS = { size: 3, stock: 3, coating: 2, gadget: 2, pattern: 4, recipe: 3, sticker: 4, trail: 3 } as const;
const FOLD_COUNT_BITS = 4;
const CLIP_COUNT_BITS = 2;
const TAPE_BITS = 2;
const NAME_LENGTH_BITS = 5;
/** Hard limits of the count fields, whatever design.ts allows. */
const FOLD_LIMIT = Math.min(MAX_FOLDS, 2 ** FOLD_COUNT_BITS - 1);
const CLIP_LIMIT = Math.min(MAX_CLIPS, 2 ** CLIP_COUNT_BITS - 1);
const TAPE_MAX = 2 ** TAPE_BITS - 1;
export const NAME_MAX_BYTES = 24;

/** Longest body (after the prefix) any valid code can have is ~210 characters; refuse anything absurd early. */
const MAX_BODY_CHARS = 320;
const MAX_INPUT_CHARS = 2048;

// ---------------------------------------------------------------------------------------------------------------
// Quantisation grids
// ---------------------------------------------------------------------------------------------------------------

interface Quant {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly bits: number;
  /** Highest level: (max - min) / step. */
  readonly top: number;
}

function quant(min: number, max: number, step: number, bits: number): Quant {
  const top = Math.round((max - min) / step);
  if (top >= 2 ** bits) throw new Error('codec: quantiser does not fit its bit width');
  return { min, max, step, bits, top };
}

/** Fold line endpoints and flap points. */
const COORD = quant(-150, 600, 0.5, 11);
/** Wing keel depths and the winglet fold position (distance from the centre line). */
const HALF_SPAN = quant(0, 255.5, 0.5, 9);
const CLIP_POS = quant(0, 511.5, 0.5, 10);
const DIHEDRAL = quant(-45, 60, 0.5, 8);
const WINGLET_ANGLE = quant(-90, 90, 1, 8);
const ELEVATOR_DEPTH = quant(0, 80, 0.5, 8);
const ELEVATOR_SPAN = quant(0, 1, 1 / 128, 8);
const ELEVATOR_ANGLE = quant(-45, 45, 0.5, 8);

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/** Nearest grid level of `value`, clamped to the range. NaN counts as 0. */
function levelOf(q: Quant, value: unknown): number {
  const v = num(value);
  const clamped = Number.isNaN(v) ? 0 : Math.min(q.max, Math.max(q.min, v));
  return Math.round((clamped - q.min) / q.step);
}

/** The value of a level (clamped to the top level, which only matters for hand-made codes). */
function valueOfLevel(q: Quant, level: number): number {
  return q.min + Math.min(level, q.top) * q.step;
}

function snap(q: Quant, value: unknown): number {
  return valueOfLevel(q, levelOf(q, value));
}

function clampInt(value: unknown, min: number, max: number): number {
  const v = Math.round(num(value));
  return Number.isNaN(v) ? min : Math.min(max, Math.max(min, v));
}

// ---------------------------------------------------------------------------------------------------------------
// Names and colours
// ---------------------------------------------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/** C0 and C1 control characters (including line breaks and tabs) have no place in a one-line name. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** UTF-8 bytes of the name: control characters removed, cut to NAME_MAX_BYTES at a character boundary. */
function nameBytes(name: unknown): Uint8Array {
  const text = typeof name === 'string' ? name.replace(CONTROL_CHARS, '') : '';
  const bytes: number[] = [];
  for (const char of text) {
    const encoded = textEncoder.encode(char); // lone surrogates become U+FFFD, so the result is always valid UTF-8
    if (bytes.length + encoded.length > NAME_MAX_BYTES) break;
    for (const byte of encoded) bytes.push(byte);
  }
  return Uint8Array.from(bytes);
}

function normalizeName(name: unknown): string {
  return textDecoder.decode(nameBytes(name));
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** `#rgb` / `#rrggbb` -> 0xRRGGBB, or null. */
function parseColor(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = HEX_COLOR.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return parseInt(hex, 16);
}

function colorString(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

const DEFAULT_COLOR = parseColor(DEFAULT_LOOK.color) ?? 0xf4efe2;
const DEFAULT_INK = parseColor(DEFAULT_LOOK.ink) ?? 0x7a8bb0;

// ---------------------------------------------------------------------------------------------------------------
// Enum helpers
// ---------------------------------------------------------------------------------------------------------------

function enumValue<T extends string>(table: readonly T[], value: unknown, fallback: T): T {
  return table.includes(value as T) ? (value as T) : fallback;
}

/** `value` if the table lists it, else null. */
function nullableValue<T extends string>(table: readonly T[], value: unknown): T | null {
  return table.includes(value as T) ? (value as T) : null;
}

/** 0 = none / unknown, otherwise index + 1. */
function nullableCode(table: readonly string[], value: string | null): number {
  return value === null ? 0 : table.indexOf(value) + 1;
}

/** Inverse of nullableCode. Codes past the table (written by a newer build) also read as none. */
function nullableFromCode<T extends string>(table: readonly T[], code: number): T | null {
  return code === 0 ? null : (table[code - 1] ?? null);
}

// ---------------------------------------------------------------------------------------------------------------
// Quantise
// ---------------------------------------------------------------------------------------------------------------

function quantizeFold(fold: FoldOp): FoldOp {
  return {
    a: { x: snap(COORD, fold?.a?.x), y: snap(COORD, fold?.a?.y) },
    b: { x: snap(COORD, fold?.b?.x), y: snap(COORD, fold?.b?.y) },
    side: fold?.side === -1 ? -1 : 1,
    mountain: !!fold?.mountain,
    flap: fold?.flap ? { x: snap(COORD, fold.flap.x), y: snap(COORD, fold.flap.y) } : null,
  };
}

/**
 * The part of `design` that survives a share code: numbers snapped to the code's grids and clamped to its ranges,
 * enums validated (unknown ids fall back to a default, or to null for recipe / sticker / trail), the name cleaned
 * and cut to 24 UTF-8 bytes, colours normalised to lowercase `#rrggbb`, at most MAX_FOLDS folds and MAX_CLIPS clips.
 * `id`, `createdAt` and `updatedAt` are passed through untouched. Idempotent.
 */
export function quantizeDesign(design: Design): Design {
  const winglet = design.shape?.winglet;
  const elevator = design.shape?.elevator;
  const color = parseColor(design.look?.color) ?? DEFAULT_COLOR;
  const backColor = parseColor(design.look?.backColor) ?? color;
  return {
    v: 1,
    id: design.id,
    name: normalizeName(design.name),
    recipe: nullableValue(RECIPES, design.recipe),
    createdAt: design.createdAt,
    updatedAt: design.updatedAt,
    paper: {
      size: enumValue(SIZES, design.paper?.size, 'a4'),
      landscape: !!design.paper?.landscape,
      stock: enumValue(STOCKS, design.paper?.stock, 'printer'),
    },
    folds: (Array.isArray(design.folds) ? design.folds : []).slice(0, FOLD_LIMIT).map(quantizeFold),
    flapsOutside: !!design.flapsOutside,
    wing: { d0: snap(HALF_SPAN, design.wing?.d0), d1: snap(HALF_SPAN, design.wing?.d1) },
    shape: {
      dihedral: snap(DIHEDRAL, design.shape?.dihedral),
      winglet: winglet ? { x: snap(HALF_SPAN, winglet.x), angle: snap(WINGLET_ANGLE, winglet.angle) } : null,
      elevator: elevator
        ? {
            depth: snap(ELEVATOR_DEPTH, elevator.depth),
            from: snap(ELEVATOR_SPAN, elevator.from),
            to: snap(ELEVATOR_SPAN, elevator.to),
            angle: snap(ELEVATOR_ANGLE, elevator.angle),
          }
        : null,
    },
    extras: {
      clips: (Array.isArray(design.extras?.clips) ? design.extras.clips : []).slice(0, CLIP_LIMIT).map((pos) => snap(CLIP_POS, pos)),
      coating: enumValue(COATINGS, design.extras?.coating, 'none'),
      tape: clampInt(design.extras?.tape, 0, TAPE_MAX),
      gadget: enumValue(GADGETS, design.extras?.gadget, 'none'),
    },
    look: {
      color: colorString(color),
      backColor: colorString(backColor),
      pattern: enumValue(PATTERNS, design.look?.pattern, 'plain'),
      ink: colorString(parseColor(design.look?.ink) ?? DEFAULT_INK),
      sticker: nullableValue(STICKERS, design.look?.sticker),
      trail: nullableValue(TRAILS, design.look?.trail),
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bits, checksum, base64url
// ---------------------------------------------------------------------------------------------------------------

class BitWriter {
  private readonly bytes: number[] = [];
  private partial = 0;
  private used = 0;

  /** Appends the low `bits` bits of `value` (an integer, at most 24 bits wide), MSB first. */
  write(value: number, bits: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits) {
      throw new RangeError(`codec: ${value} does not fit in ${bits} bits`);
    }
    for (let i = bits - 1; i >= 0; i--) {
      this.partial = (this.partial << 1) | ((value >>> i) & 1);
      if (++this.used === 8) {
        this.bytes.push(this.partial);
        this.partial = 0;
        this.used = 0;
      }
    }
  }

  writeFlag(flag: boolean): void {
    this.write(flag ? 1 : 0, 1);
  }

  /** The bytes written so far; a trailing partial byte is padded with zero bits. */
  finish(): Uint8Array {
    const out = this.bytes.slice();
    if (this.used > 0) out.push((this.partial << (8 - this.used)) & 0xff);
    return Uint8Array.from(out);
  }
}

class BitReader {
  private position = 0;
  private readonly bytes: Uint8Array;
  private readonly limit: number;

  constructor(bytes: Uint8Array, bitLength: number) {
    this.bytes = bytes;
    this.limit = bitLength;
  }

  read(bits: number): number {
    if (this.position + bits > this.limit) throw new Error('codec: truncated');
    let value = 0;
    for (let i = 0; i < bits; i++) {
      const bit = (this.bytes[this.position >> 3] >> (7 - (this.position & 7))) & 1;
      value = value * 2 + bit;
      this.position++;
    }
    return value;
  }

  readFlag(): boolean {
    return this.read(1) === 1;
  }

  get remaining(): number {
    return this.limit - this.position;
  }
}

/** CRC-8 (polynomial 0x07, seeded with 0xff so an all-zero payload doesn't check out). Catches any burst up to 8 bits. */
function crc8(bytes: Uint8Array, length: number): number {
  let crc = 0xff;
  for (let i = 0; i < length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE64URL.length; i++) table[BASE64URL.charCodeAt(i)] = i;
  return table;
})();

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += BASE64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += BASE64URL[n & 63];
  }
  return out;
}

/** Strict decoder: URL-safe alphabet only, no padding, and the unused trailing bits must be zero. */
function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? BASE64URL_LOOKUP[code] : -1;
    if (value < 0) return null;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return acc === 0 ? out : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------------------------------------------

/** Encodes a design as `GLD1-...`. Values are quantised first (see `quantizeDesign`), so this never fails on odd input. */
export function encodeDesign(design: Design): string {
  const d = quantizeDesign(design);
  const w = new BitWriter();

  w.write(SIZES.indexOf(d.paper.size), ENUM_BITS.size);
  w.writeFlag(d.paper.landscape);
  w.write(STOCKS.indexOf(d.paper.stock), ENUM_BITS.stock);
  w.write(nullableCode(RECIPES, d.recipe), ENUM_BITS.recipe);
  w.writeFlag(d.flapsOutside);

  w.write(d.folds.length, FOLD_COUNT_BITS);
  for (const fold of d.folds) {
    for (const value of [fold.a.x, fold.a.y, fold.b.x, fold.b.y]) w.write(levelOf(COORD, value), COORD.bits);
    w.writeFlag(fold.side === 1);
    w.writeFlag(fold.mountain);
    w.writeFlag(fold.flap !== null);
    if (fold.flap) {
      w.write(levelOf(COORD, fold.flap.x), COORD.bits);
      w.write(levelOf(COORD, fold.flap.y), COORD.bits);
    }
  }

  w.write(levelOf(HALF_SPAN, d.wing.d0), HALF_SPAN.bits);
  w.write(levelOf(HALF_SPAN, d.wing.d1), HALF_SPAN.bits);

  w.write(levelOf(DIHEDRAL, d.shape.dihedral), DIHEDRAL.bits);
  w.writeFlag(d.shape.winglet !== null);
  if (d.shape.winglet) {
    w.write(levelOf(HALF_SPAN, d.shape.winglet.x), HALF_SPAN.bits);
    w.write(levelOf(WINGLET_ANGLE, d.shape.winglet.angle), WINGLET_ANGLE.bits);
  }
  w.writeFlag(d.shape.elevator !== null);
  if (d.shape.elevator) {
    w.write(levelOf(ELEVATOR_DEPTH, d.shape.elevator.depth), ELEVATOR_DEPTH.bits);
    w.write(levelOf(ELEVATOR_SPAN, d.shape.elevator.from), ELEVATOR_SPAN.bits);
    w.write(levelOf(ELEVATOR_SPAN, d.shape.elevator.to), ELEVATOR_SPAN.bits);
    w.write(levelOf(ELEVATOR_ANGLE, d.shape.elevator.angle), ELEVATOR_ANGLE.bits);
  }

  w.write(d.extras.clips.length, CLIP_COUNT_BITS);
  for (const pos of d.extras.clips) w.write(levelOf(CLIP_POS, pos), CLIP_POS.bits);
  w.write(COATINGS.indexOf(d.extras.coating), ENUM_BITS.coating);
  w.write(d.extras.tape, TAPE_BITS);
  w.write(GADGETS.indexOf(d.extras.gadget), ENUM_BITS.gadget);

  const color = parseColor(d.look.color) ?? DEFAULT_COLOR;
  const backColor = parseColor(d.look.backColor) ?? color;
  w.write(color, 24);
  w.writeFlag(backColor === color);
  if (backColor !== color) w.write(backColor, 24);
  w.write(PATTERNS.indexOf(d.look.pattern), ENUM_BITS.pattern);
  w.write(parseColor(d.look.ink) ?? DEFAULT_INK, 24);
  w.write(nullableCode(STICKERS, d.look.sticker), ENUM_BITS.sticker);
  w.write(nullableCode(TRAILS, d.look.trail), ENUM_BITS.trail);

  const name = nameBytes(d.name);
  w.write(name.length, NAME_LENGTH_BITS);
  for (const byte of name) w.write(byte, 8);

  const payload = w.finish();
  const bytes = new Uint8Array(payload.length + 1);
  bytes.set(payload);
  bytes[payload.length] = crc8(payload, payload.length);
  return CODE_PREFIX + toBase64Url(bytes);
}

// ---------------------------------------------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------------------------------------------

function pick<T extends string>(table: readonly T[], index: number): T {
  const value = table[index];
  if (value === undefined) throw new Error('codec: unknown enum index');
  return value;
}

function readLevel(r: BitReader, q: Quant): number {
  return valueOfLevel(q, r.read(q.bits));
}

function decodeUnchecked(code: string): Design {
  const compact = code.replace(/\s+/g, '');
  if (!compact.startsWith(CODE_PREFIX)) throw new Error('codec: missing prefix');
  const body = compact.slice(CODE_PREFIX.length);
  if (body.length === 0 || body.length > MAX_BODY_CHARS) throw new Error('codec: bad length');
  const bytes = fromBase64Url(body);
  if (!bytes || bytes.length < 2) throw new Error('codec: not base64url');
  const payloadLength = bytes.length - 1;
  if (crc8(bytes, payloadLength) !== bytes[payloadLength]) throw new Error('codec: checksum mismatch');

  const r = new BitReader(bytes, payloadLength * 8);
  const size = pick(SIZES, r.read(ENUM_BITS.size));
  const landscape = r.readFlag();
  const stock = pick(STOCKS, r.read(ENUM_BITS.stock));
  const recipe = nullableFromCode(RECIPES, r.read(ENUM_BITS.recipe));
  const flapsOutside = r.readFlag();

  const foldCount = r.read(FOLD_COUNT_BITS);
  if (foldCount > FOLD_LIMIT) throw new Error('codec: too many folds');
  const folds: FoldOp[] = [];
  for (let i = 0; i < foldCount; i++) {
    const a = { x: readLevel(r, COORD), y: readLevel(r, COORD) };
    const b = { x: readLevel(r, COORD), y: readLevel(r, COORD) };
    const side = r.readFlag() ? 1 : -1;
    const mountain = r.readFlag();
    const flap = r.readFlag() ? { x: readLevel(r, COORD), y: readLevel(r, COORD) } : null;
    folds.push({ a, b, side, mountain, flap });
  }

  const wing = { d0: readLevel(r, HALF_SPAN), d1: readLevel(r, HALF_SPAN) };

  const dihedral = readLevel(r, DIHEDRAL);
  const winglet = r.readFlag() ? { x: readLevel(r, HALF_SPAN), angle: readLevel(r, WINGLET_ANGLE) } : null;
  const elevator = r.readFlag()
    ? {
        depth: readLevel(r, ELEVATOR_DEPTH),
        from: readLevel(r, ELEVATOR_SPAN),
        to: readLevel(r, ELEVATOR_SPAN),
        angle: readLevel(r, ELEVATOR_ANGLE),
      }
    : null;

  const clipCount = r.read(CLIP_COUNT_BITS);
  if (clipCount > CLIP_LIMIT) throw new Error('codec: too many clips');
  const clips: number[] = [];
  for (let i = 0; i < clipCount; i++) clips.push(readLevel(r, CLIP_POS));
  const coating = pick(COATINGS, r.read(ENUM_BITS.coating));
  const tape = r.read(TAPE_BITS);
  const gadget = pick(GADGETS, r.read(ENUM_BITS.gadget));

  const color = r.read(24);
  const backColor = r.readFlag() ? color : r.read(24);
  const pattern = pick(PATTERNS, r.read(ENUM_BITS.pattern));
  const ink = r.read(24);
  const sticker = nullableFromCode(STICKERS, r.read(ENUM_BITS.sticker));
  const trail = nullableFromCode(TRAILS, r.read(ENUM_BITS.trail));

  const nameLength = r.read(NAME_LENGTH_BITS);
  if (nameLength > NAME_MAX_BYTES) throw new Error('codec: name too long');
  const name = new Uint8Array(nameLength);
  for (let i = 0; i < nameLength; i++) name[i] = r.read(8);

  // Only zero padding may follow, and less than a byte of it.
  if (r.remaining >= 8 || r.read(r.remaining) !== 0) throw new Error('codec: trailing data');

  const now = Date.now();
  return {
    v: 1,
    id: newDesignId(),
    name: normalizeName(textDecoder.decode(name)),
    recipe,
    createdAt: now,
    updatedAt: now,
    paper: { size, landscape, stock },
    folds,
    flapsOutside,
    wing,
    shape: { dihedral, winglet, elevator },
    extras: { clips, coating, tape, gadget },
    look: {
      color: colorString(color),
      backColor: colorString(backColor),
      pattern,
      ink: colorString(ink),
      sticker,
      trail,
    },
  };
}

/**
 * Decodes a `GLD1-...` code (surrounding or embedded whitespace is ignored). Returns a new design with a fresh
 * `id` and timestamps, or null for anything malformed: wrong prefix, bad characters or length, checksum mismatch,
 * unknown enum values, impossible counts, invalid UTF-8, or leftover data.
 */
export function decodeDesign(code: string): Design | null {
  if (typeof code !== 'string' || code.length > MAX_INPUT_CHARS) return null;
  try {
    return decodeUnchecked(code);
  } catch {
    return null;
  }
}
