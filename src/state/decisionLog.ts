import { create } from "zustand";
import type { DecisionEntry } from "../types";

/**
 * The decision log.
 *
 * A major incident room keeps a policy log: every significant decision and the
 * reasoning behind it, written down at the time, so the investigation can be
 * audited afterwards. An e-discovery process asks for the same thing and calls
 * it an audit trail.
 *
 * It is append-only, both actors write to it, and it exports as plain text. It
 * is cheap, and it is what turns a demo into something that could survive
 * disclosure, see docs/METHOD.md.
 *
 * This is distinct from the tool log. The tool log records *calls*; this
 * records *decisions*, including every one the analyst made with a mouse.
 */

const MAX_ENTRIES = 500;

interface DecisionLogState {
  entries: DecisionEntry[];
  _push: (e: DecisionEntry) => void;
  clear: () => void;
}

export const useDecisionLog = create<DecisionLogState>((set) => ({
  entries: [],
  _push: (e) => set((s) => ({ entries: [e, ...s.entries].slice(0, MAX_ENTRIES) })),
  clear: () => set({ entries: [] }),
}));

export const decisionLog = () => useDecisionLog.getState();

const stamp = (at: number): string =>
  new Date(at).toISOString().replace("T", " ").slice(0, 19);

/** Plain text, oldest first, a log reads forwards. */
export function exportDecisionLog(entries: DecisionEntry[]): string {
  const lines = [
    "THREADWEAVER, DECISION LOG",
    `Exported ${stamp(Date.now())} UTC`,
    "",
    "Every entry below records who did what, and when. Structural facts about",
    "UK public records only; no conclusion here is asserted about any person.",
    "",
    "TIME                 ACTOR   ACTION      DETAIL",
    "".padEnd(78, "-"),
  ];
  for (const e of [...entries].reverse()) {
    lines.push(
      `${stamp(e.at)}  ${e.actor.padEnd(6)}  ${e.action.padEnd(10)}  ${e.detail}`
    );
  }
  lines.push("", `${entries.length} entries.`);
  return lines.join("\n");
}
