# Deskmate

**A whole content studio in one browser tab where an AI agent and a human can work together inside it.**
Write the script, read it off the teleprompter while the camera rolls and edit it with an
agent on the same surface as you the entire time, through **WebMCP**.

![The Deskmate desktop: a menubar reading "28 tools ready", five icons for Readme, Scripts, Skills, Camera and Editor over a valley at dusk](assets/Readme_picture.png)

**Try it:** <https://deskmate-cc.vercel.app> · **Submission:** [The WebMCP Challenge](https://webmcp.devpost.com) · **Build:** [architecture notes](docs/ARCHITECTURE.md)

---

## Features

Five apps, each in a window you can drag, stack, resize, minimise and close.

### Scripts

- A script is a list of lines. Each line carries the **spoken text** and an optional **shot
  direction**: where the camera is, what the b-roll is, what the tone should be.
- Two views of one document. A **Draft** you write in, and a **Shot list** for the pass before
  you shoot.
- A **Research** pane for links and notes you gathered while browsing.
- Runtime is estimated at 2.5 words per second (about 150 wpm, an unhurried pace) and totalled
  across the script, so you know how long the video is before you shoot it.
- The Draft does not wrap, so one line of the document is exactly one row on screen. That is
  what lets a suggestion from an agent sit at the line it is aimed at.

### Teleprompter

- Scrolls the whole script across roughly its estimated runtime, brightening the line you
  should be on.
- Speed control while it runs, 0.4x to 2.5x. Space pauses it.
- Opens as its own window for rehearsal, or runs over the camera preview while you record.
- **Records which line was on screen at which second.** That log is what the transcript gets
  built from later, and it is the most interesting thing in the app.

### Camera

- Camera or screen capture, with your mic mixed into either, so a tutorial is one take rather
  than two files to line up.
- A constraint ladder that falls back through resolutions instead of failing outright, and a
  device picker so you choose which camera.
- The teleprompter runs over the preview, and three states are readable while you shoot: idle,
  armed (a stream is live but nothing is being kept) and recording, with the elapsed seconds.
- Takes land straight in the Editor's library, named and measured.
- Releases the camera when the window is minimised, so the light goes out when you expect it to.

### Editor

- Lanes of clips, graphics and sound in one timebase: **V1** for the spine, video lanes above
  it, **A1** for sound.
- Trim, split, drag to reorder with a snap and a marker showing where it lands, inline rename,
  and delete with Backspace or a right-click.
- **Six looks**: none, mono, warm, cool, punch, faded. Plus speed and per-clip volume.
- **Four transitions**: dip to black, dip to white, flash, dip to accent.
- **Transform with keyframes**: position, scale, rotation, and horizontal or vertical flip.
- **Three frame shapes**: 16:9, 9:16 and 1:1, each with fill, fit, or drag the picture to
  choose what stays in frame.
- **Unlink sound from picture** onto its own audio lane, where it gets its own position, trim
  and volume, so a line can run under the next shot. Relink puts it back.
- **Undo and redo** over the cut, with Ctrl+Z and Ctrl+Shift+Z.
- Left rail: library, text, transitions, transcript. Right rail: clip, motion, composition.
- One orange **Import** takes video and audio together; the file's own type decides which it is.
- **Export** replays the cut into a canvas at the composition's size, mixes the audio back
  through Web Audio and records it with `MediaRecorder`. No encoder dependency, so rendering is
  real time. It lands back in your library and as a download.

### Skills

- **Craft notes** in three kinds, cut, edit and style, eight in total. The style notes carry an
  **Apply** button that sets that look and speed on the last clip on the timeline, so the
  reference is usable rather than only readable.
- **AI Skills**: a folder of markdown an agent can load and follow. Six ship with the app and
  you can write your own. This is the part worth reading about below.

### The desktop itself

- Windows fly out of the icon you clicked and reverse back into it on close. Folders hinge
  open, apps press in.
- A dock, a ⌘K launcher that searches documents, scripts and clips, and light and dark themes.
- A **Permissions** chip in the menubar, one light per thing the browser is allowed to refuse.
- A **Readme** folder of seven documents, plus a guided tour per window.
- Arrow keys walk the desktop icons, F6 cycles open windows, Escape closes the top one, and
  `prefers-reduced-motion` turns all of it off.

## WebMCP and AI integration

**28 site tools**, registered on `document.modelContext.registerTool` with a
`navigator.modelContext` fallback for Chrome's origin trial. 17 read, 11 propose. Every schema
sets `additionalProperties: false`, and every read tool carries `readOnlyHint`.

Most of them are the scripting API this app already handed to *human*-written scripts,
described in JSON Schema and given to an agent instead of to a text editor.

**What the agent can reach that nothing off-page can:**

| | |
|---|---|
| Mid-take | Which prompter line you are on, and how many seconds in |
| Mid-sentence | The line you are still typing, before you save it |
| Mid-edit | The selected clip, the playhead, the words under it, the layers over it |

Clips are Blobs in IndexedDB. The timeline is an array in a closure. The elapsed second is a
running interval. **There is no backend**, so nothing is uploaded, and a server-side MCP has
nothing to connect to in the first place.

And the tools do not only *read* that state, they write back into the window you are looking
at. A proposal is not a chat message describing a graphic. It is a dashed overlay on the actual
frame, animating live, next to an Accept button.

### The line the agent does not cross

**No tool accepts a proposal, exports a video, or reads a file.** Every accept path refuses
anything that is not a trusted browser event, which is the same mechanism the browser itself
uses to tell a real click from a script.

> The agent can compose an animated title card, put a synthesised thump under it, reframe the
> whole cut to 9:16 and list every "um" in the take, four calls, and still cannot put one frame
> into your video.

It can write a line into your draft and cannot change a word of it. It can *offer* you a
folder, and the directory picker that opens is your permission, not its own.

### Watching it work

A **ghost** names each tool as it is called, a cursor springs to the surface that call actually
touched and presses it, and the menubar badge tells "ready" from "connected" on purpose. All of
it is driven by real calls, never simulated.

## What makes this different

Three things, and the first is the one we would point at.

### 1. AI Skills, so the agent already knows how to use this app

This is the part we have not seen in another WebMCP project. **Tools tell an agent what it
*can* do. They say nothing about how this app wants it done.** So a folder of markdown does
that instead.

An AI Skill is a `.md` file with frontmatter, in the SKILL.md convention agents already
understand:

```markdown
---
name: Motion graphics that look designed
description: Use whenever you are asked for a title, an animation, an infographic, a stat...
triggers: timeline_has_clips, graphic, animate, motion, title, keynote, slop
---

The body: exact recipes, the house rules, and what never to do.
```

**Skills fire on their own.** A trigger is either a signal the page computes about itself, or a
word to look for in what you actually wrote:

| Trigger kind | Examples |
|---|---|
| A signal the page computes | `timeline_has_clips`, `research_has_url`, `recording`, `script_empty`, `graphics_pending` |
| A word in what you wrote | `glassmorphic`, `hook`, `youtube`, `slop`, `infographic` |

When one matches, **every read tool starts carrying the suggestion in its own result**, along
with the line: *"The person left these instructions for this exact situation. Their instruction
for how they want this done beats your default."* A skill that has already been loaded stops
being offered, so the nudge never turns into noise.

Paste a YouTube link into Research and the next tool the agent calls tells it to read *Turn a
link into a script*. Ask for a title over a timeline that has clips on it and it is told to
read *Motion graphics that look designed* before it answers.

**Six ship with the app:**

| Skill | Fires when |
|---|---|
| Hook in the first three seconds | Your script has lines, or you say "hook", "opening", "intro" |
| Turn a link into a script | Your Research pane has a URL in it |
| Building a motion graphics clip | Your timeline has clips and you ask for a graphic |
| Taste, not slop | You ask for copy, a headline or a caption, or you say "generic" |
| Motion graphics that look designed | Any graphic ask. Exact recipes, so the result reads like a keynote and not a template |
| Loud looks: glass and maximalist | You ask for "glassmorphic", "maximalist", "vaporwave", "y2k", "wildly different" |

**And you write your own.** Drag a `.md` onto the folder, press Add, or press New and write one
in the app: your house style, your client's brand, the way you want your lower thirds worded.
It is saved in your browser, and the next agent to read this page follows it.

That is the claim worth testing. **ChatGPT turns up already knowing how to use this app, and
you can teach it more yourself without touching a line of code.**

### 2. Motion graphics, from a spec the agent fills in

A video editor an agent can drive is one thing. One that can *design* is another.

The agent never writes CSS, SVG or JavaScript. It fills in a constrained declarative object,
and one render function draws that object twice: onto a transparent canvas over the preview,
and onto the canvas the export is recording. Same function, same spec, same pixels, so what you
approve is exactly what gets written to the file.

- **Fourteen components**: title card, lower third, caption pop, bullet list, comparison cards,
  process flow, stat badge, callout arrow, progress bar, code card and quote card, plus three
  free-form ones: **text** you style completely, a **shape** in eight kinds, and a full-frame
  **effect** (dip, flash, vignette, grain, scanlines, glitch, letterbox, wash).
- **Integer frames at 30fps**, so a frame renders the same every time it is asked for, and the
  export can draw frame 512 without having drawn 511.
- **`interpolate` and `spring`** are pure functions of the frame, so nothing gets out of step
  when the playhead jumps.
- **Colour is a role by default.** `accent` resolves against the live theme, so one spec stays
  legible in light and dark. A hex is accepted where a person has picked one deliberately.
- **Geometry is normalised**, so a graphic approved on a 468px preview is correct in a 4K
  export, and reframing to 9:16 moves no layer.
- **Synthesised sound**: six effects generated in Web Audio, plus a music bed that ducks itself
  under speech.

### 3. The teleprompter is also the transcript

The prompter does double duty. Every take records which script line was on screen at which
second, so that log plus the script gives you a transcript without uploading anything: we know
what was said, because you read it, and roughly when, because we watched you advance it. Words
are spread across their line by length.

It is an estimate and it says so, marked `source: "prompter"` and `approximate: true`. Usually
that is enough to find a phrase and land a graphic on it. For measured per-word timing, paste
your own OpenAI key into the Transcript panel and any clip re-transcribes with Whisper. The key
stays in this browser's `localStorage` and is sent nowhere but `api.openai.com`.

Either way, the useful part is that the timing lives in the page, in **cut** seconds, already
adjusted for every trim, reorder and speed change. Ask for **"a list over the bit where I say
three things"** and the agent queries the page for that quote and gets frames back, rather than
inferring it from pixels. That is what a server-side tool has no route to, because the prompter
and the clicks that moved it never left this tab.

It also turns the Transcript tab into a way of *moving* rather than reading: every word is a
button that seeks to it, fillers are struck through, and gaps over a second are called out
inline.

## Judging it in five minutes

Open the site in **ChatGPT's browser**, or Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`. The menubar badge says whether a host is attached and
whether it has actually called anything.

1. **Record ten seconds.** Open **Scripts**, pick the sample, open **Camera**, load the script,
   hit record and read a line off the prompter. Stop.
2. **Open the Editor.** Your take is on the timeline. Click the **Transcript** tab in the left
   rail; the words are already timed. Click one and the playhead goes to it.
3. **Paste this to the agent:**

   > *Look at my timeline, then build me an opening title sequence. Give me a title card, a
   > lower third with my name, and a stat badge, and put each one on a real moment in the
   > transcript rather than all at the start. Add a whoosh under the title. Then show me what it
   > would look like as a 9:16 short.*

4. **Watch the proposals arrive dashed** on the timeline, previewing live. Accept one, reject
   one. Then ask it to **"hold the title two seconds longer"**: it reads back what you kept and
   changes only that. This compounding turn is the whole argument.
5. **Ask it to "tidy up the ums."** One call marks every hesitation and every silence, each
   with its own reason, to take or leave one at a time.
6. **Then ask for a look**: *"redo the title, but make it glassmorphic"*, or *"go maximalist"*.
   A skill fires on those words and hands the agent an exact recipe, which is the difference
   between an agent that can call your tools and one that knows your app.
7. **Export.** It replays into a canvas in real time and lands back in your library.

## Run it

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # static output in dist/, deploys as-is
```

Camera and screen capture need a secure context, so `https://` or `localhost`.

No framework for the design system, no component library, no encoder dependency. Vite, React
for the chrome, Tailwind utilities only, and vanilla DOM for the desktop itself.

## More

- [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) for every tool, the composition engine, how
  transcripts are derived, how export works, and a map of every file.
- The **Readme** folder inside the app is the same story, written for whoever is using it.

## Licence

MIT. See [LICENSE](LICENSE).
