/**
 * The Whisper upgrade.
 *
 * Optional, and optional in a way that matters: the prompter path in
 * ./transcript.js is the default and produces a usable transcript for every
 * clip recorded on this desktop, with no key and no network. This file exists
 * for the clips it cannot help with — an import, a screen recording, anything
 * shot before the script was written — and to turn a good estimate into a
 * measurement when someone wants one.
 *
 * Three things are worth knowing about how this is wired.
 *
 * **The key is the user's.** It is read from localStorage, typed in by whoever
 * is at the keyboard. A static site cannot keep a secret, so the alternative
 * was either no feature or a key in the bundle, and a key in a public bundle
 * is not a trade-off, it is a mistake.
 *
 * **No FFmpeg.** The screenshot's stack extracts audio before uploading, which
 * is the right move for a Node pipeline handling gigabyte files. In a browser
 * holding a Blob it is a step that buys nothing: the transcription endpoint
 * accepts webm and mp4 directly and reads the audio track out itself. Pulling
 * in a WebAssembly build of FFmpeg to hand over the same audio would cost
 * about thirty megabytes and change no result.
 *
 * **It is a real word-level transcript.** `verbose_json` plus a word
 * granularity is what makes a caption land on the frame a word is spoken
 * rather than near it.
 */

import { normalise } from "./transcript.js";
import { apiKey, hasApiKey, persist } from "./store.js";

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";

/** Whisper's limit. A take longer than this is not the common case, and
 *  chunking it is a lot of machinery for a path that is already the fallback. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Transcribe a clip and write the result over whatever it had.
 *
 * Returns `{ ok, transcript }` or `{ ok: false, error, hint }` in the same
 * shape as everything else that can be refused, so a caller does not need to
 * know whether the failure came from a validator or from a network.
 */
export async function transcribe(clip, { signal } = {}) {
  if (!hasApiKey()) {
    return {
      ok: false,
      error: "No OpenAI API key is set in this browser.",
      hint: "Open the Editor's Transcript tab and paste a key into the panel there. It is kept in this browser's localStorage and sent only to api.openai.com.",
    };
  }
  if (!clip?.blob) {
    return { ok: false, error: "That clip has no media to transcribe." };
  }
  if (clip.blob.size > MAX_BYTES) {
    return {
      ok: false,
      error: `That clip is ${(clip.blob.size / 1024 / 1024).toFixed(0)}MB and the limit is 25MB.`,
      hint: "Trim it on the timeline and export the section you want first, or use the prompter transcript, which has no size limit.",
    };
  }

  const form = new FormData();
  // The endpoint reads the audio track out of a video container itself, so the
  // recording goes up exactly as it was saved.
  const ext = clip.blob.type.includes("mp4") ? "mp4" : "webm";
  form.append("file", clip.blob, `${clip.id}.${ext}`);
  form.append("model", "whisper-1");
  // Both are required for word timings: granularity is only honoured on the
  // verbose response.
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") return { ok: false, error: "Transcription cancelled." };
    return {
      ok: false,
      error: "Could not reach api.openai.com.",
      hint: "Check the connection. The prompter transcript works offline and needs no key.",
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ok: false, ...describe(response.status, detail) };
  }

  const body = await response.json().catch(() => null);
  const words = Array.isArray(body?.words) ? body.words : [];
  if (!words.length) {
    return {
      ok: false,
      error: "The transcript came back with no words in it.",
      hint: "The clip may have no audio track, or be silent. Check the clip plays with sound in the Editor.",
    };
  }

  const transcript = {
    source: "whisper",
    approximate: false,
    script_id: clip.scriptId ?? null,
    script_name: clip.scriptName ?? null,
    words: words.map((w) => ({
      w: String(w.word ?? "").trim(),
      n: normalise(w.word),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
      line: null,
    })),
    // Whisper does not know about script lines, so its beats come from its own
    // segments. They are sentences rather than the beats someone performed,
    // which is worth being honest about rather than papering over.
    beats: (body.segments ?? []).map((s, i) => ({
      index: i,
      line_index: null,
      text: String(s.text ?? "").trim(),
      note: null,
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
    })),
    language: body.language ?? null,
    updated: Date.now(),
  };

  await persist(clip, transcript);
  return { ok: true, transcript };
}

/** Turn a status code into something the person reading it can act on. */
function describe(status, detail) {
  const message = (() => {
    try { return JSON.parse(detail)?.error?.message; } catch { return null; }
  })();

  if (status === 401) {
    return {
      error: "That API key was rejected.",
      hint: "Check it starts with 'sk-' and is still active in your OpenAI account.",
    };
  }
  if (status === 429) {
    return {
      error: "Rate limited, or the account is out of quota.",
      hint: "Wait a moment and try again, or check billing on the OpenAI account. The prompter transcript needs neither.",
    };
  }
  if (status === 413) {
    return { error: "The clip was too large for the endpoint.", hint: "Trim it and try a shorter section." };
  }
  return {
    error: message || `Transcription failed with status ${status}.`,
    hint: "The prompter transcript is still available and needs no key.",
  };
}
