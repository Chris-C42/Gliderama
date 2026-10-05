/**
 * Song notation: a compact, hand-writable text format for chiptune songs.
 *
 * This module is PURE (no WebAudio, no DOM): it parses and validates a `SongDef` and compiles it to a
 * flat, time-ordered list of note events whose start times / durations are in seconds. The player
 * (`music.ts`) only has to walk that list. See `README.md` for the format with examples.
 *
 * Quick reference (one token per step, tokens separated by spaces; `|` is a decorative bar line):
 *
 *   pitched track   C4  C#4  Db4  -  .   + suffixes  !  ~  ^  v  >
 *   drum track      k  s  h  kh  k!  -  .
 */

import type { Envelope, FilterDef, VibratoDef, WaveName } from './types';
import { WAVE_NAMES } from './types';

// ------------------------------------------------------------------------------------------------
// Note math
// ------------------------------------------------------------------------------------------------

const SEMITONE_OF_LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const A4_FREQ = 440;
export const A4_MIDI = 69;
export const MIDI_MIN = 0;
export const MIDI_MAX = 127;

/** Frequency in Hz of a (possibly fractional) MIDI note number. A4 (69) = 440 Hz. */
export function midiToFreq(midi: number): number {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * Parses a note name (`C4`, `C#4`, `Db4`, `a3` ...; octaves 0-8; C4 = middle C = MIDI 60) to a MIDI
 * number, or returns null when the text is not a note name.
 */
export function parseNote(name: string): number | null {
  const m = /^([A-Ga-g])(#|b)?([0-8])$/.exec(name);
  if (!m) return null;
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + SEMITONE_OF_LETTER[m[1]!.toUpperCase()]! + accidental;
}

/** Like `parseNote` but throws on an invalid name. */
export function noteToMidi(name: string): number {
  const midi = parseNote(name);
  if (midi === null) throw new Error(`"${name}" is not a note name (expected e.g. C4, C#4, Db4; octaves 0-8)`);
  return midi;
}

/** Frequency in Hz of a note name. `noteToFreq('A4') === 440`. */
export function noteToFreq(name: string): number {
  return midiToFreq(noteToMidi(name));
}

/** Name (with sharps) of an integer MIDI note, e.g. 61 -> "C#4". */
export function midiToName(midi: number): string {
  const m = Math.round(midi);
  return `${SHARP_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** Seconds per step. */
export function stepDurationOf(bpm: number, stepsPerBeat: number): number {
  return 60 / (bpm * stepsPerBeat);
}

// ------------------------------------------------------------------------------------------------
// Authoring types (what you write)
// ------------------------------------------------------------------------------------------------

export interface InstrumentDef {
  wave: WaveName;
  /** ADSR (seconds / level). Missing fields default to `{ a: 0, d: 0, s: 1, r: 0.02 }`. */
  env?: Partial<Envelope>;
  /** Loudness 0..1 (default 1). All waves are level-matched, so this is a pure mixing control. */
  vol?: number;
  /**
   * Vibrato. By default every note of the instrument gets it (fading in after `delay`). Set
   * `auto: false` to only vibrato the notes marked with `~`.
   */
  vibrato?: VibratoDef & { auto?: boolean };
  /** Pitch sweep at the start of every note: semitones relative to the note, `from` -> `to` in `time` s. */
  pitchEnv?: { from: number; to: number; time: number };
  /** Chord offsets in semitones, cycled every `arpSpeed` seconds (chiptune chords), e.g. `[0, 4, 7]`. */
  arp?: number[];
  /** Seconds per arpeggio step (default 0.03). */
  arpSpeed?: number;
  /** Noise waves: playback-rate multiplier (1 = native clock, 0.2 = dark, 4 = hissy / high metallic). */
  noiseRate?: number;
  /**
   * Base pitch (note name or MIDI number) used when the instrument is triggered from a drum track,
   * and the reference for `pitchEnv`. Default `C2` for tonal waves (noise waves ignore it: they
   * run at `noiseRate`).
   */
  pitch?: string | number;
  /** Seconds a `>` glide takes (default 0.07). */
  glide?: number;
  /** Seconds a `^` / `v` slide takes (default 0.05). */
  slide?: number;
  /** Stereo position -1..1 (default 0). */
  pan?: number;
  /** Optional biquad filter (not chip-authentic, but handy to tame noise drums). */
  filter?: FilterDef;
}

export interface OrderEntry {
  /** Pattern name. */
  p: string;
  /** Semitones to transpose pitched tracks (drums are unaffected); a number, or per-track `{ melody: 5, low: 7 }`. */
  transpose?: number | Record<string, number>;
  /** Play the pattern this many times in a row (default 1). */
  times?: number;
}

export interface SongDef {
  title?: string;
  bpm: number;
  /** Steps per beat (default 4 = sixteenth notes when a beat is a quarter note). */
  stepsPerBeat?: number;
  /** Loop forever (default true). */
  loop?: boolean;
  /** Index into `order` that the loop jumps back to, for an intro that only plays once (default 0). */
  loopStart?: number;
  /** Overall song volume multiplier (default 1). */
  volume?: number;
  instruments: Record<string, InstrumentDef>;
  /**
   * `name: 'instrument'` makes a pitched track; `name: { k: 'kick', s: 'snare' }` makes a drum
   * track mapping one-letter tokens to instruments.
   */
  tracks: Record<string, string | Record<string, string>>;
  /** Per pattern, per track: a string of space-separated step tokens (or an array of strings to join). */
  patterns: Record<string, Record<string, string | readonly string[]>>;
  /** Pattern play order: names, or `{ p, transpose?, times? }`. */
  order: ReadonlyArray<string | OrderEntry>;
}

// ------------------------------------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------------------------------------

export interface SongErrorWhere {
  pattern?: string;
  track?: string;
  /** 1-based step within the pattern. */
  step?: number;
  /** Index into `order`. */
  order?: number;
}

/** Thrown for any problem in a song definition. The message names the pattern / track / step. */
export class SongError extends Error {
  readonly where: SongErrorWhere;
  constructor(message: string, where: SongErrorWhere = {}) {
    super(message);
    this.name = 'SongError';
    this.where = where;
  }
}

function whereText(w: SongErrorWhere, extra = ''): string {
  const parts: string[] = [];
  if (w.pattern !== undefined) parts.push(`Pattern "${w.pattern}"`);
  if (w.order !== undefined) parts.push(`order[${w.order}]`);
  if (w.track !== undefined) parts.push(`track "${w.track}"`);
  if (w.step !== undefined) parts.push(`step ${w.step}${extra}`);
  return parts.join(', ');
}

// ------------------------------------------------------------------------------------------------
// Tokenising and parsing one step
// ------------------------------------------------------------------------------------------------

export interface RawToken {
  text: string;
  /** 0-based step index within the pattern. */
  step: number;
  /** 1-based bar number (counted from `|` separators). */
  bar: number;
  /** 1-based step within the bar. */
  barStep: number;
}

/** Splits a pattern string (or array of strings) into step tokens; `|` bar lines are ignored but counted. */
export function tokenize(src: string | readonly string[]): { tokens: RawToken[]; hasBars: boolean } {
  const text = typeof src === 'string' ? src : src.join(' ');
  const tokens: RawToken[] = [];
  let bar = 1;
  let barStep = 0;
  let hasBars = false;
  for (const m of text.matchAll(/\||[^\s|]+/g)) {
    if (m[0] === '|') {
      hasBars = true;
      if (barStep > 0) {
        bar++;
        barStep = 0;
      }
      continue;
    }
    barStep++;
    tokens.push({ text: m[0], step: tokens.length, bar, barStep });
  }
  return { tokens, hasBars };
}

export interface DrumHit {
  /** The drum letter. */
  key: string;
  accent: boolean;
}

export type StepToken =
  | { kind: 'rest' }
  | { kind: 'hold' }
  | {
      kind: 'note';
      /** MIDI note number as written (before transposition). */
      midi: number;
      /** `!` */
      accent: boolean;
      /** `~` */
      vibrato: boolean;
      /** Slide-in in semitones: -n for `^` (starts n below, slides up), +n for `v`, 0 for none. */
      slide: number;
      /** `>` */
      glide: boolean;
    }
  | { kind: 'drum'; hits: DrumHit[] };

const REST: StepToken = { kind: 'rest' };
const HOLD: StepToken = { kind: 'hold' };

/**
 * Parses one step token. With `drumKeys` it is read as a drum token, otherwise as a pitched token.
 * Throws a plain `Error` whose message does not include the location; `compileSong` adds that.
 */
export function parseStepToken(text: string, drumKeys?: readonly string[]): StepToken {
  if (text === '') throw new Error('empty token');
  if (text === '.') return REST;
  if (text === '-') return HOLD;
  return drumKeys ? parseDrumToken(text, drumKeys) : parseNoteToken(text);
}

function parseDrumToken(text: string, drumKeys: readonly string[]): StepToken {
  const hits: DrumHit[] = [];
  for (const ch of text) {
    if (ch === '!') {
      const last = hits[hits.length - 1];
      if (!last) throw new Error(`unknown drum token "${text}": "!" (accent) must follow a drum letter`);
      if (last.accent) throw new Error(`"${text}": duplicate "!" after "${last.key}"`);
      last.accent = true;
    } else if (drumKeys.includes(ch)) {
      if (hits.some((h) => h.key === ch)) throw new Error(`"${text}": drum "${ch}" appears twice in one step`);
      hits.push({ key: ch, accent: false });
    } else {
      const hint = /^[A-Ga-g][#b]?\d/.test(text) ? ' (that looks like a note: notes belong in a pitched track)' : '';
      throw new Error(
        `unknown drum "${ch}" in token "${text}"${hint}; this drum track defines: ${drumKeys.join(', ')} (use "." for a rest)`,
      );
    }
  }
  return { kind: 'drum', hits };
}

function parseNoteToken(text: string): StepToken {
  const letter = text[0]!;
  if (!/[A-Ga-g]/.test(letter)) {
    const hint = /^[a-z]$/.test(text) ? ' (single letters are drum tokens: use a drum track)' : '';
    throw new Error(
      `unknown token "${text}"${hint}; expected a note (C4, C#4, Db4 ... octaves 0-8), "-" (hold) or "." (rest)`,
    );
  }
  let i = 1;
  if (text[i] === '#' || text[i] === 'b') i++;
  const octave = text[i];
  if (octave === undefined || !/\d/.test(octave)) {
    throw new Error(`note "${text}" needs an octave number 0-8, e.g. ${letter.toUpperCase()}4`);
  }
  if (Number(octave) > 8 || /\d/.test(text[i + 1] ?? '')) {
    throw new Error(`octave out of range in "${text}": octaves go from 0 to 8`);
  }
  const midi = parseNote(text.slice(0, i + 1));
  if (midi === null) throw new Error(`unknown token "${text}"`);

  let accent = false;
  let vibrato = false;
  let glide = false;
  let up = 0;
  let down = 0;
  for (const ch of text.slice(i + 1)) {
    switch (ch) {
      case '!':
        if (accent) throw new Error(`duplicate "!" in "${text}"`);
        accent = true;
        break;
      case '~':
        if (vibrato) throw new Error(`duplicate "~" in "${text}"`);
        vibrato = true;
        break;
      case '>':
        if (glide) throw new Error(`duplicate ">" in "${text}"`);
        glide = true;
        break;
      case '^':
        up++;
        break;
      case 'v':
        down++;
        break;
      default:
        throw new Error(`unknown suffix "${ch}" in "${text}"; suffixes are ! (accent) ~ (vibrato) ^ v (slide) > (glide)`);
    }
  }
  if (up > 0 && down > 0) throw new Error(`"${text}": cannot slide both up (^) and down (v)`);
  if (up > 12 || down > 12) throw new Error(`"${text}": a slide can be at most 12 semitones`);
  if (glide && (up > 0 || down > 0)) throw new Error(`"${text}": a note cannot both slide (^ v) and glide (>)`);
  if (glide && accent) {
    throw new Error(`"${text}": "!" cannot be combined with ">" (a glided note continues the previous note's envelope)`);
  }
  return { kind: 'note', midi, accent, vibrato, slide: up > 0 ? -up : down, glide };
}

// ------------------------------------------------------------------------------------------------
// Compiled types (what the player consumes)
// ------------------------------------------------------------------------------------------------

/** A resolved instrument (all defaults applied). */
export interface Instrument {
  name: string;
  wave: WaveName;
  env: Envelope;
  vol: number;
  vibrato: { depth: number; rate: number; delay: number; auto: boolean } | null;
  pitchEnv: { from: number; to: number; time: number } | null;
  arp: readonly number[] | null;
  arpSpeed: number;
  noiseRate: number;
  /** MIDI note number used by drum tracks / as the pitchEnv reference. */
  basePitch: number;
  glide: number;
  slide: number;
  pan: number;
  filter: FilterDef | null;
}

/** A portamento move inside a note (the `>` suffix merges the glided note into the previous one). */
export interface Glide {
  /** Seconds from the start of the event. */
  at: number;
  /** Target MIDI note (absolute, transposition applied). */
  midi: number;
  /** Seconds the move takes (already capped to fit before the next glide / the note's end). */
  time: number;
}

export interface NoteEvent {
  track: string;
  instrument: string;
  /** `track:instrument`. A new event in the same slot cuts the previous one (monophonic channel). */
  slot: string;
  /** Start time in seconds from the start of the song. */
  start: number;
  /** Gate length in seconds (key down -> key up). The release tail rings after it. */
  duration: number;
  /** 0-based index of the first step in the whole song. */
  step: number;
  /** Length in steps. */
  steps: number;
  /** MIDI note the event starts on (transposition applied; fractional allowed). */
  midi: number;
  /** Frequency of `midi` in Hz. */
  freq: number;
  /** Volume multiplier: 1, or 1.3 for accented (`!`) notes. */
  velocity: number;
  /** Seconds into the note at which a `~`-forced vibrato (no delay) begins, or null. */
  forcedVibratoAt: number | null;
  /** `^`/`v` slide-in: semitone offset the note starts at (negative = below), reaching the pitch after `slideTime`. */
  slideFrom: number;
  slideTime: number;
  /** `>` glides merged into this event. */
  glides: Glide[];
  /** true for drum-track hits. */
  drum: boolean;
}

export interface Section {
  /** Index into `SongDef.order`. */
  order: number;
  pattern: string;
  /** Normalised transposition per pitched track (tracks not listed are 0). */
  transpose: Record<string, number>;
  startStep: number;
  steps: number;
  /** Start time in seconds. */
  start: number;
}

export interface CompiledSong {
  def: SongDef;
  title: string;
  bpm: number;
  stepsPerBeat: number;
  /** Seconds per step. */
  stepDuration: number;
  loop: boolean;
  /** Overall song volume multiplier. */
  volume: number;
  /** Steps / seconds in one pass through the order. */
  totalSteps: number;
  duration: number;
  /** Time in the pass where a loop jumps back to (0 unless `loopStart` is set). */
  loopStart: number;
  /** Seconds of each repeat after the first pass: `duration - loopStart`. */
  loopLength: number;
  instruments: Record<string, Instrument>;
  trackKinds: Record<string, 'pitched' | 'drum'>;
  sections: Section[];
  /** All note events of one pass, sorted by start time (ties in track order). */
  events: NoteEvent[];
}

// ------------------------------------------------------------------------------------------------
// Validation helpers
// ------------------------------------------------------------------------------------------------

interface NumOpts {
  min?: number;
  max?: number;
  /** Strictly greater than. */
  gt?: number;
  int?: boolean;
}

function checkNum(value: unknown, label: string, o: NumOpts = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SongError(`${label} must be a finite number (got ${String(value)})`);
  }
  if (o.int && !Number.isInteger(value)) throw new SongError(`${label} must be an integer (got ${value})`);
  if (o.min !== undefined && value < o.min) throw new SongError(`${label} must be >= ${o.min} (got ${value})`);
  if (o.max !== undefined && value > o.max) throw new SongError(`${label} must be <= ${o.max} (got ${value})`);
  if (o.gt !== undefined && !(value > o.gt)) throw new SongError(`${label} must be > ${o.gt} (got ${value})`);
  return value;
}

export const DEFAULT_ENVELOPE: Readonly<Envelope> = { a: 0, d: 0, s: 1, r: 0.02 };
export const DEFAULT_ARP_SPEED = 0.03;
export const DEFAULT_GLIDE_TIME = 0.07;
export const DEFAULT_SLIDE_TIME = 0.05;
/** Used by `~` on an instrument that defines no vibrato. */
export const DEFAULT_FORCED_VIBRATO = { depth: 0.3, rate: 6 } as const;
export const ACCENT_GAIN = 1.3;
/** Default base pitch for tonal drum hits (C2 = 65.4 Hz). */
export const DEFAULT_DRUM_PITCH = 36;
/** Noise waves: a base pitch of C4 means a playback rate of exactly `noiseRate`. */
export const NOISE_REFERENCE_MIDI = 60;

function checkFilterType(type: unknown, at: string): FilterDef['type'] {
  if (type !== 'lowpass' && type !== 'highpass' && type !== 'bandpass') {
    throw new SongError(`${at}: filter.type must be lowpass, highpass or bandpass (got ${String(type)})`);
  }
  return type;
}

function resolveInstrument(name: string, d: InstrumentDef): Instrument {
  const at = `instrument "${name}"`;
  if (!d || typeof d !== 'object') throw new SongError(`${at} must be an object`);
  if (!WAVE_NAMES.includes(d.wave)) {
    throw new SongError(`${at}: unknown wave "${String(d.wave)}" (use ${WAVE_NAMES.join(', ')})`);
  }
  const env: Envelope = {
    a: d.env?.a ?? DEFAULT_ENVELOPE.a,
    d: d.env?.d ?? DEFAULT_ENVELOPE.d,
    s: d.env?.s ?? DEFAULT_ENVELOPE.s,
    r: d.env?.r ?? DEFAULT_ENVELOPE.r,
  };
  checkNum(env.a, `${at}: env.a`, { min: 0 });
  checkNum(env.d, `${at}: env.d`, { min: 0 });
  checkNum(env.s, `${at}: env.s`, { min: 0, max: 1 });
  checkNum(env.r, `${at}: env.r`, { min: 0 });

  let vibrato: Instrument['vibrato'] = null;
  if (d.vibrato) {
    vibrato = {
      depth: checkNum(d.vibrato.depth, `${at}: vibrato.depth`, { min: 0, max: 12 }),
      rate: checkNum(d.vibrato.rate, `${at}: vibrato.rate`, { gt: 0, max: 40 }),
      delay: d.vibrato.delay === undefined ? 0 : checkNum(d.vibrato.delay, `${at}: vibrato.delay`, { min: 0 }),
      auto: d.vibrato.auto !== false,
    };
  }

  let pitchEnv: Instrument['pitchEnv'] = null;
  if (d.pitchEnv) {
    pitchEnv = {
      from: checkNum(d.pitchEnv.from, `${at}: pitchEnv.from`),
      to: checkNum(d.pitchEnv.to, `${at}: pitchEnv.to`),
      time: checkNum(d.pitchEnv.time, `${at}: pitchEnv.time`, { gt: 0 }),
    };
  }

  let arp: number[] | null = null;
  if (d.arp !== undefined) {
    if (!Array.isArray(d.arp) || d.arp.length === 0) throw new SongError(`${at}: arp must be a non-empty array of semitone offsets`);
    arp = d.arp.map((v, i) => checkNum(v, `${at}: arp[${i}]`));
  }

  let basePitch = d.wave === 'noise' || d.wave === 'noise-short' ? NOISE_REFERENCE_MIDI : DEFAULT_DRUM_PITCH;
  if (d.pitch !== undefined) {
    if (typeof d.pitch === 'string') {
      const m = parseNote(d.pitch);
      if (m === null) throw new SongError(`${at}: pitch "${d.pitch}" is not a note name (e.g. C2)`);
      basePitch = m;
    } else {
      basePitch = checkNum(d.pitch, `${at}: pitch`, { min: MIDI_MIN, max: MIDI_MAX });
    }
  }

  return {
    name,
    wave: d.wave,
    env,
    vol: d.vol === undefined ? 1 : checkNum(d.vol, `${at}: vol`, { min: 0, max: 4 }),
    vibrato,
    pitchEnv,
    arp,
    arpSpeed: d.arpSpeed === undefined ? DEFAULT_ARP_SPEED : checkNum(d.arpSpeed, `${at}: arpSpeed`, { gt: 0 }),
    noiseRate: d.noiseRate === undefined ? 1 : checkNum(d.noiseRate, `${at}: noiseRate`, { gt: 0, max: 64 }),
    basePitch,
    glide: d.glide === undefined ? DEFAULT_GLIDE_TIME : checkNum(d.glide, `${at}: glide`, { min: 0 }),
    slide: d.slide === undefined ? DEFAULT_SLIDE_TIME : checkNum(d.slide, `${at}: slide`, { min: 0 }),
    pan: d.pan === undefined ? 0 : checkNum(d.pan, `${at}: pan`, { min: -1, max: 1 }),
    filter: d.filter
      ? {
          type: checkFilterType(d.filter.type, at),
          freq: checkNum(d.filter.freq, `${at}: filter.freq`, { gt: 0 }),
          q: d.filter.q === undefined ? undefined : checkNum(d.filter.q, `${at}: filter.q`, { gt: 0 }),
        }
      : null,
  };
}

type TrackInfo =
  | { name: string; kind: 'pitched'; instrument: string }
  | { name: string; kind: 'drum'; drums: Record<string, string>; keys: string[] };

function resolveTracks(tracks: SongDef['tracks'], instruments: Record<string, Instrument>): Map<string, TrackInfo> {
  const out = new Map<string, TrackInfo>();
  const known = Object.keys(instruments).join(', ');
  for (const [name, def] of Object.entries(tracks)) {
    if (typeof def === 'string') {
      if (!instruments[def]) {
        throw new SongError(`track "${name}" uses unknown instrument "${def}" (defined: ${known})`);
      }
      out.set(name, { name, kind: 'pitched', instrument: def });
    } else if (def && typeof def === 'object') {
      const keys = Object.keys(def);
      if (keys.length === 0) throw new SongError(`drum track "${name}" maps no drum letters`);
      for (const key of keys) {
        if (key.length !== 1 || /[\s.\-|!]/.test(key)) {
          throw new SongError(`drum track "${name}": drum key "${key}" must be a single character other than space . - | !`);
        }
        if (!instruments[def[key]!]) {
          throw new SongError(`drum track "${name}": drum "${key}" uses unknown instrument "${def[key]}" (defined: ${known})`);
        }
      }
      out.set(name, { name, kind: 'drum', drums: { ...def }, keys });
    } else {
      throw new SongError(`track "${name}" must be an instrument name or a { letter: instrument } drum map`);
    }
  }
  return out;
}

interface ParsedPattern {
  name: string;
  steps: number;
  tracks: Map<string, StepToken[]>;
}

function parsePattern(name: string, def: Record<string, string | readonly string[]>, tracks: Map<string, TrackInfo>): ParsedPattern {
  if (!def || typeof def !== 'object') throw new SongError(`Pattern "${name}" must be an object of track strings`);
  const parsed = new Map<string, StepToken[]>();
  for (const [trackName, src] of Object.entries(def)) {
    const info = tracks.get(trackName);
    if (!info) {
      throw new SongError(
        `Pattern "${name}": unknown track "${trackName}" (tracks: ${[...tracks.keys()].join(', ')})`,
        { pattern: name, track: trackName },
      );
    }
    if (typeof src !== 'string' && !Array.isArray(src)) {
      throw new SongError(`Pattern "${name}", track "${trackName}": expected a string (or array of strings) of step tokens`, {
        pattern: name,
        track: trackName,
      });
    }
    const { tokens, hasBars } = tokenize(src);
    const keys = info.kind === 'drum' ? info.keys : undefined;
    parsed.set(
      trackName,
      tokens.map((raw) => {
        try {
          return parseStepToken(raw.text, keys);
        } catch (e) {
          const where: SongErrorWhere = { pattern: name, track: trackName, step: raw.step + 1 };
          const extra = hasBars ? ` (bar ${raw.bar}, step ${raw.barStep})` : '';
          throw new SongError(`${whereText(where, extra)}: ${(e as Error).message}`, where);
        }
      }),
    );
  }
  if (parsed.size === 0) throw new SongError(`Pattern "${name}" has no tracks`, { pattern: name });

  const counts = [...parsed.entries()].map(([t, toks]) => [t, toks.length] as const);
  const first = counts[0]!;
  if (first[1] === 0) {
    throw new SongError(`Pattern "${name}": track "${first[0]}" has no steps`, { pattern: name, track: first[0] });
  }
  const odd = counts.find(([, n]) => n !== first[1]);
  if (odd) {
    const summary = counts.map(([t, n]) => `${t}=${n}`).join(', ');
    throw new SongError(
      `Pattern "${name}": all tracks must have the same number of steps, but found ${summary} ` +
        `(track "${odd[0]}" has ${odd[1]} but track "${first[0]}" has ${first[1]})`,
      { pattern: name, track: odd[0] },
    );
  }
  return { name, steps: first[1], tracks: parsed };
}

function expandOrder(
  order: SongDef['order'],
  patterns: Map<string, ParsedPattern>,
  tracks: Map<string, TrackInfo>,
  stepDuration: number,
): { sections: Section[]; firstSectionOfEntry: number[] } {
  if (!Array.isArray(order) || order.length === 0) throw new SongError('order must be a non-empty array of pattern names');
  const sections: Section[] = [];
  const firstSectionOfEntry: number[] = [];
  let step = 0;
  order.forEach((entry, index) => {
    const e: OrderEntry = typeof entry === 'string' ? { p: entry } : entry;
    if (!e || typeof e.p !== 'string') throw new SongError(`order[${index}] must be a pattern name or { p, transpose?, times? }`, { order: index });
    const pat = patterns.get(e.p);
    if (!pat) {
      throw new SongError(`order[${index}]: unknown pattern "${e.p}" (defined: ${[...patterns.keys()].join(', ')})`, { order: index, pattern: e.p });
    }
    const times = e.times === undefined ? 1 : checkNum(e.times, `order[${index}].times`, { min: 1, max: 1024, int: true });
    const transpose: Record<string, number> = {};
    if (typeof e.transpose === 'number') {
      checkNum(e.transpose, `order[${index}].transpose`);
      for (const t of tracks.values()) if (t.kind === 'pitched') transpose[t.name] = e.transpose;
    } else if (e.transpose && typeof e.transpose === 'object') {
      for (const [t, v] of Object.entries(e.transpose)) {
        const info = tracks.get(t);
        if (!info) throw new SongError(`order[${index}].transpose: unknown track "${t}" (tracks: ${[...tracks.keys()].join(', ')})`, { order: index });
        if (info.kind === 'drum') throw new SongError(`order[${index}].transpose: track "${t}" is a drum track and cannot be transposed`, { order: index });
        transpose[t] = checkNum(v, `order[${index}].transpose.${t}`);
      }
    } else if (e.transpose !== undefined) {
      throw new SongError(`order[${index}].transpose must be a number or a { track: semitones } object`, { order: index });
    }
    firstSectionOfEntry.push(sections.length);
    for (let n = 0; n < times; n++) {
      sections.push({ order: index, pattern: e.p, transpose, startStep: step, steps: pat.steps, start: step * stepDuration });
      step += pat.steps;
    }
  });
  return { sections, firstSectionOfEntry };
}

// ------------------------------------------------------------------------------------------------
// Compile
// ------------------------------------------------------------------------------------------------

/** Compiles (and fully validates) a song. Throws `SongError` with a message naming pattern / track / step. */
export function compileSong(def: SongDef): CompiledSong {
  if (!def || typeof def !== 'object') throw new SongError('a song must be an object');
  const bpm = checkNum(def.bpm, 'bpm', { gt: 0, max: 1000 });
  const stepsPerBeat = def.stepsPerBeat === undefined ? 4 : checkNum(def.stepsPerBeat, 'stepsPerBeat', { min: 1, max: 32, int: true });
  const volume = def.volume === undefined ? 1 : checkNum(def.volume, 'volume', { min: 0, max: 4 });
  const stepDuration = stepDurationOf(bpm, stepsPerBeat);

  if (!def.instruments || typeof def.instruments !== 'object' || Object.keys(def.instruments).length === 0) {
    throw new SongError('a song needs at least one instrument');
  }
  const instruments: Record<string, Instrument> = {};
  for (const [name, idef] of Object.entries(def.instruments)) instruments[name] = resolveInstrument(name, idef);

  if (!def.tracks || typeof def.tracks !== 'object' || Object.keys(def.tracks).length === 0) {
    throw new SongError('a song needs at least one track');
  }
  const tracks = resolveTracks(def.tracks, instruments);

  if (!def.patterns || typeof def.patterns !== 'object' || Object.keys(def.patterns).length === 0) {
    throw new SongError('a song needs at least one pattern');
  }
  const patterns = new Map<string, ParsedPattern>();
  for (const [name, pdef] of Object.entries(def.patterns)) patterns.set(name, parsePattern(name, pdef, tracks));

  const { sections, firstSectionOfEntry } = expandOrder(def.order, patterns, tracks, stepDuration);
  const totalSteps = sections.reduce((n, s) => n + s.steps, 0);
  const duration = totalSteps * stepDuration;

  let loopStart = 0;
  if (def.loopStart !== undefined) {
    const idx = checkNum(def.loopStart, 'loopStart', { min: 0, int: true });
    if (idx >= def.order.length) throw new SongError(`loopStart ${idx} is outside order (length ${def.order.length})`);
    loopStart = sections[firstSectionOfEntry[idx]!]!.start;
  }

  // Build events track by track, walking all sections so notes can be held across pattern boundaries.
  const events: Array<NoteEvent & { _track: number }> = [];
  let trackIndex = 0;
  for (const info of tracks.values()) {
    buildTrackEvents(info, trackIndex++, sections, patterns, instruments, stepDuration, totalSteps, events);
  }
  events.sort((a, b) => a.start - b.start || a._track - b._track || a.step - b.step);
  for (const ev of events) delete (ev as Partial<typeof ev>)._track;

  const trackKinds: Record<string, 'pitched' | 'drum'> = {};
  for (const t of tracks.values()) trackKinds[t.name] = t.kind;

  return {
    def,
    title: def.title ?? '',
    bpm,
    stepsPerBeat,
    stepDuration,
    loop: def.loop !== false,
    volume,
    totalSteps,
    duration,
    loopStart,
    loopLength: duration - loopStart,
    instruments,
    trackKinds,
    sections,
    events,
  };
}

function checkRange(midi: number, written: number, shift: number, where: SongErrorWhere): void {
  if (midi < MIDI_MIN || midi > MIDI_MAX) {
    throw new SongError(
      `${whereText(where)}: note ${midiToName(written)} transposed by ${shift} is out of range (MIDI ${midi}; allowed ${MIDI_MIN}-${MIDI_MAX})`,
      where,
    );
  }
}

function buildTrackEvents(
  info: TrackInfo,
  trackIndex: number,
  sections: Section[],
  patterns: Map<string, ParsedPattern>,
  instruments: Record<string, Instrument>,
  stepDuration: number,
  totalSteps: number,
  out: Array<NoteEvent & { _track: number }>,
): void {
  type Ev = NoteEvent & { _track: number };
  let active: Ev[] = []; // pitched: 0 or 1 event; drum: the hits of the last token
  const instrumentOf = (ev: Ev): Instrument => instruments[ev.instrument]!;

  const finish = (endStep: number): void => {
    for (const ev of active) {
      ev.steps = endStep - ev.step;
      ev.duration = ev.steps * stepDuration;
      const inst = instrumentOf(ev);
      const firstGlideAt = ev.glides[0]?.at ?? ev.duration;
      ev.slideTime = ev.slideFrom !== 0 ? Math.min(inst.slide, firstGlideAt) : 0;
      ev.glides.forEach((g, i) => {
        const next = ev.glides[i + 1]?.at ?? ev.duration;
        g.time = Math.min(inst.glide, next - g.at);
      });
    }
    active = [];
  };

  const make = (instrument: string, step: number, midi: number, extra: Partial<NoteEvent>): Ev => {
    const ev: Ev = {
      track: info.name,
      instrument,
      slot: `${info.name}:${instrument}`,
      start: step * stepDuration,
      duration: stepDuration,
      step,
      steps: 1,
      midi,
      freq: midiToFreq(midi),
      velocity: 1,
      forcedVibratoAt: null,
      slideFrom: 0,
      slideTime: 0,
      glides: [],
      drum: info.kind === 'drum',
      _track: trackIndex,
      ...extra,
    };
    out.push(ev);
    return ev;
  };

  for (const sec of sections) {
    const tokens = patterns.get(sec.pattern)!.tracks.get(info.name);
    if (!tokens) {
      // Track absent from this pattern: silence.
      finish(sec.startStep);
      continue;
    }
    const shift = sec.transpose[info.name] ?? 0;
    for (let i = 0; i < sec.steps; i++) {
      const token = tokens[i]!;
      const step = sec.startStep + i;
      const where: SongErrorWhere = { pattern: sec.pattern, order: sec.order, track: info.name, step: i + 1 };
      switch (token.kind) {
        case 'rest':
          finish(step);
          break;
        case 'hold':
          if (active.length === 0) {
            throw new SongError(`${whereText(where)}: "-" has nothing to hold (no note is sounding just before it); use "." for a rest`, where);
          }
          break;
        case 'drum': {
          finish(step);
          if (info.kind !== 'drum') break;
          for (const hit of token.hits) {
            const inst = instruments[info.drums[hit.key]!]!;
            active.push(make(inst.name, step, inst.basePitch, { velocity: hit.accent ? ACCENT_GAIN : 1 }));
          }
          break;
        }
        case 'note': {
          if (info.kind !== 'pitched') break;
          const midi = token.midi + shift;
          checkRange(midi, token.midi, shift, where);
          const prev = active[0];
          if (token.glide && prev) {
            // Legato: merge into the sounding note instead of retriggering it.
            const at = (step - prev.step) * stepDuration;
            prev.glides.push({ at, midi, time: 0 });
            if (token.vibrato && prev.forcedVibratoAt === null) prev.forcedVibratoAt = at;
            break;
          }
          finish(step);
          active.push(
            make(info.instrument, step, midi, {
              velocity: token.accent ? ACCENT_GAIN : 1,
              forcedVibratoAt: token.vibrato ? 0 : null,
              slideFrom: token.slide,
            }),
          );
          break;
        }
      }
    }
  }
  finish(totalSteps);
}

// ------------------------------------------------------------------------------------------------
// Cache
// ------------------------------------------------------------------------------------------------

const cache = new WeakMap<object, CompiledSong>();

/**
 * Compiles a song once and caches the result by object identity (songs are treated as immutable).
 * Accepts an already compiled song and returns it unchanged.
 */
export function parseSong(song: SongDef | CompiledSong): CompiledSong {
  if (isCompiled(song)) return song;
  let compiled = cache.get(song);
  if (!compiled) {
    compiled = compileSong(song);
    cache.set(song, compiled);
  }
  return compiled;
}

export function isCompiled(song: SongDef | CompiledSong): song is CompiledSong {
  return typeof (song as CompiledSong).stepDuration === 'number' && Array.isArray((song as CompiledSong).events);
}
