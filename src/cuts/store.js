/**
 * Staged cuts.
 *
 * A cut proposal is a range of the finished edit that someone thinks should
 * not be there, with a reason. It is the transcript's whole payoff: the agent
 * quotes the words it wants gone, findWords turns the quote into seconds, and
 * this turns seconds into a trim the editor can see marked on the timeline
 * before anything is removed.
 *
 * **Removing footage is the most destructive thing in this app**, so the same
 * rule holds harder here than anywhere: staging is a tool call, accepting is a
 * trusted click, and there is no tool that accepts. The agent can find every
 * "um" in a nine-minute take and offer to close all of them in one call, and
 * it cannot take out a single frame.
 *
 * `applyCut` is a pure function from a timeline to a new timeline, which is
 * what keeps this file free of any import from the Editor. The Editor owns its
 * array and calls this to get the next one; this never reaches into the
 * Editor to mutate it.
 */

let cuts = [];
let counter = 0;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

export const onCuts = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const allCuts = () => cuts.slice();
export const pendingCuts = () => cuts.filter((c) => c.status === "proposed");

const trusted = (gesture) =>
  gesture?.isTrusted === true || gesture?.nativeEvent?.isTrusted === true;

/* ----------------------------------------------------------------- staging */

/**
 * Stage a cut over a range of the finished edit.
 *
 * Ranges are in cut seconds, the same timebase get_timeline and
 * get_transcript report, so a quote resolved against the transcript can be
 * handed straight here.
 */
export function proposeCut({ start, end, reason, kind = "manual", text = "", origin = "agent" }, context = {}) {
  const { cutSeconds = null } = context;

  const from = Number(start);
  const to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return {
      ok: false,
      error: "A cut needs start and end, in seconds of the finished cut.",
      hint: "Call get_transcript and quote the words you want gone; it returns the exact seconds.",
    };
  }
  if (to <= from) {
    return { ok: false, error: `end (${to}) must be after start (${from}).` };
  }
  if (to - from < 0.05) {
    return {
      ok: false,
      error: `That range is ${((to - from) * 1000).toFixed(0)}ms, which is shorter than a frame and a half.`,
      hint: "Widen it, or cut the whole word rather than part of one.",
    };
  }
  if (cutSeconds != null && cutSeconds > 0 && from >= cutSeconds) {
    return {
      ok: false,
      error: `start is ${from.toFixed(2)}s but the cut is only ${cutSeconds.toFixed(2)}s long.`,
      hint: "Call get_timeline for the length of the edit.",
    };
  }

  // Two proposals over the same moment is one question asked twice. The
  // agent finding the same filler on a second pass should not double the list.
  const clash = pendingCuts().find((c) => from < c.end && to > c.start);
  if (clash) {
    return {
      ok: false,
      error: `A cut is already staged over ${clash.start.toFixed(2)}s–${clash.end.toFixed(2)}s.`,
      hint: "Call get_cuts to see what is already waiting on the editor.",
    };
  }

  const cut = {
    id: `cut-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    start: Math.max(0, from),
    end: cutSeconds != null && cutSeconds > 0 ? Math.min(to, cutSeconds) : to,
    kind,
    text: String(text ?? "").slice(0, 120),
    reason: String(reason ?? "").trim().slice(0, 200) || null,
    origin: origin === "human" ? "human" : "agent",
    status: "proposed",
    created: Date.now(),
  };
  cuts = [...cuts, cut];
  emit();
  return { ok: true, cut };
}

export function rejectCut(id, gesture) {
  if (!trusted(gesture)) {
    return { ok: false, error: "Only the person at the keyboard can reject a cut." };
  }
  cuts = cuts.filter((c) => c.id !== id);
  emit();
  return { ok: true };
}

/** Take a cut off the list once it has been applied. The Editor calls this
 *  after swapping in the new timeline, so a cut is never both applied and
 *  still pending. */
export function settle(id) {
  cuts = cuts.filter((c) => c.id !== id);
  emit();
}

/**
 * Slide the cuts that come after a removal back by what was removed.
 *
 * Every range here is an absolute position in the finished edit, so taking
 * two seconds out at 0:05 moves everything later two seconds earlier. Without
 * this, accepting the first of a batch leaves the rest pointing at the wrong
 * words — and `propose_tidy` exists to stage a whole batch at once, so that is
 * not an edge case, it is the normal path.
 *
 * Cuts that start before the removal are untouched. A cut that overlapped it
 * cannot exist, because `proposeCut` refuses to stage one.
 */
export function retime(removedAt, removedSeconds) {
  if (!(removedSeconds > 0)) return;
  cuts = cuts.map((c) =>
    c.start >= removedAt
      ? { ...c, start: Math.max(0, c.start - removedSeconds), end: Math.max(0, c.end - removedSeconds) }
      : c
  );
  emit();
}

export function clearCuts() {
  cuts = [];
  emit();
}

/* -------------------------------------------------------------- applying */

const segLength = (seg) => Math.max(0.05, (seg.out - seg.in) / (seg.speed || 1));

/**
 * Remove a range of the finished cut from a timeline.
 *
 * Pure: takes an array of segments and returns a new one. The interesting case
 * is a range that falls inside a single segment, which has to become two
 * segments of the same clip — a real split, which the timeline could not do
 * before this existed. A range covering a whole segment drops it, and a range
 * clipping an end just moves that end.
 *
 * Returns `{ timeline, removed }` so the caller can say how much went.
 */
export function applyCut(timeline, { start, end }) {
  const next = [];
  let at = 0;
  let removed = 0;

  for (const seg of timeline ?? []) {
    const speed = seg.speed || 1;
    const length = segLength(seg);
    const segStart = at;
    const segEnd = at + length;
    at = segEnd;

    // Untouched, either side of the cut.
    if (end <= segStart || start >= segEnd) {
      next.push(seg);
      continue;
    }

    // Cut time to this segment's own clip time.
    const toClip = (t) => seg.in + (t - segStart) * speed;
    const cutFrom = Math.max(segStart, start);
    const cutTo = Math.min(segEnd, end);
    removed += cutTo - cutFrom;

    const keepHead = cutFrom - segStart > 0.02;
    const keepTail = segEnd - cutTo > 0.02;

    if (!keepHead && !keepTail) continue; // the whole segment goes

    if (keepHead) {
      next.push({ ...seg, out: toClip(cutFrom) });
    }
    if (keepTail) {
      next.push({
        ...seg,
        // A split makes a second segment, so it needs its own identity or the
        // selection and the inspector would both address two rows at once.
        uid: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        in: toClip(cutTo),
      });
    }
  }

  return { timeline: next, removed };
}
