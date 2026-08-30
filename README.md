# Threadweaver

A document reader and a link canvas where a human and an AI agent work the same case.

**You read.** Open a filing, read it, drag across a passage and mark it — an address, a name, a
date, a question. Raise a line of enquiry in your own words. This is the Document Reader's job in a
police major incident room, and in this app it is yours.

**The agent indexes.** Through [WebMCP](https://webmcp.devpost.com) site tools it can see the filing
you have open, the passage you just highlighted, every mark you have left and the working set on
your canvas — then cross-references all of it against a corpus you could not hold in your head. It
comes back with **proposals**: dashed, glowing, unsettled, each carrying a citation, plus its own
highlights laid alongside yours in the document you are still reading. Click a citation, check the
filing with the exact span highlighted, then accept or reject. Accepted knowledge locks into the
physics simulation and the graph re-settles around it.

That split is not ours. Major incident rooms have run it since 1981, for the same reason: the human
capacity that reads well is not the human capacity that cross-references exhaustively. See
[`docs/METHOD.md`](docs/METHOD.md).

Built on real UK Companies House public records. No backend — the corpus is static, every tool runs
in the page.

**Take the agent away and this is still a document reader with typed highlights, an enquiry queue
and a link canvas you build by hand.** That is the test we hold ourselves to.

**Submission for The WebMCP Challenge. Deadline: 3 September 2026, 1pm PDT.**

## The agent cannot commit anything

There are nineteen tools. Ten read, nine stage a proposal, point at something or report back, and
**none promotes a proposal into the graph.** That is not a missing feature; it is the design.

Four things have no tool at all, and belong to the human alone: promoting a proposal, raising a line
of enquiry, filing one, and deleting your own markings. The agent works a queue you wrote.

It is guaranteed twice over:

- **Structurally.** No registered tool promotes anything, and nothing under `src/webmcp/` imports
  `acceptProposal` or `rejectProposal`. `scripts/check-no-commit-tool.ts` runs as part of
  `npm run build` and fails the build if that ever stops being true.
- **At runtime.** Promotion requires a DOM event with `isTrusted === true` — an event only the
  browser can produce from a real input device. A synthetic `MouseEvent`, an `element.click()`, and
  a tool call all fail it.

`src/state/actions.ts` is the only thing that mutates state. Your clicks and the agent's tool calls
take the same path through it, so the two of you are equal actors on one model rather than a UI with
a bot bolted on.

## Quickstart

```bash
npm install
npm run dev              # works fully as an ordinary web app, no agent needed
```

Then open the page in **ChatGPT's browser** and check the **Site tools** panel in the address bar.
Chrome 149+ works too with `chrome://flags/#enable-webmcp-testing`.

### Building the corpus

`public/corpus/` is committed, so the app runs without this. To rebuild it from source records:

```bash
cp .env.example .env     # add a free Companies House REST API key
```

Download and unzip both free bulk products, then put them where the scripts look:

| Product | From | Goes in |
|---|---|---|
| Free Company Data Product | <http://download.companieshouse.gov.uk/en_output.html> | `raw/bulk/*.csv` |
| PSC snapshot | <http://download.companieshouse.gov.uk/en_pscdata.html> | `raw/psc/*.txt` |

```bash
npm run corpus:fetch -- --select-only   # streaming selection, no API calls
npm run corpus:fetch                    # officers + filing history, cached per company
npm run corpus:build                    # -> public/corpus/*.json
npm run corpus:chains                   # candidate 3-4 hop chains, with citations
npm run corpus:chains -- --lock 0       # lock one; writes docs/VERIFIED-CHAIN.md
```

`raw/` and `.env` are gitignored. `CH_API_KEY` is read only by `scripts/`; the built bundle contains
neither the key nor the Companies House hostname, and `npm run build` is checked for that.

## Deliberately out of scope

These are decisions, not gaps:

- **No entity extraction or NER.** Every entity and relationship comes from a structured field in a
  real filing. Nothing is inferred from prose, so nothing is invented.
- **No graph database.** The canvas holds a working set of tens of nodes, not the corpus. Path
  finding is a hand-rolled BFS over an adjacency map, because `max_hops <= 4` does not justify a
  dependency.
- **No accounts, no server, no persistence.** The page is the API. The agent can never reach data
  the analyst cannot also see.
- **No editing the corpus from the UI.** The records are the records.
- **No mobile layout.**

## A note on the data

Everything here is a UK public record. The product surfaces **structure** — "these companies share a
registered address and a common person with significant control, here are the filings" — and leaves
the conclusion to the human. It does not make accusations about named living individuals, and the UI
copy is written to keep that true. Dates of birth are published by Companies House and are used for
identity matching, but they are never rendered anywhere in the interface.

## Docs

| File | What's in it |
|---|---|
| [`docs/METHOD.md`](docs/METHOD.md) | **Start here.** The incident-room division of labour we implement, and why the human holds the Reader's chair |
| [`docs/PLAN.md`](docs/PLAN.md) | Features by priority, the reasoning behind each decision, day-by-day schedule, definition of done |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagrams, full file tree, the one architectural rule that matters |
| [`docs/TOOLS.md`](docs/TOOLS.md) | All 19 WebMCP tool contracts with JSON Schemas |
| [`docs/UI.md`](docs/UI.md) | The visual and physics spec — what each force, colour and animation means, and why the canvas is 2D |
| [`docs/DATA.md`](docs/DATA.md) | Companies House ingestion pipeline and how to find the demo chain |

## Licence

MIT.
