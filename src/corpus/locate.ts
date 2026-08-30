import type { Span } from "../types";

/**
 * Turning a MiniSearch hit into character offsets in the filing itself.
 *
 * Kept apart from search.ts, which reaches the loaded corpus, because these two
 * functions are pure and the offsets they produce are the thing every citation
 * in the product is made of — so they are checked directly, outside a browser,
 * by scripts/check-offsets.ts.
 */

export const MAX_SPANS_PER_DOC = 4;

/** Terms MiniSearch actually matched, lowercased, longest first so that
 *  "smith" doesn't win the highlight over "john smith". */
export function matchTerms(match: Record<string, string[]> | undefined): string[] {
  if (!match) return [];
  return Object.keys(match)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3)
    .sort((a, b) => b.length - a.length);
}

/**
 * Locate the matched terms in the document's exact text. The text here is the
 * text the evidence drawer renders — build-corpus.ts wrote both — so these
 * offsets are directly citable.
 */
export function locate(text: string, terms: string[]): (Span & { text: string })[] {
  const lower = text.toLowerCase();
  const spans: (Span & { text: string })[] = [];
  const taken: [number, number][] = [];

  for (const term of terms) {
    let from = 0;
    while (spans.length < MAX_SPANS_PER_DOC) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      from = at + term.length;

      // Whole words only — a match inside another word is noise in a citation.
      const before = at === 0 ? " " : text[at - 1];
      const after = at + term.length >= text.length ? " " : text[at + term.length];
      if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;

      // Widen to the whole line: a citation the analyst can read in context
      // beats four characters of a company number. Then pull the boundaries
      // back off the indentation — filings are laid out in columns, so a
      // line-wide span otherwise underlines a stretch of empty margin, and the
      // span's own text would no longer be what its offsets slice.
      let start = text.lastIndexOf("\n", at) + 1;
      const nl = text.indexOf("\n", at);
      let end = nl < 0 ? text.length : nl;
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      if (end <= start) continue;

      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      spans.push({ start, end, text: text.slice(start, end) });
    }
    if (spans.length >= MAX_SPANS_PER_DOC) break;
  }

  return spans.sort((a, b) => a.start - b.start);
}

