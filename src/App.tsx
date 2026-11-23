import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoopPlayer } from "./audio/player";
import { Synth, VOICE_GROUPS, VOICE_INFO, type VoiceGroup } from "./audio/synth";
import { drumFor } from "./engine/drums";
import { encodeMidi, fileName } from "./engine/files";
import { labelsFor, noteForKey } from "./engine/keymap";
import { baseNote, MAX_SHIFT, MIN_SHIFT, noteName } from "./engine/notes";
import {
  decodeTune,
  encodeTune,
  MAX_TUNE_MS,
  Recorder,
  VOICES,
  type Tune,
  type Voice,
} from "./engine/tune";
import { Keyboard } from "./ui/Keyboard";

/** Where "back" goes: the Lab on jayfox.design (relative when hosted inside it). */
const LAB_URL =
  typeof location !== "undefined" && location.pathname.includes("/lab/")
    ? "../"
    : "https://jayfox.design/lab";

const PREFS_KEY = "pocket-keys:prefs";

interface Prefs {
  voice: Voice;
  volume: number;
  showNames: boolean;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { voice: "grand", volume: 0.7, showNames: false };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!raw) return fallback;
    return {
      voice: VOICES.includes(raw.voice as Voice) ? (raw.voice as Voice) : fallback.voice,
      volume:
        typeof raw.volume === "number" ? Math.max(0, Math.min(1, raw.volume)) : fallback.volume,
      showNames: raw.showNames === true,
    };
  } catch {
    return fallback;
  }
}

function tuneFromHash(): Tune | null {
  const match = /^#tune=(.+)$/.exec(location.hash);
  return match ? decodeTune(decodeURIComponent(match[1]!)) : null;
}

/** Phones held upright show one octave so keys stay finger-sized; everything else shows two. */
function useOctaves(): 1 | 2 {
  const query = "(max-width: 640px) and (orientation: portrait)";
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow ? 1 : 2;
}

/** Each kind of sound has its own light color (the name always says which, too). */
const GROUP_COLORS: Record<VoiceGroup, string> = {
  Instruments: "var(--sky)",
  Synths: "var(--green)",
  "Sound effects": "var(--pink)",
};

function formatTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

interface Held {
  midi: number;
  release: () => void;
}

export function App() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [shift, setShift] = useState(0);
  const [sustainOn, setSustainOn] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [userLit, setUserLit] = useState<Map<number, number>>(new Map());
  const [loopLit, setLoopLit] = useState<Map<number, number>>(new Map());
  const [lastNote, setLastNote] = useState<number | null>(null);
  const [tune, setTune] = useState<Tune | null>(tuneFromHash);
  const [shared, setShared] = useState(() => tune !== null);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(0);
  const [message, setMessage] = useState("");
  const [repeats, setRepeats] = useState(1);
  const [savedFile, setSavedFile] = useState("");
  const [rendering, setRendering] = useState(false);
  const octaves = useOctaves();

  const synth = useMemo(() => new Synth(), []);
  const held = useRef(new Map<string, Held>());
  const sustained = useRef<Held[]>([]);
  const recorder = useRef<Recorder | null>(null);
  const live = useRef({ voice: prefs.voice, sustain: false, base: baseNote(0) });

  const base = baseNote(shift);
  const sustain = sustainOn || shiftHeld;
  live.current = { voice: prefs.voice, sustain, base };

  const bump = (map: Map<number, number>, midi: number, by: number) => {
    const next = new Map(map);
    const n = (next.get(midi) ?? 0) + by;
    if (n > 0) next.set(midi, n);
    else next.delete(midi);
    return next;
  };

  const player = useMemo(
    () => new LoopPlayer(synth, (midi, on) => setLoopLit((m) => bump(m, midi, on ? 1 : -1))),
    [synth],
  );

  useEffect(() => {
    synth.setVolume(prefs.volume);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Private windows can refuse storage; the app works without it.
    }
  }, [prefs, synth]);

  // ---------- Playing notes ----------

  // A key pops back up as soon as you let go of it. Sustain only keeps the sound ringing, like
  // the damper pedal on a piano, so the light and the sound are let go of separately.
  const unlight = useCallback((h: Held) => setUserLit((m) => bump(m, h.midi, -1)), []);
  const silence = useCallback((h: Held) => {
    h.release();
    recorder.current?.noteOff(h.midi, performance.now());
  }, []);
  const letGo = useCallback(
    (h: Held) => {
      unlight(h);
      if (live.current.sustain) sustained.current.push(h);
      else silence(h);
    },
    [unlight, silence],
  );

  const noteDown = useCallback(
    (source: string, midi: number) => {
      const previous = held.current.get(source);
      if (previous) {
        held.current.delete(source);
        letGo(previous);
      }
      const release = synth.noteOn(midi, live.current.voice);
      held.current.set(source, { midi, release });
      recorder.current?.noteOn(midi, performance.now());
      setUserLit((m) => bump(m, midi, 1));
      setLastNote(midi);
    },
    [synth, letGo],
  );

  const noteUp = useCallback(
    (source: string) => {
      const h = held.current.get(source);
      if (!h) return;
      held.current.delete(source);
      letGo(h);
    },
    [letGo],
  );

  // Lifting the pedal silences everything it was holding (those keys are already back up).
  useEffect(() => {
    if (sustain) return;
    for (const h of sustained.current.splice(0)) silence(h);
  }, [sustain, silence]);

  const releaseAll = useCallback(() => {
    for (const source of [...held.current.keys()]) noteUp(source);
    setShiftHeld(false);
  }, [noteUp]);

  // ---------- Computer keyboard ----------

  useEffect(() => {
    // Typing in a text field shouldn't play notes; sliders, switches and buttons are fine.
    const typing = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
      return t instanceof HTMLInputElement && !["range", "checkbox", "radio"].includes(t.type);
    };
    const down = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "Shift") return setShiftHeld(true);
      if (e.code === "Minus" || e.code === "Equal") {
        e.preventDefault();
        if (!e.repeat)
          setShift((s) =>
            Math.max(MIN_SHIFT, Math.min(MAX_SHIFT, s + (e.code === "Equal" ? 1 : -1))),
          );
        return;
      }
      const midi = noteForKey(e.code, live.current.base);
      if (midi === null) return;
      e.preventDefault();
      if (!e.repeat) noteDown(`key:${e.code}`, midi);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") return setShiftHeld(false);
      noteUp(`key:${e.code}`);
    };
    const away = () => releaseAll();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", away);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", away);
    };
  }, [noteDown, noteUp, releaseAll]);

  // ---------- Loop: record, play, share ----------

  const stopPlaying = useCallback(() => {
    player.stop();
    setPlaying(false);
    setLoopLit(new Map());
  }, [player]);

  const startRecording = () => {
    stopPlaying();
    synth.wake();
    // The clock starts on the first note, so the loop doesn't open with silence.
    recorder.current = new Recorder();
    setRecording(true);
    setShared(false);
    setMessage("Recording starts with your first note. Press Stop when you're done.");
  };

  const stopRecording = useCallback(() => {
    const r = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (!r) return;
    const t = r.stop(performance.now(), live.current.voice);
    if (!t) {
      setMessage("Nothing was recorded. Press Rec, then play a few keys.");
      return;
    }
    setTune(t);
    setSavedFile("");
    history.replaceState(null, "", location.pathname + location.search);
    setMessage(`Recorded ${t.notes.length} notes. Press Play to loop it, then play along.`);
  }, []);

  // The clock on the display, and the recording's time limit.
  useEffect(() => {
    if (!recording && !playing) return;
    const started = performance.now();
    let raf = 0;
    const frame = () => {
      const r = recorder.current;
      const now = performance.now();
      if (r) {
        setClock(r.elapsed(now));
        if (r.full(now)) return stopRecording();
      } else if (tune) {
        setClock((now - started) % tune.length);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [recording, playing, tune, stopRecording]);

  const togglePlay = () => {
    if (playing) return stopPlaying();
    if (!tune) return;
    player.play(tune);
    setPlaying(true);
    setMessage(shared ? "Playing the shared tune on repeat." : "Playing your loop on repeat.");
  };

  const clearTune = () => {
    stopPlaying();
    setTune(null);
    setSavedFile("");
    setShared(false);
    history.replaceState(null, "", location.pathname + location.search);
    setMessage("Loop cleared.");
  };

  const shareTune = async () => {
    if (!tune) return;
    setSavedFile("");
    const url = `${location.origin}${location.pathname}#tune=${encodeURIComponent(encodeTune(tune))}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Link copied. Anyone who opens it can play your tune.");
    } catch {
      history.replaceState(null, "", url);
      setMessage("The link is in the address bar now. Copy it from there to share.");
    }
  };

  const save = (bytes: Uint8Array, type: string, name: string) => {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const downloadWav = async (seamless: boolean) => {
    if (!tune || rendering) return;
    setRendering(true);
    setSavedFile("");
    setMessage(seamless ? "Making your seamless loop…" : "Making your sound file…");
    try {
      const { renderWav } = await import("./audio/render");
      const name = fileName(tune.voice, "wav", new Date(), seamless ? "loop" : "");
      save(await renderWav(tune, { loops: repeats, seamless }), "audio/wav", name);
      setSavedFile(name);
      setMessage(
        seamless
          ? "Check your Downloads. Set it to repeat in a video editor, game or slideshow and it plays with no gap."
          : "Check your Downloads. It plays in any music player and drops into a video, game or slides.",
      );
    } catch {
      setMessage("This browser couldn't make the sound file. Try the notes download instead.");
    } finally {
      setRendering(false);
    }
  };

  const downloadMidi = () => {
    if (!tune) return;
    setSavedFile("");
    const name = fileName(tune.voice, "mid");
    save(encodeMidi(tune, repeats), "audio/midi", name);
    setSavedFile(name);
    setMessage(
      "Check your Downloads. It's the notes, not a recording: open it in GarageBand, MuseScore or another music app to pick any instrument or fix a note.",
    );
  };

  useEffect(() => () => player.stop(), [player]);

  // ---------- View ----------

  const low = base;
  const high = base + 12 * octaves;
  const lit = useMemo(() => new Set([...userLit.keys(), ...loopLit.keys()]), [userLit, loopLit]);
  const labels = useMemo(() => labelsFor(base), [base]);
  const voiceInfo = VOICE_INFO.find((v) => v.id === prefs.voice)!;

  const status = recording
    ? recorder.current?.started
      ? `● REC ${formatTime(clock)} / ${formatTime(MAX_TUNE_MS)}`
      : "● REC · PLAY TO START"
    : playing && tune
      ? `▶ LOOP ${formatTime(clock)} / ${formatTime(tune.length)}`
      : tune
        ? `LOOP READY · ${tune.notes.length} NOTES`
        : "PLAY A KEY";

  return (
    <div className="app" style={{ ["--voice" as string]: GROUP_COLORS[voiceInfo.group] }}>
      <header className="topbar">
        <a className="topbar__back" href={LAB_URL} aria-label="Back to the Lab at jayfox.design">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          <span className="topbar__back-text">jayfox.design/lab</span>
        </a>
      </header>

      <main className="stage">
        <div className="intro">
          <p className="intro__kicker">// a keyboard you can pocket</p>
          <h1 className="intro__title">Pocket Keys</h1>
          <p className="intro__lede">
            Tap, slide or type to play. Record a loop, play along with it, and send it to a friend.
          </p>
        </div>

        {shared && tune && (
          <p className="shared" role="status">
            Someone sent you a tune.{" "}
            <button className="link-button" onClick={togglePlay}>
              Play it
            </button>
          </p>
        )}

        <section className="instrument" aria-label="Keyboard">
          <div className="panel">
            <div className="grille" aria-hidden="true" />

            <div className="lcd" aria-live="polite" aria-atomic="true">
              <span className="lcd__note">
                {lastNote === null
                  ? "♪"
                  : prefs.voice === "drums"
                    ? drumFor(lastNote).toUpperCase()
                    : noteName(lastNote)}
              </span>
              <span className="lcd__line">
                {voiceInfo.label.toUpperCase()} · {noteName(low)}–{noteName(high)}
                {sustain ? " · SUSTAIN" : ""}
              </span>
              <span className={`lcd__line lcd__status${recording ? " lcd__status--rec" : ""}`}>
                {status}
              </span>
            </div>

            <div className="transport" role="group" aria-label="Loop">
              <button
                type="button"
                className={`transport__button transport__button--rec${recording ? " is-on" : ""}`}
                onClick={recording ? stopRecording : startRecording}
                aria-pressed={recording}
                aria-label={recording ? "Stop recording" : "Record a loop"}
              >
                <span
                  className={`transport__icon transport__icon--${recording ? "stop" : "rec"}`}
                  aria-hidden="true"
                />
                <span className="transport__label" aria-hidden="true">
                  {recording ? "Stop" : "Rec"}
                </span>
              </button>
              <button
                type="button"
                className={`transport__button${playing ? " is-on" : ""}`}
                onClick={togglePlay}
                disabled={!tune || recording}
                aria-pressed={playing}
                aria-label={playing ? "Stop the loop" : "Play the loop"}
              >
                <span
                  className={`transport__icon transport__icon--${playing ? "stop" : "play"}`}
                  aria-hidden="true"
                />
                <span className="transport__label" aria-hidden="true">
                  {playing ? "Stop" : "Play"}
                </span>
              </button>
            </div>

            <div className="voices">
              <label className="sound">
                <span className="label sound__label">Sound</span>
                <span className="sound__pick">
                  <span
                    className="voice__led"
                    style={{ background: GROUP_COLORS[voiceInfo.group] }}
                    aria-hidden="true"
                  />
                  <select
                    value={prefs.voice}
                    aria-describedby="sound-hint"
                    onChange={(e) => {
                      setPrefs((p) => ({ ...p, voice: e.target.value as Voice }));
                      synth.wake();
                    }}
                  >
                    {VOICE_GROUPS.map((group) => (
                      <optgroup key={group} label={group}>
                        {VOICE_INFO.filter((v) => v.group === group).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </span>
              </label>
              <p className="sound__hint" id="sound-hint">
                {voiceInfo.hint}
              </p>
            </div>

            <div className="controls">
              <div className="control">
                <span className="label" id="octave-label">
                  Octave
                </span>
                <div className="stepper" role="group" aria-labelledby="octave-label">
                  <button
                    type="button"
                    className="round"
                    onClick={() => setShift((s) => Math.max(MIN_SHIFT, s - 1))}
                    disabled={shift <= MIN_SHIFT}
                    aria-label="Octave down"
                    title="Octave down (−)"
                  >
                    −
                  </button>
                  <span className="stepper__value" aria-live="polite">
                    {shift > 0 ? `+${shift}` : shift}
                  </span>
                  <button
                    type="button"
                    className="round"
                    onClick={() => setShift((s) => Math.min(MAX_SHIFT, s + 1))}
                    disabled={shift >= MAX_SHIFT}
                    aria-label="Octave up"
                    title="Octave up (=)"
                  >
                    +
                  </button>
                </div>
              </div>

              <label className="control switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={sustainOn}
                  onChange={(e) => setSustainOn(e.target.checked)}
                />
                <span className="switch__track" aria-hidden="true" />
                <span className="label">Sustain</span>
              </label>

              <label className="control switch">
                <input
                  type="checkbox"
                  role="switch"
                  checked={prefs.showNames}
                  onChange={(e) => setPrefs((p) => ({ ...p, showNames: e.target.checked }))}
                />
                <span className="switch__track" aria-hidden="true" />
                <span className="label">Note names</span>
              </label>

              <label className="control volume">
                <span className="label">Volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={prefs.volume}
                  onChange={(e) => setPrefs((p) => ({ ...p, volume: Number(e.target.value) }))}
                />
              </label>
            </div>
          </div>

          <Keyboard
            low={low}
            high={high}
            lit={lit}
            labels={labels}
            showNames={prefs.showNames}
            onDown={noteDown}
            onUp={noteUp}
          />
        </section>

        <section className="loop" aria-labelledby="loop-heading">
          <h2 id="loop-heading" className="loop__heading">
            Your loop
          </h2>
          {tune && !recording ? (
            <>
              <p className="loop__summary">
                {tune.notes.length} notes, {formatTime(tune.length)} long. What you make is yours to
                use.
              </p>
              <ul className="saves">
                <li className="save">
                  <button type="button" className="button" onClick={shareTune}>
                    Copy link
                  </button>
                  <p className="save__what">
                    A web link that plays your loop on this page. Nothing to download.
                  </p>
                </li>
                <li className="save">
                  <button
                    type="button"
                    className="button"
                    onClick={() => void downloadWav(false)}
                    disabled={rendering}
                  >
                    Download sound
                    <span className="button__hint">.wav</span>
                  </button>
                  <p className="save__what">
                    A recording of what you heard. Plays anywhere; drop it into a video, game or
                    slides.
                  </p>
                </li>
                <li className="save">
                  <button
                    type="button"
                    className="button"
                    onClick={() => void downloadWav(true)}
                    disabled={rendering}
                  >
                    Download loop
                    <span className="button__hint">.wav</span>
                  </button>
                  <p className="save__what">
                    Like a GIF for sound: one seamless loop with no gap at the end, so it can repeat
                    forever as background music.
                  </p>
                </li>
                <li className="save">
                  <button type="button" className="button" onClick={downloadMidi}>
                    Download notes
                    <span className="button__hint">.mid</span>
                  </button>
                  <p className="save__what">
                    Just the notes, not the sound. Open it in GarageBand or MuseScore to change the
                    instrument or edit notes.
                  </p>
                </li>
              </ul>
              <div className="loop__foot">
                <label className="repeat">
                  <span className="save__label">Sound and notes files play the loop</span>
                  <select value={repeats} onChange={(e) => setRepeats(Number(e.target.value))}>
                    <option value={1}>once</option>
                    <option value={2}>twice</option>
                    <option value={4}>4 times</option>
                  </select>
                </label>
                <button type="button" className="button button--quiet" onClick={clearTune}>
                  Clear this loop
                </button>
              </div>
              <p className="loop__message" role="status">
                {savedFile ? <strong className="loop__saved">Saved {savedFile}. </strong> : null}
                {message}
              </p>
            </>
          ) : (
            <p className="loop__message" role="status">
              {message ||
                "Press Rec on the keyboard and play up to 30 seconds. Then loop it and play along, share it as a link, or save it as WAV or MIDI for a project."}
            </p>
          )}
        </section>

        <section className="help" aria-labelledby="help-heading">
          <h2 id="help-heading" className="help__heading">
            Playing with a keyboard
          </h2>
          <ul className="help__list">
            <li>
              <kbd>Z</kbd> to <kbd>/</kbd> play the lower octave, <kbd>Q</kbd> to <kbd>I</kbd> the
              upper one. The rows above them are the black keys.
            </li>
            <li>
              Hold <kbd>Shift</kbd> for sustain. <kbd>−</kbd> and <kbd>=</kbd> change octave.
            </li>
            <li>
              Or Tab to the keys: arrow keys move, <kbd>Enter</kbd> plays.
            </li>
          </ul>
          <p className="help__credit">
            Grand piano recordings:{" "}
            <a href="https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html">
              Salamander Grand Piano
            </a>{" "}
            by Alexander Holm, <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
