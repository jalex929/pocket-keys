/**
 * The instrument. The grand piano plays recordings of a real piano (the Salamander Grand Piano,
 * CC BY 3.0, credited on the page); the other voices are synthesized live with the Web Audio API.
 * The audio context is created on the first tap or key press, because browsers only allow sound
 * after the person interacts.
 */

import { frequency } from "../engine/notes";
import type { Voice } from "../engine/tune";

export interface VoiceInfo {
  id: Voice;
  label: string;
  hint: string;
}

export const VOICE_INFO: VoiceInfo[] = [
  { id: "grand", label: "Grand piano", hint: "A real grand piano, recorded" },
  { id: "piano", label: "Soft keys", hint: "Gentle, like a felt piano" },
  { id: "chip", label: "Chiptune", hint: "Bleepy 8-bit square wave" },
  { id: "organ", label: "Organ", hint: "Rings while you hold it" },
  { id: "toy", label: "90s toy", hint: "A wobbly toy keyboard" },
];

/** How many notes can sound at once; the oldest is let go past this. */
const MAX_POLYPHONY = 16;

// ---------- Grand piano samples ----------

/** Recorded notes: C, D#, F# and A in octaves 1 to 7, plus C8. Others are pitched from the nearest. */
const SAMPLE_NAMES = ["C", "Ds", "Fs", "A"];
const SAMPLE_OFFSETS = [0, 3, 6, 9];
export const PIANO_SAMPLES: { midi: number; file: string }[] = [
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((octave) =>
    SAMPLE_NAMES.map((name, i) => ({
      midi: (octave + 1) * 12 + SAMPLE_OFFSETS[i]!,
      file: `${name}${octave}.mp3`,
    })),
  ),
  { midi: 108, file: "C8.mp3" },
];

/** The nearest recorded note to `midi` (at most 1.5 semitones away inside the range). */
export function nearestSample(midi: number): number {
  let best = PIANO_SAMPLES[0]!.midi;
  for (const { midi: m } of PIANO_SAMPLES) if (Math.abs(m - midi) < Math.abs(best - midi)) best = m;
  return best;
}

// Decoded audio isn't tied to one context, so the speakers and the WAV renderer share it.
const pianoBuffers = new Map<number, AudioBuffer>();
let pianoLoading: Promise<void> | null = null;

function loadPiano(ctx: BaseAudioContext): Promise<void> {
  if (pianoLoading) return pianoLoading;
  if (typeof fetch !== "function") return Promise.resolve();
  const base = `${import.meta.env.BASE_URL}samples/piano/`;
  pianoLoading = Promise.all(
    PIANO_SAMPLES.map(async ({ midi, file }) => {
      try {
        const res = await fetch(base + file);
        if (!res.ok) return;
        pianoBuffers.set(midi, await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // A missing note falls back to the synthesized piano.
      }
    }),
  ).then(() => undefined);
  return pianoLoading;
}

interface Sounding {
  midi: number;
  stop: (at: number) => void;
}

export class Synth {
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private pulse: PeriodicWave | null = null;
  private volume = 0.7;
  private readonly sounding: Sounding[] = [];

  /**
   * Pass a context to render somewhere else (an OfflineAudioContext for downloads); leave it out
   * to play through the speakers.
   */
  constructor(ctx?: BaseAudioContext) {
    if (ctx) this.setup(ctx);
  }

  /** Creates the audio context if needed. Call from a tap, click or key press. */
  wake(): BaseAudioContext | null {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.setup(new Ctor({ latencyHint: "interactive" }));
      } catch {
        return null;
      }
    }
    const ctx = this.ctx;
    if (ctx && "resume" in ctx && ctx.state === "suspended") void (ctx as AudioContext).resume();
    return ctx;
  }

  private setup(ctx: BaseAudioContext) {
    {
      this.ctx = ctx;
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.6;
      this.master.connect(this.comp).connect(this.ctx.destination);
      // A 25% pulse: the classic thin, nasal 8-bit tone.
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
      this.pulse = this.ctx.createPeriodicWave(real, imag);
      void loadPiano(this.ctx);
    }
  }

  /** Resolves once the piano recordings are loaded (or have failed to). */
  ready(): Promise<void> {
    return this.ctx ? loadPiano(this.ctx) : Promise.resolve();
  }

  /** Current audio time, or 0 before the first sound. */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx)
      this.master.gain.setTargetAtTime(this.volume * 0.6, this.ctx.currentTime, 0.02);
  }

  /**
   * Starts a note. `at` is an audio time (for loop playback); omit it to play now.
   * Returns a function that releases the note.
   */
  noteOn(midi: number, voice: Voice, at?: number): (when?: number) => void {
    const ctx = this.wake();
    if (!ctx || !this.master) return () => {};
    const t = Math.max(ctx.currentTime, at ?? ctx.currentTime);
    const stop = this.build(ctx, this.master, midi, voice, t);
    const entry: Sounding = { midi, stop };
    this.sounding.push(entry);
    if (this.sounding.length > MAX_POLYPHONY) this.sounding.shift()?.stop(ctx.currentTime);
    let released = false;
    return (when?: number) => {
      if (released) return;
      released = true;
      const i = this.sounding.indexOf(entry);
      if (i >= 0) this.sounding.splice(i, 1);
      stop(Math.max(t, when ?? ctx.currentTime));
    };
  }

  /** Releases every note (used when stopping playback or leaving the page). */
  allOff() {
    const t = this.now();
    for (const s of this.sounding.splice(0)) s.stop(t);
  }

  private build(
    ctx: BaseAudioContext,
    out: AudioNode,
    midi: number,
    voice: Voice,
    t: number,
  ): (at: number) => void {
    const f = frequency(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.connect(env).connect(out);
    const oscs: AudioScheduledSourceNode[] = [];
    const osc = (type: OscillatorType | "pulse", freq: number, gain: number, detune = 0) => {
      const o = ctx.createOscillator();
      if (type === "pulse" && this.pulse) o.setPeriodicWave(this.pulse);
      else o.type = type === "pulse" ? "square" : type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(filter);
      o.start(t);
      oscs.push(o);
      return o;
    };
    // Softer for high notes so a run up the keyboard doesn't get shrill.
    const level = 0.32 * Math.min(1, 1.25 - (midi - 60) / 96);
    let release = 0.25;

    const sample = voice === "grand" ? pianoBuffers.get(nearestSample(midi)) : undefined;
    if (voice === "grand" && !sample) voice = "piano"; // still loading: use the synth piano

    switch (voice) {
      case "grand": {
        // The recording does its own strike and decay; releasing lets the damper fall.
        const src = ctx.createBufferSource();
        src.buffer = sample!;
        src.playbackRate.value = Math.pow(2, (midi - nearestSample(midi)) / 12);
        src.connect(filter);
        filter.frequency.value = 18000;
        src.start(t);
        oscs.push(src);
        env.gain.setValueAtTime(level * 4, t);
        release = 0.45;
        break;
      }
      case "piano": {
        // Struck and fading: bright at the hit, mellowing as it decays.
        osc("triangle", f, 0.8);
        osc("sine", f * 2, 0.22);
        osc("sine", f, 0.4, 4);
        filter.frequency.setValueAtTime(Math.min(9000, f * 9), t);
        filter.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2), t + 1.6);
        env.gain.exponentialRampToValueAtTime(level, t + 0.006);
        env.gain.exponentialRampToValueAtTime(level * 0.35, t + 0.45);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
        release = 0.35;
        break;
      }
      case "chip": {
        osc("pulse", f, 0.55);
        filter.frequency.value = 7000;
        env.gain.exponentialRampToValueAtTime(level * 0.8, t + 0.004);
        env.gain.setTargetAtTime(level * 0.55, t + 0.05, 0.08);
        release = 0.08;
        break;
      }
      case "organ": {
        // Drawbar-style: the note plus a few harmonics, steady while held.
        osc("sine", f, 0.7);
        osc("sine", f * 2, 0.45);
        osc("sine", f * 3, 0.25);
        osc("sine", f * 4, 0.15);
        osc("sine", f / 2, 0.3);
        filter.frequency.value = 6000;
        env.gain.exponentialRampToValueAtTime(level * 0.75, t + 0.02);
        release = 0.12;
        break;
      }
      case "toy": {
        // Cheap and cheerful: a buzzy square, slightly detuned, with a delayed wobble.
        const a = osc("square", f, 0.35, -7);
        const b = osc("square", f, 0.35, 7);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(18, t + 0.35);
        lfo.connect(depth);
        depth.connect(a.detune);
        depth.connect(b.detune);
        lfo.start(t);
        oscs.push(lfo);
        filter.frequency.value = Math.min(5000, f * 6);
        filter.Q.value = 3;
        env.gain.exponentialRampToValueAtTime(level * 0.7, t + 0.01);
        env.gain.setTargetAtTime(level * 0.45, t + 0.08, 0.2);
        release = 0.15;
        break;
      }
    }

    return (at: number) => {
      const end = Math.max(at, t + 0.02);
      // Hold the level wherever the envelope is at that moment, then fade from there.
      const g = env.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(end);
      else {
        g.cancelScheduledValues(end);
        g.setValueAtTime(Math.max(0.0001, g.value), end);
      }
      env.gain.setTargetAtTime(0.0001, end, release / 4);
      for (const o of oscs) o.stop(end + release + 0.05);
    };
  }
}
