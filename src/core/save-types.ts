import type { Design } from '../paper/design';
import type { Settings } from './types';

/** Per-level campaign record. `stamp` is the hidden stamp collectible. */
export interface LevelProgress {
  completed: boolean;
  medals: { escape: boolean; allStars: boolean; pristine: boolean; swift: boolean };
  bestTime: number | null;
  bestStars: number;
  stamp: boolean;
}

/** One finished Daily Flight attempt. `official` = the single scored attempt; the rest are practice. */
export interface DailyResult {
  score: number;
  roomsCleared: number;
  roomsTotal: number;
  stars: number;
  starsTotal: number;
  timeSec: number;
  damagePct: number;
  roomResults: ('clear' | 'damaged' | 'crash' | 'skip')[];
  practiceRuns: number;
  official: boolean;
}

/**
 * Everything the game persists (localStorage key `gliderama.save.v1`, see core/storage.ts).
 * Additive changes (new optional-with-default fields) need no version bump: loading deep-merges defaults.
 * Anything else needs `version` bumped and a migration registered in storage.ts.
 */
export interface SaveData {
  version: 1;
  designs: Design[];
  activeDesignId: string | null;
  settings: Settings;
  progress: {
    campaign: Record<string, LevelProgress>;
    unlocks: { folds: string[]; papers: string[]; gadgets: string[]; cosmetics: string[]; recipes: string[] };
    challenges: Record<string, { stars: number; bestFolds: number | null; bestTime: number | null }>;
    roguelike: { bestScore: number; bestFloor: number; runs: number; totalStars: number };
    daily: Record<string, DailyResult>;
    stats: { flights: number; crashes: number; stars: number; roomsFlown: number; foldsMade: number; playTimeSec: number };
  };
  seen: Record<string, boolean>;
}
