import { kindOf } from "./offered.js";

/**
 * Folders that are actually on the desk.
 *
 * The ghost-folder flow depended on the agent volunteering a manifest through
 * offer_folder, and in practice ChatGPT does not: it has a folder attached to
 * the chat and no reason to think a web page wants to hear about it. So the
 * page asks instead. The ghost offers, the person picks, and what comes back
 * becomes a real folder icon on the desktop next to Readme and Scripts.
 *
 * Kept out of shell.js's registry because the registry is the fixed set of apps
 * the machine ships with, and these come and go with whatever someone imported
 * this session.
 */

let folders = [];
let counter = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const onDeskFolders = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const deskFolders = () => folders.slice();
export const deskFolder = (id) => folders.find((f) => f.id === id) || null;

export function addDeskFolder({ name, files }) {
  const folder = {
    id: `desk-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    name: String(name || "Folder").slice(0, 40),
    files: files.map((f) => ({
      name: f.name,
      kind: kindOf(f.name),
      size: f.size ?? null,
      clipId: f.clipId ?? null,
      scriptId: f.scriptId ?? null,
    })),
    created: Date.now(),
  };
  folders = [...folders, folder];
  emit();
  return folder;
}

export function forgetDeskFolder(id) {
  folders = folders.filter((f) => f.id !== id);
  emit();
}
