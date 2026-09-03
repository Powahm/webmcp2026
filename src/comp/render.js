/**
 * Draw one frame of a composition.
 *
 * One function, called from two places: the preview loop in the Composition
 * tab and the export loop that writes the file. That is deliberate and it is
 * the reason the preview cannot quietly stop matching the output — there is no
 * second renderer to drift. The editor already proved the pattern with its six
 * looks, which are a CSS filter string in the preview and the identical string
 * on the canvas at export.
 *
 * The frame is the only input that changes. Given the same frame number and
 * the same layers this produces the same pixels, every time, which is what
 * makes scrubbing exact and lets the export render frame 512 without having
 * rendered 511.
 */

import { componentFor } from "./components.js";
import { activeAt, formatOf, FPS, keyedAt, resolve } from "./engine.js";
import { isolate, palette, roleColour, roleInk, u } from "./paint.js";

/**
 * A proposal is drawn, not described.
 *
 * The only useful question about a proposed graphic is what it looks like over
 * this footage at this moment, so it previews live and at nearly full
 * strength. The dashes and the slight transparency are the whole of the
 * difference, and they are enough: nobody has ever mistaken a dashed overlay
 * for a finished one.
 */
const PROPOSED_ALPHA = 0.8;

/**
 * Draw the layers of a composition onto a context.
 *
 * `width`/`height` are the real pixel size of the target, which is the video
 * box in the preview and the export canvas at export. Components author
 * against a 1080-tall frame and are scaled here, so one spec is correct at
 * both without knowing either exists.
 */
/**
 * A layer's props at one frame, with any keyframes applied.
 *
 * `x` and `y` fold back into `point`, because that is the field a component
 * reads and a keyframe should not be a second way of saying where something
 * is. With no keys this returns the props untouched and costs one comparison.
 */
function keyedProps(node, local) {
  const base = node.props ?? {};
  const keys = node.keys;
  if (!Array.isArray(keys) || keys.length === 0) return base;

  const now = keyedAt(keys, local, node.easing);
  if (!now) return base;

  const out = { ...base };
  if (Number.isFinite(now.width)) out.width = now.width;
  if (Number.isFinite(now.height)) out.height = now.height;
  if (Number.isFinite(now.rotation)) out.rotation = now.rotation;
  if (Number.isFinite(now.opacity)) out.opacity = now.opacity;
  if (Number.isFinite(now.x) || Number.isFinite(now.y)) {
    const p = base.point ?? {};
    out.point = {
      x: Number.isFinite(now.x) ? now.x : (Number(p.x) || 0.5),
      y: Number.isFinite(now.y) ? now.y : (Number(p.y) || 0.5),
    };
  }
  // A keyframed layer animates from its keys, so the component's own entrance
  // would fight it. Anything with keys is told to hold still and be placed.
  if (out.animation == null) out.animation = "none";
  return out;
}

export function renderComposition(ctx, opts = {}) {
  const {
    width,
    height,
    frame,
    layers = [],
    format = "landscape",
    fps = FPS,
    showProposed = true,
    pal = palette(),
    guides = false,
  } = opts;

  if (!(width > 0) || !(height > 0)) return;

  const { safe } = formatOf(format);
  const scale = u(width, height);

  const resolved = resolve(layers);
  const active = activeAt(resolved, frame);

  let anyProposed = false;

  for (const entry of active) {
    const { node } = entry;
    if (node.status === "rejected") continue;
    const proposed = node.status === "proposed";
    if (proposed && !showProposed) continue;
    if (proposed) anyProposed = true;

    const component = componentFor(node.component);
    if (!component) continue;

    const role = node.palette_role ?? "accent";

    isolate(ctx, () => {
      ctx.globalAlpha = proposed ? PROPOSED_ALPHA : 1;
      // Reset the text state every layer. A component that sets textAlign and
      // does not put it back would otherwise silently move the next graphic.
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.lineJoin = "round";

      // Keyframes are resolved here rather than in each component, so every
      // graphic gains them at once and none of them has to know they exist.
      const local = frame - entry.from;
      const props = keyedProps(node, local);

      try {
        component.draw(ctx, {
          frame: local,
          durationInFrames: entry.durationInFrames,
          fps,
          width,
          height,
          scale,
          safe,
          pal,
          props,
          position: node.position ?? component.defaults.position,
          role,
          colour: roleColour(role, pal),
          ink: roleInk(role, pal),
          easing: node.easing ?? "out",
        });
      } catch {
        // A component that throws loses its own frame and nothing else. The
        // alternative is one bad prop taking down the preview loop, and a
        // preview that has stopped is far harder to diagnose than a graphic
        // that is missing.
      }
    });
  }

  if (guides) drawGuides(ctx, width, height, safe, pal);
  if (anyProposed) drawProposedEdge(ctx, width, height, pal);
}

/**
 * The dashed edge that says "not in the video yet".
 *
 * Drawn once around the frame rather than once per graphic. Three pending
 * proposals should read as one unresolved question about this moment, not as
 * three boxes competing for the same border.
 */
function drawProposedEdge(ctx, width, height, pal) {
  isolate(ctx, () => {
    const lw = Math.max(2, width * 0.003);
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = lw;
    ctx.strokeStyle = pal.accent;
    ctx.setLineDash([width * 0.018, width * 0.012]);
    ctx.strokeRect(lw, lw, width - lw * 2, height - lw * 2);
  });
}

/**
 * Safe-area guides, shown while the format is being chosen.
 *
 * The inner rectangle is where text is guaranteed to survive a platform's own
 * chrome. It is the only reason reframing to vertical is a decision rather
 * than a surprise, because the margin that is generous at 16:9 is where a
 * caption goes to die at 9:16.
 */
function drawGuides(ctx, width, height, safe, pal) {
  isolate(ctx, () => {
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, width * 0.0018);
    ctx.strokeStyle = pal.accent;
    ctx.setLineDash([width * 0.01, width * 0.008]);
    ctx.strokeRect(width * safe, height * safe, width * (1 - safe * 2), height * (1 - safe * 2));

    ctx.setLineDash([]);
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
  });
}

/**
 * The letterbox a format change implies.
 *
 * The footage is whatever aspect it was shot at and the composition is
 * whichever the creator chose, so reframing to vertical means deciding what
 * happens to the sides. Cover, because a 16:9 take in a 9:16 frame with bars
 * down both sides is not a vertical video, it is a landscape video someone
 * gave up on. Returns the rectangle to draw the video into.
 */
export function fitVideo(videoW, videoH, frameW, frameH, mode = "cover") {
  if (!(videoW > 0) || !(videoH > 0)) return { x: 0, y: 0, w: frameW, h: frameH };
  const scale = mode === "contain"
    ? Math.min(frameW / videoW, frameH / videoH)
    : Math.max(frameW / videoW, frameH / videoH);
  const w = videoW * scale;
  const h = videoH * scale;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
}
