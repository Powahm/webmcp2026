# WebMCP tool contracts

Eleven tools. Six read-only, five staged writes, **no commit tool**.

Depth is itself a judging signal: eleven narrow, well-described tools score better than four broad
ones, and broad "do the thinking for me" tools are the documented anti-pattern.

## Registration

```ts
// src/webmcp/register.ts
const mc =
  (globalThis as any).document?.modelContext ??
  (globalThis as any).navigator?.modelContext;

if (typeof mc?.registerTool === "function") {
  for (const tool of ALL_TOOLS) await mc.registerTool(tool);
} else {
  console.info("[threadweaver] no WebMCP host; running as a normal web app");
}
```

Three things that will silently cost you the submission if you get them wrong:

- `document.modelContext` is the spec location and what OpenAI's browser reads. Chrome's origin
  trial still exposes `navigator.modelContext`. **Register on whichever exists.**
- `inputSchema` is **JSON Schema**. Not Python kwargs, not TypeScript types.
- **Tools inside an iframe are never discovered.** Register on the top-level document.

Set `additionalProperties: false` on every schema. Narrow inputs are explicitly recommended.

## Read-only tools

All six carry `annotations: { readOnlyHint: true }` so the browser doesn't gate them behind a
confirmation prompt. They read the stores and the corpus directly and never call `actions.ts`.

### `get_selection`

The most important tool in the project. It is the entire answer to "why WebMCP and not a normal
API" — no server and no page-scraper can know what the analyst just decided to point at.

```json
{
  "name": "get_selection",
  "description": "Return the entities the analyst currently has selected on the canvas, with their types and ids. Use this before answering any question phrased as 'these', 'this one', or 'the two I've picked'.",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ nodes: [{ id, type, label }] }`.

### `get_viewport`

```json
{
  "name": "get_viewport",
  "description": "Return which node ids are currently within the camera's view and the current zoom distance. Use it to judge what the analyst can actually see before describing the graph to them.",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ visibleNodeIds: string[], cameraDistance: number }`.

### `get_visible_subgraph`

```json
{
  "name": "get_visible_subgraph",
  "description": "Return the nodes and edges currently on the canvas, with types, labels and confirmation state. This is the analyst's working set, not the full corpus.",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ nodes: Entity[], edges: Edge[], proposalCount: number }`.

### `get_entity`

```json
{
  "name": "get_entity",
  "description": "Return the full record for one company, person or address, including every filing it appears in.",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "string", "description": "Entity id, e.g. 'company:09876543'" } },
    "required": ["id"],
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true }
}
```

### `search_documents`

Returns **document ids and matching spans, never prose.** If it returned summaries the agent would
be reading our paraphrase instead of the record, and the citation would be worthless.

```json
{
  "name": "search_documents",
  "description": "Full-text search across the filing corpus. Returns document ids with the character offsets of each match, so results can be cited exactly. Does not search the canvas — use get_visible_subgraph for that.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search terms. Names, company numbers, addresses." },
      "entity_ids": {
        "type": "array", "items": { "type": "string" },
        "description": "Optional. Restrict results to documents mentioning these entities."
      },
      "limit": { "type": "integer", "minimum": 1, "maximum": 25, "default": 10 }
    },
    "required": ["query"],
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ results: [{ doc_id, title, score, spans: [{ start, end, text }] }] }`.

### `query_paths`

Pure traversal of the confirmed canvas graph. No inference — if it returns nothing, that is a real
answer, and it is usually the answer that starts the investigation.

```json
{
  "name": "query_paths",
  "description": "Find existing paths between two entities on the canvas. Traversal only: it will not invent a connection. An empty result means no confirmed path exists yet.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from_id": { "type": "string" },
      "to_id": { "type": "string" },
      "max_hops": { "type": "integer", "minimum": 1, "maximum": 4, "default": 4 }
    },
    "required": ["from_id", "to_id"],
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true }
}
```

## Staged write tools

These call `actions.ts` and write to `proposalStore` only. Nothing here can alter the confirmed
graph. Describe the side effect in the description — that is explicit guidance, and it is also what
makes the browser's confirmation prompt read sensibly to the user.

### `propose_node`

**The page rejects any proposal without a source.** Enforce it in `actions.ts`, not just in the
schema, and return a useful error so the agent retries correctly rather than giving up.

```json
{
  "name": "propose_node",
  "description": "Propose adding an entity to the canvas. Creates a dashed, unconfirmed node that the analyst must accept. Requires a source document and the span within it that supports the claim; proposals without a source are rejected.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "type": { "type": "string", "enum": ["company", "person", "address", "document"] },
      "label": { "type": "string" },
      "entity_id": { "type": "string", "description": "Corpus id if this entity already exists in the corpus." },
      "source_doc_id": { "type": "string" },
      "span": {
        "type": "object",
        "properties": { "start": { "type": "integer" }, "end": { "type": "integer" } },
        "required": ["start", "end"], "additionalProperties": false
      },
      "reason": { "type": "string", "description": "One sentence, shown to the analyst on the proposal card." }
    },
    "required": ["type", "label", "source_doc_id", "span", "reason"],
    "additionalProperties": false
  }
}
```

### `propose_edge`

```json
{
  "name": "propose_edge",
  "description": "Propose a relationship between two entities on the canvas. Draws a dashed thread the analyst must accept. Requires the source document and span that evidences the relationship.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from_id": { "type": "string" },
      "to_id": { "type": "string" },
      "relation": {
        "type": "string",
        "enum": ["director_of", "psc_of", "registered_at", "previously_named", "shares_address_with", "filed"]
      },
      "source_doc_id": { "type": "string" },
      "span": {
        "type": "object",
        "properties": { "start": { "type": "integer" }, "end": { "type": "integer" } },
        "required": ["start", "end"], "additionalProperties": false
      },
      "reason": { "type": "string" }
    },
    "required": ["from_id", "to_id", "relation", "source_doc_id", "span", "reason"],
    "additionalProperties": false
  }
}
```

### `pin_evidence`

```json
{
  "name": "pin_evidence",
  "description": "Attach an additional citation to a node or edge already on the canvas. Use it to corroborate something the analyst has already accepted.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "target_id": { "type": "string" },
      "doc_id": { "type": "string" },
      "span": {
        "type": "object",
        "properties": { "start": { "type": "integer" }, "end": { "type": "integer" } },
        "required": ["start", "end"], "additionalProperties": false
      }
    },
    "required": ["target_id", "doc_id", "span"],
    "additionalProperties": false
  }
}
```

### `annotate`

```json
{
  "name": "annotate",
  "description": "Leave a short note on a node or edge, visible to the analyst in context on the canvas. Use it to record why something looked significant.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "target_id": { "type": "string" },
      "note": { "type": "string", "maxLength": 280 }
    },
    "required": ["target_id", "note"],
    "additionalProperties": false
  }
}
```

### `focus`

The return leg of the loop: the agent moves the analyst's view to what it found.

```json
{
  "name": "focus",
  "description": "Move the analyst's camera to frame these nodes. Use after proposing something so they can see it without hunting for it.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "node_ids": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 12 }
    },
    "required": ["node_ids"],
    "additionalProperties": false
  }
}
```

## Why there is no commit tool

The agent physically cannot promote a proposal. There is no registered tool that does it, and
`actions.ts` exposes promotion only to the panel components.

Say this explicitly in the Devpost description. It is a design principle rather than a missing
feature, it answers the "how do I know the agent isn't hallucinating links about real people"
question before a judge has to ask it, and it satisfies the requirement that consequential actions
get human review.
