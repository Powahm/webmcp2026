/* ============================================================
   Editor — a timeline of trimmed clips with per-clip grading.
   Export replays the timeline into a canvas and records the
   canvas stream, so there is no encoder dependency.
   ============================================================ */

const Editor = (() => {
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
        <div class="ed-head"><span>Timeline</span><button class="btn btn-mini" data-act="clear">Clear</button></div>
        <div class="ed-track"></div>
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

    let playing = false;
    let playhead = 0;
    let loaded = null;
    let raf = 0;

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

    function renderInspector() {
      const seg = timeline.find((s) => s.uid === selected);
      if (!seg) {
        insp.innerHTML = `<div class="ed-head"><span>Clip</span></div><p class="insp-empty">Select a clip on the timeline.</p>`;
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
        </div>`;
    }

    function renderClock() {
      clock.textContent = `${timecode(playhead)} / ${timecode(total())}`;
      const dur = total();
      scrub.value = dur ? String(Math.round((playhead / dur) * 1000)) : "0";
    }

    refresh = () => { renderTrack(); renderInspector(); renderClock(); };

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
      renderClock();
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
      renderClock();
      raf = requestAnimationFrame(loop);
    }

    async function play() {
      if (!timeline.length) return;
      if (playhead >= total() - 0.05) playhead = 0;
      playing = true;
      playBtn.dataset.playing = "true";
      playBtn.setAttribute("aria-label", "Pause");
      await seekTo(playhead, { play: true });
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      playing = false;
      playBtn.dataset.playing = "false";
      playBtn.setAttribute("aria-label", "Play");
      cancelAnimationFrame(raf);
      video.pause();
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
      const canvas = document.createElement("canvas");
      canvas.width = first?.width || 1280;
      canvas.height = first?.height || 720;
      const ctx = canvas.getContext("2d");

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

      recorder.start(250);
      playhead = 0;
      await seekTo(0, { play: true });

      await new Promise((resolve) => {
        const paint = () => {
          if (cancelled) return resolve();
          const at = segmentAt(playhead);
          if (!at) return resolve();

          ctx.filter = FILTERS[at.seg.filter] || "none";
          try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          } catch { /* frame not ready */ }

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

      if (act === "play") return playing ? stop() : play();
      if (act === "import") return fileInput.click();
      if (act === "export") return runExport();
      if (act === "cancel-export") { cancelled = true; return; }
      if (act === "clear") { timeline = []; selected = null; loaded = null; video.removeAttribute("src"); stop(); return refresh(); }

      const add = t.closest("[data-add]");
      if (add) { await addClip(add.dataset.add); return seekTo(playhead); }

      const del = t.closest("[data-del]");
      if (del) {
        timeline = timeline.filter((s) => s.clipId !== del.dataset.del);
        await Clips.remove(del.dataset.del);
        loaded = null;
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
      refresh();
    });

    fileInput.addEventListener("change", async () => {
      for (const file of fileInput.files) {
        await Clips.save(file, { name: file.name.replace(/\.[^.]+$/, ""), kind: "import" });
      }
      fileInput.value = "";
      Desk.toast("Imported.", "good");
    });

    const off = Store.on("clips", renderLibrary);
    win.onCleanup(() => { off(); stop(); refresh = () => {}; });

    renderLibrary();
    refresh();
    if (timeline.length) seekTo(0);

    body._editor = { play, stop, seekTo, runExport, renderLibrary };
  }

  function open(origin) {
    return Desk.openWindow({
      id: "editor",
      title: "Editor",
      meta: "timeline",
      tint: TINT,
      size: { w: 820, h: 600 },
      origin,
      build
    });
  }

  async function openWith(clipId) {
    open(null);
    await addClip(clipId);
  }

  return {
    open, openWith, addClip, TINT, FILTERS,
    get timeline() { return timeline; },
    clear() { timeline = []; selected = null; refresh(); },
    setAll(patch) { timeline.forEach((s) => Object.assign(s, patch)); refresh(); },
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
    }
  };
})();
