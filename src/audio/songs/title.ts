/**
 * "Paper Skies": the main theme (title, campaign map, menus). D major, 112 bpm.
 *
 * The hook is a throw and a glide: the melody climbs an arpeggio (the launch), then floats back down
 * on legato glides (`>`). Form: intro (once) -> A -> B -> A with an echo channel, looping to A.
 */

import type { SongDef } from '../notation';
import { DRUMS, DRUM_KEYS, chordVoices, comp, echo } from './kit';

const strum = 'x - - x - - x - x - - x - - x -';
const halves = 'x - - - - - - - x - - - - - - -';

const chords = chordVoices({ wave: 'pulse12', env: { a: 0, d: 0.12, s: 0.4, r: 0.06 }, vol: 0.15, arpSpeed: 0.035, pan: -0.2 });

const A_CHORDS = ['D', 'A', 'Bm', 'G', 'D', 'A', 'G', 'A'];
const B_CHORDS = ['Bm', 'G', 'D', 'A', 'Bm', 'G', 'Em', 'A'];

const A_MELODY = [
  'D5 - F#5 - | A5 - - - | D6 - - - | C#6 - B5 -', // D    the throw: up the arpeggio
  'A5 - - - | - - E5 - | C#5 - E5 - | A5 - G5 -', // A
  'F#5 - - - | - - D5 - | B4 - - - | D5 - F#5 -', // Bm
  'G5 - - - | B4 - D5 - | G5 - - - | F#5 - E5 -', // G
  'D5 - F#5 - | A5 - - - | D6 - - - | C#6 - D6 -', // D    higher this time...
  'E6 - - - | - - - - | C#6> - - - | A5> - - -', // A    ...and the glide down
  'B5 - - - | A5 - G5 - | F#5 - - - | E5 - D5 -', // G
  'E5 - - - | - - - - | A4 - C#5 - | E5 - - .', // A
];

const A_BASS = [
  'D2 - D3 - | D2 - D3 - | D2 - D3 - | A2 - D3 -',
  'A1 - A2 - | A1 - A2 - | A1 - A2 - | E2 - A2 -',
  'B1 - B2 - | B1 - B2 - | B1 - B2 - | F#2 - B2 -',
  'G1 - G2 - | G1 - G2 - | G1 - G2 - | D2 - G2 -',
  'D2 - D3 - | D2 - D3 - | D2 - D3 - | A2 - D3 -',
  'A1 - A2 - | A1 - A2 - | A1 - A2 - | E2 - A2 -',
  'G1 - G2 - | G1 - G2 - | G1 - G2 - | D2 - G2 -',
  'A1 - A2 - | A1 - A2 - | E2 - A2 - | C#3 - A2 -',
];

const A_BEAT = [
  'k . h . | s . h . | k . h k | s . h .',
  'k . h . | s . h . | k . h k | s . h o',
  'k . h . | s . h . | k . h k | s . h .',
  'k . h . | s . h . | k . h k | s . t t',
  'k . h . | s . h . | k . h k | s . h .',
  'k . h . | s . h . | k . h k | s . h o',
  'k . h . | s . h . | k . h k | s . h .',
  'k . h . | s . h . | k . t t | s! s l l',
];

export const title: SongDef = {
  title: 'Paper Skies',
  bpm: 112,
  stepsPerBeat: 4,
  loop: true,
  loopStart: 1,
  volume: 0.85,

  instruments: {
    lead: { wave: 'pulse25', env: { a: 0, d: 0.1, s: 0.65, r: 0.12 }, vol: 0.42, vibrato: { depth: 0.18, rate: 5.5, delay: 0.2 }, glide: 0.14 },
    echo: { wave: 'pulse25', env: { a: 0, d: 0.1, s: 0.6, r: 0.12 }, vol: 0.15, pan: 0.45, vibrato: { depth: 0.18, rate: 5.5, delay: 0.2 }, glide: 0.14 },
    counter: { wave: 'pulse50', env: { a: 0.02, d: 0.15, s: 0.5, r: 0.2 }, vol: 0.18, pan: -0.3, vibrato: { depth: 0.2, rate: 5, delay: 0.3 } },
    bass: { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.03 }, vol: 0.72 },
    ...chords.instruments,
    ...DRUMS,
  },

  tracks: { melody: 'lead', echo: 'echo', counter: 'counter', low: 'bass', ...chords.tracks, beat: DRUM_KEYS },

  patterns: {
    intro: {
      low: ['D2 - - - | - - - - | D2 - - - | - - D3 -', 'A1 - - - | - - - - | A1 - - - | E2 - A2 -'],
      ...comp(['D', 'A'], 'x - - - x - - - x - - - x - - -'),
      beat: ['h . h . | h . h . | h . h . | h . h .', 'h . h . | h . h . | s . s . | s s s! s!'],
    },

    A: { melody: A_MELODY, low: A_BASS, ...comp(A_CHORDS, strum), beat: A_BEAT },

    B: {
      melody: [
        'F#5 - - - | - - - - | B5 - - - | - - A5 -', // Bm
        'G5 - - - | - - - - | D5 - - - | E5 - G5 -', // G
        'F#5 - - - | - - - - | A5 - - - | - - F#5 -', // D
        'E5 - - - | - - - - | - - - - | C#5 - E5 -', // A
        'F#5 - - - | - - - - | B5 - - - | C#6 - D6 -', // Bm
        'D6 - - - | - - B5 - | G5 - - - | B5 - D6 -', // G
        'E6 - - - | - - D6 - | B5 - - - | D6 - - -', // Em
        'E6~ - - - | - - - - | C#6> - - - | A5> - - .', // A   the glide again, back into A
      ],
      counter: [
        'B4 - - - | - - - - | D5 - - - | - - - -',
        'B4 - - - | - - - - | - - - - | - - - -',
        'A4 - - - | - - - - | D5 - - - | - - - -',
        'C#5 - - - | - - - - | A4 - - - | - - - -',
        'D5 - - - | - - - - | F#5 - - - | - - - -',
        'G5 - - - | - - - - | D5 - - - | - - - -',
        'G5 - - - | - - - - | E5 - - - | - - - -',
        'C#5~ - - - | - - - - | E5 - - - | - - - .',
      ],
      low: [
        'B1 - - - | - - - - | F#2 - - - | - - - -',
        'G1 - - - | - - - - | D2 - - - | - - - -',
        'D2 - - - | - - - - | A2 - - - | - - - -',
        'A1 - - - | - - - - | E2 - - - | - - - -',
        'B1 - - - | - - - - | F#2 - - - | B2 - - -',
        'G1 - - - | - - - - | D2 - - - | G2 - - -',
        'E2 - - - | - - - - | B2 - - - | E2 - - -',
        'A1 - - - | - - - - | E2 - - - | C#2 - - -',
      ],
      ...comp(B_CHORDS, halves),
      beat: [
        'k . h . | . . h . | s . h . | . . h .',
        'k . h . | . . h . | s . h . | . . h k',
        'k . h . | . . h . | s . h . | . . h .',
        'k . h . | . . h . | s . h . | . . h o',
        'k . h . | . . h . | s . h . | . . h .',
        'k . h . | . . h . | s . h . | . . h k',
        'k . h . | . . h . | s . h . | . . h .',
        'k . h . | s . h . | s . s . | s s s! s!',
      ],
    },

    A2: { melody: A_MELODY, echo: echo(A_MELODY, 3), low: A_BASS, ...comp(A_CHORDS, strum), beat: A_BEAT },
  },

  order: ['intro', 'A', 'B', 'A2'],
};
