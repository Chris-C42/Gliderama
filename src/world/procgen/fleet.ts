/**
 * The reference planes the generator validates against: the two extremes of the starter recipes. The glider floats
 * (shallow glide, slow); the dart is quick and sinks faster. Analysing a design takes a few ms, so it is done once.
 */

import { analyzeDesign, type AeroModel } from '../../paper/aero';
import { buildMesh, type PlaneMesh } from '../../paper/build';
import { RECIPES } from '../../paper/recipes';
import { PHYS } from '../../physics/config';
import type { RefPlaneId } from './types';

export interface RefPlane {
  id: RefPlaneId;
  aero: AeroModel;
  mesh: PlaneMesh;
  /** Hands-off trim speed (m/s) the pilot holds. */
  vTrim: number;
  /** Below this airspeed (m/s) the pilot pushes the nose down. */
  vLow: number;
  /** Throw power (0..1) that launches at the trim speed. */
  power: number;
}

let fleet: RefPlane[] | null = null;

/** Throw power giving a launch speed of `v` m/s for this design. */
export function powerForSpeed(aero: AeroModel, v: number): number {
  const p = (v / aero.perf.vBest - PHYS.throwMin) / (PHYS.throwMax - PHYS.throwMin);
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

export function referencePlanes(): RefPlane[] {
  if (fleet) return fleet;
  fleet = (['glider', 'dart'] as const).map((id) => {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) throw new Error(`procgen: recipe '${id}' is missing`);
    const { build, aero } = analyzeDesign(recipe.make());
    const vTrim = aero.perf.trim?.v ?? aero.perf.vBest;
    return { id, aero, mesh: buildMesh(build, aero.cg), vTrim, vLow: aero.perf.vStall * 1.2, power: powerForSpeed(aero, vTrim) };
  });
  return fleet;
}
