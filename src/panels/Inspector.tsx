import { useMemo, useState } from "react";
import { getCorpus } from "../corpus/loadCorpus";
import { neighbours } from "../corpus/paths";
import {
  addCorpusNode,
  canvasEdges,
  drawEdge,
  onCanvas,
  removeNode,
  setSelection,
} from "../state/actions";
import { useGraphStore } from "../state/graphStore";
import type { Relation } from "../types";
import type { EvidenceTarget } from "./EvidenceDrawer";
import { RELATION_LABEL, RELATION_SHORT, TYPE_LABEL, VISIBLE_ATTRS } from "./labels";

const DRAWABLE: Relation[] = [
  "director_of",
  "psc_of",
  "registered_at",
  "shares_address_with",
  "previously_named",
];

/**
 * The selected entity, its records and its edges — and, when two nodes are
 * selected, the manual "connect these" control.
 *
 * Everything here is flat 2D. Nothing the analyst has to read carefully is ever
 * rendered in perspective.
 */
export default function Inspector({
  onShowEvidence,
}: {
  onShowEvidence: (t: EvidenceTarget) => void;
}) {
  const nodes = useGraphStore((s) => s.nodes);
  const edgeMap = useGraphStore((s) => s.edges);
  const annotations = useGraphStore((s) => s.annotations);
  const selection = useGraphStore((s) => s.selection);
  const [relation, setRelation] = useState<Relation>("shares_address_with");

  const selected = selection.map((id) => nodes.get(id)).filter((n) => n !== undefined);

  const attached = useMemo(() => {
    if (selected.length !== 1) return [];
    return neighbours(canvasEdges(), selected[0]!.id);
  }, [selected, edgeMap]);

  /** What the corpus knows about this entity that is not yet on the canvas.
   *  Expanding is a human action: the analyst decides what to look at next. */
  const expandable = useMemo(() => {
    if (selected.length !== 1) return [];
    const { edges: corpusEdges, entities } = getCorpus();
    const out: { id: string; label: string; type: string; relation: Relation }[] = [];
    for (const { edge, other } of neighbours(corpusEdges, selected[0]!.id)) {
      if (onCanvas(other)) continue;
      const e = entities.get(other);
      if (!e || e.type === "document") continue;
      if (out.some((x) => x.id === other)) continue;
      out.push({ id: other, label: e.label, type: e.type, relation: edge.relation });
      if (out.length >= 24) break;
    }
    return out;
  }, [selected, nodes]);

  if (selection.length === 0) {
    return (
      <section className="panel inspector">
        <header className="panel-head">
          <h2>Inspector</h2>
        </header>
        <p className="empty">
          Click a node to inspect it. Click a second to select both, then connect
          them or ask the agent what links them.
        </p>
      </section>
    );
  }

  if (selected.length > 1) {
    return (
      <section className="panel inspector">
        <header className="panel-head">
          <h2>Inspector</h2>
          <span className="count">{selected.length} selected</span>
        </header>
        <ul className="selected-list">
          {selected.map((n) => (
            <li key={n!.id}>
              <span className={`dot ${n!.type}`} aria-hidden />
              {n!.label}
            </li>
          ))}
        </ul>

        {selected.length === 2 && (
          <div className="connect">
            <label htmlFor="rel">Connect as</label>
            <select
              id="rel"
              value={relation}
              onChange={(e) => setRelation(e.target.value as Relation)}
            >
              {DRAWABLE.map((r) => (
                <option key={r} value={r}>
                  {RELATION_LABEL[r]}
                </option>
              ))}
            </select>
            <button
              className="primary"
              onClick={() => drawEdge(selected[0]!.id, selected[1]!.id, relation)}
            >
              Draw thread
            </button>
            <p className="hint">
              If a filing already evidences this, the citation comes with it. If
              not, the thread is marked as your assertion, not the record's.
            </p>
          </div>
        )}
      </section>
    );
  }

  const node = selected[0]!;
  const attrs = VISIBLE_ATTRS.filter((a) => node.attrs?.[a.key] !== undefined);
  const notes = annotations.filter((a) => a.target_id === node.id);

  return (
    <section className="panel inspector">
      <header className="panel-head">
        <h2>{TYPE_LABEL[node.type]}</h2>
        <button className="ghost" onClick={() => removeNode(node.id)}>
          remove
        </button>
      </header>

      <h3 className="entity-name">
        <span className={`dot ${node.type}`} aria-hidden />
        {node.label}
      </h3>

      {attrs.length > 0 && (
        <dl className="attrs">
          {attrs.map((a) => (
            <div key={a.key}>
              <dt>{a.label}</dt>
              <dd>{String(node.attrs![a.key])}</dd>
            </div>
          ))}
        </dl>
      )}

      {node.citations.length > 0 && (
        <>
          <h4>Citations</h4>
          <ul className="citation-list">
            {node.citations.map((c, i) => (
              <li key={i}>
                <button
                  className="citation"
                  onClick={() => onShowEvidence({ citation: c, claim: node.label })}
                >
                  {c.doc_id}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>On the canvas ({attached.length})</h4>
      {attached.length === 0 && <p className="empty">Nothing connected here yet.</p>}
      <ul className="edge-list">
        {attached.map(({ edge, other }) => {
          const otherNode = nodes.get(other);
          const forward = edge.from_id === node.id;
          return (
            <li key={edge.id}>
              <button className="edge-jump" onClick={() => setSelection([other])}>
                <span className="rel">
                  {forward ? "" : "← "}
                  {RELATION_SHORT[edge.relation]}
                  {forward ? " →" : ""}
                </span>
                <span className="other">{otherNode?.label ?? other}</span>
              </button>
              {edge.analystAsserted ? (
                <span className="asserted" title="No filing cites this — you drew it">
                  your assertion
                </span>
              ) : (
                edge.citations[0] && (
                  <button
                    className="citation small"
                    onClick={() =>
                      onShowEvidence({
                        citation: edge.citations[0],
                        claim: `${node.label} — ${RELATION_LABEL[edge.relation]} — ${
                          otherNode?.label ?? other
                        }`,
                      })
                    }
                  >
                    {edge.derived ? "2 filings" : "filing"}
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>

      {expandable.length > 0 && (
        <>
          <h4>In the corpus, not yet on the canvas ({expandable.length})</h4>
          <ul className="expand-list">
            {expandable.map((x) => (
              <li key={x.id}>
                <button
                  className="result"
                  onClick={() => {
                    addCorpusNode(x.id);
                    setSelection([x.id]);
                  }}
                >
                  <span className={`dot ${x.type}`} aria-hidden />
                  <span className="result-label">{x.label}</span>
                  <span className="result-type">{RELATION_SHORT[x.relation]}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {notes.length > 0 && (
        <>
          <h4>Notes</h4>
          <ul className="note-list">
            {notes.map((n) => (
              <li key={n.id}>
                <span className={`origin ${n.origin}`}>{n.origin}</span>
                {n.note}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
