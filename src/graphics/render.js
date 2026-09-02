import { roleColour } from "./spec.js";

/**
 * One renderer, two consumers.
 *
 * The preview draws these onto a transparent canvas sitting over the video; the
 * export draws them onto the canvas it is already recording, one line after the
 * frame. Same function, same spec, same pixels, so what you approve is what
 * gets written. The editor's six looks already work this way, one CSS filter
 * string used in both places, and doing it twice for graphics is how a preview
 * and an export quietly drift apart.
 *
 * Everything is drawn from normalised geometry scaled by the canvas size, so a
 * graphic approved on a 480px preview is correct in a 4K export.
 */

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const EASE = { out: easeOut, in_out: easeInOut, linear: (t) => t };

/** 0 while entering, 1 while held, back to 0 while leaving. */
function envelope(progress, easing) {
  const ease = EASE[easing] || easeOut;
  const IN = 0.16;
  const OUT = 0.84;
  if (progress < IN) return ease(progress / IN);
  if (progress > OUT) return ease(Math.max(0, (1 - progress) / (1 - OUT)));
  return 1;
}

/** Anchor a block of a given size, in normalised space, to a named position. */
function anchor(position, w, h, bw, bh) {
  const m = Math.round(w * 0.055);
  switch (position) {
    case "lower_right": return { x: w - bw - m, y: h - bh - m, align: "right" };
    case "upper_left": return { x: m, y: m, align: "left" };
    case "upper_right": return { x: w - bw - m, y: m, align: "right" };
    case "center": return { x: (w - bw) / 2, y: (h - bh) / 2, align: "center" };
    case "bottom_bar": return { x: m, y: h - bh - m, align: "left" };
    default: return { x: m, y: h - bh - m, align: "left" };
  }
}

const fontFor = (px, weight = 700) =>
  `${weight} ${Math.round(px)}px "Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif`;

/** A rounded rectangle. roundRect is not in every canvas implementation yet. */
function panel(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

/** Break text to a maximum width, in as few lines as it takes. */
function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawLowerThird(ctx, g, w, h, t, colour) {
  const slide = (1 - t) * w * 0.06;
  const pad = w * 0.022;
  ctx.font = fontFor(w * 0.042);
  const nameW = ctx.measureText(g.text).width;
  ctx.font = fontFor(w * 0.024, 500);
  const subW = g.subtext ? ctx.measureText(g.subtext).width : 0;
  const bw = Math.max(nameW, subW) + pad * 2;
  const bh = (g.subtext ? w * 0.095 : w * 0.072);
  const { x, y } = anchor(g.position, w, h, bw, bh);

  ctx.save();
  ctx.globalAlpha = t;
  ctx.translate(-slide, 0);

  ctx.fillStyle = "rgba(0,0,0,0.62)";
  panel(ctx, x, y, bw, bh, w * 0.012);
  ctx.fill();

  ctx.fillStyle = colour;
  ctx.fillRect(x, y, Math.max(2, w * 0.005), bh);

  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.font = fontFor(w * 0.042);
  ctx.fillText(g.text, x + pad, y + pad * 0.8);
  if (g.subtext) {
    ctx.fillStyle = colour;
    ctx.font = fontFor(w * 0.024, 500);
    ctx.fillText(g.subtext, x + pad, y + pad * 0.8 + w * 0.048);
  }
  ctx.restore();
}

function drawTitleCard(ctx, g, w, h, t, colour) {
  ctx.save();
  ctx.globalAlpha = t * 0.82;
  ctx.fillStyle = "#0A0C11";
  ctx.fillRect(0, 0, w, h);

  ctx.globalAlpha = t;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const size = w * 0.072;
  ctx.font = fontFor(size, 800);
  const lines = wrap(ctx, g.text, w * 0.8);
  const lineH = size * 1.18;
  const total = lines.length * lineH + (g.subtext ? size * 0.9 : 0);
  let y = h / 2 - total / 2 + lineH / 2;

  // A rise of a few percent of the frame, so it reads as arriving.
  ctx.translate(0, (1 - t) * h * 0.03);
  ctx.fillStyle = "#fff";
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lineH;
  }
  if (g.subtext) {
    ctx.font = fontFor(w * 0.03, 500);
    ctx.fillStyle = colour;
    ctx.fillText(g.subtext, w / 2, y + size * 0.1);
  }
  ctx.restore();
}

function drawCaptionPop(ctx, g, w, h, t, colour, progress) {
  const size = w * 0.05;
  ctx.save();
  ctx.font = fontFor(size, 800);
  const words = String(g.text).split(/\s+/).filter(Boolean);

  // Reveal across the held part of the shot, so the last word is not still
  // arriving as the graphic fades.
  const shown = Math.max(1, Math.ceil(words.length * Math.min(1, progress / 0.7)));
  const line = words.slice(0, shown).join(" ");
  const metrics = ctx.measureText(line);
  const pad = w * 0.018;
  const bw = metrics.width + pad * 2;
  const bh = size * 1.55;
  const x = (w - bw) / 2;
  const y = h - bh - h * 0.08;

  ctx.globalAlpha = t;
  ctx.fillStyle = "rgba(0,0,0,0.66)";
  panel(ctx, x, y, bw, bh, w * 0.01);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cursor = x + pad;
  words.slice(0, shown).forEach((word, i) => {
    ctx.fillStyle = i === shown - 1 ? colour : "#fff";
    ctx.fillText(word, cursor, y + bh / 2);
    cursor += ctx.measureText(`${word} `).width;
  });
  ctx.restore();
}

function drawCalloutArrow(ctx, g, w, h, t, colour) {
  const px = g.point.x * w;
  const py = g.point.y * h;
  const size = w * 0.026;
  ctx.save();
  ctx.globalAlpha = t;

  // The label sits away from the frame edge the point is nearest, so an arrow
  // aimed at a corner does not push its own text off screen.
  const left = g.point.x > 0.5;
  const dx = (left ? -1 : 1) * w * 0.11 * (0.6 + 0.4 * t);
  const dy = -h * 0.1 * (0.6 + 0.4 * t);

  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(px + dx, py + dy);
  ctx.lineTo(px, py);
  ctx.stroke();

  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(px, py, Math.max(3, w * 0.007), 0, Math.PI * 2);
  ctx.fill();

  ctx.font = fontFor(size, 700);
  const tw = ctx.measureText(g.text).width;
  const pad = w * 0.014;
  const bw = tw + pad * 2;
  const bh = size * 2;
  const bx = left ? px + dx - bw : px + dx;
  const by = py + dy - bh;

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  panel(ctx, bx, by, bw, bh, w * 0.008);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(g.text, bx + pad, by + bh / 2);
  ctx.restore();
}

function drawStatBadge(ctx, g, w, h, t, colour, progress) {
  // Count up over the first part of the shot, then hold, so the figure is
  // readable rather than still spinning when it leaves.
  const match = String(g.text).match(/-?[\d.,]+/);
  let shown = g.text;
  if (match) {
    const target = Number(match[0].replace(/,/g, ""));
    if (Number.isFinite(target)) {
      const k = easeOut(Math.min(1, progress / 0.55));
      const value = target % 1 === 0 ? Math.round(target * k) : (target * k).toFixed(1);
      shown = g.text.replace(match[0], String(value));
    }
  }

  const size = w * 0.085;
  ctx.save();
  ctx.font = fontFor(size, 800);
  const nw = ctx.measureText(shown).width;
  ctx.font = fontFor(w * 0.024, 600);
  const sw = g.subtext ? ctx.measureText(g.subtext).width : 0;
  const pad = w * 0.026;
  const bw = Math.max(nw, sw) + pad * 2;
  const bh = size * 1.35 + (g.subtext ? w * 0.04 : 0) + pad * 0.6;
  const { x, y } = anchor(g.position, w, h, bw, bh);

  ctx.globalAlpha = t;
  ctx.translate(0, (1 - t) * h * 0.02);
  ctx.fillStyle = "rgba(0,0,0,0.66)";
  panel(ctx, x, y, bw, bh, w * 0.014);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = colour;
  ctx.font = fontFor(size, 800);
  ctx.fillText(shown, x + bw / 2, y + pad * 0.4);
  if (g.subtext) {
    ctx.fillStyle = "#fff";
    ctx.font = fontFor(w * 0.024, 600);
    ctx.fillText(g.subtext, x + bw / 2, y + pad * 0.4 + size * 1.15);
  }
  ctx.restore();
}

function drawProgressBar(ctx, g, w, h, t, colour, progress) {
  const m = w * 0.055;
  const bw = w - m * 2;
  const bh = Math.max(4, h * 0.012);
  const y = h - m - bh;

  ctx.save();
  ctx.globalAlpha = t;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  panel(ctx, m, y, bw, bh, bh / 2);
  ctx.fill();

  ctx.fillStyle = colour;
  panel(ctx, m, y, Math.max(bh, bw * progress), bh, bh / 2);
  ctx.fill();

  if (g.text) {
    ctx.font = fontFor(w * 0.022, 600);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillText(g.text, m, y - bh);
  }
  ctx.restore();
}

const DRAW = {
  lower_third: drawLowerThird,
  title_card: drawTitleCard,
  caption_pop: drawCaptionPop,
  callout_arrow: drawCalloutArrow,
  stat_badge: drawStatBadge,
  progress_bar: drawProgressBar,
};

/**
 * Draw every graphic that is live at `time`, in seconds along the finished cut.
 *
 * Proposals are drawn too, dimmed and with a dashed frame, so an unconfirmed
 * claim never looks like part of the video. That is the same rule the graph
 * project used for dashed nodes and it is the whole reason a proposal is safe
 * to show at full size.
 */
export function drawGraphics(ctx, w, h, time, graphics, { showProposed = true } = {}) {
  for (const g of graphics) {
    if (g.status === "rejected") continue;
    if (g.status === "proposed" && !showProposed) continue;
    if (time < g.start || time > g.start + g.duration) continue;

    const progress = Math.min(1, Math.max(0, (time - g.start) / g.duration));
    const t = envelope(progress, g.easing);
    if (t <= 0.001) continue;

    const colour = roleColour(g.palette_role);
    ctx.save();
    if (g.status === "proposed") ctx.globalAlpha = 0.75;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    (DRAW[g.type] || (() => {}))(ctx, g, w, h, t, colour, progress);
    ctx.restore();

    if (g.status === "proposed") {
      ctx.save();
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(2, w * 0.003);
      ctx.setLineDash([w * 0.018, w * 0.012]);
      ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
}
