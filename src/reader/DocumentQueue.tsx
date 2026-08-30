import { useMemo, useState } from "react";
import { getCorpus } from "../corpus/loadCorpus";
import { openDocument } from "../state/actions";
import { markingsFor, useReaderStore } from "../state/readerStore";

/**
 * The working set of filings.
 *
 * A major incident room's Receiver triages what arrives before the Reader gets
 * to it; this is the small version of that. It is also the only place in the
 * app that hints at scale: the queue holds what the analyst has pulled in, the
 * corpus behind it holds far more.
 */
export default function DocumentQueue() {
  const queue = useReaderStore((s) => s.queue);
  const openDocId = useReaderStore((s) => s.openDocId);
  const markingMap = useReaderStore((s) => s.markings);
  const [filter, setFilter] = useState("");

  const rows = useMemo(() => {
    const { documents } = getCorpus();
    const q = filter.trim().toLowerCase();
    return queue
      .map((id) => documents.get(id))
      .filter((d) => d !== undefined)
      .filter((d) => !q || d!.title.toLowerCase().includes(q))
      .map((d) => ({
        doc: d!,
        marks: markingsFor(markingMap, d!.id).length,
      }));
  }, [queue, filter, markingMap]);

  return (
    <section className="panel queue">
      <header className="panel-head">
        <h2>Filings</h2>
        <span className="count">{queue.length}</span>
      </header>

      {queue.length > 6 && (
        <input
          className="search-input sm"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
      )}

      {rows.length === 0 && (
        <p className="empty">
          No filings in the working set. Add an entity from the corpus and its
          filings come with it.
        </p>
      )}

      <ul className="queue-list">
        {rows.map(({ doc, marks }) => (
          <li key={doc.id}>
            <button
              className={`queue-item ${doc.id === openDocId ? "open" : ""}`}
              onClick={() => openDocument(doc.id)}
            >
              <span className="queue-title">{doc.title}</span>
              <span className="queue-meta">
                {doc.date && <span>{doc.date}</span>}
                {marks > 0 && <span className="queue-marks">{marks} marked</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
