/**
 * Lines the agent has written into a script, waiting on the writer.
 *
 * Same shape as the graphics store and for the same reason: a proposal and an
 * accepted line are not two kinds of thing in two places, they are one record
 * with a `status`. One list renders both, and accepting is a field change
 * rather than a move between stores.
 *
 * The rule that matters: an agent can write a line into the draft you are
 * looking at, and still cannot change a word of it. There is no tool that
 * accepts. `take` and `drop` refuse without a trusted user event, which is how
 * the browser itself tells a click from a script.
 */

let proposals = [];
let counter = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const onProposals = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const proposalsFor = (scriptId) => proposals.filter((p) => p.scriptId === scriptId);
export const allProposals = () => proposals.slice();

const trusted = (g) => g?.isTrusted === true || g?.nativeEvent?.isTrusted === true;

/**
 * Stage a line.
 *
 * `mode` is "insert" or "replace". An insert lands before `index`, so index 0
 * is a new opening line and index === lines.length appends, which is what an
 * agent asked to "add a line at the end" will reach for.
 */
export function proposeLine({ scriptId, index, mode, text, note, reason }) {
  const proposal = {
    id: `ln-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    scriptId,
    index,
    mode: mode === "replace" ? "replace" : "insert",
    text: String(text ?? "").trim(),
    note: String(note ?? "").trim() || null,
    reason: String(reason ?? "").trim().slice(0, 200) || null,
    status: "proposed",
    created: Date.now(),
  };
  proposals = [...proposals, proposal];
  emit();
  return proposal;
}

export function take(id, gesture) {
  if (!trusted(gesture)) return null;
  const p = proposals.find((x) => x.id === id);
  if (!p) return null;
  proposals = proposals.filter((x) => x.id !== id);
  emit();
  return p;
}

export function drop(id, gesture) {
  if (!trusted(gesture)) return false;
  proposals = proposals.filter((x) => x.id !== id);
  emit();
  return true;
}

export function clearFor(scriptId) {
  proposals = proposals.filter((p) => p.scriptId !== scriptId);
  emit();
}
