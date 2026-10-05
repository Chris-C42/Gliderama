/**
 * "Crease Lines": the fold workshop. F major, 86 bpm, unhurried.
 *
 * A plucked "harp" plays the broken chords (written out as real notes, not chip arps), a soft pulse sings
 * long phrases with room to think between them, and a quiet pad shimmers underneath. Seventh chords
 * throughout. Form: A without drums -> B -> A -> B, about 90 s before it repeats.
 */

import type { SongDef } from '../notation';
import { DRUMS, DRUM_KEYS, chordVoices, comp } from './kit';

const pad = chordVoices({ wave: 'pulse75', env: { a: 0.12, d: 0.3, s: 0.5, r: 0.4 }, vol: 0.075, arpSpeed: 0.06, pan: 0.3 });
const whole = 'x - - - - - - - - - - - - - - -';

// broken chords, eighth notes
const H = {
  Fmaj7: 'F3 . A3 . | C4 . E4 . | A4 . E4 . | C4 . A3 .',
  Am7: 'A3 . C4 . | E4 . G4 . | C5 . G4 . | E4 . C4 .',
  Bbmaj7: 'Bb3 . D4 . | F4 . A4 . | F4 . D4 . | A3 . F3 .',
  C7sus: 'C4 . F4 . | G4 . Bb4 . | G4 . F4 . | C4 . G3 .',
  Gm7: 'G3 . Bb3 . | D4 . F4 . | Bb4 . F4 . | D4 . Bb3 .',
  Dm7: 'D3 . F3 . | A3 . C4 . | F4 . C4 . | A3 . F3 .',
};
const BASS = {
  Fmaj7: 'F2 - - - | - - - - | C3 - - - | - - - -',
  Am7: 'A2 - - - | - - - - | E2 - - - | - - G2 -',
  Bbmaj7: 'Bb1 - - - | - - - - | F2 - - - | - - - -',
  C7sus: 'C2 - - - | - - - - | G2 - - - | Bb2 - - -',
  Gm7: 'G2 - - - | - - - - | D2 - - - | - - F2 -',
  Dm7: 'D2 - - - | - - - - | A2 - - - | - - C3 -',
};

const A_PROG = ['Fmaj7', 'Am7', 'Bbmaj7', 'C7sus', 'Fmaj7', 'Am7', 'Gm7', 'C7sus'] as const;
const B_PROG = ['Dm7', 'Am7', 'Bbmaj7', 'Fmaj7', 'Gm7', 'Am7', 'Bbmaj7', 'C7sus'] as const;

const A_MELODY = [
  '. . . . | . . . . | A4 - C5 - | E5 - - -',
  '- - - - | D5 - C5 - | A4 - - - | - - - -',
  '. . . . | . . F4 - | A4 - C5 - | D5 - - -',
  '- - - - | C5 - - - | Bb4 - - - | - - - -',
  '. . . . | . . . . | A4 - C5 - | F5 - - -',
  '- - - - | E5 - - - | G5 - - - | E5 - C5 -',
  'D5 - - - | - - - - | Bb4 - - - | A4 - G4 -',
  'F4 - - - | - - - - | - - - - | . . . .',
];
const B_MELODY = [
  'F5 - - - | - - E5 - | D5 - - - | A4 - - -',
  'C5 - - - | - - - - | E5 - - - | - - - -',
  'D5 - - - | - - C5 - | Bb4 - - - | F4 - - -',
  'A4 - - - | - - - - | - - - - | . . C5 -',
  'D5 - - - | - - - - | F5 - - - | - - D5 -',
  'E5 - - - | - - - - | C5 - - - | - - A4 -',
  'F5 - - - | - - E5 - | D5 - - - | - - C5 -',
  'C5~ - - - | - - - - | - - - - | . . . .',
];

const BEAT = [
  'k . x . | r . x . | k . x k | r . x .',
  'k . x . | r . x . | k . x . | r . x x',
  'k . x . | r . x . | k . x k | r . x .',
  'k . x . | r . x . | k . x . | r . r r',
  'k . x . | r . x . | k . x k | r . x .',
  'k . x . | r . x . | k . x . | r . x x',
  'k . x . | r . x . | k . x k | r . x .',
  'k . x . | r . x . | k . . . | . . . .',
];

const chords = (prog: readonly string[]) => comp([...prog], whole);

export const workshop: SongDef = {
  title: 'Crease Lines',
  bpm: 86,
  stepsPerBeat: 4,
  loop: true,
  volume: 0.8,

  instruments: {
    lead: { wave: 'pulse50', env: { a: 0.012, d: 0.25, s: 0.45, r: 0.25 }, vol: 0.27, vibrato: { depth: 0.15, rate: 5, delay: 0.3 } },
    harp: { wave: 'pulse12', env: { a: 0, d: 0.32, s: 0, r: 0.1 }, vol: 0.2, pan: -0.25 },
    bass: { wave: 'triangle', env: { a: 0, d: 0.4, s: 0.6, r: 0.08 }, vol: 0.65 },
    ...pad.instruments,
    ...DRUMS,
    kick: { ...DRUMS.kick, vol: 0.55 },
  },

  tracks: { melody: 'lead', harp: 'harp', low: 'bass', ...pad.tracks, beat: DRUM_KEYS },

  patterns: {
    A0: { melody: A_MELODY, harp: A_PROG.map((c) => H[c]), low: A_PROG.map((c) => BASS[c]), ...chords(A_PROG) },
    A: { melody: A_MELODY, harp: A_PROG.map((c) => H[c]), low: A_PROG.map((c) => BASS[c]), ...chords(A_PROG), beat: BEAT },
    B: { melody: B_MELODY, harp: B_PROG.map((c) => H[c]), low: B_PROG.map((c) => BASS[c]), ...chords(B_PROG), beat: BEAT },
  },

  order: ['A0', 'B', 'A', 'B'],
};
