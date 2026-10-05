/**
 * The Classic Houses: John Calhoun's Glider PRO houses (GNU GPL v2), converted to Gliderama levels by
 * scripts/convert-glider-houses.mjs. The catalog (names, credits, sizes) is part of the app; each house's rooms
 * are a separate chunk loaded when the house is played (see vite.config.ts for how they are cached).
 */

import type { LevelDef } from '../../game/level';
import catalog from './catalog.json';

export interface ClassicStatus {
  /** The bot pilot collected every star (tests/helpers/houseSolver.ts). */
  flyable: boolean;
  /** How far it got. */
  reached?: string;
  note?: string;
  /** Seconds for the Swift medal. */
  par?: number;
  /** Sheets the bot pilot lost on the way (the house gives half as many again, and a few). */
  lost?: number;
}

export interface ClassicHouse {
  slug: string;
  /** Level id (`classic-<slug>`). */
  id: string;
  name: string;
  authors: string[];
  /** Credit line, or null when the Glider PRO release does not credit the house. */
  credit: string | null;
  rooms: number;
  stars: number;
  goal: 'stars' | 'none';
  blurb: string | null;
  status: ClassicStatus;
}

/** What the converter kept about the original house (see docs/classic-houses.md). */
export interface ClassicMeta {
  original: string;
  file: string;
  source: string;
  authors: string[];
  credit: string | null;
  creditSource: string;
  rooms: number;
  roomsConverted: number;
  stars: number;
  pickups: number;
  objects: { total: number; mapped: number; dropped: number };
  /** "type: why" → count. */
  dropped: Record<string, number>;
  approximated: Record<string, number>;
  /** Glider PRO object types Gliderama has no art for yet → count. */
  missingArt: Record<string, number>;
  notes: string[];
  status: ClassicStatus;
}

export type ClassicLevel = LevelDef & { meta: ClassicMeta };

export const CLASSIC_HOUSES = catalog as ClassicHouse[];

const houses = import.meta.glob<{ default: ClassicLevel }>('./houses/*.json');

/** The house's credit as shown in the game. */
export function classicCredit(h: Pick<ClassicHouse, 'credit'>): string {
  return h.credit ? `by ${h.credit}` : 'author not credited in the Glider PRO release';
}

/** Load a house's level (a fresh copy each time: sessions may adjust their level). */
export async function loadClassicHouse(slug: string): Promise<ClassicLevel> {
  const load = houses[`./houses/${slug}.json`];
  if (!load) throw new Error(`No classic house "${slug}"`);
  const mod = await load();
  return structuredClone(mod.default);
}
