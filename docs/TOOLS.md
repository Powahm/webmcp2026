# WebMCP tool contracts

Nineteen tools. Ten read-only, nine writes, **no commit tool**.

(Nine of the read-only ones are documented below; the tenth is `get_page_title`, the connectivity
smoke test that proved registration reached ChatGPT's browser before any feature existed. It stays
because it is the fastest way for anyone to confirm site tools are working.)

Depth is itself a judging signal: nineteen narrow, well-described tools score better than four broad
ones, and broad "do the thinking for me" tools are the documented anti-pattern.

Each tool below is marked **P0** (ships or we do not submit) or **P1** (cut first). If Tuesday goes
badly, cut every P1 before touching a P0. The tool count is a scoring signal but a broken flagship
is not.

## Read this first

The three tools that carry the WebMCP argument are `get_reader_context`, `get_markings` and
`get_selection`, in that order. They return state that exists nowhere but the live page: the
document the analyst has open, the passage they just highlighted, the marks they left in the last
ten minutes, the nodes they chose to point at. No server has it. No API exposes it. No page-scrape
reconstructs it, the reader's text is client-rendered from memory and the offsets are into a string
that never travelled over the wire.

Lead the write-up with `get_reader_context`. See `docs/METHOD.md` for why the *human* holds the
Reader's chair in the first place.

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

All nine carry `annotations: { readOnlyHint: true }` so the browser doesn't gate them behind a
confirmation prompt. They read the stores and the corpus directly and never call `actions.ts`.

### `get_reader_context`, P0, the flagship

What the analyst is reading right now, and what they just highlighted. Everything in `METHOD.md`
comes down to this tool: the human is the Document Reader, and this is how the agent takes
instruction from them.

```json
{
  "name": "get_reader_context",
  "description": "Return the filing the analyst currently has open in the reader, the passage they have selected right now if any, and where they are scrolled to. Use this before answering anything phrased as 'this bit', 'what I just highlighted', or 'this passage'.",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "annotations": { "readOnlyHint": true }
}
```
Returns:
```ts
{
  doc_id: string | null,
  title: string | null,
  // The live, uncommitted selection. Best-effort, see the note below.
  selection: { start: number, end: number, text: string } | null,
  // Roughly what is on screen, so the agent doesn't describe text they can't see.
  visible_span: { start: number, end: number } | null,
  marking_count: number
}
```

**Implementation note that will cost you an hour if you miss it.** Do not call
`document.getSelection()` inside `execute`. By the time the agent invokes the tool the analyst has
been typing in a different surface and the selection is collapsed or gone. Subscribe to
`selectionchange` on the document, keep the last non-empty selection that falls inside the reader in
`readerStore`, and have the tool read *that*. Clear it only when the analyst opens a different
filing.

Return `selection: null` honestly when there isn't one. An agent that gets a stale span will cite
the wrong words, and a wrong citation is worse here than no citation.

### `get_markings`, P0

The durable half of the same idea: everything the analyst has deliberately marked, typed.

```json
{
  "name": "get_markings",
  "description": "Return the passages the analyst has marked in the filings they have read, each with its document, character span, the marked text, its type and any note. This is what the analyst decided was worth noticing.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "doc_id": { "type": "string", "description": "Optional. Restrict to one filing." },
      "type": {
        "type": "string",
        "enum": ["person", "company", "address", "date", "question", "lead"],
        "description": "Optional. Restrict to one kind of mark."
      },
      "origin": {
        "type": "string", "enum": ["human", "agent"],
        "description": "Optional. Default is both. Use 'human' to see only what the analyst marked."
      }
    },
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ markings: [{ id, doc_id, span, text, type, note?, origin, created_at }] }`.

Include `text`, the substring itself, even though the agent could derive it from the span. It
halves the round trips and it makes the tool log readable on video.

### `list_enquiries`, P0

The queue the human wrote. An agent that reads this is taking instruction, not initiative, and that
is the point.

```json
{
  "name": "list_enquiries",
  "description": "Return the open lines of enquiry the analyst has raised, with the question in their own words, what it was raised from, and its status. Prefer working an open enquiry over inventing your own line of investigation.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": ["open", "claimed", "resulted", "filed", "eliminated"],
        "description": "Optional. Default returns open and claimed."
      }
    },
    "additionalProperties": false
  },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ enquiries: [{ id, question, status, raised_by, from_marking_id?, created_at }] }`.

### `get_selection`, P0

The canvas-side twin of `get_reader_context`. No server and no page-scraper knows what the analyst
just decided to point at. It is what makes "find the link between these two" mean anything.

```json
{
  "name": "get_selection",
  "description": "Return the entities the analyst currently has selected on the canvas, with their types and ids. Use this before answering any question phrased as 'these', 'this one', or 'the two I've picked'.",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ nodes: [{ id, type, label }] }`.

### `get_viewport`, P1

```json
{
  "name": "get_viewport",
  "description": "Return which node ids are currently visible in the canvas viewport, and the current zoom level. Use it to judge what the analyst can actually see before describing the graph to them.",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ visibleNodeIds: string[], zoom: number, offscreenCount: number }`.

### `get_visible_subgraph`, P0

```json
{
  "name": "get_visible_subgraph",
  "description": "Return the nodes and edges currently on the canvas, with types, labels and confirmation state. This is the analyst's working set, not the full corpus.",
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
  "annotations": { "readOnlyHint": true }
}
```
Returns `{ nodes: Entity[], edges: Edge[], proposalCount: number }`.

### `get_entity`, P0

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

### `search_documents`, P0

Returns **document ids and matching spans, never prose.** If it returned summaries the agent would
be reading our paraphrase instead of the record, and the citation would be worthless.

```json
{
  "name": "search_documents",
  "description": "Full-text search across the filing corpus. Returns document ids with the character offsets of each match, so results can be cited exactly. Does not search the canvas. Use get_visible_subgraph for that.",
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

### `query_paths`, P0

Pure traversal of the confirmed canvas graph. No inference. If it returns nothing, that is a real
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

These call `actions.ts`. Nothing here can alter the confirmed graph. They fall into three kinds,
and the distinction is worth keeping straight in your head while building:

- **Staged claims**, `propose_node`, `propose_edge`, `pin_evidence`, `propose_enquiry`. Land in
  `proposalStore` as dashed, unconfirmed, awaiting a human gesture. These assert something.
- **Pointing**, `highlight_span`, `open_document`, `focus`, `annotate`. They change what the human
  is looking at, and assert nothing. No acceptance needed; all of them are trivially reversible by
  the analyst, and all are visibly attributed to the agent.
- **Reporting**, `result_enquiry`. Answers a question the human asked. The human files it.

Describe the side effect in the description. That is explicit guidance, and it is also what makes
the browser's confirmation prompt read sensibly to the user.

### `propose_node`, P0

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

### `propose_edge`, P0

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

### `pin_evidence`, P1

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

### `annotate`, P1

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

### `focus`, P0

The return leg of the loop: the agent moves the analyst's view to what it found.

```json
{
  "name": "focus",
  "description": "Move the analyst's view on the canvas to frame these nodes. Use after proposing something so they can see it without hunting for it.",
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

### `highlight_span`, P0

The agent marks a passage *in the document the analyst is currently reading*, in the agent's own
colour, alongside their marks. Two actors annotating one surface, live. It is the single best
screenshot in the project and it is one store write.

It is a staged write, not a read: it changes what the human sees. It does not need accepting, a
highlight asserts nothing, it only points. But it is listed in the margin as the agent's and the
analyst can clear it.

```json
{
  "name": "highlight_span",
  "description": "Mark a passage in a filing so the analyst sees it in the reader, shown as the agent's mark rather than theirs. Use it to point at the exact words that support what you are about to propose. Does not add anything to the canvas.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "doc_id": { "type": "string" },
      "span": {
        "type": "object",
        "properties": { "start": { "type": "integer" }, "end": { "type": "integer" } },
        "required": ["start", "end"], "additionalProperties": false
      },
      "type": {
        "type": "string",
        "enum": ["person", "company", "address", "date", "question", "lead"]
      },
      "note": { "type": "string", "maxLength": 200, "description": "One line, shown in the margin." }
    },
    "required": ["doc_id", "span", "type"],
    "additionalProperties": false
  }
}
```

Validate the span against the document length in `actions.ts` and fail with a hint. An out-of-range
span from the agent must not render as a silently empty `<mark>`.

### `open_document`, P0

The reading-side twin of `focus`. The agent brings a filing up in the analyst's reader, scrolled to
the right place. Cheap, and it makes the loop feel like two people working rather than a request and
a response.

```json
{
  "name": "open_document",
  "description": "Open a filing in the analyst's reader and scroll it to a passage. Use after finding something so they can read it in place rather than hunting for it.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "doc_id": { "type": "string" },
      "scroll_to": {
        "type": "object",
        "properties": { "start": { "type": "integer" }, "end": { "type": "integer" } },
        "required": ["start", "end"], "additionalProperties": false
      }
    },
    "required": ["doc_id"],
    "additionalProperties": false
  }
}
```

### `result_enquiry`, P0

The agent reports back on a line of enquiry the human raised. **Reporting nothing is a valid
result**, say so in the description, or the agent will keep searching rather than admit an empty
answer, which is the exact failure mode the whole design is built against.

The human marks it filed. The agent cannot.

```json
{
  "name": "result_enquiry",
  "description": "Report back on a line of enquiry the analyst raised. Finding nothing is a valid and useful result. Report 'eliminated' with what you searched, rather than stretching for a weak link. The analyst reviews every result; you cannot close an enquiry yourself.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "enquiry_id": { "type": "string" },
      "outcome": {
        "type": "string",
        "enum": ["found", "eliminated", "partial"],
        "description": "'eliminated' means you searched and there is nothing to find. Say what you searched in 'summary'."
      },
      "summary": { "type": "string", "maxLength": 400, "description": "What you did and what you found, in plain words. Structural facts only. Never a conclusion about a person." },
      "citations": {
        "type": "array",
        "maxItems": 8,
        "items": {
          "type": "object",
          "properties": {
            "doc_id": { "type": "string" },
            "span": {
              "type": "object",
              "properties": { "start": { "type": "integer" }, "end": { "type": "integer" } },
              "required": ["start", "end"], "additionalProperties": false
            }
          },
          "required": ["doc_id", "span"], "additionalProperties": false
        }
      }
    },
    "required": ["enquiry_id", "outcome", "summary"],
    "additionalProperties": false
  }
}
```

`outcome: "found"` requires at least one citation. Enforce it in `actions.ts` and return a hint, the
same as proposals.

### `claim_enquiry`, P0

Takes a line of enquiry off the analyst's queue so they can see it is being worked. Reversible,
asserts nothing, and it is what makes the Enquiries panel show movement while the agent is thinking.

```json
{
  "name": "claim_enquiry",
  "description": "Take a line of enquiry off the analyst's queue so they can see you are working it. Call list_enquiries first. Claiming is reversible and asserts nothing.",
  "inputSchema": {
    "type": "object",
    "properties": { "enquiry_id": { "type": "string", "description": "Id from list_enquiries." } },
    "required": ["enquiry_id"],
    "additionalProperties": false
  }
}
```

### `propose_enquiry`, P1, not built

The agent suggests a line of enquiry; it lands in the panel greyed, and the human raises it for
real or discards it. Nice symmetry, genuinely cuttable. The human writing the questions is the
point, and this is the tool that dilutes it. Build it last, if at all.

```json
{
  "name": "propose_enquiry",
  "description": "Suggest a line of enquiry for the analyst to consider. It is not opened until they accept it. Use sparingly. The analyst decides what is worth chasing.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "question": { "type": "string", "maxLength": 200 },
      "why": { "type": "string", "maxLength": 200 },
      "from_marking_id": { "type": "string", "description": "Optional. The analyst's mark that prompted it." }
    },
    "required": ["question", "why"],
    "additionalProperties": false
  }
}
```

## Why there is no commit tool

The agent physically cannot promote a proposal. There is no registered tool that does it, and
`actions.ts` exposes promotion only to the panel components.

Five things stay on the human's side of the line, and none of them has a tool:

| The human alone can | Because |
|---|---|
| Promote a proposal to the confirmed graph | A wrong link is worse than no link |
| File a line of enquiry | Closing a question is a judgement about sufficiency |
| Raise a line of enquiry (`propose_enquiry` only suggests) | The human sets the agenda |
| Delete their own markings | They are the Reader's record of what they noticed |
| Add a document to the working set | What enters the record is the Receiver's judgement, and an agent that could add its own material could shape what the analyst reads |

`scripts/check-no-commit-tool.ts` asserts all of them, not just the first, and it should run in
CI. A guarantee you can execute is worth more in a write-up than a guarantee you assert.

Say this explicitly in the Devpost description. It is a design principle rather than a missing
feature, it answers the "how do I know the agent isn't hallucinating links about real people"
question before a judge has to ask it, and it satisfies the requirement that consequential actions
get human review.

It is also the structural defence against automation bias, see `docs/METHOD.md` §4. Nothing here
relies on the analyst being disciplined; the product is shaped so that not checking is not an
option.
