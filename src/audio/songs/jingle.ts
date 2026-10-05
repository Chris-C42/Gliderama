/**
 * A short non-looping stinger (about 3.6 s): `loop: false`. `playMusic(jingle, { onEnd })` tells you when
 * it has finished, e.g. to bring the level music back.
 */

import type { SongDef } from '../notation';

export const jingle: SongDef = {
  title: 'Level complete',
  bpm: 132,
  stepsPerBeat: 4,
  loop: false,
  volume: 0.9,

  instruments: {
    lead: { wave: 'pulse25', env: { a: 0, d: 0.1, s: 0.6, r: 0.25 }, vol: 0.5, vibrato: { depth: 0.2, rate: 6, delay: 0.25 } },
    bass: { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.2 }, vol: 0.85 },
    arp: { wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.4, r: 0.3 }, vol: 0.2, arp: [0, 4, 7], arpSpeed: 0.03 },
  },

  tracks: { melody: 'lead', low: 'bass', harmony: 'arp' },

  patterns: {
    A: {
      melody: [
        'C5 - E5 - | G5 - E5 - | C6 - B5 - | G5 - - -',
        'C6! - - - | - - - - | - - - - | - - - .',
      ],
      low: [
        'C3 - - - | C3 - - - | G2 - - - | G2 - - -',
        'C3 - - - | - - - - | - - - - | - - - -',
      ],
      harmony: [
        'C4 - - - | C4 - - - | G3 - - - | G3 - - -',
        'C4 - - - | - - - - | - - - - | - - - -',
      ],
    },
  },

  order: ['A'],
};
