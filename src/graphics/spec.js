/**
 * The motion graphics contract.
 *
 * The agent never writes CSS, SVG or JavaScript. It fills in the object below
 * and the editor draws it. That is not a limitation dressed up as a principle,
 * it buys four things at once:
 *
 *   - it always looks like the rest of the app, because colour is a role and
 *     the theme decides what the role means;
 *   - it cannot break the page, because nothing the agent sends is ever
 *     evaluated or inserted as markup;
 *   - it is checkable, so a bad proposal comes back with a hint instead of
 *     rendering as a blank rectangle nobody notices until export;
 *   - it renders identically in the preview and in the export, because both
 *     call one function with one spec.
 *
 * Geometry is normalised. Every position and size below is a fraction of the
 * frame, never a pixel, so one spec is correct at 720p and at 4K and the
 * preview matches the export whatever size the canvas happens to be.
 */

export const TYPES = [
  "lower_third",
  "title_card",
  "caption_pop",
  "callout_arrow",
  "stat_badge",
  "progress_bar",
];

/** What each type does, and what it needs. Used by the tool description and by
 *  the panel, so there is one description of a title card, not three. */
export const TYPE_INFO = {
  lower_third: {
    blurb: "A name and a role sliding in at the lower left. For introducing a person or a place.",
    needs: ["text"],
    uses: ["subtext"],
  },
  title_card: {
    blurb: "A full-frame headline over a wash. For a chapter break or the opening line.",
    needs: ["text"],
    uses: ["subtext"],
  },
  caption_pop: {
    blurb: "Words appearing one at a time along the bottom, in time with speech. For a line worth landing.",
    needs: ["text"],
    uses: [],
  },
  callout_arrow: {
    blurb: "An arrow and a label pointing at a spot in the frame. For a screen recording, or anything you need someone to look at.",
    needs: ["text", "point"],
    uses: [],
  },
  stat_badge: {
    blurb: "A number that counts up, with a label under it. For a figure you say out loud.",
    needs: ["text"],
    uses: ["subtext"],
  },
  progress_bar: {
    blurb: "A bar filling across the bottom over its own duration. For a walkthrough with steps.",
    needs: [],
    uses: ["text"],
  },
};

export const POSITIONS = [
  "lower_left",
  "lower_right",
  "upper_left",
  "upper_right",
  "center",
  "bottom_bar",
];

/**
 * Colour is a role, resolved against the live theme at draw time.
 *
 * The agent cannot pick a hex value, so it cannot pick one that clashes with
 * the app, and the same graphic is legible in the light theme and the dark one
 * without the agent knowing either exists.
 */
export const PALETTE_ROLES = ["accent", "warm", "cool", "positive", "plain"];

const ROLE_VARS = {
  accent: "--accent",
  warm: "--yellow",
  cool: "--teal",
  positive: "--green",
  plain: "--text",
};

/** Read the theme's own value, so light and dark both work with one spec. */
export function roleColour(role) {
  const name = ROLE_VARS[role] || ROLE_VARS.accent;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || "#F54E00";
}

export const EASINGS = ["out", "in_out", "linear"];

export const DEFAULTS = {
  duration: 4,
  position: "lower_left",
  palette_role: "accent",
  easing: "out",
};

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n)));

/**
 * Check a proposal and fill in what it left out.
 *
 * Returns `{ ok: true, graphic }` or `{ ok: false, error, hint }`. Every
 * failure says what to send instead: an agent told "invalid input" gives up or
 * invents a workaround, an agent told which field and what the allowed values
 * are simply retries correctly.
 */
export function validate(input, { timelineLength } = {}) {
  const fail = (error, hint) => ({ ok: false, error, hint });

  const type = String(input.type ?? "");
  if (!TYPES.includes(type)) {
    return fail(
      `"${type}" is not a graphic type.`,
      `Use one of: ${TYPES.join(", ")}. ${Object.entries(TYPE_INFO).map(([k, v]) => `${k} — ${v.blurb}`).join(" ")}`
    );
  }

  const info = TYPE_INFO[type];
  const text = String(input.text ?? "").trim();
  if (info.needs.includes("text") && !text) {
    return fail(`A ${type} needs text.`, "Send the words that should appear on screen, not a description of them.");
  }

  const start = Number(input.start);
  if (!Number.isFinite(start) || start < 0) {
    return fail(
      "start must be a number of seconds from the beginning of the cut.",
      "Call get_timeline for the length of the cut and where each segment begins."
    );
  }
  if (timelineLength != null && start > timelineLength + 0.001) {
    return fail(
      `start is ${start.toFixed(2)}s but the cut is only ${timelineLength.toFixed(2)}s long.`,
      "Call get_timeline first and place the graphic inside the cut."
    );
  }

  const duration = input.duration == null ? DEFAULTS.duration : Number(input.duration);
  if (!Number.isFinite(duration) || duration < 0.2 || duration > 30) {
    return fail(`duration must be between 0.2 and 30 seconds; got ${input.duration}.`);
  }

  const position = input.position == null ? DEFAULTS.position : String(input.position);
  if (!POSITIONS.includes(position)) {
    return fail(`"${position}" is not a position.`, `Use one of: ${POSITIONS.join(", ")}.`);
  }

  const role = input.palette_role == null ? DEFAULTS.palette_role : String(input.palette_role);
  if (!PALETTE_ROLES.includes(role)) {
    return fail(
      `"${role}" is not a palette role.`,
      `Use one of: ${PALETTE_ROLES.join(", ")}. Roles resolve against the theme, which is why you cannot send a colour.`
    );
  }

  const easing = input.easing == null ? DEFAULTS.easing : String(input.easing);
  if (!EASINGS.includes(easing)) return fail(`"${easing}" is not an easing.`, `Use one of: ${EASINGS.join(", ")}.`);

  let point = null;
  if (type === "callout_arrow") {
    const p = input.point;
    if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) {
      return fail(
        "A callout_arrow needs a point to aim at.",
        "Send point as fractions of the frame: { x: 0.5, y: 0.5 } is the middle, { x: 0, y: 0 } the top left."
      );
    }
    point = { x: clamp01(p.x), y: clamp01(p.y) };
  }

  return {
    ok: true,
    graphic: {
      type,
      text: text.slice(0, 90),
      subtext: String(input.subtext ?? "").trim().slice(0, 90) || null,
      start: Math.max(0, start),
      duration,
      position,
      palette_role: role,
      easing,
      point,
    },
  };
}
