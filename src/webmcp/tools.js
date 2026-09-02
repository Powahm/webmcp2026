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

/* ---------------------------------------------------------------- desktop */

export const getDesktopState = {
  name: "get_desktop_state",
  description:
    "Return which apps and folders exist on this desktop, which windows are open, and which one has focus. Call it first: what the user is looking at decides whether they are writing, filming or editing, and a note about the timeline is useless to someone standing in front of a camera.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const windows = Desk.openWindows();
    const focused = windows.find((w) => w.focused) ?? null;
    return json({
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
    "Return every script saved on this desktop, with its name and how many beats it has. A beat is one paragraph, and it is the unit the teleprompter advances through. Returns names and sizes, not the text; call get_script for that.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: async () => {
    const scripts = await Store.all("scripts");
    return json({
      scripts: scripts.map((s) => ({
        id: s.id,
        name: s.name,
        beats: Scripts.beatsOf(s.code).length,
        characters: s.code.length,
        updated: s.updated ?? s.created,
      })),
    });
  },
};

export const getScript = {
  name: "get_script",
  description:
    "Return one saved script in full, split into beats. Use it to read what the user plans to say before suggesting anything about the take or the edit.",
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
        "Call list_scripts for the ids on this desktop. They look like 'script-1788...'."
      );
    }
    return json({
      id: script.id,
      name: script.name,
      beats: Scripts.beatsOf(script.code).map((text, i) => ({ index: i, text })),
    });
  },
};

export const getOpenScript = {
  name: "get_open_script",
  description:
    "Return the script the user has open in front of them right now, including any unsaved text, where their caret is, and what they have selected. Use this before answering anything phrased as 'this line', 'what I just wrote', or 'this bit'. It is the live editor, not the saved file, so it can differ from get_script.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const open = Scripts.openScriptState();
    if (!open) {
      return json({
        open: null,
        note: "No script window is open. Call list_scripts, then open_app to bring the Scripts folder up.",
      });
    }
    return json({
      open: {
        id: open.id,
        name: open.name,
        unsaved: open.unsaved,
        caret: open.caret,
        selection: open.selection,
        beats: open.beats.map((text, i) => ({ index: i, text })),
      },
    });
  },
};

/* --------------------------------------------------------------- recorder */

export const getRecorderState = {
  name: "get_recorder_state",
  description:
    "Return what the Camera is doing right now: idle, armed with a live preview, or recording, plus how many seconds into the take it is. Check this before suggesting anything. Someone mid-take cannot read a paragraph of advice, and you cannot start or stop a recording yourself.",
  inputSchema: NO_INPUT,
  annotations: READ_ONLY,
  execute: () => {
    const state = Camera.state();
    return json({
      status: state.status,
      elapsed_seconds: round(state.elapsed),
      elapsed: timecode(state.elapsed),
      audio: state.audio,
      window_open: state.windowOpen,
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
  execute: () => {
    const segments = describeTimeline();
    return json({
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

export const TOOLS = [
  getDesktopState,
  listScripts,
  getScript,
  getOpenScript,
  getRecorderState,
  listClips,
  getTimeline,
  getSelection,
  getPlayhead,
];
