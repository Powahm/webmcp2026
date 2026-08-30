/**
 * ★ THE ONLY MUTATION API ★
 *
 * Every change to the graph goes through this file — the analyst clicking a
 * panel and the agent calling a WebMCP tool take exactly the same path. A tool
 * never touches a store directly, and never contains logic the UI doesn't also
 * use.
 *
 * This is not tidiness. It is what makes the product's claim true: the human
 * and the agent are equal actors on one model, not a UI with a bot bolted on.
 * It is also precisely what the site-tools guidance asks for — reuse your
 * existing application logic and permissions.
 *
 * Two asymmetries are deliberate and they are the whole safety argument:
 *
 *   1. Write tools can only ever reach `stageNode` / `stageEdge`, which write
 *      to proposalStore. Nothing an agent can call touches the confirmed graph.
 *   2. `acceptProposal` and `rejectProposal` are exported, but no tool imports
 *      them and none is registered. They additionally refuse to run outside a
 *      real user gesture, so even a bug that wired one up would fail closed.
 */

import { addUploadedDocument, getCorpus } from "../corpus/loadCorpus";
import { neighbours } from "../corpus/paths";
import type {
  Annotation,
  Citation,
  DecisionEntry,
  Edge,
  EnquiryOutcome,
  EntityType,
  Marking,
  MarkingType,
  Proposal,
  Relation,
  Span,
} from "../types";
import { MARKING_TYPES } from "../types";
import { decisionLog, useDecisionLog } from "./decisionLog";
import { enquiries, useEnquiryStore } from "./enquiryStore";
import { graph, useGraphStore, type CanvasEdge, type CanvasNode } from "./graphStore";
import { proposals, useProposalStore } from "./proposalStore";
import { reader, useReaderStore } from "./readerStore";

// --- Result type ------------------------------------------------------------

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { id?: string } : { id?: string; data: T }))
  | { ok: false; error: string; hint?: string };

const fail = (error: string, hint?: string): ActionResult<never> =>
  ({ ok: false, error, hint }) as ActionResult<never>;

let counter = 0;
const uid = (prefix: string) => `${prefix}:${Date.now().toString(36)}-${(counter++).toString(36)}`;

// --- The decision log -------------------------------------------------------

/**
 * Both actors write here, and every entry passes through this one function, so
 * the log cannot disagree with what actually happened. It is the SIO's policy
 * log: what was decided, by whom, at the time. See docs/METHOD.md.
 */
function record(
  actor: "human" | "agent",
  action: string,
  detail: string,
  targetId?: string
): void {
  const entry: DecisionEntry = {
    id: uid("dec"),
    at: Date.now(),
    actor,
    action,
    detail,
    target_id: targetId,
  };
  decisionLog()._push(entry);
}

// --- Validation -------------------------------------------------------------

/**
 * A proposal without a source is rejected here, in the mutation layer, not just
 * in the JSON Schema — a schema stops a well-formed agent, and this stops every
 * other path as well. The error is written to be acted on: it says which
 * argument was wrong and what to call to get a good value.
 */
export function validateCitation(
  source_doc_id: unknown,
  span: unknown
): ActionResult<Citation> {
  if (typeof source_doc_id !== "string" || !source_doc_id.trim()) {
    return fail(
      "This proposal has no source_doc_id, so it was rejected.",
      "Every proposal must cite a filing. Call search_documents first and use a doc_id from its results."
    );
  }

  const { documents } = getCorpus();
  const doc = documents.get(source_doc_id);
  if (!doc) {
    return fail(
      `No document with id "${source_doc_id}" exists in the corpus.`,
      "Use a doc_id exactly as returned by search_documents or get_entity — ids look like 'doc:officers:09876543'."
    );
  }

  const s = span as Span | undefined;
  if (!s || typeof s.start !== "number" || typeof s.end !== "number") {
    return fail(
      "This proposal has no span, so it was rejected.",
      `Pass the character offsets of the supporting text inside "${source_doc_id}". search_documents returns them on every result.`
    );
  }
  if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end <= s.start) {
    return fail(
      `Span {start: ${s.start}, end: ${s.end}} is not a valid range.`,
      "start and end must be non-negative integers with end greater than start."
    );
  }
  if (s.end > doc.text.length) {
    return fail(
      `Span ends at ${s.end} but "${source_doc_id}" is only ${doc.text.length} characters long.`,
      "Use a span returned by search_documents rather than constructing one."
    );
  }

  return { ok: true, data: { doc_id: source_doc_id, span: { start: s.start, end: s.end } } };
}

// --- Reading the canvas -----------------------------------------------------

export const canvasNodes = (): CanvasNode[] => [...graph().nodes.values()];
export const canvasEdges = (): CanvasEdge[] => [...graph().edges.values()];
export const onCanvas = (id: string): boolean => graph().nodes.has(id);

/** A node id is resolvable if it is on the canvas or is a pending proposal. */
function resolvableNodeId(id: string): boolean {
  if (onCanvas(id)) return true;
  for (const p of proposals().proposals.values()) {
    if (p.kind === "node" && p.status === "pending" && p.node_id === id) return true;
  }
  return false;
}

// --- Confirmed-graph mutation (human-initiated only) ------------------------

/**
 * Pull an entity out of the corpus and onto the canvas, confirmed.
 *
 * Only the analyst does this — via the search panel or by expanding a node.
 * There is no tool that reaches it, because an agent that could add confirmed
 * nodes could add wrong ones silently.
 */
export function addCorpusNode(entityId: string): ActionResult {
  const { entities } = getCorpus();
  const entity = entities.get(entityId);
  if (!entity) return fail(`No entity "${entityId}" in the corpus.`);

  const nodes = new Map(graph().nodes);
  if (nodes.has(entityId)) return { ok: true, id: entityId };

  nodes.set(entityId, { ...entity, citations: [] });
  useGraphStore.getState()._setNodes(nodes);

  // Bring across every corpus edge that now has both ends on the canvas. The
  // analyst added the node; the relationships it already had are not new claims.
  attachCorpusEdgesFor(entityId);
  record("human", "added", `${entity.type} "${entity.label}" to the canvas`, entityId);
  return { ok: true, id: entityId };
}

function attachCorpusEdgesFor(nodeId: string): void {
  const { edges: corpusEdges } = getCorpus();
  const nodes = graph().nodes;
  const edges = new Map(graph().edges);
  let changed = false;

  for (const { edge } of neighbours(corpusEdges, nodeId)) {
    if (!nodes.has(edge.from_id) || !nodes.has(edge.to_id)) continue;
    if (edges.has(edge.id)) continue;
    edges.set(edge.id, { ...edge });
    changed = true;
  }
  if (changed) useGraphStore.getState()._setEdges(edges);
}

export function removeNode(nodeId: string): ActionResult {
  const nodes = new Map(graph().nodes);
  if (!nodes.delete(nodeId)) return fail(`"${nodeId}" is not on the canvas.`);
  const edges = new Map(graph().edges);
  for (const [id, e] of edges) {
    if (e.from_id === nodeId || e.to_id === nodeId) edges.delete(id);
  }
  const g = useGraphStore.getState();
  g._setNodes(nodes);
  g._setEdges(edges);
  g._setSelection(graph().selection.filter((s) => s !== nodeId));
  return { ok: true };
}

/**
 * The analyst draws an edge by hand.
 *
 * If the corpus already evidences this relationship we promote the real edge,
 * citations and all. If it does not, the edge is still created — the analyst is
 * allowed to assert a hypothesis — but it is marked `analystAsserted` and the
 * UI says so, because an uncited line must never look like a cited one.
 */
export function drawEdge(fromId: string, toId: string, relation: Relation): ActionResult {
  if (fromId === toId) return fail("An edge needs two different nodes.");
  if (!onCanvas(fromId) || !onCanvas(toId)) {
    return fail("Both ends of an edge must be on the canvas.");
  }

  const { edges: corpusEdges } = getCorpus();
  const existing = corpusEdges.find(
    (e) =>
      e.relation === relation &&
      ((e.from_id === fromId && e.to_id === toId) || (e.from_id === toId && e.to_id === fromId))
  );

  const edges = new Map(graph().edges);
  if (existing) {
    if (edges.has(existing.id)) return { ok: true, id: existing.id };
    edges.set(existing.id, { ...existing });
    useGraphStore.getState()._setEdges(edges);
    return { ok: true, id: existing.id };
  }

  const id = uid("edge:asserted");
  edges.set(id, {
    id,
    from_id: fromId,
    to_id: toId,
    relation,
    citations: [],
    analystAsserted: true,
  });
  useGraphStore.getState()._setEdges(edges);
  record("human", "asserted", `${fromId} ${relation} ${toId} — no filing found, drawn by hand`, id);
  return { ok: true, id };
}

// --- Selection and view -----------------------------------------------------

export function setSelection(ids: string[]): ActionResult {
  const known = ids.filter(onCanvas);
  useGraphStore.getState()._setSelection(known);
  return { ok: true };
}

export function toggleSelection(id: string): ActionResult {
  const cur = graph().selection;
  return setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
}

export function clearSelection(): ActionResult {
  useGraphStore.getState()._setSelection([]);
  return { ok: true };
}

export function setViewport(v: { visibleNodeIds: string[]; zoom: number }): void {
  useGraphStore.getState()._setViewport(v);
}

/** The return leg of the loop: the agent moves the analyst's view to what it
 *  found. Moving a camera is not mutating a claim, so this one is safe to
 *  expose as a tool. */
export function requestFocus(nodeIds: string[]): ActionResult {
  const known = nodeIds.filter((id) => resolvableNodeId(id));
  if (!known.length) {
    return fail(
      "None of those node ids are on the canvas.",
      "Call get_visible_subgraph to see what is actually there, and use ids from it."
    );
  }
  useGraphStore.getState()._setFocusRequest({ nodeIds: known, nonce: Date.now() });
  return { ok: true };
}

// --- The reader -------------------------------------------------------------

/**
 * Open a filing.
 *
 * Both the analyst clicking the queue and the agent's `open_document` land
 * here. Opening drops the captured selection: a selection belongs to the
 * document it was made in, and carrying it across would let a tool cite the
 * wrong filing.
 */
export function openDocument(docId: string, scrollTo?: Span): ActionResult {
  const { documents } = getCorpus();
  const doc = documents.get(docId);
  if (!doc) {
    return fail(
      `No document "${docId}" in the corpus.`,
      "Use a doc_id exactly as returned by search_documents, get_entity or get_markings."
    );
  }

  const r = useReaderStore.getState();
  if (reader().openDocId !== docId) {
    r._setOpenDoc(docId);
    r._setSelection(null);
    r._setVisibleSpan(null);
  }
  if (!reader().queue.includes(docId)) r._setQueue([docId, ...reader().queue]);

  if (scrollTo) {
    if (scrollTo.start < 0 || scrollTo.end > doc.text.length || scrollTo.end <= scrollTo.start) {
      return fail(
        `scroll_to {start: ${scrollTo.start}, end: ${scrollTo.end}} is outside "${docId}", which is ${doc.text.length} characters long.`,
        "The filing was still opened. Pass a span from search_documents or get_markings."
      );
    }
    r._setScrollRequest({ doc_id: docId, span: scrollTo, nonce: Date.now() });
  }
  return { ok: true, id: docId };
}

/**
 * Take in a document the analyst dropped on the reader. **Human only.**
 *
 * There is no tool for this and there should not be: what enters the working
 * set is the Receiver's judgement, and an agent that could add its own
 * material to the record could quietly shape what the analyst reads. It goes
 * through the same store, the same offsets and the same marking system as an
 * ingested filing — the only difference is where it came from, which the UI
 * says plainly.
 */
export function ingestDocument(
  name: string,
  text: string,
  gesture?: HumanGesture
): ActionResult<string> {
  if (!requireHumanGesture("add a document", gesture)) {
    return fail("Only the analyst can add a document to the working set.");
  }

  const body = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "");
  if (!body.trim()) return fail(`"${name}" is empty.`);
  if (body.length > 400_000) {
    return fail(
      `"${name}" is ${Math.round(body.length / 1000)}k characters, which is too long to read.`,
      "Split it, or paste the part that matters."
    );
  }

  const title = name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Untitled";
  const id = uid("doc:added");

  addUploadedDocument({
    id,
    title,
    // Rendered verbatim. No wrapping, no normalising — the marking offsets and
    // any citation the agent makes both index this exact string.
    text: body,
    mentions: [],
  });

  const r = useReaderStore.getState();
  r._setQueue([id, ...reader().queue]);
  r._setOpenDoc(id);
  r._setSelection(null);
  r._setVisibleSpan(null);

  record("human", "added", `document "${title}" (${body.length.toLocaleString()} characters)`, id);
  return { ok: true, id, data: id };
}

/** Captured on `selectionchange`, not read at tool-call time — see readerStore. */
export function captureSelection(sel: { doc_id: string; start: number; end: number; text: string } | null): void {
  useReaderStore.getState()._setSelection(sel);
}

export function setVisibleSpan(span: Span | null): void {
  useReaderStore.getState()._setVisibleSpan(span);
}

export function clearScrollRequest(): void {
  useReaderStore.getState()._setScrollRequest(null);
}

export interface AddMarkingInput {
  doc_id: string;
  span: Span;
  type: MarkingType;
  note?: string;
  origin?: "human" | "agent";
}

/**
 * Mark a passage.
 *
 * The analyst dragging across a paragraph and the agent's `highlight_span` are
 * the *same* call, differing only in `origin`. There is no agent-flavoured
 * write path — if one ever appears, the product has stopped being what
 * docs/METHOD.md says it is.
 */
export function addMarking(input: AddMarkingInput): ActionResult<Marking> {
  const { documents } = getCorpus();
  const doc = documents.get(input.doc_id);
  if (!doc) {
    return fail(
      `No document "${input.doc_id}" in the corpus.`,
      "Use a doc_id from search_documents, get_entity or get_reader_context."
    );
  }

  const { start, end } = input.span;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
    return fail(
      `Span {start: ${start}, end: ${end}} is not a valid range.`,
      "start and end must be non-negative integers with end greater than start."
    );
  }
  if (end > doc.text.length) {
    return fail(
      `Span ends at ${end} but "${input.doc_id}" is only ${doc.text.length} characters long.`,
      "Use a span returned by search_documents rather than constructing one. An out-of-range span would render as an empty highlight, so it is refused."
    );
  }
  if (!MARKING_TYPES.includes(input.type)) {
    return fail(`"${input.type}" is not a marking type.`, `Use one of: ${MARKING_TYPES.join(", ")}.`);
  }

  const origin = input.origin ?? "human";
  const text = doc.text.slice(start, end);

  // Marking the same words twice is a no-op rather than an error: the agent
  // pointing at something the analyst already marked is a signal, not a fault.
  const map = new Map(reader().markings);
  for (const m of map.values()) {
    if (m.doc_id === input.doc_id && m.span.start === start && m.span.end === end && m.origin === origin) {
      return { ok: true, id: m.id, data: m };
    }
  }

  const marking: Marking = {
    id: uid("mark"),
    doc_id: input.doc_id,
    span: { start, end },
    text,
    type: input.type,
    note: input.note?.slice(0, 200) || undefined,
    origin,
    created_at: Date.now(),
  };
  map.set(marking.id, marking);
  useReaderStore.getState()._setMarkings(map);

  const shown = text.length > 60 ? `${text.slice(0, 57)}…` : text;
  record(
    origin,
    "marked",
    `${input.type} — "${shown}" in ${doc.title}`,
    marking.id
  );
  return { ok: true, id: marking.id, data: marking };
}

/**
 * Remove a mark. **Human only, and there is no tool for it.**
 *
 * A mark is the Reader's record of what they noticed. An agent that could
 * delete one could quietly erase the analyst's own reasoning, which is the
 * opposite of what this product is for.
 */
export function removeMarking(id: string, gesture?: HumanGesture): ActionResult {
  if (!requireHumanGesture("delete a marking", gesture)) {
    return fail("Only the analyst can delete their own markings.");
  }
  const map = new Map(reader().markings);
  const m = map.get(id);
  if (!m) return fail("No marking with that id.");
  map.delete(id);
  useReaderStore.getState()._setMarkings(map);
  record("human", "unmarked", `removed a ${m.type} mark`, id);
  return { ok: true };
}

// --- Lines of enquiry -------------------------------------------------------

/**
 * Raise a line of enquiry. **Human only, and there is no tool for it.**
 *
 * The human sets the agenda; the agent works the queue. This is the clearest
 * answer the product has to "is the AI just doing everything?".
 */
export function raiseEnquiry(
  question: string,
  fromMarkingId?: string,
  gesture?: HumanGesture
): ActionResult {
  if (!requireHumanGesture("raise a line of enquiry", gesture)) {
    return fail("Only the analyst can raise a line of enquiry.");
  }
  const q = question.trim();
  if (!q) return fail("A line of enquiry needs a question.");

  const id = uid("enq");
  const map = new Map(enquiries().enquiries);
  map.set(id, {
    id,
    question: q.slice(0, 240),
    status: "open",
    raised_by: "human",
    from_marking_id: fromMarkingId,
    created_at: Date.now(),
  });
  useEnquiryStore.getState()._setEnquiries(map);
  record("human", "raised", q.slice(0, 120), id);
  return { ok: true, id };
}

/** The agent takes an enquiry off the queue. Reversible and asserts nothing. */
export function claimEnquiry(id: string): ActionResult {
  const map = new Map(enquiries().enquiries);
  const e = map.get(id);
  if (!e) {
    return fail(`No line of enquiry "${id}".`, "Call list_enquiries for the open ones.");
  }
  if (e.status === "filed") {
    return fail(
      "That enquiry has been filed by the analyst and is closed.",
      "Call list_enquiries to see what is still open."
    );
  }
  map.set(id, { ...e, status: "claimed" });
  useEnquiryStore.getState()._setEnquiries(map);
  record("agent", "claimed", e.question.slice(0, 120), id);
  return { ok: true, id };
}

export interface ResultEnquiryInput {
  id: string;
  outcome: EnquiryOutcome;
  summary: string;
  citations: Citation[];
}

/**
 * Report back on an enquiry.
 *
 * `eliminated` is a first-class outcome: searching and finding nothing is the
 * majority of real investigative work, and a product that treats it as failure
 * teaches the agent to stretch for a weak link. `found` must be cited, for the
 * same reason a proposal must be.
 */
export function resultEnquiry(input: ResultEnquiryInput): ActionResult {
  const map = new Map(enquiries().enquiries);
  const e = map.get(input.id);
  if (!e) {
    return fail(`No line of enquiry "${input.id}".`, "Call list_enquiries for valid ids.");
  }
  if (e.status === "filed") {
    return fail("That enquiry has been filed by the analyst and is closed.");
  }
  if (!input.summary.trim()) {
    return fail(
      "A result needs a summary.",
      "Say what you searched and what you found, in plain words. If you found nothing, say what you searched — that is a useful result."
    );
  }
  if (input.outcome === "found" && input.citations.length === 0) {
    return fail(
      "An outcome of 'found' needs at least one citation.",
      "Pass the doc_id and span that evidence it, or report 'eliminated' or 'partial' instead. An uncited finding is not a finding."
    );
  }

  map.set(input.id, {
    ...e,
    status: "resulted",
    result: {
      outcome: input.outcome,
      summary: input.summary.slice(0, 400),
      citations: input.citations,
      at: Date.now(),
    },
  });
  useEnquiryStore.getState()._setEnquiries(map);
  record(
    "agent",
    "resulted",
    `${input.outcome} — ${input.summary.slice(0, 100)}`,
    input.id
  );
  return { ok: true, id: input.id };
}

/**
 * File an enquiry. **Human only, and there is no tool for it.**
 *
 * Closing a question is a judgement about whether the answer is sufficient.
 * That is the Reader's call, and the agent does not get to make it about its
 * own work.
 */
export function fileEnquiry(id: string, gesture?: HumanGesture): ActionResult {
  if (!requireHumanGesture("file a line of enquiry", gesture)) {
    return fail("Only the analyst can file a line of enquiry.");
  }
  const map = new Map(enquiries().enquiries);
  const e = map.get(id);
  if (!e) return fail("No line of enquiry with that id.");
  map.set(id, { ...e, status: "filed" });
  useEnquiryStore.getState()._setEnquiries(map);
  record("human", "filed", e.question.slice(0, 120), id);
  return { ok: true, id };
}

// --- Staging (the only thing a write tool can reach) ------------------------

export interface StageNodeInput {
  type: EntityType;
  label: string;
  entity_id?: string;
  source_doc_id: string;
  span: Span;
  reason: string;
  origin?: "agent" | "human";
}

export function stageNode(input: StageNodeInput): ActionResult {
  const cited = validateCitation(input.source_doc_id, input.span);
  if (!cited.ok) return cited;

  if (!input.reason?.trim()) {
    return fail(
      "A proposal needs a reason.",
      "Give one sentence explaining why this belongs on the canvas — the analyst reads it on the proposal card before accepting."
    );
  }

  const valid: EntityType[] = ["company", "person", "address", "document"];
  if (!valid.includes(input.type)) {
    return fail(`"${input.type}" is not an entity type.`, `Use one of: ${valid.join(", ")}.`);
  }

  // Prefer the corpus id so an accepted proposal merges with what we already
  // know about the entity rather than creating a duplicate island.
  const nodeId = input.entity_id?.trim() || uid(`${input.type}:proposed`);

  if (onCanvas(nodeId)) {
    return fail(
      `"${nodeId}" is already on the canvas.`,
      "Nothing to propose. Use propose_edge to connect it to something, or pin_evidence to corroborate it."
    );
  }
  if (input.entity_id && !getCorpus().entities.has(input.entity_id)) {
    return fail(
      `No entity "${input.entity_id}" exists in the corpus.`,
      "Omit entity_id if this is a new entity, or use an id from get_entity or search_documents."
    );
  }

  const map = new Map(proposals().proposals);
  for (const p of map.values()) {
    if (p.kind === "node" && p.status === "pending" && p.node_id === nodeId) {
      return fail(`"${nodeId}" is already proposed and waiting for the analyst.`);
    }
  }

  const id = uid("prop");
  map.set(id, {
    id,
    kind: "node",
    status: "pending",
    entityType: input.type,
    label: input.label,
    entity_id: input.entity_id,
    node_id: nodeId,
    citation: cited.data,
    reason: input.reason,
    created_at: Date.now(),
    origin: input.origin ?? "agent",
  });
  useProposalStore.getState()._setProposals(map);
  record(input.origin ?? "agent", "proposed", `${input.type} "${input.label}" — ${input.reason}`, id);
  return { ok: true, id };
}

export interface StageEdgeInput {
  from_id: string;
  to_id: string;
  relation: Relation;
  source_doc_id: string;
  span: Span;
  reason: string;
  origin?: "agent" | "human";
}

export function stageEdge(input: StageEdgeInput): ActionResult {
  const cited = validateCitation(input.source_doc_id, input.span);
  if (!cited.ok) return cited;

  if (!input.reason?.trim()) {
    return fail(
      "A proposal needs a reason.",
      "Give one sentence explaining what this relationship means — the analyst reads it before accepting."
    );
  }
  if (input.from_id === input.to_id) {
    return fail("An edge needs two different nodes.");
  }

  for (const end of ["from_id", "to_id"] as const) {
    const id = input[end];
    if (!resolvableNodeId(id)) {
      return fail(
        `"${id}" is neither on the canvas nor currently proposed, so this edge has nothing to attach to.`,
        "Propose the node first with propose_node, then propose the edge. Call get_visible_subgraph to see what is on the canvas."
      );
    }
  }

  const map = new Map(proposals().proposals);
  for (const p of map.values()) {
    if (
      p.kind === "edge" &&
      p.status === "pending" &&
      p.relation === input.relation &&
      ((p.from_id === input.from_id && p.to_id === input.to_id) ||
        (p.from_id === input.to_id && p.to_id === input.from_id))
    ) {
      return fail("That relationship is already proposed and waiting for the analyst.");
    }
  }

  const id = uid("prop");
  map.set(id, {
    id,
    kind: "edge",
    status: "pending",
    from_id: input.from_id,
    to_id: input.to_id,
    relation: input.relation,
    citation: cited.data,
    reason: input.reason,
    created_at: Date.now(),
    origin: input.origin ?? "agent",
  });
  useProposalStore.getState()._setProposals(map);
  return { ok: true, id };
}

/** Corroborate something already on the canvas. Additive and non-destructive:
 *  it can only ever append a citation, never change or remove one. */
export function pinEvidence(targetId: string, docId: string, span: Span): ActionResult {
  const cited = validateCitation(docId, span);
  if (!cited.ok) return cited;

  const nodes = new Map(graph().nodes);
  const node = nodes.get(targetId);
  if (node) {
    nodes.set(targetId, { ...node, citations: [...node.citations, cited.data] });
    useGraphStore.getState()._setNodes(nodes);
    return { ok: true, id: targetId };
  }

  const edges = new Map(graph().edges);
  const edge = edges.get(targetId);
  if (edge) {
    edges.set(targetId, { ...edge, citations: [...edge.citations, cited.data] });
    useGraphStore.getState()._setEdges(edges);
    return { ok: true, id: targetId };
  }

  return fail(
    `"${targetId}" is not on the canvas.`,
    "pin_evidence corroborates something the analyst has already accepted. Call get_visible_subgraph for valid target ids."
  );
}

export function annotate(
  targetId: string,
  note: string,
  origin: "agent" | "human" = "agent"
): ActionResult {
  if (!graph().nodes.has(targetId) && !graph().edges.has(targetId)) {
    return fail(
      `"${targetId}" is not on the canvas.`,
      "Call get_visible_subgraph for valid target ids."
    );
  }
  if (!note.trim()) return fail("The note is empty.");

  const a: Annotation = {
    id: uid("note"),
    target_id: targetId,
    note: note.slice(0, 280),
    origin,
    created_at: Date.now(),
  };
  useGraphStore.getState()._setAnnotations([...graph().annotations, a]);
  return { ok: true, id: a.id };
}

// --- Promotion: human only --------------------------------------------------

/**
 * Defence in depth.
 *
 * The primary guarantee is structural: no registered tool promotes a proposal,
 * nothing under src/webmcp/ imports the two functions below, and
 * scripts/check-no-commit-tool.ts fails the build if that stops being true.
 *
 * This is the second, independent guarantee. Promotion requires a DOM event
 * with `isTrusted === true` — an event the browser itself dispatched from a
 * real input device. `isTrusted` is read-only and is false on any event
 * constructed in script, and a tool call has no event at all, so a bug that
 * wired promotion into a tool fails closed rather than silently committing.
 *
 * An earlier version of this check used navigator.userActivation.isActive.
 * That was too weak to be worth having: it stays true for several seconds
 * after any interaction, so a tool call arriving just after the analyst
 * clicked anything would have passed it.
 */
export type HumanGesture = { isTrusted: boolean } | { nativeEvent: { isTrusted: boolean } };

function isTrustedGesture(gesture: HumanGesture | undefined): boolean {
  if (!gesture) return false;
  if ("nativeEvent" in gesture) return gesture.nativeEvent?.isTrusted === true;
  return gesture.isTrusted === true;
}

function requireHumanGesture(what: string, gesture: HumanGesture | undefined): boolean {
  if (isTrustedGesture(gesture)) return true;
  console.error(
    `[threadweaver] refused to ${what}: not a trusted user event. Only the ` +
      "analyst can promote a proposal — see docs/TOOLS.md, 'Why there is no commit tool'."
  );
  return false;
}

export function acceptProposal(proposalId: string, gesture?: HumanGesture): ActionResult {
  if (!requireHumanGesture("accept a proposal", gesture)) {
    return fail(
      "Proposals can only be accepted by the analyst, from the proposal tray.",
      "There is no tool that promotes a proposal. Propose it with a citation and let them decide."
    );
  }

  const map = new Map(proposals().proposals);
  const p = map.get(proposalId);
  if (!p || p.status !== "pending") return fail("No pending proposal with that id.");

  const now = Date.now();

  if (p.kind === "node") {
    const corpusEntity = p.entity_id ? getCorpus().entities.get(p.entity_id) : undefined;
    const nodes = new Map(graph().nodes);
    nodes.set(p.node_id, {
      id: p.node_id,
      type: p.entityType,
      label: corpusEntity?.label ?? p.label,
      attrs: corpusEntity?.attrs,
      sources: corpusEntity?.sources,
      citations: [p.citation],
      justAccepted: now,
    });
    useGraphStore.getState()._setNodes(nodes);
    attachCorpusEdgesFor(p.node_id);
  } else {
    const edges = new Map(graph().edges);
    const id = uid("edge:accepted");
    edges.set(id, {
      id,
      from_id: p.from_id,
      to_id: p.to_id,
      relation: p.relation,
      citations: [p.citation],
      justAccepted: now,
    });
    useGraphStore.getState()._setEdges(edges);
  }

  map.set(proposalId, { ...p, status: "accepted" } as Proposal);
  useProposalStore.getState()._setProposals(map);

  record(
    "human",
    "accepted",
    p.kind === "node"
      ? `${p.entityType} "${p.label}" onto the canvas — ${p.reason}`
      : `${p.from_id} ${p.relation} ${p.to_id} — ${p.reason}`,
    proposalId
  );

  // The money shot: the spring tightens and the whole graph contracts around
  // the new fact. See docs/UI.md, "the animated moments".
  useGraphStore.getState()._bumpReheat();
  return { ok: true, id: proposalId };
}

export function rejectProposal(proposalId: string, gesture?: HumanGesture): ActionResult {
  if (!requireHumanGesture("reject a proposal", gesture)) {
    return fail(
      "Proposals can only be rejected by the analyst, from the proposal tray.",
      "There is no tool that rejects a proposal."
    );
  }
  const map = new Map(proposals().proposals);
  const p = map.get(proposalId);
  if (!p || p.status !== "pending") return fail("No pending proposal with that id.");
  map.set(proposalId, { ...p, status: "rejected" } as Proposal);
  useProposalStore.getState()._setProposals(map);
  record(
    "human",
    "rejected",
    p.kind === "node" ? `proposed ${p.entityType} "${p.label}"` : `proposed ${p.relation}`,
    proposalId
  );
  return { ok: true, id: proposalId };
}

// --- Boot -------------------------------------------------------------------

/**
 * Seed the session.
 *
 * The canvas is deliberately sparse and deliberately incomplete: the
 * interesting entities are reachable but not present. The reader queue is
 * seeded from the filings those nodes came from, and the first one is opened,
 * because the app opens on Read — the human reads first. See docs/METHOD.md.
 */
export function seedCanvas(): void {
  const { seedNodeIds, seedDocIds, entities, documents } = getCorpus();
  for (const id of seedNodeIds) addCorpusNode(id);

  const queue: string[] = [];
  const push = (docId: string) => {
    if (documents.has(docId) && !queue.includes(docId)) queue.push(docId);
  };
  for (const id of seedDocIds) push(id);
  // Fall back to whatever the seed nodes cite, so the queue is never empty even
  // if the corpus build did not nominate opening filings.
  for (const id of seedNodeIds) {
    for (const docId of entities.get(id)?.sources ?? []) push(docId);
  }

  useReaderStore.getState()._setQueue(queue);
  if (queue.length) useReaderStore.getState()._setOpenDoc(queue[0]);

  record("human", "opened", `session started with ${seedNodeIds.length} entities and ${queue.length} filings`);
}

/** Used by the test harness and the "reset" control. */
export function resetCanvas(): void {
  const g = useGraphStore.getState();
  g._setNodes(new Map());
  g._setEdges(new Map());
  g._setAnnotations([]);
  g._setSelection([]);
  g._setFocusRequest(null);
  useProposalStore.getState()._setProposals(new Map());

  const r = useReaderStore.getState();
  r._setQueue([]);
  r._setOpenDoc(null);
  r._setMarkings(new Map());
  r._setSelection(null);
  r._setVisibleSpan(null);
  r._setScrollRequest(null);

  useEnquiryStore.getState()._setEnquiries(new Map());
  useDecisionLog.getState().clear();
}

export type { CanvasEdge, CanvasNode, Edge };
