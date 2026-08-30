import type { JsonSchema } from "./mcpTypes";

/**
 * JSON Schema for every tool. Not TypeScript types, not Python kwargs — JSON
 * Schema, which is what the host validates against.
 *
 * Every schema sets `additionalProperties: false`. Narrow inputs are the
 * documented recommendation, and a broad "do the thinking for me" tool is the
 * documented anti-pattern: eleven tools that each do one legible thing score
 * better than four that each do everything.
 */

export const NO_INPUT: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const SPAN = {
  type: "object",
  description:
    "Character offsets into the document's text, as returned by search_documents.",
  properties: {
    start: { type: "integer", minimum: 0 },
    end: { type: "integer", minimum: 1 },
  },
  required: ["start", "end"],
  additionalProperties: false,
} as const;

export const RELATIONS = [
  "director_of",
  "psc_of",
  "registered_at",
  "previously_named",
  "shares_address_with",
  "filed",
] as const;

export const MARKING_TYPE_ENUM = [
  "person",
  "company",
  "address",
  "date",
  "question",
  "lead",
] as const;

export const GET_MARKINGS: JsonSchema = {
  type: "object",
  properties: {
    doc_id: { type: "string", description: "Optional. Restrict to one filing." },
    type: {
      type: "string",
      enum: [...MARKING_TYPE_ENUM],
      description: "Optional. Restrict to one kind of mark.",
    },
    origin: {
      type: "string",
      enum: ["human", "agent"],
      description:
        "Optional. Default is both. Use 'human' to see only what the analyst marked themselves.",
    },
  },
  additionalProperties: false,
};

export const LIST_ENQUIRIES: JsonSchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["open", "claimed", "resulted", "filed"],
      description: "Optional. Default returns open and claimed.",
    },
  },
  additionalProperties: false,
};

export const HIGHLIGHT_SPAN: JsonSchema = {
  type: "object",
  properties: {
    doc_id: { type: "string" },
    span: SPAN as unknown as Record<string, unknown>,
    type: { type: "string", enum: [...MARKING_TYPE_ENUM] },
    note: {
      type: "string",
      maxLength: 200,
      description: "One line, shown beside the mark in the margin.",
    },
  },
  required: ["doc_id", "span", "type"],
  additionalProperties: false,
};

export const OPEN_DOCUMENT: JsonSchema = {
  type: "object",
  properties: {
    doc_id: { type: "string" },
    scroll_to: SPAN as unknown as Record<string, unknown>,
  },
  required: ["doc_id"],
  additionalProperties: false,
};

export const CLAIM_ENQUIRY: JsonSchema = {
  type: "object",
  properties: {
    enquiry_id: { type: "string", description: "Id from list_enquiries." },
  },
  required: ["enquiry_id"],
  additionalProperties: false,
};

export const RESULT_ENQUIRY: JsonSchema = {
  type: "object",
  properties: {
    enquiry_id: { type: "string", description: "Id from list_enquiries." },
    outcome: {
      type: "string",
      enum: ["found", "eliminated", "partial"],
      description:
        "'eliminated' means you searched and there is nothing to find; say what you searched in summary. 'found' requires at least one citation.",
    },
    summary: {
      type: "string",
      minLength: 1,
      maxLength: 400,
      description:
        "What you did and what you found, in plain words. Structural facts about public records only — never a conclusion about a person.",
    },
    citations: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          doc_id: { type: "string" },
          span: SPAN as unknown as Record<string, unknown>,
        },
        required: ["doc_id", "span"],
        additionalProperties: false,
      },
    },
  },
  required: ["enquiry_id", "outcome", "summary"],
  additionalProperties: false,
};

export const GET_ENTITY: JsonSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description:
        "Entity id, e.g. 'company:09876543', 'person:jane-doe-1975-04' or 'address:1a2b3c4d5e6f'.",
    },
  },
  required: ["id"],
  additionalProperties: false,
};

export const SEARCH_DOCUMENTS: JsonSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "Search terms. Names, company numbers, addresses.",
      minLength: 2,
    },
    entity_ids: {
      type: "array",
      items: { type: "string" },
      maxItems: 12,
      description: "Optional. Restrict results to documents mentioning these entities.",
    },
    limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
  },
  required: ["query"],
  additionalProperties: false,
};

export const QUERY_PATHS: JsonSchema = {
  type: "object",
  properties: {
    from_id: { type: "string", description: "Entity id to start from." },
    to_id: { type: "string", description: "Entity id to reach." },
    max_hops: { type: "integer", minimum: 1, maximum: 4, default: 4 },
  },
  required: ["from_id", "to_id"],
  additionalProperties: false,
};

export const PROPOSE_NODE: JsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["company", "person", "address", "document"] },
    label: { type: "string", minLength: 1, maxLength: 160 },
    entity_id: {
      type: "string",
      description: "Corpus id if this entity already exists in the corpus. Omit if it does not.",
    },
    source_doc_id: {
      type: "string",
      description: "Document that evidences this entity. Required.",
    },
    span: SPAN as unknown as Record<string, unknown>,
    reason: {
      type: "string",
      minLength: 1,
      maxLength: 280,
      description: "One sentence, shown to the analyst on the proposal card.",
    },
  },
  required: ["type", "label", "source_doc_id", "span", "reason"],
  additionalProperties: false,
};

export const PROPOSE_EDGE: JsonSchema = {
  type: "object",
  properties: {
    from_id: { type: "string" },
    to_id: { type: "string" },
    relation: { type: "string", enum: [...RELATIONS] },
    source_doc_id: {
      type: "string",
      description: "Document that evidences this relationship. Required.",
    },
    span: SPAN as unknown as Record<string, unknown>,
    reason: { type: "string", minLength: 1, maxLength: 280 },
  },
  required: ["from_id", "to_id", "relation", "source_doc_id", "span", "reason"],
  additionalProperties: false,
};

export const PIN_EVIDENCE: JsonSchema = {
  type: "object",
  properties: {
    target_id: { type: "string", description: "A node or edge id already on the canvas." },
    doc_id: { type: "string" },
    span: SPAN as unknown as Record<string, unknown>,
  },
  required: ["target_id", "doc_id", "span"],
  additionalProperties: false,
};

export const ANNOTATE: JsonSchema = {
  type: "object",
  properties: {
    target_id: { type: "string", description: "A node or edge id already on the canvas." },
    note: { type: "string", minLength: 1, maxLength: 280 },
  },
  required: ["target_id", "note"],
  additionalProperties: false,
};

export const FOCUS: JsonSchema = {
  type: "object",
  properties: {
    node_ids: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 12,
    },
  },
  required: ["node_ids"],
  additionalProperties: false,
};
