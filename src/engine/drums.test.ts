import { DRUM_KIT, drumFor, gmDrumNote } from "./drums";
import { encodeMidi } from "./files";

describe("drum kit", () => {
  it("gives every key in an octave its own drum", () => {
    expect(new Set(DRUM_KIT.map((d) => d.drum)).size).toBe(12);
    expect(drumFor(60)).toBe("kick");
    expect(drumFor(62)).toBe("snare");
    expect(drumFor(66)).toBe("closed hat");
  });

  it("repeats the same drums in every octave", () => {
    for (let midi = 0; midi < 12; midi++) expect(drumFor(midi + 48)).toBe(drumFor(midi + 72));
  });

  it("uses the General MIDI drum notes", () => {
    expect(gmDrumNote(60)).toBe(36); // kick
    expect(gmDrumNote(63)).toBe(39); // hand clap
    expect(gmDrumNote(71)).toBe(49); // crash
  });

  it("saves drum loops on the drum channel with no instrument change", () => {
    const bytes = encodeMidi({
      voice: "drums",
      length: 500,
      notes: [{ midi: 62, start: 0, length: 100 }],
    });
    const body = [...bytes].join(",");
    expect(body).toContain([0x99, 38, 96].join(",")); // snare on, channel 10
    expect(body).not.toContain(String(0xc0) + ",");
  });

  it("saves claps as the hand clap whatever the key", () => {
    const bytes = encodeMidi({
      voice: "clap",
      length: 500,
      notes: [{ midi: 72, start: 0, length: 100 }],
    });
    expect([...bytes].join(",")).toContain([0x99, 39, 96].join(","));
  });
});
