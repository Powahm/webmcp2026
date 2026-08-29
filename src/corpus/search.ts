import type { Span } from "../types";
import { getCorpus } from "./loadCorpus";

/**
 * Search returns document ids and the character offsets of each match. It never
 * returns prose.
 *
 * That is a deliberate constraint, not a limitation: if this returned summaries
 * the agent would be reading our paraphrase instead of the record, and the
 * citation it then attached to a proposal would be worthless. The agent gets
 * pointers; the analyst reads the filing.
 */

export interface SearchHit {
  doc_id: string;
  title: string;
  score: number;
  spans: (Span & { text: string })[];
}

const MAX_SPANS_PER_DOC = 4;

/** Terms MiniSearch actually matched, lowercased, longest first so that
 *  "smith" doesn't win the highlight over "john smith". */
function matchTerms(match: Record<string, string[]> | undefined): string[] {
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
function locate(text: string, terms: string[]): (Span & { text: string })[] {
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
      // beats four characters of a company number.
      const start = text.lastIndexOf("\n", at) + 1;
      const nl = text.indexOf("\n", at);
      const end = nl < 0 ? text.length : nl;

      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      spans.push({ start, end, text: text.slice(start, end).trim() });
    }
    if (spans.length >= MAX_SPANS_PER_DOC) break;
  }

  return spans.sort((a, b) => a.start - b.start);
}

export function searchDocuments(
  query: string,
  opts: { entityIds?: string[]; limit?: number } = {}
): SearchHit[] {
  const { entities, documents, index } = getCorpus();
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
  const restrict = opts.entityIds?.length ? new Set(opts.entityIds) : null;

  // Entity ids are not words, so a caller passing "company:09876543" as the
  // query would otherwise get nothing. Search the entity's label instead.
  const expanded = query
    .split(/\s+/)
    .map((tok) => {
      const e = entities.get(tok);
      return e ? `${e.label} ${tok.split(":")[1] ?? ""}` : tok;
    })
    .join(" ");

  const raw = index.search(expanded, { combineWith: "OR" });
  const hits: SearchHit[] = [];

  for (const r of raw) {
    if (hits.length >= limit) break;
    const doc = documents.get(String(r.id));
    if (!doc) continue;
    if (restrict && !doc.mentions.some((m) => restrict.has(m))) continue;

    const spans = locate(doc.text, matchTerms(r.match as Record<string, string[]>));
    // A hit we cannot point at is not a citable hit.
    if (!spans.length) continue;

    hits.push({
      doc_id: doc.id,
      title: doc.title,
      score: Math.round(r.score * 100) / 100,
      spans,
    });
  }

  return hits;
}
