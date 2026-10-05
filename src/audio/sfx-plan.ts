/**
 * Sound-effect definitions (sfxr-like) and their pure planner.
 *
 * A `SfxDef` describes one sound with a handful of intuitive parameters; `planSfx` turns it into
 * `VoicePlan`s (one per voice per repeat) that `chip.ts` renders. No WebAudio in here, so every
 * parameter is unit-testable.
 */

import {
  clamp,
  curveAt,
  curveToKeys,
  planEnvelope,
  planRetriggeredEnvelope,
  semisToRatio,
  VIBRATO_FADE,
  type Curve,
  type EnvPlan,
  type VoicePlan,
} from './plan';
import type { Envelope, FilterType, PitchKey, SfxWaveName, VibratoDef } from './types';
import { SFX_WAVE_NAMES, isNoiseWave } from './types';

/** Sample rate that a noise buffer is authored at: a noise "frequency" of this many Hz = native clock. */
export const NOISE_CLOCK_HZ = 44100;

export interface SfxArp {
  /** Semitone offsets stepped through, e.g. `[0, 4, 7, 12]`. */
  steps: number[];
  /** Seconds per step. */
  interval: number;
  /** `cycle` (default) repeats the steps (a chord); `once` plays them once and holds the last (a jingle). */
  mode?: 'cycle' | 'once';
  /** Restart the envelope at every step (separate notes) instead of one continuous envelope. */
  retrigger?: boolean;
}

export interface SfxFilter {
  type: FilterType;
  /** Cutoff / centre frequency in Hz at the start. */
  freq: number;
  /** Cutoff at the end of the sweep (exponential). Omit for a fixed filter. */
  endFreq?: number;
  /** Seconds the sweep takes (default: the duration). */
  time?: number;
  /** Q factor (default 0.7, flat). */
  q?: number;
}

export interface SfxRepeat {
  /** Total number of plays (1 = no repeat). */
  count: number;
  /** Seconds between the starts of repeats. */
  interval: number;
  /** Volume multiplier applied per repeat (0.8 = each repeat 20 % quieter). Default 1. */
  volDecay?: number;
  /** Semitones added per repeat. Default 0. */
  pitchStep?: number;
}

/** One voice of a sound effect. */
export interface SfxVoiceDef {
  wave: SfxWaveName;
  /**
   * Start frequency in Hz. For the noise waves this is the noise clock: about 44100 is full-band
   * white noise, 8000 is darker, 1000 is a rumble (for `noise-short` the buzz pitch is freq / 93).
   */
  freq: number;
  /** Frequency reached after `slideTime` (exponential glide). */
  endFreq?: number;
  /** Seconds the slide takes (default: `duration`). */
  slideTime?: number;
  /** Slide shape: 1 = even, >1 = slow start / fast end, <1 = fast start / slow end. */
  slideCurve?: number;
  /** Free pitch contour as `[seconds, Hz]` points after the start (replaces `endFreq`). */
  path?: Array<[number, number]>;
  /** Gate length in seconds (the release rings after it). */
  duration: number;
  /** ADSR (default `{ a: 0.002, d: 0, s: 1, r: 0.03 }`). */
  env?: Partial<Envelope>;
  /** Loudness 0..1 (default 0.5). */
  vol?: number;
  vibrato?: VibratoDef;
  arp?: SfxArp;
  filter?: SfxFilter;
  repeat?: SfxRepeat;
  /** Random pitch variation in semitones (plus or minus), re-rolled on every play. */
  jitter?: number;
  /** Seconds before this voice starts. */
  delay?: number;
}

export interface SfxDef extends SfxVoiceDef {
  /** Extra voices played together with the main one (their own wave / pitch / delay ...). */
  layers?: SfxVoiceDef[];
  /** Level multiplier for the whole sound, layers included (default 1). Handy to balance loudness. */
  gain?: number;
  /** Minimum seconds between two plays of this sound (prevents spam stacking). Default 0. */
  cooldown?: number;
  /** Maximum simultaneous plays; the oldest is cut when exceeded. Default 4. */
  maxVoices?: number;
}

export const DEFAULT_SFX_ENVELOPE: Readonly<Envelope> = { a: 0.002, d: 0, s: 1, r: 0.03 };
export const DEFAULT_SFX_VOLUME = 0.5;
export const DEFAULT_MAX_VOICES = 4;
/** Safety limits. */
const MAX_REPEATS = 64;
const MAX_RETRIGGERS = 256;

export interface SfxPlan {
  voices: VoicePlan[];
  /** Seconds from the start until every voice is silent. */
  duration: number;
}

export interface SfxPlanOptions {
  /** Volume multiplier (default 1). */
  vol?: number;
  /** Pitch shift in semitones (default 0). Scales oscillator frequency, noise clock and filter cutoffs. */
  pitch?: number;
}

/** Plans every voice (main + layers, each with its repeats) of a sound effect. */
export function planSfx(def: SfxDef, options: SfxPlanOptions = {}, rand: () => number = Math.random): SfxPlan {
  const vol = options.vol ?? 1;
  const pitch = options.pitch ?? 0;
  const voices: VoicePlan[] = [];
  for (const voice of [def as SfxVoiceDef, ...(def.layers ?? [])]) {
    const rep = voice.repeat ?? { count: 1, interval: 0 };
    const count = clamp(Math.floor(rep.count), 1, MAX_REPEATS);
    for (let i = 0; i < count; i++) {
      const jitter = voice.jitter ? (rand() * 2 - 1) * voice.jitter : 0;
      voices.push(
        planVoice(voice, {
          start: (voice.delay ?? 0) + i * rep.interval,
          semis: pitch + jitter + i * (rep.pitchStep ?? 0),
          peak: (voice.vol ?? DEFAULT_SFX_VOLUME) * (def.gain ?? 1) * vol * Math.pow(rep.volDecay ?? 1, i),
          noiseOffset: rand(),
        }),
      );
    }
  }
  const duration = voices.reduce((m, v) => Math.max(m, v.start + v.end), 0);
  return { voices, duration };
}

interface VoiceRun {
  start: number;
  semis: number;
  peak: number;
  noiseOffset: number;
}

function planVoice(v: SfxVoiceDef, run: VoiceRun): VoicePlan {
  const noise = isNoiseWave(v.wave);
  const ratio = semisToRatio(run.semis);
  const gate = v.duration;
  const curve = baseCurve(v);
  const envDef: Envelope = { ...DEFAULT_SFX_ENVELOPE, ...(v.env ?? {}) };

  let keys: PitchKey[];
  let env: EnvPlan;
  const arp = v.arp && v.arp.steps.length > 0 && v.arp.interval > 0 ? v.arp : null;
  if (arp) {
    const once = arp.mode === 'once';
    if (once) {
      keys = arp.steps.map((s, k) => ({ t: k * arp.interval, semis: curveAt(curve, k * arp.interval) + s, jump: true }));
    } else {
      keys = curveToKeys(curve, { offsets: arp.steps, interval: arp.interval }, gate);
    }
    if (arp.retrigger) {
      const count = once ? arp.steps.length : Math.min(MAX_RETRIGGERS, Math.max(1, Math.ceil(gate / arp.interval - 1e-9)));
      const starts = Array.from({ length: count }, (_, k) => k * arp.interval).filter((t, k) => k === 0 || t < gate);
      env = planRetriggeredEnvelope(envDef, starts, gate, run.peak);
    } else {
      env = planEnvelope(envDef, gate, run.peak);
    }
  } else {
    keys = curveToKeys(curve, null, gate);
    env = planEnvelope(envDef, gate, run.peak);
  }
  keys = keys.filter((k, i) => i === 0 || k.t < env.end);

  let vibrato: VoicePlan['vibrato'] = null;
  if (v.vibrato && !noise) {
    const onset = v.vibrato.delay ?? 0;
    if (v.vibrato.depth > 0 && onset < env.end) {
      vibrato = { cents: v.vibrato.depth * 100, rate: v.vibrato.rate, onset, fade: VIBRATO_FADE };
    }
  }

  let filter: VoicePlan['filter'] = null;
  if (v.filter) {
    const f = v.filter;
    const fkeys = [{ t: 0, hz: f.freq * ratio }];
    if (f.endFreq !== undefined) fkeys.push({ t: Math.max(f.time ?? gate, 0.001), hz: f.endFreq * ratio });
    filter = { type: f.type, q: f.q ?? 0.7, keys: fkeys };
  }

  return {
    wave: v.wave,
    start: run.start,
    gate,
    env: env.points,
    end: env.end,
    pitch: keys,
    ref: noise ? (v.freq / NOISE_CLOCK_HZ) * ratio : v.freq * ratio,
    vibrato,
    filter,
    noiseOffset: run.noiseOffset,
  };
}

/** The pitch contour of a voice in semitones relative to its start frequency. */
function baseCurve(v: SfxVoiceDef): Curve {
  const st = (hz: number): number => 12 * Math.log2(hz / v.freq);
  if (v.path && v.path.length > 0) {
    const pts: Array<readonly [number, number]> = [[0, 0]];
    for (const [t, hz] of [...v.path].sort((a, b) => a[0] - b[0])) {
      if (t > pts[pts.length - 1]![0]) pts.push([t, st(hz)]);
    }
    return pts;
  }
  if (v.endFreq !== undefined && v.endFreq !== v.freq) {
    const total = st(v.endFreq);
    const time = Math.max(v.slideTime ?? v.duration, 0.001);
    const shape = v.slideCurve ?? 1;
    if (shape === 1) {
      return [
        [0, 0],
        [time, total],
      ];
    }
    const n = 16;
    return Array.from({ length: n + 1 }, (_, i) => [(i / n) * time, total * Math.pow(i / n, shape)] as const);
  }
  return [[0, 0]];
}

// ------------------------------------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------------------------------------

/** Throws a descriptive Error if a sound-effect definition is unusable. */
export function validateSfxDef(name: string, def: SfxDef): void {
  const bad = (msg: string): never => {
    throw new Error(`sfx "${name}": ${msg}`);
  };
  const num = (value: unknown, label: string, min: number, max = Infinity): void => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      bad(`${label} must be a number between ${min} and ${max} (got ${String(value)})`);
    }
  };
  const checkVoice = (v: SfxVoiceDef, where: string): void => {
    if (!SFX_WAVE_NAMES.includes(v.wave)) bad(`${where}wave "${String(v.wave)}" is unknown (use ${SFX_WAVE_NAMES.join(', ')})`);
    num(v.freq, `${where}freq`, 1, 200000);
    num(v.duration, `${where}duration`, 0.001, 30);
    if (v.endFreq !== undefined) num(v.endFreq, `${where}endFreq`, 1, 200000);
    if (v.slideTime !== undefined) num(v.slideTime, `${where}slideTime`, 0.001);
    if (v.slideCurve !== undefined) num(v.slideCurve, `${where}slideCurve`, 0.05, 20);
    if (v.vol !== undefined) num(v.vol, `${where}vol`, 0, 4);
    if (v.jitter !== undefined) num(v.jitter, `${where}jitter`, 0, 24);
    if (v.delay !== undefined) num(v.delay, `${where}delay`, 0, 30);
    for (const k of ['a', 'd', 'r'] as const) if (v.env?.[k] !== undefined) num(v.env[k], `${where}env.${k}`, 0, 30);
    if (v.env?.s !== undefined) num(v.env.s, `${where}env.s`, 0, 1);
    v.path?.forEach(([t, hz], i) => {
      num(t, `${where}path[${i}] time`, 0);
      num(hz, `${where}path[${i}] Hz`, 1, 200000);
    });
    if (v.vibrato) {
      num(v.vibrato.depth, `${where}vibrato.depth`, 0, 12);
      num(v.vibrato.rate, `${where}vibrato.rate`, 0.1, 40);
    }
    if (v.arp) {
      if (!Array.isArray(v.arp.steps) || v.arp.steps.length === 0) bad(`${where}arp.steps must be a non-empty array`);
      v.arp.steps.forEach((s, i) => num(s, `${where}arp.steps[${i}]`, -96, 96));
      num(v.arp.interval, `${where}arp.interval`, 0.002, 10);
    }
    if (v.filter) {
      if (!['lowpass', 'highpass', 'bandpass'].includes(v.filter.type)) bad(`${where}filter.type must be lowpass, highpass or bandpass`);
      num(v.filter.freq, `${where}filter.freq`, 10, 40000);
      if (v.filter.endFreq !== undefined) num(v.filter.endFreq, `${where}filter.endFreq`, 10, 40000);
    }
    if (v.repeat) {
      num(v.repeat.count, `${where}repeat.count`, 1, MAX_REPEATS);
      num(v.repeat.interval, `${where}repeat.interval`, 0.001, 30);
    }
  };
  checkVoice(def, '');
  def.layers?.forEach((layer, i) => checkVoice(layer, `layers[${i}].`));
  if (def.gain !== undefined) num(def.gain, 'gain', 0, 8);
  if (def.cooldown !== undefined) num(def.cooldown, 'cooldown', 0, 60);
  if (def.maxVoices !== undefined) num(def.maxVoices, 'maxVoices', 1, 32);
}
