/**
 * The composition engine.
 *
 * Frames, not seconds. Everything below counts in integer frames at a fixed
 * fps, and that one decision is what the rest of the editor rests on:
 *
 *   - a frame renders the same every time it is asked for, so scrubbing
 *     backwards looks identical to playing forwards and the export cannot
 *     drift out of step with the preview;
 *   - "two seconds longer" is +60, an exact number, rather than a float that
 *     lands halfway through a frame and shimmers;
 *   - a graphic's animation is a pure function of its own local frame, so it
 *     has no state to get wrong when the playhead jumps.
 *
 * Seconds still exist at the edges, because that is what people and clips
 * speak, and `toFrames`/`toSeconds` are the only places the two meet.
 *
 * Nothing here touches the DOM or the canvas. It is arithmetic, which means it
 * is the part of the editor that can be reasoned about without running it.
 */

export const FPS = 30;

/* ------------------------------------------------------------------ formats */

/**
 * One composition, three shapes.
 *
 * Geometry in a spec is always a fraction of the frame, never a pixel, so
 * changing format is a metadata change and not a re-layout. `safe` is the
 * margin a caption must stay inside: wider on vertical, because that is where
 * a platform's own chrome eats the edges.
 */
export const FORMATS = {
  landscape: { label: "16:9", width: 1920, height: 1080, safe: 0.05 },
  vertical: { label: "9:16", width: 1080, height: 1920, safe: 0.11 },
  square: { label: "1:1", width: 1080, height: 1080, safe: 0.07 },
};

export const FORMAT_NAMES = Object.keys(FORMATS);

export const formatOf = (name) => FORMATS[name] ?? FORMATS.landscape;

/* -------------------------------------------------------------------- time */

/** Seconds in, whole frames out. Rounds, because a fractional frame is not a
 *  thing that can be drawn. */
export const toFrames = (seconds, fps = FPS) =>
  Math.max(0, Math.round((Number(seconds) || 0) * fps));

export const toSeconds = (frames, fps = FPS) => (Number(frames) || 0) / fps;

/** Timecode for a frame, `m:ss.ff`. Frames are shown because this engine can
 *  address them, and an editor who cannot see the frame cannot trim to it. */
export function frameCode(frame, fps = FPS) {
  const f = Math.max(0, Math.round(Number(frame) || 0));
  const total = Math.floor(f / fps);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}.${String(f % fps).padStart(2, "0")}`;
}

/* ----------------------------------------------------------------- easings */

/**
 * A CSS cubic-bezier, as a function of t.
 *
 * Four control values, the same four `cubic-bezier()` takes, so a curve here
 * and the matching curve in styles.css are the same curve rather than two
 * things that look similar. Solving x for t is Newton against the x
 * polynomial; four steps is plenty at frame resolution.
 */
const cubicBezier = (x1, y1, x2, y2) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const xAt = (t) => ((ax * t + bx) * t + cx) * t;
  const dxAt = (t) => (3 * ax * t + 2 * bx) * t + cx;

  return (input) => {
    const target = Math.max(0, Math.min(1, input));
    let t = target;
    for (let i = 0; i < 5; i++) {
      const d = dxAt(t);
      if (Math.abs(d) < 1e-7) break;
      const next = t - (xAt(t) - target) / d;
      if (Math.abs(next - t) < 1e-7) { t = next; break; }
      t = next;
    }
    t = Math.max(0, Math.min(1, t));
    return ((ay * t + by) * t + cy) * t;
  };
};

/**
 * The easings a spec may name.
 *
 * Deliberately short. These are the two curves the app's own CSS uses, plus
 * linear for anything tied to real time, and an agent choosing between three
 * named curves picks a good one far more reliably than one handed a bezier.
 */
export const EASINGS = {
  linear: (t) => t,
  // --ease-out in styles.css. Fast out of the gate, settles gently.
  out: cubicBezier(0.22, 1, 0.36, 1),
  in_out: cubicBezier(0.65, 0, 0.35, 1),
  // --ease-spring. Overshoots past 1, which is why it is not the default: a
  // component using it for opacity would clip, and for position it is exactly
  // the point.
  spring_out: cubicBezier(0.34, 1.4, 0.5, 1),
};

export const EASING_NAMES = Object.keys(EASINGS);

export const easingOf = (name) => EASINGS[name] ?? EASINGS.out;

/* ------------------------------------------------------------- interpolate */

/**
 * Map a frame onto a value along a range.
 *
 * Clamps at both ends by default. Extending past the range is the more
 * general behaviour but the less useful one here: an opacity that keeps
 * climbing past 1 or a position that keeps sliding off frame is a bug every
 * time, and the cost of clamping is that a spec asking for overshoot has to
 * say so through the easing, which is where overshoot belongs anyway.
 */
export function interpolate(input, inputRange, outputRange, options = {}) {
  const { easing = "linear", clamp = true } = options;
  const inR = inputRange, outR = outputRange;

  if (inR.length !== outR.length || inR.length < 2) {
    throw new Error("interpolate needs input and output ranges of the same length, at least 2 long");
  }

  // A name or a function, because a spec can only ever send a name but the
  // components are entitled to a curve of their own.
  const ease = typeof easing === "function" ? easing : easingOf(easing);

  const x = Number(input);
  if (clamp) {
    if (x <= inR[0]) return outR[0];
    if (x >= inR[inR.length - 1]) return outR[outR.length - 1];
  }

  let i = 0;
  while (i < inR.length - 2 && x >= inR[i + 1]) i++;

  const span = inR[i + 1] - inR[i];
  const t = span === 0 ? 0 : (x - inR[i]) / span;
  return outR[i] + (outR[i + 1] - outR[i]) * ease(t);
}

/* ----------------------------------------------------------------- springs */

export const SPRING_DEFAULT = { damping: 12, mass: 1, stiffness: 140 };

/**
 * A damped harmonic oscillator, sampled at a frame.
 *
 * The analytical solution rather than a stepped simulation, because a
 * simulation has to be run from frame zero to be correct and this has to
 * answer for frame 43 on its own the instant someone drags the playhead there.
 */
export function spring({
  frame,
  fps = FPS,
  config = {},
  from = 0,
  to = 1,
  delay = 0,
  velocity = 0,
} = {}) {
  const { damping, mass, stiffness } = { ...SPRING_DEFAULT, ...config };
  const t = Math.max(0, (Number(frame) || 0) - delay);
  if (t === 0) return from;

  const x0 = to - from;
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const omega0 = Math.sqrt(stiffness / mass) / fps;

  if (zeta < 1) {
    const omega1 = omega0 * Math.sqrt(1 - zeta * zeta);
    const envelope = Math.exp(-zeta * omega0 * t);
    return (
      to -
      envelope *
        (((-velocity + zeta * omega0 * x0) / omega1) * Math.sin(omega1 * t) +
          x0 * Math.cos(omega1 * t))
    );
  }
  const envelope = Math.exp(-omega0 * t);
  return to - envelope * (x0 + (-velocity + omega0 * x0) * t);
}

/* --------------------------------------------------------------- sequences */

/**
 * Flatten a nested composition into absolute frame windows.
 *
 * A node's `from` is relative to its parent, exactly as a Sequence's is, so a
 * group of graphics can be moved as a unit by changing one number. Resolution
 * turns that convenience back into the absolute windows the renderer wants,
 * once, rather than walking the tree on every frame.
 *
 * A child is also clipped to its parent's window. A caption that outlives the
 * scene it belongs to is a mistake, not an effect, and containment is what
 * makes "hold this whole section two seconds longer" mean something.
 */
export function resolve(layers, { from = 0, until = Infinity, depth = 0 } = {}) {
  const out = [];
  if (depth > 6) return out;

  for (const node of layers ?? []) {
    if (!node || node.enabled === false) continue;

    const start = from + (Number(node.from) || 0);
    const length = Number(node.durationInFrames);
    const end = Number.isFinite(length)
      ? Math.min(start + Math.max(1, length), until)
      : until;
    if (end <= start) continue;

    if (node.children?.length) {
      out.push(...resolve(node.children, { from: start, until: end, depth: depth + 1 }));
    }
    if (node.component) {
      out.push({ node, from: start, to: end, durationInFrames: end - start });
    }
  }
  return out;
}

/** The resolved entries covering a frame, in draw order. */
export const activeAt = (resolved, frame) =>
  resolved.filter((r) => frame >= r.from && frame < r.to);

/** How long a resolved composition runs. Zero layers is zero frames, and the
 *  caller decides whether that means "empty" or "just the video". */
export const durationOf = (resolved) =>
  resolved.reduce((max, r) => Math.max(max, r.to), 0);

/**
 * Lay nodes end to end, each starting where the last finished.
 *
 * Remotion calls this a Series and it is the single most useful thing a
 * timeline can do for you, because the alternative is recomputing every
 * downstream `from` by hand the moment one card gets a beat longer.
 */
export function series(nodes, { gap = 0 } = {}) {
  let cursor = 0;
  return (nodes ?? []).map((node) => {
    const length = Math.max(1, Number(node.durationInFrames) || 1);
    const placed = { ...node, from: cursor, durationInFrames: length };
    cursor += length + gap;
    return placed;
  });
}

/* ----------------------------------------------------------------- helpers */

/**
 * The three numbers every component wants and none should compute itself.
 *
 * `progress` is where we are through the node, 0 to 1. `enter` and `exit` ramp
 * over a handful of frames at each end and are clamped so a node shorter than
 * its own handles still resolves to something sane rather than a negative
 * opacity. Centralising this is why every graphic in the library animates in
 * at the same speed without any of them agreeing to.
 */
export function phase(frame, durationInFrames, { enter = 10, exit = 10, easing = "linear" } = {}) {
  const d = Math.max(1, durationInFrames);
  const inF = Math.min(enter, Math.floor(d / 2));
  const outF = Math.min(exit, Math.floor(d / 2));
  // The spec's easing is applied here, once, which is what makes it mean
  // something for all eleven components rather than only the ones that
  // remembered to look at it.
  const ease = easingOf(easing);
  const ramp = (t) => ease(Math.max(0, Math.min(1, t)));
  return {
    progress: Math.max(0, Math.min(1, frame / d)),
    enter: inF <= 0 ? 1 : ramp(frame / inF),
    exit: outF <= 0 ? 1 : ramp((d - frame) / outF),
  };
}

export const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
