/**
 * Canvas primitives in the app's own form language.
 *
 * Every graphic in the library is drawn from the handful of functions below,
 * which is the only reason they look like one family rather than six people's
 * ideas: the 2px border, the hard offset shadow and the warm near-black all
 * live here once, and a component that wants a box gets them whether it asked
 * or not.
 *
 * Two conventions run through the whole file.
 *
 * **Author at 1080p.** Sizes are written as if the frame's short edge were
 * 1080 and multiplied by `u(width, height)` at draw time. The preview canvas
 * is however many pixels the video box happens to occupy and the export canvas
 * is the delivery size, so a component that reasoned in real pixels would be
 * correct in exactly one of them.
 *
 * **Position is a fraction.** Nothing here takes a pixel coordinate from a
 * spec. That is what lets one composition be 16:9 and 9:16 without a second
 * layout pass.
 */

import { clamp01 } from "./engine.js";

/* ------------------------------------------------------------------- scale */

/**
 * Frames are authored against a 1080 short edge. This is the multiplier.
 *
 * The *narrow* dimension, not the height. Type sized off the height would grow
 * by 78% the moment the same composition was reframed to 9:16, because 1920
 * became the height — so a headline that fitted across a landscape frame would
 * overflow a portrait one that is physically narrower. Scaling on the short
 * edge keeps a graphic the same size relative to the space it actually has.
 */
export const u = (width, height) => Math.min(width, height) / 1080;

/* ------------------------------------------------------------------- fonts */

export const FONTS = {
  display: '700 {size}px "Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif',
  displayHeavy: '800 {size}px "Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif',
  body: '500 {size}px "IBM Plex Sans", system-ui, -apple-system, sans-serif',
  bodyBold: '600 {size}px "IBM Plex Sans", system-ui, -apple-system, sans-serif',
  mono: '500 {size}px "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
};

export const font = (which, size) =>
  (FONTS[which] ?? FONTS.body).replace("{size}", String(Math.max(1, Math.round(size))));

/* ----------------------------------------------------------------- palette */

/**
 * The theme, read once.
 *
 * `getComputedStyle` is a layout read and a graphic can easily want six
 * colours, so doing this per draw call costs a frame budget for values that
 * change when someone hits the theme toggle and at no other time. The renderer
 * snapshots this once per frame and passes it down.
 */
const TOKENS = {
  ground: "--ground",
  ground2: "--ground-2",
  surface: "--surface",
  surface2: "--surface-2",
  ink: "--ink",
  text: "--text",
  textMuted: "--text-muted",
  accent: "--accent",
  accentSoft: "--accent-soft",
  yellow: "--yellow",
  teal: "--teal",
  blue: "--blue",
  purple: "--purple",
  green: "--green",
};

/** What a token falls back to when the stylesheet has not defined it. The
 *  light theme's value, so an un-stamped document still draws in the brand. */
const FALLBACK = {
  ground: "#EEEFE9",
  ground2: "#E4E5DC",
  surface: "#FBFBF7",
  surface2: "#F2F2EC",
  ink: "#2F2F2F",
  text: "#2F2F2F",
  textMuted: "#6B6B63",
  accent: "#F54E00",
  accentSoft: "#FFE9DF",
  yellow: "#F7A501",
  teal: "#30ABC6",
  blue: "#1D4AFF",
  purple: "#B62AD9",
  green: "#29963F",
};

/**
 * A fixed dark palette, for the one graphic that is dark in both themes.
 *
 * The code card is a terminal and a terminal is dark; flipping it to cream in
 * the light theme would make it stop reading as one. These are the dark
 * theme's own token values, pinned here so there is one place to change them
 * rather than six literals inside a drawer.
 */
export const DARK = {
  panel: "#12141B",
  bar: "#232735",
  text: "#EDEEF2",
  muted: "#9BA1B4",
  faint: "#4A5064",
};

export function palette() {
  const style = typeof document !== "undefined"
    ? getComputedStyle(document.documentElement)
    : null;
  const out = {};
  for (const [key, prop] of Object.entries(TOKENS)) {
    out[key] = style?.getPropertyValue(prop).trim() || FALLBACK[key];
  }
  return out;
}

/**
 * Colour is a role, resolved against the live theme.
 *
 * A spec cannot name a hex value, so it cannot name one that clashes with the
 * app or one that vanishes in the other theme. The agent picks "accent" and
 * the theme decides what that means.
 */
export const PALETTE_ROLES = ["accent", "warm", "cool", "positive", "plain", "invert"];

const ROLE_KEY = {
  accent: "accent",
  warm: "yellow",
  cool: "teal",
  positive: "green",
  plain: "text",
  invert: "surface",
};

export const roleColour = (role, pal) => pal[ROLE_KEY[role] ?? "accent"] ?? pal.accent;

/** The readable colour to put on top of a role fill. Roles are saturated
 *  fills, so this is near-black for everything except the plain role, which is
 *  already the text colour and wants the surface behind it. */
export const roleInk = (role, pal) => (role === "plain" ? pal.surface : pal.ink);

/* ------------------------------------------------------------------- boxes */

/** A rounded rectangle path. `roundRect` exists in every browser we target but
 *  not in every canvas mock, so this stays hand-rolled and total. */
export function roundedPath(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * The signature box: flat fill, 2px ink border, hard offset shadow.
 *
 * The shadow is drawn as a second filled path rather than with
 * `ctx.shadowBlur`, because the house shadow has zero blur and a real offset
 * copy is both cheaper and exactly right. Elevation is an offset in authored
 * pixels, matching the scale in styles.css.
 */
export function panel(ctx, x, y, w, h, opts = {}) {
  const {
    fill = "#FBFBF7",
    border = "#2F2F2F",
    shadow = "#2F2F2F",
    radius = 10,
    elevation = 6,
    scale = 1,
    borderWidth = 2,
    alpha = 1,
  } = opts;

  if (w <= 0 || h <= 0 || alpha <= 0) return;

  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * clamp01(alpha);
  const r = radius * scale;

  if (elevation > 0) {
    const off = elevation * scale;
    ctx.fillStyle = shadow;
    roundedPath(ctx, x + off, y + off, w, h, r);
    ctx.fill();
  }

  ctx.fillStyle = fill;
  roundedPath(ctx, x, y, w, h, r);
  ctx.fill();

  if (borderWidth > 0) {
    ctx.lineWidth = borderWidth * scale;
    ctx.strokeStyle = border;
    ctx.stroke();
  }

  ctx.globalAlpha = prev;
}

/* -------------------------------------------------------------------- text */

/**
 * Draw a string, with letter-spacing that works everywhere.
 *
 * `ctx.letterSpacing` is not universal, so positive tracking is drawn glyph by
 * glyph. Only the uppercase mono labels ask for it and they are short, so the
 * per-character path costs nothing where it is used and is skipped where it is
 * not.
 */
export function label(ctx, str, x, y, opts = {}) {
  const {
    family = "body",
    size = 32,
    colour = "#2F2F2F",
    align = "left",
    baseline = "alphabetic",
    tracking = 0,
    alpha = 1,
    scale = 1,
  } = opts;

  const text = String(str ?? "");
  if (!text || alpha <= 0) return 0;

  const px = size * scale;
  ctx.font = font(family, px);
  ctx.fillStyle = colour;
  ctx.textBaseline = baseline;

  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * clamp01(alpha);

  if (!tracking) {
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = prev;
    return ctx.measureText(text).width;
  }

  const gap = tracking * px;
  const width = measure(ctx, text, { family, size, tracking, scale });
  let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  ctx.textAlign = "left";
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + gap;
  }
  ctx.globalAlpha = prev;
  return width;
}

/**
 * Width of a string, tracking included.
 *
 * Takes an authored size and a scale, exactly as `label` does. Every geometry
 * bug in a canvas layout comes from one function wanting real pixels while its
 * neighbour wants authored ones, so both take the same pair.
 */
export function measure(ctx, str, { family = "body", size = 32, tracking = 0, scale = 1 } = {}) {
  const text = String(str ?? "");
  const px = size * scale;
  ctx.font = font(family, px);
  const base = ctx.measureText(text).width;
  return tracking ? base + tracking * px * Math.max(0, text.length - 1) : base;
}

/** Greedy wrap to a pixel width. Words longer than the line are left to
 *  overflow rather than hyphenated: a graphic with one enormous word is a
 *  content problem the editor can see and fix. */
export function wrap(ctx, str, maxWidth, { family = "body", size = 32, scale = 1 } = {}) {
  ctx.font = font(family, size * scale);
  const words = String(str ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth) line = candidate;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  return lines;
}

/* ------------------------------------------------------------------ layout */

/**
 * Where a named position lands, as a fraction of the frame.
 *
 * Returns the anchor point plus which corner of the graphic that point is, so
 * a component can place itself without knowing its own size until it has
 * measured its text. Vertical eats more margin than landscape does, which is
 * the whole reason `safe` is a per-format number.
 */
export const POSITIONS = [
  "lower_left",
  "lower_right",
  "upper_left",
  "upper_right",
  "center",
  "bottom_bar",
  "top_bar",
];

export function anchor(position, { width, height, safe = 0.05 }) {
  const mx = width * safe;
  const my = height * safe;
  switch (position) {
    case "upper_left": return { x: mx, y: my, ax: 0, ay: 0 };
    case "upper_right": return { x: width - mx, y: my, ax: 1, ay: 0 };
    case "lower_right": return { x: width - mx, y: height - my, ax: 1, ay: 1 };
    case "center": return { x: width / 2, y: height / 2, ax: 0.5, ay: 0.5 };
    case "bottom_bar": return { x: width / 2, y: height - my, ax: 0.5, ay: 1 };
    case "top_bar": return { x: width / 2, y: my, ax: 0.5, ay: 0 };
    case "lower_left":
    default: return { x: mx, y: height - my, ax: 0, ay: 1 };
  }
}

/** Turn an anchor plus a measured size into a top-left corner. */
export const box = (a, w, h) => ({ x: a.x - w * a.ax, y: a.y - h * a.ay });

/* ------------------------------------------------------------------ scrims */

/** A flat wash over the whole frame. Used by the title card, so a headline
 *  stays legible over footage nobody graded for it. */
export function scrim(ctx, width, height, colour, alpha) {
  if (alpha <= 0) return;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = prev * clamp01(alpha);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = prev;
}

/** Save, run, restore. Every component draws inside one of these so a stray
 *  transform or alpha cannot leak into the next graphic on the frame. */
export function isolate(ctx, fn) {
  ctx.save();
  try { fn(); } finally { ctx.restore(); }
}
