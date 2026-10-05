import { describe, expect, it } from 'vitest';
import { compileSong, type SongDef } from '../src/audio/notation';
import { SongCursor, type TimedEvent } from '../src/audio/sequencer';
import { LOOKAHEAD_SECONDS, SCHEDULE_INTERVAL_MS } from '../src/audio/engine';
import { demo } from '../src/audio/songs';

/** 120 bpm, 16th steps (0.125 s). Pattern A: 8 steps (1 s) with 9 events. */
function makeDef(overrides: Partial<SongDef> = {}): SongDef {
  return {
    bpm: 120,
    instruments: {
      lead: { wave: 'pulse25' },
      bass: { wave: 'triangle' },
      kick: { wave: 'triangle', env: { a: 0, d: 0.1, s: 0, r: 0 } },
    },
    tracks: { melody: 'lead', low: 'bass', beat: { k: 'kick' } },
    patterns: {
      A: { melody: 'C4 - D4 - E4 - F4 -', low: 'C2 - - - - - - -', beat: 'k . k . k . k .' },
      B: { melody: 'G4 - - - A4 - - -', low: 'G2 - - - - - - -', beat: 'k . . . k . . .' },
    },
    order: ['A'],
    ...overrides,
  };
}

/** Pulls everything a cursor yields up to `until`, in 25 ms ticks with a 120 ms lookahead, like the player. */
function playThrough(cursor: SongCursor, from: number, to: number): TimedEvent[] {
  const out: TimedEvent[] = [];
  for (let now = from; now < to; now += SCHEDULE_INTERVAL_MS / 1000) {
    out.push(...cursor.drain(now + LOOKAHEAD_SECONDS));
  }
  return out;
}

describe('SongCursor windows', () => {
  it('returns events with time < until, in order, each exactly once', () => {
    const song = compileSong(makeDef());
    const cursor = new SongCursor(song, 10);
    const first = cursor.drain(10.3);
    expect(first.map((t) => t.time)).toEqual([10, 10, 10, 10.25, 10.25]); // melody + bass + kick, then melody + kick
    expect(first.every((t, i) => i === 0 || t.time >= first[i - 1]!.time)).toBe(true);
    // nothing new in the same window
    expect(cursor.drain(10.3)).toEqual([]);
    // the next window continues where we left off
    const second = cursor.drain(10.6);
    expect(second.every((t) => t.time >= 10.3 && t.time < 10.6)).toBe(true);
    expect(second.map((t) => t.event.step)).toEqual([4, 4]);
  });

  it('treats the window end as exclusive: an event at exactly `until` comes next time', () => {
    const song = compileSong(makeDef());
    const cursor = new SongCursor(song, 0);
    expect(cursor.drain(0.25).every((t) => t.time < 0.25)).toBe(true);
    const next = cursor.drain(0.250001);
    expect(next.map((t) => t.time)).toEqual([0.25, 0.25]);
  });

  it('hands out every event once when polled like the live scheduler (25 ms ticks, 120 ms lookahead)', () => {
    const song = compileSong(makeDef({ order: [{ p: 'A', times: 2 }, 'B'] }));
    const cursor = new SongCursor(song, 0.06);
    const got = playThrough(cursor, 0, 7);
    // one pass = A, A, B = 9 + 9 + 5 events over 3 s; 7 s of ticks cover a bit more than two passes
    const perPass = song.events.length;
    expect(perPass).toBe(23);
    expect(got.length).toBeGreaterThanOrEqual(perPass * 2);
    // strictly increasing serial numbers, no duplicates, no gaps
    for (let i = 0; i < got.length; i++) expect(got[i]!.serial).toBe(i);
    // times never go backwards
    for (let i = 1; i < got.length; i++) expect(got[i]!.time).toBeGreaterThanOrEqual(got[i - 1]!.time);
  });
});

describe('looping', () => {
  it('repeats the song every `duration` seconds, exactly', () => {
    const song = compileSong(makeDef());
    expect(song.duration).toBe(1);
    const cursor = new SongCursor(song, 5);
    const all = cursor.drain(5 + 3);
    expect(all).toHaveLength(song.events.length * 3);
    for (const t of all) {
      expect(t.time).toBe(5 + t.event.start + t.pass * song.loopLength);
    }
    expect([...new Set(all.map((t) => t.pass))]).toEqual([0, 1, 2]);
  });

  it('is seamless: the first event of the next pass lands exactly where the song ends', () => {
    const song = compileSong(makeDef());
    const cursor = new SongCursor(song, 0);
    const pass0 = cursor.drain(1);
    const pass1 = cursor.drain(2);
    expect(pass0.at(-1)!.time).toBeLessThan(1);
    expect(pass1[0]!.time).toBe(1); // exactly the song duration after the start
    expect(pass1[0]!.event.start).toBe(0);
  });

  it('does not drift however long the loop has been running', () => {
    const song = compileSong(makeDef({ bpm: 128 })); // 60/(128*4) is not exactly representable
    const cursor = new SongCursor(song, 0.06);
    const passes = 100_000;
    const far = 0.06 + passes * song.loopLength;
    const items = cursor.drain(far + 2, far - 1e-3); // jump straight there
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.time).toBe(0.06 + it.event.start + it.pass * song.loopLength);
      // an exact multiple of the step above the pass start: no accumulated error
      const k = (it.time - 0.06 - it.pass * song.loopLength) / song.stepDuration;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
    expect(items[0]!.pass).toBeGreaterThanOrEqual(passes - 1);
  });

  it('with loopStart, plays the intro once and then repeats only the body', () => {
    const song = compileSong(makeDef({ order: ['A', 'B', 'B'], loopStart: 1 }));
    // A is 1 s (the intro), B + B is 2 s (the body)
    expect(song.loopStart).toBe(1);
    expect(song.duration).toBe(3);
    expect(song.loopLength).toBe(2);
    const cursor = new SongCursor(song, 0);
    const all = cursor.drain(3 + 2 + 2); // intro + body + body + body
    const introEvents = all.filter((t) => t.event.start < 1);
    expect(introEvents.every((t) => t.pass === 0)).toBe(true);
    expect(introEvents.length).toBe(song.events.filter((e) => e.start < 1).length);
    // pass 1 only contains body events, shifted by one loop length
    const pass1 = all.filter((t) => t.pass === 1);
    expect(pass1.every((t) => t.event.start >= 1)).toBe(true);
    expect(pass1[0]!.time).toBe(3);
    expect(pass1[0]!.event.start).toBe(1);
    // continuity: the body repeats every `loopLength`
    const body0 = all.filter((t) => t.pass === 0 && t.event.start >= 1).map((t) => t.time);
    expect(pass1.map((t) => t.time)).toEqual(body0.map((x) => x + 2));
  });

  it('keeps the demo song seamless across its intro + loop structure', () => {
    const song = compileSong(demo);
    const cursor = new SongCursor(song, 0);
    const total = song.duration + song.loopLength * 2;
    const all = cursor.drain(total);
    const body = song.events.filter((e) => e.start >= song.loopStart);
    expect(all.length).toBe(song.events.length + body.length * 2);
    // the first event of the loop starts at duration + 0 (loopStart maps back onto itself)
    const firstOfLoop = all.find((t) => t.pass === 1)!;
    expect(firstOfLoop.event.start).toBeGreaterThanOrEqual(song.loopStart);
    expect(firstOfLoop.time).toBeCloseTo(song.duration + (firstOfLoop.event.start - song.loopStart), 9);
  });

  it('does not hang on a song with nothing to play', () => {
    const song = compileSong(
      makeDef({ patterns: { A: { melody: '. . . .' } }, order: ['A'] }),
    );
    expect(song.events).toHaveLength(0);
    const cursor = new SongCursor(song, 0);
    expect(cursor.drain(1000)).toEqual([]);
    expect(cursor.drain(5000, 4000)).toEqual([]);
  });
});

describe('fast-forward (stall recovery)', () => {
  it('skips events before notBefore without returning them, and quickly', () => {
    const song = compileSong(makeDef());
    const cursor = new SongCursor(song, 0);
    const started = performance.now();
    const items = cursor.drain(1_000_000 + 1, 1_000_000);
    expect(performance.now() - started).toBeLessThan(500);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((t) => t.time >= 1_000_000 && t.time < 1_000_001)).toBe(true);
  });

  it('continues normally after a fast-forward', () => {
    const song = compileSong(makeDef());
    const cursor = new SongCursor(song, 0);
    cursor.drain(50.5, 50);
    const next = cursor.drain(51.5);
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((t) => t.time >= 50.5 && t.time < 51.5)).toBe(true);
  });

  it('serial numbers stay unique and increasing after a jump', () => {
    const song = compileSong(makeDef());
    const cursor = new SongCursor(song, 0);
    const items = [...cursor.drain(100.5, 100), ...cursor.drain(103)];
    for (let i = 1; i < items.length; i++) expect(items[i]!.serial).toBeGreaterThan(items[i - 1]!.serial);
  });
});

describe('non-looping songs', () => {
  it('finishes after the last event and reports its end time', () => {
    const song = compileSong(makeDef({ loop: false }));
    const cursor = new SongCursor(song, 2);
    expect(cursor.finished).toBe(false);
    expect(cursor.endTime).toBe(3);
    const all = cursor.drain(100);
    expect(all).toHaveLength(song.events.length);
    expect(all.every((t) => t.pass === 0)).toBe(true);
    // finished is reported on the next poll after everything was handed out
    cursor.drain(101);
    expect(cursor.finished).toBe(true);
    expect(cursor.drain(1e9)).toEqual([]);
  });

  it('does not report finished while events are still pending', () => {
    const song = compileSong(makeDef({ loop: false }));
    const cursor = new SongCursor(song, 0);
    cursor.drain(0.4);
    expect(cursor.finished).toBe(false);
  });
});
