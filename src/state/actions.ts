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

import { getCorpus } from "../corpus/loadCorpus";
import { neighbours } from "../corpus/paths";
import type {
  Annotation,
  Citation,
  Edge,
  EntityType,
  Proposal,
  Relation,
  Span,
} from "../types";
import { graph, useGraphStore, type CanvasEdge, type CanvasNode } from "./graphStore";
import { proposals, useProposalStore } from "./proposalStore";

// --- Result type ------------------------------------------------------------

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { id?: string } : { id?: string; data: T }))
  | { ok: false; error: string; hint?: string };

const fail = (error: string, hint?: string): ActionResult<never> =>
  ({ ok: false, error, hint }) as ActionResult<never>;

let counter = 0;
const uid = (prefix: string) => `${prefix}:${Date.now().toString(36)}-${(counter++).toString(36)}`;

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

export function setViewport(v: { visibleNodeIds: string[]; cameraDistance: number }): void {
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
 * The primary guarantee is structural — there is no registered tool that
 * promotes a proposal, and nothing in src/webmcp/ imports the two functions
 * below. This adds a second, independent guarantee at the browser level: a
 * promotion must happen inside a real user gesture. A tool call is not one.
 *
 * Where userActivation is unavailable we do not fail closed, because the app
 * must keep working in browsers that lack it — the structural guarantee still
 * holds there on its own.
 */
function requireHumanGesture(what: string): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (!ua) return true;
  if (ua.isActive) return true;
  console.error(
    `[threadweaver] refused to ${what}: no user gesture. Only the analyst can ` +
      "promote a proposal — see docs/TOOLS.md, 'Why there is no commit tool'."
  );
  return false;
}

export function acceptProposal(proposalId: string): ActionResult {
  if (!requireHumanGesture("accept a proposal")) {
    return fail("Proposals can only be accepted by the analyst.");
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

  // The money shot: the spring tightens and the whole graph contracts around
  // the new fact. See docs/UI-3D.md, "the three animated moments".
  useGraphStore.getState()._bumpReheat();
  return { ok: true, id: proposalId };
}

export function rejectProposal(proposalId: string): ActionResult {
  if (!requireHumanGesture("reject a proposal")) {
    return fail("Proposals can only be rejected by the analyst.");
  }
  const map = new Map(proposals().proposals);
  const p = map.get(proposalId);
  if (!p || p.status !== "pending") return fail("No pending proposal with that id.");
  map.set(proposalId, { ...p, status: "rejected" } as Proposal);
  useProposalStore.getState()._setProposals(map);
  return { ok: true, id: proposalId };
}

// --- Boot -------------------------------------------------------------------

/** Seed the canvas. Deliberately sparse and deliberately incomplete: the
 *  interesting entities are reachable but not present. */
export function seedCanvas(): void {
  const { seedNodeIds } = getCorpus();
  for (const id of seedNodeIds) addCorpusNode(id);
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
}

export type { CanvasEdge, CanvasNode, Edge };
