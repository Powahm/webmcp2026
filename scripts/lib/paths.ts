import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** raw/ is gitignored: it holds multi-gigabyte bulk downloads and API caches. */
export const RAW = "raw";
export const RAW_BULK = join(RAW, "bulk");
export const RAW_OFFICERS = join(RAW, "officers");
export const RAW_FILINGS = join(RAW, "filings");
export const RAW_PSC = join(RAW, "psc");
export const SELECTED = join(RAW, "selected.json");

/** public/corpus/ IS committed — it is the demo, and it is small. */
export const CORPUS = join("public", "corpus");

export function ensureDirs(): void {
  for (const d of [RAW, RAW_BULK, RAW_OFFICERS, RAW_FILINGS, RAW_PSC, CORPUS]) {
    mkdirSync(d, { recursive: true });
  }
}
