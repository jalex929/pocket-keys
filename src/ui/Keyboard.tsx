import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { isBlack, noteName, noteRange, pitchClass, spokenName } from "../engine/notes";

interface Props {
  low: number;
  high: number;
  /** Notes sounding right now (yours and the loop's). */
  lit: ReadonlySet<number>;
  /** Computer-keyboard letter for each note. */
  labels: ReadonlyMap<number, string>;
  showNames: boolean;
  onDown: (source: string, midi: number) => void;
  onUp: (source: string) => void;
}

/**
 * The keys. Pointers (mouse, pen, every finger) are tracked separately, so chords and
 * glissandos work: slide across the keys and each one plays as you reach it.
 */
export function Keyboard({ low, high, lit, labels, showNames, onDown, onUp }: Props) {
  const notes = noteRange(low, high);
  const whites = notes.filter((m) => !isBlack(m));
  const down = useRef(new Map<number, number>());
  const focused = useRef(low);

  const keyAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-midi]");
    return el ? Number(el.dataset.midi) : null;
  };

  const pointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const midi = keyAt(e.clientX, e.clientY);
    if (midi === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    down.current.set(e.pointerId, midi);
    onDown(`pointer:${e.pointerId}`, midi);
  };

  const pointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = down.current.get(e.pointerId);
    if (current === undefined) return;
    const midi = keyAt(e.clientX, e.clientY);
    if (midi === null || midi === current) return;
    down.current.set(e.pointerId, midi);
    onDown(`pointer:${e.pointerId}`, midi);
  };

  const pointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!down.current.has(e.pointerId)) return;
    down.current.delete(e.pointerId);
    onUp(`pointer:${e.pointerId}`);
  };

  // Keyboard users: Tab to the keys, arrows move between them, Enter or Space plays.
  const keyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, midi: number) => {
    const move = (to: number) => {
      e.preventDefault();
      const next = Math.max(low, Math.min(high, to));
      focused.current = next;
      e.currentTarget.parentElement
        ?.querySelector<HTMLButtonElement>(`[data-midi="${next}"]`)
        ?.focus();
    };
    if (e.key === "ArrowRight") return move(midi + 1);
    if (e.key === "ArrowLeft") return move(midi - 1);
    if (e.key === "Home") return move(low);
    if (e.key === "End") return move(high);
    if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
      e.preventDefault();
      onDown("focus", midi);
    }
  };
  const keyUp = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onUp("focus");
    }
  };

  const whiteIndex = (midi: number) => whites.filter((w) => w < midi).length;

  return (
    <div
      className="keys"
      role="group"
      aria-label="Piano keys"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onLostPointerCapture={pointerUp}
      style={{ ["--whites" as string]: whites.length }}
    >
      {notes.map((midi) => {
        const black = isBlack(midi);
        const on = lit.has(midi);
        const label = labels.get(midi);
        return (
          <button
            key={midi}
            type="button"
            data-midi={midi}
            className={`key ${black ? "key--black" : "key--white"}${on ? " key--on" : ""}`}
            style={black ? { ["--at" as string]: whiteIndex(midi) } : undefined}
            aria-label={spokenName(midi)}
            aria-pressed={on}
            tabIndex={
              midi === (focused.current >= low && focused.current <= high ? focused.current : low)
                ? 0
                : -1
            }
            onFocus={() => (focused.current = midi)}
            onKeyDown={(e) => keyDown(e, midi)}
            onKeyUp={keyUp}
            onClick={(e) => e.preventDefault()}
          >
            <span className="key__marks" aria-hidden="true">
              {label && <kbd className="key__kbd">{label}</kbd>}
              {showNames && (
                <span className="key__name">{black ? pitchClass(midi) : noteName(midi)}</span>
              )}
              <span className="key__dot" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
