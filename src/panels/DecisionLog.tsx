import { exportDecisionLog, useDecisionLog } from "../state/decisionLog";

/**
 * The decision log.
 *
 * A major incident room keeps a policy log. Every significant decision and the
 * reasoning behind it, written down at the time. So the investigation can be
 * audited afterwards. E-discovery asks for the same thing and calls it an audit
 * trail.
 *
 * Both actors write to it, through the one mutation API, so it cannot disagree
 * with what actually happened. It is the cheapest thing in the project that
 * makes the product look like something that could survive disclosure rather
 * than a demo.
 */
export default function DecisionLog() {
  const entries = useDecisionLog((s) => s.entries);

  const download = () => {
    const blob = new Blob([exportDecisionLog(entries)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `threadweaver-decision-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    // Revoke on the next turn of the event loop: revoking synchronously can
    // race the browser's own read of the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section className="panel decisions">
      <header className="panel-head">
        <h2>Decision log</h2>
        <span className="count">{entries.length}</span>
        {entries.length > 0 && (
          <button className="ghost sm" onClick={download} title="Export as plain text">
            export
          </button>
        )}
      </header>

      {entries.length === 0 && (
        <p className="empty">
          Nothing yet. Every mark, question, acceptance and result lands here
          with who did it and when.
        </p>
      )}

      <ul className="decision-list">
        {entries.map((e) => (
          <li key={e.id} className={e.actor}>
            <span className="dec-time">
              {new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
            <span className={`origin ${e.actor}`}>{e.actor === "human" ? "you" : "agent"}</span>
            <span className="dec-action">{e.action}</span>
            <span className="dec-detail">{e.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
