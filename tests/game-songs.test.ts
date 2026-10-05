import { describe, expect, it } from 'vitest';
import { compileSong, noteToMidi } from '../src/audio/notation';
import { TRACKS } from '../src/audio/songs/game';
import { comp, echo, steps } from '../src/audio/songs/kit';

const SCALES: Record<string, number[]> = {
  title: [2, 4, 6, 7, 9, 11, 1], // D major
  workshop: [5, 7, 9, 10, 0, 2, 4], // F major
  home: [7, 9, 11, 0, 2, 4, 6], // G major
  hangar: [9, 11, 0, 2, 4, 6, 7], // A dorian
  trail: [4, 6, 7, 9, 11, 0, 2, 3], // E minor + the D# of the B chord
  daily: [0, 2, 4, 5, 7, 9, 11], // C major
};

describe('game soundtrack', () => {
  for (const [id, def] of Object.entries(TRACKS)) {
    it(`${id} compiles to a sensible length`, () => {
      const song = compileSong(def);
      expect(song.events.length).toBeGreaterThan(40);
      if (def.loop === false) expect(song.duration).toBeLessThan(8);
      else {
        expect(song.duration, `${id} duration`).toBeGreaterThan(30);
        expect(song.duration, `${id} duration`).toBeLessThan(120);
      }
      for (const e of song.events) {
        expect(e.freq).toBeGreaterThan(20);
        expect(e.freq, `${id}: very shrill note`).toBeLessThan(2000);
      }
    });
  }

  for (const [id, scale] of Object.entries(SCALES)) {
    it(`${id}: the tune stays in key`, () => {
      const def = TRACKS[id as keyof typeof TRACKS];
      const tuneTracks = Object.keys(def.tracks).filter((t) => ['melody', 'song', 'blip', 'bell', 'echo', 'counter', 'third'].includes(t));
      for (const [pname, pat] of Object.entries(def.patterns)) {
        for (const t of tuneTracks) {
          const src = pat[t];
          if (!src) continue;
          for (const tok of steps(src)) {
            const m = /^([A-Ga-g][#b]?\d)/.exec(tok);
            if (!m) continue;
            const pc = ((noteToMidi(m[1]) % 12) + 12) % 12;
            expect(scale, `${id} ${pname}.${t}: ${tok}`).toContain(pc);
          }
        }
      }
    });
  }
});

describe('song kit', () => {
  it('comp() writes each chord on its own track and rests the others', () => {
    const t = comp(['C', 'Am', 'F G'], 'x - - - x - - - x - - - x - - -');
    expect(Object.keys(t).sort()).toEqual(['chMaj', 'chMin']);
    expect(steps(t.chMaj[0])).toEqual(['C4', '-', '-', '-', 'C4', '-', '-', '-', 'C4', '-', '-', '-', 'C4', '-', '-', '-']);
    expect(steps(t.chMin[0]).every((x) => x === '.')).toBe(true);
    expect(steps(t.chMin[1])[0]).toBe('A3');
    // F then G in one bar
    expect(steps(t.chMaj[2])[0]).toBe('F4');
    expect(steps(t.chMaj[2])[8]).toBe('G3');
  });

  it('comp() never leaves a hold without a note in front of it', () => {
    const t = comp(['C', 'Dm', 'C'], '- x - - . - x - - - - - x - - -');
    for (const bars of Object.values(t)) {
      const s = steps(bars);
      for (let i = 0; i < s.length; i++) if (s[i] === '-') expect(i > 0 && s[i - 1] !== '.').toBe(true);
    }
  });

  it('echo() delays a line and keeps the bar count', () => {
    const e = echo(['C5 - D5 - | E5 - - - | . . . . | G5 - - -'], 3);
    expect(steps(e)).toEqual(['.', '.', '.', 'C5', '-', 'D5', '-', 'E5', '-', '-', '-', '.', '.', '.', '.', 'G5']);
  });
});
