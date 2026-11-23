/**
 * Notes as MIDI numbers (60 = middle C, C4). Plain math, no audio.
 */

export const MIDDLE_C = 60;

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;
const SPOKEN_NAMES = [
  "C",
  "C sharp",
  "D",
  "D sharp",
  "E",
  "F",
  "F sharp",
  "G",
  "G sharp",
  "A",
  "A sharp",
  "B",
] as const;

/** Equal temperament, A4 = 440 Hz. */
export function frequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Black keys are the sharps: C♯, D♯, F♯, G♯, A♯. */
export function isBlack(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** "C4", "F♯3". */
export function noteName(midi: number): string {
  return `${SHARP_NAMES[((midi % 12) + 12) % 12]}${octaveOf(midi)}`;
}

/** Name without the octave: "C", "F♯". */
export function pitchClass(midi: number): string {
  return SHARP_NAMES[((midi % 12) + 12) % 12]!;
}

/** For screen readers: "F sharp 3". */
export function spokenName(midi: number): string {
  return `${SPOKEN_NAMES[((midi % 12) + 12) % 12]} ${octaveOf(midi)}`;
}

/** Every note from `low` to `high`, inclusive. */
export function noteRange(low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = low; m <= high; m++) out.push(m);
  return out;
}

/** The lowest C shown, by octave shift: 0 → C4 (middle C). Kept inside a playable range. */
export const MIN_SHIFT = -3;
export const MAX_SHIFT = 2;

export function baseNote(shift: number): number {
  const s = Math.max(MIN_SHIFT, Math.min(MAX_SHIFT, Math.round(shift)));
  return MIDDLE_C + 12 * s;
}
