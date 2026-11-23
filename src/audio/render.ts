/**
 * Renders a tune to sound offline (faster than real time, nothing plays), with the same synth
 * the keyboard uses, so the download sounds like what you heard.
 */

import { encodeWav } from "../engine/files";
import type { Tune } from "../engine/tune";
import { Synth } from "./synth";

const SAMPLE_RATE = 44_100;
/** Room after the last loop for the final notes to ring out. */
const TAIL_S = 1.5;

export async function renderWav(tune: Tune, loops = 1): Promise<Uint8Array> {
  const seconds = (tune.length * loops) / 1000 + TAIL_S;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const synth = new Synth(ctx);
  for (let loop = 0; loop < loops; loop++) {
    const offset = (loop * tune.length) / 1000;
    for (const n of tune.notes) {
      const on = offset + n.start / 1000;
      synth.noteOn(n.midi, tune.voice, on)(on + n.length / 1000);
    }
  }
  const buffer = await ctx.startRendering();
  return encodeWav([buffer.getChannelData(0), buffer.getChannelData(1)], SAMPLE_RATE);
}
