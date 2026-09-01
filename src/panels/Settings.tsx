import { useEffect, useRef } from "react";
import {
  DEFAULT_GLYPHS,
  GLYPH_CHOICES,
  NODE_KINDS,
  useGlyphStore,
} from "../canvas/glyphs";
import { TYPE_LABEL } from "./labels";

/**
 * Settings.
 *
 * One thing lives here: which glyph stands for which kind of entity on the
 * canvas. It is a display preference. Per browser, outside the decision log,
 * and unreachable from any WebMCP tool. The agent has no business changing how
 * the analyst's chart looks.
 *
 * A popover rather than a sixth tab in the right rail: five labels and their
 * badges already fill that row, and a preference the analyst sets once should
 * not permanently cost the width of a panel they use constantly.
 */
export default function Settings({ onClose }: { onClose: () => void }) {
  const glyphs = useGlyphStore((s) => s.glyphs);
  const setGlyph = useGlyphStore((s) => s.setGlyph);
  const reset = useGlyphStore((s) => s.reset);
  const ref = useRef<HTMLDivElement>(null);

  // Escape and click-away, the two things every popover owes its user.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Deferred: the click that opened this popover is still on its way up.
    const id = window.setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.clearTimeout(id);
    };
  }, [onClose]);

  return (
    <div className="settings-pop" ref={ref} role="dialog" aria-label="Settings">
      <header className="panel-head">
        <h2>Entity icons</h2>
        <button className="ghost" onClick={reset}>
          reset
        </button>
      </header>

      <p className="hint">
        Shown on every node. Pick one, or type any character, an emoji, a
        letter, a symbol.
      </p>

      <ul className="glyph-settings">
        {NODE_KINDS.map((kind) => (
          <li key={kind}>
            <span className="glyph-kind">{TYPE_LABEL[kind]}</span>
            <div className="glyph-choices">
              {GLYPH_CHOICES[kind].map((choice) => (
                <button
                  key={choice}
                  className={`glyph-choice ${glyphs[kind] === choice ? "on" : ""}`}
                  aria-pressed={glyphs[kind] === choice}
                  title={`Use ${choice} for ${TYPE_LABEL[kind]}`}
                  onClick={() => setGlyph(kind, choice)}
                >
                  {choice}
                </button>
              ))}
              <input
                className="glyph-input"
                value={glyphs[kind]}
                aria-label={`Custom icon for ${TYPE_LABEL[kind]}`}
                onChange={(e) => setGlyph(kind, e.target.value || DEFAULT_GLYPHS[kind])}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
