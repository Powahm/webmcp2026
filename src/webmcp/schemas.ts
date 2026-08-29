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
