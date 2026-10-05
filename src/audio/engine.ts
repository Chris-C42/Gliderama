/**
 * Audio engine: owns the AudioContext, the mixer graph and the lookahead timer.
 *
 *   music bus ─┐
 *              ├─► master gain ─► limiter (DynamicsCompressor) ─► destination
 *   sfx bus   ─┘
 *
 * - The context is created lazily by `unlock()`, which must be called from a user gesture. It calls
 *   `resume()` inside the gesture and plays a 1-sample silent buffer (the iOS Safari unlock dance).
 * - The context is suspended while the page is hidden and resumed when it is visible again, but only
 *   if it was running before. After an interruption (iOS phone call ...) the next gesture resumes it.
 * - A single ~25 ms timer calls the registered tickers, which schedule ~120 ms ahead on AudioContext
 *   time. Scheduling never happens from requestAnimationFrame.
 * - Everything is safe to call before `unlock()` and outside a browser: it just does nothing.
 */

import { getChip } from './chip';
import { clamp } from './plan';

/** How often the scheduler timer fires. */
export const SCHEDULE_INTERVAL_MS = 25;
/** How far ahead of the audio clock events are scheduled. */
export const LOOKAHEAD_SECONDS = 0.12;

/** Default slider values (mirror `DEFAULT_SETTINGS` in core/types.ts). */
export const DEFAULT_MUSIC_VOLUME = 0.6;
export const DEFAULT_SFX_VOLUME = 0.8;

/**
 * Fixed gains of the two buses, on top of the 0..1 sliders. Calibrated so that, with the default sliders,
 * the demo song sits around -20 dBFS RMS (the limiter only engages when the slider is pushed towards 1)
 * and sound effects (normalised to peak about -8 dBFS) stand out above it.
 */
export const MUSIC_BUS_GAIN = 1;
export const SFX_BUS_GAIN = 1.5;

/**
 * The browsers' DynamicsCompressor adds automatic makeup gain (about +2.1 dB with the limiter settings
 * below), so the master gain compensates: the chain is transparent (unity) up to about half scale and
 * soft-limits above it, never exceeding roughly full scale.
 */
export const LIMITER_MAKEUP_COMPENSATION = 0.78;

/** Maps a 0..1 slider value to a gain with a perceptual (squared) curve: 0.5 is about -12 dB. */
export function volumeToGain(volume: number): number {
  const v = clamp(Number.isFinite(volume) ? volume : 0, 0, 1);
  return v * v;
}

export type TickFn = (now: number) => void;

/** Everything the engine needs from the host environment (replaceable in tests). */
export interface EngineEnv {
  audioContextCtor(): (new (options?: AudioContextOptions) => AudioContext) | null;
  document(): Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'> | null;
  window(): Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Runs `fn` in a later task (used to spread start-up work over several frames). */
  defer(fn: () => void, ms: number): void;
}

export const browserEnv: EngineEnv = {
  audioContextCtor() {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { AudioContext?: new (o?: AudioContextOptions) => AudioContext; webkitAudioContext?: new (o?: AudioContextOptions) => AudioContext };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  },
  document: () => (typeof document === 'undefined' ? null : document),
  window: () => (typeof window === 'undefined' ? null : window),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  defer: (fn, ms) => void setTimeout(fn, ms),
};

/** How long sounds are still accepted while an `unlock()` has not settled. */
const STARTING_TIMEOUT_MS = 400;

/** Events that count as a user activation for audio on the major browsers. */
const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  limiter: DynamicsCompressorNode | null = null;
  musicBus: GainNode | null = null;
  sfxBus: GainNode | null = null;

  private musicVolume = DEFAULT_MUSIC_VOLUME;
  private sfxVolume = DEFAULT_SFX_VOLUME;
  /** True once the context has been running at least once (i.e. the gesture worked). */
  private unlocked = false;
  /** True while an `unlock()` is waiting for `resume()` to settle (for at most `STARTING_TIMEOUT_MS`). */
  private starting = false;
  private warmedUp = false;
  /** The context was running when the page got hidden (so we resume it when visible again). */
  private wasRunning = false;
  private readonly tickers = new Set<TickFn>();
  private timer: unknown = null;
  private readyQueue: Array<(ctx: AudioContext) => void> = [];
  private listening = false;
  private autoUnlockHandler: (() => void) | null = null;

  constructor(private readonly env: EngineEnv = browserEnv) {}

  // ---- lifecycle -----------------------------------------------------------------------------

  /**
   * Creates the AudioContext (first call only) and resumes it. Call this synchronously from a user
   * gesture handler (pointerup / touchend / click / keydown). Safe to call repeatedly and safe to
   * call outside a browser. Resolves to true when audio is running.
   */
  unlock(): Promise<boolean> {
    const Ctor = this.env.audioContextCtor();
    if (!Ctor) return Promise.resolve(false);
    if (!this.ctx) {
      try {
        this.createGraph(new Ctor({ latencyHint: 'interactive' }));
      } catch (error) {
        console.warn('[audio] could not create an AudioContext:', error);
        return Promise.resolve(false);
      }
    }
    const ctx = this.ctx!;
    // iOS: resume() must be called inside the gesture, and a (silent) buffer has to be started in it too.
    let resumed: Promise<void>;
    try {
      // Old Safari returns undefined instead of a promise: Promise.resolve() copes with both.
      resumed = ctx.state === 'running' ? Promise.resolve() : Promise.resolve(ctx.resume());
    } catch {
      resumed = Promise.resolve();
    }
    this.playSilentBuffer(ctx);
    this.warmUp(ctx); // after resume(): nothing here can delay the call that has to happen inside the gesture
    this.starting = true;
    // A resume() outside a qualifying gesture may stay pending (iOS): do not accept sounds forever.
    this.env.defer(() => {
      this.starting = false;
    }, STARTING_TIMEOUT_MS);
    return resumed.then(
      () => {
        this.starting = false;
        return this.checkRunning();
      },
      () => {
        this.starting = false;
        return false;
      },
    );
  }

  /**
   * True when it makes sense to schedule sounds now: the context is running, or an `unlock()` is in
   * flight (nodes scheduled on a context that is about to resume start as soon as it does, so the very
   * first tap that unlocks audio can already play its own sound).
   */
  get canSchedule(): boolean {
    const ctx = this.ctx;
    return !!ctx && (ctx.state === 'running' || (this.starting && ctx.state !== 'closed'));
  }

  /** True once the audio context has been started successfully by a user gesture. */
  isUnlocked(): boolean {
    return this.unlocked;
  }

  /** The context state, or 'none' before `unlock()`. */
  get state(): AudioContextState | 'none' {
    return this.ctx ? this.ctx.state : 'none';
  }

  /** Audio clock time in seconds (0 before unlock). */
  now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Installs one-time listeners on `window` that call `unlock()` on the first user gesture, and removes
   * them once audio is running. Optional convenience: calling `unlock()` yourself works just as well.
   */
  autoUnlock(): void {
    const win = this.env.window();
    if (!win || this.autoUnlockHandler || this.unlocked) return;
    const handler = () => {
      void this.unlock().then((ok) => {
        if (ok) this.removeAutoUnlock();
      });
    };
    this.autoUnlockHandler = handler;
    for (const type of GESTURE_EVENTS) win.addEventListener(type, handler, { capture: true, passive: true });
  }

  /** Runs `fn` as soon as audio is running (immediately if it already is). Dropped if never unlocked. */
  whenRunning(fn: (ctx: AudioContext) => void): void {
    if (this.ctx && this.ctx.state === 'running') fn(this.ctx);
    else this.readyQueue.push(fn);
  }

  // ---- volumes -------------------------------------------------------------------------------

  setMusicVolume(volume: number): void {
    this.musicVolume = clamp(Number.isFinite(volume) ? volume : 0, 0, 1);
    this.applyVolume(this.musicBus, volumeToGain(this.musicVolume) * MUSIC_BUS_GAIN);
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = clamp(Number.isFinite(volume) ? volume : 0, 0, 1);
    this.applyVolume(this.sfxBus, volumeToGain(this.sfxVolume) * SFX_BUS_GAIN);
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  getSfxVolume(): number {
    return this.sfxVolume;
  }

  // ---- scheduler timer -----------------------------------------------------------------------

  /**
   * Registers a function that is called about every 25 ms with the current audio time while audio is
   * running. Returns an unsubscribe function. The timer only exists while there are tickers.
   */
  onTick(fn: TickFn): () => void {
    this.tickers.add(fn);
    if (this.timer === null) this.timer = this.env.setInterval(() => this.tick(), SCHEDULE_INTERVAL_MS);
    return () => {
      this.tickers.delete(fn);
      if (this.tickers.size === 0 && this.timer !== null) {
        this.env.clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** Runs one scheduler step (exposed for tests). */
  tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (const fn of [...this.tickers]) {
      try {
        fn(now);
      } catch (error) {
        console.error('[audio] scheduler error:', error);
      }
    }
  }

  /** Tears everything down (tests, hot reload). */
  dispose(): void {
    if (this.timer !== null) this.env.clearInterval(this.timer);
    this.timer = null;
    this.tickers.clear();
    this.removeAutoUnlock();
    this.stopListening();
    const ctx = this.ctx;
    this.ctx = this.master = this.limiter = this.musicBus = this.sfxBus = null;
    this.unlocked = false;
    this.starting = false;
    this.warmedUp = false;
    this.readyQueue = [];
    if (ctx && ctx.state !== 'closed') void Promise.resolve(ctx.close()).catch(() => undefined);
  }

  // ---- internals -----------------------------------------------------------------------------

  private createGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = LIMITER_MAKEUP_COMPENSATION;
    const limiter = ctx.createDynamicsCompressor();
    // A gentle brick-wall-ish limiter: transparent below about -6 dBFS, catches peaks above.
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    const musicBus = ctx.createGain();
    const sfxBus = ctx.createGain();
    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    this.limiter = limiter;
    this.musicBus = musicBus;
    this.sfxBus = sfxBus;
    musicBus.gain.value = volumeToGain(this.musicVolume) * MUSIC_BUS_GAIN;
    sfxBus.gain.value = volumeToGain(this.sfxVolume) * SFX_BUS_GAIN;

    ctx.onstatechange = () => {
      if (ctx.state === 'running') this.checkRunning();
    };
    this.startListening();
  }

  /** Builds the chip waves and noise buffers now (the big ambient ones one per task), once per context. */
  private warmUp(ctx: AudioContext): void {
    if (this.warmedUp) return;
    this.warmedUp = true;
    try {
      const chip = getChip(ctx);
      chip.warmUp();
      chip.warmUpLoopBuffers((task) => this.env.defer(task, 40));
    } catch (error) {
      console.warn('[audio] warm-up failed:', error);
    }
  }

  private playSilentBuffer(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.onended = () => src.disconnect();
      src.start(0);
    } catch {
      /* best effort */
    }
  }

  /** Called whenever the context may have started running. */
  private checkRunning(): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return false;
    this.unlocked = true;
    const queue = this.readyQueue;
    this.readyQueue = [];
    for (const fn of queue) {
      try {
        fn(ctx);
      } catch (error) {
        console.error('[audio] error in whenRunning callback:', error);
      }
    }
    return true;
  }

  private applyVolume(node: GainNode | null, gain: number): void {
    if (!node || !this.ctx) return;
    // Short smoothing ramp: no zipper noise when a slider is dragged.
    node.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.015);
  }

  private startListening(): void {
    if (this.listening) return;
    this.listening = true;
    this.env.document()?.addEventListener('visibilitychange', this.onVisibility);
    const win = this.env.window();
    if (win) {
      win.addEventListener('pageshow', this.onGesture as EventListener);
      for (const type of GESTURE_EVENTS) win.addEventListener(type, this.onGesture, { capture: true, passive: true });
    }
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    this.env.document()?.removeEventListener('visibilitychange', this.onVisibility);
    const win = this.env.window();
    if (win) {
      win.removeEventListener('pageshow', this.onGesture as EventListener);
      for (const type of GESTURE_EVENTS) win.removeEventListener(type, this.onGesture, { capture: true });
    }
  }

  private removeAutoUnlock(): void {
    const win = this.env.window();
    if (win && this.autoUnlockHandler) {
      for (const type of GESTURE_EVENTS) win.removeEventListener(type, this.autoUnlockHandler, { capture: true });
    }
    this.autoUnlockHandler = null;
  }

  /** Suspend while hidden, resume when visible (only if it was running). */
  private readonly onVisibility = (): void => {
    const ctx = this.ctx;
    const doc = this.env.document();
    if (!ctx || !doc) return;
    if (doc.hidden) {
      if (ctx.state === 'running') {
        this.wasRunning = true;
        void Promise.resolve(ctx.suspend()).catch(() => undefined);
      }
    } else if (this.wasRunning) {
      this.wasRunning = false;
      void Promise.resolve(ctx.resume()).catch(() => undefined); // if iOS refuses outside a gesture, onGesture retries
    }
  };

  /** After an interruption (phone call, iOS audio session ...) or a refused unlock, the next user gesture resumes audio. */
  private readonly onGesture = (): void => {
    const ctx = this.ctx;
    const doc = this.env.document();
    if (!ctx || (doc && doc.hidden)) return;
    // Any later gesture is a fresh chance: it also rescues an unlock() that was refused the first time.
    if (ctx.state !== 'running') void Promise.resolve(ctx.resume()).catch(() => undefined);
  };
}
