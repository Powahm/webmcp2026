/**
 * scripts/check-offsets.ts
 *
 * The evidence model rests on one invariant: every span — a corpus citation or
 * a mark the analyst made — is an index into the exact string the reader
 * renders. If that drifts, every highlight and every citation points at the
 * wrong words, and nothing on screen says so. `docs/PLAN.md` names it as one of
 * the four expensive failure modes, so it is checked on every build.
 *
 * Two halves:
 *
 *   1. The render path. `segment()` cuts a document at every mark boundary. It
 *      is fuzzed against overlapping, nested, adjacent and out-of-range marks,
 *      asserting that the cuts reassemble into the source byte for byte and
 *      that each mark's segments reassemble into exactly its own substring.
 *   2. The corpus, when one is built. Every citation on every edge must slice
 *      to a non-empty run of the document it names — which is what catches a
 *      builder change that shifts the text without shifting the offsets.
 *
 * The DOM half (selection.ts mapping a Range back to a source offset) needs a
 * browser and is exercised by hand; this covers everything that can be checked
 * without one.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { locate } from "../src/corpus/locate";
import { segment, dominant } from "../src/reader/markings";
import { MARKING_TYPES } from "../src/types";
import type { Edge, CorpusDocument, Marking } from "../src/types";

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);

// --- 1. The render path ----------------------------------------------------

/** Deterministic PRNG, so a failure is reproducible from the seed alone. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function mark(text: string, start: number, end: number, i: number, origin: "human" | "agent"): Marking {
  return {
    id: `mark_${i}`,
    doc_id: "doc:test",
    span: { start, end },
    text: text.slice(start, end),
    type: MARKING_TYPES[i % MARKING_TYPES.length],
    origin,
    created_at: i,
  };
}

function checkSegmentation(text: string, markings: Marking[], label: string): void {
  const segs = segment(text, markings);

  if (segs.map((s) => s.text).join("") !== text) {
    fail(`${label}: segments do not reassemble into the source text`);
    return;
  }

  let cursor = 0;
  for (const s of segs) {
    if (s.start !== cursor) fail(`${label}: gap or overlap at ${cursor} (segment starts ${s.start})`);
    if (s.end <= s.start) fail(`${label}: empty segment at ${s.start}`);
    if (s.text !== text.slice(s.start, s.end)) fail(`${label}: segment ${s.start}..${s.end} carries the wrong text`);
    cursor = s.end;
  }
  if (cursor !== text.length) fail(`${label}: segments cover ${cursor} of ${text.length} characters`);

  // The round trip the plan asks for: a mark goes into the store, comes back
  // through the renderer, and still selects exactly the words it was made on.
  for (const m of markings) {
    const covered = segs.filter((s) => s.marks.some((x) => x.id === m.id));
    const start = Math.max(0, m.span.start);
    const end = Math.min(text.length, m.span.end);
    if (start >= end || m.span.start >= text.length) {
      if (covered.length) fail(`${label}: out-of-range mark ${m.id} still rendered`);
      continue;
    }
    const rendered = covered.map((s) => s.text).join("");
    if (rendered !== text.slice(start, end)) {
      fail(`${label}: mark ${m.id} rendered as "${rendered}" but marks "${text.slice(start, end)}"`);
    }
  }

  // A human mark must win the colour wherever one covers the run, or the
  // agent would be repainting the analyst's own reading.
  for (const s of segs) {
    const d = dominant(s.marks);
    if (s.marks.some((m) => m.origin === "human") && d?.origin !== "human") {
      fail(`${label}: an agent mark took the colour from a human one at ${s.start}`);
    }
  }
}

// Named cases first: the shapes that actually occur.
const doc = "PETER VALAITIS, of 27 ALDER STREET, MANCHESTER, M4 1RB, appointed 12 March 2019.";
checkSegmentation(doc, [], "no marks");
checkSegmentation(doc, [mark(doc, 0, 14, 0, "human")], "one mark");
checkSegmentation(doc, [mark(doc, 0, doc.length, 0, "human")], "whole document");
checkSegmentation(doc, [mark(doc, 0, 5, 0, "human"), mark(doc, 5, 14, 1, "human")], "adjacent marks");
checkSegmentation(doc, [mark(doc, 19, 52, 0, "human"), mark(doc, 19, 33, 1, "agent")], "nested agent mark");
checkSegmentation(doc, [mark(doc, 0, 20, 0, "human"), mark(doc, 14, 40, 1, "agent")], "overlapping");
checkSegmentation(doc, [mark(doc, 60, doc.length, 0, "agent")], "mark to the last character");
checkSegmentation(doc, [{ ...mark(doc, 0, 4, 0, "human"), span: { start: 0, end: doc.length + 40 } }], "span past the end");
checkSegmentation(doc, [{ ...mark(doc, 0, 4, 0, "human"), span: { start: 900, end: 950 } }], "span entirely past the end");
checkSegmentation("", [], "empty document");

// Then fuzz, because the overlaps a real session produces are not the ones a
// person thinks to write down.
const rand = rng(20260830);
for (let round = 0; round < 400; round++) {
  const len = 1 + Math.floor(rand() * 200);
  let body = "";
  for (let i = 0; i < len; i++) body += "abcdefgh ,.\n"[Math.floor(rand() * 12)];

  const marks: Marking[] = [];
  const count = Math.floor(rand() * 6);
  for (let i = 0; i < count; i++) {
    const a = Math.floor(rand() * (len + 10));
    const b = a + 1 + Math.floor(rand() * 30);
    marks.push(mark(body, a, b, i, rand() < 0.5 ? "human" : "agent"));
  }
  checkSegmentation(body, marks, `fuzz round ${round}`);
}

// --- 2. Search spans -------------------------------------------------------

/**
 * A search hit is where most citations start life, so its span has to obey the
 * same invariant as a mark: `text` is exactly what `start`..`end` slices, with
 * no indentation swept in. A filing is laid out in columns, so a span widened
 * to the whole line otherwise underlines a stretch of empty margin.
 */
const filing = [
  "COMPANIES HOUSE — REGISTER OF DIRECTORS",
  "",
  "    Name              Priya NANDAKUMAR",
  "    Correspondence address",
  "                      27 ALDER STREET, MANCHESTER, M4 1RB",
  "\tAppointed         2018-01-22   ",
].join("\n");

for (const terms of [["alder"], ["nandakumar"], ["directors"], ["appointed", "2018"], ["27"]]) {
  for (const span of locate(filing, terms)) {
    if (span.text !== filing.slice(span.start, span.end)) {
      fail(`search span for ${terms.join("+")} carries "${span.text}" but slices "${filing.slice(span.start, span.end)}"`);
    }
    if (span.text !== span.text.trim()) {
      fail(`search span for ${terms.join("+")} includes surrounding whitespace: ${JSON.stringify(span.text)}`);
    }
    if (span.end <= span.start) fail(`search span for ${terms.join("+")} is empty`);
  }
}

// --- 3. The corpus, if one is built ----------------------------------------

const corpusDir = join(process.cwd(), "public", "corpus");
const readJson = <T>(name: string): T => JSON.parse(readFileSync(join(corpusDir, name), "utf8")) as T;

if (existsSync(join(corpusDir, "edges.json")) && existsSync(join(corpusDir, "documents.json"))) {
  const edges = readJson<Edge[]>("edges.json");
  const documents = new Map(readJson<CorpusDocument[]>("documents.json").map((d) => [d.id, d]));
  let checked = 0;

  for (const edge of edges) {
    const cites = edge.citations.flatMap((c) => [c, ...(c.corroborating ?? []).map((x) => ({ ...x }))]);
    for (const c of cites) {
      const document = documents.get(c.doc_id);
      if (!document) {
        fail(`edge ${edge.id} cites "${c.doc_id}", which is not in documents.json`);
        continue;
      }
      const { start, end } = c.span;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
        fail(`edge ${edge.id} cites an invalid span {${start}, ${end}} in ${c.doc_id}`);
        continue;
      }
      if (end > document.text.length) {
        fail(`edge ${edge.id} cites ${start}..${end} but ${c.doc_id} is ${document.text.length} characters`);
        continue;
      }
      if (!document.text.slice(start, end).trim()) {
        fail(`edge ${edge.id} cites ${start}..${end} of ${c.doc_id}, which is only whitespace`);
        continue;
      }
      checked++;
    }
  }
  console.log(`offsets: ${checked} corpus citations resolve to real text`);
} else {
  // Loud, because the failure it prevents is silent and remote: public/corpus/
  // is what the deployed site serves, so a build without it ships a page that
  // either shows the DEV FIXTURE badge or refuses to boot at all.
  console.warn(
    "\n  ! public/corpus/ is missing, so the citation check was skipped.\n" +
      "    Run `npm run corpus:build`, and commit public/corpus/*.json before deploying —\n" +
      "    the site has no records without it. See docs/DATA.md.\n"
  );
}

// --- Result ----------------------------------------------------------------

if (problems.length) {
  console.error(`\nOffset check failed — ${problems.length} problem(s):\n`);
  for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
  if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
  console.error("\nEvery span is an index into the exact string the reader renders. See docs/ARCHITECTURE.md.\n");
  process.exit(1);
}

console.log("offsets: marks survive the render path unchanged");
