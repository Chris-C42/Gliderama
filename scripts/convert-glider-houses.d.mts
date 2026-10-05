/** Types for convert-glider-houses.mjs (used by the tests). */

import type { Resource } from './glider/binhex.mjs';
import type { GPHouse } from './glider/house.mjs';

/** Convert a decoded house into a Classic House level (LevelDef + meta), as written to src/world/classic/houses. */
export function convertHouse(
  name: string,
  house: GPHouse,
  rsrc: Record<string, Resource[] | { id: number; data: ArrayLike<number> }[]>,
  file?: string,
): Record<string, unknown>;
