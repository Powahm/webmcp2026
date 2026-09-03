/**
 * The composition, as code.
 *
 * The agent fills in a spec and this turns it into TSX you can read. That
 * split is the whole design and it is worth being precise about what it buys,
 * because "the agent edits video by writing code" and "the agent emits code we
 * run" sound like the same sentence and are not.
 *
 * Nothing the agent sends is ever evaluated. It sends a spec, the spec is
 * checked field by field in composition.js, and the code below is *generated
 * from the checked spec*. So the agent gets the thing that makes code the
 * right interface (an artifact that is precise, diffable, reviewable, and
 * says exactly what will happen on which frame) without the thing that makes
 * evaluated code the wrong one, which is that a single bad prop can blank the
 * preview or take down the page.
 *
 * The generated file is also the honest documentation of what the engine does.
 * `<Sequence from={60} durationInFrames={105}>` is not a description of the
 * composition, it is the composition: those two numbers are the frames
 * resolve() will place it at.
 */

import { componentFor } from "./components.js";
import { formatOf, FPS, toSeconds } from "./engine.js";

/* ---------------------------------------------------------------- printing */

/** A JSX string attribute. Switches to a braced expression when the value
 *  carries a quote or a newline, which is the only way to keep it valid. */
function attrString(value) {
  const text = String(value);
  if (!/["\n\r]/.test(text)) return `"${text}"`;
  return `{${JSON.stringify(text)}}`;
}

function attrValue(value) {
  if (value == null) return null;
  if (typeof value === "number") return `{${Math.round(value * 1000) / 1000}}`;
  if (typeof value === "boolean") return `{${value}}`;
  if (Array.isArray(value)) {
    if (!value.length) return null;
    const items = value.map((v) => (typeof v === "number" ? String(v) : JSON.stringify(String(v))));
    // A short list on one line, a long one broken up. The generated file is
    // meant to be read, and six strings on one 300-character line is not.
    const oneLine = `{[${items.join(", ")}]}`;
    if (oneLine.length <= 72) return oneLine;
    return { multiline: items };
  }
  if (typeof value === "object") {
    const inner = Object.entries(value)
      .map(([k, v]) => `${k}: ${typeof v === "number" ? Math.round(v * 1000) / 1000 : JSON.stringify(v)}`)
      .join(", ");
    return `{{ ${inner} }}`;
  }
  return attrString(value);
}

/** camelCase for JSX, since `palette_role` is a spec field name and
 *  `paletteRole` is what a React prop is called. */
const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** One element, its props each on a line, indented from `pad`. */
function element(tag, pairs, pad) {
  const printed = pairs
    .map(([key, value]) => [camel(key), attrValue(value)])
    .filter(([, value]) => value != null);

  if (!printed.length) return [`${pad}<${tag} />`];

  const lines = [`${pad}<${tag}`];
  for (const [key, value] of printed) {
    if (value?.multiline) {
      lines.push(`${pad}  ${key}={[`);
      for (const item of value.multiline) lines.push(`${pad}    ${item},`);
      lines.push(`${pad}  ]}`);
    } else {
      lines.push(`${pad}  ${key}=${value}`);
    }
  }
  lines.push(`${pad}/>`);
  return lines;
}

/**
 * Comment a block out, as JSX.
 *
 * A bare `/* *\/` or a `//` between JSX children is not a comment, it is a
 * syntax error, and the generated file has to actually parse or the Code tab
 * is a lie. So a staged proposal becomes one `{/* ... *\/}` expression
 * wrapping the whole block, which is both valid and the way a person would
 * comment out JSX by hand.
 */
function commentOut(lines, pad, why) {
  // A `*` followed by `/` anywhere inside would close the comment early.
  const safe = lines.map((l) => l.replace(/\*\//g, "* /"));
  return [
    `${pad}{/* PROPOSED, not in the video${why ? `: ${why}` : ""}`,
    ...safe,
    `${pad}*/}`,
  ];
}

/* ------------------------------------------------------------------ layers */

const secs = (frames, fps) => `${toSeconds(frames, fps).toFixed(2)}s`;

function layerBlock(layer, fps, pad = "    ") {
  const component = componentFor(layer.component);
  if (!component) return [];

  const props = [
    ...Object.entries(layer.props ?? {}),
    ["position", layer.position],
    ["palette_role", layer.palette_role],
    ["easing", layer.easing],
  ];

  const at = `${secs(layer.from, fps)} → ${secs(layer.from + layer.durationInFrames, fps)}`;
  const inner = [
    `${pad}<Sequence from={${layer.from}} durationInFrames={${layer.durationInFrames}}>`,
    ...element(component.name, props, `${pad}  `),
    `${pad}</Sequence>`,
  ];

  if (layer.status === "proposed") return commentOut(inner, pad, layer.reason);
  return [`${pad}{/* ${at} */}`, ...inner];
}

function audioBlock(track, fps, pad = "    ") {
  const at = secs(track.from, fps);
  const inner = track.kind === "sfx"
    ? element("Sfx", [["preset", track.preset], ["at", track.from], ["gain", track.gain]], pad)
    : element("MusicBed", [
        ["clip_id", track.clipId],
        ["from", track.from],
        ["duration_in_frames", track.durationInFrames],
        ["gain", track.gain],
        // Ducking is the interesting one, so it is always printed rather than
        // omitted when it matches the default.
        ["duck", track.duck],
      ], pad);

  if (track.status === "proposed") return commentOut(inner, pad, track.reason);
  const span = track.kind === "sfx" ? at : `${at} → ${secs(track.from + track.durationInFrames, fps)}`;
  return [`${pad}{/* ${span} */}`, ...inner];
}

/* --------------------------------------------------------------- the file */

/**
 * Generate the composition file.
 *
 * `cutSeconds` is the length of the footage underneath, which is what sets
 * `durationInFrames` on the composition: the graphics do not decide how long
 * the video is, the cut does.
 */
export function generate(doc, { cutSeconds = 0, name = "Cut" } = {}) {
  const fps = doc?.fps ?? FPS;
  const { width, height, label } = formatOf(doc?.format);
  const total = Math.max(1, Math.round(cutSeconds * fps));

  const layers = [...(doc?.layers ?? [])]
    .filter((l) => l.status !== "rejected")
    .sort((a, b) => a.from - b.from);
  const audio = [...(doc?.audio ?? [])]
    .filter((a) => a.status !== "rejected")
    .sort((a, b) => a.from - b.from);

  const used = [...new Set(layers.map((l) => componentFor(l.component)?.name).filter(Boolean))];
  const audioImports = [
    audio.some((a) => a.kind === "sfx") ? "Sfx" : null,
    audio.some((a) => a.kind === "music") ? "MusicBed" : null,
  ].filter(Boolean);

  const pending = layers.filter((l) => l.status === "proposed").length
    + audio.filter((a) => a.status === "proposed").length;

  const head = [
    "/**",
    ` * ${name}: generated from the composition in the Editor.`,
    " *",
    " * Do not hand-edit: the Composition tab is the source and this is printed",
    " * from it. Times are frames at " + fps + "fps, so " + fps + " is one second and every",
    " * number here is exact rather than rounded from a float.",
    pending
      ? ` *\n * ${pending} proposal${pending === 1 ? "" : "s"} are commented out below. They are staged in the\n * editor and are not in the video until someone accepts them.`
      : null,
    " */",
    "",
    `import { Composition, Sequence } from "./engine";`,
    used.length ? `import { ${used.join(", ")} } from "./components";` : null,
    audioImports.length ? `import { ${audioImports.join(", ")} } from "./audio";` : null,
    "",
    `/** ${label}. Geometry in every component is a fraction of the frame, so`,
    ` *  changing this reframes the composition without moving a layer. */`,
    `export const FORMAT = { width: ${width}, height: ${height}, fps: ${fps} } as const;`,
    "",
    `export const ${name}: React.FC = () => (`,
    `  <Composition`,
    `    width={FORMAT.width}`,
    `    height={FORMAT.height}`,
    `    fps={FORMAT.fps}`,
    `    durationInFrames={${total}}`,
    `  >`,
    `    {/* The cut itself: the timeline in the Editor, underneath everything. */}`,
    `    <Footage />`,
    "",
  ].filter((l) => l != null);

  const body = [];

  if (layers.length) {
    layers.forEach((layer, i) => {
      if (i) body.push("");
      body.push(...layerBlock(layer, fps));
    });
  } else {
    body.push("    {/* No graphics yet. Ask the agent for a title card over the opening. */}");
  }

  if (audio.length) {
    body.push("");
    body.push("    {/* Sound. Effects are synthesised, so there is nothing to load. */}");
    for (const track of audio) body.push(...audioBlock(track, fps));
  }

  return [...head, ...body, "  </Composition>", ");", ""].join("\n");
}
