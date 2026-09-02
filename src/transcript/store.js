/**
 * Transcripts, cached in memory and persisted onto the clip.
 *
 * A transcript is stored as `clip.transcript`, not in a store of its own. That
 * is not laziness: the IndexedDB schema in legacy/store.js is at version 1
 * with two object stores, and adding a third means an upgrade path for
 * everyone who already has clips in this browser. A transcript is also
 * meaningless without its clip and should die with it, which is exactly what
 * living on the record gives us for free.
 *
 * This module deliberately does not import the Editor. The cut-level
 * transcript needs the timeline, but taking it as an argument instead of
 * reaching for it keeps the dependency pointing one way and keeps this file
 * testable without a window.
 */

import { Clips, Store } from "../legacy/store.js";
import { fromPrompter } from "./transcript.js";

/** clip id -> transcript. Derivation is cheap but not free, and the preview
 *  loop asks for these often. */
const cache = new Map();
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn());

export const onTranscripts = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/* --------------------------------------------------------------- retrieval */

/**
 * The transcript for one clip, derived from the prompter if it has never been
 * asked for.
 *
 * Persists what it derives, so the work happens once per clip per browser
 * rather than once per page load, and so a clip carries its own transcript
 * around with it.
 */
export async function transcriptFor(clipId) {
  if (cache.has(clipId)) return cache.get(clipId);

  const clip = (await Clips.all()).find((c) => c.id === clipId);
  if (!clip) return null;

  if (clip.transcript?.words?.length) {
    cache.set(clipId, clip.transcript);
    return clip.transcript;
  }

  // Only a clip recorded against a script can be derived. An import has no
  // prompter history, and that is what Whisper is for.
  if (!clip.scriptId || !clip.beats?.length) {
    cache.set(clipId, null);
    return null;
  }

  const script = (await Store.all("scripts")).find((s) => s.id === clip.scriptId);
  if (!script) {
    cache.set(clipId, null);
    return null;
  }

  const transcript = fromPrompter(clip, script);
  cache.set(clipId, transcript);
  if (transcript) await persist(clip, transcript);
  return transcript;
}

/** Transcripts for several clips at once, as the Map `toCutTime` wants. */
export async function transcriptsFor(clipIds) {
  const map = new Map();
  for (const id of new Set(clipIds ?? [])) {
    const transcript = await transcriptFor(id);
    if (transcript) map.set(id, transcript);
  }
  return map;
}

/** Write a transcript onto its clip. Used by the Whisper path to replace an
 *  estimate with a measurement. */
export async function persist(clip, transcript) {
  const record = typeof clip === "string"
    ? (await Clips.all()).find((c) => c.id === clip)
    : clip;
  if (!record) return null;
  record.transcript = transcript;
  await Store.put("clips", record);
  cache.set(record.id, transcript);
  emit();
  return transcript;
}

/** Forget a derived transcript so the next ask rebuilds it. The timings come
 *  from the take, not the script, so editing the script afterwards does not
 *  invalidate them — but re-transcribing with Whisper does. */
export function forget(clipId) {
  cache.delete(clipId);
  emit();
}

/* -------------------------------------------------------------- the api key */

/**
 * The Whisper key lives in localStorage and nowhere else.
 *
 * Not in the bundle, not in an env var, not in the repo. A public static site
 * cannot hold a secret, so the only honest version of this feature is one
 * where the key belongs to whoever is sitting at the machine. The prompter
 * path is the default precisely so that this is an upgrade and never a
 * requirement.
 */
const KEY = "desk-two:openai-key";

export const apiKey = () => {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
};

export const hasApiKey = () => apiKey().length > 20;

export function setApiKey(value) {
  try {
    const key = String(value ?? "").trim();
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
    emit();
    return true;
  } catch {
    return false;
  }
}
