import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TOUR_STEPS, type TourApi } from "./steps";
import { useTourStore } from "./tourStore";

/**
 * The spotlight.
 *
 * One scrim element with a very large box-shadow punches a hole around the
 * target's bounding box, cheaper and far more robust than four positioned
 * rectangles, and it cannot leave a seam when the target straddles a pixel.
 *
 * The card is placed on the side the step asks for, then pushed back inside the
 * viewport if that would overflow. Placement is measured rather than guessed,
 * because a tour card that falls off the bottom of the screen is the failure
 * mode nobody catches until a judge is watching.
 */

const PAD = 8;
const GAP = 14;
const CARD_W = 340;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const reduced = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Tour({ api }: { api: TourApi }) {
  const open = useTourStore((s) => s.open);
  const step = useTourStore((s) => s.step);
  const next = useTourStore((s) => s.next);
  const back = useTourStore((s) => s.back);
  const close = useTourStore((s) => s.close);

  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const current = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;

  // Put the app into the state this step talks about, before measuring, the
  // target may not exist, or may be the wrong size, until the tab has switched.
  useEffect(() => {
    if (!open || !current) return;
    current.before?.(api);
  }, [open, step, current, api]);

  const measure = useCallback(() => {
    if (!current) return;
    if (!current.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 });
  }, [current]);

  // Measured after the DOM has updated for this step, and again on the next
  // frame: a tab switch re-lays-out the rail, and the first measurement can
  // catch the panel mid-change.
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, measure]);

  // Place the card: preferred side first, then clamp into the viewport.
  useLayoutEffect(() => {
    if (!open || !current) return;
    const card = cardRef.current;
    if (!card) return;
    const ch = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!rect || current.side === "center") {
      setCardPos({ top: Math.max(GAP, (vh - ch) / 2), left: Math.max(GAP, (vw - CARD_W) / 2) });
      return;
    }

    let top: number;
    let left: number;
    switch (current.side) {
      case "top":
        top = rect.top - ch - GAP;
        left = rect.left + rect.width / 2 - CARD_W / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2 - ch / 2;
        left = rect.left - CARD_W - GAP;
        break;
      case "right":
        top = rect.top + rect.height / 2 - ch / 2;
        left = rect.left + rect.width + GAP;
        break;
      default:
        top = rect.top + rect.height + GAP;
        left = rect.left + rect.width / 2 - CARD_W / 2;
    }

    setCardPos({
      top: Math.min(Math.max(GAP, top), Math.max(GAP, vh - ch - GAP)),
      left: Math.min(Math.max(GAP, left), Math.max(GAP, vw - CARD_W - GAP)),
    });
  }, [open, step, rect, current]);

  // Keyboard: move, exit, and keep focus inside the card so a keyboard user
  // cannot tab out behind the scrim into an interface they cannot see.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        last ? close() : next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.key === "Tab") {
        const focusables = cardRef.current?.querySelectorAll<HTMLElement>("button");
        if (!focusables?.length) return;
        const first = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, last, next, back, close]);

  useEffect(() => {
    if (!open) return;
    cardRef.current?.querySelector<HTMLElement>("button.primary")?.focus();
  }, [open, step]);

  if (!open || !current) return null;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div
        className={`tour-scrim ${rect ? "cut" : "full"} ${reduced() ? "still" : ""}`}
        style={
          rect
            ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
            : undefined
        }
        onClick={close}
      />

      <div
        className="tour-card"
        ref={cardRef}
        style={{ top: cardPos.top, left: cardPos.left, width: CARD_W }}
      >
        <p className="tour-count">
          <span aria-hidden="true">
            {step + 1} / {TOUR_STEPS.length}
          </span>
          <span className="sr-only">
            Step {step + 1} of {TOUR_STEPS.length}
          </span>
        </p>

        <h2 id="tour-title">{current.title}</h2>
        <p className="tour-body">{current.body}</p>

        <div className="tour-actions">
          <button className="ghost sm" onClick={close}>
            {last ? "Close" : "Skip"}
          </button>
          <span className="tour-spacer" />
          {step > 0 && (
            <button className="ghost sm" onClick={back}>
              Back
            </button>
          )}
          <button className="primary sm" onClick={last ? close : next}>
            {last ? "Start reading" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
