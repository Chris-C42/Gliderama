import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  LIMITER_MAKEUP_COMPENSATION,
  LOOKAHEAD_SECONDS,
  MUSIC_BUS_GAIN,
  SCHEDULE_INTERVAL_MS,
  SFX_BUS_GAIN,
  volumeToGain,
} from '../src/audio/engine';
import { FakeCompressor, FakeGain, FakeSource, flush, makeFakeEnv } from './audio-fake-context';

/** The engine hands out real WebAudio types; in these tests they are always the fakes. */
const g = (node: unknown): FakeGain => node as FakeGain;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('volumeToGain', () => {
  it('maps 0..1 through a perceptual (squared) curve', () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0.5)).toBe(0.25);
    expect(volumeToGain(0.5)).toBeCloseTo(10 ** (-12 / 20), 1); // about -12 dB
  });

  it('clamps and tolerates garbage', () => {
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(5)).toBe(1);
    expect(volumeToGain(NaN)).toBe(0);
    let prev = -1;
    for (let v = 0; v <= 1; v += 0.05) {
      const g = volumeToGain(v);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });
});

describe('timing constants', () => {
  it('schedules with a ~25 ms timer and ~120 ms lookahead', () => {
    expect(SCHEDULE_INTERVAL_MS).toBe(25);
    expect(LOOKAHEAD_SECONDS).toBeCloseTo(0.12, 6);
    // the lookahead must cover several timer ticks, or a late tick would drop notes
    expect(LOOKAHEAD_SECONDS * 1000).toBeGreaterThanOrEqual(3 * SCHEDULE_INTERVAL_MS);
  });
});

describe('outside a browser / without WebAudio', () => {
  it('everything is a harmless no-op with the default (node) environment', async () => {
    const engine = new AudioEngine();
    expect(await engine.unlock()).toBe(false);
    expect(engine.isUnlocked()).toBe(false);
    expect(engine.state).toBe('none');
    expect(engine.now()).toBe(0);
    expect(() => {
      engine.setMusicVolume(0.3);
      engine.setSfxVolume(0.3);
      engine.autoUnlock();
      engine.tick();
      engine.dispose();
    }).not.toThrow();
  });

  it('unlock resolves false when the environment has no AudioContext', async () => {
    const fake = makeFakeEnv({ webAudio: false });
    const engine = new AudioEngine(fake.env);
    expect(await engine.unlock()).toBe(false);
    expect(fake.contexts).toHaveLength(0);
    const cb = vi.fn();
    engine.whenRunning(cb);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('unlock', () => {
  it('creates the AudioContext lazily, only on unlock', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    engine.setMusicVolume(0.4);
    engine.setSfxVolume(0.7);
    engine.onTick(() => undefined);
    expect(fake.contexts).toHaveLength(0);
    expect(engine.state).toBe('none');
    expect(engine.isUnlocked()).toBe(false);

    expect(await engine.unlock()).toBe(true);
    expect(fake.contexts).toHaveLength(1);
    expect(fake.ctx.options).toEqual({ latencyHint: 'interactive' });
    expect(engine.state).toBe('running');
    expect(engine.isUnlocked()).toBe(true);
  });

  it('is idempotent: repeated unlocks reuse the one context', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    expect(await engine.unlock()).toBe(true);
    expect(await engine.unlock()).toBe(true);
    expect(fake.contexts).toHaveLength(1);
  });

  it('iOS: calls resume() synchronously inside the gesture and starts a 1-sample silent buffer', () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    void engine.unlock(); // note: not awaited, nothing has had a chance to run yet
    const ctx = fake.ctx;
    expect(ctx.resumeCalls).toBe(1);
    const silent = ctx.bufferSources().find((s) => s.buffer?.length === 1);
    expect(silent).toBeDefined();
    expect(silent!.startCalls).toEqual([{ when: 0, offset: undefined }]);
    expect(silent!.connections).toContain(ctx.destination);
  });

  it('reports failure when the browser refuses to resume, and recovers when it later runs', async () => {
    const fake = makeFakeEnv({ resume: 'refuse' });
    const engine = new AudioEngine(fake.env);
    const ready = vi.fn();
    engine.whenRunning(ready);
    expect(await engine.unlock()).toBe(false);
    expect(engine.isUnlocked()).toBe(false);
    expect(ready).not.toHaveBeenCalled();
    fake.ctx.setState('running'); // the browser starts it later (e.g. after a real gesture)
    expect(engine.isUnlocked()).toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it('stays unlocked after the context is suspended', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    fake.ctx.setState('suspended');
    expect(engine.isUnlocked()).toBe(true);
    expect(engine.state).toBe('suspended');
  });
});

describe('canSchedule', () => {
  it('is false before unlock, true while running, and false when suspended', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    expect(engine.canSchedule).toBe(false);
    await engine.unlock();
    expect(engine.canSchedule).toBe(true);
    fake.ctx.setState('suspended');
    expect(engine.canSchedule).toBe(false);
  });

  it('is true while an unlock is still in flight, so the unlocking tap can play its own sound', async () => {
    const fake = makeFakeEnv({ resume: 'refuse' }); // resume() leaves the context suspended
    const engine = new AudioEngine(fake.env);
    const pending = engine.unlock();
    expect(engine.canSchedule).toBe(true);
    expect(await pending).toBe(false);
    expect(engine.canSchedule).toBe(false); // refused: nothing more is accepted
  });
});

describe('old Safari (resume/suspend/close return undefined, not a promise)', () => {
  it('still unlocks, suspends, resumes and disposes without throwing', async () => {
    const fake = makeFakeEnv({ legacyPromises: true });
    const engine = new AudioEngine(fake.env);
    expect(await engine.unlock()).toBe(true);
    expect(engine.isUnlocked()).toBe(true);

    fake.doc.hidden = true;
    expect(() => fake.fireDocument('visibilitychange')).not.toThrow();
    expect(fake.ctx.state).toBe('suspended');
    fake.doc.hidden = false;
    expect(() => fake.fireDocument('visibilitychange')).not.toThrow();
    expect(fake.ctx.state).toBe('running');

    fake.ctx.setState('interrupted');
    expect(() => fake.fireWindow('touchend')).not.toThrow();
    expect(fake.ctx.state).toBe('running');
    expect(() => engine.dispose()).not.toThrow();
    expect(fake.ctx.closeCalls).toBe(1);
  });
});

describe('refused or stuck unlocks', () => {
  it('stops accepting sounds if resume() never settles (iOS outside a gesture)', async () => {
    const fake = makeFakeEnv({ resume: 'refuse' });
    const engine = new AudioEngine(fake.env);
    void engine.unlock();
    expect(engine.canSchedule).toBe(true);
    // the engine asked the environment to end the "starting" window after a short while
    const timeouts = fake.deferred.filter((d) => d.ms >= 100);
    expect(timeouts.length).toBeGreaterThan(0);
    for (const d of timeouts) d.fn();
    expect(engine.canSchedule).toBe(false);
  });

  it('a later gesture rescues an unlock that was refused the first time', async () => {
    const fake = makeFakeEnv({ resume: 'refuse' });
    const engine = new AudioEngine(fake.env);
    expect(await engine.unlock()).toBe(false);
    expect(engine.isUnlocked()).toBe(false);
    fake.ctx.resumeBehaviour = 'run'; // now a real gesture arrives
    fake.fireWindow('touchend');
    expect(fake.ctx.state).toBe('running');
    expect(engine.isUnlocked()).toBe(true);
  });
});

describe('mixer graph', () => {
  it('routes music bus + sfx bus -> master gain -> limiter -> destination', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const { musicBus, sfxBus, master, limiter } = engine;
    expect(musicBus).toBeInstanceOf(FakeGain);
    expect(g(musicBus).connections).toContain(master);
    expect(g(sfxBus).connections).toContain(master);
    expect(g(master).connections).toEqual([limiter]);
    expect(limiter).toBeInstanceOf(FakeCompressor);
    expect((limiter as unknown as FakeCompressor).connections).toEqual([fake.ctx.destination]);
  });

  it('puts a gentle limiter on the master, with makeup-gain compensation', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const lim = engine.limiter as unknown as FakeCompressor;
    expect(lim.threshold.value).toBeLessThan(0);
    expect(lim.threshold.value).toBeGreaterThanOrEqual(-12);
    expect(lim.ratio.value).toBeGreaterThanOrEqual(8);
    expect(lim.attack.value).toBeLessThanOrEqual(0.01);
    expect(lim.release.value).toBeGreaterThan(0.05);
    expect(g(engine.master).gain.value).toBe(LIMITER_MAKEUP_COMPENSATION);
    expect(LIMITER_MAKEUP_COMPENSATION).toBeLessThan(1);
  });

  it('applies the default volumes through the perceptual curve', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    expect(engine.getMusicVolume()).toBe(DEFAULT_MUSIC_VOLUME);
    expect(engine.getSfxVolume()).toBe(DEFAULT_SFX_VOLUME);
    expect(g(engine.musicBus).gain.value).toBeCloseTo(volumeToGain(DEFAULT_MUSIC_VOLUME) * MUSIC_BUS_GAIN, 12);
    expect(g(engine.sfxBus).gain.value).toBeCloseTo(volumeToGain(DEFAULT_SFX_VOLUME) * SFX_BUS_GAIN, 12);
  });

  it('remembers volumes set before unlock and applies them when the graph is built', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    engine.setMusicVolume(0.2);
    engine.setSfxVolume(1);
    await engine.unlock();
    expect(g(engine.musicBus).gain.value).toBeCloseTo(0.04 * MUSIC_BUS_GAIN, 12);
    expect(g(engine.sfxBus).gain.value).toBeCloseTo(SFX_BUS_GAIN, 12);
  });

  it('smooths volume changes (no zipper noise) and clamps to 0..1', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    engine.setMusicVolume(0.5);
    const last = g(engine.musicBus).gain.last('target')!;
    expect(last.value).toBeCloseTo(0.25 * MUSIC_BUS_GAIN, 12);
    expect(last.timeConstant).toBeGreaterThan(0);
    engine.setMusicVolume(7);
    expect(engine.getMusicVolume()).toBe(1);
    engine.setSfxVolume(-3);
    expect(engine.getSfxVolume()).toBe(0);
    engine.setSfxVolume(NaN);
    expect(engine.getSfxVolume()).toBe(0);
  });

  it('calls resume() before doing any warm-up work (nothing may delay the call inside the gesture)', () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    const order: string[] = [];
    const Ctor = fake.env.audioContextCtor()! as unknown as { prototype: Record<string, (...a: unknown[]) => unknown> };
    const originalResume = Ctor.prototype.resume!;
    const originalWave = Ctor.prototype.createPeriodicWave!;
    Ctor.prototype.resume = function (this: unknown) {
      order.push('resume');
      return originalResume.call(this);
    };
    Ctor.prototype.createPeriodicWave = function (this: unknown, ...args: unknown[]) {
      order.push('wave');
      return originalWave.apply(this, args);
    };
    void engine.unlock();
    expect(order[0]).toBe('resume');
    expect(order).toContain('wave'); // the warm-up did run, right after
  });

  it('pre-builds the chip waves and noise buffers at unlock (off the scheduler path)', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    // 5 PeriodicWaves are created by warmUp; the big loop buffers are deferred to later tasks
    expect(fake.deferred.length).toBeGreaterThan(0);
    const before = fake.ctx.nodes.length;
    fake.runDeferred();
    expect(fake.deferred).toHaveLength(0);
    expect(fake.ctx.nodes.length).toBe(before); // buffers are not nodes; nothing else was created
  });
});

describe('page visibility', () => {
  it('suspends when the page is hidden and resumes when it is visible again', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    expect(fake.docListenerCount('visibilitychange')).toBe(1);
    const ctx = fake.ctx;
    const resumes = ctx.resumeCalls;

    fake.doc.hidden = true;
    fake.fireDocument('visibilitychange');
    expect(ctx.suspendCalls).toBe(1);
    expect(ctx.state).toBe('suspended');

    fake.doc.hidden = false;
    fake.fireDocument('visibilitychange');
    expect(ctx.resumeCalls).toBe(resumes + 1);
    expect(ctx.state).toBe('running');
  });

  it('only resumes if the context was running before it was hidden', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const ctx = fake.ctx;
    ctx.state = 'suspended'; // suspended for some other reason before the page got hidden
    const resumes = ctx.resumeCalls;

    fake.doc.hidden = true;
    fake.fireDocument('visibilitychange');
    expect(ctx.suspendCalls).toBe(0);
    fake.doc.hidden = false;
    fake.fireDocument('visibilitychange');
    expect(ctx.resumeCalls).toBe(resumes);
  });

  it('does not suspend twice or resume twice for repeated events', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const ctx = fake.ctx;
    const resumes = ctx.resumeCalls;
    fake.doc.hidden = true;
    fake.fireDocument('visibilitychange');
    fake.fireDocument('visibilitychange');
    expect(ctx.suspendCalls).toBe(1);
    fake.doc.hidden = false;
    fake.fireDocument('visibilitychange');
    fake.fireDocument('visibilitychange');
    expect(ctx.resumeCalls).toBe(resumes + 1);
  });

  it('does nothing before unlock', () => {
    const fake = makeFakeEnv();
    new AudioEngine(fake.env);
    expect(fake.docListenerCount('visibilitychange')).toBe(0);
  });
});

describe('interruptions (iOS)', () => {
  it('resumes on the next user gesture when the context is not running', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const ctx = fake.ctx;
    const resumes = ctx.resumeCalls;

    fake.fireWindow('pointerup');
    expect(ctx.resumeCalls).toBe(resumes); // running: nothing to do

    ctx.setState('interrupted');
    fake.fireWindow('touchend');
    expect(ctx.resumeCalls).toBe(resumes + 1);
    expect(ctx.state).toBe('running');
  });

  it('does not resume from a gesture while the page is hidden', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const ctx = fake.ctx;
    fake.doc.hidden = true;
    fake.fireDocument('visibilitychange'); // suspended by us
    const resumes = ctx.resumeCalls;
    fake.fireWindow('keydown');
    expect(ctx.resumeCalls).toBe(resumes);
  });

  it('retries resume on the gesture after a refused resume at visibility time', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const ctx = fake.ctx;
    fake.doc.hidden = true;
    fake.fireDocument('visibilitychange');
    ctx.resumeBehaviour = 'refuse';
    fake.doc.hidden = false;
    fake.fireDocument('visibilitychange'); // refused
    expect(ctx.state).toBe('suspended');
    ctx.resumeBehaviour = 'run';
    fake.fireWindow('click'); // the user taps: it comes back
    expect(ctx.state).toBe('running');
  });
});

describe('scheduler timer', () => {
  it('creates one 25 ms interval for any number of tickers and clears it with the last one', () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    expect(fake.intervals.size).toBe(0);
    const off1 = engine.onTick(() => undefined);
    const off2 = engine.onTick(() => undefined);
    expect(fake.intervals.size).toBe(1);
    expect([...fake.intervals.values()][0]!.ms).toBe(SCHEDULE_INTERVAL_MS);
    off1();
    expect(fake.intervals.size).toBe(1);
    off2();
    expect(fake.intervals.size).toBe(0);
    off2(); // harmless
  });

  it('calls tickers with the audio-clock time only while audio is running', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    const seen: number[] = [];
    engine.onTick((now) => seen.push(now));
    engine.tick();
    expect(seen).toEqual([]); // not unlocked

    await engine.unlock();
    fake.ctx.currentTime = 1.5;
    engine.tick();
    fake.ctx.currentTime = 1.525;
    [...fake.intervals.values()][0]!.fn(); // the real timer path
    expect(seen).toEqual([1.5, 1.525]);

    fake.ctx.setState('suspended');
    fake.ctx.currentTime = 9;
    engine.tick();
    expect(seen).toHaveLength(2);
  });

  it('isolates a failing ticker from the others', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    engine.onTick(() => {
      throw new Error('boom');
    });
    engine.onTick(good);
    engine.tick();
    expect(good).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });
});

describe('whenRunning', () => {
  it('runs queued callbacks once, after the context starts', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    const a = vi.fn();
    const b = vi.fn();
    engine.whenRunning(a);
    engine.whenRunning(b);
    expect(a).not.toHaveBeenCalled();
    await engine.unlock();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a.mock.calls[0]![0]).toBe(fake.ctx);
    fake.ctx.setState('suspended');
    fake.ctx.setState('running');
    expect(a).toHaveBeenCalledTimes(1); // not again
  });

  it('runs immediately when audio is already running', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const cb = vi.fn();
    engine.whenRunning(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('survives a throwing callback', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    engine.whenRunning(() => {
      throw new Error('boom');
    });
    engine.whenRunning(after);
    await engine.unlock();
    expect(after).toHaveBeenCalled();
  });
});

describe('autoUnlock', () => {
  it('unlocks on the first gesture and then removes its listeners', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    engine.autoUnlock();
    engine.autoUnlock(); // no duplicates
    expect(fake.winListenerCount('pointerup')).toBe(1);
    expect(fake.contexts).toHaveLength(0);

    fake.fireWindow('pointerup');
    expect(fake.contexts).toHaveLength(1);
    await flush();
    expect(engine.isUnlocked()).toBe(true);
    // its own listeners are gone (the engine keeps one listener per event for interruption recovery)
    expect(fake.winListenerCount('pointerup')).toBe(1);
    fake.fireWindow('pointerup');
    expect(fake.contexts).toHaveLength(1);
  });

  it('does nothing when already unlocked', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    const before = fake.winListenerCount('pointerup');
    engine.autoUnlock();
    expect(fake.winListenerCount('pointerup')).toBe(before);
  });
});

describe('dispose', () => {
  it('releases the timer, the listeners and the context', async () => {
    const fake = makeFakeEnv();
    const engine = new AudioEngine(fake.env);
    await engine.unlock();
    engine.onTick(() => undefined);
    const ctx = fake.ctx;
    engine.dispose();
    expect(fake.intervals.size).toBe(0);
    expect(fake.docListenerCount('visibilitychange')).toBe(0);
    expect(fake.winListenerCount('pointerup')).toBe(0);
    expect(ctx.closeCalls).toBe(1);
    expect(engine.isUnlocked()).toBe(false);
    expect(engine.state).toBe('none');
  });
});

describe('type sanity', () => {
  it('fake sources are what the engine creates for the silent buffer', async () => {
    const fake = makeFakeEnv();
    await new AudioEngine(fake.env).unlock();
    expect(fake.ctx.bufferSources().every((s) => s instanceof FakeSource)).toBe(true);
  });
});
