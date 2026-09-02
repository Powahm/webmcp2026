# Desk Two

A creator's workstation in a browser tab, presented as a small computer, built so an
AI agent can work inside it through **WebMCP**.

Write the script, read it off the teleprompter while you record, cut what you shot, and
have an agent working the same surface with you the whole way.

**Live:** _(deployment URL)_ · **Submission:** [The WebMCP Challenge](https://webmcp.devpost.com)

---

## Why WebMCP and not an API

The state that decides whether an agent is useful here has never left the page:

- which line of the teleprompter you are on, mid-take
- whether the camera is idle, armed or rolling, and how far into the take you are
- the line you are still typing, before you save it, and where your caret is
- which clip is selected on the timeline, and where the playhead sits

None of that is on a server. Clips are Blobs in IndexedDB, the timeline is an array in a
closure, the elapsed second is a running interval. A server-side MCP cannot reach any of
it, and an agent driving the DOM has to infer it from pixels.

**Nothing is uploaded.** Recording, editing and export all happen in the tab. There is no
backend to receive anything.

## The apps

| | |
|---|---|
| **Scripts** | What you are going to say, one line per spoken beat with its shot direction. Two views of one document: blocks, or a numbered text editor. A **Research** pane for links and notes you gathered while browsing. A teleprompter. |
| **Skills** | Craft notes on cutting and pacing, plus **AI Skills** — markdown you drop in that the agent can load and follow. |
| **Camera** | Camera or screen capture with your mic mixed in. The teleprompter runs over the preview and records which line you were on at which second. |
| **Editor** | Library, timeline, trim, six looks, speed, and an export that replays the cut into a canvas. Motion graphics compose here. |

## Eighteen site tools

Registered on `document.modelContext.registerTool`, with a `navigator.modelContext`
fallback for Chrome's origin trial. Read-only tools carry `readOnlyHint`; every schema
sets `additionalProperties: false`.

**Reading the page** — `get_desktop_state` · `list_scripts` · `get_script` ·
`get_open_script` · `get_prompter_state` · `get_recorder_state` · `list_clips` ·
`get_timeline` · `get_selection` · `get_playhead` · `get_graphics` ·
`get_offered_folders` · `list_ai_skills` · `load_ai_skill`

**Proposing** — `propose_graphic` · `propose_graphic_change` · `propose_script_line` ·
`offer_folder`

### The line the agent does not cross

**There is no tool that accepts a proposal, exports a video, or reads a file.** Every
accept path refuses anything that is not a trusted user event, which is how the browser
itself tells a click from a script.

So the agent can compose a four-second animated title card in a single call and still
cannot put one frame of it into your video. It can write a line into the draft you are
looking at and cannot change a word of it. It can tell the page it has a folder, and the
directory picker that opens is your authorisation, not its own.

## Three things worth a look

**Motion graphics from one spec.** The agent fills in a constrained declarative object —
never CSS, SVG or JavaScript — and one `drawGraphics` function renders it twice: onto a
transparent canvas over the preview, and onto the canvas the export is recording. Same
function, same spec, same pixels, so what you approve is what gets written. All geometry
is normalised, so a graphic approved on a 468px preview is correct in a 4K export.

**Ghost folders.** A page cannot see what an agent has access to, and cannot read a
directory without a click. So the announcing is inverted: the agent sends a manifest
through `offer_folder`, a translucent folder appears on the desktop, and hovering says
what would come in. Text rides along in the tool call; video waits for the picker.

**AI Skills that fire.** Skills declare `triggers` in frontmatter — either a signal the
page computes about itself (`research_has_url`, `timeline_empty`, `recording`) or a word
to look for in what you wrote. When the situation matches, **every read tool carries the
suggestion in its result**. Paste a link into Research and the next tool the agent calls
tells it which of your instructions applies. A skill nobody loads is a file, not a
capability.

## Running it

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # static output in dist/
```

To see the tools, open the site in **ChatGPT's browser**, or Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`. The badge in the menu bar says whether a host is
present, how many tools it took, and whether anything has actually called one — "ready"
and "connected" are deliberately different words.

Camera and screen capture need a secure context, so https or localhost.

## Notes on the build

Vite, React and Tailwind. Tailwind is **utilities only, no preflight**: `src/styles/desk.css`
is a complete hand-built design system with its own light and dark themes, and layering a
second reset on top of it would quietly change every margin and border in the app.

The window manager and the two original apps live in `src/legacy/` and are still
imperative DOM. Dragging, z-order, focus and the animation that flies a window out of its
icon's bounding rect already work; React owns the chrome, the agent surfaces and the
status badge.

`shell.js` resolves `#desktop` the moment it is evaluated, so the legacy modules are
imported dynamically after React's first paint. Anything that pulls them in statically
breaks the boot.

## Licence

MIT. See [LICENSE](LICENSE).
