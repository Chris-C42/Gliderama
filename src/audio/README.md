# Gliderama audio

Chiptune music and sound effects on plain WebAudio (no dependencies): a 4-channel-style synth (2 pulse,
triangle, noise), a hand-writable song notation, an sfxr-like sound-effect system, and continuous loops.

```ts
import { audio } from './audio';
import { demo } from './audio/songs';

window.addEventListener('pointerup', () => audio.unlock(), { once: true }); // first user gesture (or audio.autoUnlock())
audio.setMusicVolume(0.6);
audio.setSfxVolume(0.8);

audio.playMusic(demo, { fadeIn: 1 });
audio.playSfx('star');
audio.playSfx('bump', { vol: 0.4, pitch: -3 });            // vol multiplier, pitch in semitones, pan -1..1
const wind = audio.startLoop('wind');
wind.setVolume(airspeed01); wind.setPitch(2); wind.stop(0.3);
audio.crossfadeTo(otherSong, 2);
audio.stopMusic({ fadeOut: 1 });
```

**Try it:** `npm run dev`, open `/audio-lab.html`. Buttons for every sound, loops with live sliders, a level meter, and a
song editor where you can type a song and hear it (errors name the pattern, track and step).

## Contents

1. [API](#api) 2. [Song notation](#song-notation) 3. [Instruments](#instruments) 4. [Sound effects](#sound-effects)
5. [Loops](#loops) 6. [Engine behaviour](#engine-behaviour) 7. [Files, tests, tools](#files-tests-tools) 8. [Limitations](#known-limitations)

## API

`import { audio } from 'src/audio'`. Every call is safe before `unlock()` and outside a browser (Node, tests, SSR): it does
nothing, never throws.

| Call | |
|---|---|
| `unlock(): Promise<boolean>` | Creates the AudioContext (first call) and resumes it. **Call it synchronously from a user gesture** (`pointerup`, `touchend`, `click`, `keydown`). Idempotent. Resolves `true` once audio runs. |
| `isUnlocked(): boolean` | The context has been started by a gesture (stays true while the tab is suspended in the background). |
| `setMusicVolume(v)` / `setSfxVolume(v)` | Sliders `0..1`, smoothed, mapped through a squared curve (0.5 is about -12 dB). Safe to call before unlock; the values are applied when the context is created. |
| `playMusic(song, { fadeIn?, restart?, onEnd? })` | Plays a song (a `SongDef`) and replaces the current one. If that song is already current it keeps playing unless `restart: true`. `onEnd` fires when a non-looping song has finished. Before unlock the request is remembered and starts when audio runs. An invalid song logs a message naming pattern / track / step and is ignored. |
| `stopMusic({ fadeOut? })` | Fade-out (default 0.15 s). Also cancels a song that is waiting for unlock. |
| `crossfadeTo(song, seconds)` | Old song fades out and the new one fades in over `seconds` (time-based, not beat-synced). |
| `currentSong(): SongDef \| null` | The song most recently requested (playing, or waiting for unlock). |
| `playSfx(name, { vol?, pitch?, pan? }): boolean` | One-shot. `vol` multiplier, `pitch` in semitones, `pan` -1..1. Returns `false` if skipped (not unlocked, unknown name, cooldown). Never throws; an unknown name warns once. |
| `startLoop(name, { vol?, pitch?, fadeIn? }): LoopHandle` | Handle: `setVolume(v)`, `setPitch(semitones)`, `stop(fade?)`, `active`. A loop started before unlock begins when audio runs (keeping the latest volume/pitch); `stop()` before that cancels it. |
| `autoUnlock()` | Optional: installs one-time window listeners that call `unlock()` on the first gesture. |
| `stopAllLoops(fade?)` | Stops every running loop (e.g. when leaving a room). |
| `audio.sfx.register(name, def)` / `registerLoop(name, def)` | Add or replace sounds at runtime (validated). |
| `audio.engine`, `audio.music`, `audio.sfx` | The underlying objects (used by the lab). |

`playSfx` is *dropped*, not queued, before audio runs (a stale blip a second later would be wrong). The exception: the tap that
calls `unlock()` can already play its own sound, because scheduling is allowed while the context is resuming.

## Song notation

A song is a plain TypeScript object, typed `SongDef`. Complete example:

```ts
export const song: SongDef = {
  bpm: 128, stepsPerBeat: 4, loop: true,
  instruments: {
    lead:  { wave: 'pulse25', env: { a: 0, d: 0.08, s: 0.6, r: 0.1 }, vol: 0.5, vibrato: { depth: 0.15, rate: 6, delay: 0.12 } },
    bass:  { wave: 'triangle', env: { a: 0, d: 0, s: 1, r: 0.02 }, vol: 0.9 },
    arp:   { wave: 'pulse12', env: { a: 0, d: 0.1, s: 0.35, r: 0.05 }, vol: 0.25, arp: [0, 4, 7], arpSpeed: 0.03 },
    kick:  { wave: 'triangle', pitchEnv: { from: 48, to: -12, time: 0.08 }, env: { a: 0, d: 0.12, s: 0, r: 0 }, vol: 1 },
    snare: { wave: 'noise', env: { a: 0, d: 0.12, s: 0, r: 0 }, vol: 0.5, noiseRate: 1.0 },
    hat:   { wave: 'noise-short', env: { a: 0, d: 0.03, s: 0, r: 0 }, vol: 0.25 },
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
};
```

`src/audio/songs/demo.ts` is a fuller, commented example that uses every feature; copy it to start a song.

### Structure

| Field | |
|---|---|
| `bpm`, `stepsPerBeat` (default 4) | One **step** lasts `60 / (bpm * stepsPerBeat)` seconds (128 bpm, 4 steps: 0.117 s). Every token is one step. Use `stepsPerBeat: 2` for slower, 3 or 6 for triplets, 8 for 32nd-note detail. |
| `loop` (default `true`), `loopStart` | `loopStart` is an index into `order`: the loop jumps back there, so an intro plays once. |
| `volume` (default 1) | Overall level of this song, to balance songs against each other. |
| `instruments` | `{ name: InstrumentDef }`, see [Instruments](#instruments). |
| `tracks` | `name: 'instrument'` = a **pitched** track. `name: { k: 'kick', s: 'snare' }` = a **drum** track mapping one-character tokens to instruments. |
| `patterns` | `{ A: { trackName: 'tokens...' } }`. A string, or an **array of strings** (one per bar, handy for `//` comments). A pattern may leave tracks out: they are silent. |
| `order` | Play order: a pattern name, or `{ p, transpose?, times? }`. |

### Step tokens

Tokens are separated by spaces. `|` is a bar line: purely visual, ignored by the player (but counted in error messages).

| Token | Meaning |
|---|---|
| `C4` `C#4` `Db4` `a3` | A note: letter A-G (either case), optional `#` / `b`, octave **0-8**. `A4` = 440 Hz, `C4` = middle C (MIDI 60). |
| `-` | **Hold**: the previous note keeps sounding for one more step. |
| `.` | **Rest**: note off (the instrument's release rings out). |
| `\|` | Bar line, ignored. |

Optional suffixes on a note, in any order:

| Suffix | |
|---|---|
| `!` | Accent: +30 % volume. |
| `~` | Force vibrato on this note, from its very start (uses the instrument's depth/rate, or 0.3 semitones at 6 Hz if it has none). |
| `^` | Slide **up** into the note: starts 1 semitone below and bends up (`^^` = 2 semitones ... up to 12). Takes the instrument's `slide` time (default 50 ms). |
| `v` | Slide **down** into the note: starts 1 semitone above (`vv` = 2 ...). |
| `>` | **Glide** (portamento) from the previous note: the previous note simply moves to this pitch in the instrument's `glide` time (default 70 ms), without a new attack (legato). After a rest it is a plain note. |

`>` cannot be combined with `!`, `^` or `v`. `C4!~` and `E4>~` are fine (`~` on a glided note starts the vibrato at the glide).

```
C5 - - -        a quarter note (4 steps)
C5 - E5>  -     C5, then it glides up to E5 on the third step, no re-attack
C5! . C5 .      accented, rest, plain, rest
A4^ - - -       slides up into A4 from just below
```

A note is a **gate** from its step until the next token that is not `-`. A `-` with nothing to hold (the start of the song, after
a rest) is an error. Holds also work across pattern boundaries, so a pad can run through the bar lines.

### Drum tracks

A drum token is one or more drum letters from the track's map, each optionally followed by `!`:

```
beat: 'k . h . | s! . h . | kh . h k | s . h o'      // kh = kick and hat in the same step
```

`-` keeps the previous hit's gate open (only matters for drums with `s > 0`); `.` is a rest. Drums ignore transposition.

### Patterns, order, transposition

Every track present in a pattern must have the **same number of steps**, or compiling throws (the message lists all lengths).
Tracks missing from a pattern are silent for its duration.

```ts
order: [
  'intro',                                      // plays once if loopStart is 1
  { p: 'A', times: 2 },                         // the pattern twice
  'B',
  { p: 'B', transpose: { melody: 12 } },        // only the melody up an octave
  { p: 'A', transpose: 7 },                     // all pitched tracks up a fifth ("pattern A transposed +7")
],
loopStart: 1,
```

`transpose` is in semitones, either one number for all pitched tracks or `{ trackName: semitones }`. Notes that would leave the
MIDI range 0-127 are an error.

### Channels and envelopes

* **Each (track, instrument) pair is a monophonic channel**, like chip hardware: a new note cuts the tail of the previous one
  (a few ms fade), so `r` (release) rings out only after a rest or at the end of a song. Different drum instruments on one drum
  track do not cut each other.
* **Envelopes are linear** ADSR (`a`, `d`, `r` in seconds, `s` a level 0..1), as on real chips. If `s` is 0 the sound is
  *percussive*: it always plays its attack and decay in full, however short the step, instead of being cut at the end of the gate.
* Pitch curves are linear in semitones (exponential in Hz), so slides and glides sound even.

### Errors

Compiling throws a `SongError` whose message names where the problem is. `playMusic` catches it, logs it and ignores the song.

```
Pattern "A", track "melody", step 11 (bar 2, step 3): unknown token "H5"; expected a note (C4, C#4, Db4 ... octaves 0-8), "-" (hold) or "." (rest)
Pattern "A": all tracks must have the same number of steps, but found melody=16, low=14 (track "low" has 14 but track "melody" has 16)
Pattern "A", order[0], track "melody", step 1: "-" has nothing to hold (no note is sounding just before it); use "." for a rest
order[1]: unknown pattern "Z" (defined: A, B)
Pattern "A", track "beat", step 3: unknown drum "x" in token "x"; this drum track defines: k, s, h (use "." for a rest)
```

The pure functions are exported for tools and tests: `compileSong(def)` (validates and returns the timeline), `parseSong(def)`
(the same, cached by object identity: songs are parsed once), `noteToFreq('A4')`, `noteToMidi`, `midiToFreq`.

## Instruments

```ts
{ wave, env?, vol?, vibrato?, pitchEnv?, arp?, arpSpeed?, noiseRate?, pitch?, glide?, slide?, pan?, filter? }
```

| Field | |
|---|---|
| `wave` | `pulse12` `pulse25` `pulse50` `pulse75` (duty cycles 12.5 / 25 / 50 / 75 %), `triangle` (4-bit stepped like the NES), `noise` (15-bit LFSR, long 32767-step mode: white-ish), `noise-short` (short 93-step "metallic" mode). |
| `env` | `{ a, d, s, r }`, default `{ a: 0, d: 0, s: 1, r: 0.02 }`. |
| `vol` | 0..1 (up to 4). All waves are level-matched (equal RMS), so this is a pure mixing control. |
| `vibrato` | `{ depth, rate, delay?, auto? }`: depth in **semitones** (0.15 = 15 cents each way), rate in Hz, `delay` seconds before it fades in. Applies to all notes unless `auto: false` (then only `~` notes). |
| `pitchEnv` | `{ from, to, time }`: at the start of every note the pitch sweeps from `from` to `to` semitones relative to the note, over `time` seconds. This is the kick drum. |
| `arp`, `arpSpeed` | Chord arpeggio: `arp: [0, 4, 7]` cycles those semitone offsets every `arpSpeed` seconds (default 0.03). One note in, a chord out. One shape per instrument: use two instruments for major and minor (see the demo). |
| `noiseRate` | Noise waves: playback-rate multiplier (1 = native clock; 0.2 dark rumble; 4 hissy/high metallic). |
| `pitch` | Base note for drum-track hits and the reference for `pitchEnv`. Default `C2` for tonal waves. (Noise waves use `noiseRate`; a pitched noise track shifts the rate by octaves relative to C4.) |
| `glide`, `slide` | Seconds for `>` (default 0.07) and `^`/`v` (default 0.05). |
| `pan` | -1..1. |
| `filter` | `{ type: 'lowpass' \| 'highpass' \| 'bandpass', freq, q? }`: not chip-authentic, but handy for noise drums. |

## Sound effects

Defined in `sfx-defs.ts` (placeholders: tune freely, it is all data). A definition is one voice plus optional `layers` (more voices
played together):

```ts
star: {
  wave: 'pulse50', freq: 1318.5, duration: 0.3, vol: 0.35, gain: 1.15,
  env: { a: 0, d: 0.25, s: 0, r: 0.03 },
  arp: { steps: [0, 7], interval: 0.07, mode: 'once', retrigger: true },   // two notes
  layers: [{ wave: 'pulse12', freq: 2637, duration: 0.3, vol: 0.12, env: { a: 0, d: 0.25, s: 0, r: 0.03 } }],
  maxVoices: 6,
}
```

| Parameter | |
|---|---|
| `wave` | `pulse12/25/50/75`, `triangle`, `noise`, `noise-short`, plus `sine` and `saw`. |
| `freq` | Start frequency in Hz. **Noise waves:** the noise clock, about 44100 = full-band white noise, 8000 = darker, 1000 = rumble (for `noise-short` the buzz pitch is freq / 93). |
| `endFreq`, `slideTime`, `slideCurve` | Glide to `endFreq` over `slideTime` (default: the duration). `slideCurve` 1 = even, >1 slow start / fast end, <1 the opposite. |
| `path` | A free pitch contour `[[seconds, Hz], ...]` after the start (meow, boing); replaces `endFreq`. |
| `duration`, `env`, `vol` | Gate length (s); ADSR (default `{ a: 0.002, d: 0, s: 1, r: 0.03 }`); loudness 0..1 (default 0.5). |
| `gain` | Level multiplier of the **whole** sound including layers: the knob for balancing loudness. |
| `vibrato` | `{ depth (semitones), rate (Hz), delay }`. |
| `arp` | `{ steps: [semitones], interval, mode?, retrigger? }`. `mode: 'cycle'` (default) repeats the steps (a chord); `'once'` steps through them and holds the last (a jingle). `retrigger: true` restarts the envelope at every step (separate notes). |
| `filter` | `{ type, freq, endFreq?, time?, q? }`: low-pass / high-pass / band-pass, optionally swept exponentially. |
| `repeat` | `{ count, interval, volDecay?, pitchStep? }`: retriggers the voice (crackle, beeps, click-clack). |
| `jitter` | Random pitch variation in semitones (plus or minus), re-rolled on every play. |
| `delay` | (layers) seconds before the voice starts. |
| `cooldown` | Minimum seconds between two plays: stops spam stacking. |
| `maxVoices` | Maximum simultaneous plays (default 4); beyond that the **oldest is cut** (a quick fade) to make room. |

Built-in names: `throw` `fold` `unfold` `crumple` `bump` `burn` `splash` `star` `sheet` `tape` `switch` `click` `back` `hover`
`stall` `turn` `duct` `win` `lose` `unlock` `select` `error` `pop` `toast` `meow` `boost`. `playSfx` options: `vol` multiplies the
volume (e.g. scale `bump` by impact speed), `pitch` shifts oscillators, noise clock and filter cutoffs together, `pan` places it
in the stereo field.

The placeholders were level-balanced by **measurement** (peaks about -8 dBFS, jingles slightly hotter, `hover` deliberately faint),
not by ear. They are meant to be replaced by tuned versions.

## Loops

`startLoop('wind')` returns a handle. A loop is layers of looping noise (white, pink, brown, procedural crackle) and oscillators, each
with filters and slow LFO modulation, so it never sounds like a short repeating sample (the `fan`, abridged):

```ts
fan: { vol: 0.36, layers: [
  { source: 'triangle', freq: 96, gain: 0.5, filters: [{ type: 'lowpass', freq: 900 }], mods: [{ target: 'freq', rates: [0.6], depth: 1.5 }] },
  { source: 'white', gain: 1.3, filters: [{ type: 'bandpass', freq: 1100, q: 0.8 }], mods: [{ target: 'gain', rates: [24], depth: 0.45 }] },
] }
```

`setVolume(v)` and `setPitch(semitones)` ramp smoothly. `setPitch` shifts oscillator frequencies and filter cutoffs (per layer:
`pitchTrack` for the source, `track` on a filter; noise buffers default to not following). Built-in: `wind` `vent` `fan` `fire` `rain`,
all around -21 dBFS RMS at volume 1, so they sit under music. `mods` rates may list several incommensurate frequencies
(`[0.11, 0.23, 0.37]`) for organic gusts.

## Engine behaviour

```
 music bus ─┐
            ├─► master gain ─► DynamicsCompressor (limiter) ─► destination
 sfx bus   ─┘
```

* **Lazy, iOS-safe unlock.** The AudioContext is created in `unlock()`. It calls `resume()` inside the gesture and plays a
  1-sample silent buffer. Chip waves and the LFSR noise buffers are pre-built then; the bigger ambient-loop noise buffers are
  generated one per timer task right after, so no frame stalls.
* **Visibility.** `visibilitychange`: hidden suspends the context, visible resumes it, but only if it was running before. After an
  interruption (an iOS phone call) the next user gesture resumes it.
* **Scheduling.** A single ~25 ms `setInterval` (`SCHEDULE_INTERVAL_MS`) schedules everything due in the next ~120 ms
  (`LOOKAHEAD_SECONDS`) at exact AudioContext times: notes are sample-accurate and independent of frame rate. Nothing is ever
  scheduled from `requestAnimationFrame`. Event times are `origin + step * stepDuration + pass * loopLength`, products rather than
  sums, so tempo cannot drift and loops are seamless. Measured on Chromium with a recorder on the audio thread while the main
  thread was kept busy (12 ms of work every 40 ms): 11 kick hits over 10 s, one per second, were 1000.000 ms apart (the
  detector resolves 0.09 ms). If the main thread stalls, late notes (up to 80 ms) are still started with a shortened gate,
  longer-held notes catch up, and the rest are skipped rather than machine-gunned; a stall longer than the 120 ms lookahead
  can therefore drop the hit that was due during it.
* **Levels.** Slider `v` becomes gain `v^2`. Music bus x1, SFX bus x1.5 (so effects stand above music). The browser's compressor
  adds about +2.1 dB of automatic makeup gain, which the master gain (x0.78) cancels: the chain is unity up to about half scale and
  soft-limits above, so peaks stay near full scale. At the default sliders (0.6 / 0.8) the demo song sits around -20 dBFS RMS.
* **Per-context caches.** PeriodicWaves and noise buffers are built once per context. Songs are compiled once per object.

## Files, tests, tools

| File | |
|---|---|
| `notation.ts` | **Pure.** Types, note maths, tokenizer, validation, `compileSong` -> timeline of note events (start / duration in seconds). |
| `plan.ts` | **Pure.** Envelope, pitch-curve (slides, glides, arps, sweeps) and voice planning. |
| `waves.ts` | **Pure.** Fourier coefficients for pulses and the 4-bit triangle, LFSR noise, procedural noise. |
| `sequencer.ts` | **Pure.** `SongCursor`: lookahead scheduling logic (what is due in a window, looping, catch-up). |
| `sfx-plan.ts` | **Pure.** `SfxDef` and `planSfx`. |
| `chip.ts` | WebAudio: per-context resources and `startVoice`. Works with `OfflineAudioContext` too. |
| `engine.ts` | AudioContext lifecycle, buses, limiter, visibility, the scheduler timer. |
| `music.ts` | `MusicPlayer`, and `renderSong(ctx, dest, song, seconds)` to render any stretch of a song offline. |
| `sfx.ts`, `loops.ts`, `sfx-defs.ts` | Sound-effect runtime, loop runtime, the placeholder content. |
| `songs/` | `demo` (every feature), `alt` (a second loop to crossfade to), `jingle` (non-looping, `onEnd`). |
| `index.ts`, `lab.ts` | The `audio` singleton; the lab page (`/audio-lab.html`). |

Tests (`tests/audio-*.test.ts`) cover note frequencies, token parsing, drum mapping, validation errors, order/transposition,
event timelines, envelopes and pitch plans, waveform maths, the lookahead cursor (exact tempo, no drift over 100 000 loops),
the engine lifecycle (unlock, visibility, interruptions), the player, SFX cooldown/polyphony and loops, using a recording fake
AudioContext (`tests/audio-fake-context.ts`). Every shipped song and sound is compiled and validated by the tests.

Because `chip.ts` and `music.ts` accept any `BaseAudioContext`, a song can be rendered offline, e.g. to inspect it:

```ts
const ctx = new OfflineAudioContext(2, 44100 * 30, 44100);
renderSong(ctx, ctx.destination, demo, 30);
const buffer = await ctx.startRendering();
```

## Known limitations

* **Not auditioned by ear.** Levels, sweeps and tempo were verified by rendering in a real browser engine and measuring (RMS,
  peaks, pitch, spectral centroid, onset timing). The placeholder sounds and the demo song have not been tuned by listening.
* One `arp` shape per instrument (chord quality = instrument).
* A glided note (`>`) cannot carry an accent (`!`), and there is no per-note volume other than `!`.
* A song has one fixed tempo and a uniform step grid: no swing, no tempo changes (use `stepsPerBeat` 3/6/12 for triplet feels).
* Envelopes are linear but not quantised to hardware volume steps; there is no pulse-channel sweep unit. It is chip-*style*, not an
  emulator.
* Crossfades are time-based, not aligned to the beat.
* The scheduler is a main-thread timer: a stall longer than ~120 ms can delay or drop notes (it recovers, see above). Backgrounded
  tabs are suspended instead.
* iOS: the hardware silent switch mutes WebAudio. If the game should ignore it, set `navigator.audioSession.type = 'playback'`
  (iOS 16.4+) in the app.
* `playSfx` before audio runs is dropped (not queued); music and loops are deferred.
