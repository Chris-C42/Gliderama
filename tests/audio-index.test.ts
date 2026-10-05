import { afterEach, describe, expect, it, vi } from 'vitest';
import { SFX_DEFS, SongError, audio, compileSong, noteToFreq, type SongDef } from '../src/audio';
import { demo, jingle } from '../src/audio/songs';

/**
 * The public `audio` singleton, exercised in plain Node: no window, no document, no AudioContext.
 * Every call must be a harmless no-op (but music and loops remember what was asked for).
 */
afterEach(() => {
  audio.stopMusic();
  audio.stopAllLoops();
  vi.restoreAllMocks();
});

describe('audio singleton outside a browser', () => {
  it('exposes the documented API', () => {
    for (const name of [
      'unlock', 'isUnlocked', 'setMusicVolume', 'setSfxVolume', 'playMusic', 'stopMusic', 'crossfadeTo', 'currentSong', 'playSfx',
      'startLoop', 'autoUnlock', 'stopAllLoops',
    ] as const) {
      expect(typeof audio[name], name).toBe('function');
    }
    expect(audio.engine).toBeDefined();
    expect(audio.music).toBeDefined();
    expect(audio.sfx).toBeDefined();
  });

  it('unlock resolves false and nothing is unlocked', async () => {
    expect(await audio.unlock()).toBe(false);
    expect(audio.isUnlocked()).toBe(false);
    expect(audio.engine.state).toBe('none');
  });

  it('volume setters, autoUnlock and stop calls never throw', () => {
    expect(() => {
      audio.setMusicVolume(0.3);
      audio.setSfxVolume(2);
      audio.setMusicVolume(NaN);
      audio.autoUnlock();
      audio.stopMusic({ fadeOut: 2 });
      audio.stopAllLoops(1);
    }).not.toThrow();
  });

  it('playSfx does nothing and reports false', () => {
    expect(audio.playSfx('star')).toBe(false);
    expect(audio.playSfx('bump', { vol: 0.5, pitch: -3, pan: 0.5 })).toBe(false);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(audio.playSfx('no-such-sound')).toBe(false);
  });

  it('remembers the requested song, and stopMusic forgets it', () => {
    expect(audio.currentSong()).toBeNull();
    audio.playMusic(demo, { fadeIn: 1 });
    expect(audio.currentSong()).toBe(demo);
    audio.crossfadeTo(jingle, 2);
    expect(audio.currentSong()).toBe(jingle);
    audio.stopMusic({ fadeOut: 1 });
    expect(audio.currentSong()).toBeNull();
  });

  it('an invalid song is reported, not thrown', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad: SongDef = {
      bpm: 120,
      instruments: { a: { wave: 'pulse25' } },
      tracks: { t: 'a' },
      patterns: { A: { t: 'C4 - Q9 -' } },
      order: ['A'],
    };
    expect(() => audio.playMusic(bad)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(audio.currentSong()).toBeNull();
    // ... while the pure compiler does throw, for tools and tests
    expect(() => compileSong(bad)).toThrow(SongError);
  });

  it('startLoop returns a usable handle that can be adjusted and stopped', () => {
    const handle = audio.startLoop('wind', { vol: 0.5, pitch: 2 });
    expect(handle.active).toBe(true);
    expect(() => {
      handle.setVolume(0.8);
      handle.setPitch(-4);
    }).not.toThrow();
    handle.stop(0.3);
    expect(handle.active).toBe(false);
    handle.stop(); // twice is fine
  });

  it('an unknown loop gives an inert handle', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const handle = audio.startLoop('nope');
    expect(handle.active).toBe(false);
    expect(() => {
      handle.setVolume(1);
      handle.setPitch(1);
      handle.stop();
    }).not.toThrow();
  });

  it('re-exports the pure notation helpers and the built-in sound table', () => {
    expect(noteToFreq('A4')).toBe(440);
    expect(Object.keys(SFX_DEFS)).toContain('star');
  });
});
