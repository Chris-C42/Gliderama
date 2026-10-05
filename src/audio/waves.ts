/**
 * Waveform maths for the chip voices. PURE (no WebAudio): returns plain typed arrays that `chip.ts`
 * wraps in PeriodicWaves / AudioBuffers.
 *
 * Level convention: every chip wave is scaled to the same RMS (`WAVE_RMS`), so an instrument's `vol`
 * is a pure mixing control and swapping `pulse25` for `pulse12` does not change the loudness.
 */

/** RMS level of every chip wave at gain 1. */
export const WAVE_RMS = 0.4;

/** Number of Fourier harmonics generated for PeriodicWaves. The browser band-limits per pitch. */
export const HARMONICS = 512;

export interface Harmonics {
  /** Cosine coefficients (index 0 is DC and unused). */
  real: Float32Array;
  /** Sine coefficients. */
  imag: Float32Array;
}

export const PULSE_DUTIES = { pulse12: 0.125, pulse25: 0.25, pulse50: 0.5, pulse75: 0.75 } as const;
export type PulseName = keyof typeof PULSE_DUTIES;

/**
 * Fourier series of a zero-mean rectangular pulse train that is high for the first `duty` of each
 * period, scaled to `rms`. For a pulse of peak-to-peak P: a_n = P sin(2 pi n d) / (pi n),
 * b_n = P (1 - cos(2 pi n d)) / (pi n).
 */
export function pulseHarmonics(duty: number, harmonics = HARMONICS, rms = WAVE_RMS): Harmonics {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  const peakToPeak = rms / Math.sqrt(duty * (1 - duty));
  for (let n = 1; n <= harmonics; n++) {
    const theta = 2 * Math.PI * n * duty;
    real[n] = (peakToPeak * Math.sin(theta)) / (Math.PI * n);
    imag[n] = (peakToPeak * (1 - Math.cos(theta))) / (Math.PI * n);
  }
  return { real, imag };
}

/**
 * Exact Fourier series of a staircase waveform whose `levels` each last 1/levels.length of the period
 * (zero-mean, scaled to `rms`). Harmonics beyond the number of levels are the stair-step "grit" of a
 * real 4-bit DAC, and the browser drops the ones that would alias for high notes.
 */
export function stairHarmonics(levels: readonly number[], harmonics = HARMONICS, rms = WAVE_RMS): Harmonics {
  const count = levels.length;
  const mean = levels.reduce((a, b) => a + b, 0) / count;
  const centred = levels.map((v) => v - mean);
  const levelRms = Math.sqrt(centred.reduce((a, b) => a + b * b, 0) / count);
  const scale = rms / levelRms;
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    let cosSum = 0;
    let sinSum = 0;
    for (let k = 0; k < count; k++) {
      const phase = (2 * Math.PI * n * (k + 0.5)) / count;
      cosSum += centred[k]! * Math.cos(phase);
      sinSum += centred[k]! * Math.sin(phase);
    }
    const f = (scale * Math.sin((Math.PI * n) / count)) / (Math.PI * n);
    real[n] = 2 * f * cosSum;
    imag[n] = 2 * f * sinSum;
  }
  return { real, imag };
}

/**
 * The NES triangle channel: a 32-step sequence 15, 14 ... 0, 0, 1 ... 15 (4-bit, 16 levels), rotated to
 * start mid-rise so that notes begin near zero instead of at an extreme (no click).
 */
export function triangleLevels(): number[] {
  const nes: number[] = [];
  for (let v = 15; v >= 0; v--) nes.push(v);
  for (let v = 0; v <= 15; v++) nes.push(v);
  return Array.from({ length: 32 }, (_, k) => nes[(k + 24) % 32]!);
}

/** Evaluates a harmonic series at phase `p` in [0, 1). */
export function evalHarmonics(h: Harmonics, p: number): number {
  let sum = 0;
  for (let n = 1; n < h.real.length; n++) {
    const a = 2 * Math.PI * n * p;
    sum += h.real[n]! * Math.cos(a) + h.imag[n]! * Math.sin(a);
  }
  return sum;
}

// ------------------------------------------------------------------------------------------------
// LFSR noise (NES-style 15-bit shift register)
// ------------------------------------------------------------------------------------------------

export type NoiseMode = 'long' | 'short';

/** Period of the long (32767-step) and short ("metallic", 93-step) sequences. */
export const LFSR_PERIOD: Record<NoiseMode, number> = { long: 32767, short: 93 };
const LFSR_SEED = 1;

/** Output bits of the LFSR for `steps` clocks. Feedback is bit0 XOR bit1 (long) or bit0 XOR bit6 (short). */
export function lfsrBits(mode: NoiseMode, steps: number): Uint8Array {
  const tap = mode === 'short' ? 6 : 1;
  const out = new Uint8Array(steps);
  let reg = LFSR_SEED;
  for (let i = 0; i < steps; i++) {
    out[i] = reg & 1;
    const feedback = (reg & 1) ^ ((reg >> tap) & 1);
    reg = (reg >> 1) | (feedback << 14);
  }
  return out;
}

/** Number of short-mode periods in the short noise buffer (so that looping stays seamless). */
export const SHORT_REPEATS = 48;

/**
 * One clock per sample, zero-mean, scaled to `rms`. The long buffer is one full period; the short
 * buffer is `SHORT_REPEATS` periods so it can loop seamlessly.
 */
export function lfsrSamples(mode: NoiseMode, rms = WAVE_RMS): Float32Array {
  const period = LFSR_PERIOD[mode];
  const length = mode === 'short' ? period * SHORT_REPEATS : period;
  const bits = lfsrBits(mode, length);
  let ones = 0;
  for (let i = 0; i < period; i++) ones += bits[i]!;
  const mean = ones / period;
  const out = new Float32Array(length);
  const std = Math.sqrt(mean * (1 - mean)) || 1;
  for (let i = 0; i < length; i++) out[i] = ((bits[i]! - mean) * rms) / std;
  return out;
}

// ------------------------------------------------------------------------------------------------
// Procedural noise for loops (wind, rain, fire ...)
// ------------------------------------------------------------------------------------------------

export function scaleToRms(data: Float32Array, rms: number): Float32Array {
  let sum = 0;
  for (const v of data) sum += v * v;
  const current = Math.sqrt(sum / data.length) || 1;
  const k = rms / current;
  for (let i = 0; i < data.length; i++) data[i]! *= k;
  return data;
}

export function scaleToPeak(data: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const v of data) max = Math.max(max, Math.abs(v));
  const k = max > 0 ? peak / max : 1;
  for (let i = 0; i < data.length; i++) data[i]! *= k;
  return data;
}

export function whiteNoise(length: number, rand: () => number, rms = 0.3): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rand() * 2 - 1;
  return scaleToRms(out, rms);
}

/** Pink (1/f) noise via Paul Kellet's filter. */
export function pinkNoise(length: number, rand: () => number, rms = 0.3): Float32Array {
  const out = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848;
  }
  return scaleToRms(out, rms);
}

/** Brown (1/f^2) noise: a leaky integral of white noise. */
export function brownNoise(length: number, rand: () => number, rms = 0.3): Float32Array {
  const out = new Float32Array(length);
  let last = 0;
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    out[i] = last;
  }
  return scaleToRms(out, rms);
}

/**
 * Sparse crackle: short noisy pops at random times (`density` pops per second on average), most of them
 * small with a few loud ones. Normalised to a peak of 0.9.
 */
export function crackleNoise(length: number, sampleRate: number, rand: () => number, density: number): Float32Array {
  const out = new Float32Array(length);
  const chance = density / sampleRate;
  const tail = Math.floor(sampleRate * 0.006);
  for (let i = 0; i < length; i++) {
    if (rand() >= chance) continue;
    const loud = rand();
    const amp = 0.15 + 0.85 * loud * loud * loud;
    const tau = tail / 4 + rand() * (tail / 3);
    for (let j = 0; j < tail && i + j < length; j++) {
      out[i + j]! += amp * (rand() * 2 - 1) * Math.exp(-j / tau);
    }
  }
  return scaleToPeak(out, 0.9);
}

/**
 * Makes a buffer loop without a click by blending its last `fade` samples into its first `fade`
 * samples (equal power) and dropping them. Returns a new, shorter array.
 */
export function makeSeamless(data: Float32Array, fade: number): Float32Array {
  const n = data.length - fade;
  const out = new Float32Array(n);
  out.set(data.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const w = (i + 1) / (fade + 1);
    out[i] = data[i]! * Math.sin((w * Math.PI) / 2) + data[n + i]! * Math.cos((w * Math.PI) / 2);
  }
  return out;
}
