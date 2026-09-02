/**
 * Word-level timing, from the teleprompter.
 *
 * The Camera has been quietly recording the useful thing all along. Every take
 * driven by the prompter writes `clip.beats`, an array of `{ line, at }` — the
 * script line that was on screen and the second of the take it appeared. It is
 * saved onto the clip in IndexedDB and, until now, read by nothing.
 *
 * That array plus the script it came from is a transcript. We know what was
 * said, because they read it off the prompter, and we know when each line
 * started, because we watched them advance it. Spreading a line's words across
 * its own span gives per-word timing without a network call, without a key,
 * and without an audio decode.
 *
 * **It is an estimate and it says so.** `source: "prompter"` and
 * `approximate: true` travel with every transcript derived this way, so
 * nothing downstream can mistake a good guess for a measurement. Whisper is
 * the upgrade, in ./whisper.js, and it sets `source: "whisper"` and
 * `approximate: false`. Both produce the same shape, so everything that reads
 * a transcript works with either.
 *
 * The argument this is really making: no server has any of this. The words
 * were on screen in this tab, the timings came from clicks in this tab, and
 * the audio never left the machine. A server-side transcription service can
 * tell you what is in a file you uploaded. It cannot tell you what the person
 * was reading when they said it.
 */

/** Words are spread across a line by length, not evenly. "a" and
 *  "extraordinarily" do not take the same time to say, and weighting by
 *  characters plus one for the gap is a better model than dividing by count
 *  for the cost of one extra reduce. */
const weightOf = (word) => word.length + 1;

/** Matching is done on this, display uses the original. So "Remotion," and
 *  "remotion" are the same word to a search and different words on screen. */
export const normalise = (word) =>
  String(word ?? "").toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Filler words worth offering to cut.
 *
 * Deliberately short and deliberately not "like", "so" or "right". Those are
 * real words doing real work most of the time, and an editor who is offered
 * forty cuts of which thirty are wrong stops reading the list. Everything
 * here is a hesitation with no meaning, which is what makes the offer safe to
 * accept without listening first.
 */
export const FILLERS = new Set(["um", "uh", "erm", "ah", "eh", "hmm", "mm", "uhh", "umm", "er"]);

/** A gap this long between words is dead air worth offering to close. Under a
 *  second is a breath or a beat for effect, and cutting those is what makes an
 *  edit sound rushed. */
export const DEAD_AIR_SECONDS = 1.1;

/* ---------------------------------------------------------------- deriving */

/**
 * Build a transcript for one clip from its prompter marks.
 *
 * Returns `null` when the clip was not recorded against a script, which is the
 * honest answer: an imported file has no prompter history and guessing at one
 * would be inventing a transcript rather than deriving one. Whisper is the
 * path for those.
 */
export function fromPrompter(clip, script) {
  const marks = Array.isArray(clip?.beats) ? clip.beats.slice() : [];
  const lines = script?.lines ?? [];
  if (!marks.length || !lines.length) return null;

  marks.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const clipEnd = Number(clip.duration) > 0 ? Number(clip.duration) : marks[marks.length - 1].at + 4;

  const words = [];
  const beats = [];

  marks.forEach((mark, i) => {
    const start = Math.max(0, Number(mark.at) || 0);
    // A line runs until the next one was advanced to, or the end of the take.
    const end = i + 1 < marks.length ? Math.max(start, Number(marks[i + 1].at) || start) : clipEnd;
    const line = lines[mark.line];
    if (!line) return;

    beats.push({
      index: beats.length,
      line_index: mark.line,
      text: line.text ?? "",
      note: line.note || null,
      start,
      end,
    });

    const parts = String(line.text ?? "").split(/\s+/).filter(Boolean);
    if (!parts.length || end <= start) return;

    const total = parts.reduce((sum, w) => sum + weightOf(w), 0);
    let cursor = start;
    for (const part of parts) {
      const span = ((end - start) * weightOf(part)) / total;
      words.push({
        w: part,
        n: normalise(part),
        start: cursor,
        end: cursor + span,
        line: mark.line,
      });
      cursor += span;
    }
  });

  if (!words.length) return null;

  return {
    source: "prompter",
    approximate: true,
    script_id: clip.scriptId ?? script.id ?? null,
    script_name: clip.scriptName ?? script.name ?? null,
    words,
    beats,
    updated: Date.now(),
  };
}

/* ------------------------------------------------------- clip time to cut */

/**
 * Map every clip's transcript onto the finished cut.
 *
 * A word's time is a position in its own clip. What anything downstream
 * actually wants is a position in the edit, and the two differ by the trim,
 * the speed and everything before it on the timeline. So this walks the
 * segments in order and re-times the words that survive each one.
 *
 * That has a consequence worth stating plainly: a word trimmed out of the cut
 * is not in the result. The transcript describes the video as it currently
 * stands, not as it was shot, which is why placing a graphic on a quote from
 * it lands in the right place even after the cut has moved.
 *
 * `segments` is `[{ uid, clipId, in, out, speed }]`, straight off
 * Editor.timeline. `transcripts` is a Map from clip id to transcript.
 */
export function toCutTime(segments, transcripts) {
  const words = [];
  const beats = [];
  let at = 0;

  for (const seg of segments ?? []) {
    const speed = Number(seg.speed) || 1;
    const inS = Number(seg.in) || 0;
    const outS = Number(seg.out) || 0;
    const length = Math.max(0.05, (outS - inS) / speed);
    const transcript = transcripts?.get?.(seg.clipId) ?? null;

    if (transcript) {
      // Clip time to cut time. A 2x segment says its words twice as fast, so
      // the offset divides by speed exactly as the segment's own length does.
      const project = (t) => at + (t - inS) / speed;

      for (const word of transcript.words) {
        // Kept if any part of the word survives the trim. A word half cut off
        // is still a word you can hear the start of.
        if (word.end <= inS || word.start >= outS) continue;
        words.push({
          ...word,
          start: project(Math.max(word.start, inS)),
          end: project(Math.min(word.end, outS)),
          clip_id: seg.clipId,
          segment_uid: seg.uid,
          clipped: word.start < inS || word.end > outS,
        });
      }

      for (const beat of transcript.beats ?? []) {
        if (beat.end <= inS || beat.start >= outS) continue;
        beats.push({
          ...beat,
          index: beats.length,
          start: project(Math.max(beat.start, inS)),
          end: project(Math.min(beat.end, outS)),
          clip_id: seg.clipId,
          segment_uid: seg.uid,
        });
      }
    }

    at += length;
  }

  const sources = new Set(
    [...(transcripts?.values?.() ?? [])].map((t) => t.source)
  );

  return {
    // If any clip needed Whisper and got it, say so, but a cut mixing the two
    // is only as exact as its worst clip.
    source: sources.size === 1 ? [...sources][0] : sources.size ? "mixed" : null,
    approximate: [...(transcripts?.values?.() ?? [])].some((t) => t.approximate),
    words,
    beats,
    cut_seconds: at,
  };
}

/* ---------------------------------------------------------------- searching */

/**
 * Find a run of words by quoting them.
 *
 * This is what makes "cut the bit where I say the stack is three things" a
 * real instruction instead of a guess. The agent quotes the words; this hands
 * back the exact seconds they occupy. Matching is on the normalised forms, so
 * punctuation and case never cost a match.
 *
 * Returns every occurrence, because "cut where I say 'anyway'" when it was
 * said four times is a question, not an instruction, and the caller should be
 * able to say so.
 */
export function findWords(transcript, quote) {
  const needle = String(quote ?? "").split(/\s+/).map(normalise).filter(Boolean);
  const hay = transcript?.words ?? [];
  if (!needle.length || !hay.length) return [];

  const hits = [];
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j].n !== needle[j]) { ok = false; break; }
    }
    if (!ok) continue;
    const first = hay[i];
    const last = hay[i + needle.length - 1];
    hits.push({
      index: i,
      count: needle.length,
      start: first.start,
      end: last.end,
      text: hay.slice(i, i + needle.length).map((w) => w.w).join(" "),
      segment_uid: first.segment_uid ?? null,
      clip_id: first.clip_id ?? null,
    });
  }
  return hits;
}

/** The words under a moment, for "what am I saying here". */
export function wordsBetween(transcript, from, to) {
  return (transcript?.words ?? []).filter((w) => w.end > from && w.start < to);
}

export const textBetween = (transcript, from, to) =>
  wordsBetween(transcript, from, to).map((w) => w.w).join(" ");

/* ---------------------------------------------------------------- analysis */

/**
 * Everything worth offering to cut.
 *
 * Two kinds, both mechanical and both checkable by ear in a second: a
 * hesitation with no meaning, and a hole in the audio. Nothing here decides
 * that a sentence is bad or that a point was laboured, because that is a
 * judgement and this is a list.
 *
 * Each entry is a range in cut time with a reason, which is exactly the shape
 * a staged cut wants.
 */
export function findDeadWeight(transcript, { deadAir = DEAD_AIR_SECONDS } = {}) {
  const words = transcript?.words ?? [];
  const found = [];

  words.forEach((word, i) => {
    if (FILLERS.has(word.n)) {
      found.push({
        kind: "filler",
        start: word.start,
        end: word.end,
        text: word.w,
        seconds: word.end - word.start,
        reason: `"${word.w}" is a hesitation, not a word.`,
        segment_uid: word.segment_uid ?? null,
      });
    }

    const next = words[i + 1];
    if (next) {
      const gap = next.start - word.end;
      if (gap >= deadAir) {
        found.push({
          kind: "dead_air",
          start: word.end,
          end: next.start,
          text: "",
          seconds: gap,
          reason: `${gap.toFixed(1)}s of silence after "${word.w}".`,
          segment_uid: word.segment_uid ?? null,
        });
      }
    }
  });

  // Merge a filler that sits inside a gap into one offer. "um" followed by two
  // seconds of nothing is one thing to cut, and offering it twice makes the
  // list look longer than the problem is.
  found.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const item of found) {
    const last = merged[merged.length - 1];
    if (last && item.start - last.end < 0.25) {
      last.end = Math.max(last.end, item.end);
      last.seconds = last.end - last.start;
      last.kind = "filler_and_pause";
      last.reason = `${last.reason} ${item.reason}`;
      continue;
    }
    merged.push({ ...item });
  }

  return merged;
}

/**
 * Where an ad or a chapter could go without interrupting anything.
 *
 * A break is only natural at the end of a beat, so the candidates are the
 * script's own line boundaries, ranked by the pause that follows them. Kept
 * because the transcript makes it nearly free, even though the editor does not
 * yet do anything with a marked break.
 */
export function findBreaks(transcript, { minGap = 0.45 } = {}) {
  const beats = transcript?.beats ?? [];
  const words = transcript?.words ?? [];
  return beats
    .slice(0, -1)
    .map((beat) => {
      const after = words.find((w) => w.start >= beat.end);
      const gap = after ? after.start - beat.end : 0;
      return { at: beat.end, after_beat: beat.index, gap, text: beat.text };
    })
    .filter((b) => b.gap >= minGap)
    .sort((a, b) => b.gap - a.gap);
}
