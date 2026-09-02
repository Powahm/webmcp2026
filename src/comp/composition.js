/**
 * The composition document, and the checking of anything proposed into it.
 *
 * A composition is the layer *over* the cut, not the cut itself. The footage,
 * the trims, the looks and the order all stay in legacy/editor.js where they
 * already work; this document owns what sits on top of them and what you hear
 * alongside them. Keeping the two apart is what let the Composition tab arrive
 * without touching a line of the timeline.
 *
 * Seconds at the edges, frames inside. Everything a person or an agent sends
 * is in seconds, because that is what a timeline reports and what a human
 * says. The moment it is validated it becomes an integer frame and stays one,
 * so nothing downstream has to wonder which unit it is holding.
 *
 * Every failure names the field and says what to send instead. That is not
 * politeness: an agent told "invalid input" invents a workaround or gives up,
 * and an agent told `items must be an array of up to 6 short strings` retries
 * correctly on the next call.
 */

import { componentFor, COMPONENT_INFO, COMPONENT_KEYS, rows } from "./components.js";
import { EASING_NAMES, FORMAT_NAMES, formatOf, FPS, toFrames, toSeconds } from "./engine.js";
import { PALETTE_ROLES, POSITIONS } from "./paint.js";

export { COMPONENT_INFO, COMPONENT_KEYS, EASING_NAMES, FORMAT_NAMES, PALETTE_ROLES, POSITIONS };

/* ------------------------------------------------------------------- sound */

/**
 * Sound effects are synthesised, not loaded.
 *
 * Six presets built from oscillators and a noise buffer, which means no asset
 * files, no network, nothing to 404 on a judge's machine, and no licence to
 * worry about. It also means an effect is a name in a spec rather than a file
 * an agent would have to be given a list of.
 */
export const SFX_PRESETS = {
  hit: { blurb: "A short, low, percussive thump. For a title card landing.", seconds: 0.28 },
  pop: { blurb: "A bright click. For a list row or a caption word arriving.", seconds: 0.14 },
  whoosh: { blurb: "Filtered noise sweeping up. For anything sliding in from an edge.", seconds: 0.45 },
  riser: { blurb: "A pitch climbing to a stop. For building into a reveal.", seconds: 0.9 },
  tick: { blurb: "A dry tick. For a step in a process, or a counter.", seconds: 0.07 },
  chime: { blurb: "Two soft tones. For a result, a total, or a positive stat.", seconds: 0.7 },
};

export const SFX_NAMES = Object.keys(SFX_PRESETS);

/* ---------------------------------------------------------------- document */

export const emptyComposition = () => ({
  format: "landscape",
  fps: FPS,
  layers: [],
  audio: [],
});

/** The pixel dimensions and safe margin a composition renders at. */
export const frameOf = (composition) => formatOf(composition?.format);

/* ----------------------------------------------------------------- helpers */

const fail = (error, hint) => ({ ok: false, error, hint });

const str = (v, max) => String(v ?? "").trim().slice(0, max);

const listOf = (label, values) => `${label} must be one of: ${values.join(", ")}.`;

/* ------------------------------------------------------------ layer checks */

/**
 * Check a proposed layer and fill in what it left out.
 *
 * `context` carries the length of the cut in seconds, so a graphic cannot be
 * placed past the end of the footage — which is the single most common way a
 * proposal comes back looking like it did nothing at all.
 */
export function validateLayer(input, context = {}) {
  const { cutSeconds = null, fps = FPS } = context;

  const key = str(input.component, 40);
  const component = componentFor(key);
  if (!component) {
    return fail(
      `"${key}" is not a component.`,
      `Use one of: ${COMPONENT_KEYS.join(", ")}. ${COMPONENT_KEYS.map((k) => `${k} — ${COMPONENT_INFO[k].blurb}`).join(" ")}`
    );
  }

  /* ---- props ---- */

  const props = {};
  const fields = component.fields;

  if ("text" in fields) props.text = str(input.text, fields.text.max ?? 120);
  if ("subtext" in fields) props.subtext = str(input.subtext, fields.subtext.max ?? 120) || null;
  if ("eyebrow" in fields) props.eyebrow = str(input.eyebrow, fields.eyebrow.max ?? 32) || null;

  if ("items" in fields) {
    const limit = fields.items.max ?? 6;
    props.items = rows(input.items, limit);
  }

  if ("timings" in fields) {
    if (Array.isArray(input.timings) && input.timings.length) {
      // One per word or none. A mismatch used to fall through to the even
      // spread, which is the exact behaviour timings exist to replace — and
      // the caller was told the layer staged fine.
      const words = String(input.text ?? "").split(/\s+/).filter(Boolean).length;
      if (input.timings.length !== words) {
        return fail(
          `timings has ${input.timings.length} entries but text has ${words} word(s).`,
          "Send exactly one frame number per word, in order, or leave timings out and the words spread evenly across the layer."
        );
      }
      props.timings = input.timings.map((n) => Math.max(0, Math.round(Number(n) || 0)));
    } else {
      props.timings = null;
    }
  }

  if ("point" in fields) {
    const p = input.point;
    props.point = p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
      ? { x: Math.max(0, Math.min(1, Number(p.x))), y: Math.max(0, Math.min(1, Number(p.y))) }
      : null;
  }

  // What to add to a field's own note when it is missing. Keyed by the field's
  // declared type, because "send the words that appear on screen" is good
  // advice for a headline and gibberish for a coordinate.
  const ADVICE = {
    "string[]": "Send an array of short strings, or one string with a line break between rows.",
    point: "Send it as { x, y }, each a fraction of the frame.",
    string: "Send the words that appear on screen, not a description of them.",
  };

  // `needs` is the contract. Checking it here rather than in each drawer is
  // why a missing field is a message and not a blank rectangle.
  for (const need of component.needs) {
    const value = props[need];
    const missing = Array.isArray(value) ? value.length === 0 : !value;
    if (missing) {
      const field = fields[need] ?? {};
      return fail(
        `A ${key} needs ${need}.`,
        `${field.note ?? ""} ${ADVICE[field.type] ?? ""}`.trim()
      );
    }
  }

  /* ---- timing ---- */

  const seconds = Number(input.at_seconds);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return fail(
      "at_seconds must be a number of seconds from the start of the cut.",
      "Call get_timeline for the length of the cut, or get_transcript and quote the words you want this over."
    );
  }
  if (cutSeconds != null && cutSeconds > 0 && seconds > cutSeconds + 0.001) {
    return fail(
      `at_seconds is ${seconds.toFixed(2)}s but the cut is only ${cutSeconds.toFixed(2)}s long, so this would never be on screen.`,
      "Call get_timeline first and place the layer inside the cut."
    );
  }

  const defaultSeconds = toSeconds(component.defaults.durationInFrames, fps);
  const durationSeconds = input.duration_seconds == null
    ? defaultSeconds
    : Number(input.duration_seconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.2 || durationSeconds > 30) {
    return fail(
      `duration_seconds must be between 0.2 and 30; got ${input.duration_seconds}.`,
      `Leave it out and a ${key} runs for ${defaultSeconds.toFixed(1)}s, which is usually right.`
    );
  }

  /* ---- look ---- */

  const position = input.position == null ? component.defaults.position : str(input.position, 20);
  if (!POSITIONS.includes(position)) return fail(`"${position}" is not a position.`, listOf("position", POSITIONS));

  const role = input.palette_role == null ? component.defaults.palette_role : str(input.palette_role, 20);
  if (!PALETTE_ROLES.includes(role)) {
    return fail(
      `"${role}" is not a palette role.`,
      `${listOf("palette_role", PALETTE_ROLES)} Roles resolve against the live theme, which is why you cannot send a colour and why one spec is legible in both themes.`
    );
  }

  const easing = input.easing == null ? "out" : str(input.easing, 20);
  if (!EASING_NAMES.includes(easing)) return fail(`"${easing}" is not an easing.`, listOf("easing", EASING_NAMES));

  return {
    ok: true,
    layer: {
      component: key,
      from: toFrames(seconds, fps),
      durationInFrames: Math.max(6, toFrames(durationSeconds, fps)),
      position,
      palette_role: role,
      easing,
      props,
    },
  };
}

/* ------------------------------------------------------------ audio checks */

/**
 * Check a proposed audio track.
 *
 * Two kinds and they behave differently on purpose. An effect is a one-shot
 * with a preset and a moment; a bed is a clip with a gain and, optionally,
 * ducking. Collapsing them into one shape would mean every field being
 * meaningless half the time.
 */
export function validateAudio(input, context = {}) {
  const { cutSeconds = null, fps = FPS, clipIds = null } = context;

  const kind = str(input.kind, 10);
  if (kind !== "sfx" && kind !== "music") {
    return fail(`"${kind}" is not an audio kind.`, "Use 'sfx' for a one-shot effect or 'music' for a background bed.");
  }

  const seconds = Number(input.at_seconds ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return fail("at_seconds must be a number of seconds from the start of the cut.");
  }
  if (cutSeconds != null && cutSeconds > 0 && seconds > cutSeconds + 0.001) {
    return fail(
      `at_seconds is ${seconds.toFixed(2)}s but the cut is only ${cutSeconds.toFixed(2)}s long.`,
      "Call get_timeline for the length of the cut."
    );
  }

  const gain = input.gain == null ? (kind === "music" ? 0.18 : 0.6) : Number(input.gain);
  if (!Number.isFinite(gain) || gain < 0 || gain > 1) {
    return fail(
      `gain must be between 0 and 1; got ${input.gain}.`,
      kind === "music"
        ? "A bed under speech wants 0.1 to 0.25. Above 0.4 and it competes with the voice."
        : "An effect wants 0.4 to 0.8."
    );
  }

  if (kind === "sfx") {
    const preset = input.preset == null ? "pop" : str(input.preset, 20);
    if (!SFX_PRESETS[preset]) {
      return fail(
        `"${preset}" is not a sound effect.`,
        `${listOf("preset", SFX_NAMES)} ${SFX_NAMES.map((n) => `${n} — ${SFX_PRESETS[n].blurb}`).join(" ")}`
      );
    }
    return {
      ok: true,
      track: {
        kind: "sfx",
        preset,
        from: toFrames(seconds, fps),
        durationInFrames: Math.max(1, toFrames(SFX_PRESETS[preset].seconds, fps)),
        gain,
        clipId: null,
        duck: false,
      },
    };
  }

  const clipId = str(input.clip_id, 60);
  if (!clipId) {
    return fail(
      "A music bed needs clip_id: the audio or video clip to take the bed from.",
      "Call list_clips for the ids in the library. Import an audio file in the Editor's library if there is nothing to use."
    );
  }
  if (clipIds && !clipIds.includes(clipId)) {
    return fail(`No clip with id "${clipId}".`, "Call list_clips for the ids on this desktop.");
  }

  const durationSeconds = input.duration_seconds == null
    ? Math.max(1, (cutSeconds ?? 30) - seconds)
    : Number(input.duration_seconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0.2) {
    return fail("duration_seconds must be at least 0.2, or leave it out to run to the end of the cut.");
  }

  return {
    ok: true,
    track: {
      kind: "music",
      preset: null,
      clipId,
      from: toFrames(seconds, fps),
      durationInFrames: Math.max(6, toFrames(durationSeconds, fps)),
      gain,
      // Ducking is on unless it is turned off. A bed that does not duck is
      // the single most common reason a cut sounds amateur, and defaulting it
      // on means the agent gets it right without knowing the word.
      duck: input.duck !== false,
    },
  };
}

/* ------------------------------------------------------------------ format */

export function validateFormat(name) {
  const format = str(name, 20);
  if (!FORMAT_NAMES.includes(format)) {
    return fail(
      `"${format}" is not a format.`,
      `${listOf("format", FORMAT_NAMES)} ${FORMAT_NAMES.map((f) => `${f} is ${formatOf(f).label}`).join(", ")}.`
    );
  }
  return { ok: true, format };
}
