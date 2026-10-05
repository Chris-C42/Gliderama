/**
 * Music player: plays compiled songs through the chip voices with sample-accurate lookahead scheduling.
 *
 * - Every ~25 ms (`AudioEngine.onTick`) the player asks the `SongCursor` for the events due in the next
 *   ~120 ms of audio-clock time and starts a voice for each at its exact time.
 * - Each (track, instrument) pair is a monophonic channel: a new note cuts the tail of the previous one,
 *   like real chip hardware.
 * - Songs are parsed once (`parseSong` caches by object identity).
 * - Requests made before `unlock()` are remembered and start as soon as audio is running.
 */

import { getChip, startVoice, type ChipResources, type VoiceHandle } from './chip';
import { LOOKAHEAD_SECONDS, type AudioEngine } from './engine';
import { parseSong, type CompiledSong, type Instrument, type SongDef } from './notation';
import { hash01, planMusicVoice } from './plan';
import { SongCursor, type TimedEvent } from './sequencer';

export interface PlayMusicOptions {
  /** Seconds to fade the song in (default 0: starts immediately, still click-free). */
  fadeIn?: number;
  /** Restart the song even if it is already the current one (default false: keep playing). */
  restart?: boolean;
  /** Called once when a non-looping song has finished sounding. */
  onEnd?: () => void;
}

export interface StopMusicOptions {
  /** Seconds to fade out (default 0.15). */
  fadeOut?: number;
}

/** Seconds from the call until the first event, so that nothing is late. */
const START_DELAY = 0.06;
/** Fade used when a song is replaced by `playMusic` (a crossfade uses its own duration). */
const REPLACE_FADE = 0.12;
const DEFAULT_STOP_FADE = 0.15;
/** An event up to this late is still started (with a shortened gate); later ones are skipped. */
const MAX_LATE = 0.08;
/** Events older than this are not even considered (stall recovery). */
const MAX_CATCH_UP = 4;

// ------------------------------------------------------------------------------------------------
// Voice scheduling shared by the live player and offline rendering
// ------------------------------------------------------------------------------------------------

/** Starts the voices for a song's events and manages the monophonic channel slots. */
export class SongVoices {
  private readonly chip: ChipResources;
  private readonly slots = new Map<string, VoiceHandle>();
  private readonly panners = new Map<string, AudioNode>();
  /** Latest time any started voice is still sounding. */
  lastEnd = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dest: AudioNode,
    private readonly compiled: CompiledSong,
    private readonly seed: number,
  ) {
    this.chip = getChip(ctx);
  }

  /** Starts the voice for one due event. `now` is the audio-clock time of the scheduling call. */
  schedule(item: TimedEvent, now: number): VoiceHandle | null {
    const ev = item.event;
    const late = Math.max(0, now - item.time);
    if (late > MAX_LATE && ev.duration - late < 0.25) return null; // missed it (long notes still start, shortened)
    const when = Math.max(item.time, now);
    const inst = this.compiled.instruments[ev.instrument]!;
    const plan = planMusicVoice(ev, inst, {
      noiseOffset: hash01(this.seed, item.serial),
      gate: late > 0 ? Math.max(ev.duration - late, 0.02) : undefined,
    });
    // Monophonic channel: the new note cuts whatever is still sounding in the same slot.
    const previous = this.slots.get(ev.slot);
    if (previous && previous.endTime > when) previous.cut(when);
    const voice = startVoice(this.chip, this.outputFor(inst), plan, when);
    this.slots.set(ev.slot, voice);
    this.lastEnd = Math.max(this.lastEnd, voice.endTime);
    return voice;
  }

  /** Cuts every channel at `at` (with the usual short click-free fade). */
  cutAll(at: number, fade?: number): void {
    for (const voice of this.slots.values()) voice.cut(at, fade);
  }

  release(): void {
    this.slots.clear();
    try {
      for (const p of this.panners.values()) p.disconnect();
    } catch {
      /* already disconnected */
    }
    this.panners.clear();
  }

  /** The node a voice of this instrument connects to (the destination, via a panner for panned instruments). */
  private outputFor(inst: Instrument): AudioNode {
    if (inst.pan === 0 || typeof this.ctx.createStereoPanner !== 'function') return this.dest;
    let panner = this.panners.get(inst.name);
    if (!panner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = inst.pan;
      p.connect(this.dest);
      this.panners.set(inst.name, p);
      panner = p;
    }
    return panner;
  }
}

/**
 * Schedules the first `seconds` of a song (looping as needed) on any context, typically an
 * `OfflineAudioContext`: the same voices and timing as live playback, without the timer. Returns the
 * compiled song. The song's `volume` is applied.
 */
export function renderSong(ctx: BaseAudioContext, dest: AudioNode, song: SongDef | CompiledSong, seconds: number, startAt = 0): CompiledSong {
  const compiled = parseSong(song);
  const out = ctx.createGain();
  out.gain.value = compiled.volume;
  out.connect(dest);
  const voices = new SongVoices(ctx, out, compiled, 1);
  const cursor = new SongCursor(compiled, startAt);
  for (const item of cursor.drain(startAt + seconds)) voices.schedule(item, 0);
  return compiled;
}

// ------------------------------------------------------------------------------------------------
// Live playback
// ------------------------------------------------------------------------------------------------

interface Request {
  song: SongDef | CompiledSong;
  compiled: CompiledSong;
  options: PlayMusicOptions;
  /** Seconds to fade the previous song out (and the new one in, for a crossfade). */
  crossfade?: number;
}

let playbackCounter = 0;

class Playback {
  private readonly fade: GainNode;
  private readonly cursor: SongCursor;
  private readonly voices: SongVoices;
  private unsubscribe: (() => void) | null;
  private stopAt: number | null = null;
  private disposed = false;

  constructor(
    engine: AudioEngine,
    private readonly ctx: AudioContext,
    readonly compiled: CompiledSong,
    fadeIn: number,
    private readonly onEnd?: () => void,
  ) {
    const start = ctx.currentTime + START_DELAY;
    this.cursor = new SongCursor(compiled, start);
    this.fade = ctx.createGain();
    if (fadeIn > 0) {
      this.fade.gain.setValueAtTime(0, ctx.currentTime);
      this.fade.gain.linearRampToValueAtTime(compiled.volume, start + fadeIn);
    } else {
      this.fade.gain.value = compiled.volume;
    }
    this.fade.connect(engine.musicBus!);
    this.voices = new SongVoices(ctx, this.fade, compiled, ++playbackCounter * 7919);
    this.voices.lastEnd = start;
    this.unsubscribe = engine.onTick((now) => this.tick(now));
    this.tick(ctx.currentTime); // schedule the first window right away
  }

  /** Seconds into the current pass of the song (for UIs). */
  position(): number {
    const t = this.ctx.currentTime - this.cursor.origin;
    const { duration, loopStart, loopLength, loop } = this.compiled;
    if (t < duration || !loop) return Math.max(0, Math.min(t, duration));
    return loopStart + ((t - loopStart) % loopLength);
  }

  private tick(now: number): void {
    if (this.disposed) return;
    if (this.stopAt !== null) {
      if (now >= this.stopAt) this.dispose();
      return;
    }
    for (const item of this.cursor.drain(now + LOOKAHEAD_SECONDS, now - MAX_CATCH_UP)) this.voices.schedule(item, now);

    if (!this.compiled.loop && this.cursor.finished && now >= Math.max(this.cursor.endTime, this.voices.lastEnd)) {
      const onEnd = this.onEnd;
      this.dispose();
      onEnd?.();
    }
  }

  /** Fades out and releases everything. No new events are scheduled from now on. */
  fadeOutAndStop(seconds: number): void {
    if (this.disposed || this.stopAt !== null) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(seconds, 0.02);
    const g = this.fade.gain;
    const current = g.value; // read before cancelling (a cancelled in-flight ramp would snap back)
    g.cancelScheduledValues(now);
    g.setValueAtTime(current, now);
    g.linearRampToValueAtTime(0, now + dur);
    this.stopAt = now + dur + 0.05;
    this.voices.cutAll(now + dur);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.voices.cutAll(this.ctx.currentTime);
    this.voices.release();
    try {
      this.fade.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}

export class MusicPlayer {
  private request: Request | null = null;
  private playing: Playback | null = null;

  constructor(private readonly engine: AudioEngine) {}

  /**
   * Plays a song (replacing the current one). If the song is already the current one it keeps playing,
   * unless `restart` is set. Before `unlock()` the request is remembered and starts once audio runs.
   * Invalid songs are logged with a message naming the pattern / track / step, and ignored.
   */
  play(song: SongDef | CompiledSong, options: PlayMusicOptions = {}): void {
    this.submit(song, options, undefined);
  }

  /** Fades the current song out over `seconds` while the new one fades in. */
  crossfadeTo(song: SongDef | CompiledSong, seconds: number): void {
    const s = Math.max(0, seconds);
    this.submit(song, { fadeIn: s }, s);
  }

  /** Stops the music (also cancels a song that is waiting for `unlock()`). */
  stop(options: StopMusicOptions = {}): void {
    this.request = null;
    if (this.playing) {
      this.playing.fadeOutAndStop(options.fadeOut ?? DEFAULT_STOP_FADE);
      this.playing = null;
    }
  }

  /** The song most recently requested (playing, or waiting for `unlock()`), or null. */
  current(): SongDef | null {
    const song = this.request?.song;
    if (!song) return null;
    return (song as CompiledSong).def ?? (song as SongDef);
  }

  /** True while a song is audibly scheduled. */
  isPlaying(): boolean {
    return this.playing !== null;
  }

  /** Seconds into the current pass of the playing song, or null. */
  position(): number | null {
    return this.playing ? this.playing.position() : null;
  }

  /** Stops everything immediately and forgets the request (tests, hot reload). */
  dispose(): void {
    this.request = null;
    this.playing?.dispose();
    this.playing = null;
  }

  private submit(song: SongDef | CompiledSong, options: PlayMusicOptions, crossfade: number | undefined): void {
    let compiled: CompiledSong;
    try {
      compiled = parseSong(song);
    } catch (error) {
      console.error('[audio] cannot play song:', error instanceof Error ? error.message : error);
      return;
    }
    if (this.request?.compiled === compiled && !options.restart) return; // already current

    const request: Request = { song, compiled, options, crossfade };
    this.request = request;
    this.engine.whenRunning(() => {
      if (this.request === request) this.start(request);
    });
  }

  private start(request: Request): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.engine.musicBus) return;
    this.playing?.fadeOutAndStop(request.crossfade ?? REPLACE_FADE);
    this.playing = new Playback(this.engine, ctx, request.compiled, request.options.fadeIn ?? 0, () => {
      if (this.request === request) {
        this.request = null;
        this.playing = null;
      }
      request.options.onEnd?.();
    });
  }
}
