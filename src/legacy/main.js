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
        { t: "lede", v: "Three folders and two apps. Write what you are going to say, record it, cut it. An agent can work in here beside you, and cannot change anything without you." },
        { t: "h", v: "The five things on the desktop" },
        { t: "ul", v: [
          "**Readme**: this folder. What everything does.",
          "**Scripts**: what you are going to say on camera, with a prompter and a place for research.",
          "**Skills**: craft notes on cutting, pacing and looks, and **AI Skills** inside it: instructions you write for the agent.",
          "**Camera**: live preview, one button to record, and the prompter over the top of it.",
          "**Editor**: lanes of clips, graphics and sound. Trim, grade, reframe, reorder, export."
        ] },
        { t: "h", v: "A first run" },
        { t: "ul", v: [
          "Open **Scripts**, write a couple of lines, and read them through with the prompter.",
          "Open **Camera**, load that script, and press the red button. Space advances the prompter a line at a time. Press the button again to stop.",
          "Open **Editor**. Your take is in the library on the left: click it to put it on the timeline.",
          "Open the **Transcript** tab. The words are already there and already timed, because the prompter was watching. Click one to jump to it.",
          "Drag either end of the clip to trim, pick a look, and press **Export**."
        ] },
        { t: "note", v: "Rendering happens in real time, so a forty-second cut takes forty seconds to export. It is worth knowing before you start one." },
        { t: "note", v: "No camera? Every app has an Import video button. The editor works the same on a file you already have." },
        { t: "h", v: "Being shown around" },
        { t: "p", v: "The **?** in the menubar walks the whole machine: it dims the screen, lights up each thing in turn and says what it is for. Every window's title bar has its own **?** for that window alone, in more detail. Arrow keys move through a tour, Escape leaves it." },
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
        { t: "lede", v: "A preview, a shutter, a teleprompter over the top of it, and a strip of what you just shot." },
        { t: "p", v: "Recording uses MediaRecorder against the live stream, which produces WebM. Clips are written straight to the library, where the Editor and any script can reach them." },

        { t: "h", v: "Camera, or your screen" },
        { t: "ul", v: [
          "**Camera** is the default: whatever the machine is pointing at you with.",
          "**Screen** records a window or a whole display, and keeps your microphone, so a walkthrough is one take rather than a picture you narrate afterwards.",
          "Stopping the share from the browser's own bar stops the recording too, instead of running on with a frozen frame."
        ] },

        { t: "h", v: "Controls" },
        { t: "ul", v: [
          "**Shutter**: starts recording, and turns into a stop button with a running timer.",
          "**Camera picker**: appears when the machine has more than one.",
          "**Mic**: toggles audio capture. It restarts the stream, so the preview blinks.",
          "**Import video**: pulls a file into the library without a camera."
        ] },

        { t: "h", v: "The teleprompter, while you record" },
        { t: "p", v: "Load a script and its lines appear over the preview, one at a time, large. **Space or a click advances; the left arrow goes back.** It does not scroll on a timer, because a prompter that gets ahead of you is worse than no prompter at all: you advance when you have finished the line." },
        { t: "note", v: "Advancing is also how the transcript gets made. Each press records which line was on screen at which second of the take, saved onto the clip, and the Editor turns that into word-level timing with no upload and no key. See **The agent** for what reads it." },

        { t: "h", v: "If the camera will not start" },
        { t: "p", v: "The app tells you which of the three it is: permission was refused, no device exists, or another program holds it. Camera access also needs a secure context, so this works on https and on localhost, and an embedded preview frame may refuse it outright." },
        { t: "p", v: "**Ask for camera and mic** on that panel puts the question to the browser deliberately, which matters in an agent's browser: a prompt that appears on its own, that nobody pressed anything for, is one some browsers answer for you. The **Permissions** chip in the menubar shows the same thing for everything at once." }
      ]
    },
    {
      id: "editor-doc",
      name: "Editor",
      kind: "doc",
      eyebrow: "App",
      title: "Editor",
      blocks: [
        { t: "lede", v: "Lanes of clips, graphics and sound, in one timebase, with the picture above and whatever you have selected either side of it." },

        { t: "h", v: "The five regions" },
        { t: "ul", v: [
          "**Left rail**: four tabs. **Library** is your footage and sound, with one orange **Import** for both: the file says which it is, so there is no kind to pick first. **Text** adds words; **Transitions** holds how a clip arrives and leaves, and where it sits in the frame; **Transcript** is what was said.",
          "**Viewer**, centre: plays the whole cut as one piece. The frame shape is the composition's, not the footage's, so a reframe is something you look at rather than discover at export.",
          "**Right rail**: **Clip** for whatever is selected, **Motion** for the graphics on the cut and anything waiting on a decision, **Comp** for the composition as a whole.",
          "**Timeline**, bottom: the lanes, with **Split**, **Text**, **Motion graphics**, **Overlay** and the two lane buttons above them, and **Undo** and **Redo** beside the page switch.",
          "Every divider between them can be dragged, and the timeline has its own zoom."
        ] },

        { t: "h", v: "Lanes" },
        { t: "p", v: "Video tracks count up from **V1** and audio tracks from **A1**, and graphics are numbered along with the video rather than given a letter of their own: to the frame a title card is one more thing drawn on top, and a second alphabet would be one more thing to learn." },
        { t: "ul", v: [
          "**V1** is the spine: clips end to end, and its length is the length of the cut.",
          "**A1** is the spine's own sound, drawn from the same segments rather than kept as a second list of them, because trimming the picture trims the sound with it.",
          "Graphics sit on the next video number above your overlays; sound effects on the next audio number below A1.",
          "**+ Video** and **+ Audio** add more. Anything on one floats: it has its own position, trim, volume and placement in the frame.",
          "A lane only appears once it has something in it, so an empty cut is not a wall of empty rows."
        ] },

        { t: "h", v: "Moving and cutting" },
        { t: "ul", v: [
          "Drag a clip along V1 to reorder it. It snaps to the seam between two clips, and a marker shows which one before you let go.",
          "**[** and **]** shuffle the selected clip one place, for when you would rather not aim a drag.",
          "Drag either end of a clip to trim it. **S** splits whatever is under the playhead.",
          "Drag the ruler, or the playhead's handle, to scrub.",
          "**Backspace** removes whatever is selected: a clip, an overlay, a graphic, a sound or a suggestion. **Right click** anything on the timeline for the same thing, and for **Open** on a motion graphics clip.",
          "**Rename** in the Clip panel renames the underlying clip, so the library stops being a list of `export-00_41`."
        ] },

        { t: "h", v: "Shape of the frame" },
        { t: "p", v: "**16:9**, **9:16** and **1:1** sit beside the picture. Changing one moves no graphic, because every position in a composition is a fraction of the frame rather than a pixel." },
        { t: "ul", v: [
          "**Fill frame** crops the footage to the frame. Going from 16:9 to 9:16 this throws away about seventy per cent of the width, which is right once you have chosen what to keep.",
          "**Fit whole clip** keeps all of it and pads the edges instead.",
          "**Drag the picture** to choose what stays in frame. It moves under your cursor, and it stops where the hidden part runs out, so you cannot slide the shot off its own edge."
        ] },
        { t: "note", v: "On footage already the shape of the frame there is nothing hidden and nothing to pan, and the cursor says so rather than offering a grab that would do nothing." },

        { t: "h", v: "Sound" },
        { t: "ul", v: [
          "Every clip has a volume and a mute, and every overlay item has its own.",
          "**Unlink sound from picture** lifts a clip's audio onto its own audio lane. From then on it has its own position and trim, so a line can run under the next shot, or be replaced.",
          "**Relink** puts it back, and brings the volume with it.",
          "Effects are synthesised in the browser: there is nothing to download and nothing to license."
        ] },

        { t: "h", v: "Looks, transitions and transform" },
        { t: "ul", v: [
          "Six grades: none, mono, warm, cool, punch, faded. They are CSS filter strings in the preview and the identical string on the canvas at export.",
          "A transition is a real layer on the motion track, so you can drag it, retime it or delete it there rather than hunting for the menu that made it.",
          "Across, down, scale, rotate and flip live in **Transitions**. Put a key down, move the playhead, drag it again, and the two keys are an animation."
        ] },

        { t: "h", v: "Two pages" },
        { t: "p", v: "**Edit** is the cut. **Motion** appears when you open a motion graphics clip, and then the timeline becomes that clip: its own length, one element to a row, trimmed and moved in its own local time. Come back out and the cut is where you left it." },

        { t: "h", v: "Undo" },
        { t: "p", v: "**Ctrl+Z** and **Ctrl+Shift+Z**, or the two buttons, over everything that changes the cut: adding, trimming, moving, reordering, splitting, deleting, and accepting a cut. A snapshot carries the composition with it, because a timeline edit takes composition state with it. Accepting a suggestion is not an undo step; **Reject** is the button for that." },

        { t: "h", v: "The transcript" },
        { t: "p", v: "**Transcript** in the left rail is the words, timed. Click one to move the playhead to it. Fillers are struck through and gaps are called out, and **Find fillers and gaps** stages a cut over each one for you to take or leave." },
        { t: "note", v: "The composition can also be read as code, one `Sequence` per graphic with the exact frame it starts on. There is no panel for it: it is a tool an agent calls, `get_composition_code`, so what it sees and what you see are the same composition described two ways." },

        { t: "h", v: "Keyboard" },
        { t: "ul", v: [
          "**Space** plays and pauses. **J K L** and the arrows move the playhead; hold Shift for a whole second.",
          "**Home** and **End** jump to either end. **S** splits, **T** adds text, **B** adds a motion graphics clip.",
          "**[** and **]** move the selected clip. **Backspace** deletes it."
        ] },

        { t: "h", v: "Export" },
        { t: "p", v: "There is no encoder dependency here. Export replays the timeline into a canvas at the composition's own size, draws the accepted graphics over each frame with the same function the preview uses, mixes the audio back in through a Web Audio graph, and records the result. That has one consequence worth knowing: **rendering happens in real time**, so a forty-second cut takes forty seconds." },
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

        { t: "h", v: "Two views, and a place to put research" },
        { t: "ul", v: [
          "**Draft** is the writing surface: the lines, in order, as one document.",
          "**Shot list** is the same script read as directions, for the day you are filming rather than the day you are writing.",
          "**Research** is a pane for whatever you pasted in while reading around. It is not filler: it is what an agent writes from, so a suggested line comes out of your sources instead of out of the air."
        ] },

        { t: "h", v: "Runtime" },
        { t: "p", v: "Every line shows an estimated duration, and the script totals them. The estimate assumes about 150 words a minute, which is an unhurried speaking pace; if you read fast, treat it as an upper bound." },

        { t: "h", v: "Two prompters, for two different jobs" },
        { t: "ul", v: [
          "**In here**, the rehearsal prompter scrolls the whole script across roughly its estimated runtime, brightening the line you should be on. − and + change speed while it runs. It is for finding out whether the writing says out loud what it says on the page.",
          "**In the Camera**, the prompter waits: one line at a time, advanced by space or a click. That is the one to use on a take."
        ] },

        { t: "h", v: "A line the agent wrote" },
        { t: "p", v: "A suggestion arrives in the draft itself, in a gap held open at the line it belongs before, at the document's own line height. It reads as part of the page rather than a panel over it, and there is no tool that can accept one: that is a click, and only yours." },
        { t: "note", v: "Write the hook last. You rarely know what the video is about until you have written the rest of it." }
      ]
    },
    {
      id: "the-agent",
      name: "The agent",
      kind: "doc",
      eyebrow: "Reference",
      title: "What the agent can and cannot do",
      blocks: [
        { t: "lede", v: "This page hands a browser agent twenty-eight tools. Not one of them can put a frame into your video." },

        { t: "p", v: "The tools are registered on `document.modelContext`, which is the browser's own way of letting a page offer an agent something to do. Open this site in an agent's browser and they appear in its site-tools panel. Open it in an ordinary one and nothing changes: the machine is the same machine, and the **Agent** chip in the menubar says whether a host is there and whether anything has actually called one." },

        { t: "h", v: "Why the tools live in the page" },
        { t: "p", v: "Because what makes them useful never leaves it. Which script is open, which beat the prompter is on, whether the camera is rolling and how far in, which clip is selected, where the playhead sits, and what you said and when you said it. There is no backend here, so no server has any of it. A service can tell you what is in a file you uploaded; it cannot tell you what you were reading off the prompter when you said it." },

        { t: "h", v: "Reading is free" },
        { t: "p", v: "Roughly half the tools only look: the state of the desktop, the scripts, the recorder, the clips, the cut, the selection, the playhead, the graphics, the transcript, and the composition printed as code. They carry `readOnlyHint`, so a browser need not stop and ask before answering a question about your own timeline." },

        { t: "h", v: "Writing is a suggestion" },
        { t: "ul", v: [
          "A graphic arrives dashed on the timeline, previewing live over the footage, with the reason it was suggested on its card.",
          "A line arrives in the draft, in a gap held open where it would go.",
          "A cut arrives as a marked region under the track. Nothing is removed.",
          "A reframe arrives with the safe-area guides up, so the crop is a decision rather than a surprise."
        ] },
        { t: "p", v: "Every one of them waits. **Accept** and **Reject** are buttons, and the code behind them refuses anything that is not a real key or mouse event: the same bit the browser uses to tell a person from a script. There is no tool that accepts, no tool that exports, and no tool that deletes a clip." },
        { t: "note", v: "That is the whole bargain. An agent can compose a title card, put a sound under it, reframe the cut to vertical and list every hesitation in the take, in four calls, and you will still have to press something before any of it is in your video." },

        { t: "h", v: "Telling it how you work" },
        { t: "p", v: "**AI Skills**, inside the Skills folder, is a folder of your own instructions in markdown. Each one says when it applies, and the page offers the matching one back in its own tool results when the situation it was written for is actually on screen. It is a suggestion and nothing more: there is no way here to make an agent read anything, and there should not be." },

        { t: "h", v: "Folders" },
        { t: "p", v: "An agent can ask for a folder on your machine by name and say what it wants it for. Nothing opens on its own: the request sits there until you press the button that shows the browser's own directory picker, and the browser then asks you as well." }
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
        { t: "p", v: "Four stores in IndexedDB under the origin serving the page: your clips, your scripts, the folders you have filed the clips into, and the AI Skills you have written. Video never leaves the tab: recording, editing and export all happen locally, and the site has no backend to receive anything." },
        { t: "p", v: "A clip carries its own transcript, so it travels with the footage and dies with it rather than sitting in a table of its own. The one thing kept outside IndexedDB is an OpenAI key, if you paste one in for Whisper: that lives in this browser's localStorage and is sent to nowhere except OpenAI." },
        { t: "h", v: "What that means in practice" },
        { t: "ul", v: [
          "Clearing site data clears your clips. There is no copy anywhere else.",
          "A private window starts empty and forgets everything on close.",
          "If IndexedDB is unavailable, the apps fall back to memory for the session so nothing breaks, but a refresh loses the library.",
          "Export a cut you want to keep, and save the file."
        ] },
        { t: "h", v: "Permissions" },
        { t: "p", v: "The **Permissions** chip in the menubar is five lights: camera, microphone, screen capture, folders, and whether the browser will keep your clips when it is short of space. Green is allowed, amber means nobody has asked yet, and the accent colour means refused. Press one to ask for it." },
        { t: "note", v: "A refusal cannot be undone from in here. Once a browser has been told no for a site it stops asking and starts refusing instantly, so the way back is that browser's own site settings, and the panel says so rather than offering a button that would do nothing. **Storage** is the odd one out: it is not about access at all, it is asking the browser to keep your clips rather than clear them when space runs short." },
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

        { t: "h", v: "The Editor from the keyboard" },
        { t: "ul", v: [
          "**Space**, **J K L** and the arrows drive the playhead; **S** splits, **T** adds text, **B** adds a motion graphics clip.",
          "**[** and **]** move the selected clip along the spine, so reordering no longer needs a pointer.",
          "**Backspace** removes whatever is selected, a suggestion included.",
          "The three panel dividers are focusable separators: reach one with Tab and the arrow keys resize it."
        ] },

        { t: "h", v: "What is still not there" },
        { t: "ul", v: [
          "Exported video has no caption track. The transcript exists in the Editor; it does not yet travel with the file.",
          "Dragging a clip into the frame to reposition it is pointer-only. The same numbers are on sliders in **Transitions**, so nothing is unreachable, but the direct way needs a mouse.",
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
    id: "readme", name: "Readme", type: "folder", subtitle: "7 documents",
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
