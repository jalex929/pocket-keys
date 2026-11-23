# Working in pocket-keys

Read `README.md` and `DECISIONS.md` first.

- Record every product, design or engineering decision in `DECISIONS.md`: what, why, the
  trade-off, and who made the call (Jay's call / proposed, approved / build default).
- Logic stays in `src/engine` (plain TypeScript, no React, no audio) and is unit tested there.
- Sound is synthesized (Web Audio), never sampled: nothing to license. No recreated demo songs,
  preset names or panel layouts from a real keyboard brand.
- Loop playback is scheduled on the audio clock, not timers; keep it that way.
- Left-aligned, navy (#000052) / yellow (#FFDF3F) identity; never show state by color alone;
  every control reachable by keyboard; respect reduced motion.
- READMEs say what was tested and what wasn't. No secrets, no private data.
- Before pushing: `npm run check`, and `npm run build && npm run test:e2e` when the UI changed.
- Commits use the GitHub no-reply email, never a personal address.
