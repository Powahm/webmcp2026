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
  const seen = useRef(0);
  const ghostRef = useRef(null);

  const here = s.calls.length > 0;

  /* --- new calls become things it says ---------------------------------- */
  useEffect(() => {
    if (s.calls.length === 0) return;

    // calls[] is newest first. Anything above the count we last handled is new.
    const fresh = s.calls.slice(0, s.calls.length - seen.current).reverse();
    if (fresh.length === 0) return;

    const first = seen.current === 0;
    seen.current = s.calls.length;

    setBubbles((prev) => [
      ...prev,
      ...(first ? [{ id: "hello", kind: "hello", text: "Agent connected", at: Date.now() }] : []),
      ...fresh.map((c, i) => ({
        id: `${c.at}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        kind: isProposal(c.name) ? "proposal" : "read",
        tool: c.name,
        text: labelFor(c.name),
        ok: c.ok,
        at: Date.now(),
      })),
    ]);
  }, [s.calls]);

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
