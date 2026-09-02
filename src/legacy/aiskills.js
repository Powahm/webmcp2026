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
export const addSkill = (skill) => Store.put("aiskills", skill);
export const removeSkill = (id) => Store.del("aiskills", id);

const EXAMPLE = `---
name: Hook in the first three seconds
description: Use when writing or reviewing the opening of a short-form video, or when the creator says the start feels slow.
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

/** One skill to start with, so the folder is never a blank page. */
export async function seed() {
  const existing = await Store.all("aiskills");
  if (existing.length) return;
  await addSkill(parseSkill("hook-in-three-seconds.md", EXAMPLE));
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
        win.setMeta(`${skills.length} skill${skills.length === 1 ? "" : "s"}`);
        list.innerHTML = skills.length
          ? skills
              .map((s) => {
                const when = loadedAt(s.id);
                return `
                  <article class="ais-card ${when ? "used" : ""}" data-skill="${s.id}">
                    <header class="ais-card-head">
                      <span class="ais-card-name">${Desk.esc(s.name)}</span>
                      <span class="ais-card-file mono">${Desk.esc(s.filename)}</span>
                    </header>
                    <p class="ais-card-desc">${Desk.esc(s.description || "No description.")}</p>
                    <footer class="ais-card-foot">
                      <span class="mono">${s.words} words</span>
                      ${when ? `<span class="ais-card-used">the agent loaded this</span>` : `<span class="ais-card-idle">offered, not yet used</span>`}
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
