import { describe, expect, it } from 'vitest';
import { compileSong, type NoteEvent, type SongDef } from '../src/audio/notation';
import {
  MAX_ARP_STEPS,
  MIN_ATTACK,
  MIN_RELEASE,
  addCurves,
  curveAt,
  envelopeLevelAt,
  hash01,
  mulberry32,
  planEnvelope,
  planMusicVoice,
  planPitch,
  planRetriggeredEnvelope,
  semisToRatio,
} from '../src/audio/plan';

function strictlyIncreasing(points: ReadonlyArray<{ t: number }>): boolean {
  return points.every((p, i) => i === 0 || p.t > points[i - 1]!.t);
}

describe('planEnvelope', () => {
  const lead = { a: 0, d: 0.08, s: 0.6, r: 0.1 };

  it('plans a full ADSR with a minimum attack and a linear release', () => {
    const { points, end } = planEnvelope(lead, 1, 0.5);
    expect(points).toEqual([
      { t: 0, v: 0 },
      { t: MIN_ATTACK, v: 0.5 },
      { t: MIN_ATTACK + 0.08, v: 0.3 },
      { t: 1, v: 0.3 },
      { t: 1.1, v: 0 },
    ]);
    expect(end).toBeCloseTo(1.1, 12);
  });

  it('has no decay segment when the sustain level is 1', () => {
    const { points } = planEnvelope({ a: 0.02, d: 0.5, s: 1, r: 0.05 }, 0.3, 1);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ t: 0, v: 0 });
    expect(points[1]).toEqual({ t: 0.02, v: 1 });
    expect(points[2]).toEqual({ t: 0.3, v: 1 });
    expect(points[3]!.t).toBeCloseTo(0.35, 12);
    expect(points[3]!.v).toBe(0);
  });

  it('never releases with a click: release is at least MIN_RELEASE', () => {
    const { points, end } = planEnvelope({ a: 0, d: 0, s: 1, r: 0 }, 0.2, 1);
    expect(points[points.length - 1]).toEqual({ t: expect.closeTo(0.2 + MIN_RELEASE, 12), v: 0 });
    expect(end).toBeCloseTo(0.2 + MIN_RELEASE, 12);
  });

  it('releases from the current level when the gate closes during the attack', () => {
    const { points } = planEnvelope({ a: 0.1, d: 0, s: 1, r: 0.05 }, 0.05, 1);
    // halfway up the attack ramp
    expect(points).toEqual([
      { t: 0, v: 0 },
      { t: 0.05, v: 0.5 },
      { t: 0.1, v: 0 },
    ]);
  });

  it('releases from the current level when the gate closes during the decay', () => {
    const { points } = planEnvelope({ a: 0, d: 0.2, s: 0.2, r: 0.1 }, 0.101, 1);
    // decay runs 1 -> 0.2 between t=0.001 and t=0.201; at t=0.101 it is halfway: 0.6
    const atGate = points[points.length - 2]!;
    expect(atGate.t).toBeCloseTo(0.101, 12);
    expect(atGate.v).toBeCloseTo(0.6, 12);
    expect(points[points.length - 1]!.v).toBe(0);
  });

  it('plays percussive envelopes (sustain 0) to the end of the decay even for a short gate', () => {
    const kick = { a: 0, d: 0.12, s: 0, r: 0 };
    const { points, end } = planEnvelope(kick, 0.05, 1);
    expect(points).toEqual([
      { t: 0, v: 0 },
      { t: MIN_ATTACK, v: 1 },
      { t: MIN_ATTACK + 0.12, v: 0 },
    ]);
    expect(end).toBeCloseTo(0.121, 12);
  });

  it('does not keep a percussive voice alive after its decay when the gate is long', () => {
    const { points, end } = planEnvelope({ a: 0, d: 0.05, s: 0, r: 0.3 }, 2, 1);
    expect(end).toBeCloseTo(0.051, 12);
    expect(points).toHaveLength(3);
  });

  it('always produces strictly increasing times that start at silence and end at silence', () => {
    for (const env of [lead, { a: 0, d: 0, s: 1, r: 0 }, { a: 0, d: 0, s: 0, r: 0 }, { a: 0.3, d: 0.3, s: 0.5, r: 0.3 }]) {
      for (const gate of [0, 0.0001, 0.01, 0.2, 5]) {
        const { points } = planEnvelope(env, gate, 0.8);
        expect(points[0]).toEqual({ t: 0, v: 0 });
        expect(strictlyIncreasing(points), JSON.stringify([env, gate])).toBe(true);
        expect(points[points.length - 1]!.v, JSON.stringify([env, gate])).toBe(0);
        expect(points.every((p) => Number.isFinite(p.t) && Number.isFinite(p.v))).toBe(true);
      }
    }
  });

  it('interpolates levels linearly and clamps outside the range', () => {
    const pts = [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
      { t: 2, v: 0 },
    ];
    expect(envelopeLevelAt(pts, -1)).toBe(0);
    expect(envelopeLevelAt(pts, 0.5)).toBe(0.5);
    expect(envelopeLevelAt(pts, 1.5)).toBe(0.5);
    expect(envelopeLevelAt(pts, 9)).toBe(0);
  });
});

describe('planRetriggeredEnvelope', () => {
  it('restarts the envelope at every step and returns to silence in between', () => {
    const env = { a: 0, d: 0.05, s: 0.5, r: 0.2 };
    const starts = [0, 0.1, 0.2];
    const { points, end } = planRetriggeredEnvelope(env, starts, 0.5, 1);
    expect(strictlyIncreasing(points)).toBe(true);
    for (const s of starts) {
      expect(envelopeLevelAt(points, s + 1e-6)).toBeLessThan(0.1); // ramping up from ~0 at each start
      expect(envelopeLevelAt(points, s + MIN_ATTACK + 1e-9)).toBeGreaterThan(0.9); // reaches the peak
    }
    // silent right before steps 2 and 3
    expect(envelopeLevelAt(points, 0.1 - 1e-9)).toBeLessThan(0.01);
    expect(envelopeLevelAt(points, 0.2 - 1e-9)).toBeLessThan(0.01);
    // the last step gets the full release: gate 0.5 + r 0.2
    expect(end).toBeCloseTo(0.7, 9);
    expect(points[points.length - 1]!.v).toBe(0);
  });

  it('truncates a percussive decay that outlasts its step', () => {
    const { points } = planRetriggeredEnvelope({ a: 0, d: 0.5, s: 0, r: 0 }, [0, 0.1], 0.3, 1);
    expect(strictlyIncreasing(points)).toBe(true);
    expect(envelopeLevelAt(points, 0.1 - 1e-6)).toBeLessThan(0.02);
  });
});

describe('pitch curves', () => {
  it('adds piecewise-linear curves exactly', () => {
    const sum = addCurves(
      [
        [0, 0],
        [1, 10],
      ],
      [
        [0, 5],
        [0.5, 0],
      ],
    );
    expect(curveAt(sum, 0)).toBe(5);
    expect(curveAt(sum, 0.5)).toBe(5);
    expect(curveAt(sum, 1)).toBe(10);
    expect(curveAt(sum, 2)).toBe(10);
  });

  it('is a single static key without modulation', () => {
    expect(planPitch({ duration: 1 })).toEqual([{ t: 0, semis: 0 }]);
  });

  it('plans a slide-in (^ starts below, v starts above)', () => {
    expect(planPitch({ duration: 1, slideFrom: -1, slideTime: 0.05 })).toEqual([
      { t: 0, semis: -1 },
      { t: 0.05, semis: 0 },
    ]);
    expect(planPitch({ duration: 1, slideFrom: 2, slideTime: 0.1 })).toEqual([
      { t: 0, semis: 2 },
      { t: 0.1, semis: 0 },
    ]);
  });

  it('plans the kick pitch sweep from the instrument pitchEnv', () => {
    expect(planPitch({ duration: 0.1, pitchEnv: { from: 48, to: -12, time: 0.08 } })).toEqual([
      { t: 0, semis: 48 },
      { t: 0.08, semis: -12 },
    ]);
  });

  it('plans glides: hold, then move to the target', () => {
    const keys = planPitch({ duration: 1, glides: [{ at: 0.25, semis: 4, time: 0.07 }] });
    expect(keys.map((k) => k.semis)).toEqual([0, 0, 4]);
    expect(keys.map((k) => k.t)[0]).toBe(0);
    expect(keys[1]!.t).toBeCloseTo(0.25, 12);
    expect(keys[2]!.t).toBeCloseTo(0.32, 12);

    const two = planPitch({
      duration: 1,
      glides: [
        { at: 0.2, semis: 4, time: 0.1 },
        { at: 0.5, semis: -3, time: 0.1 },
      ],
    });
    expect(two.map((k) => k.semis)).toEqual([0, 0, 4, 4, -3]);
    [0, 0.2, 0.3, 0.5, 0.6].forEach((t, i) => expect(two[i]!.t).toBeCloseTo(t, 12));
  });

  it('cycles arp offsets as stepped keys every interval', () => {
    const keys = planPitch({ duration: 0.1, arp: { offsets: [0, 4, 7], interval: 0.03 } });
    expect(keys.map((k) => [Math.round(k.t * 1000) / 1000, k.semis, k.jump])).toEqual([
      [0, 0, true],
      [0.03, 4, true],
      [0.06, 7, true],
      [0.09, 0, true],
    ]);
  });

  it('adds the base curve to the arp steps', () => {
    const keys = planPitch({ duration: 0.1, slideFrom: -2, slideTime: 0.06, arp: { offsets: [0, 12], interval: 0.03 } });
    expect(keys.map((k) => Math.round(k.semis * 1000) / 1000)).toEqual([-2, 11, 0, 12]);
  });

  it('caps the number of arp steps', () => {
    const keys = planPitch({ duration: 1000, arp: { offsets: [0, 7], interval: 0.01 } });
    expect(keys).toHaveLength(MAX_ARP_STEPS);
  });

  it('converts semitones to frequency ratios', () => {
    expect(semisToRatio(0)).toBe(1);
    expect(semisToRatio(12)).toBeCloseTo(2, 12);
    expect(semisToRatio(-12)).toBeCloseTo(0.5, 12);
    expect(semisToRatio(7)).toBeCloseTo(1.4983, 4);
  });
});

describe('planMusicVoice', () => {
  const instruments: SongDef['instruments'] = {
    lead: { wave: 'pulse25', env: { a: 0, d: 0.08, s: 0.6, r: 0.1 }, vol: 0.5, vibrato: { depth: 0.15, rate: 6, delay: 0.12 } },
    manual: { wave: 'pulse50', vibrato: { depth: 0.2, rate: 5, delay: 0.3, auto: false } },
    plain: { wave: 'triangle' },
    arp: { wave: 'pulse12', arp: [0, 4, 7], arpSpeed: 0.03 },
    snare: { wave: 'noise', noiseRate: 1.5, vol: 0.5, env: { a: 0, d: 0.12, s: 0, r: 0 } },
    hat: { wave: 'noise-short', filter: { type: 'highpass', freq: 6000, q: 1 } },
    kick: { wave: 'triangle', pitchEnv: { from: 48, to: -12, time: 0.08 }, env: { a: 0, d: 0.12, s: 0, r: 0 } },
    n: { wave: 'noise', noiseRate: 2 },
  };
  /** Compiles a one-track song (120 bpm, 4 steps per beat) and returns it. */
  const song = (melody: string, instrument = 'lead') =>
    compileSong({ bpm: 120, instruments, tracks: { t: instrument }, patterns: { A: { t: melody } }, order: ['A'] });
  const drums = (pattern: string, keys: Record<string, string>) =>
    compileSong({ bpm: 120, instruments, tracks: { d: keys }, patterns: { A: { d: pattern } }, order: ['A'] });
  const first = (s: ReturnType<typeof song>): NoteEvent => s.events[0]!;

  it('plans volume = vol x velocity and the oscillator reference frequency', () => {
    const s = song('A4! - - -');
    const plan = planMusicVoice(first(s), s.instruments.lead!);
    expect(plan.wave).toBe('pulse25');
    expect(plan.ref).toBeCloseTo(440, 9);
    expect(plan.env[1]!.v).toBeCloseTo(0.5 * 1.3, 12);
    expect(plan.gate).toBe(0.5);
    expect(plan.start).toBe(0);
  });

  it('gives an instrument with vibrato a delayed vibrato in cents', () => {
    const s = song('A4 - - -');
    const vib = planMusicVoice(first(s), s.instruments.lead!).vibrato!;
    expect(vib.cents).toBeCloseTo(15, 9);
    expect(vib).toMatchObject({ rate: 6, onset: 0.12 });
  });

  it('skips vibrato that would only start after the sound has ended', () => {
    const s = compileSong({ bpm: 960, instruments, tracks: { t: 'lead' }, patterns: { A: { t: 'A4 .' } }, order: ['A'] });
    // one step = 0.015625 s; gate + release = 0.1156 s < 0.12 s vibrato delay
    expect(planMusicVoice(s.events[0]!, s.instruments.lead!).vibrato).toBeNull();
  });

  it('forces vibrato with ~: no delay, the instrument depth/rate, or a default for instruments without any', () => {
    const lead = song('A4~ - - -', 'lead');
    const leadVib = planMusicVoice(first(lead), lead.instruments.lead!).vibrato!;
    expect(leadVib).toMatchObject({ rate: 6, onset: 0 });
    expect(leadVib.cents).toBeCloseTo(15, 9);

    const manual = song('A4 - - -', 'manual');
    expect(planMusicVoice(first(manual), manual.instruments.manual!).vibrato).toBeNull(); // auto: false
    const forced = song('A4~ - - -', 'manual');
    const forcedVib = planMusicVoice(first(forced), forced.instruments.manual!).vibrato!;
    expect(forcedVib).toMatchObject({ rate: 5, onset: 0 });
    expect(forcedVib.cents).toBeCloseTo(20, 9);

    const plain = song('A4~ - - -', 'plain');
    const plainVib = planMusicVoice(first(plain), plain.instruments.plain!).vibrato!;
    expect(plainVib).toMatchObject({ rate: 6, onset: 0 });
    expect(plainVib.cents).toBeCloseTo(30, 9);
    expect(planMusicVoice(first(song('A4 - - -', 'plain')), plain.instruments.plain!).vibrato).toBeNull();
  });

  it('makes arp instruments step through chord offsets', () => {
    const s = song('C4 - - -', 'arp');
    const plan = planMusicVoice(first(s), s.instruments.arp!);
    expect(plan.pitch.slice(0, 4).map((k) => k.semis)).toEqual([0, 4, 7, 0]);
    expect(plan.pitch.every((k) => k.jump)).toBe(true);
  });

  it('sweeps the pitch of a kick and keeps its decay', () => {
    const s = drums('k . . .', { k: 'kick' });
    const plan = planMusicVoice(s.events[0]!, s.instruments.kick!);
    expect(plan.pitch).toEqual([
      { t: 0, semis: 48 },
      { t: 0.08, semis: -12 },
    ]);
    expect(plan.ref).toBeCloseTo(65.4064, 3); // C2
    expect(plan.end).toBeCloseTo(0.121, 9);
  });

  it('maps noise voices to a playback rate and never gives them vibrato', () => {
    const s = drums('s h . .', { s: 'snare', h: 'hat' });
    const snare = planMusicVoice(s.events[0]!, s.instruments.snare!, { noiseOffset: 0.25 });
    expect(snare.wave).toBe('noise');
    expect(snare.ref).toBe(1.5);
    expect(snare.vibrato).toBeNull();
    expect(snare.noiseOffset).toBe(0.25);
    expect(snare.env[1]!.v).toBe(0.5);
    const hat = planMusicVoice(s.events[1]!, s.instruments.hat!);
    expect(hat.filter).toEqual({ type: 'highpass', q: 1, keys: [{ t: 0, hz: 6000 }] });
  });

  it('shifts a pitched noise instrument by octaves relative to C4', () => {
    const s = song('C5 C3 C4', 'n');
    expect(planMusicVoice(s.events[0]!, s.instruments.n!).ref).toBeCloseTo(4, 12);
    expect(planMusicVoice(s.events[1]!, s.instruments.n!).ref).toBeCloseTo(1, 12);
    expect(planMusicVoice(s.events[2]!, s.instruments.n!).ref).toBeCloseTo(2, 12);
  });

  it('plans glides relative to the starting note', () => {
    const s = song('C4 - E4> -');
    const plan = planMusicVoice(first(s), s.instruments.lead!);
    expect(plan.pitch.map((k) => k.semis)).toEqual([0, 0, 4]);
    expect(plan.pitch[1]!.t).toBeCloseTo(0.25, 12);
    expect(plan.pitch[2]!.t).toBeCloseTo(0.32, 12);
  });

  it('can shorten the gate for an event that starts late', () => {
    const s = song('A4 - - -');
    const plan = planMusicVoice(first(s), s.instruments.lead!, { gate: 0.2 });
    expect(plan.gate).toBe(0.2);
    expect(plan.end).toBeCloseTo(0.3, 12);
  });
});

describe('deterministic random helpers', () => {
  it('mulberry32 is reproducible and uniform-ish in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = Array.from({ length: 1000 }, () => a());
    expect(seq).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = seq.reduce((x, y) => x + y, 0) / seq.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(mulberry32(43)()).not.toBe(mulberry32(42)());
  });

  it('hash01 is stable, in range and varies with both inputs', () => {
    expect(hash01(1, 2)).toBe(hash01(1, 2));
    expect(hash01(1, 2)).not.toBe(hash01(2, 1));
    expect(hash01(1, 2)).not.toBe(hash01(1, 3));
    for (let i = 0; i < 200; i++) {
      const v = hash01(7, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
