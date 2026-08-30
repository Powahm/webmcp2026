import type { Span } from "../types";
import { locate, matchTerms } from "./locate";
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
