# Desk Two

A small computer in a browser tab. Three folders, two apps, and a browser agent that works
inside the same windows you are looking at.

- **Readme** — documentation about the machine.
- **Scripts** — what you are going to say on camera, with a teleprompter.
- **Skills** — craft notes on cutting, pacing and looks.
- **Camera** — live preview, one button to record.
- **Editor** — a timeline. Trim, grade, reorder, layer graphics and sound over it, export.

Write the script, read it off the prompter while you record, then cut what you shot. The take
comes back with a transcript, because the prompter was already watching.

## Run it

```bash
npm install
npm run dev       # http://127.0.0.1:5173
npm run build     # static output in dist/, deploys as-is
```

The camera needs a **secure context**: `https://` or `localhost`. Everything runs client-side;
there is no backend and nothing is uploaded.

## Files

| File | Contents |
|---|---|
| `index.html` | Mount node and fonts |
| `src/index.css` | Tailwind utilities, then the design system; the newer surfaces |
| `src/styles/desk.css` | Design tokens, both themes, window and app chrome |
| `src/App.jsx` | Desktop chrome, boot, tool registration |
| `src/legacy/store.js` | IndexedDB persistence for clips and scripts, plus clip probing |
| `src/legacy/shell.js` | Window manager, dock, ⌘K launcher, theme, icons |
| `src/legacy/camera.js` | Stream acquisition, recording, prompter marks |
| `src/legacy/editor.js` | Timeline, playback, grading, canvas export, composition views |
| `src/legacy/scripts-app.js` | Script folder, line editor, teleprompter |
| `src/legacy/skills.js` | Craft notes; the style ones apply to the timeline |
| `src/legacy/main.js` | Readme documents, app registration, boot |

The composition engine, which owns everything layered over the cut:

| File | Contents |
|---|---|
| `src/comp/engine.js` | Frames, `interpolate`, `spring`, easings, `Sequence` resolution, formats |
| `src/comp/paint.js` | Canvas primitives in the house form language; the palette roles |
| `src/comp/components.js` | The eleven graphics, each a pure function of its own frame |
| `src/comp/composition.js` | The document, and the checking of anything proposed into it |
| `src/comp/store.js` | Staging and the trusted-gesture guard |
| `src/comp/render.js` | Draws one frame. Called by the preview *and* the export |
| `src/comp/audio.js` | Synthesised effects, and a bed that ducks itself under speech |
| `src/comp/codegen.js` | Prints the composition as TSX |
| `src/transcript/transcript.js` | Word timing from prompter marks; search, fillers, dead air |
| `src/transcript/store.js` | Caching, persistence onto the clip, the API key |
| `src/transcript/whisper.js` | The optional measured-timing upgrade |
| `src/cuts/store.js` | Staged cuts; `applyCut` splits a segment |
| `src/webmcp/` | Tool definitions, registration, status badge |

## Scripts

A script is a title and a list of lines. Each line carries the **spoken text** and an optional
**shot direction** — where the camera is, what the b-roll is, what the tone should be.

Runtime is estimated at 2.5 words per second (about 150 wpm, an unhurried speaking pace) and
totalled across the script. The teleprompter scrolls the whole thing across roughly that
runtime, brightening the line you should be on, with speed control while it runs.

Scripts saved by the earlier code-based version are migrated on boot: each non-empty source
line becomes a spoken line, so nothing is lost.

## Skills

Short craft notes in three kinds — `cut`, `edit` and `style`. The style notes carry an
**Apply** button that sets that look and speed on the last clip on the timeline, so the
reference is usable rather than only readable.

## The composition engine

The Editor has a second half. The **Cut** owns footage — trims, order, looks, speed. The
**composition** owns everything layered on top of it: motion graphics, sound, and the aspect
ratio. Reframing to 9:16 moves no layer, because every position in a spec is a fraction of the
frame rather than a pixel.

It is a small purpose-built engine rather than a video framework, for one reason: this app is
a static page with no backend, and the render paths of the React video frameworks need Node
and a headless browser. What was worth taking from them is the model, not the dependency.

- **Frames, not seconds.** Everything counts in integer frames at 30fps. A frame renders the
  same every time it is asked for, so scrubbing backwards looks like playing forwards, and the
  export can draw frame 512 without having drawn 511.
- **`Sequence` nodes** carry `from` and `durationInFrames` and time-shift their children, so a
  group of graphics moves as a unit and children are clipped to their parent's window.
- **`interpolate` and `spring`** are pure functions of the frame. A component holds no state,
  so there is nothing to get wrong when the playhead jumps.
- **Eleven components** — title card, lower third, caption pop, bullet list, comparison cards,
  process flow, stat badge, callout arrow, progress bar, code card, quote card.
- **Colour is a role**, not a hex value. `accent` resolves against the live theme, so one spec
  is legible in light and dark.

`comp/render.js` draws a frame, and the preview loop and the export loop call it with the same
arguments. One renderer is what stops the preview from quietly ceasing to match the file.

## Transcripts

The Camera has been recording the useful thing all along. A take driven by the teleprompter
saves `clip.beats` — which script line was on screen at which second. That array plus the
script is a transcript: we know what was said, because they read it, and roughly when, because
we watched them advance it. Words are spread across their line by length.

It is an estimate and it says so: `source: "prompter"`, `approximate: true`. Pasting an OpenAI
key into the Transcript panel upgrades any clip to measured per-word timing from Whisper. The
key lives in this browser's localStorage and is never bundled — a static site cannot keep a
secret, so the only honest version of that feature is one where the key is yours.

Times are reported in **cut** seconds, already adjusted for every trim, reorder and speed
change. So quoting "three things" gives the second it happens in the edit as it stands now, and
that number can be handed straight to a graphic or a cut.

The transcript is what makes the Transcript tab a way of *moving* rather than reading: every
word is a button that seeks to it, fillers are struck through, and gaps over a second are
called out inline.

## How export works

There is no encoder dependency. Export replays the timeline into a `<canvas>`, applying each
clip's filter as `ctx.filter`, drawing the accepted composition layers over the frame, captures
that canvas with `captureStream()`, mixes the audio back in through a Web Audio graph — the
same graph the synthesised sound effects fire into — and records the combined stream with
`MediaRecorder`.

The consequence: **rendering is real time.** A forty-second cut takes forty seconds.

Exports are saved back into the library as a new clip *and* offered as a download. The library
copy is the reliable one — some embedded frames block downloads a page starts itself.

## Site tools

The page registers its tools on `document.modelContext` (falling back to
`navigator.modelContext`, which Chrome's origin trial still uses). Most of them are the
scripting API `scripts-app.js` already handed to human-written scripts, described in JSON
Schema and given to an agent instead of to a text editor.

Reading is free and marked `readOnlyHint`. Staging is cheap. **Accepting is not available.**

Every write tool produces a dashed, visible, live-previewing proposal and returns its id.
None of them can promote one, because every accept path in `comp/store.js`,
`graphics/store.js` and `cuts/store.js` refuses without a trusted user event — the same bit
the browser uses to tell a real click from a synthetic one. So the agent can compose an
animated title card, put a synthesised thump under it, reframe the whole thing to 9:16 and
list every hesitation in the take, in four calls, and it still cannot put one frame into your
video. There is no tool that exports, deletes a clip, or accepts a proposal.

The tools worth knowing about:

| Tool | Does |
|---|---|
| `get_transcript` | What is said, word by word, in cut seconds. Pass `quote` to locate a phrase. |
| `get_composition` | Layers, sound, format, and what is waiting on a decision. |
| `get_composition_code` | The composition as the TSX it compiles to. |
| `propose_layer` | Stages a graphic. Dashed on the timeline, previewing live. |
| `propose_cut` | Stages a cut. Give it a quote and it resolves to exact frames. |
| `propose_tidy` | Stages a cut over every filler and every silence, in one call. |
| `propose_sound` | A synthesised effect on a moment, or a bed that ducks under speech. |
| `propose_format` | Stages a reframe, with safe-area guides shown while it waits. |

## Storage

Clips and scripts live in IndexedDB under the origin serving the page. Nothing is uploaded;
there is no backend. If IndexedDB is unavailable the apps fall back to memory for the session,
so nothing breaks, but a refresh loses the library.

## Interactions

- **Click an icon** — folders hinge open, apps press in; the window scales out of the icon's
  exact rectangle and reverses back into it on close.
- **Drag** a window by its title bar, **resize** from the bottom-right, **double-click** to maximise.
- **⌘K / Ctrl+K** searches documents, scripts and clips.
- **Escape** closes the top window. **⌘Enter** runs a script, **⌘S** saves it.
- In the Editor, the bottom pane switches between **Timeline**, **Transcript** and **Code**.
  Clicking a word seeks to it; clicking a staged layer takes the playhead into it, past its
  entrance, so what you judge is the graphic and not its first three frames.

## Accessibility

Icons and files are real buttons, windows are labelled dialogs, focus moves into a window on
open and back to the icon on close. `prefers-reduced-motion` disables the window animations
and the wallpaper parallax.

## Licence

MIT.
