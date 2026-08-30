import { useCallback, useMemo, useRef, useState } from "react";
import { getCorpus } from "../corpus/loadCorpus";
import { ingestDocument, openDocument } from "../state/actions";
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
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * The analyst's own interaction with the drop zone.
   *
   * `ingestDocument` requires a trusted gesture, and the natural candidate —
   * the file input's `change` event — is the wrong one: it fires after the
   * browser's file dialog, and in some contexts arrives untrusted even though
   * a real person picked the file. The gesture that actually means "I am
   * adding this" is the pointer going down on the drop zone, so that is what
   * we keep and hand on.
   */
  const gestureRef = useRef<{ isTrusted: boolean } | null>(null);

  /**
   * Take in whatever the analyst dropped.
   *
   * Text only, and deliberately so: PDF.js plus stable character offsets is a
   * different project, and an offset that drifts would silently point every
   * mark and every citation at the wrong words. Better to accept less than to
   * accept something we cannot cite honestly.
   */
  const ingest = useCallback(async (files: FileList | null, ev: { isTrusted: boolean }) => {
    if (!files?.length) return;
    setError(null);
    const gesture = ev?.isTrusted ? ev : gestureRef.current;
    for (const file of Array.from(files)) {
      if (!/\.(txt|md|markdown|csv|log|json)$/i.test(file.name)) {
        setError(`"${file.name}" is not a text file. Plain text or Markdown only.`);
        continue;
      }
      const res = ingestDocument(file.name, await file.text(), gesture ?? undefined);
      if (!res.ok) setError(res.error);
    }
  }, []);

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

      <div
        className={`dropzone ${dragging ? "over" : ""}`}
        onPointerDown={(e) => {
          gestureRef.current = e.nativeEvent;
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingest(e.dataTransfer.files, e.nativeEvent);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.markdown,.csv,.log,.json"
          multiple
          hidden
          onChange={(e) => {
            void ingest(e.target.files, e.nativeEvent);
            e.target.value = "";
          }}
        />
        <button className="dropzone-btn" onClick={() => fileRef.current?.click()}>
          Drop a document, or browse
        </button>
        <span className="dropzone-note">
          Text or Markdown. It stays in this browser — there is no server.
        </span>
      </div>

      {error && <p className="dropzone-error">{error}</p>}

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
