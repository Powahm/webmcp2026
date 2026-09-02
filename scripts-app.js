/* ============================================================
   Scripts — what you are going to say, on camera.
   A script is a title and a list of lines. Each line is one
   spoken beat plus an optional shot direction. Runtime is
   estimated from word count, and the teleprompter scrolls it
   while you record.
   ============================================================ */

const Scripts = (() => {
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
    setRunning(true);
  }

  function closePrompter() {
    cancelAnimationFrame(promptTimer);
    prompter.hidden = true;
    prompter.onclick = null;
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !prompter.hidden) {
      e.stopPropagation();
      closePrompter();
    }
  }, true);

  /* ---------------- script window ---------------- */

  function openScript(script, origin) {
    Desk.openWindow({
      id: `script:${script.id}`,
      title: script.name,
      meta: timecode(runtime(script)),
      tint: TINT,
      size: { w: 640, h: 560 },
      origin,
      build(body, win) {
        body.className = "win-body scr";
        body.innerHTML = `
          <div class="scr-bar">
            <input class="scr-name" value="${Desk.esc(script.name)}" aria-label="Script title" spellcheck="false">
            <button class="btn btn-mini" data-act="save">Save</button>
            <button class="btn btn-mini btn-danger" data-act="delete">Delete</button>
            <button class="btn btn-accent" data-act="prompt">Teleprompter</button>
          </div>
          <div class="scr-lines"></div>
          <div class="scr-foot">
            <button class="btn btn-mini" data-act="add">+ Add line</button>
            <span class="scr-total mono"></span>
          </div>`;

        const list = body.querySelector(".scr-lines");
        const total = body.querySelector(".scr-total");
        const nameInput = body.querySelector(".scr-name");

        function renderTotals() {
          const r = runtime(script);
          total.textContent = `${script.lines.length} lines · about ${timecode(r)}`;
          win.setMeta(timecode(r));
          list.querySelectorAll(".line").forEach((el, i) => {
            el.querySelector(".line-time").textContent = timecode(seconds(script.lines[i].text));
          });
        }

        function render() {
          list.innerHTML = script.lines.map((line, i) => `
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
            </article>`).join("")
            || `<p class="scr-empty">No lines yet. Add the first thing you are going to say.</p>`;
          renderTotals();
          autosizeAll();
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

        async function save() {
          script.name = nameInput.value.trim() || "Untitled script";
          script.updated = Date.now();
          await Store.put("scripts", script);
          Desk.toast(`Saved ${script.name}`, "good");
        }

        body.addEventListener("click", async (e) => {
          const act = e.target.closest("[data-act]")?.dataset.act;
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
      size: { w: 520, h: 400 },
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

  return { open, seed, openScript, newScript, runtime, TINT };
})();
