import type { Marking, Span } from "../types";

/**
 * Turning a set of overlapping marks into a flat sequence of segments.
 *
 * Overlaps are not an edge case here, they are the normal case: the analyst
 * marks a name, and the agent's `highlight_span` underlines a phrase containing
 * it. Nesting elements to represent that gets tangled fast and makes the offset
 * arithmetic in selection.ts harder to trust, so instead we cut the document at
 * every mark boundary and render one flat run per segment, each knowing which
 * marks cover it.
 */

export interface Segment extends Span {
  text: string;
  /** Every mark covering this run, in the order they were made. */
  marks: Marking[];
}

export function segment(text: string, markings: Marking[]): Segment[] {
  const relevant = markings.filter(
    (m) => m.span.start < text.length && m.span.end > m.span.start
  );
  // An empty document has no runs at all rather than one empty one: every
  // segment becomes a rendered anchor, and an anchor with no text is a place
  // the analyst can put a caret but never a selection.
  if (!text.length) return [];
  if (!relevant.length) {
    return [{ start: 0, end: text.length, text, marks: [] }];
  }

  const cuts = new Set<number>([0, text.length]);
  for (const m of relevant) {
    cuts.add(Math.max(0, m.span.start));
    cuts.add(Math.min(text.length, m.span.end));
  }

  const points = [...cuts].sort((a, b) => a - b);
  const out: Segment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    if (end <= start) continue;
    out.push({
      start,
      end,
      text: text.slice(start, end),
      marks: relevant.filter((m) => m.span.start <= start && m.span.end >= end),
    });
  }

  return out;
}

/**
 * Which mark decides the segment's colour when several overlap.
 *
 * The analyst's own mark always wins. Their reading is the point of the
 * product, and an agent highlight must never repaint what a person decided.
 * The agent's contribution shows as the underline instead.
 */
export function dominant(marks: Marking[]): Marking | null {
  if (!marks.length) return null;
  return marks.find((m) => m.origin === "human") ?? marks[0];
}

export const hasAgentMark = (marks: Marking[]): boolean =>
  marks.some((m) => m.origin === "agent");
