/**
 * Fixed-timestep game loop.
 *
 * `update(dt)` always receives the same `dt` (1 / hz seconds) and runs 0..maxStepsPerFrame times per
 * rendered frame; `render(alpha, frameDt)` runs once per frame with the interpolation factor
 * `alpha` in [0, 1] (how far the render is between the previous and the latest simulated state).
 *
 * Robustness:
 * - A frame gap bigger than `maxFrameDt` (default `maxStepsPerFrame / hz`, 66.7 ms at 120 Hz) is
 *   clamped, and at most `maxStepsPerFrame` steps run per frame; any backlog beyond that is
 *   dropped, not carried. A slow device therefore runs the game in slow motion instead of falling
 *   into a spiral of death.
 * - While `document.hidden` the loop is paused (no frames, no catch-up). On becoming visible the
 *   accumulator is reset and the first frame reports `frameDt = 0`.
 *
 * The accumulator maths lives in the pure function `stepAccumulator` so it can be unit tested
 * without a DOM.
 */

/** Tolerance (seconds) so that e.g. 2 x 8.3333 ms frames reliably produce 2 steps at 120 Hz. */
const EPS = 1e-9;

export interface StepperConfig {
  /** Fixed step length in seconds. */
  dt: number;
  /** Most steps allowed in one frame. */
  maxSteps: number;
  /** Largest real frame time (seconds) accepted; bigger gaps are clamped to this. */
  maxFrameDt: number;
}

export interface StepperResult {
  /** New accumulator value (seconds of un-simulated time carried to the next frame). */
  acc: number;
  /** Number of fixed steps to run this frame. */
  steps: number;
  /** Interpolation factor in [0, 1]: acc / dt. */
  alpha: number;
  /** The (clamped) frame time in seconds. */
  frameDt: number;
  /** Seconds of backlog discarded because maxSteps was reached. */
  dropped: number;
}

/**
 * Pure fixed-step accumulator. Feed it the previous accumulator and the real elapsed time; it says
 * how many steps to run and what to carry over. Negative / NaN frame times count as 0.
 */
export function stepAccumulator(acc: number, rawFrameDt: number, cfg: StepperConfig): StepperResult {
  const { dt, maxSteps, maxFrameDt } = cfg;
  let frameDt = rawFrameDt > 0 ? rawFrameDt : 0;
  if (frameDt > maxFrameDt) frameDt = maxFrameDt;

  let a = acc + frameDt;
  const due = Math.max(0, Math.floor((a + EPS) / dt));
  const steps = due < maxSteps ? due : maxSteps;
  a -= steps * dt;

  let dropped = 0;
  if (due > steps) {
    // Behind by more than we are willing to simulate: keep only the sub-step remainder.
    const keep = a % dt;
    dropped = a - keep;
    a = keep;
  }

  const alpha = a <= 0 ? 0 : a >= dt ? 1 : a / dt;
  return { acc: a, steps, alpha, frameDt, dropped };
}

// ---------------------------------------------------------------------------------------------

export interface LoopCallbacks {
  /** Advance the simulation by exactly `dt` seconds (the fixed step). */
  update(dt: number): void;
  /** Draw. `alpha` in [0, 1]; `frameDt` is the real (clamped) seconds since the previous frame. */
  render(alpha: number, frameDt: number): void;
}

/** Browser hooks; injectable for tests. */
export interface LoopEnv {
  requestFrame(cb: (now: number) => void): number;
  cancelFrame(id: number): void;
  isHidden(): boolean;
  /** Subscribe to visibility changes; returns an unsubscribe function. */
  onVisibilityChange(cb: () => void): () => void;
}

export interface LoopOptions {
  /** Simulation rate in Hz. Default 120. */
  hz?: number;
  /** Cap on update steps per rendered frame. Default 8. */
  maxStepsPerFrame?: number;
  /** Largest accepted real frame gap in seconds. Default `maxStepsPerFrame / hz`. */
  maxFrameDt?: number;
  /** Override the browser hooks (tests). */
  env?: LoopEnv;
}

export interface LoopStats {
  /** Smoothed frames per second (about the last 10 frames). */
  fps: number;
  /** Real duration of the most recent frame in milliseconds (unclamped, so hitches show up). */
  frameMs: number;
  /** How many fixed steps ran in the most recent frame. */
  stepsLastFrame: number;
}

export interface Loop {
  /** Start (or restart) frames. No-op if already started. */
  start(): void;
  /** Stop for good until `start()` is called again. */
  stop(): void;
  /** True between `start()` and `stop()`, including while paused because the tab is hidden. */
  isRunning(): boolean;
  /** Live stats object, updated in place every frame. */
  readonly stats: Readonly<LoopStats>;
  /** The fixed step in seconds (1 / hz). */
  readonly dt: number;
}

function browserEnv(): LoopEnv {
  return {
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    isHidden: () => typeof document !== 'undefined' && document.hidden,
    onVisibilityChange: (cb) => {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
  };
}

export function createLoop(callbacks: LoopCallbacks, options: LoopOptions = {}): Loop {
  const hz = options.hz ?? 120;
  const maxSteps = Math.floor(options.maxStepsPerFrame ?? 8);
  if (!(hz > 0) || !Number.isFinite(hz)) throw new RangeError('createLoop: hz must be a positive number');
  if (!(maxSteps >= 1)) throw new RangeError('createLoop: maxStepsPerFrame must be >= 1');

  const dt = 1 / hz;
  const cfg: StepperConfig = { dt, maxSteps, maxFrameDt: options.maxFrameDt ?? maxSteps * dt };
  const env = options.env ?? browserEnv();
  const stats: LoopStats = { fps: 0, frameMs: 0, stepsLastFrame: 0 };

  let running = false;
  let suspended = false; // paused because the tab is hidden
  let frameId = 0;
  let last: number | null = null; // timestamp of the previous frame; null = no reference yet
  let acc = 0;
  let smoothMs = 0;
  let unsubscribe: (() => void) | null = null;

  function resetTiming(): void {
    last = null;
    acc = 0;
  }

  function frame(now: number): void {
    frameId = 0;
    if (!running || suspended) return;
    frameId = env.requestFrame(frame); // schedule first so an exception below can't kill the loop

    const rawDt = last === null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;

    const res = stepAccumulator(acc, rawDt, cfg);
    acc = res.acc;

    if (rawDt > 0) {
      const ms = rawDt * 1000;
      stats.frameMs = ms;
      smoothMs = smoothMs === 0 ? ms : smoothMs + (ms - smoothMs) * 0.1;
      stats.fps = 1000 / smoothMs;
    }
    stats.stepsLastFrame = res.steps;

    for (let i = 0; i < res.steps && running; i++) callbacks.update(dt);
    if (running) callbacks.render(res.alpha, res.frameDt);
  }

  function onVisibility(): void {
    if (!running) return;
    if (env.isHidden()) {
      suspended = true;
      if (frameId) env.cancelFrame(frameId);
      frameId = 0;
      resetTiming();
    } else if (suspended) {
      suspended = false;
      resetTiming(); // no catch-up for the time we were away
      frameId = env.requestFrame(frame);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      resetTiming();
      smoothMs = 0;
      unsubscribe = env.onVisibilityChange(onVisibility);
      suspended = env.isHidden();
      if (!suspended) frameId = env.requestFrame(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      suspended = false;
      if (frameId) env.cancelFrame(frameId);
      frameId = 0;
      unsubscribe?.();
      unsubscribe = null;
    },
    isRunning: () => running,
    stats,
    dt,
  };
}
