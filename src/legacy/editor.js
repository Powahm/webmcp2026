import { Store, Clips, timecode } from "./store.js";
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
   The timeline, the trims and the six looks below are untouched by all of it —
   the composition sits on top of the cut and never owns the footage. */
import { createMixer, createScheduler, speechRanges } from "../comp/audio.js";
import { generate } from "../comp/codegen.js";
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
} from "../comp/store.js";
import { applyCut, onCuts, pendingCuts, proposeCut, rejectCut, retime, settle } from "../cuts/store.js";
import { FILLERS, findDeadWeight, toCutTime } from "../transcript/transcript.js";
import { hasApiKey, onTranscripts, setApiKey, transcriptsFor } from "../transcript/store.js";
import { transcribe } from "../transcript/whisper.js";

/* ============================================================
   Editor — a timeline of trimmed clips with per-clip grading.
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
  const total = () => Math.max(spine(), overlayEnd());

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

  async function addClip(clipId, { select = true } = {}) {
    const clip = (await Clips.all()).find((c) => c.id === clipId);
    if (!clip) return null;
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
    timeline.push(seg);
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
   * something first to put underneath it. A blank is a segment like any other
   * — it takes up time on the spine, it trims, it splits — it just paints a
   * colour instead of decoding a video. Everything downstream treats it as a
   * segment, so the transcript, the export and the cut tools needed no special
   * case beyond "there is no picture to draw".
   */
  function addBlank({ seconds = 5, colour = null, select = true } = {}) {
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
      <aside class="ed-lib">
        <div class="ed-head">
          <span>Library</span>
          <button class="btn btn-mini" data-act="import">Import</button>
          <input type="file" accept="video/*" multiple hidden data-act="file">
        </div>
        <div class="ed-lib-list"></div>
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
          <span class="ed-clock mono">0:00 / 0:00</span>
          <button class="btn btn-accent" data-act="export">Export</button>
        </div>
      </section>

      <div class="ed-grip ed-grip--lib" data-grip-pane="lib" role="separator"
           aria-label="Resize the library" tabindex="0"></div>
      <div class="ed-grip ed-grip--insp" data-grip-pane="insp" role="separator"
           aria-label="Resize the inspector" tabindex="0"></div>
      <aside class="ed-insp">
        <!-- Three columns of the same right-hand rail. Clip, graphics and the
             composition were stacked in one scroll, which meant reaching the
             composition took a scroll past whatever else happened to be
             selected. -->
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
          <div class="cmp-tabs" role="tablist" aria-label="Timeline views">
            <button class="cmp-tab" role="tab" id="tab-track" aria-controls="pane-track"
                    data-tab="track" aria-selected="true" tabindex="0">Timeline</button>
            <button class="cmp-tab" role="tab" id="tab-words" aria-controls="pane-words"
                    data-tab="words" aria-selected="false" tabindex="-1">Transcript</button>
            <button class="cmp-tab" role="tab" id="tab-code" aria-controls="pane-code"
                    data-tab="code" aria-selected="false" tabindex="-1">Code</button>
          </div>
          <button class="btn btn-mini" data-act="clear">Clear</button>
        </div>
        <div class="cmp-pane" id="pane-track" role="tabpanel" aria-labelledby="tab-track" data-pane="track" tabindex="0">
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
              <div class="tl-ruler" data-seek></div>
              <div class="tl-lanes"></div>
              <div class="tl-playhead" data-playhead><span class="tl-playhead-grab"></span></div>
            </div>
          </div>
          <div class="cut-strip"></div>
        </div>
        <div class="cmp-pane" id="pane-words" role="tabpanel" aria-labelledby="tab-words" data-pane="words" tabindex="0" hidden></div>
        <div class="cmp-pane" id="pane-code" role="tabpanel" aria-labelledby="tab-code" data-pane="code" tabindex="0" hidden></div>
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
    const libList = body.querySelector(".ed-lib-list");
    const tl = body.querySelector(".tl");
    const tlScroll = body.querySelector(".tl-scroll");
    const ruler = body.querySelector(".tl-ruler");
    const laneBox = body.querySelector(".tl-lanes");
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
    const exportPane = body.querySelector(".ed-export");
    const cutStrip = body.querySelector(".cut-strip");
    const panes = {
      track: body.querySelector('[data-pane="track"]'),
      words: body.querySelector('[data-pane="words"]'),
      code: body.querySelector('[data-pane="code"]'),
    };

    let playing = false;
    let playhead = 0;
    let loaded = null;
    let raf = 0;
    let tab = "track";

    /* The cut-level transcript, rebuilt whenever the timeline changes.
       It has to be: every trim and reorder moves every word after it, and a
       stale transcript would place a caption confidently in the wrong place. */
    let transcript = null;
    let transcribing = false;

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

    async function renderLibrary() {
      const clips = await Clips.all();
      clips.forEach((c) => byId.set(c.id, c));
      libList.innerHTML = clips.length
        ? clips.map((c) => `
            <div class="lib-item">
              <button class="lib-add" draggable="true" data-add="${c.id}" title="Add to the timeline, or drag onto a lane">
                ${c.thumb ? `<img src="${c.thumb}" alt="">` : `<span class="strip-blank"></span>`}
                <span class="lib-name">${Desk.esc(c.name)}</span>
                <span class="lib-time mono">${timecode(c.duration)}</span>
              </button>
              <button class="lib-del" data-del="${c.id}" aria-label="Delete ${Desk.esc(c.name)}">×</button>
            </div>`).join("")
        : `<p class="lib-empty">No clips yet. Record one in Camera, or import a file.</p>`;
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
      insp: { prop: "--ed-insp", axis: "x", min: 150, max: 480, from: (r, e) => r.right - e.clientX },
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
     * recording. That is deliberate — one drawing path for both, the same rule
     * the composition follows, so an overlay cannot look right in the preview
     * and wrong in the file.
     */
    const overlayVideos = new Map();

    function overlayVideo(laneId) {
      let el = overlayVideos.get(laneId);
      if (!el) {
        el = document.createElement("video");
        el.playsInline = true;
        el.muted = true;              // overlay sound is a lane of its own
        el.preload = "auto";
        el.style.display = "none";
        body.appendChild(el);
        overlayVideos.set(laneId, el);
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
        const target = hit.item.in + hit.offset * (hit.item.speed || 1);
        if (Math.abs(el.currentTime - target) > 0.12) el.currentTime = target;
        if (play) el.play().catch(() => {});
        else el.pause();
      }
      if (waits.length) await Promise.all(waits);
    }

    /** Draw whatever the overlay lanes are showing, bottom lane first. */
    function drawOverlays(ctx, w, h, time) {
      for (const { lane } of overlaysAt(time)) {
        const el = overlayVideos.get(lane.id);
        if (!el || el.readyState < 2) continue;
        try {
          const fit = fitVideo(el.videoWidth || w, el.videoHeight || h, w, h);
          ctx.drawImage(el, fit.x, fit.y, fit.w, fit.h);
        } catch { /* frame not ready */ }
      }
    }

    /** True when anything but the spine wants painting. */
    const hasOverlayPicture = () => lanes.some((l) => l.kind === "video" && l.items.length);

    /* ---------------- motion graphics clips ----------------
     *
     * A motion graphics clip is a span of the cut with elements inside it, and
     * that is the whole model. The composition still holds one flat list of
     * layers positioned in cut frames, so the file the Code tab generates, the
     * export and every tool the agent calls keep working exactly as they did.
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
     * play. A floating one does not — it sits above the pictures for a stretch
     * of the cut, which is the only way to build a title sequence over someone
     * talking. It needs no compositing work because the graphics canvas already
     * draws over the frame; what it adds is a container to hold and name them,
     * so a person can open one and work in it.
     */
    let floats = [];
    let floatNo = 0;

    function addFloatingClip({ at = 0, seconds = 5, title = "Overlay" } = {}) {
      const clip = {
        id: `mcf-${Date.now().toString(36)}-${(floatNo++).toString(36)}`,
        title,
        at: Math.max(0, at),
        seconds: Math.max(0.5, Math.min(60, seconds)),
      };
      floats = [...floats, clip];
      return clip;
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
     * twice — two clips both claiming six elements, and deleting one from
     * inside either leaves it in the other. The overlay wins because it sits
     * above the picture, which is the same order the frame is painted in.
     */
    function ownerOf(seconds) {
      const ex = explicitClips();
      return ex.find((c) => c.kind === "float" && withinClip(c, seconds))
        || ex.find((c) => c.kind === "spine" && withinClip(c, seconds))
        || null;
    }

    const holds = (c, seconds) =>
      c.kind === "loose" ? withinClip(c, seconds) : ownerOf(seconds)?.id === c.id;

    function layersIn(c) {
      const fps = composition().fps || 30;
      return liveLayers()
        .filter((l) => holds(c, l.from / fps))
        .sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
    }

    function soundsIn(c) {
      const fps = composition().fps || 30;
      return liveAudio()
        .filter((a) => holds(c, a.from / fps))
        .sort((a, b) => a.from - b.from);
    }

    /**
     * Which clip the timeline is inside, or null for the whole cut.
     *
     * Held as an id rather than the object, because the clips are derived on
     * every read and holding one would go stale the moment an element moved.
     */
    let scope = null;
    const scopeClip = () => (scope ? motionClips().find((c) => c.id === scope) || null : null);

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

    function enterScope(id) {
      scope = id;
      selected = selected ?? null;
      renderTrack();
      renderInspector();
    }

    function leaveScope() {
      scope = null;
      renderTrack();
      renderInspector();
    }

    /* ---------------- the timeline ---------------- */

    /**
     * Seconds to a percentage of the track, and back.
     *
     * Everything on the timeline is positioned in one timebase — the finished
     * cut — so a lane, a ruler tick and the playhead cannot disagree about
     * where two seconds is. Zoom widens the track and the scroller takes the
     * overflow; nothing recomputes, because a percentage of a wider box is
     * still the same second.
     */
    /* Inside a motion graphics clip the track is that clip and nothing else:
       it starts where the clip starts and it is as long as the clip is. Every
       position stays a cut-second underneath, so a drag writes the same field
       it always wrote and the agent's numbers never have to be translated. */
    const spanStart = () => scopeClip()?.start ?? 0;
    const span = () => {
      const c = scopeClip();
      return c ? Math.max(c.end - c.start, 0.5) : Math.max(total(), 1);
    };
    /** A moment, as a percentage across the track. */
    const pctOf = (seconds) => ((seconds - spanStart()) / span()) * 100;
    /** A duration, as a percentage of the track's width. */
    const pctLen = (seconds) => (seconds / span()) * 100;

    /** Where a pointer landed, in cut seconds. */
    function timeAtPointer(e) {
      const r = tl.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
      return spanStart() + (x / r.width) * span();
    }

    /** Ruler ticks at a spacing that stays readable at any zoom. */
    function rulerHtml() {
      const width = tl.getBoundingClientRect().width || 900;
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

    /** The spine's own sound, as its own row. Linked, not separate. */
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
            <span class="tl-item-time mono">${seg.muted ? "muted" : "sound"}</span>
          </div>`;
      }).join("");
    }

    /**
     * A1: the spine's own sound, on its own row.
     *
     * Drawn from the same segments as V1 rather than kept as a second list of
     * them, because a cut is a cut — trimming the picture trims the sound, and
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
               style="left:${pctOf(start)}%; width:${pctOf(dur)}%"
               role="button" tabindex="0" aria-pressed="${seg.uid === selected}"
               aria-label="${Desk.esc(clip?.name || "audio")}, ${seg.muted ? "muted" : "sound on"}">
            <span class="tl-item-name">${Desk.esc(clip?.name || "audio")}</span>
            <span class="tl-item-time mono">${seg.muted ? "muted" : "sound"}</span>
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
     * neither label can be read. Packing them into sub-rows — the first row
     * that is free at that moment — is what every editor does, and it costs
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
        return `<i style="left:${Math.max(0, Math.min(99, left)).toFixed(2)}%;
                          width:${Math.min(100 - left, width).toFixed(2)}%;
                          top:${(i % 5) * 3}px"></i>`;
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
    function motionLaneHtml() {
      const clips = motionClips().filter((c) => c.kind === "loose" || c.kind === "float");
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

      rows.push(`<div class="tl-crumb">
        <button class="btn btn-mini" data-act="scope-out">← Timeline</button>
        <b>${Desk.esc(c.title)}</b>
        <span class="tl-crumb-meta mono">${timecode(Math.max(0, c.end - c.start))} · ${els.length} element${els.length === 1 ? "" : "s"}</span>
        <span class="tl-crumb-acts">
          <button class="btn btn-mini" data-act="scope-text">+ Text</button>
          <button class="btn btn-mini" data-act="scope-shape">+ Shape</button>
        </span>
      </div>`);

      if (!els.length && !sounds.length) {
        rows.push(`<div class="tl-lane"><div class="tl-lane-body">
          <p class="track-empty">Nothing in this clip yet. Add text or a shape, or ask the agent for one.</p>
        </div></div>`);
      }

      els.forEach((l, i) => {
        const start = l.from / fps;
        const len = Math.max(0.2, l.durationInFrames / fps);
        rows.push(`<div class="tl-lane tl-lane--el" data-lane="el-${l.id}">
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
      const held = (a) => clips.some((c) => holds(c, a.from / fps));
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
      return `translate(${(t.x * 100).toFixed(3)}%, ${(t.y * 100).toFixed(3)}%) rotate(${t.rotation}deg) scale(${sx}, ${sy})`;
    }

    /** Point the export's canvas at the same place. Caller restores. */
    function applyTransform(ctx, t, w, h) {
      ctx.translate(w / 2 + t.x * w, h / 2 + t.y * h);
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
     * quietly turned every unset field into zero — which for opacity meant a
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
      const at = segmentAt(playhead);
      if (!at || !at.seg || at.seg.blank) return;
      reframing = { seg: at.seg, x: e.clientX, y: e.clientY, rect: frameBox.getBoundingClientRect() };
      selected = at.seg.uid;
      frameBox.setPointerCapture?.(e.pointerId);
      frameBox.dataset.dragging = "true";
      e.preventDefault();
    });

    frameBox.addEventListener("pointermove", (e) => {
      if (!reframing) return;
      const t = transformOf(reframing.seg);
      reframing.seg.transform = {
        ...t,
        x: Math.max(-1, Math.min(1, t.x + (e.clientX - reframing.x) / reframing.rect.width)),
        y: Math.max(-1, Math.min(1, t.y + (e.clientY - reframing.y) / reframing.rect.height)),
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

    /** Only intercept clicks when there is something on the picture to grab. */
    function armFrameGrabs() {
      const layer = selectedLayer();
      gfx.style.pointerEvents = layer && MOVABLE.has(layer.component) ? "auto" : "none";
      gfx.style.cursor = layer && MOVABLE.has(layer.component) ? "move" : "";
    }

    gfx.addEventListener("pointerdown", (e) => {
      const layer = selectedLayer();
      if (!layer || !MOVABLE.has(layer.component)) return;
      const r = gfx.getBoundingClientRect();
      const b = layerBox(layer, r.width, r.height);
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;

      const nearCorner = Math.abs(x - (b.x + b.w)) < 12 && Math.abs(y - (b.y + b.h)) < 12;
      const inside = x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 6 && y <= b.y + b.h + 6;
      if (!inside && !nearCorner) return;

      onFrame = { id: layer.id, mode: nearCorner ? "size" : "move", x, y, rect: r };
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
        paintPlayhead();
        paintFrame();
        return;
      }

      const rows = [];
      // Video lanes read top-down like every editor: the newest overlay on
      // top, the spine at the bottom, motion graphics above the pictures.
      const motion = motionLaneHtml();
      if (motion) {
        rows.push(`<div class="tl-lane tl-lane--motion" data-lane="motion">
          <span class="tl-lane-name mono">M1</span>
          <div class="tl-lane-body">${motion}</div>
        </div>`);
      }

      for (const lane of lanes.filter((l) => l.kind === "video").slice().reverse()) {
        rows.push(`<div class="tl-lane" data-lane="${lane.id}">
          <span class="tl-lane-name mono">${lane.name}</span>
          <button class="tl-lane-x" data-drop-lane="${lane.id}" aria-label="Remove lane ${lane.name}">×</button>
          <div class="tl-lane-body">${lane.items.map((it) => laneItemHtml(lane, it)).join("")}</div>
        </div>`);
      }

      rows.push(`<div class="tl-lane tl-lane--spine" data-lane="spine">
        <span class="tl-lane-name mono">V1</span>
        <div class="tl-lane-body">${
          timeline.length ? spineHtml() : `<p class="track-empty">Drag a clip here, or add one from the library.</p>`
        }</div>
      </div>`);

      // Audio tracks are numbered the way an editor numbers them, in the order
      // they appear, rather than named after what happens to be on them.
      let audioNo = 0;
      const audioName = () => `A${++audioNo}`;

      if (timeline.some((sg) => !sg.blank)) {
        rows.push(`<div class="tl-lane tl-lane--a1" data-lane="a1">
          <span class="tl-lane-name mono">${audioName()}</span>
          <div class="tl-lane-body">${a1Html()}</div>
        </div>`);
      }

      const sfxLane = sfxLaneHtml();
      if (sfxLane.html) {
        rows.push(`<div class="tl-lane tl-lane--sfx" data-lane="sfx" style="--rows:${sfxLane.rows}">
          <span class="tl-lane-name mono">${audioName()}</span>
          <div class="tl-lane-body">${sfxLane.html}</div>
        </div>`);
      }

      for (const lane of lanes.filter((l) => l.kind === "audio")) {
        const name = audioName();
        rows.push(`<div class="tl-lane tl-lane--audio" data-lane="${lane.id}">
          <span class="tl-lane-name mono">${name}</span>
          <button class="tl-lane-x" data-drop-lane="${lane.id}" aria-label="Remove audio track ${name}">×</button>
          <div class="tl-lane-body">${lane.items.map((it) => laneItemHtml(lane, it)).join("")}</div>
        </div>`);
      }

      laneBox.innerHTML = rows.join("");
      ruler.innerHTML = rulerHtml();
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
          <p class="gfx-text">${Desk.esc(g.text || g.subtext || "—")}</p>
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
             <p><b>${formatOf(doc.pendingFormat.format).label}</b> proposed — decide it above the picture.</p>
             ${doc.pendingFormat.reason ? `<p class="cmp-reframe-why">${Desk.esc(doc.pendingFormat.reason)}</p>` : ""}
           </div>`
        : "";

      const layerCard = (l) => {
        const label = l.component.replace(/_/g, " ");
        const words = l.props?.text || l.props?.items?.[0] || l.props?.subtext || "—";
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
          ? `${a.preset} — ${SFX_PRESETS[a.preset]?.blurb ?? ""}`
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
              ${a.status === "proposed"
                ? `<button class="btn btn-mini btn-accent" data-sound-accept="${a.id}">Accept</button>
                   <button class="btn btn-mini btn-danger" data-sound-reject="${a.id}">Reject</button>`
                : `<button class="btn btn-mini" data-sound-play="${a.id}">Play</button>
                   <button class="btn btn-mini btn-danger" data-sound-remove="${a.id}">Remove</button>`}
            </div>
          </li>`;
      };

      const byPending = (a, b) =>
        (a.status === "proposed" ? 0 : 1) - (b.status === "proposed" ? 0 : 1) || a.from - b.from;

      return `
        <div class="ed-head">
          <span>Composition</span>
          ${pending ? `<span class="gfx-count">${pending} to judge</span>` : ""}
        </div>
        <div class="cmp-formats">${formats}</div>
        ${reframe}
        ${layers.length
          ? `<ul class="cmp-list">${[...layers].sort(byPending).map(layerCard).join("")}</ul>`
          : `<p class="cmp-empty">Nothing waiting on you. Accepted work is on the timeline — open a motion graphics clip to change or remove an element.</p>`}
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
          const now = Number.isFinite(Number(value)) ? Number(value) : lo;
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
    function clipPaneHtml() {
      const layer = liveLayers().find((l) => l.id === selected);
      if (layer) return layerPanelHtml(layer);

      const sound = liveAudio().find((a) => a.id === selected);
      if (sound) return soundPanelHtml(sound);

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
            ${transitionFields(seg)}
            ${transformFields(seg)}
          </div>`;
      }

      const clip = byId.get(seg.clipId);
      const max = clip?.duration || seg.out;
      return `
        <div class="insp-body">
          <p class="insp-name">${Desk.esc(clip?.name || "Missing clip")}</p>
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

          <button class="btn btn-ghost btn-wide" data-set="mute" aria-pressed="${seg.muted}">${seg.muted ? "Muted" : "Sound on"}</button>

          ${transitionFields(seg)}
          ${transformFields(seg)}

          <div class="insp-row">
            <button class="btn btn-mini" data-move="-1" aria-label="Move earlier">←</button>
            <button class="btn btn-mini" data-move="1" aria-label="Move later">→</button>
            <button class="btn btn-mini btn-danger" data-move="x" aria-label="Remove from timeline">Remove</button>
          </div>
        </div>`;
    }

    function renderInspector() {
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
            <span class="cut-chip" data-cut="${c.id}">
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
      if (tab !== "words" || !transcript?.words?.length) return;
      const i = transcript.words.findIndex((w) => playhead >= w.start && playhead < w.end);
      if (i === nowWord) return;
      nowWord = i;
      // Two class writes, not one per word. A five-minute take is a thousand
      // buttons and this runs every time the spoken word advances.
      if (!wordEls) wordEls = [...panes.words.querySelectorAll(".trx-word")];
      nowEl?.classList.remove("now");
      nowEl = wordEls[i] ?? null;
      nowEl?.classList.add("now");
    }

    function renderWords() {
      if (tab !== "words") return;
      // Anything half-typed into the key field survives a re-render. The pane
      // rebuilds on every transcript change and losing the key mid-paste is
      // the kind of thing that makes a feature feel broken.
      const typed = panes.words.querySelector('[data-act="key"]')?.value ?? "";
      nowWord = -1;
      nowEl = null;
      wordEls = null;

      if (!transcript?.words?.length) {
        panes.words.innerHTML = `
          <div class="trx">
            <p class="cmp-empty">${
              !timeline.length
                ? "Nothing on the timeline yet. Add a clip, and if it was recorded with the teleprompter its transcript is already waiting."
                : "These clips were not recorded against a script, so there are no prompter timings to derive. Load a script into the Camera before recording and the transcript comes for free — or paste an OpenAI key below to transcribe with Whisper."
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

      panes.words.innerHTML = `
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
        const field = panes.words.querySelector('[data-act="key"]');
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

    /** The composition, printed as the TSX it compiles to. */
    function renderCode() {
      if (tab !== "code") return;
      const code = generate(composition(), { cutSeconds: total() });
      panes.code.innerHTML = `
        <div class="tsx-view">
          <div class="tsx-bar">
            <span>Cut.tsx · generated from the composition · ${composition().fps}fps</span>
            <button class="btn btn-mini" data-act="copy-code">Copy</button>
          </div>
          <pre class="tsx-code"><code>${Desk.esc(code)}</code></pre>
        </div>`;
    }

    const TAB_ORDER = ["track", "words", "code"];

    function showTab(next, { focus = false } = {}) {
      tab = next;
      for (const [name, pane] of Object.entries(panes)) pane.hidden = name !== next;
      // Roving tabindex: one stop in the tab order for the whole strip, and
      // the arrow keys move between the tabs. A tablist that does not do this
      // announces itself as one and then behaves like three buttons.
      body.querySelectorAll(".cmp-tab").forEach((t) => {
        const on = t.dataset.tab === next;
        t.setAttribute("aria-selected", String(on));
        t.setAttribute("tabindex", on ? "0" : "-1");
        if (on && focus) t.focus();
      });
      renderWords();
      renderCode();
    }

    refresh = () => {
      renderTrack();
      renderInspector();
      renderClock();
      renderCuts();
      renderCode();
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
        screen.style.filter = "";
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
      screen.style.filter = FILTERS[at.seg.filter] || "";
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

      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
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

          if (at.seg.blank) {
            ctx.filter = "none";
            ctx.fillStyle = at.seg.colour || exportPal.ink;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          } else {
          ctx.filter = FILTERS[at.seg.filter] || "none";
          try {
            // Cover, not stretch. A 16:9 take in a 9:16 frame with bars down
            // both sides is not a vertical video, it is a landscape video
            // someone gave up on — and stretching every clip to the canvas
            // distorted any footage that was not the first clip's shape.
            const fit = fitVideo(
              video.videoWidth || first?.width || canvas.width,
              video.videoHeight || first?.height || canvas.height,
              canvas.width,
              canvas.height
            );
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // The clip's own reframe, from the same numbers the preview uses.
            const t = transformAt(at.seg, playhead);
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

          if (at.seg.blank) {
            // Real time, like everything else here: the recorder is capturing
            // a live canvas, so a blank has to take up its real duration.
            playhead += 1 / 30;
          } else {
            const local = Math.max(0, (video.currentTime - at.seg.in) / at.seg.speed);
            playhead = at.start + local;
          }
          fill.style.width = `${Math.min(100, (playhead / duration) * 100)}%`;
          title.textContent = `Exporting… ${timecode(playhead)} of ${timecode(duration)}`;

          const done = at.seg.blank
            ? playhead >= at.start + segDuration(at.seg) - 0.02
            : video.currentTime >= at.seg.out - 0.03 || video.ended;
          if (done) {
            const next = timeline[timeline.indexOf(at.seg) + 1];
            if (!next) return resolve();
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

        // A bed has a window, and it is the window the inspector shows and the
        // Code tab prints. Honour it: start when the playhead reaches it, stop
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

      const result = applyCut(timeline, cut);
      timeline = result.timeline;
      if (!timeline.some((s) => s.uid === selected)) selected = null;
      loaded = null;

      // Everything downstream of a removal has just moved. The cuts still
      // waiting are absolute ranges in the edit and the layers are absolute
      // frames of it, so both have to slide back by what went — otherwise
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
      a.download = `${clip.name.replace(/\s+/g, "-").toLowerCase()}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }

    /* ---- events ---- */

    body.addEventListener("click", async (e) => {
      const t = e.target;
      const act = t.closest("[data-act]")?.dataset.act;

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

      const tabBtn = t.closest("[data-tab]");
      if (tabBtn) return showTab(tabBtn.dataset.tab);

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
      if (noCut) return void rejectCut(noCut.dataset.cutReject, e);

      const cutChip = t.closest("[data-cut]");
      if (cutChip) {
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
      if (act === "copy-code") {
        navigator.clipboard?.writeText(generate(composition(), { cutSeconds: total() }))
          .then(() => Desk.toast("Composition copied as TSX.", "good"))
          .catch(() => Desk.toast("Could not reach the clipboard.", "bad"));
        return;
      }

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
          return void Desk.toast("Add a clip first — an overlay goes over footage.", "bad");
        }
        const room = Math.max(1, total() - playhead);
        const made = addFloatingClip({ at: playhead, seconds: Math.min(5, room) });
        Desk.toast("Overlay added over the cut. Open it to build inside it.", "good");
        refresh();
        return void enterScope(made.id);
      }
      if (act === "scope-out") return void leaveScope();
      if (act === "scope-text") return void addInScope("text", e);
      if (act === "scope-shape") return void addInScope("shape", e);
      if (act === "add-lane") { addLane("video"); Desk.toast("Video lane added. Drag a clip onto it.", "good"); return refresh(); }
      if (act === "add-audio") { addLane("audio"); audioInput.click(); return refresh(); }
      if (act === "export") return runExport();
      if (act === "cancel-export") { cancelled = true; return; }
      if (act === "clear") {
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

      const add = t.closest("[data-add]");
      if (add) {
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

    insp.addEventListener("input", (e) => {
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

    insp.addEventListener("click", (e) => {
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
     * clicked and hands focus back to the document — so a listener on the
     * window body never saw the keypress that followed. Listening on the
     * document and checking which window is focused is what makes Backspace
     * work right after selecting something, which is the only time anyone
     * presses it.
     */
    const editorFocused = () => body.closest(".win")?.dataset.focused === "true";

    function onShortcut(e) {
      if (!editorFocused()) return;
      if (e.target.closest?.("input, textarea, select")) return;
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
        case "Backspace": case "Delete":
          e.preventDefault();
          return deleteSelected(e);
        default:
          break;
      }
    }

    document.addEventListener("keydown", onShortcut);

    body.addEventListener("keydown", (e) => {
      const onTab = e.target.closest?.(".cmp-tab");
      if (!onTab) return;
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (step) {
        e.preventDefault();
        const i = TAB_ORDER.indexOf(tab);
        showTab(TAB_ORDER[(i + step + TAB_ORDER.length) % TAB_ORDER.length], { focus: true });
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        showTab(e.key === "Home" ? TAB_ORDER[0] : TAB_ORDER[TAB_ORDER.length - 1], { focus: true });
      }
    });

    scrub.addEventListener("input", () => {
      const wasPlaying = playing;
      stop();
      seekTo((Number(scrub.value) / 1000) * total()).then(() => wasPlaying && play());
    });

    /* drag to reorder the spine */
    let dragUid = null;
    let dragClipId = null;

    laneBox.addEventListener("dragstart", (e) => {
      dragUid = e.target.closest("[data-seg]")?.dataset.seg || null;
    });
    libList.addEventListener("dragstart", (e) => {
      dragClipId = e.target.closest("[data-add]")?.dataset.add || null;
      if (dragClipId) e.dataTransfer.setData("text/plain", dragClipId);
    });
    laneBox.addEventListener("dragover", (e) => e.preventDefault());
    laneBox.addEventListener("drop", async (e) => {
      e.preventDefault();

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
        dragClipId = null;
        await addClip(e.dataTransfer.getData("text/plain") || "");
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
      // A real control inside the timeline is still a control. Swallowing its
      // pointerdown here — which the scrub branch does, to stop the drag
      // selecting text — also swallows its click.
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
        return;
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
        if (a) editAudio(a.id, { from: a.from + frames }, e);
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
      if (!gesture) return;
      const was = gesture;
      gesture = null;
      if (was.type === "scrub" && wasPlaying) { wasPlaying = false; play(); return; }
      if (was.type === "trim" && was.segUid) rebuildTranscript().then(refresh);
      else refresh();
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

    const layerById = (id) => liveLayers().find((l) => l.id === id) || null;

    function nudgeLayer(id, frames, e) {
      const l = layerById(id);
      if (l) editLayer(id, { from: l.from + frames }, e);
    }

    function stretchLayer(id, edge, frames, e) {
      const l = layerById(id);
      if (!l) return;
      if (edge === "in") {
        // Dragging the head moves the start and keeps the tail where it is.
        const from = Math.max(0, l.from + frames);
        editLayer(id, { from, durationInFrames: l.durationInFrames - (from - l.from) }, e);
      } else {
        editLayer(id, { durationInFrames: l.durationInFrames + frames }, e);
      }
    }

    /**
     * A transition on a clip, by hand.
     *
     * It is an `effect` layer of kind `dip`, which is exactly what the agent
     * would propose for the same thing — the person is not getting a second,
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
          <p class="insp-hint">Drag the picture to move it in the frame. Handy after a reframe, when the shot is no longer centred on what matters.</p>
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
      const mb = bytes ? `${(bytes / 1048576).toFixed(1)} MB` : "—";
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
      if (!selected) return;

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
      const seg = at.seg;
      const source = seg.in + at.offset * (seg.speed || 1);
      if (source <= seg.in + 0.08 || source >= seg.out - 0.08) {
        return Desk.toast("Too close to the edge of the clip to split.", "bad");
      }
      const tail = { ...seg, uid: `seg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, in: source };
      seg.out = source;
      timeline.splice(timeline.indexOf(seg) + 1, 0, tail);
      selected = tail.uid;
      Desk.toast(`Split at ${timecode(playhead)}`, "good");
      rebuildTranscript().then(refresh);
    }

    /**
     * A text clip.
     *
     * It is a composition layer, not a new kind of object, which is what makes
     * it correct in the export the moment it exists: the same renderer draws
     * it in the preview and into the file. Created by a click, so it is
     * accepted the moment it is made — a person does not propose to themselves.
     */
    /**
     * A new element inside the clip you are in.
     *
     * It lands after the last thing already there rather than on top of it.
     * Stacking two elements on the same second is the mistake that makes a
     * motion graphics clip look like a pile, and the editor should not make it
     * easy to make by accident.
     */
    function addInScope(kind, e) {
      const c = scopeClip();
      if (!c) return;
      const fps = composition().fps || 30;
      const clipLen = Math.max(0.5, c.end - c.start);
      const held = [...layersIn(c), ...soundsIn(c)];
      const lastEnd = held.reduce(
        (m, x) => Math.max(m, (x.from + Math.max(1, x.durationInFrames)) / fps),
        c.start
      );
      const seconds = Math.min(2.5, Math.max(0.6, clipLen / 2));
      const at = Math.min(Math.max(c.start, lastEnd + 0.1), Math.max(c.start, c.end - seconds));

      const spec = kind === "shape"
        ? { component: "shape", shape: "pill", palette_role: "accent" }
        : { component: "title_card", text: "Your text here", palette_role: "accent" };

      const made = proposeLayer(
        {
          ...spec,
          at_seconds: at,
          duration_seconds: Math.min(seconds, Math.max(0.3, c.end - at)),
          position: "center",
          origin: "human",
        },
        { cutSeconds: total() }
      );
      if (!made.ok) return void Desk.toast(made.error || "Could not add that.", "bad");
      acceptLayer(made.layer.id, e);
      selected = made.layer.id;
      seekTo(Math.min(total(), at + 0.05));
      refresh();
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
      inspTab = "clip";
      renderTrack();
      renderInspector();
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
      const lane = lanes.filter((l) => l.kind === "audio").at(-1) || addLane("audio");
      for (const file of audioInput.files) {
        const clip = await Clips.save(file, { name: file.name.replace(/\.[^.]+$/, ""), kind: "audio" });
        byId.set(clip.id, clip);
        lane.items.push({
          uid: `au-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          clipId: clip.id,
          name: clip.name,
          at: playhead,
          in: 0,
          out: clip.duration || 10,
          speed: 1,
          gain: 1,
        });
      }
      audioInput.value = "";
      refresh();
    });

    fileInput.addEventListener("change", async () => {
      for (const file of fileInput.files) {
        await Clips.save(file, { name: file.name.replace(/\.[^.]+$/, ""), kind: "import" });
      }
      fileInput.value = "";
      Desk.toast("Imported.", "good");
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
      const anything = liveGraphics().length || liveLayers().length || composition().pendingFormat
        || hasOverlayPicture() || onBlank || selectedLayer();
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
      if (onBlank) {
        gfxCtx.fillStyle = segmentAt(playhead).seg.colour || pal.ink;
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
        // Rebuilding the panel mid-sentence takes the caret with it, so the
        // panel holding focus is left alone and repaints when focus leaves.
        if (!insp.contains(document.activeElement)) renderInspector();
        followProposals();
        // The lanes are drawn from the composition, so a staged layer or sound
        // has to reach the track too, not just the list.
        renderTrack();
        paintFrame();
        renderCode();
      });
    });
    insp.addEventListener("focusout", () => {
      // Only once focus has actually left the panel, not while it moves
      // between two fields inside it.
      setTimeout(() => { if (!insp.contains(document.activeElement)) renderInspector(); }, 0);
    });
    const offCuts = onCuts(() => renderCuts());
    const offTranscripts = onTranscripts(() => renderWords());
    const off = Store.on("clips", renderLibrary);

    win.onCleanup(() => {
      document.removeEventListener("keydown", onShortcut);
      off();
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
      meta: "timeline",
      tint: TINT,
      size: { w: 1080, h: 760 },
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
