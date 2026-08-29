/**
 * scripts/find-chains.ts — hunt for the chain the demo is built on.
 *
 * Searches the built corpus for a path that satisfies all four conditions in
 * docs/DATA.md:
 *
 *   1. Exactly 3-4 hops. Two is obvious; five is unfollowable in three minutes.
 *   2. Not visible from the seed set — at least two intermediate nodes must be
 *      absent from seed.json, or the agent has found nothing the analyst
 *      couldn't already see.
 *   3. Every hop independently citable, with a specific filing and span.
 *   4. A shape a human can narrate in one sentence.
 *
 *   npm run corpus:chains              print the top candidates
 *   npm run corpus:chains -- --lock 3  lock candidate 3: rewrite seed.json so
 *                                      the intermediates are absent at boot,
 *                                      and write docs/VERIFIED-CHAIN.md
 *
 * DO NOT SKIP THE MANUAL VERIFICATION. Locking a chain does not make it true.
 * Open every hop on the Companies House website and confirm it before the
 * chain goes in the video — the entire impact argument rests on it holding up
 * if a judge looks it up during judging.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORPUS } from "./lib/paths";

interface Span { start: number; end: number }
interface Citation { doc_id: string; span: Span; corroborating?: { doc_id: string; span: Span }[] }
interface Entity { id: string; type: string; label: string; attrs?: Record<string, unknown> }
interface Edge {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  derived?: boolean;
  citations: Citation[];
}
interface CorpusDocument { id: string; title: string; text: string }

const MAX_HOPS = 4;
const MIN_HOPS = 3;
const TOP_N = 10;

const read = <T,>(f: string): T => JSON.parse(readFileSync(join(CORPUS, f), "utf8")) as T;

const entities = read<Entity[]>("entities.json");
const edges = read<Edge[]>("edges.json");
const documents = read<CorpusDocument[]>("documents.json");
const seed = read<{ node_ids: string[] }>("seed.json");

const byId = new Map(entities.map((e) => [e.id, e]));
const docById = new Map(documents.map((d) => [d.id, d]));
const seedSet = new Set(seed.node_ids);

/** Documents are evidence, not waypoints. A path that hops through a filing is
 *  an artefact of how we stored things, not a fact about the world. */
const traversable = (id: string) => byId.get(id)?.type !== "document";

const adjacency = new Map<string, { to: string; edge: Edge }[]>();
for (const e of edges) {
  if (e.relation === "filed") continue;
  if (!traversable(e.from_id) || !traversable(e.to_id)) continue;
  for (const [a, b] of [
    [e.from_id, e.to_id],
    [e.to_id, e.from_id],
  ]) {
    const list = adjacency.get(a);
    if (list) list.push({ to: b, edge: e });
    else adjacency.set(a, [{ to: b, edge: e }]);
  }
}

interface Chain {
  nodes: string[];
  edges: Edge[];
  score: number;
  hiddenIntermediates: string[];
}

const directlyLinked = new Set(edges.map((e) => `${e.from_id}|${e.to_id}`));
const areDirectlyLinked = (a: string, b: string) =>
  directlyLinked.has(`${a}|${b}`) || directlyLinked.has(`${b}|${a}`);

function score(nodes: string[], chainEdges: Edge[]): { score: number; hidden: string[] } {
  const intermediates = nodes.slice(1, -1);
  const hidden = intermediates.filter((n) => !seedSet.has(n));
  if (hidden.length < 2) return { score: -1, hidden };

  let s = 0;
  // Both endpoints on the canvas: the analyst can literally drag them together.
  if (seedSet.has(nodes[0]) && seedSet.has(nodes[nodes.length - 1])) s += 6;
  else if (seedSet.has(nodes[0]) || seedSet.has(nodes[nodes.length - 1])) s += 2;

  s += hidden.length * 2;

  // A chain of four identical hops is one fact repeated. Variety is what makes
  // it narratable: "director of one, PSC of a third, registered at the same
  // address as the second."
  s += new Set(chainEdges.map((e) => e.relation)).size * 2;

  // A person in the middle is the shape that reads best out loud.
  s += intermediates.filter((n) => byId.get(n)?.type === "person").length * 2;

  // All-derived chains are weaker evidence: every hop is our inference from two
  // filings rather than a single stated fact.
  if (chainEdges.every((e) => e.derived)) s -= 4;

  // Prefer a person whose identity was matched on date of birth, not name alone.
  for (const n of intermediates) {
    const e = byId.get(n);
    if (e?.type === "person" && e.attrs?.identity === "dob-matched") s += 1;
  }

  return { score: s, hidden };
}

function findChains(): Chain[] {
  const companies = entities.filter((e) => e.type === "company").map((e) => e.id);
  const found: Chain[] = [];
  const seen = new Set<string>();

  // Start from seed companies: an endpoint the analyst can already see is worth
  // far more than one they would have to find first.
  const starts = companies.filter((c) => seedSet.has(c));
  const from = starts.length >= 2 ? starts : companies.slice(0, 60);

  for (const start of from) {
    const stack: { node: string; path: string[]; edgePath: Edge[] }[] = [
      { node: start, path: [start], edgePath: [] },
    ];

    while (stack.length) {
      const { node, path, edgePath } = stack.pop()!;
      if (edgePath.length >= MIN_HOPS && byId.get(node)?.type === "company" && node !== start) {
        if (!areDirectlyLinked(start, node)) {
          const key = [start, node].sort().join("~") + "|" + path.length;
          const { score: s, hidden } = score(path, edgePath);
          if (s > 0 && !seen.has(key)) {
            seen.add(key);
            found.push({ nodes: [...path], edges: [...edgePath], score: s, hiddenIntermediates: hidden });
          }
        }
      }
      if (edgePath.length >= MAX_HOPS) continue;
      for (const { to, edge } of adjacency.get(node) ?? []) {
        if (path.includes(to)) continue;
        stack.push({ node: to, path: [...path, to], edgePath: [...edgePath, edge] });
      }
    }
  }

  return found.sort((a, b) => b.score - a.score).slice(0, TOP_N);
}

const label = (id: string) => byId.get(id)?.label ?? id;

function narrate(c: Chain): string {
  const parts = c.edges.map((e, i) => {
    const a = label(c.nodes[i]);
    const b = label(c.nodes[i + 1]);
    const verb: Record<string, string> = {
      director_of: "is a director of",
      psc_of: "is a person with significant control of",
      registered_at: "is registered at",
      previously_named: "was previously named",
      shares_address_with: "shares a registered address with",
    };
    const forward = e.from_id === c.nodes[i];
    return forward
      ? `${a} ${verb[e.relation] ?? e.relation} ${b}`
      : `${b} ${verb[e.relation] ?? e.relation} ${a}`;
  });
  return parts.join("; then ");
}

function citationLine(e: Edge): string {
  const c = e.citations[0];
  const doc = docById.get(c.doc_id);
  const quoted = doc ? doc.text.slice(c.span.start, c.span.end).trim() : "(document missing)";
  const extra = c.corroborating?.length ? ` + ${c.corroborating.length} corroborating` : "";
  return `      ${c.doc_id} [${c.span.start}..${c.span.end}]${extra}  "${quoted}"`;
}

function print(chains: Chain[]) {
  if (!chains.length) {
    console.log(
      "\n  No chain found that satisfies all four conditions.\n" +
        "  Most likely causes, in order:\n" +
        "    - the seed is too large, so nothing is hidden from it\n" +
        "    - no person links two address clusters (check the last line of\n" +
        "      `npm run corpus:build`)\n" +
        "    - the selection band in fetch-companies.ts is too narrow\n"
    );
    return;
  }
  chains.forEach((c, i) => {
    console.log(`\n[${i}]  score ${c.score}   ${c.edges.length} hops   ${c.hiddenIntermediates.length} hidden`);
    console.log(`  ${narrate(c)}`);
    console.log(`  path:`);
    c.nodes.forEach((n, j) => {
      const e = byId.get(n);
      const mark = seedSet.has(n) ? "on canvas" : "HIDDEN";
      console.log(`    ${j}. [${e?.type}] ${label(n)}  (${mark})  ${n}`);
      if (j < c.edges.length) {
        console.log(`      --${c.edges[j].relation}${c.edges[j].derived ? " (derived)" : ""}-->`);
        console.log(citationLine(c.edges[j]));
      }
    });
  });
  console.log(`\n  Verify one by hand on https://find-and-update.company-information.service.gov.uk/`);
  console.log(`  then lock it:  npm run corpus:chains -- --lock <index>\n`);
}

function lock(c: Chain) {
  // The endpoints must be on the canvas at boot; the intermediates must not be.
  const keep = seed.node_ids.filter((id) => !c.hiddenIntermediates.includes(id));
  const endpoints = [c.nodes[0], c.nodes[c.nodes.length - 1]];
  for (const e of endpoints) if (!keep.includes(e)) keep.push(e);

  const next = { node_ids: keep.slice(0, 14) };
  writeFileSync(join(CORPUS, "seed.json"), JSON.stringify(next, null, 2));

  const md = [
    "# The verified chain",
    "",
    "> Locked by `npm run corpus:chains -- --lock`.",
    "> **Every hop below must be confirmed by hand on the Companies House website",
    "> before this goes in the video.** Tick each one off here as you check it.",
    "",
    `**In one sentence:** ${narrate(c)}.`,
    "",
    "| # | Hop | Relation | Evidence | Verified |",
    "|---|---|---|---|---|",
    ...c.edges.map((e, i) => {
      const cit = e.citations[0];
      const doc = docById.get(cit.doc_id);
      const quoted = doc ? doc.text.slice(cit.span.start, cit.span.end).trim().replace(/\|/g, "\\|") : "";
      return `| ${i + 1} | ${label(c.nodes[i])} → ${label(c.nodes[i + 1])} | \`${e.relation}\`${e.derived ? " (derived)" : ""} | \`${cit.doc_id}\` [${cit.span.start}..${cit.span.end}] "${quoted}" | ☐ |`;
    }),
    "",
    "## Canvas state at boot",
    "",
    ...c.nodes.map(
      (n, i) => `- ${i}. **${label(n)}** — ${seedSet.has(n) && !c.hiddenIntermediates.includes(n) ? "on canvas" : "hidden, the agent must find it"} (\`${n}\`)`
    ),
    "",
    "Endpoints are seeded so the analyst can drag them together and ask.",
    "Intermediates are deliberately absent from `public/corpus/seed.json`.",
    "",
  ].join("\n");

  writeFileSync(join("docs", "VERIFIED-CHAIN.md"), md);
  console.log(`\n  locked.\n  rewrote ${join(CORPUS, "seed.json")} (${next.node_ids.length} nodes)`);
  console.log(`  wrote docs/VERIFIED-CHAIN.md — now verify every hop by hand.\n`);
}

const chains = findChains();
const lockArg = process.argv.indexOf("--lock");
if (lockArg > -1) {
  const idx = Number(process.argv[lockArg + 1]);
  if (!Number.isInteger(idx) || !chains[idx]) {
    console.error(`\n  --lock needs an index between 0 and ${chains.length - 1}.\n`);
    process.exit(1);
  }
  print([chains[idx]]);
  lock(chains[idx]);
} else {
  print(chains);
}
