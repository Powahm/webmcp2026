# Deskmate: overview

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
- **what you said and when you said it**, and this one is the sharpest, because it is the fact
  a transcription service *cannot* give you. A server can tell you what is in a file you
  uploaded. It cannot tell you what you were reading off the prompter when you said it, because
  the prompter is in this tab and so are the clicks that advanced it.

No server has any of it. The clips are Blobs in IndexedDB; the timeline is an array in
`editor.js`; the recorder's elapsed time exists only in a running interval; the transcript is
derived from `clip.beats`, which is a log of when someone pressed a key in this window. A
server-side MCP cannot reach any of it and a screen-scraping agent has to infer it from pixels.

There is a second half to the argument that is easy to miss. The tools do not only *read* state
no server has, they **write into the surface the creator is already looking at**. A proposal is
not a message in a chat log describing a graphic; it is a dashed overlay on the frame at the
second in question, previewing live, next to an Accept button. Nothing off-page can put a
suggestion *there*.

**The strongest fact about this codebase, and the one to lead the write-up with:** the app already
had a scripting API for humans before any agent existed. `scripts-app.js` hands a script an `api`
object with `api.camera.record()`, `api.editor.add()`, `api.editor.trim()`, `api.clips.all()`. The
WebMCP layer is not a new capability bolted on the side, it is the *same* API, described in JSON
Schema, handed to an agent instead of to a text editor. That is exactly what the site-tools guidance
asks for: reuse your existing application logic and permissions.

## What exists today

Everything below is built and tested.

| Piece | Where | State |
|---|---|---|
| Window manager, dock, spotlight, theme, toasts | `src/legacy/shell.js` | Done. Plus an `onVisibility` hook so an app can let go of a device when it is minimised. |
| Storage | `src/legacy/store.js` | IndexedDB v2 with a memory fallback: `clips`, `scripts`, `aiskills`. |
| Camera | `src/legacy/camera.js` | Camera and screen capture, constraint ladder, mic mixed into a display stream, teleprompter over the preview, beat marks written onto the take. |
| Editor | `src/legacy/editor.js` | Lanes in one timebase, trim, split, drag-to-reorder with a seam marker, six looks, speed, per-clip and per-item volume, sound unlinked from picture onto its own lane, transform with keyframes, three frame shapes with a pan that tracks the cursor, inline rename, undo over the cut, real-time canvas export at the composition's size with audio mixed through Web Audio. Transcript in the left rail; the composition as code is a tool rather than a panel. |
| Scripts | `src/legacy/scripts-app.js` | Lines-and-shot-directions model, Draft and Shot list views, research pane, suggestions drawn into the draft, standalone rehearsal prompter. |
| Skills / AI Skills | `src/legacy/skills.js`, `src/legacy/aiskills.js` | Craft notes, plus a folder of markdown the agent can load, with triggers. |
| Motion graphics | `src/graphics/` | Six declarative types, one renderer for preview and export, propose and accept. |
| **Motion graphics clips** | `src/legacy/editor.js`, `src/comp/store.js` | A clip is a span of the cut that holds elements. Open one and it becomes the timeline: its own length, one element to a row, trim and move in local time. Explicit on the spine, floating over the footage, or gathered implicitly around elements the agent proposed with no clip to hold them. Ownership is a field on the element, not a question about where its start second lands, so shortening a clip cannot hand its contents to the clip beside it and trimming its head takes frames off the head. An element pushed only partly outside keeps its own origin and gets a window, so it draws from the clip's edge half-animated rather than replaying its entrance there; one pushed out entirely is parked and comes back when the clip widens. The composition underneath is still one flat list in cut frames, so the tool contract, the codegen and the export never learned about any of this. |
| **Undo and redo** | `src/legacy/editor.js` | Over the cut: add, trim, move, reorder, split, delete, clear, and accepted cuts. Ctrl+Z and Ctrl+Shift+Z, or the buttons. A snapshot carries the composition with it, because a timeline edit takes composition state with it. Restoring goes through `restoreComposition`, which takes the same trusted gesture every other decision does, so undo is a person's click and there is still no route from a tool to a state nobody clicked their way into. |
| **The agent's cursor** | `src/agent/Cursor.jsx` | A pointer that springs to the surface each tool call actually touched and presses it, and a border that breathes on the window while a call is in flight. Driven only by real calls, like the ghost. |
| **Composition engine** | `src/comp/` | Frames at 30fps, `Sequence` resolution, `interpolate`/`spring`, fourteen components, three formats with a per-clip cover-or-contain fit, synthesised sound, TSX codegen. |
| **Transcripts** | `src/transcript/` | Word timing derived from prompter marks; Whisper as an opt-in upgrade on the user's own key. |
| **Staged cuts** | `src/cuts/` | Cut by quoting the words; `applyCut` splits a segment. |
| Ghost folders | `src/folders/` | Manifest from the agent, directory picker from the person. |
| The agent's presence | `src/agent/`, `src/webmcp/StatusBadge.jsx` | A ghost that names each tool as it is called, and a four-state status badge. |
| WebMCP layer | `src/webmcp/` | Twenty-eight tools, registration with fallback, per-call instrumentation. |

The composition engine is a purpose-built alternative to a React video framework rather than
an integration of one. The reason is structural: this is a static page with no backend, and
the render path of every such framework needs Node and a headless browser. The model was
worth taking (frames rather than seconds, time-shifting sequences, animation as a pure
function of the frame), and the dependency was not.

### Verified

Headless Chromium against a stand-in host built to the spec's shape, plus a real export
decoded frame by frame to confirm an accepted graphic is genuinely burned into the file.
Roughly 190 checks across the tool contract, both browsers' picker paths, the recorder,
the teleprompter, the graphics loop, the folder loop, the skills loop and the ghost.

**Not yet verified: any of it inside ChatGPT's browser.** A stand-in host is good evidence
and it is not the real thing.

## Still open

- Export is real-time canvas capture, so it takes as long as the cut and is
  whatever container the browser will encode. It is now sized to the
  composition's format rather than the first clip, so a reframe reaches the
  file; WebCodecs with `mp4-muxer` is still the path to exact frame rates and
  4K, and it replaces `runExport` entirely.
- No caption track on the exported file. The transcript exists and is
  frame-accurate in cut time, so this is plumbing rather than a question.
- Dragging the picture to reposition a reframe is pointer-only. The same
  numbers are on sliders, so nothing is unreachable, but the direct gesture
  needs a mouse.
- Undo covers the cut, not the composition on its own. Accepting a proposal is
  not an undo step; Reject is the button for that.
- The demo video and the Devpost write-up.

## The demo, three minutes

1. **20s.** The desktop. Open a script in the Scripts folder. No AI on screen yet.
2. Open the Camera, load the script, hit record. The teleprompter scrolls while you deliver a beat
   to camera. Stop.
3. Open the Editor. The take is in the library and on the timeline. **Open the Transcript tab:
   the words are already there, timed, because the prompter was watching.** Nothing was uploaded
   and no key was needed. Click a word; the playhead goes to it.
4. Ask the agent for a list over the bit where you say "three things". It calls `get_transcript`
   with that quote, gets exact seconds back, then `propose_layer`. A dashed list appears at that
   frame and previews live.
5. **Accept it.** It goes solid. `get_composition_code` returns the composition as the TSX
   it compiles to: `<Sequence from={115} durationInFrames={150}>`. That is not a description
   of the graphic, those are the frames it renders on. (The Code tab it used to be shown in
   was removed in `fca1d40`; say the line, do not go looking for the tab.)
6. Second ask, on the thing you just accepted: "hold it two seconds longer and put a thump under
   it." `get_composition`, then `propose_layer_change` and `propose_sound`. This compounding turn
   is the whole argument, because a page-scraper cannot know what you just chose to keep.
7. "Tidy up the ums." One `propose_tidy` call marks every hesitation under the track, each with
   its own reason, to take or leave one at a time.
8. "Make it a short." `propose_format` stages 9:16 and the safe-area guides appear over the
   preview, so the reframe is a decision rather than a surprise.
9. Show the Site tools panel on screen at some point, so WebMCP itself is visible.

The line to say out loud while doing it: **every one of those was a proposal.** The agent
composed a graphic, a sound, a reframe and a list of cuts, and it never put one frame into the
video. Acceptance is a click, and there is no tool that clicks.

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
