/**
 * Playing with the computer keyboard. Two letter rows each play an octave, laid out like a
 * piano: the bottom row (Z X C V…) plays the white keys of the lower octave and the row above
 * it (S D G H J…) its black keys; the Q row plays the upper octave the same way, with the
 * number row as its black keys. This is the common "tracker" layout.
 *
 * Uses KeyboardEvent.code (the physical key), so it works the same on any keyboard language.
 */

/** Physical key → semitones above the lowest C shown. */
export const KEY_OFFSETS: Readonly<Record<string, number>> = {
  // Lower octave: white keys on Z row, black keys on the row above.
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  Comma: 12,
  KeyL: 13,
  Period: 14,
  Semicolon: 15,
  Slash: 16,
  // Upper octave: white keys on Q row, black keys on the number row.
  KeyQ: 12,
  Digit2: 13,
  KeyW: 14,
  Digit3: 15,
  KeyE: 16,
  KeyR: 17,
  Digit5: 18,
  KeyT: 19,
  Digit6: 20,
  KeyY: 21,
  Digit7: 22,
  KeyU: 23,
  KeyI: 24,
};

/** Note for a physical key, or null if that key doesn't play anything. */
export function noteForKey(code: string, base: number): number | null {
  const offset = KEY_OFFSETS[code];
  return offset === undefined ? null : base + offset;
}

/** The letter printed on a physical key, for labels on the on-screen keys. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return { Comma: ",", Period: ".", Semicolon: ";", Slash: "/" }[code] ?? code;
}

/**
 * The key to show on each on-screen note. Where two keys play the same note (the top of the
 * lower octave overlaps the Q row), the Q row wins, so each note shows one label.
 */
export function labelsFor(base: number): Map<number, string> {
  const labels = new Map<number, string>();
  for (const [code, offset] of Object.entries(KEY_OFFSETS)) {
    const midi = base + offset;
    const upperRow = /^(Key[QWERTYUI]|Digit\d)$/.test(code);
    if (!labels.has(midi) || upperRow) labels.set(midi, keyLabel(code));
  }
  return labels;
}
