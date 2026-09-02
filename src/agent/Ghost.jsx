import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "../webmcp/status.js";
import { isProposal, labelFor } from "./toolLabels.js";

/**
 * The agent, given a body.
 *
 * WebMCP is invisible by design: a model reads your page and writes into it
 * with nothing on screen to say so. That is fine for a protocol and terrible
 * for trust, and it is hopeless on video, where the most interesting thing
 * happening is a function call nobody can see.
 *
 * So the ghost is the model. It swoops in the first time a tool is called, and
 * every call after that it says which one, by name. Not a spinner and not a
 * "thinking" animation, both of which would be invented: every word it says
 * corresponds to a tool call that actually happened, in the order it happened.
 *
 * It never appears before a call. A registered tool means the agent *could*
 * read the page; a call means it did. That distinction is the same one the
 * status badge makes, and it is the only honest one available.
 */

/** How long a bubble stays up. Long enough to read, short enough to keep up. */
const LIFETIME = 4200;
/** Three at once, and the third carries the overflow. */
const MAX_BUBBLES = 3;

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function Ghost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const [bubbles, setBubbles] = useState([]);
  const [eyes, setEyes] = useState({ x: 0, y: 0 });
  /**
   * The offer to go and get a folder.
   *
   * The agent will not volunteer one: it has a folder attached to the chat and
   * no reason to think a web page wants to hear about it. So the page asks. It
   * appears a beat after the agent turns up, once, and goes away for good
   * whether they take it or not — an offer that keeps coming back is a nag.
   */
  const [askFolder, setAskFolder] = useState(false);
  const picker = useRef(null);
  const [asked, setAsked] = useState(false);
  /** The highest call sequence already spoken. Not a count of the log, which
   *  is capped and stops growing. */
  const seen = useRef(0);
  const ghostRef = useRef(null);

  const here = s.calls.length > 0;

  /* --- new calls become things it says ---------------------------------- */
  useEffect(() => {
    if (s.calls.length === 0) return;

    // calls[] is newest first, and it is capped, so its length stops changing
    // once it fills. Compare sequence numbers instead: they only go up.
    const fresh = s.calls.filter((c) => c.seq > seen.current).reverse();
    if (fresh.length === 0) return;

    const first = seen.current === 0;
    seen.current = Math.max(seen.current, ...s.calls.map((c) => c.seq));

    setBubbles((prev) => [
      ...prev,
      ...(first
        ? [{ id: "hello", kind: "hello", text: "Agent connected", at: Date.now() }]
        : []),
      ...fresh.map((c, i) => ({
        id: `${c.at}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        kind: !c.ok ? "failed" : isProposal(c.name) ? "proposal" : "read",
        tool: c.name,
        text: c.ok ? labelFor(c.name) : "that one did not work",
        ok: c.ok,
        at: Date.now(),
      })),
    ]);
  }, [s.calls]);

  /* --- the one thing it asks for ---------------------------------------- */
  // Load the folder code as soon as the question is on screen, not when it
  // is answered, so pressing the button opens the picker synchronously.
  useEffect(() => {
    if (!askFolder || picker.current) return;
    let live = true;
    import("../folders/import.js").then((m) => {
      if (live) picker.current = m.pickFolderOntoDesk;
    });
    return () => { live = false; };
  }, [askFolder]);

  useEffect(() => {
    if (!here || asked) return;
    const id = setTimeout(() => {
      setAskFolder(true);
      setAsked(true);
    }, 2600);
    return () => clearTimeout(id);
  }, [here, asked]);

  /* --- and then it stops saying them ------------------------------------ */
  useEffect(() => {
    if (bubbles.length === 0) return;
    const id = setInterval(() => {
      const now = Date.now();
      setBubbles((prev) => prev.filter((b) => now - b.at < LIFETIME));
    }, 400);
    return () => clearInterval(id);
  }, [bubbles.length]);

  /* --- the eyes follow you ---------------------------------------------- */
  useEffect(() => {
    if (!here || prefersReducedMotion()) return;
    const onMove = (e) => {
      const box = ghostRef.current?.getBoundingClientRect();
      if (!box) return;
      const dx = (e.clientX - (box.left + box.width / 2)) * 0.06;
      const dy = (e.clientY - (box.top + box.height / 2)) * 0.06;
      const cap = 7;
      setEyes({
        x: Math.max(-cap, Math.min(cap, dx)),
        y: Math.max(-cap, Math.min(cap, dy)),
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [here]);

  if (!here) return null;

  // Newest at the bottom, nearest the ghost. Past three, the last one carries
  // the count instead of the queue scrolling away faster than anyone can read.
  const recent = bubbles.slice(-MAX_BUBBLES);
  const overflow = bubbles.length - recent.length;

  return (
    <div className="agent-ghost" aria-live="polite">
      <div className="agent-bubbles">
        {askFolder && (
          <div className="agent-bubble ask">
            <div className="agent-ask">
              <p className="agent-ask-text">
                Want me to see your footage? Pick a folder and I can work with what is in it.
              </p>
              <div className="agent-ask-acts">
                <button
                  className="btn btn-mini btn-accent"
                  onClick={() => {
                    // The picker must open inside this click. The module is
                    // fetched when the question appears, so there is nothing
                    // left to await here: awaiting an import first can spend
                    // the user activation and the picker never opens.
                    setAskFolder(false);
                    picker.current?.();
                  }}
                >
                  Choose a folder
                </button>
                <button className="btn btn-mini" data-later onClick={() => setAskFolder(false)}>
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}
        {recent.map((b, i) => {
          const last = i === recent.length - 1;
          return (
            <div
              key={b.id}
              className={`agent-bubble ${b.kind}`}
              data-stack={overflow > 0 && i === 0 ? "true" : undefined}
            >
              {b.kind === "hello" ? (
                <span className="agent-bubble-hello">Agent connected</span>
              ) : (
                <>
                  <code className="mono agent-bubble-tool">{b.tool}</code>
                  <span className="agent-bubble-text">{b.text}</span>
                </>
              )}
              {overflow > 0 && i === 0 && (
                <span className="agent-bubble-count">+{overflow} more</span>
              )}
              {last && <span className="agent-bubble-tail" aria-hidden="true" />}
            </div>
          );
        })}
      </div>

      <div className="agent-body" ref={ghostRef} title="The agent is reading this page">
        <div className="agent-shape">
          <span className="agent-blob b1" />
          <span className="agent-blob b2" />
          <span className="agent-blob b3" />
        </div>
        <div
          className="agent-eyes"
          style={{ transform: `translate(${eyes.x}px, ${eyes.y}px)` }}
        >
          <span className="agent-eye" />
          <span className="agent-eye" />
        </div>
      </div>
    </div>
  );
}
