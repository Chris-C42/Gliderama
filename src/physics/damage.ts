/**
 * Wear & tear. Each part tracks how creased/crumpled it is (0..1); environmental effects soak,
 * scorch and set fire to the paper. Damage feeds back into the aerodynamics.
 */

import type { AeroMods, AeroModel } from '../paper/aero';

export type PartName = 'nose' | 'wingL' | 'wingR' | 'tail' | 'body';
export const PART_NAMES: PartName[] = ['nose', 'wingL', 'wingR', 'tail', 'body'];

export interface Damage {
  nose: number;
  wingL: number;
  wingR: number;
  tail: number;
  body: number;
  /** Water soaked up, 0..1. */
  soak: number;
  /** Scorching, 0..1. */
  scorch: number;
  /** Seconds (sim) the plane keeps burning; 0 = not on fire. */
  burning: number;
  /** Random trim change from a bent tail, in Cm units. */
  tailTrim: number;
}

export function freshDamage(): Damage {
  return { nose: 0, wingL: 0, wingR: 0, tail: 0, body: 0, soak: 0, scorch: 0, burning: 0, tailTrim: 0 };
}

/** How much each part counts towards the structure (`structural`). */
const WEIGHT: Record<PartName, number> = { nose: 0.9, wingL: 0.8, wingR: 0.8, tail: 0.6, body: 1.0 };
const PARTS_TOTAL = 2.4;

/** Structural integrity lost, 0..1 (1 = destroyed). */
export function structural(d: Damage): number {
  let parts = 0;
  for (const p of PART_NAMES) parts += d[p] * WEIGHT[p];
  return Math.min(1, parts / PARTS_TOTAL + d.scorch * 0.55 + Math.max(0, d.soak - 0.7) * 0.6);
}

/** Crumple `part` so the plane loses `amount` (0..1) more of its structure: what that part can't take goes to the body, then the rest. */
export function crumple(d: Damage, part: PartName, amount: number): void {
  let left = amount * PARTS_TOTAL;
  for (const p of [part, 'body' as const, ...PART_NAMES.filter((q) => q !== part && q !== 'body')]) {
    if (left <= 0) break;
    const take = Math.min(left, (1 - d[p]) * WEIGHT[p]);
    d[p] += take / WEIGHT[p];
    left -= take;
  }
}

/** Overall damage percentage for HUD / scoring. */
export function damagePct(d: Damage): number {
  return Math.round(Math.min(1, structural(d) + d.soak * 0.15) * 100);
}

export interface DamageMods extends AeroMods {
  massMul: number;
  /** Signed asymmetry: positive = right wing weaker. */
  asym: number;
}

export function damageMods(d: Damage, aero: AeroModel): DamageMods {
  const wings = (d.wingL + d.wingR) / 2;
  return {
    liftMul: Math.max(0.35, 1 - 0.28 * wings - 0.18 * d.scorch - 0.18 * d.soak),
    dragAdd: 0.035 * d.nose + 0.025 * (d.wingL + d.wingR) + 0.02 * d.tail + 0.02 * d.body + 0.03 * d.scorch + 0.012 * d.soak,
    cmAdd: d.tailTrim,
    stallMul: Math.max(0.6, 1 - 0.25 * wings - 0.15 * d.scorch),
    massMul: 1 + d.soak * 0.9 * Math.min(1.6, aero.absorbency),
    asym: d.wingR - d.wingL,
  };
}

/**
 * Apply an impact to a part. `severity` is the excess impact speed (m/s) beyond the safe limit.
 * Returns the damage added.
 */
export function applyImpact(d: Damage, part: PartName, severity: number, toughness: number, rand: () => number): number {
  if (severity <= 0) return 0;
  const add = Math.min(0.9, (severity * 0.22) / Math.max(0.25, toughness));
  d[part] = Math.min(1, d[part] + add);
  if (part === 'tail') {
    // A bent tail changes the trim: either way, more so with more damage.
    const dir = rand() < 0.5 ? -1 : 1;
    d.tailTrim = Math.max(-0.05, Math.min(0.05, d.tailTrim + dir * add * 0.06));
  }
  // Collateral creasing of the body
  d.body = Math.min(1, d.body + add * 0.25);
  return add;
}

/** Tape repair: removes damage (fraction 0..1 of each part's damage) and dries a little. */
export function repair(d: Damage, amount: number): void {
  for (const p of PART_NAMES) d[p] = Math.max(0, d[p] - amount);
  d.tailTrim *= 1 - amount;
  d.scorch = Math.max(0, d.scorch - amount * 0.5);
}

export function soakUp(d: Damage, amount: number, aero: AeroModel): void {
  if (aero.waterproof) return;
  d.soak = Math.min(1, d.soak + amount * aero.absorbency);
  if (d.burning > 0) d.burning = 0; // water puts out fire
}

export function ignite(d: Damage, aero: AeroModel): boolean {
  if (aero.heatproof || d.soak > 0.35) return false;
  if (d.burning <= 0) d.burning = 1.6;
  return true;
}

/** Per-tick environmental updates: burning spreads scorch; paper slowly dries. */
export function tickDamage(d: Damage, dt: number): void {
  if (d.burning > 0) {
    d.burning = Math.max(0, d.burning - dt);
    d.scorch = Math.min(1, d.scorch + dt * 0.55);
  }
  if (d.soak > 0) d.soak = Math.max(0, d.soak - dt * 0.01);
}
