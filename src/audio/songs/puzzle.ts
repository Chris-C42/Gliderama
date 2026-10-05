/**
 * "Brain Teaser": the Challenges. D dorian, 96 bpm, curious.
 *
 * A plucked staccato tune with a ping-pong echo, a walking pizzicato bass and off-beat seventh chords:
 * thinking music that never gets in the way. B is the "eureka" lift through B-flat and C.
 * Form: A -> B -> A with echo -> B, 80 s.
 */

import type { SongDef } from '../notation';
import { DRUMS, DRUM_KEYS, chordVoices, comp, echo } from './kit';

const chords = chordVoices({ wave: 'pulse50', env: { a: 0, d: 0.08, s: 0.2, r: 0.04 }, vol: 0.11, arpSpeed: 0.03, pan: -0.3 });
const offbeats = '. . x . . . x . . . x . . . x .';

const WALK: Record<string, string> = {
  Dm7: 'D2 . . . | F2 . . . | A2 . . . | C3 . . .',
  G7: 'G2 . . . | B2 . . . | D3 . . . | B2 . . .',
  Fmaj7: 'F2 . . . | A2 . . . | C3 . . . | E3 . . .',
  Em7: 'E2 . . . | G2 . . . | B2 . . . | D3 . . .',
  G: 'G2 . . . | B2 . . . | D3 . . . | B2 . . .',
  A7: 'A2 . . . | C#3 . . . | E3 . . . | G3 . . .',
  Bbmaj7: 'Bb1 . . . | D2 . . . | F2 . . . | A2 . . .',
  C: 'C2 . . . | E2 . . . | G2 . . . | Bb2 . . .',
  Am7: 'A1 . . . | C2 . . . | E2 . . . | G2 . . .',
  Gm7: 'G2 . . . | Bb2 . . . | D3 . . . | F3 . . .',
  C7: 'C3 . . . | Bb2 . . . | G2 . . . | E2 . . .',
  A7end: 'A2 . . . | G2 . . . | E2 . . . | C#2 . . .',
};

const A_PROG = ['Dm7', 'G7', 'Dm7', 'G7', 'Fmaj7', 'Em7', 'G', 'A7'];
const B_PROG = ['Bbmaj7', 'C', 'Am7', 'Dm7', 'Gm7', 'C7', 'Fmaj7', 'A7'];

const A_MELODY = [
  'D5 . F5 . | A5 . . . | G5 . F5 . | D5 . . .', // Dm7
  'B4 . D5 . | F5 . . . | E5 . D5 . | B4 . . .', // G7
  'D5 . F5 . | A5 . C6 . | B5 . A5 . | F5 . . .', // Dm7
  'G5 - - . | F5 - - . | D5 . . . | . . . .', // G7
  'A5 . C6 . | E6 - - . | C6 . A5 . | F5 . . .', // Fmaj7
  'G5 . B5 . | D6 - - . | B5 . G5 . | E5 . . .', // Em7
  'D5 . G5 . | B5 . D6 . | . . B5 . | G5 . . .', // G
  'C#6 - - . | A5 . G5 . | E5 . C#5 . | A4 . . .', // A7
];
const B_MELODY = [
  'F5 . A5 . | D6 . . . | C6 . A5 . | F5 . . .', // Bbmaj7
  'E5 . G5 . | C6 . . . | Bb5 . G5 . | E5 . . .', // C
  'C6 . . . | B5 . A5 . | G5 . E5 . | C5 . . .', // Am7
  'D5 . F5 . | A5 . . . | C6 . . . | . . . .', // Dm7
  'Bb5 . . . | A5 . G5 . | F5 . D5 . | Bb4 . . .', // Gm7
  'C5 . E5 . | G5 . Bb5 . | . . G5 . | E5 . . .', // C7
  'F5 . A5 . | C6 . E6 . | . . C6 . | A5 . . .', // Fmaj7
  'G5 . . . | E5 . . . | C#5 . . . | A4 . . .', // A7
];

const BEAT = [
  'k . x . | r . x . | k . x k | r . x .',
  'k . x . | r . x . | k . x . | r . x x',
  'k . x . | r . x . | k . x k | r . x .',
  'k . x . | r . x . | k . x . | r . r r',
  'k . x . | r . x . | k . x k | r . x .',
  'k . x . | r . x . | k . x . | r . x x',
  'k . x . | r . x . | k . x k | r . x .',
  'k . x . | r . x . | k . t . | t . l .',
];

export const puzzle: SongDef = {
  title: 'Brain Teaser',
  bpm: 96,
  stepsPerBeat: 4,
  loop: true,
  volume: 0.75,

  instruments: {
    pluck: { wave: 'pulse12', env: { a: 0, d: 0.16, s: 0, r: 0.05 }, vol: 0.4 },
    echo: { wave: 'pulse12', env: { a: 0, d: 0.16, s: 0, r: 0.05 }, vol: 0.14, pan: 0.5 },
    bass: { wave: 'triangle', env: { a: 0, d: 0.22, s: 0.3, r: 0.04 }, vol: 0.78 },
    ...chords.instruments,
    ...DRUMS,
    kick: { ...DRUMS.kick, vol: 0.6 },
  },

  tracks: { melody: 'pluck', echo: 'echo', low: 'bass', ...chords.tracks, beat: DRUM_KEYS },

  patterns: {
    A: { melody: A_MELODY, low: A_PROG.map((c) => WALK[c]), ...comp(A_PROG, offbeats), beat: BEAT },
    B: { melody: B_MELODY, low: B_PROG.map((c, i) => WALK[i === 7 ? 'A7end' : c]), ...comp(B_PROG, offbeats), beat: BEAT },
    A2: { melody: A_MELODY, echo: echo(A_MELODY, 2), low: A_PROG.map((c) => WALK[c]), ...comp(A_PROG, offbeats), beat: BEAT },
  },

  order: ['A', 'B', 'A2', 'B'],
};
