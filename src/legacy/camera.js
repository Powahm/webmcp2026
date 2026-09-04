import {
  askForCameraAndMic,
  describeEnvironment,
  framed as framedIn,
  openInOwnTab,
} from "../env/browser.js";
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
  /** Why the mic is missing, when it was asked for and did not arrive. The
   *  name of the DOMException, or null when there is nothing wrong. */
  let audioError = null;
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

  const framed = () => framedIn();

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
   * Why this take will be silent, in one sentence a person can act on.
   *
   * Separate from describeError because a missing mic is not a failure to
   * record: the picture is fine, the take will happen, and the only thing
   * wrong is that nobody will hear it. That deserves saying out loud at the
   * moment it is discovered, which is what the old code never did.
   */
  function describeAudioError(name) {
    const tail = " so this take will have no sound.";
    if (name === "NotFoundError")
      return "No microphone was found," + tail;
    if (name === "NotReadableError")
      return "Another app is holding the microphone," + tail +
        " An agent's browser often keeps it for its own voice features. Close that, then press the mic button to try again.";
    if (name === "MutedError")
      return "The microphone is muted at the system level," + tail + " Unmute it and press the mic button.";
    if (name === "NotAllowedError" || name === "SecurityError")
      return framed()
        ? "The page this one is inside did not pass the microphone down," + tail + " Open Deskmate in a tab of its own."
        : "The microphone was blocked," + tail + " Allow it from the address bar, then press the mic button to try again.";
    if (name === "UnsupportedError")
      return "This browser will not give the page a microphone," + tail;
    if (!name) return "";
    return "The microphone could not be started (" + name + ")," + tail;
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

    // A silent screen recording still beats no take, so a mic failure is not
    // fatal here either. It is no longer swallowed, though: acquireMic keeps
    // the reason, and the mic button offers to try again.
    tracks.push(...(await acquireMic()));

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

  /**
   * The microphone, on its own.
   *
   * This used to be one rung of a video-and-audio ladder, and that was a bug
   * with a silent failure mode. The ladder asked for `{ video, audio: true }`
   * and, when that combination failed for any reason short of an outright
   * refusal, fell through to a rung with `audio: false`. Every symptom of a
   * working camera was still there -- a live preview, an enabled shutter -- and
   * the take came out with no sound.
   *
   * An agent's browser makes that likely rather than rare. The host app is
   * often already holding the microphone for its own voice features, which is
   * `NotReadableError`, or does not expose a microphone to the page at all,
   * which is `NotFoundError`. Neither is a refusal, so neither stopped the
   * fall-through.
   *
   * Asking for the two devices separately fixes three things at once: the
   * picture no longer depends on the mic, the mic failure keeps a name worth
   * reporting, and asking again later costs one call instead of tearing the
   * preview down. It also means two smaller permission prompts rather than one
   * combined one, and a combined prompt that is only half granted is refused
   * outright by the browser.
   */
  async function acquireMic() {
    audioError = null;
    if (!withAudio) return [];
    if (!navigator.mediaDevices?.getUserMedia) {
      audioError = "UnsupportedError";
      return [];
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = mic.getAudioTracks();
      if (!tracks.length) audioError = "NotFoundError";
      // A track can arrive live and muted at the source, which is silence with
      // none of the signs of failure. Say so rather than record it.
      else if (tracks.every((t) => t.muted)) audioError = "MutedError";
      return tracks;
    } catch (err) {
      audioError = err?.name || "unknown";
      return [];
    }
  }

  /**
   * Put the mic on a preview that is already running.
   *
   * MediaRecorder freezes its track list when it is constructed, so this is
   * only ever useful before a take starts. That is exactly when it is called:
   * once from the mic button, and once more from start(), because the click
   * that starts a take is a fresh user gesture and a browser that ignored the
   * first request may honour one attached to that.
   */
  async function addMicToLive() {
    if (!withAudio || gotAudio || !stream) return false;
    const tracks = await acquireMic();
    if (!tracks.length) return false;
    tracks.forEach((t) => stream.addTrack(t));
    gotAudio = true;
    viewers.forEach((fn) => fn(stream));
    return true;
  }

  async function acquire() {
    if (stream && stream.active) return stream;
    if (source === "screen") return acquireScreen();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error("no camera API in this context"), { name: "UnsupportedError" });
    }

    const video = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" };
    // Video only. A named camera, then any camera: nothing here can cost the
    // take its sound, because the sound is not in this ladder any more.
    const ladder = [{ video }, { video: true }];

    let last;
    let picture = null;
    for (const constraints of ladder) {
      try {
        picture = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        last = err;
        /* a refusal is final; a missing device or a bad constraint is worth retrying */
        if (err.name === "NotAllowedError" || err.name === "SecurityError") break;
      }
    }
    if (!picture) throw last;

    const audioTracks = await acquireMic();
    stream = new MediaStream([...picture.getVideoTracks(), ...audioTracks]);
    gotAudio = audioTracks.length > 0;
    viewers.forEach((fn) => fn(stream));
    if (recorder.status === "idle") recorder.status = "armed";
    return stream;
  }

  function release() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (recorder.status === "armed") recorder.status = "idle";
  }

  /* record for a fixed number of seconds, or until stop() is called */
  async function start({ onTick } = {}) {
    const live = await acquire();

    /*
     * Last chance at the microphone, and the last chance to say it is missing.
     *
     * Both halves matter. The retry is worth one call because the click that
     * got us here is a fresh user gesture, and a browser that ignored the
     * request made while the window was opening may honour this one. The
     * warning matters more: the old code recorded a silent take and said
     * nothing at all, so the first anyone knew of it was on the timeline
     * afterwards. It has to be before MediaRecorder is constructed, because
     * that is when the track list is frozen.
     */
    if (withAudio && !gotAudio) await addMicToLive();
    if (withAudio && !gotAudio) Desk.toast(describeAudioError(audioError), "bad");

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
            kind: source === "screen" ? "screen" : "recording",
            // Recorded on the clip so nothing downstream has to guess. A take
            // with no audio track is why a transcript cannot be measured from
            // it and why its volume slider does nothing.
            hasAudio: gotAudio
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
        <!-- Three doors out, in the order worth trying. Asking is first
             because it is the one that works when the browser simply has not
             been asked yet; a tab of its own is second because it is the only
             thing that helps when the surrounding page never passed the camera
             down; Try again is last, for when the person has just changed
             something themselves. -->
        <div class="cam-blocked" hidden>
          <p class="cam-blocked-title">Camera unavailable</p>
          <p class="cam-blocked-msg"></p>
          <div class="cam-blocked-acts">
            <button class="btn btn-accent" data-act="ask">Ask for camera and mic</button>
            <button class="btn btn-ghost" data-act="own-tab" hidden>Open in its own tab</button>
            <button class="btn btn-ghost" data-act="retry">Try again</button>
          </div>
          <p class="cam-blocked-env mono"></p>
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

    /**
     * The mic button says which of three states it is in, not two.
     *
     * "Mic off" is a choice, "Mic on" is working, and "No mic" is the one that
     * used to be invisible: asked for, not granted, take will be silent. In
     * that state the button stops being a toggle and becomes a retry, because
     * turning the mic "off" is not what anybody wants from it.
     */
    function paintMic() {
      const warn = withAudio && !gotAudio;
      micBtn.textContent = !withAudio ? "Mic off" : gotAudio ? "Mic on" : "No mic · retry";
      micBtn.setAttribute("aria-pressed", String(gotAudio));
      micBtn.dataset.warn = warn ? "true" : "false";
      const why = warn ? describeAudioError(audioError) : "";
      if (why) micBtn.title = why;
      else micBtn.removeAttribute("title");
    }

    async function connect() {
      blocked.hidden = true;
      try {
        const live = await acquire();
        video.srcObject = live;
        await video.play().catch(() => {});
        shutter.disabled = false;
        paintMic();
        // Said once, on arming, so it is known before the take rather than
        // after it. start() says it again if it is still true by then.
        if (withAudio && !gotAudio) Desk.toast(describeAudioError(audioError), "bad");
        await listDevices();
      } catch (err) {
        shutter.disabled = true;
        blocked.hidden = false;
        blockedMsg.textContent = describeError(err);
        showEnvironment();
      }
    }

    /**
     * Ask for the camera and the microphone, deliberately.
     *
     * The prompt usually arrives the moment this window opens, which is a
     * prompt nobody pressed anything for: some browsers, agent browsers in
     * particular, dismiss one of those on the person's behalf and there is no
     * way back to it. This button is a request the person made, so the browser
     * has a gesture to attach the prompt to and they know what they are
     * answering. A grant is remembered for the origin, so pressing record next
     * time asks nobody.
     */
    async function askPermission() {
      const ask = body.querySelector('[data-act="ask"]');
      if (ask) { ask.disabled = true; ask.textContent = "Asking…"; }
      const result = await askForCameraAndMic();
      if (ask) { ask.disabled = false; ask.textContent = "Ask for camera and mic"; }

      if (result.ok) {
        Desk.toast("Camera and mic allowed.", "good");
        return connect();
      }
      blocked.hidden = false;
      blockedMsg.textContent = describeError({ name: result.error, message: result.detail });
      showEnvironment();
    }

    /**
     * What the browser says about itself, under the message.
     *
     * A refusal with no reason is the thing this window has always been worst
     * at: "Camera unavailable" is true and useless. This is the one line that
     * separates a permission the person can grant from a frame that was never
     * given the camera to pass down, and it decides whether the way out is
     * worth offering.
     */
    async function showEnvironment() {
      const line = body.querySelector(".cam-blocked-env");
      const escape = body.querySelector('[data-act="own-tab"]');
      if (escape) escape.hidden = !framed();
      if (!line) return;
      line.textContent = await describeEnvironment();
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
      if (act === "ask") return void askPermission();
      if (act === "own-tab") {
        // Straight off the click. A window opened later is a popup, and popups
        // are blocked, which would look like this button doing nothing.
        if (!openInOwnTab()) {
          Desk.toast("This browser would not open a new tab. Copy the address into one yourself.", "bad");
        }
        return;
      }
      if (act === "import") fileInput.click();
      if (act === "mic") {
        // Asked for and missing: this press is a retry, not a toggle. Straight
        // off the click, so the request has a real gesture behind it.
        if (withAudio && !gotAudio && stream?.active) {
          micBtn.disabled = true;
          micBtn.textContent = "Trying…";
          const ok = await addMicToLive();
          micBtn.disabled = false;
          paintMic();
          Desk.toast(ok ? "Microphone is on." : describeAudioError(audioError), ok ? "good" : "bad");
          return;
        }

        withAudio = !withAudio;

        // With a live preview the mic goes on or off in place. Tearing the
        // stream down and reconnecting made the picture flicker and, on a
        // browser that prompts every time, asked for the camera again.
        if (stream?.active) {
          if (!withAudio) {
            stream.getAudioTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
            gotAudio = false;
            audioError = null;
            paintMic();
            return;
          }
          const ok = await addMicToLive();
          paintMic();
          if (!ok) Desk.toast(describeAudioError(audioError), "bad");
          return;
        }

        paintMic();
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
      help: "camera",
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
      // for: the mic can be held by another app, or not exposed to the page at
      // all, and neither of those stops the picture.
      audio: recorder.status === "idle" ? withAudio : gotAudio,
      audioRequested: withAudio,
      // Set when the mic was asked for and did not arrive. Worth surfacing:
      // an agent that can see this can say the take will be silent before the
      // person has spoken into it for a minute.
      audioError: withAudio && !gotAudio ? audioError : null,
      audioProblem: withAudio && !gotAudio ? describeAudioError(audioError) : null,
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
