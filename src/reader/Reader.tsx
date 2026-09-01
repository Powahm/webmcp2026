import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCorpus } from "../corpus/loadCorpus";
import {
  addMarking,
  captureSelection,
  clearScrollRequest,
  raiseEnquiry,
  removeMarking,
  setVisibleSpan,
} from "../state/actions";
import { markingsFor, useReaderStore } from "../state/readerStore";
import { MARKING_TYPES, type MarkingType } from "../types";
import { dominant, hasAgentMark, segment } from "./markings";
import { readSelection } from "./selection";

/**
 * The reader, the analyst's work surface.
 *
 * This is the human doing the job, and it happens before any agent is involved:
 * open a filing, read it, drag across a passage, mark it. Take the agent out of
 * the application and this panel still does something a person would want.
 * See docs/METHOD.md.
 *
 * Two rules govern everything here:
 *
 *  1. **The text is never reformatted.** No wrapping, trimming, smart quotes or
 *     whitespace collapsing. Every span in the corpus and every mark the
 *     analyst makes indexes this exact string, so touching it at display time
 *     would silently point every citation at the wrong words.
 *  2. **The human's marks colour the page; the agent's only underline it.**
 *     That survives greyscale and colour-blindness, and it keeps the analyst's
 *     own reading visually primary.
 */

/**
 * Below this the marks column and a 78-column filing stop fitting side by side:
 * 236px of queue + 372px of rail + 268px of margin + the text itself. Measured,
 * not guessed, see the media queries in App.css that step the rails down.
 */
const MARGIN_FITS_ABOVE = "(max-width: 1520px)";

const TYPE_KEYS: Record<string, MarkingType> = {
  "1": "person",
  "2": "company",
  "3": "address",
  "4": "date",
  "5": "question",
  "6": "lead",
};

export default function Reader() {
  const openDocId = useReaderStore((s) => s.openDocId);
  const markingMap = useReaderStore((s) => s.markings);
  const selection = useReaderStore((s) => s.selection);
  const scrollRequest = useReaderStore((s) => s.scrollRequest);

  const textRef = useRef<HTMLPreElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<{ start: number; end: number } | null>(null);

  const doc = useMemo(
    () => (openDocId ? (getCorpus().documents.get(openDocId) ?? null) : null),
    [openDocId]
  );

  const marks = useMemo(
    () => (doc ? markingsFor(markingMap, doc.id) : []),
    [markingMap, doc]
  );

  const segments = useMemo(
    () => (doc ? segment(doc.text, marks) : []),
    [doc, marks]
  );

  // --- Capture the selection ------------------------------------------------
  // On `selectionchange`, into the store. Never read at tool-call time. By the
  // time an agent invokes a tool the analyst has clicked into another surface
  // and document.getSelection() is collapsed, so reading it there would return
  // null exactly when it matters. See docs/TOOLS.md, get_reader_context.
  useEffect(() => {
    if (!doc) return;
    const onChange = () => {
      const el = textRef.current;
      if (!el) return;
      const read = readSelection(el, doc.text);
      // A collapsed selection means the analyst clicked away, not that they
      // withdrew what they highlighted. Keep the last real one.
      if (read) captureSelection({ doc_id: doc.id, ...read });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [doc]);

  // --- Report roughly what is on screen -------------------------------------
  useEffect(() => {
    const scroller = scrollRef.current;
    const pre = textRef.current;
    if (!scroller || !pre || !doc) return;

    const report = () => {
      const total = pre.scrollHeight || 1;
      const top = scroller.scrollTop;
      const height = scroller.clientHeight;
      const chars = doc.text.length;
      setVisibleSpan({
        start: Math.max(0, Math.floor((top / total) * chars)),
        end: Math.min(chars, Math.ceil(((top + height) / total) * chars)),
      });
    };
    report();
    scroller.addEventListener("scroll", report, { passive: true });
    return () => scroller.removeEventListener("scroll", report);
  }, [doc]);

  // --- Scroll to a span (a citation click, or the agent's open_document) ----
  const scrollToSpan = useCallback((span: { start: number; end: number }) => {
    const el = textRef.current?.querySelector<HTMLElement>(
      `[data-start="${span.start}"]`
    );
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(span);
    window.setTimeout(() => setFlash(null), 1600);
  }, []);

  useEffect(() => {
    if (!scrollRequest || !doc || scrollRequest.doc_id !== doc.id) return;
    // One frame, so the segments for the newly opened filing are in the DOM.
    const raf = requestAnimationFrame(() => {
      scrollToSpan(scrollRequest.span);
      clearScrollRequest();
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollRequest, doc, scrollToSpan]);

  // --- Marking --------------------------------------------------------------
  const mark = useCallback(
    (type: MarkingType) => {
      if (!doc) return;
      const el = textRef.current;
      const live = el ? readSelection(el, doc.text) : null;
      const use = live ?? (selection?.doc_id === doc.id ? selection : null);
      if (!use) return;
      addMarking({ doc_id: doc.id, span: { start: use.start, end: use.end }, type, origin: "human" });
      document.getSelection()?.removeAllRanges();
      captureSelection(null);
    },
    [doc, selection]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const type = TYPE_KEYS[e.key];
      if (type) {
        e.preventDefault();
        mark(type);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mark]);

  const pendingSelection = selection?.doc_id === doc?.id ? selection : null;

  /**
   * The margin costs 268px, and a filing is 78 columns of monospace that must
   * not wrap, the claim is that this is the record rendered verbatim, and a
   * correspondence address broken across two lines reads as a bug. So below the
   * width where both fit, the margin folds away and the analyst opens it when
   * they want it. Above it, nothing changes.
   */
  const [marginOpen, setMarginOpen] = useState(
    () => !window.matchMedia(MARGIN_FITS_ABOVE).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(MARGIN_FITS_ABOVE);
    const sync = () => setMarginOpen(!mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (!doc) {
    return (
      <div className="reader">
        <div className="reader-empty">
          <h2>No filing open</h2>
          <p className="dim">Choose one from the queue to start reading.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="reader">
      <header className="reader-head">
        <div className="reader-title">
          <h2>{doc.title}</h2>
          <p className="reader-meta">
            <code>{doc.id}</code>
            {doc.date && <span> · {doc.date}</span>}
            <span> · {doc.text.length.toLocaleString()} characters</span>
            <span> · {marks.length} mark{marks.length === 1 ? "" : "s"}</span>
          </p>
        </div>

        <button
          className={`margin-toggle ${marginOpen ? "on" : ""}`}
          type="button"
          onClick={() => setMarginOpen((o) => !o)}
          aria-expanded={marginOpen}
          aria-controls="reader-margin"
        >
          Marks
          <span className="count">{marks.length}</span>
        </button>
      </header>

      <div className={`reader-body ${marginOpen ? "" : "solo"}`}>
        {/* Focusable and named: without tabIndex a keyboard user cannot scroll
            the filing at all, which is an axe 'serious' and, more to the point,
            makes the primary reading surface unusable without a mouse. */}
        <div
          className="reader-scroll"
          ref={scrollRef}
          tabIndex={0}
          role="region"
          aria-label={`Filing: ${doc.title}`}
        >
          {/* white-space: pre-wrap, and the string is never touched. */}
          <pre className="filing-text" ref={textRef} data-tour="filing">
            {segments.map((seg) => {
              const top = dominant(seg.marks);
              if (!top) {
                return (
                  <span key={seg.start} data-start={seg.start}>
                    {seg.text}
                  </span>
                );
              }
              const classes = [
                "mk",
                `mk-${top.type}`,
                top.origin === "agent" ? "mk-agent" : "mk-human",
                hasAgentMark(seg.marks) && top.origin === "human" ? "mk-both" : "",
                flash && seg.start >= flash.start && seg.end <= flash.end ? "mk-flash" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <span
                  key={seg.start}
                  data-start={seg.start}
                  className={classes}
                  title={
                    seg.marks
                      .map((m) => `${m.origin === "agent" ? "agent" : "you"}: ${m.type}${m.note ? `, ${m.note}` : ""}`)
                      .join("\n")
                  }
                >
                  {seg.text}
                </span>
              );
            })}
          </pre>

          <p className="provenance">
            Source: UK Companies House public records, rendered verbatim from the
            ingested filing. Structural facts only.
          </p>
        </div>

        {marginOpen && <MarginList docId={doc.id} onGoTo={scrollToSpan} />}
      </div>

      <MarkBar selection={pendingSelection} onMark={mark} />
    </div>
  );
}

// --- The marking toolbar ----------------------------------------------------

function MarkBar({
  selection,
  onMark,
}: {
  selection: { start: number; end: number; text: string } | null;
  onMark: (t: MarkingType) => void;
}) {
  const preview =
    selection && selection.text.length > 64
      ? `${selection.text.slice(0, 61)}…`
      : selection?.text;

  return (
    <footer className={`markbar ${selection ? "armed" : ""}`} data-tour="markbar">
      {selection ? (
        <>
          <span className="markbar-sel" title={selection.text}>
            “{preview}”
          </span>
          <span className="markbar-label">mark as</span>
        </>
      ) : (
        <span className="markbar-label dim">
          Select a passage to mark it. The agent can read what you mark.
        </span>
      )}

      <div className="markbar-types">
        {MARKING_TYPES.map((t, i) => (
          <button
            key={t}
            className={`type-btn t-${t}`}
            disabled={!selection}
            onClick={() => onMark(t)}
            title={`Mark as ${t} (${i + 1})`}
          >
            <i className={`swatch mk-${t}`} />
            {t}
            <kbd>{i + 1}</kbd>
          </button>
        ))}
      </div>
    </footer>
  );
}

// --- The margin -------------------------------------------------------------

function MarginList({
  docId,
  onGoTo,
}: {
  docId: string;
  onGoTo: (span: { start: number; end: number }) => void;
}) {
  const markingMap = useReaderStore((s) => s.markings);
  const marks = useMemo(() => markingsFor(markingMap, docId), [markingMap, docId]);
  const [asking, setAsking] = useState<string | null>(null);
  const [question, setQuestion] = useState("");

  const submit = (markId: string, ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const res = raiseEnquiry(question, markId, ev.nativeEvent as unknown as { isTrusted: boolean });
    if (res.ok) {
      setAsking(null);
      setQuestion("");
    }
  };

  // Applies to the agent's marks too: the analyst reads them alongside its
  // own and must be able to clear either kind, the same way it can accept or
  // reject the agent's other claims.
  const remove = (markId: string, ev: React.MouseEvent<HTMLButtonElement>) => {
    removeMarking(markId, ev.nativeEvent as unknown as { isTrusted: boolean });
    if (asking === markId) setAsking(null);
  };

  return (
    <aside className="margin" id="reader-margin">
      <header className="margin-head">
        <h3>Marks</h3>
        <span className="count">{marks.length}</span>
      </header>

      {marks.length === 0 && (
        <p className="empty">
          Nothing marked in this filing yet. Select a passage and press 1-6.
        </p>
      )}

      <ul className="margin-list">
        {marks.map((m) => (
          <li key={m.id} className={`margin-mark ${m.origin}`}>
            <div className="margin-row">
              <button className="margin-jump" onClick={() => onGoTo(m.span)}>
                <span className={`swatch mk-${m.type}`} />
                <span className="margin-type">{m.type}</span>
                {m.origin === "agent" && <span className="by-agent">agent</span>}
                <span className="margin-text">{m.text.slice(0, 90)}</span>
              </button>
              <button
                type="button"
                className="margin-delete"
                aria-label={`Delete this ${m.type} mark`}
                title="Delete this mark"
                onClick={(ev) => remove(m.id, ev)}
              >
                ×
              </button>
            </div>
            {m.note && <p className="margin-note">{m.note}</p>}

            {asking === m.id ? (
              <form className="ask-form" onSubmit={(ev) => submit(m.id, ev)}>
                <input
                  autoFocus
                  value={question}
                  placeholder="What do you want to know?"
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <button className="primary sm" type="submit" disabled={!question.trim()}>
                  Raise
                </button>
                <button className="ghost sm" type="button" onClick={() => setAsking(null)}>
                  cancel
                </button>
              </form>
            ) : (
              m.origin === "human" && (
                <button
                  className="ghost sm"
                  onClick={() => {
                    setAsking(m.id);
                    setQuestion("");
                  }}
                >
                  raise a line of enquiry
                </button>
              )
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
