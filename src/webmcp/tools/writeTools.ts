import {
  annotate,
  pinEvidence,
  requestFocus,
  stageEdge,
  stageNode,
  type ActionResult,
} from "../../state/actions";
import type { EntityType, Relation, Span } from "../../types";
import { errorResult, jsonResult, type McpToolDefinition } from "../mcpTypes";
import { ANNOTATE, FOCUS, PIN_EVIDENCE, PROPOSE_EDGE, PROPOSE_NODE } from "../schemas";

/**
 * The five staged-write tools.
 *
 * Every one of these calls actions.ts — the same entry point the analyst's
 * clicks use. None of them can alter the confirmed graph: propose_node and
 * propose_edge reach proposalStore only, pin_evidence can append a citation but
 * never change or remove one, annotate writes a note, and focus moves a camera.
 *
 * There is no commit tool. Nothing in this file imports acceptProposal or
 * rejectProposal, and no such tool is registered, so the agent physically
 * cannot promote its own claim. That is a design principle rather than a
 * missing feature: it answers "how do I know the agent isn't inventing links
 * about real people" before it has to be asked.
 *
 * The side effect is described in each description, which is both the explicit
 * guidance and what makes the browser's confirmation prompt read sensibly.
 */

/** Translate an actions.ts result into a tool result, preserving the hint —
 *  an agent that gets told what to do differently will retry correctly rather
 *  than give up or invent a workaround. */
function reply(result: ActionResult, ok: (id?: string) => Record<string, unknown>) {
  if (!result.ok) return errorResult(result.error, result.hint);
  return jsonResult({ ok: true, ...ok(result.id) });
}

const asSpan = (v: unknown): Span => {
  const s = v as { start?: unknown; end?: unknown } | undefined;
  return { start: Number(s?.start), end: Number(s?.end) };
};

export const proposeNode: McpToolDefinition = {
  name: "propose_node",
  description:
    "Propose adding an entity to the canvas. Creates a dashed, unconfirmed node that the analyst must accept — it does not add anything to the confirmed graph. Requires a source document and the span within it that supports the claim; proposals without a source are rejected.",
  inputSchema: PROPOSE_NODE,
  execute: (args) =>
    reply(
      stageNode({
        type: String(args.type) as EntityType,
        label: String(args.label ?? ""),
        entity_id: args.entity_id ? String(args.entity_id) : undefined,
        source_doc_id: String(args.source_doc_id ?? ""),
        span: asSpan(args.span),
        reason: String(args.reason ?? ""),
        origin: "agent",
      }),
      (id) => ({
        proposal_id: id,
        staged: true,
        note: "Staged for the analyst. It is on the canvas as an unconfirmed proposal and becomes part of the graph only if they accept it.",
      })
    ),
};

export const proposeEdge: McpToolDefinition = {
  name: "propose_edge",
  description:
    "Propose a relationship between two entities on the canvas. Draws a dashed thread the analyst must accept; it does not create a confirmed relationship. Requires the source document and span that evidences the relationship. Both ends must already be on the canvas or be nodes you have just proposed.",
  inputSchema: PROPOSE_EDGE,
  execute: (args) =>
    reply(
      stageEdge({
        from_id: String(args.from_id ?? ""),
        to_id: String(args.to_id ?? ""),
        relation: String(args.relation) as Relation,
        source_doc_id: String(args.source_doc_id ?? ""),
        span: asSpan(args.span),
        reason: String(args.reason ?? ""),
        origin: "agent",
      }),
      (id) => ({
        proposal_id: id,
        staged: true,
        note: "Staged for the analyst. Nothing is connected until they accept it.",
      })
    ),
};

export const pinEvidenceTool: McpToolDefinition = {
  name: "pin_evidence",
  description:
    "Attach an additional citation to a node or edge already on the canvas. Use it to corroborate something the analyst has already accepted. It only ever adds a citation — it cannot change or remove one, and it cannot change what the node or edge asserts.",
  inputSchema: PIN_EVIDENCE,
  execute: (args) =>
    reply(
      pinEvidence(String(args.target_id ?? ""), String(args.doc_id ?? ""), asSpan(args.span)),
      (id) => ({ target_id: id, note: "Citation added. The analyst can open it in the evidence drawer." })
    ),
};

export const annotateTool: McpToolDefinition = {
  name: "annotate",
  description:
    "Leave a short note on a node or edge, visible to the analyst in the inspector. Use it to record why something looked significant. A note is not a claim about the record and carries no citation.",
  inputSchema: ANNOTATE,
  execute: (args) =>
    reply(annotate(String(args.target_id ?? ""), String(args.note ?? ""), "agent"), (id) => ({
      annotation_id: id,
    })),
};

export const focusTool: McpToolDefinition = {
  name: "focus",
  description:
    "Move the analyst's camera to frame these nodes. Use it after proposing something so they can see it without hunting for it. It changes the view only — it asserts nothing and changes no data.",
  inputSchema: FOCUS,
  execute: (args) => {
    const ids = Array.isArray(args.node_ids) ? (args.node_ids as unknown[]).map(String) : [];
    return reply(requestFocus(ids), () => ({
      focused: ids.length,
      note: "The camera is moving to those nodes.",
    }));
  },
};

export const WRITE_TOOLS: McpToolDefinition[] = [
  proposeNode,
  proposeEdge,
  pinEvidenceTool,
  annotateTool,
  focusTool,
];
