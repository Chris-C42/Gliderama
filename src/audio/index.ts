/**
 * Gliderama audio: chiptune music + sound effects on plain WebAudio.
 *
 *   import { audio } from './audio';
 *   window.addEventListener('pointerup', () => audio.unlock(), { once: true });  // from a user gesture
 *   audio.playMusic(demoSong, { fadeIn: 1 });
 *   audio.playSfx('star');
 *   const wind = audio.startLoop('wind'); wind.setVolume(airspeed01);
 *
 * Every call is safe before `unlock()` and outside a browser (it does nothing; a requested song or loop
 * starts as soon as audio is running). See README.md.
 */

import { AudioEngine } from './engine';
import type { LoopStartOptions } from './loops';
import { MusicPlayer, type PlayMusicOptions, type StopMusicOptions } from './music';
import type { CompiledSong, SongDef } from './notation';
import { SfxPlayer, type LoopHandle, type LoopKey, type PlaySfxOptions, type SfxKey } from './sfx';

export interface AudioApi {
  /**
   * Creates the AudioContext (first call) and resumes it. Call it synchronously from a user gesture
   * (pointerup / touchend / click / keydown). Resolves to true once audio is running.
   */
  unlock(): Promise<boolean>;
  /** True once audio has been started successfully by a user gesture. */
  isUnlocked(): boolean;
  /** Music volume slider 0..1 (perceptual curve). */
  setMusicVolume(volume: number): void;
  /** Sound-effect volume slider 0..1 (perceptual curve). */
  setSfxVolume(volume: number): void;
  /** Plays a song, replacing the current one (a song that is already playing keeps playing). */
  playMusic(song: SongDef | CompiledSong, options?: PlayMusicOptions): void;
  /** Stops the music with a short fade (default 0.15 s). */
  stopMusic(options?: StopMusicOptions): void;
  /** Fades the current song out and the new one in over `seconds`. */
  crossfadeTo(song: SongDef | CompiledSong, seconds: number): void;
  /** The song most recently requested (playing, or waiting for `unlock()`), or null. */
  currentSong(): SongDef | null;
  /** Plays a sound effect. Returns false if it was skipped (not unlocked, unknown, or in cooldown). */
  playSfx(name: SfxKey, options?: PlaySfxOptions): boolean;
  /** Starts a continuous loop; steer it with the returned handle. */
  startLoop(name: LoopKey, options?: LoopStartOptions): LoopHandle;

  // ---- extras --------------------------------------------------------------------------------
  /** Installs one-time window listeners that call `unlock()` on the first user gesture. */
  autoUnlock(): void;
  /** Stops all running loops (e.g. when leaving a room). */
  stopAllLoops(fade?: number): void;
  /** The underlying objects, for tools like the audio lab. */
  readonly engine: AudioEngine;
  readonly music: MusicPlayer;
  readonly sfx: SfxPlayer;
}

const engine = new AudioEngine();
const music = new MusicPlayer(engine);
const sfx = new SfxPlayer(engine);

export const audio: AudioApi = {
  unlock: () => engine.unlock(),
  isUnlocked: () => engine.isUnlocked(),
  setMusicVolume: (volume) => engine.setMusicVolume(volume),
  setSfxVolume: (volume) => engine.setSfxVolume(volume),
  playMusic: (song, options) => music.play(song, options),
  stopMusic: (options) => music.stop(options),
  crossfadeTo: (song, seconds) => music.crossfadeTo(song, seconds),
  currentSong: () => music.current(),
  playSfx: (name, options) => sfx.play(name, options),
  startLoop: (name, options) => sfx.startLoop(name, options),
  autoUnlock: () => engine.autoUnlock(),
  stopAllLoops: (fade) => sfx.stopAllLoops(fade),
  engine,
  music,
  sfx,
};

// ---- re-exports for convenience --------------------------------------------------------------
export { AudioEngine, volumeToGain } from './engine';
export { MusicPlayer, renderSong } from './music';
export type { PlayMusicOptions, StopMusicOptions } from './music';
export { SfxPlayer } from './sfx';
export type { LoopHandle, LoopKey, PlaySfxOptions, SfxKey } from './sfx';
export type { LoopStartOptions, LoopDef, LoopLayer } from './loops';
export { LOOP_DEFS, SFX_DEFS } from './sfx-defs';
export type { LoopName, SfxName } from './sfx-defs';
export type { SfxDef, SfxVoiceDef } from './sfx-plan';
export { compileSong, parseSong, noteToFreq, noteToMidi, midiToFreq, SongError } from './notation';
export type { CompiledSong, InstrumentDef, NoteEvent, OrderEntry, SongDef } from './notation';
export type { Envelope, WaveName } from './types';
