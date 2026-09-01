import { getCorpus } from "../corpus/loadCorpus";
import type { Marking } from "../types";
import { useReaderStore } from "./readerStore";

/**
 * Markings survive a refresh, and nothing else does.
 *
 * `sessionStorage`, deliberately, not `localStorage`: the store is scoped to
 * the tab, so a reload — accidental, or the one the analyst does after enabling
 * a browser flag — keeps their marks, and closing the tab ends the session for
 * good. That is the same promise the project already makes ("no persistence
 * beyond a session"); losing ten minutes of reading to a stray Cmd-R was never
 * part of it.
 *
 * Only marks. The canvas, the enquiry queue and the decision log still start
 * clean, because a half-restored investigation is worse than an honest empty
 * one: an audit trail that survived a reload with gaps in it is not an audit
 * trail. A mark is different — it is a note about a document, and the document
 * is still there.
 *
 * Every restored mark is re-checked against the corpus before it is trusted,
 * which is the same discipline scripts/check-offsets.ts applies at build time:
 * a span that no longer quotes the text it claims to quote is dropped rather
 * than shown. That is what makes an uploaded file's marks disappear correctly —
 * the upload does not survive the reload, so neither can a mark into it.
 */

const KEY = "threadweaver:markings:v1";

/** sessionStorage throws in some embedded contexts. Never let it break boot. */
function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isMarking(v: unknown): v is Marking {
  const m = v as Partial<Marking> | null;
  return (
    !!m &&
    typeof m.id === "string" &&
    typeof m.doc_id === "string" &&
    typeof m.text === "string" &&
    typeof m.type === "string" &&
    (m.origin === "human" || m.origin === "agent") &&
    typeof m.created_at === "number" &&
    !!m.span &&
    Number.isInteger(m.span.start) &&
    Number.isInteger(m.span.end) &&
    m.span.start >= 0 &&
    m.span.end > m.span.start
  );
}

/**
 * Rehydrate. Call once, after the corpus has loaded and after seedCanvas — the
 * seed does not touch markings, but the corpus check below needs the documents.
 *
 * Returns how many marks came back, so the caller can say so in the log.
 */
export function restoreMarkings(): number {
  const s = store();
  if (!s) return 0;

  let parsed: unknown;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return 0;
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt or truncated. Drop it silently; a stale key is not worth an error
    // in front of the analyst.
    try {
      s.removeItem(KEY);
    } catch {
      /* nothing further to do */
    }
    return 0;
  }

  if (!Array.isArray(parsed)) return 0;

  const { documents } = getCorpus();
  const map = new Map<string, Marking>();

  for (const item of parsed) {
    if (!isMarking(item)) continue;
    const doc = documents.get(item.doc_id);
    // The filing is gone (an upload from the previous page life), or the span
    // no longer quotes what the mark says it quotes. Either way, do not show it.
    if (!doc || doc.text.slice(item.span.start, item.span.end) !== item.text) continue;
    map.set(item.id, item);
  }

  if (map.size) useReaderStore.getState()._setMarkings(map);
  return map.size;
}

let subscribed = false;

/**
 * Mirror every change to the marking set into sessionStorage.
 *
 * A subscription rather than a call inside `addMarking` / `removeMarking`:
 * actions.ts is the single mutation path and should not also become the
 * persistence path, and every write already funnels through `_setMarkings`, so
 * there is exactly one thing to watch.
 */
export function startMarkingPersistence(): void {
  if (subscribed) return;
  subscribed = true;

  useReaderStore.subscribe((state, prev) => {
    if (state.markings === prev.markings) return;
    const s = store();
    if (!s) return;
    try {
      s.setItem(KEY, JSON.stringify([...state.markings.values()]));
    } catch {
      // Quota, or storage disabled mid-session. The app carries on; the marks
      // are still in memory and only this tab's reload would lose them.
    }
  });
}
