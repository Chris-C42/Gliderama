/** Level generation facade for the roguelike and the daily. */

import type { LevelDef } from '../game/level';
import { dailyOptions, generateFloor, themeForFloor, type FloorOptions, type ThemeId, type TwistId } from '../world/procgen';
import { fallbackFloor } from '../world/procgen/fallback';

export type { FloorOptions, ThemeId, TwistId };

/** A procedurally built, flight-validated floor (the stitched fallback only if generation throws). */
export function generateFloorLevel(opts: FloorOptions): LevelDef {
  try {
    return generateFloor(opts);
  } catch (e) {
    console.warn('Floor generation failed, using the fallback house', e);
    return fallbackFloor(opts);
  }
}

export function themeFor(floor: number): ThemeId {
  return themeForFloor(floor);
}

export const TWISTS: Record<TwistId, { name: string; text: string }> = {
  none: { name: 'Fair skies', text: 'No twist today. Just you, your plane and the house.' },
  tissue: { name: 'Tissue Day', text: 'Only tissue paper today: feather-light and fragile.' },
  cardstock: { name: 'Heavy Paper Day', text: 'Cardstock only. Tough, heavy, punchy.' },
  'lights-out': { name: 'Power Cut', text: 'Every room is dark. Find the light switches!' },
  windy: { name: 'Windy Day', text: 'Fans everywhere. Mind the drafts.' },
  'heavy-nose': { name: 'Heavy Nose', text: 'Two paperclips are clipped to every plane.' },
  'fold-budget': { name: 'Minimalist', text: 'Five folds. Not one more.' },
  night: { name: 'Night Flight', text: 'The house after dark.' },
  gusty: { name: 'Gusty', text: 'The air moves more: every draft is 25% stronger.' },
  'one-sheet': { name: 'One Shot', text: 'A single sheet. No second chances.' },
};

export function dailyPlan(key: string): FloorOptions & { twist: TwistId } {
  return dailyOptions(key);
}
