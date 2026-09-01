/**
 * Threadweaver — shared domain types.
 *
 * These are the contract between the corpus, the stores, the canvas and the
 * WebMCP tool layer. Nothing here knows about React or three.js.
 */

export type EntityType = "company" | "person" | "address" | "document";

export type Relation =
  | "director_of"
  | "psc_of"
  | "registered_at"
  | "previously_named"
  | "shares_address_with"
  | "filed";

/** A character range inside a Document's `text`. Offsets are stable: the text
 *  indexed offline is byte-for-byte the text the evidence drawer renders. */
export interface Span {
  start: number;
  end: number;
}

export interface Citation {
  doc_id: string;
  span: Span;
  /** Present on derived relations (shares_address_with), which cite two filings. */
  corroborating?: { doc_id: string; span: Span }[];
}

/** An entity as it exists in the corpus (~300 companies and everything attached). */
export interface Entity {
  id: string; // "company:09876543" | "person:<slug>-<yyyy-mm>" | "address:<hash>"
  type: EntityType;
  label: string;
  /** Type-specific public-record fields. Never rendered raw; the Inspector picks. */
  attrs?: Record<string, string | number | undefined>;
  /** Document ids this entity was derived from. */
  sources?: string[];
}

/** A relationship in the corpus or on the canvas. */
export interface Edge {
  id: string;
  from_id: string;
  to_id: string;
  relation: Relation;
  /** True for shares_address_with, which we computed rather than read. */
  derived?: boolean;
  citations: Citation[];
}

/** A filing, rendered once offline as readable plain text with stable offsets. */
export interface CorpusDocument {
  id: string;
  title: string;
  /** Company number / entity the filing belongs to. */
  entity_id?: string;
  date?: string;
  /** The exact string the evidence drawer renders and search indexes. */
  text: string;
  /** Entity ids mentioned anywhere in `text`. Used by search_documents filtering. */
  mentions: string[];
}

export type ProposalKind = "node" | "edge";
export type ProposalStatus = "pending" | "accepted" | "rejected";

interface ProposalBase {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  /** Every proposal carries a source. actions.ts rejects any that does not. */
  citation: Citation;
  /** One sentence, shown on the proposal card. */
  reason: string;
  created_at: number;
  /** "agent" for WebMCP tool calls, "human" for panel-initiated staging. */
  origin: "agent" | "human";
}

export interface NodeProposal extends ProposalBase {
  kind: "node";
  entityType: Exclude<EntityType, never>;
  label: string;
  /** Corpus id, if this entity already exists in the corpus. */
  entity_id?: string;
  /** The id the node will carry on the canvas. */
  node_id: string;
}

export interface EdgeProposal extends ProposalBase {
  kind: "edge";
  from_id: string;
  to_id: string;
  relation: Relation;
}

export type Proposal = NodeProposal | EdgeProposal;

// --- The reader ------------------------------------------------------------

/**
 * What a mark can be. Six types, because a person will not use more without a
 * legend, and a legend in an investigation tool is a design failure.
 */
export type MarkingType = "person" | "company" | "address" | "date" | "question" | "lead";

export const MARKING_TYPES: MarkingType[] = [
  "person",
  "company",
  "address",
  "date",
  "question",
  "lead",
];

/**
 * A passage someone deliberately marked in a filing.
 *
 * The richest state in the application, and the one no server has: offsets into
 * a string that is rendered from memory and never travelled over the wire. The
 * analyst's marks and the agent's `highlight_span` marks are the same object,
 * differing only in `origin` — there is no agent-flavoured write path.
 */
export interface Marking {
  id: string;
  doc_id: string;
  span: Span;
  /** The substring itself. Denormalised so tool results are readable without a
   *  second lookup, and so a mark survives being read out of context. */
  text: string;
  type: MarkingType;
  note?: string;
  origin: "human" | "agent";
  created_at: number;
}

// --- Lines of enquiry ------------------------------------------------------

/**
 * MIRSAP calls these Actions. The human raises them; the agent works them; only
 * the human files one. See docs/METHOD.md.
 */
export type EnquiryStatus = "open" | "claimed" | "resulted" | "filed";

/** `eliminated` is a result, not a failure — clearing a line of enquiry is the
 *  majority of real investigative work. See docs/METHOD.md §3. */
export type EnquiryOutcome = "found" | "eliminated" | "partial";

export interface EnquiryResult {
  outcome: EnquiryOutcome;
  summary: string;
  citations: Citation[];
  at: number;
}

export interface Enquiry {
  id: string;
  /** The analyst's own words. Never rewritten by the agent. */
  question: string;
  status: EnquiryStatus;
  raised_by: "human" | "agent";
  /** The mark this came off, if it was raised from the reader. */
  from_marking_id?: string;
  result?: EnquiryResult;
  created_at: number;
  /** When the agent took it. Used to count the calls made since, which is the
   *  only honest progress signal the page has while it waits. */
  claimed_at?: number;
}

// --- Decision log ----------------------------------------------------------

/** The SIO's policy log, and the audit trail an e-discovery process would ask
 *  for. Append-only; both actors write to it; the analyst can export it. */
export interface DecisionEntry {
  id: string;
  at: number;
  actor: "human" | "agent";
  /** Short verb phrase: "accepted", "marked", "raised", "resulted". */
  action: string;
  /** One line of plain English. Structural, never a conclusion about a person. */
  detail: string;
  /** Whatever it concerned — a node, an edge, a marking, an enquiry. */
  target_id?: string;
}

/** A note left on a node or edge. */
export interface Annotation {
  id: string;
  target_id: string;
  note: string;
  origin: "agent" | "human";
  created_at: number;
}

/** One entry in the ToolLog panel. */
export interface ToolCallLogEntry {
  id: string;
  tool: string;
  args: unknown;
  /** Short, human-readable outcome. Not the full payload. */
  summary: string;
  ok: boolean;
  durationMs: number;
  at: number;
  readOnly: boolean;
}

/** Uniform result shape returned to the agent by every tool. */
export interface ToolFailure {
  ok: false;
  error: string;
  /** What the agent should do differently. Always actionable. */
  hint?: string;
}
