/**
 * Demo song: exercises every feature of the notation. Use it as a template.
 *
 * Form (120 bpm, 16 steps per bar):  intro (plays once) -> A x2 -> B -> B (melody up an octave) -> A in G
 * and then back to the first A (`loopStart: 1`). About 44 s, the loop part is 40 s.
 *
 * Features used (search for the marker to find an example):
 *   waves        every wave: pulse12 pulse25 pulse50 pulse75 triangle noise noise-short
 *   instruments  vibrato (auto, delayed) / vibrato with auto:false (only on ~ notes) / arp / pitchEnv / pan /
 *                filter / noiseRate / pitch (drum base note) / glide + slide times
 *   tokens       notes  sharps/flats (see 'Bb')  -  hold   .  rest   |  bar line   !  accent   ~  vibrato
 *                ^  slide up into the note   v  slide down into it   >  glide (legato) from the previous note
 *   drums        one letter per hit, several in one step ('kh'), '!' accent
 *   structure    patterns that leave tracks out (intro), bars as an array of strings, order entries with
 *                { transpose } (a number, or per track) and { times }, loopStart
 */

import type { SongDef } from '../notation';

export const demo: SongDef = {
  title: 'Gliderama demo',
  bpm: 120,
  stepsPerBeat: 4,
  loop: true,
  loopStart: 1, // the intro plays once, the loop jumps back to order[1]
  volume: 0.85,

  instruments: {
    // --- melodic ---------------------------------------------------------------------------
    // Lead: pulse 25 %. Every note gets a gentle vibrato that fades in after 0.15 s (so only long notes wobble).
    lead: { wave: 'pulse25', env: { a: 0, d: 0.08, s: 0.6, r: 0.1 }, vol: 0.5, vibrato: { depth: 0.2, rate: 6, delay: 0.15 }, glide: 0.08, slide: 0.06 },
    // Second voice: pulse 50 %, panned right. Vibrato only where a note is marked with ~ (auto: false).
    lead2: { wave: 'pulse50', env: { a: 0.005, d: 0.1, s: 0.5, r: 0.08 }, vol: 0.26, vibrato: { depth: 0.3, rate: 5.5, auto: false }, pan: 0.35 },
    // Triangle bass (4-bit stepped, like the NES).
    bass: { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.03 }, vol: 0.7 },
    // Chiptune chords: one note in, a [root, third, fifth] arpeggio out, cycling every 30 ms.
    arp: { wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.35, r: 0.05 }, vol: 0.2, arp: [0, 4, 7], arpSpeed: 0.03, pan: -0.3 },
    arpMin: { wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.35, r: 0.05 }, vol: 0.2, arp: [0, 3, 7], arpSpeed: 0.03, pan: -0.3 },
    // Pad: pulse 75 % with a slow attack.
    pad: { wave: 'pulse75', env: { a: 0.05, d: 0, s: 1, r: 0.25 }, vol: 0.14, pan: -0.35 },

    // --- drums -----------------------------------------------------------------------------
    // Kick: a triangle whose pitch falls from F#4 to D1 in 70 ms (offsets are relative to the base note C2).
    kick: { wave: 'triangle', pitchEnv: { from: 30, to: -10, time: 0.07 }, env: { a: 0, d: 0.14, s: 0, r: 0 }, vol: 0.85 },
    // Snare: white-ish noise with the low end filtered away.
    snare: { wave: 'noise', env: { a: 0, d: 0.13, s: 0, r: 0 }, vol: 0.5, noiseRate: 1, filter: { type: 'highpass', freq: 900 } },
    // Hats: the 93-step "metallic" noise at a high rate.
    hat: { wave: 'noise-short', env: { a: 0, d: 0.035, s: 0, r: 0 }, vol: 0.2, noiseRate: 4 },
    openHat: { wave: 'noise-short', env: { a: 0, d: 0.14, s: 0, r: 0 }, vol: 0.16, noiseRate: 4 },
    // Tom: tonal drum with its own base pitch (G2) and a short downward sweep.
    tom: { wave: 'triangle', pitch: 'G2', pitchEnv: { from: 7, to: -5, time: 0.12 }, env: { a: 0, d: 0.2, s: 0, r: 0 }, vol: 0.8 },
  },

  // A track is either an instrument name (pitched) or a { letter: instrument } map (drums).
  tracks: {
    melody: 'lead',
    lead2: 'lead2',
    low: 'bass',
    harmony: 'arp',
    harmonyMin: 'arpMin',
    pad: 'pad',
    beat: { k: 'kick', s: 'snare', h: 'hat', o: 'openHat', t: 'tom' },
  },

  patterns: {
    // Intro: only low / harmony / beat are written, so the other tracks are silent. Bars are an array of
    // strings (one per bar) so that JS comments can sit between them.
    intro: {
      low: [
        'C2 - - - | - - - - | C2 - - - | - - - -', // bar 1
        'G2 - - - | - - - - | G2 - - - | - - - -', // bar 2
      ],
      harmony: [
        'C4 - - - | C4 - - - | C4 - - - | C4 - - -',
        'G3 - - - | G3 - - - | G3 - - - | G3 - - -',
      ],
      beat: [
        'h . h . | h . h . | h . h . | h . h .',
        'kh . h . | h . h . | kh . h . | s! s s! s', // snare roll into the theme
      ],
    },

    // A: the theme. Chords: C  F  G  C.
    A: {
      melody: [
        'E5 - G5 - | C6 - - - | B5 - G5 - | E5 - - .', // C
        'F5 - A5 - | C6! - A5 - | G5 - F5 - | A5 - - .', // F   (! = accent: 30 % louder)
        'G5 - B5 - | D6 - - - | C6 - B5 - | G5 - - .', // G
        'E5 - G5> - | C6^ - - - | G5 - E5 - | C5~ - - -', // C   (> glides E5 into G5; ^ slides up into C6; ~ vibrato)
      ],
      lead2: [
        '. . . . | . . . . | . . . . | . . . .', // silent for two bars ...
        '. . . . | . . . . | . . . . | . . . .',
        'D5 - G5 - | B5 - - - | A5 - G5 - | D5 - - .', // ... then a counter-line
        'G4 - - - | E5 - - - | C5 - - - | E5~ - - -', // ~ turns the manual vibrato on
      ],
      low: [
        'C2 - C3 - | C2 - C3 - | C2 - C3 - | C2 - G2 -',
        'F2 - F3 - | F2 - F3 - | F2 - F3 - | F2 - C3 -',
        'G2 - G3 - | G2 - G3 - | G2 - G3 - | G2 - B2 -',
        'C2 - C3 - | C2 - C3 - | C2 - G2 - | C2 - - -',
      ],
      harmony: [
        'C4 - - - | C4 - - - | C4 - - - | C4 - - -', // one note = a whole major chord, restarted every beat
        'F3 - - - | F3 - - - | F3 - - - | F3 - - -',
        'G3 - - - | G3 - - - | G3 - - - | G3 - - -',
        'C4 - - - | C4 - - - | C4 - - - | C4 - - -',
      ],
      beat: [
        'kh . h . | s . h . | kh . h k | s . h o', // kh = kick and hat in the same step
        'kh . h . | s . h . | kh . h k | s . h o',
        'kh . h . | s . h . | kh . h k | s . h o',
        'kh . h . | s . h . | kh . t t | s! s s! s', // fill
      ],
    },

    // B: the contrast, in A minor. Chords: Am  F  C  G.
    B: {
      melody: [
        'A4 - - - | C5^ - - - | E5 - - - | D5 - C5 -', // Am
        'A4 - - - | C5 - - - | F5v - - - | E5 - D5 -', // F   (v slides down into F5)
        'E5 - - G5 | E5 - C5 - | D5 - E5 - | C5~ - - -', // C
        'D5 - B4 - | G4 - B4 - | D5 - - - | B4^ - - .', // G
      ],
      lead2: [
        'E4 - - - | A4 - - - | C5 - - - | A4~ - - -',
        'F4 - - - | A4 - - - | C5~ - - - | C5 - A4 -',
        'G4 - - E5 | G4 - E4 - | F4 - G4 - | E4~ - - -',
        'B4 - G4 - | D4 - G4 - | B4 - - - | G4~ - - .',
      ],
      low: [
        'A2 - A3 - | A2 - A3 - | A2 - E3 - | A2 - C3 -',
        'F2 - F3 - | F2 - F3 - | F2 - C3 - | F2 - A2 -',
        'C2 - C3 - | C2 - C3 - | C2 - G2 - | C2 - E2 -',
        'G2 - G3 - | G2 - G3 - | G2 - D3 - | G2 - B2 -',
      ],
      // Two chord tracks because an instrument has one arp shape: arp = major, arpMin = minor.
      harmony: [
        '. . . . | . . . . | . . . . | . . . .',
        'F3 - - - | F3 - - - | F3 - - - | F3 - - -',
        'C4 - - - | C4 - - - | C4 - - - | C4 - - -',
        'G3 - - - | G3 - - - | G3 - - - | G3 - - -',
      ],
      harmonyMin: [
        'A3 - - - | A3 - - - | A3 - - - | A3 - - -',
        '. . . . | . . . . | . . . . | . . . .',
        '. . . . | . . . . | . . . . | . . . .',
        '. . . . | . . . . | . . . . | . . . .',
      ],
      pad: [
        'E4 - - - | - - - - | - - - - | - - - -', // a held note, tied across the bar lines
        'A4 - - - | - - - - | - - - - | - - - -',
        'G4 - - - | - - - - | - - - - | - - - -',
        'D4 - - - | - - - - | - - - - | - - - -',
      ],
      beat: [
        'kh . . h | s . h . | k . h . | s! . h o',
        'kh . . h | s . h . | k . h . | s! . h o',
        'kh . . h | s . h . | k . h . | s! . h o',
        'kh . . h | s . h . | k . h k | s! s s! s',
      ],
    },
  },

  order: [
    'intro', // 0: plays once
    { p: 'A', times: 2 }, // 1: the loop starts here; times: 2 plays the pattern twice
    'B', // 2
    { p: 'B', transpose: { melody: 12, lead2: 12 } }, // 3: same pattern, the two lead voices an octave up
    { p: 'A', transpose: 7 }, // 4: the theme in G major; it ends on a C chord, which leads back into A
  ],
};
