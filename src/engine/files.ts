/**
 * Download formats, as plain byte builders (no audio, no DOM), so they can be unit tested.
 *
 * - WAV: the sound itself, for video, games, slides or any editor.
 * - Seamless loop WAV: exactly one loop long, so it repeats with no gap, like a GIF for sound.
 * - MIDI: the notes, for GarageBand, Logic, Ableton, MuseScore and so on, where they can be
 *   re-voiced and edited.
 */

import type { Tune, Voice } from "./tune";

// ---------- WAV (16-bit PCM) ----------

/**
 * Folds whatever rings on past `frames` back onto the start, so a loop played on repeat carries
 * its last notes' tails into the next pass instead of cutting them off.
 */
export function foldTail(channel: Float32Array, frames: number): Float32Array {
  const out = new Float32Array(frames);
  if (frames <= 0) return out;
  for (let i = 0; i < channel.length; i++) out[i % frames]! += channel[i]!;
  return out;
}

/** The "smpl" chunk: tells samplers and game engines to loop the whole file forever. */
const SMPL_BYTES = 8 + 36 + 24;

export function encodeWav(
  channels: Float32Array[],
  sampleRate: number,
  options: { loop?: boolean } = {},
): Uint8Array {
  const count = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * count * 2;
  const extra = options.loop ? SMPL_BYTES : 0;
  const bytes = new Uint8Array(44 + dataBytes + extra);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + dataBytes + extra, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true); // bytes per second
  view.setUint16(32, count * 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, dataBytes, true);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const v = Math.max(-1, Math.min(1, channels[c]![i] ?? 0));
      view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      at += 2;
    }
  }
  if (options.loop) {
    text(at, "smpl");
    view.setUint32(at + 4, SMPL_BYTES - 8, true);
    view.setUint32(at + 16, Math.round(1e9 / sampleRate), true); // nanoseconds per sample
    view.setUint32(at + 20, 60, true); // unity note: middle C
    view.setUint32(at + 36, 1, true); // one loop
    const loop = at + 44;
    view.setUint32(loop + 8, 0, true); // start frame
    view.setUint32(loop + 12, Math.max(0, frames - 1), true); // end frame
    view.setUint32(loop + 20, 0, true); // play count: 0 means forever
  }
  return bytes;
}

// ---------- MIDI (Standard MIDI File, format 0) ----------

export const MIDI_BPM = 120;
const PPQ = 480;
const US_PER_BEAT = Math.round(60_000_000 / MIDI_BPM);

/** General MIDI instrument closest to each voice, so the file opens sounding similar. */
export const MIDI_PROGRAM: Record<Voice, number> = {
  grand: 0, // Acoustic Grand Piano
  piano: 0, // Acoustic Grand Piano
  chip: 80, // Lead 1 (square)
  organ: 16, // Drawbar Organ
  toy: 81, // Lead 2 (sawtooth)
};

function varLen(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const out = [v & 0x7f];
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
  return out;
}

const msToTicks = (ms: number) => Math.round((ms * PPQ * MIDI_BPM) / 60_000);

export function encodeMidi(tune: Tune, loops = 1): Uint8Array {
  const events: { tick: number; order: number; bytes: number[] }[] = [];
  for (let loop = 0; loop < loops; loop++) {
    const offset = loop * tune.length;
    for (const n of tune.notes) {
      const on = msToTicks(offset + n.start);
      const off = Math.max(on + 1, msToTicks(offset + n.start + n.length));
      events.push({ tick: on, order: 1, bytes: [0x90, n.midi, 96] });
      events.push({ tick: off, order: 0, bytes: [0x80, n.midi, 0] });
    }
  }
  // Note-offs before note-ons at the same moment, so a repeated note retriggers cleanly.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const name = [..."Pocket Keys"].map((c) => c.charCodeAt(0));
  const track: number[] = [
    0x00,
    0xff,
    0x03,
    name.length,
    ...name, // track name
    0x00,
    0xff,
    0x51,
    0x03,
    (US_PER_BEAT >> 16) & 0xff,
    (US_PER_BEAT >> 8) & 0xff,
    US_PER_BEAT & 0xff, // tempo
    0x00,
    0xc0,
    MIDI_PROGRAM[tune.voice], // instrument
  ];
  let last = 0;
  for (const e of events) {
    track.push(...varLen(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  const end = msToTicks(loops * tune.length);
  track.push(...varLen(Math.max(0, end - last)), 0xff, 0x2f, 0x00); // end of track

  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const header = [
    ...[..."MThd"].map((c) => c.charCodeAt(0)),
    ...u32(6),
    0x00,
    0x00, // format 0
    0x00,
    0x01, // one track
    (PPQ >> 8) & 0xff,
    PPQ & 0xff,
  ];
  const trackChunk = [...[..."MTrk"].map((c) => c.charCodeAt(0)), ...u32(track.length), ...track];
  return Uint8Array.from([...header, ...trackChunk]);
}

/** A file name from the voice and time: "pocket-keys-toy-2026-11-22-1430". */
export function fileName(voice: Voice, ext: "wav" | "mid", date = new Date(), suffix = ""): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  return `pocket-keys-${voice}${suffix ? `-${suffix}` : ""}-${stamp}.${ext}`;
}
