import { EASINGS, PALETTE_ROLES, POSITIONS, TYPES, TYPE_INFO } from "../graphics/spec.js";
import { liveGraphics, proposeChange, proposeGraphic } from "../graphics/store.js";
import { allFolders, offerFolder } from "../folders/offered.js";
import { proposalsFor, proposeLine } from "../scripts/proposals.js";
import { allSkills, loadedAt, markLoaded, matchSkills } from "../legacy/aiskills.js";
import { currentSignals } from "../skills/signals.js";
import { Camera } from "../legacy/camera.js";
import { Editor } from "../legacy/editor.js";
import { Scripts } from "../legacy/scripts-app.js";
import { Desk } from "../legacy/shell.js";
import { Clips, Store, timecode } from "../legacy/store.js";
import { fail, json, NO_INPUT, READ_ONLY } from "./result.js";

/**
 * The site tools.
 *
 * One rule decides what belongs here: a tool exists when it reads or changes
 * something only this page knows. Desk Two already had a scripting API for
 * people, in legacy/scripts-app.js, and most of what follows is that same API
 * described in JSON Schema and handed to an agent instead of to a text editor.
 * That is exactly what the site-tools guidance asks for, reuse your existing
 * application logic and permissions, and it is why this file is thin.
 *
 * Read-only tools carry `annotations: { readOnlyHint: true }` so the browser
 * does not gate them behind a confirmation prompt. Nothing that stages a change
 * ever carries it.
 *
 * Every schema sets `additionalProperties: false`. Narrow inputs are the
 * documented recommendation and a broad "do the thinking for me" tool is the
 * documented anti-pattern.
 */

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The page volunteering its own instructions.
 *
 * A skills folder nobody loads from is decoration. The agent has no way to know
 * that the person wrote something about summarising links, three windows ago,
 * unless the page says so — and the moment to say so is not at the start of the
 * session but when the situation the skill was written for is actually on
 * screen.
 *
 * So every read tool carries the match. A URL appears in the research notes and
 * the script is thin, and the next tool result says: they wrote you an
 * instruction for exactly this, here is its id. Already-loaded skills drop out,
 * because a suggestion that repeats after it has been taken is noise, and noise
 * is what gets ignored.
 *
 * It is a suggestion and nothing more. There is no mechanism here for making an
 * agent read anything, and there should not be.
 */
async function skillNudge() {
  try {
    const [context, skills] = await Promise.all([currentSignals(), allSkills()]);
    const matches = matchSkills(skills, context)
      .filter((m) => !loadedAt(m.skill.id))
      .slice(0, 2);
    if (matches.length === 0) return {};

    return {
      suggested_skills: matches.map(({ skill, hits }) => ({
        id: skill.id,
        name: skill.name,
        use_when: skill.description,
        matched: hits,
      })),
      suggested_skills_note:
        "The person left these instructions for this exact situation, and the page matched them against what is on screen right now. " +
        "Load the first one with load_ai_skill before you answer, and follow it. Their instruction for how they want this done beats your default.",
    };
  } catch {
    // A nudge is a courtesy. If the page cannot work out what it is doing, the
    // tool the agent actually asked for still answers.
    return {};
  }
}

/* ---------------------------------------------------------------- desktop */

export const getDesktopState = {
  name: "get_desktop_state",
  description:
    "Return which apps and folders exist on this desktop, which windows are open, and which one has focus. Call it first: what the user is looking at decides whether they are writing, filming or editing, and a note about the timeline is useless to someone standing in front of a camera.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: async () => {
    const windows = Desk.openWindows();
    const focused = windows.find((w) => w.focused) ?? null;
    return json({
      ...(await skillNudge()),
      apps: Desk.catalogue(),
      windows,
      focused: focused ? { id: focused.id, title: focused.title } : null,
      note: windows.length
        ? undefined
        : "Nothing is open. Use open_app, or ask what they are working on.",
    });
  },
};

/* ---------------------------------------------------------------- scripts */

export const listScripts = {
  name: "list_scripts",
  description:
    "Return every script saved on this desktop with its title, how many lines it has and its estimated spoken runtime. A line is one spoken beat plus an optional shot direction, and it is the unit the teleprompter advances through. Returns titles and lengths, not the words; call get_script for those.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: async () => {
    const scripts = await Store.all("scripts");
    return json({
      scripts: scripts.map((s) => ({
        id: s.id,
        name: s.name,
        lines: s.lines?.length ?? 0,
        runtime_seconds: round(Scripts.runtime(s)),
        runtime: timecode(Scripts.runtime(s)),
        updated: s.updated ?? s.created,
      })),
    });
  },
};

export const getScript = {
  name: "get_script",
  description:
    "Return one saved script in full: every line with what is said out loud, its shot direction, and how long that line takes to say. Read it before suggesting anything about the take or the edit, because the shot directions say what the footage is meant to show.",
  inputSchema: {
    type: "object",
    properties: { script_id: { type: "string", description: "Id from list_scripts." } },
    required: ["script_id"],
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  execute: async (args) => {
    const id = String(args.script_id ?? "");
    const script = (await Store.all("scripts")).find((s) => s.id === id);
    if (!script) {
      return fail(
        `No script with id "${id}".`,
        "Call list_scripts for the ids on this desktop. They look like 'script-1788...' or 'example-intro'."
      );
    }
    return json({
      id: script.id,
      name: script.name,
      runtime_seconds: round(Scripts.runtime(script)),
      lines: (script.lines ?? []).map((l, i) => ({
        index: i,
        text: l.text,
        note: l.note || null,
        seconds: round(Scripts.seconds(l.text)),
      })),
    });
  },
};

export const getOpenScript = {
  name: "get_open_script",
  description:
    "Return the script the writer has open in front of them right now, taken from the live fields rather than the saved record, so a line they are still typing is included. Says which line and which field their caret is in and what they have selected. Use this before answering anything phrased as 'this line', 'what I just wrote', or 'this bit'.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: async () => {
    const open = Scripts.openScriptState();
    if (!open) {
      return json({
        ...(await skillNudge()),
        open: null,
        note: "No script window is open. Call list_scripts, then open_app to bring the Scripts folder up.",
      });
    }
    return json({
      ...(await skillNudge()),
      open: {
        ...open,
        runtime_seconds: round(open.runtime_seconds),
        runtime: timecode(open.runtime_seconds),
        // Lines you have already written into this draft that they have not
        // decided on. Do not propose the same thing twice.
        pending_lines: proposalsFor(open.id).map((p) => ({
          id: p.id,
          index: p.index,
          mode: p.mode,
          text: p.text,
        })),
      },
    });
  },
};

export const getPrompterState = {
  name: "get_prompter_state",
  description:
    "Return what the teleprompter is showing at this instant: the line the speaker is on, its shot direction, how far through the script they are, and whether it is scrolling or paused. Only meaningful while the prompter is up. If it is running, the person is mid-performance: keep any answer to one short sentence, or say nothing.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const state = Scripts.prompterState();
    if (!state) {
      return json({
        running: false,
        prompter: null,
        note: "The teleprompter is closed. Open a script and press Teleprompter to start it.",
      });
    }
    return json({
      prompter: {
        ...state,
        progress: Math.round(state.progress * 100) / 100,
        runtime_seconds: round(state.runtime_seconds),
      },
      note: state.running
        ? "The prompter is scrolling, so they are speaking to camera right now. Do not answer at length."
        : undefined,
    });
  },
};

/* --------------------------------------------------------------- recorder */

export const getRecorderState = {
  name: "get_recorder_state",
  description:
    "Return what the Camera is doing right now: idle, armed with a live preview, or recording, how many seconds into the take it is, and the teleprompter script loaded into it with the exact line they are on. Check this before suggesting anything. Someone mid-take cannot read a paragraph of advice, and you cannot start or stop a recording yourself.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: async () => {
    const state = Camera.state();
    return json({
      ...(await skillNudge()),
      status: state.status,
      elapsed_seconds: round(state.elapsed),
      elapsed: timecode(state.elapsed),
      // What the stream actually carries. acquire() walks a constraint ladder
      // and will drop audio to get a picture at all, so asking for a mic and
      // having one are two different facts.
      audio: state.audio,
      audio_requested: state.audioRequested,
      // "camera" or "screen". A screen recording is a tutorial or a walkthrough
      // and wants different advice from a piece to camera.
      source: state.source,
      window_open: state.windowOpen,
      // The teleprompter as loaded in the Camera, which is what tells you what
      // they are about to say rather than what they saved yesterday.
      script: state.script,
      note:
        state.status === "recording"
          ? "A take is running. Do not interrupt with a long answer, and do not propose edits until it stops."
          : undefined,
    });
  },
};

/* ------------------------------------------------------------------ clips */

export const listClips = {
  name: "list_clips",
  description:
    "Return the clip library: everything recorded or imported on this desktop, oldest first. Clips are held in this browser and have never been uploaded anywhere, so this is the only place they can be listed.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["recording", "import", "export", "screen"],
        description: "Optional. Restrict to one kind of clip.",
      },
    },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  execute: async (args) => {
    const kind = args.kind ? String(args.kind) : null;
    const clips = await Clips.all();
    return json({
      clips: clips
        .filter((c) => !kind || c.kind === kind)
        .map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          duration_seconds: round(c.duration),
          duration: timecode(c.duration),
          width: c.width,
          height: c.height,
        })),
    });
  },
};

/* --------------------------------------------------------------- timeline */

function describeTimeline() {
  let start = 0;
  return Editor.timeline.map((seg) => {
    const clip = Editor.clipFor(seg.clipId);
    const length = Math.max(0.05, (seg.out - seg.in) / seg.speed);
    const row = {
      uid: seg.uid,
      clip_id: seg.clipId,
      name: clip?.name ?? seg.clipId,
      starts_at: round(start),
      length_seconds: round(length),
      in: round(seg.in),
      out: round(seg.out),
      look: seg.filter,
      speed: seg.speed,
      muted: seg.muted,
      selected: seg.uid === Editor.selectedUid,
    };
    start += length;
    return row;
  });
}

export const getTimeline = {
  name: "get_timeline",
  description:
    "Return the cut as it stands: every segment in order with its in and out points, look, speed and where it starts in the finished piece. This is the working edit, not the clip library. Use list_clips for what is available to add.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: async () => {
    const segments = describeTimeline();
    return json({
      ...(await skillNudge()),
      open: Editor.isOpen(),
      segments,
      total_seconds: round(Editor.totalDuration),
      total: timecode(Editor.totalDuration),
      looks: Object.keys(Editor.FILTERS),
      speeds: Editor.SPEEDS,
      note: segments.length
        ? undefined
        : "The timeline is empty. Nothing can be proposed against it yet.",
    });
  },
};

export const getSelection = {
  name: "get_selection",
  description:
    "Return the segment the user currently has selected in the Editor. Use this before answering anything phrased as 'this clip', 'this bit', or 'tighten this'. Nothing outside this tab knows what is selected.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const selected = describeTimeline().find((s) => s.selected) ?? null;
    return json({
      selected,
      note: selected
        ? undefined
        : "Nothing is selected. Ask which part they mean, or call get_timeline and describe the whole cut.",
    });
  },
};

export const getPlayhead = {
  name: "get_playhead",
  description:
    "Return where the playhead is in the Editor preview and which segment sits under it. Use it to talk about the moment the user is actually looking at.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    if (!Editor.isOpen()) {
      return json({ open: false, note: "The Editor is not open, so there is no playhead." });
    }
    const at = Editor.playhead;
    const under = describeTimeline().find((s) => at >= s.starts_at && at < s.starts_at + s.length_seconds) ?? null;
    return json({
      open: true,
      at_seconds: round(at),
      at: timecode(at),
      total: timecode(Editor.totalDuration),
      under: under ? { uid: under.uid, name: under.name, offset_seconds: round(at - under.starts_at) } : null,
    });
  },
};

/* --------------------------------------------------------------- graphics */

const GRAPHIC_MENU = TYPES.map((t) => `${t}: ${TYPE_INFO[t].blurb}`).join(" ");

export const getGraphics = {
  name: "get_graphics",
  description:
    "Return the motion graphics on this cut, both the ones you have proposed and the ones the editor has accepted, with their timings and settings. Call it before proposing, so you build on what is there instead of stacking a second title card on top of the first.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () =>
    json({
      graphics: liveGraphics().map((g) => ({
        id: g.id,
        type: g.type,
        status: g.status,
        text: g.text,
        subtext: g.subtext,
        start: round(g.start),
        duration: round(g.duration),
        position: g.position,
        palette_role: g.palette_role,
        easing: g.easing,
        point: g.point,
        proposed_by: g.origin,
      })),
      types: TYPE_INFO,
      positions: POSITIONS,
      palette_roles: PALETTE_ROLES,
      note:
        "A graphic with status 'proposed' is waiting on the editor and is not in the video. Only they can accept it.",
    }),
};

/**
 * The tool the whole submission turns on.
 *
 * The agent composes a piece of motion design in a single call, and still
 * cannot put one frame of it into the video. It sends a spec, never CSS, SVG or
 * JavaScript: that is what makes the result always on-theme, impossible to
 * break the page with, and checkable, so a bad proposal comes back with a hint
 * rather than rendering as an empty rectangle nobody notices until export.
 */
export const proposeGraphicTool = {
  name: "propose_graphic",
  description:
    `Propose a motion graphic over the cut. It appears immediately on the timeline as a dashed, unconfirmed overlay the editor can watch and then accept or reject; it is not in the video until they accept it. Choose a type from: ${GRAPHIC_MENU} Call get_timeline first so the timing lands on the right moment, and get_selection if they asked for it over "this bit".`,
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", enum: [...TYPES] },
      text: {
        type: "string",
        maxLength: 90,
        description: "The words that appear on screen. Not a description of them. Short: this is a graphic, not a paragraph.",
      },
      subtext: { type: "string", maxLength: 90, description: "Optional second line: a role, a source, a label under a number." },
      start: { type: "number", minimum: 0, description: "Seconds from the start of the finished cut, from get_timeline." },
      duration: { type: "number", minimum: 0.2, maximum: 30, description: "Seconds on screen. Default 4." },
      position: { type: "string", enum: [...POSITIONS] },
      palette_role: {
        type: "string",
        enum: [...PALETTE_ROLES],
        description: "A role, not a colour. The theme decides what it looks like, so this works in light and dark.",
      },
      easing: { type: "string", enum: [...EASINGS] },
      point: {
        type: "object",
        description: "callout_arrow only. Where to aim, as fractions of the frame: {x: 0.5, y: 0.5} is the middle.",
        properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 } },
        required: ["x", "y"],
        additionalProperties: false,
      },
      reason: { type: "string", maxLength: 200, description: "One sentence, shown to the editor on the card. Why this, here." },
    },
    required: ["type", "start"],
    additionalProperties: false,
  },
  execute: (args) => {
    const result = proposeGraphic({ ...args, origin: "agent" }, { timelineLength: Editor.totalDuration });
    if (!result.ok) return fail(result.error, result.hint);
    return json({
      ok: true,
      graphic_id: result.graphic.id,
      staged: true,
      note: "It is on the editor's timeline as a dashed proposal, previewing live. Nothing is in the video until they accept it, and there is no tool that accepts.",
    });
  },
};

export const proposeGraphicChange = {
  name: "propose_graphic_change",
  description:
    "Propose a change to a graphic that is already on the cut: retime it, move it, reword it, recolour it. The original stays exactly as it is until the editor accepts the change, so rejecting costs them nothing. Send only the fields you are changing.",
  inputSchema: {
    type: "object",
    properties: {
      graphic_id: { type: "string", description: "Id from get_graphics." },
      text: { type: "string", maxLength: 90 },
      subtext: { type: "string", maxLength: 90 },
      start: { type: "number", minimum: 0 },
      duration: { type: "number", minimum: 0.2, maximum: 30 },
      position: { type: "string", enum: [...POSITIONS] },
      palette_role: { type: "string", enum: [...PALETTE_ROLES] },
      easing: { type: "string", enum: [...EASINGS] },
      reason: { type: "string", maxLength: 200 },
    },
    required: ["graphic_id"],
    additionalProperties: false,
  },
  execute: (args) => {
    const { graphic_id, ...patch } = args;
    const result = proposeChange(String(graphic_id ?? ""), patch, { timelineLength: Editor.totalDuration });
    if (!result.ok) return fail(result.error, result.hint);
    return json({
      ok: true,
      graphic_id: result.graphic.id,
      replaces: result.graphic.replaces,
      staged: true,
      note: "Staged beside the original. The editor sees both and chooses; accepting the change removes the one it replaces.",
    });
  },
};

/* ---------------------------------------------------------------- writing */

/**
 * The agent writes into the draft the person is looking at.
 *
 * This is the writing half of the same bargain the graphics tools make. The
 * line appears exactly where it would go, dashed, between the lines around it,
 * because the only useful question about a proposed line is how it reads next
 * to its neighbours. And it is still just sitting there: there is no tool that
 * accepts one, and the accept path refuses anything that is not a trusted user
 * event.
 *
 * Call get_open_script first. The research field is what they pasted in while
 * browsing, and writing from it rather than from memory is the difference
 * between drafting and inventing.
 */
export const proposeScriptLine = {
  name: "propose_script_line",
  description:
    "Write a line into the script the person has open: a new beat, or a rewrite of one that is already there. It appears in place as a dashed suggestion between the lines around it, and it is not in their script until they accept it. Call get_open_script first, so you write from their research and their current draft rather than from memory, and so you do not repeat a line already waiting for them. One line per call: a beat is one thing said to camera, not a paragraph.",
  inputSchema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        minLength: 1,
        maxLength: 320,
        description: "The words they say out loud. Their voice, not yours, and short enough to say in one breath.",
      },
      note: {
        type: "string",
        maxLength: 160,
        description: "Optional shot direction for this beat: camera, b-roll, tone, what is on screen.",
      },
      index: {
        type: "integer",
        minimum: 0,
        description:
          "Which line this concerns, from get_open_script. With mode 'insert' the line lands before this one, so 0 is a new opening and the line count appends at the end.",
      },
      mode: {
        type: "string",
        enum: ["insert", "replace"],
        description: "'insert' adds a beat, 'replace' offers a rewrite of the line at index. Default insert.",
      },
      reason: {
        type: "string",
        maxLength: 200,
        description: "One sentence shown under the suggestion. Why this line, here.",
      },
    },
    required: ["text", "index"],
    additionalProperties: false,
  },
  execute: (args) => {
    const open = Scripts.openScriptState();
    if (!open) {
      return fail(
        "No script is open, so there is nothing to write into.",
        "Call list_scripts, then ask them to open the one they want to work on. You cannot open a script yourself."
      );
    }

    const index = Number(args.index);
    const mode = args.mode === "replace" ? "replace" : "insert";
    const limit = mode === "replace" ? open.lines.length - 1 : open.lines.length;
    if (!Number.isInteger(index) || index < 0 || index > Math.max(0, limit)) {
      return fail(
        `index ${args.index} is outside this script, which has ${open.lines.length} line(s).`,
        mode === "replace"
          ? "To replace, use the index of an existing line from get_open_script."
          : `To insert, use 0 to ${open.lines.length}, where ${open.lines.length} adds to the end.`
      );
    }

    const p = proposeLine({
      scriptId: open.id,
      index,
      mode,
      text: String(args.text ?? ""),
      note: args.note,
      reason: args.reason,
    });

    return json({
      ok: true,
      proposal_id: p.id,
      staged: true,
      note: "It is in their draft as a dashed suggestion in the position you gave. Nothing changes in the script until they accept it, and there is no tool that accepts.",
    });
  },
};

/* ---------------------------------------------------------------- folders */

/**
 * The agent says what it has; the page draws it; the person opens the door.
 *
 * A page cannot see what an agent has access to. WebMCP runs one way, and no
 * browser lets a page read a directory without a click. So the announcing is
 * inverted: the agent, which does know, sends a manifest, and a ghost folder
 * appears on the desktop. Hovering says what is inside. Clicking opens the
 * browser's own picker, and that gesture is the authorisation.
 *
 * Text can ride along in the call, because a script fits. Video cannot, so it
 * waits for the picker. There is no tool that imports a folder.
 */
export const offerFolderTool = {
  name: "offer_folder",
  description:
    "Tell this page about a folder you have access to, so it can offer to import it. Send the folder's name and a list of what is in it; the page draws it on the desktop as a ghost folder the person can accept or ignore. For text files (.txt, .md, .srt, .vtt) you may include the contents and they land immediately as scripts. Do not try to send video: it will not fit, and the page asks the person to point the browser at the folder instead. This does not read anything from their machine and does not import anything by itself.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 60, description: "The folder's name as they would recognise it." },
      files: {
        type: "array",
        minItems: 1,
        maxItems: 60,
        description: "What is in the folder. Names only, unless it is a text file you can include.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200, description: "File name including its extension." },
            size: { type: "integer", minimum: 0, description: "Bytes, if you know. Shown to them, never used to decide anything." },
            text: {
              type: "string",
              maxLength: 20000,
              description: "Text files only. The contents, which become a script with one line per paragraph. Omit for video.",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
      reason: { type: "string", maxLength: 200, description: "One sentence, shown when they hover it. Why this folder is worth importing." },
    },
    required: ["name", "files"],
    additionalProperties: false,
  },
  execute: (args) => {
    const result = offerFolder({
      name: String(args.name ?? ""),
      files: Array.isArray(args.files) ? args.files : [],
      reason: args.reason,
    });
    if (!result.ok) return fail(result.error, result.hint);

    const withText = result.folder.files.filter((f) => f.kind === "text" && f.text).length;
    return json({
      ok: true,
      folder_id: result.folder.id,
      offered: true,
      files: result.folder.files.length,
      text_included: withText,
      note:
        "It is on their desktop as a ghost folder. Nothing has been read from their machine. " +
        (withText
          ? `The ${withText} text file(s) you included will land as scripts the moment they accept; everything else waits for them to point the browser at the folder.`
          : "They will be asked to point the browser at the folder, which is the only way its contents can be read."),
    });
  },
};

export const getOfferedFolders = {
  name: "get_offered_folders",
  description:
    "Return the folders you have offered this page and whether the person accepted them. Check it before offering again, so you do not offer the same folder twice, and to find out whether the files you expected are actually in their library now.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () =>
    json({
      folders: allFolders().map((f) => ({
        id: f.id,
        name: f.name,
        status: f.status,
        files: f.files.length,
        imported: f.counts ?? null,
      })),
      note: "status 'offered' means it is still sitting on their desktop untouched. Only they can accept one.",
    }),
};

/* ------------------------------------------------------------- ai skills */

/**
 * Instructions this page will hand you, if you ask.
 *
 * A page cannot install anything into an agent, and should not be able to: a
 * site that could permanently modify the model visiting it is a security hole
 * wearing a feature's clothes. But a skill is only ever instructions, so a page
 * that answers well when asked has done the whole job. The agent reads the
 * index, decides something is relevant, pulls the body, and follows it for the
 * rest of the session.
 *
 * Which is why this is two tools and not one. The index is small and always
 * safe to call; the body is only worth its tokens when it is going to be used.
 * That is the same progressive disclosure every skill system settles on, and
 * doing it in one tool would mean every agent that glanced at the folder paid
 * for all of it.
 */
export const listAiSkills = {
  name: "list_ai_skills",
  description:
    "Return the skills this workstation offers you: name, when to use it, and how long it is. These are instructions the person put here for you, about how they want this kind of work done. Call this early, once, and remember what is on the list. It returns descriptions only, so it is cheap; when one of them matches what you have been asked to do, call load_ai_skill to get it.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: async () => {
    const skills = await allSkills();
    const matching = new Set(
      matchSkills(skills, await currentSignals()).map((m) => m.skill.id)
    );
    return json({
      skills: skills.map((s) => ({
        id: s.id,
        name: s.name,
        use_when: s.description,
        words: s.words,
        file: s.filename,
        // True when the page's own state already matches this skill's triggers.
        // Start with these.
        relevant_now: matching.has(s.id),
        loaded: Boolean(loadedAt(s.id)),
      })),
      note: skills.length
        ? "These are the person's own instructions for working here. If one matches the task, load it and follow it rather than falling back on your defaults."
        : "Nothing here yet. They can drop markdown into the AI Skills folder inside Skills.",
    });
  },
};

export const loadAiSkill = {
  name: "load_ai_skill",
  description:
    "Return the full text of one skill from list_ai_skills, so you can follow it. Load a skill when its 'use_when' matches the task in front of you, not speculatively. Once loaded, treat it as the person's instruction for this kind of work and apply it for the rest of the session; they can see which skills you have taken.",
  inputSchema: {
    type: "object",
    properties: { skill_id: { type: "string", description: "Id from list_ai_skills." } },
    required: ["skill_id"],
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  execute: async (args) => {
    const id = String(args.skill_id ?? "");
    const skill = (await allSkills()).find((s) => s.id === id);
    if (!skill) {
      return fail(
        `No skill with id "${id}".`,
        "Call list_ai_skills for the ids this workstation offers. They look like 'skill-1788...'."
      );
    }

    // The person sees which skills the agent actually took. A list of skills
    // nobody can tell are being used is indistinguishable from a list nobody
    // is using.
    markLoaded(skill.id);

    return json({
      id: skill.id,
      name: skill.name,
      use_when: skill.description,
      // Everything the file carried, including fields this app does not know
      // about: a skill written for another host should still arrive intact.
      frontmatter: skill.meta,
      instructions: skill.body,
      note: "This is the person's instruction for this kind of work. Follow it for the rest of the session, and say when you are applying it.",
    });
  },
};

export const TOOLS = [
  getDesktopState,
  listScripts,
  getScript,
  getOpenScript,
  getPrompterState,
  getRecorderState,
  listClips,
  getTimeline,
  getSelection,
  getPlayhead,
  getGraphics,
  proposeGraphicTool,
  proposeGraphicChange,
  proposeScriptLine,
  offerFolderTool,
  getOfferedFolders,
  listAiSkills,
  loadAiSkill,
];
