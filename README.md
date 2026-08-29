# Threadweaver

An investigative graph canvas where a human and an AI agent build the same picture together.

You drag two entities that feel connected onto the canvas and say *"I think there's a link here."*
The agent reads what you have selected — through [WebMCP](https://webmcp.devpost.com) site tools —
searches the corpus, and draws the missing nodes and the thread between them as **proposals**:
dashed, glowing, unsettled, each carrying a citation. Click the citation, read the filing with the
exact span highlighted, then accept or reject. Accepted knowledge locks into the physics simulation
and the graph re-settles around it.

Built on real UK Companies House public records. No backend — the corpus is static, every tool runs
in the page.

**Submission for The WebMCP Challenge. Deadline: 3 September 2026, 1pm PDT.**

## Docs

| File | What's in it |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Features by priority, the reasoning behind each decision, day-by-day schedule, definition of done |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System diagrams, full file tree, the one architectural rule that matters |
| [`docs/TOOLS.md`](docs/TOOLS.md) | All 11 WebMCP tool contracts with JSON Schemas |
| [`docs/UI-3D.md`](docs/UI-3D.md) | The 3D visual and physics spec — what each force, material and animation means |
| [`docs/DATA.md`](docs/DATA.md) | Companies House ingestion pipeline and how to find the demo chain |

## Quickstart

```bash
npm install
npm run corpus:build     # one-off, see docs/DATA.md
npm run dev
```

Then open the page in **ChatGPT's browser** and check the **Site tools** panel in the address bar.
Chrome 149+ works too with `chrome://flags/#enable-webmcp-testing`.

## Licence

MIT.
