import { Store, Clips, timecode } from "./store.js";
import { drop, onProposals, proposalsFor, take } from "../scripts/proposals.js";
import { Desk } from "./shell.js";

/* ============================================================
   Scripts — what you are going to say, on camera.
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
      id: "example-intro",
      name: "Channel intro",
      lines: [
        { text: "Right — so this thing has been sitting on my desk for about three weeks now.", note: "Hold it up. Straight to camera." },
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
        { text: "So — record here, and it lands in the library automatically.", note: "Cut to Camera app. Press record." },
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

    if (existing.length) return;
    for (const [i, ex] of EXAMPLES.entries()) {
      await Store.put("scripts", { ...ex, created: Date.now() + i, updated: Date.now() + i });
    }
  }

  /* ---------------- teleprompter ---------------- */

  const prompter = document.getElementById("prompter");
  let promptTimer = 0;
  /** The running prompter session, or null. Read by prompterState(). */
  let prompting = null;

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
    prompting = { script, isRunning: () => running, getSpeed: () => speed };
    setRunning(true);
  }

  function closePrompter() {
    cancelAnimationFrame(promptTimer);
    prompter.hidden = true;
    prompter.onclick = null;
    prompting = null;
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
    if (e.key === "Escape" && !prompter.hidden) {
      e.stopPropagation();
      closePrompter();
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
      meta: timecode(runtime(script)),
      tint: TINT,
      size: { w: 900, h: 720 },
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
            <button class="btn btn-mini" data-act="research" aria-pressed="false">Research</button>
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

          <aside class="scr-research" hidden>
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
                  placeholder="Shot direction — camera, b-roll, tone">
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
        /**
         * A suggestion opens a real gap in the draft.
         *
         * The old version floated a card over the text, which meant two
         * suggestions near each other drew on top of one another and neither
         * could be read. Instead the textarea holds a blank row at the
         * insertion point — the document literally makes room — and the
         * suggestion is drawn into that space.
         *
         * The blank row is marked with a zero-width space rather than tracked
         * by index. Indices shift the moment anyone presses Enter above them,
         * and a stale index means deleting a line somebody wrote; a marker
         * travels with its row whatever happens around it.
         */
        const GAP = "\u200B";
        const isGap = (line) => line.startsWith(GAP);

        /** What the textarea should contain: the script, plus a held-open row
         *  for every pending suggestion, in order. */
        function displayText() {
          const pending = proposalsFor(script.id).slice().sort((a, b) => a.index - b.index);
          const out = script.lines.map((l) => l.text);
          // Back to front, so an insertion does not move the next one.
          for (let i = pending.length - 1; i >= 0; i--) {
            const at = Math.max(0, Math.min(pending[i].index, out.length));
            out.splice(at, 0, GAP);
          }
          return out.join("\n");
        }

        /**
         * Offsets, with and without the gap rows.
         *
         * A gap adds two characters to the document that are not part of the
         * script, so a caret position means two different things depending on
         * which text you are counting. These convert between them, which is
         * what lets a suggestion open a gap while somebody is mid-sentence
         * without the caret jumping.
         */
        function toPlain(value, off) {
          let plain = 0;
          let seen = 0;
          for (const row of value.split("\n")) {
            const len = row.length + 1;
            if (seen + len > off) {
              if (!isGap(row)) plain += Math.max(0, off - seen);
              return plain;
            }
            seen += len;
            if (!isGap(row)) plain += len;
          }
          return plain;
        }

        function fromPlain(value, plainOff) {
          let plain = 0;
          let off = 0;
          for (const row of value.split("\n")) {
            const len = row.length + 1;
            if (isGap(row)) { off += len; continue; }
            if (plain + len > plainOff) return off + (plainOff - plain);
            plain += len;
            off += len;
          }
          return off;
        }

        /**
         * Rewrite the textarea, keeping the caret where the writer left it.
         *
         * This runs even while the draft has focus. It has to: a suggestion
         * that arrives while somebody is typing used to render nothing at all,
         * because the gap it needed could not be opened.
         */
        function writeDoc() {
          const focused = document.activeElement === doc;
          const plain = focused ? toPlain(doc.value, doc.selectionStart) : 0;
          const next = displayText();
          if (doc.value !== next) doc.value = next;
          if (focused) {
            const at = fromPlain(next, plain);
            doc.setSelectionRange(at, at);
          }
          paintGutter();
        }

        function renderDoc() {
          writeDoc();
        }

        /**
         * Read the script back out of the textarea.
         *
         * A gap row that is still empty is not a line and never becomes one. A
         * gap row somebody has typed into is theirs: it turns into a real line
         * and the suggestion that was sitting there is dropped, because they
         * have just answered it by writing their own.
         */
        function readDoc() {
          const rows = doc.value.split("\n");
          const pending = proposalsFor(script.id).slice().sort((a, b) => a.index - b.index);
          const kept = [];
          let seen = 0;
          const superseded = [];

          for (const row of rows) {
            if (isGap(row)) {
              const typed = row.slice(GAP.length);
              const owner = pending[seen];
              seen += 1;
              if (typed.trim()) {
                kept.push(typed);
                if (owner) superseded.push(owner.id);
              }
              continue;
            }
            kept.push(row);
          }
          return { texts: kept, superseded };
        }

        function paintGutter() {
          const rows = doc.value.split("\n");
          let n = 0;
          gutter.innerHTML = rows
            .map((row) => (isGap(row) ? `<span class="scr-gap-no"></span>` : `<span>${++n}</span>`))
            .join("");
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

          // Each suggestion sits in the gap the document is holding open for
          // it, so the row it is drawn on is wherever that gap ended up — not
          // a number computed from its index, which drifts the moment anyone
          // types above it.
          // Make sure every pending suggestion has a gap to sit in before
          // measuring where the gaps are.
          if (doc.value.split("\n").filter(isGap).length !== pending.length) writeDoc();

          const rows = doc.value.split("\n");
          const gapRows = [];
          rows.forEach((row, i) => { if (isGap(row)) gapRows.push(i); });
          const ordered = pending.slice().sort((a, b) => a.index - b.index);

          const sig = ordered.map((p, i) => `${p.id}:${gapRows[i]}:${p.mode}`).join("|");
          if (suggests.dataset.sig === sig) return;
          suggests.dataset.sig = sig;

          suggests.innerHTML = ordered
            .map((p, i) => {
              const row = gapRows[i];
              if (row == null) return "";
              // Which line number it lands under, counting only real lines.
              const above = rows.slice(0, row).filter((r) => !isGap(r)).length;
              return `
                <div class="scr-sugg" data-proposal="${p.id}" style="top:${padTop + row * lh}px">
                  <span class="scr-sugg-arrow" aria-hidden="true">&#8624;</span>
                  <span class="scr-sugg-text">${Desk.esc(p.text)}</span>
                  <span class="scr-sugg-acts">
                    <button class="scr-sugg-btn" data-take="${p.id}"
                      title="${p.mode === "replace" ? `Replace line ${above}` : `Put this in at line ${above + 1}`}">insert</button>
                    <button class="scr-sugg-btn scr-sugg-btn--no" data-drop="${p.id}" title="Discard">&times;</button>
                  </span>
                </div>`;
            })
            .join("");

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
          const { texts, superseded } = readDoc();
          script.lines = adoptNotes(texts);
          if (superseded.length) {
            // They wrote in the gap, so the suggestion has been answered.
            superseded.forEach((id) => drop(id, { isTrusted: true }));
            writeDoc();
          }
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
            writeDoc();
            render();

            // Put the caret at the end of the line that just landed, so
            // carrying on typing continues from it.
            // Put the caret at the end of the line that just landed. Counted
            // through the displayed text, because any other suggestion is
            // still holding its own gap open above or below it.
            const shown = doc.value.split("\n");
            let real = 0, upto = 0;
            for (const row of shown) {
              upto += row.length + 1;
              if (!isGap(row) && ++real > at) break;
            }
            doc.focus();
            doc.setSelectionRange(Math.max(0, upto - 1), Math.max(0, upto - 1));
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
      meta: "",
      tint: TINT,
      size: { w: 660, h: 480 },
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
