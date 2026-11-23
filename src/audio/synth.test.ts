import { nearestSample, PIANO_SAMPLES } from "./synth";

describe("grand piano samples", () => {
  it("covers the keyboard with recordings every three semitones", () => {
    expect(PIANO_SAMPLES[0]).toEqual({ midi: 24, file: "C1.mp3" });
    expect(PIANO_SAMPLES.at(-1)).toEqual({ midi: 108, file: "C8.mp3" });
    expect(PIANO_SAMPLES).toHaveLength(29);
  });

  it("pitches each note from a recording at most 1.5 semitones away", () => {
    for (let midi = 24; midi <= 108; midi++) {
      expect(Math.abs(nearestSample(midi) - midi)).toBeLessThanOrEqual(1.5);
    }
    expect(nearestSample(60)).toBe(60); // middle C is recorded
    expect(nearestSample(62)).toBe(63); // D comes from D#
  });
});
