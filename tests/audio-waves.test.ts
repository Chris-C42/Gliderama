import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/audio/plan';
import {
  LFSR_PERIOD,
  PULSE_DUTIES,
  SHORT_REPEATS,
  WAVE_RMS,
  brownNoise,
  crackleNoise,
  evalHarmonics,
  lfsrBits,
  lfsrSamples,
  makeSeamless,
  pinkNoise,
  pulseHarmonics,
  scaleToPeak,
  stairHarmonics,
  triangleLevels,
  whiteNoise,
  type Harmonics,
} from '../src/audio/waves';

/** Samples one period of a harmonic series at `n` evenly spaced phases. */
function render(h: Harmonics, n = 1024): number[] {
  return Array.from({ length: n }, (_, i) => evalHarmonics(h, (i + 0.5) / n));
}
const rms = (xs: ArrayLike<number>): number => Math.sqrt(Array.from(xs).reduce((a, b) => a + b * b, 0) / xs.length);
const mean = (xs: ArrayLike<number>): number => Array.from(xs).reduce((a, b) => a + b, 0) / xs.length;

describe('pulse waves', () => {
  it('reproduces a rectangular pulse of the right duty (high first, then low)', () => {
    for (const [name, duty] of Object.entries(PULSE_DUTIES)) {
      const h = pulseHarmonics(duty);
      const pp = WAVE_RMS / Math.sqrt(duty * (1 - duty));
      const high = (1 - duty) * pp;
      const low = -duty * pp;
      // middle of the high part and of the low part (away from the Gibbs ripple at the edges)
      expect(evalHarmonics(h, duty / 2), name).toBeCloseTo(high, 1);
      expect(evalHarmonics(h, duty + (1 - duty) / 2), name).toBeCloseTo(low, 1);
    }
  });

  it('is zero-mean with the same RMS for every duty (vol is a pure mixing control)', () => {
    for (const [name, duty] of Object.entries(PULSE_DUTIES)) {
      const samples = render(pulseHarmonics(duty), 4096);
      expect(mean(samples), name).toBeCloseTo(0, 2);
      expect(rms(samples), name).toBeCloseTo(WAVE_RMS, 2);
    }
  });

  it('square waves have only odd harmonics', () => {
    const h = pulseHarmonics(0.5);
    for (let n = 2; n < 40; n += 2) expect(Math.abs(h.imag[n]!) + Math.abs(h.real[n]!), `harmonic ${n}`).toBeLessThan(1e-6);
    expect(h.imag[1]!).toBeCloseTo((4 / Math.PI) * (WAVE_RMS / Math.sqrt(0.25)) / 2, 5);
  });

  it('75 % is the mirror of 25 % (same spectrum magnitudes, inverted shape)', () => {
    const a = pulseHarmonics(0.25);
    const b = pulseHarmonics(0.75);
    for (let n = 1; n < 30; n++) {
      expect(Math.hypot(a.real[n]!, a.imag[n]!)).toBeCloseTo(Math.hypot(b.real[n]!, b.imag[n]!), 6);
    }
    // 75 % pulse is high for the first 75 % of the period
    expect(evalHarmonics(b, 0.375)).toBeGreaterThan(0);
    expect(evalHarmonics(b, 0.875)).toBeLessThan(0);
  });

  it('thin pulses have a stronger harmonic content than the square wave at equal RMS', () => {
    const thin = pulseHarmonics(0.125);
    const square = pulseHarmonics(0.5);
    const energyAbove = (h: Harmonics) => Array.from(h.real).reduce((a, _, n) => (n >= 4 ? a + h.real[n]! ** 2 + h.imag[n]! ** 2 : a), 0);
    expect(energyAbove(thin)).toBeGreaterThan(energyAbove(square));
  });

  it('has the DC term unused', () => {
    const h = pulseHarmonics(0.25);
    expect(h.real[0]).toBe(0);
    expect(h.imag[0]).toBe(0);
    expect(h.real).toHaveLength(513);
  });
});

describe('4-bit stepped triangle', () => {
  it('is the NES 32-step sequence, starting mid-rise', () => {
    const levels = triangleLevels();
    expect(levels).toHaveLength(32);
    expect(levels.slice(0, 8)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(levels.slice(8, 16)).toEqual([15, 14, 13, 12, 11, 10, 9, 8]);
    expect(levels.slice(16, 24)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(levels.slice(24)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // 16 distinct 4-bit levels, each used twice per period
    for (let v = 0; v <= 15; v++) expect(levels.filter((x) => x === v)).toHaveLength(2);
  });

  it('renders the staircase: each step is flat at its (zero-mean, scaled) level', () => {
    const levels = triangleLevels();
    const h = stairHarmonics(levels);
    const avg = mean(levels);
    const sd = rms(levels.map((v) => v - avg));
    const scale = WAVE_RMS / sd;
    for (let k = 0; k < 32; k++) {
      const expected = (levels[k]! - avg) * scale;
      expect(evalHarmonics(h, (k + 0.5) / 32), `step ${k}`).toBeCloseTo(expected, 1);
    }
  });

  it('is zero-mean with the shared wave RMS and starts near zero going up', () => {
    const h = stairHarmonics(triangleLevels());
    const samples = render(h, 4096);
    expect(mean(samples)).toBeCloseTo(0, 2);
    expect(rms(samples)).toBeCloseTo(WAVE_RMS, 2);
    expect(Math.abs(evalHarmonics(h, 0.5 / 32))).toBeLessThan(0.05);
    expect(evalHarmonics(h, 3.5 / 32)).toBeGreaterThan(evalHarmonics(h, 0.5 / 32));
  });

  it('has odd harmonics only (it is a symmetric triangle-like wave)', () => {
    const h = stairHarmonics(triangleLevels());
    const fundamental = Math.hypot(h.real[1]!, h.imag[1]!);
    for (let n = 2; n <= 30; n += 2) expect(Math.hypot(h.real[n]!, h.imag[n]!) / fundamental).toBeLessThan(1e-5);
  });

  it('has a smooth-triangle-like spectrum: 1/n^2 fall-off of the low odd harmonics', () => {
    const h = stairHarmonics(triangleLevels());
    const mag = (n: number) => Math.hypot(h.real[n]!, h.imag[n]!);
    expect(mag(3) / mag(1)).toBeCloseTo(1 / 9, 1);
    expect(mag(5) / mag(1)).toBeCloseTo(1 / 25, 1);
  });
});

describe('LFSR noise', () => {
  it('long mode has a period of 32767 steps', () => {
    const bits = lfsrBits('long', 2 * LFSR_PERIOD.long);
    for (let i = 0; i < LFSR_PERIOD.long; i++) {
      if (bits[i] !== bits[i + LFSR_PERIOD.long]) throw new Error(`mismatch at ${i}`);
    }
    // ... and no shorter period (the 93-step one in particular)
    expect(Array.from(bits.slice(0, 200))).not.toEqual(Array.from(bits.slice(93, 293)));
    expect(Array.from(bits.slice(0, 200))).not.toEqual(Array.from(bits.slice(31, 231)));
    // an m-sequence has exactly one more 1 than 0 per period
    const ones = bits.slice(0, LFSR_PERIOD.long).reduce((a, b) => a + b, 0);
    expect(ones).toBe(16384);
  });

  it('short mode is the 93-step "metallic" sequence', () => {
    const bits = lfsrBits('short', 93 * 20);
    for (let i = 0; i < 93 * 19; i++) expect(bits[i + 93], `bit ${i}`).toBe(bits[i]);
    // no shorter period
    expect(Array.from(bits.slice(0, 93))).not.toEqual(Array.from(bits.slice(31, 124)));
    for (let p = 1; p < 93; p++) {
      const same = bits.slice(0, 93).every((b, i) => b === bits[i + p]);
      expect(same, `period ${p}`).toBe(false);
    }
  });

  it('produces zero-mean buffers at the shared RMS level', () => {
    const long = lfsrSamples('long');
    expect(long).toHaveLength(32767);
    expect(mean(long)).toBeCloseTo(0, 4);
    expect(rms(long)).toBeCloseTo(WAVE_RMS, 3);
    const short = lfsrSamples('short');
    expect(short).toHaveLength(93 * SHORT_REPEATS);
    expect(Math.abs(mean(short))).toBeLessThan(1e-3);
    expect(rms(short)).toBeCloseTo(WAVE_RMS, 3);
  });

  it('loops the short buffer seamlessly (an exact number of periods)', () => {
    const short = lfsrSamples('short');
    expect(short[0]).toBe(short[93]);
    expect(short[92]).toBe(short[93 * SHORT_REPEATS - 1]);
  });

  it('is deterministic', () => {
    expect(Array.from(lfsrSamples('long').slice(0, 100))).toEqual(Array.from(lfsrSamples('long').slice(0, 100)));
  });
});

describe('procedural noise for loops', () => {
  it('white, pink and brown noise hit the requested RMS and are reproducible', () => {
    for (const make of [whiteNoise, pinkNoise, brownNoise]) {
      const a = make(20000, mulberry32(7), 0.3);
      const b = make(20000, mulberry32(7), 0.3);
      expect(rms(a)).toBeCloseTo(0.3, 3);
      expect(Array.from(a.slice(0, 50))).toEqual(Array.from(b.slice(0, 50)));
      expect(make(20000, mulberry32(8), 0.3)[0]).not.toBe(a[0]);
    }
  });

  it('pink noise has less high-frequency energy than white, brown less than pink', () => {
    const roughness = (x: Float32Array) => {
      let d = 0;
      for (let i = 1; i < x.length; i++) d += (x[i]! - x[i - 1]!) ** 2;
      return Math.sqrt(d / x.length) / rms(x);
    };
    const w = roughness(whiteNoise(30000, mulberry32(1)));
    const p = roughness(pinkNoise(30000, mulberry32(1)));
    const b = roughness(brownNoise(30000, mulberry32(1)));
    expect(w).toBeGreaterThan(p);
    expect(p).toBeGreaterThan(b);
  });

  it('crackle is sparse, peaks at 0.9 and has a few loud pops', () => {
    const sr = 22050;
    const x = crackleNoise(sr * 4, sr, mulberry32(3), 30);
    expect(Math.max(...x.map(Math.abs))).toBeCloseTo(0.9, 6);
    const active = x.filter((v) => Math.abs(v) > 0.02).length / x.length;
    expect(active).toBeLessThan(0.3);
    expect(active).toBeGreaterThan(0.001);
  });

  it('scales to a peak', () => {
    const x = scaleToPeak(Float32Array.from([0.1, -0.5, 0.25]), 1);
    [0.2, -1, 0.5].forEach((v, i) => expect(x[i]).toBeCloseTo(v, 6));
  });

  it('makeSeamless shortens the buffer and removes the loop discontinuity', () => {
    // a 0 -> 1 ramp jumps by ~1 where it wraps around
    const ramp = Float32Array.from({ length: 10000 }, (_, i) => i / 10000);
    expect(Math.abs(ramp[ramp.length - 1]! - ramp[0]!)).toBeGreaterThan(0.99);
    const fixed = makeSeamless(ramp, 1000);
    expect(fixed).toHaveLength(9000);
    // after the fix the wrap-around is an ordinary neighbouring-sample step
    expect(Math.abs(fixed[fixed.length - 1]! - fixed[0]!)).toBeLessThan(0.001);
    // and the crossfade region itself moves smoothly (no sample-to-sample jump anywhere)
    let maxStep = 0;
    for (let i = 1; i < fixed.length; i++) maxStep = Math.max(maxStep, Math.abs(fixed[i]! - fixed[i - 1]!));
    expect(maxStep).toBeLessThan(0.002);
  });
});
