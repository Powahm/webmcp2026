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
import { SFX_PRESETS } from "../comp/composition.js";
import { formatOf, toSeconds } from "../comp/engine.js";
import { palette } from "../comp/paint.js";
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
  pendingCount,
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
  const total = () => timeline.reduce((sum, seg) => sum + segDuration(seg), 0);

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
          <video class="ed-video" playsinline></video>
          <!-- Graphics are drawn here, by the same function the export calls.
               A DOM overlay would have meant two renderers for one spec, and
               a preview that quietly stops matching the file. -->
          <canvas class="ed-gfx"></canvas>
          <p class="ed-empty">Add a clip from the library to start cutting.</p>
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

      <aside class="ed-insp"></aside>

      <div class="ed-timeline">
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
          <div class="ed-track"></div>
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
    const empty = body.querySelector(".ed-empty");
    const libList = body.querySelector(".ed-lib-list");
    const track = body.querySelector(".ed-track");
    const insp = body.querySelector(".ed-insp");
    const scrub = body.querySelector(".scrub");
    const clock = body.querySelector(".ed-clock");
    const playBtn = body.querySelector('[data-act="play"]');
    const fileInput = body.querySelector('[data-act="file"]');
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
              <button class="lib-add" data-add="${c.id}" title="Add to timeline">
                ${c.thumb ? `<img src="${c.thumb}" alt="">` : `<span class="strip-blank"></span>`}
                <span class="lib-name">${Desk.esc(c.name)}</span>
                <span class="lib-time mono">${timecode(c.duration)}</span>
              </button>
              <button class="lib-del" data-del="${c.id}" aria-label="Delete ${Desk.esc(c.name)}">×</button>
            </div>`).join("")
        : `<p class="lib-empty">No clips yet. Record one in Camera, or import a file.</p>`;
    }

    function renderTrack() {
      empty.hidden = timeline.length > 0;
      const dur = total() || 1;
      track.innerHTML = timeline.length
        ? timeline.map((seg) => {
            const clip = byId.get(seg.clipId);
            const pct = (segDuration(seg) / dur) * 100;
            return `
              <button class="seg" draggable="true" data-seg="${seg.uid}"
                      style="flex-basis:${pct}%; --thumb:${clip?.thumb ? `url('${clip.thumb}')` : "none"}"
                      aria-pressed="${seg.uid === selected}">
                <span class="seg-name">${Desk.esc(clip?.name || "Missing clip")}</span>
                <span class="seg-time mono">${timecode(segDuration(seg))}</span>
              </button>`;
          }).join("")
        : `<p class="track-empty">Timeline is empty.</p>`;
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
    function compositionHtml() {
      const doc = composition();
      const layers = liveLayers();
      const sounds = liveAudio();
      const pending = pendingCount();

      const formats = ["landscape", "vertical", "square"].map((name) => {
        const f = formatOf(name);
        // The glyph is the aspect ratio itself, scaled to fit a 20px box.
        const w = f.width >= f.height ? 20 : Math.round((f.width / f.height) * 20);
        const h = f.height >= f.width ? 20 : Math.round((f.height / f.width) * 20);
        return `
          <button class="cmp-format" data-format="${name}" aria-pressed="${doc.format === name}"
                  style="--fw:${w}px; --fh:${h}px" title="${Desk.esc(name)}">
            <span class="cmp-format-box" aria-hidden="true"></span>
            <span>${f.label}</span>
          </button>`;
      }).join("");

      const reframe = doc.pendingFormat
        ? `<div class="cmp-reframe">
             <p><b>Reframe to ${formatOf(doc.pendingFormat.format).label}?</b></p>
             ${doc.pendingFormat.reason ? `<p class="cmp-reframe-why">${Desk.esc(doc.pendingFormat.reason)}</p>` : ""}
             <div class="cmp-item-acts">
               <button class="btn btn-mini btn-accent" data-fmt-accept="1">Accept</button>
               <button class="btn btn-mini btn-danger" data-fmt-reject="1">Reject</button>
             </div>
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
          : `<p class="cmp-empty">No graphics yet. Ask the agent for a title card over the opening, or a list where you say "three things".</p>`}
        ${sounds.length
          ? `<ul class="cmp-list">${[...sounds].sort(byPending).map(soundCard).join("")}</ul>`
          : ""}`;
    }

    function renderInspector() {
      const seg = timeline.find((s) => s.uid === selected);
      if (!seg) {
        insp.innerHTML =
          `<div class="ed-head"><span>Clip</span></div><p class="insp-empty">Select a clip on the timeline.</p>` +
          graphicsHtml() + compositionHtml();
        return;
      }
      const clip = byId.get(seg.clipId);
      const max = clip?.duration || seg.out;
      insp.innerHTML = `
        <div class="ed-head"><span>Clip</span></div>
        <div class="insp-body">
          <p class="insp-name">${Desk.esc(clip?.name || "Missing clip")}</p>

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

          <div class="insp-row">
            <button class="btn btn-mini" data-move="-1" aria-label="Move earlier">←</button>
            <button class="btn btn-mini" data-move="1" aria-label="Move later">→</button>
            <button class="btn btn-mini btn-danger" data-move="x" aria-label="Remove from timeline">Remove</button>
          </div>
        </div>` + graphicsHtml() + compositionHtml();
    }

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
      renderClock();
      highlightWord();
    }

    function loop() {
      if (!playing) return;
      const at = segmentAt(playhead);
      if (at) {
        const local = Math.max(0, (video.currentTime - at.seg.in) / at.seg.speed);
        playhead = at.start + local;

        if (video.currentTime >= at.seg.out - 0.03 || video.ended) {
          const next = timeline[timeline.indexOf(at.seg) + 1];
          if (next) seekTo(at.start + segDuration(at.seg) + 0.01, { play: true });
          else return stop();
        }
      }
      // Fire any accepted effect the playhead just crossed.
      scheduler?.tick(playhead, liveAudio());
      renderClock();
      highlightWord();
      raf = requestAnimationFrame(loop);
    }

    async function play() {
      if (!timeline.length) return;
      if (playhead >= total() - 0.05) playhead = 0;
      cancelAnimationFrame(raf);
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

    async function runExport() {
      if (!timeline.length) return Desk.toast("Nothing on the timeline to export.", "bad");
      stop();
      cancelled = false;

      const first = byId.get(timeline[0].clipId);
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
            ctx.drawImage(video, fit.x, fit.y, fit.w, fit.h);
          } catch { /* frame not ready */ }

          // The same functions the preview calls, on the frame being written.
          // Proposals are excluded: only what the editor accepted is in the
          // file, and the look never has to be reconciled between two
          // renderers because there is only one.
          ctx.filter = "none";
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

          const local = Math.max(0, (video.currentTime - at.seg.in) / at.seg.speed);
          playhead = at.start + local;
          fill.style.width = `${Math.min(100, (playhead / duration) * 100)}%`;
          title.textContent = `Exporting… ${timecode(playhead)} of ${timecode(duration)}`;

          if (video.currentTime >= at.seg.out - 0.03 || video.ended) {
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
        if (result.hint) console.info(`[desk-two] ${result.hint}`);
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

      const yes = t.closest("[data-gfx-accept]");
      if (yes) return void acceptGraphic(yes.dataset.gfxAccept, e);
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
      if (yesLayer) return void acceptLayer(yesLayer.dataset.layerAccept, e);
      const noLayer = t.closest("[data-layer-reject]");
      if (noLayer) return void rejectLayer(noLayer.dataset.layerReject, e);
      const goneLayer = t.closest("[data-layer-remove]");
      if (goneLayer) return void removeLayer(goneLayer.dataset.layerRemove, e);

      const yesSound = t.closest("[data-sound-accept]");
      if (yesSound) return void acceptAudio(yesSound.dataset.soundAccept, e);
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

      if (act === "play") return playing ? stop() : play();
      if (act === "import") return fileInput.click();
      if (act === "export") return runExport();
      if (act === "cancel-export") { cancelled = true; return; }
      if (act === "clear") {
        timeline = [];
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
      if (e.target.dataset.set !== "mute") return;
      const seg = timeline.find((s) => s.uid === selected);
      if (!seg) return;
      seg.muted = !seg.muted;
      refresh();
      seekTo(playhead);
    });

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

    /* drag to reorder */
    let dragUid = null;
    track.addEventListener("dragstart", (e) => {
      dragUid = e.target.closest("[data-seg]")?.dataset.seg || null;
    });
    track.addEventListener("dragover", (e) => e.preventDefault());
    track.addEventListener("drop", (e) => {
      e.preventDefault();
      const overUid = e.target.closest("[data-seg]")?.dataset.seg;
      if (!dragUid || !overUid || dragUid === overUid) return;
      const from = timeline.findIndex((s) => s.uid === dragUid);
      const to = timeline.findIndex((s) => s.uid === overUid);
      timeline.splice(to, 0, timeline.splice(from, 1)[0]);
      dragUid = null;
      rebuildTranscript().then(refresh);
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

      const anything = liveGraphics().length || liveLayers().length || composition().pendingFormat;
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

      gfxFrame = requestAnimationFrame(paintGraphics);
    }
    gfxFrame = requestAnimationFrame(paintGraphics);

    const offGraphics = onGraphics(() => renderInspector());
    const offComposition = onComposition(() => {
      renderInspector();
      renderCode();
    });
    const offCuts = onCuts(() => renderCuts());
    const offTranscripts = onTranscripts(() => renderWords());
    const off = Store.on("clips", renderLibrary);

    win.onCleanup(() => {
      off();
      offGraphics();
      offComposition();
      offCuts();
      offTranscripts();
      cancelAnimationFrame(gfxFrame);
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

    clear() { timeline = []; selected = null; refresh(); },
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
