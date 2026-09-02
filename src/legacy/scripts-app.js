import { Store, Clips, timecode } from "./store.js";
import { Desk } from "./shell.js";
import { Camera } from "./camera.js";
import { Editor } from "./editor.js";

/* ============================================================
   Scripts — a folder of small programs that drive this computer.
   Scripts run as real async JavaScript with an injected `api`,
   so a script can record, cut and export without touching the UI.
   ============================================================ */

export const Scripts = (() => {
  const TINT = "#F7A501";
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  /* some sandboxes forbid Function construction; find out once */
  const canRun = (() => {
    try { new Function("return 1")(); return true; } catch { return false; }
  })();

  const EXAMPLES = [
    {
      id: "example-hello",
      name: "hello.js",
      code: `// Every script gets an \`api\` object. Press Run.
log("Booting…");

const clips = await api.clips.all();
log(\`Library holds \${clips.length} clip(s).\`);

for (const clip of clips) {
  log(\`  · \${clip.name} — \${api.timecode(clip.duration)}\`);
}

if (!clips.length) log("Record something in Camera first.");
log("Done.");`
    },
    {
      id: "example-record",
      name: "record-and-cut.js",
      code: `// Record three seconds, drop it on the timeline, cut it down.
log("Recording 3s…");
const clip = await api.camera.record(3);
log(\`Got \${clip.name}\`);

await api.editor.open();
await api.editor.add(clip);

api.editor.trim(0.5, 2.5);   // seconds, in and out
api.editor.look("punch");    // none mono warm cool punch faded
api.editor.speed(1.5);

log("Trimmed to 2s at 1.5x. Press Export when you like it.");`
    },
    {
      id: "example-montage",
      name: "montage.js",
      code: `// Build a montage from everything in the library.
const clips = await api.clips.all();
if (!clips.length) throw new Error("Library is empty — record a clip first.");

await api.editor.open();
api.editor.clear();

const looks = ["warm", "cool", "mono", "punch"];

for (const [i, clip] of clips.entries()) {
  await api.editor.add(clip);
  api.editor.look(looks[i % looks.length]);
  api.editor.trim(0, Math.min(2, clip.duration || 2));
  log(\`Added \${clip.name} as \${looks[i % looks.length]}\`);
}

log(\`Montage ready: \${clips.length} clips.\`);`
    }
  ];

  async function seed() {
    const existing = await Store.all("scripts");
    if (existing.length) return;
    for (const [i, ex] of EXAMPLES.entries()) {
      await Store.put("scripts", { ...ex, created: Date.now() + i, updated: Date.now() + i });
    }
  }

  /* ---------------- the API handed to a script ---------------- */

  function makeApi(log) {
    return {
      timecode,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      toast: (msg) => Desk.toast(String(msg)),

      clips: {
        all: () => Clips.all(),
        async last() {
          const all = await Clips.all();
          return all[all.length - 1] || null;
        },
        remove: (id) => Clips.remove(id)
      },

      camera: {
        async record(seconds = 3) {
          log(`camera.record(${seconds})`);
          return Camera.recordFor(seconds);
        },
        open: () => Desk.launch("camera")
      },

      editor: {
        async open() {
          if (!Desk.isOpen("editor")) Editor.open(null);
          await new Promise((r) => setTimeout(r, 60));
        },
        async add(clipOrId) {
          const id = typeof clipOrId === "string" ? clipOrId : clipOrId?.id;
          if (!id) throw new Error("editor.add() needs a clip or a clip id");
          return Editor.addClip(id);
        },
        clear: () => Editor.clear(),
        trim: (inS, outS) => Editor.trimSelected(inS, outS),
        look: (name) => {
          if (!(name in Editor.FILTERS)) throw new Error(`Unknown look "${name}"`);
          const seg = Editor.timeline[Editor.timeline.length - 1];
          if (seg) { seg.filter = name; Editor.setAll({}); }
        },
        speed: (n) => {
          const seg = Editor.timeline[Editor.timeline.length - 1];
          if (seg) { seg.speed = Number(n) || 1; Editor.setAll({}); }
        },
        export: () => Editor.exportNow()
      }
    };
  }

  async function run(code, log) {
    if (!canRun) {
      throw new Error("This frame blocks script execution (CSP). Scripts run on the deployed site.");
    }
    const api = makeApi(log);
    const fn = new AsyncFunction("api", "log", `"use strict";\n${code}`);
    return fn(api, log);
  }

  /* ---------------- script editor window ---------------- */

  function openScript(script, origin) {
    Desk.openWindow({
      id: `script:${script.id}`,
      title: script.name,
      meta: "script",
      tint: TINT,
      size: { w: 640, h: 520 },
      origin,
      build(body, win) {
        body.className = "win-body scr";
        body.innerHTML = `
          <div class="scr-bar">
            <input class="scr-name" value="${Desk.esc(script.name)}" aria-label="Script name" spellcheck="false">
            <button class="btn btn-mini" data-act="save">Save</button>
            <button class="btn btn-mini btn-danger" data-act="delete">Delete</button>
            <button class="btn btn-accent" data-act="run">Run</button>
          </div>
          ${canRun ? "" : `<p class="scr-warn">This preview frame blocks script execution. The code still saves, and runs on the deployed site.</p>`}
          <textarea class="code-input" spellcheck="false" aria-label="Script source">${Desk.esc(script.code)}</textarea>
          <div class="scr-status mono"><span data-role="pos">Ln 1, Col 1</span><span data-role="state">idle</span></div>
          <div class="scr-out" aria-label="Output" aria-live="polite"></div>`;

        const area = body.querySelector(".code-input");
        const out = body.querySelector(".scr-out");
        const pos = body.querySelector('[data-role="pos"]');
        const state = body.querySelector('[data-role="state"]');
        const nameInput = body.querySelector(".scr-name");

        const write = (text, tone = "log") => {
          const line = document.createElement("p");
          line.className = "out-line";
          line.dataset.tone = tone;
          line.textContent = text;
          out.appendChild(line);
          out.scrollTop = out.scrollHeight;
        };

        const log = (...args) =>
          write(args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" "));

        function updatePos() {
          const upto = area.value.slice(0, area.selectionStart);
          const lines = upto.split("\n");
          pos.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
        }

        area.addEventListener("keyup", updatePos);
        area.addEventListener("click", updatePos);
        area.addEventListener("keydown", (e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const { selectionStart: s, selectionEnd: t } = area;
            area.value = area.value.slice(0, s) + "  " + area.value.slice(t);
            area.selectionStart = area.selectionEnd = s + 2;
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); doRun(); }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
        });

        async function save() {
          script.name = nameInput.value.trim() || "untitled.js";
          script.code = area.value;
          script.updated = Date.now();
          await Store.put("scripts", script);
          Desk.toast(`Saved ${script.name}`, "good");
        }

        async function doRun() {
          out.innerHTML = "";
          state.textContent = "running";
          write(`▸ ${script.name}`, "meta");
          const started = performance.now();
          try {
            const result = await run(area.value, log);
            if (result !== undefined) write(`⇒ ${String(result)}`, "meta");
            write(`✓ finished in ${Math.round(performance.now() - started)}ms`, "good");
          } catch (err) {
            write(`✕ ${err.message}`, "bad");
          } finally {
            state.textContent = "idle";
          }
        }

        body.addEventListener("click", async (e) => {
          const act = e.target.closest("[data-act]")?.dataset.act;
          if (act === "run") doRun();
          if (act === "save") save();
          if (act === "delete") {
            await Store.del("scripts", script.id);
            Desk.toast(`Deleted ${script.name}`);
            win.close();
          }
        });

        updatePos();
      }
    });
  }

  async function newScript() {
    const script = {
      id: `script-${Date.now()}`,
      name: "untitled.js",
      code: `// A new script. api.camera, api.editor and api.clips are yours.\nlog("Hello from a new script.");\n`,
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
      size: { w: 500, h: 380 },
      origin,
      build(body, win) {
        body.className = "win-body";
        const grid = document.createElement("div");
        grid.className = "filegrid";
        body.appendChild(grid);

        async function render() {
          const all = await Store.all("scripts");
          win.setMeta(`${all.length} scripts`);
          grid.innerHTML =
            all.map((s, i) => `
              <button class="file" data-script="${s.id}" style="--i:${i}; --f-accent:${TINT}">
                <span class="file-art file-art--code" aria-hidden="true"><span class="mono">JS</span></span>
                <span class="file-name">${Desk.esc(s.name)}</span>
                <span class="file-kind">script</span>
              </button>`).join("") +
            `<button class="file file--new" data-new="1" style="--i:${all.length}">
               <span class="file-art file-art--new" aria-hidden="true">+</span>
               <span class="file-name">New script</span>
               <span class="file-kind">create</span>
             </button>`;
          grid.classList.add("spill");
        }

        grid.addEventListener("click", async (e) => {
          if (e.target.closest("[data-new]")) return newScript();
          const id = e.target.closest("[data-script]")?.dataset.script;
          if (!id) return;
          const all = await Store.all("scripts");
          const script = all.find((s) => s.id === id);
          if (script) openScript(script, e.target.closest("[data-script]").getBoundingClientRect());
        });

        const off = Store.on("scripts", render);
        win.onCleanup(off);
        render();
      }
    });
  }

  return { open, seed, openScript, newScript, TINT, canRun };
})();
