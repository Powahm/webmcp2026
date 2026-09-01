import { useCallback, useMemo, useRef, useState } from "react";
import { getCorpus } from "../corpus/loadCorpus";
import { ingestDocument, openDocument } from "../state/actions";
import { markingsFor, useReaderStore } from "../state/readerStore";
import type { CorpusDocument } from "../types";

interface QueueRow {
  doc: CorpusDocument;
  /** What kind of record it is, with the company name stripped off. */
  kind: string;
  marks: number;
}

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
   * `ingestDocument` requires a trusted gesture, and the natural candidate.
   * The file input's `change` event. Is the wrong one: it fires after the
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

  /**
   * Grouped by the company the filing belongs to.
   *
   * Ninety filings titled "COMPANY NAME. Persons with significant control" is
   * ninety repetitions of the company name and nothing else to read. Grouping
   * says the name once and leaves the row to say which record it is, which is
   * the only part that differs.
   */
  const groups = useMemo(() => {
    const { documents, entities } = getCorpus();
    const q = filter.trim().toLowerCase();

    const byOwner = new Map<string, { label: string; rows: QueueRow[] }>();
    for (const id of queue) {
      const doc = documents.get(id);
      if (!doc) continue;
      if (q && !doc.title.toLowerCase().includes(q)) continue;

      // "COMPANY, register of directors" -> the part after the dash is what
      // distinguishes one row from another.
      const dash = doc.title.indexOf(", ");
      const kind = dash > -1 ? doc.title.slice(dash + 3) : doc.title;

      // Anything the analyst brought in has no owning entity. It goes first,
      // under its own heading, because it is theirs and not ours.
      const ownerId = doc.entity_id ?? "__yours__";
      const ownerLabel =
        ownerId === "__yours__"
          ? "Your documents"
          : (entities.get(ownerId)?.label ?? (dash > -1 ? doc.title.slice(0, dash) : ownerId));

      const group = byOwner.get(ownerId);
      const row: QueueRow = { doc, kind, marks: markingsFor(markingMap, doc.id).length };
      if (group) group.rows.push(row);
      else byOwner.set(ownerId, { label: ownerLabel, rows: [row] });
    }

    const all = [...byOwner.entries()].map(([id, g]) => ({ id, ...g }));
    // The analyst's own material first; everything else keeps queue order,
    // which puts the filing carrying hop one of the chain at the top.
    return all.sort((a, b) => (a.id === "__yours__" ? -1 : b.id === "__yours__" ? 1 : 0));
  }, [queue, filter, markingMap]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <section className="panel queue">
      <header className="panel-head">
        <h2>Filings</h2>
        <span className="count">{total}</span>
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
          Text or Markdown. It stays in this browser, there is no server.
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

      {total === 0 && (
        <p className="empty">
          {filter.trim()
            ? "No filing in the working set matches that."
            : "No filings yet. Add an entity from the corpus and its filings come with it, or drop in one of your own."}
        </p>
      )}

      <div className="queue-groups">
        {groups.map((g) => {
          const marks = g.rows.reduce((n, r) => n + r.marks, 0);
          return (
            <section key={g.id} className={`queue-group ${g.id === "__yours__" ? "yours" : ""}`}>
              <header className="queue-group-head">
                <span className="queue-company">{g.label}</span>
                {marks > 0 && <span className="queue-marks">{marks}</span>}
              </header>
              <ul className="queue-list">
                {g.rows.map(({ doc, kind, marks: n }) => (
                  <li key={doc.id}>
                    <button
                      className={`queue-item ${doc.id === openDocId ? "open" : ""}`}
                      onClick={() => openDocument(doc.id)}
                      title={doc.title}
                    >
                      <span className="queue-kind">{kind}</span>
                      {n > 0 && <span className="queue-marks">{n}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

    </section>
  );
}
