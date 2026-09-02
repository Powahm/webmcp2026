# Desk Two — overview

The single source of truth for what this is, what exists, and what is left.
Submission for **The WebMCP Challenge**, deadline **3 September 2026, 1pm PDT / 10pm Berlin**.

## What it is

A creator's workstation in a browser tab, presented as a small computer: a desktop, icons,
draggable windows, a dock, a spotlight search. Inside it live a **Camera**, an **Editor**, a
**Scripts** folder and a **Readme**. Everything runs locally. Clips and scripts sit in IndexedDB
under the page's own origin, and there is no backend to upload anything to.

A browser agent works inside that desktop through WebMCP: it reads what the creator currently has
open and proposes work into the same windows they are looking at.

**The pitch in one sentence.** Filming a video means holding a script, a camera and a timeline in
your head at the same time, and this is the first workstation where an agent can see all three at
the same moment you can.

## Why this is a WebMCP project and not an API project

The state that decides whether the agent is useful has never left the page:

- which script is open in the Scripts window, and which beat the teleprompter is on
- whether the Camera is idle, armed or rolling, and how far into the take you are
- which clip is selected on the timeline, and where the playhead sits
- which take you just decided was the keeper

No server has any of it. The clips are Blobs in IndexedDB; the timeline is an array in
`editor.js`; the recorder's elapsed time exists only in a running interval. A server-side MCP
cannot reach it and a screen-scraping agent has to infer it from pixels.

**The strongest fact about this codebase, and the one to lead the write-up with:** the app already
had a scripting API for humans before any agent existed. `scripts-app.js` hands a script an `api`
object with `api.camera.record()`, `api.editor.add()`, `api.editor.trim()`, `api.clips.all()`. The
WebMCP layer is not a new capability bolted on the side, it is the *same* API, described in JSON
Schema, handed to an agent instead of to a text editor. That is exactly what the site-tools guidance
asks for: reuse your existing application logic and permissions.

## What exists today

| Piece | File | State |
|---|---|---|
| Window manager, dock, spotlight, theme, toasts | `shell.js` | Done. `Desk.openWindow`, `Desk.register`, `Desk.addSearchSource`, `Desk.toast`. |
| Storage | `store.js` | Done. IndexedDB with a memory fallback, `Store` + `Clips` + `timecode()`. |
| Camera | `camera.js` | Done. `getUserMedia`, MediaRecorder to WebM, device picker, mic toggle, file import, recent strip. |
| Editor | `editor.js` | Done. Library, preview, clip inspector, timeline, trim, six looks, speed, reorder, and a real export that replays the timeline into a canvas and mixes audio through Web Audio. |
| Scripts | `scripts-app.js` | Runs real async JS against the `api` object. Seeded with examples. |
| Readme | `main.js` | Five documents. |
| Deploy | `vercel.json` | Static. Deploys as-is. |

Not started: the teleprompter, screen recording, motion graphics, the WebMCP layer.

## What is left to build

### 1. Screen recording, in the Camera

Cheap and worth doing. `camera.js` already isolates the whole capture path behind `acquire()`, and
everything downstream (MediaRecorder, `Clips.save`, the editor, export) is source-agnostic because
it only ever sees a `MediaStream` and then a Blob.

- Add a source mode: `camera` / `screen` / `screen + mic`.
- In `acquire()`, branch to `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`.
- For screen plus voiceover, take the display stream and a `getUserMedia({ audio: true })` stream
  and build one `MediaStream` from the display video track plus the mic audio track. That is three
  lines, and it is what makes a tutorial recording possible.
- Save with `kind: "screen"` so the library can label it.
- Handle the user hitting the browser's own "Stop sharing" button: listen for `ended` on the video
  track and stop the recorder, or the clip runs on with a frozen frame.
- `getDisplayMedia` needs a secure context and a user gesture, same as the camera. The existing
  `describeError` needs one more case for `NotAllowedError` when the picker is dismissed.

Roughly forty minutes.

### 2. The teleprompter, in the Camera

Open the Camera, pick a script, hit record, and the script scrolls as large text over the preview,
one beat at a time.

- Beats come from the script text split on blank lines. One paragraph, one beat.
- **Advance manually**, space bar or a large button. A timed prompter that gets ahead of you is
  worse than no prompter at all.
- Record `{ beat, atSeconds }` as the take runs and store the array on the clip. That single field
  is what later lets anything cut on script structure rather than on guesswork, and capturing it now
  costs nothing.
- The Camera needs to know which script is loaded, which beat is showing, and how far in it is.
  That triple is what `get_recorder_state` returns and it is the whole reason the agent can say
  anything useful about a take.

### 3. Motion graphics, a tab in the Editor

A tab where the creator asks the agent for a graphic and it lands on the timeline as a proposal
they accept, reject or tweak.

**The agent must not emit CSS, SVG or JavaScript.** It fills in a constrained declarative spec that
the editor already knows how to render. Faster to build, always on-theme, cannot break the page, and
it is the difference between a demo that works on the first take and one that works on the fifth.

Six types, one envelope:

```
lower_third     name + role, slides in from the left
title_card      full-frame headline, optional subtitle
caption_pop     word-by-word kinetic captions over a time range
callout_arrow   arrow plus label pointing at a position
stat_badge      a number that counts up
progress_bar    a bar tied to a time range
```

```js
{ type, start, duration, text, subtext, position, palette_role, easing }
```

Palette *roles*, not hex. The agent picks "accent" and the theme decides what that is, so the
graphic cannot be off-brand and cannot be ugly.

Render it twice, from one spec: as a DOM overlay in the preview, and as canvas draw calls during
export. The editor already proves this pattern works, its six looks are a CSS filter string in
preview and the identical string on the canvas at export.

### 4. The WebMCP layer

New file, `webmcp.js`, loaded last from `index.html`.

```js
const mc = document.modelContext ?? navigator.modelContext;
if (typeof mc?.registerTool === "function") {
  for (const tool of TOOLS) await mc.registerTool(tool);
}
```

Most tools are a thin wrapper over the `api` object that `scripts-app.js` already builds.

**Read-only**, `annotations: { readOnlyHint: true }` so the browser does not gate them behind a
confirmation prompt:

| Tool | Returns |
|---|---|
| `get_desktop_state` | Which windows are open and which is focused. The agent should know whether you are filming or editing before it says anything. |
| `list_scripts` | Script ids, names, beat counts. |
| `get_script` | One script, split into beats. |
| `get_open_script` | **Flagship.** The script open right now, the beat on screen, the creator's cursor or selection inside it. |
| `get_recorder_state` | `idle` / `armed` / `recording`, source, elapsed seconds, loaded script, current beat. |
| `list_clips` | Library: id, name, kind, duration, dimensions. |
| `get_timeline` | Segments in order with in and out points, look, speed, total runtime. |
| `get_selection` | **Flagship.** The selected segment or graphic in the Editor. Makes "tighten this bit" mean something. |
| `get_graphics` | Graphics on the timeline with their specs, so the agent can build on what is there. |

**Pointing**, changes the view and asserts nothing:

| Tool | Effect |
|---|---|
| `open_app` | Brings a window to the front. |
| `load_teleprompter` | Loads a script into the Camera. Does not start recording. |
| `scroll_teleprompter` | Moves the prompter to a beat. |
| `seek_preview` | Moves the playhead so the creator sees what the agent is talking about. |

**Staged proposals**, the creator accepts or rejects:

| Tool | Effect |
|---|---|
| `propose_graphic` | A ghost graphic on the timeline, visibly unconfirmed, previewing live. |
| `propose_graphic_change` | A staged edit to an existing graphic. |
| `propose_cut` | A ghost trim on a segment. Nothing is trimmed until accepted. |
| `propose_look` | A staged grade on a segment. |

### The line the agent does not cross

**There is no tool that exports, deletes a clip, or accepts a proposal.** Acceptance is a click,
guarded by a trusted user event. Say it outright in the Devpost description: the agent can compose
an eight-second animated title card in a single call, and it still cannot put one frame into your
video. That answers "how do I know it won't wreck my edit" before a judge has to ask, and it
satisfies the requirement that consequential actions get human review.

## Build order

**Tonight**

1. WebMCP registration live, one tool visible in ChatGPT browser's Site tools panel. Nothing else
   until a judge's browser can see one tool.
2. Screen recording in the Camera.
3. Teleprompter, including the beat index on `get_recorder_state`.
4. The nine read-only tools. They are cheap once the state is reachable, because the state already
   exists.

**Thursday morning**

5. `propose_graphic`, the six renderers, accept and reject.
6. The pointing tools and `propose_cut`.

**Thursday, code freeze at noon Berlin**

7. Video, Devpost description, README.

Cut first, in this order: `propose_look`, `propose_cut`, `get_desktop_state`, script creation.

## The demo, three minutes

1. **20s.** The desktop. Open a script in the Scripts folder. No AI on screen yet.
2. Open the Camera, load the script, hit record. The teleprompter scrolls while you deliver a beat
   to camera. Stop.
3. Open the Editor. The take is in the library and on the timeline. Select a range.
4. Ask the agent for a title card over the opening. It calls `get_selection` and `get_timeline`,
   then `propose_graphic`. A ghost graphic appears and previews live.
5. **Accept it.** It goes solid.
6. Second ask, on the thing you just accepted: "hold it two seconds longer and use the accent
   colour." `get_graphics`, then `propose_graphic_change`. This compounding turn is the whole
   argument, because a page-scraper cannot know what you just chose to keep.
7. Show the Site tools panel on screen at some point, so WebMCP itself is visible.

## Non-negotiables

- Register on `document.modelContext.registerTool`. Feature-detect `navigator.modelContext` too;
  Chrome's origin trial still exposes the old location.
- `inputSchema` is JSON Schema. Every schema sets `additionalProperties: false`. Narrow inputs are
  the documented recommendation and a broad "do the thinking for me" tool is the documented
  anti-pattern.
- **Tools inside an iframe are never discovered.** Register on the top-level document. This matters
  more here than anywhere, because a windowed desktop is exactly the shape of app someone builds
  out of iframes. Do not.
- `readOnlyHint` on every read tool. Never on a proposal tool.
- The consuming agent is ChatGPT's browser. Build and rehearse there, Chrome 149+ as backup. The
  Claude desktop app is not a WebMCP consumer.
- Everything built after 25 August 2026; commit history is the proof.
- Public repo with an MIT LICENSE file, a live public URL, and a YouTube video under three minutes
  with audio.
- Four Devpost headings, matching the four equally weighted criteria: WebMCP Leverage, Execution,
  Potential Impact, Creativity and Ambition.
