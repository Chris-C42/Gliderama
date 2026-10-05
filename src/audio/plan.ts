/**
 * Voice planning: PURE functions that turn a note (or a sound effect) into a `VoicePlan`, a complete,
 * WebAudio-free description of one voice: its envelope breakpoints, pitch curve, vibrato and filter.
 * `chip.ts` then renders a plan with oscillators / buffer sources. Keeping this separate makes all the
 * musically important maths unit-testable in Node.
 */

import type { Instrument, NoteEvent } from './notation';
import { DEFAULT_FORCED_VIBRATO, NOISE_REFERENCE_MIDI } from './notation';
import type { EnvPoint, Envelope, FilterType, PitchKey, SfxWaveName } from './types';
import { isNoiseWave } from './types';

// ------------------------------------------------------------------------------------------------
// Envelope
// ------------------------------------------------------------------------------------------------

/** Shortest attack, so that "instant" attacks do not click. */
export const MIN_ATTACK = 0.001;
/** Shortest release, for the same reason. */
export const MIN_RELEASE = 0.004;
/** Smallest time step between two automation points. */
export const MIN_STEP = 0.0005;

export interface EnvPlan {
  /** Breakpoints (strictly increasing `t`, starting at `{t: 0, v: 0}`), linear between points. */
  points: EnvPoint[];
  /** Time at which the voice is silent again. */
  end: number;
}

function pushPoint(points: EnvPoint[], t: number, v: number): void {
  const last = points[points.length - 1]!;
  points.push({ t: Math.max(t, last.t + MIN_STEP), v });
}

/**
 * Plans a linear ADSR for a note held for `gate` seconds at loudness `peak`.
 *
 * - The note-off at `gate` starts a linear release from whatever level the envelope has reached, so a
 *   short note released mid-attack or mid-decay is handled correctly.
 * - If the sustain level is 0 the sound is percussive: it always plays out its attack + decay, because
 *   cutting a decaying drum hit short at the end of its step would just click.
 */
export function planEnvelope(env: Envelope, gate: number, peak: number): EnvPlan {
  const a = Math.max(env.a, MIN_ATTACK);
  const shape: EnvPoint[] = [
    { t: 0, v: 0 },
    { t: a, v: peak },
  ];
  if (env.s < 1) shape.push({ t: a + Math.max(env.d, MIN_ATTACK), v: peak * env.s });
  const shapeEnd = shape[shape.length - 1]!.t;

  const g = env.s === 0 ? Math.max(gate, shapeEnd) : Math.max(gate, 0);
  const points: EnvPoint[] = [{ t: 0, v: 0 }];
  for (const p of shape.slice(1)) {
    if (p.t < g - MIN_STEP) pushPoint(points, p.t, p.v);
  }
  const atGate = envelopeLevelAt(shape, g);
  if (atGate > 0) {
    pushPoint(points, g, atGate);
    pushPoint(points, g + Math.max(env.r, MIN_RELEASE), 0);
  } else if (points[points.length - 1]!.v !== 0) {
    pushPoint(points, Math.min(g, shapeEnd), 0);
  }
  return { points, end: points[points.length - 1]!.t };
}

/** Value of a piecewise-linear breakpoint list at time `t` (clamped at both ends). */
export function envelopeLevelAt(points: readonly EnvPoint[], t: number): number {
  const first = points[0]!;
  if (t <= first.t) return first.v;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (t <= p.t) {
      const q = points[i - 1]!;
      return q.v + ((p.v - q.v) * (t - q.t)) / (p.t - q.t);
    }
  }
  return points[points.length - 1]!.v;
}

/** Keeps an envelope within `[0, tEnd]`: anything later is replaced by a quick fade to zero ending at `tEnd`. */
function clipEnvelope(points: readonly EnvPoint[], tEnd: number): EnvPoint[] {
  if (points[points.length - 1]!.t <= tEnd) return [...points];
  const tFade = Math.max(tEnd - MIN_RELEASE, 0);
  const out = points.filter((p) => p.t < tFade - MIN_STEP);
  out.push({ t: tFade, v: envelopeLevelAt(points, tFade) }, { t: tEnd, v: 0 });
  return out;
}

/**
 * Plans an envelope that retriggers at each of `starts` (ascending seconds, the first is 0): every
 * segment gets its own attack / decay, and all but the last are faded to silence just before the next
 * one starts. Only the last segment gets the full release. `gate` is the total gate length.
 * Used by sound effects whose arpeggio steps are separate notes.
 */
export function planRetriggeredEnvelope(env: Envelope, starts: readonly number[], gate: number, peak: number): EnvPlan {
  const out: EnvPoint[] = [{ t: 0, v: 0 }];
  starts.forEach((start, i) => {
    const last = i === starts.length - 1;
    let pts: EnvPoint[];
    if (last) {
      pts = planEnvelope(env, Math.max(gate - start, MIN_STEP), peak).points;
    } else {
      const room = starts[i + 1]! - start;
      pts = clipEnvelope(planEnvelope({ ...env, r: MIN_RELEASE }, Math.max(room - MIN_RELEASE, MIN_STEP), peak).points, room);
    }
    for (const p of pts) {
      const t = start + p.t;
      if (t < out[out.length - 1]!.t + MIN_STEP) continue; // the segment's own (0, 0) start point
      out.push({ t, v: p.v });
    }
  });
  return { points: out, end: out[out.length - 1]!.t };
}

// ------------------------------------------------------------------------------------------------
// Pitch
// ------------------------------------------------------------------------------------------------

/** A piecewise-linear curve: `[time, value]` pairs sorted by time, constant outside the range. */
export type Curve = ReadonlyArray<readonly [number, number]>;

export function curveAt(curve: Curve, t: number): number {
  const first = curve[0]!;
  if (t <= first[0]) return first[1];
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i]!;
    if (t <= p[0]) {
      const q = curve[i - 1]!;
      return p[0] === q[0] ? p[1] : q[1] + ((p[1] - q[1]) * (t - q[0])) / (p[0] - q[0]);
    }
  }
  return curve[curve.length - 1]![1];
}

/** Sum of two piecewise-linear curves (exact: evaluated at the union of breakpoints). */
export function addCurves(a: Curve, b: Curve): Curve {
  const times = [...new Set([...a.map((p) => p[0]), ...b.map((p) => p[0])])].sort((x, y) => x - y);
  return times.map((t) => [t, curveAt(a, t) + curveAt(b, t)] as const);
}

export interface PitchPlanInput {
  /** Seconds the pitch plan has to cover (gate length). */
  duration: number;
  /** `^`/`v` slide-in: semitone offset at the start, reaching 0 after `slideTime`. */
  slideFrom?: number;
  slideTime?: number;
  /** Instrument pitch sweep (semitones relative to the note). */
  pitchEnv?: { from: number; to: number; time: number } | null;
  /** Portamento moves: `semis` is relative to the pitch the note started on. */
  glides?: ReadonlyArray<{ at: number; semis: number; time: number }>;
  /** Chord arpeggio. */
  arp?: { offsets: readonly number[]; interval: number } | null;
}

/** Safety cap on arpeggio steps per voice. */
export const MAX_ARP_STEPS = 4000;

/** Builds the pitch curve (semitones relative to the voice's reference pitch) for a note. */
export function planPitch(input: PitchPlanInput): PitchKey[] {
  let curve: Curve = [[0, 0]];
  if (input.slideFrom && input.slideTime && input.slideTime > 0) {
    curve = addCurves(curve, [
      [0, input.slideFrom],
      [input.slideTime, 0],
    ]);
  }
  if (input.pitchEnv) {
    curve = addCurves(curve, [
      [0, input.pitchEnv.from],
      [input.pitchEnv.time, input.pitchEnv.to],
    ]);
  }
  if (input.glides && input.glides.length > 0) {
    const g: Array<readonly [number, number]> = [[0, 0]];
    let prev = 0;
    for (const m of input.glides) {
      g.push([m.at, prev], [m.at + Math.max(m.time, MIN_STEP), m.semis]);
      prev = m.semis;
    }
    curve = addCurves(curve, g);
  }
  return curveToKeys(curve, input.arp ?? null, input.duration);
}

/** Converts a pitch curve (plus optional stepped arpeggio) into automation keys. */
export function curveToKeys(
  curve: Curve,
  arp: { offsets: readonly number[]; interval: number } | null,
  duration: number,
): PitchKey[] {
  if (arp && arp.offsets.length > 0 && arp.interval > 0) {
    const n = Math.min(MAX_ARP_STEPS, Math.max(1, Math.ceil(duration / arp.interval - 1e-9)));
    const keys: PitchKey[] = [];
    for (let k = 0; k < n; k++) {
      const t = k * arp.interval;
      keys.push({ t, semis: curveAt(curve, t) + arp.offsets[k % arp.offsets.length]!, jump: true });
    }
    return keys;
  }
  const keys: PitchKey[] = [];
  for (const [t, semis] of curve) {
    const last = keys[keys.length - 1];
    if (last && t - last.t < 1e-6) {
      last.semis = semis; // collapse duplicate times
    } else {
      keys.push({ t, semis });
    }
  }
  return keys;
}

/** True when the pitch never moves (a single key). */
export function isStaticPitch(keys: readonly PitchKey[]): boolean {
  return keys.length === 1 || keys.every((k) => k.semis === keys[0]!.semis);
}

// ------------------------------------------------------------------------------------------------
// Voice plans
// ------------------------------------------------------------------------------------------------

export interface VibratoPlan {
  /** Peak deviation in cents. */
  cents: number;
  rate: number;
  /** Seconds after the voice start at which the vibrato begins to fade in. */
  onset: number;
  /** Seconds the vibrato takes to reach full depth. */
  fade: number;
}

export interface FilterPlan {
  type: FilterType;
  q: number;
  /** Cutoff keys in Hz; the filter sweeps exponentially between them. */
  keys: Array<{ t: number; hz: number }>;
}

/** Everything needed to render one voice. All times are seconds relative to the voice's start. */
export interface VoicePlan {
  wave: SfxWaveName;
  /** Offset of the voice from the plan origin (used by multi-voice sound effects). */
  start: number;
  gate: number;
  env: EnvPoint[];
  /** Time the voice is silent again (end of the envelope). */
  end: number;
  /** Pitch keys in semitones relative to `ref`. */
  pitch: PitchKey[];
  /** Oscillators: frequency in Hz at 0 semitones. Noise: playbackRate at 0 semitones. */
  ref: number;
  vibrato: VibratoPlan | null;
  filter: FilterPlan | null;
  /** 0..1: where in the looping noise buffer to begin (hit-to-hit variation). */
  noiseOffset: number;
}

/** Vibrato fade-in time. */
export const VIBRATO_FADE = 0.04;

export interface MusicVoiceOptions {
  /** 0..1 start position in the noise buffer. */
  noiseOffset?: number;
  /** Overrides the gate length (used when an event starts late and has to be shortened). */
  gate?: number;
}

/** Plans the voice for one compiled note event. */
export function planMusicVoice(ev: NoteEvent, inst: Instrument, opts: MusicVoiceOptions = {}): VoicePlan {
  const gate = opts.gate ?? ev.duration;
  const noise = isNoiseWave(inst.wave);
  const env = planEnvelope(inst.env, gate, inst.vol * ev.velocity);
  const pitch = planPitch({
    duration: gate,
    slideFrom: ev.slideFrom,
    slideTime: ev.slideTime,
    pitchEnv: inst.pitchEnv,
    glides: ev.glides.map((g) => ({ at: g.at, semis: g.midi - ev.midi, time: g.time })),
    arp: inst.arp ? { offsets: inst.arp, interval: inst.arpSpeed } : null,
  });

  let vibrato: VibratoPlan | null = null;
  if (!noise) {
    let depth = 0;
    let rate = 0;
    let onset = Infinity;
    if (inst.vibrato && inst.vibrato.auto) {
      depth = inst.vibrato.depth;
      rate = inst.vibrato.rate;
      onset = inst.vibrato.delay;
    }
    if (ev.forcedVibratoAt !== null) {
      const base = inst.vibrato ?? DEFAULT_FORCED_VIBRATO;
      depth = base.depth;
      rate = base.rate;
      onset = Math.min(onset, ev.forcedVibratoAt);
    }
    if (depth > 0 && onset < env.end) {
      vibrato = { cents: depth * 100, rate, onset, fade: VIBRATO_FADE };
    }
  }

  return {
    wave: inst.wave,
    start: 0,
    gate,
    env: env.points,
    end: env.end,
    pitch,
    ref: noise ? inst.noiseRate * Math.pow(2, (ev.midi - NOISE_REFERENCE_MIDI) / 12) : ev.freq,
    vibrato,
    filter: inst.filter
      ? { type: inst.filter.type, q: inst.filter.q ?? 0.7, keys: [{ t: 0, hz: inst.filter.freq }] }
      : null,
    noiseOffset: opts.noiseOffset ?? 0,
  };
}

// ------------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Frequency ratio of a number of semitones. */
export function semisToRatio(semis: number): number {
  return Math.pow(2, semis / 12);
}

/** Deterministic PRNG (mulberry32): returns a function giving numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of two integers to a number in [0, 1). */
export function hash01(a: number, b: number): number {
  return mulberry32((Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b)) >>> 0)();
}
