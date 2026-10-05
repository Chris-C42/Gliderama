/**
 * Continuous sound loops (wind, vent, fan hum, fire crackle, rain ...): layers of looping noise buffers
 * and oscillators, each with filters and slow LFO modulation, controlled live through `setVolume` and
 * `setPitch` with smooth parameter ramps.
 */

import { getChip, disconnectAll, filterQValue, type NoiseKind } from './chip';
import { clamp, semisToRatio } from './plan';
import type { FilterType, SfxWaveName } from './types';
import { isNoiseWave } from './types';

/** `white`..`crackleB` are procedural noise buffers; the rest are oscillators / LFSR noise. */
export type LoopSource = 'white' | 'pink' | 'brown' | 'crackleA' | 'crackleB' | SfxWaveName;

const BUFFER_SOURCES: Partial<Record<LoopSource, NoiseKind>> = {
  white: 'white',
  pink: 'pink',
  brown: 'brown',
  crackleA: 'crackleA',
  crackleB: 'crackleB',
  noise: 'long',
  'noise-short': 'short',
};

export interface LoopFilter {
  type: FilterType;
  /** Cutoff / centre in Hz. */
  freq: number;
  q?: number;
  /** Fraction of the loop's pitch shift applied to the cutoff (default 1: it follows `setPitch`). */
  track?: number;
}

export interface LoopMod {
  target: 'gain' | 'freq' | 'filter';
  /** For `filter`: which of the layer's filters (default 0). */
  filter?: number;
  /** Sine LFO rates in Hz. Several incommensurate rates sum to an organic, never-repeating wobble. */
  rates: number[];
  /** `gain`: fraction of the layer gain. `freq` / `filter`: Hz. */
  depth: number;
}

export interface LoopLayer {
  source: LoopSource;
  /** Oscillator frequency in Hz. */
  freq?: number;
  /** Noise buffer playback-rate multiplier (default 1). */
  rate?: number;
  /** Layer level. */
  gain: number;
  filters?: LoopFilter[];
  /** How strongly `setPitch` moves the oscillator frequency / noise rate (default 1 for oscillators, 0 for noise). */
  pitchTrack?: number;
  mods?: LoopMod[];
}

export interface LoopDef {
  /** Overall level (default 0.5), multiplied with `setVolume`. */
  vol?: number;
  layers: LoopLayer[];
}

export interface LoopStartOptions {
  /** Initial volume 0..1 (default 1). */
  vol?: number;
  /** Initial pitch shift in semitones (default 0). */
  pitch?: number;
  /** Fade-in seconds (default 0.15). */
  fadeIn?: number;
}

export const DEFAULT_LOOP_VOLUME = 0.5;

export function validateLoopDef(name: string, def: LoopDef): void {
  const bad = (msg: string): never => {
    throw new Error(`loop "${name}": ${msg}`);
  };
  if (!Array.isArray(def.layers) || def.layers.length === 0) bad('needs at least one layer');
  def.layers.forEach((layer, i) => {
    const where = `layers[${i}]`;
    const known = layer.source in BUFFER_SOURCES || ['pulse12', 'pulse25', 'pulse50', 'pulse75', 'triangle', 'sine', 'saw'].includes(layer.source);
    if (!known) bad(`${where}.source "${String(layer.source)}" is unknown`);
    if (!(layer.source in BUFFER_SOURCES) && !(layer.freq && layer.freq > 0)) bad(`${where} oscillators need a freq`);
    if (!(layer.gain >= 0)) bad(`${where}.gain must be >= 0`);
    for (const m of layer.mods ?? []) {
      if (!m.rates.length) bad(`${where} a modulation needs at least one rate`);
      if (m.target === 'filter' && !(layer.filters ?? [])[m.filter ?? 0]) bad(`${where} modulates a filter that does not exist`);
      if (m.target === 'freq' && layer.source in BUFFER_SOURCES) bad(`${where} "freq" modulation only works on oscillators`);
    }
  });
}

/** One running loop. Use through the handle returned by `SfxPlayer.startLoop`. */
export class LoopInstance {
  private readonly all: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly follow: Array<{ param: AudioParam; base: number; track: number }> = [];
  private readonly out: GainNode;
  private readonly baseVol: number;
  private volume: number;
  private pitch: number;
  private stopped = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    def: LoopDef,
    options: LoopStartOptions = {},
  ) {
    this.baseVol = def.vol ?? DEFAULT_LOOP_VOLUME;
    this.volume = clamp(options.vol ?? 1, 0, 2);
    this.pitch = options.pitch ?? 0;
    const now = ctx.currentTime;
    this.out = ctx.createGain();
    // Fade in with a target curve rather than a ramp: later setVolume() calls simply chain onto it
    // (cancelling an in-flight ramp would snap the gain back to its start value).
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.setTargetAtTime(this.baseVol * this.volume, now, Math.max(options.fadeIn ?? 0.15, 0.01) / 4);
    this.out.connect(dest);
    this.all.push(this.out);
    for (const layer of def.layers) this.buildLayer(layer, now);
  }

  private buildLayer(layer: LoopLayer, now: number): void {
    const ctx = this.ctx;
    const chip = getChip(ctx);
    const ratio = semisToRatio(this.pitch);

    // --- source ---------------------------------------------------------------------------
    let src: AudioScheduledSourceNode;
    let pitchParam: AudioParam;
    let baseValue: number;
    let track: number;
    const bufferKind = BUFFER_SOURCES[layer.source];
    if (bufferKind) {
      const b = ctx.createBufferSource();
      b.buffer = chip.noiseBuffer(bufferKind);
      b.loop = true;
      baseValue = layer.rate ?? 1;
      track = layer.pitchTrack ?? 0;
      b.playbackRate.value = baseValue * Math.pow(ratio, track);
      b.start(now, Math.random() * b.buffer.duration * 0.99);
      src = b;
      pitchParam = b.playbackRate;
    } else {
      const o = ctx.createOscillator();
      const wave = layer.source as SfxWaveName;
      if (wave === 'sine') o.type = 'sine';
      else if (wave === 'saw') o.type = 'sawtooth';
      else if (!isNoiseWave(wave)) o.setPeriodicWave(chip.periodicWave(wave as 'pulse12' | 'pulse25' | 'pulse50' | 'pulse75' | 'triangle'));
      baseValue = layer.freq ?? 100;
      track = layer.pitchTrack ?? 1;
      o.frequency.value = baseValue * Math.pow(ratio, track);
      o.start(now);
      src = o;
      pitchParam = o.frequency;
    }
    this.sources.push(src);
    this.all.push(src);
    this.follow.push({ param: pitchParam, base: baseValue, track });

    // --- filters --------------------------------------------------------------------------
    const filters: BiquadFilterNode[] = [];
    let node: AudioNode = src;
    for (const f of layer.filters ?? []) {
      const bq = ctx.createBiquadFilter();
      bq.type = f.type;
      bq.Q.value = filterQValue(f.type, f.q ?? 0.7);
      const fTrack = f.track ?? 1;
      bq.frequency.value = f.freq * Math.pow(ratio, fTrack);
      this.follow.push({ param: bq.frequency, base: f.freq, track: fTrack });
      node.connect(bq);
      node = bq;
      filters.push(bq);
      this.all.push(bq);
    }

    const gain = ctx.createGain();
    gain.gain.value = layer.gain;
    node.connect(gain);
    gain.connect(this.out);
    this.all.push(gain);

    // --- slow modulation ------------------------------------------------------------------
    for (const mod of layer.mods ?? []) {
      const target =
        mod.target === 'gain' ? gain.gain : mod.target === 'freq' ? pitchParam : filters[mod.filter ?? 0]!.frequency;
      const depth = mod.target === 'gain' ? mod.depth * layer.gain : mod.depth;
      const each = depth / mod.rates.length;
      for (const rate of mod.rates) {
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = rate;
        const amount = ctx.createGain();
        amount.gain.value = each;
        lfo.connect(amount);
        amount.connect(target);
        lfo.start(now + Math.random() / rate); // random phase so layers do not wobble in lockstep
        this.sources.push(lfo);
        this.all.push(lfo, amount);
      }
    }
  }

  /** Sets the loop volume (0..1, multiplied with the loop's own level) with a smooth ramp. */
  setVolume(volume: number, timeConstant = 0.05): void {
    if (this.stopped) return;
    this.volume = clamp(Number.isFinite(volume) ? volume : 0, 0, 2);
    this.out.gain.setTargetAtTime(this.baseVol * this.volume, this.ctx.currentTime, timeConstant);
  }

  /** Shifts the pitch of the loop in semitones with a smooth ramp (oscillators, noise rate, filter cutoffs). */
  setPitch(semitones: number, timeConstant = 0.08): void {
    if (this.stopped) return;
    this.pitch = clamp(Number.isFinite(semitones) ? semitones : 0, -48, 48);
    const now = this.ctx.currentTime;
    const ratio = semisToRatio(this.pitch);
    for (const f of this.follow) {
      f.param.setTargetAtTime(f.base * Math.pow(ratio, f.track), now, timeConstant);
    }
  }

  /** Fades out and releases all nodes. */
  stop(fade = 0.2): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    const f = Math.max(fade, 0.01);
    const current = this.out.gain.value; // read before cancelling
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(current, now);
    this.out.gain.linearRampToValueAtTime(0, now + f);
    for (const s of this.sources) {
      try {
        s.stop(now + f + 0.05);
      } catch {
        /* already stopped */
      }
    }
    const first = this.sources[0];
    if (first) first.onended = () => disconnectAll(...this.all);
    else disconnectAll(...this.all);
  }

  get isStopped(): boolean {
    return this.stopped;
  }
}
