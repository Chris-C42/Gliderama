import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import { validateLoopDef } from '../src/audio/loops';
import { envelopeLevelAt } from '../src/audio/plan';
import { SfxPlayer } from '../src/audio/sfx';
import { LOOP_DEFS, SFX_DEFS } from '../src/audio/sfx-defs';
import { NOISE_CLOCK_HZ, planSfx, validateSfxDef, type SfxDef } from '../src/audio/sfx-plan';
import { FakeBiquad, FakeGain, FakePanner, makeFakeEnv, type FakeContext } from './audio-fake-context';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A deterministic "random" source cycling through the given values. */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

const base: SfxDef = { wave: 'pulse50', freq: 440, duration: 0.2, vol: 0.5 };

describe('planSfx: pitch', () => {
  it('plays a steady tone at the given frequency', () => {
    const plan = planSfx(base, {}, seq(0.25));
    expect(plan.voices).toHaveLength(1);
    const v = plan.voices[0]!;
    expect(v).toMatchObject({ wave: 'pulse50', start: 0, gate: 0.2, ref: 440, vibrato: null, filter: null, noiseOffset: 0.25 });
    expect(v.pitch).toEqual([{ t: 0, semis: 0 }]);
    expect(v.env[1]!.v).toBe(0.5);
    expect(plan.duration).toBeCloseTo(0.23, 9); // gate + default release 0.03
  });

  it('slides to endFreq over the duration (or slideTime)', () => {
    expect(planSfx({ ...base, endFreq: 880 }).voices[0]!.pitch).toEqual([
      { t: 0, semis: 0 },
      { t: 0.2, semis: 12 },
    ]);
    expect(planSfx({ ...base, endFreq: 220, slideTime: 0.1 }).voices[0]!.pitch).toEqual([
      { t: 0, semis: 0 },
      { t: 0.1, semis: -12 },
    ]);
  });

  it('shapes the slide with slideCurve (>1: slow start, fast end)', () => {
    const slow = planSfx({ ...base, endFreq: 880, slideCurve: 2 }).voices[0]!.pitch;
    expect(slow).toHaveLength(17);
    expect(slow[0]!.semis).toBe(0);
    expect(slow[8]!.semis).toBeCloseTo(12 * 0.25, 9); // halfway in time = a quarter of the way up
    expect(slow[16]!.semis).toBeCloseTo(12, 9);
    const fast = planSfx({ ...base, endFreq: 880, slideCurve: 0.5 }).voices[0]!.pitch;
    expect(fast[4]!.semis).toBeGreaterThan(12 * 0.25); // quickly gets most of the way
  });

  it('follows a free pitch contour (path replaces endFreq)', () => {
    const keys = planSfx({ ...base, endFreq: 100, path: [[0.1, 880], [0.3, 440]], duration: 0.4 }).voices[0]!.pitch;
    expect(keys.map((k) => [k.t, Math.round(k.semis * 1000) / 1000])).toEqual([
      [0, 0],
      [0.1, 12],
      [0.3, 0],
    ]);
  });

  it('cycles arpeggio steps every interval (a chord)', () => {
    const keys = planSfx({ ...base, duration: 0.1, arp: { steps: [0, 4, 7], interval: 0.03 } }).voices[0]!.pitch;
    expect(keys.map((k) => k.semis)).toEqual([0, 4, 7, 0]);
    expect(keys.every((k) => k.jump)).toBe(true);
  });

  it('steps through arpeggio notes once and holds the last (a jingle)', () => {
    const v = planSfx({ ...base, duration: 0.5, arp: { steps: [0, 7, 12], interval: 0.05, mode: 'once' } }).voices[0]!;
    expect(v.pitch.map((k) => [k.t, k.semis])).toEqual([
      [0, 0],
      [0.05, 7],
      [0.1, 12],
    ]);
  });

  it('retriggers the envelope at each arpeggio step when asked', () => {
    const v = planSfx({
      ...base,
      duration: 0.4,
      env: { a: 0, d: 0.04, s: 0.2, r: 0.05 },
      arp: { steps: [0, 7, 12], interval: 0.1, mode: 'once', retrigger: true },
    }).voices[0]!;
    for (const start of [0.1, 0.2]) {
      expect(envelopeLevelAt(v.env, start - 1e-6)).toBeLessThan(0.05); // silence between notes
      expect(envelopeLevelAt(v.env, start + 0.0011)).toBeGreaterThan(0.45); // fresh attack to the peak
    }
    const plain = planSfx({ ...base, duration: 0.4, env: { a: 0, d: 0.04, s: 0.2, r: 0.05 }, arp: { steps: [0, 7, 12], interval: 0.1, mode: 'once' } }).voices[0]!;
    expect(envelopeLevelAt(plain.env, 0.2)).toBeCloseTo(0.1, 9); // sustain level: no restarts
  });

  it('adds random pitch jitter (plus or minus) on every play', () => {
    const def: SfxDef = { ...base, jitter: 3 };
    const up = planSfx(def, {}, seq(1, 0)).voices[0]!; // jitter roll 1 -> +3 semitones
    const down = planSfx(def, {}, seq(0, 0)).voices[0]!; // roll 0 -> -3
    expect(up.ref).toBeCloseTo(440 * 2 ** (3 / 12), 9);
    expect(down.ref).toBeCloseTo(440 * 2 ** (-3 / 12), 9);
    const middle = planSfx(def, {}, seq(0.5, 0)).voices[0]!;
    expect(middle.ref).toBeCloseTo(440, 9);
  });
});

describe('planSfx: repeat, layers and options', () => {
  it('repeats with an interval, volume decay and pitch step', () => {
    const v = planSfx({ ...base, vol: 1, repeat: { count: 3, interval: 0.1, volDecay: 0.5, pitchStep: 2 } }).voices;
    expect(v.map((x) => x.start)).toEqual([0, 0.1, 0.2]);
    expect(v.map((x) => x.env[1]!.v)).toEqual([1, 0.5, 0.25]);
    expect(v.map((x) => x.ref)).toEqual([440, 440 * 2 ** (2 / 12), 440 * 2 ** (4 / 12)]);
    // the total duration covers the last repeat
    expect(planSfx({ ...base, repeat: { count: 3, interval: 0.1 } }).duration).toBeCloseTo(0.2 + 0.23, 9);
  });

  it('clamps the repeat count', () => {
    expect(planSfx({ ...base, repeat: { count: 1000, interval: 0.01 } }).voices).toHaveLength(64);
    expect(planSfx({ ...base, repeat: { count: 0, interval: 0.01 } }).voices).toHaveLength(1);
  });

  it('plays layers together with the main voice, each with its own delay', () => {
    const plan = planSfx({
      ...base,
      layers: [
        { wave: 'triangle', freq: 220, duration: 0.1, delay: 0.05 },
        { wave: 'noise', freq: 22050, duration: 0.3, vol: 1, delay: 0.1 },
      ],
    });
    expect(plan.voices.map((v) => [v.wave, v.start])).toEqual([
      ['pulse50', 0],
      ['triangle', 0.05],
      ['noise', 0.1],
    ]);
    expect(plan.duration).toBeCloseTo(0.1 + 0.33, 9);
  });

  it('scales volume, pitch and filter cutoffs with the play options', () => {
    const def: SfxDef = { ...base, filter: { type: 'lowpass', freq: 1000, endFreq: 500, time: 0.1 } };
    const v = planSfx(def, { vol: 0.5, pitch: 12 }).voices[0]!;
    expect(v.ref).toBeCloseTo(880, 9);
    expect(v.env[1]!.v).toBeCloseTo(0.25, 12);
    expect(v.filter!.keys[0]!.hz).toBeCloseTo(2000, 9);
    expect(v.filter!.keys[1]!.hz).toBeCloseTo(1000, 9);
  });

  it('applies the def-level gain to every layer', () => {
    const def: SfxDef = { ...base, gain: 2, layers: [{ wave: 'triangle', freq: 220, duration: 0.1, vol: 0.25 }] };
    const v = planSfx(def).voices;
    expect(v[0]!.env[1]!.v).toBe(1);
    expect(v[1]!.env[1]!.v).toBe(0.5);
  });

  it('defaults the volume to 0.5', () => {
    expect(planSfx({ wave: 'pulse50', freq: 440, duration: 0.1 }).voices[0]!.env[1]!.v).toBe(0.5);
  });
});

describe('planSfx: noise, filter and vibrato', () => {
  it('maps the noise frequency to the noise clock (44100 = native)', () => {
    const v = planSfx({ wave: 'noise', freq: NOISE_CLOCK_HZ / 2, duration: 0.1 }).voices[0]!;
    expect(v.ref).toBeCloseTo(0.5, 12);
    expect(planSfx({ wave: 'noise-short', freq: NOISE_CLOCK_HZ, duration: 0.1 }).voices[0]!.ref).toBe(1);
    // pitch shifts scale the clock
    expect(planSfx({ wave: 'noise', freq: NOISE_CLOCK_HZ, duration: 0.1 }, { pitch: -12 }).voices[0]!.ref).toBeCloseTo(0.5, 12);
  });

  it('never gives noise a vibrato', () => {
    const v = planSfx({ wave: 'noise', freq: 10000, duration: 0.3, vibrato: { depth: 1, rate: 8 } }).voices[0]!;
    expect(v.vibrato).toBeNull();
  });

  it('plans a vibrato in cents with its delay, and skips one that would never be heard', () => {
    const v = planSfx({ ...base, duration: 0.5, vibrato: { depth: 0.5, rate: 6, delay: 0.05 } }).voices[0]!;
    expect(v.vibrato).toMatchObject({ cents: 50, rate: 6, onset: 0.05 });
    expect(planSfx({ ...base, duration: 0.05, vibrato: { depth: 0.5, rate: 6, delay: 5 } }).voices[0]!.vibrato).toBeNull();
  });

  it('plans filter sweeps (default time = duration) and static filters', () => {
    const sweep = planSfx({ ...base, filter: { type: 'bandpass', freq: 800, endFreq: 3200, q: 2 } }).voices[0]!.filter!;
    expect(sweep).toEqual({ type: 'bandpass', q: 2, keys: [{ t: 0, hz: 800 }, { t: 0.2, hz: 3200 }] });
    const fixed = planSfx({ ...base, filter: { type: 'highpass', freq: 2000 } }).voices[0]!.filter!;
    expect(fixed).toEqual({ type: 'highpass', q: 0.7, keys: [{ t: 0, hz: 2000 }] });
  });
});

describe('validateSfxDef', () => {
  const bad = (def: unknown, pattern: RegExp) => expect(() => validateSfxDef('thing', def as SfxDef)).toThrow(pattern);

  it('accepts a good definition', () => {
    expect(() => validateSfxDef('ok', base)).not.toThrow();
  });

  it('names the sound and the offending parameter', () => {
    bad({ ...base, wave: 'square' }, /sfx "thing": wave "square" is unknown/);
    bad({ ...base, freq: 0 }, /sfx "thing": freq must be a number between 1/);
    bad({ ...base, duration: 0 }, /duration must be a number between 0\.001/);
    bad({ ...base, endFreq: -5 }, /endFreq/);
    bad({ ...base, vol: 9 }, /vol/);
    bad({ ...base, env: { s: 2 } }, /env\.s/);
    bad({ ...base, arp: { steps: [], interval: 0.1 } }, /arp\.steps must be a non-empty array/);
    bad({ ...base, arp: { steps: [0], interval: 0 } }, /arp\.interval/);
    bad({ ...base, filter: { type: 'notch', freq: 100 } }, /filter\.type/);
    bad({ ...base, repeat: { count: 0, interval: 0.1 } }, /repeat\.count/);
    bad({ ...base, path: [[0.1, 0]] }, /path\[0\] Hz/);
    bad({ ...base, gain: -1 }, /gain/);
    bad({ ...base, cooldown: -1 }, /cooldown/);
    bad({ ...base, maxVoices: 0 }, /maxVoices/);
  });

  it('points at the layer', () => {
    bad({ ...base, layers: [{ wave: 'pulse50', freq: 440, duration: 0.1 }, { wave: 'saw', freq: -1, duration: 0.1 }] }, /layers\[1\]\.freq/);
  });
});

describe('built-in sound effects', () => {
  const expected = [
    'throw', 'fold', 'unfold', 'crumple', 'bump', 'burn', 'splash', 'star', 'sheet', 'tape', 'switch', 'click', 'back', 'hover',
    'stall', 'turn', 'duct', 'win', 'lose', 'unlock', 'select', 'error', 'pop', 'toast', 'meow', 'boost',
  ];

  it('provides every requested placeholder', () => {
    expect(Object.keys(SFX_DEFS).sort()).toEqual([...expected].sort());
  });

  it('provides the five loops', () => {
    expect(Object.keys(LOOP_DEFS).sort()).toEqual(['fan', 'fire', 'rain', 'vent', 'wind']);
  });

  it('every definition is valid and plans finite, well-formed voices', () => {
    for (const [name, def] of Object.entries(SFX_DEFS)) {
      expect(() => validateSfxDef(name, def as SfxDef), name).not.toThrow();
      const plan = planSfx(def as SfxDef, {}, seq(0.3, 0.7, 0.1));
      expect(plan.voices.length, name).toBeGreaterThan(0);
      expect(plan.duration, name).toBeGreaterThan(0.01);
      expect(plan.duration, name).toBeLessThan(2.5);
      for (const v of plan.voices) {
        expect(v.ref, name).toBeGreaterThan(0);
        expect(Number.isFinite(v.ref) && Number.isFinite(v.start) && Number.isFinite(v.end), name).toBe(true);
        expect(v.env[0], name).toEqual({ t: 0, v: 0 });
        expect(v.env[v.env.length - 1]!.v, name).toBe(0);
        for (let i = 1; i < v.env.length; i++) expect(v.env[i]!.t, name).toBeGreaterThan(v.env[i - 1]!.t);
        expect(Math.max(...v.env.map((p) => p.v)), `${name} peak`).toBeLessThanOrEqual(1.2);
        for (let i = 1; i < v.pitch.length; i++) expect(v.pitch[i]!.t, name).toBeGreaterThan(v.pitch[i - 1]!.t);
        expect(v.pitch.every((k) => Number.isFinite(k.semis)), name).toBe(true);
      }
    }
  });

  it('plans identically for the same random source (reproducible)', () => {
    for (const def of Object.values(SFX_DEFS)) {
      expect(planSfx(def as SfxDef, {}, seq(0.1, 0.9))).toEqual(planSfx(def as SfxDef, {}, seq(0.1, 0.9)));
    }
  });

  it('every loop definition is valid', () => {
    for (const [name, def] of Object.entries(LOOP_DEFS)) expect(() => validateLoopDef(name, def as never), name).not.toThrow();
  });

  it('validateLoopDef rejects broken loops', () => {
    expect(() => validateLoopDef('x', { layers: [] })).toThrow(/at least one layer/);
    expect(() => validateLoopDef('x', { layers: [{ source: 'nope' as never, gain: 1 }] })).toThrow(/source "nope"/);
    expect(() => validateLoopDef('x', { layers: [{ source: 'sine', gain: 1 }] })).toThrow(/need a freq/);
    expect(() => validateLoopDef('x', { layers: [{ source: 'pink', gain: 1, mods: [{ target: 'filter', rates: [1], depth: 1 }] }] })).toThrow(
      /filter that does not exist/,
    );
    expect(() => validateLoopDef('x', { layers: [{ source: 'pink', gain: 1, mods: [{ target: 'freq', rates: [1], depth: 1 }] }] })).toThrow(
      /only works on oscillators/,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------------------------

async function setup(unlocked = true) {
  const fake = makeFakeEnv();
  const engine = new AudioEngine(fake.env);
  const sfx = new SfxPlayer(engine);
  if (unlocked) await engine.unlock();
  const ctx = (): FakeContext => fake.ctx;
  const sfxBus = () => engine.sfxBus as unknown as FakeGain;
  /** Groups / loop outputs: gains that feed the sfx bus (directly or via a panner). */
  const busFeeders = () => ctx().nodes.filter((n) => n !== sfxBus() && n.connections.includes(sfxBus()));
  return { fake, engine, sfx, ctx, sfxBus, busFeeders };
}

describe('SfxPlayer.play', () => {
  it('does nothing before unlock (and creates no context)', async () => {
    const { sfx, fake } = await setup(false);
    expect(sfx.play('click')).toBe(false);
    expect(fake.contexts).toHaveLength(0);
  });

  it('starts all voices of a sound just ahead of the audio clock, on the sfx bus', async () => {
    const { sfx, ctx, busFeeders } = await setup();
    ctx().currentTime = 3;
    expect(sfx.play('click')).toBe(true);
    const voices = ctx().voices();
    expect(voices).toHaveLength(1);
    expect(voices[0]!.startTime).toBeCloseTo(3.002, 9);
    expect(voices[0]!.type).toBe('custom'); // a pulse PeriodicWave
    expect(voices[0]!.frequency.events[0]).toMatchObject({ type: 'set', value: 1500 });
    expect(busFeeders()).toHaveLength(1); // the group gain
  });

  it('plays multi-voice sounds with all layers', async () => {
    const { sfx, ctx } = await setup();
    sfx.play('bump'); // triangle + noise layer
    expect(ctx().voices()).toHaveLength(1);
    expect(ctx().bufferSources().filter((b) => b.buffer!.length > 1)).toHaveLength(1);
    sfx.play('win'); // 1 + 4 layers
    expect(ctx().voices().length).toBeGreaterThanOrEqual(1 + 5);
  });

  it('plays the sound of the very tap that unlocks audio (while resume() is still in flight)', async () => {
    const fake = makeFakeEnv({ resume: 'refuse' });
    const engine = new AudioEngine(fake.env);
    const sfx = new SfxPlayer(engine);
    const pending = engine.unlock();
    expect(sfx.play('click')).toBe(true);
    expect(fake.ctx.voices()).toHaveLength(1);
    await pending;
    expect(sfx.play('hover')).toBe(false); // the unlock was refused: no more sounds
  });

  it('skips sounds that are still in their cooldown (spam protection)', async () => {
    const { sfx, ctx } = await setup();
    sfx.register('tick', { wave: 'pulse50', freq: 1000, duration: 0.05, cooldown: 0.5 });
    expect(sfx.play('tick')).toBe(true);
    expect(sfx.play('tick')).toBe(false);
    ctx().currentTime = 0.3;
    expect(sfx.play('tick')).toBe(false);
    ctx().currentTime = 0.5;
    expect(sfx.play('tick')).toBe(true);
    expect(ctx().voices()).toHaveLength(2);
  });

  it('cooldowns are per sound', async () => {
    const { sfx } = await setup();
    sfx.register('a', { wave: 'pulse50', freq: 1000, duration: 0.05, cooldown: 5 });
    sfx.register('b', { wave: 'pulse50', freq: 1000, duration: 0.05, cooldown: 5 });
    expect(sfx.play('a')).toBe(true);
    expect(sfx.play('b')).toBe(true);
  });

  it('limits polyphony per sound by cutting the oldest play', async () => {
    const { sfx, ctx, busFeeders } = await setup();
    sfx.register('beep', { wave: 'pulse50', freq: 800, duration: 1, maxVoices: 2 });
    expect(sfx.play('beep')).toBe(true);
    expect(sfx.play('beep')).toBe(true);
    const [first, second] = busFeeders() as [FakeGain, FakeGain];
    expect(first.gain.events).toEqual([]);
    expect(sfx.play('beep')).toBe(true); // steals the oldest
    expect(first.gain.last('linear')).toMatchObject({ value: 0 });
    expect(second.gain.events).toEqual([]);
    expect(ctx().voices()).toHaveLength(3);
  });

  it('does not count plays that have already finished against the limit', async () => {
    const { sfx, ctx, busFeeders } = await setup();
    sfx.register('beep', { wave: 'pulse50', freq: 800, duration: 0.1, maxVoices: 1 });
    sfx.play('beep');
    ctx().currentTime = 5;
    sfx.play('beep');
    expect((busFeeders()[0] as FakeGain).gain.events).toEqual([]); // nothing was cut
  });

  it('warns once about unknown names and returns false', async () => {
    const { sfx } = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(sfx.play('does-not-exist')).toBe(false);
    expect(sfx.play('does-not-exist')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/unknown sound effect "does-not-exist"/);
  });

  it('pans through a stereo panner', async () => {
    const { sfx, ctx, sfxBus } = await setup();
    sfx.play('click');
    expect(ctx().nodes.some((n) => n.kind === 'panner')).toBe(false);
    ctx().currentTime = 1;
    sfx.play('click', { pan: 0.75 });
    const panner = ctx().nodes.find((n): n is FakePanner => n.kind === 'panner')!;
    expect(panner.pan.value).toBe(0.75);
    expect(panner.connections).toContain(sfxBus());
    sfx.register('x', { wave: 'pulse50', freq: 500, duration: 0.05 });
    ctx().currentTime = 2;
    sfx.play('x', { pan: -5 });
    expect(ctx().nodes.filter((n): n is FakePanner => n.kind === 'panner').at(-1)!.pan.value).toBe(-1); // clamped
  });

  it('applies vol and pitch (semitones) from the play options', async () => {
    const { sfx, ctx } = await setup();
    sfx.register('tone', { wave: 'pulse50', freq: 440, duration: 0.2, vol: 0.8 });
    sfx.play('tone', { vol: 0.5, pitch: 12 });
    const voice = ctx().voices()[0]!;
    expect(voice.frequency.events[0]).toMatchObject({ type: 'set', value: 880 });
    const env = voice.connections[0] as FakeGain;
    expect(env.gain.events.find((e) => e.type === 'linear')!.value).toBeCloseTo(0.4, 12);
  });

  it('releases finished plays so the audio graph does not grow', async () => {
    const { sfx, ctx, busFeeders, fake, engine } = await setup();
    sfx.play('click');
    const group = busFeeders()[0] as FakeGain;
    expect(group.disconnected).toBe(false);
    expect(fake.intervals.size).toBe(1);
    ctx().currentTime = 1;
    engine.tick();
    expect(group.disconnected).toBe(true);
    expect(fake.intervals.size).toBe(0); // the sweeper unsubscribed itself
  });

  it('does nothing while the context is suspended', async () => {
    const { sfx, ctx } = await setup();
    ctx().setState('suspended');
    expect(sfx.play('click')).toBe(false);
    expect(ctx().voices()).toHaveLength(0);
  });

  it('can register new sounds, rejecting invalid ones', async () => {
    const { sfx } = await setup();
    sfx.register('mine', { wave: 'saw', freq: 300, duration: 0.1 });
    expect(sfx.names()).toContain('mine');
    expect(sfx.play('mine')).toBe(true);
    expect(() => sfx.register('broken', { wave: 'saw', freq: 0, duration: 0.1 })).toThrow(/sfx "broken"/);
    expect(sfx.names()).not.toContain('broken');
    expect(sfx.names()).toEqual(expect.arrayContaining(Object.keys(SFX_DEFS)));
  });
});

describe('SfxPlayer loops', () => {
  const windVol = LOOP_DEFS.wind.vol;

  it('is deferred until audio runs, then starts with a fade-in', async () => {
    const { sfx, engine, fake, ctx, busFeeders } = await setup(false);
    const handle = sfx.startLoop('wind', { vol: 0.5 });
    expect(handle.active).toBe(true);
    expect(fake.contexts).toHaveLength(0);
    await engine.unlock();
    const out = busFeeders().find((n): n is FakeGain => n instanceof FakeGain)!;
    expect(out).toBeDefined();
    expect(out.gain.events[0]).toMatchObject({ type: 'set', value: 0 });
    expect(out.gain.events[1]).toMatchObject({ type: 'target' }); // a target curve, so setVolume can chain onto it
    expect(out.gain.events[1]!.value).toBeCloseTo(windVol * 0.5, 12);
    expect(ctx().bufferSources().filter((b) => b.buffer!.length > 1).length).toBeGreaterThanOrEqual(2); // pink + white
    expect(ctx().bufferSources().every((b) => b.loop || b.buffer!.length === 1)).toBe(true);
  });

  it('keeps the latest volume and pitch given before audio started', async () => {
    const { sfx, engine, busFeeders, ctx } = await setup(false);
    const handle = sfx.startLoop('wind');
    handle.setVolume(0.25);
    handle.setPitch(12);
    await engine.unlock();
    const out = busFeeders().find((n): n is FakeGain => n instanceof FakeGain)!;
    expect(out.gain.events[1]!.value).toBeCloseTo(windVol * 0.25, 12); // starts at the latest volume
    const bandpass = ctx().nodes.find((n): n is FakeBiquad => n instanceof FakeBiquad && n.type === 'bandpass')!;
    expect(bandpass.frequency.value).toBeCloseTo(1040, 6); // 520 Hz shifted up an octave
  });

  it('setVolume right after start does not cancel the fade-in (no snap back to silence)', async () => {
    const { sfx, busFeeders } = await setup();
    const handle = sfx.startLoop('wind');
    handle.setVolume(0.8);
    handle.setVolume(0.6);
    const out = busFeeders().find((n): n is FakeGain => n instanceof FakeGain)!;
    expect(out.gain.events.some((e) => e.type === 'cancel')).toBe(false);
    expect(out.gain.events.map((e) => e.type)).toEqual(['set', 'target', 'target', 'target']);
  });

  it('stop reads the current gain before cancelling, so the fade-out starts from it', async () => {
    const { sfx, busFeeders } = await setup();
    const handle = sfx.startLoop('wind');
    const out = busFeeders().find((n): n is FakeGain => n instanceof FakeGain)!;
    out.gain.value = 0.3; // what the audio thread has rendered so far
    handle.stop(0.2);
    const types = out.gain.events.map((e) => e.type);
    expect(types.slice(-3)).toEqual(['cancel', 'set', 'linear']);
    expect(out.gain.events.at(-2)).toMatchObject({ type: 'set', value: 0.3 });
  });

  it('setVolume ramps smoothly to baseVol x volume', async () => {
    const { sfx, busFeeders } = await setup();
    const handle = sfx.startLoop('wind');
    handle.setVolume(0.5);
    const out = busFeeders().find((n): n is FakeGain => n instanceof FakeGain)!;
    const last = out.gain.last('target')!;
    expect(last.value).toBeCloseTo(windVol * 0.5, 12);
    expect(last.timeConstant).toBeGreaterThan(0);
    handle.setVolume(-3);
    expect(out.gain.last('target')!.value).toBe(0); // clamped
  });

  it('setPitch shifts oscillators, noise rates and filter cutoffs by semitones (as set per layer)', async () => {
    const { sfx, ctx } = await setup();
    const handle = sfx.startLoop('fan'); // triangle 96 Hz + saw 192 Hz + noise through a 1100 Hz band-pass
    const tri = ctx().oscillators().find((o) => o.type === 'custom')!;
    expect(tri.frequency.value).toBeCloseTo(96, 9);
    handle.setPitch(12);
    expect(tri.frequency.last('target')!.value).toBeCloseTo(192, 6);
    const band = ctx().nodes.find((n): n is FakeBiquad => n instanceof FakeBiquad && n.type === 'bandpass')!;
    expect(band.frequency.last('target')!.value).toBeCloseTo(2200, 6);
    expect(band.frequency.last('target')!.timeConstant).toBeGreaterThan(0);
    handle.setPitch(-12);
    expect(tri.frequency.last('target')!.value).toBeCloseTo(48, 6);
  });

  it("a noise layer's rate only follows setPitch if its pitchTrack says so, while filter cutoffs follow by default", async () => {
    const { sfx, ctx } = await setup();
    const handle = sfx.startLoop('rain'); // noise layers at rates 1, 1, 2.4 and 1.8; none of them tracks pitch
    handle.setPitch(7);
    const rates = ctx()
      .bufferSources()
      .filter((b) => b.buffer!.length > 1)
      .map((b) => b.playbackRate.last('target')!.value);
    expect(rates).toEqual([1, 1, 2.4, 1.8]); // retargeted to their own base rates, not shifted
    const highpass = ctx().nodes.find((n): n is FakeBiquad => n instanceof FakeBiquad && n.type === 'highpass' && n.frequency.value > 2000)!;
    expect(highpass.frequency.last('target')!.value).toBeCloseTo(1500 * 2 ** (7 / 12), 6);
  });

  it('stop fades out, stops every source, and ignores later calls', async () => {
    const { sfx, ctx, busFeeders } = await setup();
    ctx().currentTime = 4;
    const handle = sfx.startLoop('rain');
    const out = busFeeders().find((n): n is FakeGain => n instanceof FakeGain)!;
    ctx().currentTime = 5;
    handle.stop(0.3);
    expect(handle.active).toBe(false);
    expect(out.gain.last('linear')).toMatchObject({ value: 0 });
    expect(out.gain.last('linear')!.time).toBeCloseTo(5.3, 9);
    const sources = [...ctx().oscillators(), ...ctx().bufferSources()].filter((s) => s.startCalls.length && s.buffer?.length !== 1);
    expect(sources.length).toBeGreaterThan(3);
    for (const s of sources) expect(s.lastStop!).toBeGreaterThanOrEqual(5.3);
    const events = out.gain.events.length;
    handle.setVolume(1);
    handle.setPitch(5);
    handle.stop();
    expect(out.gain.events.length).toBe(events);
  });

  it('a loop stopped before audio runs never starts', async () => {
    const { sfx, engine, ctx } = await setup(false);
    const handle = sfx.startLoop('wind');
    handle.stop();
    expect(handle.active).toBe(false);
    await engine.unlock();
    expect(ctx().bufferSources().filter((b) => b.buffer!.length > 1)).toHaveLength(0);
  });

  it('unknown loops give an inert handle and one warning', async () => {
    const { sfx } = await setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = sfx.startLoop('nothing');
    const b = sfx.startLoop('nothing');
    expect(a.active).toBe(false);
    expect(() => {
      a.setVolume(1);
      a.setPitch(1);
      a.stop();
      b.stop();
    }).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('stopAllLoops stops every running loop', async () => {
    const { sfx } = await setup();
    const a = sfx.startLoop('wind');
    const b = sfx.startLoop('fan');
    const c = sfx.startLoop('fire');
    c.stop();
    sfx.stopAllLoops(0.1);
    expect(a.active).toBe(false);
    expect(b.active).toBe(false);
  });

  it('runs several instances of one loop independently', async () => {
    const { sfx, busFeeders } = await setup();
    const a = sfx.startLoop('fan');
    const b = sfx.startLoop('fan');
    const outs = busFeeders().filter((n): n is FakeGain => n instanceof FakeGain);
    expect(outs).toHaveLength(2);
    const before = outs.map((o) => o.gain.events.length);
    a.setVolume(0.2);
    expect(outs[0]!.gain.events.length).toBe(before[0]! + 1); // only the adjusted instance changed
    expect(outs[1]!.gain.events.length).toBe(before[1]);
    expect(outs[0]!.gain.last('target')!.value).toBeCloseTo(LOOP_DEFS.fan.vol * 0.2, 12);
    b.stop();
    expect(a.active).toBe(true);
  });
});
