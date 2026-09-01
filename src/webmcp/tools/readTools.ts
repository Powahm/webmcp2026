import { getCorpus } from "../../corpus/loadCorpus";
import { findPaths, neighbours } from "../../corpus/paths";
import { searchDocuments } from "../../corpus/search";
import { canvasEdges, canvasNodes } from "../../state/actions";
import { graph } from "../../state/graphStore";
import { pendingProposals, proposals } from "../../state/proposalStore";
import { errorResult, jsonResult, type McpToolDefinition } from "../mcpTypes";
import { openEnquiryNudge } from "../nudge";
import { GET_ENTITY, NO_INPUT, QUERY_PATHS, SEARCH_DOCUMENTS } from "../schemas";

/**
 * The canvas and corpus read-only tools. The reader ones live in
 * readerTools.ts.
 *
 * All carry annotations.readOnlyHint so the browser doesn't gate them behind a
 * confirmation prompt, nothing here can change anything. They read the stores
 * and the corpus directly and never call actions.ts, because actions.ts is the
 * mutation API and these tools do not mutate.
 *
 * The canvas-state tools are half the argument for WebMCP over an API: no
 * server and no page-scraper can know what the analyst just decided to point
 * at. The other half, and the stronger one, is in readerTools.ts.
 */

const READ_ONLY = { readOnlyHint: true } as const;

export const getSelection: McpToolDefinition = {
  name: "get_selection",
  description:
    "Return the entities the analyst currently has selected on the canvas, with their types and ids. Use this before answering any question phrased as 'these', 'this one', or 'the two I've picked'.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const { nodes, selection } = graph();
    return jsonResult({
      ...openEnquiryNudge(),
      nodes: selection
        .map((id) => nodes.get(id))
        .filter((n) => n !== undefined)
        .map((n) => ({ id: n!.id, type: n!.type, label: n!.label })),
      note:
        selection.length === 0
          ? "Nothing is selected. Ask the analyst what they want you to look at, or call get_visible_subgraph."
          : undefined,
    });
  },
};

export const getViewport: McpToolDefinition = {
  name: "get_viewport",
  description:
    "Return which node ids are currently visible in the canvas viewport, and the current zoom level. Use it to judge what the analyst can actually see before describing the graph to them.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const { viewport, nodes } = graph();
    return jsonResult({
      visibleNodeIds: viewport.visibleNodeIds,
      zoom: viewport.zoom,
      offscreenCount: Math.max(0, nodes.size - viewport.visibleNodeIds.length),
    });
  },
};

export const getVisibleSubgraph: McpToolDefinition = {
  name: "get_visible_subgraph",
  description:
    "Return the nodes and edges currently on the canvas, with types, labels and confirmation state. This is the analyst's working set, not the full corpus. The corpus is much larger, and search_documents reaches it.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const pending = pendingProposals(proposals().proposals);
    return jsonResult({
      ...openEnquiryNudge(),
      nodes: canvasNodes().map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        confirmed: true,
        evidenceCount: n.citations.length,
      })),
      edges: canvasEdges().map((e) => ({
        id: e.id,
        from_id: e.from_id,
        to_id: e.to_id,
        relation: e.relation,
        derived: e.derived ?? false,
        analystAsserted: e.analystAsserted ?? false,
        evidenceCount: e.citations.length,
      })),
      proposalCount: pending.length,
      corpusSize: getCorpus().entities.size,
    });
  },
};

export const getEntity: McpToolDefinition = {
  name: "get_entity",
  description:
    "Return the full record for one company, person or address, including every filing it appears in and everything the corpus attaches to it. Says whether each neighbour is already on the canvas.",
  inputSchema: GET_ENTITY,
  annotations: READ_ONLY,
  execute: (args) => {
    const id = String(args.id ?? "");
    const { entities, edges, documents } = getCorpus();
    const entity = entities.get(id);
    if (!entity) {
      return errorResult(
        `No entity "${id}" in the corpus.`,
        "Ids look like 'company:09876543' or 'person:jane-doe-1975-04'. Call search_documents to find one, or get_visible_subgraph for what is on the canvas."
      );
    }

    const onCanvasIds = new Set(canvasNodes().map((n) => n.id));
    const related = neighbours(edges, id).slice(0, 60);

    return jsonResult({
      id: entity.id,
      type: entity.type,
      label: entity.label,
      attrs: entity.attrs ?? {},
      documents: (entity.sources ?? []).map((docId) => ({
        doc_id: docId,
        title: documents.get(docId)?.title,
      })),
      related: related.map(({ edge, other }) => ({
        id: other,
        label: entities.get(other)?.label,
        type: entities.get(other)?.type,
        relation: edge.relation,
        direction: edge.from_id === id ? "outgoing" : "incoming",
        derived: edge.derived ?? false,
        onCanvas: onCanvasIds.has(other),
        source_doc_id: edge.citations[0]?.doc_id,
        span: edge.citations[0]?.span,
      })),
    });
  },
};

export const searchDocumentsTool: McpToolDefinition = {
  name: "search_documents",
  description:
    "Full-text search across the filing corpus. Returns document ids with the character offsets of each match, so results can be cited exactly. It returns pointers, never prose. Read the spans and cite them. Does not search the canvas; use get_visible_subgraph for that.",
  inputSchema: SEARCH_DOCUMENTS,
  annotations: READ_ONLY,
  execute: (args) => {
    const query = String(args.query ?? "").trim();
    if (query.length < 2) {
      return errorResult("query is too short.", "Give at least two characters.");
    }
    const entityIds = Array.isArray(args.entity_ids)
      ? (args.entity_ids as unknown[]).map(String)
      : undefined;
    const limit = typeof args.limit === "number" ? args.limit : 10;

    const results = searchDocuments(query, { entityIds, limit });
    return jsonResult({
      ...openEnquiryNudge(),
      results,
      note: results.length
        ? "Each span is directly citable: pass source_doc_id and span to propose_node or propose_edge."
        : "Nothing matched. Try a company number, a surname, or a street name rather than a phrase.",
    });
  },
};

export const queryPaths: McpToolDefinition = {
  name: "query_paths",
  description:
    "Find existing paths between two entities on the canvas. Traversal only: it will not invent a connection. An empty result is a real answer. It means no confirmed path exists yet, which is usually where the investigation starts.",
  inputSchema: QUERY_PATHS,
  annotations: READ_ONLY,
  execute: (args) => {
    const fromId = String(args.from_id ?? "");
    const toId = String(args.to_id ?? "");
    const maxHops = typeof args.max_hops === "number" ? Math.min(4, Math.max(1, args.max_hops)) : 4;

    const nodes = graph().nodes;
    for (const [name, id] of [
      ["from_id", fromId],
      ["to_id", toId],
    ] as const) {
      if (!nodes.has(id)) {
        return errorResult(
          `${name} "${id}" is not on the canvas.`,
          "query_paths traverses the canvas, not the corpus. Call get_visible_subgraph for valid ids, or get_entity to see what the corpus attaches to this entity."
        );
      }
    }

    const paths = findPaths(canvasEdges(), fromId, toId, maxHops);
    return jsonResult({
      paths: paths.map((p) => ({
        hops: p.hops,
        nodes: p.node_ids.map((id) => ({ id, label: nodes.get(id)?.label })),
        edges: p.edges,
      })),
      note: paths.length
        ? undefined
        : `No path of ${maxHops} hops or fewer exists on the canvas between these two. That is a real answer, not a failure. Search_documents may show a connection the canvas does not yet contain.`,
    });
  },
};

export const READ_TOOLS: McpToolDefinition[] = [
  getSelection,
  getViewport,
  getVisibleSubgraph,
  getEntity,
  searchDocumentsTool,
  queryPaths,
];
