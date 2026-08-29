import { useState } from "react";
import { useToolLogStore } from "../state/toolLogStore";

/**
 * Live WebMCP calls.
 *
 * Not a debug panel. It is the evidence a judge watches — every tool call, its
 * arguments, whether it was read-only, and how long it took. If the agent's
 * work is invisible, the WebMCP claim rests on the demo narration; here it
 * rests on the screen.
 */
export default function ToolLog() {
  const entries = useToolLogStore((s) => s.entries);
  const clear = useToolLogStore((s) => s.clear);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className="toollog">
      <header className="toollog-head">
        <h2>WebMCP calls</h2>
        <span className="count">{entries.length}</span>
        {entries.length > 0 && (
          <button className="ghost" onClick={clear}>
            clear
          </button>
        )}
      </header>

      <div className="toollog-body">
        {entries.length === 0 && (
          <p className="empty">
            No calls yet. Open this page in an agentic browser and ask it something
            about what you have selected.
          </p>
        )}

        <ul>
          {entries.map((e) => {
            const args = JSON.stringify(e.args ?? {});
            const isOpen = expanded === e.id;
            return (
              <li key={e.id} className={e.ok ? "" : "failed"}>
                <button
                  className="call"
                  onClick={() => setExpanded(isOpen ? null : e.id)}
                  title="Show full arguments"
                >
                  <span className="time">
                    {new Date(e.at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className={`kind ${e.readOnly ? "read" : "write"}`}>
                    {e.readOnly ? "read" : "write"}
                  </span>
                  <span className="tool">{e.tool}</span>
                  <span className="args">{args === "{}" ? "()" : args}</span>
                  <span className="summary">{e.summary}</span>
                  <span className="ms">{e.durationMs}ms</span>
                </button>
                {isOpen && <pre className="args-full">{JSON.stringify(e.args, null, 2)}</pre>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
