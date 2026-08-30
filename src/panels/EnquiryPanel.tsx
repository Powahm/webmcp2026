import { useMemo, useState } from "react";
import { getCorpus } from "../corpus/loadCorpus";
import { fileEnquiry, raiseEnquiry } from "../state/actions";
import { enquiryList, useEnquiryStore } from "../state/enquiryStore";
import { useReaderStore } from "../state/readerStore";
import type { Enquiry } from "../types";
import type { EvidenceTarget } from "./EvidenceDrawer";

/**
 * Lines of enquiry — MIRSAP's Actions.
 *
 * The analyst raises them in their own words; the agent lists and results them;
 * **only the analyst files one**, and there is no tool that does. This panel is
 * the clearest answer the product has to "is the AI just doing everything?" —
 * the agent is working a queue a person wrote.
 *
 * An enquiry resulted `eliminated` is displayed as a result, not a failure.
 * Clearing a line of enquiry is most of real investigative work.
 */
export default function EnquiryPanel({
  onShowEvidence,
}: {
  onShowEvidence: (t: EvidenceTarget) => void;
}) {
  const map = useEnquiryStore((s) => s.enquiries);
  const markings = useReaderStore((s) => s.markings);
  const [draft, setDraft] = useState("");

  const all = useMemo(() => enquiryList(map), [map]);
  const open = all.filter((e) => e.status !== "filed");
  const filed = all.filter((e) => e.status === "filed");

  const raise = (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const res = raiseEnquiry(draft, undefined, ev.nativeEvent as unknown as { isTrusted: boolean });
    if (res.ok) setDraft("");
  };

  return (
    <section className="panel enquiries">
      <header className="panel-head">
        <h2>Lines of enquiry</h2>
        <span className="count">{open.length} open</span>
      </header>

      <form className="raise-form" onSubmit={raise}>
        <input
          value={draft}
          placeholder="Ask a question in your own words…"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="primary sm" type="submit" disabled={!draft.trim()}>
          Raise
        </button>
      </form>

      {all.length === 0 && (
        <p className="empty">
          Nothing raised. You set the agenda — mark something in a filing and ask
          what you want to know. The agent works this queue.
        </p>
      )}

      <ul className="enquiry-list">
        {open.map((e) => (
          <Row key={e.id} e={e} markings={markings} onShowEvidence={onShowEvidence} />
        ))}
      </ul>

      {filed.length > 0 && (
        <details className="filed">
          <summary>{filed.length} filed</summary>
          <ul className="enquiry-list">
            {filed.map((e) => (
              <Row key={e.id} e={e} markings={markings} onShowEvidence={onShowEvidence} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

const STATUS_COPY: Record<Enquiry["status"], string> = {
  open: "open",
  claimed: "with the agent",
  resulted: "resulted",
  filed: "filed",
};

function Row({
  e,
  markings,
  onShowEvidence,
}: {
  e: Enquiry;
  markings: Map<string, { text: string; type: string }>;
  onShowEvidence: (t: EvidenceTarget) => void;
}) {
  const from = e.from_marking_id ? markings.get(e.from_marking_id) : undefined;
  const { documents } = getCorpus();

  return (
    <li className={`enquiry ${e.status} ${e.result?.outcome ?? ""}`}>
      <div className="enquiry-head">
        <span className={`status ${e.status}`}>{STATUS_COPY[e.status]}</span>
        <span className={`origin ${e.raised_by}`}>{e.raised_by === "human" ? "you" : "agent"}</span>
      </div>

      <p className="enquiry-q">{e.question}</p>

      {from && (
        <p className="enquiry-from">
          from your <b>{from.type}</b> mark — “{from.text.slice(0, 70)}”
        </p>
      )}

      {e.result && (
        <div className={`enquiry-result ${e.result.outcome}`}>
          <span className="outcome">{e.result.outcome}</span>
          <p>{e.result.summary}</p>

          {e.result.citations.length > 0 && (
            <div className="enquiry-cites">
              {e.result.citations.map((c, i) => (
                <button
                  key={`${c.doc_id}-${c.span.start}-${i}`}
                  className="citation sm"
                  onClick={() => onShowEvidence({ citation: c, claim: e.question })}
                >
                  {documents.get(c.doc_id)?.title ?? c.doc_id}
                </button>
              ))}
            </div>
          )}

          {e.result.outcome === "eliminated" && (
            <p className="eliminated-note">
              Nothing found. Clearing a line of enquiry is a result — it is
              recorded in the decision log either way.
            </p>
          )}
        </div>
      )}

      {e.status !== "filed" && (
        <div className="enquiry-actions">
          <button className="ghost sm" onClick={(ev) => fileEnquiry(e.id, ev)}>
            {e.status === "resulted" ? "File it" : "File without a result"}
          </button>
        </div>
      )}
    </li>
  );
}
