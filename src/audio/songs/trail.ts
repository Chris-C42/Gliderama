/**
 * "Paper Trail": the endless roguelike, hub and floors alike. E minor, 138 bpm, adventurous.
 *
 * A galloping triangle bass drives a heroic pulse tune; B lifts to the relative major and adds a second
 * voice in thirds; the B-major dominant pulls every phrase home. Form: intro (once) -> A -> B -> A with echo.
 */

import type { SongDef } from '../notation';
import { DRUMS, DRUM_KEYS, chordVoices, comp, echo } from './kit';

const chords = chordVoices({ wave: 'pulse12', env: { a: 0, d: 0.15, s: 0.45, r: 0.06 }, vol: 0.15, arpSpeed: 0.03, pan: -0.3 });
const push = 'x - - - - - x - - - x - - - - -';

/** Gallop on a chord root: low and high octave (MIDI-style names). */
const gallop = (lo: string, hi: string, end = `${hi} - ${lo} ${lo}`) => `${lo} - ${lo} ${lo} | ${hi} - ${lo} ${lo} | ${lo} - ${lo} ${lo} | ${end}`;
const G: Record<string, string> = {
  Em: gallop('E2', 'E3'),
  C: gallop('C2', 'C3'),
  G: gallop('G2', 'G3'),
  D: gallop('D2', 'D3'),
  Am: gallop('A1', 'A2'),
  Bm: gallop('B1', 'B2'),
  B: gallop('B1', 'B2', 'B2 - A2 F#2'),
};

const A_CHORDS = ['Em', 'C', 'G', 'D', 'Em', 'C', 'Am', 'B'];
const B_CHORDS = ['C', 'D', 'Bm', 'Em', 'C', 'D', 'B', 'B7'];

const A_MELODY = [
  'E5 - - - | B4 - E5 - | G5 - - - | F#5 - E5 -', // Em
  'G5 - - - | - - A5 - | G5 - E5 - | C5 - - -', // C
  'D5 - - - | G5 - - - | B5 - - - | A5 - G5 -', // G
  'F#5 - - - | - - - - | D5 - E5 - | F#5 - - -', // D
  'E5 - - - | B4 - E5 - | G5 - - - | B5 - - -', // Em
  'C6 - - - | B5 - A5 - | G5 - - - | E5 - - -', // C
  'A5 - - - | - - G5 - | F#5 - - - | E5 - F#5 -', // Am
  'D#5 - - - | - - - - | F#5 - - - | B5 - - -', // B
];

const A_BEAT = [
  'k . h . | s . h k | k . h . | s . h .',
  'k . h . | s . h k | k . h . | s . h o',
  'k . h . | s . h k | k . h . | s . h .',
  'k . h . | s . h k | k . h . | s . t t',
  'k . h . | s . h k | k . h . | s . h .',
  'k . h . | s . h k | k . h . | s . h o',
  'k . h . | s . h k | k . h . | s . h .',
  'k . s . | s . s s | t t l l | s! s! s! s!',
];

export const trail: SongDef = {
  title: 'Paper Trail',
  bpm: 138,
  stepsPerBeat: 4,
  loop: true,
  loopStart: 1,
  volume: 0.56,

  instruments: {
    lead: { wave: 'pulse25', env: { a: 0, d: 0.1, s: 0.7, r: 0.1 }, vol: 0.42, vibrato: { depth: 0.2, rate: 6, delay: 0.15 }, slide: 0.05 },
    echo: { wave: 'pulse25', env: { a: 0, d: 0.1, s: 0.6, r: 0.1 }, vol: 0.15, pan: 0.45, vibrato: { depth: 0.2, rate: 6, delay: 0.15 } },
    third: { wave: 'pulse50', env: { a: 0.005, d: 0.12, s: 0.55, r: 0.1 }, vol: 0.2, pan: 0.3, vibrato: { depth: 0.2, rate: 6, delay: 0.18 } },
    bass: { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.02 }, vol: 0.78 },
    ...chords.instruments,
    ...DRUMS,
  },

  tracks: { melody: 'lead', echo: 'echo', third: 'third', low: 'bass', ...chords.tracks, beat: DRUM_KEYS },

  patterns: {
    intro: {
      low: [G.Em, G.Em],
      beat: ['h . h . | h . h . | h . h . | h . h .', 'k . h . | k . h . | k . s . | s s s! s!'],
    },

    A: { melody: A_MELODY, low: A_CHORDS.map((c) => G[c]), ...comp(A_CHORDS, push), beat: A_BEAT },

    B: {
      melody: [
        'G5 - - - | - - - - | E5 - G5 - | C6 - - -', // C
        'A5 - - - | - - - - | F#5 - A5 - | D6 - - -', // D
        'B5 - - - | - - A5 - | F#5 - - - | D5 - - -', // Bm
        'E5 - - - | - - - - | G5 - - - | B5 - - -', // Em
        'C6 - - - | - - B5 - | A5 - - - | G5 - - -', // C
        'F#5 - - - | - - G5 - | A5 - - - | D6 - - -', // D
        'D#6 - - - | - - - - | B5 - - - | F#5 - - -', // B
        'D#5~ - - - | - - - - | F#5 - - - | A5 - - -', // B7
      ],
      third: [
        'E5 - - - | - - - - | C5 - E5 - | G5 - - -',
        'F#5 - - - | - - - - | D5 - F#5 - | A5 - - -',
        'F#5 - - - | - - F#5 - | D5 - - - | B4 - - -',
        'B4 - - - | - - - - | E5 - - - | G5 - - -',
        'G5 - - - | - - G5 - | E5 - - - | E5 - - -',
        'D5 - - - | - - E5 - | F#5 - - - | A5 - - -',
        'B5 - - - | - - - - | F#5 - - - | D#5 - - -',
        'B4 - - - | - - - - | D#5 - - - | F#5 - - -',
      ],
      low: B_CHORDS.map((c) => G[c === 'B7' ? 'B' : c]),
      ...comp(B_CHORDS, push),
      beat: [
        'k . h k | s . h k | k . h k | s . h o',
        'k . h k | s . h k | k . h k | s . h o',
        'k . h k | s . h k | k . h k | s . h o',
        'k . h k | s . h k | k . h k | s . t t',
        'k . h k | s . h k | k . h k | s . h o',
        'k . h k | s . h k | k . h k | s . h o',
        'k . h k | s . h k | k . h k | s . h o',
        'k . s . | s . s s | t t l l | s! s! s! s!',
      ],
    },

    A2: { melody: A_MELODY, echo: echo(A_MELODY, 3), low: A_CHORDS.map((c) => G[c]), ...comp(A_CHORDS, push), beat: A_BEAT },
  },

  order: ['intro', 'A', 'B', 'A2'],
};
