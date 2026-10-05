/**
 * Glue between the game and the audio engine: the SFX bridge, volume settings, which track plays on
 * which screen (with crossfades), UI click sounds and the in-flight ambience (wind, vents, fans, fire).
 */

import { effect } from '@preact/signals';
import { audio } from '../audio';
import { setSfxImpl } from '../audio/bridge';
import type { LoopHandle, SfxKey } from '../audio/sfx';
import { TRACKS, type TrackId } from '../audio/songs/game';
import { settings } from '../core/settings';
import type { Ambience } from '../game/session';
import { route, type Route } from './nav';

let current: TrackId | null = null;

/** The track that belongs to a screen. Play screens pick by mode (and later by place). */
export function trackFor(r: Route): TrackId {
  switch (r.name) {
    case 'workshop':
      return 'workshop';
    case 'hangar':
      return 'hangar';
    case 'trail':
      return 'trail';
    case 'daily':
      return 'daily';
    case 'challenges':
      return 'puzzle';
    case 'play':
      switch (r.play.mode) {
        case 'trail':
          return 'trail';
        case 'daily':
          return 'daily';
        case 'challenge':
          return 'puzzle';
        case 'test':
          return 'hangar';
        default:
          return 'home';
      }
    default:
      return 'title';
  }
}

/** Switch the music (null fades it out). The same track keeps playing without a restart. */
export function playTrack(id: TrackId | null, fade = 1.2): void {
  if (id === current) return;
  current = id;
  if (!id) {
    audio.stopMusic({ fadeOut: fade });
    return;
  }
  const song = TRACKS[id];
  if (song.loop === false) audio.playMusic(song, { restart: true });
  else if (audio.currentSong()) audio.crossfadeTo(song, fade);
  else audio.playMusic(song, { fadeIn: 0.5 });
}

/** Back to the current screen's track (after a jingle, or a restart). */
export function resumeScreenTrack(): void {
  playTrack(trackFor(route.peek()));
}

let started = false;

export function initAudio(): void {
  if (started) return;
  started = true;
  setSfxImpl((name, opts) => {
    audio.playSfx(name as SfxKey, opts);
  });
  // The cottage's cuckoo clock: a falling third on a soft, flute-like voice.
  audio.sfx.register('cuckoo', {
    gain: 1.3,
    wave: 'triangle',
    freq: 784,
    duration: 0.46,
    vol: 0.45,
    env: { a: 0.012, d: 0.08, s: 0.55, r: 0.08 },
    arp: { steps: [0, -4], interval: 0.23, mode: 'once', retrigger: true },
    layers: [{ wave: 'sine', freq: 1568, duration: 0.46, vol: 0.08, env: { a: 0.012, d: 0.08, s: 0.4, r: 0.08 }, arp: { steps: [0, -4], interval: 0.23, mode: 'once', retrigger: true } }],
    cooldown: 0.8,
    maxVoices: 1,
  });
  // Hover assist on / off: a soft rising (falling) pair of notes, like a little wind-up.
  audio.sfx.register('hoverOn', {
    gain: 1,
    wave: 'triangle',
    freq: 523,
    duration: 0.22,
    vol: 0.32,
    env: { a: 0.005, d: 0.05, s: 0.5, r: 0.06 },
    arp: { steps: [0, 7], interval: 0.09, mode: 'once', retrigger: true },
    cooldown: 0.15,
    maxVoices: 1,
  });
  // Taking the stairs: four quick soft footsteps going up (or down) the scale.
  for (const [name, steps] of [
    ['stairsUp', [0, 3, 5, 8]],
    ['stairsDown', [8, 5, 3, 0]],
  ] as const) {
    audio.sfx.register(name, {
      gain: 1,
      wave: 'pulse25',
      freq: 330,
      duration: 0.34,
      vol: 0.18,
      env: { a: 0.002, d: 0.04, s: 0.2, r: 0.03 },
      arp: { steps: [...steps], interval: 0.07, mode: 'once', retrigger: true },
      layers: [{ wave: 'noise', freq: 900, duration: 0.3, vol: 0.05, env: { a: 0.001, d: 0.03, s: 0, r: 0.02 } }],
      cooldown: 0.4,
      maxVoices: 1,
    });
  }
  audio.sfx.register('hoverOff', {
    gain: 1,
    wave: 'triangle',
    freq: 784,
    duration: 0.2,
    vol: 0.26,
    env: { a: 0.005, d: 0.05, s: 0.45, r: 0.06 },
    arp: { steps: [0, -7], interval: 0.08, mode: 'once', retrigger: true },
    cooldown: 0.15,
    maxVoices: 1,
  });
  effect(() => {
    const s = settings.value;
    audio.setMusicVolume(s.musicVolume);
    audio.setSfxVolume(s.sfxVolume);
  });
  audio.autoUnlock();
  // iOS (Safari 16.4+): mix with the player's own music instead of stopping it, like a native casual game.
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
  } catch {
    /* not supported */
  }
  effect(() => playTrack(trackFor(route.value)));
  // A soft tick for every button press; back buttons get their own sound.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('button, .btn, [role="button"]');
      if (!el || (el as HTMLButtonElement).disabled || el.closest('[data-quiet]')) return;
      if (el.getAttribute('aria-label') === 'Back') audio.playSfx('back', { vol: 0.6 });
      else audio.playSfx('click', { vol: 0.5 });
    },
    { capture: true, passive: true },
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The ambient loops during play: started on construction, steered with `update`, ended with `stop`. */
export class Ambient {
  private loops: Record<'wind' | 'vent' | 'fan' | 'fire', LoopHandle>;
  private last = { wind: -1, vent: -1, fan: -1, fire: -1, pitch: 99 };
  private t = 0;

  constructor() {
    this.loops = {
      wind: audio.startLoop('wind', { vol: 0, fadeIn: 0.4 }),
      vent: audio.startLoop('vent', { vol: 0, fadeIn: 0.4 }),
      fan: audio.startLoop('fan', { vol: 0, fadeIn: 0.4 }),
      fire: audio.startLoop('fire', { vol: 0, fadeIn: 0.4 }),
    };
  }

  /** Call every frame; parameters are sent ~15 times a second and only when they change. */
  update(dt: number, a: Ambience | null): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1 / 15;
    const rush = a && a.flying ? clamp01((a.speed - 0.5) / 3) : 0;
    const target = {
      wind: a && a.flying ? 0.12 + 0.75 * rush : 0,
      vent: a ? 0.85 * a.vent : 0,
      fan: a ? 0.8 * a.fan : 0,
      fire: a ? 0.9 * a.fire : 0,
    };
    for (const k of ['wind', 'vent', 'fan', 'fire'] as const) {
      if (Math.abs(target[k] - this.last[k]) < 0.01) continue;
      this.last[k] = target[k];
      this.loops[k].setVolume(target[k]);
    }
    const pitch = Math.round((rush - 0.4) * 10) / 2; // half-semitone steps
    if (pitch !== this.last.pitch) {
      this.last.pitch = pitch;
      this.loops.wind.setPitch(pitch);
    }
  }

  stop(): void {
    for (const l of Object.values(this.loops)) l.stop(0.3);
  }
}
