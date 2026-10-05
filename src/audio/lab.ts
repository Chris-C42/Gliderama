/**
 * Audio Lab: a dev page (`/audio-lab.html`) to try the audio engine by ear.
 *
 *  - unlock audio, set the music / sfx volumes, watch the output level and the limiter
 *  - play / stop / crossfade the demo songs, or type your own song in the editor and hear it
 *  - trigger every sound effect (with pitch / pan / volume), optionally "spammed" to test cooldowns
 *  - start / stop every loop and move its volume and pitch sliders live
 *
 * Plain DOM, no framework. Not part of the production build (only index.html is a build input).
 */

import { audio } from './index';
import { compileSong, parseSong, type CompiledSong, type SongDef } from './notation';
import type { LoopHandle } from './sfx';
import { LOOP_DEFS, SFX_DEFS } from './sfx-defs';
import { alt, demo, jingle } from './songs';

// ------------------------------------------------------------------------------------------------
// Tiny DOM helpers
// ------------------------------------------------------------------------------------------------

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

/** localStorage that never throws (private windows, blocked storage ...). */
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`audio-lab:${key}`);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`audio-lab:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

function slider(
  label: string,
  o: { min: number; max: number; step: number; value: number; format?: (v: number) => string; onInput: (v: number) => void },
): HTMLLabelElement {
  const fmt = o.format ?? ((v: number) => v.toFixed(2));
  const out = h('output');
  const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, value: o.value });
  out.textContent = fmt(o.value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    o.onInput(v);
  });
  return h('label', { class: 'slider' }, h('span', {}, label), input, out);
}

function checkbox(label: string, key: string, initial: boolean): { el: HTMLLabelElement; checked: () => boolean } {
  const input = h('input', { type: 'checkbox' });
  input.checked = store.get(key, initial);
  input.addEventListener('change', () => store.set(key, input.checked));
  return { el: h('label', { class: 'check' }, input, label), checked: () => input.checked };
}

// ------------------------------------------------------------------------------------------------
// Log (also mirrors console warnings and errors from the audio code)
// ------------------------------------------------------------------------------------------------

const logEl = h('pre', { id: 'log' });

function log(message: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'info'): void {
  const stamp = (performance.now() / 1000).toFixed(2).padStart(7);
  logEl.append(h('div', { class: kind === 'info' ? '' : `log-${kind}` }, `${stamp}  ${message}`));
  while (logEl.childElementCount > 300) logEl.firstElementChild?.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

for (const level of ['warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    log(args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a))).join(' '), level);
  };
}

/** Called from click handlers: unlocks audio on the first gesture. */
function ensureUnlocked(): void {
  if (!audio.isUnlocked()) {
    void audio.unlock().then((ok) => log(ok ? 'audio unlocked' : 'audio could not be unlocked (try clicking again)', ok ? 'ok' : 'error'));
  }
}

// ------------------------------------------------------------------------------------------------
// Status + level meter
// ------------------------------------------------------------------------------------------------

function statusPanel(): HTMLElement {
  const pill = h('span', { class: 'pill none' }, 'none');
  const details = h('span');
  const meter = h('canvas', { id: 'meter' });
  const reduction = h('span');
  const unlock = h('button', { class: 'primary' }, 'Unlock audio');
  unlock.addEventListener('click', ensureUnlocked);

  let analyser: AnalyserNode | null = null;
  let samples = new Float32Array(1024);
  let peakHold = -90;
  let lastFrame = performance.now();

  const refresh = (): void => {
    const state = audio.engine.state;
    pill.textContent = state;
    pill.className = `pill ${state}`;
    const ctx = audio.engine.ctx;
    details.textContent = ctx
      ? `${ctx.sampleRate} Hz   latency ${((ctx.baseLatency ?? 0) * 1000).toFixed(0)} ms   clock ${ctx.currentTime.toFixed(1)} s`
      : 'AudioContext not created yet';
    unlock.textContent = audio.isUnlocked() ? 'Audio is on' : 'Unlock audio';
    unlock.className = audio.isUnlocked() ? 'on' : 'primary';
  };
  setInterval(refresh, 250);
  refresh();

  const draw = (): void => {
    requestAnimationFrame(draw); // UI only: audio is never scheduled from here
    const ctx = audio.engine.ctx;
    const limiter = audio.engine.limiter;
    if (ctx && limiter && !analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize);
      limiter.connect(analyser); // a tap: it feeds nothing
    }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(meter.clientWidth * dpr));
    const hgt = Math.max(1, Math.floor(meter.clientHeight * dpr));
    if (meter.width !== w || meter.height !== hgt) {
      meter.width = w;
      meter.height = hgt;
    }
    const g = meter.getContext('2d');
    if (!g) return;
    g.fillStyle = '#14102a';
    g.fillRect(0, 0, w, hgt);
    let peak = 0;
    let rms = 0;
    if (analyser) {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) {
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      rms = Math.sqrt(sum / samples.length);
    }
    const toX = (db: number): number => ((Math.max(-60, Math.min(0, db)) + 60) / 60) * w;
    const db = (x: number): number => 20 * Math.log10(Math.max(x, 1e-6));
    const now = performance.now();
    peakHold = Math.max(db(peak), peakHold - ((now - lastFrame) / 1000) * 20);
    lastFrame = now;
    g.fillStyle = '#06d6a0';
    g.fillRect(0, 2 * dpr, toX(db(rms)), hgt - 4 * dpr);
    g.fillStyle = peakHold > -1 ? '#ef476f' : '#ffd166';
    g.fillRect(toX(peakHold) - 2 * dpr, 0, 3 * dpr, hgt);
    g.fillStyle = 'rgba(255,255,255,.25)';
    for (const mark of [-48, -36, -24, -12, -6]) g.fillRect(toX(mark), 0, dpr, hgt);
    reduction.textContent = limiter ? `limiter ${limiter.reduction.toFixed(1)} dB` : '';
  };
  requestAnimationFrame(draw);

  return h(
    'section',
    {},
    h('h2', {}, 'Engine'),
    h('div', { class: 'row' }, unlock, pill, h('span', { class: 'status' }, details, reduction)),
    h('div', { style: 'margin-top:10px' }, meter),
    h('p', { class: 'hint' }, 'Meter: green = RMS, yellow tick = peak (decaying), red = at or over full scale. Scale -60..0 dBFS, ticks at -48 -36 -24 -12 -6.'),
  );
}

function volumePanel(): HTMLElement {
  const music = store.get('musicVolume', 0.6);
  const sfx = store.get('sfxVolume', 0.8);
  audio.setMusicVolume(music);
  audio.setSfxVolume(sfx);
  return h(
    'section',
    {},
    h('h2', {}, 'Volumes'),
    h(
      'div',
      { class: 'row' },
      slider('Music', { min: 0, max: 1, step: 0.01, value: music, onInput: (v) => (audio.setMusicVolume(v), store.set('musicVolume', v)) }),
      slider('Sound effects', { min: 0, max: 1, step: 0.01, value: sfx, onInput: (v) => (audio.setSfxVolume(v), store.set('sfxVolume', v)) }),
    ),
    h('p', { class: 'hint' }, 'Sliders are 0..1 and go through a squared curve (0.5 is about -12 dB). Defaults match DEFAULT_SETTINGS (0.6 / 0.8).'),
  );
}

// ------------------------------------------------------------------------------------------------
// Music
// ------------------------------------------------------------------------------------------------

function musicPanel(): HTMLElement {
  const fade = checkbox('fade in over 1 s', 'fadeIn', false);
  const nowPlaying = h('span', { class: 'status' }, 'nothing playing');
  const bar = h('i');
  const progress = h('div', { class: 'progress' }, bar);

  const play = (def: SongDef, name: string): void => {
    ensureUnlocked();
    audio.playMusic(def, {
      fadeIn: fade.checked() ? 1 : 0,
      onEnd: () => log(`"${name}" finished`, 'ok'),
    });
    log(`playMusic("${name}")${fade.checked() ? ' with fadeIn 1 s' : ''}`);
  };

  const button = (label: string, sub: string, onClick: () => void): HTMLButtonElement => {
    const b = h('button', {}, label, h('span', { class: 'sub' }, sub));
    b.addEventListener('click', onClick);
    return b;
  };

  const buttons = h(
    'div',
    { class: 'row' },
    button('Demo', 'every feature, loops', () => play(demo, 'demo')),
    button('Night lights', 'second loop', () => play(alt, 'alt')),
    button('Jingle', 'no loop, onEnd', () => play(jingle, 'jingle')),
    button('Crossfade', 'demo <-> night lights, 2 s', () => {
      ensureUnlocked();
      const current = audio.currentSong();
      const next = current === demo ? alt : demo;
      audio.crossfadeTo(next, 2);
      log(`crossfadeTo(${next === demo ? 'demo' : 'alt'}, 2)`);
    }),
    button('Stop', 'fade out 0.5 s', () => {
      audio.stopMusic({ fadeOut: 0.5 });
      log('stopMusic({ fadeOut: 0.5 })');
    }),
    fade.el,
  );

  setInterval(() => {
    const current = audio.currentSong();
    const position = audio.music.position();
    if (!current) {
      nowPlaying.textContent = 'nothing playing';
      bar.style.width = '0';
      return;
    }
    let compiled: CompiledSong | null = null;
    try {
      compiled = parseSong(current);
    } catch {
      /* shown elsewhere */
    }
    const label = `${current.title ?? 'song'}   ${compiled ? `${compiled.bpm} bpm  ${compiled.duration.toFixed(1)} s` : ''}`;
    nowPlaying.textContent = position === null ? `${label}   (waiting for audio to start)` : `${label}   at ${position.toFixed(1)} s`;
    bar.style.width = compiled && position !== null ? `${(position / compiled.duration) * 100}%` : '0';
  }, 100);

  return h(
    'section',
    {},
    h('h2', {}, 'Music'),
    buttons,
    h('div', { class: 'row', style: 'margin-top:10px' }, nowPlaying, progress),
    h(
      'p',
      { class: 'hint' },
      'The demo has a one-time intro, then loops (loopStart). Press Crossfade while it plays. Requests made before unlocking start as soon as audio runs.',
    ),
  );
}

const EDITOR_DEFAULT = `// Edit and press Play. A song is a JS object literal (see src/audio/README.md).
{
  title: 'Editor song',
  bpm: 128, stepsPerBeat: 4, loop: true,
  instruments: {
    lead:  { wave: 'pulse25', env: { a: 0, d: 0.08, s: 0.6, r: 0.1 }, vol: 0.5, vibrato: { depth: 0.15, rate: 6, delay: 0.12 } },
    bass:  { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.02 }, vol: 0.7 },
    arp:   { wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.35, r: 0.05 }, vol: 0.2, arp: [0, 4, 7], arpSpeed: 0.03 },
    kick:  { wave: 'triangle', pitchEnv: { from: 30, to: -10, time: 0.07 }, env: { a: 0, d: 0.14, s: 0, r: 0 }, vol: 0.9 },
    snare: { wave: 'noise', env: { a: 0, d: 0.12, s: 0, r: 0 }, vol: 0.5, filter: { type: 'highpass', freq: 900 } },
    hat:   { wave: 'noise-short', env: { a: 0, d: 0.03, s: 0, r: 0 }, vol: 0.2, noiseRate: 4 },
  },
  tracks: { melody: 'lead', low: 'bass', harmony: 'arp', beat: { k: 'kick', s: 'snare', h: 'hat' } },
  patterns: {
    A: {
      melody:  'C5 . E5 . G5 - - . | A5 - G5 . E5 . C5 .',
      low:     'C3 - - - C3 - - - | F2 - - - G2 - - -',
      harmony: 'C4 - - - - - - - | F4 - - - G4 - - -',
      beat:    'k . h . s . h . | k . h k s . h .',
    },
  },
  order: ['A', 'A', { p: 'A', transpose: 5 }],
}`;

function editorPanel(): HTMLElement {
  const textarea = h('textarea', { spellcheck: 'false' });
  textarea.value = store.get('editor', EDITOR_DEFAULT);
  textarea.addEventListener('input', () => store.set('editor', textarea.value));
  const message = h('div', { id: 'editor-msg' });

  const compile = (): { def: SongDef; compiled: CompiledSong } | null => {
    try {
      // A dev tool: evaluate the object literal the author typed.
      const def = new Function(`"use strict"; return (${textarea.value}\n);`)() as SongDef;
      const compiled = compileSong(def);
      message.className = 'ok';
      message.textContent = `OK: ${compiled.totalSteps} steps, ${compiled.duration.toFixed(2)} s, ${compiled.events.length} events, ${compiled.sections.length} sections, ${compiled.loop ? 'loops' : 'plays once'}`;
      return { def, compiled };
    } catch (error) {
      message.className = 'bad';
      message.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return null;
    }
  };

  const validate = h('button', {}, 'Validate');
  validate.addEventListener('click', () => void compile());
  const playBtn = h('button', { class: 'primary' }, 'Play');
  playBtn.addEventListener('click', () => {
    const result = compile();
    if (!result) return;
    ensureUnlocked();
    audio.playMusic(result.def, { restart: true });
    log(`playMusic(editor song, ${result.compiled.duration.toFixed(1)} s)`);
  });
  const reset = h('button', {}, 'Reset to example');
  reset.addEventListener('click', () => {
    textarea.value = EDITOR_DEFAULT;
    store.set('editor', EDITOR_DEFAULT);
    message.textContent = '';
  });

  return h(
    'section',
    {},
    h('h2', {}, 'Song editor'),
    textarea,
    h('div', { class: 'row', style: 'margin-top:8px' }, playBtn, validate, reset),
    message,
    h('p', { class: 'hint' }, 'Errors name the pattern, track and step. Play restarts the song every time. Your text is kept in this browser.'),
  );
}

// ------------------------------------------------------------------------------------------------
// Sound effects
// ------------------------------------------------------------------------------------------------

function sfxPanel(): HTMLElement {
  let vol = store.get('sfx:vol', 1);
  let pitch = store.get('sfx:pitch', 0);
  let pan = store.get('sfx:pan', 0);
  const spam = checkbox('spam: 8 plays in 120 ms (tests cooldown + polyphony)', 'sfx:spam', false);

  const fire = (name: string, button: HTMLButtonElement): void => {
    ensureUnlocked();
    const count = spam.checked() ? 8 : 1;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const played = audio.playSfx(name, { vol, pitch, pan });
        if (!played) {
          button.classList.add('flash-bad');
          setTimeout(() => button.classList.remove('flash-bad'), 120);
          if (count === 1) log(`"${name}" was not played (still in its cooldown, or audio is off)`, 'warn');
        }
      }, i * 17);
    }
  };

  const grid = h('div', { class: 'grid' });
  for (const name of audio.sfx.names()) {
    const def = (SFX_DEFS as Record<string, { cooldown?: number; maxVoices?: number }>)[name];
    const sub = def ? [def.cooldown ? `cd ${def.cooldown}s` : '', def.maxVoices ? `max ${def.maxVoices}` : ''].filter(Boolean).join(' ') : 'custom';
    const button = h('button', {}, name, h('span', { class: 'sub' }, sub || ' '));
    button.addEventListener('click', () => fire(name, button));
    grid.append(button);
  }

  return h(
    'section',
    {},
    h('h2', {}, 'Sound effects'),
    h(
      'div',
      { class: 'row', style: 'margin-bottom:10px' },
      slider('Volume x', { min: 0, max: 2, step: 0.05, value: vol, onInput: (v) => ((vol = v), store.set('sfx:vol', v)) }),
      slider('Pitch (st)', { min: -12, max: 12, step: 0.5, value: pitch, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`, onInput: (v) => ((pitch = v), store.set('sfx:pitch', v)) }),
      slider('Pan', { min: -1, max: 1, step: 0.05, value: pan, onInput: (v) => ((pan = v), store.set('sfx:pan', v)) }),
    ),
    h('div', { class: 'row', style: 'margin-bottom:10px' }, spam.el),
    grid,
  );
}

// ------------------------------------------------------------------------------------------------
// Loops
// ------------------------------------------------------------------------------------------------

function loopRow(name: string): HTMLElement {
  let handle: LoopHandle | null = null;
  let vol = store.get(`loop:${name}:vol`, 1);
  let pitch = store.get(`loop:${name}:pitch`, 0);

  const toggle = h('button', {}, name);
  const setOn = (on: boolean): void => {
    toggle.classList.toggle('on', on);
  };
  toggle.addEventListener('click', () => {
    if (handle?.active) {
      handle.stop(0.3);
      handle = null;
      setOn(false);
      log(`loop "${name}" stop(0.3)`);
    } else {
      ensureUnlocked();
      handle = audio.startLoop(name, { vol, pitch });
      setOn(true);
      log(`loop "${name}" start`);
    }
  });

  return h(
    'div',
    { class: 'loop-row' },
    toggle,
    slider('Volume', { min: 0, max: 1, step: 0.01, value: vol, onInput: (v) => ((vol = v), store.set(`loop:${name}:vol`, v), handle?.setVolume(v)) }),
    slider('Pitch (st)', {
      min: -12,
      max: 12,
      step: 0.1,
      value: pitch,
      format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
      onInput: (v) => ((pitch = v), store.set(`loop:${name}:pitch`, v), handle?.setPitch(v)),
    }),
  );
}

function loopsPanel(): HTMLElement {
  const stopAll = h('button', {}, 'Stop all loops');
  stopAll.addEventListener('click', () => {
    audio.stopAllLoops(0.3);
    for (const b of document.querySelectorAll('.loop-row button')) b.classList.remove('on');
    log('stopAllLoops(0.3)');
  });
  return h(
    'section',
    {},
    h('h2', {}, 'Loops'),
    ...Object.keys(LOOP_DEFS).map(loopRow),
    h('div', { class: 'row', style: 'margin-top:10px' }, stopAll),
    h('p', { class: 'hint' }, 'In the game: volume = airspeed / fan distance ..., pitch = fan speed, wind whistle ...'),
  );
}

// ------------------------------------------------------------------------------------------------
// Page
// ------------------------------------------------------------------------------------------------

function mount(): void {
  const root = document.getElementById('lab');
  if (!root) return;
  root.replaceChildren(
    h('h1', {}, 'Gliderama Audio Lab'),
    statusPanel(),
    volumePanel(),
    musicPanel(),
    editorPanel(),
    sfxPanel(),
    loopsPanel(),
    h('section', {}, h('h2', {}, 'Log'), logEl),
  );
  // The first tap anywhere unlocks audio, so any button works first time.
  audio.autoUnlock();
  log('ready: tap anything (or "Unlock audio") to start the audio engine');
}

mount();

// Handy in the browser console: `audioLab.audio.playSfx('star')`
(window as unknown as { audioLab: unknown }).audioLab = { audio, compileSong, songs: { demo, alt, jingle } };
