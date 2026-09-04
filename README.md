# Deskmate

**A whole video studio in one browser tab, built so an AI agent can work inside it.**
Write the script, read it off the teleprompter while you record, cut what you shot — with an
agent on the same surface as you the entire time, through **WebMCP**.

![The Deskmate desktop: a menubar reading "28 tools ready", five icons for Readme, Scripts, Skills, Camera and Editor over a valley at dusk](assets/Readme_picture.png)

**Try it:** <https://deskmate-cc.vercel.app> · **Submission:** [The WebMCP Challenge](https://webmcp.devpost.com) · **Build:** [architecture notes](docs/ARCHITECTURE.md)

---

## Where the timings come from

The teleprompter does double duty. Every take records which script line was on screen at which
second, so that log plus the script gives you a transcript without uploading anything: we know
what was said, because you read it, and roughly when, because we watched you advance it. Words
are spread across their line by length.

It's an estimate and it says so — transcripts derived this way are marked `source: "prompter"`
and `approximate: true`. Usually that's enough to find a phrase and land a graphic on it. For
measured per-word timing, paste your own OpenAI key into the Transcript panel and any clip
re-transcribes with Whisper; the key stays in this browser's `localStorage` and is sent nowhere
but `api.openai.com`.

Either way, the useful part is that the timing lives in the page. Ask for **"a list over the
bit where I say three things"** and the agent queries the page for that quote and gets frames
back, rather than inferring it from pixels — and that's the part a server-side tool has no
route to, because the prompter and the clicks that moved it never left this tab.

## What the agent can reach that nothing off-page can

| | |
|---|---|
| Mid-take | Which prompter line you're on, and how many seconds in |
| Mid-sentence | The line you're still typing, before you save it |
| Mid-edit | The selected clip, the playhead, the words under it, the layers over it |

Clips are Blobs in IndexedDB. The timeline is an array in a closure. The elapsed second is a
running interval. **There is no backend** — nothing here is uploaded, and a server-side MCP
has nothing to connect to.

And the tools don't just *read* that state, they write back into the window you're looking at.
A proposal isn't a chat message describing a graphic. It's a dashed overlay on the actual
frame, animating live, next to an Accept button.

## The line the agent does not cross

**No tool accepts a proposal, exports a video, or reads a file.** Every accept path refuses
anything that isn't a trusted browser event — the same mechanism the browser itself uses to
tell a real click from a script.

> The agent can compose an animated title card, put a synthesised thump under it, reframe the
> whole cut to 9:16 and list every "um" in the take — four calls — and still cannot put one
> frame into your video.

It can write a line into your draft and cannot change a word of it. It can *offer* you a
folder; the directory picker that opens is your permission, not its own.

## Judging it in five minutes

Open the site in **ChatGPT's browser** (or Chrome 149+ with
`chrome://flags/#enable-webmcp-testing`). The menubar badge says whether a host is attached
and whether it has actually called anything — "ready" and "connected" are deliberately
different words.

1. **Record ten seconds.** Open **Scripts**, pick the sample, open **Camera**, load the
   script, hit record and read a line off the prompter. Stop.
2. **Open the Editor.** Your take is on the timeline. Click the **Transcript** tab in the left
   rail — the words are already timed. Click one; the playhead goes to it.
3. **Paste this to the agent:**

   > *Look at my timeline, then build me an opening title sequence. Give me a title card, a
   > lower third with my name, and a stat badge — put each one on a real moment in the
   > transcript, not just at the start. Add a whoosh under the title. Then show me what it
   > would look like as a 9:16 short.*

4. **Watch the proposals arrive dashed** on the timeline, previewing live. Accept one, reject
   one. Then ask it to **"hold the title two seconds longer"** — it reads back what you kept
   and changes only that. This compounding turn is the whole argument.
5. **Ask it to "tidy up the ums."** One call marks every hesitation and silence, each with its
   own reason, to take or leave one at a time.
6. **Export.** It replays into a canvas in real time and lands back in your library.

Want a wilder look? Ask for **"something glassmorphic"** or **"go maximalist"** — a dropped-in
AI Skill fires on those words and hands the agent an exact recipe.

## Inside the machine

**Five apps** — Readme, Scripts, Skills, Camera, Editor — each in a window you can drag,
stack, resize and minimise.

**28 site tools** on `document.modelContext.registerTool`, with a `navigator.modelContext`
fallback. 17 read, 11 propose. Every schema sets `additionalProperties: false`; every read
tool carries `readOnlyHint`. Most of them are the scripting API this app already handed to
*human*-written scripts, described in JSON Schema and given to an agent instead.

**A composition engine** in ~3,000 lines, because a static site can't run a React video
framework's Node renderer. Integer frames at 30fps, time-shifting `Sequence` nodes, animation
as a pure function of the frame, and **fourteen graphics components**. One render function
draws both the preview and the export, so what you approve is exactly what gets written to
the file.

**AI Skills that fire on their own.** Drop in markdown with `triggers` in the frontmatter, and
when the situation matches, *every* read tool starts carrying the suggestion in its result. A
skill nobody loads is a file, not a capability.

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

- [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) — every tool, the composition engine, how
  transcripts are derived, how export works, and a map of every file.
- The **Readme** folder inside the app is the same story written for whoever is using it.

## Licence

MIT. See [LICENSE](LICENSE).
