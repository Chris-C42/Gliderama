/**
 * "Bedroom Breeze": the Home levels. G major, 120 bpm, light on its feet.
 *
 * A bouncy staccato tune over a root-fifth bass and off-beat chord strums (a chip ukulele), a smoother
 * B section, and a melody-free interlude where a music-box bell plays alone so the rooms can breathe.
 * Form: A -> B -> A -> interlude, about 64 s.
 */

import type { SongDef } from '../notation';
import { DRUMS, DRUM_KEYS, chordVoices, comp } from './kit';

const uke = chordVoices({ wave: 'pulse12', env: { a: 0, d: 0.09, s: 0.15, r: 0.04 }, vol: 0.16, arpSpeed: 0.025, pan: -0.25 });
const offbeats = '. . x . . . x . . . x . . . x .';
const sway = 'x - - - - - x - - - x - - - - -';

const A_CHORDS = ['G', 'Em', 'C', 'D', 'G', 'Em', 'Am', 'D'];
const B_CHORDS = ['C', 'D', 'Bm', 'Em', 'C', 'D', 'Am', 'D'];

const BOUNCE: Record<string, string> = {
  G: 'G2 . D3 . | G2 . D3 . | G2 . D3 . | B2 . D3 .',
  Em: 'E2 . B2 . | E2 . B2 . | E2 . B2 . | G2 . B2 .',
  C: 'C3 . G2 . | C3 . G2 . | C3 . G2 . | E2 . G2 .',
  D: 'D2 . A2 . | D2 . A2 . | D2 . A2 . | F#2 . A2 .',
  Am: 'A2 . E2 . | A2 . E2 . | A2 . E2 . | C3 . E2 .',
};
const LONG: Record<string, string> = {
  C: 'C2 - - - | - - - - | G2 - - - | - - - -',
  D: 'D2 - - - | - - - - | A2 - - - | - - - -',
  Bm: 'B1 - - - | - - - - | F#2 - - - | - - - -',
  Em: 'E2 - - - | - - - - | B2 - - - | - - - -',
  Am: 'A1 - - - | - - - - | E2 - - - | - - - -',
};

const A_BEAT = [
  'k . h . | s . h h | k . h . | s . h .',
  'k . h . | s . h h | k . h . | s . h .',
  'k . h . | s . h h | k . h . | s . h .',
  'k . h . | s . h h | k . h . | s . h o',
  'k . h . | s . h h | k . h . | s . h .',
  'k . h . | s . h h | k . h . | s . h .',
  'k . h . | s . h h | k . h . | s . h .',
  'k . h . | s . h h | k . t t | l l s! .',
];

export const home: SongDef = {
  title: 'Bedroom Breeze',
  bpm: 120,
  stepsPerBeat: 4,
  loop: true,
  volume: 0.72,

  instruments: {
    lead: { wave: 'pulse25', env: { a: 0, d: 0.12, s: 0.35, r: 0.06 }, vol: 0.4, vibrato: { depth: 0.15, rate: 6, delay: 0.2 } },
    song: { wave: 'pulse50', env: { a: 0.01, d: 0.15, s: 0.6, r: 0.15 }, vol: 0.28, vibrato: { depth: 0.2, rate: 5.5, delay: 0.22 } },
    bell: { wave: 'triangle', env: { a: 0, d: 0.45, s: 0, r: 0.1 }, vol: 0.32, pan: 0.2 },
    bass: { wave: 'triangle', env: { a: 0, d: 0.15, s: 0.45, r: 0.03 }, vol: 0.75 },
    longBass: { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.05 }, vol: 0.7 },
    ...uke.instruments,
    ...DRUMS,
  },

  tracks: { melody: 'lead', song: 'song', bell: 'bell', low: 'bass', long: 'longBass', ...uke.tracks, beat: DRUM_KEYS },

  patterns: {
    A: {
      melody: [
        'G5 . D5 . | B4 . D5 . | G5 - A5 . | B5 - - .', // G
        'A5 . G5 . | E5 - - . | G5 . E5 . | B4 - - .', // Em
        'C5 . E5 . | G5 . E5 . | C6 - B5 . | A5 - G5 .', // C
        'F#5 - - . | A5 - - . | D5 - - - | - - - .', // D
        'G5 . D5 . | B4 . D5 . | G5 - A5 . | B5 - - .', // G
        'B5 . A5 . | G5 - - . | E5 . G5 . | B5 - - .', // Em
        'A5 . G5 . | E5 . C5 . | A4 - B4 . | C5 - E5 .', // Am
        'D5 - - - | F#5 - - - | A5 - - . | F#5 . D5 .', // D
      ],
      low: A_CHORDS.map((c) => BOUNCE[c]),
      ...comp(A_CHORDS, offbeats),
      beat: A_BEAT,
    },

    B: {
      song: [
        'E5 - - - | G5 - - - | C6 - - - | B5 - A5 -', // C
        'F#5 - - - | - - - - | D5 - E5 - | F#5 - A5 -', // D
        'B5 - - - | - - A5 - | F#5 - - - | D5 - - -', // Bm
        'E5 - - - | - - - - | G5 - - - | B5 - - -', // Em
        'C6 - - - | B5 - A5 - | G5 - - - | E5 - G5 -', // C
        'A5 - - - | - - - - | F#5 - - - | D5 - - -', // D
        'C5 - - - | E5 - - - | A5 - - - | G5 - E5 -', // Am
        'F#5~ - - - | - - - - | - - - - | . . . .', // D
      ],
      long: B_CHORDS.map((c) => LONG[c]),
      ...comp(B_CHORDS, sway),
      beat: [
        'k . x . | s . x . | k . x k | s . x .',
        'k . x . | s . x . | k . x k | s . x .',
        'k . x . | s . x . | k . x k | s . x .',
        'k . x . | s . x . | k . x k | s . x o',
        'k . x . | s . x . | k . x k | s . x .',
        'k . x . | s . x . | k . x k | s . x .',
        'k . x . | s . x . | k . x k | s . x .',
        'k . x . | s . x . | k . t t | s! s s! s',
      ],
    },

    // interlude: no tune, a music-box bell over the A accompaniment
    I: {
      bell: [
        'B5 . . . | . . . . | D6 . . . | . . . .',
        'G5 . . . | . . . . | B5 . . . | . . . .',
        'E6 . . . | . . . . | C6 . . . | . . . .',
        'A5 . . . | . . . . | F#5 . . . | . . . .',
        'B5 . . . | . . . . | D6 . . . | . . G6 .',
        'E6 . . . | . . . . | B5 . . . | . . . .',
        'C6 . . . | . . . . | A5 . . . | . . E6 .',
        'D6 . . . | . . . . | F#6 . . . | A5 . . .',
      ],
      low: A_CHORDS.map((c) => BOUNCE[c]),
      ...comp(A_CHORDS, offbeats),
      beat: [
        'k . . . | r . . . | k . . . | r . . .',
        'k . . . | r . . . | k . . . | r . . .',
        'k . . . | r . . . | k . . . | r . . .',
        'k . . . | r . . . | k . . . | r . . h',
        'k . . . | r . . . | k . . . | r . . .',
        'k . . . | r . . . | k . . . | r . . .',
        'k . . . | r . . . | k . . . | r . . .',
        'k . . . | r . . . | k . t t | s! s s! s',
      ],
    },
  },

  order: ['A', 'B', 'A', 'I'],
};
