import { describe, expect, it } from 'vitest';
import { compileSong, type CompiledSong, type NoteEvent } from '../src/audio/notation';
import { alt, demo, jingle, songs } from '../src/audio/songs';
import { WAVE_NAMES } from '../src/audio/types';

const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);
const G_MAJOR = new Set([0, 2, 4, 6, 7, 9, 11]);
const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;

/** Maximum number of events sounding at the same moment (gate only, release tails excluded). */
function maxOverlap(events: NoteEvent[]): number {
  const points = events.flatMap((e) => [
    [e.start, 1],
    [e.start + e.duration, -1],
  ] as const);
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, delta] of points) {
    cur += delta;
    max = Math.max(max, cur);
  }
  return max;
}

describe('shipped songs', () => {
  it('every song compiles', () => {
    for (const [name, def] of Object.entries(songs)) {
      expect(() => compileSong(def), name).not.toThrow();
    }
  });

  it('every song has finite, in-range events', () => {
    for (const [name, def] of Object.entries(songs)) {
      const song = compileSong(def);
      expect(song.events.length, name).toBeGreaterThan(10);
      for (const e of song.events) {
        expect(Number.isFinite(e.start) && e.start >= 0, `${name} start`).toBe(true);
        expect(e.duration, `${name} duration`).toBeGreaterThan(0);
        expect(e.start + e.duration, `${name} end`).toBeLessThanOrEqual(song.duration + 1e-9);
        expect(e.freq, `${name} freq`).toBeGreaterThan(8);
        expect(e.freq, `${name} freq`).toBeLessThan(8000);
      }
    }
  });

  it('exports the songs under their names', () => {
    expect(songs).toEqual({ demo, alt, jingle });
  });
});

describe('demo song', () => {
  const song: CompiledSong = compileSong(demo);

  it('has the documented form and length', () => {
    // intro 2 bars + A x2 (8 bars) + B (4) + B (4) + A (4) = 22 bars of 16 steps at 120 bpm (0.125 s per step)
    expect(song.sections.map((s) => [s.order, s.pattern])).toEqual([
      [0, 'intro'],
      [1, 'A'],
      [1, 'A'],
      [2, 'B'],
      [3, 'B'],
      [4, 'A'],
    ]);
    expect(song.totalSteps).toBe(32 + 64 * 5);
    expect(song.duration).toBeCloseTo(44, 9);
    expect(song.loop).toBe(true);
    expect(song.loopStart).toBeCloseTo(4, 9); // the intro plays once
    expect(song.loopLength).toBeCloseTo(40, 9);
  });

  it('uses every wave of the chip', () => {
    const waves = new Set(song.events.map((e) => song.instruments[e.instrument]!.wave));
    expect([...waves].sort()).toEqual([...WAVE_NAMES].sort());
  });

  it('exercises every notation feature', () => {
    const events = song.events;
    expect(events.some((e) => e.velocity === 1.3), 'accent').toBe(true);
    expect(events.some((e) => e.forcedVibratoAt === 0), 'vibrato ~').toBe(true);
    expect(events.some((e) => e.slideFrom < 0), 'slide up ^').toBe(true);
    expect(events.some((e) => e.slideFrom > 0), 'slide down v').toBe(true);
    expect(events.some((e) => e.glides.length > 0), 'glide >').toBe(true);
    expect(events.some((e) => e.steps > 1 && !e.drum), 'holds -').toBe(true);
    // two drums in one step (kh)
    const beat = events.filter((e) => e.track === 'beat');
    const starts = beat.map((e) => e.start);
    expect(starts.length).toBeGreaterThan(new Set(starts).size);
    // every drum of the map is used
    expect(new Set(beat.map((e) => e.instrument))).toEqual(new Set(['kick', 'snare', 'hat', 'openHat', 'tom']));
    // transposition: a number and a per-track record, and times
    expect(song.sections.some((s) => Object.values(s.transpose).some((v) => v === 7))).toBe(true);
    expect(song.sections.some((s) => s.transpose.melody === 12 && s.transpose.low === undefined)).toBe(true);
    expect(song.sections.filter((s) => s.pattern === 'A' && s.order === 1)).toHaveLength(2);
    // an intro that leaves tracks out
    expect(events.filter((e) => e.start < 4).some((e) => e.track === 'melody')).toBe(false);
    // instrument features
    const inst = song.instruments;
    expect(inst.lead!.vibrato).toMatchObject({ auto: true, delay: 0.15 });
    expect(inst.lead2!.vibrato).toMatchObject({ auto: false });
    expect(inst.arp!.arp).toEqual([0, 4, 7]);
    expect(inst.kick!.pitchEnv).not.toBeNull();
    expect(inst.tom!.basePitch).toBe(43); // G2
    expect(inst.snare!.filter).not.toBeNull();
    expect(inst.hat!.noiseRate).toBe(4);
    expect(inst.lead2!.pan).not.toBe(0);
  });

  it('stays in key: the C-major passes use only C-major notes, the +7 pass only G-major notes', () => {
    for (const e of song.events) {
      if (e.drum) continue;
      const section = song.sections.find((s) => e.step >= s.startStep && e.step < s.startStep + s.steps)!;
      const key = (section.transpose[e.track] ?? 0) % 12 === 7 ? G_MAJOR : C_MAJOR; // +12 is an octave: still C major
      expect(key.has(pitchClass(e.midi)), `${e.track} step ${e.step} midi ${e.midi}`).toBe(true);
      for (const g of e.glides) expect(key.has(pitchClass(g.midi)), `${e.track} glide to ${g.midi}`).toBe(true);
    }
  });

  it('keeps a sane voice count (monophonic channels, no pile-ups)', () => {
    expect(maxOverlap(song.events)).toBeLessThanOrEqual(10);
    // each channel is monophonic by design: events of one slot never overlap
    const bySlot = new Map<string, NoteEvent[]>();
    for (const e of song.events) bySlot.set(e.slot, [...(bySlot.get(e.slot) ?? []), e]);
    for (const [slot, list] of bySlot) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.start, slot).toBeGreaterThanOrEqual(list[i - 1]!.start + list[i - 1]!.duration - 1e-9);
      }
    }
  });
});

describe('companion songs', () => {
  it('the jingle is a short non-looping stinger', () => {
    const song = compileSong(jingle);
    expect(song.loop).toBe(false);
    expect(song.duration).toBeGreaterThan(3);
    expect(song.duration).toBeLessThan(5);
  });

  it('the alternate loop loops and has its own tempo and key', () => {
    const song = compileSong(alt);
    expect(song.loop).toBe(true);
    expect(song.bpm).toBe(96);
    expect(song.totalSteps).toBe(64);
    const melody = song.events.filter((e) => e.track === 'melody');
    expect(melody.every((e) => C_MAJOR.has(pitchClass(e.midi)))).toBe(true); // A minor = C major notes
  });
});
