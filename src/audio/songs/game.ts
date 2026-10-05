/** The game soundtrack: one track per screen or mode (see app/audio.ts for which plays where). */

import type { SongDef } from '../notation';
import { clear } from './clear';
import { daily } from './daily';
import { hangar } from './hangar';
import { home } from './home';
import { puzzle } from './puzzle';
import { title } from './title';
import { trail } from './trail';
import { workshop } from './workshop';

export const TRACKS = { title, workshop, home, hangar, trail, daily, puzzle, clear } satisfies Record<string, SongDef>;

export type TrackId = keyof typeof TRACKS;
