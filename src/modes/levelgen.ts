/** Level generation facade for the roguelike and the daily. */

import type { LevelDef } from '../game/level';
import { dailySeed } from '../core/rng';
import { fallbackFloor, type FloorOptions, type ThemeId, type TwistId } from '../world/procgen/fallback';

export type { FloorOptions, ThemeId, TwistId };

export function generateFloorLevel(opts: FloorOptions): LevelDef {
  return fallbackFloor(opts);
}

export function themeFor(floor: number): ThemeId {
  return Math.floor(floor / 2) % 2 === 0 ? 'home' : 'cottage';
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

const TWIST_ORDER: TwistId[] = ['none', 'tissue', 'cardstock', 'lights-out', 'windy', 'heavy-nose', 'fold-budget', 'night', 'gusty', 'one-sheet'];

export function dailyPlan(key: string): FloorOptions & { twist: TwistId } {
  const seed = dailySeed(key);
  const twist = TWIST_ORDER[seed % TWIST_ORDER.length];
  return { seed, floor: 3, theme: seed % 3 === 0 ? 'cottage' : 'home', rooms: 6, twist };
}
