/**
 * Sound: six synthesised effects and one ducked music bed.
 *
 * **The effects are built, not loaded.** Every preset below is oscillators, a
 * noise buffer and an envelope, which means there are no audio files in this
 * repo, nothing to fetch, nothing to 404 on a judge's machine and no licence
 * to think about. It also changes what the agent has to know: an effect is a
 * name from a list of six, not a file it would have to be handed a manifest
 * of.
 *
 * **The bed ducks itself.** A music bed at a fixed level under speech is the
 * fastest way to make an edit sound amateur, and the usual fix is a
 * side-chain compressor nobody configures correctly. We already know exactly
 * where the words are, because the transcript says so, so the envelope is
 * computed up front and scheduled on a gain node. Not an approximation of
 * ducking — the actual word boundaries.
 *
 * One graph serves the preview and the export. The export in legacy/editor.js
 * already builds an AudioContext with a MediaStreamDestination to get the
 * video's own sound into the file; passing that destination in here as a
 * second output is the whole of what makes effects land in the exported file
 * rather than only in the room.
 */

/* ------------------------------------------------------------------- noise */

const noiseCache = new WeakMap();

/** Two seconds of white noise, once per context. Every noise-based preset
 *  reads a window out of this rather than filling its own buffer. */
function noiseBuffer(ctx) {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buffer);
  return buffer;
}

/* ----------------------------------------------------------------- presets */

/**
 * Each preset is a function of (ctx, out, at, gain) that wires itself up,
 * schedules its own stop and returns nothing. Nothing here holds state or
 * needs cleaning up: a one-shot disconnects when its source ends.
 */
const PRESETS = {
  /** A low percussive thump. For a title card landing. */
  hit(ctx, out, at, gain) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(48, at + 0.24);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + 0.3);

    // A click on the front, or the thump has no attack and reads as a hum.
    const click = ctx.createBufferSource();
    const clickEnv = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    click.buffer = noiseBuffer(ctx);
    hp.type = "highpass";
    hp.frequency.value = 1200;
    clickEnv.gain.setValueAtTime(gain * 0.35, at);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    click.connect(hp).connect(clickEnv).connect(out);
    click.start(at, 0, 0.06);
  },

  /** A bright click. For a list row or a caption word arriving. */
  pop(ctx, out, at, gain) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(920, at);
    osc.frequency.exponentialRampToValueAtTime(380, at + 0.12);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + 0.16);
  },

  /** Filtered noise sweeping up. For anything sliding in from an edge. */
  whoosh(ctx, out, at, gain) {
    const src = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = noiseBuffer(ctx);
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(260, at);
    bp.frequency.exponentialRampToValueAtTime(3200, at + 0.4);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain * 0.7, at + 0.12);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    src.connect(bp).connect(env).connect(out);
    src.start(at, 0, 0.5);
  },

  /** A pitch climbing to a stop. For building into a reveal. */
  riser(ctx, out, at, gain) {
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, at);
    osc.frequency.exponentialRampToValueAtTime(1150, at + 0.85);
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, at);
    lp.frequency.exponentialRampToValueAtTime(4800, at + 0.85);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain * 0.5, at + 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
    osc.connect(lp).connect(env).connect(out);
    osc.start(at);
    osc.stop(at + 0.92);
  },

  /** A dry tick. For a step in a process, or a counter. */
  tick(ctx, out, at, gain) {
    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = noiseBuffer(ctx);
    hp.type = "highpass";
    hp.frequency.value = 2600;
    env.gain.setValueAtTime(gain * 0.6, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    src.connect(hp).connect(env).connect(out);
    src.start(at, 0, 0.08);
  },

  /** Two soft tones. For a result, a total, or a positive stat. */
  chime(ctx, out, at, gain) {
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const start = at + i * 0.09;
      osc.type = "sine";
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(gain * (i ? 0.4 : 0.55), start + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.6);
      osc.connect(env).connect(out);
      osc.start(start);
      osc.stop(start + 0.62);
    });
  },
};

/* ------------------------------------------------------------------- mixer */

/**
 * A mixer over one AudioContext, fanning out to any number of destinations.
 *
 * Two destinations is the normal case: the speakers, so the editor hears it,
 * and the export's MediaStreamDestination, so the file has it. Everything
 * routes through one master gain so the whole composition's sound can be
 * pulled down without touching a single track.
 */
export function createMixer(ctx, outputs = []) {
  const master = ctx.createGain();
  master.gain.value = 1;
  for (const out of outputs) {
    try { master.connect(out); } catch { /* a destination already gone */ }
  }

  const beds = new Set();

  return {
    ctx,
    master,

    /** Fire an effect now, or at a context time. */
    sfx(preset, gain = 0.6, at = null) {
      const build = PRESETS[preset];
      if (!build) return false;
      const when = Math.max(ctx.currentTime, at ?? ctx.currentTime);
      try { build(ctx, master, when, Math.max(0, Math.min(1, gain))); return true; }
      catch { return false; }
    },

    /**
     * Start a music bed from a media element, ducked under speech.
     *
     * `speech` is an array of `{ start, end }` in the same timebase as
     * `offset`, straight from the transcript. The envelope is scheduled in one
     * pass rather than watched frame by frame, so it stays exact even if the
     * render loop stutters.
     */
    bed(element, { gain = 0.18, duck = true, speech = [], offset = 0, duckTo = 0.28 } = {}) {
      let source;
      try { source = ctx.createMediaElementSource(element); }
      catch { return null; }

      const node = ctx.createGain();
      source.connect(node).connect(master);

      const now = ctx.currentTime;
      const full = Math.max(0, Math.min(1, gain));
      node.gain.setValueAtTime(full, now);

      if (duck && speech.length) {
        const low = full * duckTo;
        // Merge overlapping and near-adjacent speech, or the bed pumps back up
        // for a tenth of a second between two words and that is worse than not
        // ducking at all.
        const merged = [];
        for (const range of [...speech].sort((a, b) => a.start - b.start)) {
          const last = merged[merged.length - 1];
          if (last && range.start - last.end < 0.45) last.end = Math.max(last.end, range.end);
          else merged.push({ ...range });
        }
        for (const range of merged) {
          const down = now + Math.max(0, range.start - offset) - 0.12;
          const up = now + Math.max(0, range.end - offset);
          if (up <= now) continue;
          node.gain.linearRampToValueAtTime(low, Math.max(now, down));
          node.gain.setValueAtTime(low, Math.max(now, up));
          node.gain.linearRampToValueAtTime(full, Math.max(now, up) + 0.35);
        }
      }

      const bedRef = { source, node, element };
      beds.add(bedRef);
      return {
        stop() {
          try { element.pause(); } catch { /* already gone */ }
          try { node.disconnect(); } catch { /* already gone */ }
          beds.delete(bedRef);
        },
        gain: node,
      };
    },

    stopAll() {
      for (const bed of [...beds]) {
        try { bed.element.pause(); bed.node.disconnect(); } catch { /* already gone */ }
        beds.delete(bed);
      }
    },

    dispose() {
      this.stopAll();
      try { master.disconnect(); } catch { /* already gone */ }
    },
  };
}

/* --------------------------------------------------------------- scheduler */

/**
 * Fire one-shots as a playhead crosses them.
 *
 * Called from the render loop with the playhead in cut seconds. It fires a
 * track once per pass and will not re-fire on a seek backwards until the
 * playhead has crossed it again, because an effect that retriggers every time
 * you scrub over it makes the preview unusable.
 *
 * Beds are started on `open` and stopped on `close`, since a bed is a
 * continuous thing and starting one mid-loop would mean fading it in from
 * wherever the playhead happened to be.
 */
export function createScheduler(mixer, { fps = 30 } = {}) {
  const fired = new Set();
  let last = -1;

  return {
    /** Move without firing anything. Used when the editor seeks. */
    seek(seconds) {
      last = seconds;
      fired.clear();
    },

    /**
     * Advance to `seconds` and fire whatever lies between here and there.
     * `tracks` is the accepted audio for the composition.
     */
    tick(seconds, tracks) {
      if (last < 0) { last = seconds; return; }
      const from = last;
      const to = seconds;
      last = seconds;

      // A jump backwards, or a big jump forwards, is a seek and not playback.
      if (to < from || to - from > 0.6) { fired.clear(); return; }

      for (const track of tracks ?? []) {
        if (track.kind !== "sfx" || track.status !== "accepted") continue;
        const at = track.from / fps;
        if (at >= from && at < to && !fired.has(track.id)) {
          fired.add(track.id);
          mixer.sfx(track.preset, track.gain);
        }
      }
    },

    reset() { fired.clear(); last = -1; },
  };
}

/** The speech ranges a bed should duck under, from a cut-level transcript. */
export const speechRanges = (transcript) =>
  (transcript?.words ?? []).map((w) => ({ start: w.start, end: w.end }));
