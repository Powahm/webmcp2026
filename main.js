/* ============================================================
   Readme folder + boot. Edit DOCS to change the documentation.
   ============================================================ */

const Readme = (() => {
  const TINT = "#30ABC6";

  const DOCS = [
    {
      id: "getting-started",
      name: "Getting started",
      kind: "doc",
      eyebrow: "Start here",
      title: "This is a computer",
      blocks: [
        { t: "lede", v: "Two folders and two apps. Record something, cut it, and automate the whole thing with a script." },
        { t: "h", v: "The four things on the desktop" },
        { t: "ul", v: [
          "**Readme** — this folder. What everything does.",
          "**Scripts** — example programs, and a blank one you can write.",
          "**Camera** — live preview, one button to record.",
          "**Editor** — a timeline. Trim, grade, reorder, export."
        ] },
        { t: "h", v: "A first run" },
        { t: "ul", v: [
          "Open Camera and press the red button. Press it again to stop.",
          "Open Editor. Your clip is in the library on the left — click it to add it to the timeline.",
          "Drag the Start and End sliders to trim, pick a look, press Export."
        ] },
        { t: "note", v: "No camera? Every app has an Import video button. The editor works the same on a file you already have." },
        { t: "h", v: "Keyboard" },
        { t: "ul", v: [
          "⌘K / Ctrl+K — search clips, scripts and docs.",
          "Escape — close the top window.",
          "⌘Enter inside a script — run it. ⌘S — save it."
        ] }
      ]
    },
    {
      id: "camera-doc",
      name: "Camera",
      kind: "doc",
      eyebrow: "App",
      title: "Camera",
      blocks: [
        { t: "lede", v: "A preview, a shutter, and a strip of what you just shot." },
        { t: "p", v: "Recording uses MediaRecorder against the live camera stream, which produces WebM. Clips are written straight to the library, where the editor and any script can reach them." },
        { t: "h", v: "Controls" },
        { t: "ul", v: [
          "**Shutter** — starts recording, and turns into a stop button with a running timer.",
          "**Camera picker** — appears when the machine has more than one.",
          "**Mic** — toggles audio capture. It restarts the stream, so the preview blinks.",
          "**Import video** — pulls a file into the library without a camera."
        ] },
        { t: "h", v: "If the camera will not start" },
        { t: "p", v: "The app tells you which of the three it is: permission was refused, no device exists, or another program holds it. Camera access also needs a secure context, so this works on https and on localhost, and an embedded preview frame may refuse it outright." }
      ]
    },
    {
      id: "editor-doc",
      name: "Editor",
      kind: "doc",
      eyebrow: "App",
      title: "Editor",
      blocks: [
        { t: "lede", v: "A timeline of trimmed clips, each with its own look and speed." },
        { t: "h", v: "Layout" },
        { t: "ul", v: [
          "**Library**, left — every clip you have recorded or imported.",
          "**Preview**, centre — plays the timeline as one piece, not clip by clip.",
          "**Clip inspector**, right — trim, look, speed and sound for whatever is selected.",
          "**Timeline**, bottom — click to select, drag to reorder."
        ] },
        { t: "h", v: "Looks" },
        { t: "p", v: "Six grades — none, mono, warm, cool, punch, faded. They are CSS filter strings in preview and the identical string on the canvas at export, so what you see is what is written." },
        { t: "h", v: "Export" },
        { t: "p", v: "There is no encoder dependency here. Export replays the timeline into a canvas, captures that canvas as a stream, mixes the audio back in through a Web Audio graph, and records the result. That has one consequence worth knowing: **rendering happens in real time**, so a forty-second cut takes forty seconds." },
        { t: "note", v: "Exports are saved back into your library as a new clip, and offered as a download. The library copy is the reliable one — some embedded frames block downloads that a page starts itself." }
      ]
    },
    {
      id: "scripting",
      name: "Scripting API",
      kind: "doc",
      eyebrow: "Reference",
      title: "Scripting API",
      blocks: [
        { t: "lede", v: "Scripts are real async JavaScript. They get an `api` object and a `log()` function." },
        { t: "p", v: "Anything the two apps can do, a script can do without you clicking. There is no separate language and no sandbox dialect — top-level await works, and a thrown error lands in the output pane." },
        { t: "h", v: "Clips" },
        { t: "ul", v: [
          "`api.clips.all()` — every clip, oldest first.",
          "`api.clips.last()` — the most recent one.",
          "`api.clips.remove(id)` — delete it."
        ] },
        { t: "h", v: "Camera" },
        { t: "ul", v: [
          "`api.camera.record(seconds)` — records and resolves with the saved clip.",
          "`api.camera.open()` — brings the window up."
        ] },
        { t: "h", v: "Editor" },
        { t: "ul", v: [
          "`api.editor.open()` — open the editor window.",
          "`api.editor.add(clip)` — append a clip, by object or by id.",
          "`api.editor.trim(in, out)` — set in and out points, in seconds.",
          "`api.editor.look(name)` — none, mono, warm, cool, punch, faded.",
          "`api.editor.speed(n)` — 0.5, 1, 1.5 or 2.",
          "`api.editor.clear()` — empty the timeline.",
          "`api.editor.export()` — render it."
        ] },
        { t: "h", v: "Odds and ends" },
        { t: "ul", v: [
          "`api.sleep(ms)`, `api.toast(message)`, `api.timecode(seconds)`."
        ] },
        { t: "note", v: "Scripts are constructed with the Function constructor. A page served under a Content-Security-Policy without unsafe-eval will refuse to run them — the editor says so up front and still saves your code." }
      ]
    },
    {
      id: "storage",
      name: "Storage and privacy",
      kind: "doc",
      eyebrow: "Reference",
      title: "Where everything lives",
      blocks: [
        { t: "lede", v: "On your machine, in your browser. Nothing is uploaded, because there is nowhere to upload it to." },
        { t: "p", v: "Clips and scripts are held in IndexedDB under the origin serving the page. Video never leaves the tab: recording, editing and export all happen locally, and the site has no backend to receive anything." },
        { t: "h", v: "What that means in practice" },
        { t: "ul", v: [
          "Clearing site data clears your clips. There is no copy anywhere else.",
          "A private window starts empty and forgets everything on close.",
          "If IndexedDB is unavailable, the apps fall back to memory for the session so nothing breaks — but a refresh loses the library.",
          "Export a cut you want to keep, and save the file."
        ] },
        { t: "h", v: "The theme" },
        { t: "p", v: "Light and dark are both designed. The page follows your system until you press the toggle, which stores an explicit choice." }
      ]
    }
  ];

  const bold = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const code = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>');
  const rich = (s) => code(bold(Desk.esc(s)))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="doc-link" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  function renderBlock(b) {
    switch (b.t) {
      case "lede": return `<p class="doc-lede">${rich(b.v)}</p>`;
      case "meta": return `<ul class="doc-meta">${b.v.map((m) => `<li><span>${Desk.esc(m)}</span></li>`).join("")}</ul>`;
      case "h":    return `<h2>${Desk.esc(b.v)}</h2>`;
      case "p":    return `<p>${rich(b.v)}</p>`;
      case "ul":   return `<ul>${b.v.map((li) => `<li>${rich(li)}</li>`).join("")}</ul>`;
      case "note": return `<p class="doc-note">${rich(b.v)}</p>`;
      case "rule": return `<hr class="doc-rule">`;
      default:     return "";
    }
  }

  function openDoc(doc, origin) {
    Desk.openWindow({
      id: `doc:${doc.id}`,
      title: doc.name,
      meta: "Readme",
      tint: TINT,
      size: { w: 580, h: 500 },
      origin,
      build(body) {
        const article = document.createElement("article");
        article.className = "doc";
        article.innerHTML =
          `<span class="doc-eyebrow">${Desk.esc(doc.eyebrow)}</span><h1>${Desk.esc(doc.title)}</h1>` +
          doc.blocks.map(renderBlock).join("");
        body.appendChild(article);
      }
    });
  }

  function open(origin) {
    Desk.openWindow({
      id: "readme",
      title: "Readme",
      meta: `${DOCS.length} documents`,
      tint: TINT,
      size: { w: 520, h: 360 },
      origin,
      build(body) {
        body.className = "win-body";
        const grid = document.createElement("div");
        grid.className = "filegrid spill";
        grid.innerHTML = DOCS.map((d, i) => `
          <button class="file" data-doc="${d.id}" style="--i:${i}; --f-accent:${TINT}">
            <span class="file-art" aria-hidden="true"></span>
            <span class="file-name">${Desk.esc(d.name)}</span>
            <span class="file-kind">${Desk.esc(d.kind)}</span>
          </button>`).join("");

        grid.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-doc]");
          if (!btn) return;
          const doc = DOCS.find((d) => d.id === btn.dataset.doc);
          if (doc) openDoc(doc, btn.getBoundingClientRect());
        });

        body.appendChild(grid);
      }
    });
  }

  return { open, openDoc, DOCS, TINT };
})();

/* ============================================================
   Boot
   ============================================================ */

const ICONS = {
  camera: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 8h3l1.4-2h7.2L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
    <circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>`,
  editor: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.9"/>
    <path d="M3 10h18M8 6v12M16 6v12" stroke="currentColor" stroke-width="1.6"/></svg>`
};

Desk.register({
  id: "readme", name: "Readme", type: "folder", subtitle: "5 documents",
  tint: "#30ABC6", tintDark: "#1F7E94", open: Readme.open
});

Desk.register({
  id: "scripts", name: "Scripts", type: "folder", subtitle: "write + run",
  tint: "#F7A501", tintDark: "#C97F00", open: Scripts.open
});

Desk.register({
  id: "camera", name: "Camera", type: "app", subtitle: "record",
  tint: "#F54E00", icon: ICONS.camera, open: Camera.open
});

Desk.register({
  id: "editor", name: "Editor", type: "app", subtitle: "cut + export",
  tint: "#B62AD9", icon: ICONS.editor, open: Editor.open
});

Desk.renderIcons();

/* launcher sources: docs, scripts, clips */

Desk.addSearchSource(() =>
  Readme.DOCS.map((d) => ({
    name: d.name, where: "Readme", tint: Readme.TINT,
    text: d.blocks.map((b) => (Array.isArray(b.v) ? b.v.join(" ") : b.v || "")).join(" "),
    run: () => Readme.openDoc(d, null)
  }))
);

Desk.addSearchSource(async () =>
  (await Store.all("scripts")).map((s) => ({
    name: s.name, where: "Scripts", tint: Scripts.TINT, text: s.code,
    run: () => Scripts.openScript(s, null)
  }))
);

Desk.addSearchSource(async () =>
  (await Clips.all()).map((c) => ({
    name: c.name, where: "Clips", tint: Editor.TINT, text: c.kind,
    run: () => Editor.openWith(c.id)
  }))
);

Scripts.seed();
