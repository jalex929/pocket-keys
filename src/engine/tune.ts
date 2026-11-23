/**
 * A tune is a short recording: which notes were played, when, and for how long, plus the voice.
 * Plain data, so it can be looped, tested and squeezed into a share link.
 */

export const VOICES = ["grand", "piano", "chip", "organ", "toy"] as const;
export type Voice = (typeof VOICES)[number];

export interface TuneNote {
  midi: number;
  /** Milliseconds from the start of the tune. */
  start: number;
  /** Milliseconds the note was held. */
  length: number;
}

export interface Tune {
  voice: Voice;
  /** Loop length in milliseconds (from the start of recording to Stop). */
  length: number;
  notes: TuneNote[];
}

/** Longest tune kept: enough for a riff, short enough for a link. */
export const MAX_TUNE_MS = 30_000;
export const MAX_NOTES = 400;
const MIN_TUNE_MS = 250;

/**
 * Records notes as they're played. Times come from the caller (performance.now() in the app,
 * plain numbers in tests), so it's deterministic. Without a start time, the clock starts on the
 * first note, so a loop never opens with dead air.
 */
export class Recorder {
  private t0: number | null;
  private readonly open = new Map<number, number>();
  private readonly notes: TuneNote[] = [];

  constructor(startTime?: number) {
    this.t0 = startTime ?? null;
  }

  /** True once the clock is running (after the first note, if no start time was given). */
  get started(): boolean {
    return this.t0 !== null;
  }

  /** Time since recording started (0 while waiting for the first note). */
  elapsed(now: number): number {
    return this.t0 === null ? 0 : now - this.t0;
  }

  /** True when the recording has hit its time or note limit. */
  full(now: number): boolean {
    return this.elapsed(now) >= MAX_TUNE_MS || this.notes.length >= MAX_NOTES;
  }

  noteOn(midi: number, now: number) {
    if (this.t0 === null) this.t0 = now;
    if (this.full(now)) return;
    if (this.open.has(midi)) this.noteOff(midi, now);
    this.open.set(midi, this.elapsed(now));
  }

  noteOff(midi: number, now: number) {
    const start = this.open.get(midi);
    if (start === undefined) return;
    this.open.delete(midi);
    const end = Math.min(this.elapsed(now), MAX_TUNE_MS);
    this.notes.push({ midi, start, length: Math.max(30, end - start) });
  }

  /** Ends the recording. Returns null if nothing was played. */
  stop(now: number, voice: Voice): Tune | null {
    for (const midi of [...this.open.keys()]) this.noteOff(midi, now);
    if (this.notes.length === 0) return null;
    const length = Math.max(MIN_TUNE_MS, Math.min(MAX_TUNE_MS, Math.round(this.elapsed(now))));
    const notes = this.notes
      .filter((n) => n.start < length)
      .map((n) => ({
        midi: n.midi,
        start: Math.round(n.start),
        length: Math.round(Math.min(n.length, length - n.start)),
      }))
      .sort((a, b) => a.start - b.start || a.midi - b.midi);
    return { voice, length, notes };
  }
}

/** Notes that start in [from, to) of a looping tune, with their absolute start times. */
export function notesInWindow(
  tune: Tune,
  from: number,
  to: number,
): { note: TuneNote; at: number }[] {
  const out: { note: TuneNote; at: number }[] = [];
  if (tune.length <= 0 || to <= from) return out;
  const firstLoop = Math.floor(from / tune.length);
  const lastLoop = Math.floor((to - 1e-9) / tune.length);
  for (let loop = firstLoop; loop <= lastLoop; loop++) {
    const offset = loop * tune.length;
    for (const note of tune.notes) {
      const at = offset + note.start;
      if (at >= from && at < to) out.push({ note, at });
    }
  }
  return out;
}

// ---------- Share links ----------
//
// A tune becomes a short text string: version, voice, length, then each note as
// midi.start.length in base 36 with times in 10 ms steps. Example: "1~toy~bk~1o.0.f~1q.g.f".

const VERSION = "1";
const STEP_MS = 10;

export function encodeTune(tune: Tune): string {
  const n = (ms: number) => Math.round(ms / STEP_MS).toString(36);
  const notes = tune.notes.map((x) => `${x.midi.toString(36)}.${n(x.start)}.${n(x.length)}`);
  return [VERSION, tune.voice, n(tune.length), ...notes].join("~");
}

/** Reads a share string. Returns null for anything malformed, never throws. */
export function decodeTune(text: string): Tune | null {
  const parts = text.split("~");
  if (parts.length < 4 || parts[0] !== VERSION) return null;
  const voice = parts[1] as Voice;
  if (!VOICES.includes(voice)) return null;
  const num = (s: string | undefined) => (s && /^[0-9a-z]{1,6}$/.test(s) ? parseInt(s, 36) : NaN);
  const length = num(parts[2]) * STEP_MS;
  if (!Number.isFinite(length) || length < MIN_TUNE_MS || length > MAX_TUNE_MS) return null;
  const noteParts = parts.slice(3);
  if (noteParts.length > MAX_NOTES) return null;
  const notes: TuneNote[] = [];
  for (const part of noteParts) {
    const [m, s, l] = part.split(".");
    const midi = num(m);
    const start = num(s) * STEP_MS;
    const len = num(l) * STEP_MS;
    if (![midi, start, len].every(Number.isFinite)) return null;
    if (midi < 21 || midi > 108 || start >= length || len <= 0) return null;
    notes.push({ midi, start, length: Math.min(len, length - start) });
  }
  return { voice, length, notes };
}
