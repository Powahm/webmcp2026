import { create } from "zustand";
import type { Marking, Span } from "../types";

/**
 * The reader: what the analyst has open, what they have selected right now, and
 * every passage either actor has marked.
 *
 * This is the state `get_reader_context` and `get_markings` expose, and it is
 * the strongest WebMCP argument in the project. None of it exists anywhere but
 * this page: the filing text is rendered from memory, the offsets index a
 * string that never travelled over the wire, and the live selection is gone the
 * moment the analyst clicks elsewhere.
 *
 * Nothing outside src/state/actions.ts calls the `_`-prefixed setters.
 */

export interface LiveSelection extends Span {
  doc_id: string;
  text: string;
}

interface ReaderState {
  /** Ids of the filings in the working set, in queue order. */
  queue: string[];
  openDocId: string | null;
  markings: Map<string, Marking>;

  /**
   * The last non-empty selection the analyst made inside the reader.
   *
   * Captured on `selectionchange` and *kept* — deliberately not read at
   * tool-call time. By the time an agent invokes a tool the analyst has clicked
   * into another surface and `document.getSelection()` is collapsed, so reading
   * it there returns null exactly when it matters. Cleared only when a
   * different filing is opened. See docs/TOOLS.md, `get_reader_context`.
   */
  selection: LiveSelection | null;

  /** Roughly what is on screen, so the agent doesn't describe text the analyst
   *  cannot see. Maintained by the Reader on scroll. */
  visibleSpan: Span | null;

  /** Bumped by actions.openDocument; the Reader watches it and scrolls. */
  scrollRequest: { doc_id: string; span: Span; nonce: number } | null;

  _setQueue: (ids: string[]) => void;
  _setOpenDoc: (id: string | null) => void;
  _setMarkings: (m: Map<string, Marking>) => void;
  _setSelection: (s: LiveSelection | null) => void;
  _setVisibleSpan: (s: Span | null) => void;
  _setScrollRequest: (r: { doc_id: string; span: Span; nonce: number } | null) => void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  queue: [],
  openDocId: null,
  markings: new Map(),
  selection: null,
  visibleSpan: null,
  scrollRequest: null,

  _setQueue: (queue) => set({ queue }),
  _setOpenDoc: (openDocId) => set({ openDocId }),
  _setMarkings: (markings) => set({ markings }),
  _setSelection: (selection) => set({ selection }),
  _setVisibleSpan: (visibleSpan) => set({ visibleSpan }),
  _setScrollRequest: (scrollRequest) => set({ scrollRequest }),
}));

/** Read from outside React — the tool layer runs in no component. */
export const reader = () => useReaderStore.getState();

/** Markings for one document, in reading order. */
export const markingsFor = (m: Map<string, Marking>, docId: string): Marking[] =>
  [...m.values()].filter((x) => x.doc_id === docId).sort((a, b) => a.span.start - b.span.start);
