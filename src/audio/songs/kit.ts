/**
 * Shared voices, drum kit and writing helpers for the game soundtrack, so every song sounds like it
 * came off the same cartridge.
 *
 *   comp(['C', 'Am', 'F G'], 'x - - - x - - - x - - - x - - -')   // chord tracks for a pattern
 *   echo(melodyBars, 3)                                             // the line 3 steps later (chip echo)
 */

import type { InstrumentDef } from '../notation';

type Kit = Record<string, InstrumentDef>;

/** One drum kit for the whole soundtrack. Map letters with DRUM_KEYS. */
export const DRUMS: Kit = {
  kick: { wave: 'triangle', pitchEnv: { from: 30, to: -10, time: 0.07 }, env: { a: 0, d: 0.14, s: 0, r: 0 }, vol: 0.8 },
  snare: { wave: 'noise', env: { a: 0, d: 0.12, s: 0, r: 0 }, vol: 0.4, noiseRate: 1, filter: { type: 'highpass', freq: 1000 } },
  hat: { wave: 'noise-short', env: { a: 0, d: 0.03, s: 0, r: 0 }, vol: 0.13, noiseRate: 4 },
  openHat: { wave: 'noise-short', env: { a: 0, d: 0.13, s: 0, r: 0 }, vol: 0.1, noiseRate: 4 },
  shaker: { wave: 'noise', env: { a: 0.004, d: 0.045, s: 0, r: 0 }, vol: 0.11, noiseRate: 2, filter: { type: 'highpass', freq: 6000 } },
  rim: { wave: 'noise-short', env: { a: 0, d: 0.025, s: 0, r: 0 }, vol: 0.17, noiseRate: 1.5, filter: { type: 'bandpass', freq: 1800, q: 2 } },
  tomHi: { wave: 'triangle', pitch: 'C3', pitchEnv: { from: 7, to: -5, time: 0.1 }, env: { a: 0, d: 0.16, s: 0, r: 0 }, vol: 0.7 },
  tomLo: { wave: 'triangle', pitch: 'G2', pitchEnv: { from: 7, to: -5, time: 0.12 }, env: { a: 0, d: 0.2, s: 0, r: 0 }, vol: 0.75 },
  crash: { wave: 'noise', env: { a: 0, d: 0.7, s: 0, r: 0 }, vol: 0.2, noiseRate: 1.4, filter: { type: 'highpass', freq: 3000 } },
};

/** Drum letters: k kick, s snare, h hat, o open hat, x shaker, r rim, t / l high / low tom, c crash. */
export const DRUM_KEYS = { k: 'kick', s: 'snare', h: 'hat', o: 'openHat', x: 'shaker', r: 'rim', t: 'tomHi', l: 'tomLo', c: 'crash' };

/** Chord qualities: suffix -> [track name, arp shape]. */
const QUALITIES: Record<string, [string, number[]]> = {
  '': ['chMaj', [0, 4, 7]],
  m: ['chMin', [0, 3, 7]],
  '7': ['chDom7', [0, 4, 7, 10]],
  maj7: ['chMaj7', [0, 4, 7, 11]],
  m7: ['chMin7', [0, 3, 7, 10]],
  sus: ['chSus', [0, 5, 7]],
  '7sus': ['chSus7', [0, 5, 7, 10]],
  add9: ['chAdd9', [0, 4, 7, 14]],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parseChord(ch: string): { root: number; quality: string } {
  const m = /^([A-G])([#b]?)(.*)$/.exec(ch);
  if (!m || !(m[3] in QUALITIES)) throw new Error(`comp(): unknown chord "${ch}" (qualities: ${Object.keys(QUALITIES).join(', ') || 'major'})`);
  const pc = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { root: pc, quality: m[3] };
}

/** Splits a line into step tokens (bar lines dropped). */
export function steps(src: string | readonly string[]): string[] {
  return (typeof src === 'string' ? src : src.join(' ')).split(/\s+/).filter((t) => t && t !== '|');
}

/** Re-chunks step tokens into bar strings of `perBar` steps with a bar line every `group` steps. */
export function toBars(tokens: string[], perBar = 16, group = 4): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += perBar) {
    const bar = tokens.slice(i, i + perBar);
    const groups: string[] = [];
    for (let g = 0; g < bar.length; g += group) groups.push(bar.slice(g, g + group).join(' '));
    out.push(groups.join(' | '));
  }
  return out;
}

/** The same line `n` steps later: a chip "echo" channel (the last n steps fall off the end). */
export function echo(src: readonly string[], n: number, perBar = 16, group = 4): string[] {
  const t = steps(src);
  const out = [...Array<string>(n).fill('.'), ...t.slice(0, t.length - n)];
  for (let i = n; i < out.length && out[i] === '-'; i++) out[i] = '.';
  return toBars(out, perBar, group);
}

/**
 * Chord tracks for one pattern. `chords` has one entry per bar; an entry may name several chords
 * ('F G') that split the bar evenly. `rhythm` is one bar of x (strike) / - (hold) / . (rest). Roots sit
 * between `low` and an octave above (MIDI, default G3 = 55). Returns `{ chMaj: [...bars], chMin: [...] }`:
 * only the qualities the pattern uses, so the others are silent.
 */
export function comp(chords: string[], rhythm: string, opts: { low?: number; perBar?: number; group?: number } = {}): Record<string, string[]> {
  const low = opts.low ?? 55;
  const perBar = opts.perBar ?? 16;
  const group = opts.group ?? 4;
  const rh = steps(rhythm);
  if (rh.length !== perBar) throw new Error(`comp(): rhythm has ${rh.length} steps, expected ${perBar}`);
  const used = new Set<string>();
  for (const bar of chords) for (const ch of bar.split(/\s+/)) used.add(QUALITIES[parseChord(ch).quality][0]);
  const tracks: Record<string, string[]> = {};
  for (const name of used) tracks[name] = [];
  for (const bar of chords) {
    const list = bar.split(/\s+/).map(parseChord);
    const cur: Record<string, string[]> = {};
    for (const name of used) cur[name] = [];
    let sounding: string | null = null;
    for (let i = 0; i < perBar; i++) {
      const c = list[Math.min(list.length - 1, Math.floor((i * list.length) / perBar))];
      const name = QUALITIES[c.quality][0];
      const midi = low + ((c.root - (low % 12) + 12) % 12);
      for (const n of used) {
        if (n !== name) {
          cur[n].push('.');
          continue;
        }
        const r = rh[i];
        if (r === 'x') {
          cur[n].push(`${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`);
        } else if (r === '-' && sounding === name && cur[n].length > 0 && cur[n][cur[n].length - 1] !== '.') {
          cur[n].push('-');
        } else cur[n].push('.');
      }
      sounding = rh[i] === 'x' ? name : rh[i] === '-' ? sounding : null;
    }
    for (const n of used) tracks[n].push(...toBars(cur[n], perBar, group));
  }
  return tracks;
}

/** Chord instruments (one per quality, the arp shape is the chord) and the matching tracks. */
export function chordVoices(base: InstrumentDef): { instruments: Kit; tracks: Record<string, string> } {
  const instruments: Kit = {};
  const tracks: Record<string, string> = {};
  for (const [name, shape] of Object.values(QUALITIES)) {
    instruments[name] = { ...base, arp: shape };
    tracks[name] = name;
  }
  return { instruments, tracks };
}
