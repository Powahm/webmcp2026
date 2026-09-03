/**
 * The composition and transcript tools.
 *
 * Same rule as tools.js: a tool exists when it reads or changes something only
 * this page knows. Everything here qualifies twice over, because the
 * transcript is derived from prompter clicks that happened in this tab and the
 * composition is an array in a module closure. No server has either, and a
 * screen-scraper looking at the Editor can see that a graphic exists without
 * being able to tell you it starts on frame 420 and is waiting on a decision.
 *
 * The division of labour is worth stating once. **Reading is free, staging is
 * cheap, and accepting is not available.** Every write tool below produces a
 * dashed, visible, live-previewing proposal and returns the id of it. None of
 * them can promote one, because the store guards every accept path behind a
 * trusted user event. The agent can compose an eight-second animated title
 * card, a sound effect under it, a reframe to vertical and a list of every
 * hesitation in the take — four calls — and it still cannot put one frame into
 * the video.
 */

import { generate } from "../comp/codegen.js";
import {
  COMPONENT_INFO, COMPONENT_KEYS, EASING_NAMES, FORMAT_NAMES,
  PALETTE_ROLES, POSITIONS, SFX_NAMES, SFX_PRESETS,
} from "../comp/composition.js";
import { formatOf, toSeconds } from "../comp/engine.js";
import {
  composition, liveAudio, liveLayers, pendingCount,
  proposeAudio, proposeFormat, proposeLayer, proposeLayerChange,
} from "../comp/store.js";
import { pendingCuts, proposeCut } from "../cuts/store.js";
import { Editor } from "../legacy/editor.js";
import { Clips, timecode } from "../legacy/store.js";
import { findDeadWeight, findWords, toCutTime } from "../transcript/transcript.js";
import { hasApiKey, transcriptsFor } from "../transcript/store.js";
import { fail, json, NO_INPUT, READ_ONLY } from "./result.js";

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The length of the edit, which is what every timing is checked against. */
const cutSeconds = () => Editor.totalDuration;

const context = () => ({ cutSeconds: cutSeconds(), fps: composition().fps });

/**
 * The transcript of the cut as it currently stands.
 *
 * Assembled on demand rather than cached, because it depends on the timeline
 * and the timeline changes. Every trim, reorder and speed change moves every
 * word after it, and a stale transcript is worse than none: it would place a
 * graphic confidently in the wrong place.
 */
async function cutTranscript() {
  if (!Editor.timeline.length) return null;
  const transcripts = await transcriptsFor(Editor.timeline.map((s) => s.clipId));
  if (!transcripts.size) return null;
  // Re-read after the await. Accepting a cut swaps the whole array, so a
  // timeline captured before the IndexedDB read could be the pre-cut one, and
  // a quote resolved against it would stage a range in the wrong place.
  return toCutTime(Editor.timeline, transcripts);
}

/* ---------------------------------------------------------- reading it out */

export const getComposition = {
  name: "get_composition",
  description:
    "Return the motion graphics, sound and format layered over the cut, with every timing in both seconds and frames. Call it before proposing anything so you build on what is there instead of stacking a second title card on the first, and so you know the format: a graphic laid out for 16:9 reads differently once the same composition is reframed to 9:16.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const doc = composition();
    const { fps } = doc;
    const format = formatOf(doc.format);

    return json({
      format: doc.format,
      aspect: format.label,
      width: format.width,
      height: format.height,
      fps,
      cut_seconds: round(cutSeconds()),
      cut: timecode(cutSeconds()),
      pending_format: doc.pendingFormat
        ? { format: doc.pendingFormat.format, reason: doc.pendingFormat.reason }
        : null,
      layers: liveLayers().map((l) => ({
        id: l.id,
        component: l.component,
        status: l.status,
        replaces: l.replaces ?? null,
        at_seconds: round(toSeconds(l.from, fps)),
        duration_seconds: round(toSeconds(l.durationInFrames, fps)),
        from_frame: l.from,
        duration_frames: l.durationInFrames,
        position: l.position,
        palette_role: l.palette_role,
        easing: l.easing,
        props: l.props,
        reason: l.reason,
        proposed_by: l.origin,
      })),
      audio: liveAudio().map((a) => ({
        id: a.id,
        kind: a.kind,
        status: a.status,
        preset: a.preset,
        clip_id: a.clipId,
        at_seconds: round(toSeconds(a.from, fps)),
        duration_seconds: round(toSeconds(a.durationInFrames, fps)),
        gain: a.gain,
        ducks_under_speech: a.duck,
        reason: a.reason,
        proposed_by: a.origin,
      })),
      components: COMPONENT_INFO,
      positions: POSITIONS,
      palette_roles: PALETTE_ROLES,
      easings: EASING_NAMES,
      formats: FORMAT_NAMES.map((f) => ({ name: f, aspect: formatOf(f).label })),
      sound_effects: SFX_NAMES.map((n) => ({ name: n, for: SFX_PRESETS[n].blurb })),
      waiting_on_the_editor: pendingCount(),
      note:
        "Anything with status 'proposed' is dashed on their timeline and is not in the video. Only the person at the keyboard can accept it; there is no tool that does.",
    });
  },
};

export const getTranscript = {
  name: "get_transcript",
  description:
    "Return what is said in the cut, word by word, with the second each word lands on. The timing comes from the teleprompter: the Camera recorded which script line was on screen at which second of the take, so this is derived from what they actually performed, not guessed from the page. Times are positions in the finished edit, already adjusted for every trim, reorder and speed change, so a time from here can be handed straight to propose_layer or propose_cut. Pass `quote` to locate a specific phrase.",
  inputSchema: {
    type: "object",
    properties: {
      quote: {
        type: "string",
        maxLength: 200,
        description:
          "Optional. Words to find, as they were said. Case and punctuation are ignored. Returns every occurrence with exact start and end seconds, which is how you turn 'the bit where I talk about the stack' into a range.",
      },
      include_words: {
        type: "boolean",
        description:
          "Optional. Include the full word-by-word array. Default false, which returns the text and the beats and is usually enough; ask for words when you need to time a caption to individual words.",
      },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  execute: async (args) => {
    const transcript = await cutTranscript();
    if (!transcript || !transcript.words.length) {
      const clips = await Clips.all();
      const recorded = clips.filter((c) => c.beats?.length).length;
      return json({
        transcript: null,
        note: !Editor.timeline.length
          ? "The timeline is empty, so there is nothing said in the cut yet. Call get_timeline."
          : recorded
            ? "The clips on this timeline were not recorded against a script, so there are no prompter timings for them. A transcript can still be made with Whisper from the Editor's Transcript panel, which needs the user's own API key."
            : "No clip on this desktop was recorded with the teleprompter, so there is nothing to derive timings from. Loading a script into the Camera before recording is what creates them.",
        whisper_available: hasApiKey(),
      });
    }

    if (args.quote) {
      const hits = findWords(transcript, args.quote);
      if (!hits.length) {
        return json({
          quote: args.quote,
          occurrences: [],
          hint: "Those words are not in the cut in that order. They may have been trimmed out, or said differently. Call this again with include_words true, or without a quote, to read what is actually there.",
        });
      }
      return json({
        quote: args.quote,
        occurrences: hits.map((h) => ({
          text: h.text,
          start_seconds: round(h.start),
          end_seconds: round(h.end),
          at: timecode(h.start),
          segment_uid: h.segment_uid,
        })),
        note: hits.length > 1
          ? `Said ${hits.length} times. Ask which one they mean rather than choosing, or use the surrounding beats to tell them apart.`
          : undefined,
      });
    }

    const dead = findDeadWeight(transcript);

    return json({
      source: transcript.source,
      // An honest flag. Prompter timings are a good estimate spread across a
      // line; Whisper's are measured. Anything reading this should know which.
      approximate: transcript.approximate,
      approximate_note: transcript.approximate
        ? "Timings come from teleprompter line advances, with each line's words spread across it by length. Good to about a quarter of a second at the line level, less exact within a line. Whisper gives measured per-word timing if the user has set a key."
        : "Measured per-word timing from Whisper.",
      cut_seconds: round(transcript.cut_seconds),
      word_count: transcript.words.length,
      text: transcript.words.map((w) => w.w).join(" "),
      beats: transcript.beats.map((b) => ({
        index: b.index,
        text: b.text,
        note: b.note,
        start_seconds: round(b.start),
        end_seconds: round(b.end),
      })),
      words: args.include_words === true
        ? transcript.words.map((w) => ({
            word: w.w,
            start_seconds: round(w.start),
            end_seconds: round(w.end),
          }))
        : undefined,
      dead_weight: dead.map((d) => ({
        kind: d.kind,
        start_seconds: round(d.start),
        end_seconds: round(d.end),
        seconds: round(d.seconds),
        reason: d.reason,
      })),
      dead_weight_note: dead.length
        ? `${dead.length} hesitation(s) or silence(s) worth ${round(dead.reduce((s, d) => s + d.seconds, 0))}s in total. propose_tidy stages cuts for all of them in one call.`
        : "No fillers or dead air found.",
    });
  },
};

export const getCompositionCode = {
  name: "get_composition_code",
  description:
    "Return the composition as the TSX file it compiles to: one Sequence per graphic, with the exact frame it starts on and how many frames it runs for. This is the same code the editor sees in the Code tab. Read it when you need to reason about the composition as a whole rather than one layer at a time, or to quote a specific line back to the person you are helping.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () =>
    json({
      language: "tsx",
      fps: composition().fps,
      code: generate(composition(), { cutSeconds: cutSeconds() }),
      note:
        "Generated from the composition, not hand-written, and nothing you send is ever evaluated. To change it, call propose_layer or propose_layer_change; the file is printed again from the result.",
    }),
};

/* ----------------------------------------------------------------- staging */

/**
 * The layer schema, generated from the components themselves.
 *
 * This used to be typed out by hand, which meant a component could declare a
 * field and the tool would still refuse it — `additionalProperties: false` and
 * a stale property list is a silent way to make a feature unreachable. The
 * component library is the single description of what a graphic takes, so the
 * schema is built from it and adding a field to a component is the whole job.
 */
const FIELD_TYPE = { number: "number", object: "object", "string[]": "array" };

function layerFieldSchema(name, spec, componentsUsing) {
  const who = componentsUsing.length && componentsUsing.length < COMPONENT_KEYS.length
    ? `${componentsUsing.join(", ")} only. `
    : "";
  const description = `${who}${spec.note ?? ""}`.trim() || undefined;

  if (name === "point") {
    return {
      type: "object",
      description,
      properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 } },
      required: ["x", "y"],
      additionalProperties: false,
    };
  }
  if (name === "items") {
    return { type: "array", items: { type: "string", maxLength: spec.max ?? 90 }, maxItems: 6, description };
  }
  if (name === "timings") {
    return { type: "array", items: { type: "integer", minimum: 0 }, maxItems: 40, description };
  }
  const type = FIELD_TYPE[spec.type] ?? "string";
  const out = { type, description };
  if (type === "string" && spec.max) out.maxLength = spec.max;
  return out;
}

/** Every field any component declares, with the components that take it. */
function componentFieldProperties() {
  const seen = new Map();
  for (const key of COMPONENT_KEYS) {
    for (const [name, spec] of Object.entries(COMPONENT_INFO[key].fields ?? {})) {
      if (!seen.has(name)) seen.set(name, { spec, used: [] });
      seen.get(name).used.push(key);
      // Keep the longest note: the component that bothered to explain it.
      if ((spec.note ?? "").length > (seen.get(name).spec.note ?? "").length) seen.get(name).spec = spec;
    }
  }
  return Object.fromEntries(
    [...seen].map(([name, { spec, used }]) => [name, layerFieldSchema(name, spec, used)])
  );
}

const LAYER_FIELDS = componentFieldProperties();

const COLOUR_NOTE =
  "A palette role, or a hex like \"#F54E00\". Roles resolve against the live theme, so one spec is legible in light and dark; send a hex when the exact colour is the point. Roles: " +
  PALETTE_ROLES.join(", ") + ".";

const COMPONENT_MENU = COMPONENT_KEYS
  .map((k) => `${k}: ${COMPONENT_INFO[k].blurb}`)
  .join(" ");

export const proposeLayerTool = {
  name: "propose_layer",
  description:
    `Propose a motion graphic over the cut. It appears at once on the timeline as a dashed, unconfirmed layer that previews live, and it is not in the video until the editor accepts it. Choose from: ${COMPONENT_MENU} For anything the preset graphics do not cover, use 'text' (full control of typeface, size, colour, alignment and animation), 'shape' (rectangles, ellipses, pills, triangles, lines, arrows, rings and stars in any colour and rotation) or 'effect' (flash, vignette, grain, scanlines, glitch, letterbox, wash). Colour is a palette role or a hex. Call get_composition first for the format and what is already there, and get_transcript if they asked for it over something they said.`,
  inputSchema: {
    type: "object",
    properties: {
      component: { type: "string", enum: [...COMPONENT_KEYS] },
      ...LAYER_FIELDS,
      at_seconds: { type: "number", minimum: 0, description: "Seconds from the start of the finished cut. From get_timeline or get_transcript." },
      duration_seconds: { type: "number", minimum: 0.2, maximum: 30, description: "Seconds on screen. Leave it out for the component's own sensible default." },
      position: { type: "string", enum: [...POSITIONS], description: "A named anchor. For `text` and `shape` you can send `point` instead and place it anywhere." },
      palette_role: { type: "string", description: COLOUR_NOTE },
      easing: { type: "string", enum: [...EASING_NAMES] },
      reason: { type: "string", maxLength: 200, description: "One sentence, shown to the editor on the card. Why this, here." },
    },
    required: ["component", "at_seconds"],
    additionalProperties: false,
  },
  execute: (args) => {
    const result = proposeLayer({ ...args, origin: "agent" }, context());
    if (!result.ok) return fail(result.error, result.hint);
    const fps = composition().fps;
    return json({
      ok: true,
      layer_id: result.layer.id,
      staged: true,
      from_frame: result.layer.from,
      duration_frames: result.layer.durationInFrames,
      note: `On the editor's timeline as a dashed proposal at frame ${result.layer.from} (${round(toSeconds(result.layer.from, fps))}s), previewing live. Nothing is in the video until they accept it, and there is no tool that accepts.`,
    });
  },
};

/**
 * A blank clip to build on.
 *
 * Until this existed a graphic had to sit on footage, so an agent asked to
 * "make me an animated title card" had nowhere to put one. A blank takes up
 * real time on the spine and paints a colour, and every graphic tool then
 * works over it exactly as it would over a take.
 *
 * Staged, not added: it changes the length of their cut, which is not a
 * decision a tool gets to make.
 */
export const proposeBlankTool = {
  name: "propose_blank_clip",
  description:
    "Propose a blank clip on the timeline: a solid colour that takes up time, for building motion graphics on when there is no footage to put them over. Stage this first when they ask for a title sequence, an animated card or a graphics-only piece, then propose layers over it with propose_layer. It appears as a dashed block on the base track and is not part of the cut until the editor accepts it.",
  inputSchema: {
    type: "object",
    properties: {
      seconds: { type: "number", minimum: 0.5, maximum: 60, description: "How long it lasts. Five is a sensible title card." },
      colour: { type: "string", description: 'The ground, as a hex like "#101018". Leave it out for the theme\'s own dark ground, which is the safe choice.' },
      reason: { type: "string", maxLength: 200, description: "One sentence, shown to the editor. Why this, here." },
    },
    required: ["seconds"],
    additionalProperties: false,
  },
  execute: (args) => {
    if (!Editor.isOpen()) {
      return fail("The Editor is not open.", "Ask them to open the Editor, then try again.");
    }
    const colour = args.colour == null ? null : String(args.colour).trim();
    if (colour && !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(colour)) {
      return fail(`"${colour}" is not a colour.`, 'Send a hex like "#101018", or leave it out for the theme ground.');
    }
    const seg = Editor.stageBlank({ seconds: Number(args.seconds), colour });
    if (!seg) return fail("Could not stage a blank clip.", "Ask them to open the Editor.");
    return json({
      ok: true,
      segment_uid: seg.uid,
      staged: true,
      seconds: round(seg.out - seg.in),
      note: "A dashed blank on the base track, at the end of the cut. Propose your graphics over it with propose_layer using at_seconds inside its range. Nothing is in the video until they accept it, and there is no tool that accepts.",
    });
  },
};

export const proposeLayerChangeTool = {
  name: "propose_layer_change",
  description:
    "Propose a change to a layer that is already on the cut: retime it, move it, reword it, recolour it. The original stays exactly as it is until the editor accepts the change, so rejecting costs them nothing. Send only the fields you are changing; everything else is kept.",
  inputSchema: {
    type: "object",
    properties: {
      layer_id: { type: "string", description: "Id from get_composition." },
      component: { type: "string", enum: [...COMPONENT_KEYS], description: "Change what kind of graphic it is. The fields it takes change with it." },
      ...LAYER_FIELDS,
      at_seconds: { type: "number", minimum: 0 },
      duration_seconds: { type: "number", minimum: 0.2, maximum: 30 },
      position: { type: "string", enum: [...POSITIONS] },
      palette_role: { type: "string", description: COLOUR_NOTE },
      easing: { type: "string", enum: [...EASING_NAMES] },
      reason: { type: "string", maxLength: 200 },
    },
    required: ["layer_id"],
    additionalProperties: false,
  },
  execute: (args) => {
    const { layer_id, ...patch } = args;
    const result = proposeLayerChange(String(layer_id ?? ""), patch, context());
    if (!result.ok) return fail(result.error, result.hint);
    return json({
      ok: true,
      layer_id: result.layer.id,
      replaces: result.layer.replaces,
      staged: true,
      note: "Staged beside the original. The editor sees both and chooses; accepting the change removes the one it replaces.",
    });
  },
};

export const proposeSound = {
  name: "propose_sound",
  description:
    `Propose sound: a one-shot effect on a moment, or a music bed under a stretch of the cut. Effects are synthesised in the browser, so there is nothing to load and nothing to license — pick one of: ${SFX_NAMES.map((n) => `${n} (${SFX_PRESETS[n].blurb})`).join(" ")} A music bed takes an existing clip from the library and ducks itself under speech automatically, using the transcript's word boundaries, so you do not need to shape the volume yourself.`,
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["sfx", "music"], description: "'sfx' for a one-shot on a moment, 'music' for a bed under a stretch." },
      preset: { type: "string", enum: [...SFX_NAMES], description: "sfx only. Which effect." },
      clip_id: { type: "string", description: "music only. The clip to take the bed from, from list_clips." },
      at_seconds: { type: "number", minimum: 0, description: "Seconds from the start of the cut. For an effect under a graphic, use that graphic's at_seconds so they land together." },
      duration_seconds: { type: "number", minimum: 0.2, description: "music only. Leave it out to run to the end of the cut." },
      gain: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "0 to 1. A bed under speech wants 0.1 to 0.25; above 0.4 it competes with the voice. An effect wants 0.4 to 0.8.",
      },
      duck: { type: "boolean", description: "music only. Duck under speech. Default true, and leaving it true is almost always right." },
      reason: { type: "string", maxLength: 200 },
    },
    required: ["kind", "at_seconds"],
    additionalProperties: false,
  },
  execute: async (args) => {
    const clips = await Clips.all();
    const result = proposeAudio(
      { ...args, origin: "agent" },
      { ...context(), clipIds: clips.map((c) => c.id) }
    );
    if (!result.ok) return fail(result.error, result.hint);
    return json({
      ok: true,
      sound_id: result.track.id,
      staged: true,
      note: "Staged on the editor's sound row. They can audition it and then accept or reject it; it is not in the video until they do.",
    });
  },
};

export const proposeFormatTool = {
  name: "propose_format",
  description:
    "Propose reframing the whole composition to a different aspect ratio. Every graphic is laid out as fractions of the frame, so this moves nothing and rewrites nothing — the same composition simply becomes 16:9, 9:16 or 1:1, with the safe margins that format needs. Use it when they mention shorts, reels, vertical or a square post.",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: [...FORMAT_NAMES],
        description: FORMAT_NAMES.map((f) => `${f} is ${formatOf(f).label}`).join(", "),
      },
      reason: { type: "string", maxLength: 200 },
    },
    required: ["format"],
    additionalProperties: false,
  },
  execute: (args) => {
    const result = proposeFormat(args.format, { reason: args.reason });
    if (!result.ok) return fail(result.error, result.hint);
    return json({
      ok: true,
      staged: true,
      format: result.format,
      aspect: formatOf(result.format).label,
      note: "Staged. The editor sees the reframe with safe-area guides before deciding, because a caption that is comfortable at 16:9 is often outside the safe area at 9:16.",
    });
  },
};

export const proposeCutTool = {
  name: "propose_cut",
  description:
    "Propose removing a stretch of the cut. Give it a quote and it finds the words in the transcript and stages a cut over exactly them, which is how 'take out the bit where I stumble over the second point' becomes a precise range. It appears as a marked region on the timeline and nothing is removed until the editor accepts it. Removing footage is the most destructive thing in this app, so it is also the one most firmly behind a click.",
  inputSchema: {
    type: "object",
    properties: {
      quote: {
        type: "string",
        maxLength: 200,
        description: "The words to cut, as they were said. Preferred over raw seconds: it is checked against the transcript, so it cannot land in the wrong place.",
      },
      start_seconds: { type: "number", minimum: 0, description: "Use only when there is no transcript. Seconds into the finished cut." },
      end_seconds: { type: "number", minimum: 0, description: "Use only when there is no transcript." },
      reason: { type: "string", maxLength: 200, description: "One sentence shown on the marker. Why this should go." },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    let start = args.start_seconds;
    let end = args.end_seconds;
    let text = "";

    if (args.quote) {
      const transcript = await cutTranscript();
      if (!transcript) {
        return fail(
          "There is no transcript for this cut, so a quote cannot be located.",
          "Call get_transcript to see why, or pass start_seconds and end_seconds instead."
        );
      }
      const hits = findWords(transcript, args.quote);
      if (!hits.length) {
        return fail(
          `"${args.quote}" is not said in the cut in that order.`,
          "Call get_transcript to read what is actually there. The words may already have been trimmed out."
        );
      }
      if (hits.length > 1) {
        return fail(
          `"${args.quote}" is said ${hits.length} times, at ${hits.map((h) => `${round(h.start)}s`).join(", ")}.`,
          "Quote more of the surrounding words so there is only one match, or ask which one they mean. Do not guess."
        );
      }
      start = hits[0].start;
      end = hits[0].end;
      text = hits[0].text;
    }

    if (start == null || end == null) {
      return fail(
        "Give either a quote, or start_seconds and end_seconds.",
        "A quote is better: it is resolved against the transcript so it cannot land in the wrong place."
      );
    }

    const result = proposeCut(
      { start, end, reason: args.reason, text, kind: args.quote ? "quote" : "manual" },
      context()
    );
    if (!result.ok) return fail(result.error, result.hint);
    return json({
      ok: true,
      cut_id: result.cut.id,
      staged: true,
      start_seconds: round(result.cut.start),
      end_seconds: round(result.cut.end),
      removes_seconds: round(result.cut.end - result.cut.start),
      note: "Marked on the editor's timeline. Nothing is removed until they accept it, and there is no tool that accepts.",
    });
  },
};

export const proposeTidy = {
  name: "propose_tidy",
  description:
    "Find every hesitation and every silence in the cut and stage a cut over each one, in a single call. Only mechanical things: 'um' and 'uh' and holes in the audio longer than about a second. It never proposes cutting a sentence for being weak, because that is a judgement and this is a list. Each one is marked separately on the timeline so they can be taken or left one at a time.",
  inputSchema: {
    type: "object",
    properties: {
      min_silence_seconds: {
        type: "number",
        minimum: 0.4,
        maximum: 5,
        description: "How long a gap has to be before it counts as dead air. Default 1.1. Below about 0.8 you start cutting breaths, which makes the edit sound rushed.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args) => {
    const transcript = await cutTranscript();
    if (!transcript) {
      return fail(
        "There is no transcript for this cut, so there is nothing to scan.",
        "Call get_transcript to see why. A clip recorded with the teleprompter loaded gets one for free."
      );
    }

    const deadAir = args.min_silence_seconds == null ? undefined : Number(args.min_silence_seconds);
    const found = findDeadWeight(transcript, deadAir != null ? { deadAir } : {});
    if (!found.length) {
      return json({
        ok: true,
        staged: 0,
        note: "Nothing to tidy: no fillers and no dead air. Say so rather than inventing something to cut.",
      });
    }

    const staged = [];
    const skipped = [];
    for (const item of found) {
      const result = proposeCut(
        { start: item.start, end: item.end, reason: item.reason, text: item.text, kind: item.kind },
        context()
      );
      if (result.ok) staged.push({ cut_id: result.cut.id, start_seconds: round(item.start), seconds: round(item.seconds), reason: item.reason });
      else skipped.push({ start_seconds: round(item.start), why: result.error });
    }

    return json({
      ok: true,
      staged: staged.length,
      would_remove_seconds: round(staged.reduce((s, c) => s + c.seconds, 0)),
      cuts: staged,
      skipped: skipped.length ? skipped : undefined,
      waiting_on_the_editor: pendingCuts().length,
      note: "All marked on the timeline, each with its own reason, to accept or reject one at a time. Nothing has been removed.",
    });
  },
};

export const COMP_TOOLS = [
  getComposition,
  getTranscript,
  getCompositionCode,
  proposeLayerTool,
  proposeBlankTool,
  proposeLayerChangeTool,
  proposeSound,
  proposeFormatTool,
  proposeCutTool,
  proposeTidy,
];
