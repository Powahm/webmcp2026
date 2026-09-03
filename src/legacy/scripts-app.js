import { Store, Clips, timecode } from "./store.js";
import { announce, trapFocus } from "../a11y/focus-work.js";
import { drop, onProposals, proposalsFor, take } from "../scripts/proposals.js";
import { Desk } from "./shell.js";

/* ============================================================
   Scripts: what you are going to say, on camera.
   A script is a title and a list of lines. Each line is one
   spoken beat plus an optional shot direction. Runtime is
   estimated from word count, and the teleprompter scrolls it
   while you record.
   ============================================================ */

export const Scripts = (() => {
  const TINT = "#F7A501";
  const WORDS_PER_SECOND = 2.5;   /* ~150 wpm, an unhurried speaking pace */

  const seconds = (text) => (String(text).trim().split(/\s+/).filter(Boolean).length) / WORDS_PER_SECOND;
  const runtime = (script) => script.lines.reduce((sum, l) => sum + seconds(l.text), 0);

  const EXAMPLES = [
    {
      id: "example-webmcp",
      name: "WebMCP Challenge demo",
      lines: [
        { text: "This is Deskmate. A whole editing workstation, living in one browser tab.", note: "Straight to camera. Desktop visible behind you." },
        { text: "You write the script here, read it off the teleprompter while you record, and cut what you shot.", note: "Screen: Scripts, then Camera, then Editor. Keep it moving, three seconds each." },
        { text: "The interesting part is what the agent sitting next to me can see.", note: "Back to camera. Beat before the next line." },
        { text: "Which line of the prompter I am on, mid-take. Whether the camera is rolling. What I have selected on the timeline.", note: "Screen: the ghost reading the page. Let the tool names show." },
        { text: "None of that is on a server. It is a Blob in IndexedDB and an array in a closure.", note: "Hold on the Editor. Slow down here." },
        { text: "So a server-side MCP cannot reach it, and an agent driving the DOM would be guessing from pixels.", note: "Land this one. It is the whole argument." },
        { text: "Twenty-eight tools, registered straight onto the page.", note: "Screen: the badge in the menu bar, then the tool list." },
        { text: "Watch. I ask for a title card over the bit where I stumbled.", note: "Type the ask on camera. Do not cut away." },
        { text: "It composes the graphic, times it against the transcript, and puts it on the timeline dashed.", note: "Hold on the dashed proposal previewing live." },
        { text: "Dashed means proposed. There is no tool that accepts one: that click is mine.", note: "Accept it on camera. Beat after." },
        { text: "Nothing uploaded. No backend. Everything you just watched happened in this tab.", note: "Back to camera." },
        { text: "Link is below. Go and break it.", note: "Point down. Hold two seconds for the outro." }
      ]
    },
    {
      id: "example-intro",
      name: "Channel intro",
      lines: [
        { text: "Right, so this thing has been sitting on my desk for about three weeks now.", note: "Hold it up. Straight to camera." },
        { text: "And I genuinely did not expect to like it as much as I do.", note: "Beat. Small smile." },
        { text: "Three things I want to show you, and the third one is the reason I kept it.", note: "Count on fingers." },
        { text: "Let's get into it.", note: "Cut to title card." }
      ]
    },
    {
      id: "example-demo",
      name: "Product demo, 60s",
      lines: [
        { text: "Here's the problem. Every clip you shoot ends up in a different folder, and by Friday you can't find any of them.", note: "Screen recording of a messy folder." },
        { text: "So, record here, and it lands in the library automatically.", note: "Cut to Camera app. Press record." },
        { text: "Drop it on the timeline, drag the ends to trim, pick a look.", note: "Screen capture of the editor. Keep it moving." },
        { text: "That's it. No accounts, no upload, nothing leaves your machine.", note: "Back to camera. Slow down here." },
        { text: "Link's below if you want to try it.", note: "Point down. Hold two seconds for the outro." }
      ]
    },
    {
      id: "example-voiceover",
      name: "Tutorial voiceover",
      lines: [
        { text: "Start with everything on the timeline in roughly the right order. Don't trim yet.", note: "B-roll: dragging clips in." },
        { text: "Now watch it once, all the way through, without touching anything.", note: "Hands off the keyboard." },
        { text: "The places you got bored are the places you cut. That's the whole method.", note: "Land this line. Pause after." },
        { text: "Then go back and tighten. Take out the breath before each sentence and it'll feel twice as fast.", note: "Show a J-cut on screen." }
      ]
    }
  ];

  async function seed() {
    const existing = await Store.all("scripts");

    /* scripts saved by the old code-based version have `code`, not `lines`.
       Keep their text rather than dropping it on the floor. */
    for (const old of existing) {
      if (Array.isArray(old.lines)) continue;
      const lines = String(old.code || "")
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text) => ({ text, note: "" }));
      await Store.put("scripts", {
        id: old.id,
        name: old.name || "Recovered script",
        lines: lines.length ? lines : [{ text: "", note: "" }],
        created: old.created || Date.now(),
        updated: Date.now()
      });
    }

    /*
     * Seed per example, not all-or-nothing.
     *
     * The old check was `if (existing.length) return`, which meant an example
     * added later never reached anybody who had already opened the app once,
     * and the people who have opened it are exactly the ones a new example is
     * written for. Offered ids are remembered instead, so a fresh one arrives
     * and one you deleted stays deleted.
     */
    const offered = new Set(readOffered());
    const byId = new Set(existing.map((s2) => s2.id));

    for (const [i, ex] of EXAMPLES.entries()) {
      if (offered.has(ex.id) || byId.has(ex.id)) continue;
      await Store.put("scripts", { ...ex, created: Date.now() + i, updated: Date.now() + i });
      offered.add(ex.id);
    }
    writeOffered([...offered]);
  }

  /** Which examples this browser has already been given. */
  function readOffered() {
    try {
      return JSON.parse(localStorage.getItem("desk-examples") || "[]");
    } catch {
      return [];
    }
  }

  function writeOffered(ids) {
    try {
      localStorage.setItem("desk-examples", JSON.stringify(ids));
    } catch {
      /* private mode: the worst case is an example offered twice */
    }
  }

  /* ---------------- teleprompter ---------------- */

  const prompter = document.getElementById("prompter");
  let promptTimer = 0;
  /** The running prompter session, or null. Read by prompterState(). */
  let prompting = null;
  /** Undoes the prompter's focus trap and hands focus back to the script. */
  let releasePrompter = null;

  function openPrompter(script) {
    const body = prompter.querySelector(".prompter-scroll");
    const title = prompter.querySelector(".prompter-title");
    title.textContent = script.name;

    body.innerHTML = script.lines
      .map((l, i) => `<p class="prompter-line" data-i="${i}">${Desk.esc(l.text)}</p>`)
      .join("");

    prompter.hidden = false;
    body.scrollTop = 0;

    let running = true;
    let speed = 1;
    const playBtn = prompter.querySelector('[data-act="prompt-play"]');
    const speedOut = prompter.querySelector(".prompter-speed");

    /* pace the scroll so the whole script takes about its estimated runtime */
    const step = () => {
      if (!running) return;
      const spread = body.scrollHeight - body.clientHeight;
      const perTick = spread > 0 ? (spread / Math.max(runtime(script), 1)) / 60 : 0;
      body.scrollTop += perTick * speed;

      const focus = body.scrollTop + body.clientHeight * 0.42;
      let best = null;
      let shortest = Infinity;
      [...body.children].forEach((el) => {
        el.dataset.now = "false";
        const gap = Math.abs(el.offsetTop + el.offsetHeight / 2 - focus);
        if (gap < shortest) { shortest = gap; best = el; }
      });
      if (best) best.dataset.now = "true";

      if (body.scrollTop < spread) promptTimer = requestAnimationFrame(step);
      else { running = false; playBtn.dataset.playing = "false"; }
    };

    const setRunning = (v) => {
      running = v;
      playBtn.dataset.playing = String(v);
      playBtn.setAttribute("aria-label", v ? "Pause" : "Play");
      cancelAnimationFrame(promptTimer);
      if (v) promptTimer = requestAnimationFrame(step);
    };

    prompter.onclick = (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "prompt-close" || e.target.hasAttribute("data-close-prompter")) return closePrompter();
      if (act === "prompt-play") return setRunning(!running);
      if (act === "prompt-slower") { speed = Math.max(0.4, speed - 0.2); speedOut.textContent = `${speed.toFixed(1)}×`; }
      if (act === "prompt-faster") { speed = Math.min(2.5, speed + 0.2); speedOut.textContent = `${speed.toFixed(1)}×`; }
      if (act === "prompt-camera") Desk.launch("camera");
    };

    speedOut.textContent = "1.0×";
    prompting = { script, isRunning: () => running, getSpeed: () => speed, setRunning };
    setRunning(true);

    // The prompter covers the whole machine, so focus has to come with it and
    // stay inside: Tab behind a modal scrim lands on controls nobody can see.
    releasePrompter = trapFocus(prompter.querySelector(".prompter-panel"), { initial: playBtn });
    announce(`Teleprompter running: ${script.name}. Space pauses, Escape leaves.`);
  }

  function closePrompter() {
    cancelAnimationFrame(promptTimer);
    prompter.hidden = true;
    prompter.onclick = null;
    prompting = null;
    releasePrompter?.();
    releasePrompter = null;
  }

  /**
   * The teleprompter, as state rather than as pixels.
   *
   * `line_index` is whichever paragraph the scroll loop last marked data-now,
   * so it is the line the speaker is on at this instant. Nothing outside this
   * tab can know that, and it is what lets an agent talk about the bit you are
   * on while a take is running.
   */
  function prompterState() {
    if (!prompting || prompter.hidden) return null;
    const body = prompter.querySelector(".prompter-scroll");
    const now = body.querySelector('.prompter-line[data-now="true"]');
    const index = now ? Number(now.dataset.i) : 0;
    const spread = body.scrollHeight - body.clientHeight;
    return {
      script_id: prompting.script.id,
      name: prompting.script.name,
      line_index: index,
      line: prompting.script.lines[index]?.text ?? "",
      note: prompting.script.lines[index]?.note || null,
      lines_total: prompting.script.lines.length,
      running: prompting.isRunning(),
      speed: prompting.getSpeed(),
      progress: spread > 0 ? Math.min(1, body.scrollTop / spread) : 0,
      runtime_seconds: runtime(prompting.script)
    };
  }

  document.addEventListener("keydown", (e) => {
    if (prompter.hidden) return;

    if (e.key === "Escape") {
      e.stopPropagation();
      return closePrompter();
    }

    // Space is what a performer reaches for when they need to stop, and they
    // are looking at the lens rather than at the pause button.
    if (e.key === " " && !e.target.closest("input, textarea, [contenteditable]")) {
      e.preventDefault();
      e.stopPropagation();
      const next = !prompting?.isRunning();
      prompting?.setRunning(next);
      announce(next ? "Prompter running." : "Prompter paused.");
    }
  }, true);

  /* ---------------- script window ---------------- */

  /**
   * Script windows that are open, oldest first.
   *
   * The WebMCP layer reads this to answer get_open_script. What it returns
   * exists nowhere else: which script the writer has in front of them, the text
   * of a line they are still typing, and which line their caret is in. A server
   * has the saved file; only this page has the caret.
   */
  const openWindows = new Map();

  /** The script window with focus, or the most recently opened one. */
  function focusedScript() {
    if (openWindows.size === 0) return null;
    const win = Desk.openWindows().find((w) => w.focused && w.id.startsWith("script:"));
    if (win) {
      const rec = openWindows.get(win.id.slice("script:".length));
      if (rec) return rec;
    }
    return [...openWindows.values()].pop();
  }

  function openScript(script, origin) {
    Desk.openWindow({
      id: `script:${script.id}`,
      title: script.name,
      help: "script",
      meta: timecode(runtime(script)),
      tint: TINT,
      size: "large",
      origin,
      build(body, win) {
        body.className = "win-body scr";
        body.innerHTML = `
          <div class="scr-bar">
            <input class="scr-name" value="${Desk.esc(script.name)}" aria-label="Script title" spellcheck="false">
            <div class="scr-views" role="tablist" aria-label="View">
              <button class="scr-view on" data-view="text" role="tab" aria-selected="true">Draft</button>
              <button class="scr-view" data-view="blocks" role="tab" aria-selected="false">Shot list</button>
            </div>
            <button class="btn btn-mini" data-act="research" aria-pressed="true">Research</button>
            <button class="btn btn-mini" data-act="save">Save</button>
            <button class="btn btn-mini btn-danger" data-act="delete">Delete</button>
            <button class="btn btn-accent" data-act="prompt">Teleprompter</button>
          </div>

          <!-- Two views of one document. Blocks is the shooting script, one
               line per spoken beat with its shot direction. Text is the same
               lines as one editable document, numbered, for when you want to
               rewrite the whole thing rather than nudge a beat. -->
          <div class="scr-lines" data-pane="blocks" hidden></div>

          <!-- The draft. Where the writing and the researching happen, and so
               where the agent's suggestions land: a line offered into a shot
               list is a line offered after the thinking is over. -->
          <div class="scr-text" data-pane="text">
            <div class="scr-gutter mono" aria-hidden="true"></div>
            <div class="scr-docwrap">
              <textarea class="scr-doc" spellcheck="true" wrap="off"
                aria-label="Script, one line per beat"
                placeholder="One line per beat. Each line becomes a beat in the shot list."></textarea>
              <div class="scr-suggests" aria-live="polite"></div>
            </div>
          </div>

          <aside class="scr-research">
            <div class="ed-head"><span>Research</span></div>
            <textarea class="scr-sources" spellcheck="false"
              aria-label="Research notes and links"
              placeholder="Paste links, quotes, figures, anything you found while browsing. The agent reads this when you ask it to write."></textarea>
          </aside>

          <div class="scr-foot">
            <button class="btn btn-mini" data-act="add">+ Add line</button>
            <span class="scr-total mono"></span>
          </div>`;

        const list = body.querySelector(".scr-lines");
        const total = body.querySelector(".scr-total");
        const nameInput = body.querySelector(".scr-name");
        const textPane = body.querySelector(".scr-text");
        const doc = body.querySelector(".scr-doc");
        const gutter = body.querySelector(".scr-gutter");
        const suggests = body.querySelector(".scr-suggests");
        const research = body.querySelector(".scr-research");
        const sources = body.querySelector(".scr-sources");

        script.sources = script.sources || "";
        sources.value = script.sources;

        /**
         * The last state that reached the store.
         *
         * Typing writes straight into `script.lines` below, so the record in
         * memory is always current and comparing against it would say nothing
         * is ever unsaved. This snapshot is the saved truth, taken when the
         * window opens and refreshed by save().
         */
        let saved = JSON.stringify({ name: script.name, lines: script.lines, sources: script.sources });

        openWindows.set(script.id, {
          script, body, list, nameInput,
          savedSnapshot: () => saved,
          sourcesValue: () => sources.value,
          markSaved: () => { saved = JSON.stringify({ name: script.name, lines: script.lines }); }
        });
        win.onCleanup(() => openWindows.delete(script.id));

        function renderTotals() {
          const r = runtime(script);
          total.textContent = `${script.lines.length} lines · about ${timecode(r)}`;
          win.setMeta(timecode(r));
          // The block list can be a render behind: editing in the text view
          // rewrites script.lines without re-rendering the blocks, so deleting
          // lines there leaves more elements here than there are lines. Reading
          // past the end used to throw and take the whole window down.
          list.querySelectorAll(".line").forEach((el, i) => {
            const line = script.lines[i];
            if (!line) return;
            el.querySelector(".line-time").textContent = timecode(seconds(line.text));
          });
        }

        function render() {
          const rows = script.lines.map((line, i) => `
            <article class="line" data-i="${i}">
              <div class="line-rail">
                <span class="line-no mono">${String(i + 1).padStart(2, "0")}</span>
                <span class="line-time mono">${timecode(seconds(line.text))}</span>
              </div>
              <div class="line-main">
                <textarea class="line-text" rows="2" data-field="text"
                  placeholder="What you say out loud…">${Desk.esc(line.text)}</textarea>
                <input class="line-note" data-field="note" value="${Desk.esc(line.note || "")}"
                  placeholder="Shot direction: camera, b-roll, tone">
              </div>
              <div class="line-acts">
                <button class="line-btn" data-move="-1" aria-label="Move line ${i + 1} up">↑</button>
                <button class="line-btn" data-move="1" aria-label="Move line ${i + 1} down">↓</button>
                <button class="line-btn line-btn--del" data-move="x" aria-label="Delete line ${i + 1}">×</button>
              </div>
            </article>`);

          list.innerHTML =
            rows.join("") ||
            `<p class="scr-empty">No lines yet. Add the first thing you are going to say.</p>`;
          renderTotals();
          autosizeAll();
          renderDoc();
          paintSuggestions();
        }

        /* ---------------- the text view ---------------- */

        /**
         * One line of the document is one block.
         *
         * That is the whole mapping, and keeping it that strict is what lets
         * the two views be the same document rather than two formats to
         * convert between. Shot directions are not in the text: they belong to
         * a beat, not to a sentence, and folding them in would mean the line
         * numbers here stopped matching the block numbers there.
         */
        function renderDoc() {
          if (document.activeElement === doc) return;
          doc.value = script.lines.map((l) => l.text).join("\n");
          paintGutter();
        }

        function paintGutter() {
          const n = Math.max(1, doc.value.split("\n").length);
          gutter.innerHTML = Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join("");
          gutter.scrollTop = doc.scrollTop;
        }

        /**
         * Suggestions, drawn into the draft at the line they are aimed at.
         *
         * The textarea does not wrap (wrap="off"), which is what makes this
         * possible and is worth the horizontal scroll on its own: one line of
         * the document is one row on screen, so a row's offset is just its
         * index times the line height. Wrapped lines would put the gutter
         * numbers out of step with their lines too, which they quietly were.
         */
        function lineHeight() {
          const px = parseFloat(getComputedStyle(doc).lineHeight);
          return Number.isFinite(px) ? px : 22;
        }

        function paintSuggestions() {
          const pending = proposalsFor(script.id);
          doc.dataset.suggesting = pending.length ? "true" : "false";

          if (pending.length === 0) {
            suggests.innerHTML = "";
            suggests.dataset.sig = "";
            doc.style.paddingBottom = "";
            return;
          }

          const lh = lineHeight();
          const padTop = parseFloat(getComputedStyle(doc).paddingTop) || 0;
          const count = doc.value.split("\n").length;
          const place = (p) => padTop + Math.max(0, Math.min(p.index, count)) * lh;

          // Only rebuild when the cards themselves changed. Typing in the
          // draft repaints on every keystroke, and blurring it rebuilds the
          // blocks; either one replacing these nodes mid-gesture swallows the
          // click, because the button you pressed is gone before mouseup.
          const sig = pending.map((p) => `${p.id}:${p.index}:${p.mode}`).join("|") + `@${count}`;
          if (suggests.dataset.sig === sig) {
            pending.forEach((p) => {
              const el = suggests.querySelector(`[data-proposal="${p.id}"]`);
              if (el) el.style.top = `${place(p)}px`;
            });
            return;
          }
          suggests.dataset.sig = sig;

          suggests.innerHTML = pending
            .map((p) => {
              const at = Math.max(0, Math.min(p.index, count));
              const top = place(p);
              return `
                <div class="scr-sugg" data-proposal="${p.id}" style="top:${top}px">
                  <span class="scr-sugg-rail mono">${p.mode === "replace" ? "↻" : "+"}</span>
                  <div class="scr-sugg-main">
                    <p class="scr-sugg-text">${Desk.esc(p.text)}</p>
                    ${p.note ? `<p class="scr-sugg-note">${Desk.esc(p.note)}</p>` : ""}
                    ${p.reason ? `<p class="scr-sugg-why">${Desk.esc(p.reason)}</p>` : ""}
                    <div class="scr-sugg-acts">
                      <button class="btn btn-mini btn-accent" data-take="${p.id}">
                        ${p.mode === "replace" ? `Replace line ${at + 1}` : `Insert at line ${at + 1}`}
                      </button>
                      <button class="btn btn-mini btn-danger" data-drop="${p.id}">Discard</button>
                    </div>
                  </div>
                </div>`;
            })
            .join("");

          // Room at the bottom so a suggestion aimed past the last line is not
          // hanging off the end of the document.
          suggests.scrollTop = doc.scrollTop;
          doc.style.paddingBottom = `${Math.max(140, lh * 4)}px`;
        }

        /** Keep a note with its line when the text moves under it. */
        function adoptNotes(texts) {
          const old = script.lines;
          const spare = new Map();
          old.forEach((l) => {
            if (l.note) spare.set(l.text, l.note);
          });
          return texts.map((text, i) => ({
            text,
            note: old[i]?.text === text ? old[i].note : spare.get(text) ?? old[i]?.note ?? "",
          }));
        }

        doc.addEventListener("input", () => {
          script.lines = adoptNotes(doc.value.split("\n"));
          paintGutter();
          paintSuggestions();
          renderTotals();
        });
        doc.addEventListener("scroll", () => {
          gutter.scrollTop = doc.scrollTop;
          suggests.style.transform = `translateY(${-doc.scrollTop}px)`;
        });
        // Pressing a suggestion must not pull focus out of the draft: the
        // blur rebuilds the blocks, and the caret should stay where the writer
        // left it anyway.
        suggests.addEventListener("mousedown", (e) => e.preventDefault());

        doc.addEventListener("blur", () => {
          // Blocks are rebuilt from the document, so switching back shows what
          // was actually typed rather than a stale render.
          renderBlocks();
        });

        function renderBlocks() {
          render();
        }

        // The draft opens first: it is where the writing and the researching
        // happen, and the shot list is for the pass before you shoot.
        let view = "text";
        function setView(next) {
          view = next;
          list.hidden = next !== "blocks";
          textPane.hidden = next !== "text";
          body.querySelectorAll(".scr-view").forEach((b) => {
            const on = b.dataset.view === next;
            b.classList.toggle("on", on);
            b.setAttribute("aria-selected", String(on));
          });
          if (next === "text") renderDoc();
          else render();
        }

        const autosize = (el) => {
          el.style.height = "auto";
          el.style.height = el.scrollHeight + "px";
        };
        const autosizeAll = () => list.querySelectorAll(".line-text").forEach(autosize);

        list.addEventListener("input", (e) => {
          const field = e.target.dataset.field;
          const i = Number(e.target.closest(".line")?.dataset.i);
          if (!field || Number.isNaN(i)) return;
          script.lines[i][field] = e.target.value;
          if (field === "text") { autosize(e.target); renderTotals(); }
        });

        list.addEventListener("click", (e) => {
          const move = e.target.closest("[data-move]")?.dataset.move;
          if (!move) return;
          const i = Number(e.target.closest(".line").dataset.i);
          if (move === "x") script.lines.splice(i, 1);
          else {
            const j = i + Number(move);
            if (j < 0 || j >= script.lines.length) return;
            [script.lines[i], script.lines[j]] = [script.lines[j], script.lines[i]];
          }
          render();
        });

        sources.addEventListener("input", () => { script.sources = sources.value; });

        const offProposals = onProposals(() => render());
        win.onCleanup(() => offProposals());

        async function save() {
          script.name = nameInput.value.trim() || "Untitled script";
          script.sources = sources.value;
          script.updated = Date.now();
          await Store.put("scripts", script);
          saved = JSON.stringify({ name: script.name, lines: script.lines, sources: script.sources });
          Desk.toast(`Saved ${script.name}`, "good");
        }

        body.addEventListener("click", async (e) => {
          const tab = e.target.closest("[data-view]");
          if (tab) return setView(tab.dataset.view);

          // Accept a line the agent wrote. Only a real click reaches here:
          // take() refuses anything that is not a trusted user event.
          const yes = e.target.closest("[data-take]");
          if (yes) {
            const p = take(yes.dataset.take, e);
            if (!p) return;
            const line = { text: p.text, note: p.note || "" };
            const at = Math.max(0, Math.min(p.index, script.lines.length));
            if (p.mode === "replace" && script.lines[at]) script.lines[at] = line;
            else script.lines.splice(at, 0, line);

            // Rebuild the draft even while it has focus. renderDoc bails when
            // the textarea is focused, which is right for ordinary typing and
            // wrong here: the line arrived from outside and has to appear.
            doc.value = script.lines.map((l) => l.text).join("\n");
            paintGutter();
            render();

            // Put the caret at the end of the line that just landed, so
            // carrying on typing continues from it.
            const upto = script.lines.slice(0, at + 1).map((l) => l.text).join("\n").length;
            doc.focus();
            doc.setSelectionRange(upto, upto);
            return;
          }
          const no = e.target.closest("[data-drop]");
          if (no) { drop(no.dataset.drop, e); return void render(); }

          const act = e.target.closest("[data-act]")?.dataset.act;

          if (act === "research") {
            const open = research.hidden;
            research.hidden = !open;
            body.querySelector('[data-act="research"]').setAttribute("aria-pressed", String(open));
            if (open) sources.focus();
            return;
          }

          if (act === "add") {
            script.lines.push({ text: "", note: "" });
            render();
            list.querySelector(".line:last-child .line-text")?.focus();
          }
          if (act === "save") save();
          if (act === "prompt") {
            if (!script.lines.length) return Desk.toast("Write a line first.", "bad");
            openPrompter(script);
          }
          if (act === "delete") {
            await Store.del("scripts", script.id);
            Desk.toast(`Deleted ${script.name}`);
            win.close();
          }
        });

        body.addEventListener("keydown", (e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
        });

        render();
      }
    });
  }

  async function newScript() {
    const script = {
      id: `script-${Date.now()}`,
      name: "Untitled script",
      lines: [{ text: "", note: "" }],
      created: Date.now(),
      updated: Date.now()
    };
    await Store.put("scripts", script);
    openScript(script, null);
  }

  /* ---------------- the folder ---------------- */

  function open(origin) {
    Desk.openWindow({
      id: "scripts",
      title: "Scripts",
      help: "scripts",
      meta: "",
      tint: TINT,
      size: "large",
      origin,
      build(body, win) {
        body.className = "win-body";
        const grid = document.createElement("div");
        grid.className = "filegrid spill";
        body.appendChild(grid);

        async function render() {
          const all = await Store.all("scripts");
          win.setMeta(`${all.length} scripts`);
          grid.innerHTML =
            all.map((s, i) => `
              <button class="file" data-script="${s.id}" style="--i:${i}; --f-accent:${TINT}">
                <span class="file-art file-art--script" aria-hidden="true"></span>
                <span class="file-name">${Desk.esc(s.name)}</span>
                <span class="file-kind">${timecode(runtime(s))}</span>
              </button>`).join("") +
            `<button class="file file--new" data-new="1" style="--i:${all.length}">
               <span class="file-art file-art--new" aria-hidden="true">+</span>
               <span class="file-name">New script</span>
               <span class="file-kind">write</span>
             </button>`;
        }

        grid.addEventListener("click", async (e) => {
          if (e.target.closest("[data-new]")) return newScript();
          const btn = e.target.closest("[data-script]");
          if (!btn) return;
          const all = await Store.all("scripts");
          const script = all.find((s) => s.id === btn.dataset.script);
          if (script) openScript(script, btn.getBoundingClientRect());
        });

        const off = Store.on("scripts", render);
        win.onCleanup(off);
        render();
      }
    });
  }

  /**
   * Live editor state for the WebMCP layer.
   *
   * Lines come off the textareas, not off the saved record, so a line the
   * writer is still typing is visible before it is saved. That is the
   * difference between reading the page and reading a database.
   */
  function openScriptState() {
    const rec = focusedScript();
    if (!rec) return null;
    const { script, list, nameInput } = rec;

    // Read the document, not one of its two views. Both the block editor and
    // the text editor write into script.lines as you type, so that array is
    // always current, and reading the DOM instead meant an edit made in the
    // view that happened to be hidden was invisible to the agent.
    const lines = script.lines.map((l, i) => ({
      index: i,
      text: l.text,
      note: l.note || null
    }));

    const active = document.activeElement;
    const row = active?.closest?.(".line");
    const inLine = row && active.classList && (active.classList.contains("line-text") || active.classList.contains("line-note"));
    const caret = inLine
      ? {
          line_index: Number(row.dataset.i),
          field: active.classList.contains("line-text") ? "text" : "note",
          offset: active.selectionStart ?? 0,
          selected:
            active.selectionEnd > active.selectionStart
              ? active.value.slice(active.selectionStart, active.selectionEnd)
              : null
        }
      : null;

    const live = { lines: lines.map(({ text, note }) => ({ text, note: note ?? "" })) };

    return {
      id: script.id,
      name: nameInput.value,
      lines,
      // What they pasted in while researching. The agent writes from this,
      // which is the difference between drafting and inventing.
      research: rec.sourcesValue(),
      caret,
      runtime_seconds: runtime(live),
      // Against the store, not against the in-memory record: typing mutates
      // that record, so it is never behind.
      unsaved:
        JSON.stringify({ name: nameInput.value, lines: live.lines, sources: rec.sourcesValue() }) !==
        rec.savedSnapshot()
    };
  }

  return {
    open, seed, openScript, newScript, runtime, seconds, TINT,
    openPrompter, closePrompter, prompterState, openScriptState
  };
})();
