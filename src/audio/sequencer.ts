/**
 * The song cursor: PURE lookahead scheduling logic.
 *
 * Given a compiled song and the audio-clock time at which it started (`origin`), `drain(until)` returns
 * the events whose start time falls before `until`, each exactly once and in order, wrapping around the
 * loop point as needed. The music player calls it every ~25 ms with `now + 120 ms`.
 *
 * Event times are always computed as `origin + event.start + pass * loopLength` (a product of integers
 * and exact step multiples, never an accumulated sum), so tempo cannot drift however long the song loops.
 */

import type { CompiledSong, NoteEvent } from './notation';

export interface TimedEvent {
  event: NoteEvent;
  /** Absolute start time on the audio clock, in seconds. */
  time: number;
  /** Which pass through the song (0 = first). */
  pass: number;
  /** Unique, stable number for this occurrence (pass * events + index), e.g. to seed hit variation. */
  serial: number;
}

export class SongCursor {
  private pass = 0;
  private index = 0;
  private done = false;
  /** Index of the first event of the looping part (start >= loopStart). */
  private readonly firstLoopIndex: number;

  constructor(
    readonly song: CompiledSong,
    /** Audio-clock time at which song time 0 occurs. */
    readonly origin: number,
  ) {
    const i = song.events.findIndex((e) => e.start >= song.loopStart - 1e-9);
    this.firstLoopIndex = i < 0 ? song.events.length : i;
  }

  /** Audio-clock time at which the (non-looping) song's last step ends. */
  get endTime(): number {
    return this.origin + this.song.duration;
  }

  /** True once a non-looping song has handed out all its events. */
  get finished(): boolean {
    return this.done;
  }

  /** The pass the cursor is currently in. */
  get currentPass(): number {
    return this.pass;
  }

  /** Absolute time of an event occurrence. */
  timeOf(event: NoteEvent, pass: number): number {
    return this.origin + event.start + pass * this.song.loopLength;
  }

  /**
   * Returns all not-yet-returned events with `time < until`, in order. Events earlier than
   * `notBefore` are skipped without being returned (used to catch up cheaply after a long stall).
   */
  drain(until: number, notBefore = -Infinity): TimedEvent[] {
    const out: TimedEvent[] = [];
    const { song } = this;
    const events = song.events;
    if (this.done) return out;

    // Jump over whole passes that lie entirely before `notBefore`.
    if (song.loop && notBefore > this.origin + song.duration && this.firstLoopIndex < events.length) {
      const pass = Math.floor((notBefore - this.origin - song.loopStart) / song.loopLength);
      if (pass > this.pass) {
        this.pass = pass;
        this.index = this.firstLoopIndex;
      }
    }

    for (;;) {
      if (this.index >= events.length) {
        if (!song.loop) {
          this.done = true;
          break;
        }
        if (this.firstLoopIndex >= events.length) break; // nothing to repeat
        this.pass++;
        this.index = this.firstLoopIndex;
      }
      const event = events[this.index]!;
      const time = this.timeOf(event, this.pass);
      if (time >= until) break;
      if (time >= notBefore) out.push({ event, time, pass: this.pass, serial: this.pass * events.length + this.index });
      this.index++;
    }
    return out;
  }
}
