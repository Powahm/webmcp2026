import { Store, Clips, timecode, noPictureMessage } from "./store.js";
import { Desk } from "./shell.js";
import { Editor } from "./editor.js";

/* ============================================================
   Camera: live preview and recording.
   The same recorder backs both the window UI and the scripting
   API, so camera.record(3) in a script behaves identically.
   ============================================================ */

export const Camera = (() => {
  const TINT = "#F54E00";
  let stream = null;
  let deviceId = null;
  let withAudio = true;
  let gotAudio = false;
  /** "camera" or "screen". Screen capture keeps the mic, so a tutorial is one take. */
  let source = "camera";
  const viewers = new Set();

  /**
   * What the recorder is doing, right now.
   *
   * Maintained inside start() rather than in the window UI, so it is true
   * whether the take was begun by a person pressing the shutter or by anything
   * else. This is the state the WebMCP layer reads: `armed` means a stream is
   * live and the preview is running, `recording` means a MediaRecorder is
   * collecting. Elapsed seconds tick from an interval that exists nowhere but
   * this tab.
   */
  const recorder = { status: "idle", startedAt: 0, elapsed: 0 };

  /**
   * The teleprompter, as it exists during a take.
   *
   * Kept at module level rather than in the window, so a take begun anywhere
   * carries the same record and so get_recorder_state can answer "which line
   * are they on" without reaching into the DOM.
   *
   * `marks` is the useful part: one entry per line, with the second of the take
   * it was reached at. It is written onto the clip when the take ends, which is
   * what later lets anything cut on what was said rather than on guesswork.
   */
  const prompt = { script: null, line: 0, marks: [] };

  function pickMime() {
    const options = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4"
    ];
    return options.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  }

  const framed = () => { try { return window.self !== window.top; } catch { return true; } };

  function describeError(err) {
    const name = err?.name || "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return framed()
        ? "This preview frame blocked the camera. Open the deployed site to record, or use Import video."
        : "Camera access was blocked. Allow it in your browser's address bar, then press Try again.";
    }
    if (source === "screen") {
      if (name === "NotAllowedError") return "Screen sharing was cancelled. Pick a window or a screen to record it.";
      if (name === "UnsupportedError" || !navigator.mediaDevices?.getDisplayMedia) {
        return framed()
          ? "This preview frame does not allow screen capture. Open the deployed site to record your screen."
          : "Screen capture needs a secure page: https or localhost.";
      }
    }
    if (name === "NotFoundError" || name === "OverconstrainedError")
      return "No camera found on this device. Import video works without one.";
    if (name === "NotReadableError")
      return "The camera is already in use by another app.";
    if (name === "UnsupportedError" || !navigator.mediaDevices?.getUserMedia) {
      return framed()
        ? "This preview frame does not allow camera access. Open the deployed site to record, or use Import video."
        : "Camera access needs a secure page: https or localhost. Import video works anywhere.";
    }
    return err?.message || "The camera could not be started.";
  }

  /**
   * The screen, plus your voice.
   *
   * getDisplayMedia gives picture and, at the user's discretion, the audio of
   * whatever they picked. That is not the same thing as a voiceover, so the mic
   * is fetched separately and both are put into one MediaStream. Everything
   * downstream only ever sees a MediaStream and then a Blob, so the recorder,
   * the library, the editor and the export need no changes at all.
   *
   * Two things this must get right or the take is ruined silently:
   *
   *   - It needs a real user gesture. A tool call has none, which is why there
   *     is no WebMCP tool that starts a recording. The person presses the
   *     button.
   *   - The browser draws its own "Stop sharing" bar. Pressing it ends the
   *     track but not the MediaRecorder, so without the `ended` listener the
   *     clip runs on with a frozen last frame.
   */
  async function acquireScreen() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw Object.assign(new Error("no screen capture in this context"), { name: "UnsupportedError" });
    }

    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30 } },
      audio: true
    });

    const tracks = [...display.getVideoTracks(), ...display.getAudioTracks()];

    if (withAudio) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        tracks.push(...mic.getAudioTracks());
      } catch {
        /* No mic, or refused. A silent screen recording still beats no take. */
      }
    }

    stream = new MediaStream(tracks);
    gotAudio = stream.getAudioTracks().length > 0;

    // The browser's own stop button lives outside the page. This is the only
    // way the page hears about it.
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      stopRequests.forEach((fn) => fn());
      release();
    });

    viewers.forEach((fn) => fn(stream));
    if (recorder.status === "idle") recorder.status = "armed";
    return stream;
  }

  /** Callbacks that end an in-flight take. Registered by start(). */
  const stopRequests = new Set();

  async function acquire() {
    if (stream && stream.active) return stream;
    if (source === "screen") return acquireScreen();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error("no camera API in this context"), { name: "UnsupportedError" });
    }

    const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" };
    const ladder = [
      { video, audio: withAudio },
      { video, audio: false },
      { video: true, audio: false }
    ];

    let last;
    for (const constraints of ladder) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        gotAudio = stream.getAudioTracks().length > 0;
        viewers.forEach((fn) => fn(stream));
        if (recorder.status === "idle") recorder.status = "armed";
        return stream;
      } catch (err) {
        last = err;
        /* a refusal is final; a missing device or a bad constraint is worth retrying */
        if (err.name === "NotAllowedError" || err.name === "SecurityError") break;
      }
    }
    throw last;
  }

  function release() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (recorder.status === "armed") recorder.status = "idle";
  }

  /* record for a fixed number of seconds, or until stop() is called */
  async function start({ onTick } = {}) {
    const live = await acquire();
    const mimeType = pickMime();
    const rec = new MediaRecorder(live, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const startedAt = Date.now();

    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    recorder.status = "recording";
    recorder.startedAt = startedAt;
    recorder.elapsed = 0;

    // One interval, whether or not the caller asked for ticks: the module's own
    // elapsed counter has to be right for every take, not only a UI-driven one.
    const timer = setInterval(() => {
      recorder.elapsed = (Date.now() - startedAt) / 1000;
      onTick?.(recorder.elapsed);
    }, 200);

    rec.start(250);

    const finished = new Promise((resolve) => {
      rec.onstop = async () => {
        clearInterval(timer);
        recorder.status = stream?.active ? "armed" : "idle";
        recorder.elapsed = (Date.now() - startedAt) / 1000;
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        resolve(
          await Clips.save(blob, {
            name: source === "screen" ? `Screen ${stamp}` : `Recording ${stamp}`,
            kind: source === "screen" ? "screen" : "recording"
          })
        );
      };
    });

    const stop = () => rec.state !== "inactive" && rec.stop();
    stopRequests.add(stop);
    finished.finally(() => stopRequests.delete(stop));

    return { stop, finished };
  }

  /* ---------------- window UI ---------------- */

  function build(body, win) {
    // `source` outlives one window: it is module state, not per-window state,
    // so closing the window while on Screen and reopening it left the select
    // showing its default "Camera" option while acquire() still reached for
    // getDisplayMedia underneath. A fresh window always starts on Camera.
    source = "camera";

    body.className = "win-body cam";
    body.innerHTML = `
      <div class="cam-stage">
        <video class="cam-video" playsinline muted autoplay></video>
        <div class="cam-blocked" hidden>
          <p class="cam-blocked-title">Camera unavailable</p>
          <p class="cam-blocked-msg"></p>
          <button class="btn btn-ghost" data-act="retry">Try again</button>
        </div>
        <div class="cam-rec" hidden><span class="cam-dot"></span><span class="cam-time mono">00:00:00</span></div>

        <!-- The teleprompter, over the preview rather than over the desktop.
             Tailwind utilities with the theme's own custom properties, so it
             sits on the same palette as everything else without adding rules
             to desk.css. -->
        <div class="cam-prompt absolute inset-x-0 bottom-0 flex-col gap-1 p-4
                    bg-gradient-to-t from-black/85 via-black/65 to-transparent"
             style="display:none" hidden>
          <p class="cam-prompt-line m-0 text-[22px] leading-snug font-semibold text-white
                    [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]"></p>
          <p class="cam-prompt-next m-0 text-[15px] leading-snug text-white/55
                    [text-shadow:0_1px_3px_rgb(0_0_0/0.9)]"></p>
          <p class="cam-prompt-note m-0 text-[11px] uppercase tracking-wider text-[var(--amber,#F7A501)]"></p>
          <p class="cam-prompt-hint m-0 text-[10px] text-white/45">space or click advances · ← goes back</p>
        </div>
      </div>
      <div class="cam-bar">
        <select class="select" data-act="source" aria-label="What to record">
          <option value="camera">Camera</option>
          <option value="screen">Screen</option>
        </select>
        <select class="select" data-act="script" aria-label="Teleprompter script">
          <option value="">No script</option>
        </select>
        <select class="select" data-act="device" aria-label="Camera"><option>Default camera</option></select>
        <button class="btn btn-ghost" data-act="mic" aria-pressed="true">Mic on</button>
        <button class="shutter" data-act="record" aria-label="Start recording"><span class="shutter-core"></span></button>
        <button class="btn btn-ghost" data-act="import">Import video</button>
        <input type="file" accept="video/*" multiple hidden data-act="file">
      </div>
      <div class="cam-strip" aria-label="Recent clips"></div>`;

    const video = body.querySelector(".cam-video");
    const blocked = body.querySelector(".cam-blocked");
    const blockedMsg = body.querySelector(".cam-blocked-msg");
    const recBadge = body.querySelector(".cam-rec");
    const recTime = body.querySelector(".cam-time");
    const shutter = body.querySelector('[data-act="record"]');
    const micBtn = body.querySelector('[data-act="mic"]');
    const select = body.querySelector('[data-act="device"]');
    const fileInput = body.querySelector('[data-act="file"]');
    const strip = body.querySelector(".cam-strip");
    const stage = body.querySelector(".cam-stage");
    const promptEl = body.querySelector(".cam-prompt");
    const promptLine = body.querySelector(".cam-prompt-line");
    const promptNext = body.querySelector(".cam-prompt-next");
    const promptNote = body.querySelector(".cam-prompt-note");
    const scriptSelect = body.querySelector('[data-act="script"]');
    const sourceSelect = body.querySelector('[data-act="source"]');

    /* ---------------- teleprompter ---------------- */

    function paintPrompt() {
      const script = prompt.script;

      // Set display outright rather than toggling a `hidden` class against a
      // `flex` class: both are display utilities with the same specificity, so
      // which one wins comes down to Tailwind's internal ordering, and the
      // overlay silently laid out at zero height.
      promptEl.hidden = !script;
      promptEl.style.display = script ? "flex" : "none";
      if (!script) return;

      const line = script.lines[prompt.line];
      const next = script.lines[prompt.line + 1];
      promptLine.textContent = line?.text || "";
      promptNext.textContent = next?.text || "";
      promptNote.textContent = line?.note || "";
    }

    /**
     * Move to a line.
     *
     * Manual by default, and deliberately so: a prompter that scrolls on a
     * timer gets ahead of you the moment you pause, and the take is ruined
     * silently. You advance when you have finished the line.
     */
    function goToLine(index) {
      if (!prompt.script) return;
      prompt.line = Math.max(0, Math.min(index, prompt.script.lines.length - 1));
      if (recorder.status === "recording") {
        prompt.marks.push({ line: prompt.line, at: (Date.now() - recorder.startedAt) / 1000 });
      }
      paintPrompt();
    }

    async function loadScripts() {
      const scripts = await Store.all("scripts");
      scriptSelect.innerHTML =
        `<option value="">No script</option>` +
        scripts
          .map((s) => `<option value="${s.id}">${Desk.esc(s.name)}</option>`)
          .join("");
      if (prompt.script) scriptSelect.value = prompt.script.id;
    }

    async function loadPrompt(scriptId) {
      if (!scriptId) {
        prompt.script = null;
        prompt.line = 0;
        prompt.marks = [];
        return paintPrompt();
      }
      const script = (await Store.all("scripts")).find((s) => s.id === scriptId);
      prompt.script = script && script.lines?.length ? script : null;
      prompt.line = 0;
      prompt.marks = [];
      paintPrompt();
    }

    scriptSelect.addEventListener("change", () => loadPrompt(scriptSelect.value));

    // Click the preview to advance. The shutter is a long way from your hand
    // when you are set up in front of the camera; the picture is not.
    stage.addEventListener("click", (e) => {
      if (!prompt.script || e.target.closest("button")) return;
      goToLine(prompt.line + 1);
    });

    const onPromptKey = (e) => {
      if (!prompt.script || !Desk.isOpen("camera")) return;
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (e.key === " " || e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        goToLine(prompt.line + 1);
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        goToLine(prompt.line - 1);
      }
    };
    window.addEventListener("keydown", onPromptKey);

    let session = null;

    async function connect() {
      blocked.hidden = true;
      try {
        const live = await acquire();
        video.srcObject = live;
        await video.play().catch(() => {});
        shutter.disabled = false;
        /* the ladder may have dropped audio to get a picture at all */
        micBtn.textContent = gotAudio ? "Mic on" : withAudio ? "No mic" : "Mic off";
        micBtn.setAttribute("aria-pressed", String(gotAudio));
        await listDevices();
      } catch (err) {
        shutter.disabled = true;
        blocked.hidden = false;
        blockedMsg.textContent = describeError(err);
      }
    }

    async function listDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === "videoinput");
        if (cams.length < 2) return;
        select.innerHTML = cams
          .map((d, i) => `<option value="${d.deviceId}">${Desk.esc(d.label || `Camera ${i + 1}`)}</option>`)
          .join("");
        if (deviceId) select.value = deviceId;
      } catch { /* labels need permission; not fatal */ }
    }

    async function renderStrip() {
      const clips = (await Clips.all()).slice(-6).reverse();
      strip.innerHTML = clips.length
        ? clips.map((c) => `
            <button class="strip-clip" data-clip="${c.id}" title="${Desk.esc(c.name)} (open in Editor)">
              ${c.thumb ? `<img src="${c.thumb}" alt="">` : `<span class="strip-blank"></span>`}
              <span class="strip-time mono">${timecode(c.duration)}</span>
            </button>`).join("")
        : `<p class="strip-empty">Recordings land here.</p>`;
    }

    async function toggleRecord() {
      if (session) {
        shutter.dataset.recording = "false";
        shutter.setAttribute("aria-label", "Start recording");
        recBadge.hidden = true;
        const current = session;
        session = null;
        current.stop();
        const clip = await current.finished;
        await attachPromptMarks(clip);
        if (source === "screen") {
          // The share ends with the take. Leaving it live would keep the
          // browser's sharing bar on screen with nothing recording.
          release();
          video.srcObject = null;
          blocked.hidden = false;
          blockedMsg.textContent = "Press record to pick a window or a screen again.";
        }
        Desk.toast(`Saved ${clip.name}`, "good");
        renderStrip();
        return;
      }

      try {
        prompt.marks = [];
        // The gesture that opened this handler is what getDisplayMedia needs,
        // so there must be nothing slow between the click and start().
        session = await start({ onTick: (s) => (recTime.textContent = timecode(s)) });
        if (source === "screen") {
          // Show them what is actually being captured, muted so the room does
          // not feed back into itself.
          video.srcObject = stream;
          await video.play().catch(() => {});
          blocked.hidden = true;
        }
        if (prompt.script) prompt.marks.push({ line: prompt.line, at: 0 });
        shutter.dataset.recording = "true";
        shutter.setAttribute("aria-label", "Stop recording");
        recTime.textContent = "00:00:00";
        recBadge.hidden = false;
      } catch (err) {
        Desk.toast(describeError(err), "bad");
      }
    }

    body.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "record") toggleRecord();
      if (act === "retry") connect();
      if (act === "import") fileInput.click();
      if (act === "mic") {
        withAudio = !withAudio;
        micBtn.textContent = withAudio ? "Mic on" : "Mic off";
        micBtn.setAttribute("aria-pressed", String(withAudio));
        release();
        connect();
      }
      const clipBtn = e.target.closest("[data-clip]");
      if (clipBtn) Editor.openWith(clipBtn.dataset.clip);
    });

    select.addEventListener("change", () => {
      deviceId = select.value;
      release();
      connect();
    });

    /**
     * Switching to Screen opens the picker right away.
     *
     * A `change` event on a select is a real user gesture, same as a click, so
     * getDisplayMedia can be called straight from it. Cancelling the picker
     * just lands on the same "camera unavailable" state any other refusal
     * does, with its own Try again — no reason to make the person press
     * record first just to get the prompt they were already asking for.
     */
    sourceSelect.addEventListener("change", () => {
      source = sourceSelect.value;
      release();
      video.srcObject = null;
      select.hidden = source === "screen";
      connect();
    });

    fileInput.addEventListener("change", async () => {
      const count = fileInput.files.length;
      const mute = [];
      for (const file of fileInput.files) {
        const clip = await Clips.save(file, { name: file.name.replace(/\.[^.]+$/, ""), kind: "import" });
        if (clip.hasPicture === false) mute.push(clip.name);
      }
      if (mute.length) Desk.toast(noPictureMessage(mute), "bad");
      else Desk.toast(`Imported ${count} file(s)`, "good");
      fileInput.value = "";
      renderStrip();
    });

    /**
     * Minimising the window lets the camera go.
     *
     * A webcam light that stays on after the window is tucked into the dock is
     * alarming, and the app has no business holding the device while it is not
     * showing you the picture. Restoring re-acquires. A take in progress is
     * ended first, so the clip is saved rather than truncated by the tracks
     * being pulled from under the recorder.
     */
    win.onVisibility(async (visible) => {
      if (!visible) {
        if (session) await toggleRecord();
        release();
        video.srcObject = null;
        return;
      }
      if (source === "camera") connect();
    });

    const off = Store.on("clips", renderStrip);
    const offScripts = Store.on("scripts", loadScripts);
    win.onCleanup(() => {
      off();
      offScripts();
      window.removeEventListener("keydown", onPromptKey);
      release();
      video.srcObject = null;
    });

    connect();
    renderStrip();
    loadScripts();
    paintPrompt();
  }

  function open(origin) {
    Desk.openWindow({
      id: "camera",
      title: "Camera",
      meta: "live",
      tint: TINT,
      size: { w: 760, h: 700 },
      minSize: { w: 480, h: 420 },
      origin,
      build
    });
  }

  /** Live recorder state for the WebMCP layer. */
  function state() {
    return {
      status: recorder.status,
      elapsed: recorder.status === "recording"
        ? (Date.now() - recorder.startedAt) / 1000
        : recorder.elapsed,
      // What the stream actually carries, which is not always what was asked
      // for: acquire() walks a constraint ladder and will drop audio to get a
      // picture at all.
      audio: recorder.status === "idle" ? withAudio : gotAudio,
      audioRequested: withAudio,
      source,
      deviceId: deviceId || null,
      windowOpen: Desk.isOpen("camera"),
      script: prompt.script
        ? {
            id: prompt.script.id,
            name: prompt.script.name,
            line_index: prompt.line,
            line: prompt.script.lines[prompt.line]?.text ?? "",
            note: prompt.script.lines[prompt.line]?.note || null,
            lines_total: prompt.script.lines.length
          }
        : null
    };
  }

  /**
   * Write the prompter marks onto the take.
   *
   * A clip that knows which line was being spoken at which second is a clip
   * anything can cut on later. It costs one extra field and it can only be
   * captured here, while the take is running.
   */
  async function attachPromptMarks(clip) {
    if (!prompt.script || prompt.marks.length === 0) return clip;
    clip.scriptId = prompt.script.id;
    clip.scriptName = prompt.script.name;
    clip.beats = prompt.marks.slice();
    await Store.put("clips", clip);
    return clip;
  }

  return { open, start, acquire, release, state, TINT, describeError };
})();
