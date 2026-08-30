/**
 * scripts/check-no-commit-tool.ts
 *
 * The product's central safety claim is that the agent cannot promote its own
 * proposal: there is no registered tool that does it, and nothing in the tool
 * layer can reach the two functions that do.
 *
 * A claim that is only true because nobody has broken it yet is not a guarantee.
 * This makes it one — it runs as part of `npm run build`, and the build fails if
 * it stops being true.
 *
 * It checks four things:
 *   1. No file under src/webmcp/ references any store setter or any of the
 *      four operations reserved to the analyst.
 *   2. No registered tool's name suggests promotion.
 *   3. Every read-only tool declares readOnlyHint, and no write tool does.
 *   4. Each reserved operation still refuses to run without a trusted gesture.
 *
 * Four operations belong to the analyst alone and have no tool:
 * promoting a proposal, raising a line of enquiry, filing one, and deleting a
 * marking. See docs/TOOLS.md, "Why there is no commit tool".
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Reserved to the analyst, plus the raw store setters no tool may touch. */
const HUMAN_ONLY = [
  "acceptProposal",
  "rejectProposal",
  "raiseEnquiry",
  "fileEnquiry",
  "removeMarking",
];
const FORBIDDEN = [
  ...HUMAN_ONLY,
  "_setNodes",
  "_setEdges",
  "_setProposals",
  "_setMarkings",
  "_setEnquiries",
];
const PROMOTION_WORDS = /(commit|promote|accept|confirm|approve|apply)/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

let failures = 0;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};

// 1. The tool layer cannot reach the confirmed graph.
for (const file of walk(join("src", "webmcp"))) {
  const text = readFileSync(file, "utf8");
  for (const symbol of FORBIDDEN) {
    // Ignore prose in comments — the architecture is explained in them.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    if (code.includes(symbol)) {
      fail(`${file} references ${symbol}. The tool layer must not reach the confirmed graph.`);
    }
  }
}

// 2 & 3. Tool names and annotations, read straight from the source of truth.
const readSrc =
  readFileSync(join("src", "webmcp", "tools", "readTools.ts"), "utf8") +
  readFileSync(join("src", "webmcp", "tools", "readerTools.ts"), "utf8");
const writeSrc = readFileSync(join("src", "webmcp", "tools", "writeTools.ts"), "utf8");

const nameRe = /name:\s*"([a-z_]+)"/g;
const names = (src: string) => [...src.matchAll(nameRe)].map((m) => m[1]);

const readNames = names(readSrc);
const writeNames = names(writeSrc);

for (const n of [...readNames, ...writeNames]) {
  if (PROMOTION_WORDS.test(n)) {
    fail(`A tool is named "${n}". Only the analyst may promote a proposal — there must be no such tool.`);
  }
}

// Each read tool block must carry the annotation; write tools must not.
for (const n of readNames) {
  const block = readSrc.slice(readSrc.indexOf(`name: "${n}"`));
  const end = block.indexOf("execute:");
  if (!/readOnlyHint/.test(block.slice(0, end)) && !/READ_ONLY/.test(block.slice(0, end))) {
    fail(`Read tool "${n}" does not declare readOnlyHint.`);
  }
}
for (const n of writeNames) {
  const block = writeSrc.slice(writeSrc.indexOf(`name: "${n}"`));
  const end = block.indexOf("execute:");
  if (/readOnlyHint/.test(block.slice(0, end))) {
    fail(`Write tool "${n}" declares readOnlyHint. It stages a proposal, so it is not read-only.`);
  }
}

// 4. Each reserved operation still fails closed without a trusted DOM event.
const actionsSrc = readFileSync(join("src", "state", "actions.ts"), "utf8");
for (const fn of HUMAN_ONLY) {
  const at = actionsSrc.indexOf(`export function ${fn}(`);
  if (at < 0) {
    fail(`actions.ts no longer exports ${fn}. The safety check cannot verify it.`);
    continue;
  }
  const body = actionsSrc.slice(at, at + 700);
  if (!body.includes("requireHumanGesture")) {
    fail(
      `${fn} does not require a trusted user gesture. It is reserved to the analyst — see docs/TOOLS.md.`
    );
  }
}

if (failures) {
  console.error(`\n  ${failures} safety check(s) failed.\n`);
  process.exit(1);
}

console.log(
  `  ✓ no commit tool: ${readNames.length} read-only, ${writeNames.length} write, ` +
    `0 promotion tools, ${HUMAN_ONLY.length} operations reserved to the analyst`
);
