import {
  baseNote,
  frequency,
  isBlack,
  noteName,
  noteRange,
  spokenName,
  MAX_SHIFT,
  MIN_SHIFT,
} from "./notes";
import { KEY_OFFSETS, keyLabel, labelsFor, noteForKey } from "./keymap";
import { decodeTune, encodeTune, MAX_TUNE_MS, notesInWindow, Recorder, type Tune } from "./tune";

describe("notes", () => {
  it("tunes A4 to 440 Hz and doubles every octave", () => {
    expect(frequency(69)).toBeCloseTo(440, 6);
    expect(frequency(81)).toBeCloseTo(880, 6);
    expect(frequency(60)).toBeCloseTo(261.626, 2);
  });

  it("knows black keys, names and spoken names", () => {
    expect(noteRange(60, 71).filter(isBlack).map(noteName)).toEqual([
      "C♯4",
      "D♯4",
      "F♯4",
      "G♯4",
      "A♯4",
    ]);
    expect(noteName(60)).toBe("C4");
    expect(noteName(59)).toBe("B3");
    expect(spokenName(66)).toBe("F sharp 4");
  });

  it("keeps octave shifts inside the playable range", () => {
    expect(baseNote(0)).toBe(60);
    expect(baseNote(-1)).toBe(48);
    expect(baseNote(MIN_SHIFT - 5)).toBe(baseNote(MIN_SHIFT));
    expect(baseNote(MAX_SHIFT + 5)).toBe(baseNote(MAX_SHIFT));
  });
});

describe("computer keyboard", () => {
  it("plays two octaves like a piano: white keys on letter rows, black keys above them", () => {
    expect(noteForKey("KeyZ", 60)).toBe(60);
    expect(noteForKey("KeyS", 60)).toBe(61);
    expect(noteForKey("KeyQ", 60)).toBe(72);
    expect(noteForKey("Digit2", 60)).toBe(73);
    expect(noteForKey("KeyI", 60)).toBe(84);
    expect(noteForKey("KeyA", 60)).toBeNull();
    expect(noteForKey("Space", 60)).toBeNull();
  });

  it("puts every white-key letter on a white key and every black-key letter on a black key", () => {
    const whiteRows = /^Key[ZXCVBNMQWERTYUI]$|^(Comma|Period|Slash)$/;
    for (const [code, offset] of Object.entries(KEY_OFFSETS)) {
      expect(isBlack(60 + offset), code).toBe(!whiteRows.test(code));
    }
  });

  it("labels each of the 25 notes once, preferring the upper row where rows overlap", () => {
    const labels = labelsFor(60);
    expect(labels.size).toBe(25);
    expect(labels.get(60)).toBe("Z");
    expect(labels.get(72)).toBe("Q");
    expect(labels.get(73)).toBe("2");
    expect(keyLabel("Comma")).toBe(",");
  });
});

describe("recording", () => {
  it("records notes relative to the start and ends the loop at Stop", () => {
    const r = new Recorder(1000);
    r.noteOn(60, 1100);
    r.noteOn(64, 1300);
    r.noteOff(60, 1500);
    r.noteOff(64, 1600);
    const tune = r.stop(2000, "piano");
    expect(tune).toEqual({
      voice: "piano",
      length: 1000,
      notes: [
        { midi: 60, start: 100, length: 400 },
        { midi: 64, start: 300, length: 300 },
      ],
    });
  });

  it("closes notes still held at Stop, and returns nothing for an empty recording", () => {
    const r = new Recorder(0);
    r.noteOn(67, 200);
    expect(r.stop(1000, "organ")?.notes).toEqual([{ midi: 67, start: 200, length: 800 }]);
    expect(new Recorder(0).stop(500, "piano")).toBeNull();
  });

  it("starts the clock on the first note when no start time is given", () => {
    const r = new Recorder();
    expect(r.started).toBe(false);
    expect(r.elapsed(5000)).toBe(0);
    r.noteOn(60, 5000);
    r.noteOff(60, 5200);
    r.noteOn(62, 5400);
    r.noteOff(62, 5600);
    expect(r.stop(6000, "toy")).toEqual({
      voice: "toy",
      length: 1000,
      notes: [
        { midi: 60, start: 0, length: 200 },
        { midi: 62, start: 400, length: 200 },
      ],
    });
  });

  it("stops taking notes at the time limit", () => {
    const r = new Recorder(0);
    r.noteOn(60, MAX_TUNE_MS + 10);
    expect(r.full(MAX_TUNE_MS + 10)).toBe(true);
    expect(r.stop(MAX_TUNE_MS + 20, "chip")).toBeNull();
  });
});

describe("looping", () => {
  const tune: Tune = {
    voice: "toy",
    length: 1000,
    notes: [
      { midi: 60, start: 0, length: 100 },
      { midi: 62, start: 500, length: 100 },
    ],
  };

  it("finds the notes due in a time window, across loop boundaries", () => {
    expect(notesInWindow(tune, 0, 100).map((x) => x.at)).toEqual([0]);
    expect(notesInWindow(tune, 400, 1100).map((x) => [x.note.midi, x.at])).toEqual([
      [62, 500],
      [60, 1000],
    ]);
    expect(notesInWindow(tune, 2500, 2600).map((x) => x.at)).toEqual([2500]);
  });

  it("schedules every note exactly once when windows tile the timeline", () => {
    let count = 0;
    for (let t = 0; t < 10_000; t += 37)
      count += notesInWindow(tune, t, Math.min(t + 37, 10_000)).length;
    expect(count).toBe(20);
  });
});

describe("share links", () => {
  const tune: Tune = {
    voice: "chip",
    length: 2340,
    notes: [
      { midi: 60, start: 0, length: 250 },
      { midi: 64, start: 500, length: 120 },
      { midi: 67, start: 1000, length: 600 },
    ],
  };

  it("round-trips a tune through a short string", () => {
    const text = encodeTune(tune);
    expect(text.length).toBeLessThan(40);
    expect(decodeTune(text)).toEqual(tune);
  });

  it("rejects anything malformed without throwing", () => {
    for (const bad of [
      "",
      "garbage",
      "2~chip~6i~1o.0.p",
      "1~kazoo~6i~1o.0.p",
      "1~chip~zzzzzzz~1o.0.p",
      "1~chip~6i~1o.0",
      "1~chip~6i~1o.0.0",
      "1~chip~6i~zz.0.p",
      "1~chip~6i~1o.999.p",
      "1~chip~6i~<script>",
    ]) {
      expect(decodeTune(bad), bad).toBeNull();
    }
  });
});
