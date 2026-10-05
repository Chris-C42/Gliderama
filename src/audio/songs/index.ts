/** All songs shipped with the audio module (tests compile every one of them). */

import type { SongDef } from '../notation';
import { alt } from './alt';
import { demo } from './demo';
import { jingle } from './jingle';

export { alt, demo, jingle };

export const songs: Record<string, SongDef> = { demo, alt, jingle };
