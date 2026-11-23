import { encodeMidi } from "./files";
import { decodeTune, encodeTune, Recorder, soundLength, type Tune } from "./tune";

describe("sustain pedal in recordings", () => {
  it("records keys going up when they did, and the pedal on its own", () => {
    const r = new Recorder(0);
    r.pedalDown(0);
    r.noteOn(60, 100);
    r.noteOff(60, 300); // key up while the pedal holds the sound
    r.pedalUp(900);
    const t = r.stop(1000, "grand")!;
    expect(t.notes).toEqual([{ midi: 60, start: 100, length: 200 }]);
    expect(t.pedal).toEqual([{ start: 0, length: 900 }]);
    // On playback the key is down 200 ms, the sound rings until the pedal lifts.
    expect(soundLength(t, t.notes[0]!)).toBe(800);
  });

  it("starts the pedal with the clock if it was down before the first note", () => {
    const r = new Recorder();
    r.pedalDown(50);
    r.noteOn(64, 500);
    r.noteOff(64, 600);
    const t = r.stop(1500, "grand")!;
    expect(t.pedal).toEqual([{ start: 0, length: 1000 }]);
  });

  it("lets notes released after the pedal lifted stop at their own key-up", () => {
    const t: Tune = {
      voice: "grand",
      length: 2000,
      notes: [{ midi: 60, start: 600, length: 400 }],
      pedal: [{ start: 0, length: 500 }],
    };
    expect(soundLength(t, t.notes[0]!)).toBe(400);
  });

  it("never rings past the end of the loop", () => {
    const t: Tune = {
      voice: "grand",
      length: 1000,
      notes: [{ midi: 60, start: 800, length: 100 }],
      pedal: [{ start: 700, length: 300 }],
    };
    expect(soundLength(t, t.notes[0]!)).toBe(200);
  });

  it("keeps recordings without the pedal unchanged", () => {
    const r = new Recorder(0);
    r.noteOn(60, 0);
    r.noteOff(60, 200);
    expect(r.stop(500, "piano")).not.toHaveProperty("pedal");
  });

  it("round-trips the pedal through a share link, and old links still open", () => {
    const t: Tune = {
      voice: "grand",
      length: 2000,
      notes: [{ midi: 60, start: 100, length: 200 }],
      pedal: [{ start: 0, length: 900 }],
    };
    const text = encodeTune(t);
    expect(text).toContain("~P.");
    expect(decodeTune(text)).toEqual(t);
    expect(decodeTune("1~piano~c8~1o.0.f")).toEqual({
      voice: "piano",
      length: 4400,
      notes: [{ midi: 60, start: 0, length: 150 }],
    });
    expect(decodeTune("1~grand~c8~P.0.f")).toBeNull(); // a pedal with no notes
  });

  it("writes the pedal into MIDI as controller 64", () => {
    const t: Tune = {
      voice: "grand",
      length: 2000,
      notes: [{ midi: 60, start: 100, length: 200 }],
      pedal: [{ start: 0, length: 900 }],
    };
    const body = [...encodeMidi(t)].join(",");
    expect(body).toContain([0xb0, 64, 127].join(","));
    expect(body).toContain([0xb0, 64, 0].join(","));
  });
});
