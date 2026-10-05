/**
 * Level clear: a two-bar fanfare (F -> G -> C) that follows the `win` sound effect's arpeggio. Not looping.
 */

import type { SongDef } from '../notation';
import { DRUMS, DRUM_KEYS, chordVoices, comp } from './kit';

const chords = chordVoices({ wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.45, r: 0.3 }, vol: 0.18, arpSpeed: 0.03, pan: -0.2 });

export const clear: SongDef = {
  title: 'Level clear',
  bpm: 132,
  stepsPerBeat: 4,
  loop: false,
  volume: 0.85,

  instruments: {
    lead: { wave: 'pulse25', env: { a: 0, d: 0.1, s: 0.65, r: 0.3 }, vol: 0.45, vibrato: { depth: 0.22, rate: 6, delay: 0.2 } },
    harmony: { wave: 'pulse50', env: { a: 0, d: 0.1, s: 0.55, r: 0.3 }, vol: 0.2, pan: 0.3 },
    bass: { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.25 }, vol: 0.8 },
    ...chords.instruments,
    ...DRUMS,
  },

  tracks: { melody: 'lead', harmony: 'harmony', low: 'bass', ...chords.tracks, beat: DRUM_KEYS },

  patterns: {
    A: {
      melody: ['A5 - - - | A5 - C6 - | B5 - - - | B5 - D6 -', 'C6! - - - | G5 - C6 - | E6~ - - - | - - - .'],
      harmony: ['F5 - - - | F5 - A5 - | G5 - - - | G5 - B5 -', 'E5 - - - | E5 - G5 - | C6 - - - | - - - .'],
      low: ['F2 - - - | F2 - - - | G2 - - - | G2 - - -', 'C2 - - - | - - - - | C3 - - - | - - - .'],
      ...comp(['F G', 'C'], 'x - x - x - x - x - x - x - x -'),
      beat: ['k . s . | k . s . | k . s . | t t l l', 'kc . . . | . . . . | k . . . | . . . .'],
    },
  },

  order: ['A'],
};
