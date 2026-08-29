# Threadweaver — build plan

## 1. The product in one paragraph

A 3D force-directed graph canvas holding a small working set of entities (companies, people,
addresses, filings) pulled from a much larger corpus of real Companies House records. The human
supplies intuition and judgement; the agent supplies recall across thousands of records it can read
and the human cannot. The agent never mutates the confirmed graph — it can only *propose*, with a
citation attached to every claim. The human verifies against the source and accepts. Accepted
knowledge becomes part of the graph the next query traverses.

## 2. Why this shape

Three constraints drove every decision below.

**The judging rubric.** Four equally weighted criteria. Creativity is already strong — the concept
carries it. Every remaining point lives in WebMCP Leverage (are the tools doing something only
WebMCP can do?), Execution (is it a coherent product, not a demo?) and Impact (is the case credible
*based on what's demonstrated*?).

**Five days, two people.** Anything that isn't on screen in the video is waste. No backend, no
database, no auth, no accounts, no ingestion pipeline in the running app.

**Trust.** In investigative work a confident wrong link is worse than no link. Any design where the
agent silently writes to the graph is dead on arrival, and a judge will say so. The proposal model
turns the biggest objection into the strongest feature.

### Why 3D, honestly

3D graphs are *worse* than 2D for reading a network — occlusion, depth ambiguity, harder clicking.
That cost is real and we take it deliberately, for two reasons:

1. **The physics is the metaphor, not decoration.** A proposal is attached by a weak spring, so it
   visibly floats unsettled at the edge of the cluster. Accepting it tightens the spring and the
   whole graph contracts and re-settles around the new fact. You *watch knowledge lock in*. That is
   a genuinely better representation of "unconfirmed vs confirmed" than a dashed 2D line, and it is
   the single most memorable thing in the video.
2. **`d3-force-3d` gives it to us nearly free.** We are not hand-rolling a physics engine; we are
   configuring one and animating two parameters.

The readability cost is paid back by keeping all *reading* in flat 2D panels beside the canvas. The
3D layer is spatial and emotional; the 2D layer is evidential. See `docs/UI-3D.md`.

## 3. Features

### P0 — without these there is no submission

| # | Feature | Why it scores |
|---|---|---|
| 1 | 3D force canvas with typed nodes (company / person / address / document) | Execution, Creativity |
| 2 | Manual use: search corpus, add node, draw edge, select, pan/zoom — all without any agent | Execution. Every judge clicks around before they prompt |
| 3 | All 6 read-only WebMCP tools, including the three canvas-state ones | **Leverage.** `get_selection` is the whole argument |
| 4 | 5 staged-write tools; proposals render dashed with weak springs | Leverage, Creativity |
| 5 | Evidence drawer — click a citation, filing opens, span highlighted | **Impact.** This is what makes the claim checkable |
| 6 | Accept / reject, with the accept re-settle animation | Creativity, Execution |
| 7 | Tool call log panel — every WebMCP call visible live, with args and duration | **Leverage.** The judge watches the standard working |
| 8 | Real Companies House corpus, ~300 companies, one verified 4-hop chain | **Impact.** "Based on what's demonstrated" |

### P1 — build if P0 lands on time

- Bloom post-processing on emissive proposal nodes. Highest wow-per-line-of-code in the project.
- `focus()` camera fly-to with easing.
- Directional particles flowing along evidence-backed edges.
- Dim-the-rest mode when a path is highlighted.
- Reject animation: radial impulse, node flies out and dissolves.

### P2 — only if Tuesday finishes early. Assume these do not happen

- Timeline scrubber for filing dates.
- Saving and reloading an investigation.
- Multiple simultaneous investigations.

### Explicitly out of scope — write this in the README so it reads as a decision, not a gap

Entity extraction / NER. A graph database. User accounts. Server-side anything. Editing the corpus
from the UI. Mobile layout.

## 4. Dependencies

| Package | Role | Why this one |
|---|---|---|
| `vite`, `react`, `typescript` | App shell | Fastest path to a deployable static site |
| `react-force-graph-3d` | The canvas | Wraps three.js + `d3-force-3d`. Gives us the simulation, node/link custom objects, camera control and particles out of the box |
| `three` | Custom node meshes, materials, bloom | Peer of the above; we only touch it for materials and the composer |
| `d3-force-3d` | Physics | Comes with the graph lib; we configure link strength and charge directly |
| `zustand` | State | Tiny, no boilerplate, and easy to read from outside React — which the tool layer needs |
| `minisearch` | Corpus full-text | Small, fast, prebuilt index, field boosting. 300 docs is nothing for it |
| — | Path finding | Hand-rolled BFS over an adjacency map, ~40 lines. A graph library is not worth the weight for `max_hops <= 4` |

Deploy to **Vercel** or **Netlify** (both are sponsors; either is a static deploy).

## 5. Schedule

Time is the binding constraint. If a day slips, cut from P1, never from P0.

**Sat 29 — pipeline before product.**
`npm create vite`, deps installed, deployed to Vercel, and **one** registered tool
(`get_page_title` is fine) confirmed visible in ChatGPT browser's Site tools panel. Start the
Companies House Company Data Product download — it is large and you want it running overnight.
Do not build features until a judge's browser can see one tool.

**Sun 30 — corpus and canvas, no agent.**
Run the ingestion scripts. Get the 3D canvas on screen with real nodes, manual search, manual node
add, manual edge draw. Begin hunting the four-hop chain (`scripts/find-chains.ts`).

**Mon 31 — all six read-only tools.**
Canvas-state tools first (`get_selection`, `get_viewport`, `get_visible_subgraph`), then
`get_entity`, `search_documents`, `query_paths`. Ship the ToolLog panel the same day so you can see
calls landing. By tonight the agent can accurately describe what you are looking at — which is
already demoable, so a bad Tuesday cannot leave you with nothing.

**Tue 1 — the proposal layer.** Protect this day.
Staged writes, dashed rendering with weak springs, the evidence drawer, accept/reject, the
re-settle animation. Lock the chain and rehearse the two-turn interaction end to end.

**Wed 2 — code freeze at noon.**
Video and write-up all afternoon and evening. It always takes three times longer than planned and
it is a quarter of what the judges experience.

**Thu 3 — buffer. Submit by lunchtime.** Submissions can be edited after they are in.

## 6. Video script (3 min hard cap, with audio)

1. **0:00–0:20** The problem. A human holds three or four entities in working memory. The corpus has
   thousands. State it plainly over a shot of the canvas.
2. **0:20–0:45** Manual use. Search, drag two nodes together. Establish that this is a real tool
   before any AI appears.
3. **0:45–1:00** Open the Site tools panel in the address bar. Show the eleven tools. *This is the
   WebMCP Leverage evidence — do not skip it.*
4. **1:00–1:40** The ask: "I think these two are connected — find it." ToolLog fires:
   `get_selection` → `search_documents` → `query_paths` → `propose_*`. Dashed nodes bloom into view,
   camera flies to them.
5. **1:40–2:15** Click a citation. The real filing opens with the span highlighted. Say out loud
   that this is a public record, verifiable. Accept — the graph tightens and re-settles.
6. **2:15–2:45** The second turn. Select the node you just confirmed: "now every other director at
   this address." The agent works outward from what the human chose to believe.
7. **2:45–3:00** One sentence: the agent has no commit tool. Only the human promotes a proposal.

## 7. Definition of done

- [ ] Live URL opens cold in ChatGPT's browser, tools visible in Site tools
- [ ] Also loads in Chrome 149+ with the flag on
- [ ] Public repo, MIT `LICENSE` present, README explains how to run it
- [ ] All 11 tools registered, read-only ones marked `readOnlyHint`
- [ ] The four-hop chain is real, checkable, and rehearsed
- [ ] No agent path can mutate the confirmed graph
- [ ] Video under 3:00 with audio, showing the Site tools panel
- [ ] Devpost description uses the four judging criteria as its four headings
- [ ] Commit history starts after 25 Aug and is not three commits
