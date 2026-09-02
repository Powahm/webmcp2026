/**
 * What the page can honestly say about the agent.
 *
 * WebMCP gives a page no "an agent connected" event, and inventing one would be
 * theatre. Three things are actually knowable, and the badge says exactly those
 * and nothing more:
 *
 *   1. whether a host exists at all, which is `document.modelContext` or, on
 *      Chrome's origin trial, `navigator.modelContext`;
 *   2. how many tools it accepted, because registerTool can reject one;
 *   3. whether any of them have been called, and when the last one was.
 *
 * Only the third is evidence of an agent. A host with tools registered means
 * the tools are *offerable*; a tool call means something is actually out there
 * reading this page. So "ready" and "connected" are deliberately different
 * words, and the badge never claims the second on the strength of the first.
 */

const state = {
  /** null until registration runs. "document.modelContext" | "navigator.modelContext" | "none" */
  host: null,
  registered: [],
  failed: [],
  /** Newest first, capped: this is a status light, not an audit trail. */
  calls: [],
  inFlight: 0,
  lastCallAt: 0,
  /**
   * Total calls ever, which is not the same as calls.length.
   *
   * The log is capped, so once it fills, its length stops changing and anything
   * watching for new calls by comparing lengths goes quiet forever. This
   * counter only ever goes up.
   */
  seq: 0,
};

const MAX_CALLS = 40;
const listeners = new Set();

/** useSyncExternalStore needs a stable snapshot, so mutations swap the object. */
let snapshot = { ...state };
function commit() {
  snapshot = { ...state, calls: state.calls.slice() };
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getSnapshot = () => snapshot;

export function setHost(host, registered, failed) {
  state.host = host;
  state.registered = registered;
  state.failed = failed;
  commit();
}

export function callStarted(name) {
  state.inFlight += 1;
  commit();
  return { name, at: Date.now() };
}

export function callFinished(record, ok, summary) {
  state.inFlight = Math.max(0, state.inFlight - 1);
  state.lastCallAt = Date.now();
  state.seq += 1;
  state.calls = [
    { ...record, ok, summary, ms: Date.now() - record.at, seq: state.seq },
    ...state.calls,
  ].slice(0, MAX_CALLS);
  commit();
}

/**
 * Wrap a tool so its calls show up in the badge.
 *
 * Read-only and write tools alike, because the question the badge answers is
 * "is anything out there", not "has anything changed".
 */
export function instrument(tool) {
  return {
    ...tool,
    execute: async (args) => {
      const record = callStarted(tool.name);
      try {
        const result = await tool.execute(args);
        callFinished(record, !result?.isError, summarise(tool.name, args));
        return result;
      } catch (err) {
        callFinished(record, false, String(err?.message || err));
        throw err;
      }
    },
  };
}

/** One short line per call, for the popover. Never the whole payload. */
function summarise(name, args) {
  const keys = Object.keys(args || {});
  if (keys.length === 0) return name;
  const first = keys
    .slice(0, 2)
    .map((k) => `${k}: ${String(args[k]).slice(0, 24)}`)
    .join(", ");
  return `${name} · ${first}`;
}
