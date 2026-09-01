import { useLayoutEffect, useRef, useState } from "react";
import { MARKING_TYPES, type MarkingType } from "../types";

/** The six mark types read as plain words in a tooltip and to a screen reader. */
const LABEL: Record<MarkingType, string> = {
  person: "a person",
  company: "a company",
  address: "an address",
  date: "a date",
  question: "a question",
  lead: "a lead",
};


/**
 * The little card that appears over a fresh selection in cursor mode.
 *
 * It exists because the mark bar is at the bottom of the pane and the passage
 * you just selected is usually not: the analyst had to look away from their own
 * selection to say what it was. Putting the six types at the selection means
 * the decision happens where the evidence is.
 *
 * "Ask about this" sits beside them because raising a line of enquiry from a
 * passage is the strongest move in the app, and it was two panels away.
 */

const WIDTH = 268;
const GAP = 10;

export default function SelectionPopup({
  rect,
  onPick,
  onAsk,
  onDismiss,
}: {
  /** The selection's bounding box, in the coordinate space of the reader pane. */
  rect: { top: number; left: number; width: number; height: number };
  onPick: (t: MarkingType) => void;
  onAsk: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const parent = el.parentElement?.getBoundingClientRect();
    const maxLeft = Math.max(GAP, (parent?.width ?? WIDTH + GAP * 2) - WIDTH - GAP);
    // Above the selection by default; below it when there is no room above.
    const above = rect.top - h - GAP;
    setPos({
      top: above > GAP ? above : rect.top + rect.height + GAP,
      left: Math.min(Math.max(GAP, rect.left + rect.width / 2 - WIDTH / 2), maxLeft),
    });
  }, [rect]);

  return (
    <div
      className="sel-popup"
      ref={ref}
      role="dialog"
      aria-label="Mark this passage"
      style={{ top: pos.top, left: pos.left, width: WIDTH }}
      // Never let a click in here collapse the selection it is about to act on.
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="sel-popup-label">Mark as</p>
      <div className="sel-popup-types">
        {MARKING_TYPES.map((t, i) => (
          <button
            key={t}
            type="button"
            className={`swatch-btn mk-${t}`}
            title={`Mark as ${LABEL[t]} (press ${i + 1})`}
            aria-label={`Mark as ${LABEL[t]}`}
            onClick={() => onPick(t)}
          >
            <span className="swatch-key" aria-hidden>
              {i + 1}
            </span>
          </button>
        ))}
      </div>
      <div className="sel-popup-actions">
        <button type="button" className="ask-about sm" onClick={onAsk}>
          Ask about this
        </button>
        <button type="button" className="ghost sm" onClick={onDismiss}>
          Cancel
        </button>
      </div>
    </div>
  );
}
