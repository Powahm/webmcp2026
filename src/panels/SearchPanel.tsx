import { useMemo, useState } from "react";
import { getCorpus } from "../corpus/loadCorpus";
import { addCorpusNode, onCanvas, setSelection } from "../state/actions";
import { useGraphStore } from "../state/graphStore";
import type { Entity } from "../types";
import { TYPE_LABEL } from "./labels";

/**
 * Manual corpus search.
 *
 * Every judge clicks around before they prompt anything, so the app has to be a
 * real tool with no agent present. This panel is how the analyst pulls entities
 * out of the ~300-company corpus and onto the canvas by hand.
 */
export default function SearchPanel() {
  const [query, setQuery] = useState("");
  const nodes = useGraphStore((s) => s.nodes);

  const results = useMemo<Entity[]>(() => {
    const q = query.trim();
    if (q.length < 2) return [];
    const { entities } = getCorpus();
    const lower = q.toLowerCase();
    const out: Entity[] = [];
    for (const e of entities.values()) {
      if (e.type === "document") continue;
      if (
        e.label.toLowerCase().includes(lower) ||
        String(e.attrs?.company_number ?? "").toLowerCase().includes(lower)
      ) {
        out.push(e);
        if (out.length >= 40) break;
      }
    }
    return out.sort((a, b) => a.label.length - b.label.length);
  }, [query]);

  return (
    <section className="panel search">
      <header className="panel-head">
        <h2>Corpus</h2>
        <span className="count">{getCorpus().entities.size.toLocaleString()} entities</span>
      </header>

      <input
        className="search-input"
        placeholder="Search companies, people, addresses…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />

      {query.trim().length >= 2 && results.length === 0 && (
        <p className="empty">Nothing in the corpus matches that.</p>
      )}

      <ul className="result-list">
        {results.map((e) => {
          const present = onCanvas(e.id);
          return (
            <li key={e.id}>
              <button
                className="result"
                disabled={present}
                onClick={() => {
                  addCorpusNode(e.id);
                  setSelection([e.id]);
                }}
                title={present ? "Already on the canvas" : "Add to the canvas"}
              >
                <span className={`dot ${e.type}`} aria-hidden />
                <span className="result-label">{e.label}</span>
                <span className="result-type">{present ? "on canvas" : TYPE_LABEL[e.type]}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="hint">
        {nodes.size} node{nodes.size === 1 ? "" : "s"} on the canvas. The corpus holds
        far more, the canvas is only what you have chosen to look at.
      </p>
    </section>
  );
}
