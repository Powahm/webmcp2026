import { getCorpus } from "../../corpus/loadCorpus";
import {
  addMarking,
  annotate,
  claimEnquiry,
  openDocument,
  pinEvidence,
  requestFocus,
  resultEnquiry,
  stageEdge,
  stageNode,
  type ActionResult,
} from "../../state/actions";
import type { Citation, EntityType, EnquiryOutcome, MarkingType, Relation, Span } from "../../types";
import { errorResult, jsonResult, type McpToolDefinition } from "../mcpTypes";
import {
  ANNOTATE,
  CLAIM_ENQUIRY,
  FOCUS,
  HIGHLIGHT_SPAN,
  OPEN_DOCUMENT,
  PIN_EVIDENCE,
  PROPOSE_EDGE,
  PROPOSE_NODE,
  RESULT_ENQUIRY,
} from "../schemas";

/**
 * The nine write tools.
 *
 * Every one of these calls actions.ts. The same entry point the analyst's
 * clicks use. They fall into three kinds and none can alter the confirmed
 * graph:
 *
 *   - staged claims  propose_node, propose_edge, pin_evidence. They assert
 *                    something, land unconfirmed, and wait for a human.
 *   - pointing       highlight_span, open_document, focus, annotate. They
 *                    change what the analyst is looking at and assert nothing.
 *   - reporting      claim_enquiry, result_enquiry. They answer a question the
 *                    analyst asked. Only the analyst files it.
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

/** Translate an actions.ts result into a tool result, preserving the hint.
 *  An agent that gets told what to do differently will retry correctly rather
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
    "Propose adding an entity to the canvas. Creates a dashed, unconfirmed node that the analyst must accept. It does not add anything to the confirmed graph. Requires a source document and the span within it that supports the claim; proposals without a source are rejected.",
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
    "Attach an additional citation to a node or edge already on the canvas. Use it to corroborate something the analyst has already accepted. It only ever adds a citation. It cannot change or remove one, and it cannot change what the node or edge asserts.",
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
    "Move the analyst's view on the canvas to frame these nodes. Use it after proposing something so they can see it without hunting for it. It changes the view only. It asserts nothing and changes no data.",
  inputSchema: FOCUS,
  execute: (args) => {
    const ids = Array.isArray(args.node_ids) ? (args.node_ids as unknown[]).map(String) : [];
    return reply(requestFocus(ids), () => ({
      focused: ids.length,
      note: "The canvas is moving to frame those nodes.",
    }));
  },
};

// --- Pointing at things in the reader ---------------------------------------

/**
 * The agent marks a passage in the filing the analyst is reading, in the
 * agent's own colour, beside their marks. Two actors annotating one surface.
 *
 * It goes through the same `addMarking` the analyst's mouse does, differing
 * only in `origin`. There is no agent-flavoured write path.
 */
export const highlightSpanTool: McpToolDefinition = {
  name: "highlight_span",
  description:
    "Mark a passage in a filing so the analyst sees it in their reader, shown as your mark rather than theirs. Use it to point at the exact words that support what you are about to propose or report. It asserts nothing and adds nothing to the canvas. The analyst can clear it.",
  inputSchema: HIGHLIGHT_SPAN,
  execute: (args) =>
    reply(
      addMarking({
        doc_id: String(args.doc_id ?? ""),
        span: asSpan(args.span),
        type: String(args.type) as MarkingType,
        note: args.note ? String(args.note) : undefined,
        origin: "agent",
      }),
      (id) => ({
        marking_id: id,
        note: "Your mark is in the analyst's reader, in the agent colour, alongside their own.",
      })
    ),
};

export const openDocumentTool: McpToolDefinition = {
  name: "open_document",
  description:
    "Open a filing in the analyst's reader and scroll it to a passage. Use it after finding something so they can read it in place rather than hunting for it. It changes the view only. It asserts nothing and changes no data.",
  inputSchema: OPEN_DOCUMENT,
  execute: (args) => {
    const scroll = args.scroll_to ? asSpan(args.scroll_to) : undefined;
    return reply(openDocument(String(args.doc_id ?? ""), scroll), (id) => ({
      doc_id: id,
      note: "The filing is open in front of the analyst.",
    }));
  },
};

// --- Working the analyst's queue --------------------------------------------

export const claimEnquiryTool: McpToolDefinition = {
  name: "claim_enquiry",
  description:
    "Take a line of enquiry off the analyst's queue so they can see you are working it. Call list_enquiries first. Claiming is reversible and asserts nothing.",
  inputSchema: CLAIM_ENQUIRY,
  execute: (args) =>
    reply(claimEnquiry(String(args.enquiry_id ?? "")), (id) => ({
      enquiry_id: id,
      note: "Marked as yours. Report back with result_enquiry.",
    })),
};

/**
 * Reporting back, including with nothing.
 *
 * The description says outright that finding nothing is a valid result. Without
 * that, a model keeps searching rather than admitting an empty answer, and
 * stretching for a weak link is the exact failure this whole product is built
 * against. In real investigative work, eliminating a line of enquiry is most of
 * the job. See docs/METHOD.md.
 */
export const resultEnquiryTool: McpToolDefinition = {
  name: "result_enquiry",
  description:
    "Report back on a line of enquiry the analyst raised. Finding nothing is a valid and useful result: report 'eliminated' with what you searched rather than stretching for a weak link. 'found' requires at least one citation. The analyst reviews every result. You cannot close an enquiry yourself.",
  inputSchema: RESULT_ENQUIRY,
  execute: (args) => {
    const raw = Array.isArray(args.citations) ? (args.citations as unknown[]) : [];
    const { documents } = getCorpus();
    const citations: Citation[] = [];

    for (const c of raw) {
      const obj = c as { doc_id?: unknown; span?: unknown };
      const docId = String(obj.doc_id ?? "");
      const span = asSpan(obj.span);
      const doc = documents.get(docId);
      if (!doc) {
        return errorResult(
          `No document "${docId}" in the corpus.`,
          "Use doc_ids exactly as returned by search_documents, get_entity or get_markings."
        );
      }
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start) {
        return errorResult(
          `Span {start: ${span.start}, end: ${span.end}} is not a valid range.`,
          "start and end must be non-negative integers with end greater than start."
        );
      }
      if (span.end > doc.text.length) {
        return errorResult(
          `Span ends at ${span.end} but "${docId}" is only ${doc.text.length} characters long.`,
          "Use a span returned by search_documents rather than constructing one."
        );
      }
      citations.push({ doc_id: docId, span });
    }

    return reply(
      resultEnquiry({
        id: String(args.enquiry_id ?? ""),
        outcome: String(args.outcome) as EnquiryOutcome,
        summary: String(args.summary ?? ""),
        citations,
      }),
      (id) => ({
        enquiry_id: id,
        note: "Reported. It is in the analyst's queue and in the decision log; only they can file it.",
      })
    );
  },
};

export const WRITE_TOOLS: McpToolDefinition[] = [
  proposeNode,
  proposeEdge,
  pinEvidenceTool,
  highlightSpanTool,
  annotateTool,
  openDocumentTool,
  focusTool,
  claimEnquiryTool,
  resultEnquiryTool,
];
