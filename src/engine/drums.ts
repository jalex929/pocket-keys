/**
 * The drum kit voice: every key in an octave is a different drum, laid out the way General MIDI
 * lays out drums (kick on C, snare on D, hi-hats on the black keys of F#, G# and A#), so a
 * drum loop saved as MIDI opens in any music app as the same drums.
 */

export type Drum =
  | "kick"
  | "rim"
  | "snare"
  | "clap"
  | "snap"
  | "low tom"
  | "closed hat"
  | "floor tom"
  | "pedal hat"
  | "mid tom"
  | "open hat"
  | "crash";

/** One drum per note of the octave, starting at C. */
export const DRUM_KIT: { drum: Drum; gm: number }[] = [
  { drum: "kick", gm: 36 },
  { drum: "rim", gm: 37 },
  { drum: "snare", gm: 38 },
  { drum: "clap", gm: 39 },
  { drum: "snap", gm: 40 },
  { drum: "low tom", gm: 41 },
  { drum: "closed hat", gm: 42 },
  { drum: "floor tom", gm: 43 },
  { drum: "pedal hat", gm: 44 },
  { drum: "mid tom", gm: 45 },
  { drum: "open hat", gm: 46 },
  { drum: "crash", gm: 49 },
];

const pitchClass = (midi: number) => ((midi % 12) + 12) % 12;

/** Which drum a key plays. The same drum repeats in every octave. */
export function drumFor(midi: number): Drum {
  return DRUM_KIT[pitchClass(midi)]!.drum;
}

/** The General MIDI drum note (channel 10) for a key. */
export function gmDrumNote(midi: number): number {
  return DRUM_KIT[pitchClass(midi)]!.gm;
}
