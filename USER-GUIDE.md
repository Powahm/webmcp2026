# Threadweaver — the user guide

**For investigative journalists, OSINT researchers, fraud analysts and anyone who has to
find the one connection buried in a stack of filings.**

This guide is about using the app. It is not about how it is built. If you want the
engineering, start at [`README.md`](README.md) and [`docs/`](docs/).

---

## 1. What this is, in one paragraph

Threadweaver is a **document reader** and a **link chart**, side by side, plus an AI agent
that can see both. You read filings and mark what matters. You write down the questions you
want answered. The agent reads the corpus you cannot hold in your head, comes back with
**proposals** — dashed nodes and dashed threads, each carrying a citation — and you check
the citation against the source and accept or reject it. **The agent cannot add anything to
your chart.** Only you can.

Take the agent away and you still have a document reader with typed highlights, a queue of
open questions, and a link chart you build by hand. That is deliberate.

## 2. Who it is for, and the problem it solves

You have three hundred company filings. Somewhere in them, Company A and Company E are
connected through three intermediaries none of whom appear in either filing. You can hold
three or four entities in your head at once; the connection is four hops long. A search box
cannot help you, because you do not know what to search for — you do not know the names of
the people in the middle.

That is the shape of problem this is built for. The historical case behind the design is the
Yorkshire Ripper inquiry: forty tons of paper, the suspect interviewed nine times, and no
system that could put the nine interviews next to each other. The answer the police arrived
at — HOLMES, and the incident-room roles around it — is a **division of labour**: one person
reads and judges, another indexes and cross-references. Threadweaver gives you the reading
chair and gives the agent the index.

## 3. The two rules that shape everything

**1. Structure, never accusation.** The app will tell you "these two companies share a
registered address and a person with significant control, here are the filings." It will not
tell you that someone is running a fraud. Every entity and relationship comes from a
structured field in a real public filing — nothing is inferred from prose, so nothing is
invented. The conclusion is yours to draw and yours to defend.

**2. Nothing enters your chart without you.** The agent has no way to commit. It stages
proposals; you promote them. This is enforced in the code twice over, and it is why the
decision log at the end of a session is a document you could hand to a lawyer.

---

## 4. The screen

There are **two workspaces**. Press <kbd>W</kbd> — or click **Read** / **Canvas** in the
top bar — to switch. Both stay alive: switching loses no scroll position, no selection, no
layout. The app opens on **Read**, because you read first.

### The READ workspace

```
┌──────────┬────────────────────────────┬──────────────┐
│ FILINGS  │  THE FILING                │  ▸ panels    │
│  queue   │  (select text → mark it)   │              │
│          │                            │  Proposals   │
│          │                            │  Enquiries   │
│          │                            │  Evidence    │
│          │                            │  Details     │
│          ├────────────────────────────┤  Decisions   │
│          │  mark bar   1 2 3 4 5 6    │              │
├──────────┴────────────────────────────┴──────────────┤
│  WebMCP calls — every agent tool call, live          │
└──────────────────────────────────────────────────────┘
```

- **Filings (left).** Every document in the working set, grouped by the company it belongs
  to. Your own uploads sit in their own group at the top. There is a filter box.
- **The filing (centre).** The record, rendered exactly as it was ingested — no reflowing,
  no smart quotes, no tidying. That matters: every citation in the app is a pair of
  character offsets into this exact string, so if the text were reformatted every citation
  would point at the wrong words.
- **Marks (right of the filing).** A list of every passage marked in this filing, yours and
  the agent's. Click one to scroll to it. Fold the column away with the **Marks** button in
  the filing header when you want the full width.
- **The mark bar (bottom).** Appears armed as soon as you select text.

### The CANVAS workspace

```
┌──────────┬────────────────────────────┬──────────────┐
│ CORPUS   │   LINK CHART               │  ▸ panels    │
│ search   │   pan · zoom · drag        │              │
└──────────┴────────────────────────────┴──────────────┘
```

- **Corpus search (left).** Full-text search over every filing. Add any entity it finds to
  the chart.
- **The chart (centre).** Entities as discs, relationships as threads. It lays itself out
  with a physics simulation and frames itself automatically until the first time you pan or
  zoom — after that it leaves your view alone.

### The shared right rail

Five tabs, always available in both workspaces. Badges tell you when something has arrived.

| Tab | What it holds |
|---|---|
| **Proposals** | What the agent is asserting, waiting on you. Accept or reject. |
| **Enquiries** | The questions you have raised, and the agent's results |
| **Evidence** | The citation you last clicked, shown against the claim it supports |
| **Details** | The selected entity: its attributes, its citations, what it connects to, and what the corpus knows about it that is not on your chart yet |
| **Decisions** | The audit trail. Every mark, question, acceptance and rejection, with actor and time. Exportable. |

### The tool log (bottom strip)

Every WebMCP call the agent makes, live, with arguments and duration. It is not a debug
panel — it is how you see what the agent actually looked at before it told you something.

---

## 5. The workflow

### Step 1 — Read

Pick a filing from the queue on the left. Read it. This part is not automated and is not
meant to be.

### Step 2 — Mark what matters

Drag across a passage. The mark bar arms. Press a number, or click the button:

| Key | Type | Use it for |
|---|---|---|
| <kbd>1</kbd> | **person** | A named individual — a director, a person with significant control, a signatory |
| <kbd>2</kbd> | **company** | A company name or number |
| <kbd>3</kbd> | **address** | A registered office or correspondence address |
| <kbd>4</kbd> | **date** | An incorporation, appointment, resignation or filing date |
| <kbd>5</kbd> | **question** | Something that does not add up and you want to come back to |
| <kbd>6</kbd> | **lead** | Something worth chasing |

Marks are durable. They appear in the margin, they are colour-washed in the text, and — this
is the important part — **the agent can read them**. Marking is how you tell the agent what
you think is significant without typing an essay into a chat box.

Your marks wash the text in the type's colour. The agent's marks only underline it, in teal.
When you have both marked the same words, you see both. Teal means "the agent did this" and
appears nowhere else in the application.

### Step 3 — Raise a line of enquiry

In the margin, under any mark you made, click **raise a line of enquiry** and write the
question in your own words: *"who else has used this address?"*, *"does this person control
anything else?"*, *"is there any link between these two companies at all?"*

This is the queue the agent works. It is not a chat prompt — it is an open item with a
status, and it stays open until **you** file it. The agent can claim it and result it. It
cannot close it.

You can also raise an enquiry from scratch in the **Enquiries** tab, without a mark behind it.

### Step 4 — Hand it to the agent

Open the page in an agent-capable browser (see §8) and ask in plain language:

> *"Take the enquiry I just raised."*
>
> *"What have I marked in this filing, and does any of it appear anywhere else in the corpus?"*
>
> *"Find the link between the two companies I have selected."*
>
> *"This passage I just highlighted — who else is connected to it?"*

Watch the tool log. You will see the agent read your enquiries, read your marks, search the
corpus, try to walk a path across your chart, and then start proposing.

### Step 5 — Verify

Proposals arrive as **dashed, hollow nodes** on a long weak spring — they sit visibly
further out than everything you have confirmed, because they are not yet part of what you
believe. Each carries a citation.

**Click the citation.** The filing opens in the reader with the exact span highlighted, and
the Evidence tab tells you what that passage is being offered as evidence *for*. Read the
words. If the agent has stretched, you will see it immediately.

The agent will often also drop its own highlight into the filing you are reading, pointing at
the exact words it is relying on. Two people annotating one document.

### Step 6 — Accept, reject, or eliminate

**Accept** and the node goes solid, the thread becomes part of your chart, and the next
question the agent asks of the graph will traverse it. **Reject** and it disappears.

An enquiry can also come back **eliminated** — the agent searched and there is nothing there.
That is a result, not a failure. Clearing a line of enquiry is one of the most useful things
an investigation can do, and the app is built to record it as an output.

When you are done with a question, **file it**. Only you can.

### Step 7 — Compound

Select the node you just confirmed and ask the next question about it. The agent reads your
selection — the thing you *just chose to believe* — and works outward from there. That is
the loop: each accepted fact becomes the ground the next question stands on.

### Step 8 — Export the log

The **Decisions** tab exports a plain-text audit trail: every mark, every question, every
acceptance and rejection, who did it and when. Keep it with the story.

---

## 6. Everything you can do without the agent

Worth knowing, because it is most of the app.

**In the reader**

- Open any filing from the queue; filter the queue by name
- **Upload your own documents.** Drop a `.txt` or `.md` file onto the queue. It joins the
  working set, is indexed in your browser, and becomes markable and searchable — including by
  the agent. Text only: no PDF, no OCR. (Nothing leaves your browser; there is no server.)
- Select and mark passages, six types, keyboard or mouse
- Jump to any mark from the margin
- Fold the margin away for full-width reading
- Raise a line of enquiry from a mark, or from nothing
- File an enquiry, with or without a result

**On the canvas**

- Search the corpus and add any entity to the chart
- Click a node to select it; click a second to select both
- **Select two nodes and the route between them lights up.** If there is no route, the canvas
  says so out loud — *"nothing on this canvas connects them — that is a real answer, not a
  failure."* That readout is worth taking seriously; it is the honest starting state of most
  investigations.
- Draw a thread by hand: select two nodes, pick a relationship in **Details**, click **Draw
  thread**. If a filing already evidences it, the citation comes along automatically. If not,
  the thread is drawn in a warm colour and marked as *your assertion, not the record's* — an
  uncited edge must never look like a cited one.
- Expand from any node: **Details** lists what the corpus knows about it that is not on your
  chart yet, and one click brings any of it across
- Remove a node
- Read the whole chart's citations: every confirmed object lists its filings

**Everywhere**

- Change the glyph used for each entity type in Settings (the gear, top right). Remembered
  per browser.
- Export the decision log

## 7. Keyboard

| Key | Does |
|---|---|
| <kbd>W</kbd> | Switch between Read and Canvas |
| <kbd>1</kbd>–<kbd>6</kbd> | Mark the selected passage (in the reader) |
| <kbd>F</kbd> | Frame the selection on the canvas, or everything if nothing is selected |
| <kbd>Esc</kbd> | Clear the canvas selection |
| Scroll | Zoom the canvas |
| Drag a node | Move it. Releasing hands it back to the physics rather than pinning it |

## 8. Where to run it

The reading, marking, enquiry and charting half works in any modern browser.

The agent half needs a browser that speaks **WebMCP**, because that is how the agent sees the
page at all:

- **ChatGPT's browser** — the tools appear in the **Site tools** panel in the address bar
- **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled

The Claude desktop app is not a WebMCP host and will not see the tools.

There is no sign-in, no server and no persistence. Close the tab and the session is gone —
export the decision log before you do.

---

## 9. Worked examples

### A. "These two companies must be connected. Prove it or clear it."

You have two companies on the canvas that you believe are linked, with nothing between them.

1. Click both. The canvas tells you: **no path yet**.
2. Open the filing for the first one, read the persons-with-significant-control register,
   select the name of the controlling person and press <kbd>1</kbd>.
3. Under that mark: *raise a line of enquiry* — "what else does this person control?"
4. Ask the agent to take the enquiry.
5. It reads your enquiry and your marks, searches the corpus for that name, and proposes the
   second company that person controls, then the next person on that company's register, and
   so on — each proposal a dashed node with a citation.
6. Click each citation. The filing opens with the name highlighted. You are reading the
   public record, not a summary of it.
7. Accept the hops that hold up. When the chain closes, select the two original companies
   again: the canvas now says **4 hops**, and the route lights up.
8. Export the decision log. It shows every hop, its filing, and the moment you accepted it.

### B. "Who else uses this address?"

Corporate service addresses are shared by hundreds of companies, and most of that is
meaningless. What is not meaningless is a residential address used by six companies that also
share a director.

1. In a filing, select the registered office line, press <kbd>3</kbd>.
2. Raise: "which other companies are registered at this address, and do any of them share a
   person?"
3. The agent proposes the companies with citations. Accept the ones that check out.
4. Hover the address node: everything unrelated dims and you can see the cluster shape.
5. Look at **Details** on the address — the corpus almost certainly knows more companies
   there than you have brought across. Add the ones you want.

### C. Clearing a line — the result that saves you a week

1. Raise: "is there any connection between this director and the parent company?"
2. The agent searches and comes back **eliminated**, with a summary of what it searched.
3. You read the summary, decide it is thorough enough, and **file** the enquiry.
4. That is now in the log with a timestamp. When an editor asks whether you checked, the
   answer is a document, not a memory.

### D. Bringing your own material

1. Drop a `.txt` of your interview notes onto the filings queue.
2. Mark the names in it exactly as you would mark a filing.
3. Ask the agent whether any name in your notes appears anywhere in the corpus.
4. Anything it finds arrives as a proposal with a citation into a public filing — so a name
   from a private note becomes a claim you can evidence publicly.

## 10. Reading the chart

**Nodes**

| Look | Means |
|---|---|
| Solid disc | Confirmed — you accepted it, or you added it yourself |
| Hollow, dashed teal ring, gently breathing | **Proposed.** Not part of your chart yet |
| Ring outside the disc | Selected |
| Faded to near-invisible | Not the node you are hovering, and not one of its neighbours |
| Bigger | More connections. A hub looks like a hub |

**Threads**

| Look | Means |
|---|---|
| Thin solid line | Confirmed, one citation |
| Thicker, lighter | Corroborated — more than one filing says so |
| Dashed teal, crawling | Proposed |
| Warm coloured | **You asserted this and no filing was found for it** |

The physics is not decoration. A proposal hangs on a long weak spring, so it drifts at the
edge of the cluster; a confirmed fact is held on a short strong one. When you accept
something, the spring tightens and the chart contracts around the new fact.

## 11. What it deliberately does not do

These are decisions, not gaps.

- **No entity extraction from prose.** Everything comes from a structured field in a real
  filing. If it cannot be pointed at, it does not exist.
- **No graph database, no server, no accounts.** The page is the whole application, and the
  agent can never reach data you cannot also see.
- **No saving.** One session, one investigation. Export the log.
- **No PDF or OCR upload.** Plain text and Markdown only — a drifting character offset would
  point every mark and every citation at the wrong words, and that is worse than no upload.
- **No editing the records.** The filings are the filings.
- **No mobile layout.** This is a desktop tool.
- **No accusations.** See §3.

---

## 12. The WebMCP tools

These are what an agent sees when it opens the page. Nineteen tools: ten that read, nine that
stage or point, and **none that commits**. You never call these yourself — they are listed so
you know exactly what an agent can and cannot do on your screen.

### Read-only — no confirmation prompt, nothing changes

| Tool | What it reads |
|---|---|
| `get_reader_context` | The filing you have open, the passage you have selected right now, roughly where you are scrolled to, and how many marks are in the document |
| `get_markings` | Every passage you have marked, with its document, character span, the text itself, its type, any note, and whether you or the agent made it. Filterable by document, type or origin |
| `list_enquiries` | The lines of enquiry you have raised, in your words, with status |
| `get_selection` | The entities you currently have selected on the canvas |
| `get_viewport` | Which nodes are actually on screen, the zoom level, and how many are off screen |
| `get_visible_subgraph` | Everything on the canvas — nodes, threads, types, labels, confirmed or proposed |
| `get_entity` | The full record for one company, person or address, with every filing it appears in |
| `search_documents` | Full-text search over the corpus. Returns document ids and the character offsets of each match — **never prose**, so a citation is always to the record and never to a paraphrase |
| `query_paths` | Existing routes between two entities on your canvas. Pure traversal: it will not invent a connection, and an empty result is a real answer |
| `get_page_title` | A connectivity check. If this works, site tools are wired up |

### Staged claims — these become proposals, and wait for you

| Tool | What it does |
|---|---|
| `propose_node` | Draws a dashed entity on the canvas. **Rejected outright if it arrives without a source document and span** |
| `propose_edge` | Draws a dashed thread with its citation attached. Same rule |
| `pin_evidence` | Attaches a further citation to something already on the canvas — corroboration |

### Pointing — changes what you are looking at, asserts nothing

| Tool | What it does |
|---|---|
| `highlight_span` | Marks a passage in the filing you are reading, in the agent's colour, alongside your own marks |
| `open_document` | Opens a filing in your reader and scrolls it to a passage |
| `focus` | Moves your canvas view to frame the nodes it wants you to see |
| `annotate` | Leaves a short note on a node or thread, visible in Details |

### Working your queue

| Tool | What it does |
|---|---|
| `claim_enquiry` | Takes a line of enquiry off your queue so you can see it is being worked. Reversible |
| `result_enquiry` | Reports back: **found**, **partial**, or **eliminated**, with a summary and citations. `found` is refused without at least one citation |

### What has no tool at all

Six things belong to you alone, and there is no tool for any of them:

1. Promoting a proposal into the graph
2. Rejecting one
3. Raising a line of enquiry
4. Filing one
5. Deleting your own markings
6. Adding a document to the working set

That last one matters more than it looks: an agent that could add its own material to the
queue could shape what you read.

---

## 13. If something looks wrong

- **An orange "DEV FIXTURE — not real records" badge in the header** means the real corpus
  did not load and you are looking at obviously-fake development data. Nothing on screen is a
  real company.
- **The tool log stays empty** — the browser is not a WebMCP host, or the page was opened in
  an ordinary tab. See §8.
- **A citation opens the filing but the highlight looks off** — stop and report it. A citation
  that points at the wrong words is the one failure this design cannot tolerate.

## 14. The one thing to remember

The app is built so that not checking is not an option. Every claim the agent makes arrives
with the filing that supports it, one click from the words themselves, and nothing enters
your chart until you have looked. If you find yourself accepting proposals without clicking
the citation, the tool is no longer doing anything for you that a chatbot could not do worse.
