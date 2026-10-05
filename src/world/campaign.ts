/** Campaign: a journey of places, each a short series of levels with unlocks. */

import type { LevelDef } from '../game/level';
import { HOME_LEVELS } from './levels/home';
import { COTTAGE_LEVELS } from './levels/cottage';

export type UnlockKind = 'recipes' | 'folds' | 'papers' | 'gadgets' | 'cosmetics';

export interface Unlock {
  kind: UnlockKind;
  id: string;
  label: string;
}

export interface CampaignLevel {
  id: string;
  name: string;
  blurb: string;
  build: () => LevelDef;
  unlocks: Unlock[];
}

export interface PlaceDef {
  id: string;
  name: string;
  blurb: string;
  color: string;
  icon: string;
  levels: CampaignLevel[];
  comingSoon?: boolean;
}

export const PLACES: PlaceDef[] = [
  {
    id: 'home',
    name: 'Home',
    blurb: 'Up past bedtime. The paper plane wants out.',
    color: '#b8d0ea',
    icon: 'home',
    levels: HOME_LEVELS,
  },
  {
    id: 'cottage',
    name: "Grandma's Cottage",
    blurb: 'Candles, kettles, knitting — and a very curious cat.',
    color: '#f6c9cc',
    icon: 'flame',
    levels: COTTAGE_LEVELS,
  },
  { id: 'school', name: 'School', blurb: 'Hallways, classrooms and a gymnasium of drafts.', color: '#f0d470', icon: 'sheet', levels: [], comingSoon: true },
  { id: 'office', name: 'Office Tower', blurb: 'Shredders, desk fans and lift shafts.', color: '#c8e8d0', icon: 'chart', levels: [], comingSoon: true },
  { id: 'museum', name: 'Museum of Flight', blurb: 'Fly with the greats.', color: '#ceb0d6', icon: 'trophy', levels: [], comingSoon: true },
  { id: 'sky', name: 'Rooftops & Sky', blurb: 'The open air at last.', color: '#96c2e4', icon: 'balloon', levels: [], comingSoon: true },
];

export function allLevels(): CampaignLevel[] {
  return PLACES.flatMap((p) => p.levels);
}

export function levelById(id: string): CampaignLevel | undefined {
  return allLevels().find((l) => l.id === id);
}

/** A level is open if it's the first, or the previous level in the journey is completed. */
export function isLevelOpen(id: string, completed: (id: string) => boolean): boolean {
  const all = allLevels();
  const i = all.findIndex((l) => l.id === id);
  if (i <= 0) return i === 0;
  return completed(all[i - 1].id);
}
