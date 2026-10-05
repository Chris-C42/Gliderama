/**
 * The chip voices: renders a `VoicePlan` with plain WebAudio nodes.
 *
 * Everything here takes a `BaseAudioContext`, so the same code drives the live `AudioContext` and an
 * `OfflineAudioContext` (used for rendering / verification). Pure planning lives in `plan.ts`.
 */

import type { FilterType } from './types';
import type { VoicePlan } from './plan';
import { clamp, mulberry32 } from './plan';
import {
  HARMONICS,
  PULSE_DUTIES,
  brownNoise,
  crackleNoise,
  lfsrSamples,
  makeSeamless,
  pinkNoise,
  pulseHarmonics,
  stairHarmonics,
  triangleLevels,
  whiteNoise,
  type PulseName,
} from './waves';

/** Sample rate at which noise buffers are authored (the browser resamples to the context rate). */
export const NOISE_SAMPLE_RATE = 44100;

export type NoiseKind = 'long' | 'short' | 'white' | 'pink' | 'brown' | 'crackleA' | 'crackleB';

/** Seconds of each procedural loop-noise buffer. */
const LOOP_NOISE_SECONDS = 3;

/** Per-context cache of PeriodicWaves and noise AudioBuffers (built lazily). */
export class ChipResources {
  private waves = new Map<string, PeriodicWave>();
  private buffers = new Map<NoiseKind, AudioBuffer>();

  constructor(readonly ctx: BaseAudioContext) {}

  /**
   * Builds everything the chip voices need (all PeriodicWaves and the two LFSR noise buffers) up front,
   * so that the first notes of a song do not pay for it inside the scheduler tick.
   */
  warmUp(): void {
    for (const name of ['pulse12', 'pulse25', 'pulse50', 'pulse75', 'triangle'] as const) this.periodicWave(name);
    this.noiseBuffer('long');
    this.noiseBuffer('short');
  }

  /**
   * Generates the larger ambient-loop noise buffers (9-18 ms each) one per task via `defer`, so that no
   * single frame pays for them. Loops started earlier just build what is still missing.
   */
  warmUpLoopBuffers(defer: (task: () => void) => void): void {
    const kinds: NoiseKind[] = ['pink', 'white', 'brown', 'crackleA', 'crackleB'];
    const next = (): void => {
      const kind = kinds.shift();
      if (!kind) return;
      try {
        this.noiseBuffer(kind);
      } catch {
        return;
      }
      defer(next);
    };
    defer(next);
  }

  /** PeriodicWave for a pulse duty or the 4-bit stepped triangle. */
  periodicWave(name: PulseName | 'triangle'): PeriodicWave {
    let wave = this.waves.get(name);
    if (!wave) {
      const h = name === 'triangle' ? stairHarmonics(triangleLevels(), HARMONICS) : pulseHarmonics(PULSE_DUTIES[name], HARMONICS);
      wave = this.ctx.createPeriodicWave(h.real, h.imag, { disableNormalization: true });
      this.waves.set(name, wave);
    }
    return wave;
  }

  /** A looping noise buffer. `long`/`short` are the LFSR sequences; the rest feed ambient loops. */
  noiseBuffer(kind: NoiseKind): AudioBuffer {
    let buf = this.buffers.get(kind);
    if (!buf) {
      buf = this.makeNoiseBuffer(kind);
      this.buffers.set(kind, buf);
    }
    return buf;
  }

  private makeNoiseBuffer(kind: NoiseKind): AudioBuffer {
    const length = NOISE_SAMPLE_RATE * LOOP_NOISE_SECONDS;
    const fade = Math.floor(NOISE_SAMPLE_RATE * 0.1);
    let data: Float32Array;
    switch (kind) {
      case 'long':
        data = lfsrSamples('long');
        break;
      case 'short':
        data = lfsrSamples('short');
        break;
      case 'white':
        data = makeSeamless(whiteNoise(length + fade, mulberry32(0x1001)), fade);
        break;
      case 'pink':
        data = makeSeamless(pinkNoise(length + fade, mulberry32(0x2002)), fade);
        break;
      case 'brown':
        data = makeSeamless(brownNoise(length + fade, mulberry32(0x3003)), fade);
        break;
      case 'crackleA':
        data = makeSeamless(crackleNoise(Math.floor(NOISE_SAMPLE_RATE * 3.7) + fade, NOISE_SAMPLE_RATE, mulberry32(0x4004), 22), fade);
        break;
      case 'crackleB':
        data = makeSeamless(crackleNoise(Math.floor(NOISE_SAMPLE_RATE * 5.3) + fade, NOISE_SAMPLE_RATE, mulberry32(0x5005), 15), fade);
        break;
    }
    const buf = this.ctx.createBuffer(1, data.length, NOISE_SAMPLE_RATE);
    buf.getChannelData(0).set(data);
    return buf;
  }
}

const registry = new WeakMap<BaseAudioContext, ChipResources>();

/** The (cached) chip resources of a context. */
export function getChip(ctx: BaseAudioContext): ChipResources {
  let chip = registry.get(ctx);
  if (!chip) {
    chip = new ChipResources(ctx);
    registry.set(ctx, chip);
  }
  return chip;
}

// ------------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------------

/**
 * Trim that brings the built-in sine / sawtooth to the same RMS as the chip waves, so that `vol`
 * means the same thing for every wave.
 */
const NATIVE_TRIM: Partial<Record<string, number>> = { sine: 0.5657, saw: 0.6928 };

/**
 * Converts a conventional filter Q factor to what a BiquadFilterNode expects: bandpass takes the
 * linear Q directly, lowpass / highpass take resonance in dB (0 dB = flat Butterworth, Q = 0.7071).
 */
export function filterQValue(type: FilterType, q: number): number {
  if (type === 'bandpass') return clamp(q, 0.0001, 200);
  if (q <= Math.SQRT1_2) return 0;
  const d2 = 1 / (q * q);
  return clamp(10 * Math.log10(4 / (d2 * (4 - d2))), 0, 60);
}

export function supportsStereoPanner(ctx: BaseAudioContext): boolean {
  return typeof ctx.createStereoPanner === 'function';
}

/** Best-effort `disconnect` of several nodes (never throws). */
export function disconnectAll(...nodes: Array<AudioNode | null | undefined>): void {
  for (const node of nodes) {
    try {
      node?.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Voices
// ------------------------------------------------------------------------------------------------

export interface VoiceHandle {
  /** Context time at which the voice is silent (and its nodes are released). */
  endTime: number;
  /** Fades the voice out from `at` over `fade` seconds and stops it (monophonic channel cut). */
  cut(at: number, fade?: number): void;
}

/** Starts a voice. `origin` is the context time of the plan's origin (`plan.start` is added to it). */
export function startVoice(chip: ChipResources, dest: AudioNode, plan: VoicePlan, origin: number): VoiceHandle {
  const ctx = chip.ctx;
  const t0 = Math.max(origin + plan.start, 0);
  const tEnd = t0 + plan.end;
  const noise = plan.wave === 'noise' || plan.wave === 'noise-short';
  const nyquist = ctx.sampleRate / 2;

  // --- source -------------------------------------------------------------------------------
  let src: AudioScheduledSourceNode;
  let pitchParam: AudioParam;
  let detuneParam: AudioParam | undefined;
  let toValue: (semis: number) => number;
  if (noise) {
    const bufSrc = ctx.createBufferSource();
    const buffer = chip.noiseBuffer(plan.wave === 'noise' ? 'long' : 'short');
    bufSrc.buffer = buffer;
    bufSrc.loop = true;
    pitchParam = bufSrc.playbackRate;
    detuneParam = undefined; // vibrato is not applied to noise
    toValue = (semis) => clamp(plan.ref * Math.pow(2, semis / 12), 0.001, 128);
    bufSrc.start(t0, clamp(plan.noiseOffset, 0, 1) * buffer.duration * 0.999);
    src = bufSrc;
  } else {
    const osc = ctx.createOscillator();
    if (plan.wave === 'sine') osc.type = 'sine';
    else if (plan.wave === 'saw') osc.type = 'sawtooth';
    else osc.setPeriodicWave(chip.periodicWave(plan.wave === 'triangle' ? 'triangle' : (plan.wave as PulseName)));
    pitchParam = osc.frequency;
    detuneParam = osc.detune;
    toValue = (semis) => clamp(plan.ref * Math.pow(2, semis / 12), 1, nyquist * 0.99);
    osc.start(t0);
    src = osc;
  }

  // --- pitch --------------------------------------------------------------------------------
  const first = plan.pitch[0]!;
  pitchParam.setValueAtTime(toValue(first.semis), t0);
  for (let i = 1; i < plan.pitch.length; i++) {
    const key = plan.pitch[i]!;
    if (key.jump) pitchParam.setValueAtTime(toValue(key.semis), t0 + key.t);
    else pitchParam.exponentialRampToValueAtTime(toValue(key.semis), t0 + key.t);
  }

  // --- vibrato (an LFO on detune, in cents) --------------------------------------------------
  let lfo: OscillatorNode | undefined;
  let lfoGain: GainNode | undefined;
  if (plan.vibrato && detuneParam) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = plan.vibrato.rate;
    lfoGain = ctx.createGain();
    const onset = t0 + plan.vibrato.onset;
    lfoGain.gain.setValueAtTime(0, t0);
    lfoGain.gain.setValueAtTime(0, onset);
    lfoGain.gain.linearRampToValueAtTime(plan.vibrato.cents, onset + plan.vibrato.fade);
    lfo.connect(lfoGain);
    lfoGain.connect(detuneParam);
    lfo.start(t0);
    lfo.stop(tEnd + 0.03);
  }

  // --- filter -------------------------------------------------------------------------------
  let filter: BiquadFilterNode | undefined;
  if (plan.filter) {
    filter = ctx.createBiquadFilter();
    filter.type = plan.filter.type;
    filter.Q.value = filterQValue(plan.filter.type, plan.filter.q);
    const keys = plan.filter.keys;
    filter.frequency.setValueAtTime(clamp(keys[0]!.hz, 10, nyquist * 0.99), t0);
    for (let i = 1; i < keys.length; i++) {
      filter.frequency.exponentialRampToValueAtTime(clamp(keys[i]!.hz, 10, nyquist * 0.99), t0 + keys[i]!.t);
    }
  }

  // --- envelope -----------------------------------------------------------------------------
  const trim = NATIVE_TRIM[plan.wave] ?? 1;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t0);
  for (let i = 1; i < plan.env.length; i++) {
    env.gain.linearRampToValueAtTime(plan.env[i]!.v * trim, t0 + plan.env[i]!.t);
  }
  const cutGain = ctx.createGain();

  if (filter) {
    src.connect(filter);
    filter.connect(env);
  } else {
    src.connect(env);
  }
  env.connect(cutGain);
  cutGain.connect(dest);

  src.stop(tEnd + 0.02);
  src.onended = () => disconnectAll(src, lfo, lfoGain, filter, env, cutGain);

  let cutDone = false;
  const handle: VoiceHandle = {
    endTime: tEnd,
    cut(at, fade = 0.004) {
      const t = Math.max(at, ctx.currentTime);
      if (cutDone || t >= handle.endTime) return;
      cutDone = true;
      cutGain.gain.setValueAtTime(1, t);
      cutGain.gain.linearRampToValueAtTime(0, t + fade);
      try {
        src.stop(t + fade + 0.005);
        lfo?.stop(t + fade + 0.005);
      } catch {
        /* already stopped */
      }
      handle.endTime = t + fade;
    },
  };
  return handle;
}
