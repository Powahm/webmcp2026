import { useEffect, useMemo, useRef, useState } from "react";
import {
  CASE_HOPS,
  CASE_QUESTION,
  hopsFound,
  nextStep,
} from "./caseDefinition";
import { enquiryList, useEnquiryStore } from "../state/enquiryStore";
import { useGraphStore } from "../state/graphStore";
import { pendingProposals, useProposalStore } from "../state/proposalStore";

/**
 * The objective, the progress towards it, and the next sentence to say.
 *
 * A judge arrives holding an agent and looking at twelve British companies
 * they have never heard of. The tour explains the method, but a tour is read
 * once and dismissed; this is the line that stays on screen and answers "what
 * am I supposed to do" at every point in the session.
 *
 * It renders text a human copies and nothing else. It registers no tool and
 * calls none: a page that drove the agent itself would invert the product,
 * which is that the human sets the agenda and the agent answers.
 *
 * Progress is derived from the canvas every render, never stored. Reload
 * clears the canvas, so progress clears with it, correctly and for free.
 */
export default function CaseBar() {
  const edges = useGraphStore((s) => s.edges);
  const selection = useGraphStore((s) => s.selection);
  const proposalMap = useProposalStore((s) => s.proposals);
  const enquiryMap = useEnquiryStore((s) => s.enquiries);

  const found = useMemo(() => hopsFound([...edges.values()]), [edges]);
  const foundCount = found.filter(Boolean).length;

  const pendingCount = useMemo(() => pendingProposals(proposalMap).length, [proposalMap]);
  const enquiries = useMemo(() => enquiryList(enquiryMap), [enquiryMap]);

  const step = useMemo(
    () =>
      nextStep({
        found: foundCount,
        selectionCount: selection.length,
        pendingProposalCount: pendingCount,
        hasClaimedEnquiry: enquiries.some((e) => e.status === "claimed"),
        hasOpenEnquiry: enquiries.some((e) => e.status === "open"),
        hasResultedEnquiry: enquiries.some((e) => e.status === "resulted"),
      }),
    [foundCount, selection.length, pendingCount, enquiries]
  );

  const complete = foundCount === CASE_HOPS.length;

  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = async () => {
    if (!step.prompt) return;
    try {
      await navigator.clipboard.writeText(step.prompt);
    } catch {
      // Clipboard access can be refused. Select the text instead so the
      // analyst can copy it by hand, rather than failing silently.
      const el = document.querySelector(".casebar-prompt");
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      }
      return;
    }
    setCopied(true);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section
      className={`casebar${complete ? " is-complete" : ""}`}
      aria-label="Case"
      data-tour="casebar"
    >
      <div className="casebar-case">
        <span className="casebar-eyebrow">Case</span>
        <p className="casebar-question">
          {complete ? "Chain complete. Four links, four filings." : CASE_QUESTION}
        </p>
      </div>

      <div className="casebar-progress" role="group" aria-label="Chain progress">
        {/* Hidden from a screen reader because the count beside them says the
            same thing in words, and four unlabelled list items do not. */}
        <ol className="casebar-dots" aria-hidden="true">
          {found.map((on, i) => (
            <li key={CASE_HOPS[i].from_id + CASE_HOPS[i].to_id} className={on ? "on" : ""} />
          ))}
        </ol>
        {/* role="status" sits on the count alone. On the whole bar it would
            re-announce the question and the prompt every time a dot lit. */}
        <span className="casebar-count" role="status">
          {foundCount} of {CASE_HOPS.length} links found
        </span>
      </div>

      <div className="casebar-next">
        <span className="casebar-instruction">{step.instruction}</span>
        {step.prompt && (
          <>
            {/* A <code> because it is literal text to be reproduced exactly,
                not a phrase to be paraphrased. */}
            <code className="casebar-prompt">{step.prompt}</code>
            <button className="casebar-copy" type="button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
