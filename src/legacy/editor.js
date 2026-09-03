import { Clips, Folders, noPictureMessage, Store, timecode } from "./store.js";
import { drawGraphics } from "../graphics/render.js";
import {
  accept as acceptGraphic,
  acceptedGraphics,
  liveGraphics,
  onGraphics,
  pendingGraphics,
  reject as rejectGraphic,
  removeGraphic,
} from "../graphics/store.js";
import { Desk } from "./shell.js";
import { Camera } from "./camera.js";

/* The composition engine: the frame-accurate graphics layer over the cut, the
   transcript derived from the teleprompter, and cuts staged against the edit.
   The timeline, the trims and the six looks below are untouched by all of it:
   the composition sits on top of the cut and never owns the footage. */
import { createMixer, createScheduler, speechRanges } from "../comp/audio.js";
import { COMPONENT_INFO, SFX_PRESETS, validateLayer } from "../comp/composition.js";
import { formatOf, keyedAt, toSeconds } from "../comp/engine.js";
import { isolate, PALETTE_ROLES as COMP_ROLES, palette, POSITIONS as COMP_POSITIONS } from "../comp/paint.js";
import { fitVideo, renderComposition } from "../comp/render.js";
import {
  acceptAudio,
  acceptedLayers,
  acceptFormat,
  acceptLayer,
  composition,
  liveAudio,
  liveLayers,
  layerFrames,
  onComposition,
  pendingAudio,
  pendingCount,
  pendingLayers,
  proposeLayer,
  editLayer,
  editAudio,
  rejectAudio,
  rejectFormat,
  rejectLayer,
  removeAudio,
  removeLayer,
  setFormat,
  shiftAfter,
  adoptInside,
  reseat,
  disown,
  restoreComposition,
} from "../comp/store.js";
import { applyCut, onCuts, pendingCuts, proposeCut, rejectCut, retime, settle } from "../cuts/store.js";
import { FILLERS, findDeadWeight, toCutTime } from "../transcript/transcript.js";
import { hasApiKey, onTranscripts, setApiKey, transcriptsFor } from "../transcript/store.js";
import { transcribe } from "../transcript/whisper.js";

/* ============================================================
   Editor: a timeline of trimmed clips with per-clip grading.
   Export replays the timeline into a canvas and records the
   canvas stream, so there is no encoder dependency.
   ============================================================ */

export const Editor = (() => {
  const TINT = "#B62AD9";

  const FILTERS = {
    none:  "",
    mono:  "grayscale(1) contrast(1.1)",
    warm:  "sepia(0.35) saturate(1.35) contrast(1.05)",
    cool:  "hue-rotate(-12deg) saturate(1.15) brightness(1.05)",
    punch: "contrast(1.35) saturate(1.45)",
    faded: "contrast(0.85) saturate(0.75) brightness(1.12)"
  };
  const SPEEDS = [0.5, 1, 1.5, 2];

  /* the document being edited */
  let timeline = [];
  let selected = null;
  let refresh = () => {};
  /** Remember the cut before changing it. Assigned by the open window, the
   *  same way `refresh` is, because the undo stack lives with the window and
   *  `addClip` and `addBlank` out here have to be able to push onto it. */
  let mark = () => {};

  /**
   * Lanes above and below the spine.
   *
   * `timeline` is the base video track and stays exactly what it was: a
   * sequential list of segments that defines how long the cut is. Every other
   * lane is placed against that timebase rather than adding to it, which is
   * the whole reason the export, the transcript's cut-seconds and `segmentAt`
   * did not have to be rewritten to gain multi-track. Most editors work this
   * way too: the bottom video track is the spine and everything else floats
   * over it.
   *
   * An item on an overlay lane carries `at`, the cut-second it starts on.
   * Items on the base track do not, because their position is their order.
   */
  let lanes = [];
  let laneCount = 0;

  const laneById = (id) => lanes.find((l) => l.id === id) || null;
  const itemDuration = (it) => Math.max(0.05, (it.out - it.in) / (it.speed || 1));
  const itemEnd = (it) => it.at + itemDuration(it);

  /** How long the finished cut is: the spine, or an overlay that outlasts it. */
  const overlayEnd = () =>
    lanes.reduce((m, lane) => lane.items.reduce((n, it) => Math.max(n, itemEnd(it)), m), 0);

  function addLane(kind) {
    const same = lanes.filter((l) => l.kind === kind).length;
    const lane = {
      id: `lane-${Date.now().toString(36)}-${(laneCount++).toString(36)}`,
      kind,
      name: kind === "video" ? `V${same + 2}` : kind === "audio" ? `A${same + 1}` : "GFX",
      items: [],
      muted: false,
    };
    lanes = [...lanes, lane];
    return lane;
  }

  /** The overlay video items covering a moment, bottom lane first. */
  function overlaysAt(time) {
    const out = [];
    for (const lane of lanes) {
      if (lane.kind !== "video") continue;
      const it = lane.items.find((x) => time >= x.at && time < itemEnd(x));
      if (it) out.push({ lane, item: it, offset: time - it.at });
    }
    return out;
  }

  /** The audio items covering a moment. */
  function audioAt(time) {
    const out = [];
    for (const lane of lanes) {
      if (lane.kind !== "audio" || lane.muted) continue;
      for (const it of lane.items) {
        if (time >= it.at && time < itemEnd(it)) out.push({ lane, item: it, offset: time - it.at });
      }
    }
    return out;
  }

  const byId = new Map();

  /**
   * The open window's transcript rebuild, or a no-op when it is closed.
   *
   * `addClip`, `trimSelected` and `clear` live out here at module scope but
   * every one of them re-times the words, and the transcript lives inside
   * `build`. This is the seam between them: without it, opening the Editor on
   * a clip (Camera -> click the take) builds the transcript against an empty
   * timeline and then adds the clip, so the Transcript tab claims the take was
   * never recorded against a script.
   */
  let retimeTranscript = async () => {};

  const segDuration = (seg) => Math.max(0.05, (seg.out - seg.in) / seg.speed);
  const spine = () => timeline.reduce((sum, seg) => sum + segDuration(seg), 0);
  /**
   * How far the floating motion graphics clips reach.
   *
   * Assigned by the open window, because the floats live with it. It is a hook
   * rather than a read of `floats` for the same reason `refresh` is one: the
   * length of the cut is asked for out here, and the clips are in there.
   *
   * Without it, `total()` was the spine plus the overlay lanes and a floating
   * clip was in neither, so a title sequence hung off the end of the last shot
   * was drawn up to the end of that shot and stopped mid-animation.
   */
  let floatEnd = () => 0;
  const total = () => Math.max(spine(), overlayEnd(), floatEnd());

  /**
   * A clip this browser can play but not draw.
   *
   * Explicitly `false`, never merely falsy: clips saved before the probe
   * started recording this have no such field at all, and "we never checked"
   * is not "we checked and there is no picture".
   */
  const noPicture = (clip) => clip?.hasPicture === false;

  function segmentAt(time) {
    let acc = 0;
    for (const seg of timeline) {
      const d = segDuration(seg);
      if (time < acc + d) return { seg, offset: time - acc, start: acc };
      acc += d;
    }
    const last = timeline[timeline.length - 1];
    return last ? { seg: last, offset: segDuration(last), start: acc - segDuration(last) } : null;
  }

  async function addClip(clipId, { select = true, at = timeline.length } = {}) {
    const clip = (await Clips.all()).find((c) => c.id === clipId);
    if (!clip) return null;
    mark();
    byId.set(clip.id, clip);
    const seg = {
      uid: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      clipId: clip.id,
      in: 0,
      out: clip.duration || 5,
      filter: "none",
      speed: 1,
      muted: false
    };
    const i = Math.max(0, Math.min(at, timeline.length));
    timeline.splice(i, 0, seg);
    if (select) selected = seg.uid;
    await retimeTranscript();
    refresh();
    return seg;
  }

  /**
   * A blank clip.
   *
   * Until now a graphic had to sit on footage, which meant you could not build
   * a title sequence, a lower-third pack or an animated card without shooting
   * something first to put underneath it. A blank is a segment like any other:
   * it takes up time on the spine, it trims, it splits; it just paints a
   * colour instead of decoding a video. Everything downstream treats it as a
   * segment, so the transcript, the export and the cut tools needed no special
   * case beyond "there is no picture to draw".
   */
  function addBlank({ seconds = 5, colour = null, select = true } = {}) {
    mark();
    const seg = {
      uid: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      clipId: null,
      blank: true,
      colour,                 // null means the theme's own ground
      in: 0,
      out: Math.max(0.5, Math.min(60, seconds)),
      filter: "none",
      speed: 1,
      muted: true,
    };
    timeline.push(seg);
    if (select) selected = seg.uid;
    refresh();
    return seg;
  }

  /* ---------------- window UI ---------------- */

  function build(body, win) {
    body.className = "win-body ed";
    body.innerHTML = `
      <!-- Three tabs on the left, because the things you reach for while
           cutting are footage, words and transitions, and none of them is a
           property of whatever happens to be selected on the right. -->
      <aside class="ed-lib">
        <div class="cmp-tabs lib-tabs" role="tablist" aria-label="Left panel">
          <button class="cmp-tab" role="tab" data-lib="clips" aria-selected="true" tabindex="0">Library</button>
          <button class="cmp-tab" role="tab" data-lib="text" aria-selected="false" tabindex="-1">Text</button>
          <button class="cmp-tab" role="tab" data-lib="trans" aria-selected="false" tabindex="-1">Transitions</button>
          <button class="cmp-tab" role="tab" data-lib="words" aria-selected="false" tabindex="-1">Transcript</button>
        </div>
        <div class="lib-pane" data-libpane="clips">
          <div class="ed-lib-bar">
            <button class="btn btn-mini" data-act="import" title="Import video files into the library">Video</button>
            <button class="btn btn-mini" data-act="import-audio" title="Import music or sound effects into the library">Audio</button>
            <input type="file" accept="video/*" multiple hidden data-act="file">
            <input type="file" accept="audio/*" multiple hidden data-act="lib-audio-file">
          </div>
          <!-- Folders are a filter, not a tree. One row of chips with one open
               at a time: a library of forty takes and a music bed is a library
               you scroll rather than read, and nesting would only move the
               scrolling somewhere else. -->
          <div class="lib-folders" role="group" aria-label="Library folders"></div>
          <div class="ed-lib-list"></div>
        </div>
        <div class="lib-pane" data-libpane="text" hidden></div>
        <div class="lib-pane" data-libpane="trans" hidden></div>
        <div class="lib-pane" data-libpane="words" hidden></div>
        <div class="lib-pane" data-libpane="motion" hidden></div>
      </aside>

      <section class="ed-stage">
        <div class="ed-screen">
          <!-- The frame is the composition's, not the footage's. Before this
               the preview showed the clip at its own aspect ratio and only the
               export obeyed an accepted reframe, so 9:16 looked like a promise
               the file kept and the screen did not. -->
          <div class="ed-frame">
          <video class="ed-video" playsinline></video>
          <!-- Graphics are drawn here, by the same function the export calls.
               A DOM overlay would have meant two renderers for one spec, and
               a preview that quietly stops matching the file. -->
          <canvas class="ed-gfx"></canvas>
          </div>
          <p class="ed-empty">Add a clip from the library to start cutting.</p>
          <!-- Shown over the picture when the clip under the playhead is one
               this browser can play but not draw, so a black frame says why
               it is black instead of looking like a broken editor. -->
          <p class="ed-nopic" hidden></p>
        </div>
        <!-- The format lives where the picture is, because it is a thing you
             look at and change, not a setting you go and find. -->
        <div class="ed-formats">
          <span class="ed-formats-list" role="group" aria-label="Frame shape"></span>
          <span class="ed-zoom">
            <button class="btn btn-mini" data-zoom="out" aria-label="Zoom out">&minus;</button>
            <button class="btn btn-mini" data-zoom="fit" title="Fit the frame in the viewer">Fit</button>
            <button class="btn btn-mini" data-zoom="in" aria-label="Zoom in">+</button>
            <span class="ed-zoom-read mono">100%</span>
          </span>
        </div>
        <div class="ed-transport">
          <button class="btn btn-play" data-act="play" aria-label="Play">
            <svg class="ico-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>
            <svg class="ico-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h3v11h-3zM8.5 2.5h3v11h-3z"/></svg>
          </button>
          <input class="scrub" type="range" min="0" max="1000" value="0" aria-label="Playhead">
          <span class="ed-clock mono">00:00:00 / 00:00:00</span>
          <button class="btn btn-accent" data-act="export">Export</button>
        </div>
      </section>

      <div class="ed-grip ed-grip--lib" data-grip-pane="lib" role="separator"
           aria-label="Resize the library" tabindex="0"></div>
      <div class="ed-grip ed-grip--insp" data-grip-pane="insp" role="separator"
           aria-label="Resize the inspector" tabindex="0"></div>
      <aside class="ed-insp">
        <!-- Three columns of the same right-hand rail. Transitions moved to
             the left, beside the library, because a transition is a thing you
             go and fetch rather than a property of the selection. -->
        <div class="cmp-tabs insp-tabs" role="tablist" aria-label="Inspector">
          <button class="cmp-tab" role="tab" data-insp="clip" aria-selected="true" tabindex="0">Clip</button>
          <button class="cmp-tab" role="tab" data-insp="gfx" aria-selected="false" tabindex="-1">Motion</button>
          <button class="cmp-tab" role="tab" data-insp="comp" aria-selected="false" tabindex="-1">Comp</button>
        </div>
        <div class="insp-panes"></div>
      </aside>

      <div class="ed-timeline">
        <div class="ed-grip ed-grip--tl" data-grip-pane="tl" role="separator"
             aria-label="Resize the timeline" tabindex="0"></div>
        <div class="ed-head">
          <!-- One pane, three views of the same cut. The transcript and the
               code are both full-width things, which is why they live down
               here beside the track rather than in the 196px inspector. -->
          <!-- The page you are on. Editing the cut and building a motion
               graphics clip are two different jobs with two different sets of
               panels, so they are two pages rather than one crowded one. -->
          <!-- Only visible while scoped into a motion graphics clip's own
               timeline: the way back out, kept beside the page it returns
               you to rather than in a crumb bar of its own further down. -->
          <button class="btn btn-mini ed-back" data-act="scope-out" hidden>← Timeline</button>
          <div class="ed-pages" role="group" aria-label="Page">
            <button class="btn btn-mini ed-page" data-page-to="edit" aria-pressed="true">Edit</button>
            <button class="btn btn-mini ed-page" data-page-to="motion" aria-pressed="false" hidden>Motion</button>
          </div>
          <button class="btn btn-mini btn-icon" data-act="undo" title="Undo the last timeline edit (Ctrl+Z)" aria-label="Undo" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.2 3.5 2.7 7l3.5 3.5M3.2 7h6.3a3.3 3.3 0 0 1 0 6.6H7"/></svg>
          </button>
          <button class="btn btn-mini btn-icon" data-act="redo" title="Redo the last undone edit (Ctrl+Shift+Z)" aria-label="Redo" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.8 3.5 3.5 3.5-3.5 3.5M12.8 7H6.5a3.3 3.3 0 0 0 0 6.6H9"/></svg>
          </button>
        </div>
        <div class="cmp-pane" id="pane-track" data-pane="track" tabindex="0">
          <div class="tl-tools">
            <button class="btn btn-mini" data-act="split" title="Split the clip under the playhead (S)">Split</button>
            <button class="btn btn-mini" data-act="add-text" title="Add a text clip at the playhead (T)">Text</button>
            <button class="btn btn-mini" data-act="add-blank" title="Add a motion graphics clip (B)">Motion graphics</button>
            <button class="btn btn-mini" data-act="add-overlay" title="Add a motion graphics clip over the footage">Overlay</button>
            <button class="btn btn-mini" data-act="add-lane" title="Add another video lane">+ Video</button>
            <button class="btn btn-mini" data-act="add-audio" title="Add another audio lane">+ Audio</button>
            <input type="file" accept="audio/*" multiple hidden data-act="audio-file">
            <span class="tl-zoomwrap">
              <label class="tl-zoom-label mono" for="tl-zoom">Zoom</label>
              <input class="tl-zoom" id="tl-zoom" type="range" min="100" max="800" value="100" aria-label="Timeline zoom">
            </span>
          </div>
          <!-- One scroller for the ruler, every lane and the playhead, so they
               cannot drift out of register when the timeline is zoomed. -->
          <div class="tl-scroll">
            <div class="tl">
              <!-- One coordinate space for the ruler, the lanes and the
                   playhead, inset past the lane-label gutter.

                   This used to be three. The lanes are padded to leave room
                   for their names, so a clip at 50% sat halfway across
                   (width - gutter), while the ruler ticks and the playhead sat
                   halfway across the full width and timeAtPointer measured the
                   full width too. Everything therefore disagreed by the gutter
                   plus a scale factor (about two seconds on a minute-long
                   cut), which is why a cut landed nowhere near where it was
                   aimed. The tl-field element below is that one space, and it
                   is the only rectangle the pointer is measured against. -->
              <div class="tl-ruler" data-seek></div>
              <div class="tl-lanes"></div>
              <!-- An inset overlay spanning every lane: the playhead lives in
                   it, and it is the rectangle the pointer is measured against. -->
              <div class="tl-field" data-field>
                <div class="tl-playhead" data-playhead><span class="tl-playhead-grab"></span></div>
              </div>
            </div>
          </div>
          <div class="cut-strip"></div>
        </div>
      </div>

      <div class="ed-export" hidden>
        <div class="ed-export-card">
          <p class="ed-export-title">Exporting…</p>
          <div class="bar"><span class="bar-fill"></span></div>
          <p class="ed-export-note mono">Rendering in real time. Keep this window visible.</p>
          <button class="btn btn-ghost" data-act="cancel-export">Cancel</button>
        </div>
      </div>`;

    const video = body.querySelector(".ed-video");
    const gfx = body.querySelector(".ed-gfx");
    const gfxCtx = gfx.getContext("2d");
    const screen = body.querySelector(".ed-screen");
    const frameBox = body.querySelector(".ed-frame");
    const formatBar = body.querySelector(".ed-formats-list");
    const empty = body.querySelector(".ed-empty");
    const noPic = body.querySelector(".ed-nopic");
    const libList = body.querySelector(".ed-lib-list");
    const lib = body.querySelector(".ed-lib");
    const libTabs = body.querySelector(".lib-tabs");
    const libPane = (name) => body.querySelector(`[data-libpane="${name}"]`);
    let libTab = "clips";
    const LIB_TAB_ORDER = ["clips", "text", "trans", "words"];
    const tl = body.querySelector(".tl");
    const tlScroll = body.querySelector(".tl-scroll");
    const ruler = body.querySelector(".tl-ruler");
    const laneBox = body.querySelector(".tl-lanes");
    const field = body.querySelector(".tl-field");
    const head = body.querySelector(".tl-playhead");
    const zoom = body.querySelector(".tl-zoom");
    const insp = body.querySelector(".insp-panes");
    const inspTabs = body.querySelector(".insp-tabs");
    let inspTab = "clip";
    const scrub = body.querySelector(".scrub");
    const clock = body.querySelector(".ed-clock");
    const playBtn = body.querySelector('[data-act="play"]');
    const fileInput = body.querySelector('[data-act="file"]');
    const audioInput = body.querySelector('[data-act="audio-file"]');
    const libAudioInput = body.querySelector('[data-act="lib-audio-file"]');
    const libFolderBar = body.querySelector(".lib-folders");
    const exportPane = body.querySelector(".ed-export");
    const cutStrip = body.querySelector(".cut-strip");

    let playing = false;
    let playhead = 0;
    let loaded = null;
    let raf = 0;

    /* The cut-level transcript, rebuilt whenever the timeline changes.
       It has to be: every trim and reorder moves every word after it, and a
       stale transcript would place a caption confidently in the wrong place. */
    let transcript = null;
    let transcribing = false;
    /** True while the name field is open in the inspector. */
    let renaming = false;

    // Rebuilds are fired from a dozen places and each awaits IndexedDB, so two
    // can be in flight at once. Only the newest may write, or a slow read from
    // before a trim lands after the fast one from after it.
    let generation = 0;

    async function rebuildTranscript() {
      const mine = ++generation;
      if (!timeline.length) {
        if (mine === generation) transcript = null;
        return;
      }
      const map = await transcriptsFor(timeline.map((s) => s.clipId));
      if (mine !== generation) return;
      // Re-read the array after the await: accepting a cut replaces it whole.
      transcript = map.size ? toCutTime(timeline, map) : null;
    }

    retimeTranscript = rebuildTranscript;

    /* ---- rendering ---- */

    /** Which library card is having its name typed into, if any. */
    let libRenaming = null;
    /** The folder the library is showing: a folder id, "all", or "loose". */
    let libFolder = "all";
    /** The folders, as of the last render, so the chips and the move row agree. */
    let libFolders = [];
    /** Which card has its "put this somewhere" row open, if any. */
    let libFiling = null;
    /** Which folder chip is having its name typed into, if any. */
    let folderRenaming = null;

    const SOUND_MARK = `<span class="lib-wave" aria-hidden="true">
        <svg viewBox="0 0 64 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 12h3M11 7v10M18 4v16M25 9v6M32 3v18M39 8v8M46 5v14M53 10v4M60 12h0"/>
        </svg>
      </span>`;

    /** A real folder, rather than one of the two views that are not folders. */
    const isFolder = (id) => id !== "all" && id !== "loose";

    /**
     * The row of folders above the library.
     *
     * Every chip carries its own count, because the question a person asks a
     * folder row is "where did I put it", and a count is the cheapest answer
     * that is ever right. Rename and Delete belong to whichever folder is
     * open rather than sitting on every chip: two more buttons on each of
     * eight chips is a row nobody can read.
     */
    function renderFolders(folders, total, count) {
      const chip = (id, label, n, extra = "") => `
        <button class="lib-fold" data-folder="${id}" aria-pressed="${libFolder === id}" ${extra}>
          <span class="lib-fold-name">${Desk.esc(label)}</span>
          <span class="lib-fold-n mono">${n}</span>
        </button>`;

      const loose = count("loose");
      const named = folders
        .map((f) =>
          folderRenaming === f.id
            ? `<input class="lib-fold-rename" type="text" spellcheck="false"
                      data-folder-rename-input="${f.id}" value="${Desk.esc(f.name)}"
                      aria-label="New name for ${Desk.esc(f.name)}">`
            : chip(f.id, f.name, count(f.id), `data-folder-drop="${f.id}"`)
        )
        .join("");

      libFolderBar.innerHTML =
        chip("all", "All", total) +
        // No point offering the loose pile when nothing is loose, unless that
        // is the view you are standing in and it has just been emptied.
        (loose || libFolder === "loose" ? chip("loose", "Unfiled", loose, `data-folder-drop=""`) : "") +
        named +
        `<button class="lib-fold lib-fold--new" data-act="new-folder" title="Make a folder" aria-label="Make a folder">+</button>` +
        (isFolder(libFolder)
          ? `<span class="lib-fold-tools">
               <button class="btn btn-mini" data-folder-rename="${libFolder}">Rename</button>
               <button class="btn btn-mini" data-folder-del="${libFolder}">Delete</button>
             </span>`
          : "");
    }

    /** The folders a clip can be put in, shown on the card itself. */
    function filingHtml(clip) {
      const here = clip.folder || "";
      const opt = (id, label) => `
        <button class="lib-file-opt" data-file-to="${id}" data-file-clip="${clip.id}"
                aria-pressed="${here === id}">${Desk.esc(label)}</button>`;
      return `
        <div class="lib-filing" role="group" aria-label="Put ${Desk.esc(clip.name)} in a folder">
          ${opt("", "Unfiled")}
          ${libFolders.map((f) => opt(f.id, f.name)).join("")}
          <button class="lib-file-opt lib-file-opt--new" data-file-new="${clip.id}">+ New folder</button>
        </div>`;
    }

    async function renderLibrary() {
      const [clips, folders] = await Promise.all([Clips.all(), Folders.all()]);
      libFolders = folders;
      clips.forEach((c) => byId.set(c.id, c));

      // A clip pointing at a folder that has since gone is loose, not lost.
      // Deleting a folder must never take the footage in it out of the library.
      const live = new Set(folders.map((f) => f.id));
      const folderOf = (c) => (c.folder && live.has(c.folder) ? c.folder : null);
      if (isFolder(libFolder) && !live.has(libFolder)) libFolder = "all";

      const count = (id) =>
        clips.filter((c) => (id === "loose" ? !folderOf(c) : folderOf(c) === id)).length;
      const shown = clips.filter((c) =>
        libFolder === "all" ? true : libFolder === "loose" ? !folderOf(c) : folderOf(c) === libFolder
      );

      renderFolders(folders, clips.length, count);

      libList.innerHTML = shown.length
        ? shown.map((c) => {
            const sound = c.kind === "audio";
            return `
            <div class="lib-item${sound ? " lib-item--sound" : ""}">
              <button class="lib-add" draggable="true" data-add="${c.id}"
                      title="${sound
                        ? "Put it on an audio lane at the playhead, or drag it onto one"
                        : noPicture(c)
                          ? Desk.esc(noPictureMessage(c.name))
                          : "Add to the timeline, or drag onto a lane"}">
                ${sound
                  ? SOUND_MARK
                  : c.thumb ? `<img src="${c.thumb}" alt="">` : `<span class="strip-blank"></span>`}
                ${!sound && noPicture(c) ? `<span class="lib-mute mono">no picture</span>` : ""}
                <span class="lib-name">${Desk.esc(c.name)}</span>
                <span class="lib-time mono">${sound ? "sound &middot; " : ""}${timecode(c.duration)}</span>
              </button>
              <button class="lib-ren" data-lib-rename="${c.id}" aria-label="Rename ${Desk.esc(c.name)}" title="Rename">✎</button>
              <button class="lib-file" data-lib-file="${c.id}" aria-expanded="${libFiling === c.id}"
                      aria-label="Put ${Desk.esc(c.name)} in a folder" title="Put in a folder">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
                     stroke-width="2.2" stroke-linejoin="round"><path d="M3 6h6l2 2h10v11H3z"/></svg>
              </button>
              <button class="lib-del" data-del="${c.id}" aria-label="Delete ${Desk.esc(c.name)}">×</button>
              ${libRenaming === c.id
                ? `<input class="lib-rename" type="text" spellcheck="false"
                          data-lib-rename-input="${c.id}" value="${Desk.esc(c.name)}"
                          aria-label="New name for ${Desk.esc(c.name)}">`
                : ""}
              ${libFiling === c.id ? filingHtml(c) : ""}
            </div>`;
          }).join("")
        : `<p class="lib-empty">${
            clips.length
              ? "Nothing in this folder yet. Drag a clip onto the folder, or use the folder button on a card."
              : "No clips yet. Record one in Camera, or import a file."
          }</p>`;

      // Focus after the list is in the document, not before it exists.
      if (libRenaming) {
        const field = libList.querySelector("[data-lib-rename-input]");
        if (field) { field.focus(); field.select(); }
        else libRenaming = null;
      }
      if (folderRenaming) {
        const field = libFolderBar.querySelector("[data-folder-rename-input]");
        if (field) { field.focus(); field.select(); }
        else folderRenaming = null;
      }
    }

    /**
     * Sound onto an audio lane, from wherever it was asked for.
     *
     * Clicking a sound in the library and dropping a file on the timeline are
     * the same act with two doorways, so they run the same code: the last
     * audio lane if there is one, a new one if there is not.
     */
    function addSoundAt(clip, seconds) {
      const lane = lanes.filter((l) => l.kind === "audio").at(-1) || addLane("audio");
      lane.items.push({
        uid: `au-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        clipId: clip.id,
        name: clip.name,
        at: Math.max(0, seconds),
        in: 0,
        out: clip.duration || 10,
        speed: 1,
        gain: 1,
      });
      return lane;
    }

    /** Rename a folder, or leave it alone if the field was emptied. */
    async function commitFolderRename(id, value) {
      folderRenaming = null;
      const name = String(value ?? "").trim().slice(0, 40);
      if (!name) return void renderLibrary();
      await Folders.rename(id, name);   // emits, so the row redraws
    }

    /**
     * Rename a clip from the library.
     *
     * It writes the clip, not a label on a card, so the name follows it onto
     * the timeline and into every segment already cut from it. One name, one
     * place, whichever end you type it at.
     */
    async function commitLibRename(id, value) {
      const name = String(value ?? "").trim().slice(0, 80);
      libRenaming = null;
      const clip = byId.get(id);
      if (!name || !clip) return void renderLibrary();
      clip.name = name;
      byId.set(id, clip);
      await Store.put("clips", clip);   // emits, so the library redraws
      Desk.toast("Renamed", "good");
      refresh();
    }

    /* The components a Text clip can be: the ones whose whole content is
       words. A process flow or a comparison card wants a list, so it is the
       agent's to propose rather than something to switch into by accident. */
    const TEXTY_COMPONENTS = Object.keys(COMPONENT_INFO).filter((k) => {
      const f = COMPONENT_INFO[k].fields || {};
      return "text" in f && !("items" in f);
    });

    /* ---------------- resizing the panels ----------------
     *
     * The three regions are grid tracks, so a resize is one custom property
     * rather than any layout maths: the grip writes a width or a height and
     * the grid does the rest. Sizes are clamped so a panel cannot be dragged
     * to nothing and stranded.
     */
    const PANES = {
      lib:  { prop: "--ed-lib",  axis: "x", min: 96,  max: 420, from: (r, e) => e.clientX - r.left },
      // 176 rather than 150: below that the rail cannot fit its own three
      // tabs, and a tab you cannot read is a panel you cannot reach.
      insp: { prop: "--ed-insp", axis: "x", min: 176, max: 480, from: (r, e) => r.right - e.clientX },
      tl:   { prop: "--ed-tl",   axis: "y", min: 120, max: 620, from: (r, e) => r.bottom - e.clientY },
    };

    let sizing = null;

    body.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest("[data-grip-pane]");
      if (!grip) return;
      sizing = PANES[grip.dataset.gripPane];
      if (!sizing) return;
      if (!body.style.getPropertyValue(sizing.prop)) {
        const el = { lib: ".ed-lib", insp: ".ed-insp", tl: ".ed-timeline" }[grip.dataset.gripPane];
        const r0 = body.querySelector(el)?.getBoundingClientRect();
        if (r0) body.style.setProperty(sizing.prop, `${Math.round(sizing.axis === "x" ? r0.width : r0.height)}px`);
      }
      grip.setPointerCapture?.(e.pointerId);
      body.dataset.sizing = "true";
      e.preventDefault();
    });

    body.addEventListener("pointermove", (e) => {
      if (!sizing) return;
      const r = body.getBoundingClientRect();
      const px = Math.max(sizing.min, Math.min(sizing.max, sizing.from(r, e)));
      body.style.setProperty(sizing.prop, `${Math.round(px)}px`);
    });

    const endSizing = () => {
      if (!sizing) return;
      sizing = null;
      delete body.dataset.sizing;
      // The timeline is drawn as percentages of its own width, so it has to be
      // repainted once the width it is a percentage of has changed.
      renderTrack();
    };
    body.addEventListener("pointerup", endSizing);
    body.addEventListener("pointercancel", endSizing);

    // Keyboard, because a drag handle nobody can tab to is not a control.
    body.addEventListener("keydown", (e) => {
      const grip = e.target.closest?.("[data-grip-pane]");
      if (!grip) return;
      const pane = PANES[grip.dataset.gripPane];
      if (!pane) return;
      const step = e.shiftKey ? 32 : 8;
      const now = parseFloat(getComputedStyle(body).getPropertyValue(pane.prop)) || pane.min;
      const grow = e.key === (pane.axis === "x" ? "ArrowRight" : "ArrowUp");
      const shrink = e.key === (pane.axis === "x" ? "ArrowLeft" : "ArrowDown");
      if (!grow && !shrink) return;
      e.preventDefault();
      const sign = pane.prop === "--ed-lib" ? 1 : -1;
      const next = Math.max(pane.min, Math.min(pane.max, now + (grow ? step : -step) * (pane.axis === "y" ? -1 : sign)));
      body.style.setProperty(pane.prop, `${Math.round(next)}px`);
      renderTrack();
    });

    /* ---------------- overlay lanes ----------------
     *
     * A lane above the spine needs its own decoder, so each gets a hidden
     * <video>. They are never shown: the preview draws them onto the same
     * canvas the graphics use, and the export draws them onto the canvas it is
     * recording. That is deliberate: one drawing path for both, the same rule
     * the composition follows, so an overlay cannot look right in the preview
     * and wrong in the file.
     */
    const overlayVideos = new Map();

    /**
     * The element for one overlay lane, wired for sound.
     *
     * It used to be `muted = true`, on the reasoning that overlay sound
     * belongs on an audio lane. In practice that meant dragging a video onto
     * V2 silently threw its audio away with no control anywhere to get it
     * back. It now plays at the item's own gain, and it is routed into the
     * same graph the export records from (the same wiring `laneAudioEl` does)
     * so what you hear in the preview is what lands in the file.
     */
    const overlayWired = new Set();

    function overlayVideo(laneId) {
      let el = overlayVideos.get(laneId);
      if (!el) {
        el = document.createElement("video");
        el.playsInline = true;
        el.preload = "auto";
        el.style.display = "none";
        body.appendChild(el);
        overlayVideos.set(laneId, el);
      }
      const { ctx: audioCtx, dest } = ensureAudio();
      if (audioCtx && !overlayWired.has(laneId)) {
        try {
          const src = audioCtx.createMediaElementSource(el);
          src.connect(audioCtx.destination);
          if (dest) src.connect(dest);
          overlayWired.add(laneId);
        } catch { /* already wired, or no graph */ }
      }
      return el;
    }

    /** Point every overlay lane at the right frame of the right clip. */
    async function syncOverlays(time, { play = false } = {}) {
      const active = new Map(overlaysAt(time).map((o) => [o.lane.id, o]));
      const waits = [];
      for (const lane of lanes.filter((l) => l.kind === "video")) {
        const el = overlayVideo(lane.id);
        const hit = active.get(lane.id);
        if (!hit) { el.pause(); continue; }

        const clip = byId.get(hit.item.clipId);
        if (!clip) continue;
        const url = Clips.url(clip);
        if (el.dataset.clip !== hit.item.clipId) {
          el.src = url;
          el.dataset.clip = hit.item.clipId;
          waits.push(new Promise((r) => {
            const bail = setTimeout(r, 4000);
            el.onloadeddata = () => { clearTimeout(bail); r(); };
          }));
        }
        el.playbackRate = hit.item.speed || 1;
        el.volume = Math.max(0, Math.min(1, hit.item.gain ?? 1));
        const target = hit.item.in + hit.offset * (hit.item.speed || 1);
        if (Math.abs(el.currentTime - target) > 0.12) el.currentTime = target;
        if (play) el.play().catch(() => {});
        else el.pause();
      }
      if (waits.length) await Promise.all(waits);
    }

    /** Draw whatever the overlay lanes are showing, bottom lane first. */
    function drawOverlays(ctx, w, h, time) {
      for (const { lane, item } of overlaysAt(time)) {
        const el = overlayVideos.get(lane.id);
        if (!el || el.readyState < 2) continue;
        try {
          // The item's own placement, through the same function the spine and
          // the export use, so a nudged overlay is nudged in the file too.
          const t = transformOf(item);
          const fit = fitVideo(el.videoWidth || w, el.videoHeight || h, w, h, fitOf(item), panOf(t));
          ctx.save();
          applyTransform(ctx, t, w, h);
          ctx.drawImage(el, fit.x, fit.y, fit.w, fit.h);
          ctx.restore();
        } catch { /* frame not ready */ }
      }
    }

    /** True when anything but the spine wants painting. */
    const hasOverlayPicture = () => lanes.some((l) => l.kind === "video" && l.items.length);

    /* ---------------- motion graphics clips ----------------
     *
     * A motion graphics clip is a span of the cut with elements inside it, and
     * that is the whole model. The composition still holds one flat list of
     * layers positioned in cut frames, so the export and every tool the agent
     * calls keep working exactly as they did.
     * What changed is how the timeline groups them. Twenty bars fighting over
     * one lane became one clip you open, which is the same move a precomp
     * makes in any compositor and for the same reason: a lane can only show
     * what fits in it.
     *
     * Two kinds. A clip someone placed on the spine is explicit and owns a
     * duration of its own. Elements that landed over footage with no clip to
     * hold them are gathered into an implicit one, so an element is never
     * invisible for want of a container.
     */

    /** The gap that ends a run. Two elements further apart than this are two
     *  separate ideas, not one clip with a hole in it. */
    const MOTION_GAP = 0.35;

    const layerWords = (l) =>
      (l.props?.text || l.props?.items?.[0] || l.props?.shape || l.props?.effect
        || l.component || "Graphic").toString();

    /**
     * Motion graphics clips that float over the cut.
     *
     * A clip on the spine takes a turn: the footage stops and the graphics
     * play. A floating one does not: it sits above the pictures for a stretch
     * of the cut, which is the only way to build a title sequence over someone
     * talking. It needs no compositing work because the graphics canvas already
     * draws over the frame; what it adds is a container to hold and name them,
     * so a person can open one and work in it.
     */
    let floats = [];
    floatEnd = () => floats.reduce((max, f) => Math.max(max, f.at + f.seconds), 0);
    let floatNo = 0;

    function addFloatingClip({ at = 0, seconds = 5, title = "Overlay", laneId = null } = {}) {
      mark();
      const clip = {
        id: `mcf-${Date.now().toString(36)}-${(floatNo++).toString(36)}`,
        title,
        at: Math.max(0, at),
        seconds: Math.max(0.5, Math.min(60, seconds)),
        // The video lane it sits on, when a person put it on one. Null means
        // the motion lane drawn above every video track, which is where the
        // agent's loose clips live too.
        laneId,
      };
      floats = [...floats, clip];
      return clip;
    }

    /**
     * The first video lane with nothing on it between two cut-seconds,
     * bottom-up: V2 before V3. An overlay added at the playhead goes on the
     * lowest track with room rather than on a fresh one above everything.
     * Null when every lane is busy there, or there are no lanes at all.
     */
    function freeVideoLaneAt(start, end) {
      const busy = (a0, a1) => a0 < end && a1 > start;
      return lanes.find((lane) =>
        lane.kind === "video" &&
        !lane.items.some((it) => busy(it.at, itemEnd(it))) &&
        !floats.some((f) => f.laneId === lane.id && busy(f.at, f.at + f.seconds))
      ) || null;
    }

    /** Clips a person or the agent actually placed, in cut seconds. */
    function explicitClips() {
      const out = floats.map((f) => ({
        id: f.id,
        float: f,
        kind: "float",
        title: f.title || "Overlay",
        start: f.at,
        end: f.at + f.seconds,
      }));
      let at = 0;
      for (const seg of timeline) {
        const dur = segDuration(seg);
        if (seg.blank) {
          out.push({
            id: seg.uid,
            seg,
            kind: "spine",
            title: seg.title || "Motion graphics",
            start: at,
            end: at + dur,
          });
        }
        at += dur;
      }
      return out;
    }

    /** Every clip on the cut, explicit and implicit, earliest first. */
    function motionClips() {
      const clips = explicitClips();
      const fps = composition().fps || 30;
      const inside = (t) => clips.some((c) => withinClip(c, t));

      const loose = liveLayers()
        .map((l) => ({
          l,
          start: l.from / fps,
          end: (l.from + Math.max(1, l.durationInFrames)) / fps,
        }))
        .filter((x) => !inside(x.start))
        .sort((a, b) => a.start - b.start);

      let run = null;
      for (const x of loose) {
        if (run && x.start <= run.end + MOTION_GAP) {
          run.end = Math.max(run.end, x.end);
          continue;
        }
        // The id is the first element's, so the clip keeps the same identity
        // while you are inside it and a repaint does not close the editor.
        run = {
          id: `mc-${x.l.id}`,
          kind: "loose",
          title: layerWords(x.l),
          start: x.start,
          end: x.end,
        };
        clips.push(run);
      }
      return clips.sort((a, b) => a.start - b.start);
    }

    const withinClip = (c, seconds) => seconds >= c.start - 0.001 && seconds < c.end - 0.001;

    /**
     * Which clip owns a moment. Exactly one does.
     *
     * An overlay placed over a clip on the spine covers the same seconds, and
     * asking each container separately what it holds counts every element
     * twice: two clips both claiming six elements, and deleting one from
     * inside either leaves it in the other. The overlay wins because it sits
     * above the picture, which is the same order the frame is painted in.
     */
    function ownerOf(seconds) {
      const ex = explicitClips();
      return ex.find((c) => c.kind === "float" && withinClip(c, seconds))
        || ex.find((c) => c.kind === "spine" && withinClip(c, seconds))
        || null;
    }

    /**
     * Whether a clip holds an element.
     *
     * A clip on the spine answers by name: the element carries the uid of the
     * clip it was put in, so shortening that clip cannot hand its contents to
     * the clip beside it, and trimming its head takes frames off the head
     * rather than off the far end. Everything else -- an overlay clip, and the
     * run of loose elements the agent left sitting over footage -- is still
     * decided by the clock, and skips anything that already has a home.
     */
    const holds = (c, item) => {
      if (c.kind === "spine") return item.owner === c.id;
      if (item.owner) return false;
      const seconds = item.from / (composition().fps || 30);
      return c.kind === "loose" ? withinClip(c, seconds) : ownerOf(seconds)?.id === c.id;
    };

    function layersIn(c) {
      return liveLayers()
        .filter((l) => holds(c, l))
        .sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
    }

    function soundsIn(c) {
      return liveAudio()
        .filter((a) => holds(c, a))
        .sort((a, b) => a.from - b.from);
    }

    /**
     * Keep every motion graphics clip's contents inside that clip.
     *
     * Runs before the track is drawn, which is after every edit that can move
     * a clip: a trim, a reorder, a delete, an accepted cut. For each clip on
     * the spine it compares where the clip is now against where it was when
     * its contents were last seated, and moves them by the difference --
     * `start` for the clip sliding along the spine, `in` for its head being
     * trimmed, which scrolls the animation rather than moving it.
     *
     * `anchor` lives on the segment because the clips themselves are derived
     * on every read; holding one across an edit would be holding a stale copy.
     */
    function anchorMotion() {
      const fps = composition().fps || 30;
      let at = 0;
      for (const seg of timeline) {
        const dur = segDuration(seg);
        const start = at;
        at += dur;
        if (!seg.blank) continue;

        const startFrame = Math.round(start * fps);
        const endFrame = Math.max(startFrame + 1, Math.round((start + dur) * fps));
        const was = seg.anchor;
        const shiftFrames = was
          ? Math.round(((start - was.start) - (seg.in - was.in)) * fps)
          : 0;
        const settled = !!was
          && shiftFrames === 0
          && was.startFrame === startFrame
          && was.endFrame === endFrame;
        seg.anchor = { start, in: seg.in, startFrame, endFrame };

        adoptInside(seg.uid, startFrame, endFrame);
        reseat(seg.uid, { shiftFrames, startFrame, endFrame, settled });
      }
    }

    /**
     * Which clip the timeline is inside, or null for the whole cut.
     *
     * Held as an id rather than the object, because the clips are derived on
     * every read and holding one would go stale the moment an element moved.
     */
    let scope = null;
    const scopeClip = () => (scope ? motionClips().find((c) => c.id === scope) || null : null);

    /* ------------------------------------------------------------- history */

    /**
     * Undo and redo, over the cut.
     *
     * What it covers is the timeline: adding, trimming, moving, splitting,
     * reordering and deleting clips, and the cuts accepted off the transcript.
     * A snapshot carries the composition along with it, because a timeline
     * edit takes composition state with it -- deleting a motion graphics clip
     * deletes the elements inside it, and an accepted cut re-times every layer
     * after it. Putting the spine back without them would put a clip back
     * empty, which is not the state anyone asked to return to.
     *
     * What it deliberately does not cover is the composition on its own.
     * Accepting a proposal is not an undo step: there is a Reject beside every
     * one of them, and a stack that could quietly un-accept something a person
     * chose is a worse answer than the button already sitting there.
     *
     * Deep copies, not references. `timeline` is mutated in place all over
     * this file, so a snapshot holding the same objects would rewrite itself
     * as the edit it exists to remember goes past.
     */
    const HISTORY_DEPTH = 50;
    const history = { past: [], future: [] };

    const clone = (value) =>
      (typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)));

    const snapshot = () => ({
      timeline: clone(timeline),
      lanes: clone(lanes),
      floats: clone(floats),
      comp: clone(composition()),
      selected,
    });

    /** Whether two snapshots are the same edit. Cheap, and it keeps a press
     *  that moved nothing off the stack -- selecting a clip is not an edit. */
    const same = (a, b) =>
      JSON.stringify([a.timeline, a.lanes, a.floats, a.comp])
      === JSON.stringify([b.timeline, b.lanes, b.floats, b.comp]);

    function push(snap) {
      history.past.push(snap);
      if (history.past.length > HISTORY_DEPTH) history.past.shift();
      history.future.length = 0;
      renderHistory();
    }

    mark = () => push(snapshot());

    /* A drag decides whether it was an edit at the end of it rather than the
       start: a pointerdown that only selected a clip must not cost a step. */
    let gestureSnap = null;
    const markGesture = () => { gestureSnap = snapshot(); };
    function settleGesture() {
      const before = gestureSnap;
      gestureSnap = null;
      if (before && !same(before, snapshot())) push(before);
    }

    function restoreSnapshot(snap, e) {
      timeline = clone(snap.timeline);
      lanes = clone(snap.lanes);
      floats = clone(snap.floats);
      selected = snap.selected;
      scope = null;
      loaded = null;
      restoreComposition(clone(snap.comp), e);
      renderHistory();
      return rebuildTranscript().then(() => {
        refresh();
        seekTo(Math.min(playhead, total()));
      });
    }

    function undo(e) {
      if (!history.past.length) return void Desk.toast("Nothing to undo.", "bad");
      history.future.push(snapshot());
      const snap = history.past.pop();
      renderHistory();
      Desk.toast("Undone", "good");
      restoreSnapshot(snap, e);
    }

    function redo(e) {
      if (!history.future.length) return void Desk.toast("Nothing to redo.", "bad");
      history.past.push(snapshot());
      const snap = history.future.pop();
      renderHistory();
      Desk.toast("Redone", "good");
      restoreSnapshot(snap, e);
    }

    function renderHistory() {
      const u = body.querySelector('[data-act="undo"]');
      const r = body.querySelector('[data-act="redo"]');
      if (u) u.disabled = history.past.length === 0;
      if (r) r.disabled = history.future.length === 0;
    }

    /**
     * Double click, counted by hand.
     *
     * The browser's own `dblclick` only fires when both presses land on the
     * same node, and the first press here selects the clip, which redraws the
     * track and replaces that node. So the second press lands on a stranger
     * and no double click is ever reported. Two clicks on the same clip id
     * inside the interval is the same gesture and survives the repaint.
     */
    let lastClipClick = { id: null, at: 0 };

    /**
     * How tall each track is, when someone has said.
     *
     * Keyed by the lane rather than by its index, so adding a track above one
     * you have resized does not hand its height to a different lane. Unset
     * lanes take the height in the stylesheet.
     */
    const laneH = new Map();

    function laneStyle(key, extra = "") {
      const h = laneH.get(key);
      const bits = [extra, h ? `--lane-h:${h}px` : ""].filter(Boolean).join("; ");
      return bits ? ` style="${bits}"` : "";
    }

    const laneGrip = (key) =>
      `<span class="tl-lane-resize" data-lane-resize="${key}" aria-hidden="true"></span>`;

    let lastScope = null;

    /** The page buttons say where you are and what is reachable. */
    function syncPageTabs() {
      const toEdit = body.querySelector('[data-page-to="edit"]');
      const toMotion = body.querySelector('[data-page-to="motion"]');
      const back = body.querySelector(".ed-back");
      if (!toEdit || !toMotion) return;
      const here = scopeClip();
      toMotion.hidden = motionClips().length === 0;
      toMotion.textContent = here ? (here.title || "Motion").slice(0, 22) : "Motion";
      toEdit.setAttribute("aria-pressed", String(!here));
      toMotion.setAttribute("aria-pressed", String(Boolean(here)));
      if (back) back.hidden = !here;
      body.dataset.page = here ? "motion" : "edit";
    }

    function enterScope(id) {
      scope = id;
      lastScope = id;
      // The right rail is the element's own fields on this page, which is what
      // it already shows for whatever is selected.
      inspTab = "clip";
      syncPageTabs();
      renderLib();
      renderTrack();
      renderInspector();
    }

    function leaveScope() {
      scope = null;
      syncPageTabs();
      renderLib();
      renderTrack();
      renderInspector();
    }

    /* ---------------- the timeline ---------------- */

    /**
     * Seconds to a percentage of the track, and back.
     *
     * Everything on the timeline is positioned in one timebase (the finished
     * cut), so a lane, a ruler tick and the playhead cannot disagree about
     * where two seconds is. Zoom widens the track and the scroller takes the
     * overflow; nothing recomputes, because a percentage of a wider box is
     * still the same second.
     */
    /* Inside a motion graphics clip the track is that clip and nothing else:
       it starts where the clip starts and it is as long as the clip is. Every
       position stays a cut-second underneath, so a drag writes the same field
       it always wrote and the agent's numbers never have to be translated. */
    const spanStart = () => scopeClip()?.start ?? 0;

    /**
     * How far the track is drawn, which is not the same as how long the cut
     * is.
     *
     * Shortening a motion graphics clip can leave an element sitting past the
     * end of the footage. It is still in the composition and still in the
     * file, so the track has to reach far enough to show it. `total()` is left
     * alone on purpose: it is what the export and the playhead measure, and a
     * graphic hanging off the end must not silently lengthen the video.
     */
    const viewEnd = () => Math.max(total(), layerFrames() / (composition().fps || 30));

    const span = () => {
      const c = scopeClip();
      return c ? Math.max(c.end - c.start, 0.5) : Math.max(viewEnd(), 1);
    };
    /** A moment, as a percentage across the track. */
    const pctOf = (seconds) => ((seconds - spanStart()) / span()) * 100;
    /** A duration, as a percentage of the track's width. */
    const pctLen = (seconds) => (seconds / span()) * 100;

    /**
     * Where a pointer landed, in cut seconds.
     *
     * Measured against `.tl-field`, never against `.tl`. The lanes are inset
     * by the label gutter and the field is inset by the same amount, so this
     * is the only rectangle in which "half way across" and "half the running
     * time" are the same place. Measuring the outer box is what made a cut
     * land seconds away from where it was aimed.
     */
    function timeAtPointer(e) {
      const r = field.getBoundingClientRect();
      if (!(r.width > 0)) return 0;
      const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
      return spanStart() + (x / r.width) * span();
    }

    /** Ruler ticks at a spacing that stays readable at any zoom. */
    function rulerHtml() {
      const width = field.getBoundingClientRect().width || 900;
      const seconds = span();
      const perPx = seconds / width;
      const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
      const step = steps.find((v) => v / perPx >= 74) ?? steps[steps.length - 1];
      // timecode() rounds to the second, so at a half-second step every label
      // would appear twice. Below a second the ruler counts in seconds instead.
      const label = step < 1 ? (t) => `${t.toFixed(1)}s` : timecode;
      let out = "";
      for (let t = 0; t <= seconds + 0.0001; t += step) {
        out += `<span class="tl-tick" style="left:${pctLen(t)}%"><i class="mono">${label(t)}</i></span>`;
      }
      return out;
    }

    function laneItemHtml(lane, it) {
      const clip = byId.get(it.clipId);
      const dur = itemDuration(it);
      const label = lane.kind === "audio"
        ? Desk.esc(it.name || clip?.name || "Audio")
        : Desk.esc(clip?.name || "Missing clip");
      return `
        <div class="tl-item" data-item="${it.uid}" data-lane="${lane.id}"
             style="left:${pctOf(it.at)}%; width:${pctLen(dur)}%; --thumb:${clip?.thumb ? `url('${clip.thumb}')` : "none"}"
             role="button" tabindex="0" aria-pressed="${it.uid === selected}"
             aria-label="${label}, ${timecode(dur)}">
          <span class="tl-grip tl-grip--in" data-grip="in" data-item="${it.uid}" data-lane="${lane.id}"></span>
          <span class="tl-item-name">${label}</span>
          <span class="tl-item-time mono">${timecode(dur)}</span>
          <span class="tl-grip tl-grip--out" data-grip="out" data-item="${it.uid}" data-lane="${lane.id}"></span>
        </div>`;
    }

    /** The base track: sequential, so an item's position is where it lands. */
    function spineHtml() {
      let at = 0;
      return timeline.map((seg) => {
        const dur = segDuration(seg);
        const clip = byId.get(seg.clipId);
        const mine = { id: seg.uid, kind: "spine", start: at, end: at + dur };
        const held = seg.blank ? layersIn(mine).length + soundsIn(mine).length : 0;
        const name = seg.blank
          ? (seg.title || "Motion graphics")
          : (clip?.name || "Missing clip");
        const html = `
          <div class="tl-item tl-item--spine ${seg.blank ? "tl-item--blank tl-item--mclip" : ""} ${seg.status === "proposed" ? "is-proposed" : ""}" draggable="true" data-seg="${seg.uid}"
               style="left:${pctOf(at)}%; width:${pctLen(dur)}%; --thumb:${clip?.thumb ? `url('${clip.thumb}')` : "none"}${seg.colour ? `; background-color:${seg.colour}` : ""}"
               role="button" tabindex="0" aria-pressed="${seg.uid === selected}"
               aria-label="${Desk.esc(name)}, ${timecode(dur)}">
            <span class="tl-grip tl-grip--in" data-grip="in" data-seg="${seg.uid}"></span>
            <span class="tl-item-name">${Desk.esc(name)}</span>
            <span class="tl-item-time mono">${seg.blank ? `${held} element${held === 1 ? "" : "s"} · ${timecode(dur)}` : timecode(dur)}</span>
            ${seg.blank ? `<span class="tl-mini" aria-hidden="true">${miniHtml(mine)}</span>
            <button class="tl-open" data-open-mclip="${seg.uid}" aria-label="Open ${Desk.esc(name)}">Open</button>` : ""}
            ${(seg.tkeys ?? []).map((k) => {
              const at2 = Math.max(0, Math.min(1, k.f / Math.max(1, dur * (composition().fps || 30))));
              return `<span class="tl-key" style="left:${(at2 * 100).toFixed(2)}%"></span>`;
            }).join("")}
            ${seg.status === "proposed" ? `<span class="tl-ask">
              <button class="btn btn-mini btn-accent" data-take-blank="${seg.uid}">Keep</button>
              <button class="btn btn-mini btn-danger" data-drop-blank="${seg.uid}">Drop</button>
            </span>` : ""}
            <span class="tl-grip tl-grip--out" data-grip="out" data-seg="${seg.uid}"></span>
          </div>`;
        at += dur;
        return html;
      }).join("");
    }


    /**
     * A1: the spine's own sound, on its own row.
     *
     * Drawn from the same segments as V1 rather than kept as a second list of
     * them, because a cut is a cut: trimming the picture trims the sound, and
     * two lists of the same thing is how they come to disagree. Clicking a
     * block here selects the clip, so the mute is where the rest of the clip's
     * controls are.
     */
    function a1Html() {
      let at = 0;
      return timeline.map((seg) => {
        const dur = segDuration(seg);
        const clip = byId.get(seg.clipId);
        const start = at;
        at += dur;
        if (seg.blank) return "";
        return `
          <div class="tl-item tl-item--a1 ${seg.muted ? "is-muted" : ""}" data-seg="${seg.uid}"
               style="left:${pctOf(start)}%; width:${pctLen(dur)}%"
               role="button" tabindex="0" aria-pressed="${seg.uid === selected}"
               aria-label="${Desk.esc(clip?.name || "audio")}, ${seg.muted ? "muted" : "sound on"}">
            <span class="tl-item-name">${Desk.esc(clip?.name || "audio")}</span>
            <span class="tl-item-time mono">${
              detachedAudio(seg.uid) ? "unlinked" : seg.muted ? "muted" : "sound"
            }</span>
          </div>`;
      }).join("");
    }

    /**
     * The graphics lane.
     *
     * It holds no items of its own: it draws the composition, which is where
     * every graphic already lives whether a person typed it or an agent
     * proposed it. Two representations of one list is how a preview stops
     * matching a file.
     */
    /**
     * Stack things that overlap.
     *
     * Two graphics at the same second on one row draw on top of each other and
     * neither label can be read. Packing them into sub-rows (the first row
     * that is free at that moment) is what every editor does, and it costs
     * one pass over a list that is never long.
     */
    const MAX_ROWS = 4;

    function pack(items) {
      const rowsEnd = [];
      return items.map((it) => {
        let row = rowsEnd.findIndex((end) => it.start >= end - 0.001);
        if (row === -1) {
          // Past the cap the lane would push the picture off the screen, so it
          // wraps and two labels overlap instead. Twenty graphics on one second
          // is a state worth showing badly rather than a state worth hiding.
          row = rowsEnd.length < MAX_ROWS ? rowsEnd.length : rowsEnd.indexOf(Math.min(...rowsEnd));
          if (rowsEnd.length < MAX_ROWS) rowsEnd.push(0);
        }
        rowsEnd[row] = it.start + it.length;
        return { ...it, row };
      });
    }

    /** How tall a lane has to be to show every row it packed into. */
    const laneRows = (packed) => Math.max(1, ...packed.map((p) => p.row + 1));

    function graphicsLaneHtml() {
      const fps = composition().fps || 30;
      const packed = pack(liveLayers().map((l) => ({
        l, start: l.from / fps, length: Math.max(0.2, l.durationInFrames / fps),
      })));
      const rows = laneRows(packed);
      return {
        rows,
        html: packed.map(({ l, start, length, row }) => {
          const words = (l.props?.text || l.props?.items?.[0] || l.props?.shape || l.props?.effect || l.component || "Graphic").toString();
          return `
            <div class="tl-item tl-item--gfx ${l.status === "proposed" ? "is-proposed" : ""}"
                 data-layer="${l.id}"
                 style="left:${pctOf(start)}%; width:${pctLen(length)}%; --row:${row}"
                 role="button" tabindex="0" aria-pressed="${l.id === selected}"
                 aria-label="${Desk.esc(words)}, ${timecode(length)}">
              <span class="tl-grip tl-grip--in" data-grip="in" data-layer="${l.id}"></span>
              <span class="tl-item-name">${Desk.esc(words.slice(0, 40))}</span>
              <span class="tl-item-time mono">${l.component}</span>
              ${(l.keys ?? []).map((k) => {
                const at = Math.max(0, Math.min(1, k.f / Math.max(1, l.durationInFrames)));
                return `<span class="tl-key" style="left:${(at * 100).toFixed(2)}%"></span>`;
              }).join("")}
              <span class="tl-grip tl-grip--out" data-grip="out" data-layer="${l.id}"></span>
            </div>`;
        }).join(""),
      };
    }

    /**
     * The little bars inside a clip.
     *
     * A clip that says "6 elements" and shows nothing is a folder. This draws
     * where each element sits inside the clip, so the shape of the animation
     * is readable without opening it.
     */
    function miniHtml(c) {
      const fps = composition().fps || 30;
      const len = Math.max(0.001, c.end - c.start);
      const rows = [...layersIn(c), ...soundsIn(c)].slice(0, 14);
      return rows.map((x, i) => {
        const left = ((x.from / fps - c.start) / len) * 100;
        const width = Math.max(2, ((Math.max(1, x.durationInFrames) / fps) / len) * 100);
        // Two rows at most. Five stacked was tall enough to run through the
        // clip's own label, which is the one thing on the bar you have to be
        // able to read.
        return `<i style="left:${Math.max(0, Math.min(99, left)).toFixed(2)}%;
                          width:${Math.min(100 - left, width).toFixed(2)}%;
                          top:${(i % 2) * 3}px"></i>`;
      }).join("");
    }

    /**
     * Clips that hold elements sitting over footage.
     *
     * The clips on the spine draw themselves. This lane is for the ones the
     * agent made by proposing a graphic at a moment in the transcript, where
     * there was no clip to put it in. They behave the same: one bar, open it
     * to work inside it.
     */
    function motionLaneHtml(laneId = null) {
      const clips = motionClips().filter((c) =>
        laneId === null
          ? c.kind === "loose" || (c.kind === "float" && !c.float.laneId)
          : c.kind === "float" && c.float.laneId === laneId
      );
      return clips.map((c) => {
        const els = layersIn(c);
        const waiting = els.filter((l) => l.status === "proposed").length;
        const n = els.length + soundsIn(c).length;
        return `
          <div class="tl-item tl-item--mclip ${waiting ? "is-proposed" : ""}" data-mclip="${c.id}"
               ${c.kind === "float" ? `data-float="${c.id}"` : ""}
               style="left:${pctOf(c.start)}%; width:${pctLen(Math.max(0.25, c.end - c.start))}%"
               role="button" tabindex="0"
               title="Double click to open this motion graphics clip"
               aria-label="${Desk.esc(c.title)}, ${n} element${n === 1 ? "" : "s"}${waiting ? `, ${waiting} waiting on you` : ""}">
            <span class="tl-item-name">${Desk.esc(c.title.slice(0, 40))}</span>
            <span class="tl-item-time mono">${n} element${n === 1 ? "" : "s"}${waiting ? ` · ${waiting} new` : ""}</span>
            <span class="tl-mini" aria-hidden="true">${miniHtml(c)}</span>
            ${c.kind === "float" ? `<span class="tl-grip tl-grip--in" data-grip="in" data-float="${c.id}"></span>
            <span class="tl-grip tl-grip--out" data-grip="out" data-float="${c.id}"></span>` : ""}
            <button class="tl-open" data-open-mclip="${c.id}"
                    aria-label="Open ${Desk.esc(c.title)}">Open</button>
          </div>`;
      }).join("");
    }

    /**
     * Inside a clip.
     *
     * One element to a row, so nothing can overlap anything and the lane
     * cannot run out of space: the track scrolls instead. Positions are drawn
     * against the clip's own length, which is what makes this a timeline for
     * the animation rather than a slice of the cut's.
     */
    function scopedRows(c) {
      const fps = composition().fps || 30;
      const els = layersIn(c);
      const sounds = soundsIn(c);
      const rows = [];

      if (!els.length && !sounds.length) {
        rows.push(`<div class="tl-lane"><div class="tl-lane-body">
          <p class="track-empty">Nothing in this clip yet. Add text or a shape, or ask the agent for one.</p>
        </div></div>`);
      }

      els.forEach((l, i) => {
        const start = l.from / fps;
        const len = Math.max(0.2, l.durationInFrames / fps);
        rows.push(`<div class="tl-lane tl-lane--el" data-lane="el-${l.id}"${laneStyle("el")}>
          <span class="tl-lane-name mono">${i + 1}</span>
          <div class="tl-lane-body">
            <div class="tl-item tl-item--gfx ${l.status === "proposed" ? "is-proposed" : ""}"
                 data-layer="${l.id}"
                 style="left:${pctOf(start)}%; width:${pctLen(len)}%"
                 role="button" tabindex="0" aria-pressed="${l.id === selected}"
                 aria-label="${Desk.esc(layerWords(l))}, ${timecode(len)}">
              <span class="tl-grip tl-grip--in" data-grip="in" data-layer="${l.id}"></span>
              <span class="tl-item-name">${Desk.esc(layerWords(l).slice(0, 44))}</span>
              <span class="tl-item-time mono">${l.component}</span>
              ${(l.keys ?? []).map((k) => {
                const at = Math.max(0, Math.min(1, k.f / Math.max(1, l.durationInFrames)));
                return `<span class="tl-key" style="left:${(at * 100).toFixed(2)}%"></span>`;
              }).join("")}
              <span class="tl-grip tl-grip--out" data-grip="out" data-layer="${l.id}"></span>
            </div>
          </div>
        </div>`);
      });

      sounds.forEach((a) => {
        const start = a.from / fps;
        const len = Math.max(0.15, (a.durationInFrames || fps) / fps);
        const name = a.kind === "sfx" ? a.preset : (a.name || "music bed");
        rows.push(`<div class="tl-lane tl-lane--el tl-lane--sfx" data-lane="el-${a.id}">
          <span class="tl-lane-name mono">♪</span>
          <div class="tl-lane-body">
            <div class="tl-item tl-item--sfx ${a.status === "proposed" ? "is-proposed" : ""}"
                 data-sound="${a.id}"
                 style="left:${pctOf(start)}%; width:${pctLen(len)}%"
                 role="button" tabindex="0" aria-pressed="${a.id === selected}"
                 aria-label="${Desk.esc(String(name))}, ${timecode(len)}">
              <span class="tl-grip tl-grip--in" data-grip="in" data-sound="${a.id}"></span>
              <span class="tl-item-name">${Desk.esc(String(name))}</span>
              <span class="tl-item-time mono">${a.kind}</span>
              <span class="tl-grip tl-grip--out" data-grip="out" data-sound="${a.id}"></span>
            </div>
          </div>
        </div>`);
      });

      return rows;
    }

    function sfxLaneHtml() {
      const fps = composition().fps || 30;
      // Sound that belongs to a motion graphics clip is shown inside that
      // clip. Drawing it here as well would be the same thing in two places,
      // which is the state where a person deletes one copy and is surprised.
      const clips = motionClips();
      const held = (a) => clips.some((c) => holds(c, a));
      const packed = pack(liveAudio().filter((a) => !held(a)).map((a) => ({
        a, start: a.from / fps, length: Math.max(0.15, (a.durationInFrames || fps) / fps),
      })));
      const rows = laneRows(packed);
      return {
        rows,
        html: packed.map(({ a, start, length, row }) => {
          const name = a.kind === "sfx" ? a.preset : (a.name || "music bed");
          return `
            <div class="tl-item tl-item--sfx ${a.status === "proposed" ? "is-proposed" : ""}"
                 data-sound="${a.id}"
                 style="left:${pctOf(start)}%; width:${pctLen(length)}%; --row:${row}"
                 role="button" tabindex="0" aria-pressed="${a.id === selected}"
                 aria-label="${Desk.esc(String(name))}, ${timecode(length)}">
              <span class="tl-grip tl-grip--in" data-grip="in" data-sound="${a.id}"></span>
              <span class="tl-item-name">${Desk.esc(String(name))}</span>
              <span class="tl-item-time mono">${a.kind}${a.duck ? " · ducks" : ""}</span>
              <span class="tl-grip tl-grip--out" data-grip="out" data-sound="${a.id}"></span>
            </div>`;
        }).join(""),
      };
    }


    /* ---------------- handling a graphic on the picture ----------------
     *
     * A layer an agent proposed is a spec, and until now the only way to
     * change it was to argue with the agent about numbers. Selecting one puts
     * handles on the preview: drag the middle to move it, drag a corner to
     * size it. What the drag writes is the same `point`, `width` and `height`
     * the spec already had, so the thing being edited is still one object and
     * a person and an agent are still editing the same fields.
     *
     * Only layers that carry a free point can be dragged. A lower third is
     * anchored by its component and moving it by hand would be a lie about
     * what the spec says.
     */
    const MOVABLE = new Set(["text", "shape", "callout_arrow"]);

    const selectedLayer = () => liveLayers().find((l) => l.id === selected) || null;

    /** The layer's box on the preview, in canvas pixels. */
    function layerBox(layer, w, h) {
      const p = layer.props?.point ?? {};
      const cx = num(p.x, 0.5) * w;
      const cy = num(p.y, 0.5) * h;
      const bw = num(layer.props?.width, 0.24) * w;
      const bh = num(layer.props?.height, 0.18) * h;
      return { cx, cy, w: bw, h: bh, x: cx - bw / 2, y: cy - bh / 2 };
    }

    /** The layer's props at the playhead, with its keyframes applied. */
    function keyedNow(layer) {
      const now = keyedAt(layer.keys, localFrame(layer), layer.easing);
      if (!now) return layer.props ?? {};
      return {
        ...(layer.props ?? {}),
        width: now.width,
        height: now.height,
        point: { x: now.x, y: now.y },
      };
    }

    /** Draw the selection box and its corner. */
    function paintHandles(ctx, w, h) {
      const layer = selectedLayer();
      if (!layer || !MOVABLE.has(layer.component)) return;
      const fps = composition().fps || 30;
      const f = Math.round(playhead * fps);
      if (f < layer.from || f > layer.from + layer.durationInFrames) return;

      const shown = (layer.keys ?? []).length ? { ...layer, props: keyedNow(layer) } : layer;
      const b = layerBox(shown, w, h);
      isolate(ctx, () => {
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
        ctx.fillStyle = pal.accent;
        for (const [hx, hy] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]])
          ctx.fillRect(hx - 4, hy - 4, 8, 8);
      });
    }

    /* ---------------- reframing a clip ----------------
     *
     * The frame is the composition's shape; the footage covers it. Which is
     * fine until you reframe 16:9 to 9:16 and the thing you cared about is
     * outside the crop, so every clip carries a transform saying where inside
     * the frame its picture sits.
     *
     * Everything is normalised: x and y are fractions of the frame, scale is a
     * multiplier on "cover", rotation is degrees, flips are booleans. That is
     * what lets the same numbers drive a CSS transform in the preview and a
     * canvas transform in the export and produce the same picture.
     */
    const NO_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0, flipH: false, flipV: false };

    /**
     * How a clip's picture meets the frame.
     *
     * "cover" fills the frame and loses whatever does not fit; "contain" keeps
     * the whole picture and pads the rest. Reframing 16:9 footage to 9:16 on
     * cover throws away about 70% of the width, which is right when you have
     * chosen what to keep and wrong when you have not been asked. This is the
     * choice, and it is per clip because a talking head and a screen recording
     * want different answers in the same cut.
     */
    const fitOf = (thing) => (thing?.fit === "contain" ? "contain" : "cover");

    /**
     * The transform's pan, as CSS object-position percentages.
     *
     * This is the fix for "the whole video is cropped and I cannot move it".
     * The pan used to be a `transform: translate()` on the video element, and
     * with `object-fit: cover` that element *is* the frame: the source is
     * already cropped to it, so translating slid the cropped picture out of
     * frame and showed the backdrop instead of revealing more of the source.
     *
     * object-position is the primitive that actually means "which part of the
     * source the frame shows", and it clamps itself to however much is
     * hidden. x = +1 pushes the picture right, which is the same as showing
     * the source's left edge, hence 50 - x*50.
     */
    const panOf = (t) => ({
      px: Math.max(0, Math.min(100, 50 - (Number(t?.x) || 0) * 50)),
      py: Math.max(0, Math.min(100, 50 - (Number(t?.y) || 0) * 50)),
    });

    const transformOf = (seg) => ({ ...NO_TRANSFORM, ...(seg?.transform || {}) });

    /** The transform at a moment, with the clip's own keyframes applied. */
    function transformAt(seg, cutSeconds) {
      const base = transformOf(seg);
      const keys = seg?.tkeys;
      if (!Array.isArray(keys) || keys.length === 0) return base;
      const b = boundsOf(seg);
      const local = Math.round(((cutSeconds ?? playhead) - (b?.start ?? 0)) * (composition().fps || 30));
      const now = keyedAt(keys, local, "out");
      if (!now) return base;
      return {
        ...base,
        x: Number.isFinite(now.x) ? now.x : base.x,
        y: Number.isFinite(now.y) ? now.y : base.y,
        scale: Number.isFinite(now.width) ? now.width : base.scale,
        rotation: Number.isFinite(now.rotation) ? now.rotation : base.rotation,
      };
    }

    /** The same transform as a CSS string, for the preview. */
    function cssTransform(t) {
      const sx = t.flipH ? -t.scale : t.scale;
      const sy = t.flipV ? -t.scale : t.scale;
      // No translate. The pan is object-position, because translating a
      // cover-fitted element moves the crop and its contents together instead
      // of moving the crop across the source.
      return `rotate(${t.rotation}deg) scale(${sx}, ${sy})`;
    }

    /** Point the export's canvas at the same place. Caller restores.
     *  Scale, rotation and flip only: the pan arrives in the rect fitVideo
     *  returns, exactly as object-position supplies it in the preview. */
    function applyTransform(ctx, t, w, h) {
      ctx.translate(w / 2, h / 2);
      ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.scale(t.flipH ? -t.scale : t.scale, t.flipV ? -t.scale : t.scale);
      ctx.translate(-w / 2, -h / 2);
    }

    /** Push the selected clip's transform onto the preview element. */
    function paintTransform() {
      const at = segmentAt(playhead);
      const t = at ? transformAt(at.seg) : NO_TRANSFORM;
      video.style.transform = cssTransform(t);
      video.style.transformOrigin = "center";
      // object-fit and object-position in the preview, the same two numbers
      // fitVideo takes at export, so the two cannot mean different things.
      video.style.objectFit = at ? fitOf(at.seg) : "cover";
      const pan = panOf(t);
      video.style.objectPosition = `${pan.px.toFixed(2)}% ${pan.py.toFixed(2)}%`;

      // A grab cursor on a picture that cannot move is a promise the frame
      // cannot keep, and footage already the shape of the frame has nothing
      // hidden to pan to.
      const g = at ? panGearing(at.seg, frameBox.getBoundingClientRect()) : { gx: 0, gy: 0 };
      frameBox.style.cursor = g.gx || g.gy ? "" : "default";
    }

    /* ---------------- keyframes ----------------
     *
     * A key is the layer's placement at one frame. Pressing Key writes where
     * the graphic is now; moving the playhead and dragging it writes another,
     * and between them the renderer interpolates. Two keys is an animation,
     * which is the smallest honest version of this and the one a person can
     * actually hold in their head.
     */
    const localFrame = (layer) => Math.round(playhead * (composition().fps || 30)) - layer.from;

    /**
     * A number, or the fallback.
     *
     * `Number(null)` is 0 and 0 is finite, so the obvious version of this
     * quietly turned every unset field into zero, which for opacity meant a
     * keyframed graphic animated perfectly and invisibly.
     */
    const num = (v, fallback) => {
      if (v == null || v === "") return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    /** The layer's placement right now, as a key. */
    function keyFrom(layer) {
      const p = layer.props?.point ?? {};
      return {
        f: Math.max(0, localFrame(layer)),
        x: num(p.x, 0.5),
        y: num(p.y, 0.5),
        width: num(layer.props?.width, 0.24),
        height: num(layer.props?.height, 0.18),
        rotation: num(layer.props?.rotation, 0),
        opacity: num(layer.props?.opacity, 1),
      };
    }

    /** Put a key at the playhead, replacing one already on that frame. */
    function addKey(layer, e, patch = {}) {
      const key = { ...keyFrom(layer), ...patch };
      const keys = (layer.keys ?? []).filter((k) => k.f !== key.f).concat(key).sort((a, b) => a.f - b.f);
      editLayer(layer.id, { keys }, e);
      return keys;
    }

    function clearKeys(layer, e) {
      editLayer(layer.id, { keys: [] }, e);
      refresh();
    }

    /** The key sitting exactly on the playhead, if there is one. */
    const keyHere = (layer) => (layer.keys ?? []).find((k) => k.f === Math.max(0, localFrame(layer))) || null;

    /* Dragging the picture itself reframes the clip, when no graphic is
       selected to take the drag instead. */
    let reframing = null;

    frameBox.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const layer = selectedLayer();
      if (layer && MOVABLE.has(layer.component)) return;   // the graphic wants it
      // An overlay you have selected takes the drag, because that is the
      // picture you are looking at on top. Otherwise it is the spine's.
      const onLane = findItem(selected);
      const target = onLane && playhead >= onLane.it.at && playhead < itemEnd(onLane.it)
        ? onLane.it
        : segmentAt(playhead)?.seg;
      if (!target || target.blank) return;
      reframing = { seg: target, x: e.clientX, y: e.clientY, rect: frameBox.getBoundingClientRect() };
      selected = target.uid;
      frameBox.setPointerCapture?.(e.pointerId);
      frameBox.dataset.dragging = "true";
      e.preventDefault();
    });

    /**
     * How far a pixel of cursor moves the pan.
     *
     * The picture should sit under the cursor, so a drag of `dx` has to move
     * the visible content by `dx` — and the content can only move through the
     * part of it that is hidden. That overflow is what sets the gearing, not
     * the width of the frame: gearing to the frame made the picture crawl at
     * roughly a third of the pointer and feel like it was resisting.
     *
     * Returns 0 on each axis with nothing hidden, which is the honest answer
     * on `contain` and on footage that already matches the frame.
     */
    function panGearing(thing, rect) {
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      if (!(vw > 0) || !(vh > 0) || !(rect.width > 0) || !(rect.height > 0)) return { gx: 0, gy: 0 };

      const t = transformOf(thing);
      const scale = t.scale || 1;
      // The rectangle the picture actually occupies, from the same function
      // the export uses, so the gearing is derived from the real geometry
      // rather than a second guess at it.
      const box = fitVideo(vw * scale, vh * scale, rect.width, rect.height, fitOf(thing));

      // offset = (frame - drawn) * px/100 and px = 50 - x*50, so moving the
      // content by dx needs x to change by -2*dx/(frame - drawn).
      //
      // One formula covers both fits, and the sign falls out of it. On cover
      // (frame - drawn) is negative, which is overflow to reveal; on contain
      // it is positive, which is slack to slide the letterboxed picture
      // around in. Special-casing contain to zero meant a fitted clip could
      // not be nudged off-centre to make room for a caption.
      const slackX = rect.width - box.w;
      const slackY = rect.height - box.h;
      return {
        gx: Math.abs(slackX) > 0.5 ? -2 / slackX : 0,
        gy: Math.abs(slackY) > 0.5 ? -2 / slackY : 0,
      };
    }

    frameBox.addEventListener("pointermove", (e) => {
      if (!reframing) return;
      const t = transformOf(reframing.seg);
      const { gx, gy } = panGearing(reframing.seg, reframing.rect);
      reframing.seg.transform = {
        ...t,
        x: Math.max(-1, Math.min(1, t.x + (e.clientX - reframing.x) * gx)),
        y: Math.max(-1, Math.min(1, t.y + (e.clientY - reframing.y) * gy)),
      };
      reframing.x = e.clientX;
      reframing.y = e.clientY;
      if ((reframing.seg.tkeys ?? []).length) {
        const b = boundsOf(reframing.seg);
        const f = Math.max(0, Math.round((playhead - (b?.start ?? 0)) * (composition().fps || 30)));
        const tt = transformOf(reframing.seg);
        reframing.seg.tkeys = (reframing.seg.tkeys ?? [])
          .filter((k) => k.f !== f)
          .concat({ f, x: tt.x, y: tt.y, width: tt.scale, rotation: tt.rotation })
          .sort((a, c) => a.f - c.f);
      }
      paintTransform();
    });

    const endReframe = () => {
      if (!reframing) return;
      reframing = null;
      delete frameBox.dataset.dragging;
      renderInspector();
      renderTrack();
    };
    frameBox.addEventListener("pointerup", endReframe);
    frameBox.addEventListener("pointercancel", endReframe);

    /* Dragging on the picture. */
    let onFrame = null;

    /** Every movable graphic actually on screen at the playhead, in the order
     *  they draw -- last is topmost, so a click hits whichever one is really
     *  on top rather than whichever was clicked last. */
    function movableLayersAtPlayhead() {
      const frame = Math.round(playhead * (composition().fps || 30));
      return liveLayers().filter((l) =>
        MOVABLE.has(l.component) && frame >= l.from && frame < l.from + Math.max(1, l.durationInFrames)
      );
    }

    /** Only intercept clicks when there is something on the picture to grab.
     *  A graphic sitting in frame is a target to click even before it is
     *  selected -- the background reframe drag yields to it either way. */
    function armFrameGrabs() {
      const layer = selectedLayer();
      const clickable = movableLayersAtPlayhead().length > 0 || (layer && MOVABLE.has(layer.component));
      gfx.style.pointerEvents = clickable ? "auto" : "none";
      gfx.style.cursor = layer && MOVABLE.has(layer.component) ? "move" : "";
    }

    function hitLayer(x, y, r) {
      const inBox = (l) => {
        const b = layerBox(l, r.width, r.height);
        const nearCorner = Math.abs(x - (b.x + b.w)) < 12 && Math.abs(y - (b.y + b.h)) < 12;
        const inside = x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6;
        return (inside || nearCorner) ? { nearCorner } : null;
      };

      // The already-selected layer gets first refusal, so grabbing its resize
      // corner still works even when another graphic overlaps it nearby.
      const current = selectedLayer();
      if (current && MOVABLE.has(current.component)) {
        const hit = inBox(current);
        if (hit) return { layer: current, ...hit };
      }
      const layers = movableLayersAtPlayhead();
      for (let i = layers.length - 1; i >= 0; i--) {
        const hit = inBox(layers[i]);
        if (hit) return { layer: layers[i], ...hit };
      }
      return null;
    }

    gfx.addEventListener("pointerdown", (e) => {
      const r = gfx.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      const hit = hitLayer(x, y, r);
      if (!hit) return;
      if (hit.layer.id !== selected) select(hit.layer.id);

      onFrame = { id: hit.layer.id, mode: hit.nearCorner ? "size" : "move", x, y, rect: r };
      gfx.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    gfx.addEventListener("pointermove", (e) => {
      if (!onFrame) return;
      const layer = liveLayers().find((l) => l.id === onFrame.id);
      if (!layer) return;
      const r = gfx.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const dx = (x - onFrame.x) / r.width;
      const dy = (y - onFrame.y) / r.height;
      onFrame.x = x; onFrame.y = y;

      const animated = (layer.keys ?? []).length > 0;
      const nowKey = animated ? (keyHere(layer) ?? keyFrom(layer)) : null;
      const p = animated ? nowKey : (layer.props?.point ?? { x: 0.5, y: 0.5 });
      const curW = animated ? nowKey.width : num(layer.props?.width, 0.24);
      const curH = animated ? nowKey.height : num(layer.props?.height, 0.18);

      const next = onFrame.mode === "move"
        ? {
            x: Math.max(0, Math.min(1, num(p.x, 0.5) + dx)),
            y: Math.max(0, Math.min(1, num(p.y, 0.5) + dy)),
          }
        : {
            width: Math.max(0.02, Math.min(1.5, curW + dx * 2)),
            height: Math.max(0.02, Math.min(1.5, curH + dy * 2)),
          };

      if (animated) {
        // An animated layer is edited at the frame you are looking at, which
        // is what makes dragging the way you author the motion rather than a
        // thing that fights it.
        addKey(layer, e, next);
      } else if (onFrame.mode === "move") {
        editLayer(layer.id, { props: { point: { x: next.x, y: next.y } } }, e);
      } else {
        editLayer(layer.id, { props: { width: next.width, height: next.height } }, e);
      }
    });

    const endFrameDrag = () => {
      if (!onFrame) return;
      onFrame = null;
      renderInspector();
    };
    gfx.addEventListener("pointerup", endFrameDrag);
    gfx.addEventListener("pointercancel", endFrameDrag);

    /**
     * Zooming the viewer.
     *
     * The frame is a box of the composition's aspect ratio inside a padded
     * viewport, so at 100% it fits with air around it and you can see where
     * the picture actually ends. Above that the viewport scrolls, which is
     * what makes it possible to work on the corner of a graphic.
     */
    let zoomLevel = 1;
    const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

    function setZoom(next) {
      zoomLevel = Math.max(0.25, Math.min(6, next));
      screen.style.setProperty("--zoom", String(zoomLevel));
      const read = body.querySelector(".ed-zoom-read");
      if (read) read.textContent = `${Math.round(zoomLevel * 100)}%`;
    }

    /** The preview frame takes the composition's aspect ratio. */
    function paintFrame() {
      const doc = composition();
      const shape = formatOf(doc.format);
      frameBox.style.setProperty("--ar", `${shape.width} / ${shape.height}`);

      formatBar.innerHTML = ["landscape", "vertical", "square"].map((name) => {
        const f = formatOf(name);
        const w = f.width >= f.height ? 15 : Math.round((f.width / f.height) * 15);
        const h = f.height >= f.width ? 15 : Math.round((f.height / f.width) * 15);
        return `
          <button class="cmp-format" data-format="${name}" aria-pressed="${doc.format === name}"
                  style="--fw:${w}px; --fh:${h}px" title="${f.label}">
            <span class="cmp-format-box" aria-hidden="true"></span>
            <span>${f.label}</span>
          </button>`;
      }).join("") + (doc.pendingFormat
        ? `<span class="ed-formats-ask">
             <b>${formatOf(doc.pendingFormat.format).label}?</b>
             <button class="btn btn-mini btn-accent" data-fmt-accept="1">Keep</button>
             <button class="btn btn-mini btn-danger" data-fmt-reject="1">No</button>
           </span>`
        : "");
    }

    function renderTrack() {
      anchorMotion();
      empty.hidden = timeline.length > 0 || lanes.some((l) => l.items.length)
        || liveLayers().length > 0 || liveAudio().length > 0;

      // Nothing on the spine means nothing to show. Without this the viewer
      // keeps the last decoded frame after the final clip is deleted, which
      // reads as "the delete did not work".
      if (!timeline.length && loaded) {
        video.pause();
        video.removeAttribute("src");
        video.load?.();
        loaded = null;
      }

      // Inside a clip the track is that clip: one element to a row, nothing
      // else on screen, and a way back out at the top.
      const inside = scopeClip();
      if (scope && !inside) scope = null;
      body.classList.toggle("is-scoped", Boolean(inside));

      if (inside) {
        laneBox.innerHTML = scopedRows(inside).join("");
        ruler.innerHTML = rulerHtml();
        syncPageTabs();
        paintPlayhead();
        paintFrame();
        return;
      }

      const rows = [];
      // Video lanes read top-down like every editor: the newest overlay on
      // top, the spine at the bottom. Motion graphics sit above the pictures
      // and are numbered with them, because to the frame they are one more
      // video track and a second letter would be one more thing to learn.
      const videoLanes = lanes.filter((l) => l.kind === "video");
      const motion = motionLaneHtml();
      if (motion) {
        const name = `V${videoLanes.length + 2}`;
        rows.push(`<div class="tl-lane tl-lane--motion" data-lane="motion"${laneStyle("motion")}>
          <span class="tl-lane-name mono">${name}</span>
          <div class="tl-lane-body">${motion}</div>
          ${laneGrip("motion")}
        </div>`);
      }

      for (const lane of videoLanes.slice().reverse()) {
        rows.push(`<div class="tl-lane" data-lane="${lane.id}"${laneStyle(lane.id)}>
          <span class="tl-lane-name mono">${lane.name}</span>
          <button class="tl-lane-x" data-drop-lane="${lane.id}" aria-label="Remove lane ${lane.name}">×</button>
          <div class="tl-lane-body">${lane.items.map((it) => laneItemHtml(lane, it)).join("")}${motionLaneHtml(lane.id)}</div>
          ${laneGrip(lane.id)}
        </div>`);
      }

      rows.push(`<div class="tl-lane tl-lane--spine" data-lane="spine"${laneStyle("spine")}>
        <span class="tl-lane-name mono">V1</span>
        <div class="tl-lane-body">${
          timeline.length ? spineHtml() : `<p class="track-empty">Drag a clip here, or add one from the library.</p>`
        }</div>
        ${laneGrip("spine")}
      </div>`);

      // Audio tracks are numbered the way an editor numbers them, in the order
      // they appear, rather than named after what happens to be on them.
      let audioNo = 0;
      const audioName = () => `A${++audioNo}`;

      if (timeline.some((sg) => !sg.blank)) {
        rows.push(`<div class="tl-lane tl-lane--a1" data-lane="a1"${laneStyle("a1")}>
          <span class="tl-lane-name mono">${audioName()}</span>
          <div class="tl-lane-body">${a1Html()}</div>
          ${laneGrip("a1")}
        </div>`);
      }

      const sfxLane = sfxLaneHtml();
      if (sfxLane.html) {
        rows.push(`<div class="tl-lane tl-lane--sfx" data-lane="sfx"${laneStyle("sfx", `--rows:${sfxLane.rows}`)}>
          <span class="tl-lane-name mono">${audioName()}</span>
          <div class="tl-lane-body">${sfxLane.html}</div>
          ${laneGrip("sfx")}
        </div>`);
      }

      for (const lane of lanes.filter((l) => l.kind === "audio")) {
        const name = audioName();
        rows.push(`<div class="tl-lane tl-lane--audio" data-lane="${lane.id}"${laneStyle(lane.id)}>
          <span class="tl-lane-name mono">${name}</span>
          <button class="tl-lane-x" data-drop-lane="${lane.id}" aria-label="Remove audio track ${name}">×</button>
          <div class="tl-lane-body">${lane.items.map((it) => laneItemHtml(lane, it)).join("")}</div>
          ${laneGrip(lane.id)}
        </div>`);
      }

      laneBox.innerHTML = rows.join("");
      ruler.innerHTML = rulerHtml();
      syncPageTabs();
      paintPlayhead();
      paintFrame();
    }

    /** Cheap, and called every animation frame while playing. */
    function paintPlayhead() {
      const p = pctOf(playhead);
      // Inside a clip the playhead is often somewhere else in the cut, and a
      // line pinned to the edge would be a lie about where it is.
      head.hidden = p < -0.5 || p > 100.5;
      head.style.left = `${Math.max(0, Math.min(100, p))}%`;
    }

    /**
     * The graphics section of the inspector.
     *
     * Proposals sit above accepted graphics because a proposal is the thing
     * asking for a decision. Each carries the reason the agent gave, and
     * clicking one moves the playhead to it, so judging it means looking at it
     * rather than imagining it.
     */
    function graphicsHtml() {
      const pending = pendingGraphics();
      const live = acceptedGraphics();
      if (!pending.length && !live.length) {
        return `
          <div class="ed-head"><span>Graphics</span></div>
          <p class="insp-empty">Nothing yet. Ask the agent for a title card or a lower third over the bit you have selected.</p>`;
      }

      const card = (g) => `
        <li class="gfx ${g.status}" data-gfx="${g.id}">
          <div class="gfx-head">
            <span class="gfx-type mono">${Desk.esc(g.type.replace(/_/g, " "))}</span>
            <span class="gfx-at mono">${timecode(g.start)} · ${g.duration.toFixed(1)}s</span>
          </div>
          <p class="gfx-text">${Desk.esc(g.text || g.subtext || "no text")}</p>
          ${g.reason ? `<p class="gfx-reason">${Desk.esc(g.reason)}</p>` : ""}
          ${
            g.status === "proposed"
              ? `<div class="gfx-acts">
                   <button class="btn btn-mini btn-accent" data-gfx-accept="${g.id}">Accept</button>
                   <button class="btn btn-mini btn-danger" data-gfx-reject="${g.id}">Reject</button>
                 </div>`
              : `<div class="gfx-acts">
                   <button class="btn btn-mini btn-danger" data-gfx-remove="${g.id}">Remove</button>
                 </div>`
          }
        </li>`;

      return `
        <div class="ed-head">
          <span>Graphics</span>
          ${pending.length ? `<span class="gfx-count">${pending.length} to judge</span>` : ""}
        </div>
        <ul class="gfx-list">${[...pending, ...live].map(card).join("")}</ul>`;
    }

    /**
     * The composition section: format, then layers, then sound.
     *
     * Proposals sort above accepted work in both lists, because a proposal is
     * the thing asking for a decision. Each carries the reason the agent gave
     * and clicking one moves the playhead into it, so judging a graphic means
     * looking at it rather than imagining it.
     */
    /**
     * Only what is waiting on you.
     *
     * This listed everything the composition held, which turned a panel with
     * two decisions in it into a log of every decision already made. What is
     * accepted is on the timeline, inside the clip it belongs to, where it can
     * be moved, trimmed and deleted. A second copy of that list here was one
     * more place for the two to disagree.
     */
    function compositionHtml() {
      const doc = composition();
      const layers = pendingLayers();
      const sounds = pendingAudio();
      const pending = pendingCount();

      // The format buttons live beside the picture now. What stays here is
      // the reason an agent gave for wanting a different one, which is a thing
      // to read rather than a control to press.
      const formats = "";
      const reframe = doc.pendingFormat
        ? `<div class="cmp-reframe">
             <p><b>${formatOf(doc.pendingFormat.format).label}</b> proposed: decide it above the picture.</p>
             ${doc.pendingFormat.reason ? `<p class="cmp-reframe-why">${Desk.esc(doc.pendingFormat.reason)}</p>` : ""}
           </div>`
        : "";

      const layerCard = (l) => {
        const label = l.component.replace(/_/g, " ");
        const words = l.props?.text || l.props?.items?.[0] || l.props?.subtext || "no text";
        return `
          <li class="cmp-item ${l.status}" data-layer="${l.id}">
            <div class="cmp-item-head">
              <span class="cmp-item-kind">${Desk.esc(label)}</span>
              <span class="cmp-item-at">${timecode(toSeconds(l.from, doc.fps))} · ${l.durationInFrames}f</span>
            </div>
            <p class="cmp-item-text">${Desk.esc(String(words))}</p>
            ${l.reason ? `<p class="cmp-item-why">${Desk.esc(l.reason)}</p>` : ""}
            <div class="cmp-item-acts">
              ${l.status === "proposed"
                ? `<button class="btn btn-mini btn-accent" data-layer-accept="${l.id}">Accept</button>
                   <button class="btn btn-mini btn-danger" data-layer-reject="${l.id}">Reject</button>`
                : `<button class="btn btn-mini btn-danger" data-layer-remove="${l.id}">Remove</button>`}
            </div>
          </li>`;
      };

      const soundCard = (a) => {
        const what = a.kind === "sfx"
          ? `${a.preset}: ${SFX_PRESETS[a.preset]?.blurb ?? ""}`
          : `music bed${a.duck ? ", ducked under speech" : ""}`;
        return `
          <li class="cmp-item ${a.status}" data-sound="${a.id}">
            <div class="cmp-item-head">
              <span class="cmp-item-kind">${a.kind === "sfx" ? "sound" : "music"}</span>
              <span class="cmp-item-at">${timecode(toSeconds(a.from, doc.fps))} · ${Math.round(a.gain * 100)}%</span>
            </div>
            <p class="cmp-item-text">${Desk.esc(what)}</p>
            ${a.reason ? `<p class="cmp-item-why">${Desk.esc(a.reason)}</p>` : ""}
            <div class="cmp-item-acts">
              <button class="btn btn-mini" data-sound-play="${a.id}">${a.status === "proposed" ? "Hear it" : "Play"}</button>
              ${a.status === "proposed"
                ? `<button class="btn btn-mini btn-accent" data-sound-accept="${a.id}">Accept</button>
                   <button class="btn btn-mini btn-danger" data-sound-reject="${a.id}">Reject</button>`
                : `<button class="btn btn-mini btn-danger" data-sound-remove="${a.id}">Remove</button>`}
            </div>
          </li>`;
      };

      const byPending = (a, b) =>
        (a.status === "proposed" ? 0 : 1) - (b.status === "proposed" ? 0 : 1) || a.from - b.from;

      return `
        <div class="ed-head">
          <span>Composition</span>
          ${pending ? `<span class="gfx-count">${pending} to judge</span>` : ""}
          ${pending ? `<button class="btn btn-mini btn-accent" data-act="accept-all">Accept all</button>` : ""}
        </div>
        <div class="cmp-formats">${formats}</div>
        ${reframe}
        ${layers.length
          ? `<ul class="cmp-list">${[...layers].sort(byPending).map(layerCard).join("")}</ul>`
          : `<p class="cmp-empty">Nothing waiting on you. Accepted work is on the timeline: open a motion graphics clip to change or remove an element.</p>`}
        ${sounds.length
          ? `<ul class="cmp-list">${[...sounds].sort(byPending).map(soundCard).join("")}</ul>`
          : ""}`;
    }

    /**
     * Editing a text clip.
     *
     * The fields are the layer's own schema, not a second model of it: the
     * same `component`, `text`, `position` and `palette_role` an agent fills
     * in through propose_layer. Which means a person and an agent are editing
     * the same object, and neither has a field the other cannot see.
     */
    /* Fields whose values are a fixed list, so they get a menu rather than a
       box you can type a typo into. */
    const CHOICES = {
      font: ["display", "displayHeavy", "body", "bodyBold", "mono"],
      align: ["left", "center", "right"],
      backdrop: ["none", "box", "scrim"],
      animation: ["fade", "rise", "drop", "slide_left", "slide_right", "pop", "grow", "none"],
      shape: ["rect", "ellipse", "pill", "triangle", "line", "arrow", "ring", "star"],
      effect: ["dip", "flash", "vignette", "grain", "scanlines", "glitch", "letterbox", "wash"],
    };

    /* Sensible ranges for the numeric fields, so a slider is usable. */
    const RANGES = {
      size: [12, 220, 1], tracking: [-0.05, 0.4, 0.01], line_height: [0.8, 2.4, 0.05],
      outline: [0, 12, 0.5], rotation: [-180, 180, 1], opacity: [0, 1, 0.05],
      width: [0.02, 1.5, 0.01], height: [0.02, 1.5, 0.01],
      stroke_width: [0, 40, 1], radius: [0, 400, 2], strength: [0, 1, 0.05],
    };

    const HIDDEN_FIELDS = new Set(["timings", "point", "tag", "items"]);

    /**
     * The panel for whatever kind of graphic is selected.
     *
     * Built from the component's own declared fields rather than typed out per
     * component, which is the same rule the tool schema follows: the component
     * library is the single description of what a graphic takes, so a person
     * and an agent are offered exactly the same set and neither has a control
     * the other cannot reach.
     */
    function layerPanelHtml(layer) {
      const fps = composition().fps || 30;
      const info = COMPONENT_INFO[layer.component];
      const fields = info?.fields ?? {};
      const kind = (info?.name || layer.component).replace(/([a-z])([A-Z])/g, "$1 $2");

      const control = (name, spec) => {
        const value = layer.props?.[name];
        if (CHOICES[name]) {
          return `<label class="field"><span>${name.replace(/_/g, " ")}</span>
            <select data-lprop="${name}">
              ${CHOICES[name].map((c) => `<option value="${c}" ${c === value ? "selected" : ""}>${c.replace(/_/g, " ")}</option>`).join("")}
            </select></label>`;
        }
        if (name === "fill" || name === "stroke") {
          const hex = /^#/.test(String(value || "")) ? value : "#F54E00";
          return `<label class="field"><span>${name}</span>
            <span class="insp-colour">
              <input type="color" data-lprop="${name}" value="${hex}">
              <button class="btn btn-mini" data-lnone="${name}">none</button>
            </span></label>`;
        }
        if (spec.type === "number") {
          const [lo, hi, step] = RANGES[name] ?? [0, 1, 0.01];
          // The component's own default, not the bottom of the range. An
          // unset opacity used to show a slider parked at 0 while the shape
          // drew at full strength, so transparency looked broken before it
          // had been touched.
          const fallback = Number.isFinite(Number(spec.default)) ? Number(spec.default) : lo;
          // `value == null` first, because the validator stores an unset
          // numeric field as null and `Number(null)` is 0, which sails through
          // Number.isFinite. That is what parked a fresh shape's opacity
          // slider at 0 while the shape itself drew fully opaque.
          const now = value == null || value === ""
            ? fallback
            : (Number.isFinite(Number(value)) ? Number(value) : fallback);
          return `<label class="field"><span>${name.replace(/_/g, " ")} <b class="mono">${now}</b></span>
            <input type="range" data-lprop="${name}" min="${lo}" max="${hi}" step="${step}" value="${now}"></label>`;
        }
        if (name === "text") {
          return `<label class="field"><span>Words</span>
            <textarea class="insp-text" data-lprop="text" rows="3">${Desk.esc(value || "")}</textarea></label>`;
        }
        return `<label class="field"><span>${name.replace(/_/g, " ")}</span>
          <input type="text" data-lprop="${name}" value="${Desk.esc(value || "")}" placeholder="${Desk.esc((spec.note || "").slice(0, 40))}"></label>`;
      };

      const rows = Object.entries(fields)
        .filter(([name]) => !HIDDEN_FIELDS.has(name))
        .map(([name, spec]) => control(name, spec))
        .join("");

      return `
        <p class="insp-kind mono">${Desk.esc(kind)}</p>
        <div class="insp-body">
          ${MOVABLE.has(layer.component)
            ? `<p class="insp-hint">Drag it on the picture to move it, or a corner to size it.</p>` : ""}
          ${rows}
          <label class="field">
            <span>Look</span>
            <select data-lset="component">
              ${Object.keys(COMPONENT_INFO).map((c) => `<option value="${c}" ${c === layer.component ? "selected" : ""}>${c.replace(/_/g, " ")}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>Where</span>
            <select data-lset="position">
              ${COMP_POSITIONS.map((c) => `<option value="${c}" ${c === layer.position ? "selected" : ""}>${c.replace(/_/g, " ")}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>Colour</span>
            <select data-lset="palette_role">
              ${COMP_ROLES.map((c) => `<option value="${c}" ${c === layer.palette_role ? "selected" : ""}>${c}</option>`).join("")}
              ${/^#/.test(String(layer.palette_role)) ? `<option value="${layer.palette_role}" selected>${layer.palette_role}</option>` : ""}
            </select>
          </label>
          <label class="field">
            <span>Starts <b class="mono">${timecode(layer.from / fps)}</b></span>
            <input type="range" data-lmove="from" min="0" max="${Math.max(1, Math.round(total()))}" step="0.05" value="${layer.from / fps}">
          </label>
          <label class="field">
            <span>On screen <b class="mono">${(layer.durationInFrames / fps).toFixed(1)}s</b></span>
            <input type="range" data-lmove="dur" min="0.3" max="20" step="0.1" value="${(layer.durationInFrames / fps).toFixed(1)}">
          </label>
          ${MOVABLE.has(layer.component) ? `
          <p class="insp-kind mono">Motion</p>
          <p class="insp-hint">${(layer.keys ?? []).length
            ? `${layer.keys.length} keyframe${layer.keys.length === 1 ? "" : "s"}. Move the playhead and drag it on the picture to add another.`
            : "Put a key where it starts, move the playhead, then drag it. Two keys is an animation."}</p>
          <div class="insp-keys">
            <button class="btn btn-mini btn-accent" data-key="add">${keyHere(layer) ? "Update key" : "Key"}</button>
            ${(layer.keys ?? []).length ? `<button class="btn btn-mini" data-key="clear">Clear</button>` : ""}
          </div>` : ""}
          <button class="btn btn-danger btn-wide" data-ldrop="${layer.id}">Delete</button>
        </div>`;
    }

    /**
     * The left-hand tab: whatever is selected.
     *
     * A graphic and a clip are both "the thing you are working on", so they
     * share a tab rather than each having one that is empty most of the time.
     */
    /** The lane and item behind a uid, for the panels and the handlers. */
    function findItem(uid) {
      for (const lane of lanes) {
        const it = lane.items.find((x) => x.uid === uid);
        if (it) return { lane, it };
      }
      return null;
    }

    /**
     * Position, rotation and flip for one lane item.
     *
     * The same normalised numbers the spine uses (x and y as fractions of the
     * frame, scale as a multiplier, rotation in degrees) so one set of
     * sliders drives the preview and the export through the same
     * `applyTransform`.
     */
    function itemTransformFields(it) {
      const t = transformOf(it);
      return `
        <p class="insp-kind mono">Transform</p>
        <div class="insp-body insp-body--tight">
          <p class="insp-hint">Drag the picture to choose what stays in frame.</p>
          <div class="insp-row">
            <button class="btn btn-mini" data-item-fit="cover" aria-pressed="${fitOf(it) === "cover"}">Fill frame</button>
            <button class="btn btn-mini" data-item-fit="contain" aria-pressed="${fitOf(it) === "contain"}">Fit whole clip</button>
          </div>
          <label class="field"><span>Across <b class="mono">${t.x.toFixed(2)}</b></span>
            <input type="range" data-item-tf="x" min="-1" max="1" step="0.01" value="${t.x}"></label>
          <label class="field"><span>Down <b class="mono">${t.y.toFixed(2)}</b></span>
            <input type="range" data-item-tf="y" min="-1" max="1" step="0.01" value="${t.y}"></label>
          <label class="field"><span>Scale <b class="mono">${t.scale.toFixed(2)}</b></span>
            <input type="range" data-item-tf="scale" min="0.2" max="4" step="0.01" value="${t.scale}"></label>
          <label class="field"><span>Rotate <b class="mono">${Math.round(t.rotation)}&deg;</b></span>
            <input type="range" data-item-tf="rotation" min="-180" max="180" step="1" value="${t.rotation}"></label>
          <div class="insp-row">
            <button class="btn btn-mini" data-item-flip="flipH" aria-pressed="${t.flipH}">Flip across</button>
            <button class="btn btn-mini" data-item-flip="flipV" aria-pressed="${t.flipV}">Flip down</button>
          </div>
        </div>`;
    }

    /**
     * A clip on an overlay lane.
     *
     * Selecting one used to show "Select a clip or a graphic", because the
     * panel only knew about layers, staged sounds and the spine. Everything
     * dragged onto a V or A lane was therefore unreachable: no volume, no
     * position, no trim, no name.
     */
    function itemPanelHtml(lane, it) {
      const clip = byId.get(it.clipId);
      const max = clip?.duration || it.out;
      const isAudio = lane.kind === "audio";
      return `
        <p class="insp-kind mono">${isAudio ? "Sound" : "Overlay"}</p>
        <div class="insp-body">
          ${nameRowHtml(it.name || clip?.name || "Clip")}
          ${clip ? clipStatsHtml({ in: it.in, out: it.out, speed: it.speed || 1 }, clip) : ""}

          <label class="field">
            <span>Volume <b class="mono">${Math.round((it.gain ?? 1) * 100)}%</b></span>
            <input type="range" data-item-set="gain" min="0" max="1" step="0.02" value="${it.gain ?? 1}">
          </label>
          <label class="field">
            <span>Starts <b class="mono">${timecode(it.at)}</b></span>
            <input type="range" data-item-set="at" min="0" max="${Math.max(1, Math.ceil(total()))}" step="0.05" value="${it.at.toFixed(2)}">
          </label>
          <label class="field">
            <span>Trim in <b class="mono">${timecode(it.in)}</b></span>
            <input type="range" data-item-set="in" min="0" max="${max}" step="0.05" value="${it.in}">
          </label>
          <label class="field">
            <span>Trim out <b class="mono">${timecode(it.out)}</b></span>
            <input type="range" data-item-set="out" min="0" max="${max}" step="0.05" value="${it.out}">
          </label>
          <label class="field">
            <span>Speed</span>
            <select data-item-set="speed">
              ${SPEEDS.map((sp) => `<option value="${sp}" ${sp === (it.speed || 1) ? "selected" : ""}>${sp}&times;</option>`).join("")}
            </select>
          </label>

          ${isAudio ? "" : crossToTransitions()}

          <button class="btn btn-danger btn-wide" data-item-drop="${it.uid}">Remove from lane</button>
        </div>`;
    }

    /**
     * The name, with a way to change it.
     *
     * A library full of "export-00_41" is a library you cannot navigate, and
     * the name is the one thing about a clip that was read-only everywhere.
     */
    function nameRowHtml(name) {
      if (renaming) {
        return `<label class="field">
          <span>Name</span>
          <input type="text" data-rename-input value="${Desk.esc(name)}" spellcheck="false"
                 aria-label="Clip name">
        </label>`;
      }
      return `<div class="insp-name-row">
        <p class="insp-name">${Desk.esc(name)}</p>
        <button class="btn btn-mini" data-rename="start" title="Rename">Rename</button>
      </div>`;
    }

    function clipPaneHtml() {
      const layer = liveLayers().find((l) => l.id === selected);
      if (layer) return layerPanelHtml(layer);

      const sound = liveAudio().find((a) => a.id === selected);
      if (sound) return soundPanelHtml(sound);

      const onLane = findItem(selected);
      if (onLane) return itemPanelHtml(onLane.lane, onLane.it);

      // A staged cut, so selecting a chip does not leave the rail claiming
      // nothing is selected while a marker is clearly highlighted.
      const staged = pendingCuts().find((c) => c.id === selected);
      if (staged) {
        return `
          <p class="insp-kind mono">Suggested cut</p>
          <div class="insp-body">
            <p class="insp-name">Remove ${(staged.end - staged.start).toFixed(2)}s</p>
            <dl class="insp-stats mono">
              <div><dt>From</dt><dd>${timecode(staged.start)}</dd></div>
              <div><dt>To</dt><dd>${timecode(staged.end)}</dd></div>
              <div><dt>Asked by</dt><dd>${staged.origin === "agent" ? "the agent" : "you"}</dd></div>
            </dl>
            ${staged.text ? `<p class="insp-hint">&ldquo;${Desk.esc(staged.text)}&rdquo;</p>` : ""}
            ${staged.reason ? `<p class="insp-hint">${Desk.esc(staged.reason)}</p>` : ""}
            <div class="insp-row">
              <button class="btn btn-mini btn-accent" data-cut-accept="${staged.id}">Cut it</button>
              <button class="btn btn-mini btn-danger" data-cut-reject="${staged.id}">Keep it</button>
            </div>
            <p class="insp-hint">Backspace dismisses it.</p>
          </div>`;
      }

      const seg = timeline.find((s) => s.uid === selected);
      if (!seg) {
        return `<p class="insp-empty">Select a clip or a graphic on the timeline.</p>`;
      }
      if (seg.blank) {
        return `
          <p class="insp-kind mono">Motion graphics</p>
          <div class="insp-body">
            <p class="insp-name">Double click it on the timeline to work inside it.</p>
            <button class="btn btn-wide" data-blank="open">Open this clip</button>
            <label class="field">
              <span>Name</span>
              <input type="text" data-blank="title" value="${Desk.esc(seg.title || "Motion graphics")}" maxlength="40">
            </label>
            <label class="field">
              <span>Seconds <b class="mono">${(seg.out - seg.in).toFixed(1)}</b></span>
              <input type="range" data-blank="len" min="0.5" max="60" step="0.5" value="${seg.out - seg.in}">
            </label>
            <label class="field">
              <span>Colour</span>
              <input type="color" data-blank="colour" value="${seg.colour || "#101018"}">
            </label>
            <button class="btn btn-ghost btn-wide" data-blank="theme">Use the theme ground</button>
            ${crossToTransitions()}
          </div>`;
      }

      const clip = byId.get(seg.clipId);
      const max = clip?.duration || seg.out;
      return `
        <div class="insp-body">
          ${nameRowHtml(clip?.name || "Missing clip")}
          ${clipStatsHtml(seg, clip)}

          <label class="field">
            <span>Start <b class="mono">${timecode(seg.in)}</b></span>
            <input type="range" data-set="in" min="0" max="${max}" step="0.05" value="${seg.in}">
          </label>
          <label class="field">
            <span>End <b class="mono">${timecode(seg.out)}</b></span>
            <input type="range" data-set="out" min="0" max="${max}" step="0.05" value="${seg.out}">
          </label>

          <label class="field">
            <span>Look</span>
            <select class="select" data-set="filter">
              ${Object.keys(FILTERS).map((f) => `<option value="${f}" ${f === seg.filter ? "selected" : ""}>${f}</option>`).join("")}
            </select>
          </label>

          <label class="field">
            <span>Speed</span>
            <select class="select" data-set="speed">
              ${SPEEDS.map((s) => `<option value="${s}" ${s === seg.speed ? "selected" : ""}>${s}×</option>`).join("")}
            </select>
          </label>

          <label class="field">
            <span>Volume <b class="mono">${Math.round((seg.gain ?? 1) * 100)}%</b></span>
            <input type="range" data-set="gain" min="0" max="1" step="0.02" value="${seg.gain ?? 1}">
          </label>
          <button class="btn btn-ghost btn-wide" data-set="mute" aria-pressed="${seg.muted}">${seg.muted ? "Muted" : "Sound on"}</button>
          ${detachedAudio(seg.uid)
            ? `<button class="btn btn-ghost btn-wide" data-link="relink">Relink sound to picture</button>
               <p class="insp-hint">Its sound is on an audio lane with its own position and trim.</p>`
            : `<button class="btn btn-ghost btn-wide" data-link="unlink">Unlink sound from picture</button>
               <p class="insp-hint">Puts this clip's audio on its own lane, so it can run past the cut or be replaced.</p>`}

          ${crossToTransitions()}

          <div class="insp-row">
            <button class="btn btn-mini" data-move="-1" aria-label="Move earlier">←</button>
            <button class="btn btn-mini" data-move="1" aria-label="Move later">→</button>
            <button class="btn btn-mini btn-danger" data-move="x" aria-label="Remove from timeline">Remove</button>
          </div>
        </div>`;
    }

    /**
     * A line back to the tab that now owns the sliders.
     *
     * Splitting a panel is only an improvement if the half you are looking at
     * says where the other half went. One sentence, and it is a button, so the
     * keyboard reaches it like everything else here.
     */
    function crossToTransitions() {
      return `<button class="btn btn-ghost btn-wide" data-insp-go="trans">Transitions &amp; transform &rarr;</button>`;
    }

    /**
     * The second tab: how a clip arrives, how it leaves, and where it sits.
     *
     * These used to be the bottom half of the Clip panel, below the trim, the
     * look, the speed and the volume, which meant the two things you reach
     * for while watching the cut back were the two things furthest down a
     * scroll. They are their own column now.
     *
     * A transition is not a property on the segment: picking one stages an
     * `effect` layer on the VFX lane, tagged to this clip's edge, which is why
     * it survives being dragged and is in the export the moment it is set.
     */
    function transitionsPaneHtml() {
      const onLane = findItem(selected);
      if (onLane) {
        const { lane, it } = onLane;
        if (lane.kind === "audio") {
          return `<p class="insp-empty">Sound has no transition and nothing to move in the frame. Its level and timing are in <b>Clip</b>.</p>`;
        }
        return `
          ${itemTransformFields(it)}
          <p class="insp-hint">Transitions belong to the clips on the spine. This one is on an overlay lane, so fade it with a graphic instead.</p>`;
      }

      const layer = liveLayers().find((l) => l.id === selected);
      if (layer) {
        return `<p class="insp-empty">A graphic carries its own position and motion. They are in <b>Clip</b>, under the settings for this layer.</p>`;
      }

      const seg = timeline.find((s2) => s2.uid === selected);
      if (!seg) {
        return `<p class="insp-empty">Select a clip on the timeline to give it a transition, or to move it in the frame.</p>`;
      }

      return `
        <p class="insp-kind mono">Transition</p>
        <div class="insp-body insp-body--tight">
          <p class="insp-hint">How this clip arrives and how it leaves. Each one is a real layer on the VFX lane, so you can drag it, retime it or delete it there.</p>
          ${transitionFields(seg)}
        </div>
        ${transformFields(seg)}`;
    }

    /** A field worth protecting from a mid-keystroke repaint: text you could
     *  still be typing into, inside the rail. Anything else focused there
     *  (a button included) is not something a repaint could lose. */
    function isEditingField(el) {
      if (!el || !insp.contains(el)) return false;
      return el.matches?.("input, textarea") || el.isContentEditable === true;
    }

    function renderInspector() {
      // "trans" no longer names a tab of this rail's own: transitions moved
      // to the left panel, so it is not a case here. clipPaneHtml() is left
      // to answer for it, same as any other id it does not recognise.
      insp.innerHTML =
        inspTab === "gfx" ? graphicsHtml()
        : inspTab === "comp" ? compositionHtml()
        : clipPaneHtml();
      // A count on the tab, because a proposal behind a closed tab is a
      // proposal nobody answers.
      const waiting = agentWaiting();
      inspTabs.querySelectorAll("[data-insp]").forEach((b) => {
        const on = b.dataset.insp === inspTab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
        const n = waiting[b.dataset.insp] ?? 0;
        b.dataset.count = n > 0 ? String(n) : "";
        b.classList.toggle("has-waiting", n > 0);
      });
    }

    /**
     * A new proposal opens the tab that shows it.
     *
     * Splitting the rail into columns is worth it right up until something
     * arrives in a column you are not looking at, so anything newly staged
     * brings its own tab forward. Only on an increase: re-rendering must not
     * drag the rail back while somebody is reading a different tab.
     */
    /**
     * What is actually waiting on a decision, counting only what an agent
     * asked for. A transition somebody picks is a layer that exists as a
     * proposal for one tick before it is accepted, and following that would
     * drag the rail away from the panel they are working in.
     */
    function agentWaiting() {
      return {
        // The two stores land in two different panes, so they are counted
        // apart: badging the wrong tab is worse than not badging one.
        gfx: pendingGraphics().filter((g) => g.origin !== "human").length,
        comp: liveLayers().filter((l) => l.status === "proposed" && l.origin !== "human").length
          + liveAudio().filter((a) => a.status === "proposed" && a.origin !== "human").length
          + (composition().pendingFormat ? 1 : 0),
      };
    }

    let lastWaiting = { gfx: 0, comp: 0 };
    function followProposals() {
      const w = agentWaiting();
      const grew = w.gfx > lastWaiting.gfx ? "gfx" : w.comp > lastWaiting.comp ? "comp" : null;
      lastWaiting = w;
      if (grew && inspTab !== grew) {
        inspTab = grew;
        renderInspector();
      }
    }

    inspTabs.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-insp]");
      if (!tab) return;
      inspTab = tab.dataset.insp;
      renderInspector();
    });

    /** Arrows walk the rail's tabs, which is what a tablist is meant to do. */
    inspTabs.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();

      const order = [...inspTabs.querySelectorAll("[data-insp]")].map((b) => b.dataset.insp);
      const i = order.indexOf(inspTab);
      inspTab =
        e.key === "Home" ? order[0]
        : e.key === "End" ? order[order.length - 1]
        : order[(i + step + order.length) % order.length];

      renderInspector();
      inspTabs.querySelector(`[data-insp="${inspTab}"]`)?.focus({ preventScroll: true });
    });

    function renderClock() {
      clock.textContent = `${timecode(playhead)} / ${timecode(total())}`;
      const dur = total();
      scrub.value = dur ? String(Math.round((playhead / dur) * 1000)) : "0";
    }

    /** Staged cuts, under the track. Each says what it takes out and why. */
    function renderCuts() {
      const cuts = pendingCuts();
      cutStrip.innerHTML = cuts.length
        ? cuts.map((c) => `
            <span class="cut-chip ${c.id === selected ? "is-selected" : ""}" data-cut="${c.id}">
              <b>−${(c.end - c.start).toFixed(2)}s</b>
              <span>${timecode(c.start)}</span>
              <span class="cut-chip-why">${Desk.esc(c.text || c.reason || "")}</span>
              <button class="btn btn-mini btn-accent" data-cut-accept="${c.id}">Cut</button>
              <button class="btn btn-mini btn-danger" data-cut-reject="${c.id}">Keep</button>
            </span>`).join("")
        : "";
    }

    /**
     * The transcript, as buttons.
     *
     * Every word moves the playhead to the moment it was said, which is what
     * turns a wall of text into a way of navigating the take. Fillers are
     * struck through and gaps are called out inline, so what the agent would
     * offer to cut is already visible before it offers.
     */
    /**
     * Follow the playhead through the transcript without rebuilding it.
     *
     * The pane holds a text input for the API key and can be scrolled, so
     * re-rendering it on every frame would throw away the caret and the scroll
     * position thirty times a second. Only the one word that changed gets
     * touched, and only when it actually changes.
     */
    let nowWord = -1;
    let nowEl = null;
    let wordEls = null;
    function highlightWord() {
      if (libTab !== "words" || !transcript?.words?.length) return;
      const i = transcript.words.findIndex((w) => playhead >= w.start && playhead < w.end);
      if (i === nowWord) return;
      nowWord = i;
      // Two class writes, not one per word. A five-minute take is a thousand
      // buttons and this runs every time the spoken word advances.
      if (!wordEls) wordEls = [...libPane("words").querySelectorAll(".trx-word")];
      nowEl?.classList.remove("now");
      nowEl = wordEls[i] ?? null;
      nowEl?.classList.add("now");
    }

    function renderWords() {
      if (libTab !== "words") return;
      const pane = libPane("words");
      // Anything half-typed into the key field survives a re-render. The pane
      // rebuilds on every transcript change and losing the key mid-paste is
      // the kind of thing that makes a feature feel broken.
      const typed = pane.querySelector('[data-act="key"]')?.value ?? "";
      nowWord = -1;
      nowEl = null;
      wordEls = null;

      if (!transcript?.words?.length) {
        pane.innerHTML = `
          <div class="trx">
            <p class="cmp-empty">${
              !timeline.length
                ? "Nothing on the timeline yet. Add a clip, and if it was recorded with the teleprompter its transcript is already waiting."
                : "These clips were not recorded against a script, so there are no prompter timings to derive. Load a script into the Camera before recording and the transcript comes for free, or paste an OpenAI key below to transcribe with Whisper."
            }</p>
            ${timeline.length ? whisperHtml() : ""}
          </div>`;
        return;
      }

      const words = transcript.words.map((w, i) => {
        const next = transcript.words[i + 1];
        const gap = next ? next.start - w.end : 0;
        const now = playhead >= w.start && playhead < w.end;
        const classes = ["trx-word", now ? "now" : "", FILLERS.has(w.n) ? "filler" : ""]
          .filter(Boolean).join(" ");
        return `<button class="${classes}" data-at="${w.start.toFixed(3)}">${Desk.esc(w.w)}</button>` +
          (gap >= 1.1 ? `<span class="trx-gap">⟨${gap.toFixed(1)}s⟩</span>` : "");
      }).join(" ");

      pane.innerHTML = `
        <div class="trx">
          <div class="trx-meta">
            <span class="trx-tag${transcript.approximate ? " approx" : ""}">${
              transcript.source === "whisper" ? "whisper · measured" : "teleprompter · estimated"
            }</span>
            <span>${transcript.words.length} words</span>
            <span>${timecode(transcript.cut_seconds)}</span>
            <button class="btn btn-mini" data-act="tidy">Find fillers and gaps</button>
          </div>
          <p class="trx-words">${words}</p>
          ${whisperHtml()}
        </div>`;
      if (typed) {
        const field = pane.querySelector('[data-act="key"]');
        if (field) field.value = typed;
      }
    }

    /** The Whisper upgrade. The key is the user's and stays in this browser. */
    function whisperHtml() {
      const seg = timeline.find((s) => s.uid === selected) ?? timeline[0];
      const clip = seg ? byId.get(seg.clipId) : null;
      return `
        <div class="trx-key">
          <input type="password" data-act="key" placeholder="${
            hasApiKey() ? "OpenAI key saved in this browser" : "sk-… paste an OpenAI key to use Whisper"
          }" autocomplete="off" spellcheck="false" aria-label="OpenAI API key">
          <button class="btn btn-mini" data-act="save-key">Save</button>
          <button class="btn btn-mini btn-accent" data-act="transcribe" ${
            hasApiKey() && clip && !transcribing ? "" : "disabled"
          }>${transcribing ? "Transcribing…" : `Transcribe ${clip ? Desk.esc(clip.name) : "clip"}`}</button>
        </div>
        <p class="trx-note">Kept in this browser's localStorage and sent only to api.openai.com. The teleprompter transcript needs no key and works offline.</p>`;
    }

    /** Switch the left rail to one of its own tabs (Library, Text,
     *  Transitions, Transcript): the counterpart to clicking a `[data-lib]`
     *  button, shared with the arrow-key cycling below. */
    function selectLibTab(name, { focus = false } = {}) {
      libTab = name;
      renderLib();
      if (name === "words") renderWords();
      if (focus) libTabs.querySelector(`[data-lib="${name}"]`)?.focus({ preventScroll: true });
    }

    refresh = () => {
      renderTrack();
      renderLib();
      renderInspector();
      renderClock();
      renderCuts();
      // Not renderWords. The words pane is owned by rebuildTranscript's
      // callers and the onTranscripts subscription, because it is the
      // expensive one and the only one holding a text field.
    };

    /* ---- playback ---- */

    async function seekTo(time, { play = false } = {}) {
      playhead = Math.max(0, Math.min(time, total()));
      const at = segmentAt(playhead);
      if (!at) return;

      // A blank has nothing to decode. Park the element and let the graphics
      // canvas carry the frame.
      if (at.seg.blank) {
        video.pause();
        loaded = null;
        video.style.filter = "";
        noPic.hidden = true;
        syncOverlays(playhead, { play });
        syncLaneAudio(playhead, { play });
        scheduler?.seek(playhead);
        renderClock();
        paintPlayhead();
        highlightWord();
        return;
      }

      const clip = byId.get(at.seg.clipId);
      if (!clip) return;

      // The picture is missing for a reason worth reading, and the frame it
      // would have filled is the one place nobody can miss it.
      noPic.hidden = !noPicture(clip);
      if (noPicture(clip)) noPic.textContent = noPictureMessage(clip.name);

      if (loaded !== at.seg.clipId) {
        video.src = Clips.url(clip);
        loaded = at.seg.clipId;
        await new Promise((r) => {
          const bail = setTimeout(r, 4000);
          video.onloadeddata = () => { clearTimeout(bail); r(); };
        });
      }

      video.playbackRate = at.seg.speed;
      video.muted = at.seg.muted;
      // On the video element, not `.ed-screen`. A CSS filter on an ancestor
      // rasterises and grades its whole subtree: the graphics canvas
      // included, and no `filter: none` on the canvas can opt back out of
      // that, because it is the ancestor's composite being filtered, not
      // the canvas's own paint. The clip's look belongs on the clip.
      video.style.filter = FILTERS[at.seg.filter] || "";
      const target = at.seg.in + at.offset * at.seg.speed;
      if (Math.abs(video.currentTime - target) > 0.12) video.currentTime = target;
      if (play) await video.play().catch(() => {});
      // Moving the playhead is not playing through it, so nothing fires. An
      // effect that retriggered every time you scrubbed over it would make the
      // preview unusable.
      scheduler?.seek(playhead);
      paintTransform();
      syncOverlays(playhead, { play });
      syncLaneAudio(playhead, { play });
      renderClock();
      paintPlayhead();
      highlightWord();
    }

    let lastTick = 0;

    function loop() {
      if (!playing) return;
      const now = performance.now();
      const dt = lastTick ? Math.min(0.25, (now - lastTick) / 1000) : 0;
      lastTick = now;

      const at = segmentAt(playhead);
      if (at) {
        if (at.seg.blank) {
          // Nothing is decoding, so the wall clock is the only clock.
          playhead += dt;
          if (playhead >= at.start + segDuration(at.seg) - 0.02) {
            const next = timeline[timeline.indexOf(at.seg) + 1];
            if (next) seekTo(at.start + segDuration(at.seg) + 0.01, { play: true });
            else if (playhead >= total() - 0.02) return stop();
          }
        } else {
          const local = Math.max(0, (video.currentTime - at.seg.in) / at.seg.speed);
          playhead = at.start + local;

          if (video.currentTime >= at.seg.out - 0.03 || video.ended) {
            const next = timeline[timeline.indexOf(at.seg) + 1];
            if (next) seekTo(at.start + segDuration(at.seg) + 0.01, { play: true });
            else return stop();
          }
        }
      }
      // Fire any accepted effect the playhead just crossed.
      scheduler?.tick(playhead, liveAudio());
      paintTransform();
      syncOverlays(playhead, { play: true });
      syncLaneAudio(playhead, { play: true });
      renderClock();
      paintPlayhead();
      highlightWord();
      raf = requestAnimationFrame(loop);
    }

    async function play() {
      if (!timeline.length && !lanes.some((l) => l.items.length)) return;
      if (playhead >= total() - 0.05) playhead = 0;
      cancelAnimationFrame(raf);
      lastTick = 0;
      playing = true;
      playBtn.dataset.playing = "true";
      playBtn.setAttribute("aria-label", "Pause");
      if (hasSound()) ensureMixer();
      await seekTo(playhead, { play: true });
      if (hasSound()) startBeds();
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      playing = false;
      playBtn.dataset.playing = "false";
      playBtn.setAttribute("aria-label", "Play");
      cancelAnimationFrame(raf);
      video.pause();
      overlayVideos.forEach((el) => el.pause());
      laneAudio.forEach(({ el }) => el.pause());
      stopBeds();
      renderClock();
    }

    /* ---- export: replay the timeline into a canvas ---- */

    let audioGraph = null;
    let cancelled = false;

    function ensureAudio() {
      if (audioGraph) return audioGraph;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const source = ctx.createMediaElementSource(video);
        const dest = ctx.createMediaStreamDestination();
        source.connect(ctx.destination);
        source.connect(dest);
        audioGraph = { ctx, dest };
      } catch {
        audioGraph = { ctx: null, dest: null };
      }
      return audioGraph;
    }

    /**
     * The audio lanes, wired into the same graph the recorder captures.
     *
     * One <audio> per lane, routed through the export destination as well as
     * the speakers, so a music bed a person dropped on A1 is in the file for
     * the same reason the spine's own sound is: it went through the graph the
     * MediaRecorder is listening to. A source node can only be created once
     * per element, hence the cache.
     */
    const laneAudio = new Map();

    function laneAudioEl(laneId) {
      let entry = laneAudio.get(laneId);
      if (!entry) {
        const el = document.createElement("audio");
        el.preload = "auto";
        el.style.display = "none";
        body.appendChild(el);
        entry = { el, wired: false };
        laneAudio.set(laneId, entry);
      }
      const { ctx, dest } = ensureAudio();
      if (ctx && !entry.wired) {
        try {
          const src = ctx.createMediaElementSource(entry.el);
          src.connect(ctx.destination);
          if (dest) src.connect(dest);
          entry.wired = true;
        } catch { /* already wired, or no graph */ }
      }
      return entry.el;
    }

    function syncLaneAudio(time, { play = false } = {}) {
      const active = new Map(audioAt(time).map((a) => [a.lane.id, a]));
      for (const lane of lanes.filter((l) => l.kind === "audio")) {
        const hit = active.get(lane.id);
        const el = laneAudioEl(lane.id);
        if (!hit) { el.pause(); continue; }
        const clip = byId.get(hit.item.clipId);
        if (!clip) continue;
        if (el.dataset.clip !== hit.item.clipId) {
          el.src = Clips.url(clip);
          el.dataset.clip = hit.item.clipId;
        }
        el.volume = Math.max(0, Math.min(1, hit.item.gain ?? 1));
        const target = hit.item.in + hit.offset;
        if (Math.abs(el.currentTime - target) > 0.16) el.currentTime = target;
        if (play) el.play().catch(() => {});
        else el.pause();
      }
    }

    const hasLaneAudio = () => lanes.some((l) => l.kind === "audio" && l.items.length);

    async function runExport() {
      if (!timeline.length) return Desk.toast("Nothing on the timeline to export.", "bad");
      const firstReal = timeline.find((sg) => !sg.blank);
      stop();
      cancelled = false;

      const first = firstReal ? byId.get(firstReal.clipId) : null;
      const shape = formatOf(composition().format);
      const canvas = document.createElement("canvas");
      // The composition's format decides the file's shape. Before this, the
      // canvas took the first clip's dimensions and an accepted reframe to
      // 9:16 exported a landscape video, which made propose_format a lie.
      canvas.width = shape.width;
      canvas.height = shape.height;
      const ctx = canvas.getContext("2d");
      // One palette snapshot for the whole render, not one per frame.
      const exportPal = palette();

      const stream = canvas.captureStream(30);
      const { ctx: audioCtx, dest } = ensureAudio();
      if (audioCtx?.state === "suspended") await audioCtx.resume().catch(() => {});
      dest?.stream.getAudioTracks().forEach((t) => stream.addTrack(t));

      // MP4 first: it is what everything downstream of this app -- other
      // editors, phones, whatever the export is actually for -- expects.
      // A codec-qualified string ("avc1...") is refused on some builds that
      // accept the bare type and pick the codec themselves, so it is left
      // unqualified rather than pinned to one that only sometimes matches.
      // WebM is still the fallback for a browser with no MP4 encoder.
      const mime = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        .find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

      exportPane.hidden = false;
      const fill = exportPane.querySelector(".bar-fill");
      const title = exportPane.querySelector(".ed-export-title");
      const duration = total();

      if (hasSound()) ensureMixer();
      // Wire every audio lane before the recorder starts; a source connected
      // mid-recording is a lane that is silent for the first half of the file.
      if (hasLaneAudio()) lanes.filter((l) => l.kind === "audio").forEach((l) => laneAudioEl(l.id));
      recorder.start(250);
      playhead = 0;
      await seekTo(0, { play: true });
      scheduler?.reset();
      if (hasSound()) await startBeds();

      await new Promise((resolve) => {
        const paint = () => {
          if (cancelled) return resolve();
          const at = segmentAt(playhead);
          if (!at) return resolve();

          /* Past the last clip, with a floating motion graphics clip still
             running. The loop used to stop the moment the spine ran out, which
             is why a title sequence hung off the end was in the timeline and
             not in the file. There is nothing to decode down here, so it runs
             like a blank: ground, graphics, real time. */
          const tail = playhead >= spine() - 0.001;

          if (tail || at.seg.blank) {
            ctx.filter = "none";
            ctx.fillStyle = (tail ? null : at.seg.colour) || exportPal.ink;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          } else {
          ctx.filter = FILTERS[at.seg.filter] || "none";
          try {
            // Cover, not stretch. A 16:9 take in a 9:16 frame with bars down
            // both sides is not a vertical video, it is a landscape video
            // someone gave up on, and stretching every clip to the canvas
            // distorted any footage that was not the first clip's shape.
            // The clip's own reframe, from the same numbers the preview uses.
            const t = transformAt(at.seg, playhead);
            const fit = fitVideo(
              video.videoWidth || first?.width || canvas.width,
              video.videoHeight || first?.height || canvas.height,
              canvas.width,
              canvas.height,
              fitOf(at.seg),
              panOf(t)
            );
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            applyTransform(ctx, t, canvas.width, canvas.height);
            ctx.drawImage(video, fit.x, fit.y, fit.w, fit.h);
            ctx.restore();
          } catch { /* frame not ready */ }
          }

          // The same functions the preview calls, on the frame being written.
          // Proposals are excluded: only what the editor accepted is in the
          // file, and the look never has to be reconciled between two
          // renderers because there is only one.
          // Overlay lanes are pictures, so they get the same filter-free
          // treatment as the spine and go on before any graphic.
          ctx.filter = "none";
          drawOverlays(ctx, canvas.width, canvas.height, playhead);
          drawGraphics(ctx, canvas.width, canvas.height, playhead, acceptedGraphics(), { showProposed: false });
          renderComposition(ctx, {
            width: canvas.width,
            height: canvas.height,
            frame: Math.round(playhead * composition().fps),
            layers: acceptedLayers(),
            format: composition().format,
            fps: composition().fps,
            showProposed: false,
            pal: exportPal,
          });

          // Effects fire into the same graph the recorder is capturing, so
          // what you heard in the preview is what is in the file.
          scheduler?.tick(playhead, liveAudio());
          syncLaneAudio(playhead, { play: true });

          if (tail || at.seg.blank) {
            // Real time, like everything else here: the recorder is capturing
            // a live canvas, so a blank has to take up its real duration.
            playhead += 1 / 30;
          } else {
            const local = Math.max(0, (video.currentTime - at.seg.in) / at.seg.speed);
            playhead = at.start + local;
          }
          fill.style.width = `${Math.min(100, (playhead / duration) * 100)}%`;
          title.textContent = `Exporting… ${timecode(playhead)} of ${timecode(duration)}`;

          if (tail) {
            if (playhead >= duration - 0.02) return resolve();
            return void requestAnimationFrame(paint);
          }

          const done = at.seg.blank
            ? playhead >= at.start + segDuration(at.seg) - 0.02
            : video.currentTime >= at.seg.out - 0.03 || video.ended;
          if (done) {
            const next = timeline[timeline.indexOf(at.seg) + 1];
            if (!next) {
              // The spine is finished. Anything still running past it is a
              // floating clip, and the next frame falls into the tail above.
              if (playhead >= duration - 0.02) return resolve();
              video.pause();
              return void requestAnimationFrame(paint);
            }
            seekTo(at.start + segDuration(at.seg) + 0.01, { play: true });
          }
          requestAnimationFrame(paint);
        };
        requestAnimationFrame(paint);
      });

      video.pause();
      stopBeds();
      recorder.stop();

      const blob = await new Promise((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime || "video/webm" }));
      });

      exportPane.hidden = true;
      if (cancelled) return Desk.toast("Export cancelled.", "bad");

      const clip = await Clips.save(blob, { name: `Export ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, kind: "export" });
      Desk.toast("Export saved to your library.", "good");
      offerDownload(clip);
      return clip;
    }

    /* ---- sound ---- */

    /**
     * One mixer, fanning out to the speakers and to the export stream.
     *
     * Built on the same AudioContext the export already makes to get the
     * video's own audio into the file, so an accepted effect is audible in the
     * preview and present in the export without a second graph or a second
     * decision about routing.
     */
    let mixer = null;
    let scheduler = null;
    let beds = [];
    let bedTimers = [];

    /**
     * Built on first use, and only on first use.
     *
     * `ensureAudio` puts the video through a MediaElementSource, and from then
     * on the element's sound reaches the speakers only by way of the graph. So
     * a composition with no sound in it must not touch this at all: doing it
     * eagerly on every play would route the audio through a context the
     * autoplay policy may have left suspended, and the cost of that is silent
     * playback for someone who never asked for a sound effect.
     */
    function ensureMixer() {
      if (mixer) return mixer;
      const { ctx: audioCtx, dest } = ensureAudio();
      if (!audioCtx) return null;
      // A context created without a gesture starts suspended, and a suspended
      // context passes no audio through at all.
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      const outs = [audioCtx.destination];
      if (dest) outs.push(dest);
      mixer = createMixer(audioCtx, outs);
      scheduler = createScheduler(mixer, { fps: composition().fps });
      return mixer;
    }

    /** Is there any sound to mix? If not, leave the audio path alone. */
    const hasSound = () => liveAudio().some((a) => a.status === "accepted");

    /** Start the accepted music beds, ducked under the words we know about. */
    async function startBeds() {
      stopBeds();
      const tracks = liveAudio().filter((a) => a.kind === "music" && a.status === "accepted");
      if (!tracks.length) return;
      const mix = ensureMixer();
      if (!mix) return;

      const fps = composition().fps;

      for (const bedTrack of tracks) {
        const clip = byId.get(bedTrack.clipId) ?? (await Clips.all()).find((c) => c.id === bedTrack.clipId);
        if (!clip) continue;

        // A bed has a window, and it is the window the inspector shows.
        // Honour it: start when the playhead reaches it, stop
        // when it ends, and enter partway through if the playhead is already
        // inside.
        const from = bedTrack.from / fps;
        const until = (bedTrack.from + bedTrack.durationInFrames) / fps;
        if (playhead >= until) continue;

        const el = new Audio(Clips.url(clip));
        el.loop = true;
        el.crossOrigin = "anonymous";

        const begin = async () => {
          const into = Math.max(0, playhead - from);
          const bed = mix.bed(el, {
            gain: bedTrack.gain,
            duck: bedTrack.duck,
            speech: bedTrack.duck ? speechRanges(transcript) : [],
            offset: playhead,
          });
          if (!bed) return;
          if (into > 0 && Number.isFinite(el.duration)) el.currentTime = into % Math.max(0.1, el.duration);
          await el.play().catch(() => {});
          beds.push(bed);
          const left = (until - Math.max(playhead, from)) * 1000;
          if (Number.isFinite(left) && left > 0) {
            bedTimers.push(setTimeout(() => bed.stop(), left));
          }
        };

        if (playhead >= from) await begin();
        else bedTimers.push(setTimeout(begin, (from - playhead) * 1000));
      }
    }

    function stopBeds() {
      for (const timer of bedTimers) clearTimeout(timer);
      bedTimers = [];
      for (const bed of beds) bed.stop();
      beds = [];
    }

    /* ---- staged cuts ---- */

    /**
     * Take a staged cut.
     *
     * The store hands back a whole new timeline rather than mutating this one,
     * so applying a cut is a swap. A cut in the middle of a segment becomes
     * two segments of the same clip: a real split, which the timeline could
     * not do before the transcript gave a reason to want one.
     */
    async function takeCut(id, gesture) {
      const cut = pendingCuts().find((c) => c.id === id);
      if (!cut) return;
      if (!(gesture?.isTrusted || gesture?.nativeEvent?.isTrusted)) return;

      mark();
      const result = applyCut(timeline, cut);
      timeline = result.timeline;
      if (!timeline.some((s) => s.uid === selected)) selected = null;
      loaded = null;

      // Everything downstream of a removal has just moved. The cuts still
      // waiting are absolute ranges in the edit and the layers are absolute
      // frames of it, so both have to slide back by what went, otherwise
      // accepting the first of a batch quietly aims the rest at the wrong
      // words, and propose_tidy stages a batch by design.
      settle(id);
      retime(cut.start, result.removed);
      shiftAfter(Math.round(cut.start * composition().fps), Math.round(result.removed * composition().fps));

      await rebuildTranscript();
      Desk.toast(`Cut ${result.removed.toFixed(2)}s.`, "good");
      refresh();
      seekTo(Math.min(playhead, total()));
    }

    /** The button beside the transcript. Same finder the agent's propose_tidy
     *  uses, so the two never disagree about what counts as a filler. */
    function findDeadWeightHere(gesture) {
      if (!transcript) return;
      const found = findDeadWeight(transcript);
      if (!found.length) return Desk.toast("No fillers or dead air found.", "good");

      let staged = 0;
      for (const item of found) {
        // origin "human", because this list was asked for by the person at the
        // keyboard. They still have to accept each one.
        const r = proposeCut(
          { start: item.start, end: item.end, reason: item.reason, text: item.text, kind: item.kind, origin: "human" },
          { cutSeconds: total() }
        );
        if (r.ok) staged++;
      }
      Desk.toast(
        staged ? `${staged} cut${staged === 1 ? "" : "s"} staged under the track.` : "Those are already staged.",
        "good"
      );
    }

    /* ---- whisper ---- */

    async function runTranscribe() {
      const seg = timeline.find((s) => s.uid === selected) ?? timeline[0];
      const clip = seg ? (await Clips.all()).find((c) => c.id === seg.clipId) : null;
      if (!clip) return Desk.toast("Select a clip on the timeline first.", "bad");

      transcribing = true;
      renderWords();
      const result = await transcribe(clip);
      transcribing = false;

      if (!result.ok) {
        Desk.toast(result.error, "bad");
        if (result.hint) console.info(`[deskmate] ${result.hint}`);
      } else {
        Desk.toast(`Transcribed ${result.transcript.words.length} words.`, "good");
      }
      await rebuildTranscript();
      refresh();
    }

    function offerDownload(clip) {
      const a = document.createElement("a");
      a.href = Clips.url(clip);
      // The extension follows what the recorder actually produced, not a
      // fixed guess -- an .mp4 that is secretly WebM opens nowhere useful.
      const ext = clip.blob.type.includes("mp4") ? "mp4" : "webm";
      a.download = `${clip.name.replace(/\s+/g, "-").toLowerCase()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    /* ---- events ---- */

    body.addEventListener("click", async (e) => {
      const t = e.target;
      const act = t.closest("[data-act]")?.dataset.act;

      const pageTo = t.closest("[data-page-to]")?.dataset.pageTo;
      if (pageTo === "edit") return void leaveScope();
      if (pageTo === "motion") {
        const c = scopeClip()
          || motionClips().find((x) => x.id === lastScope)
          || motionClips()[0];
        if (!c) return void Desk.toast("No motion graphics clip yet. Add one below.", "bad");
        return void enterScope(c.id);
      }

      const libRen = t.closest("[data-lib-rename]");
      if (libRen) {
        libRenaming = libRen.dataset.libRename;
        return void renderLibrary();
      }

      const libTo = t.closest("[data-lib]")?.dataset.lib;
      if (libTo) return void selectLibTab(libTo);

      const addText = t.closest("[data-add-text]");
      if (addText) return void addElement(TEXT_KINDS[Number(addText.dataset.addText)], e);
      const addShape = t.closest("[data-add-shape]");
      if (addShape) {
        return void addElement({ component: "shape", props: { shape: addShape.dataset.addShape } }, e);
      }

      const opener = t.closest("[data-open-mclip]");
      if (opener) return void enterScope(opener.dataset.openMclip);

      /**
       * Answer the press, then do the work.
       *
       * The repaint that follows an accept is a frame away, and a button that
       * looks unchanged for a frame reads as a button that did not register.
       * This flips the thing being decided the moment it is clicked; the
       * repaint then draws the same state from the store and agrees with it.
       */
      const settle = (el, id) => {
        const card = el.closest(".cmp-item, .gfx-item");
        if (card) {
          card.classList.remove("proposed");
          card.classList.add("accepted", "is-settling");
          card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
        }
        if (id) {
          body.querySelectorAll(`[data-layer="${id}"], [data-sound="${id}"]`)
            .forEach((x) => x.classList.remove("is-proposed"));
        }
      };

      const yes = t.closest("[data-gfx-accept]");
      if (yes) { settle(yes, yes.dataset.gfxAccept); return void acceptGraphic(yes.dataset.gfxAccept, e); }
      const no = t.closest("[data-gfx-reject]");
      if (no) return void rejectGraphic(no.dataset.gfxReject, e);
      const gone = t.closest("[data-gfx-remove]");
      if (gone) return void removeGraphic(gone.dataset.gfxRemove, e);

      // Clicking a graphic takes you to it. Judging one means seeing it.
      const card = t.closest("[data-gfx]");
      if (card) {
        const g = liveGraphics().find((x) => x.id === card.dataset.gfx);
        if (g) return void seekTo(Math.min(total(), g.start + g.duration * 0.45));
      }

      /* ---- the composition ---- */

      // One click, the same guard as each single Accept: `e` is this click,
      // so every accept it fans out still carries a trusted gesture. Nothing
      // here can be reached without a real person pressing a real button.
      if (t.closest('[data-act="accept-all"]')) {
        pendingLayers().forEach((l) => acceptLayer(l.id, e));
        pendingAudio().forEach((a) => acceptAudio(a.id, e));
        if (composition().pendingFormat) acceptFormat(e);
        return;
      }

      const fmt = t.closest("[data-format]");
      if (fmt) return void setFormat(fmt.dataset.format, e);
      if (t.closest("[data-fmt-accept]")) return void acceptFormat(e);
      if (t.closest("[data-fmt-reject]")) return void rejectFormat(e);

      const yesLayer = t.closest("[data-layer-accept]");
      if (yesLayer) {
        settle(yesLayer, yesLayer.dataset.layerAccept);
        return void acceptLayer(yesLayer.dataset.layerAccept, e);
      }
      const noLayer = t.closest("[data-layer-reject]");
      if (noLayer) return void rejectLayer(noLayer.dataset.layerReject, e);
      const goneLayer = t.closest("[data-layer-remove]");
      if (goneLayer) return void removeLayer(goneLayer.dataset.layerRemove, e);

      const yesSound = t.closest("[data-sound-accept]");
      if (yesSound) {
        settle(yesSound, yesSound.dataset.soundAccept);
        return void acceptAudio(yesSound.dataset.soundAccept, e);
      }
      const noSound = t.closest("[data-sound-reject]");
      if (noSound) return void rejectAudio(noSound.dataset.soundReject, e);
      const goneSound = t.closest("[data-sound-remove]");
      if (goneSound) return void removeAudio(goneSound.dataset.soundRemove, e);

      // Audition an effect without moving the playhead. Deciding whether a
      // thump belongs under a title card takes hearing it, once.
      const hear = t.closest("[data-sound-play]");
      if (hear) {
        const track = liveAudio().find((a) => a.id === hear.dataset.soundPlay);
        if (track?.kind === "sfx") ensureMixer()?.sfx(track.preset, track.gain);
        return;
      }

      // Clicking a layer takes you into it, past its entrance, so what you
      // are judging is the graphic and not its first three frames.
      const layerCard = t.closest("[data-layer]");
      if (layerCard) {
        const l = liveLayers().find((x) => x.id === layerCard.dataset.layer);
        if (l) {
          const at = toSeconds(l.from + l.durationInFrames * 0.45, composition().fps);
          return void seekTo(Math.min(total(), at));
        }
      }

      /* ---- staged cuts ---- */

      const yesCut = t.closest("[data-cut-accept]");
      if (yesCut) return void takeCut(yesCut.dataset.cutAccept, e);
      const noCut = t.closest("[data-cut-reject]");
      if (noCut) {
        const id = noCut.dataset.cutReject;
        const result = rejectCut(id, e);
        // Reject only reaches `onCuts`, which redraws the strip. If the same
        // cut was open in the Clip tab (reachable from that panel's own
        // "Keep it", not only the chip's), the rail never heard about it and
        // sat there showing a decision that had already been made.
        if (result.ok) {
          if (selected === id) selected = null;
          renderInspector();
        }
        return;
      }

      const cutChip = t.closest("[data-cut]");
      if (cutChip) {
        // Selecting it is what lets Backspace dismiss it.
        select(cutChip.dataset.cut);
        const c = pendingCuts().find((x) => x.id === cutChip.dataset.cut);
        if (c) return void seekTo(Math.max(0, c.start - 0.6));
      }

      /* ---- the transcript ---- */

      // Every word is a seek. This is the whole point of the panel.
      const word = t.closest("[data-at]");
      if (word) return void seekTo(Number(word.dataset.at));

      if (act === "tidy") return findDeadWeightHere(e);
      if (act === "save-key") {
        const input = body.querySelector('[data-act="key"]');
        setApiKey(input.value);
        input.value = "";
        Desk.toast(hasApiKey() ? "Key saved in this browser." : "Key cleared.", "good");
        return refresh();
      }
      if (act === "transcribe") return runTranscribe();

      const zoomBtn = t.closest("[data-zoom]");
      if (zoomBtn) {
        const how = zoomBtn.dataset.zoom;
        if (how === "fit") return setZoom(1);
        const i = ZOOM_STEPS.findIndex((z) => z >= zoomLevel - 0.001);
        const at = i === -1 ? ZOOM_STEPS.length - 1 : i;
        return setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, how === "in" ? at + 1 : at - 1))]);
      }

      if (act === "play") return playing ? stop() : play();
      if (act === "import") return fileInput.click();
      if (act === "import-audio") return libAudioInput.click();
      if (act === "new-folder") {
        const made = await Folders.add(`Folder ${libFolders.length + 1}`);
        // Straight into the name field. A folder called "Folder 3" is a folder
        // nobody uses, and the moment to name it is the moment it appears.
        libFolder = made.id;
        folderRenaming = made.id;
        return void renderLibrary();
      }
      if (act === "split") return splitAtPlayhead();
      if (act === "add-text") return addTextClip(e);
      if (act === "add-blank") {
        const made = addBlank({ seconds: 5 });
        Desk.toast("Motion graphics clip added. Open it to build inside it.", "good");
        return rebuildTranscript().then(() => {
          refresh();
          if (made?.uid) enterScope(made.uid);
        });
      }
      if (act === "add-overlay") {
        // An overlay is graphics over a picture. With no cut under it there is
        // nothing to overlay, and the bar would be drawn wider than the track.
        if (total() < 0.5) {
          return void Desk.toast("Add a clip first: an overlay goes over footage.", "bad");
        }
        const room = Math.max(1, total() - playhead);
        const seconds = Math.min(5, room);
        const lane = freeVideoLaneAt(playhead, playhead + seconds);
        const made = addFloatingClip({ at: playhead, seconds, laneId: lane?.id ?? null });
        Desk.toast(
          lane ? `Overlay added on ${lane.name}. Open it to build inside it.` : "Overlay added over the cut. Open it to build inside it.",
          "good"
        );
        refresh();
        return void enterScope(made.id);
      }
      if (act === "scope-out") return void leaveScope();
      if (act === "scope-text") return void addInScope("text", e);
      if (act === "scope-shape") return void addInScope("shape", e);
      if (act === "add-lane") { mark(); addLane("video"); Desk.toast("Video lane added. Drag a clip onto it.", "good"); return refresh(); }
      if (act === "add-audio") { mark(); addLane("audio"); audioInput.click(); return refresh(); }
      if (act === "export") return runExport();
      if (act === "cancel-export") { cancelled = true; return; }
      if (act === "undo") return void undo(e);
      if (act === "redo") return void redo(e);
      if (act === "clear") {
        mark();
        timeline = [];
        lanes = [];
        floats = [];
        scope = null;
        selected = null;
        loaded = null;
        video.removeAttribute("src");
        stop();
        await rebuildTranscript();
        return refresh();
      }

      const chip = t.closest("[data-folder]");
      if (chip) {
        libFolder = chip.dataset.folder;
        libFiling = null;
        return void renderLibrary();
      }

      const filing = t.closest("[data-lib-file]");
      if (filing) {
        libFiling = libFiling === filing.dataset.libFile ? null : filing.dataset.libFile;
        return void renderLibrary();
      }

      const fileTo = t.closest("[data-file-to]");
      if (fileTo) {
        libFiling = null;
        await Folders.move(fileTo.dataset.fileClip, fileTo.dataset.fileTo);   // emits
        return;
      }

      const fileNew = t.closest("[data-file-new]");
      if (fileNew) {
        const made = await Folders.add(`Folder ${libFolders.length + 1}`);
        await Folders.move(fileNew.dataset.fileNew, made.id);
        libFiling = null;
        libFolder = made.id;
        folderRenaming = made.id;
        return void renderLibrary();
      }

      const foldRen = t.closest("[data-folder-rename]");
      if (foldRen) {
        folderRenaming = foldRen.dataset.folderRename;
        return void renderLibrary();
      }

      const foldDel = t.closest("[data-folder-del]");
      if (foldDel) {
        // The clips come back out rather than going with it, so this needs no
        // confirming: nothing here is lost, and the toast says as much.
        const inside = (await Clips.all()).filter((c) => c.folder === foldDel.dataset.folderDel).length;
        await Folders.remove(foldDel.dataset.folderDel);
        libFolder = "all";
        Desk.toast(
          inside ? `Folder deleted. ${inside} clip${inside === 1 ? "" : "s"} back in the library.` : "Folder deleted.",
          "good"
        );
        return void renderLibrary();
      }

      const add = t.closest("[data-add]");
      if (add) {
        const picked = byId.get(add.dataset.add);
        // Sound has nowhere to be on the spine: put there it would be a
        // segment with no picture and a duration nobody asked for. It lands on
        // an audio lane at the playhead, which is where dragging it would have
        // put it.
        if (picked?.kind === "audio") {
          mark();
          const lane = addSoundAt(picked, playhead);
          Desk.toast(`${picked.name} on ${lane.name}.`, "good");
          return void refresh();
        }
        await addClip(add.dataset.add);
        // The transcript is a property of the cut, not of the library, so
        // adding a clip changes it.
        await rebuildTranscript();
        refresh();
        return seekTo(playhead);
      }

      const takeBlank = t.closest("[data-take-blank]");
      if (takeBlank) {
        Editor.takeBlank(takeBlank.dataset.takeBlank, e);
        return void rebuildTranscript().then(refresh);
      }
      const dropBlank = t.closest("[data-drop-blank]");
      if (dropBlank) {
        Editor.dropBlank(dropBlank.dataset.dropBlank, e);
        return void rebuildTranscript().then(refresh);
      }

      const dropLane = t.closest("[data-drop-lane]");
      if (dropLane) {
        lanes = lanes.filter((l) => l.id !== dropLane.dataset.dropLane);
        floats = floats.map((f) => (f.laneId === dropLane.dataset.dropLane ? { ...f, laneId: null } : f));
        return refresh();
      }

      const del = t.closest("[data-del]");
      if (del) {
        timeline = timeline.filter((s) => s.clipId !== del.dataset.del);
        await Clips.remove(del.dataset.del);
        loaded = null;
        await rebuildTranscript();
        return refresh();
      }

      const seg = t.closest("[data-seg]");
      if (seg) {
        selected = seg.dataset.seg;
        const index = timeline.findIndex((s) => s.uid === selected);
        const start = timeline.slice(0, index).reduce((sum, s) => sum + segDuration(s), 0);
        renderTrack(); renderInspector();
        return seekTo(start);
      }

      const move = t.closest("[data-move]")?.dataset.move;
      if (move) {
        const i = timeline.findIndex((s) => s.uid === selected);
        if (i < 0) return;
        if (move === "x") { timeline.splice(i, 1); selected = null; loaded = null; }
        else {
          const j = i + Number(move);
          if (j < 0 || j >= timeline.length) return;
          [timeline[i], timeline[j]] = [timeline[j], timeline[i]];
        }
        await rebuildTranscript();
        return refresh();
      }
    });

    body.addEventListener("input", (e) => {
      // Text first: the layer panel and the clip panel share this listener,
      // and a layer is selected the same way a segment is.
      const layer = liveLayers().find((l) => l.id === selected);
      if (layer) {
        const fps = composition().fps || 30;
        // Typing edits the layer in place. Rebuilding it per keystroke would
        // hand it a new id sixty times a sentence, and the caret with it.
        const lprop = e.target.dataset.lprop;
        if (lprop) {
          const raw = e.target.type === "range" ? Number(e.target.value) : e.target.value;
          editLayer(layer.id, { props: { [lprop]: raw === "" ? null : raw } }, e);
          renderTrack();
          // Redraw the readout beside a slider without rebuilding the panel.
          const label = e.target.closest(".field")?.querySelector("b");
          if (label && e.target.type === "range") label.textContent = String(raw);
          return;
        }
        const lset = e.target.dataset.lset;
        if (lset === "position") { editLayer(layer.id, { position: e.target.value }, e); return void renderTrack(); }
        if (lset === "palette_role") { editLayer(layer.id, { palette_role: e.target.value }, e); return void renderTrack(); }
        // A different component takes different fields, so it is re-checked.
        if (lset === "component") return void patchLayer(layer, { component: e.target.value }, e);
        const lmove = e.target.dataset.lmove;
        if (lmove === "from") {
          editLayer(layer.id, { from: Math.round(Number(e.target.value) * fps) }, e);
          return void refresh();
        }
        if (lmove === "dur") {
          editLayer(layer.id, { durationInFrames: Math.round(Number(e.target.value) * fps) }, e);
          return void refresh();
        }
      }

      const blank = e.target.dataset.blank;
      if (blank) {
        const bseg = timeline.find((x) => x.uid === selected);
        if (!bseg) return;
        if (blank === "len") bseg.out = bseg.in + Number(e.target.value);
        if (blank === "colour") bseg.colour = e.target.value;
        if (blank === "title") {
          // Rebuilding the panel on every keystroke would take the caret with
          // it, and the name only ever shows on the track.
          bseg.title = e.target.value.slice(0, 40);
          return void renderTrack();
        }
        refresh();
        return void seekTo(playhead);
      }

      // A lane item: volume, placement, trim and speed.
      const iset = e.target.dataset.itemSet;
      if (iset) {
        const found = findItem(selected);
        if (!found) return;
        const { it } = found;
        const v = Number(e.target.value);
        if (iset === "gain") it.gain = v;
        if (iset === "at") it.at = Math.max(0, v);
        if (iset === "in") it.in = Math.min(v, it.out - 0.1);
        if (iset === "out") it.out = Math.max(v, it.in + 0.1);
        if (iset === "speed") it.speed = v || 1;
        const label = e.target.closest(".field")?.querySelector("b");
        if (label) {
          label.textContent = iset === "gain" ? `${Math.round(v * 100)}%`
            : iset === "at" || iset === "in" || iset === "out" ? timecode(v) : String(v);
        }
        // syncOverlays and syncLaneAudio both read item.gain, and seekTo
        // runs them, so the change is audible on the next frame.
        renderTrack();
        return void seekTo(playhead);
      }

      // A lane item's transform.
      const itf = e.target.dataset.itemTf;
      if (itf) {
        const found = findItem(selected);
        if (!found) return;
        const { it } = found;
        const v = Number(e.target.value);
        it.transform = { ...transformOf(it), [itf]: v };
        const label = e.target.closest(".field")?.querySelector("b");
        if (label) label.textContent = itf === "rotation" ? `${Math.round(v)}°` : v.toFixed(2);
        return void paintFrame();
      }

      const snd = e.target.dataset.snd;
      if (snd) {
        const a = liveAudio().find((x) => x.id === selected);
        if (!a) return;
        const fps = composition().fps || 30;
        const v = Number(e.target.value);
        if (snd === "gain") editAudio(a.id, { gain: v }, e);
        if (snd === "from") editAudio(a.id, { from: Math.round(v * fps) }, e);
        if (snd === "dur") editAudio(a.id, { durationInFrames: Math.round(v * fps) }, e);
        const label = e.target.closest(".field")?.querySelector("b");
        if (label) label.textContent = snd === "gain" ? `${Math.round(v * 100)}%`
          : snd === "from" ? timecode(v) : `${v.toFixed(1)}s`;
        return void renderTrack();
      }

      const tf = e.target.dataset.tf;
      if (tf) {
        const tseg = timeline.find((x) => x.uid === selected);
        if (!tseg) return;
        tseg.transform = { ...transformOf(tseg), [tf]: Number(e.target.value) };
        // If this clip is animated, the slider edits the key you are parked on
        // rather than a base the animation would immediately overrule.
        if ((tseg.tkeys ?? []).length) addTransformKey(tseg);
        const label = e.target.closest(".field")?.querySelector("b");
        if (label) label.textContent = tf === "rotation"
          ? `${Math.round(Number(e.target.value))}\u00B0`
          : Number(e.target.value).toFixed(2);
        paintTransform();
        return;
      }

      const trans = e.target.dataset.trans;
      if (trans) {
        const tseg = timeline.find((x) => x.uid === selected);
        if (tseg) setTransition(tseg, e.target.value, trans, e);
        return;
      }

      const set = e.target.dataset.set;
      if (set === "gain") {
        const gseg = timeline.find((x) => x.uid === selected);
        if (!gseg) return;
        gseg.gain = Number(e.target.value);
        // The element is the spine's own audio, so this lands immediately.
        video.volume = Math.max(0, Math.min(1, gseg.gain));
        const label = e.target.closest(".field")?.querySelector("b");
        if (label) label.textContent = `${Math.round(gseg.gain * 100)}%`;
        return;
      }
      const seg = timeline.find((s) => s.uid === selected);
      if (!set || !seg) return;

      if (set === "in") seg.in = Math.min(Number(e.target.value), seg.out - 0.1);
      if (set === "out") seg.out = Math.max(Number(e.target.value), seg.in + 0.1);
      if (set === "filter") seg.filter = e.target.value;
      if (set === "speed") seg.speed = Number(e.target.value);
      // A trim or a speed change re-times every word after it. The per-clip
      // transcripts are cached, so this is a remap rather than a rebuild.
      if (set === "in" || set === "out" || set === "speed") rebuildTranscript().then(renderWords);
      refresh();
      seekTo(playhead);
    });

    body.addEventListener("click", (e) => {
      // The cross-reference at the bottom of a Clip panel. Transitions live
      // in the left panel now, beside Library and Text: this used to point
      // at a tab of its own on the right, which moved out from under it.
      const go = e.target.closest("[data-insp-go]");
      if (go) {
        libTab = "trans";
        renderLib();
        libTabs.querySelector('[data-lib="trans"]')?.focus({ preventScroll: true });
        return;
      }

      const keyBtn = e.target.closest("[data-key]");
      if (keyBtn) {
        const layer = liveLayers().find((l) => l.id === selected);
        if (!layer) return;
        if (keyBtn.dataset.key === "clear") return clearKeys(layer, e);
        addKey(layer, e);
        Desk.toast(`Key at ${timecode(playhead)}`, "good");
        return void refresh();
      }

      const lnone = e.target.closest("[data-lnone]");
      if (lnone) {
        const layer = liveLayers().find((l) => l.id === selected);
        if (layer) { editLayer(layer.id, { props: { [lnone.dataset.lnone]: "none" } }, e); refresh(); }
        return;
      }

      const drop = e.target.closest("[data-ldrop]");
      if (drop) {
        removeLayer(drop.dataset.ldrop, e);
        selected = null;
        return refresh();
      }
      // Rename opens the field; the field commits on change or on Enter.
      if (e.target.closest("[data-rename]")) {
        renaming = true;
        renderInspector();
        const field = insp.querySelector("[data-rename-input]");
        field?.focus();
        field?.select();
        return;
      }

      const itemDrop = e.target.closest("[data-item-drop]");
      if (itemDrop) {
        const found = findItem(itemDrop.dataset.itemDrop);
        if (found) {
          found.lane.items = found.lane.items.filter((x) => x.uid !== found.it.uid);
          selected = null;
          Desk.toast("Removed from the lane", "good");
          refresh();
        }
        return;
      }

      const link = e.target.closest("[data-link]");
      if (link) {
        const lseg = timeline.find((x) => x.uid === selected);
        if (lseg) (link.dataset.link === "unlink" ? unlinkAudio : relinkAudio)(lseg);
        return;
      }

      const fitBtn = e.target.closest("[data-fit]");
      if (fitBtn) {
        const fseg = timeline.find((x) => x.uid === selected);
        if (fseg) {
          fseg.fit = fitBtn.dataset.fit;
          // Filling the frame from a fit shot keeps whatever pan was chosen;
          // fitting from a filled one re-centres, because a pan chosen to
          // rescue a crop is meaningless once nothing is cropped.
          if (fseg.fit === "contain") fseg.transform = { ...transformOf(fseg), x: 0, y: 0 };
          renderInspector();
          paintTransform();
          paintFrame();
        }
        return;
      }

      const itemFit = e.target.closest("[data-item-fit]");
      if (itemFit) {
        const found = findItem(selected);
        if (found) {
          found.it.fit = itemFit.dataset.itemFit;
          if (found.it.fit === "contain") found.it.transform = { ...transformOf(found.it), x: 0, y: 0 };
          renderInspector();
          paintFrame();
        }
        return;
      }

      const itemFlip = e.target.closest("[data-item-flip]");
      if (itemFlip) {
        const found = findItem(selected);
        if (!found) return;
        const which = itemFlip.dataset.itemFlip;
        found.it.transform = { ...transformOf(found.it), [which]: !transformOf(found.it)[which] };
        renderInspector();
        return void paintFrame();
      }

      const sndDrop = e.target.closest("[data-snd-drop]");
      if (sndDrop) {
        removeAudio(sndDrop.dataset.sndDrop, e);
        selected = null;
        return void refresh();
      }

      const flip = e.target.closest("[data-tflip]");
      if (flip) {
        const fseg = timeline.find((x) => x.uid === selected);
        if (!fseg) return;
        const key = flip.dataset.tflip;
        fseg.transform = { ...transformOf(fseg), [key]: !transformOf(fseg)[key] };
        paintTransform();
        return void refresh();
      }

      const tkey = e.target.closest("[data-tkey]");
      if (tkey) {
        const kseg = timeline.find((x) => x.uid === selected);
        if (!kseg) return;
        if (tkey.dataset.tkey === "add") return addTransformKey(kseg);
        if (tkey.dataset.tkey === "clear") { kseg.tkeys = []; paintTransform(); return void refresh(); }
        kseg.transform = { ...NO_TRANSFORM };
        kseg.tkeys = [];
        paintTransform();
        return void refresh();
      }

      if (e.target.dataset.blank === "open") {
        const bseg = timeline.find((x) => x.uid === selected);
        if (bseg?.blank) return void enterScope(bseg.uid);
        return;
      }
      if (e.target.dataset.blank === "theme") {
        const bseg = timeline.find((x) => x.uid === selected);
        if (bseg) { bseg.colour = null; refresh(); seekTo(playhead); }
        return;
      }
      if (e.target.dataset.set !== "mute") return;
      const seg = timeline.find((s) => s.uid === selected);
      if (!seg) return;
      seg.muted = !seg.muted;
      refresh();
      seekTo(playhead);
    });

    /**
     * The keys an editor expects.
     *
     * Left and right step a frame, shift steps a second, and J K L is the
     * shuttle every NLE has had for thirty years. Ignored while a field has
     * focus, because S in a text box means the letter S.
     */
    /**
     * Shortcuts belong to the window, not to whatever happens to have focus.
     *
     * Clicking a block rebuilds the track, which destroys the element that was
     * clicked and hands focus back to the document, so a listener on the
     * window body never saw the keypress that followed. Listening on the
     * document and checking which window is focused is what makes Backspace
     * work right after selecting something, which is the only time anyone
     * presses it.
     */
    const editorFocused = () => body.closest(".win")?.dataset.focused === "true";

    function onShortcut(e) {
      if (!editorFocused()) return;
      if (e.target.closest?.("input, textarea, select")) return;

      /**
       * Undo and redo, before the modifier guard below.
       *
       * Everything else here is a bare key, so the guard exists to keep the
       * browser's own chords working. These two are chords by definition and
       * have to be read first. Shift+Z and Ctrl+Y are both spelled, because
       * half the editors in the world use one and half the other.
       */
      const chord = e.metaKey || e.ctrlKey;
      if (chord && !e.altKey && (e.key === "z" || e.key === "Z" || e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        const forward = e.key === "y" || e.key === "Y" || e.shiftKey;
        return void (forward ? redo(e) : undo(e));
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const frame = 1 / (composition().fps || 30);
      const step = e.shiftKey ? 1 : frame;

      switch (e.key) {
        case " ":
          e.preventDefault();
          return void (playing ? stop() : play());
        case "ArrowLeft": case "j": case "J":
          e.preventDefault();
          if (playing) stop();
          return void seekTo(playhead - step);
        case "ArrowRight": case "l": case "L":
          e.preventDefault();
          if (playing) stop();
          return void seekTo(playhead + step);
        case "k": case "K":
          e.preventDefault();
          return void stop();
        case "Home":
          e.preventDefault();
          return void seekTo(0);
        case "End":
          e.preventDefault();
          return void seekTo(total());
        case "s": case "S":
          e.preventDefault();
          return splitAtPlayhead();
        case "t": case "T":
          e.preventDefault();
          return addTextClip(e);
        case "b": case "B":
          e.preventDefault();
          addBlank({ seconds: 5 });
          return void rebuildTranscript().then(refresh);
        case "[": case "]": {
          // Shuffling a clip one place along, without aiming a drag at a seam.
          e.preventDefault();
          const i = timeline.findIndex((x) => x.uid === selected);
          if (i < 0) return;
          const to = i + (e.key === "[" ? -1 : 1);
          if (to < 0 || to >= timeline.length) return;
          [timeline[i], timeline[to]] = [timeline[to], timeline[i]];
          return void rebuildTranscript().then(() => { refresh(); seekTo(playhead); });
        }
        case "Backspace": case "Delete":
          e.preventDefault();
          return deleteSelected(e);
        default:
          break;
      }
    }

    document.addEventListener("keydown", onShortcut);

    body.addEventListener("keydown", (e) => {
      // Scoped to this tablist. The inspector's tabs are built from the same
      // `.cmp-tab` class, so an unscoped match had the arrow keys there
      // quietly switching the left rail instead.
      const onTab = e.target.closest?.(".cmp-tabs:not(.insp-tabs) .cmp-tab");
      if (!onTab) return;
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step) {
        e.preventDefault();
        const i = LIB_TAB_ORDER.indexOf(libTab);
        selectLibTab(LIB_TAB_ORDER[(i + step + LIB_TAB_ORDER.length) % LIB_TAB_ORDER.length], { focus: true });
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        selectLibTab(e.key === "Home" ? LIB_TAB_ORDER[0] : LIB_TAB_ORDER[LIB_TAB_ORDER.length - 1], { focus: true });
      }
    });

    scrub.addEventListener("input", () => {
      // Read where the drag put it before anything else touches the input.
      // `stop()` below calls `renderClock()`, which writes `scrub.value` right
      // back to wherever the playhead already was -- so reading it after stop
      // read the position this drag was leaving, not the one it landed on,
      // and the bar snapped back under your thumb on every scrub.
      const target = (Number(scrub.value) / 1000) * total();
      const wasPlaying = playing;
      stop();
      seekTo(target).then(() => wasPlaying && play());
    });

    /* drag to reorder the spine */
    let dragUid = null;
    let dragClipId = null;

    laneBox.addEventListener("dragstart", (e) => {
      const held = e.target.closest("[data-seg]");
      dragUid = held?.dataset.seg || null;
      held?.classList.add("is-dragging");
    });
    libList.addEventListener("dragstart", (e) => {
      dragClipId = e.target.closest("[data-add]")?.dataset.add || null;
      if (dragClipId) e.dataTransfer.setData("text/plain", dragClipId);
    });

    /**
     * Filing by dragging.
     *
     * The card is already draggable, for the timeline. A folder is the other
     * place it makes sense to let go of one, and the chip lights up while the
     * pointer is over it so the drop is not a guess. The row on the card does
     * the same job from the keyboard, so this is a shortcut rather than the
     * only way in.
     */
    libFolderBar.addEventListener("dragover", (e) => {
      const target = e.target.closest?.("[data-folder-drop]");
      if (!dragClipId || !target) return;
      e.preventDefault();
      libFolderBar.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
      target.classList.add("is-drop-target");
    });
    libFolderBar.addEventListener("dragleave", (e) => {
      if (!libFolderBar.contains(e.relatedTarget)) {
        libFolderBar.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
      }
    });
    libFolderBar.addEventListener("drop", async (e) => {
      const target = e.target.closest?.("[data-folder-drop]");
      if (!target) return;
      e.preventDefault();
      libFolderBar.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
      const id = dragClipId || e.dataTransfer.getData("text/plain");
      dragClipId = null;
      if (!id) return;
      const moved = await Folders.move(id, target.dataset.folderDrop);   // emits
      if (moved) Desk.toast(target.dataset.folderDrop ? `Filed in ${target.querySelector(".lib-fold-name")?.textContent || "the folder"}.` : "Unfiled.", "good");
    });
    /**
     * Where the thing you are dragging will land.
     *
     * Dropping with no feedback means the only way to find out where a clip
     * goes is to let go of it, and the only way to undo that is to drag it
     * back. The lane under the pointer lights up and a line marks the seam.
     * On the spine the marker snaps to a real seam between clips, because that
     * is the only place a clip can actually go.
     */
    let dropMark = null;

    function clearDrop() {
      laneBox.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
      laneBox.querySelectorAll(".is-dragging").forEach((el) => el.classList.remove("is-dragging"));
      dropMark?.remove();
      dropMark = null;
    }

    /** The nearest cut between two clips, for a spine drop. */
    function nearestSeam(at) {
      return seams(at).time;
    }

    /** Same search, but as a splice index into `timeline` rather than a time —
     *  seam 0 is the very start, so dropping there inserts at index 0 instead
     *  of always landing after the last clip. */
    function nearestSeamIndex(at) {
      return seams(at).index;
    }

    function seams(at) {
      const marks = [0];
      let acc = 0;
      for (const seg of timeline) { acc += segDuration(seg); marks.push(acc); }
      let index = 0;
      let best = Math.abs(marks[0] - at);
      for (let i = 1; i < marks.length; i++) {
        const d = Math.abs(marks[i] - at);
        if (d < best) { best = d; index = i; }
      }
      return { time: marks[index], index };
    }

    function showDrop(e) {
      const laneEl = e.target.closest?.("[data-lane]");
      if (!laneEl) return void clearDrop();

      laneBox.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
      laneEl.classList.add("is-drop-target");

      const bodyEl = laneEl.querySelector(".tl-lane-body");
      if (!bodyEl) return;
      if (!dropMark) {
        dropMark = document.createElement("div");
        dropMark.className = "tl-drop";
      }
      if (dropMark.parentElement !== bodyEl) bodyEl.appendChild(dropMark);

      const at = timeAtPointer(e);
      const seconds = laneEl.dataset.lane === "spine" ? nearestSeam(at) : Math.max(0, at);
      dropMark.style.left = `${pctOf(seconds)}%`;
    }

    laneBox.addEventListener("dragover", (e) => { e.preventDefault(); showDrop(e); });
    laneBox.addEventListener("dragleave", (e) => {
      // Only when the pointer has actually left the lanes, not on every
      // crossing between two children of them.
      if (!laneBox.contains(e.relatedTarget)) clearDrop();
    });
    laneBox.addEventListener("dragend", clearDrop);
    laneBox.addEventListener("drop", async (e) => {
      e.preventDefault();
      clearDrop();

      // A clip dragged out of the library lands on the lane it was dropped on,
      // at the second it was dropped at. That is the only way to put anything
      // on an overlay lane, and it is the reason the lanes are worth having.
      const laneEl = e.target.closest("[data-lane]");
      const laneId = laneEl?.dataset.lane;
      if (dragClipId && laneId && laneId !== "spine" && laneId !== "gfx") {
        const lane = laneById(laneId);
        const clip = byId.get(dragClipId) || (await Clips.all()).find((c) => c.id === dragClipId);
        if (lane && clip) {
          byId.set(clip.id, clip);
          lane.items.push({
            uid: `it-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            clipId: clip.id,
            name: clip.name,
            at: Math.max(0, timeAtPointer(e)),
            in: 0,
            out: clip.duration || 5,
            speed: 1,
            gain: 1,
          });
          dragClipId = null;
          return refresh();
        }
      }
      if (dragClipId && (laneId === "spine" || !laneId)) {
        const clipId = e.dataTransfer.getData("text/plain") || "";
        const at = laneId === "spine" ? nearestSeamIndex(timeAtPointer(e)) : timeline.length;
        dragClipId = null;
        await addClip(clipId, { at });
        await rebuildTranscript();
        return refresh();
      }
      dragClipId = null;

      const overUid = e.target.closest("[data-seg]")?.dataset.seg;
      if (!dragUid || !overUid || dragUid === overUid) return;
      const from = timeline.findIndex((s) => s.uid === dragUid);
      const to = timeline.findIndex((s) => s.uid === overUid);
      timeline.splice(to, 0, timeline.splice(from, 1)[0]);
      dragUid = null;
      rebuildTranscript().then(refresh);
    });

    /* ---------------- working the timeline with a pointer ----------------
     *
     * One handler for three gestures, because they start the same way: press
     * on a grip and you are trimming, press on the playhead or on empty track
     * and you are scrubbing, press on the body of a floating item and you are
     * moving it. Pointer capture means the gesture survives the cursor leaving
     * the element, which is most of why the old sliders felt better than the
     * timeline did.
     */
    let gesture = null;
    let wasPlaying = false;

    function beginGesture(e) {
      if (e.button !== 0) return;
      // Taken before anything moves; discarded at the end if nothing did.
      markGesture();
      // A real control inside the timeline is still a control. Swallowing its
      // pointerdown here (which the scrub branch does, to stop the drag
      // selecting text) also swallows its click.
      if (e.target.closest("button, input, select, a")) return;

      /**
       * Two presses on the same clip means open it.
       *
       * This is counted here rather than left to the browser's own `dblclick`
       * because the first press selects the clip and redraws the track, which
       * detaches the node the browser was waiting to fire the second click on.
       * The event never arrives. Comparing the clip's id across two
       * pointerdowns survives the repaint, which is the only thing that does.
       */
      const sizer = e.target.closest("[data-lane-resize]");
      if (sizer) {
        const row = sizer.closest(".tl-lane");
        gesture = {
          type: "lane-h",
          key: sizer.dataset.laneResize,
          fromY: e.clientY,
          startH: row.getBoundingClientRect().height,
        };
        tl.setPointerCapture?.(e.pointerId);
        e.preventDefault();
        return;
      }

      const clipHit = e.target.closest("[data-mclip], .tl-item--spine.tl-item--blank");
      if (clipHit && !e.target.closest("[data-grip]")) {
        const clipId = clipHit.dataset.mclip || clipHit.dataset.seg;
        const now = Date.now();
        if (clipId && lastClipClick.id === clipId && now - lastClipClick.at < 450) {
          lastClipClick = { id: null, at: 0 };
          e.preventDefault();
          return void enterScope(clipId);
        }
        lastClipClick = { id: clipId, at: now };
      }

      const grip = e.target.closest("[data-grip]");
      const floatBar = e.target.closest("[data-float]");
      const item = e.target.closest("[data-item]");
      const seg = e.target.closest("[data-seg]");
      const layer = e.target.closest("[data-layer]");
      const sound = e.target.closest("[data-sound]");
      const onHead = e.target.closest("[data-playhead]");

      if (grip) {
        gesture = {
          type: "trim", edge: grip.dataset.grip,
          segUid: grip.dataset.seg || null,
          itemUid: grip.dataset.item || null,
          laneId: grip.dataset.lane || null,
          layerId: grip.dataset.layer || null,
          soundId: grip.dataset.sound || null,
          floatId: grip.dataset.float || null,
          from: timeAtPointer(e),
        };
      } else if (onHead) {
        gesture = { type: "scrub" };
      } else if (item) {
        select(item.dataset.item);
        gesture = { type: "move", itemUid: item.dataset.item, laneId: item.dataset.lane, from: timeAtPointer(e) };
      } else if (layer) {
        select(layer.dataset.layer);
        gesture = { type: "move-layer", layerId: layer.dataset.layer, from: timeAtPointer(e) };
      } else if (sound) {
        select(sound.dataset.sound);
        gesture = { type: "move-sound", soundId: sound.dataset.sound, from: timeAtPointer(e) };
      } else if (floatBar) {
        gesture = { type: "move-float", floatId: floatBar.dataset.float, from: timeAtPointer(e) };
      } else if (seg) {
        select(seg.dataset.seg);
        // Pressing a spine clip starts a reorder. It used to select and stop,
        // so the only way to move a clip was the browser's own drag-and-drop
        // with no feedback, or two arrow buttons in the inspector.
        gesture = {
          type: "reorder",
          segUid: seg.dataset.seg,
          from: timeAtPointer(e),
          startX: e.clientX,
          moved: false,
        };
        seg.classList.add("is-dragging");
      } else {
        gesture = { type: "scrub" };
      }

      if (gesture.type === "scrub") {
        wasPlaying = playing;
        if (playing) stop();
        seekTo(timeAtPointer(e));
      }
      tl.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    }

    function moveGesture(e) {
      if (!gesture) return;

      if (gesture.type === "lane-h") {
        const h = Math.max(24, Math.min(320, gesture.startH + (e.clientY - gesture.fromY)));
        laneH.set(gesture.key, Math.round(h));
        renderTrack();
        return;
      }

      const now = timeAtPointer(e);

      if (gesture.type === "scrub") { seekTo(now); paintPlayhead(); return; }

      if (gesture.type === "trim") {
        const delta = now - gesture.from;
        gesture.from = now;
        trimBy(gesture, delta, e);
        renderTrack();
        renderInspector();
        return;
      }

      if (gesture.type === "reorder") {
        // A few pixels of slop, so a click that wobbles stays a click.
        if (!gesture.moved && Math.abs(e.clientX - gesture.startX) < 4) return;
        gesture.moved = true;
        gesture.seam = seamIndexAt(now);
        markSeam(seamAt(gesture.seam));
        return;
      }

      if (gesture.type === "move") {
        const lane = laneById(gesture.laneId);
        const it = lane?.items.find((x) => x.uid === gesture.itemUid);
        if (!it) return;
        it.at = Math.max(0, it.at + (now - gesture.from));
        gesture.from = now;
        renderTrack();
        return;
      }

      if (gesture.type === "move-sound") {
        const fps = composition().fps || 30;
        const frames = Math.round((now - gesture.from) * fps);
        if (frames === 0) return;
        gesture.from = now;
        const a = liveAudio().find((x) => x.id === gesture.soundId);
        if (a) editAudio(a.id, { from: clampToScope(a.from + frames) }, e);
        renderTrack();
        return;
      }

      if (gesture.type === "move-float") {
        // The remainder is kept, not thrown away, so a slow drag still moves.
        if (shiftFloat(gesture.floatId, now - gesture.from, e)) {
          gesture.from = now;
          renderTrack();
        }
        return;
      }

      if (gesture.type === "move-layer") {
        const fps = composition().fps || 30;
        const frames = Math.round((now - gesture.from) * fps);
        if (frames === 0) return;
        gesture.from = now;
        nudgeLayer(gesture.layerId, frames, e);
        renderTrack();
      }
    }

    function endGesture() {
      if (!gesture) { gestureSnap = null; return; }
      const was = gesture;
      gesture = null;
      settleGesture();

      if (was.type === "reorder") {
        clearDrop();
        if (was.moved && was.seam != null && moveSegTo(was.segUid, was.seam)) {
          // Reordering re-times every word after the clip that moved.
          return void rebuildTranscript().then(() => { refresh(); seekTo(playhead); });
        }
        return void refresh();
      }

      if (was.type === "scrub" && wasPlaying) { wasPlaying = false; play(); return; }
      if (was.type === "trim" && was.segUid) rebuildTranscript().then(refresh);
      else refresh();
    }

    /**
     * The seams between spine clips, in cut seconds.
     *
     * A clip can only land in one of these, so a reorder snaps to them rather
     * than to wherever the pointer happens to be. Seam `i` means "before clip
     * i", which is exactly the index a splice wants.
     */
    function seams() {
      const out = [0];
      let acc = 0;
      for (const seg of timeline) { acc += segDuration(seg); out.push(acc); }
      return out;
    }

    const seamAt = (i) => seams()[Math.max(0, Math.min(i, timeline.length))] ?? 0;

    function seamIndexAt(at) {
      const all = seams();
      let best = 0;
      all.forEach((sm, i) => { if (Math.abs(sm - at) < Math.abs(all[best] - at)) best = i; });
      return best;
    }

    /** Put the drop marker on a spine seam. */
    function markSeam(seconds) {
      const laneEl = laneBox.querySelector('[data-lane="spine"]');
      const bodyEl = laneEl?.querySelector(".tl-lane-body");
      if (!bodyEl) return;
      if (!dropMark) {
        dropMark = document.createElement("div");
        dropMark.className = "tl-drop";
      }
      if (dropMark.parentElement !== bodyEl) bodyEl.appendChild(dropMark);
      dropMark.style.left = `${pctOf(seconds)}%`;
      laneEl.classList.add("is-drop-target");
    }

    /**
     * Move a clip to a seam.
     *
     * Taking the clip out first shifts every seam after its old slot down by
     * one, which is the off-by-one that makes a drag to the right land one
     * place short. Returns whether anything actually moved.
     */
    function moveSegTo(uid, seamIndex) {
      const from = timeline.findIndex((x) => x.uid === uid);
      if (from < 0) return false;
      const [held] = timeline.splice(from, 1);
      const to = Math.max(0, Math.min(timeline.length, seamIndex > from ? seamIndex - 1 : seamIndex));
      timeline.splice(to, 0, held);
      return to !== from;
    }

    /* ---------------- unlinking sound from picture ----------------
     *
     * A1 is drawn from the spine, not stored separately, because a cut is a
     * cut: trimming the picture trims the sound with it. That is the right
     * default and the wrong law. Holding a line of dialogue over the next shot,
     * or dropping the on-camera audio while keeping the picture, both need the
     * two to come apart.
     *
     * Unlinking copies the segment's audio onto a real audio lane as an item of
     * its own and mutes the segment, so from then on the sound has its own
     * position, trim and volume. The item remembers where it came from, which
     * is what lets it be put back.
     */

    /** The detached audio for a segment, if it has been unlinked. */
    function detachedAudio(segUid) {
      for (const lane of lanes) {
        if (lane.kind !== "audio") continue;
        const it = lane.items.find((x) => x.fromSeg === segUid);
        if (it) return { lane, it };
      }
      return null;
    }

    function unlinkAudio(seg) {
      if (!seg || seg.blank || detachedAudio(seg.uid)) return;
      const b = boundsOf(seg);
      const clip = byId.get(seg.clipId);
      if (!b || !clip) return;

      const lane = lanes.filter((l) => l.kind === "audio").at(-1) || addLane("audio");
      lane.items.push({
        uid: `it-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        clipId: seg.clipId,
        name: `${clip.name} (sound)`,
        // Where it sits in the cut, and the same window of the source, so the
        // moment you unlink nothing has changed about what you hear.
        at: b.start,
        in: seg.in,
        out: seg.out,
        speed: seg.speed || 1,
        gain: seg.gain ?? 1,
        fromSeg: seg.uid,
      });
      seg.muted = true;
      Desk.toast("Sound unlinked onto its own lane", "good");
      refresh();
      seekTo(playhead);
    }

    function relinkAudio(seg) {
      const found = detachedAudio(seg?.uid);
      if (!found) return;
      found.lane.items = found.lane.items.filter((x) => x.uid !== found.it.uid);
      // Take the volume back with it: it is the one thing that may have been
      // deliberately changed while the two were apart.
      seg.gain = found.it.gain ?? seg.gain ?? 1;
      seg.muted = false;
      Desk.toast("Sound relinked to the picture", "good");
      refresh();
      seekTo(playhead);
    }

    /** Move one edge of whatever is under the grip. */
    /**
     * Move an overlay clip, and everything in it.
     *
     * A container that slides out from under its own contents is not a
     * container, it is a rectangle. Both edges of the clip and every element
     * inside move by the same seconds, which is what a precomp does anywhere
     * else and what anyone dragging one expects.
     */
    function shiftFloat(id, seconds, e) {
      const f = floats.find((x) => x.id === id);
      if (!f) return false;
      const fps = composition().fps || 30;

      /* The clip moves in whole frames, because its contents can only move in
         whole frames. Moving the container by the exact pointer delta and the
         elements by the rounded one is how a drag walks them apart: three
         pixels of rounding per pointermove, sixty times a second. Below a
         frame nothing moves at all and the caller keeps the remainder for the
         next event. */
      const frames = Math.round(seconds * fps);
      if (frames === 0) return false;
      const moved = frames / fps;
      if (f.at + moved < 0) return false;

      const before = { start: f.at, end: f.at + f.seconds };
      f.at = f.at + moved;
      for (const l of liveLayers()) {
        if (withinClip(before, l.from / fps)) editLayer(l.id, { from: Math.max(0, l.from + frames) }, e);
      }
      for (const a of liveAudio()) {
        if (withinClip(before, a.from / fps)) editAudio(a.id, { from: Math.max(0, a.from + frames) }, e);
      }
      return true;
    }

    function trimBy(g, delta, e) {
      if (g.floatId) {
        const f = floats.find((x) => x.id === g.floatId);
        if (!f) return;
        if (g.edge === "in") {
          // Dragging the head moves the clip and takes its contents with it.
          const at0 = f.at;
          const want = Math.min(delta, f.seconds - 0.5);
          if (shiftFloat(f.id, want, e)) f.seconds = Math.max(0.5, f.seconds - (f.at - at0));
        } else {
          f.seconds = Math.max(0.5, Math.min(60, f.seconds + delta));
        }
        return;
      }
      if (g.segUid) {
        const seg = timeline.find((x) => x.uid === g.segUid);
        if (!seg) return;
        const clip = byId.get(seg.clipId);
        const max = clip?.duration ?? seg.out;
        const source = delta * (seg.speed || 1);
        if (g.edge === "in") seg.in = Math.max(0, Math.min(seg.in + source, seg.out - 0.1));
        else seg.out = Math.min(max, Math.max(seg.out + source, seg.in + 0.1));
        return;
      }
      if (g.itemUid) {
        const lane = laneById(g.laneId);
        const it = lane?.items.find((x) => x.uid === g.itemUid);
        if (!it) return;
        const clip = byId.get(it.clipId);
        const max = clip?.duration ?? it.out;
        const source = delta * (it.speed || 1);
        // Trimming the head of a floating item moves it too, so the frame
        // under the cursor stays put rather than sliding away from you.
        if (g.edge === "in") {
          const next = Math.max(0, Math.min(it.in + source, it.out - 0.1));
          it.at = Math.max(0, it.at + (next - it.in) / (it.speed || 1));
          it.in = next;
        } else {
          it.out = Math.min(max, Math.max(it.out + source, it.in + 0.1));
        }
        return;
      }
      if (g.layerId) {
        const fps = composition().fps || 30;
        const frames = Math.round(delta * fps);
        if (frames !== 0) stretchLayer(g.layerId, g.edge, frames, e);
        return;
      }
      if (g.soundId) {
        const fps = composition().fps || 30;
        const frames = Math.round(delta * fps);
        if (frames === 0) return;
        const a = liveAudio().find((x) => x.id === g.soundId);
        if (!a) return;
        if (g.edge === "in") {
          const from = Math.max(0, a.from + frames);
          editAudio(a.id, { from, durationInFrames: a.durationInFrames - (from - a.from) }, e);
        } else {
          editAudio(a.id, { durationInFrames: a.durationInFrames + frames }, e);
        }
      }
    }

    tl.addEventListener("pointerdown", beginGesture);
    tl.addEventListener("pointermove", moveGesture);
    tl.addEventListener("pointerup", endGesture);
    tl.addEventListener("pointercancel", endGesture);

    /* ---------------- right-click menu ---------------- */

    let ctxMenuEl = null;

    function closeCtxMenu() {
      if (!ctxMenuEl) return;
      ctxMenuEl.remove();
      ctxMenuEl = null;
      document.removeEventListener("pointerdown", onCtxOutside, true);
      document.removeEventListener("keydown", onCtxEscape, true);
    }
    function onCtxOutside(e) {
      if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu();
    }
    function onCtxEscape(e) {
      if (e.key === "Escape") closeCtxMenu();
    }

    /** A small menu of actions for whatever was right-clicked, so split,
     *  duplicate and delete do not require hunting down a keyboard shortcut
     *  or scrolling the inspector to find the right button. */
    function openCtxMenu(x, y, actions) {
      closeCtxMenu();
      const menu = document.createElement("div");
      menu.className = "tl-ctx-menu";
      menu.setAttribute("role", "menu");
      menu.innerHTML = actions
        .map((a, i) => `<button class="tl-ctx-item" role="menuitem" data-ctx="${i}" data-danger="${!!a.danger}">${Desk.esc(a.label)}</button>`)
        .join("");
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      document.body.appendChild(menu);
      ctxMenuEl = menu;

      // Kept on screen: a menu opened near the right or bottom edge should
      // open leftward/upward instead of spilling off, same as a native one.
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth) menu.style.left = `${Math.max(4, x - r.width)}px`;
      if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(4, y - r.height)}px`;

      menu.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-ctx]");
        if (!btn) return;
        const action = actions[Number(btn.dataset.ctx)];
        closeCtxMenu();
        action?.run(e);
      });
      menu.querySelector(".tl-ctx-item")?.focus({ preventScroll: true });
      // Registered after this event finishes, or the contextmenu event
      // itself -- still bubbling -- would close the menu it just opened.
      setTimeout(() => {
        document.addEventListener("pointerdown", onCtxOutside, true);
        document.addEventListener("keydown", onCtxEscape, true);
      }, 0);
    }

    tl.addEventListener("contextmenu", (e) => {
      if (e.target.closest("[data-grip], button, input, select")) return;

      const segEl = e.target.closest("[data-seg]");
      const itemEl = !segEl && e.target.closest("[data-item]");
      const layerEl = !segEl && !itemEl && e.target.closest("[data-layer]");
      const soundEl = !segEl && !itemEl && !layerEl && e.target.closest("[data-sound]");

      let actions = null;

      if (segEl) {
        const seg = timeline.find((s) => s.uid === segEl.dataset.seg);
        if (seg) {
          select(seg.uid);
          const at = timeAtPointer(e);
          actions = [
            { label: "Split here", run: () => splitSegAt(seg, at) },
            { label: "Duplicate", run: () => duplicateSeg(seg) },
            { label: "Delete", danger: true, run: (ev) => deleteSelected(ev) },
          ];
        }
      } else if (itemEl) {
        const lane = laneById(itemEl.dataset.lane);
        const it = lane?.items.find((x) => x.uid === itemEl.dataset.item);
        if (lane && it) {
          select(it.uid);
          actions = [
            { label: "Duplicate", run: () => duplicateItem(lane, it) },
            { label: "Delete", danger: true, run: (ev) => deleteSelected(ev) },
          ];
        }
      } else if (layerEl) {
        const layer = liveLayers().find((l) => l.id === layerEl.dataset.layer);
        if (layer) {
          select(layer.id);
          actions = [{ label: "Delete", danger: true, run: (ev) => deleteSelected(ev) }];
        }
      } else if (soundEl) {
        const a = liveAudio().find((x) => x.id === soundEl.dataset.sound);
        if (a) {
          select(a.id);
          actions = [{ label: "Delete", danger: true, run: (ev) => deleteSelected(ev) }];
        }
      }

      if (!actions) return;
      e.preventDefault();
      openCtxMenu(e.clientX, e.clientY, actions);
    });

    const layerById = (id) => liveLayers().find((l) => l.id === id) || null;

    /**
     * Where an element's start is allowed to land.
     *
     * Ownership of an element is decided by nothing but its start second
     * (`holds()`, above): drag one far enough that its start crosses the clip
     * boundary and it stops belonging to the clip it was dragged out of,
     * mid-gesture, with no clip catching it on the other side. It used to
     * reappear on the main timeline as a clip of its own. Scoped into a clip,
     * a drag's start is clamped to stay inside it -- the sub-timeline that
     * opened is the only place the gesture is allowed to end up.
     */
    function clampToScope(from) {
      const c = scopeClip();
      // A "loose" scope is a synthetic grouping drawn around whatever elements
      // happen to sit near each other, not a real container: its bounds are
      // read straight off the elements inside it, the one being dragged
      // included. Clamping to that self-derived span pins the drag to
      // wherever it already is, and dragging left -- which shrinks the
      // bound at the same instant it is checked against it -- never moves at
      // all. A loose element has no clip to escape, so it gets the same free
      // range an unscoped drag does.
      if (!c || c.kind === "loose") return Math.max(0, from);
      const fps = composition().fps || 30;
      const lo = Math.round(c.start * fps);
      const hi = Math.max(lo, Math.round(c.end * fps) - 1);
      return Math.max(lo, Math.min(hi, from));
    }

    function nudgeLayer(id, frames, e) {
      const l = layerById(id);
      if (l) editLayer(id, { from: clampToScope(l.from + frames) }, e);
    }

    function stretchLayer(id, edge, frames, e) {
      const l = layerById(id);
      if (!l) return;
      if (edge === "in") {
        // Dragging the head moves the start and keeps the tail where it is.
        const from = clampToScope(l.from + frames);
        editLayer(id, { from, durationInFrames: l.durationInFrames - (from - l.from) }, e);
      } else {
        editLayer(id, { durationInFrames: l.durationInFrames + frames }, e);
      }
    }

    /**
     * A transition on a clip, by hand.
     *
     * It is an `effect` layer of kind `dip`, which is exactly what the agent
     * would propose for the same thing: the person is not getting a second,
     * lesser mechanism. Because it is a layer it draws through the one
     * renderer, so it is in the export the moment it is on the timeline, and
     * it can be dragged, retimed and deleted like anything else.
     */
    const TRANSITIONS = {
      none: null,
      dip_black: { role: "invert", label: "Dip to black" },
      dip_white: { role: "plain", label: "Dip to white" },
      flash: { role: "plain", label: "Flash", effect: "flash" },
      dip_accent: { role: "accent", label: "Dip to accent" },
    };

    /** Where a segment starts and ends in the finished cut. */
    function boundsOf(seg) {
      let at = 0;
      for (const s2 of timeline) {
        const d = segDuration(s2);
        if (s2 === seg) return { start: at, end: at + d };
        at += d;
      }
      return null;
    }

    function setTransition(seg, kind, edge, e) {
      const fps = composition().fps || 30;
      const spec = TRANSITIONS[kind];
      const bounds = boundsOf(seg);
      if (!bounds) return;

      // One transition per edge of a clip: adding another replaces it rather
      // than stacking two dips on the same cut.
      const tag = `${seg.uid}:${edge}`;
      liveLayers()
        .filter((l) => l.props?.tag === tag)
        .forEach((l) => removeLayer(l.id, e));

      if (!spec) return void refresh();

      const seconds = 0.6;
      const at = edge === "in" ? bounds.start : Math.max(0, bounds.end - seconds);
      const made = proposeLayer(
        {
          component: "effect",
          effect: spec.effect || "dip",
          strength: 1,
          tag,
          at_seconds: at,
          duration_seconds: seconds,
          palette_role: spec.role,
          origin: "human",
        },
        { cutSeconds: total() }
      );
      if (!made.ok) return void Desk.toast(made.error || "Could not add the transition.", "bad");
      acceptLayer(made.layer.id, e);
      refresh();
    }

    /** The transition already on an edge, if any. */
    /**
     * Reframing controls for a clip.
     *
     * These are the fields the transform already has, so there is nothing here
     * that the drag on the picture cannot also write and nothing the drag
     * writes that is not shown here.
     */
    function transformFields(seg) {
      const t = transformOf(seg);
      const keys = seg.tkeys ?? [];
      return `
        <p class="insp-kind mono">Transform</p>
        <div class="insp-body insp-body--tight">
          <p class="insp-hint">Drag the picture to choose what stays in frame. On <b>Fill</b> the shot is cropped to the frame; on <b>Fit</b> the whole shot is kept and the edges are padded.</p>
          <div class="insp-row">
            <button class="btn btn-mini" data-fit="cover" aria-pressed="${fitOf(seg) === "cover"}">Fill frame</button>
            <button class="btn btn-mini" data-fit="contain" aria-pressed="${fitOf(seg) === "contain"}">Fit whole clip</button>
          </div>
          <label class="field"><span>Across <b class="mono">${t.x.toFixed(2)}</b></span>
            <input type="range" data-tf="x" min="-1" max="1" step="0.01" value="${t.x}"></label>
          <label class="field"><span>Down <b class="mono">${t.y.toFixed(2)}</b></span>
            <input type="range" data-tf="y" min="-1" max="1" step="0.01" value="${t.y}"></label>
          <label class="field"><span>Scale <b class="mono">${t.scale.toFixed(2)}</b></span>
            <input type="range" data-tf="scale" min="0.2" max="4" step="0.01" value="${t.scale}"></label>
          <label class="field"><span>Rotate <b class="mono">${Math.round(t.rotation)}&deg;</b></span>
            <input type="range" data-tf="rotation" min="-180" max="180" step="1" value="${t.rotation}"></label>
          <div class="insp-row">
            <button class="btn btn-mini" data-tflip="flipH" aria-pressed="${t.flipH}">Flip across</button>
            <button class="btn btn-mini" data-tflip="flipV" aria-pressed="${t.flipV}">Flip down</button>
          </div>
          <div class="insp-row">
            <button class="btn btn-mini btn-accent" data-tkey="add">${tkeyHere(seg) ? "Update key" : "Key"}</button>
            ${keys.length ? `<button class="btn btn-mini" data-tkey="clear">Clear ${keys.length}</button>` : ""}
            <button class="btn btn-mini" data-tkey="reset">Reset</button>
          </div>
        </div>`;
    }

    /** A transform key at the playhead, if there is one. */
    function tkeyHere(seg) {
      const b = boundsOf(seg);
      if (!b) return null;
      const f = Math.max(0, Math.round((playhead - b.start) * (composition().fps || 30)));
      return (seg.tkeys ?? []).find((k) => k.f === f) || null;
    }

    function addTransformKey(seg) {
      const b = boundsOf(seg);
      if (!b) return;
      const t = transformOf(seg);
      const key = {
        f: Math.max(0, Math.round((playhead - b.start) * (composition().fps || 30))),
        x: t.x, y: t.y, width: t.scale, rotation: t.rotation,
      };
      seg.tkeys = (seg.tkeys ?? []).filter((k) => k.f !== key.f).concat(key).sort((a, c) => a.f - c.f);
      Desk.toast(`Key at ${timecode(playhead)}`, "good");
      refresh();
    }

    /**
     * A sound, when one is selected on the SFX lane.
     *
     * Deliberately short: what you want from a sound effect is louder, quieter,
     * later, gone. Everything else is the agent's to propose.
     */
    function soundPanelHtml(a) {
      const fps = composition().fps || 30;
      return `
        <p class="insp-kind mono">Sound</p>
        <div class="insp-body">
          <p class="insp-name">${Desk.esc(String(a.kind === "sfx" ? a.preset : a.name || "music bed"))}</p>
          <p class="insp-hint">${a.kind === "sfx" ? "A synthesised effect." : "A bed under the whole cut."}${a.duck ? " Ducks under speech." : ""}</p>
          <label class="field">
            <span>Volume <b class="mono">${Math.round((a.gain ?? 1) * 100)}%</b></span>
            <input type="range" data-snd="gain" min="0" max="1.5" step="0.05" value="${a.gain ?? 1}">
          </label>
          <label class="field">
            <span>Starts <b class="mono">${timecode(a.from / fps)}</b></span>
            <input type="range" data-snd="from" min="0" max="${Math.max(1, Math.round(total()))}" step="0.05" value="${(a.from / fps).toFixed(2)}">
          </label>
          <label class="field">
            <span>Lasts <b class="mono">${(a.durationInFrames / fps).toFixed(1)}s</b></span>
            <input type="range" data-snd="dur" min="0.1" max="30" step="0.1" value="${(a.durationInFrames / fps).toFixed(1)}">
          </label>
          <div class="insp-row">
            <button class="btn btn-mini" data-sound-play="${a.id}">Hear it</button>
            <button class="btn btn-mini btn-danger" data-snd-drop="${a.id}">Delete</button>
          </div>
        </div>`;
    }

    /** What the footage actually is, for the clip panel. */
    function clipStatsHtml(seg, clip) {
      const shape = clip?.width && clip?.height ? `${clip.width}&times;${clip.height}` : "unknown";
      const bytes = clip?.blob?.size;
      const mb = bytes ? `${(bytes / 1048576).toFixed(1)} MB` : "unknown";
      const used = segDuration(seg);
      return `
        <dl class="insp-stats mono">
          <div><dt>Source</dt><dd>${shape}</dd></div>
          <div><dt>Full length</dt><dd>${timecode(clip?.duration || 0)}</dd></div>
          <div><dt>Using</dt><dd>${timecode(used)}</dd></div>
          <div><dt>In / out</dt><dd>${timecode(seg.in)} &rarr; ${timecode(seg.out)}</dd></div>
          <div><dt>Speed</dt><dd>${seg.speed}&times;</dd></div>
          <div><dt>Size</dt><dd>${mb}</dd></div>
        </dl>`;
    }

    /** The two transition pickers, for whatever kind of clip is selected. */
    function transitionFields(seg) {
      const pick = (edge) => `
        <label class="field">
          <span>${edge === "in" ? "In" : "Out"}</span>
          <select data-trans="${edge}">
            ${Object.entries(TRANSITIONS).map(([k, v]) =>
              `<option value="${k}" ${k === transitionOn(seg, edge) ? "selected" : ""}>${v ? v.label : "No transition"}</option>`).join("")}
          </select>
        </label>`;
      return pick("in") + pick("out");
    }

    function transitionOn(seg, edge) {
      const tag = `${seg.uid}:${edge}`;
      const l = liveLayers().find((x) => x.props?.tag === tag);
      if (!l) return "none";
      const found = Object.entries(TRANSITIONS).find(
        ([, v]) => v && v.role === l.palette_role && (v.effect || "dip") === l.props?.effect
      );
      return found ? found[0] : "none";
    }

    /**
     * Remove whatever is selected.
     *
     * One key for four kinds of thing, because from where the person is
     * standing there is only one kind of thing: the block they clicked. The
     * keypress is a real event, so the trusted-gesture guards on the
     * composition are satisfied by it exactly as a button press would be.
     */
    function deleteSelected(e) {
      mark();
      if (!selected) return;

      // A staged cut is a suggestion like any other, and it was the one kind
      // Backspace could not reach: the chips were clickable but never
      // selectable, so there was nothing for the key to act on.
      const cut = pendingCuts().find((c) => c.id === selected);
      if (cut) {
        rejectCut(cut.id, e);
        selected = null;
        Desk.toast("Cut suggestion dismissed", "good");
        return void refresh();
      }

      const layer = liveLayers().find((l) => l.id === selected);
      if (layer) {
        removeLayer(layer.id, e);
        selected = null;
        Desk.toast("Graphic deleted", "good");
        return void refresh();
      }

      const sound = liveAudio().find((a) => a.id === selected);
      if (sound) {
        removeAudio(sound.id, e);
        selected = null;
        Desk.toast("Sound deleted", "good");
        return void refresh();
      }

      for (const lane of lanes) {
        const i = lane.items.findIndex((it) => it.uid === selected);
        if (i >= 0) {
          lane.items.splice(i, 1);
          selected = null;
          Desk.toast("Removed from the lane", "good");
          return void refresh();
        }
      }

      const seg = timeline.find((x) => x.uid === selected);
      if (seg) {
        // A clip's own transitions go with it. A dip left hanging over a cut
        // that no longer exists is worse than no transition at all.
        liveLayers()
          .filter((l) => String(l.props?.tag || "").startsWith(`${seg.uid}:`))
          .forEach((l) => removeLayer(l.id, e));
        // A motion graphics clip owns what is inside it, same as a folder
        // owns its files. Deleting the clip and leaving its elements behind
        // at the same cut seconds is how they used to come back as a stray
        // clip of their own the moment the timeline reflowed around the gap.
        if (seg.blank) {
          // By owner, not by clock: an element scrolled out of the clip's
          // window is still the clip's, and leaving it behind is how a
          // deleted clip used to come back as a stray.
          const doc = composition();
          doc.layers.filter((l) => l.owner === seg.uid).forEach((l) => removeLayer(l.id, e));
          doc.audio.filter((a) => a.owner === seg.uid).forEach((a) => removeAudio(a.id, e));
        }
        timeline = timeline.filter((x) => x.uid !== seg.uid);
        selected = null;
        Desk.toast("Clip removed", "good");
        return void rebuildTranscript().then(refresh);
      }
    }

    /**
     * Split whatever is under the playhead.
     *
     * On the spine this is two segments of one clip: the same source, cut at
     * the source second the playhead is sitting on. Nothing is re-encoded and
     * nothing moves, so the cut is exactly where you put it.
     */
    function splitAtPlayhead() {
      const at = segmentAt(playhead);
      if (!at || !at.seg) return Desk.toast("Nothing under the playhead.", "bad");
      splitSegAt(at.seg, playhead);
    }

    /** Split a spine segment at a given second, rather than only ever at the
     *  playhead -- what the right-click menu needs, since the clip a person
     *  right-clicked is not always the one already playing. */
    function splitSegAt(seg, seconds) {
      const bounds = boundsOf(seg);
      if (!bounds) return;
      const source = seg.in + (seconds - bounds.start) * (seg.speed || 1);
      if (source <= seg.in + 0.08 || source >= seg.out - 0.08) {
        return Desk.toast("Too close to the edge of the clip to split.", "bad");
      }
      mark();
      const tail = { ...seg, uid: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, in: source };
      // Two clips now, so who owns what has to be asked again. Releasing the
      // contents lets each half adopt the elements that land in it on the next
      // pass; without this everything past the cut stays owned by the head and
      // is parked out of sight the moment the halves are trimmed apart.
      if (seg.blank) disown(seg.uid);
      delete tail.anchor;
      delete seg.anchor;
      seg.out = source;
      timeline.splice(timeline.indexOf(seg) + 1, 0, tail);
      selected = tail.uid;
      Desk.toast(`Split at ${timecode(seconds)}`, "good");
      rebuildTranscript().then(refresh);
    }

    /** A copy of a spine clip, right after the original. Its own contents --
     *  the layers and sounds a motion graphics clip owns -- start empty
     *  rather than half-copied; duplicating those exactly is a bigger claim
     *  than "put another one of these here" ought to make. */
    function duplicateSeg(seg) {
      mark();
      const copy = { ...seg, uid: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
      delete copy.anchor;
      timeline.splice(timeline.indexOf(seg) + 1, 0, copy);
      selected = copy.uid;
      Desk.toast("Clip duplicated", "good");
      rebuildTranscript().then(refresh);
    }

    /** A copy of a lane item, placed right after the original so the two
     *  never start out stacked on top of each other. */
    function duplicateItem(lane, it) {
      mark();
      const copy = { ...it, uid: `it-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: itemEnd(it) };
      lane.items.push(copy);
      selected = copy.uid;
      Desk.toast("Item duplicated", "good");
      refresh();
    }

    /**
     * A text clip.
     *
     * It is a composition layer, not a new kind of object, which is what makes
     * it correct in the export the moment it exists: the same renderer draws
     * it in the preview and into the file. Created by a click, so it is
     * accepted the moment it is made: a person does not propose to themselves.
     */
    /**
     * What a person can put on the frame, and what to fill it with.
     *
     * The same list feeds the Text tab beside the library and the palette on
     * the motion page, because they are the same act: put an element on the
     * frame. Only where it lands differs.
     */
    const TEXT_KINDS = [
      // `font` is seeded to each component's own default rather than left
      // unset. The draw functions fall back to the same value either way, but
      // a font menu with nothing selected shows its first entry regardless of
      // what is actually on screen: seeding it is what keeps the menu
      // telling the truth from the moment the element lands.
      { component: "title_card", label: "Title card", props: { text: "Your title", subtext: "", font: "displayHeavy" }, position: "center" },
      { component: "lower_third", label: "Lower third", props: { text: "Their name", subtext: "What they do", font: "display" }, position: "lower_left" },
      { component: "caption_pop", label: "Caption", props: { text: "Something said", font: "display" }, position: "bottom_bar" },
      { component: "quote_card", label: "Quote", props: { text: "A line worth pulling out", font: "display" }, position: "center" },
      { component: "bullet_list", label: "Bullet list", props: { items: ["First", "Second", "Third"], font: "body" }, position: "center" },
      { component: "stat_badge", label: "Stat", props: { text: "42%", font: "displayHeavy" }, position: "upper_right" },
      { component: "text", label: "Plain text", props: { text: "Text", font: "display" }, position: "center" },
    ];

    const SHAPE_KINDS = ["rect", "ellipse", "pill", "triangle", "line", "arrow", "ring", "star"];

    /**
     * Put an element on the frame.
     *
     * Inside a clip it lands after the last thing already there rather than on
     * top of it, because stacking two elements on one second is the mistake
     * that makes a motion graphics clip look like a pile. Outside one it lands
     * at the playhead, where you are looking.
     */
    function addElement(spec, e) {
      const c = scopeClip();
      let at = playhead;
      let seconds = 2.5;

      if (c) {
        const fps = composition().fps || 30;
        const clipLen = Math.max(0.5, c.end - c.start);
        const held = [...layersIn(c), ...soundsIn(c)];
        const lastEnd = held.reduce(
          (m, x) => Math.max(m, (x.from + Math.max(1, x.durationInFrames)) / fps),
          c.start
        );
        seconds = Math.min(2.5, Math.max(0.6, clipLen / 2));
        at = Math.min(Math.max(c.start, lastEnd + 0.1), Math.max(c.start, c.end - seconds));
        seconds = Math.min(seconds, Math.max(0.3, c.end - at));
      }

      const made = proposeLayer(
        {
          component: spec.component,
          ...(spec.props || {}),
          at_seconds: at,
          duration_seconds: seconds,
          position: spec.position || "center",
          palette_role: spec.palette_role || "accent",
          origin: "human",
        },
        { cutSeconds: total() }
      );
      if (!made.ok) return void Desk.toast(made.error || "Could not add that.", "bad");
      acceptLayer(made.layer.id, e);
      selected = made.layer.id;
      inspTab = "clip";
      seekTo(Math.min(total(), at + 0.05));
      refresh();
    }

    /** The buttons themselves, shared by the Text tab and the motion palette. */
    function elementButtonsHtml({ shapes = true } = {}) {
      const text = TEXT_KINDS.map((k, i) =>
        `<button class="palette-btn" data-add-text="${i}">${k.label}</button>`).join("");
      const shape = shapes
        ? `<p class="palette-head mono">Shapes</p>
           <div class="palette-grid">${SHAPE_KINDS.map((k) =>
             `<button class="palette-btn palette-btn--shape" data-add-shape="${k}">${k}</button>`).join("")}</div>`
        : "";
      return `
        <div class="palette">
          <p class="palette-head mono">Text</p>
          <div class="palette-grid">${text}</div>
          ${shape}
          <p class="palette-hint">${scopeClip()
            ? "Lands after the last element in this clip, so nothing overlaps."
            : "Lands at the playhead. Open a motion graphics clip to build a sequence."}</p>
        </div>`;
    }

    /** The left rail, whichever tab is showing. */
    function renderLib() {
      const onMotion = Boolean(scopeClip());
      // The motion page has its own palette and no use for the footage list.
      const want = onMotion ? "motion" : libTab;
      for (const name of ["clips", "text", "trans", "words", "motion"]) {
        const el = libPane(name);
        if (el) el.hidden = name !== want;
      }
      libTabs.hidden = onMotion;
      libTabs.querySelectorAll("[data-lib]").forEach((b) => {
        const on = b.dataset.lib === libTab;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      // The Text tab is text. Shapes belong with the rest of the motion work.
      if (want === "text") libPane("text").innerHTML = elementButtonsHtml({ shapes: false });
      if (want === "trans") libPane("trans").innerHTML = transitionsPaneHtml();
      if (want === "motion") libPane("motion").innerHTML = elementButtonsHtml();
    }

    /**
     * A new element inside the clip you are in.
     *
     * It lands after the last thing already there rather than on top of it.
     * Stacking two elements on the same second is the mistake that makes a
     * motion graphics clip look like a pile, and the editor should not make it
     * easy to make by accident.
     */
    function addInScope(kind, e) {
      if (!scopeClip()) return;
      addElement(
        kind === "shape"
          ? { component: "shape", props: { shape: "pill" } }
          : { component: "title_card", props: { text: "Your text here" } },
        e
      );
    }

    function addTextClip(e) {
      const made = proposeLayer(
        {
          component: "title_card",
          text: "Your text here",
          at_seconds: playhead,
          duration_seconds: 3,
          position: "center",
          palette_role: "accent",
          origin: "human",
        },
        { cutSeconds: total() }
      );
      if (!made.ok) return Desk.toast(made.error || "Could not add the text.", "bad");
      acceptLayer(made.layer.id, e);
      selected = made.layer.id;
      Desk.toast("Text added. Edit it on the right.", "good");
      refresh();
    }

    /**
     * Change a text clip's content.
     *
     * Position, colour and wording go through validateLayer the same way a
     * proposal does, so a person cannot type a layer the renderer would refuse
     * to draw. The result is accepted immediately: they made it, so there is
     * nothing to approve.
     */
    function patchLayer(layer, patch, e) {
      const fps = composition().fps || 30;
      const checked = validateLayer(
        {
          component: patch.component ?? layer.component,
          text: patch.text ?? layer.props?.text ?? "",
          subtext: patch.subtext ?? layer.props?.subtext ?? "",
          eyebrow: layer.props?.eyebrow ?? "",
          items: layer.props?.items ?? undefined,
          at_seconds: layer.from / fps,
          duration_seconds: layer.durationInFrames / fps,
          // A component change drops the old placement rather than carrying
          // it over: a lower third has no business being centred, and the
          // component's own default is the right answer.
          position: patch.position ?? (patch.component ? undefined : layer.position),
          palette_role: patch.palette_role ?? layer.palette_role,
        },
        { cutSeconds: total(), fps }
      );
      if (!checked.ok) return void Desk.toast(checked.error || "That will not draw.", "bad");

      // Edited in place rather than staged-and-swapped. The old version made a
      // second layer and deleted the first, which is two ids for one thing and
      // leaves a stray behind the moment either half is refused.
      const done = editLayer(
        layer.id,
        {
          component: checked.layer.component,
          position: checked.layer.position,
          palette_role: checked.layer.palette_role,
          easing: checked.layer.easing,
          props: checked.layer.props,
        },
        e
      );
      if (!done.ok) return void Desk.toast(done.error || "Could not change it.", "bad");
      refresh();
    }

    function select(uid) {
      selected = uid;
      // Selecting a thing means you want to look at it, so the rail follows.
      if (inspTab !== "clip") inspTab = "clip";
      renderTrack();
      renderInspector();
      // Transitions reads the same `selected`, but it lives in the left panel
      // now and only `renderLib()` redraws it: without this, picking a
      // different clip while that tab is open left it showing the last one.
      if (libTab === "trans") renderLib();
      armFrameGrabs();
    }

    zoom.addEventListener("input", () => {
      tl.style.width = `${zoom.value}%`;
      renderTrack();
    });

    /**
     * Sound onto an audio lane.
     *
     * Audio is a clip like any other as far as the library is concerned, so it
     * goes through the same Clips.save and gets the same probing. What makes it
     * an audio item is the lane it lands on, not a different kind of record.
     */
    audioInput.addEventListener("change", async () => {
      for (const file of audioInput.files) {
        const clip = await Clips.save(file, {
          name: file.name.replace(/\.[^.]+$/, ""),
          kind: "audio",
          folder: isFolder(libFolder) ? libFolder : null,
        });
        byId.set(clip.id, clip);
        addSoundAt(clip, playhead);
      }
      audioInput.value = "";
      refresh();
    });

    /**
     * Sound into the library, rather than onto a lane.
     *
     * The only way in used to be the timeline's own "+ Audio", which makes a
     * lane, opens the picker and drops whatever you chose at the playhead. That
     * is one thing to want. The other is a shelf of sound effects you keep
     * around and reach for later, which is what a library is for, so the
     * importer beside the clips leaves the timeline alone.
     */
    libAudioInput.addEventListener("change", async () => {
      const files = [...libAudioInput.files];
      for (const file of files) {
        await Clips.save(file, {
          name: file.name.replace(/\.[^.]+$/, ""),
          kind: "audio",
          folder: isFolder(libFolder) ? libFolder : null,
        });
      }
      libAudioInput.value = "";
      if (files.length) Desk.toast(`${files.length} sound${files.length === 1 ? "" : "s"} in the library.`, "good");
    });

    fileInput.addEventListener("change", async () => {
      const mute = [];
      for (const file of fileInput.files) {
        const clip = await Clips.save(file, {
          name: file.name.replace(/\.[^.]+$/, ""),
          kind: "import",
          // Imported into whichever folder is open, because filing it
          // afterwards is the step that never happens.
          folder: isFolder(libFolder) ? libFolder : null,
        });
        if (clip.hasPicture === false) mute.push(clip.name);
      }
      fileInput.value = "";
      // Said at the moment of import, because that is when it can still be
      // acted on. Finding out later, from a black rectangle on the timeline,
      // reads as the editor being broken rather than the file being one this
      // browser cannot draw.
      if (mute.length) Desk.toast(noPictureMessage(mute), "bad");
      else Desk.toast("Imported.", "good");
    });

    /**
     * Paint the overlay.
     *
     * Runs whether or not the timeline is playing, because a proposal you
     * cannot see while paused is a proposal you cannot judge. The canvas is
     * sized in device pixels to the box the video actually occupies, so text
     * is sharp and the geometry matches the export, which is normalised the
     * same way.
     */
    let gfxFrame = 0;
    let pal = palette();
    let palAge = 0;
    let painted = false;

    function paintGraphics() {
      // The palette is a forced style read plus fourteen property lookups, and
      // it only changes when someone hits the theme toggle. Re-snapshot three
      // times a second rather than sixty.
      if (palAge++ % 20 === 0) pal = palette();

      const onBlank = segmentAt(playhead)?.seg?.blank === true;
      // Past the last clip on the spine, with a floating clip still running.
      // There is no picture down there to hold, so the canvas is the picture,
      // exactly as it is on a blank.
      const pastSpine = timeline.length > 0 && playhead >= spine() - 0.001;
      const onGround = onBlank || pastSpine;
      const anything = liveGraphics().length || liveLayers().length || composition().pendingFormat
        || hasOverlayPicture() || onGround || selectedLayer();
      if (!anything) {
        // Clear once, then stop drawing. With nothing to paint this loop was
        // burning a frame budget forever, including while minimised.
        if (painted) {
          gfxCtx.setTransform(1, 0, 0, 1, 0, 0);
          gfxCtx.clearRect(0, 0, gfx.width, gfx.height);
          painted = false;
        }
        gfxFrame = requestAnimationFrame(paintGraphics);
        return;
      }
      painted = true;

      const rect = video.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));

      if (gfx.width !== w * dpr || gfx.height !== h * dpr) {
        gfx.width = w * dpr;
        gfx.height = h * dpr;
        gfx.style.width = `${w}px`;
        gfx.style.height = `${h}px`;
      }

      gfxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gfxCtx.clearRect(0, 0, w, h);
      // A blank has no picture under the canvas, so the canvas is the picture.
      if (onGround) {
        gfxCtx.fillStyle = (onBlank ? segmentAt(playhead)?.seg?.colour : null) || pal.ink;
        gfxCtx.fillRect(0, 0, w, h);
      }
      // Pictures first, then graphics over them: the same order the export
      // uses, and the reason an overlay lane covers the spine rather than
      // hiding behind it.
      drawOverlays(gfxCtx, w, h, playhead);
      drawGraphics(gfxCtx, w, h, playhead, liveGraphics());

      // The composition, on the same canvas and from the same playhead. One
      // renderer for the preview and the export is what keeps them honest, so
      // this is the identical call the export loop makes below.
      renderComposition(gfxCtx, {
        width: w,
        height: h,
        frame: Math.round(playhead * composition().fps),
        layers: liveLayers(),
        format: composition().format,
        fps: composition().fps,
        pal,
        // Guides only while a reframe is waiting, which is the one moment the
        // safe area is a decision rather than clutter.
        guides: Boolean(composition().pendingFormat),
      });

      // On top of everything, so the box you are dragging is never behind the
      // thing it is selecting.
      paintHandles(gfxCtx, w, h);

      // Which graphics are on screen changes as the playhead moves, and so
      // does whether the canvas should be catching clicks for them.
      armFrameGrabs();

      gfxFrame = requestAnimationFrame(paintGraphics);
    }
    gfxFrame = requestAnimationFrame(paintGraphics);

    const offGraphics = onGraphics(() => { renderInspector(); followProposals(); });

    /**
     * One repaint per frame, not four per change.
     *
     * Accepting a layer used to run the inspector, the track, the frame and
     * the code generator synchronously inside the click, and accepting a batch
     * ran all four once per item. The work is the same either way; doing it on
     * the next animation frame is what lets the button answer the press
     * immediately instead of a beat later.
     */
    let repaint = 0;
    const offComposition = onComposition(() => {
      if (repaint) return;
      repaint = requestAnimationFrame(() => {
        repaint = 0;
        // Typing in the text panel changes the composition, which fires this.
        // Rebuilding the panel mid-sentence takes the caret with it, so a
        // field being typed into is left alone and repaints once it is not.
        //
        // Narrowly: only an actual text field earns that protection. The
        // first version checked `insp.contains(document.activeElement)`,
        // which also matched a Reject button sitting there focused after its
        // own click: nothing else ever nudges focus off a button, so the
        // card it belonged to stayed on screen, fully stale, until something
        // unrelated happened to move focus out of the rail. Rejecting a
        // proposal is not typing, and its card is gone from the store the
        // instant the click lands; the rail should agree just as fast.
        if (!isEditingField(document.activeElement)) renderInspector();
        followProposals();
        // The lanes are drawn from the composition, so a staged layer or sound
        // has to reach the track too, not just the list.
        renderTrack();
        paintFrame();
      });
    });
    /**
     * Commit a rename.
     *
     * A lane item carries its own label, so renaming one is local. A spine
     * clip has no name of its own: it points at a library record, so
     * renaming it renames the clip, which is what makes the library
     * navigable and is almost always what was meant.
     */
    async function commitRename(value) {
      const name = String(value ?? "").trim().slice(0, 80);
      renaming = false;
      if (!name) return void renderInspector();

      const found = findItem(selected);
      if (found) {
        found.it.name = name;
        refresh();
        return;
      }

      const seg = timeline.find((x) => x.uid === selected);
      const clip = seg && byId.get(seg.clipId);
      if (clip) {
        clip.name = name;
        byId.set(clip.id, clip);
        await Store.put("clips", clip);   // emits, so the library redraws
        Desk.toast("Renamed", "good");
        refresh();
        return;
      }
      renderInspector();
    }

    body.addEventListener("change", (e) => {
      if (e.target.matches?.("[data-folder-rename-input]")) {
        return void commitFolderRename(e.target.dataset.folderRenameInput, e.target.value);
      }
      if (e.target.matches?.("[data-lib-rename-input]")) {
        return void commitLibRename(e.target.dataset.libRenameInput, e.target.value);
      }
      if (e.target.matches?.("[data-rename-input]")) commitRename(e.target.value);
    });
    body.addEventListener("keydown", (e) => {
      if (e.target.matches?.("[data-folder-rename-input]")) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitFolderRename(e.target.dataset.folderRenameInput, e.target.value);
        }
        if (e.key === "Escape") {
          // The desktop closes the top window on Escape. Naming a folder is
          // not a reason to lose the editor, so this one stops here.
          e.stopPropagation();
          folderRenaming = null;
          renderLibrary();
        }
        return;
      }
      if (e.target.matches?.("[data-lib-rename-input]")) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitLibRename(e.target.dataset.libRenameInput, e.target.value);
        }
        if (e.key === "Escape") { libRenaming = null; renderLibrary(); }
        return;
      }
      if (!e.target.matches?.("[data-rename-input]")) return;
      if (e.key === "Enter") { e.preventDefault(); commitRename(e.target.value); }
      if (e.key === "Escape") { e.preventDefault(); renaming = false; renderInspector(); }
    });

    insp.addEventListener("focusout", () => {
      // Only once focus has actually left the panel, not while it moves
      // between two fields inside it.
      setTimeout(() => { if (!insp.contains(document.activeElement)) renderInspector(); }, 0);
    });
    const offCuts = onCuts(() => renderCuts());
    const offTranscripts = onTranscripts(() => renderWords());
    const off = Store.on("clips", renderLibrary);
    const offFolders = Store.on("libfolders", renderLibrary);

    /**
     * Redraw what was measured, when the measurement changes.
     *
     * Tick spacing, the playhead and the viewer's fit are all computed from a
     * width read at render time, and nothing was watching that width. Resizing
     * the window or dragging a pane grip therefore left the ruler labelled for
     * the old size: ticks bunched up or spread out, and the playhead sitting
     * off the second it claimed, until something else happened to re-render.
     * Coalesced into one animation frame, because a drag fires this per pixel.
     */
    let resizeFrame = 0;
    const onResized = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        ruler.innerHTML = rulerHtml();
        paintPlayhead();
        paintFrame();
      });
    };
    const sizeWatch = typeof ResizeObserver === "function" ? new ResizeObserver(onResized) : null;
    sizeWatch?.observe(field);
    sizeWatch?.observe(screen);

    win.onCleanup(() => {
      document.removeEventListener("keydown", onShortcut);
      sizeWatch?.disconnect();
      cancelAnimationFrame(resizeFrame);
      off();
      offFolders();
      offGraphics();
      offComposition();
      offCuts();
      offTranscripts();
      cancelAnimationFrame(gfxFrame);
      if (repaint) cancelAnimationFrame(repaint);
      stop();
      stopBeds();
      mixer?.dispose();
      // Close it, not just disconnect. Each window built its own context and
      // browsers cap how many may exist at once; leaking one per open/close
      // means sound stops working after about six visits, with no error.
      audioGraph?.ctx?.close?.().catch?.(() => {});
      audioGraph = null;
      retimeTranscript = async () => {};
      refresh = () => {};
      floatEnd = () => 0;
    });

    renderLibrary();
    rebuildTranscript().then(refresh);
    refresh();
    if (timeline.length) seekTo(0);

    body._editor = { play, stop, seekTo, runExport, renderLibrary, at: () => playhead };
  }

  function open(origin) {
    return Desk.openWindow({
      id: "editor",
      title: "Editor",
      help: "editor",
      meta: "timeline",
      tint: TINT,
      size: "large",
      origin,
      build
    });
  }

  async function openWith(clipId) {
    open(null);
    await addClip(clipId);
  }

  /** The live window body, when the editor is open. */
  const live = () => document.querySelector('[data-win="editor"] .win-body')?._editor ?? null;

  return {
    open, openWith, addClip, TINT, FILTERS,
    get timeline() { return timeline; },

    /**
     * State the WebMCP layer reads.
     *
     * All three exist only in this tab. The timeline is an array in this
     * closure, the selection is a uid held in a local, and the playhead is a
     * number a requestAnimationFrame loop is updating right now. No server has
     * any of it and no scraper can tell a selected segment from an unselected
     * one, which is the whole reason get_selection is worth a tool.
     */
    get selectedUid() { return selected; },
    get playhead() { return live()?.at() ?? 0; },
    get totalDuration() { return total(); },
    isOpen: () => live() !== null,
    clipFor: (clipId) => byId.get(clipId) ?? null,
    SPEEDS,

    clear() { timeline = []; lanes = []; selected = null; refresh(); },

    /** Stage a blank clip. Proposed, like everything an agent asks for: it is
     *  a dashed block on the spine until a person accepts it. */
    stageBlank({ seconds = 5, colour = null } = {}) {
      const seg = addBlank({ seconds, colour, select: false });
      seg.status = "proposed";
      refresh();
      return seg;
    },

    /** A person accepting a staged blank. Refuses without a real click. */
    takeBlank(uid, gesture) {
      if (!(gesture?.isTrusted === true || gesture?.nativeEvent?.isTrusted === true)) return false;
      const seg = timeline.find((x) => x.uid === uid);
      if (!seg || seg.status !== "proposed") return false;
      delete seg.status;
      refresh();
      return true;
    },

    dropBlank(uid, gesture) {
      if (!(gesture?.isTrusted === true || gesture?.nativeEvent?.isTrusted === true)) return false;
      timeline = timeline.filter((x) => x.uid !== uid);
      refresh();
      return true;
    },
    trimSelected(inS, outS) {
      const seg = timeline[timeline.length - 1];
      if (!seg) return;
      seg.in = Math.max(0, inS);
      seg.out = Math.max(seg.in + 0.1, outS);
      refresh();
    },
    exportNow() {
      const body = document.querySelector('[data-win="editor"] .win-body');
      return body?._editor?.runExport();
    },
    /** Repaint the timeline, inspector and clock after something outside this
     *  module has changed a segment. The Skills app applies a look this way.
     *  This replaces `setAll({})`, which was an empty patch applied to every
     *  segment for no reason other than the refresh on the end of it. */
    repaint: () => refresh()
  };
})();
