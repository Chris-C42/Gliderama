/**
 * "Test Flight": the Test Hangar. A dorian, 104 bpm, cool and methodical.
 *
 * A thin pulse "computer" runs sixteenth-note arpeggios like instruments ticking over, the bass locks
 * into an ostinato, and the tune is radio blips that open into a longer line in B.
 * Form: A (no tune, once) -> A -> B -> A -> B.
 */

import type { SongDef } from '../notation';
import { DRUMS, DRUM_KEYS, chordVoices, comp } from './kit';

const pad = chordVoices({ wave: 'pulse75', env: { a: 0.15, d: 0, s: 1, r: 0.3 }, vol: 0.07, arpSpeed: 0.04, pan: -0.3 });
const whole = 'x - - - - - - - - - - - - - - -';

const RUN: Record<string, string> = {
  Am7: 'A3 C4 E4 G4 | A4 G4 E4 C4 | A3 C4 E4 G4 | A4 G4 E4 C4',
  D7: 'D4 F#4 A4 C5 | D5 C5 A4 F#4 | D4 F#4 A4 C5 | D5 C5 A4 F#4',
  Fmaj7: 'F3 A3 C4 E4 | F4 E4 C4 A3 | F3 A3 C4 E4 | F4 E4 C4 A3',
  G7: 'G3 B3 D4 F4 | G4 F4 D4 B3 | G3 B3 D4 F4 | G4 F4 D4 B3',
  Em7: 'E3 G3 B3 D4 | E4 D4 B3 G3 | E3 G3 B3 D4 | E4 D4 B3 G3',
};
const OSTINATO: Record<string, string> = {
  Am7: 'A1 . A2 . | A1 A1 A2 . | A1 . A2 . | G2 . E2 .',
  D7: 'D2 . D3 . | D2 D2 D3 . | D2 . D3 . | C3 . A2 .',
  Fmaj7: 'F2 . F3 . | F2 F2 F3 . | F2 . F3 . | E3 . C3 .',
  G7: 'G2 . G3 . | G2 G2 G3 . | G2 . G3 . | F3 . D3 .',
  Em7: 'E2 . E3 . | E2 E2 E3 . | E2 . E3 . | D3 . B2 .',
};

const A_PROG = ['Am7', 'D7', 'Am7', 'D7'];
const B_PROG = ['Fmaj7', 'G7', 'Em7', 'Am7'];

const BEAT = ['k . h . | s . h . | k k h . | s . h .', 'k . h . | s . h . | k k h . | s . h .', 'k . h . | s . h . | k k h . | s . h .', 'k . h . | s . h . | k k h . | s . h o'];

export const hangar: SongDef = {
  title: 'Test Flight',
  bpm: 104,
  stepsPerBeat: 4,
  loop: true,
  loopStart: 1,
  volume: 0.75,

  instruments: {
    blip: { wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.3, r: 0.05 }, vol: 0.33, vibrato: { depth: 0.1, rate: 7, delay: 0.25 } },
    lead: { wave: 'pulse25', env: { a: 0.005, d: 0.15, s: 0.55, r: 0.12 }, vol: 0.34, vibrato: { depth: 0.15, rate: 5.5, delay: 0.2 } },
    computer: { wave: 'pulse12', env: { a: 0, d: 0.06, s: 0.2, r: 0.03 }, vol: 0.12, pan: 0.35 },
    bass: { wave: 'triangle', env: { a: 0, d: 0.1, s: 0.7, r: 0.03 }, vol: 0.75 },
    ...pad.instruments,
    ...DRUMS,
  },

  tracks: { blip: 'blip', melody: 'lead', computer: 'computer', low: 'bass', ...pad.tracks, beat: DRUM_KEYS },

  patterns: {
    A0: {
      computer: A_PROG.map((c) => RUN[c]),
      low: A_PROG.map((c) => OSTINATO[c]),
      beat: ['h . h . | h . h . | h . h . | h . h .', 'h . h . | h . h . | h . h . | h . h .', 'k . h . | k . h . | k . h . | k . h .', 'k . h . | k . h . | k . s . | s s s! s!'],
    },
    A: {
      blip: [
        'E5 . . . | . . A5 . | G5 . E5 . | . . . .',
        'F#5 . . . | . . E5 . | D5 . . . | . . . .',
        'E5 . . . | . . A5 . | B5 . C6 . | B5 . A5 .',
        'F#5 - - - | - - - - | . . . . | . . . .',
      ],
      computer: A_PROG.map((c) => RUN[c]),
      low: A_PROG.map((c) => OSTINATO[c]),
      ...comp(['Am7', 'D', 'Am7', 'D'], whole),
      beat: BEAT,
    },
    B: {
      melody: [
        'A5 - - - | G5 - - - | E5 - - - | C5 - - -',
        'D5 - - - | - - G5 - | B5 - - - | - - - -',
        'G5 - - - | - - E5 - | D5 - - - | B4 - - -',
        'C5 - - - | - - - - | E5 - - - | - - - .',
      ],
      computer: B_PROG.map((c) => RUN[c]),
      low: B_PROG.map((c) => OSTINATO[c]),
      ...comp(['Fmaj7', 'G', 'Em7', 'Am7'], whole),
      beat: BEAT,
    },
  },

  order: ['A0', 'A', 'B', 'A', 'B'],
};
