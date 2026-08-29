import { getCorpus } from "../corpus/loadCorpus";
import { acceptProposal, rejectProposal } from "../state/actions";
import { useGraphStore } from "../state/graphStore";
import { pendingProposals, useProposalStore } from "../state/proposalStore";
import type { Proposal } from "../types";
import type { EvidenceTarget } from "./EvidenceDrawer";
import { RELATION_LABEL, TYPE_LABEL } from "./labels";

/**
 * Accept / reject.
 *
 * These two buttons are the only way anything an agent says becomes part of the
 * graph. The agent has no tool that reaches them, and acceptProposal requires
 * the trusted DOM event these onClick handlers pass it — an event only the
 * browser can produce. This component is not merely the convenient path to
 * promotion; it is the only one.
 */
export default function ProposalTray({
  onShowEvidence,
}: {
  onShowEvidence: (t: EvidenceTarget) => void;
}) {
  const proposalMap = useProposalStore((s) => s.proposals);
  const nodes = useGraphStore((s) => s.nodes);
  const pending = pendingProposals(proposalMap);

  const labelOf = (id: string): string => {
    const onCanvas = nodes.get(id);
    if (onCanvas) return onCanvas.label;
    for (const p of proposalMap.values()) {
      if (p.kind === "node" && p.node_id === id) return p.label;
    }
    return getCorpus().entities.get(id)?.label ?? id;
  };

  const claimOf = (p: Proposal): string =>
    p.kind === "node"
      ? `${TYPE_LABEL[p.entityType]} — ${p.label}`
      : `${labelOf(p.from_id)} — ${RELATION_LABEL[p.relation]} — ${labelOf(p.to_id)}`;

  return (
    <section className="panel tray">
      <header className="panel-head">
        <h2>Proposals</h2>
        <span className="count">{pending.length} awaiting you</span>
      </header>

      {pending.length === 0 && (
        <p className="empty">
          Nothing staged. The agent can propose nodes and threads, each carrying a
          citation — but only you can accept one.
        </p>
      )}

      <ul className="proposal-list">
        {pending.map((p) => (
          <li key={p.id} className="proposal">
            <div className="proposal-head">
              <span className="badge">{p.kind === "node" ? "node" : "thread"}</span>
              <span className={`origin ${p.origin}`}>{p.origin}</span>
            </div>

            <p className="proposal-claim">{claimOf(p)}</p>
            <p className="proposal-reason">{p.reason}</p>

            <div className="proposal-actions">
              <button
                className="citation"
                onClick={() => onShowEvidence({ citation: p.citation, claim: claimOf(p) })}
              >
                read the filing
              </button>
              <button className="primary" onClick={(ev) => acceptProposal(p.id, ev)}>
                Accept
              </button>
              <button className="reject" onClick={(ev) => rejectProposal(p.id, ev)}>
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pending.length > 0 && (
        <p className="hint">
          Read the filing before you accept. Accepting locks the claim into the
          graph and the next question will traverse it.
        </p>
      )}
    </section>
  );
}
