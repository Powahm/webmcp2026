# Threadweaver — build plan

Read `docs/METHOD.md` first. It is the argument; this is the schedule.

## 1. The product in one paragraph

A document reader and a link canvas, side by side, running the division of labour a major
incident room has used since 1981. **The human reads.** They open filings, select passages, mark
them by type, and raise lines of enquiry off what they have read — work that is useful with no
agent present at all. **The agent indexes.** Over WebMCP it can see the document the analyst has
open, the passage they just highlighted, the marks they have left and the working set on the
canvas, and it cross-references all of that against a corpus of real Companies House records the
human cannot hold in their head. It comes back with structure and a citation, staged as a proposal
the human verifies against the source and accepts. The agent has no commit tool. Accepted knowledge
becomes part of the graph the next query traverses.

## 2. Why this shape

Four constraints drove every decision below.

**The judging rubric.** Four equally weighted criteria: WebMCP Leverage, Execution, Potential
Impact, Creativity & Ambition. Creativity is carried by the concept. The remaining three are won by
whether the tools do something only WebMCP can do, whether this is a coherent product rather than a
demo, and whether the case is credible *based on what's demonstrated*.

**The human has to be doing something.** This is the constraint we added late and it reshaped the
plan. In the first draft the human searched, clicked Accept, and narrated. That is supervision, not
work, and a judge watching a video of someone approving AI output will score it as an AI product
with a human rubber stamp. The Reader loop in §3 exists to fix that, and it is now P0.

**Three days, two people.** Today is Sunday. Code freezes Wednesday at noon. Anything not on screen
in the video is waste. No backend, no database, no auth, no accounts, no ingestion in the running
app.

**Trust.** In investigative work a confident wrong link is worse than no link. Any design where the
agent silently writes to the canvas is dead on arrival and a judge will say so. The proposal model
turns the biggest objection into the strongest feature.

### Why the canvas is 2D

It was 3D. It is not any more, and the reasoning is worth keeping written down so nobody re-adds it.

3D graphs are *worse* than 2D for reading a network — occlusion, depth ambiguity, harder clicking —
and every mitigation for that costs effort buying back something 2D never took away. The camera also
had a failure mode with no 2D equivalent: framing was computed along the vector from the world
origin to the target, which collapses when the target is near the origin — exactly where a freshly
proposed node sits before the simulation places it. The screen went black. And the graph library
pulled its own copy of three.js, putting two builds of it on the page.

**We lost nothing that carried meaning.** The physics metaphor is the reason 3D was chosen and it
works identically flat: a proposal hangs off a weak, long spring, visibly unsettled at the edge of
the cluster; accepting it tightens the spring and the graph contracts and re-settles around the new
fact. You *watch knowledge lock in*, and now you can actually see it happen.

The canvas is a single 2D context over a hand-rolled simulation — **no graph library, no WebGL, no
dependencies** — so the duplicate-package class of bug cannot recur. See `docs/UI.md`.

### Why two workspaces, not one screen

With the Reader added there are six surfaces competing for the window: canvas, reader, evidence,
proposals, inspector, tool log. Crammed together that is a cockpit, and cockpits photograph badly.

Split it. **Read** and **Canvas** are two full-width workspaces with a shared right rail (proposals,
evidence, inspector) and the tool log along the bottom of both. One key toggles. The agent's
`focus` call switches to Canvas; a citation click switches to Read. Both workspaces are always live
— switching is a view change, not a mode change, and no state is lost.

## 3. The human's loop — the part that must exist

This is the new spine of the product. Detail and justification in `docs/METHOD.md` §3.

| Step | What the human does | Where |
|---|---|---|
| 1 | Opens a filing from the working set and reads it | Reader |
| 2 | Selects a passage, marks it typed: person / company / address / date / question / lead | Reader |
| 3 | Raises a line of enquiry from a mark, in their own words | Enquiries panel |
| 4 | Asks the agent to index what they marked, or to take an open enquiry | their agent |
| 5 | Clicks the citation, checks it against the filing, accepts / rejects / eliminates | Evidence + Proposals |
| 6 | Everything above lands in the Decision Log with an actor and a timestamp | Decision Log |

**The deletion test.** Take the agent out of the app. What is left must still be a tool someone
would use: a document reader with typed highlights, a queue of open questions, and a link canvas you
build by hand. If deleting the AI leaves nothing, we built a chatbot with a graph skin. Run this
test on Tuesday night, honestly, before the freeze.

### Markings — the richest state in the app

A marking is `{ id, doc_id, span: {start,end}, type, note?, origin: "human" | "agent", created_at }`.

Durable, listed in the margin, clickable to scroll. The human's are in one colour, the agent's in
another, **in the same document**. Two actors annotating one surface is the entire pitch in a single
screenshot, and it costs one store and one renderer.

The live, uncommitted text selection is carried alongside as a best-effort extra —
see the implementation note in `docs/ARCHITECTURE.md`; getting this wrong is a plausible way to
lose an hour on Monday.

### Lines of enquiry — the human sets the agenda

Straight out of MIRSAP's Actions. `{ id, question, raised_by, from_marking?, status: open |
claimed | resulted | filed, result?, citations[] }`.

The human raises them. The agent can list them and result them. **Only the human marks one filed.**
This is the clearest available answer to "is the AI just doing everything?" — the agent is working
a queue the human wrote.

An enquiry can be resulted **`eliminated`**, with the reason recorded. Clearing a line is an output,
not a failure. See `METHOD.md` §3.

### Decision log — cheap, and it changes what the product is

Append-only, both actors, exportable as text. It is the SIO's policy log and the e-discovery audit
trail, it is maybe forty lines of code on top of stores we already have, and it converts a demo into
something that could survive a disclosure process. Say that in the Devpost description.

## 4. Features

### P0 — without these there is no submission

| # | Feature | Why it scores |
|---|---|---|
| 1 | 2D force canvas, typed nodes, manual search / add / draw / select | Execution. Every judge clicks before they prompt |
| 2 | **Reader: open a filing, read it, select text, mark it typed** | **Execution + Impact.** This is the human's work |
| 3 | **`get_reader_context` + `get_markings`** | **Leverage.** The best WebMCP argument we have — see below |
| 4 | Remaining read tools: `get_selection`, `get_visible_subgraph`, `get_entity`, `search_documents`, `query_paths` | Leverage |
| 5 | Staged writes; proposals render dashed on weak springs | Leverage, Creativity |
| 6 | **`highlight_span` — the agent marks the document the human is reading** | Creativity. Both actors on one surface |
| 7 | Evidence drawer — click a citation, filing opens, span highlighted | **Impact.** This is what makes a claim checkable |
| 8 | Accept / reject, with the accept re-settle animation | Creativity, Execution |
| 9 | **Lines of enquiry: human raises, agent results, human files** | **Impact.** Proof the human directs the work |
| 10 | Decision log, exportable | Impact |
| 11 | Tool call log — every WebMCP call live, with args and duration | **Leverage.** The judge watches the standard working |
| 12 | Real Companies House corpus, ~300 companies, one verified 4-hop chain | **Impact.** "Based on what's demonstrated" |

**Why `get_reader_context` beats `get_selection` as the flagship.** `get_selection` returns which
nodes are selected — defensible, but a determined scraper could read that off the DOM. The passage
an analyst just highlighted inside a client-rendered document, typed, with character offsets into
text that only exists in memory, sitting next to eleven other marks they made in the last ten
minutes — there is no server that has it, no API that exposes it, and no page-scrape that
reconstructs it. It is the page's own state, and handing it to an agent is precisely what WebMCP is
for. Lead the Devpost description with this tool, not with the graph.

### P1 — done

- **Human-side upload.** Drop a `.txt` / `.md` onto the Reader and it joins the working set,
  indexed in the browser, markable, searchable by the agent. **Text only — no PDF, no OCR.**
  PDF.js plus stable character offsets is a different project, and an offset that drifts points
  every mark and every citation at the wrong words.
- **Path highlighting.** Select two nodes and the route between them lights up while everything
  else drops to 12%. When there is no route the canvas says so — *"nothing on this canvas connects
  them — that is a real answer, not a failure"*. That readout is the before/after of the whole
  product in one line of UI.

### P1 — still open

- Reader queue grouped by company (91 filings is a long flat list).

### P2 — assume these do not happen

Timeline scrubber. Saving and reloading an investigation. Multiple investigations. A real TIE pool
with elimination criteria per subject (the concept is in `METHOD.md`; only the `eliminated` result
ships).

### Explicitly out of scope — say so in the README, so it reads as a decision

Entity extraction / NER. A graph database. User accounts. Server-side anything. PDF ingestion in
the browser. Editing the corpus from the UI. Mobile layout.

## 5. Dependencies

| Package | Role | Why this one |
|---|---|---|
| `vite`, `react`, `typescript` | App shell | Fastest path to a deployable static site |
| — | The canvas | Hand-rolled: 2D context, ~250 lines of forces, ~200 of drawing. A graph library is what put two copies of three.js on the page |
| `zustand` | State | Tiny, and easy to read from outside React — which the tool layer needs |
| `minisearch` | Corpus full-text | Prebuilt index, field boosting, and `addAll` at runtime for P1 upload |
| — | Path finding | Hand-rolled BFS, ~40 lines. Not worth a library for `max_hops <= 4` |
| — | Text selection | `document.getSelection()` plus a `selectionchange` listener. No library |

Deploy to **Vercel** or **Netlify** — both sponsors, both a static deploy.

## 6. Schedule

Three days left. If a day slips, cut from P1, never from P0. The two riskiest items are the Reader
(Sunday–Monday) and the proposal layer (Tuesday); do not let either slide into Wednesday.

**Sun 30 — corpus, canvas, and the reading surface.**
Run the ingestion scripts. Chart on screen with real nodes, manual search, manual add, manual edge
draw. **Then get the Reader rendering a filing from the corpus with the document queue beside it.**
Reading is on the critical path now, so it starts today, not Tuesday. Begin hunting the four-hop
chain (`scripts/find-chains.ts`) in the background.

**Mon 31 — markings, and every read tool.**
Selection → typed marking → margin list → click to scroll. Then the read tools, canvas-state ones
first, and `get_reader_context` / `get_markings` before any of the corpus ones. Ship the ToolLog the
same day so you can watch calls land. By tonight the agent can describe both what the analyst is
looking at *and* what they marked — which is already demoable, so a bad Tuesday cannot leave you
with nothing.

**Tue 1 — the proposal layer, enquiries, and the log. Protect this day.**
Staged writes, dashed rendering with weak springs, `highlight_span` into the Reader, accept/reject
with the re-settle animation. Then lines of enquiry and the decision log — both are small, and both
are load-bearing for the argument. Lock the chain. Run the deletion test. Rehearse the full
interaction end to end, in ChatGPT's browser, twice.

**Wed 2 — code freeze at noon.**
Video and write-up all afternoon and evening. It always takes three times longer than planned and
it is a quarter of what the judges experience.

**Thu 3 — buffer. Submit by lunchtime.** Submissions can be edited after they are in.

## 7. Video script (3 min hard cap, with audio)

The old cut opened with the agent. This one opens with the human working, because that is the
thing we are claiming and the thing every other entry will not have.

1. **0:00–0:20 — the problem, with a real one.** Forty tons of paper in the Ripper incident room;
   nine interviews with the same man; nobody could see it. The link was in the documents. Say it
   over a shot of the Reader with a filing open.
2. **0:20–0:50 — the human works. No AI on screen.** Open a filing, read, highlight a
   correspondence address, mark it `address`. Highlight a signatory, mark it `person`. Raise a line
   of enquiry in your own words: *"who else has used this address?"* Establish that this is a real
   tool before any agent appears. **Do not rush this beat — it is the whole differentiator.**
3. **0:50–1:05 — open the Site tools panel.** Show the tools. This is the WebMCP Leverage
   evidence; do not skip it.
4. **1:05–1:45 — delegate.** *"Take the enquiry I just raised."* ToolLog fires:
   `list_enquiries` → `get_markings` → `search_documents` → `query_paths` → `propose_*` →
   `highlight_span`. A second colour of highlight appears in the document *you are still reading*.
   Dashed nodes appear on the canvas; the view eases across to frame them.
5. **1:45–2:15 — verify.** Click the citation. The real filing opens, span highlighted. Say out
   loud that this is a public record and anyone can check it. Accept — the graph tightens and
   re-settles.
6. **2:15–2:40 — the compounding turn, and a negative result.** Select the node you just confirmed:
   *"now every other director at this address."* The agent works outward from what the human chose
   to believe. Show one enquiry resulted **eliminated** — nothing in the corpus connects them —
   and say that clearing a line is an output, not a failure.
7. **2:40–3:00 — the close.** Open the Decision Log: every mark, every enquiry, every acceptance,
   who did it and when. One sentence: the agent has no commit tool. Only the human promotes a
   proposal.

## 8. Devpost description

Four headings, one per criterion. Open on `get_reader_context`, not on the graph.

- **WebMCP Leverage** — the tools read state that exists nowhere but the live page: the open
  document, the live selection, the human's typed markings, the working set. Nineteen narrow
  tools, no god-tools, read-only ones annotated. No server: the page *is* the API.
- **Potential Impact** — the Byford framing, real Companies House records, a chain a judge can
  verify on the Companies House website during judging, the citation-per-claim rule, the decision
  log, and structure-never-accusation.
- **Execution** — one mutation API shared by human clicks and agent tool calls; two workspaces;
  it works as a normal web app with no agent present.
- **Creativity & Ambition** — the incident-room division of labour, both actors highlighting the
  same document, and the accept animation.

## 9. Risks we know about

Written down because the expensive failures on a five-day build are the ones nobody named on day
two.

**The agent never calls the reader tools.** The biggest one, and it is not a code risk — it is a
tool-description risk. If `get_reader_context` reads like a debugging accessor, the model will
answer from the conversation and never call it, and the demo dies in front of a judge. Defences:
phrase every reader-tool description around the words the analyst will actually say ("this bit",
"what I just highlighted"), have `search_documents` and `query_paths` descriptions point back at
the reader tools, and **rehearse the exact prompts** in ChatGPT's browser on Tuesday, not
Wednesday. If a prompt reliably fails, that is a description bug, and it is fixable in a line.

**Six panels and a canvas is too much screen.** Mitigated by the two workspaces, but only if
that split is built early. If you find yourself shrinking panels to fit on Wednesday morning, the
answer is to cut a panel, not to shrink them all.

**The offsets break.** Two named failure modes and both fixes are in `docs/ARCHITECTURE.md`. Write
a test that round-trips a marking through the store and back to the rendered string on Monday, when
it costs ten minutes, rather than debugging it Tuesday night when it costs the demo.

**The corpus is unreadable.** The whole Reader premise collapses if the filings render as a wall of
field:value. See the amendment in `docs/DATA.md` — check the demo filings by actually reading one,
today, before building anything on top of them.

**Scope.** This plan adds a document reader, a marking system, an enquiry queue, a decision log and
seven tools, in three days, on top of a proposal layer that was already the riskiest thing in the
project. That is real. The mitigations are the P0/P1 marks on every tool in `docs/TOOLS.md` and one
rule: **if Tuesday evening arrives and the Reader loop is not demoable end to end, cut the enquiry
queue and the decision log entirely and ship the reader, the markings and `get_reader_context`.**
Those three are the argument. Everything else is reinforcement.

**Commit history.** The rules require work built inside the submission window, and the history is
the proof. There are currently two commits for the whole project, one of them called `test`. That
is a bad look on a judged repo regardless of when the code was written — commit per logical chunk
from here.

## 10. Definition of done

- [ ] Live URL opens cold in ChatGPT's browser, tools visible in Site tools
- [ ] Also loads in Chrome 149+ with the flag on
- [ ] Public repo, MIT `LICENSE`, README explains how to run it
- [ ] All tools registered, read-only ones marked `readOnlyHint`
- [ ] **The deletion test passes: remove the agent and a usable tool remains**
- [ ] **The human's first two minutes of the video contain no AI**
- [ ] The four-hop chain is real, checkable, and rehearsed
- [ ] At least one enquiry resulted `eliminated` in the demo
- [ ] No agent path can mutate the confirmed graph
- [ ] Decision log exports and reads sensibly
- [ ] Video under 3:00 with audio, showing the Site tools panel
- [ ] Devpost description uses the four judging criteria as its four headings
- [ ] Commit history starts after 25 Aug and is not three commits
