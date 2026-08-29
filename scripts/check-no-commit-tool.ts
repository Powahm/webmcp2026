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
 * It checks three things:
 *   1. No file under src/webmcp/ references acceptProposal or rejectProposal.
 *   2. No registered tool's name suggests promotion.
 *   3. Every read-only tool declares readOnlyHint, and no write tool does.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["acceptProposal", "rejectProposal", "_setNodes", "_setEdges"];
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
const readSrc = readFileSync(join("src", "webmcp", "tools", "readTools.ts"), "utf8");
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

if (failures) {
  console.error(`\n  ${failures} safety check(s) failed.\n`);
  process.exit(1);
}

console.log(
  `  ✓ no commit tool: ${readNames.length} read-only, ${writeNames.length} staged-write, 0 promotion tools`
);
