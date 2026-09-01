import { useEffect, useMemo, useRef } from "react";
import { getCorpus } from "../corpus/loadCorpus";
import type { Citation } from "../types";

/**
 * The evidence drawer. This is what makes a claim checkable, and it is the
 * whole impact argument: the analyst clicks a citation, the filing opens, and
 * the exact span that supports the claim is highlighted.
 *
 * The text rendered here is byte-for-byte the text scripts/build-corpus.ts
 * indexed and recorded offsets against. It is never reformatted at display
 * time, if it were, every span in the corpus would point at the wrong words.
 */

export interface EvidenceTarget {
  citation: Citation;
  /** What the citation is being offered as evidence for. */
  claim: string;
}

export default function EvidenceDrawer({
  target,
  onClose,
}: {
  target: EvidenceTarget | null;
  onClose: () => void;
}) {
  const markRef = useRef<HTMLElement>(null);

  const view = useMemo(() => {
    if (!target) return null;
    const { documents } = getCorpus();
    const primary = documents.get(target.citation.doc_id);
    if (!primary) return null;
    const corroborating = (target.citation.corroborating ?? [])
      .map((c) => ({ doc: documents.get(c.doc_id), span: c.span }))
      .filter((x): x is { doc: NonNullable<typeof primary>; span: typeof x.span } => Boolean(x.doc));
    return { primary, span: target.citation.span, corroborating };
  }, [target]);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [view]);

  if (!target) {
    return (
      <section className="panel evidence">
        <header className="panel-head">
          <h2>Evidence</h2>
        </header>
        <p className="empty">
          Click a citation on a node, an edge or a proposal to open the filing it
          rests on.
        </p>
      </section>
    );
  }

  if (!view) {
    return (
      <section className="panel evidence">
        <header className="panel-head">
          <h2>Evidence</h2>
          <button className="ghost" onClick={onClose}>
            close
          </button>
        </header>
        <p className="empty">
          Document <code>{target.citation.doc_id}</code> is not in the corpus.
        </p>
      </section>
    );
  }

  const { primary, span, corroborating } = view;

  return (
    <section className="panel evidence">
      <header className="panel-head">
        <h2>Evidence</h2>
        <button className="ghost" onClick={onClose}>
          close
        </button>
      </header>

      <p className="claim">{target.claim}</p>

      {corroborating.length > 0 && (
        <p className="derived-note">
          This is a derived relationship. It rests on {corroborating.length + 1} filings,
          not one, both are shown below.
        </p>
      )}

      <article className="filing">
        <h3>{primary.title}</h3>
        <p className="doc-id">
          <code>{primary.id}</code> · characters {span.start}-{span.end}
        </p>
        <pre className="filing-text">
          {primary.text.slice(0, span.start)}
          <mark ref={markRef}>{primary.text.slice(span.start, span.end)}</mark>
          {primary.text.slice(span.end)}
        </pre>
      </article>

      {corroborating.map(({ doc, span: s }) => (
        <article className="filing" key={doc.id + s.start}>
          <h3>{doc.title}</h3>
          <p className="doc-id">
            <code>{doc.id}</code> · characters {s.start}-{s.end}
          </p>
          <pre className="filing-text">
            {doc.text.slice(0, s.start)}
            <mark>{doc.text.slice(s.start, s.end)}</mark>
            {doc.text.slice(s.end)}
          </pre>
        </article>
      ))}

      <p className="provenance">
        Source: UK Companies House public records, rendered verbatim from the
        ingested filing.
      </p>
    </section>
  );
}
