/**
 * Renders a tune to sound offline (faster than real time, nothing plays), with the same synth
 * the keyboard uses, so the download sounds like what you heard.
 */

import { encodeWav, foldTail } from "../engine/files";
import type { Tune } from "../engine/tune";
import { Synth } from "./synth";

const SAMPLE_RATE = 44_100;
/** Room after the last loop for the final notes to ring out. */
const TAIL_S = 3;

/**
 * `loops` repeats the tune in one file. `seamless` instead makes a file exactly one loop long,
 * with the ringing tail folded back to the start, so it repeats with no gap when set to loop.
 */
export async function renderWav(
  tune: Tune,
  { loops = 1, seamless = false }: { loops?: number; seamless?: boolean } = {},
): Promise<Uint8Array> {
  const passes = seamless ? 1 : loops;
  const seconds = (tune.length * passes) / 1000 + TAIL_S;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const synth = new Synth(ctx);
  await synth.ready();
  for (let loop = 0; loop < passes; loop++) {
    const offset = (loop * tune.length) / 1000;
    for (const n of tune.notes) {
      const on = offset + n.start / 1000;
      synth.noteOn(n.midi, tune.voice, on)(on + n.length / 1000);
    }
  }
  const buffer = await ctx.startRendering();
  let channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  if (seamless) {
    const frames = Math.round((tune.length / 1000) * SAMPLE_RATE);
    channels = channels.map((c) => foldTail(c, frames));
  }
  return encodeWav(channels, SAMPLE_RATE, { loop: seamless });
}
