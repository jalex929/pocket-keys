# Decisions

How Pocket Keys was set up on purpose: what was decided, why, and what was left out. Each
decision says who made it:

- **Jay's call:** a product or design decision Jay Fox made.
- **Proposed, approved:** suggested during the build and accepted by Jay.
- **Build default:** an engineering choice made while building it, kept because it worked.
  Open to change.

Pocket Keys was designed by Jay Fox and built with an AI coding assistant (Claude) as a pair
programmer. Jay set the direction and made the calls marked below.

## What it is for

A musical keyboard toy in the browser (Jay's idea, 2026-11-22): fun within ten seconds, deep
enough to noodle on for ten minutes. One of the whimsical games and toys in the Lab on
[jayfox.design](https://jayfox.design/lab).

## Product decisions

**Play it any way you can** (proposed, approved). Tap or click keys, slide a finger across
them to play each one in turn, hold several for a chord, or play with the computer keyboard.
Phones held upright show one octave so keys stay finger-sized; wider screens show two.

**Four voices, all synthesized** (proposed, approved): soft keys, chiptune, organ and a
wobbly "90s toy" voice. The 90s toy voice ties it to Tiny Canvas's 90s mode. Synthesized live
with Web Audio, so there are no samples to license or download.

**A real grand piano, from recordings** (Jay asked for a classic piano sound; recordings
proposed, approved). Synthesis can't make a convincing acoustic piano, so this one voice plays
the Salamander Grand Piano (a Yamaha C5), CC BY 3.0 by Alexander Holm, credited on the page and
in the README. 29 notes, about 1.9 MB of MP3s, loaded after the first tap; every other key is
pitched from a recording at most 1.5 semitones away. It's the new default. Until the files
arrive, the piano falls back to the synthesized soft keys, so the first notes never go silent.
Trade-off: the only part of the app that isn't synthesized, and a download on first play.

**Sustain is a damper pedal, not a key lock** (Jay's call). Letting go of a key pops it back
up; sustain only lets the sound ring on until the pedal lifts. Recordings keep each note until
its sound stopped, so loops and downloads ring the same way you heard them.

**Say what each save option gives you** (Jay's call: it wasn't clear you were saving). Each
option is its own card with a plain name, the file type and one line on what it's for; once
saved, the page names the file and says to check Downloads.

**A seamless loop download, like a GIF for sound** (Jay's idea). One loop exactly, with the
ringing tail folded back onto the start so it repeats with no gap or click, and a WAV loop
marker (the `smpl` chunk) for samplers and game engines that read it.

**Record a loop and play along** (proposed, approved). Up to 30 seconds, looping in the voice
it was recorded in, so you can layer a melody over it.

**Rec and Play on the instrument** (proposed after Jay asked for a tighter UI/UX pass). Like a
real toy keyboard's buttons, they sit on the panel so they're in reach while you play, even on a
phone. Recording starts on your first note, so loops never open with dead air. The card below
only appears with actions once there's a loop to share or save.

**Keys first on phones** (same pass). Upright phones drop the intro text and tighten the panel
so the keys are big and high on the screen; phones held sideways put every control in one band
and let the keys fill the rest. The volume slider is hidden on phones, which have volume buttons.

**Save your music to use in a project** (Jay's call). A loop downloads as:

- **WAV**, the sound itself, for a video, a game, slides or any audio editor. It's rendered
  with the same synth you heard, offline, so the file matches the sound.
- **MIDI**, the notes, for GarageBand, Logic, Ableton or MuseScore, where you can change the
  instrument or edit notes. It uses the General MIDI instrument closest to each voice.

Either can repeat the loop 1, 2 or 4 times. The page says plainly that what you make is yours
to use.

**Share a tune as a link** (proposed, approved). The notes are packed into the link itself
(about 10 characters a note), so there's no server and nothing stored about anyone.

**No accounts, no tracking** (build default, matching Jay's other Lab projects). Voice, volume
and the note-names switch are remembered in the browser; nothing else is saved.

**An original toy, not a copy** (build default, Jay's standing rule for the Lab). The look is
a general toy keyboard (speaker grille, a little LCD, chunky buttons), with no brand's panel
layout, preset names or demo songs.

## Design decisions

**Jay's identity, played as a toy** (proposed, approved). Navy body, cream keys, yellow
controls, on the light dotted background of the Lab. The four voices have colored lights (sky,
green, yellow, pink) that tint the dot on a pressed key.

**State never by color alone** (build default, Jay's standard). A pressed key sinks and shows a
dot; a selected voice turns white with a yellow outline; switches slide and change shape.

**Left-aligned** (Jay's standing preference) with a clear grid: title, instrument, loop, help.

**Keyboard and screen reader friendly** (build default). Keys are real buttons with spoken
names ("F sharp 4"); Tab reaches them, arrow keys move between them and Enter or Space plays.
The computer-keyboard letters show on each key only where there's a physical keyboard.

## Engineering decisions

**Logic in plain TypeScript, tested on its own** (build default). Note math, the keyboard
layout, recording, looping, the share-link format and the WAV and MIDI writers live in
`src/engine` with no React or audio, and have unit tests.

**Loop timing on the audio clock** (build default). The player schedules notes a little ahead
on Web Audio's own clock rather than with timers, so playback stays in time when the page is
busy. Timers only drive the key lights.

**Computer keys by physical position** (build default). Uses `KeyboardEvent.code`, so the
layout (Z row and Q row, the common "tracker" layout) works on any keyboard language.

**Low latency by default** (build default). The audio context asks for interactive latency.
Actual latency depends on the device and wasn't measured.

**Same toolchain as the other Lab apps** (build default): React, Vite, TypeScript (strict),
Vitest and Playwright, relative paths so it runs at any address.

## Deliberately not done (yet)

- A drum-pad beat, a chord helper, "safe" scale highlighting, Web MIDI for a real keyboard and
  a full 90s mode are in the backlog, not built.
- No overdubbing (recording over a loop) in this version.
- No accounts or cloud saves.

## Honest limits

- Tested in headless Chromium on Windows (desktop and an emulated Pixel 7). **Not yet tested**
  on real phones, in Safari or Firefox, with a screen reader by hand, or for latency on real
  devices. iPhones in silent mode may mute web audio.
- The browser tests confirm sound is made (they count started oscillators) and that the WAV
  and MIDI files are valid; nobody has listened to the downloads on another device yet.
