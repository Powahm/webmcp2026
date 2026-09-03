import { Store } from "./store.js";
import { Desk } from "./shell.js";

/**
 * AI Skills — instructions this page hands to whatever agent is reading it.
 *
 * The honest framing matters here, because the obvious description of this is
 * wrong. A web page cannot install anything into ChatGPT. There is no API for
 * it, and there should not be: a site that could permanently modify the agent
 * visiting it is a security hole, not a feature.
 *
 * What a page *can* do is answer well. A skill is only ever instructions, so if
 * the agent asks for them and gets them, it has them for the rest of the
 * session and behaves accordingly. That is loading, not installing, and it is
 * exactly how skills work everywhere else: a cheap index of names and
 * descriptions that is always safe to read, and a full body fetched only when
 * one is actually relevant.
 *
 * So this folder exposes two tools and nothing else. `list_ai_skills` is the
 * index. `load_ai_skill` is the body. The agent decides when to reach for one,
 * the same way it decides when to call any other tool, and the page shows the
 * person which ones it took.
 *
 * The file format is the SKILL.md convention, because that is what agents
 * already read: YAML frontmatter carrying `name` and `description`, then a
 * markdown body. A file without frontmatter still works — the name comes from
 * the filename and the description from the first line — because someone
 * dropping a plain note in here should not have to know any of that.
 */

export const TINT = "#7B5EA7";

/** Skills the agent has pulled this session. Cleared on reload, like the agent's own memory of them. */
const loaded = new Map();
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const onAiSkills = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const markLoaded = (id) => {
  loaded.set(id, Date.now());
  emit();
};
export const loadedAt = (id) => loaded.get(id) || null;

/**
 * Read YAML frontmatter, shallowly.
 *
 * Deliberately not a YAML parser. A skill's frontmatter is a handful of
 * `key: value` lines, and pulling in a parser to read them would be a
 * dependency for nothing.
 */
export function parseSkill(filename, raw) {
  const text = String(raw).replace(/\r\n/g, "\n");
  let meta = {};
  let body = text;

  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (match) {
    body = text.slice(match[0].length);
    for (const line of match[1].split("\n")) {
      const at = line.indexOf(":");
      if (at < 1) continue;
      const key = line.slice(0, at).trim();
      let value = line.slice(at + 1).trim();
      if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
      meta[key] = value;
    }
  }

  const stem = filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  const firstLine = body.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) || "";

  return {
    id: `skill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    filename,
    name: (meta.name || stem || "Untitled skill").slice(0, 80),
    description: (meta.description || firstLine).slice(0, 400),
    /**
     * When this skill is worth loading, as a list of tokens.
     *
     * A token is either a signal the page can compute about itself
     * (research_has_url, timeline_empty, recording) or a plain word to look for
     * in what the person has actually written. Both matter: the first catches
     * the situation, the second catches the subject.
     *
     * A skill with no triggers is still listed and still loadable. It just
     * never volunteers itself, which is the right default for a skill whose
     * author did not say when it applies.
     */
    triggers: String(meta.triggers || "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
    body: body.trim(),
    words: body.trim().split(/\s+/).filter(Boolean).length,
    // Anything else in the frontmatter is kept and handed back verbatim: a
    // skill written for another host may carry fields this app knows nothing
    // about, and dropping them would quietly break it.
    meta,
    created: Date.now(),
  };
}

export const allSkills = () => Store.all("aiskills");

/**
 * Which skills fit what is happening on the page right now.
 *
 * This is the part that stops a skills folder being decoration. A skill nobody
 * loads is a file, not a capability, and an agent cannot be expected to guess
 * that the person wrote something about summarising links three windows ago. So
 * the page watches its own state and volunteers the match, in the result of
 * whatever tool the agent happened to call.
 *
 * Suggesting is all it does. The agent still decides whether to load, the same
 * way it decides everything else, and a skill already loaded stops being
 * offered so the nudge does not become noise.
 */
export function matchSkills(skills, { signals = {}, text = "" }) {
  const haystack = String(text).toLowerCase();
  return skills
    .map((skill) => {
      const hits = (skill.triggers || []).filter((t) =>
        t in signals ? signals[t] : t.length > 2 && haystack.includes(t)
      );
      return hits.length ? { skill, hits } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.hits.length - a.hits.length);
}
export const addSkill = (skill) => Store.put("aiskills", skill);
export const removeSkill = (id) => Store.del("aiskills", id);

const EXAMPLE = `---
name: Hook in the first three seconds
description: Use when writing or reviewing the opening of a short-form video, or when the creator says the start feels slow.
triggers: script_has_lines, hook, opening, intro
---

# Hook in the first three seconds

Most viewers decide in about three seconds. The opening line has to be the
interesting thing itself, not an introduction to the interesting thing.

## What to do

- Open on the claim, the number or the result. Never on "hi guys" or "in this video".
- Cut the throat-clear. If the first line still works with its first four words
  deleted, delete them.
- Put the most specific noun you have in the first sentence.
- If there is a surprising figure anywhere in the script, it belongs at the top.

## What to avoid

- A question the viewer does not already care about.
- Anything that describes the video rather than being the video.
- Naming yourself before you have earned twenty seconds of attention.

## Applying it here

Read the open script with get_open_script. If line 0 is a greeting or a
preamble, propose a replacement with propose_script_line using mode "replace",
built from a fact already in their research. Say what you changed and why.
`;

const FROM_A_LINK = `---
name: Turn a link into a script
description: Use when there is a URL in the research notes and the script is empty or thin, or when the creator asks for a link to be summarised into something they can say out loud.
triggers: research_has_url, summarise, summarize, article, youtube, video essay
---

# Turn a link into a script

A summary is not a script. A summary is what the page said; a script is what
they are going to say, out loud, to a camera, in their own voice.

## The method

1. Read the research with get_open_script. Work only from what is in there.
   If the notes are a bare URL with nothing under it, say so and ask them to
   paste the part that mattered rather than guessing at the contents.
2. Find the one claim worth the video. Not the summary of the whole piece: the
   single fact that made them save the link.
3. Open on that claim. The first line is the interesting thing itself, never an
   introduction to it.
4. Write four to six beats. One idea per beat, each short enough to say in one
   breath. Contractions. Second person. No lists read aloud.
5. Give every beat a shot direction: to camera, b-roll, screen recording,
   what is on screen while they say it.
6. End on the consequence, not on a sign-off.

## Writing it in

Use propose_script_line, one call per beat, in order, with mode "insert" and an
index that puts each line where it belongs. Give a reason naming the part of
their research it came from. Do not write the whole thing in one call, and do
not touch lines they already wrote unless you are proposing a replacement and
say so.

## What not to do

- Do not invent a figure that is not in their notes.
- Do not open with "in this video" or their own name.
- Do not write more than about sixty seconds of speech unless they asked for it.
`;


const MOTION = `---
name: Building a motion graphics clip
description: Use whenever you are asked for graphics, an animation, a title, an infographic or a lower third over a cut. It is how this editor wants motion graphics built.
triggers: timeline_has_clips, graphic, graphics, animation, animate, motion, title, infographic, lower third, callout, stat, list, overlay
---

# Building a motion graphics clip

Everything you compose lands inside a **motion graphics clip**: a span of the cut
that holds its elements, that a person opens and edits on its own timeline.
Getting the containers right is most of the job. A clip with six elements piled
onto the same second is the failure this file exists to prevent.

## Work in passes, not in one call

1. **Read first.** \`get_composition\` for what is already there and the ids, and
   \`get_transcript\` when the ask refers to something said, so the seconds come
   from the words rather than from a guess.
2. **Make the container.** If the graphics are a sequence of their own rather
   than a caption over footage, call \`propose_blank_clip\` and build inside it.
   A clip of its own is cheap. Two ideas sharing one clip is not.
3. **One element per call**, in the order they appear.
4. **Sound under each one**, immediately after it. See below.
5. **Stop.** Do not also reframe, tidy or cut unless that is what was asked.

## Timing: nothing starts at the same second as anything else

- Stagger the starts. **0.25 to 0.4 seconds apart** is the readable range. If
  three rows land together the eye has nowhere to go.
- Give each element a real dwell. **1.5 to 3 seconds** for anything with words in
  it, and never under 0.8 seconds.
- An element may overlap the one before it, and normally should. What it must
  not do is *start* at the same moment.
- Keep everything inside the clip. An element that runs past the end of the clip
  it belongs to is drawn on whatever follows, which is almost never intended.

## Space: two elements never share a position

Positions are \`upper_left\`, \`upper_right\`, \`lower_left\`, \`lower_right\`,
\`center\`, \`top_bar\`, \`bottom_bar\`.

- **One element per position at a time.** Before you place a second element at
  \`center\`, check the first has ended.
- \`center\` is for one thing only, and it is usually the title.
- A lower third belongs at \`lower_left\`; a stat badge at \`upper_right\`; a
  caption at \`bottom_bar\`. Do not stack two of those in one corner.
- Use a component that already contains its own layout instead of assembling one
  out of loose parts. \`bullet_list\` is one element that lays out four rows.
  Four \`text\` layers at the same moment are four things fighting.

## Which component

| You want | Use |
|---|---|
| An opening title | \`title_card\` at \`center\` |
| Someone's name and role | \`lower_third\` at \`lower_left\` |
| A spoken phrase punched up | \`caption_pop\` at \`bottom_bar\` |
| Three or four points | \`bullet_list\`, one call, not one per row |
| This versus that | \`comparison_cards\` |
| Steps in order | \`process_flow\` |
| A single number | \`stat_badge\` at \`upper_right\` |
| Pointing at something on screen | \`callout_arrow\` |
| A quote | \`quote_card\` |
| A cut to black, a flash | \`effect\` |

## Sound is part of the graphic

**Every element you propose gets a sound under it**, in the same pass, at the
same \`at_seconds\`. A graphic that appears in silence reads as a still.

| Element | Sound |
|---|---|
| \`title_card\`, \`quote_card\` | \`hit\` |
| a row of a list, \`caption_pop\` | \`pop\` |
| anything sliding in from an edge | \`whoosh\` |
| building to a reveal | \`riser\` |
| a step in a process, a counter | \`tick\` |
| a result, a total, a good number | \`chime\` |

Call \`propose_sound\` with \`kind: "sfx"\`. One per element, not one per clip, and
not one under every frame of a bed.

## Colour

\`palette_role\` is one of \`accent\`, \`warm\`, \`cool\`, \`positive\`, \`plain\`,
\`invert\`. Spend \`accent\` once per clip, on the thing that matters most.
Everything else is \`plain\` unless it means something: \`positive\` for a good
number, \`invert\` for a dip to black.

## Say what you did

Every proposal takes a \`reason\`. Say what it is for in the person's own terms —
"the three points you list at 0:14" — not "added a bullet list". They are reading
the reason to decide, and there is no tool that decides for them.
`;

/**
 * Three skills to start with, so the folder is never a blank page.
 *
 * Missing ones are added rather than the whole set being skipped when anything
 * is there. Bailing on the first existing skill meant a browser that had opened
 * an older build never saw a skill added since, which is a bug you only find
 * on the machine you have been testing on all week.
 */
export async function seed() {
  const existing = await Store.all("aiskills");
  const have = new Set(existing.map((s) => s.filename));
  const stock = [
    ["hook-in-three-seconds.md", EXAMPLE],
    ["link-to-script.md", FROM_A_LINK],
    ["building-a-motion-graphics-clip.md", MOTION],
  ];
  for (const [filename, body] of stock) {
    if (!have.has(filename)) await addSkill(parseSkill(filename, body));
  }
}

/* ---------------- the window ---------------- */

export function open(origin) {
  Desk.openWindow({
    id: "aiskills",
    title: "AI Skills",
    meta: "for the agent",
    tint: TINT,
    size: { w: 760, h: 620 },
    origin,
    build(body, win) {
      body.className = "win-body ais";
      body.innerHTML = `
        <div class="ais-bar">
          <p class="ais-lede">
            Markdown dropped here is offered to whatever agent is reading this page.
            It asks for the index, then pulls in a skill when one is relevant.
          </p>
          <button class="btn btn-mini" data-act="add">Add .md</button>
          <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden data-act="file">
        </div>
        <div class="ais-drop"><div class="ais-list"></div></div>`;

      const list = body.querySelector(".ais-list");
      const drop = body.querySelector(".ais-drop");
      const fileInput = body.querySelector('[data-act="file"]');

      async function render() {
        const skills = await allSkills();

        // The same match the tool layer makes, shown to the person, so they can
        // tell whether a skill they wrote will ever actually fire. A trigger
        // that never matches is the commonest way one of these files ends up
        // being dead weight.
        let matching = new Set();
        try {
          const { currentSignals } = await import("../skills/signals.js");
          matching = new Set(matchSkills(skills, await currentSignals()).map((m) => m.skill.id));
        } catch { /* the desktop is mid-boot; the list still renders */ }

        win.setMeta(`${skills.length} skill${skills.length === 1 ? "" : "s"}`);
        list.innerHTML = skills.length
          ? skills
              .map((s) => {
                const when = loadedAt(s.id);
                const now = matching.has(s.id);
                return `
                  <article class="ais-card ${when ? "used" : now ? "ready" : ""}" data-skill="${s.id}">
                    <header class="ais-card-head">
                      <span class="ais-card-name">${Desk.esc(s.name)}</span>
                      <span class="ais-card-file mono">${Desk.esc(s.filename)}</span>
                    </header>
                    <p class="ais-card-desc">${Desk.esc(s.description || "No description.")}</p>
                    <footer class="ais-card-foot">
                      <span class="mono">${s.words} words</span>
                      ${
                        when
                          ? `<span class="ais-card-used">the agent loaded this</span>`
                          : now
                            ? `<span class="ais-card-ready">fits what you are doing now</span>`
                            : s.triggers.length
                              ? `<span class="ais-card-idle">waiting for ${Desk.esc(s.triggers.slice(0, 2).join(" or "))}</span>`
                              : `<span class="ais-card-idle">no triggers, load on request only</span>`
                      }
                      <button class="btn btn-mini btn-danger" data-remove="${s.id}">Remove</button>
                    </footer>
                  </article>`;
              })
              .join("")
          : `<p class="ais-empty">Nothing here yet. Drop a <code>.md</code> file in, or press Add.<br>
             Frontmatter with <code>name</code> and <code>description</code> is read if it is there, and worked out from the file if it is not.</p>`;
      }

      async function ingest(files) {
        let added = 0;
        for (const file of files) {
          if (!/\.(md|markdown|txt)$/i.test(file.name)) continue;
          await addSkill(parseSkill(file.name, await file.text()));
          added += 1;
        }
        if (added) Desk.toast(`${added} skill${added === 1 ? "" : "s"} offered to the agent`, "good");
        else Desk.toast("Markdown files only.", "bad");
        render();
      }

      body.addEventListener("click", async (e) => {
        if (e.target.closest('[data-act="add"]')) return fileInput.click();
        const gone = e.target.closest("[data-remove]");
        if (gone) {
          await removeSkill(gone.dataset.remove);
          render();
        }
      });

      fileInput.addEventListener("change", () => {
        ingest([...fileInput.files]);
        fileInput.value = "";
      });

      ["dragenter", "dragover"].forEach((type) =>
        drop.addEventListener(type, (e) => {
          e.preventDefault();
          drop.dataset.over = "true";
        })
      );
      ["dragleave", "drop"].forEach((type) =>
        drop.addEventListener(type, (e) => {
          e.preventDefault();
          drop.dataset.over = "false";
        })
      );
      drop.addEventListener("drop", (e) => ingest([...(e.dataTransfer?.files || [])]));

      const off = onAiSkills(render);
      const offStore = Store.on("aiskills", render);
      win.onCleanup(() => { off(); offStore(); });

      render();
    }
  });
}
