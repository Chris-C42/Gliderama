/**
 * PLACEHOLDER sound effects and loops. Tune freely: everything is plain data.
 *
 * Cheat sheet (full reference in README.md):
 *   wave      pulse12 pulse25 pulse50 pulse75 triangle noise noise-short sine saw
 *   freq      start Hz (noise waves: the noise clock; ~44100 = white, 8000 = darker, 1000 = rumble)
 *   endFreq   glide to this Hz over slideTime (default: duration); path: [[sec, Hz], ...] for a contour
 *   duration  gate length (seconds); env {a,d,s,r} linear ADSR; s: 0 = percussive (always plays its decay)
 *   vol       0..1 (default 0.5)       vibrato {depth (semitones), rate (Hz), delay}
 *   arp       { steps: [semitones], interval, mode: 'cycle' | 'once', retrigger }
 *   filter    { type: lowpass | highpass | bandpass, freq, endFreq?, time?, q? }
 *   repeat    { count, interval, volDecay?, pitchStep? }     jitter: random +- semitones
 *   layers    extra voices played together (each with its own delay)
 *   cooldown  min seconds between plays      maxVoices: simultaneous plays before the oldest is cut
 */

import type { LoopDef } from './loops';
import type { SfxDef } from './sfx-plan';

export const SFX_DEFS = {
  // ---- flight ------------------------------------------------------------------------------
  /** Slingshot release: a whoosh plus a falling "thwip". */
  throw: {
    gain: 1.6,
    wave: 'noise', freq: 20000, duration: 0.3, vol: 0.4,
    env: { a: 0.1, d: 0.2, s: 0, r: 0.02 },
    filter: { type: 'bandpass', freq: 700, endFreq: 2800, time: 0.25, q: 1.2 },
    layers: [{ wave: 'triangle', freq: 700, endFreq: 180, duration: 0.16, vol: 0.32, env: { a: 0.002, d: 0.16, s: 0, r: 0.01 } }],
    cooldown: 0.1,
  },
  /** Stall warning: three beeps. The game should call it repeatedly while stalling; the cooldown paces it. */
  stall: {
    gain: 2.5,
    wave: 'pulse50', freq: 900, duration: 0.07, vol: 0.3,
    env: { a: 0.002, d: 0, s: 1, r: 0.012 },
    repeat: { count: 3, interval: 0.13 },
    cooldown: 0.55, maxVoices: 1,
  },
  /** Turnaround swish. */
  turn: {
    gain: 1.6,
    wave: 'noise', freq: 20000, duration: 0.3, vol: 0.34,
    env: { a: 0.1, d: 0.2, s: 0, r: 0.02 },
    filter: { type: 'bandpass', freq: 800, endFreq: 2800, time: 0.3, q: 1.0 },
    layers: [{ wave: 'triangle', freq: 300, path: [[0.12, 520], [0.3, 280]], duration: 0.3, vol: 0.12, env: { a: 0.08, d: 0.2, s: 0, r: 0.02 } }],
    cooldown: 0.2, maxVoices: 2,
  },
  /** Gadget boost: rising whoosh. */
  boost: {
    gain: 1.55,
    wave: 'noise', freq: 18000, duration: 0.5, vol: 0.38,
    env: { a: 0.12, d: 0.38, s: 0, r: 0.02 },
    filter: { type: 'bandpass', freq: 400, endFreq: 3500, time: 0.45, q: 1.4 },
    layers: [{ wave: 'pulse25', freq: 220, endFreq: 880, slideCurve: 2, duration: 0.45, vol: 0.2, env: { a: 0.05, d: 0.4, s: 0, r: 0.02 } }],
    cooldown: 0.3, maxVoices: 2,
  },
  /** Teleport through a duct: thump + a falling "bwoop". */
  duct: {
    gain: 0.72,
    wave: 'noise', freq: 6000, duration: 0.4, vol: 0.4,
    env: { a: 0.02, d: 0.35, s: 0, r: 0 },
    filter: { type: 'lowpass', freq: 1200, endFreq: 250, time: 0.35 },
    layers: [
      { wave: 'triangle', freq: 120, endFreq: 60, duration: 0.3, vol: 0.6, env: { a: 0.005, d: 0.28, s: 0, r: 0.01 } },
      { wave: 'sine', freq: 300, path: [[0.15, 900], [0.4, 250]], duration: 0.4, vol: 0.18, env: { a: 0.02, d: 0.35, s: 0, r: 0.01 } },
    ],
    cooldown: 0.3, maxVoices: 2,
  },

  // ---- paper -------------------------------------------------------------------------------
  /** Crisp crease. */
  fold: {
    wave: 'noise', freq: 30000, duration: 0.07, vol: 0.42, jitter: 1.5,
    env: { a: 0.002, d: 0.06, s: 0, r: 0.01 },
    filter: { type: 'highpass', freq: 3500, endFreq: 6500, time: 0.06 },
    layers: [{ wave: 'pulse25', freq: 2400, endFreq: 1500, duration: 0.025, vol: 0.12, env: { a: 0.001, d: 0.025, s: 0, r: 0.005 } }],
    cooldown: 0.05,
  },
  /** Softer, opening version of the crease. */
  unfold: {
    gain: 1.75,
    wave: 'noise', freq: 30000, duration: 0.12, vol: 0.35, jitter: 1.5,
    env: { a: 0.04, d: 0.08, s: 0, r: 0.01 },
    filter: { type: 'bandpass', freq: 6000, endFreq: 2200, time: 0.1, q: 1.0 },
    layers: [{ wave: 'pulse25', freq: 1500, endFreq: 2200, duration: 0.03, vol: 0.08, delay: 0.09, env: { a: 0.001, d: 0.03, s: 0, r: 0.005 } }],
    cooldown: 0.05,
  },
  /** Crackly crumple: a burst of tiny noise pops. */
  crumple: {
    gain: 1.5,
    wave: 'noise', freq: 18000, duration: 0.035, vol: 0.45, jitter: 4,
    env: { a: 0.001, d: 0.03, s: 0, r: 0 },
    filter: { type: 'bandpass', freq: 3000, q: 0.9 },
    repeat: { count: 8, interval: 0.04, volDecay: 0.88 },
    cooldown: 0.15, maxVoices: 3,
  },
  /** Tape pickup: a rip and a blip. */
  tape: {
    gain: 1.4,
    wave: 'noise', freq: 14000, duration: 0.12, vol: 0.3,
    env: { a: 0.01, d: 0.1, s: 0, r: 0 },
    filter: { type: 'bandpass', freq: 1800, endFreq: 900, time: 0.12 },
    layers: [{ wave: 'triangle', freq: 440, endFreq: 880, duration: 0.1, vol: 0.35, delay: 0.1, env: { a: 0.002, d: 0.1, s: 0, r: 0.01 } }],
  },

  // ---- impacts and hazards -----------------------------------------------------------------
  /** Thud. Pass a `vol` scaled by the impact speed. */
  bump: {
    gain: 0.72,
    wave: 'triangle', freq: 190, endFreq: 55, slideTime: 0.14, duration: 0.14, vol: 0.8,
    env: { a: 0.001, d: 0.16, s: 0, r: 0.01 },
    layers: [{
      wave: 'noise', freq: 6000, duration: 0.08, vol: 0.35,
      env: { a: 0.001, d: 0.07, s: 0, r: 0 },
      filter: { type: 'lowpass', freq: 900, endFreq: 300, time: 0.08 },
    }],
    cooldown: 0.06, maxVoices: 4,
  },
  /** Catching fire: a "fwoosh" followed by crackles. */
  burn: {
    wave: 'noise', freq: 14000, duration: 0.5, vol: 0.45,
    env: { a: 0.06, d: 0.45, s: 0, r: 0.02 },
    filter: { type: 'bandpass', freq: 500, endFreq: 2500, time: 0.3, q: 0.8 },
    layers: [{
      wave: 'noise', freq: 30000, duration: 0.03, vol: 0.3, jitter: 6, delay: 0.08,
      env: { a: 0.001, d: 0.03, s: 0, r: 0 },
      filter: { type: 'highpass', freq: 2500 },
      repeat: { count: 9, interval: 0.05, volDecay: 0.92 },
    }],
    cooldown: 0.3, maxVoices: 2,
  },
  /** Water: noise burst with bubbly "bloops". */
  splash: {
    gain: 1.6,
    wave: 'noise', freq: 25000, duration: 0.35, vol: 0.4,
    env: { a: 0.005, d: 0.3, s: 0, r: 0.02 },
    filter: { type: 'bandpass', freq: 3200, endFreq: 700, time: 0.3, q: 0.9 },
    layers: [
      { wave: 'sine', freq: 600, endFreq: 1100, duration: 0.08, vol: 0.2, delay: 0.06, env: { a: 0.002, d: 0.08, s: 0, r: 0.005 } },
      { wave: 'sine', freq: 500, endFreq: 950, duration: 0.07, vol: 0.15, delay: 0.15, env: { a: 0.002, d: 0.07, s: 0, r: 0.005 } },
      { wave: 'sine', freq: 700, endFreq: 1300, duration: 0.06, vol: 0.12, delay: 0.24, env: { a: 0.002, d: 0.06, s: 0, r: 0.005 } },
    ],
    cooldown: 0.2, maxVoices: 2,
  },
  /** Balloon pop. */
  pop: {
    gain: 0.67,
    wave: 'noise', freq: 30000, duration: 0.07, vol: 0.55,
    env: { a: 0.0005, d: 0.07, s: 0, r: 0 },
    filter: { type: 'highpass', freq: 1500 },
    layers: [
      { wave: 'triangle', freq: 700, endFreq: 90, duration: 0.05, vol: 0.4, env: { a: 0.001, d: 0.05, s: 0, r: 0 } },
      { wave: 'noise', freq: 4000, duration: 0.12, vol: 0.25, delay: 0.02, env: { a: 0.001, d: 0.11, s: 0, r: 0 }, filter: { type: 'lowpass', freq: 1200 } },
    ],
    cooldown: 0.05,
  },
  /** A plucked rubber band (shooting one, or a cobweb snagging the plane): a short twanging glide. */
  twang: {
    gain: 1.2,
    wave: 'pulse25', freq: 220, endFreq: 150, slideTime: 0.25, duration: 0.28, vol: 0.32,
    env: { a: 0.001, d: 0.27, s: 0, r: 0.01 },
    vibrato: { depth: 0.6, rate: 22 },
    layers: [{ wave: 'triangle', freq: 440, endFreq: 300, duration: 0.2, vol: 0.18, env: { a: 0.001, d: 0.2, s: 0, r: 0.01 } }],
    cooldown: 0.12, maxVoices: 2,
  },
  /** Electric outlet sparking: a buzzy crackle. */
  zap: {
    gain: 1.1,
    wave: 'saw', freq: 120, duration: 0.18, vol: 0.28, jitter: 2,
    env: { a: 0.001, d: 0.06, s: 0.5, r: 0.03 },
    vibrato: { depth: 3, rate: 38 },
    layers: [{
      wave: 'noise', freq: 30000, duration: 0.02, vol: 0.3, jitter: 5,
      env: { a: 0.001, d: 0.02, s: 0, r: 0 },
      filter: { type: 'highpass', freq: 3000 },
      repeat: { count: 5, interval: 0.035, volDecay: 0.85 },
    }],
    cooldown: 0.15, maxVoices: 2,
  },
  /** Rubber ball bouncing: a hollow "bonk" that rises a little. */
  boing: {
    gain: 1,
    wave: 'sine', freq: 140, path: [[0.04, 260], [0.16, 200]],
    duration: 0.18, vol: 0.4,
    env: { a: 0.001, d: 0.17, s: 0, r: 0.01 },
    layers: [{ wave: 'triangle', freq: 280, endFreq: 420, duration: 0.06, vol: 0.12, env: { a: 0.001, d: 0.06, s: 0, r: 0 } }],
    cooldown: 0.08, maxVoices: 3,
  },
  /** Paper shredder chewing up the plane: a grinding motor and tearing paper. */
  shred: {
    gain: 1.3,
    wave: 'saw', freq: 70, duration: 0.9, vol: 0.3,
    env: { a: 0.01, d: 0.2, s: 0.7, r: 0.1 },
    vibrato: { depth: 0.8, rate: 18 },
    layers: [{
      wave: 'noise', freq: 16000, duration: 0.05, vol: 0.35, jitter: 3,
      env: { a: 0.001, d: 0.05, s: 0, r: 0 },
      filter: { type: 'bandpass', freq: 2400, q: 0.8 },
      repeat: { count: 14, interval: 0.06, volDecay: 0.95 },
    }],
    cooldown: 0.5, maxVoices: 1,
  },
  /** Something appearing or vanishing in a twinkle (enemies coming and going, as in Glider PRO). */
  sparkle: {
    gain: 0.8,
    wave: 'triangle', freq: 1568, duration: 0.24, vol: 0.12,
    env: { a: 0.002, d: 0.05, s: 0.3, r: 0.05 },
    arp: { steps: [0, 7, 12, 19], interval: 0.045, mode: 'once', retrigger: true },
    cooldown: 0.2, maxVoices: 2,
  },
  /** A guitar strummed by a passing wing: a quick downstroke of a G chord. */
  strum: {
    gain: 1,
    wave: 'pulse25', freq: 98, duration: 0.9, vol: 0.3,
    env: { a: 0.002, d: 0.7, s: 0, r: 0.1 },
    filter: { type: 'lowpass', freq: 2200, endFreq: 900, time: 0.8 },
    arp: { steps: [0, 4, 7, 12, 16, 24], interval: 0.022, mode: 'once' },
    layers: [{ wave: 'triangle', freq: 196, duration: 0.8, vol: 0.18, env: { a: 0.002, d: 0.6, s: 0, r: 0.1 }, arp: { steps: [0, 4, 7, 12, 16, 19], interval: 0.022, mode: 'once' } }],
    cooldown: 0.4, maxVoices: 2,
  },
  /** Wind chimes: a few bright, slowly dying bell tones. */
  chime: {
    gain: 0.8,
    wave: 'sine', freq: 1047, duration: 1.2, vol: 0.22,
    env: { a: 0.002, d: 1.1, s: 0, r: 0.2 },
    arp: { steps: [0, 7, 4, 12, 9], interval: 0.13, mode: 'once', retrigger: true },
    layers: [{ wave: 'sine', freq: 2890, duration: 1, vol: 0.06, env: { a: 0.002, d: 0.6, s: 0, r: 0.2 }, arp: { steps: [0, 7, 4, 12, 9], interval: 0.13, mode: 'once', retrigger: true } }],
    cooldown: 0.8, maxVoices: 2,
  },
  /** Toaster pop: a springy "boing" with a clunk. */
  toast: {
    wave: 'triangle', freq: 180, path: [[0.05, 330], [0.1, 250], [0.15, 380], [0.22, 260], [0.3, 300], [0.4, 240]],
    duration: 0.45, vol: 0.45,
    env: { a: 0.002, d: 0.4, s: 0, r: 0.02 },
    vibrato: { depth: 0.4, rate: 14 },
    layers: [{ wave: 'noise', freq: 8000, duration: 0.03, vol: 0.35, env: { a: 0.001, d: 0.03, s: 0, r: 0 }, filter: { type: 'bandpass', freq: 1500 } }],
    cooldown: 0.3,
  },
  /** Cat. A vowel-like sweep: pitch contour + a moving band-pass formant. */
  meow: {
    gain: 2.5,
    wave: 'pulse25', freq: 520, path: [[0.08, 760], [0.2, 880], [0.36, 700], [0.5, 420]],
    duration: 0.5, vol: 0.4, jitter: 1.5,
    env: { a: 0.03, d: 0.1, s: 0.7, r: 0.12 },
    vibrato: { depth: 0.5, rate: 6, delay: 0.12 },
    filter: { type: 'bandpass', freq: 700, endFreq: 1800, time: 0.25, q: 2.5 },
    cooldown: 0.6, maxVoices: 2,
  },

  // ---- pickups and jingles -----------------------------------------------------------------
  /** Gold star: a bright two-note blip. */
  star: {
    gain: 1.15,
    wave: 'pulse50', freq: 1318.5, duration: 0.3, vol: 0.35,
    env: { a: 0, d: 0.25, s: 0, r: 0.03 },
    arp: { steps: [0, 7], interval: 0.07, mode: 'once', retrigger: true },
    layers: [{
      wave: 'pulse12', freq: 2637, duration: 0.3, vol: 0.12,
      env: { a: 0, d: 0.25, s: 0, r: 0.03 },
      arp: { steps: [0, 7], interval: 0.07, mode: 'once', retrigger: true },
    }],
    maxVoices: 6,
  },
  /** Spare sheet (extra life): rising arpeggio with a bass double. */
  sheet: {
    gain: 0.93,
    wave: 'pulse25', freq: 523.25, duration: 0.5, vol: 0.35,
    env: { a: 0, d: 0.2, s: 0.3, r: 0.08 },
    arp: { steps: [0, 4, 7, 12, 16], interval: 0.075, mode: 'once', retrigger: true },
    layers: [{
      wave: 'triangle', freq: 261.63, duration: 0.5, vol: 0.5,
      env: { a: 0, d: 0.2, s: 0.3, r: 0.08 },
      arp: { steps: [0, 4, 7, 12, 16], interval: 0.075, mode: 'once', retrigger: true },
    }],
  },
  /** Level won: a short fanfare ending on a held C-major chord. */
  win: {
    gain: 0.77,
    wave: 'pulse25', freq: 523.25, duration: 1.1, vol: 0.34,
    env: { a: 0, d: 0.15, s: 0.5, r: 0.15 },
    arp: { steps: [0, 4, 7, 12, 16, 19, 24], interval: 0.085, mode: 'once', retrigger: true },
    layers: [
      { wave: 'triangle', freq: 261.63, duration: 1.1, vol: 0.5, env: { a: 0, d: 0.15, s: 0.5, r: 0.15 }, arp: { steps: [0, 4, 7, 12, 16, 19, 24], interval: 0.085, mode: 'once', retrigger: true } },
      { wave: 'pulse50', freq: 1046.5, duration: 0.55, vol: 0.12, delay: 0.51, env: { a: 0.01, d: 0, s: 1, r: 0.2 } },
      { wave: 'pulse50', freq: 1318.5, duration: 0.55, vol: 0.1, delay: 0.51, env: { a: 0.01, d: 0, s: 1, r: 0.2 } },
      { wave: 'pulse50', freq: 1568, duration: 0.55, vol: 0.1, delay: 0.51, env: { a: 0.01, d: 0, s: 1, r: 0.2 } },
    ],
    maxVoices: 1,
  },
  /** Level lost: a sad descending "wah-wah-wah-waaah". */
  lose: {
    gain: 0.9,
    wave: 'pulse50', freq: 392, duration: 1.3, vol: 0.32,
    env: { a: 0.005, d: 0.2, s: 0.5, r: 0.3 },
    arp: { steps: [0, -1, -2, -3], interval: 0.22, mode: 'once', retrigger: true },
    vibrato: { depth: 0.35, rate: 5.5, delay: 0.75 },
    layers: [{ wave: 'triangle', freq: 196, duration: 1.3, vol: 0.45, env: { a: 0.005, d: 0.2, s: 0.5, r: 0.3 }, arp: { steps: [0, -1, -2, -3], interval: 0.22, mode: 'once', retrigger: true } }],
    maxVoices: 1,
  },
  /** Something unlocked: a sparkling run up. */
  unlock: {
    gain: 0.9,
    wave: 'pulse12', freq: 1046.5, duration: 0.6, vol: 0.28,
    env: { a: 0, d: 0.12, s: 0, r: 0.1 },
    arp: { steps: [0, 4, 7, 12, 16, 19, 24, 28], interval: 0.05, mode: 'once', retrigger: true },
    layers: [{
      wave: 'pulse50', freq: 523.25, duration: 0.6, vol: 0.15, delay: 0.05,
      env: { a: 0, d: 0.12, s: 0, r: 0.1 },
      arp: { steps: [0, 4, 7, 12, 16, 19, 24, 28], interval: 0.05, mode: 'once', retrigger: true },
    }],
    maxVoices: 2,
  },

  // ---- UI ----------------------------------------------------------------------------------
  /** Light switch: click-clack. */
  switch: {
    gain: 1.3,
    wave: 'noise', freq: 25000, duration: 0.012, vol: 0.5,
    env: { a: 0.0005, d: 0.012, s: 0, r: 0 },
    filter: { type: 'bandpass', freq: 2500, q: 1.5 },
    repeat: { count: 2, interval: 0.075, pitchStep: -4 },
    layers: [{ wave: 'pulse50', freq: 900, duration: 0.015, vol: 0.2, env: { a: 0.0005, d: 0.015, s: 0, r: 0 }, repeat: { count: 2, interval: 0.075, pitchStep: -4 } }],
    cooldown: 0.1,
  },
  /** Menu tick. */
  click: {
    gain: 1.25,
    wave: 'pulse25', freq: 1500, endFreq: 1900, duration: 0.03, vol: 0.3,
    env: { a: 0.001, d: 0.03, s: 0, r: 0.005 },
    cooldown: 0.02, maxVoices: 3,
  },
  /** Back / cancel: a falling blip. */
  back: {
    gain: 1.2,
    wave: 'pulse25', freq: 1100, endFreq: 600, duration: 0.07, vol: 0.3,
    env: { a: 0.001, d: 0.07, s: 0, r: 0.005 },
    cooldown: 0.05, maxVoices: 2,
  },
  /** Hover: the faintest tick. */
  hover: {
    wave: 'pulse12', freq: 2200, duration: 0.02, vol: 0.12,
    env: { a: 0.001, d: 0.02, s: 0, r: 0.003 },
    cooldown: 0.04, maxVoices: 2,
  },
  /** Confirm: two quick rising notes. */
  select: {
    gain: 1.2,
    wave: 'pulse25', freq: 880, duration: 0.14, vol: 0.3,
    env: { a: 0, d: 0.06, s: 0.3, r: 0.04 },
    arp: { steps: [0, 7], interval: 0.05, mode: 'once', retrigger: true },
    cooldown: 0.05,
  },
  /** Not allowed: a low double buzz. */
  error: {
    gain: 1.1,
    wave: 'pulse75', freq: 150, duration: 0.1, vol: 0.35,
    env: { a: 0.002, d: 0, s: 1, r: 0.02 },
    repeat: { count: 2, interval: 0.15 },
    layers: [{ wave: 'pulse12', freq: 155, duration: 0.1, vol: 0.2, env: { a: 0.002, d: 0, s: 1, r: 0.02 }, repeat: { count: 2, interval: 0.15 } }],
    cooldown: 0.25, maxVoices: 1,
  },
} satisfies Record<string, SfxDef>;

export type SfxName = keyof typeof SFX_DEFS;

/**
 * PLACEHOLDER loops. Drive them from the game: `setVolume` (e.g. airspeed) and `setPitch` (semitones).
 * Layer gains are relative to a noise RMS of about 0.3; `vol` is the loop's overall level.
 */
export const LOOP_DEFS = {
  /** Airspeed wind: breathy band-passed noise with slow gusts. Pitch raises the whistle with speed. */
  wind: {
    vol: 0.48,
    layers: [
      {
        source: 'pink', gain: 1.6,
        filters: [{ type: 'bandpass', freq: 520, q: 0.9 }],
        mods: [{ target: 'gain', rates: [0.11, 0.23, 0.37], depth: 0.35 }, { target: 'filter', rates: [0.17, 0.29], depth: 180 }],
      },
      {
        source: 'white', gain: 0.35,
        filters: [{ type: 'highpass', freq: 2600 }, { type: 'lowpass', freq: 7000 }],
        mods: [{ target: 'gain', rates: [0.13, 0.31], depth: 0.5 }],
      },
    ],
  },
  /** Floor / ceiling vent: a steady low "hoooo" with a breathy resonance. */
  vent: {
    vol: 0.13,
    layers: [
      { source: 'brown', gain: 2.2, filters: [{ type: 'lowpass', freq: 520 }] },
      {
        source: 'pink', gain: 1.1,
        filters: [{ type: 'bandpass', freq: 1000, q: 2.2 }],
        mods: [{ target: 'filter', rates: [0.23, 0.41], depth: 160 }, { target: 'gain', rates: [0.17], depth: 0.25 }],
      },
      { source: 'triangle', freq: 55, gain: 0.35, filters: [{ type: 'lowpass', freq: 200 }] },
    ],
  },
  /** Desk / ceiling fan: motor hum plus a chopping blade whirr. Pitch = fan speed. */
  fan: {
    vol: 0.36,
    layers: [
      { source: 'triangle', freq: 96, gain: 0.5, filters: [{ type: 'lowpass', freq: 900 }], mods: [{ target: 'freq', rates: [0.6], depth: 1.5 }] },
      { source: 'saw', freq: 192, gain: 0.1, filters: [{ type: 'lowpass', freq: 700 }] },
      {
        source: 'white', gain: 1.3,
        filters: [{ type: 'bandpass', freq: 1100, q: 0.8 }],
        mods: [{ target: 'gain', rates: [24], depth: 0.45 }],
      },
    ],
  },
  /** Fire: low rumble, crackles, and a hiss. */
  fire: {
    vol: 0.145,
    layers: [
      { source: 'brown', gain: 2.0, filters: [{ type: 'lowpass', freq: 320 }], mods: [{ target: 'gain', rates: [0.31, 0.7, 1.3], depth: 0.35 }] },
      { source: 'crackleA', gain: 1.4, filters: [{ type: 'bandpass', freq: 2400, q: 0.6 }], pitchTrack: 0 },
      { source: 'crackleB', gain: 1.0, filters: [{ type: 'highpass', freq: 4200 }], pitchTrack: 0 },
      { source: 'pink', gain: 0.4, filters: [{ type: 'bandpass', freq: 2800, q: 0.5 }], mods: [{ target: 'gain', rates: [0.9, 2.1], depth: 0.5 }] },
    ],
  },
  /** Rain on the window: dense hiss plus individual drops. */
  rain: {
    vol: 0.33,
    layers: [
      {
        source: 'white', gain: 1.0,
        filters: [{ type: 'highpass', freq: 1500 }, { type: 'lowpass', freq: 9000 }],
        mods: [{ target: 'gain', rates: [0.07, 0.19], depth: 0.12 }],
      },
      { source: 'pink', gain: 1.1, filters: [{ type: 'bandpass', freq: 4200, q: 0.4 }] },
      { source: 'crackleA', rate: 2.4, gain: 1.1, filters: [{ type: 'highpass', freq: 3000 }] },
      { source: 'crackleB', rate: 1.8, gain: 0.8, filters: [{ type: 'bandpass', freq: 5200, q: 0.8 }] },
    ],
  },
} satisfies Record<string, LoopDef>;

export type LoopName = keyof typeof LOOP_DEFS;
