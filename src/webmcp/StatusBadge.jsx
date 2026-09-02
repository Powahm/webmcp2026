import { useEffect, useState, useSyncExternalStore } from "react";
import { getSnapshot, subscribe } from "./status.js";

/**
 * Is anything out there?
 *
 * Four states, and the wording of each is doing real work:
 *
 *   checking   registration has not run yet
 *   offline    no WebMCP host on this page. Normal Chrome looks like this, and
 *              it is not an error, so it does not read like one.
 *   ready      the host took the tools. They can be seen, but nothing has
 *              asked for anything yet.
 *   connected  a tool has actually been called. This is the only state that is
 *              evidence of an agent, which is why it is the only one that says
 *              so.
 *
 * The distinction between "ready" and "connected" is the whole point. A page
 * cannot detect an agent; it can only notice being used by one.
 */

const AGO = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
};

export default function StatusBadge() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  const [open, setOpen] = useState(false);
  // Re-render on a timer so "3s ago" does not sit there being wrong.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const state =
    s.host === null ? "checking"
    : s.host === "none" ? "offline"
    : s.calls.length > 0 ? "connected"
    : "ready";

  const label = {
    checking: "Checking",
    offline: "No agent",
    ready: `${s.registered.length} tools ready`,
    connected: s.inFlight > 0 ? "Agent working" : `Agent connected`,
  }[state];

  const dot = {
    checking: "bg-[var(--text-muted)]",
    offline: "bg-[var(--text-muted)]",
    ready: "bg-[var(--yellow)]",
    connected: "bg-[var(--green)]",
  }[state];

  return (
    <div className="relative">
      <button
        className="chip"
        aria-expanded={open}
        aria-label={`WebMCP status: ${label}`}
        title="Whether an agent can see this page, and whether one has used it"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`inline-block h-[8px] w-[8px] rounded-full ${dot} ${
            s.inFlight > 0 ? "animate-pulse" : ""
          }`}
          aria-hidden="true"
        />
        <span>{label}</span>
        {state === "connected" && (
          <span className="mono ml-0.5 opacity-60">{s.calls.length}</span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-[calc(100%+8px)] z-[500] w-[290px] rounded-[var(--radius)]
                     border-[length:var(--bw)] border-solid border-[var(--line)] bg-[var(--surface)]
                     p-3 text-[12px] leading-relaxed shadow-[4px_4px_0_var(--shadow)]"
          role="dialog"
          aria-label="WebMCP status"
        >
          {state === "offline" && (
            <>
              <p className="m-0 font-semibold">No agent host on this page.</p>
              <p className="m-0 mt-1.5 text-[var(--text-muted)]">
                That is normal in an ordinary browser. Open this site in ChatGPT&rsquo;s
                browser, or Chrome 149+ with{" "}
                <code className="mono">chrome://flags/#enable-webmcp-testing</code>, and the
                tools appear in its Site tools panel.
              </p>
            </>
          )}

          {state === "ready" && (
            <>
              <p className="m-0 font-semibold">Tools are on offer.</p>
              <p className="m-0 mt-1.5 text-[var(--text-muted)]">
                {s.registered.length} registered on <code className="mono">{s.host}</code>.
                Nothing has called one yet, so nothing is reading this page. Ask the agent
                something about your timeline and this turns green.
              </p>
            </>
          )}

          {state === "connected" && (
            <>
              <p className="m-0 font-semibold">
                An agent is using this page.{" "}
                <span className="font-normal text-[var(--text-muted)]">
                  {s.inFlight > 0 ? "Call in flight." : `Last call ${AGO(Date.now() - s.lastCallAt)}.`}
                </span>
              </p>
              <p className="m-0 mt-1 text-[var(--text-muted)]">
                {s.calls.length} call{s.calls.length === 1 ? "" : "s"} on{" "}
                <code className="mono">{s.host}</code>.
              </p>
              <ul className="m-0 mt-2 max-h-[168px] list-none overflow-auto p-0">
                {s.calls.slice(0, 8).map((c, i) => (
                  <li
                    key={`${c.at}-${i}`}
                    className="flex items-baseline gap-2 border-t-[length:1px] border-solid
                               border-[var(--line)] py-1 pr-1 first:border-t-0"
                  >
                    <span
                      className={`mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full ${
                        c.ok ? "bg-[var(--green)]" : "bg-[var(--accent)]"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="mono min-w-0 flex-1 truncate text-[11px]">{c.summary}</span>
                    <span className="mono shrink-0 text-[10px] text-[var(--text-muted)]">{c.ms}ms</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {s.failed.length > 0 && (
            <p className="m-0 mt-2 text-[11px] text-[var(--accent)]">
              {s.failed.length} tool{s.failed.length === 1 ? "" : "s"} refused by the host:{" "}
              {s.failed.map((f) => f.name).join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
