/** Types for convert-glider-houses.mjs (used by the tests). */

import type { Resource } from './glider/binhex.mjs';
import type { GPHouse } from './glider/house.mjs';

/** Convert a decoded house into a Classic House level (LevelDef + meta), as written to src/world/classic/houses. */
export function convertHouse(
  name: string,
  house: GPHouse,
  rsrc: Record<string, Resource[] | { id: number; data: ArrayLike<number> }[]>,
  file?: string,
  pictures?: Record<string, unknown> | null,
): Record<string, unknown>;

/** What each room looks like in the original, in a few numbers ({ [room index]: summary }). */
export function pictureSummary(house: GPHouse, rsrc: Record<string, Resource[]>, builtin?: Record<string, Resource[]>): Record<string, unknown>;
