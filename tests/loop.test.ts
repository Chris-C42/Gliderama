import { describe, expect, it } from 'vitest';
import { createLoop, stepAccumulator, type LoopEnv, type StepperConfig } from '../src/core/loop';
import { createRng } from '../src/core/rng';

const HZ = 120;
const DT = 1 / HZ;
const cfg: StepperConfig = { dt: DT, maxSteps: 8, maxFrameDt: 8 * DT };

describe('stepAccumulator (pure)', () => {
  it('60 fps frames at 120 Hz run exactly 2 steps per frame, with no drift over ten minutes', () => {
    let acc = 0;
    let total = 0;
    for (let i = 0; i < 36000; i++) {
      const r = stepAccumulator(acc, 1 / 60, cfg);
      expect(r.steps).toBe(2);
      acc = r.acc;
      total += r.steps;
    }
    expect(total).toBe(72000);
    expect(acc).toBeLessThan(DT);
  });

  it('144 fps frames at 120 Hz run 0 or 1 step and add up to 120 steps per second', () => {
    let acc = 0;
    let total = 0;
    for (let i = 0; i < 144; i++) {
      const r = stepAccumulator(acc, 1 / 144, cfg);
      expect(r.steps).toBeLessThanOrEqual(1);
      acc = r.acc;
      total += r.steps;
    }
    expect(total).toBeGreaterThanOrEqual(119);
    expect(total).toBeLessThanOrEqual(120);
  });

  it('carries a fractional remainder and reports it as alpha', () => {
    const a = stepAccumulator(0, DT * 0.5, cfg);
    expect(a.steps).toBe(0);
    expect(a.alpha).toBeCloseTo(0.5, 9);
    const b = stepAccumulator(a.acc, DT * 0.5, cfg);
    expect(b.steps).toBe(1);
    expect(b.alpha).toBeCloseTo(0, 6);
    const c = stepAccumulator(b.acc, DT * 0.25, cfg);
    expect(c.steps).toBe(0);
    expect(c.alpha).toBeCloseTo(0.25, 6);
  });

  it('clamps a huge gap (tab switch / debugger pause) to maxFrameDt', () => {
    const r = stepAccumulator(0, 30, cfg);
    expect(r.frameDt).toBeCloseTo(8 * DT, 12);
    expect(r.steps).toBe(8);
    expect(r.acc).toBeLessThan(DT);
    expect(r.dropped).toBe(0);
  });

  it('caps steps per frame and drops the backlog instead of spiralling', () => {
    // maxFrameDt larger than maxSteps * dt: the step cap is what protects us.
    const wide: StepperConfig = { dt: DT, maxSteps: 8, maxFrameDt: 1 };
    const r = stepAccumulator(0, 1, wide); // a full second of backlog
    expect(r.steps).toBe(8);
    expect(r.dropped).toBeGreaterThan(100 * DT);
    expect(r.acc).toBeGreaterThanOrEqual(0);
    expect(r.acc).toBeLessThan(DT);
    // The next normal frame is back to normal: nothing left over to catch up.
    const next = stepAccumulator(r.acc, 1 / 60, wide);
    expect(next.steps).toBeLessThanOrEqual(2);
  });

  it('ignores negative and NaN frame times', () => {
    for (const bad of [-1, NaN, -Infinity]) {
      const r = stepAccumulator(0.001, bad, cfg);
      expect(r.steps).toBe(0);
      expect(r.frameDt).toBe(0);
      expect(r.acc).toBeCloseTo(0.001, 12);
    }
  });

  it('invariants over a long run of jittery frames', () => {
    const rng = createRng(2024);
    let acc = 0;
    let simulated = 0;
    let real = 0;
    let dropped = 0;
    for (let i = 0; i < 5000; i++) {
      const raw = rng.chance(0.02) ? rng.float(0.1, 2) : rng.float(0.004, 0.03); // occasional hitch
      const r = stepAccumulator(acc, raw, cfg);
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThanOrEqual(1);
      expect(r.steps).toBeGreaterThanOrEqual(0);
      expect(r.steps).toBeLessThanOrEqual(cfg.maxSteps);
      expect(r.acc).toBeGreaterThan(-1e-8);
      expect(r.acc).toBeLessThan(DT);
      acc = r.acc;
      simulated += r.steps * DT;
      real += r.frameDt;
      dropped += r.dropped;
    }
    // Everything that was fed in is either simulated, carried in the accumulator, or dropped.
    expect(simulated + acc + dropped).toBeCloseTo(real, 6);
    expect(simulated).toBeLessThanOrEqual(real + 1e-6); // never runs ahead of real time
  });
});

// ---------------------------------------------------------------------------------------------

interface FakeEnv {
  env: LoopEnv;
  /** Run the single pending frame callback at time `nowMs`. Returns false if nothing was pending. */
  frame(nowMs: number): boolean;
  pendingCount(): number;
  listenerCount(): number;
  setHidden(hidden: boolean): void;
}

function fakeEnv(startHidden = false): FakeEnv {
  let nextId = 1;
  const pending = new Map<number, (now: number) => void>();
  const listeners = new Set<() => void>();
  let hidden = startHidden;
  return {
    env: {
      requestFrame(cb) {
        const id = nextId++;
        pending.set(id, cb);
        return id;
      },
      cancelFrame(id) {
        pending.delete(id);
      },
      isHidden: () => hidden,
      onVisibilityChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    frame(nowMs) {
      const first = pending.entries().next();
      if (first.done) return false;
      const [id, cb] = first.value;
      pending.delete(id);
      cb(nowMs);
      return true;
    },
    pendingCount: () => pending.size,
    listenerCount: () => listeners.size,
    setHidden(h) {
      hidden = h;
      for (const l of [...listeners]) l();
    },
  };
}

interface Recorded {
  updates: number[];
  renders: { alpha: number; frameDt: number }[];
}

function makeLoop(fe: FakeEnv, opts: { hz?: number; maxStepsPerFrame?: number; maxFrameDt?: number } = {}) {
  const rec: Recorded = { updates: [], renders: [] };
  const loop = createLoop(
    {
      update: (dt) => rec.updates.push(dt),
      render: (alpha, frameDt) => rec.renders.push({ alpha, frameDt }),
    },
    { ...opts, env: fe.env },
  );
  return { loop, rec };
}

describe('createLoop', () => {
  it('update always gets the fixed dt; render gets alpha and the frame time', () => {
    const fe = fakeEnv();
    const { loop, rec } = makeLoop(fe);
    expect(loop.dt).toBe(DT);
    loop.start();

    // First frame has no previous timestamp: renders, but runs no steps.
    fe.frame(1000);
    expect(rec.updates).toHaveLength(0);
    expect(rec.renders).toEqual([{ alpha: 0, frameDt: 0 }]);

    fe.frame(1000 + 1000 / 60);
    expect(rec.updates).toHaveLength(2);
    expect(rec.updates.every((dt) => dt === DT)).toBe(true);
    expect(rec.renders).toHaveLength(2);
    expect(rec.renders[1].frameDt).toBeCloseTo(1 / 60, 9);
    expect(rec.renders[1].alpha).toBeGreaterThanOrEqual(0);
    expect(rec.renders[1].alpha).toBeLessThanOrEqual(1);
  });

  it('keeps scheduling frames while running, and stops cleanly', () => {
    const fe = fakeEnv();
    const { loop, rec } = makeLoop(fe);
    expect(loop.isRunning()).toBe(false);
    expect(fe.pendingCount()).toBe(0);

    loop.start();
    expect(loop.isRunning()).toBe(true);
    expect(fe.pendingCount()).toBe(1);
    loop.start(); // second start is a no-op
    expect(fe.pendingCount()).toBe(1);
    expect(fe.listenerCount()).toBe(1);

    fe.frame(0);
    fe.frame(16);
    expect(fe.pendingCount()).toBe(1);

    loop.stop();
    expect(loop.isRunning()).toBe(false);
    expect(fe.pendingCount()).toBe(0);
    expect(fe.listenerCount()).toBe(0);
    const rendered = rec.renders.length;
    expect(fe.frame(32)).toBe(false);
    expect(rec.renders).toHaveLength(rendered);
    loop.stop(); // idempotent
  });

  it('restarting resets timing: no catch-up for the time spent stopped', () => {
    const fe = fakeEnv();
    const { loop, rec } = makeLoop(fe);
    loop.start();
    fe.frame(0);
    fe.frame(8);
    loop.stop();
    const before = rec.updates.length;
    loop.start();
    fe.frame(60_000); // a minute later
    expect(rec.updates).toHaveLength(before);
    fe.frame(60_000 + 1000 / 60);
    expect(rec.updates).toHaveLength(before + 2);
  });

  it('survives a huge gap: bounded steps, clamped frame time', () => {
    const fe = fakeEnv();
    const { loop, rec } = makeLoop(fe);
    loop.start();
    fe.frame(0);
    fe.frame(10_000); // ten seconds
    expect(rec.updates).toHaveLength(8);
    expect(rec.renders[1].frameDt).toBeCloseTo(8 * DT, 9);
    fe.frame(10_000 + 1000 / 60); // and it is back to normal right away
    expect(rec.updates.length - 8).toBeLessThanOrEqual(3);
    expect(loop.stats.stepsLastFrame).toBeLessThanOrEqual(3);
  });

  it('honours hz and maxStepsPerFrame', () => {
    const fe = fakeEnv();
    const { loop, rec } = makeLoop(fe, { hz: 60, maxStepsPerFrame: 3, maxFrameDt: 10 });
    loop.start();
    fe.frame(0);
    fe.frame(1000); // 1 s of backlog, but at most 3 steps
    expect(rec.updates).toHaveLength(3);
    expect(rec.updates.every((dt) => dt === 1 / 60)).toBe(true);
  });

  it('pauses while the document is hidden and does not catch up on return', () => {
    const fe = fakeEnv();
    const { loop, rec } = makeLoop(fe);
    loop.start();
    fe.frame(0);
    fe.frame(1000 / 120 / 2); // half a step banked in the accumulator
    expect(rec.updates).toHaveLength(0);

    fe.setHidden(true);
    expect(loop.isRunning()).toBe(true); // still "running", just suspended
    expect(fe.pendingCount()).toBe(0); // the frame request was cancelled
    expect(fe.frame(5_000)).toBe(false);
    expect(rec.updates).toHaveLength(0);

    fe.setHidden(false);
    expect(fe.pendingCount()).toBe(1);
    fe.frame(600_000); // ten minutes later
    expect(rec.updates).toHaveLength(0);
    expect(rec.renders[rec.renders.length - 1]).toEqual({ alpha: 0, frameDt: 0 });

    // The half step banked before hiding is gone: two half-step frames make ONE step, not two.
    fe.frame(600_000 + 1000 / 120 / 2);
    fe.frame(600_000 + 1000 / 120);
    expect(rec.updates).toHaveLength(1);
  });

  it('starting while hidden waits for visibility', () => {
    const fe = fakeEnv(true);
    const { loop, rec } = makeLoop(fe);
    loop.start();
    expect(loop.isRunning()).toBe(true);
    expect(fe.pendingCount()).toBe(0);
    fe.setHidden(false);
    expect(fe.pendingCount()).toBe(1);
    fe.frame(100);
    expect(rec.renders).toHaveLength(1);
  });

  it('stop while suspended does not resurrect the loop', () => {
    const fe = fakeEnv();
    const { loop } = makeLoop(fe);
    loop.start();
    fe.setHidden(true);
    loop.stop();
    fe.setHidden(false);
    expect(fe.pendingCount()).toBe(0);
    expect(loop.isRunning()).toBe(false);
  });

  it('stop() from inside update ends the frame without rendering', () => {
    const fe = fakeEnv();
    let loopRef: ReturnType<typeof createLoop> | null = null;
    let updates = 0;
    let renders = 0;
    const loop = createLoop(
      {
        update: () => {
          updates++;
          loopRef?.stop();
        },
        render: () => {
          renders++;
        },
      },
      { env: fe.env },
    );
    loopRef = loop;
    loop.start();
    fe.frame(0);
    expect(renders).toBe(1);
    fe.frame(100); // wants several steps; the first one stops the loop
    expect(updates).toBe(1);
    expect(renders).toBe(1);
    expect(fe.pendingCount()).toBe(0);
  });

  it('reports stats', () => {
    const fe = fakeEnv();
    const { loop } = makeLoop(fe);
    expect(loop.stats).toEqual({ fps: 0, frameMs: 0, stepsLastFrame: 0 });
    loop.start();
    let t = 0; // timestamp of the most recent frame
    for (let i = 0; i < 60; i++) {
      fe.frame(t);
      if (i < 59) t += 1000 / 60;
    }
    expect(loop.stats.fps).toBeCloseTo(60, 3);
    expect(loop.stats.frameMs).toBeCloseTo(1000 / 60, 6);
    expect(loop.stats.stepsLastFrame).toBe(2);

    fe.frame(t + 250); // a hitch shows up in frameMs (unclamped) ...
    expect(loop.stats.frameMs).toBeCloseTo(250, 6);
    expect(loop.stats.stepsLastFrame).toBe(8); // ... but the steps are bounded
    expect(loop.stats.fps).toBeLessThan(60); // ... and drags the smoothed fps down a little
    expect(loop.stats.fps).toBeGreaterThan(20);
  });

  it('rejects nonsense configuration', () => {
    const cb = { update() {}, render() {} };
    expect(() => createLoop(cb, { hz: 0 })).toThrow(RangeError);
    expect(() => createLoop(cb, { hz: -5 })).toThrow(RangeError);
    expect(() => createLoop(cb, { hz: NaN })).toThrow(RangeError);
    expect(() => createLoop(cb, { maxStepsPerFrame: 0 })).toThrow(RangeError);
  });

  it('creating a loop never touches the DOM (node-safe)', () => {
    expect(() => createLoop({ update() {}, render() {} })).not.toThrow();
  });
});
