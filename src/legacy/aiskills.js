import { Store } from "./store.js";
import { Desk } from "./shell.js";
import DESIGNED from "../skills/motion-graphics-that-look-designed.md?raw";

/**
 * AI Skills: instructions this page hands to whatever agent is reading it.
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
 * markdown body. A file without frontmatter still works: the name comes from
 * the filename and the description from the first line, because someone
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

/**
 * Records written by an older build can predate a field. A skill saved before
 * `triggers` existed has none, and the window's render read `.length` off it,
 * threw, and left the list blank under a title that still said "5 skills".
 * Fill in what is missing from what is there, so an old record reads the same
 * as a new one everywhere downstream.
 */
function normalise(skill) {
  const body = String(skill.body ?? "");
  return {
    ...skill,
    filename: skill.filename || "skill.md",
    name: skill.name || "Untitled skill",
    description: skill.description || "",
    triggers: Array.isArray(skill.triggers) ? skill.triggers : [],
    body,
    words: Number.isFinite(skill.words) ? skill.words : body.split(/\s+/).filter(Boolean).length,
    meta: skill.meta && typeof skill.meta === "object" ? skill.meta : {},
  };
}

/**
 * Rebuild the file text a skill was parsed out of.
 *
 * The store keeps the parsed fields, not the bytes that arrived, so anything
 * that wants to hand the person their file back has to put the frontmatter
 * together again. It is written from the parsed values rather than from `meta`
 * because those are what the rest of the app actually reads, and a file whose
 * `name:` line disagreed with the name on the card would be a trap. Every other
 * key follows verbatim, for the same reason parseSkill kept it.
 */
export function toRaw(skill) {
  const s = normalise(skill);
  const own = new Set(["name", "description", "triggers"]);
  const rest = Object.entries(s.meta).filter(([key]) => !own.has(key));

  // A plain note that declared nothing stays a plain note. Growing a
  // frontmatter block the moment someone opens it would put three lines in
  // front of a person who never asked for any.
  if (!Object.keys(s.meta).length && !s.description) return s.body;

  const front = [`name: ${s.name}`];
  if (s.description) front.push(`description: ${s.description}`);
  if (s.triggers.length) front.push(`triggers: ${s.triggers.join(", ")}`);
  for (const [key, value] of rest) front.push(`${key}: ${value}`);
  return `---\n${front.join("\n")}\n---\n\n${s.body}`;
}

export const allSkills = async () => (await Store.all("aiskills")).map(normalise);

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
\`center\`, \`bottom_bar\`.

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

Every proposal takes a \`reason\`. Say what it is for in the person's own terms:
"the three points you list at 0:14", not "added a bullet list". They are reading
the reason to decide, and there is no tool that decides for them.
`;

const TASTE = `---
name: Taste, not slop
description: Use before writing any headline, label or caption text, or when the creator says a graphic reads flat, generic or "made by AI".
triggers: graphic, graphics, title, headline, copy, caption, text, slop, generic, bland, bullet_list, quote_card, title_card
---

# Taste, not slop

Most of what makes an AI-made interface look AI-made is not available to you here, and that is
deliberate. \`paint.js\` draws flat fills, a 2px ink border and a hard offset shadow with zero blur
-- there is no gradient function in this renderer, no blur, no glassmorphism, because none of those
exist as calls you can make. The type is Bricolage Grotesque over IBM Plex Sans, fixed, not a
choice. The palette is six roles -- \`accent\`, \`warm\`, \`cool\`, \`positive\`, \`plain\`, \`invert\` --
not a colour wheel. You cannot accidentally build the purple-to-blue gradient every AI landing page
reaches for, because the tool you would need to build it does not exist.

That means the slop this file exists to stop is not visual. It is what you still control: the
words, the repetition, and the one door left open into a literal colour.

## The hex door

A \`colour\` prop takes a role or a hex, and a hex is taken at its word -- \`roleColour\` in
\`paint.js\` does not second-guess it. That is the one place you could still hand-build the thing
the renderer was built to prevent: reach for \`#7C3AED\` or \`#3B82F6\` because the phrase in your
head is "make it pop," and you have quietly recreated indigo-to-blue on a page designed never to
have it. Ask what a role already means before naming a hex. Use a literal colour only when the
creator names one -- a brand colour, a hex from their own deck -- never as a synonym for "accent,
but more."

## Words

A caption in a demo video is read in under a second, so it has no room for a word that was already
worn out on every SaaS landing page before this one. Do not write, and reject if you are tidying
someone else's:

| Banned | Because | Say instead |
|---|---|---|
| Elevate, Empower, Unlock, Supercharge, Revolutionize, Streamline | means nothing until it names what changed | the actual thing that changed |
| Seamless, Effortless, Frictionless | a claim, not a fact the viewer can check | the number or the step it removed |
| "Welcome to", "In this video", "Let's dive in" | describes the video instead of being it | open on the claim itself |
| Game-changer, Next-level, Cutting-edge | says nothing a specific noun wouldn't say better | the noun |

A \`stat_badge\` gets a real number, not "many" or "10x faster*" with no source. A \`quote_card\`
gets the actual sentence someone said, not a paraphrase that sounds more like a testimonial. If the
composition has nothing concrete to put in a box, that is a sign the box should not exist yet --
propose fewer elements, not vaguer ones.

## Repetition is the tell

Three identical cards in a row is the single most recognisable AI layout, and this engine can still
produce its version of it: the same component, the same \`palette_role\`, the same position, three
rows of a \`bullet_list\` in the same voice, back to back. Before adding an element, call
\`get_composition\` and look at what is already there in this clip. If the last two elements share a
component and a role, change one of them -- role, position, or which component does the job --
rather than adding a third that matches.

\`accent\` is spent once per clip, per the motion-graphics skill. That rule exists for the same
reason: a graphic where everything is loud is a graphic where nothing is.

## Applying it

Before a \`propose_layer\` or \`propose_blank_clip\` call that carries text: run the copy past the
banned-words table, check whether a hex is standing in for a role that already says what you mean,
and check the last one or two elements in the clip for a repeat you are about to add to. Say what
you avoided in the \`reason\` if it is not obvious -- "kept it to the one stat rather than three
bullets" is as much a design decision as the layer itself.
`;

/**
 * Five skills to start with, so the folder is never a blank page.
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
    ["taste-not-slop.md", TASTE],
    ["motion-graphics-that-look-designed.md", DESIGNED],
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
      body.dataset.view = "list";
      body.innerHTML = `
        <div class="ais-bar">
          <p class="ais-lede">
            Markdown dropped here is offered to whatever agent is reading this page.
            It asks for the index, then pulls in a skill when one is relevant.
          </p>
          <button class="btn btn-mini" data-act="add">Add .md</button>
          <button class="btn btn-mini" data-act="new">New</button>
          <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden data-act="file">
        </div>
        <div class="ais-drop"><div class="ais-list"></div></div>
        <div class="ais-detail"></div>`;

      const list = body.querySelector(".ais-list");
      const drop = body.querySelector(".ais-drop");
      const detail = body.querySelector(".ais-detail");
      const fileInput = body.querySelector('[data-act="file"]');

      /**
       * Which of the two views the window is showing, and what is half-typed
       * into it.
       *
       * It is held here rather than read back off the markup because every
       * write to this store re-renders this window, the person's own save
       * included. Working the mode out from the DOM would mean saving a skill
       * threw them back to the list one keystroke after they asked to keep it.
       */
      let view = { mode: "list", id: null, editing: false, draft: null, caret: null };

      const openDetail = (id) => {
        view = { mode: "detail", id, editing: false, draft: null, caret: null };
        render();
      };
      const showList = () => {
        view = { mode: "list", id: null, editing: false, draft: null, caret: null };
        render();
      };
      const cancelEdit = () => {
        view.editing = false;
        view.draft = null;
        view.caret = null;
        render();
      };

      async function render() {
        const skills = await allSkills();

        // What is in the textarea belongs to the person and is not in the
        // store yet, so a render fired by something else (the seed finishing,
        // a tool writing) has to hand it back rather than wipe it.
        if (view.editing) {
          const live = detail.querySelector(".ais-editor");
          if (live) {
            view.draft = live.value;
            view.caret = [live.selectionStart, live.selectionEnd];
          }
        }

        if (view.mode === "detail") {
          const skill = skills.find((s) => s.id === view.id);
          if (skill) return renderDetail(skill);
          // Removed while it was open, from this window or from anywhere else.
          // There is no file behind the pane any more, and a detail view of
          // nothing is worse than the list.
          view = { mode: "list", id: null, editing: false, draft: null, caret: null };
        }
        return renderList(skills);
      }

      async function renderList(skills) {
        // The same match the tool layer makes, shown to the person, so they can
        // tell whether a skill they wrote will ever actually fire. A trigger
        // that never matches is the commonest way one of these files ends up
        // being dead weight.
        let matching = new Set();
        try {
          const { currentSignals } = await import("../skills/signals.js");
          matching = new Set(matchSkills(skills, await currentSignals()).map((m) => m.skill.id));
        } catch { /* the desktop is mid-boot; the list still renders */ }

        // Working out the matches is a round trip, and a card opened in the
        // meantime has already moved the window on. Do not drag it back.
        if (view.mode !== "list") return;

        body.dataset.view = "list";
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
                      <span class="ais-card-acts">
                        <button class="btn btn-mini" data-open-skill="${s.id}" aria-label="Open ${Desk.esc(s.name)}">Open</button>
                        <button class="btn btn-mini btn-danger" data-remove="${s.id}" aria-label="Remove ${Desk.esc(s.name)}">Remove</button>
                      </span>
                    </footer>
                  </article>`;
              })
              .join("")
          : `<p class="ais-empty">Nothing here yet. Drop a <code>.md</code> file in, press Add, or press New and write one.<br>
             Frontmatter with <code>name</code> and <code>description</code> is read if it is there, and worked out from the file if it is not.</p>`;
      }

      /**
       * One skill, on its own, in the same window.
       *
       * Reading a skill is reading a file, so it is shown as one: the text, in
       * a mono well, exactly as it is written. Nothing renders the markdown,
       * because the agent is handed the same characters and the person should
       * be looking at what the agent gets, not at a prettier version of it.
       */
      function renderDetail(skill) {
        body.dataset.view = "detail";
        // With the list hidden the window's meta line is the only thing naming
        // the file, and knowing which one you are about to rewrite is the point
        // of it.
        win.setMeta(skill.filename);

        const raw = view.draft ?? toRaw(skill);
        const facts = [
          `${skill.words} word${skill.words === 1 ? "" : "s"}`,
          skill.triggers.length
            ? `triggers: ${skill.triggers.join(", ")}`
            : "no triggers, load on request only"
        ];

        detail.innerHTML = `
          <div class="ais-detail-head">
            <button class="btn btn-mini" data-act="back">Back</button>
            <span class="ais-detail-title">
              <span class="ais-detail-name">${Desk.esc(skill.name)}</span>
              <span class="ais-detail-file mono">${Desk.esc(skill.filename)}</span>
            </span>
            <span class="ais-detail-acts">
              ${
                view.editing
                  ? `<button class="btn btn-mini" data-act="cancel">Cancel</button>
                     <button class="btn btn-mini btn-accent" data-act="save">Save</button>`
                  : `<button class="btn btn-mini" data-act="edit">Edit</button>`
              }
            </span>
          </div>
          <p class="ais-detail-desc">${Desk.esc(skill.description || "No description.")}</p>
          <p class="ais-detail-facts mono">${facts.map((f) => `<span>${Desk.esc(f)}</span>`).join("")}</p>
          ${
            view.editing
              ? `<textarea class="ais-body ais-editor" spellcheck="false" aria-label="Text of ${Desk.esc(skill.filename)}" placeholder="---&#10;name: What it is&#10;description: When to use it&#10;triggers: a word, another word&#10;---&#10;&#10;The instructions themselves.">${Desk.esc(raw)}</textarea>`
              : skill.body
                ? `<pre class="ais-body">${Desk.esc(skill.body)}</pre>`
                : `<div class="ais-body ais-body-empty">
                     <p>This file is empty.</p>
                     <p class="ais-body-empty-note">Nothing is offered to the agent until there is something in it.</p>
                     <button class="btn btn-mini btn-accent" data-act="edit">Write it</button>
                   </div>`
          }`;

        if (view.editing) {
          // Editing was asked for, so the caret belongs in the box. Putting it
          // back where it was matters on the renders this window did not start
          // itself, which arrive mid-sentence.
          const box = detail.querySelector(".ais-editor");
          const [from, to] = view.caret || [raw.length, raw.length];
          box.focus({ preventScroll: true });
          box.setSelectionRange(Math.min(from, raw.length), Math.min(to, raw.length));
        }
      }

      async function saveEdit() {
        const box = detail.querySelector(".ais-editor");
        const current = (await allSkills()).find((s) => s.id === view.id);
        if (!box || !current) return render();

        // parseSkill mints a fresh id and a fresh timestamp because it is
        // normally reading a file it has never seen before. This is the same
        // skill, so both are put back: the store key, the position in the list
        // and the "the agent loaded this" marker all hang off that id, and a
        // new one would leave the old record sitting next to it.
        const next = { ...parseSkill(current.filename, box.value), id: current.id, created: current.created };
        view.editing = false;
        view.draft = null;
        view.caret = null;
        await addSkill(next);
        Desk.toast(`${next.filename} saved`, "good");
        render();
      }

      /**
       * A skill written here rather than dropped in.
       *
       * It is saved empty and opened straight into the editor, so the file
       * exists in the list from the first keystroke instead of living in a
       * dialog that can be lost. The filename is the one thing a blank file
       * cannot work out for itself, so it is numbered rather than repeated:
       * two files called untitled.md is a list nobody can read.
       */
      async function createSkill() {
        const taken = new Set((await allSkills()).map((s) => s.filename));
        let filename = "untitled.md";
        for (let n = 2; taken.has(filename); n += 1) filename = `untitled-${n}.md`;

        const skill = parseSkill(filename, "");
        view = { mode: "detail", id: skill.id, editing: true, draft: "", caret: null };
        await addSkill(skill);
        render();
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
        if (e.target.closest('[data-act="new"]')) return createSkill();
        if (e.target.closest('[data-act="back"]')) return showList();
        if (e.target.closest('[data-act="cancel"]')) return cancelEdit();
        if (e.target.closest('[data-act="save"]')) return saveEdit();
        if (e.target.closest('[data-act="edit"]')) {
          view.editing = true;
          view.draft = null;
          view.caret = null;
          return render();
        }

        const gone = e.target.closest("[data-remove]");
        if (gone) {
          await removeSkill(gone.dataset.remove);
          return render();
        }

        // The Open button is the path a keyboard takes. The whole card answers
        // a click as well, because a card that opens something and ignores
        // being clicked reads as broken.
        const card = e.target.closest("[data-open-skill]") || e.target.closest("[data-skill]");
        if (card) openDetail(card.dataset.openSkill || card.dataset.skill);
      });

      // Escape backs out of an edit. The desktop closes the top window on
      // Escape and shell.js only spares the script editor, by class name, so
      // the event is stopped here instead: losing the window would be a far
      // ruder answer to Escape than losing the edit.
      body.addEventListener("keydown", (e) => {
        if (e.key !== "Escape" || !e.target.closest(".ais-editor")) return;
        e.stopPropagation();
        cancelEdit();
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
