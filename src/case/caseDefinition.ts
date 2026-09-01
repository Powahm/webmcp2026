import type { CanvasEdge } from "../state/actions";
import type { Relation } from "../types";

/**
 * The one case the demo is about, as data.
 *
 * Hard-coded rather than derived. A "longest interesting path" search over the
 * corpus would find a different chain on a different day, and the whole point
 * of this bar is that a judge arrives to a fixed, verified objective that the
 * rest of the submission can talk about by name. The chain is the one in
 * docs/VERIFIED-CHAIN.md, checked against public/corpus/edges.json.
 */

export interface Hop {
  from_id: string;
  to_id: string;
  relation: Relation;
}

/** Both endpoints are on the canvas at boot; the three middle nodes are not.
 *  public/corpus/seed.json is the authority on that, not the prose. */
export const CASE_START_ID = "company:11624512";
export const CASE_END_ID = "company:15481912";
export const CASE_START_LABEL = "ENVIROPASS CONSULTING LTD";
export const CASE_END_LABEL = "RENEWABLE DIESEL FUELS LTD";

export const CASE_HOPS: Hop[] = [
  { from_id: "company:11624512", to_id: "person:matthew-colley-banks-1984-02", relation: "psc_of" },
  { from_id: "person:matthew-colley-banks-1984-02", to_id: "company:15164603", relation: "psc_of" },
  { from_id: "company:15164603", to_id: "person:peter-valaitis-1950-11", relation: "psc_of" },
  { from_id: "person:peter-valaitis-1950-11", to_id: "company:15481912", relation: "psc_of" },
];

export const CASE_QUESTION = `Are ${CASE_START_LABEL} and ${CASE_END_LABEL} connected?`;

/**
 * Which hops are on the canvas. Index matches CASE_HOPS.
 *
 * Confirmed edges only, which is why this takes the graph store's edges and
 * never looks at proposals: the product's claim is that only the analyst
 * promotes a proposal, so progress that moved on the agent's say-so would
 * quietly contradict it.
 *
 * Direction-insensitive on purpose. stageEdge does not force an orientation,
 * and an edge drawn person to company asserts the same structural fact as one
 * drawn company to person.
 */
export function hopsFound(edges: CanvasEdge[]): boolean[] {
  return CASE_HOPS.map((hop) =>
    edges.some(
      (e) =>
        e.relation === hop.relation &&
        ((e.from_id === hop.from_id && e.to_id === hop.to_id) ||
          (e.from_id === hop.to_id && e.to_id === hop.from_id))
    )
  );
}

export interface CaseStep {
  /** Plain-language line telling the analyst what to do now. Always present. */
  instruction: string;
  /** The sentence to paste into the agent. Absent when the next move is theirs. */
  prompt?: string;
}

/**
 * The single suggested prompt, chosen by the first matching rule.
 *
 * Pure, and importing nothing from the stores, so the ladder can be reasoned
 * about and tested without a browser or a mounted component.
 *
 * Two of the seven rules deliberately return no prompt. When a proposal is
 * waiting or the agent has claimed a question, the next move belongs to the
 * human, and a bar that offered something to type there would be telling them
 * to hand work back to an agent that already has it.
 */
export function nextStep(input: {
  found: number;
  selectionCount: number;
  pendingProposalCount: number;
  hasClaimedEnquiry: boolean;
  hasOpenEnquiry: boolean;
}): CaseStep {
  if (input.found === CASE_HOPS.length) {
    return {
      instruction: "The chain is complete. Ask for the write-up:",
      prompt: "Summarise the chain I just built, listing each link and its citation.",
    };
  }
  if (input.hasClaimedEnquiry) {
    return {
      instruction:
        "The agent is working your question. When it reports back, verify the citation before you accept.",
    };
  }
  if (input.hasOpenEnquiry) {
    return {
      instruction: "You have an open question. Hand it over:",
      prompt: "Look at my open line of enquiry and work it.",
    };
  }
  if (input.pendingProposalCount > 0) {
    return {
      instruction:
        "The agent has proposed something. Click its citation to check the source, then accept or reject.",
    };
  }
  if (input.found > 0) {
    return {
      instruction: "Keep going:",
      prompt: `Now find what connects the node I just accepted to ${CASE_END_LABEL}.`,
    };
  }
  if (input.selectionCount === 2) {
    return {
      instruction: "Two selected. Ask:",
      prompt: "Find the link between the two companies I have selected.",
    };
  }
  return {
    instruction: "Select both companies on the canvas, then ask:",
    prompt: `Find the link between ${CASE_START_LABEL} and ${CASE_END_LABEL}.`,
  };
}
