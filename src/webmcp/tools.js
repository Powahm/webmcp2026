import { Desk } from "../legacy/shell.js";
import { json, NO_INPUT, READ_ONLY } from "./result.js";

/**
 * The site tools.
 *
 * The rule this file follows: a tool exists when it reads or changes something
 * that only this page knows. Desk Two already had a scripting API for people,
 * in legacy/scripts-app.js, and most of what follows is that same API described
 * in JSON Schema and handed to an agent instead of to a text editor. That is
 * exactly what the site-tools guidance asks for, reuse your existing
 * application logic and permissions, and it is why this layer is thin.
 *
 * Read-only tools carry `annotations: { readOnlyHint: true }` so the browser
 * does not gate them behind a confirmation prompt. Nothing that stages a change
 * ever carries it.
 */

export const getDesktopState = {
  name: "get_desktop_state",
  description:
    "Return which apps and folders exist on this desktop, which windows are currently open, and which one has focus. Call it first: what the user is looking at decides whether they are scripting, filming or editing, and a suggestion about the timeline is useless to someone standing in front of a camera.",
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
        : "Nothing is open. Use open_app, or ask the user what they are working on.",
    });
  },
};

export const TOOLS = [getDesktopState];
