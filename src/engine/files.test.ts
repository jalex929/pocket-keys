import { encodeMidi, encodeWav, fileName, foldTail, MIDI_PROGRAM } from "./files";
import type { Tune } from "./tune";

const ascii = (bytes: Uint8Array, from: number, length: number) =>
  String.fromCharCode(...bytes.slice(from, from + length));

describe("WAV download", () => {
  it("writes a valid 16-bit stereo PCM header and samples", () => {
    const left = Float32Array.from([0, 1, -1, 0.5]);
    const right = Float32Array.from([0, -1, 1, 2]); // 2 is clipped to full scale
    const bytes = encodeWav([left, right], 44_100);
    const view = new DataView(bytes.buffer);
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(ascii(bytes, 8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(44_100);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(bytes.length).toBe(44 + 16);
    expect(view.getInt16(44 + 4, true)).toBe(32767); // left, frame 1
    expect(view.getInt16(44 + 6, true)).toBe(-32768); // right, frame 1
    expect(view.getInt16(44 + 14, true)).toBe(32767); // right, frame 3, clipped
  });
});

describe("MIDI download", () => {
  const tune: Tune = {
    voice: "organ",
    length: 1000,
    notes: [
      { midi: 60, start: 0, length: 500 },
      { midi: 60, start: 500, length: 500 },
    ],
  };

  it("writes a format-0 file with tempo, instrument and every note", () => {
    const bytes = encodeMidi(tune);
    expect(ascii(bytes, 0, 4)).toBe("MThd");
    expect(ascii(bytes, 14, 4)).toBe("MTrk");
    const body = [...bytes];
    const count = (status: number, note: number) =>
      body.filter((b, i) => b === status && body[i + 1] === note).length;
    expect(count(0x90, 60)).toBe(2);
    expect(count(0x80, 60)).toBe(2);
    expect(body.join(",")).toContain([0xc0, MIDI_PROGRAM.organ].join(","));
    expect(body.slice(-3)).toEqual([0xff, 0x2f, 0x00]);
  });

  it("puts a repeated note's note-off before the next note-on", () => {
    const body = [...encodeMidi(tune)];
    const firstOff = body.findIndex((b, i) => b === 0x80 && body[i + 1] === 60);
    const secondOn = body.findIndex(
      (b, i) => i > body.indexOf(0x90) && b === 0x90 && body[i + 1] === 60,
    );
    expect(firstOff).toBeLessThan(secondOn);
  });

  it("repeats the loop when asked", () => {
    const body = [...encodeMidi(tune, 3)];
    expect(body.filter((b, i) => b === 0x90 && body[i + 1] === 60).length).toBe(6);
  });
});

it("names files by voice and time", () => {
  expect(fileName("toy", "wav", new Date(2026, 10, 22, 14, 5))).toBe(
    "pocket-keys-toy-2026-11-22-1405.wav",
  );
});

describe("seamless loop", () => {
  it("folds the ringing tail back onto the start", () => {
    const rendered = Float32Array.from([1, 2, 3, 4, 0.5, 0.25]);
    expect([...foldTail(rendered, 4)]).toEqual([1.5, 2.25, 3, 4]);
  });

  it("marks the file to loop forever with a smpl chunk", () => {
    const frames = 10;
    const bytes = encodeWav([new Float32Array(frames), new Float32Array(frames)], 44_100, {
      loop: true,
    });
    const view = new DataView(bytes.buffer);
    const at = 44 + frames * 4;
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(ascii(bytes, at, 4)).toBe("smpl");
    expect(view.getUint32(at + 4, true)).toBe(60);
    expect(view.getUint32(at + 36, true)).toBe(1); // one loop
    expect(view.getUint32(at + 44 + 8, true)).toBe(0); // from the first frame
    expect(view.getUint32(at + 44 + 12, true)).toBe(frames - 1); // to the last
    expect(view.getUint32(at + 44 + 20, true)).toBe(0); // forever
  });

  it("leaves ordinary WAVs without the loop marker", () => {
    const bytes = encodeWav([new Float32Array(4)], 44_100);
    expect(bytes.length).toBe(44 + 8);
  });

  it("names loop files so they're easy to tell apart", () => {
    const d = new Date(2026, 10, 22, 14, 30);
    expect(fileName("grand", "wav", d, "loop")).toBe("pocket-keys-grand-loop-2026-11-22-1430.wav");
    expect(fileName("grand", "wav", d)).toBe("pocket-keys-grand-2026-11-22-1430.wav");
  });
});
