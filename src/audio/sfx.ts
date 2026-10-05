/**
 * Sound effects: a registry of sfxr-like parametric definitions, one-shot playback with cooldown and
 * per-sound polyphony limits, and continuous loops with live volume / pitch control.
 *
 * - `playSfx(name, { vol?, pitch? (semitones), pan? })` never throws; before `unlock()` it does nothing.
 * - `startLoop(name)` returns a handle for `setVolume`, `setPitch` and `stop(fade?)`. A loop started
 *   before `unlock()` begins once audio runs (and keeps the latest volume / pitch you gave it).
 */

import { getChip, startVoice, supportsStereoPanner, type VoiceHandle } from './chip';
import type { AudioEngine } from './engine';
import { LoopInstance, validateLoopDef, type LoopDef, type LoopStartOptions } from './loops';
import { clamp } from './plan';
import { LOOP_DEFS, SFX_DEFS, type LoopName, type SfxName } from './sfx-defs';
import { DEFAULT_MAX_VOICES, planSfx, validateSfxDef, type SfxDef } from './sfx-plan';

export interface PlaySfxOptions {
  /** Volume multiplier (default 1). */
  vol?: number;
  /** Pitch shift in semitones (default 0). */
  pitch?: number;
  /** Stereo position -1 (left) .. 1 (right) (default 0). */
  pan?: number;
}

export interface LoopHandle {
  /** Sets the loop volume 0..1 (smoothly). */
  setVolume(volume: number): void;
  /** Shifts the loop's pitch in semitones (smoothly). */
  setPitch(semitones: number): void;
  /** Fades out (default 0.2 s) and releases the loop. */
  stop(fade?: number): void;
  /** False once stopped. */
  readonly active: boolean;
}

/** Autocompletes the built-in names but accepts any registered name. */
export type SfxKey = SfxName | (string & {});
export type LoopKey = LoopName | (string & {});

/** Seconds added to the current audio time so the first samples of a sound are never in the past. */
const START_LEAD = 0.002;

interface Instance {
  endTime: number;
  group: GainNode;
  panner?: StereoPannerNode;
  handles: VoiceHandle[];
  cutAll(at: number): void;
}

interface LoopState {
  vol: number;
  pitch: number;
  stopped: boolean;
  inst: LoopInstance | null;
}

/**
 * Plans a sound effect and starts all of its voices on any context (live or offline) at audio time
 * `origin`, connected to `dest`. Used by `SfxPlayer.play` and for offline rendering.
 */
export function startSfxVoices(
  ctx: BaseAudioContext,
  dest: AudioNode,
  def: SfxDef,
  options: Pick<PlaySfxOptions, 'vol' | 'pitch'> = {},
  origin = 0,
  rand: () => number = Math.random,
): { handles: VoiceHandle[]; duration: number } {
  const plan = planSfx(def, { vol: clamp(options.vol ?? 1, 0, 4), pitch: clamp(options.pitch ?? 0, -48, 48) }, rand);
  const chip = getChip(ctx);
  const handles = plan.voices.map((voice) => startVoice(chip, dest, voice, origin));
  return { handles, duration: plan.duration };
}

const INERT_LOOP: LoopHandle = {
  setVolume() {},
  setPitch() {},
  stop() {},
  active: false,
};

export class SfxPlayer {
  private readonly defs = new Map<string, SfxDef>(Object.entries(SFX_DEFS) as Array<[string, SfxDef]>);
  private readonly loopDefs = new Map<string, LoopDef>(Object.entries(LOOP_DEFS) as Array<[string, LoopDef]>);
  private readonly lastPlayed = new Map<string, number>();
  private readonly active = new Map<string, Instance[]>();
  private readonly liveLoops = new Set<LoopState>();
  private readonly warned = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly engine: AudioEngine) {}

  // ---- registry ------------------------------------------------------------------------------

  /** Adds or replaces a sound effect. Throws if the definition is invalid. */
  register(name: string, def: SfxDef): void {
    validateSfxDef(name, def);
    this.defs.set(name, def);
  }

  /** Adds or replaces a loop definition. Throws if the definition is invalid. */
  registerLoop(name: string, def: LoopDef): void {
    validateLoopDef(name, def);
    this.loopDefs.set(name, def);
  }

  names(): string[] {
    return [...this.defs.keys()];
  }

  loopNames(): string[] {
    return [...this.loopDefs.keys()];
  }

  // ---- one-shots -----------------------------------------------------------------------------

  /**
   * Plays a sound effect. Returns true if it was started, false if it was skipped (not unlocked, unknown
   * name, or still in its cooldown).
   */
  play(name: SfxKey, options: PlaySfxOptions = {}): boolean {
    const ctx = this.engine.ctx;
    const bus = this.engine.sfxBus;
    if (!ctx || !bus || !this.engine.canSchedule) return false;
    const def = this.defs.get(name);
    if (!def) {
      this.warnOnce(`sfx:${name}`, `[audio] unknown sound effect "${name}"`);
      return false;
    }
    const now = ctx.currentTime;

    // Cooldown: ignore plays that come too soon after the last one.
    if (def.cooldown) {
      const last = this.lastPlayed.get(name);
      if (last !== undefined && now - last < def.cooldown) return false;
    }
    // Polyphony: cut the oldest still-sounding plays to make room.
    const sounding = (this.active.get(name) ?? []).filter((i) => i.endTime > now);
    while (sounding.length >= (def.maxVoices ?? DEFAULT_MAX_VOICES)) sounding.shift()!.cutAll(now);

    const group = ctx.createGain();
    let panner: StereoPannerNode | undefined;
    if (options.pan && supportsStereoPanner(ctx)) {
      panner = ctx.createStereoPanner();
      panner.pan.value = clamp(options.pan, -1, 1);
      group.connect(panner);
      panner.connect(bus);
    } else {
      group.connect(bus);
    }
    const origin = now + START_LEAD;
    const { handles, duration } = startSfxVoices(ctx, group, def, options, origin);
    const instance: Instance = {
      endTime: origin + duration,
      group,
      panner,
      handles,
      cutAll(at) {
        const t = Math.max(at, ctx.currentTime);
        group.gain.setValueAtTime(1, t);
        group.gain.linearRampToValueAtTime(0, t + 0.012);
        for (const h of handles) h.cut(t, 0.012);
        this.endTime = t + 0.02;
      },
    };
    sounding.push(instance);
    this.active.set(name, sounding);
    this.lastPlayed.set(name, now);
    this.ensureSweeper();
    return true;
  }

  // ---- loops ---------------------------------------------------------------------------------

  /**
   * Starts a continuous loop and returns a handle to steer it. Unknown names return an inert handle.
   */
  startLoop(name: LoopKey, options: LoopStartOptions = {}): LoopHandle {
    const def = this.loopDefs.get(name);
    if (!def) {
      this.warnOnce(`loop:${name}`, `[audio] unknown loop "${name}"`);
      return INERT_LOOP;
    }
    const state: LoopState = { vol: options.vol ?? 1, pitch: options.pitch ?? 0, stopped: false, inst: null };
    this.liveLoops.add(state);
    this.engine.whenRunning((ctx) => {
      if (state.stopped || state.inst || !this.engine.sfxBus) return;
      state.inst = new LoopInstance(ctx, this.engine.sfxBus, def, { vol: state.vol, pitch: state.pitch, fadeIn: options.fadeIn });
    });
    return {
      setVolume: (volume) => {
        state.vol = volume;
        state.inst?.setVolume(volume);
      },
      setPitch: (semitones) => {
        state.pitch = semitones;
        state.inst?.setPitch(semitones);
      },
      stop: (fade) => {
        if (state.stopped) return;
        state.stopped = true;
        this.liveLoops.delete(state);
        state.inst?.stop(fade);
      },
      get active() {
        return !state.stopped;
      },
    };
  }

  /** Stops every running loop (e.g. when leaving a room). */
  stopAllLoops(fade = 0.2): void {
    for (const state of [...this.liveLoops]) {
      state.stopped = true;
      state.inst?.stop(fade);
    }
    this.liveLoops.clear();
  }

  /** Releases everything (tests, hot reload). */
  dispose(): void {
    this.stopAllLoops(0.01);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.active.clear();
  }

  // ---- internals -----------------------------------------------------------------------------

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }

  /** Disconnects finished plays so the graph does not grow without bound. */
  private ensureSweeper(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.engine.onTick((now) => {
      let remaining = 0;
      for (const [name, list] of this.active) {
        const alive: Instance[] = [];
        for (const inst of list) {
          if (inst.endTime + 0.1 < now) {
            try {
              inst.group.disconnect();
              inst.panner?.disconnect();
            } catch {
              /* already disconnected */
            }
          } else {
            alive.push(inst);
          }
        }
        if (alive.length) this.active.set(name, alive);
        else this.active.delete(name);
        remaining += alive.length;
      }
      if (remaining === 0) {
        this.unsubscribe?.();
        this.unsubscribe = null;
      }
    });
  }
}
