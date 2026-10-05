/**
 * Shared, dependency-free types for the audio module (no WebAudio, no DOM).
 */

/** Wave shapes of the emulated 4-channel chip (2 pulse, triangle, noise). */
export type WaveName =
  | 'pulse12' // 12.5 % duty
  | 'pulse25' // 25 % duty
  | 'pulse50' // 50 % duty (square)
  | 'pulse75' // 75 % duty (a 25 % pulse with inverted phase)
  | 'triangle' // 4-bit stepped, NES-like
  | 'noise' // 15-bit LFSR, long mode (32767 steps): white-ish noise
  | 'noise-short'; // 15-bit LFSR, short "metallic" mode (93 steps)

export const WAVE_NAMES: readonly WaveName[] = [
  'pulse12',
  'pulse25',
  'pulse50',
  'pulse75',
  'triangle',
  'noise',
  'noise-short',
];

/** Sound effects and loops may also use two non-chip waves. */
export type SfxWaveName = WaveName | 'sine' | 'saw';

export const SFX_WAVE_NAMES: readonly SfxWaveName[] = [...WAVE_NAMES, 'sine', 'saw'];

export function isNoiseWave(wave: SfxWaveName): boolean {
  return wave === 'noise' || wave === 'noise-short';
}

/**
 * Linear ADSR envelope, times in seconds, `s` is the sustain level 0..1.
 * `a`/`d`/`r` are linear ramps, like the hardware envelopes this emulates.
 */
export interface Envelope {
  a: number;
  d: number;
  s: number;
  r: number;
}

/** Vibrato (an LFO on pitch). */
export interface VibratoDef {
  /** Peak deviation in semitones (0.15 = 15 cents each way; 0.5 is a wide vibrato). */
  depth: number;
  /** LFO rate in Hz. */
  rate: number;
  /** Seconds after the note starts before the vibrato fades in. Default 0. */
  delay?: number;
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** A biquad filter on a voice. */
export interface FilterDef {
  type: FilterType;
  /** Cutoff / centre frequency in Hz. */
  freq: number;
  /** Resonance (Q). Default 0.7 (flat). */
  q?: number;
}

/** A point of a piecewise-linear envelope: value `v` at time `t` (seconds, relative to note start). */
export interface EnvPoint {
  t: number;
  v: number;
}

/**
 * A point of a pitch curve. `semis` is relative to the voice's reference pitch.
 * Between points the pitch moves linearly in semitones (= exponentially in Hz),
 * unless `jump` is set, in which case the pitch steps to `semis` at `t`.
 */
export interface PitchKey {
  t: number;
  semis: number;
  jump?: boolean;
}
