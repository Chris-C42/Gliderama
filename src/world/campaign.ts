/** Campaign: a journey of places, each a short series of levels with unlocks. */

import type { LevelDef } from '../game/level';
import { HOME_LEVELS } from './levels/home';
import { COTTAGE_LEVELS } from './levels/cottage';
import { CLASSIC_HOUSES, classicCredit, loadClassicHouse } from './classic';

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
  /** Build a hand-built level. */
  build?: () => LevelDef;
  /** Load a level kept as data (the Classic Houses), when there is no `build`. */
  load?: () => Promise<LevelDef>;
  unlocks: Unlock[];
}

/** A level of the journey proper: hand built, opened by finishing the one before. */
export type JourneyLevel = CampaignLevel & { build: () => LevelDef };

export interface PlaceDef {
  id: string;
  name: string;
  blurb: string;
  color: string;
  icon: string;
  levels: CampaignLevel[];
  comingSoon?: boolean;
  /** Every level is open from the start, outside the journey's order (the Classic Houses). */
  open?: boolean;
}

/** Glider PRO's houses, as in the original: all of them open from the start. */
const CLASSIC_LEVELS: CampaignLevel[] = CLASSIC_HOUSES.map((h) => ({
  id: h.id,
  name: h.name,
  blurb: `${classicCredit(h)} · ${h.rooms} room${h.rooms === 1 ? '' : 's'}${h.goal === 'none' ? ' · no stars: free flight' : ''}`,
  load: () => loadClassicHouse(h.slug),
  unlocks: [],
}));

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
  {
    id: 'classic',
    name: 'Classic Houses',
    blurb: "John Calhoun's Glider PRO houses and their authors' (GPL v2). Find every star to finish a house.",
    color: '#e8dcc0',
    icon: 'star',
    levels: CLASSIC_LEVELS,
    open: true,
  },
];

export function allLevels(): CampaignLevel[] {
  return PLACES.flatMap((p) => p.levels);
}

/** The journey's hand-built levels, in order. */
export function journeyLevels(): JourneyLevel[] {
  return PLACES.filter((p) => !p.open).flatMap((p) => p.levels.filter((l): l is JourneyLevel => !!l.build));
}

export function levelById(id: string): CampaignLevel | undefined {
  return allLevels().find((l) => l.id === id);
}

/** The level itself, built or loaded. */
export function loadLevel(cl: CampaignLevel): Promise<LevelDef> {
  if (cl.build) return Promise.resolve(cl.build());
  if (cl.load) return cl.load();
  return Promise.reject(new Error(`Level ${cl.id} has no content`));
}

/** A level is open if its place is open, or it's the first, or the previous level in the journey is completed. */
export function isLevelOpen(id: string, completed: (id: string) => boolean): boolean {
  if (PLACES.some((p) => p.open && p.levels.some((l) => l.id === id))) return true;
  const all = journeyLevels();
  const i = all.findIndex((l) => l.id === id);
  if (i <= 0) return i === 0;
  return completed(all[i - 1].id);
}
