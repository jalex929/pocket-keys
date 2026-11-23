/**
 * The instrument. The grand piano plays recordings of a real piano (the Salamander Grand Piano,
 * CC BY 3.0, credited on the page); the other voices are synthesized live with the Web Audio API.
 * The audio context is created on the first tap or key press, because browsers only allow sound
 * after the person interacts.
 */

import { drumFor } from "../engine/drums";
import { frequency } from "../engine/notes";
import type { Voice } from "../engine/tune";

export type VoiceGroup = "Instruments" | "Synths" | "Sound effects";

export interface VoiceInfo {
  id: Voice;
  label: string;
  hint: string;
  group: VoiceGroup;
}

export const VOICE_GROUPS: VoiceGroup[] = ["Instruments", "Synths", "Sound effects"];

export const VOICE_INFO: VoiceInfo[] = [
  { id: "grand", group: "Instruments", label: "Grand piano", hint: "A real grand piano, recorded" },
  { id: "epiano", group: "Instruments", label: "Electric piano", hint: "Warm and bell-like" },
  { id: "piano", group: "Instruments", label: "Soft keys", hint: "Gentle, like a felt piano" },
  { id: "organ", group: "Instruments", label: "Organ", hint: "Rings while you hold it" },
  {
    id: "strings",
    group: "Instruments",
    label: "Strings",
    hint: "Swells in slowly; hold the keys",
  },
  { id: "musicbox", group: "Instruments", label: "Music box", hint: "Tiny, twinkly and high" },
  { id: "marimba", group: "Instruments", label: "Marimba", hint: "A soft wooden knock" },
  { id: "bass", group: "Instruments", label: "Bass", hint: "Deep, two octaves down" },
  { id: "chip", group: "Synths", label: "Chiptune", hint: "Bleepy 8-bit square wave" },
  { id: "toy", group: "Synths", label: "90s toy", hint: "A wobbly toy keyboard" },
  { id: "lead", group: "Synths", label: "Synth lead", hint: "Bright and buzzy, for melodies" },
  { id: "pad", group: "Synths", label: "Space pad", hint: "Slow, shimmering chords" },
  { id: "drums", group: "Sound effects", label: "Drum kit", hint: "Every key is a different drum" },
  { id: "clap", group: "Sound effects", label: "Clap", hint: "Hand claps, higher up the keys" },
  { id: "laser", group: "Sound effects", label: "Laser", hint: "Pew pew" },
  { id: "alien", group: "Sound effects", label: "Alien", hint: "A wobbly voice from far away" },
  { id: "ufo", group: "Sound effects", label: "UFO", hint: "Hovering, warbling saucer" },
  { id: "robot", group: "Sound effects", label: "Robot", hint: "Beep boop, while you hold it" },
  { id: "bubble", group: "Sound effects", label: "Bubble", hint: "Bloop" },
  { id: "boing", group: "Sound effects", label: "Boing", hint: "A springy cartoon bounce" },
];

/**
 * Evens out loudness between voices (measured from rendered WAVs: peak and average level), so
 * switching sounds doesn't jump the volume.
 */
const TRIM: Partial<Record<Voice, number>> = {
  strings: 2.4,
  pad: 3.5,
  chip: 2,
  lead: 2,
  toy: 1.5,
  musicbox: 1.3,
  bass: 0.65,
  drums: 0.6,
  laser: 2.5,
  robot: 3.5,
  boing: 1.3,
};

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

// Two seconds of white noise per context, for drums, claps and hiss.
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
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
    // Only live playback needs waking; an offline renderer starts when it renders.
    const live = typeof AudioContext !== "undefined" && ctx instanceof AudioContext;
    if (live && ctx.state === "suspended") void ctx.resume().catch(() => {});
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
    const trim = ctx.createGain();
    trim.gain.value = TRIM[voice] ?? 1;
    filter.connect(env).connect(trim).connect(out);
    const oscs: AudioScheduledSourceNode[] = [];
    // Each part gets its own gain, so a part can fade on its own (a bell's overtones, a drum's
    // click); everything then goes through the shared filter and envelope.
    const part = (type: OscillatorType | "pulse", freq: number, gain: number, detune = 0) => {
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
      return { o, g };
    };
    const osc = (type: OscillatorType | "pulse", freq: number, gain: number, detune = 0) =>
      part(type, freq, gain, detune).o;
    /** Filtered noise with its own envelope: peak at `at`, gone after `decay` seconds. */
    const noise = (type: BiquadFilterType, freq: number, gain: number, decay: number, at = t) => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      const nf = ctx.createBiquadFilter();
      nf.type = type;
      nf.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      src.connect(nf).connect(g).connect(filter);
      src.start(t, Math.random());
      src.stop(at + decay + 0.05); // stops itself, so it is not in the oscs list
    };
    /** A slow wobble on a parameter (vibrato, tremolo). */
    const lfo = (
      rate: number,
      depth: number,
      target: AudioParam,
      type: OscillatorType = "sine",
    ) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start(t);
      oscs.push(o);
      return g;
    };
    /** Plays to the end on its own; letting go of the key doesn't cut it short. */
    let oneShot = 0;
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
      case "epiano": {
        // FM: a sine modulated by a sine. The modulation fades, so the tone goes from bright
        // bark to a soft round ring, with a short metallic "tine" on top.
        const carrier = osc("sine", f, 0.9);
        const mod = ctx.createOscillator();
        mod.frequency.value = f;
        const index = ctx.createGain();
        index.gain.setValueAtTime(f * 2.2, t);
        index.gain.exponentialRampToValueAtTime(f * 0.25, t + 1.2);
        mod.connect(index).connect(carrier.frequency);
        mod.start(t);
        oscs.push(mod);
        const tine = part("sine", f * 14, 0.05);
        tine.g.gain.setValueAtTime(0.05, t);
        tine.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        filter.frequency.value = 9000;
        env.gain.exponentialRampToValueAtTime(level * 1.1, t + 0.004);
        env.gain.exponentialRampToValueAtTime(level * 0.5, t + 0.6);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
        release = 0.4;
        break;
      }
      case "strings": {
        // A few detuned saws, darkened, swelling in, with a gentle vibrato once it's sounding.
        const saws = [-9, 0, 9].map((d) => osc("sawtooth", f, 0.28, d));
        const vib = lfo(5, 0, saws[0]!.detune);
        vib.gain.setValueAtTime(0, t + 0.3);
        vib.gain.linearRampToValueAtTime(7, t + 0.8);
        for (const s of saws.slice(1)) vib.connect(s.detune);
        filter.frequency.value = Math.min(6000, f * 4);
        filter.Q.value = 0.7;
        env.gain.linearRampToValueAtTime(level * 0.85, t + 0.28);
        release = 0.6;
        break;
      }
      case "musicbox": {
        // A small metal tine, an octave up: a pure tone with quickly fading bell overtones.
        osc("sine", f * 2, 0.7);
        const over = part("sine", f * 2 * 2.76, 0.25);
        over.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        const ping = part("sine", f * 2 * 5.4, 0.12);
        ping.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        filter.frequency.value = 14000;
        env.gain.exponentialRampToValueAtTime(level * 0.9, t + 0.002);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        oneShot = 2.3;
        break;
      }
      case "marimba": {
        // A wooden bar: the note plus a high overtone that dies almost at once.
        osc("sine", f, 1);
        const knock = part("sine", f * 4, 0.45);
        knock.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        const body = part("triangle", f * 10, 0.08);
        body.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
        filter.frequency.value = 8000;
        env.gain.exponentialRampToValueAtTime(level * 1.2, t + 0.003);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        oneShot = 1;
        break;
      }
      case "bass": {
        // Two octaves down: a saw and a square sub through a filter that closes after the pluck.
        osc("sawtooth", f / 4, 0.55);
        osc("square", f / 4, 0.3, -5);
        filter.Q.value = 5;
        filter.frequency.setValueAtTime(Math.min(4000, f * 2), t);
        filter.frequency.exponentialRampToValueAtTime(Math.max(120, f / 2), t + 0.35);
        env.gain.exponentialRampToValueAtTime(level * 1.4, t + 0.005);
        env.gain.setTargetAtTime(level * 0.9, t + 0.05, 0.3);
        release = 0.12;
        break;
      }
      case "lead": {
        // Two saws slightly apart and a sub, bright but not harsh.
        osc("sawtooth", f, 0.35, -10);
        osc("sawtooth", f, 0.35, 10);
        osc("square", f / 2, 0.15);
        filter.frequency.value = Math.min(7000, f * 6);
        filter.Q.value = 2;
        env.gain.exponentialRampToValueAtTime(level * 0.7, t + 0.01);
        env.gain.setTargetAtTime(level * 0.55, t + 0.05, 0.15);
        release = 0.15;
        break;
      }
      case "pad": {
        // Wide, slow and dreamy: detuned saws an octave apart, a filter that drifts open and
        // closed, a long fade in and out.
        for (const d of [-14, -5, 5, 14]) osc("sawtooth", f, 0.16, d);
        osc("sine", f * 2, 0.15, 3);
        filter.frequency.value = Math.min(3000, f * 2.5);
        lfo(0.25, Math.min(1500, f * 1.5), filter.frequency);
        env.gain.linearRampToValueAtTime(level * 0.9, t + 0.7);
        release = 1.6;
        break;
      }
      case "drums": {
        // Each key is a different drum (see engine/drums.ts); higher octaves are a touch tighter.
        const drum = drumFor(midi);
        const tight = Math.pow(2, (midi - 60) / 48);
        filter.frequency.value = 18000;
        env.gain.setValueAtTime(level * 2.4, t);
        const thump = (from: number, to: number, decay: number, gain = 1) => {
          const p = part("sine", from, gain);
          p.o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
          p.g.gain.setValueAtTime(gain, t);
          p.g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        };
        switch (drum) {
          case "kick":
            thump(160 * tight, 45 * tight, 0.45, 1.2);
            noise("lowpass", 1500, 0.15, 0.02);
            break;
          case "rim":
            thump(1700 * tight, 1600 * tight, 0.03, 0.4);
            noise("bandpass", 3500, 0.5, 0.03);
            break;
          case "snare":
          case "snap":
            thump(220 * tight, 160 * tight, 0.1, 0.5);
            noise("highpass", drum === "snare" ? 1200 : 2500, 0.7, drum === "snare" ? 0.22 : 0.12);
            break;
          case "clap":
            for (const [i, at] of [0, 0.012, 0.024].entries())
              noise("bandpass", 1200 * tight, 0.9 - i * 0.1, 0.02, t + at);
            noise("bandpass", 1200 * tight, 0.7, 0.18, t + 0.034);
            break;
          case "low tom":
          case "floor tom":
          case "mid tom": {
            const pitch = { "low tom": 110, "floor tom": 140, "mid tom": 180 }[drum] * tight;
            thump(pitch * 1.6, pitch, 0.35, 0.9);
            noise("lowpass", 3000, 0.08, 0.04);
            break;
          }
          case "closed hat":
          case "pedal hat":
            noise("highpass", 7500, 0.45, drum === "closed hat" ? 0.05 : 0.09);
            break;
          case "open hat":
            noise("highpass", 7000, 0.4, 0.4);
            break;
          case "crash":
            noise("highpass", 4500, 0.45, 1.3);
            noise("bandpass", 9000, 0.2, 0.8);
            break;
        }
        oneShot = 1.4;
        break;
      }
      case "clap": {
        // Several hands at once (quick bursts of noise), pitched by moving the filter.
        const center = Math.min(9000, 1200 * Math.pow(2, (midi - 60) / 12));
        for (const [i, at] of [0, 0.011, 0.023].entries())
          noise("bandpass", center, 0.9 - i * 0.1, 0.02, t + at);
        noise("bandpass", center, 0.75, 0.2, t + 0.033);
        filter.frequency.value = 18000;
        env.gain.setValueAtTime(level * 2.6, t);
        oneShot = 0.3;
        break;
      }
      case "laser": {
        // A square that plunges in pitch.
        const o = osc("square", f * 4, 0.5);
        o.frequency.exponentialRampToValueAtTime(f / 2, t + 0.25);
        filter.frequency.value = 5000;
        env.gain.exponentialRampToValueAtTime(level * 0.8, t + 0.003);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        oneShot = 0.32;
        break;
      }
      case "alien": {
        // Swoops up into the note, then warbles; a second voice a fifth up, ring-modulated, makes
        // it sound otherworldly.
        const a = osc("sine", f / 2, 0.7);
        a.frequency.exponentialRampToValueAtTime(f, t + 0.18);
        const b = osc("triangle", f * 1.5, 0.25);
        b.frequency.setValueAtTime(f * 0.75, t);
        b.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.18);
        lfo(6.5, 70, a.detune);
        lfo(6.5, 70, b.detune);
        const ring = ctx.createGain();
        ring.gain.value = 0;
        filter.disconnect();
        filter.connect(ring).connect(env);
        lfo(f * 0.51, 1, ring.gain);
        filter.frequency.value = 4000;
        env.gain.exponentialRampToValueAtTime(level * 1.2, t + 0.05);
        release = 0.3;
        break;
      }
      case "ufo": {
        // The classic flying saucer: a fast, wide pitch wobble that slowly speeds up.
        const o = osc("sine", f, 0.8);
        const o2 = osc("triangle", f * 2, 0.15);
        const rate = ctx.createOscillator();
        rate.frequency.setValueAtTime(8, t);
        rate.frequency.linearRampToValueAtTime(14, t + 2);
        const depth = ctx.createGain();
        depth.gain.value = 350;
        rate.connect(depth);
        depth.connect(o.detune);
        depth.connect(o2.detune);
        rate.start(t);
        oscs.push(rate);
        filter.frequency.value = 5000;
        env.gain.exponentialRampToValueAtTime(level * 0.85, t + 0.08);
        release = 0.4;
        break;
      }
      case "robot": {
        // Buzzy and boxy, chopped into quick beeps while you hold the key.
        osc("square", f, 0.4);
        osc("sawtooth", f * 1.5, 0.15);
        filter.type = "bandpass";
        filter.frequency.value = Math.min(4000, f * 3);
        filter.Q.value = 4;
        const chop = ctx.createGain();
        chop.gain.value = 0.5;
        filter.disconnect();
        filter.connect(chop).connect(env);
        lfo(11, 0.5, chop.gain, "square");
        env.gain.exponentialRampToValueAtTime(level * 1.6, t + 0.005);
        release = 0.06;
        break;
      }
      case "bubble": {
        // A quick upward chirp: the sound of a bubble popping up through water.
        const o = osc("sine", f, 0.9);
        o.frequency.exponentialRampToValueAtTime(f * 3, t + 0.09);
        filter.frequency.value = 9000;
        env.gain.exponentialRampToValueAtTime(level * 1.3, t + 0.004);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        oneShot = 0.18;
        break;
      }
      case "boing": {
        // A spring: a wobble in pitch that starts wide and settles onto the note.
        const o = osc("triangle", f / 2, 0.8);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        const sproing = lfo(13, 0, o.detune);
        sproing.gain.setValueAtTime(500, t);
        sproing.gain.exponentialRampToValueAtTime(5, t + 0.7);
        filter.frequency.value = 3500;
        env.gain.exponentialRampToValueAtTime(level * 1.3, t + 0.005);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
        oneShot = 0.82;
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

    if (oneShot > 0) {
      for (const o of oscs) o.stop(t + oneShot + 0.05);
      return () => {};
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
