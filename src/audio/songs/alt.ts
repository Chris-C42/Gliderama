/**
 * A second, moodier loop (A minor, 96 bpm): something to crossfade to from the demo song.
 * Chords: Am  F  C  Em, with open-fifth arpeggios so that one instrument fits every chord.
 */

import type { SongDef } from '../notation';

export const alt: SongDef = {
  title: 'Night lights',
  bpm: 96,
  stepsPerBeat: 4,
  loop: true,
  volume: 0.76,

  instruments: {
    lead: { wave: 'pulse50', env: { a: 0.005, d: 0.12, s: 0.55, r: 0.15 }, vol: 0.34, vibrato: { depth: 0.25, rate: 5.5, delay: 0.2 } },
    bass: { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.04 }, vol: 0.85 },
    arp: { wave: 'pulse12', env: { a: 0, d: 0.14, s: 0.3, r: 0.06 }, vol: 0.17, arp: [0, 7, 12, 7], arpSpeed: 0.035, pan: -0.25 },
    kick: { wave: 'triangle', pitchEnv: { from: 30, to: -10, time: 0.07 }, env: { a: 0, d: 0.14, s: 0, r: 0 }, vol: 0.9 },
    snare: { wave: 'noise', env: { a: 0, d: 0.15, s: 0, r: 0 }, vol: 0.42, filter: { type: 'highpass', freq: 900 } },
    hat: { wave: 'noise-short', env: { a: 0, d: 0.03, s: 0, r: 0 }, vol: 0.16, noiseRate: 4 },
  },

  tracks: {
    melody: 'lead',
    low: 'bass',
    harmony: 'arp',
    beat: { k: 'kick', s: 'snare', h: 'hat' },
  },

  patterns: {
    A: {
      melody: [
        'E5 - - - | A5 - - - | G5 - E5 - | C5 - - -', // Am
        'F5 - - - | A5 - - - | G5 - F5 - | C5 - - -', // F
        'E5 - - - | G5 - - - | E5 - D5 - | C5 - - -', // C
        'B4 - - - | E5 - - - | G5~ - - - | E5 - - .', // Em
      ],
      low: [
        'A2 - A2 - | A2 - A2 - | E3 - E3 - | A2 - A2 -',
        'F2 - F2 - | F2 - F2 - | C3 - C3 - | F2 - F2 -',
        'C2 - C2 - | C2 - C2 - | G2 - G2 - | C2 - C2 -',
        'E2 - E2 - | E2 - E2 - | B2 - B2 - | E2 - G2 -',
      ],
      harmony: [
        'A3 - - - | A3 - - - | A3 - - - | A3 - - -',
        'F3 - - - | F3 - - - | F3 - - - | F3 - - -',
        'C4 - - - | C4 - - - | C4 - - - | C4 - - -',
        'E3 - - - | E3 - - - | E3 - - - | E3 - - -',
      ],
      beat: [
        'kh . h . | sh . h . | kh . kh . | sh . h .',
        'kh . h . | sh . h . | kh . kh . | sh . h .',
        'kh . h . | sh . h . | kh . kh . | sh . h .',
        'kh . h . | sh . h . | kh . kh . | s! s s! s',
      ],
    },
  },

  order: ['A'],
};
