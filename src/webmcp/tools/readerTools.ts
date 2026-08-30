import { getCorpus } from "../../corpus/loadCorpus";
import { enquiryList, enquiries } from "../../state/enquiryStore";
import { markingsFor, reader } from "../../state/readerStore";
import type { EnquiryStatus, MarkingType } from "../../types";
import { jsonResult, type McpToolDefinition } from "../mcpTypes";
import { GET_MARKINGS, LIST_ENQUIRIES, NO_INPUT } from "../schemas";

/**
 * The reader tools — the strongest WebMCP argument in the project.
 *
 * `get_selection` is defensible: a determined scraper could read a selected
 * node off the DOM. These are not. The passage an analyst highlighted inside a
 * client-rendered document, typed, with character offsets into a string that
 * never travelled over the wire, sitting beside eleven other marks they made in
 * the last ten minutes — no server has it, no API exposes it, and there is
 * nothing to scrape. It is the page's own state, and handing it to an agent is
 * exactly what WebMCP is for.
 *
 * Descriptions here are written around the words an analyst actually says
 * ("this bit", "what I just highlighted"). A tool that reads like a debugging
 * accessor never gets called, and a tool that never gets called is worth
 * nothing however well it is implemented.
 */

const READ_ONLY = { readOnlyHint: true } as const;

export const getReaderContext: McpToolDefinition = {
  name: "get_reader_context",
  description:
    "Return the filing the analyst currently has open in the reader, the passage they have selected right now if there is one, and roughly what is on their screen. Call this before answering anything phrased as 'this bit', 'this passage', 'what I just highlighted', or 'the bit I'm looking at'.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const { openDocId, selection, visibleSpan, markings } = reader();
    const doc = openDocId ? getCorpus().documents.get(openDocId) : undefined;

    if (!doc) {
      return jsonResult({
        doc_id: null,
        title: null,
        selection: null,
        note: "The analyst has no filing open. Ask them to open one, or call search_documents and open_document.",
      });
    }

    return jsonResult({
      doc_id: doc.id,
      title: doc.title,
      length: doc.text.length,
      // Captured on selectionchange rather than read here — by now the analyst
      // has clicked into their agent and the live DOM selection is collapsed.
      selection:
        selection && selection.doc_id === doc.id
          ? { start: selection.start, end: selection.end, text: selection.text }
          : null,
      visible_span: visibleSpan,
      marking_count: markingsFor(markings, doc.id).length,
      note:
        selection && selection.doc_id === doc.id
          ? "That span is directly citable: pass doc_id and the span to propose_node, propose_edge or highlight_span."
          : "Nothing is selected in the reader. Call get_markings to see what the analyst has marked so far.",
    });
  },
};

export const getMarkings: McpToolDefinition = {
  name: "get_markings",
  description:
    "Return the passages the analyst has marked while reading, each with its filing, character span, the marked text itself, its type and any note. This is what the analyst decided was worth noticing — treat it as instruction. Marks you made yourself with highlight_span are included and labelled origin 'agent'.",
  inputSchema: GET_MARKINGS,
  annotations: READ_ONLY,
  execute: (args) => {
    const docId = args.doc_id ? String(args.doc_id) : undefined;
    const type = args.type ? (String(args.type) as MarkingType) : undefined;
    const origin = args.origin ? String(args.origin) : undefined;

    const { documents } = getCorpus();
    const all = [...reader().markings.values()]
      .filter((m) => (docId ? m.doc_id === docId : true))
      .filter((m) => (type ? m.type === type : true))
      .filter((m) => (origin ? m.origin === origin : true))
      .sort((a, b) => a.created_at - b.created_at);

    return jsonResult({
      markings: all.map((m) => ({
        id: m.id,
        doc_id: m.doc_id,
        doc_title: documents.get(m.doc_id)?.title,
        span: m.span,
        // Denormalised deliberately: it halves the round trips and it makes the
        // tool log readable on screen.
        text: m.text,
        type: m.type,
        note: m.note,
        origin: m.origin,
      })),
      note: all.length
        ? "Every span here is directly citable. The analyst marked these by hand — start from them rather than searching blind."
        : "The analyst has not marked anything yet. Call get_reader_context to see what they have open.",
    });
  },
};

export const listEnquiries: McpToolDefinition = {
  name: "list_enquiries",
  description:
    "Return the lines of enquiry the analyst has raised, in their own words, with what each was raised from and its status. Prefer working an open enquiry over inventing your own line of investigation — the analyst sets the agenda. Use claim_enquiry to take one, then result_enquiry to report back.",
  inputSchema: LIST_ENQUIRIES,
  annotations: READ_ONLY,
  execute: (args) => {
    const status = args.status ? (String(args.status) as EnquiryStatus) : undefined;
    const markings = reader().markings;

    const rows = enquiryList(enquiries().enquiries).filter((e) =>
      status ? e.status === status : e.status === "open" || e.status === "claimed"
    );

    return jsonResult({
      enquiries: rows.map((e) => {
        const from = e.from_marking_id ? markings.get(e.from_marking_id) : undefined;
        return {
          id: e.id,
          question: e.question,
          status: e.status,
          raised_by: e.raised_by,
          from_marking: from
            ? { id: from.id, doc_id: from.doc_id, span: from.span, text: from.text, type: from.type }
            : undefined,
          result: e.result
            ? { outcome: e.result.outcome, summary: e.result.summary }
            : undefined,
        };
      }),
      note: rows.length
        ? "You cannot close any of these. Report what you find with result_enquiry; the analyst decides whether the answer is sufficient and files it."
        : "Nothing open. The analyst raises lines of enquiry from the reader — ask them what they want looked at.",
    });
  },
};

export const READER_TOOLS: McpToolDefinition[] = [
  getReaderContext,
  getMarkings,
  listEnquiries,
];
