import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, LOOKAHEAD_SECONDS } from '../src/audio/engine';
import { MusicPlayer, renderSong } from '../src/audio/music';
import { compileSong, type SongDef } from '../src/audio/notation';
import { SongCursor } from '../src/audio/sequencer';
import { FakeGain, FakePanner, FakeSource, makeFakeEnv, type FakeContext } from './audio-fake-context';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 120 bpm (0.125 s per step). One pass is 1 s with 9 events: 4 melody, 1 bass, 4 kick. */
function makeDef(overrides: Partial<SongDef> = {}): SongDef {
  return {
    bpm: 120,
    instruments: {
      lead: { wave: 'pulse25', env: { a: 0, d: 0, s: 1, r: 0.05 }, vol: 0.5 },
      bass: { wave: 'triangle' },
      kick: { wave: 'triangle', env: { a: 0, d: 0.1, s: 0, r: 0 } },
    },
    tracks: { melody: 'lead', low: 'bass', beat: { k: 'kick' } },
    patterns: { A: { melody: 'C4 - D4 - E4 - F4 -', low: 'C2 - - - - - - -', beat: 'k . k . k . k .' } },
    order: ['A'],
    ...overrides,
  };
}

async function setup(unlocked = true) {
  const fake = makeFakeEnv();
  const engine = new AudioEngine(fake.env);
  const music = new MusicPlayer(engine);
  if (unlocked) await engine.unlock();
  const ctx = (): FakeContext => fake.ctx;
  /** Fade gains of the running playbacks (the nodes that feed the music bus). */
  const fades = (): FakeGain[] => ctx().gains().filter((gain) => gain.connections.includes(engine.musicBus as unknown as FakeGain));
  /** Advances the audio clock in 25 ms steps, running the scheduler like the real timer. */
  const advance = (seconds: number): void => {
    const end = ctx().currentTime + seconds;
    while (ctx().currentTime < end - 1e-9) {
      ctx().currentTime = Math.min(end, ctx().currentTime + 0.025);
      engine.tick();
    }
  };
  return { fake, engine, music, ctx, fades, advance };
}

/** Start times of all note voices, sorted. */
const startTimes = (ctx: FakeContext): number[] =>
  ctx
    .voices()
    .map((v) => v.startTime!)
    .sort((a, b) => a - b);

describe('before unlock', () => {
  it('remembers the request without making any sound, and starts once audio runs', async () => {
    const { fake, engine, music } = await setup(false);
    const def = makeDef();
    music.play(def);
    expect(music.current()).toBe(def);
    expect(music.isPlaying()).toBe(false);
    expect(fake.contexts).toHaveLength(0);

    await engine.unlock();
    expect(music.isPlaying()).toBe(true);
    expect(fake.ctx.voices().length).toBeGreaterThan(0);
  });

  it('only the latest request starts', async () => {
    const { fake, engine, music } = await setup(false);
    const first = makeDef({ bpm: 100 });
    const second = makeDef({ bpm: 140 });
    music.play(first);
    music.play(second);
    expect(music.current()).toBe(second);
    await engine.unlock();
    expect(fake.ctx.gains().filter((gain) => gain.connections.includes(engine.musicBus as unknown as FakeGain))).toHaveLength(1);
  });

  it('stop() cancels a pending request', async () => {
    const { fake, engine, music } = await setup(false);
    music.play(makeDef());
    music.stop();
    expect(music.current()).toBeNull();
    await engine.unlock();
    expect(music.isPlaying()).toBe(false);
    expect(fake.ctx.voices()).toHaveLength(0);
  });

  it('is a no-op without WebAudio but still remembers the song', () => {
    const fake = makeFakeEnv({ webAudio: false });
    const music = new MusicPlayer(new AudioEngine(fake.env));
    const def = makeDef();
    expect(() => music.play(def)).not.toThrow();
    expect(music.current()).toBe(def);
    expect(() => music.stop()).not.toThrow();
    expect(music.current()).toBeNull();
  });

  it('ignores an invalid song with a helpful message instead of throwing', async () => {
    const { music } = await setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = makeDef({ patterns: { A: { melody: 'C4 - H9 -' } } });
    expect(() => music.play(bad)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![1])).toMatch(/Pattern "A", track "melody", step 3/);
    expect(music.current()).toBeNull();
    expect(music.isPlaying()).toBe(false);
  });
});

describe('scheduling', () => {
  it('schedules the first window at the exact start time, a little in the future', async () => {
    const { music, ctx } = await setup();
    music.play(makeDef());
    // origin = now (0) + 60 ms: melody C4, bass C2 and kick all start there
    expect(startTimes(ctx())).toEqual([0.06, 0.06, 0.06]);
  });

  it('schedules only ~120 ms ahead of the audio clock', async () => {
    const { music, ctx, advance } = await setup();
    music.play(makeDef());
    advance(0.2); // clock = 0.2: window is < 0.32, so the events at 0.31 are in
    expect(startTimes(ctx())).toEqual([0.06, 0.06, 0.06, 0.31, 0.31]);
    // nothing is scheduled beyond now + lookahead
    expect(Math.max(...startTimes(ctx()))).toBeLessThan(ctx().currentTime + LOOKAHEAD_SECONDS);
  });

  it('starts every event exactly once, at exactly origin + start + pass x length, over many loops', async () => {
    const { music, ctx, advance } = await setup();
    music.play(makeDef());
    advance(7.5);
    const horizon = ctx().currentTime + LOOKAHEAD_SECONDS;
    const expected = new SongCursor(compileSong(makeDef()), 0.06)
      .drain(horizon)
      .map((item) => item.time)
      .sort((a, b) => a - b);
    expect(expected.length).toBeGreaterThan(60);
    expect(startTimes(ctx())).toEqual(expected);
  });

  it('keeps the tempo through the loop point (no gap, no double hit)', async () => {
    const { music, ctx, advance } = await setup();
    music.play(makeDef());
    advance(3);
    const kicks = ctx()
      .voices()
      .filter((v) => v.periodicWave !== null || true)
      .map((v) => v.startTime!)
      .filter((t, i, all) => all.indexOf(t) === i)
      .sort((a, b) => a - b);
    // events are on the quarter-note grid of 0.25 s relative to the origin, across passes
    for (const t of kicks) expect((t - 0.06) / 0.25).toBeCloseTo(Math.round((t - 0.06) / 0.25), 9);
    // the first event of pass 1 is exactly 1 s after the first event of pass 0
    expect(kicks).toContain(1.06);
  });

  it('applies the song volume to the playback gain', async () => {
    const { music, fades } = await setup();
    music.play(makeDef({ volume: 0.5 }));
    expect(fades()[0]!.gain.value).toBe(0.5);
  });

  it('fades in when asked', async () => {
    const { music, fades } = await setup();
    music.play(makeDef(), { fadeIn: 1 });
    const gain = fades()[0]!.gain;
    expect(gain.events[0]).toMatchObject({ type: 'set', value: 0 });
    expect(gain.events[1]).toMatchObject({ type: 'linear', value: 1 });
    expect(gain.events[1]!.time).toBeCloseTo(1.06, 9);
  });

  it('routes panned instruments through a stereo panner', async () => {
    const { music, ctx } = await setup();
    music.play(makeDef({ instruments: { ...makeDef().instruments, lead: { wave: 'pulse25', pan: -0.5 } } }));
    const panner = ctx().nodes.find((n): n is FakePanner => n.kind === 'panner')!;
    expect(panner.pan.value).toBe(-0.5);
    const lead = ctx().voices()[0]!;
    // oscillator -> env gain -> cut gain -> panner
    const env = lead.connections[0] as FakeGain;
    const cut = env.connections[0] as FakeGain;
    expect(cut.connections).toContain(panner);
  });
});

describe('monophonic channels', () => {
  it('a new note cuts the tail of the previous note in the same channel', async () => {
    const { music, ctx, advance } = await setup();
    music.play(makeDef({ patterns: { A: { melody: 'C4 D4 E4 F4 G4 A4 B4 C5' } } }));
    advance(0.15);
    const [first, second] = ctx().voices().filter((v) => v.type === 'custom').slice(0, 2) as [FakeSource, FakeSource];
    expect(first.startTime).toBeCloseTo(0.06, 9);
    expect(second.startTime).toBeCloseTo(0.185, 9);
    // the first voice was cut at the start of the second one
    const cutGain = (first.connections[0] as FakeGain).connections[0] as FakeGain;
    const ramp = cutGain.gain.last('linear')!;
    expect(ramp.value).toBe(0);
    expect(ramp.time).toBeGreaterThan(0.185);
    expect(ramp.time).toBeLessThan(0.2);
    expect(first.lastStop!).toBeLessThan(0.2);
  });

  it('lets a note ring out its release when there is a rest after it', async () => {
    const { music, ctx, advance } = await setup();
    music.play(makeDef({ patterns: { A: { melody: 'C4 . . . D4 . . .' } } }));
    advance(0.7);
    const first = ctx().voices().find((v) => v.type === 'custom')!;
    const cutGain = (first.connections[0] as FakeGain).connections[0] as FakeGain;
    expect(cutGain.gain.events).toEqual([]); // never cut
  });
});

describe('replacing, crossfading and stopping', () => {
  it('playing the current song again does nothing, unless restart is set', async () => {
    const { music, fades } = await setup();
    const def = makeDef();
    music.play(def);
    music.play(def);
    expect(fades()).toHaveLength(1);
    music.play(def, { restart: true });
    expect(fades()).toHaveLength(2); // the old one is fading out
  });

  it('a different song replaces the old one with a short fade-out', async () => {
    const { music, fades, ctx } = await setup();
    const a = makeDef();
    const b = makeDef({ bpm: 100 });
    music.play(a);
    ctx().currentTime = 1;
    music.play(b);
    expect(music.current()).toBe(b);
    const [old, fresh] = fades() as [FakeGain, FakeGain];
    const fadeOut = old.gain.last('linear')!;
    expect(fadeOut.value).toBe(0);
    expect(fadeOut.time).toBeCloseTo(1.12, 9);
    expect(fresh.gain.value).toBe(1);
  });

  it('crossfadeTo fades the old song out and the new one in over the same time', async () => {
    const { music, fades, ctx } = await setup();
    const a = makeDef();
    const b = makeDef({ bpm: 100 });
    music.play(a);
    ctx().currentTime = 2;
    music.crossfadeTo(b, 3);
    expect(music.current()).toBe(b);
    const [old, fresh] = fades() as [FakeGain, FakeGain];
    expect(old.gain.last('linear')).toMatchObject({ value: 0 });
    expect(old.gain.last('linear')!.time).toBeCloseTo(5, 9);
    expect(fresh.gain.events[0]).toMatchObject({ type: 'set', value: 0 });
    expect(fresh.gain.events[1]).toMatchObject({ type: 'linear', value: 1 });
    expect(fresh.gain.events[1]!.time).toBeCloseTo(5.06, 9);
  });

  it('releases the old playback (and its timer) once its fade is over', async () => {
    const { music, fades, fake, advance } = await setup();
    music.play(makeDef());
    advance(0.3);
    music.stop({ fadeOut: 0.5 });
    expect(music.isPlaying()).toBe(false);
    expect(music.current()).toBeNull();
    const fade = fades()[0]!;
    expect(fade.gain.last('linear')).toMatchObject({ value: 0 });
    expect(fade.disconnected).toBe(false); // still fading
    advance(0.4);
    expect(fade.disconnected).toBe(false);
    advance(0.4);
    expect(fade.disconnected).toBe(true);
    expect(fake.intervals.size).toBe(0); // no ticker left: the timer stopped itself
  });

  it('stops scheduling new notes as soon as it is stopped', async () => {
    const { music, ctx, advance } = await setup();
    music.play(makeDef());
    advance(0.3);
    const before = ctx().voices().length;
    music.stop();
    advance(1.5);
    expect(ctx().voices().length).toBe(before);
  });

  it('cuts a still-sounding voice at the end of the fade, and leaves already-finished ones alone', async () => {
    const { music, ctx, advance } = await setup();
    // one long bass note (1 s): still sounding when the 0.2 s fade ends
    music.play(makeDef({ patterns: { A: { melody: '. . . . . . . .', low: 'C2 - - - - - - -' } } }));
    advance(0.5);
    music.stop({ fadeOut: 0.2 });
    const [bass] = ctx().voices();
    const cutGain = (bass!.connections[0] as FakeGain).connections[0] as FakeGain;
    const ramp = cutGain.gain.last('linear')!;
    expect(ramp.value).toBe(0);
    expect(ramp.time).toBeCloseTo(0.5 + 0.2 + 0.004, 9); // fade end + the short click-free fade
    expect(bass!.lastStop!).toBeCloseTo(0.5 + 0.2 + 0.009, 9);

    // a voice that had already finished by then is not touched
    const { music: music2, ctx: ctx2, advance: advance2 } = await setup();
    music2.play(makeDef({ patterns: { A: { melody: 'C4 . . . . . . .', low: '. . . . . . . .' } } }));
    advance2(0.5);
    music2.stop({ fadeOut: 0.2 });
    const note = ctx2().voices()[0]!;
    expect(((note.connections[0] as FakeGain).connections[0] as FakeGain).gain.events).toEqual([]);
  });
});

describe('stall recovery', () => {
  it('after a long main-thread stall it catches up without a burst of old notes', async () => {
    const { music, ctx, engine } = await setup();
    music.play(makeDef());
    const before = ctx().voices().length;
    ctx().currentTime = 10; // 10 s pass without a tick
    engine.tick();
    const fresh = ctx().voices().slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.length).toBeLessThanOrEqual(6);
    for (const v of fresh) expect(v.startTime!).toBeGreaterThanOrEqual(10 - 1e-9);
  });

  it('starts a slightly late note immediately instead of dropping it', async () => {
    const { music, ctx, engine } = await setup();
    music.play(makeDef());
    ctx().currentTime = 0.22; // the 0.31 s events are on time; now jump so that 0.31 is 40 ms late
    engine.tick();
    const n = ctx().voices().length;
    ctx().currentTime = 0.35;
    engine.tick();
    const late = ctx().voices().slice(n).filter((v) => v.startTime! <= 0.351);
    expect(late.every((v) => v.startTime! >= 0.35 - 1e-9)).toBe(true);
  });
});

describe('non-looping songs', () => {
  it('calls onEnd once after the song has finished sounding, then forgets it', async () => {
    const { music, fades, advance } = await setup();
    const onEnd = vi.fn();
    const def = makeDef({ loop: false });
    music.play(def, { onEnd });
    const fade = fades()[0]!;
    advance(0.9);
    expect(onEnd).not.toHaveBeenCalled();
    expect(music.isPlaying()).toBe(true);
    advance(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(music.isPlaying()).toBe(false);
    expect(music.current()).toBeNull();
    expect(fade.disconnected).toBe(true);
    advance(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('can be replayed after it ended', async () => {
    const { music, advance } = await setup();
    const def = makeDef({ loop: false });
    music.play(def);
    advance(2.5);
    expect(music.isPlaying()).toBe(false);
    music.play(def);
    expect(music.isPlaying()).toBe(true);
  });
});

describe('position', () => {
  it('reports the position within the current pass (wrapping at the loop)', async () => {
    const { music, ctx } = await setup();
    expect(music.position()).toBeNull();
    music.play(makeDef());
    ctx().currentTime = 0.56;
    expect(music.position()).toBeCloseTo(0.5, 9);
    ctx().currentTime = 2.31; // 2.25 s after the origin: the third pass, 0.25 s in
    expect(music.position()).toBeCloseTo(0.25, 9);
  });

  it('honours loopStart when wrapping', async () => {
    const { music, ctx } = await setup();
    const def = makeDef({
      patterns: { A: { melody: 'C4 - - - - - - -' }, B: { melody: 'D4 - - - - - - -' } },
      order: ['A', 'B'],
      loopStart: 1,
    });
    music.play(def);
    ctx().currentTime = 0.06 + 2.5; // intro 1 s + body 1 s -> 0.5 s into the second pass of the body
    expect(music.position()).toBeCloseTo(1.5, 9);
  });
});

describe('renderSong (offline rendering)', () => {
  it('schedules a whole stretch of a song on any context, looping as needed', () => {
    const fake = makeFakeEnv();
    const Ctor = fake.env.audioContextCtor()!;
    const ctx = new Ctor() as unknown as FakeContext;
    const compiled = renderSong(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeDef(), 2.5);
    expect(compiled.duration).toBe(1);
    const times = startTimes(ctx);
    // two full passes (18 events) plus the events of pass 3 that start before 2.5 s: at 0 and 0.25
    expect(times).toHaveLength(18 + 5);
    expect(times[0]).toBe(0);
    expect(Math.max(...times)).toBeLessThan(2.5);
  });

  it('applies the song volume', () => {
    const fake = makeFakeEnv();
    const ctx = new (fake.env.audioContextCtor()!)() as unknown as FakeContext;
    renderSong(ctx as unknown as BaseAudioContext, ctx.destination as unknown as AudioNode, makeDef({ volume: 0.25 }), 1);
    const out = ctx.gains().find((gain) => gain.connections.includes(ctx.destination as unknown as FakeGain))!;
    expect(out.gain.value).toBe(0.25);
  });
});
