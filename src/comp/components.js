/**
 * The component library.
 *
 * Eleven graphics, each a pure function of its own local frame. A component
 * gets told what frame it is on and what its props are, and draws; it holds no
 * state, reads no clock and never looks at the composition around it. That is
 * what makes dragging the playhead backwards produce the same picture as
 * playing forwards into it, and it is why the export can render frame 512
 * without having rendered 511.
 *
 * Each entry declares its own `fields`, which is the single description of
 * that component in the whole app. Validation reads it, the inspector builds
 * its form from it, the code generator types its props from it and the WebMCP
 * tool description is generated from it. There is no second list to forget to
 * update.
 *
 * `needs` is what a component is useless without and `uses` is what it will
 * take if offered. A proposal missing something in `needs` comes back with a
 * hint naming the field, because an agent told "invalid input" gives up and an
 * agent told which field to send simply retries.
 */

import { clamp01, interpolate, phase, spring } from "./engine.js";
import {
  anchor, box, DARK, font, FONTS, isHex, isolate, label, measure, PALETTE_ROLES,
  panel, roleColour, roundedPath, scrim, wrap,
} from "./paint.js";

/* ----------------------------------------------------------------- helpers */

/**
 * Reveal an item in a list, `index` places down, on its own delay.
 *
 * A list whose rows all arrive together reads as one block and there is no
 * reason to animate it at all. Staggering is the difference between a graphic
 * that lands and a graphic that appears.
 */
const stagger = (frame, index, { every = 5, over = 12 } = {}) =>
  clamp01(interpolate(frame - index * every, [0, over], [0, 1], { easing: "out" }));

/** Split a `props.items` value into rows. Accepts an array or newline text,
 *  because an agent sending a list as a string is a near-certainty and failing
 *  the call over it would be pedantry. */
export function rows(items, limit = 6) {
  if (Array.isArray(items)) return items.map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, limit);
  return String(items ?? "")
    .split(/\r?\n|\s*[;·•]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/** The count-up used by the stat badge: find the number inside a string, walk
 *  it up from zero, and put it back where it was so "$1.2M" and "40%" keep
 *  their furniture. */
function countUp(text, k) {
  const str = String(text ?? "");
  const match = str.match(/-?[\d.,]+/);
  if (!match) return str;
  const raw = match[0].replace(/,/g, "");
  const target = Number(raw);
  if (!Number.isFinite(target)) return str;
  const now = target * k;
  const shown = Number.isInteger(target) ? String(Math.round(now)) : now.toFixed(1);
  return str.replace(match[0], shown);
}

/* -------------------------------------------------------------- components */

/**
 * A full-frame headline over a wash.
 *
 * The wash is the point. A title over ungraded footage is unreadable half the
 * time, and dimming the frame is what makes one spec safe over any clip.
 */
const TitleCard = {
  key: "title_card",
  name: "TitleCard",
  blurb: "A full-frame headline over a dimmed wash, with an optional line under it. For an opening or a chapter break.",
  needs: ["text"],
  uses: ["subtext", "eyebrow"],
  defaults: { durationInFrames: 105, position: "center", palette_role: "accent" },
  fields: {
    text: { type: "string", max: 90, note: "The headline. Six words is a headline; twenty is a paragraph." },
    subtext: { type: "string", max: 120, note: "One line under the headline." },
    eyebrow: { type: "string", max: 32, note: "A small tracked label above it: a chapter number, a section name." },
    font: { type: "string", note: 'The headline\'s typeface. One of: display, displayHeavy, body, bodyBold, mono. Defaults to displayHeavy; the eyebrow and subtext keep their own weight.' },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D } = f;
    const { enter, exit } = phase(frame, D, { enter: 14, exit: 12, easing: f.easing });
    const alpha = Math.min(enter, exit);
    const rise = (1 - enter) * 40 * s;
    const family = FONTS[props.font] ? props.font : "displayHeavy";

    scrim(ctx, W, H, pal.ink, alpha * 0.82);

    const lines = wrap(ctx, props.text, W * 0.78, { family, size: 76, scale: s });
    const lh = 88 * s;
    let y = H / 2 - ((lines.length - 1) * lh) / 2 + rise;

    if (props.eyebrow) {
      label(ctx, props.eyebrow.toUpperCase(), W / 2, y - lh * 0.85, {
        family: "mono", size: 24, colour, align: "center", tracking: 0.07, alpha, scale: s,
      });
    }

    for (const line of lines) {
      label(ctx, line, W / 2, y, {
        family, size: 76, colour: pal.surface, align: "center", baseline: "middle", alpha, scale: s,
      });
      y += lh;
    }

    // The rule grows out of the centre, which is the only moving part once the
    // text has settled. One thing moving reads as deliberate; three reads as a
    // template.
    const ruleW = interpolate(frame, [6, 26], [0, 180 * s], { easing: "out" });
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour;
    ctx.fillRect(W / 2 - ruleW / 2, y - lh * 0.45, ruleW, 6 * s);
    ctx.globalAlpha = 1;

    if (props.subtext) {
      label(ctx, props.subtext, W / 2, y + 14 * s, {
        family: "body", size: 30, colour: pal.surface, align: "center", baseline: "middle", alpha: alpha * 0.85, scale: s,
      });
    }
  },
};

/** A name and a role, sliding in on a spring. */
const LowerThird = {
  key: "lower_third",
  name: "LowerThird",
  blurb: "A name and a role on a panel at the lower left. For introducing a person, a place or a tool.",
  needs: ["text"],
  uses: ["subtext"],
  defaults: { durationInFrames: 120, position: "lower_left", palette_role: "accent" },
  fields: {
    text: { type: "string", max: 60, note: "The name. The big line." },
    subtext: { type: "string", max: 80, note: "The role, the title, the one-line description." },
    font: { type: "string", note: "The name's typeface. One of: display, displayHeavy, body, bodyBold, mono. Defaults to display; the role line stays body." },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D, fps, safe } = f;
    const { enter, exit } = phase(frame, D, { enter: 16, exit: 10, easing: f.easing });
    const slide = spring({ frame, fps, from: -0.35, to: 0, config: { damping: 14, stiffness: 150 } });
    const family = FONTS[props.font] ? props.font : "display";

    const nameW = measure(ctx, props.text, { family, size: 46, scale: s });
    const roleW = props.subtext ? measure(ctx, props.subtext, { family: "body", size: 28, scale: s }) : 0;
    const padX = 34 * s;
    const w = Math.max(nameW, roleW) + padX * 2 + 14 * s;
    const h = (props.subtext ? 126 : 88) * s;

    const a = anchor(f.position, { width: W, height: H, safe });
    const { x, y } = box(a, w, h);

    isolate(ctx, () => {
      ctx.translate(slide * W, 0);
      panel(ctx, x, y, w, h, {
        fill: pal.surface, border: pal.ink, shadow: pal.ink,
        radius: 10, elevation: 6, scale: s, alpha: Math.min(enter, exit),
      });

      // The role colour arrives as a rule, not as a fill. A saturated panel
      // behind small text is the fastest way to make a lower third unreadable.
      ctx.globalAlpha = Math.min(enter, exit);
      ctx.fillStyle = colour;
      ctx.fillRect(x, y + 10 * s, 8 * s, h - 20 * s);
      ctx.globalAlpha = 1;

      const alpha = Math.min(enter, exit);
      label(ctx, props.text, x + padX, y + (props.subtext ? 52 : 48) * s, {
        family, size: 46, colour: pal.text, baseline: "middle", alpha, scale: s,
      });
      if (props.subtext) {
        label(ctx, props.subtext, x + padX, y + 92 * s, {
          family: "body", size: 28, colour: pal.textMuted, baseline: "middle", alpha, scale: s,
        });
      }
    });
  },
};

/**
 * Words appearing one at a time.
 *
 * This is the component the transcript exists for. Given word timings it lands
 * each word on the frame it is actually spoken; given none it spreads them over
 * its own duration, which looks fine and is never quite right.
 */
const CaptionPop = {
  key: "caption_pop",
  name: "CaptionPop",
  blurb: "Words appearing one at a time along the bottom, in time with speech. Pass word timings from the transcript and each word lands on the frame it is said.",
  needs: ["text"],
  uses: ["timings"],
  defaults: { durationInFrames: 75, position: "bottom_bar", palette_role: "accent" },
  fields: {
    text: { type: "string", max: 120, note: "The line being said. Keep it to what fits on two rows." },
    timings: {
      type: "number[]",
      note: "Optional. One frame number per word, from get_transcript, relative to this layer's start. Without it the words are spread evenly, which is close but never exact.",
    },
    font: { type: "string", note: "One of: display, displayHeavy, body, bodyBold, mono. Defaults to display." },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D, safe } = f;
    const { exit } = phase(frame, D, { enter: 4, exit: 8, easing: f.easing });
    const family = FONTS[props.font] ? props.font : "display";

    const words = String(props.text ?? "").split(/\s+/).filter(Boolean);
    if (!words.length) return;

    const timings = Array.isArray(props.timings) && props.timings.length === words.length
      ? props.timings
      : words.map((_, i) => (i * D * 0.72) / words.length);

    const size = 44;
    const gap = 14 * s;
    const chipH = 74 * s;
    const padX = 20 * s;

    // Lay the words out first, wrapping to rows, then draw. Measuring during
    // the draw pass is what makes a caption jitter as words arrive.
    const maxW = W * (1 - safe * 2);
    const laid = [];
    let rowW = 0, row = 0;
    for (let i = 0; i < words.length; i++) {
      const wWidth = measure(ctx, words[i], { family, size, scale: s }) + padX * 2;
      if (rowW + wWidth > maxW && rowW > 0) { row++; rowW = 0; }
      laid.push({ word: words[i], row, x: rowW, w: wWidth, at: timings[i] });
      rowW += wWidth + gap;
    }
    const rowCount = row + 1;
    const rowWidths = Array.from({ length: rowCount }, (_, r) => {
      const inRow = laid.filter((l) => l.row === r);
      return inRow.reduce((sum, l) => sum + l.w + gap, 0) - gap;
    });

    const baseY = H * (1 - safe) - chipH * rowCount - gap * (rowCount - 1);

    for (const item of laid) {
      const k = clamp01(interpolate(frame - item.at, [0, 6], [0, 1], { easing: "out" }));
      if (k <= 0.01) continue;
      const pop = 0.92 + 0.08 * k;
      const x = (W - rowWidths[item.row]) / 2 + item.x;
      const y = baseY + item.row * (chipH + gap);
      // The word being said is the accent one. Everything already said stays
      // on screen in the plain fill, so the line reads as a sentence rather
      // than as a slot machine.
      const current = frame >= item.at && frame < item.at + 10;
      isolate(ctx, () => {
        ctx.translate(x + item.w / 2, y + chipH / 2);
        ctx.scale(pop, pop);
        ctx.translate(-item.w / 2, -chipH / 2);
        panel(ctx, 0, 0, item.w, chipH, {
          fill: current ? colour : pal.surface, border: pal.ink, shadow: pal.ink,
          radius: 8, elevation: 4, scale: s, alpha: k * exit,
        });
        label(ctx, item.word, item.w / 2, chipH / 2, {
          family, size, align: "center", baseline: "middle",
          colour: current ? f.ink : pal.text,
          alpha: k * exit, scale: s,
        });
      });
    }
  },
};

/** A list that arrives row by row. */
const BulletList = {
  key: "bullet_list",
  name: "BulletList",
  blurb: "A titled list whose rows arrive one at a time. For anything you say as 'three things' or 'first, second, third'.",
  needs: ["items"],
  uses: ["text"],
  defaults: { durationInFrames: 150, position: "center", palette_role: "accent" },
  fields: {
    text: { type: "string", max: 60, note: "Optional heading above the list." },
    items: { type: "string[]", max: 6, note: "The rows. Up to six, each short enough to read at a glance." },
    font: { type: "string", note: "The rows' typeface. One of: display, displayHeavy, body, bodyBold, mono. Defaults to body; the optional heading stays display." },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D, safe } = f;
    const { enter, exit } = phase(frame, D, { enter: 12, exit: 10, easing: f.easing });
    const list = rows(props.items, 6);
    if (!list.length) return;

    const size = 38;
    const rowH = 66 * s;
    const padX = 44 * s;
    const padY = 40 * s;
    const headH = props.text ? 74 * s : 0;
    const family = FONTS[props.font] ? props.font : "body";

    const widest = list.reduce(
      (max, r) => Math.max(max, measure(ctx, r, { family, size, scale: s })),
      props.text ? measure(ctx, props.text, { family: "display", size: 46, scale: s }) : 0
    );
    const w = Math.min(W * (1 - safe * 2), widest + padX * 2 + 54 * s);
    const h = headH + list.length * rowH + padY * 2;

    const a = anchor(f.position, { width: W, height: H, safe });
    const { x, y } = box(a, w, h);

    panel(ctx, x, y, w, h, {
      fill: pal.surface, border: pal.ink, shadow: pal.ink,
      radius: 12, elevation: 7, scale: s, alpha: Math.min(enter, exit),
    });

    if (props.text) {
      label(ctx, props.text, x + padX, y + padY + 30 * s, {
        family: "display", size: 46, colour: pal.text, baseline: "middle", alpha: Math.min(enter, exit), scale: s,
      });
    }

    list.forEach((text, i) => {
      const k = stagger(frame, i, { every: 7, over: 14 }) * exit;
      if (k <= 0.01) return;
      const rowY = y + padY + headH + i * rowH + rowH / 2;
      const slide = (1 - k) * 26 * s;

      // A square, not a disc. The app's form language is corners.
      ctx.globalAlpha = k;
      ctx.fillStyle = colour;
      ctx.fillRect(x + padX - slide, rowY - 9 * s, 18 * s, 18 * s);
      ctx.globalAlpha = 1;

      label(ctx, text, x + padX + 38 * s - slide, rowY, {
        family, size, colour: pal.text, baseline: "middle", alpha: k, scale: s,
      });
    });
  },
};

/** Two or three cards side by side. */
const ComparisonCards = {
  key: "comparison_cards",
  name: "ComparisonCards",
  blurb: "Two or three bordered cards side by side, each with a heading and a line. For 'before and after', 'this versus that', or a set of options.",
  needs: ["items"],
  uses: ["text"],
  defaults: { durationInFrames: 150, position: "center", palette_role: "accent" },
  fields: {
    text: { type: "string", max: 60, note: "Optional heading above the cards." },
    items: {
      type: "string[]",
      max: 3,
      note: "One entry per card. Write each as 'Heading: the line under it'; a colon, en dash, or pipe splits them.",
    },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D, fps, safe } = f;
    const { enter, exit } = phase(frame, D, { enter: 12, exit: 10, easing: f.easing });
    const list = rows(props.items, 3);
    if (!list.length) return;

    const gap = 28 * s;
    const totalW = W * (1 - safe * 2);
    const cardW = (totalW - gap * (list.length - 1)) / list.length;
    const cardH = 300 * s;
    const headH = props.text ? 80 * s : 0;
    const top = H / 2 - cardH / 2 + headH / 2;

    if (props.text) {
      label(ctx, props.text, W / 2, top - headH * 0.55, {
        family: "display", size: 48, colour: pal.text, align: "center", baseline: "middle",
        alpha: Math.min(enter, exit), scale: s,
      });
    }

    list.forEach((entry, i) => {
      const [head, ...restParts] = entry.split(/\s*[–:|]\s*/);
      const rest = restParts.join(": ");
      const k = clamp01(spring({ frame, fps, delay: i * 6, config: { damping: 15, stiffness: 160 } })) * exit;
      if (k <= 0.01) return;

      const x = W * safe + i * (cardW + gap);
      const lift = (1 - k) * 30 * s;

      isolate(ctx, () => {
        panel(ctx, x, top + lift, cardW, cardH, {
          fill: pal.surface, border: pal.ink, shadow: pal.ink,
          radius: 12, elevation: 7, scale: s, alpha: k,
        });

        // A colour band at the top of the card, so the set reads as a set.
        ctx.globalAlpha = k;
        ctx.fillStyle = colour;
        ctx.fillRect(x + 2 * s, top + lift + 2 * s, cardW - 4 * s, 14 * s);
        ctx.globalAlpha = 1;

        label(ctx, String(i + 1).padStart(2, "0"), x + 30 * s, top + lift + 70 * s, {
          family: "mono", size: 24, colour: pal.textMuted, tracking: 0.07, alpha: k, scale: s,
        });

        const headLines = wrap(ctx, head, cardW - 60 * s, { family: "display", size: 40, scale: s });
        let hy = top + lift + 120 * s;
        for (const line of headLines.slice(0, 2)) {
          label(ctx, line, x + 30 * s, hy, { family: "display", size: 40, colour: pal.text, alpha: k, scale: s });
          hy += 46 * s;
        }

        if (rest) {
          const bodyLines = wrap(ctx, rest, cardW - 60 * s, { family: "body", size: 26, scale: s });
          let by = hy + 24 * s;
          for (const line of bodyLines.slice(0, 4)) {
            label(ctx, line, x + 30 * s, by, { family: "body", size: 26, colour: pal.textMuted, alpha: k, scale: s });
            by += 34 * s;
          }
        }
      });
    });
  },
};

/** Numbered steps on a connecting line. */
const ProcessFlow = {
  key: "process_flow",
  name: "ProcessFlow",
  blurb: "Numbered steps joined by a line, revealed one at a time. For a process, a pipeline, or anything you narrate as a sequence.",
  needs: ["items"],
  uses: ["text"],
  defaults: { durationInFrames: 180, position: "center", palette_role: "cool" },
  fields: {
    text: { type: "string", max: 60, note: "Optional heading above the flow." },
    items: { type: "string[]", max: 5, note: "One label per step, in order. Two or three words each." },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D, safe } = f;
    const { enter, exit } = phase(frame, D, { enter: 12, exit: 10, easing: f.easing });
    const steps = rows(props.items, 5);
    if (!steps.length) return;

    const r = 44 * s;
    const span = W * (1 - safe * 2) - r * 2;
    const stepGap = steps.length > 1 ? span / (steps.length - 1) : 0;
    const x0 = W * safe + r;
    const cy = H / 2 + (props.text ? 30 * s : 0);

    if (props.text) {
      label(ctx, props.text, W / 2, cy - 150 * s, {
        family: "display", size: 48, colour: pal.text, align: "center", baseline: "middle",
        alpha: Math.min(enter, exit), scale: s,
      });
    }

    // The connector draws itself across as the steps arrive, so the line is
    // the thing that carries your eye rather than decoration behind them.
    const reach = clamp01(interpolate(frame, [8, 8 + steps.length * 8], [0, 1], { easing: "out" }));
    if (steps.length > 1) {
      ctx.globalAlpha = Math.min(enter, exit) * 0.9;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 4 * s;
      ctx.beginPath();
      ctx.moveTo(x0, cy);
      ctx.lineTo(x0 + span * reach, cy);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    steps.forEach((text, i) => {
      const k = stagger(frame, i, { every: 8, over: 14 }) * exit;
      if (k <= 0.01) return;
      const cx = x0 + i * stepGap;

      isolate(ctx, () => {
        ctx.translate(cx, cy);
        ctx.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
        panel(ctx, -r, -r, r * 2, r * 2, {
          fill: colour, border: pal.ink, shadow: pal.ink,
          radius: r, elevation: 5, scale: s, alpha: k,
        });
        label(ctx, String(i + 1), 0, 2 * s, {
          family: "displayHeavy", size: 42, colour: f.ink,
          align: "center", baseline: "middle", alpha: k, scale: s,
        });
      });

      const lines = wrap(ctx, text, stepGap > 0 ? stepGap * 0.92 : W * 0.4, { family: "bodyBold", size: 28, scale: s });
      let ly = cy + r + 44 * s;
      for (const line of lines.slice(0, 2)) {
        label(ctx, line, cx, ly, {
          family: "bodyBold", size: 28, colour: pal.text, align: "center", baseline: "middle", alpha: k, scale: s,
        });
        ly += 36 * s;
      }
    });
  },
};

/** A number that counts up. */
const StatBadge = {
  key: "stat_badge",
  name: "StatBadge",
  blurb: "A number that counts up from zero, with a label under it. For a figure you say out loud and want to land.",
  needs: ["text"],
  uses: ["subtext"],
  defaults: { durationInFrames: 105, position: "center", palette_role: "positive" },
  fields: {
    text: { type: "string", max: 24, note: "The figure, with its furniture: '40%', '$1.2M', '3×'. The number inside is what counts up." },
    subtext: { type: "string", max: 60, note: "What the number is of." },
    font: { type: "string", note: "The figure's typeface. One of: display, displayHeavy, body, bodyBold, mono. Defaults to displayHeavy; the label under it stays body." },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D, safe } = f;
    const { enter, exit } = phase(frame, D, { enter: 10, exit: 10, easing: f.easing });
    const k = clamp01(interpolate(frame, [0, D * 0.5], [0, 1], { easing: "out" }));
    const shown = countUp(props.text, k);
    const family = FONTS[props.font] ? props.font : "displayHeavy";

    const size = 132;
    const numW = measure(ctx, shown, { family, size, scale: s });
    const subW = props.subtext ? measure(ctx, props.subtext, { family: "body", size: 30, scale: s }) : 0;
    const padX = 52 * s;
    const w = Math.max(numW, subW) + padX * 2;
    const h = (props.subtext ? 250 : 190) * s;

    const a = anchor(f.position, { width: W, height: H, safe });
    const { x, y } = box(a, w, h);
    const alpha = Math.min(enter, exit);

    panel(ctx, x, y, w, h, {
      fill: pal.surface, border: pal.ink, shadow: pal.ink,
      radius: 14, elevation: 8, scale: s, alpha,
    });

    label(ctx, shown, x + w / 2, y + (props.subtext ? 118 : 100) * s, {
      family, size, colour, align: "center", baseline: "middle", alpha, scale: s,
    });

    if (props.subtext) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pal.ink;
      ctx.fillRect(x + padX, y + 178 * s, w - padX * 2, 3 * s);
      ctx.globalAlpha = 1;
      label(ctx, props.subtext, x + w / 2, y + 212 * s, {
        family: "body", size: 30, colour: pal.textMuted, align: "center", baseline: "middle", alpha, scale: s,
      });
    }
  },
};

/** An arrow and a label, pointing at something. */
const CalloutArrow = {
  key: "callout_arrow",
  name: "CalloutArrow",
  blurb: "A label with an arrow pointing at a spot in the frame. For a screen recording, or anything you need someone to look at.",
  needs: ["text", "point"],
  uses: [],
  defaults: { durationInFrames: 90, position: "center", palette_role: "accent" },
  fields: {
    text: { type: "string", max: 60, note: "What to say about the thing you are pointing at." },
    point: {
      type: "point",
      note: "Where to aim, as fractions of the frame. { x: 0.5, y: 0.5 } is the middle, { x: 0, y: 0 } the top left.",
    },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D } = f;
    const { enter, exit } = phase(frame, D, { enter: 12, exit: 10, easing: f.easing });
    const alpha = Math.min(enter, exit);

    const px = clamp01(props.point?.x ?? 0.5) * W;
    const py = clamp01(props.point?.y ?? 0.5) * H;

    // The label sits on whichever side has room, so an arrow pointing at the
    // right edge does not put its own label off frame.
    const left = props.point?.x > 0.5;
    const reach = 170 * s;
    const tw = measure(ctx, props.text, { family: "bodyBold", size: 30, scale: s });
    const lw = tw + 44 * s;
    const lh = 68 * s;
    const lx = left ? px - reach - lw : px + reach;
    const ly = py - lh / 2 - 60 * s;

    const grow = interpolate(frame, [0, 14], [0, 1], { easing: "out" });

    // A ring on the target, pulsing once. It is what says "here", and the
    // arrow only says "over there".
    isolate(ctx, () => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = 5 * s;
      const rr = interpolate(frame, [0, 18], [10 * s, 34 * s], { easing: "out" });
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(px + (left ? -rr : rr), py);
      const elbowX = lx + (left ? lw : 0);
      const tipX = px + (left ? -rr : rr) + (elbowX - px - (left ? -rr : rr)) * grow;
      ctx.lineTo(tipX, py);
      ctx.lineTo(tipX, ly + lh / 2 + (py - ly - lh / 2) * (1 - grow));
      ctx.lineWidth = 4 * s;
      ctx.strokeStyle = pal.ink;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    panel(ctx, lx, ly, lw, lh, {
      fill: colour, border: pal.ink, shadow: pal.ink,
      radius: 8, elevation: 5, scale: s, alpha: alpha * grow,
    });
    label(ctx, props.text, lx + lw / 2, ly + lh / 2, {
      family: "bodyBold", size: 30, colour: f.ink,
      align: "center", baseline: "middle", alpha: alpha * grow, scale: s,
    });
  },
};

/** A bar that fills over its own duration. */
const ProgressBar = {
  key: "progress_bar",
  name: "ProgressBar",
  blurb: "A bar filling across the bottom over its own duration, with an optional label. For a walkthrough with steps, or a chapter you want a sense of the length of.",
  needs: [],
  uses: ["text"],
  defaults: { durationInFrames: 240, position: "bottom_bar", palette_role: "accent" },
  fields: { text: { type: "string", max: 60, note: "Optional label above the bar." } },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D, safe } = f;
    const { enter, exit } = phase(frame, D, { enter: 8, exit: 8, easing: f.easing });
    const alpha = Math.min(enter, exit);
    const k = clamp01(frame / Math.max(1, D));

    const w = W * (1 - safe * 2);
    const h = 20 * s;
    const x = W * safe;
    const y = H * (1 - safe) - h;

    if (props.text) {
      label(ctx, props.text, x, y - 22 * s, {
        family: "mono", size: 24, colour: pal.surface, tracking: 0.07, alpha, scale: s,
      });
    }

    panel(ctx, x, y, w, h, {
      fill: pal.ground2, border: pal.ink, shadow: pal.ink,
      radius: 6, elevation: 3, scale: s, alpha,
    });
    isolate(ctx, () => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.rect(x, y, Math.max(h, w * k), h);
      ctx.clip();
      panel(ctx, x, y, w, h, {
        fill: colour, border: pal.ink, shadow: "transparent",
        radius: 6, elevation: 0, scale: s, alpha: 1,
      });
    });
  },
};

/** Mono lines on a dark panel, arriving line by line. */
const CodeCard = {
  key: "code_card",
  name: "CodeCard",
  blurb: "Monospaced lines on a dark panel, arriving one at a time. For a command, a snippet, a file tree, or a stack you are listing out.",
  needs: ["items"],
  uses: ["text"],
  defaults: { durationInFrames: 165, position: "center", palette_role: "cool" },
  fields: {
    text: { type: "string", max: 48, note: "Optional filename or label for the panel's title bar." },
    items: { type: "string[]", max: 8, note: "The lines, in order. Kept as written: no wrapping, no reflow." },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D, safe } = f;
    const { enter, exit } = phase(frame, D, { enter: 12, exit: 10, easing: f.easing });
    const list = rows(props.items, 8);
    if (!list.length) return;

    const size = 30;
    const lineH = 46 * s;
    const padX = 36 * s;
    const barH = 52 * s;
    const widest = list.reduce((max, r) => Math.max(max, measure(ctx, r, { family: "mono", size, scale: s })), 0);
    const w = Math.min(W * (1 - safe * 2), widest + padX * 2);
    const h = barH + list.length * lineH + 32 * s;

    const a = anchor(f.position, { width: W, height: H, safe });
    const { x, y } = box(a, w, h);
    const alpha = Math.min(enter, exit);

    panel(ctx, x, y, w, h, {
      fill: DARK.panel, border: pal.ink, shadow: pal.ink,
      radius: 12, elevation: 7, scale: s, alpha,
    });

    // A title bar, because the app's own windows have one and a code panel
    // without one reads as a screenshot of somewhere else.
    isolate(ctx, () => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = DARK.bar;
      ctx.beginPath();
      ctx.rect(x + 2 * s, y + 2 * s, w - 4 * s, barH);
      ctx.fill();
      ctx.fillStyle = colour;
      ctx.fillRect(x + padX, y + barH / 2 - 6 * s, 12 * s, 12 * s);
      ctx.globalAlpha = 1;
    });
    if (props.text) {
      label(ctx, props.text, x + padX + 26 * s, y + barH / 2 + 2 * s, {
        family: "mono", size: 24, colour: DARK.muted, baseline: "middle", alpha, scale: s,
      });
    }

    list.forEach((line, i) => {
      const k = stagger(frame, i, { every: 6, over: 10 }) * exit;
      if (k <= 0.01) return;
      const ly = y + barH + 26 * s + i * lineH;
      label(ctx, String(i + 1).padStart(2, "0"), x + padX, ly, {
        family: "mono", size: 22, colour: DARK.faint, baseline: "middle", alpha: k, scale: s,
      });
      label(ctx, line, x + padX + 44 * s, ly, {
        family: "mono", size, colour: DARK.text, baseline: "middle", alpha: k, scale: s,
      });
    });
  },
};

/** A pulled quote. */
const QuoteCard = {
  key: "quote_card",
  name: "QuoteCard",
  blurb: "An oversized quote mark, the line, and who said it. For something worth attributing, or your own sentence worth repeating on screen.",
  needs: ["text"],
  uses: ["subtext"],
  defaults: { durationInFrames: 150, position: "center", palette_role: "warm" },
  fields: {
    text: { type: "string", max: 180, note: "The quote. No surrounding quote marks: the graphic draws one." },
    subtext: { type: "string", max: 60, note: "Who said it." },
    font: { type: "string", note: "The quote's typeface. One of: display, displayHeavy, body, bodyBold, mono. Defaults to display; the mark and attribution keep their own weight." },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D } = f;
    const { enter, exit } = phase(frame, D, { enter: 14, exit: 12, easing: f.easing });
    const alpha = Math.min(enter, exit);
    const family = FONTS[props.font] ? props.font : "display";

    scrim(ctx, W, H, pal.ink, alpha * 0.72);

    const lines = wrap(ctx, props.text, W * 0.7, { family, size: 52, scale: s });
    const lh = 66 * s;
    const top = H / 2 - (lines.length * lh) / 2;

    label(ctx, "“", W * 0.14, top + 30 * s, {
      family: "displayHeavy", size: 200, colour, baseline: "middle",
      alpha: alpha * 0.9, scale: s,
    });

    lines.forEach((line, i) => {
      const k = stagger(frame, i, { every: 4, over: 12 }) * exit;
      label(ctx, line, W / 2, top + i * lh + lh / 2, {
        family, size: 52, colour: pal.surface, align: "center", baseline: "middle",
        alpha: k, scale: s,
      });
    });

    if (props.subtext) {
      label(ctx, `by ${props.subtext}`, W / 2, top + lines.length * lh + 40 * s, {
        family: "mono", size: 26, colour, align: "center", baseline: "middle",
        tracking: 0.07, alpha, scale: s,
      });
    }
  },
};

/* -------------------------------------------------------------- the library */


/* ------------------------------------------------ the open-ended three ----
 *
 * The eleven above are opinionated: a lower third knows where it sits and what
 * it weighs, and that is why an agent can ask for one in a sentence. What they
 * cannot do is anything their author did not think of, and "put a pink circle
 * behind the logo and fade it in" is a perfectly ordinary request that none of
 * them can express.
 *
 * These three are the escape hatch. They take the parameters a motion designer
 * expects (typeface, size, weight, colour, placement, rotation, an in and out
 * animation) and they draw exactly what they are told. The trade is that the
 * caller now has to have taste; the point is that the tool no longer decides
 * on their behalf.
 */

/** in/out motion, shared by the open components. */
const MOTIONS = ["fade", "rise", "drop", "slide_left", "slide_right", "pop", "grow", "none"];

/**
 * One motion applied to the canvas, as a transform plus an alpha.
 *
 * Returns rather than draws, so a component can combine it with its own
 * geometry instead of having the movement imposed on it.
 */
function motion(name, { enter, exit, scale }) {
  const k = Math.min(enter, exit);
  const away = 1 - enter;
  switch (name) {
    case "none": return { alpha: 1, dx: 0, dy: 0, k: 1 };
    case "rise": return { alpha: k, dx: 0, dy: away * 48 * scale, k: 1 };
    case "drop": return { alpha: k, dx: 0, dy: -away * 48 * scale, k: 1 };
    case "slide_left": return { alpha: k, dx: away * 90 * scale, dy: 0, k: 1 };
    case "slide_right": return { alpha: k, dx: -away * 90 * scale, dy: 0, k: 1 };
    case "pop": return { alpha: k, dx: 0, dy: 0, k: 0.86 + 0.14 * enter };
    case "grow": return { alpha: k, dx: 0, dy: 0, k: Math.max(0.02, enter) };
    case "fade":
    default: return { alpha: k, dx: 0, dy: 0, k: 1 };
  }
}

/** Where a layer sits: a free point if it was given one, else a named anchor. */
function placement(f) {
  const p = f.props.point;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    return { x: f.width * p.x, y: f.height * p.y, ax: 0.5, ay: 0.5, free: true };
  }
  const a = anchor(f.position, { width: f.width, height: f.height, safe: f.safe });
  return { ...a, free: false };
}

/**
 * Words, with the controls a person expects to have over words.
 *
 * Every other text in this library is styled by its component. This one is
 * styled by whoever asked for it: face, size, weight, colour, tracking,
 * alignment, an optional plate behind it and an optional outline. It is the
 * answer to "I could not change the font colour or style", and it is the
 * component an agent should reach for when the preset ones do not fit.
 */
const TextBlock = {
  key: "text",
  name: "TextBlock",
  blurb: "Free text you control completely: typeface, size, colour, alignment, tracking, a plate behind it, an outline, and how it enters and leaves. Use this when none of the preset graphics fit, or when the styling is the point.",
  needs: ["text"],
  uses: ["font", "size", "align", "tracking", "backdrop", "outline", "line_height", "point", "rotation", "opacity", "animation"],
  defaults: { durationInFrames: 90, position: "center", palette_role: "plain" },
  fields: {
    text: { type: "string", max: 220, note: "The words. Newlines are kept, so you can set two lines deliberately." },
    font: { type: "string", note: 'One of: display, displayHeavy, body, bodyBold, mono. "displayHeavy" is the headline weight.' },
    size: { type: "number", default: 54, note: "Type size in points of a 1080-tall frame, 12 to 220. It scales with the format, so one number is right in every aspect ratio." },
    align: { type: "string", note: "left, center or right. Also decides which way the block grows from its anchor." },
    tracking: { type: "number", default: 0, note: "Letter spacing as a fraction of the size, -0.05 to 0.4. Small caps labels want about 0.07." },
    line_height: { type: "number", default: 1.18, note: "Multiple of the size, 0.8 to 2.4. Defaults to 1.18." },
    backdrop: { type: "string", note: "none, box, or scrim. A box is a plate behind the words; a scrim dims the whole frame so text over busy footage stays readable." },
    outline: { type: "number", default: 0, note: "Outline thickness in points of a 1080 frame, 0 to 12. Reads on any background, which a plate does not." },
    rotation: { type: "number", default: 0, note: "Degrees, -180 to 180." },
    opacity: { type: "number", default: 1, note: "0 to 1. Below 1 the words are see-through, for a watermark or a caption you do not want to fight the picture." },
    point: { type: "object", note: "Free placement as fractions of the frame: {x: 0.5, y: 0.5} is the middle. Leave it out to use `position` instead." },
    animation: { type: "string", note: `How it enters and leaves: ${MOTIONS.join(", ")}.` },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D } = f;
    const { enter, exit } = phase(frame, D, { enter: 12, exit: 10, easing: f.easing });
    const m = motion(props.animation ?? "fade", { enter, exit, scale: s });

    const size = clampNum(props.size, 12, 220, 54);
    const family = FONTS[props.font] ? props.font : "display";
    const align = ["left", "center", "right"].includes(props.align) ? props.align : "center";
    const tracking = clampNum(props.tracking, -0.05, 0.4, 0);
    const lh = clampNum(props.line_height, 0.8, 2.4, 1.18) * size * s;

    // Explicit newlines first, then wrap what is still too wide. A person who
    // typed two lines meant two lines.
    const maxW = W * (props.point ? 0.9 : 0.86);
    const lines = String(props.text ?? "")
      .split(/\r?\n/)
      .flatMap((line) => wrap(ctx, line, maxW, { family, size, scale: s }));

    const widest = Math.max(1, ...lines.map((l) => measure(ctx, l, { family, size, tracking, scale: s })));
    const blockH = lines.length * lh;
    const at = placement(f);

    // One alpha for the whole block, the entrance and the setting multiplied
    // together, so fading in a half-transparent caption stays half
    // transparent rather than snapping to solid.
    const alpha = m.alpha * clampNum(props.opacity, 0, 1, 1);

    if (props.backdrop === "scrim") scrim(ctx, W, H, pal.ink, alpha * 0.6);

    isolate(ctx, () => {
      ctx.globalAlpha = alpha;
      ctx.translate(at.x + m.dx, at.y + m.dy);
      if (props.rotation) ctx.rotate((clampNum(props.rotation, -180, 180, 0) * Math.PI) / 180);
      if (m.k !== 1) ctx.scale(m.k, m.k);

      // The anchor decides which corner the block hangs from; alignment then
      // decides where each line sits inside it.
      const left = at.free
        ? (align === "center" ? -widest / 2 : align === "right" ? -widest : 0)
        : -widest * at.ax;
      const top = at.free ? -blockH / 2 : -blockH * at.ay;

      if (props.backdrop === "box") {
        const padX = size * s * 0.5;
        const padY = size * s * 0.34;
        panel(ctx, left - padX, top - padY, widest + padX * 2, blockH + padY * 2, {
          fill: colour, border: pal.ink, shadow: pal.ink, radius: size * 0.22, scale: s,
        });
      }

      const ink = props.backdrop === "box" ? f.ink : colour;
      const outline = clampNum(props.outline, 0, 12, 0);

      lines.forEach((line, i) => {
        const w = measure(ctx, line, { family, size, tracking, scale: s });
        const x = left + (align === "center" ? widest / 2 - w / 2 : align === "right" ? widest - w : 0);
        const y = top + i * lh + lh * 0.5;
        if (outline > 0) {
          ctx.save();
          ctx.font = font(family, size * s);
          ctx.textBaseline = "middle";
          ctx.lineWidth = outline * s;
          ctx.strokeStyle = pal.ink;
          ctx.lineJoin = "round";
          ctx.strokeText(line, x, y);
          ctx.restore();
        }
        label(ctx, line, x, y, {
          family, size, colour: ink, align: "left", baseline: "middle", tracking, alpha: 1, scale: s,
        });
      });
    });
  },
};

/**
 * A shape.
 *
 * Not decoration for its own sake: a circle behind a face, a bar under a
 * headline, an arrow that is not the callout arrow's arrow. Everything is a
 * fraction of the frame, so a shape placed on a 16:9 preview is in the same
 * place in a 9:16 export.
 */
const Shape = {
  key: "shape",
  name: "Shape",
  blurb: "A rectangle, ellipse, pill, triangle, line, arrow, ring or star, in any colour, anywhere in the frame, at any size and rotation. The building block for anything the preset graphics do not cover.",
  needs: ["shape"],
  uses: ["width", "height", "point", "fill", "stroke", "stroke_width", "radius", "rotation", "opacity", "animation"],
  defaults: { durationInFrames: 75, position: "center", palette_role: "accent" },
  fields: {
    shape: { type: "string", note: "rect, ellipse, pill, triangle, line, arrow, ring or star." },
    width: { type: "number", default: 0.24, note: "As a fraction of the frame width, 0.01 to 1.5." },
    height: { type: "number", default: 0.24, note: "As a fraction of the frame height, 0.01 to 1.5." },
    point: { type: "object", note: "Centre, as fractions of the frame: {x: 0.5, y: 0.5}. Leave it out to use `position`." },
    fill: { type: "string", note: 'A hex like "#F54E00", a palette role, or "none" for an outline only.' },
    stroke: { type: "string", note: 'Outline colour: a hex, a palette role, or "none".' },
    stroke_width: { type: "number", default: 0, note: "Outline thickness in points of a 1080 frame, 0 to 40." },
    radius: { type: "number", default: 0, note: "Corner rounding for a rect, in points of a 1080 frame." },
    rotation: { type: "number", default: 0, note: "Degrees, -180 to 180." },
    opacity: { type: "number", default: 1, note: "0 to 1. Below 1 the shape is see-through, so it can sit over the picture without hiding it." },
    animation: { type: "string", note: `How it enters and leaves: ${MOTIONS.join(", ")}.` },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D } = f;
    const { enter, exit } = phase(frame, D, { enter: 10, exit: 9, easing: f.easing });
    const m = motion(props.animation ?? "pop", { enter, exit, scale: s });

    const w = clampNum(props.width, 0.01, 1.5, 0.24) * W;
    const h = clampNum(props.height, 0.01, 1.5, 0.24) * H;
    const at = placement(f);
    const fill = paintOf(props.fill, colour, pal);
    const stroke = paintOf(props.stroke, "none", pal);
    const lw = clampNum(props.stroke_width, 0, 40, stroke === "none" ? 0 : 4) * s;
    const kind = ["rect", "ellipse", "pill", "triangle", "line", "arrow", "ring", "star"].includes(props.shape)
      ? props.shape : "rect";

    isolate(ctx, () => {
      ctx.globalAlpha = m.alpha * clampNum(props.opacity, 0, 1, 1);
      ctx.translate(at.x + m.dx - (at.free ? 0 : w * (at.ax - 0.5)), at.y + m.dy - (at.free ? 0 : h * (at.ay - 0.5)));
      if (props.rotation) ctx.rotate((clampNum(props.rotation, -180, 180, 0) * Math.PI) / 180);
      if (m.k !== 1) ctx.scale(m.k, m.k);

      ctx.beginPath();
      const x = -w / 2, y = -h / 2;
      switch (kind) {
        case "ellipse": ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
        case "ring": ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
        case "pill": roundedPath(ctx, x, y, w, h, Math.min(w, h) / 2); break;
        case "triangle":
          ctx.moveTo(0, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
          break;
        case "line":
          ctx.moveTo(x, 0); ctx.lineTo(x + w, 0);
          break;
        case "arrow": {
          const headW = Math.min(w * 0.36, h * 1.6);
          const shaft = h * 0.34;
          ctx.moveTo(x, -shaft / 2);
          ctx.lineTo(x + w - headW, -shaft / 2);
          ctx.lineTo(x + w - headW, y);
          ctx.lineTo(x + w, 0);
          ctx.lineTo(x + w - headW, y + h);
          ctx.lineTo(x + w - headW, shaft / 2);
          ctx.lineTo(x, shaft / 2);
          ctx.closePath();
          break;
        }
        case "star": {
          const R = Math.min(w, h) / 2;
          for (let i = 0; i < 10; i++) {
            const r = i % 2 ? R * 0.46 : R;
            const a = (Math.PI / 5) * i - Math.PI / 2;
            i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          break;
        }
        default: roundedPath(ctx, x, y, w, h, clampNum(props.radius, 0, 400, 0) * s);
      }

      // A ring and a line are strokes by nature, whatever was asked for.
      const strokeOnly = kind === "ring" || kind === "line";
      if (!strokeOnly && fill !== "none") { ctx.fillStyle = fill; ctx.fill(); }
      const edge = strokeOnly ? (stroke === "none" ? fill : stroke) : stroke;
      if (edge !== "none") {
        ctx.strokeStyle = edge;
        ctx.lineWidth = Math.max(strokeOnly ? 2 * s : 0, lw);
        ctx.lineCap = "round";
        ctx.stroke();
      }
    });
  },
};

/**
 * A full-frame effect.
 *
 * Only effects that are *drawn over* the picture, never ones that claim to
 * change it. A layer sits on a canvas above the video in the preview and is
 * composited over it in the export, so a vignette or a flash is identical in
 * both, and a blur of the footage would not be: it would look right in the
 * file and wrong on screen, which is the one failure this app is built to
 * avoid.
 */
const Effect = {
  key: "effect",
  name: "Effect",
  blurb: "A full-frame look over the picture: a dip to a colour (the transition to put over a cut), a flash, vignette, grain, scanlines, glitch, letterbox bars or a colour wash. Drawn over the frame, so the preview and the exported file are identical.",
  needs: ["effect"],
  uses: ["strength", "animation"],
  defaults: { durationInFrames: 30, position: "center", palette_role: "plain" },
  fields: {
    effect: { type: "string", note: "dip, flash, vignette, grain, scanlines, glitch, letterbox or wash. `dip` fades to the colour and back out, which is the transition you put over a cut." },
    strength: { type: "number", default: 0.5, note: "0 to 1. Half is usually plenty; grain above 0.4 is a stylistic choice rather than an accident." },
    animation: { type: "string", note: "fade or none. Effects hold rather than move." },
    tag: { type: "string", max: 60, note: "An internal label. The editor uses it to find the transition it put on a clip; leave it out." },
  },
  draw(ctx, f) {
    const { width: W, height: H, scale: s, props, colour, pal, frame, durationInFrames: D } = f;
    const { enter, exit } = phase(frame, D, { enter: 6, exit: 6, easing: f.easing });
    const hold = props.animation === "none" ? 1 : Math.min(enter, exit);
    const k = clampNum(props.strength, 0, 1, 0.5) * hold;
    if (k <= 0.001) return;

    switch (props.effect) {
      case "dip": {
        // Up to full and back down: the dissolve you put across a cut. The
        // colour comes from the layer's own colour, so a dip to black and a
        // dip to white are the same effect with a different role.
        const half = Math.max(1, D / 2);
        const up = clamp01(interpolate(frame, [0, half], [0, 1], { easing: "in_out" }));
        const down = clamp01(interpolate(frame, [half, D], [1, 0], { easing: "in_out" }));
        isolate(ctx, () => {
          ctx.globalAlpha = Math.min(up, down) * clampNum(props.strength, 0, 1, 1);
          ctx.fillStyle = colour;
          ctx.fillRect(0, 0, W, H);
        });
        return;
      }
      case "vignette": {
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.72);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, pal.ink);
        isolate(ctx, () => { ctx.globalAlpha = k; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); });
        return;
      }
      case "grain": {
        // Deterministic per frame, so scrubbing back gives the same grain.
        isolate(ctx, () => {
          ctx.globalAlpha = k * 0.5;
          ctx.fillStyle = pal.surface;
          let seed = frame * 9301 + 49297;
          const dots = Math.round((W * H) / 5200);
          for (let i = 0; i < dots; i++) {
            seed = (seed * 9301 + 49297) % 233280;
            const x = (seed / 233280) * W;
            seed = (seed * 9301 + 49297) % 233280;
            const y = (seed / 233280) * H;
            ctx.fillRect(x, y, 1.4 * s, 1.4 * s);
          }
        });
        return;
      }
      case "scanlines":
        isolate(ctx, () => {
          ctx.globalAlpha = k * 0.34;
          ctx.fillStyle = pal.ink;
          for (let y = 0; y < H; y += Math.max(2, Math.round(3 * s))) ctx.fillRect(0, y, W, Math.max(1, 1.4 * s));
        });
        return;
      case "glitch":
        isolate(ctx, () => {
          let seed = frame * 7919 + 13;
          const bars = 3 + Math.round(k * 5);
          for (let i = 0; i < bars; i++) {
            seed = (seed * 9301 + 49297) % 233280;
            const y = (seed / 233280) * H;
            seed = (seed * 9301 + 49297) % 233280;
            const hgt = (seed / 233280) * H * 0.06 + 4 * s;
            seed = (seed * 9301 + 49297) % 233280;
            const dx = ((seed / 233280) - 0.5) * W * 0.08 * k;
            ctx.globalAlpha = k * 0.55;
            ctx.fillStyle = i % 2 ? colour : pal.surface;
            ctx.fillRect(dx, y, W, hgt);
          }
        });
        return;
      case "letterbox": {
        const bar = H * 0.11 * (props.strength == null ? 1 : clampNum(props.strength, 0, 1, 1));
        isolate(ctx, () => {
          ctx.globalAlpha = hold;
          ctx.fillStyle = pal.ink;
          ctx.fillRect(0, 0, W, bar);
          ctx.fillRect(0, H - bar, W, bar);
        });
        return;
      }
      case "wash":
        isolate(ctx, () => { ctx.globalAlpha = k * 0.55; ctx.fillStyle = colour; ctx.fillRect(0, 0, W, H); });
        return;
      case "flash":
      default:
        // Brightest at the start and gone quickly: a cut accent, not a state.
        isolate(ctx, () => {
          ctx.globalAlpha = clamp01(interpolate(frame, [0, Math.max(2, D * 0.5)], [k, 0], { easing: "out" }));
          ctx.fillStyle = pal.surface;
          ctx.fillRect(0, 0, W, H);
        });
    }
  },
};

/** A number, kept inside its range, with a default for anything unusable. */
function clampNum(v, lo, hi, fallback) {
  // `Number(null)` is `0`, a perfectly finite number, so a field the caller
  // left unset used to clamp to its floor (0 width, 0 opacity, ...) instead
  // of falling back to the component's default. An element added with only
  // its required fields -- the common case, from the palette buttons -- came
  // out a fully transparent sliver: technically drawn, invisible either way.
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** A fill or a stroke: a hex, a role, or the string "none". */
function paintOf(value, fallback, pal) {
  if (value == null || value === "") return fallback;
  const v = String(value).trim();
  if (v === "none") return "none";
  if (isHex(v)) return v;
  if (PALETTE_ROLES.includes(v)) return roleColour(v, pal);
  return fallback;
}

export const COMPONENTS = [
  TitleCard,
  LowerThird,
  CaptionPop,
  BulletList,
  ComparisonCards,
  ProcessFlow,
  StatBadge,
  CalloutArrow,
  ProgressBar,
  CodeCard,
  QuoteCard,
  TextBlock,
  Shape,
  Effect,
];

/** Keyed by the snake_case name a spec uses. */
export const BY_KEY = Object.fromEntries(COMPONENTS.map((c) => [c.key, c]));

export const COMPONENT_KEYS = COMPONENTS.map((c) => c.key);

export const componentFor = (key) => BY_KEY[String(key ?? "")] ?? null;

/** What each component is and what it wants, for a tool description and for
 *  the inspector. One description of a title card, not three. */
export const COMPONENT_INFO = Object.fromEntries(
  COMPONENTS.map((c) => [
    c.key,
    {
      name: c.name,
      blurb: c.blurb,
      needs: c.needs,
      uses: c.uses,
      fields: Object.fromEntries(
        Object.entries(c.fields).map(([k, v]) =>
          [k, { type: v.type, note: v.note, max: v.max, default: v.default }])
      ),
      default_duration_frames: c.defaults.durationInFrames,
    },
  ])
);
