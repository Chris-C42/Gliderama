/**
 * "Morning Post": the Daily Flight. C major, a swung shuffle (three steps per beat), 108 bpm.
 *
 * Long-short swing rhythms, a boom-chick bass and off-beat chords: a sunny paper-round feel that sets
 * the daily apart from the straight-time tracks. Form: A -> B -> A with echo, about 53 s.
 */

import type { SongDef } from '../notation';
import { DRUMS, DRUM_KEYS, chordVoices, comp, echo } from './kit';

const PER_BAR = 12;
const chords = chordVoices({ wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.25, r: 0.05 }, vol: 0.16, arpSpeed: 0.03, pan: -0.25 });
const chick = '. . . | x - . | . . . | x - .';
const halves = 'x - - | - - - | x - - | - - -';
const swing = (bars: string[]) => comp(bars, chick, { perBar: PER_BAR, group: 3 });

const A_CHORDS = ['C', 'Am', 'F', 'G7', 'C', 'Am', 'Dm', 'G7'];
const B_CHORDS = ['F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'G7'];

const A_MELODY = [
  'E5 - G5 | C6 - - | B5 - G5 | E5 - -', // C
  'A5 - - | G5 - E5 | C5 - - | - - -', // Am
  'F5 - A5 | C6 - - | A5 - F5 | C5 - -', // F
  'D5 - E5 | F5 - - | G5 - - | - - -', // G7
  'E5 - G5 | C6 - - | B5 - G5 | E5 - D5', // C
  'C5 - - | E5 - - | A5 - - | G5 - E5', // Am
  'F5 - - | A5 - - | D6 - C6 | A5 - F5', // Dm
  'G5 - - | - - - | B4 - D5 | F5 - -', // G7
];
const A_BASS = [
  'C2 - - | G2 - - | C3 - - | G2 - -',
  'A1 - - | E2 - - | A2 - - | E2 - -',
  'F2 - - | C3 - - | F2 - - | C3 - -',
  'G2 - - | D3 - - | G2 - - | F2 - D2',
  'C2 - - | G2 - - | C3 - - | G2 - -',
  'A1 - - | E2 - - | A2 - - | E2 - -',
  'D2 - - | A2 - - | D3 - - | A2 - -',
  'G2 - - | D3 - - | G2 - - | F2 - D2',
];
const A_BEAT = [
  'k . h | s . h | k . h | s . h',
  'k . h | s . h | k k h | s . h',
  'k . h | s . h | k . h | s . h',
  'k . h | s . h | k k h | s . o',
  'k . h | s . h | k . h | s . h',
  'k . h | s . h | k k h | s . h',
  'k . h | s . h | k . h | s . h',
  'k . h | s . h | t . t | l s! s',
];

export const daily: SongDef = {
  title: 'Morning Post',
  bpm: 108,
  stepsPerBeat: 3,
  loop: true,
  volume: 0.72,

  instruments: {
    lead: { wave: 'pulse25', env: { a: 0, d: 0.12, s: 0.5, r: 0.08 }, vol: 0.4, vibrato: { depth: 0.15, rate: 6, delay: 0.2 } },
    echo: { wave: 'pulse25', env: { a: 0, d: 0.12, s: 0.45, r: 0.08 }, vol: 0.14, pan: 0.45 },
    bass: { wave: 'triangle', env: { a: 0, d: 0.12, s: 0.6, r: 0.03 }, vol: 0.75 },
    ...chords.instruments,
    ...DRUMS,
  },

  tracks: { melody: 'lead', echo: 'echo', low: 'bass', ...chords.tracks, beat: DRUM_KEYS },

  patterns: {
    A: { melody: A_MELODY, low: A_BASS, ...swing(A_CHORDS), beat: A_BEAT },
    B: {
      melody: [
        'A5 - - | - - G5 | F5 - - | C5 - -', // F
        'D5 - - | - - B4 | G4 - - | B4 - D5', // G
        'E5 - - | - - D5 | B4 - - | G4 - -', // Em
        'A4 - - | C5 - - | E5 - - | A5 - -', // Am
        'F5 - - | - - E5 | D5 - - | A4 - -', // Dm
        'B4 - - | D5 - - | G5 - - | F5 - D5', // G
        'E5 - - | - - - | G5 - - | C6 - -', // C
        'B5~ - - | - - - | - - - | . . .', // G7
      ],
      low: [
        'F2 - - | C3 - - | F2 - - | A2 - -',
        'G2 - - | D3 - - | G2 - - | B2 - -',
        'E2 - - | B2 - - | E2 - - | G2 - -',
        'A1 - - | E2 - - | A2 - - | C3 - -',
        'D2 - - | A2 - - | D3 - - | F2 - -',
        'G2 - - | D3 - - | G2 - - | B2 - -',
        'C2 - - | G2 - - | C3 - - | E2 - -',
        'G2 - - | F2 - - | D2 - - | B1 - -',
      ],
      ...comp(B_CHORDS, halves, { perBar: PER_BAR, group: 3 }),
      beat: [
        'k . x | s . x | k . x | s . x',
        'k . x | s . x | k . x | s . x',
        'k . x | s . x | k . x | s . x',
        'k . x | s . x | k . x | s . o',
        'k . x | s . x | k . x | s . x',
        'k . x | s . x | k . x | s . x',
        'k . x | s . x | k . x | s . x',
        'k . h | s . h | s . s | s! s s!',
      ],
    },
    A2: { melody: A_MELODY, echo: echo(A_MELODY, 2, PER_BAR, 3), low: A_BASS, ...swing(A_CHORDS), beat: A_BEAT },
  },

  order: ['A', 'B', 'A2'],
};
