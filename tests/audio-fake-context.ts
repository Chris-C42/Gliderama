/**
 * A recording fake of the WebAudio subset used by src/audio, plus a fake browser environment for the
 * engine. Not a test file itself (no `.test.ts` suffix); imported by the audio-*.test.ts files.
 */

import type { EngineEnv } from '../src/audio/engine';

export interface ParamEvent {
  type: 'set' | 'linear' | 'exp' | 'target' | 'cancel';
  value?: number;
  time: number;
  timeConstant?: number;
}

export class FakeParam {
  events: ParamEvent[] = [];
  constructor(public value = 0) {}
  setValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'set', value, time });
    this.value = value;
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'exp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.events.push({ type: 'target', value, time, timeConstant });
    this.value = value;
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', time });
    return this;
  }
  /** The last scheduled value of a given type, for assertions. */
  last(type?: ParamEvent['type']): ParamEvent | undefined {
    const list = type ? this.events.filter((e) => e.type === type) : this.events;
    return list[list.length - 1];
  }
}

export class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  constructor(
    readonly ctx: FakeContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
  }
  connect(dest: unknown): unknown {
    this.connections.push(dest as FakeNode);
    return dest;
  }
  disconnect(): void {
    this.connections = [];
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super(ctx, 'gain');
  }
}

export class FakeSource extends FakeNode {
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
  playbackRate = new FakeParam(1);
  type = 'sine';
  periodicWave: unknown = null;
  buffer: FakeBuffer | null = null;
  loop = false;
  startCalls: Array<{ when: number; offset?: number }> = [];
  stopCalls: number[] = [];
  onended: (() => void) | null = null;
  constructor(ctx: FakeContext, kind: 'oscillator' | 'bufferSource') {
    super(ctx, kind);
  }
  setPeriodicWave(wave: unknown): void {
    this.periodicWave = wave;
    this.type = 'custom';
  }
  start(when = 0, offset?: number): void {
    this.startCalls.push({ when, offset });
  }
  stop(when = 0): void {
    this.stopCalls.push(when);
  }
  get startTime(): number | undefined {
    return this.startCalls[0]?.when;
  }
  get lastStop(): number | undefined {
    return this.stopCalls[this.stopCalls.length - 1];
  }
}

export class FakeBiquad extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  constructor(ctx: FakeContext) {
    super(ctx, 'biquad');
  }
}

export class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
  constructor(ctx: FakeContext) {
    super(ctx, 'compressor');
  }
}

export class FakePanner extends FakeNode {
  pan = new FakeParam(0);
  constructor(ctx: FakeContext) {
    super(ctx, 'panner');
  }
}

export class FakeBuffer {
  readonly duration: number;
  private readonly data: Float32Array;
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.duration = length / sampleRate;
    this.data = new Float32Array(length);
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeContext {
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  nodes: FakeNode[] = [];
  destination = new FakeNode(this, 'destination');
  onstatechange: (() => void) | null = null;
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  /** 'refuse' simulates iOS refusing resume() outside a gesture: the state stays suspended. */
  resumeBehaviour: 'run' | 'refuse' = 'run';
  /** Options the context was constructed with. */
  options: unknown;
  /** Old Safari: resume() / suspend() / close() return undefined instead of a promise. */
  legacyPromises = false;

  constructor(options?: unknown) {
    this.options = options;
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeBehaviour === 'run') this.setState('running');
    return (this.legacyPromises ? undefined : Promise.resolve()) as Promise<void>;
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.setState('suspended');
    return (this.legacyPromises ? undefined : Promise.resolve()) as Promise<void>;
  }
  close(): Promise<void> {
    this.closeCalls++;
    this.setState('closed');
    return (this.legacyPromises ? undefined : Promise.resolve()) as Promise<void>;
  }
  setState(state: FakeContext['state']): void {
    this.state = state;
    this.onstatechange?.();
  }

  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createOscillator(): FakeSource {
    return new FakeSource(this, 'oscillator');
  }
  createBufferSource(): FakeSource {
    return new FakeSource(this, 'bufferSource');
  }
  createBiquadFilter(): FakeBiquad {
    return new FakeBiquad(this);
  }
  createDynamicsCompressor(): FakeCompressor {
    return new FakeCompressor(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  createPeriodicWave(real: Float32Array, imag: Float32Array, constraints?: unknown): unknown {
    return { real, imag, constraints };
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  // ---- inspection helpers ----------------------------------------------------------------------
  oscillators(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n.kind === 'oscillator');
  }
  bufferSources(): FakeSource[] {
    return this.nodes.filter((n): n is FakeSource => n.kind === 'bufferSource');
  }
  gains(): FakeGain[] {
    return this.nodes.filter((n): n is FakeGain => n.kind === 'gain');
  }
  /** Oscillators that carry a note: everything except LFOs (an LFO's chain is oscillator -> gain -> AudioParam). */
  voices(): FakeSource[] {
    return this.oscillators().filter((o) => {
      const first = o.connections[0];
      return !(first instanceof FakeGain && first.connections[0] instanceof FakeParam);
    });
  }
}

/** Fake browser environment for `AudioEngine`, with controllable timers and events. */
export function makeFakeEnv(opts: { webAudio?: boolean; resume?: 'run' | 'refuse'; legacyPromises?: boolean } = {}) {
  const contexts: FakeContext[] = [];
  class Ctor extends FakeContext {
    constructor(options?: unknown) {
      super(options);
      this.resumeBehaviour = opts.resume ?? 'run';
      this.legacyPromises = opts.legacyPromises ?? false;
      contexts.push(this);
    }
  }
  const docListeners = new Map<string, Set<() => void>>();
  const winListeners = new Map<string, Set<() => void>>();
  const doc = {
    hidden: false,
    addEventListener(type: string, fn: () => void) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      docListeners.get(type)?.delete(fn);
    },
  };
  const win = {
    addEventListener(type: string, fn: () => void) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      winListeners.get(type)?.delete(fn);
    },
  };
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;
  const deferred: Array<{ fn: () => void; ms: number }> = [];

  const env: EngineEnv = {
    audioContextCtor: () => (opts.webAudio === false ? null : (Ctor as unknown as ReturnType<EngineEnv['audioContextCtor']>)),
    document: () => doc as unknown as ReturnType<EngineEnv['document']>,
    window: () => win as unknown as ReturnType<EngineEnv['window']>,
    setInterval: (fn, ms) => {
      const id = nextId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (handle) => {
      intervals.delete(handle as number);
    },
    defer: (fn, ms) => {
      deferred.push({ fn, ms });
    },
  };

  return {
    env,
    doc,
    contexts,
    intervals,
    deferred,
    get ctx(): FakeContext {
      return contexts[contexts.length - 1]!;
    },
    docListenerCount: (type: string) => docListeners.get(type)?.size ?? 0,
    winListenerCount: (type: string) => winListeners.get(type)?.size ?? 0,
    fireDocument(type: string) {
      for (const fn of [...(docListeners.get(type) ?? [])]) fn();
    },
    fireWindow(type: string) {
      for (const fn of [...(winListeners.get(type) ?? [])]) fn();
    },
    /** Runs every deferred task (and those they defer in turn). */
    runDeferred() {
      let guard = 0;
      while (deferred.length && guard++ < 1000) deferred.shift()!.fn();
    },
  };
}

/** Lets pending promise callbacks (resume().then ...) run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
