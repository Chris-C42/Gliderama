import { describe, expect, it } from 'vitest';
import {
  ACCENT_GAIN,
  SongError,
  compileSong,
  midiToFreq,
  midiToName,
  noteToFreq,
  noteToMidi,
  parseNote,
  parseSong,
  parseStepToken,
  stepDurationOf,
  tokenize,
  type SongDef,
} from '../src/audio/notation';

/** A small valid song to mutate in tests. 120 bpm, 4 steps per beat: one step = 0.125 s. */
function makeSong(overrides: Partial<SongDef> = {}): SongDef {
  return {
    bpm: 120,
    stepsPerBeat: 4,
    instruments: {
      lead: { wave: 'pulse25', env: { a: 0, d: 0.08, s: 0.6, r: 0.1 }, vol: 0.5 },
      bass: { wave: 'triangle' },
      kick: { wave: 'triangle', pitchEnv: { from: 48, to: -12, time: 0.08 }, env: { a: 0, d: 0.12, s: 0, r: 0 } },
      snare: { wave: 'noise', env: { a: 0, d: 0.12, s: 0, r: 0 } },
      hat: { wave: 'noise-short', env: { a: 0, d: 0.03, s: 0, r: 0 } },
    },
    tracks: { melody: 'lead', low: 'bass', beat: { k: 'kick', s: 'snare', h: 'hat' } },
    patterns: {
      A: {
        melody: 'C5 . E5 . G5 - - . | A5 - G5 . E5 . C5 .',
        low: 'C3 - - - C3 - - - | F2 - - - G2 - - -',
        beat: 'k . h . s . h . | k . h k s . h .',
      },
    },
    order: ['A'],
    ...overrides,
  };
}

/** Compiles a one-pattern song whose melody track is `melody` (other tracks omitted). */
function melodySong(melody: string, extra: Partial<SongDef> = {}) {
  return compileSong(makeSong({ patterns: { A: { melody } }, ...extra }));
}

describe('note -> frequency', () => {
  it('A4 is 440 Hz and octaves double', () => {
    expect(noteToFreq('A4')).toBeCloseTo(440, 10);
    expect(noteToFreq('A3')).toBeCloseTo(220, 10);
    expect(noteToFreq('A5')).toBeCloseTo(880, 10);
    expect(noteToFreq('A0')).toBeCloseTo(27.5, 10);
    expect(noteToFreq('A8')).toBeCloseTo(7040, 8);
  });

  it('matches well-known equal-temperament frequencies', () => {
    expect(noteToFreq('C4')).toBeCloseTo(261.6256, 3);
    expect(noteToFreq('E4')).toBeCloseTo(329.6276, 3);
    expect(noteToFreq('G4')).toBeCloseTo(391.9954, 3);
    expect(noteToFreq('C0')).toBeCloseTo(16.3516, 3);
    expect(noteToFreq('B8')).toBeCloseTo(7902.133, 2);
  });

  it('maps note names to MIDI numbers (C4 = 60)', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C0')).toBe(12);
    expect(noteToMidi('B8')).toBe(119);
    expect(noteToMidi('C#4')).toBe(61);
    expect(noteToMidi('Db4')).toBe(61);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('Cb4')).toBe(59);
    expect(noteToMidi('B#3')).toBe(60);
  });

  it('treats sharps and flats as enharmonic equivalents', () => {
    for (const [sharp, flat] of [
      ['C#4', 'Db4'],
      ['D#3', 'Eb3'],
      ['F#5', 'Gb5'],
      ['G#2', 'Ab2'],
      ['A#6', 'Bb6'],
    ] as const) {
      expect(noteToFreq(sharp)).toBeCloseTo(noteToFreq(flat), 10);
    }
  });

  it('accepts lower-case note letters, including "bb" as B-flat', () => {
    expect(noteToMidi('c4')).toBe(60);
    expect(noteToMidi('b4')).toBe(71);
    expect(noteToMidi('bb4')).toBe(70);
  });

  it('rejects things that are not notes', () => {
    for (const bad of ['', 'H4', 'C', 'C9', 'C-1', 'C#', '4', 'CC4', 'C##4', 'c10']) {
      expect(parseNote(bad), bad).toBeNull();
      expect(() => noteToMidi(bad), bad).toThrow(/not a note name/);
    }
  });

  it('converts MIDI numbers back to frequencies and names', () => {
    expect(midiToFreq(69)).toBe(440);
    expect(midiToFreq(81)).toBeCloseTo(880, 10);
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
    expect(midiToName(61)).toBe('C#4');
    expect(midiToName(12)).toBe('C0');
  });
});

describe('tokenizer', () => {
  it('splits on whitespace and ignores | bar lines (even when glued to tokens)', () => {
    const { tokens, hasBars } = tokenize('C4 - . | D4  E4|F4\n  G4');
    expect(tokens.map((t) => t.text)).toEqual(['C4', '-', '.', 'D4', 'E4', 'F4', 'G4']);
    expect(hasBars).toBe(true);
  });

  it('counts bars and steps within the bar', () => {
    const { tokens } = tokenize('a b c | d e | f');
    expect(tokens.map((t) => [t.text, t.bar, t.barStep])).toEqual([
      ['a', 1, 1],
      ['b', 1, 2],
      ['c', 1, 3],
      ['d', 2, 1],
      ['e', 2, 2],
      ['f', 3, 1],
    ]);
  });

  it('does not count empty bars for leading or doubled bar lines', () => {
    const { tokens } = tokenize('| a b || c |');
    expect(tokens.map((t) => [t.text, t.bar])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('accepts an array of strings (one per bar) as a pattern', () => {
    const arr = compileSong(makeSong({ patterns: { A: { melody: ['C4 - - -', 'D4 - - -'] } } }));
    expect(arr.totalSteps).toBe(8);
    expect(arr.events.map((e) => e.midi)).toEqual([60, 62]);
  });
});

describe('pitched token parsing', () => {
  it('parses rests, holds and plain notes', () => {
    expect(parseStepToken('.')).toEqual({ kind: 'rest' });
    expect(parseStepToken('-')).toEqual({ kind: 'hold' });
    expect(parseStepToken('C4')).toEqual({ kind: 'note', midi: 60, accent: false, vibrato: false, slide: 0, glide: false });
    expect(parseStepToken('Db4')).toMatchObject({ kind: 'note', midi: 61 });
    expect(parseStepToken('F#2')).toMatchObject({ kind: 'note', midi: 42 });
  });

  it('parses the ! accent, ~ vibrato and > glide suffixes', () => {
    expect(parseStepToken('C4!')).toMatchObject({ accent: true, vibrato: false, glide: false });
    expect(parseStepToken('C4~')).toMatchObject({ accent: false, vibrato: true });
    expect(parseStepToken('C4>')).toMatchObject({ glide: true, slide: 0 });
    expect(parseStepToken('C4!~')).toMatchObject({ accent: true, vibrato: true });
    expect(parseStepToken('C4~!')).toMatchObject({ accent: true, vibrato: true });
    expect(parseStepToken('C4>~')).toMatchObject({ glide: true, vibrato: true });
  });

  it('parses ^ and v slides (^ starts below and slides up; v starts above and slides down)', () => {
    expect(parseStepToken('C4^')).toMatchObject({ slide: -1 });
    expect(parseStepToken('C4v')).toMatchObject({ slide: 1 });
    expect(parseStepToken('C4^^')).toMatchObject({ slide: -2 });
    expect(parseStepToken('C4vvv')).toMatchObject({ slide: 3 });
    expect(parseStepToken('Db4v')).toMatchObject({ midi: 61, slide: 1 });
    expect(parseStepToken('Bb4!^')).toMatchObject({ midi: 70, accent: true, slide: -1 });
  });

  it('gives helpful errors for malformed tokens', () => {
    expect(() => parseStepToken('H5')).toThrow(/unknown token "H5".*expected a note/);
    expect(() => parseStepToken('k')).toThrow(/single letters are drum tokens/);
    expect(() => parseStepToken('C')).toThrow(/needs an octave number 0-8, e\.g\. C4/);
    expect(() => parseStepToken('C#')).toThrow(/needs an octave/);
    expect(() => parseStepToken('C9')).toThrow(/octave out of range/);
    expect(() => parseStepToken('C10')).toThrow(/octave out of range/);
    expect(() => parseStepToken('C4*')).toThrow(/unknown suffix "\*"/);
    expect(() => parseStepToken('C4!!')).toThrow(/duplicate "!"/);
    expect(() => parseStepToken('C4~~')).toThrow(/duplicate "~"/);
    expect(() => parseStepToken('C4>>')).toThrow(/duplicate ">"/);
    expect(() => parseStepToken('C4^v')).toThrow(/both up \(\^\) and down \(v\)/);
    expect(() => parseStepToken('C4^>')).toThrow(/slide.*glide/);
    expect(() => parseStepToken('C4!>')).toThrow(/cannot be combined/);
    expect(() => parseStepToken('C4^^^^^^^^^^^^^')).toThrow(/at most 12/);
  });
});

describe('drum token parsing and mapping', () => {
  const keys = ['k', 's', 'h'];

  it('parses single hits, accents and rests/holds', () => {
    expect(parseStepToken('k', keys)).toEqual({ kind: 'drum', hits: [{ key: 'k', accent: false }] });
    expect(parseStepToken('s!', keys)).toEqual({ kind: 'drum', hits: [{ key: 's', accent: true }] });
    expect(parseStepToken('.', keys)).toEqual({ kind: 'rest' });
    expect(parseStepToken('-', keys)).toEqual({ kind: 'hold' });
  });

  it('allows several drums in one step (kick + hat)', () => {
    expect(parseStepToken('kh', keys)).toEqual({
      kind: 'drum',
      hits: [
        { key: 'k', accent: false },
        { key: 'h', accent: false },
      ],
    });
    expect(parseStepToken('k!h', keys)).toEqual({
      kind: 'drum',
      hits: [
        { key: 'k', accent: true },
        { key: 'h', accent: false },
      ],
    });
  });

  it('rejects unknown letters, repeated drums and stray accents', () => {
    expect(() => parseStepToken('x', keys)).toThrow(/unknown drum "x".*defines: k, s, h/);
    expect(() => parseStepToken('kk', keys)).toThrow(/appears twice/);
    expect(() => parseStepToken('!', keys)).toThrow(/must follow a drum letter/);
    expect(() => parseStepToken('k!!', keys)).toThrow(/duplicate "!"/);
    expect(() => parseStepToken('C4', keys)).toThrow(/looks like a note/);
  });

  it('maps drum letters to instruments in the compiled timeline', () => {
    const song = compileSong(makeSong());
    const beat = song.events.filter((e) => e.track === 'beat');
    // 16 steps: k . h . s . h . | k . h k s . h .  -> k,h,s,h,k,h,k,s,h = 9 hits
    expect(beat).toHaveLength(9);
    expect(beat.map((e) => e.instrument)).toEqual(['kick', 'hat', 'snare', 'hat', 'kick', 'hat', 'kick', 'snare', 'hat']);
    expect(beat.every((e) => e.drum)).toBe(true);
    expect(beat.map((e) => e.step)).toEqual([0, 2, 4, 6, 8, 10, 11, 12, 14]);
  });

  it('uses the instrument base pitch for tonal drums (default C2) and C4 reference for noise', () => {
    const song = compileSong(makeSong());
    const kick = song.events.find((e) => e.instrument === 'kick')!;
    expect(kick.midi).toBe(36);
    expect(kick.freq).toBeCloseTo(65.406, 2);
    const snare = song.events.find((e) => e.instrument === 'snare')!;
    expect(snare.midi).toBe(60);
    const custom = compileSong(
      makeSong({
        instruments: { ...makeSong().instruments, kick: { wave: 'triangle', pitch: 'A1' } },
      }),
    );
    expect(custom.events.find((e) => e.instrument === 'kick')!.midi).toBe(33);
  });

  it('applies ! accents to drum hits and lets - sustain a hit', () => {
    const song = compileSong(
      makeSong({ patterns: { A: { beat: 'k! - - . | s . k . | h . . .' } } }),
    );
    const [k, s, k2] = song.events;
    expect(k!.velocity).toBe(ACCENT_GAIN);
    expect(k!.steps).toBe(3);
    expect(k!.duration).toBeCloseTo(0.375, 12);
    expect(s!.velocity).toBe(1);
    expect(k2!.instrument).toBe('kick');
  });

  it('does not transpose drum tracks', () => {
    const song = compileSong(makeSong({ order: [{ p: 'A', transpose: 7 }] }));
    const kick = song.events.find((e) => e.instrument === 'kick')!;
    expect(kick.midi).toBe(36);
  });
});

describe('validation errors', () => {
  it('names the pattern, track and step of an unknown token', () => {
    const def = makeSong({ patterns: { A: { melody: 'C5 . H5 .' } } });
    expect(() => compileSong(def)).toThrow(SongError);
    expect(() => compileSong(def)).toThrow(/Pattern "A", track "melody", step 3: unknown token "H5"/);
    try {
      compileSong(def);
    } catch (e) {
      expect((e as SongError).where).toEqual({ pattern: 'A', track: 'melody', step: 3 });
    }
  });

  it('adds the bar number when the track uses | separators', () => {
    const def = makeSong({ patterns: { A: { melody: 'C5 . E5 . | G5 Z5 . .' } } });
    expect(() => compileSong(def)).toThrow(/step 6 \(bar 2, step 2\): unknown token "Z5"/);
  });

  it('names the drum track and letter for an unknown drum', () => {
    const def = makeSong({ patterns: { A: { beat: 'k . x .' } } });
    expect(() => compileSong(def)).toThrow(/Pattern "A", track "beat", step 3: unknown drum "x"/);
  });

  it('reports every track length when a pattern is not rectangular', () => {
    const def = makeSong({
      patterns: { A: { melody: 'C5 . E5 .', low: 'C3 - -', beat: 'k . . .' }, B: { melody: 'C5 .' } },
    });
    let message = '';
    try {
      compileSong(def);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/Pattern "A"/);
    expect(message).toMatch(/same number of steps/);
    expect(message).toMatch(/melody=4, low=3, beat=4/);
    expect(message).toMatch(/track "low" has 3/);
  });

  it('rejects empty tracks, empty patterns and unknown tracks', () => {
    expect(() => melodySong('')).toThrow(/Pattern "A": track "melody" has no steps/);
    expect(() => compileSong(makeSong({ patterns: { A: {} } }))).toThrow(/Pattern "A" has no tracks/);
    expect(() => compileSong(makeSong({ patterns: { A: { nope: 'C4' } } }))).toThrow(
      /Pattern "A": unknown track "nope" \(tracks: melody, low, beat\)/,
    );
  });

  it('rejects unknown instruments and unknown waves', () => {
    expect(() => compileSong(makeSong({ tracks: { melody: 'ghost' } }))).toThrow(
      /track "melody" uses unknown instrument "ghost"/,
    );
    expect(() => compileSong(makeSong({ tracks: { beat: { k: 'ghost' } } }))).toThrow(/drum "k" uses unknown instrument "ghost"/);
    expect(() =>
      compileSong(makeSong({ instruments: { lead: { wave: 'sine' as never } } })),
    ).toThrow(/instrument "lead": unknown wave "sine"/);
  });

  it('validates numeric fields', () => {
    expect(() => compileSong(makeSong({ bpm: 0 }))).toThrow(/bpm must be > 0/);
    expect(() => compileSong(makeSong({ bpm: NaN }))).toThrow(/bpm must be a finite number/);
    expect(() => compileSong(makeSong({ stepsPerBeat: 2.5 }))).toThrow(/stepsPerBeat must be an integer/);
    expect(() =>
      compileSong(makeSong({ instruments: { lead: { wave: 'pulse25', env: { s: 2 } } } })),
    ).toThrow(/instrument "lead": env\.s must be <= 1/);
    expect(() =>
      compileSong(makeSong({ instruments: { lead: { wave: 'pulse25', arp: [] } } })),
    ).toThrow(/arp must be a non-empty array/);
  });

  it('rejects an empty token and a bad filter type', () => {
    expect(() => parseStepToken('')).toThrow(/empty token/);
    expect(() => parseStepToken('', ['k'])).toThrow(/empty token/);
    expect(() =>
      compileSong(makeSong({ instruments: { lead: { wave: 'pulse25', filter: { type: 'notch' as never, freq: 500 } } } })),
    ).toThrow(/instrument "lead": filter\.type must be lowpass, highpass or bandpass \(got notch\)/);
  });

  it('lets an explicit undefined in a partial envelope fall back to the default', () => {
    const song = compileSong(makeSong({ instruments: { ...makeSong().instruments, lead: { wave: 'pulse25', env: { a: undefined, s: 0.5 } } } }));
    expect(song.instruments.lead!.env).toEqual({ a: 0, d: 0, s: 0.5, r: 0.02 });
  });

  it('rejects bad drum keys', () => {
    expect(() => compileSong(makeSong({ tracks: { beat: { kk: 'kick' } } }))).toThrow(/single character/);
    expect(() => compileSong(makeSong({ tracks: { beat: { '.': 'kick' } } }))).toThrow(/single character/);
  });

  it('rejects "-" with nothing to hold, naming where', () => {
    expect(() => melodySong('- C4 . .')).toThrow(/Pattern "A", order\[0\], track "melody", step 1: "-" has nothing to hold/);
    expect(() => melodySong('C4 . - .')).toThrow(/step 3: "-" has nothing to hold/);
  });

  it('reports order problems with the order index', () => {
    expect(() => compileSong(makeSong({ order: [] }))).toThrow(/order must be a non-empty array/);
    expect(() => compileSong(makeSong({ order: ['A', 'Z'] }))).toThrow(/order\[1\]: unknown pattern "Z" \(defined: A\)/);
    expect(() => compileSong(makeSong({ order: [{ p: 'A', transpose: { nope: 1 } }] }))).toThrow(/unknown track "nope"/);
    expect(() => compileSong(makeSong({ order: [{ p: 'A', transpose: { beat: 1 } }] }))).toThrow(/drum track/);
    expect(() => compileSong(makeSong({ order: [{ p: 'A', times: 0 }] }))).toThrow(/times must be >= 1/);
    expect(() => compileSong(makeSong({ loopStart: 5 }))).toThrow(/loopStart 5 is outside order/);
  });

  it('rejects notes that transpose out of the MIDI range', () => {
    expect(() =>
      compileSong(makeSong({ patterns: { A: { melody: 'B8 . . .' } }, order: [{ p: 'A', transpose: 12 }] })),
    ).toThrow(/Pattern "A", order\[0\], track "melody", step 1: note B8 transposed by 12 is out of range/);
  });
});

describe('order and transposition expansion', () => {
  const def = makeSong({
    patterns: {
      A: { melody: 'C4 - - -', low: 'C2 - - -', beat: 'k . . .' },
      B: { melody: 'E4 - - -', low: 'E2 - - -', beat: 's . . .' },
    },
  });

  it('plays patterns in order with consecutive start steps and times', () => {
    const song = compileSong({ ...def, order: ['A', 'B', 'A'] });
    expect(song.sections.map((s) => [s.pattern, s.startStep, s.steps])).toEqual([
      ['A', 0, 4],
      ['B', 4, 4],
      ['A', 8, 4],
    ]);
    expect(song.totalSteps).toBe(12);
    expect(song.duration).toBeCloseTo(1.5, 12);
    const melody = song.events.filter((e) => e.track === 'melody');
    expect(melody.map((e) => [e.midi, e.start])).toEqual([
      [60, 0],
      [64, 0.5],
      [60, 1],
    ]);
  });

  it('transposes all pitched tracks of an order entry, but not drums', () => {
    const song = compileSong({ ...def, order: ['A', 'A', { p: 'A', transpose: 5 }] });
    const melody = song.events.filter((e) => e.track === 'melody').map((e) => e.midi);
    const low = song.events.filter((e) => e.track === 'low').map((e) => e.midi);
    const beat = song.events.filter((e) => e.track === 'beat').map((e) => e.midi);
    expect(melody).toEqual([60, 60, 65]);
    expect(low).toEqual([36, 36, 41]);
    expect(beat).toEqual([36, 36, 36]);
    expect(song.events.find((e) => e.track === 'melody' && e.start === 1)!.freq).toBeCloseTo(noteToFreq('F4'), 10);
  });

  it('supports negative and per-track transposition', () => {
    const song = compileSong({ ...def, order: [{ p: 'A', transpose: -12 }, { p: 'A', transpose: { melody: 7 } }] });
    const melody = song.events.filter((e) => e.track === 'melody').map((e) => e.midi);
    const low = song.events.filter((e) => e.track === 'low').map((e) => e.midi);
    expect(melody).toEqual([48, 67]);
    expect(low).toEqual([24, 36]);
  });

  it('expands times: n into n consecutive sections of the same order entry', () => {
    const song = compileSong({ ...def, order: [{ p: 'A', times: 3 }, 'B'] });
    expect(song.sections.map((s) => [s.order, s.pattern, s.startStep])).toEqual([
      [0, 'A', 0],
      [0, 'A', 4],
      [0, 'A', 8],
      [1, 'B', 12],
    ]);
    expect(song.events.filter((e) => e.track === 'melody')).toHaveLength(4);
  });

  it('loopStart jumps back to the start of an order entry (intro that plays once)', () => {
    const song = compileSong({ ...def, order: ['A', { p: 'B', times: 2 }, 'A'], loopStart: 1 });
    expect(song.duration).toBeCloseTo(2, 12);
    expect(song.loopStart).toBeCloseTo(0.5, 12);
    expect(song.loopLength).toBeCloseTo(1.5, 12);
    expect(compileSong({ ...def, order: ['A', 'B'] }).loopStart).toBe(0);
  });

  it('treats a track missing from a pattern as silence', () => {
    const song = compileSong({
      ...def,
      patterns: { ...def.patterns, C: { melody: 'G4 - - -' } },
      order: ['A', 'C', 'A'],
    });
    expect(song.events.filter((e) => e.track === 'low').map((e) => e.start)).toEqual([0, 1]);
    expect(song.events.filter((e) => e.track === 'melody')).toHaveLength(3);
  });
});

describe('event timeline (seconds)', () => {
  it('computes step duration from bpm and steps per beat', () => {
    expect(stepDurationOf(120, 4)).toBe(0.125);
    expect(stepDurationOf(60, 1)).toBe(1);
    expect(stepDurationOf(128, 4)).toBeCloseTo(0.1171875, 12);
    expect(stepDurationOf(90, 2)).toBeCloseTo(1 / 3, 12);
  });

  it('turns tokens into start times and gate durations at 120 bpm', () => {
    const song = melodySong('C4 - - . | D4 E4 - .');
    expect(song.stepDuration).toBe(0.125);
    expect(song.events.map((e) => [e.midi, e.start, e.duration, e.steps])).toEqual([
      [60, 0, 0.375, 3],
      [62, 0.5, 0.125, 1],
      [64, 0.625, 0.25, 2],
    ]);
    expect(song.duration).toBe(1);
    expect(song.totalSteps).toBe(8);
  });

  it('scales with the tempo', () => {
    const slow = melodySong('C4 - D4 -', { bpm: 60, stepsPerBeat: 1 });
    expect(slow.events.map((e) => [e.start, e.duration])).toEqual([
      [0, 2],
      [2, 2],
    ]);
    const fast = melodySong('C4 - D4 -', { bpm: 240, stepsPerBeat: 4 });
    expect(fast.events.map((e) => [e.start, e.duration])).toEqual([
      [0, 0.125],
      [0.125, 0.125],
    ]);
  });

  it('keeps tempo accurate: times are exact multiples of the step, no drift', () => {
    const song = compileSong(makeSong({ bpm: 128, order: [{ p: 'A', times: 64 }] }));
    const step = 60 / (128 * 4);
    for (const e of song.events) {
      expect(e.start).toBe(e.step * step);
      expect(e.duration).toBe(e.steps * step);
    }
    expect(song.duration).toBe(song.totalSteps * step);
    expect(song.duration).toBeCloseTo(64 * 16 * step, 9);
  });

  it('ends a held note at the next note or rest, and at the end of the song', () => {
    const song = melodySong('C4 - - D4 - . E4 -');
    expect(song.events.map((e) => [e.start, e.duration])).toEqual([
      [0, 0.375],
      [0.375, 0.25],
      [0.75, 0.25],
    ]);
  });

  it('holds a note across a pattern boundary', () => {
    const song = compileSong(
      makeSong({
        patterns: { A: { melody: 'C4 - - -' }, B: { melody: '- - D4 -' } },
        order: ['A', 'B'],
      }),
    );
    expect(song.events.map((e) => [e.midi, e.start, e.duration])).toEqual([
      [60, 0, 0.75],
      [62, 0.75, 0.25],
    ]);
  });

  it('sorts events by start time, with ties in track order', () => {
    const song = compileSong(makeSong());
    for (let i = 1; i < song.events.length; i++) {
      expect(song.events[i]!.start).toBeGreaterThanOrEqual(song.events[i - 1]!.start);
    }
    const first = song.events.slice(0, 3);
    expect(first.map((e) => e.track)).toEqual(['melody', 'low', 'beat']);
  });

  it('sets slot keys per track and instrument (monophonic channels)', () => {
    const song = compileSong(makeSong());
    const slots = new Set(song.events.map((e) => e.slot));
    expect([...slots].sort()).toEqual(['beat:hat', 'beat:kick', 'beat:snare', 'low:bass', 'melody:lead']);
  });

  it('applies accents as a 30 % volume boost', () => {
    const song = melodySong('C4! D4');
    expect(song.events.map((e) => e.velocity)).toEqual([1.3, 1]);
    expect(ACCENT_GAIN).toBe(1.3);
  });

  it('forces vibrato with ~ (from the very start of the note)', () => {
    const song = melodySong('C4~ D4 E4');
    expect(song.events.map((e) => e.forcedVibratoAt)).toEqual([0, null, null]);
  });

  it('turns ^ and v into a slide-in capped by the note length', () => {
    const song = melodySong('C4^ - D4v E4^^', { bpm: 120 });
    const [c, d, e] = song.events;
    expect(c!.slideFrom).toBe(-1);
    expect(c!.slideTime).toBeCloseTo(0.05, 12); // instrument default slide time
    expect(d!.slideFrom).toBe(1);
    expect(e!.slideFrom).toBe(-2);
    expect(e!.slideTime).toBeCloseTo(0.05, 12);
    const quick = melodySong('C4^', { bpm: 480 }); // step = 0.03125 s < 0.05 s
    expect(quick.events[0]!.slideTime).toBeCloseTo(0.03125, 12);
    expect(melodySong('C4').events[0]!.slideFrom).toBe(0);
  });

  it('merges > glides into the previous note (legato) instead of retriggering', () => {
    const song = melodySong('C4 - E4> - - G4> . D4');
    expect(song.events.map((e) => [e.midi, e.start, e.duration])).toEqual([
      [60, 0, 0.75], // C4 sounds through both glided notes, until the rest at step 6
      [62, 0.875, 0.125],
    ]);
    const glides = song.events[0]!.glides;
    expect(glides.map((g) => [g.midi, g.at])).toEqual([
      [64, 0.25],
      [67, 0.625],
    ]);
    // default glide time 0.07 s fits inside both segments
    expect(glides[0]!.time).toBeCloseTo(0.07, 12);
    expect(glides[1]!.time).toBeCloseTo(0.07, 12);
  });

  it('caps a glide to the length of its segment', () => {
    const song = melodySong('C4 D4> E4>', { bpm: 480 }); // 31.25 ms steps
    expect(song.events).toHaveLength(1);
    expect(song.events[0]!.glides.map((g) => g.time)).toEqual([0.03125, 0.03125]);
  });

  it('plays a > note as a plain note when nothing is sounding', () => {
    const song = melodySong('C4 . E4> -');
    expect(song.events.map((e) => [e.midi, e.start, e.glides.length])).toEqual([
      [60, 0, 0],
      [64, 0.25, 0],
    ]);
    expect(melodySong('E4> -').events[0]!.glides).toHaveLength(0);
  });

  it('starts forced vibrato at the glide for ~> notes', () => {
    const song = melodySong('C4 - E4>~ -');
    expect(song.events[0]!.forcedVibratoAt).toBe(0.25);
    expect(melodySong('C4~ E4>~').events[0]!.forcedVibratoAt).toBe(0);
  });
});

describe('instrument resolution', () => {
  it('fills in defaults', () => {
    const song = compileSong(makeSong({ instruments: { ...makeSong().instruments, plain: { wave: 'pulse50' } } }));
    expect(song.instruments.plain).toMatchObject({
      wave: 'pulse50',
      env: { a: 0, d: 0, s: 1, r: 0.02 },
      vol: 1,
      vibrato: null,
      pitchEnv: null,
      arp: null,
      arpSpeed: 0.03,
      noiseRate: 1,
      glide: 0.07,
      slide: 0.05,
      pan: 0,
      filter: null,
    });
  });

  it('keeps vibrato, arp and pitch-env settings', () => {
    const song = compileSong(
      makeSong({
        instruments: {
          ...makeSong().instruments,
          fancy: {
            wave: 'pulse12',
            vibrato: { depth: 0.15, rate: 6, delay: 0.12 },
            arp: [0, 4, 7],
            arpSpeed: 0.04,
            pitchEnv: { from: 12, to: 0, time: 0.05 },
          },
        },
      }),
    );
    expect(song.instruments.fancy).toMatchObject({
      vibrato: { depth: 0.15, rate: 6, delay: 0.12, auto: true },
      arp: [0, 4, 7],
      arpSpeed: 0.04,
      pitchEnv: { from: 12, to: 0, time: 0.05 },
    });
  });
});

describe('parseSong cache', () => {
  it('compiles a definition once and returns the same object afterwards', () => {
    const def = makeSong();
    const a = parseSong(def);
    const b = parseSong(def);
    expect(b).toBe(a);
    expect(parseSong(a)).toBe(a);
    expect(parseSong(makeSong())).not.toBe(a);
  });

  it('throws SongError for invalid songs (and does not cache them)', () => {
    const def = makeSong({ order: ['nope'] });
    expect(() => parseSong(def)).toThrow(SongError);
    expect(() => parseSong(def)).toThrow(SongError);
  });
});

describe('the example song from the brief', () => {
  it('compiles exactly as written', () => {
    const song = compileSong({
      bpm: 128,
      stepsPerBeat: 4,
      loop: true,
      instruments: {
        lead: { wave: 'pulse25', env: { a: 0, d: 0.08, s: 0.6, r: 0.1 }, vol: 0.5, vibrato: { depth: 0.15, rate: 6, delay: 0.12 } },
        bass: { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.02 }, vol: 0.9 },
        arp: { wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.35, r: 0.05 }, vol: 0.25, arp: [0, 4, 7], arpSpeed: 0.03 },
        kick: { wave: 'triangle', pitchEnv: { from: 48, to: -12, time: 0.08 }, env: { a: 0, d: 0.12, s: 0, r: 0 }, vol: 1 },
        snare: { wave: 'noise', env: { a: 0, d: 0.12, s: 0, r: 0 }, vol: 0.5, noiseRate: 1.0 },
        hat: { wave: 'noise-short', env: { a: 0, d: 0.03, s: 0, r: 0 }, vol: 0.25 },
      },
      tracks: { melody: 'lead', low: 'bass', harmony: 'arp', beat: { k: 'kick', s: 'snare', h: 'hat' } },
      patterns: {
        A: {
          melody: 'C5 . E5 . G5 - - . | A5 - G5 . E5 . C5 .',
          low: 'C3 - - - C3 - - - | F2 - - - G2 - - -',
          harmony: 'C4 - - - - - - - | F4 - - - G4 - - -',
          beat: 'k . h . s . h . | k . h k s . h .',
        },
      },
      order: ['A', 'A', { p: 'A', transpose: 5 }],
    });
    expect(song.totalSteps).toBe(48);
    expect(song.duration).toBeCloseTo(48 * (60 / 128 / 4), 10);
    expect(song.sections.map((s) => s.startStep)).toEqual([0, 16, 32]);
    const melody = song.events.filter((e) => e.track === 'melody');
    expect(melody).toHaveLength(21); // 7 notes per pass x 3 (C5 E5 G5 A5 G5 E5 C5)
    expect(melody[0]!.freq).toBeCloseTo(523.2511, 3); // C5
    expect(melody[14]!.midi).toBe(72 + 5); // third pass, transposed +5: C5 -> F5
  });
});
