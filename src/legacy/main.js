import { Store, Clips, timecode } from "./store.js";
import { Desk } from "./shell.js";
import { Camera } from "./camera.js";
import { Editor } from "./editor.js";
import { Scripts } from "./scripts-app.js";
import * as AiSkills from "./aiskills.js";
import { Skills } from "./skills.js";

/* ============================================================
   Readme folder + boot. Edit DOCS to change the documentation.
   ============================================================ */

export const Readme = (() => {
  const TINT = "#30ABC6";

  const DOCS = [
    {
      id: "getting-started",
      name: "Getting started",
      kind: "doc",
      eyebrow: "Start here",
      title: "This is a computer",
      blocks: [
        { t: "lede", v: "Three folders and two apps. Write what you are going to say, record it, cut it." },
        { t: "h", v: "The five things on the desktop" },
        { t: "ul", v: [
          "**Readme**: this folder. What everything does.",
          "**Scripts**: what you are going to say on camera, with a teleprompter.",
          "**Skills**: craft notes on cutting, pacing and looks.",
          "**Camera**: live preview, one button to record.",
          "**Editor**: a timeline. Trim, grade, reorder, export."
        ] },
        { t: "h", v: "A first run" },
        { t: "ul", v: [
          "Open Scripts, write a couple of lines, and hit Teleprompter.",
          "Open Camera and press the red button. Press it again to stop.",
          "Open Editor. Your clip is in the library on the left: click it to add it to the timeline.",
          "Drag the Start and End sliders to trim, pick a look, press Export."
        ] },
        { t: "note", v: "No camera? Every app has an Import video button. The editor works the same on a file you already have." },
        { t: "h", v: "Keyboard" },
        { t: "ul", v: [
          "⌘K / Ctrl+K: search docs, skills, scripts and clips.",
          "Escape: close the top window, or leave the teleprompter.",
          "F6: cycle through the open windows.",
          "⌘S inside a script: save it.",
          "Everything here works from the keyboard. See **Accessibility** for the rest."
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
          "**Shutter**: starts recording, and turns into a stop button with a running timer.",
          "**Camera picker**: appears when the machine has more than one.",
          "**Mic**: toggles audio capture. It restarts the stream, so the preview blinks.",
          "**Import video**: pulls a file into the library without a camera."
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
          "**Library**, left: every clip you have recorded or imported.",
          "**Preview**, centre: plays the timeline as one piece, not clip by clip.",
          "**Clip inspector**, right: trim, look, speed and sound for whatever is selected.",
          "**Timeline**, bottom: click to select, drag to reorder."
        ] },
        { t: "h", v: "Looks" },
        { t: "p", v: "Six grades: none, mono, warm, cool, punch, faded. They are CSS filter strings in preview and the identical string on the canvas at export, so what you see is what is written." },
        { t: "h", v: "Export" },
        { t: "p", v: "There is no encoder dependency here. Export replays the timeline into a canvas, captures that canvas as a stream, mixes the audio back in through a Web Audio graph, and records the result. That has one consequence worth knowing: **rendering happens in real time**, so a forty-second cut takes forty seconds." },
        { t: "note", v: "Exports are saved back into your library as a new clip, and offered as a download. The library copy is the reliable one: some embedded frames block downloads that a page starts itself." }
      ]
    },
    {
      id: "scripts-doc",
      name: "Writing a script",
      kind: "doc",
      eyebrow: "Folder",
      title: "Writing a script",
      blocks: [
        { t: "lede", v: "A script here is what you are going to say out loud, broken into lines you can actually deliver." },
        { t: "p", v: "Each line has two parts: the **spoken text**, and a **shot direction**: where the camera is, what the b-roll is, what the tone should be. The direction is for you while filming; it never appears in the teleprompter." },
        { t: "h", v: "Runtime" },
        { t: "p", v: "Every line shows an estimated duration, and the script totals them. The estimate assumes about 150 words a minute, which is an unhurried speaking pace; if you read fast, treat it as an upper bound." },
        { t: "h", v: "The teleprompter" },
        { t: "ul", v: [
          "Scrolls the whole script across roughly its estimated runtime.",
          "The line you should be on is bright; the rest sit back.",
          "− and + change speed while it runs. Space it out rather than racing it.",
          "**Open Camera** puts the recorder up beside it. Escape leaves."
        ] },
        { t: "note", v: "Write the hook last. You rarely know what the video is about until you have written the rest of it." }
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
          "If IndexedDB is unavailable, the apps fall back to memory for the session so nothing breaks, but a refresh loses the library.",
          "Export a cut you want to keep, and save the file."
        ] },
        { t: "h", v: "The theme" },
        { t: "p", v: "Light and dark are both designed. The page follows your system until you press the toggle, which stores an explicit choice." }
      ]
    },
    {
      id: "accessibility",
      name: "Accessibility",
      kind: "doc",
      eyebrow: "Reference",
      title: "Working without a mouse",
      blocks: [
        { t: "lede", v: "A desktop is a pointing metaphor by default. Everything here exists so the same machine can be driven from the keyboard, and so the things that happen on their own get said out loud." },

        { t: "h", v: "Focus work" },
        { t: "p", v: "**Focus work** is the name for how Tab moves through this page and how it shows you where it has got to. Every control on the desktop is a real button, so Tab reaches all of them in the order they are drawn: menubar, then the desktop icons, then any open window, then the dock." },
        { t: "ul", v: [
          "**Tab / Shift+Tab**: step forward and back through everything you can use.",
          "**A visible ring**: 3px of blue with a halo of the page's own ground colour behind it, so it stays readable over the wallpaper as well as over a window.",
          "**Skip to the desktop**: the first thing Tab reaches on a fresh page, so you can jump the menubar and land on the icons.",
          "**Arrow keys, Home and End**: move along the row of desktop icons without tabbing through every one. Tab still reaches them individually; the arrows are in addition.",
          "**Enter or Space**: open whatever the ring is on."
        ] },
        { t: "note", v: "Focus is never dropped on the floor. Close a window and focus returns to the icon that opened it, or to the window underneath if one is still up. Minimise a window and focus moves to the dock button that brings it back." },

        { t: "h", v: "Windows from the keyboard" },
        { t: "ul", v: [
          "**F6 / Shift+F6**: cycle through the open windows, front to back. It is the only way to reach a window sitting behind another one without dragging.",
          "**Escape**: close the top window.",
          "**⌘K / Ctrl+K**: the launcher. Type, arrow through the results, Enter to open."
        ] },
        { t: "p", v: "The launcher is a combobox: focus stays in the field while the arrows move the highlight, and the highlighted row is reported as you go rather than only when you pick it. Both it and the teleprompter hold focus inside themselves while they are up, and hand it back to whatever opened them when they close." },

        { t: "h", v: "The teleprompter" },
        { t: "ul", v: [
          "Opening it moves focus onto the play button, not into the page behind it.",
          "**Space** pauses and restarts the scroll: the thing you reach for when you are looking at the lens and not at the screen.",
          "**Escape** leaves, and focus goes back to the script you started from."
        ] },

        { t: "h", v: "Said out loud" },
        { t: "p", v: "Windows opening, closing and folding into the dock are silent events: they change the screen without anyone pressing anything visible. Each of them is announced through a polite live region, along with the prompter starting and stopping and the number of results a search found." },

        { t: "h", v: "Motion" },
        { t: "p", v: "Turn on **Reduce motion** in your system settings and this page listens. The window-open flight, the folder lids, the dock's entrance and the wallpaper's drift under the pointer all stop; windows simply appear and disappear. Nothing is lost but the animation." },

        { t: "h", v: "Contrast, and the wallpaper" },
        { t: "p", v: "The wallpaper is a photograph, which means text has to sit on top of a picture nobody designed for text. Three things keep it legible: a wash of the ground colour across the band where the icons sit, a halo in the same colour behind every desktop label, and a solid plate under the hint along the bottom. Each theme has its own photograph rather than one image dimmed: dark is the same valley at last light, not the light one turned down." },

        { t: "h", v: "What is still not there" },
        { t: "ul", v: [
          "Reordering clips on the timeline is drag-and-drop only. Everything else in the Editor has keys (J K L, Space, arrows, S to split), but reordering needs a pointer.",
          "Exported video has no caption track. The transcript exists in the Editor; it does not yet travel with the file.",
          "The desktop has not been tested against a screen magnifier at high zoom."
        ] },
        { t: "note", v: "If something here is unreachable from a keyboard, that is a bug rather than a limitation, and it is worth reporting as one." }
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
      size: { w: 720, h: 640 },
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
      help: "readme",
      meta: `${DOCS.length} documents`,
      tint: TINT,
      size: { w: 660, h: 460 },
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

/**
 * The glyphs.
 *
 * Camera and Editor draw theirs on the 92×100 desktop tile. The three folders
 * draw a hinged folder out there instead, but the dock has room for one small
 * square and nothing else, so every registered thing needs a glyph that reads
 * at 14 pixels, folders included.
 */
export const ICONS = {
  camera: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 8h3l1.4-2h7.2L17 8h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
    <circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>`,
  editor: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.9"/>
    <path d="M3 10h18M8 6v12M16 6v12" stroke="currentColor" stroke-width="1.6"/></svg>`,
  readme: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round">
    <path d="M4 5.5h6a2 2 0 0 1 2 2v11a2 2 0 0 0-2-2H4zM20 5.5h-6a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h6z"/></svg>`,
  scripts: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round">
    <path d="M5.5 3.5h13v17h-13z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>`,
  skills: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round">
    <path d="M12 3.5l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z"/></svg>`
};

/**
 * Boot.
 *
 * Called from React once the chrome is in the DOM. It cannot run at module
 * evaluation time: shell.js resolves #desktop, #dock and #icons the moment it is
 * imported, so the legacy modules are loaded dynamically after the first paint.
 */
export function boot() {
  Desk.register({
    id: "readme", name: "Readme", type: "folder", subtitle: "6 documents",
    tint: "#30ABC6", tintDark: "#1F7E94", icon: ICONS.readme, open: Readme.open
  });

  Desk.register({
    id: "scripts", name: "Scripts", type: "folder", subtitle: "write + run",
    tint: "#F7A501", tintDark: "#C97F00", icon: ICONS.scripts, open: Scripts.open
  });

  Desk.register({
    id: "skills", name: "Skills", type: "folder", subtitle: "cuts + looks",
    tint: "#29963F", tintDark: "#1C6B2C", icon: ICONS.skills, open: Skills.open
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

  Desk.addSearchSource(() => [
    {
      name: "How this works", where: "Guided tour", tint: "#F54E00",
      text: "help tour tutorial guide walkthrough what is this getting started",
      run: () => import("../help/tours.js").then((m) => m.startHelp("system")),
    },
  ]);

  Desk.addSearchSource(() =>
    Readme.DOCS.map((d) => ({
      name: d.name, where: "Readme", tint: Readme.TINT,
      text: d.blocks.map((b) => (Array.isArray(b.v) ? b.v.join(" ") : b.v || "")).join(" "),
      run: () => Readme.openDoc(d, null)
    }))
  );

  Desk.addSearchSource(() =>
    Skills.SKILLS.map((k) => ({
      name: k.name, where: "Skills", tint: Skills.TINT,
      text: k.blocks.map((b) => (Array.isArray(b.v) ? b.v.join(" ") : b.v || "")).join(" "),
      run: () => Skills.openSkill(k, null)
    }))
  );

  Desk.addSearchSource(async () =>
    (await Store.all("scripts")).map((s) => ({
      name: s.name, where: "Scripts", tint: Scripts.TINT,
      text: s.lines.map((l) => `${l.text} ${l.note || ""}`).join(" "),
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
  AiSkills.seed();
}
