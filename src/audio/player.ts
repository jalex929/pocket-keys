/**
 * Plays a recorded tune on repeat. Notes are scheduled a little ahead on the audio clock (not
 * with timers), so playback stays in time even when the page is busy; timers only drive the
 * on-screen key lights.
 */

import { notesInWindow, soundLength, type Tune } from "../engine/tune";
import type { Synth } from "./synth";

const TICK_MS = 25;
const LOOKAHEAD_MS = 120;

export class LoopPlayer {
  private timer: number | null = null;
  private lights: number[] = [];
  private releases: ((when?: number) => void)[] = [];

  constructor(
    private readonly synth: Synth,
    /** Called when a played note lights up (true) or goes dark (false) on screen. */
    private readonly onLight: (midi: number, on: boolean) => void,
  ) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  play(tune: Tune) {
    this.stop();
    const ctx = this.synth.wake();
    if (!ctx || tune.notes.length === 0) return;
    const startAudio = ctx.currentTime + 0.06;
    let scheduledUntil = 0;
    const tick = () => {
      const elapsed = (ctx.currentTime - startAudio) * 1000;
      const until = Math.max(0, elapsed) + LOOKAHEAD_MS;
      for (const { note, at } of notesInWindow(tune, scheduledUntil, until)) {
        const on = startAudio + at / 1000;
        // The sound can ring on (sustain pedal); the key on screen goes up when it did.
        const off = on + soundLength(tune, note) / 1000;
        const release = this.synth.noteOn(note.midi, tune.voice, on);
        release(off);
        this.releases.push(release);
        const delay = Math.max(0, (on - ctx.currentTime) * 1000);
        this.lights.push(
          window.setTimeout(() => this.onLight(note.midi, true), delay),
          window.setTimeout(() => this.onLight(note.midi, false), delay + note.length),
        );
      }
      scheduledUntil = until;
      // Forget finished timers and releases so a long session doesn't pile them up.
      if (this.releases.length > 256) this.releases.splice(0, this.releases.length - 64);
      if (this.lights.length > 512) this.lights.splice(0, this.lights.length - 128);
    };
    tick();
    this.timer = window.setInterval(tick, TICK_MS);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const id of this.lights) window.clearTimeout(id);
    this.lights = [];
    // Let go of the loop's own notes only, so keys you're holding keep sounding.
    for (const release of this.releases) release();
    this.releases = [];
  }
}
