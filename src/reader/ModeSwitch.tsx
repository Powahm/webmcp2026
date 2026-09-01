import { useState } from "react";
import { MARKING_TYPES, type MarkingType } from "../types";
import { useReaderMode } from "./modeStore";

/**
 * Cursor or highlighter, top right, with the loaded ink on the button.
 *
 * The palette opens on hover and on focus, so it is reachable with a mouse
 * without a click and with a keyboard without a mouse. It is not a menu widget:
 * it is six buttons in a box, which is what it looks like, and building it as a
 * roving-tabindex menu would make it worse to use in both cases.
 */

const LABEL: Record<MarkingType, string> = {
  person: "Person",
  company: "Company",
  address: "Address",
  date: "Date",
  question: "Question",
  lead: "Lead",
};

export default function ModeSwitch() {
  const mode = useReaderMode((m) => m.mode);
  const colour = useReaderMode((m) => m.colour);
  const setMode = useReaderMode((m) => m.setMode);
  const pick = useReaderMode((m) => m.pick);
  const [open, setOpen] = useState(false);

  return (
    <div
      className="mode-switch"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        className={`mode-btn ${mode === "cursor" ? "on" : ""}`}
        onClick={() => setMode("cursor")}
        aria-pressed={mode === "cursor"}
        title="Cursor: select a passage and choose what it is"
        aria-label="Cursor mode"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
          <path
            d="M3 2l9 5.2-3.8.9L6.6 12z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <button
        type="button"
        className={`mode-btn ${mode === "highlight" ? "on" : ""}`}
        onClick={() => setMode("highlight")}
        onFocus={() => setOpen(true)}
        aria-pressed={mode === "highlight"}
        aria-expanded={open}
        aria-haspopup="true"
        title={`Highlighter, loaded with ${LABEL[colour].toLowerCase()}. Selecting marks straight away.`}
        aria-label={`Highlighter mode, loaded with ${LABEL[colour].toLowerCase()}`}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
          <path
            d="M10.5 2.5l3 3-6 6H4.5v-3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M2.5 14.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {/* The loaded ink, the way a real highlighter shows its own colour. */}
        <i className={`mode-ink mk-${colour}`} aria-hidden />
      </button>

      {open && (
        <div className="mode-palette" role="group" aria-label="Highlighter colour">
          {MARKING_TYPES.map((t, i) => (
            <button
              key={t}
              type="button"
              className={`swatch-btn mk-${t} ${colour === t ? "on" : ""}`}
              onClick={() => {
                pick(t);
                setOpen(false);
              }}
              title={`${LABEL[t]} (press ${i + 1} to mark a selection)`}
              aria-label={`Load the highlighter with ${LABEL[t].toLowerCase()}`}
              aria-pressed={colour === t}
            >
              <span className="swatch-key" aria-hidden>
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
