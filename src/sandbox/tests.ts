/**
 * Auto tests for the Test Hangar: a hands-off glide test, a throw sweep, the aerodynamic polar, a
 * report card in plain English and a side-by-side comparison of two designs.
 *
 * Units: distances in metres, angles in radians unless a name ends in `Deg`, speeds and sink rates in
 * sim (SI) m/s, times in REAL seconds unless a name says `Sim`. Real time x PHYS.timeScale = sim time.
 */

import { G, coeffs, glideSpeed, type AeroModel, type Friendly } from '../paper/aero';
import type { PlaneMesh } from '../paper/build';
import { PHYS } from '../physics/config';
import { idealThrowPower } from '../physics/flight';
import { simulateOpen, type OpenOutcome, type PathPoint } from './openSim';

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  const n = Math.round((to - from) / step);
  for (let i = 0; i <= n; i++) out.push(from + i * step);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Glide test
// ---------------------------------------------------------------------------------------------

export interface GlideTestOptions {
  /** Launcher height above the floor, metres (default 2). */
  height?: number;
  /** Throw power 0..1 (default: the design's ideal throw). */
  power?: number;
  /** Launch angle, radians; 0 = level, positive = up (default 0). */
  angle?: number;
  /** Longest flight to simulate, real seconds (default 60). */
  maxT?: number;
}

export interface GlideTestResult {
  /** The launch used. */
  height: number;
  power: number;
  angle: number;
  outcome: OpenOutcome;
  /** Horizontal distance from the launcher to first touchdown, metres. */
  distance: number;
  /** Time in the air, real seconds (what the player watches) and sim seconds (the physics). */
  timeAloft: number;
  timeAloftSim: number;
  /** Mean sink rate: metres per sim second (the physical one, comparable with the polar) and per real second. */
  avgSink: number;
  avgSinkReal: number;
  /** distance / launch height: the number you can see. */
  glideRatio: number;
  /** distance / the height the flight really spent, counting the energy of the throw too. This is the number to
   *  compare with the design's L/D: the throw adds a little speed energy on top of the height. */
  glideRatioEnergy: number;
  /** Highest point reached, metres above the floor. */
  maxHeight: number;
  stallEvents: number;
  /** Best instantaneous lift-to-drag ratio seen in flight. */
  bestLD: number;
  /** Damage when it landed, per cent. */
  finalDamage: number;
  launchSpeed: number;
  touchdownSpeed: number;
  /** What the design analysis predicts for a steady hands-off glide (null if it has no stable trim). */
  predicted: { LD: number; V: number; sink: number } | null;
  path: PathPoint[];
}

/** Hands-off flight from a launcher: how far, how long, how steeply it comes down. */
export function glideTest(aero: AeroModel, mesh: PlaneMesh, opts: GlideTestOptions = {}): GlideTestResult {
  const height = Math.max(0.1, opts.height ?? 2);
  const power = clamp(opts.power ?? idealThrowPower(aero), 0, 1);
  const angle = opts.angle ?? 0;
  const r = simulateOpen(aero, mesh, { x: 0, y: height, angle, power }, undefined, { maxT: opts.maxT });
  const spent = height - r.touchdownY + (r.launchSpeed ** 2 - r.touchdownSpeed ** 2) / (2 * G);
  const trim = aero.perf.trim;
  return {
    height,
    power,
    angle,
    outcome: r.outcome,
    distance: r.distance,
    timeAloft: r.timeAloft,
    timeAloftSim: r.timeAloftSim,
    avgSink: r.avgSink,
    avgSinkReal: r.avgSink * PHYS.timeScale,
    glideRatio: r.distance / height,
    glideRatioEnergy: r.distance / Math.max(0.05, spent),
    maxHeight: r.maxHeight,
    stallEvents: r.stallEvents,
    bestLD: r.bestLD,
    finalDamage: r.finalDamage,
    launchSpeed: r.launchSpeed,
    touchdownSpeed: r.touchdownSpeed,
    predicted: trim ? { LD: trim.LD, V: trim.v, sink: trim.sink } : null,
    path: r.path,
  };
}

// ---------------------------------------------------------------------------------------------
// Throw sweep
// ---------------------------------------------------------------------------------------------

export interface SweepPoint {
  /** Throw power 0..1 and angle (radians; `angleDeg` in degrees). */
  power: number;
  angle: number;
  angleDeg: number;
  /** Distance to first touchdown, metres. */
  distance: number;
  timeAloft: number;
  finalDamage: number;
  stallEvents: number;
  outcome: OpenOutcome;
}

export interface ThrowSweep {
  height: number;
  /** Distance against throw power (0.1..1), at the best angle. */
  byPower: SweepPoint[];
  /** Distance against throw angle (-20..+40 degrees), at the best power. */
  byAngle: SweepPoint[];
  /** The farthest throw found (check its `finalDamage`: the farthest throw is not always a gentle one). */
  best: SweepPoint;
  /** The game's suggested throw (the design's ideal power, level). */
  ideal: SweepPoint;
}

export interface ThrowSweepOptions {
  /** Launcher height, metres (default 2). */
  height?: number;
}

const SWEEP_POWERS = range(0.1, 1, 0.05).map((p) => Math.round(p * 100) / 100);
const SWEEP_ANGLES_DEG = range(-20, 40, 2.5);

/**
 * Distance against throw power and against throw angle, and the best throw. The two curves are slices
 * through the best throw found, so it sits on both of them.
 */
export function throwSweep(aero: AeroModel, mesh: PlaneMesh, opts: ThrowSweepOptions = {}): ThrowSweep {
  const height = Math.max(0.1, opts.height ?? 2);
  const memo = new Map<string, SweepPoint>();
  const fly = (power: number, angleDeg: number): SweepPoint => {
    const key = `${power}|${angleDeg}`;
    let pt = memo.get(key);
    if (!pt) {
      const r = simulateOpen(aero, mesh, { x: 0, y: height, angle: angleDeg * DEG, power }, undefined, { maxT: 40, every: 1000 });
      pt = { power, angle: angleDeg * DEG, angleDeg, distance: r.distance, timeAloft: r.timeAloft, finalDamage: r.finalDamage, stallEvents: r.stallEvents, outcome: r.outcome };
      memo.set(key, pt);
    }
    return pt;
  };
  const argmax = (pts: SweepPoint[]) => pts.reduce((best, pt) => (pt.distance > best.distance ? pt : best));
  const sweepAngles = (power: number) => SWEEP_ANGLES_DEG.map((a) => fly(power, a));
  const sweepPowers = (angleDeg: number) => SWEEP_POWERS.map((p) => fly(p, angleDeg));

  const idealPower = idealThrowPower(aero);
  const ideal = fly(idealPower, 0);

  // Coordinate ascent on the (power, angle) grid: each step can only improve, so it settles quickly.
  let angleDeg = 0;
  let power = idealPower;
  for (let round = 0; round < 4; round++) {
    const a = argmax(sweepAngles(power)).angleDeg;
    const p = argmax(sweepPowers(a)).power;
    const done = a === angleDeg && p === power;
    angleDeg = a;
    power = p;
    if (done) break;
  }
  const byAngle = sweepAngles(power);
  const byPower = sweepPowers(angleDeg);
  const best = argmax([...byPower, ...byAngle]);
  return { height, byPower, byAngle, best, ideal };
}

// ---------------------------------------------------------------------------------------------
// Polar
// ---------------------------------------------------------------------------------------------

export interface PolarPoint {
  alphaDeg: number;
  CL: number;
  CD: number;
  /** Lift-to-drag ratio. */
  LD: number;
  /** Steady-glide airspeed (m/s) and sink rate (m/s) at this angle of attack. */
  V: number;
  sink: number;
}

export interface Polar {
  /** Angle of attack grid, degrees (-6..40), with the coefficients of the plane as folded (hands-off elevators). */
  alphaDeg: number[];
  CL: number[];
  CD: number[];
  Cm: number[];
  LD: number[];
  /** Stall fraction 0 (attached) .. 1 (fully stalled). */
  stall: number[];
  /** Steady-glide polar over the attached range: airspeed against sink rate at each angle of attack. */
  glide: { alphaDeg: number[]; V: number[]; sink: number[]; LD: number[] };
  /** The angle of attack of the best glide ratio, and of the slowest sink. */
  bestLD: PolarPoint;
  minSink: PolarPoint;
  /** Peak lift coefficient and where it occurs; the speed it implies is the stall speed (m/s). */
  CLmax: number;
  alphaStallDeg: number;
  vStall: number;
  /** Where the plane settles hands-off (null: no stable trim, it dives). */
  trim: PolarPoint | null;
  /** The design analysis' figures for the same plane with the elevators flat (the game's "potential"). */
  potential: { LDmax: number; alphaBestDeg: number; vBest: number; sinkMin: number; vStall: number };
}

function polarPoint(aero: AeroModel, alpha: number): PolarPoint {
  const c = coeffs(aero, alpha, 0, 0);
  const cr = Math.hypot(c.CL, c.CD);
  const V = glideSpeed(aero, c.CL, c.CD);
  return { alphaDeg: alpha / DEG, CL: c.CL, CD: c.CD, LD: c.CD > 1e-6 ? c.CL / c.CD : 0, V, sink: (V * c.CD) / Math.max(1e-6, cr) };
}

/** The plane's aerodynamic polar from `coeffs`, as folded: arrays for plotting plus the points worth marking. */
export function polar(aero: AeroModel, opts: { step?: number } = {}): Polar {
  const step = opts.step ?? 0.5;
  const alphaDeg = range(-6, 40, step);
  const CL: number[] = [];
  const CD: number[] = [];
  const Cm: number[] = [];
  const LD: number[] = [];
  const stall: number[] = [];
  for (const a of alphaDeg) {
    const c = coeffs(aero, a * DEG, 0, 0);
    CL.push(c.CL);
    CD.push(c.CD);
    Cm.push(c.Cm);
    LD.push(c.CD > 1e-6 ? c.CL / c.CD : 0);
    stall.push(c.stall);
  }

  // Fine scan for the extremes and the attached range (up to the peak of the lift curve).
  const fine = 0.1 * DEG;
  const aMax = aero.alphaStall + aero.stallWidth;
  let clMax = -Infinity;
  let aClMax = 0;
  for (let a = 0; a <= aMax; a += fine) {
    const cl = coeffs(aero, a, 0, 0).CL;
    if (cl > clMax) {
      clMax = cl;
      aClMax = a;
    }
  }
  const glide = { alphaDeg: [] as number[], V: [] as number[], sink: [] as number[], LD: [] as number[] };
  let bestLD: PolarPoint | null = null;
  let minSink: PolarPoint | null = null;
  for (let a = -6 * DEG; a <= aClMax + 1e-9; a += fine) {
    const pt = polarPoint(aero, a);
    if (pt.CL < 0.05 || pt.V > 12) continue; // the lift-free dive end of the curve is off the chart
    if (!bestLD || pt.LD > bestLD.LD) bestLD = pt;
    if (!minSink || pt.sink < minSink.sink) minSink = pt;
  }
  for (let a = -6 * DEG; a <= aClMax + 1e-9; a += step * DEG) {
    const pt = polarPoint(aero, a);
    if (pt.CL < 0.05 || pt.V > 12) continue;
    glide.alphaDeg.push(pt.alphaDeg);
    glide.V.push(pt.V);
    glide.sink.push(pt.sink);
    glide.LD.push(pt.LD);
  }
  const atStall = polarPoint(aero, aClMax);
  const t = aero.perf.trim;
  return {
    alphaDeg,
    CL,
    CD,
    Cm,
    LD,
    stall,
    glide,
    bestLD: bestLD ?? atStall,
    minSink: minSink ?? atStall,
    CLmax: clMax,
    alphaStallDeg: aClMax / DEG,
    vStall: atStall.V,
    trim: t ? polarPoint(aero, t.alpha) : null,
    potential: {
      LDmax: aero.perf.LDmax,
      alphaBestDeg: aero.perf.alphaBest / DEG,
      vBest: aero.perf.vBest,
      sinkMin: aero.perf.sinkMin,
      vStall: aero.perf.vStall,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Report card
// ---------------------------------------------------------------------------------------------

export type Tone = 'good' | 'ok' | 'poor';

export interface ReportLine {
  key: keyof Friendly;
  label: string;
  /** 0..10 from the design analysis. */
  score: number;
  tone: Tone;
  /** A short plain-English remark, backed by the numbers. */
  remark: string;
}

export interface ReportNote {
  tone: 'good' | 'warn' | 'bad';
  text: string;
}

export interface Measured {
  height: number;
  power: number;
  distance: number;
  timeAloft: number;
  timeAloftSim: number;
  avgSink: number;
  glideRatio: number;
  glideRatioEnergy: number;
  maxHeight: number;
  stallEvents: number;
  bestLD: number;
  finalDamage: number;
}

export interface ReportFacts {
  massG: number;
  spanCm: number;
  wingLoading: number;
  LDmax: number;
  trimSpeed: number | null;
  stallSpeed: number;
  sinkMin: number;
}

export interface ReportCard {
  name: string;
  /** The six friendly stats with remarks. */
  lines: ReportLine[];
  /** What the glide test measured (null when no test was run). */
  measured: Measured | null;
  /** Remarks on how it flies hands-off, most important first. */
  notes: ReportNote[];
  /** The design analysis' own warnings, passed through. */
  warnings: string[];
  facts: ReportFacts;
}

const LABELS: Record<keyof Friendly, string> = {
  glide: 'Glide',
  speed: 'Speed',
  float: 'Float',
  stability: 'Stability',
  agility: 'Agility',
  toughness: 'Toughness',
};

const f1 = (v: number) => v.toFixed(1);
/** Speed is a matter of taste, so it never reads as good or poor. */
const toneOf = (key: keyof Friendly, score: number): Tone => (key === 'speed' ? 'ok' : score >= 6.5 ? 'good' : score >= 3.5 ? 'ok' : 'poor');

function remarkFor(key: keyof Friendly, aero: AeroModel, glide: GlideTestResult | null): string {
  const s = aero.friendly[key];
  const trim = aero.perf.trim;
  switch (key) {
    case 'glide': {
      // Quote the measured glide only when the test was a plain level throw; a steep one says little about L/D.
      const plain = glide && glide.outcome !== 'crashed' && Math.abs(glide.angle) <= 15 * DEG ? glide : null;
      const ratio = plain ? plain.glideRatioEnergy : trim ? trim.LD : aero.perf.LDmax * 0.5;
      const how = `about ${f1(ratio)} m forward for every 1 m of height`;
      if (s >= 7.5) return `Long, flat glide: ${how}.`;
      if (s >= 5) return `Decent glide: ${how}.`;
      if (s >= 3) return `Middling glide: ${how}.`;
      return `Comes down steeply: ${how}.`;
    }
    case 'speed': {
      const v = trim ? trim.v : aero.perf.vBest;
      if (s >= 7) return `Fast, about ${f1(v)} m/s: needs room to fly.`;
      if (s >= 3.5) return `Cruises at about ${f1(v)} m/s.`;
      return `Slow and gentle, about ${f1(v)} m/s.`;
    }
    case 'float': {
      const wl = `${f1(aero.wingLoading)} N/m² wing loading`;
      if (s >= 7) return `Floats beautifully in drafts (${wl}).`;
      if (s >= 3.5) return `Drafts lift it a little (${wl}).`;
      return `Heavy for its wings: drafts barely move it (${wl}).`;
    }
    case 'stability': {
      const sm = `${(aero.SM * 100).toFixed(1)} % static margin`;
      if (aero.SM <= 0) return 'Unstable: it will tumble. Add nose weight.';
      if (aero.SM < 0.03) return `Twitchy: barely stable (${sm}). A little nose weight would calm it.`;
      if (aero.SM > 0.3) return 'Very nose-heavy: sluggish and dives. Bend the elevators up or lose some weight.';
      if (s >= 7) return `Rock steady in the air (${sm}).`;
      if (s >= 3.5) return `Steady (${sm}).`;
      return `Lightly stable (${sm}): bumps and drafts will upset it.`;
    }
    case 'agility': {
      const turn = `${aero.perf.turnTime.toFixed(2)} s to turn around`;
      if (s >= 7) return `Quick to turn: ${turn}.`;
      if (s >= 3.5) return `Turns at a steady pace: ${turn}.`;
      return `Slow to turn: ${turn}. It needs space.`;
    }
    case 'toughness': {
      const hit = glide && glide.finalDamage > 0 ? ` Took ${glide.finalDamage} % damage landing in the test.` : '';
      if (s >= 7) return `Shrugs off bumps.${hit}`;
      if (s >= 3.5) return `Takes a few knocks before it creases.${hit}`;
      return `Fragile: soft landings only.${hit}`;
    }
  }
}

function handsOffNotes(aero: AeroModel, glide: GlideTestResult | null): ReportNote[] {
  const notes: ReportNote[] = [];
  const trim = aero.perf.trim;
  if (aero.SM < 0) notes.push({ tone: 'bad', text: 'Unstable: it will tumble. Add nose weight (more nose folds or a paperclip).' });
  else if (!trim) notes.push({ tone: 'bad', text: 'Dives when hands-off: bend the elevators up.' });
  else if (trim.CL < 0.12) notes.push({ tone: 'warn', text: 'Noses down hands-off: a touch more up-elevator would help.' });
  else if (trim.alpha > aero.alphaStall * 0.95) notes.push({ tone: 'warn', text: 'Hovers on the edge of a stall hands-off: reduce the elevator bend.' });
  if (glide) {
    if (glide.outcome === 'crashed') notes.push({ tone: 'bad', text: 'Wrecked in the glide test: it cannot take that landing.' });
    if (glide.stallEvents > 0) {
      notes.push(
        glide.power < idealThrowPower(aero) - 0.02
          ? { tone: 'warn', text: 'Stalls easily: throw a little harder.' }
          : { tone: 'warn', text: `Stalled ${glide.stallEvents === 1 ? 'once' : `${glide.stallEvents} times`} in the glide test even with its ideal throw: reduce the elevator bend or add nose weight.` },
      );
    }
    if (trim && glide.stallEvents === 0 && glide.glideRatioEnergy < trim.LD * 0.75) {
      notes.push({ tone: 'warn', text: 'Glided shorter than its trim predicts: it wobbled and lost energy after the throw.' });
    }
    if (glide.finalDamage >= 10) notes.push({ tone: 'warn', text: `Landing cost ${glide.finalDamage} % damage: try a gentler throw.` });
  }
  if (notes.length === 0) notes.push({ tone: 'good', text: 'Flies smoothly hands-off: it settles into its trim by itself.' });
  return notes;
}

/** The friendly 0..10 stats with plain-English remarks, plus what the glide test measured. */
export function reportCard(aero: AeroModel, glide: GlideTestResult | null = null, name = 'Plane'): ReportCard {
  const keys = Object.keys(LABELS) as (keyof Friendly)[];
  const lines = keys.map((key): ReportLine => {
    const score = aero.friendly[key];
    return { key, label: LABELS[key], score, tone: toneOf(key, score), remark: remarkFor(key, aero, glide) };
  });
  return {
    name,
    lines,
    measured: glide
      ? {
          height: glide.height,
          power: glide.power,
          distance: glide.distance,
          timeAloft: glide.timeAloft,
          timeAloftSim: glide.timeAloftSim,
          avgSink: glide.avgSink,
          glideRatio: glide.glideRatio,
          glideRatioEnergy: glide.glideRatioEnergy,
          maxHeight: glide.maxHeight,
          stallEvents: glide.stallEvents,
          bestLD: glide.bestLD,
          finalDamage: glide.finalDamage,
        }
      : null,
    notes: handsOffNotes(aero, glide),
    warnings: [...aero.warnings],
    facts: {
      massG: aero.mass * 1000,
      spanCm: aero.span * 100,
      wingLoading: aero.wingLoading,
      LDmax: aero.perf.LDmax,
      trimSpeed: aero.perf.trim ? aero.perf.trim.v : null,
      stallSpeed: aero.perf.vStall,
      sinkMin: aero.perf.sinkMin,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------------------------

export interface CompareRow {
  key: string;
  label: string;
  unit: string;
  a: number;
  b: number;
  /** b - a. */
  delta: number;
  /** Which is better; 'tie' when they are the same or the row is a matter of taste (higherIsBetter null). */
  better: 'a' | 'b' | 'tie';
  higherIsBetter: boolean | null;
}

export interface Comparison {
  a: string;
  b: string;
  rows: CompareRow[];
  /** The biggest differences in a sentence each. */
  summary: string[];
}

/** Side-by-side deltas for two report cards (b relative to a). */
export function compare(a: ReportCard, b: ReportCard): Comparison {
  const rows: CompareRow[] = [];
  const add = (key: string, label: string, unit: string, av: number | null, bv: number | null, higherIsBetter: boolean | null) => {
    if (av === null || bv === null) return;
    const delta = bv - av;
    const eps = Math.max(1e-9, 0.005 * Math.max(Math.abs(av), Math.abs(bv)));
    const better = higherIsBetter === null || Math.abs(delta) <= eps ? 'tie' : (delta > 0) === higherIsBetter ? 'b' : 'a';
    rows.push({ key, label, unit, a: av, b: bv, delta, better, higherIsBetter });
  };
  for (const la of a.lines) {
    const lb = b.lines.find((l) => l.key === la.key)!;
    add(la.key, la.label, '/10', la.score, lb.score, true);
  }
  const ma = a.measured;
  const mb = b.measured;
  if (ma && mb) {
    add('distance', 'Glide distance', 'm', ma.distance, mb.distance, true);
    add('timeAloft', 'Time aloft', 's', ma.timeAloft, mb.timeAloft, true);
    add('glideRatio', 'Glide ratio', ': 1', ma.glideRatio, mb.glideRatio, true);
    add('avgSink', 'Sink rate', 'm/s', ma.avgSink, mb.avgSink, false);
    add('stallEvents', 'Stalls', '', ma.stallEvents, mb.stallEvents, false);
    add('finalDamage', 'Landing damage', '%', ma.finalDamage, mb.finalDamage, false);
  }
  add('massG', 'Mass', 'g', a.facts.massG, b.facts.massG, null);
  add('spanCm', 'Span', 'cm', a.facts.spanCm, b.facts.spanCm, null);
  add('wingLoading', 'Wing loading', 'N/m²', a.facts.wingLoading, b.facts.wingLoading, null);
  add('LDmax', 'Best L/D', '', a.facts.LDmax, b.facts.LDmax, true);
  add('trimSpeed', 'Trim speed', 'm/s', a.facts.trimSpeed, b.facts.trimSpeed, null);
  add('stallSpeed', 'Stall speed', 'm/s', a.facts.stallSpeed, b.facts.stallSpeed, false);
  add('sinkMin', 'Minimum sink', 'm/s', a.facts.sinkMin, b.facts.sinkMin, false);

  const summary: string[] = [];
  const row = (key: string) => rows.find((r) => r.key === key);
  const d = row('distance');
  if (d && Math.abs(d.delta) >= 0.1) summary.push(`${d.delta > 0 ? b.name : a.name} glides ${Math.abs(d.delta).toFixed(1)} m farther.`);
  const t = row('timeAloft');
  if (t && Math.abs(t.delta) >= 0.2) summary.push(`${t.delta > 0 ? b.name : a.name} stays up ${Math.abs(t.delta).toFixed(1)} s longer.`);
  const s = row('avgSink');
  if (s && Math.abs(s.delta) >= 0.03) summary.push(`${s.delta < 0 ? b.name : a.name} sinks slower by ${Math.abs(s.delta).toFixed(2)} m/s.`);
  const stats = rows
    .filter((r) => r.unit === '/10' && Math.abs(r.delta) >= 1)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, 2);
  for (const r of stats) summary.push(`${r.delta > 0 ? b.name : a.name} scores ${Math.abs(r.delta).toFixed(1)} points higher for ${r.label.toLowerCase()}.`);
  if (summary.length === 0) summary.push('These two fly almost identically.');
  return { a: a.name, b: b.name, rows, summary };
}
