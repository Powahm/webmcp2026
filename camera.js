/* ============================================================
   Camera — live preview and recording.
   The same recorder backs both the window UI and the scripting
   API, so camera.record(3) in a script behaves identically.
   ============================================================ */

const Camera = (() => {
  const TINT = "#F54E00";
  let stream = null;
  let deviceId = null;
  let withAudio = true;
  let gotAudio = false;
  const viewers = new Set();

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
    if (name === "NotFoundError" || name === "OverconstrainedError")
      return "No camera found on this device. Import video works without one.";
    if (name === "NotReadableError")
      return "The camera is already in use by another app.";
    if (name === "UnsupportedError" || !navigator.mediaDevices?.getUserMedia) {
      return framed()
        ? "This preview frame does not allow camera access. Open the deployed site to record, or use Import video."
        : "Camera access needs a secure page — https or localhost. Import video works anywhere.";
    }
    return err?.message || "The camera could not be started.";
  }

  async function acquire() {
    if (stream && stream.active) return stream;
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
  }

  /* record for a fixed number of seconds, or until stop() is called */
  async function start({ onTick } = {}) {
    const live = await acquire();
    const mimeType = pickMime();
    const recorder = new MediaRecorder(live, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const startedAt = Date.now();

    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const timer = onTick && setInterval(() => onTick((Date.now() - startedAt) / 1000), 200);
    recorder.start(250);

    const finished = new Promise((resolve) => {
      recorder.onstop = async () => {
        clearInterval(timer);
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        resolve(await Clips.save(blob, { name: `Recording ${stamp}`, kind: "recording" }));
      };
    });

    return {
      stop: () => recorder.state !== "inactive" && recorder.stop(),
      finished
    };
  }

  async function recordFor(seconds = 3) {
    const session = await start();
    await new Promise((r) => setTimeout(r, Math.max(0.2, seconds) * 1000));
    session.stop();
    return session.finished;
  }

  /* ---------------- window UI ---------------- */

  function build(body, win) {
    body.className = "win-body cam";
    body.innerHTML = `
      <div class="cam-stage">
        <video class="cam-video" playsinline muted autoplay></video>
        <div class="cam-blocked" hidden>
          <p class="cam-blocked-title">Camera unavailable</p>
          <p class="cam-blocked-msg"></p>
          <button class="btn btn-ghost" data-act="retry">Try again</button>
        </div>
        <div class="cam-rec" hidden><span class="cam-dot"></span><span class="cam-time mono">0:00</span></div>
      </div>
      <div class="cam-bar">
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
            <button class="strip-clip" data-clip="${c.id}" title="${Desk.esc(c.name)} — open in Editor">
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
        Desk.toast(`Saved ${clip.name}`, "good");
        renderStrip();
        return;
      }

      try {
        session = await start({ onTick: (s) => (recTime.textContent = timecode(s)) });
        shutter.dataset.recording = "true";
        shutter.setAttribute("aria-label", "Stop recording");
        recTime.textContent = "0:00";
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

    fileInput.addEventListener("change", async () => {
      for (const file of fileInput.files) {
        await Clips.save(file, { name: file.name.replace(/\.[^.]+$/, ""), kind: "import" });
      }
      Desk.toast(`Imported ${fileInput.files.length} file(s)`, "good");
      fileInput.value = "";
      renderStrip();
    });

    const off = Store.on("clips", renderStrip);
    win.onCleanup(() => { off(); release(); video.srcObject = null; });

    connect();
    renderStrip();
  }

  function open(origin) {
    Desk.openWindow({
      id: "camera",
      title: "Camera",
      meta: "live",
      tint: TINT,
      size: { w: 560, h: 560 },
      origin,
      build
    });
  }

  return { open, recordFor, start, acquire, release, TINT, describeError };
})();
