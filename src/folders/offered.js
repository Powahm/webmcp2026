/**
 * Folders the agent says it has, waiting to be let in.
 *
 * The page cannot see what the agent has access to. WebMCP runs one way: the
 * page offers tools, the agent calls them, and there is no channel back for
 * asking "what folders do you have". Nor can a page read a directory without a
 * click; both showDirectoryPicker and <input webkitdirectory> require a user
 * gesture, and a page that could read your disk on load is exactly what that
 * rule exists to stop.
 *
 * So the announcing is inverted. The agent already knows what it has, and tells
 * the page through offer_folder: a folder name and a manifest of what is in it,
 * no bytes. The page draws a ghost folder. The person hovers it, reads what is
 * being offered, and clicks. The picker that opens is the authorisation.
 *
 * Text can skip the picker, because a script or an outline fits down a tool
 * call and the agent can send it outright. Video cannot, so media waits for the
 * click. That split is real rather than tidy, and it is why the import says
 * which files came from where.
 */

const VIDEO = /\.(mp4|mov|webm|m4v|avi|mkv)$/i;
const TEXT = /\.(txt|md|markdown|srt|vtt|rtf)$/i;

export const kindOf = (name) => (VIDEO.test(name) ? "video" : TEXT.test(name) ? "text" : "other");

let folders = [];
let counter = 0;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const onFolders = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const offeredFolders = () => folders.filter((f) => f.status === "offered");
export const allFolders = () => folders.slice();
export const folderById = (id) => folders.find((f) => f.id === id) || null;

const trusted = (g) => g?.isTrusted === true || g?.nativeEvent?.isTrusted === true;

export function offerFolder({ name, files, reason }) {
  const clean = (files || [])
    .map((f) => ({
      name: String(f.name ?? "").trim(),
      kind: kindOf(String(f.name ?? "")),
      size: Number.isFinite(Number(f.size)) ? Number(f.size) : null,
      // Only ever kept for text. A video's bytes do not come down a tool call,
      // and pretending otherwise would mean silently truncating someone's take.
      text: TEXT.test(String(f.name ?? "")) && typeof f.text === "string" ? f.text : null,
    }))
    .filter((f) => f.name);

  if (clean.length === 0) {
    return { ok: false, error: "That folder has no files in it.", hint: "Send at least one file name." };
  }

  const existing = folders.find((f) => f.name === name && f.status === "offered");
  if (existing) {
    existing.files = clean;
    existing.reason = reason || existing.reason;
    emit();
    return { ok: true, folder: existing, replaced: true };
  }

  const folder = {
    id: `fld-${Date.now().toString(36)}-${(counter++).toString(36)}`,
    name: String(name ?? "Folder").trim().slice(0, 60) || "Folder",
    files: clean,
    reason: String(reason ?? "").trim().slice(0, 200) || null,
    status: "offered",
    created: Date.now(),
  };
  folders = [...folders, folder];
  emit();
  return { ok: true, folder };
}

/** The person let it in. Only a real click gets here. */
export function markImported(id, gesture, counts) {
  if (!trusted(gesture)) return false;
  folders = folders.map((f) => (f.id === id ? { ...f, status: "imported", counts } : f));
  emit();
  return true;
}

export function dismiss(id, gesture) {
  if (!trusted(gesture)) return false;
  folders = folders.filter((f) => f.id !== id);
  emit();
  return true;
}

export const summarise = (folder) => {
  const by = { video: 0, text: 0, other: 0 };
  folder.files.forEach((f) => (by[f.kind] += 1));
  const parts = [];
  if (by.video) parts.push(`${by.video} video${by.video === 1 ? "" : "s"}`);
  if (by.text) parts.push(`${by.text} script${by.text === 1 ? "" : "s"}`);
  if (by.other) parts.push(`${by.other} other`);
  return { by, text: parts.join(", ") || `${folder.files.length} files` };
};
