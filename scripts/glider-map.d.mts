/** Types for the parts of glider-map.mjs the tests use. */

import type { GPObject, GPRoom } from './glider/house.mjs';

type Interval = [number, number];

/** What a link names: the room (null when missing), its key, and the object (null when missing). */
export interface GPLink {
  room: GPRoom | null;
  key: string | null;
  target: GPObject | null;
}

/** Overlapping or touching intervals merged, in order. */
export function merge(intervals: Interval[]): Interval[];

/** What is left of `intervals` once `cuts` are taken out, the pieces at least `min` long. */
export function subtract(intervals: Interval[], cuts: Interval[], min?: number): Interval[];

/** Where a room's invisible obstacles wall off its edges (GP px): y ranges at the sides, x ranges at the floor and ceiling. */
export function obstacleWalls(room: Pick<GPRoom, 'objects'>): { left: Interval[]; right: Interval[]; up: Interval[]; down: Interval[] };

/** What a switch flips (a trigger: what the switch it fires flips), or null. */
export function flipped(ob: GPObject, link: (ob: GPObject) => GPLink | null): GPLink | null;
