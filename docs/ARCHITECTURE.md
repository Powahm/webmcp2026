# Deskmate: architecture

How the machine is built. [`README.md`](../README.md) is the short version and the place to
start; this is the reference, one section per part of the system.

- [The apps](#the-apps)
- [Twenty-eight site tools](#twenty-eight-site-tools)
- [The line the agent does not cross](#the-line-the-agent-does-not-cross)
- [The composition engine](#the-composition-engine)
- [Transcripts](#transcripts)
- [Scripts](#scripts)
- [Skills](#skills)
- [Reframing, and what it keeps](#reframing-and-what-it-keeps)
- [Unlinking sound](#unlinking-sound)
- [How export works](#how-export-works)
- [Storage](#storage)
- [The wallpaper](#the-wallpaper)
- [Interactions](#interactions)
- [Accessibility](#accessibility)
- [Files](#files)
- [Notes on the build](#notes-on-the-build)

## Why WebMCP and not an API

The state that decides whether an agent is useful here has never left the page:

- which line of the teleprompter you are on, mid-take
- whether the camera is idle, armed or rolling, and how far into the take you are
- the line you are still typing, before you save it, and where your caret is
- which clip is selected on the timeline, and where the playhead sits
- which words are under the playhead, and what is layered over them

None of that is on a server. Clips are Blobs in IndexedDB, the timeline is an array in a
closure, the elapsed second is a running interval. A server-side MCP cannot reach any of
it, and an agent driving the DOM has to infer it from pixels.

There is a second half to the argument that is easy to miss. The tools do not only *read*
state no server has, they **write into the surface the creator is already looking at**. A
proposal is not a message in a chat log describing a graphic; it is a dashed overlay on the
frame at the second in question, previewing live, next to an Accept button.

**Nothing is uploaded.** Recording, editing and export all happen in the tab. There is no
backend to receive anything.

## The apps

| | |
|---|---|
| **Readme** | Documentation about the machine. |
| **Scripts** | What you are going to say, one line per spoken beat with its shot direction. Two views of one document: a **Draft** you write in, and a **Shot list** for the pass before you shoot. A **Research** pane for links and notes you gathered while browsing. A teleprompter. |
| **Skills** | Craft notes on cutting and pacing, plus **AI Skills**: markdown you drop in that the agent can load and follow. |
| **Camera** | Camera or screen capture with your mic mixed in. The teleprompter runs over the preview and records which line you were on at which second. |
| **Editor** | Lanes of clips, graphics and sound in one timebase. Trim, split, reorder by dragging, six looks, speed, per-clip volume, transform with keyframes, three frame shapes, undo over the cut, and an export that replays it into a canvas. The left rail holds the library, text, transitions and the transcript; the right rail holds the clip, the motion and the composition. |

## Twenty-eight site tools

Registered on `document.modelContext.registerTool`, with a `navigator.modelContext`
fallback for Chrome's origin trial. Read-only tools carry `readOnlyHint`; every schema
sets `additionalProperties: false`.

**Reading the page**: `get_desktop_state` · `list_scripts` · `get_script` ·
`get_open_script` · `get_prompter_state` · `get_recorder_state` · `list_clips` ·
`get_timeline` · `get_selection` · `get_playhead` · `get_graphics` ·
`get_offered_folders` · `list_ai_skills` · `load_ai_skill` · `get_composition` ·
`get_transcript` · `get_composition_code`

**Proposing**: `propose_graphic` · `propose_graphic_change` · `propose_script_line` ·
`offer_folder` · `propose_layer` · `propose_blank_clip` · `propose_layer_change` ·
`propose_sound` · `propose_format` · `propose_cut` · `propose_tidy`

Most of them are the scripting API `scripts-app.js` already handed to human-written
scripts, described in JSON Schema and given to an agent instead of to a text editor.

The ones worth knowing about:

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

### The line the agent does not cross

**There is no tool that accepts a proposal, exports a video, or reads a file.** Every
accept path (in `comp/store.js`, `graphics/store.js`, `cuts/store.js` and
`scripts/proposals.js`) refuses anything that is not a trusted user event, which is how
the browser itself tells a click from a script.

So the agent can compose an animated title card, put a synthesised thump under it, reframe
the whole thing to 9:16 and list every hesitation in the take, in four calls, and it still
cannot put one frame into your video. It can write a line into the draft you are looking at
and cannot change a word of it. It can tell the page it has a folder, and the directory
picker that opens is your authorisation, not its own.

## Three things worth a look

**Motion graphics from one spec.** The agent fills in a constrained declarative object
(never CSS, SVG or JavaScript) and one render function draws it twice: onto a transparent
canvas over the preview, and onto the canvas the export is recording. Same function, same
spec, same pixels, so what you approve is what gets written. All geometry is normalised,
so a graphic approved on a 468px preview is correct in a 4K export.

**Ghost folders.** A page cannot see what an agent has access to, and cannot read a
directory without a click. So the announcing is inverted: the agent sends a manifest
through `offer_folder`, a translucent folder appears on the desktop, and hovering says
what would come in. Text rides along in the tool call; video waits for the picker.

**AI Skills that fire.** Skills declare `triggers` in frontmatter: either a signal the
page computes about itself (`research_has_url`, `timeline_empty`, `recording`) or a word
to look for in what you wrote. When the situation matches, **every read tool carries the
suggestion in its result**. Paste a link into Research and the next tool the agent calls
tells it which of your instructions applies. A skill nobody loads is a file, not a
capability.

## The composition engine

The Editor has a second half. The **Cut** owns footage: trims, order, looks, speed. The
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
- **Fourteen components**: title card, lower third, caption pop, bullet list, comparison
  cards, process flow, stat badge, callout arrow, progress bar, code card, quote card, plus
  three free-form ones: **text** you style completely, a **shape** in eight kinds, and a
  full-frame **effect** (dip, flash, vignette, grain, scanlines, glitch, letterbox, wash).
  Text and shape both carry an **opacity**, so either can sit over the picture without hiding
  it.
- **Colour is a role by default.** `accent` resolves against the live theme, so one spec is
  legible in light and dark. A hex is accepted where a person has picked one deliberately;
  a role is what an agent is offered, because it cannot then choose something off-brand.

`comp/render.js` draws a frame, and the preview loop and the export loop call it with the same
arguments. One renderer is what stops the preview from quietly ceasing to match the file.

## Transcripts

The Camera has been recording the useful thing all along. A take driven by the teleprompter
saves `clip.beats`: which script line was on screen at which second. That array plus the
script is a transcript: we know what was said, because they read it, and roughly when, because
we watched them advance it. Words are spread across their line by length.

It is an estimate and it says so: `source: "prompter"`, `approximate: true`. Pasting an OpenAI
key into the Transcript panel upgrades any clip to measured per-word timing from Whisper. The
key lives in this browser's localStorage and is never bundled: a static site cannot keep a
secret, so the only honest version of that feature is one where the key is yours.

Times are reported in **cut** seconds, already adjusted for every trim, reorder and speed
change. So quoting "three things" gives the second it happens in the edit as it stands now, and
that number can be handed straight to a graphic or a cut.

The transcript is what makes the Transcript tab a way of *moving* rather than reading: every
word is a button that seeks to it, fillers are struck through, and gaps over a second are
called out inline.

## Scripts

A script is a title and a list of lines. Each line carries the **spoken text** and an optional
**shot direction**: where the camera is, what the b-roll is, what the tone should be.

Runtime is estimated at 2.5 words per second (about 150 wpm, an unhurried speaking pace) and
totalled across the script. The teleprompter scrolls the whole thing across roughly that
runtime, brightening the line you should be on, with speed control while it runs.

The Draft does not wrap, so one line of the document is exactly one row on screen. That is what
lets a suggestion from the agent sit at the line it is aimed at, and it is what keeps the gutter
numbers honest.

Scripts saved by the earlier code-based version are migrated on boot: each non-empty source
line becomes a spoken line, so nothing is lost.

## Skills

Short craft notes in three kinds: `cut`, `edit` and `style`. The style notes carry an
**Apply** button that sets that look and speed on the last clip on the timeline, so the
reference is usable rather than only readable.

## Reframing, and what it keeps

**16:9**, **9:16** and **1:1** sit beside the picture, and changing one moves no graphic,
because every position in a composition is a fraction of the frame. What it does change is
how much of the *footage* survives, so that is a choice per clip:

- **Fill frame** crops to the frame. 16:9 to 9:16 loses about 70% of the width.
- **Fit whole clip** keeps all of it and pads the edges.
- **Drag the picture** to choose what stays in frame.

The pan is `object-position`, not a transform. That distinction is the whole feature: with
`object-fit: cover` the element *is* the frame, so translating it slides the crop and its
contents together and reveals the backdrop rather than more of the shot. `fitVideo()` applies
the same two percentages at export, and the drag is geared to the overflow so the picture
tracks the cursor exactly and stops where the hidden part runs out.

## Unlinking sound

A1 is drawn from the spine rather than stored beside it, because a cut is a cut: trimming the
picture trims the sound. **Unlink sound from picture** lifts a clip's audio onto its own audio
lane, where it has its own position, trim and volume, so a line can run under the next shot or
be replaced. It remembers where it came from, which is what makes **Relink** possible.

## How export works

There is no encoder dependency. Export replays the timeline into a `<canvas>` **sized to the
composition's format**, not to the first clip, so an accepted reframe reaches the file. It
applies each clip's filter as `ctx.filter`, fits the picture with the clip's own
cover-or-contain and pan, draws the accepted composition layers over the frame, captures
that canvas with `captureStream()`, mixes the audio back in through a Web Audio graph (the
same graph the synthesised sound effects fire into) and records the combined stream with
`MediaRecorder`.

The consequence: **rendering is real time.** A forty-second cut takes forty seconds.

Exports are saved back into the library as a new clip *and* offered as a download. The library
copy is the reliable one: some embedded frames block downloads a page starts itself.

## Storage

Four stores in IndexedDB (v3) under the origin serving the page: `clips`, `scripts`,
`aiskills` and `libfolders`. Nothing is uploaded; there is no backend. If IndexedDB is
unavailable the apps fall back to memory for the session, so nothing breaks, but a refresh
loses the library.

A transcript rides on its own clip record rather than in a store of its own: it is
meaningless without the clip and should die with it, which living on the record gives for
free. The one thing kept outside IndexedDB is an OpenAI key, if you paste one in for Whisper.
That is in `localStorage` and is sent nowhere but `api.openai.com`.

## The wallpaper

Two photographs of the same valley, one per theme: `Light_theme` at sunrise,
`Dark_theme` at last light. The exports live in `assets/` as PNG and are never
touched; `tools/wallpaper.mjs` writes the `.webp` beside each one, which is what
`desk.css` actually loads. It does two things on the way: WebP takes 1.9MB down
to about 100KB, and the brand lock-up is moved. It ships across the middle of each
export, which is exactly where the desktop icons and their labels land, so the
script lifts it off the sky and puts it back above the icon row: a clean plate
crossfaded from the sky either side of it, then a difference matte against that
plate, which is what gives grey letters and an orange mark a shared alpha channel
that no colour key could.

Nothing else has to know: the picture is a `background-image` on one element, so
swapping in a different export is two lines of CSS. What sits on top of it is a
scrim in the ground colour, strongest across the icon row and lightest across the
horizon, plus a halo behind every desktop label, which is what keeps the labels
readable on a picture that was never designed to have text on it.

## Interactions

- **Click an icon**: folders hinge open, apps press in; the window scales out of the icon's
  exact rectangle and reverses back into it on close.
- **Drag** a window by its title bar, **resize** from the bottom-right, **double-click** to maximise.
- **⌘K / Ctrl+K** searches documents, scripts and clips.
- **Escape** closes the top window. **⌘Enter** runs a script, **⌘S** saves it.
- In the Editor, **Transcript** is in the left rail. Clicking a word seeks to it; clicking a
  staged layer takes the playhead into it, past its entrance, so what you judge is the graphic
  and not its first three frames.
- **Ctrl+Z / Ctrl+Shift+Z** undo and redo anything that changes the cut.
- **Backspace** removes whatever is selected, and **right-clicking** anything on the timeline
  offers the same, plus **Open** on a motion graphics clip.
- One orange **Import** in the library takes video and audio together; the file's own type
  decides which it is, so there is no kind to choose before choosing the file.
- **Drag a clip along V1** to reorder it: it snaps to a seam and a marker shows which one.
  `[` and `]` do the same from the keyboard. **Drag the picture** to choose what a reframe
  keeps. **Backspace** removes whatever is selected, a suggestion included.

## Accessibility

Icons and files are real buttons, windows are labelled dialogs, focus moves into a window on
open and back to the icon on close. `prefers-reduced-motion` disables the window animations
and the wallpaper parallax. The **Accessibility** document in the Readme folder is the
user-facing version of this list.

**Focus work** (`src/a11y/focus-work.js`) is the keyboard's map of the desktop:

- A **skip link** as the first tab stop, and one 3px focus ring with a ground-coloured halo
  so it survives the wallpaper as well as a window body.
- **Arrow keys, Home and End** walk the desktop icons; Tab still reaches each one.
- **F6 / Shift+F6** cycles the open windows: the only way to reach one that is behind
  another. Closing a window hands focus back to its icon, minimising hands it to the dock
  button, and both are announced.
- The **launcher** and the **teleprompter** hold focus inside themselves and give it back to
  whatever opened them. The launcher is a combobox with `aria-activedescendant`, so arrowing
  through results is audible and not only visible. **Space** pauses the prompter.
- One polite live region narrates what happens without a click: windows opening, closing and
  minimising, the prompter starting and stopping, how many results a search found.

Known gaps, also listed in the document: reordering timeline clips is drag-only, and exported
video carries no caption track.

## Files

| File | Contents |
|---|---|
| `index.html` | Mount node and fonts |
| `src/index.css` | Tailwind utilities, then the design system; the newer surfaces |
| `src/styles/desk.css` | Design tokens, both themes, window and app chrome |
| `assets/*.png` | The wallpaper exports, untouched |
| `tools/wallpaper.mjs` | Turns those into the `.webp` the page loads |
| `src/main.jsx` | React entry |
| `src/App.jsx` | Desktop chrome, boot, tool registration |
| `src/env/browser.js` | What this browser will and will not allow |
| `src/env/Permissions.jsx` | The menubar chip: one light per thing that can be refused |
| `src/help/tours.js` | The guided tours, per window and for the machine |
| `src/help/tour.js` | The spotlight, the dimming and the arrow-key walk |
| `src/legacy/store.js` | IndexedDB v3: clips, scripts, AI skills, library folders, plus clip probing |
| `src/legacy/shell.js` | Window manager, dock, ⌘K launcher, theme, icons |
| `src/a11y/focus-work.js` | The live region, the focus trap, and arrow-key movement |
| `src/legacy/camera.js` | Stream acquisition, recording, prompter marks |
| `src/legacy/editor.js` | Timeline, playback, grading, canvas export, composition views |
| `src/legacy/scripts-app.js` | Script folder, Draft and Shot list, research, teleprompter |
| `src/legacy/skills.js` | Craft notes; the style ones apply to the timeline |
| `src/legacy/aiskills.js` | The AI Skills folder: SKILL.md parsing, triggers, matching |
| `src/legacy/main.js` | Readme documents, app registration, boot |

The composition engine, which owns everything layered over the cut:

| File | Contents |
|---|---|
| `src/comp/engine.js` | Frames, `interpolate`, `spring`, easings, `Sequence` resolution, formats |
| `src/comp/paint.js` | Canvas primitives in the house form language; the palette roles |
| `src/comp/components.js` | The fourteen graphics, each a pure function of its own frame |
| `src/comp/composition.js` | The document, and the checking of anything proposed into it |
| `src/comp/store.js` | Staging and the trusted-gesture guard |
| `src/comp/render.js` | Draws one frame. Called by the preview *and* the export |
| `src/comp/audio.js` | Synthesised effects, and a bed that ducks itself under speech |
| `src/comp/codegen.js` | Prints the composition as TSX, for `get_composition_code` |
| `src/transcript/transcript.js` | Word timing from prompter marks; search, fillers, dead air |
| `src/transcript/store.js` | Caching, persistence onto the clip, the API key |
| `src/transcript/whisper.js` | The optional measured-timing upgrade |
| `src/cuts/store.js` | Staged cuts; `applyCut` splits a segment |

And the agent's side of the page:

| File | Contents |
|---|---|
| `src/webmcp/tools.js` | The desktop, camera, scripts and graphics tools |
| `src/webmcp/comp-tools.js` | Composition, transcript and cut tools |
| `src/webmcp/register.js` | Host detection, registration, per-call instrumentation |
| `src/webmcp/result.js` | The one envelope every tool returns, and the hint on a refusal |
| `src/webmcp/status.js` | Host, tool count and call count, for the badge |
| `src/webmcp/nudge.js` | Offering a matching AI Skill back inside a tool result |
| `src/webmcp/StatusBadge.jsx` | Whether a host is present, and whether it has called anything |
| `src/agent/Ghost.jsx` | The ghost, and a line for every call that actually happened |
| `src/agent/Presence.jsx` | Whether an agent is watching, and what it last touched |
| `src/agent/toolLabels.js` | What to call each tool in front of a person |
| `src/graphics/` | The six-type declarative graphics layer and its renderer |
| `src/scripts/proposals.js` | Lines staged into a draft, and the trusted-gesture guard |
| `src/folders/` | Folders the agent offers, and the picker that authorises one |
| `src/skills/signals.js` | What the page can say about its own situation, for skill triggers |

## Notes on the build

Vite, React and Tailwind. Tailwind is **utilities only, no preflight**: `src/styles/desk.css`
is a complete hand-built design system with its own light and dark themes, and layering a
second reset on top of it would quietly change every margin and border in the app.

The window manager and the original apps live in `src/legacy/` and are still imperative DOM.
Dragging, z-order, focus and the animation that flies a window out of its icon's bounding rect
already work; React owns the chrome, the agent surfaces and the status badge.

`shell.js` resolves `#desktop` the moment it is evaluated, so the legacy modules are
imported dynamically after React's first paint. Anything that pulls them in statically
breaks the boot.
