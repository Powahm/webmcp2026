/**
 * scripts/fetch-companies.ts — selection pass.
 *
 * Reads the two free bulk products, picks ~300 companies worth investigating,
 * then pulls officers and filing history for exactly those from the REST API.
 * Everything lands in raw/, which is gitignored. Nothing here runs in the app.
 *
 * INPUTS you must download by hand (both free, both large):
 *
 *   1. Free Company Data Product  (monthly, ~2.5 GB unzipped)
 *      http://download.companieshouse.gov.uk/en_output.html
 *      Unzip it and put the CSV in  raw/bulk/
 *
 *   2. PSC snapshot               (daily, ~1.5 GB unzipped, optional but wanted)
 *      http://download.companieshouse.gov.uk/en_pscdata.html
 *      Unzip it and put the .txt in  raw/psc/
 *
 * Then:  cp .env.example .env   (add your CH_API_KEY)
 *        npm run corpus:fetch
 *
 * The API pull is cached per company, so re-running is free and interrupting it
 * is safe — it picks up where it stopped.
 *
 * Pass --select-only to run the two streaming passes and write raw/selected.json
 * without touching the API. Worth doing first: it is where all the judgement is,
 * and it costs none of the rate-limit budget.
 */

import { createReadStream, existsSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { parse } from "csv-parse";
import {
  addressId,
  formatAddress,
  isGroupableAddress,
  normaliseAddress,
  type RawAddress,
} from "./lib/address";
import { getFilingHistory, getOfficers } from "./lib/ch";
import { hash32 } from "./lib/hash";
import { ensureDirs, RAW_BULK, RAW_FILINGS, RAW_OFFICERS, RAW_PSC, SELECTED } from "./lib/paths";
import { progress } from "./lib/progress";
import { requireApiKey } from "./lib/env";

// --- Tuning -----------------------------------------------------------------
// docs/DATA.md: an *unusual* number of companies at one address is the signal.
// Below MIN it is a normal small office. Above MAX it is a formation agent
// serving thousands, which is noise rather than structure.
const MIN_AT_ADDRESS = 4;
const MAX_AT_ADDRESS = 30;
const TARGET_COMPANIES = 300;
// Reserve room for the PSC expansion — see the seed step in main().
const SEED_BUDGET = Math.round(TARGET_COMPANIES * 0.7);
const BUCKETS = 1 << 24; // 16.7M prefilter buckets, 64 MB flat

interface CompanyRow {
  number: string;
  name: string;
  status: string;
  category: string;
  incorporated: string;
  sic: string[];
  previousNames: string[];
  address: RawAddress;
  addressNorm: string;
  addressId: string;
}

interface PscRecord {
  company_number: string;
  name: string;
  kind: string;
  natures_of_control: string[];
  /** Month and year only. Companies House publishes it for identity matching;
   *  docs/DATA.md forbids rendering it in the UI. */
  dob?: { month?: number; year?: number };
  address?: RawAddress;
  notified_on?: string;
  /** name + dob month/year — what we actually match people on. */
  identityKey: string;
}

// --- Input discovery --------------------------------------------------------

/** The Free Company Data Product ships either as one big CSV or as six split
 *  parts. Both are normal; take every CSV in the directory, sorted, and stream
 *  them in sequence as though they were one file. */
function findFiles(dir: string, exts: string[], what: string, help: string): string[] {
  if (!existsSync(dir)) fail(what, help);
  const hits = readdirSync(dir)
    .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
    .sort()
    .map((f) => join(dir, f));
  if (!hits.length) fail(what, help);
  return hits;
}

function fail(what: string, help: string): never {
  console.error(`\n  Missing ${what}.\n${help}\n`);
  process.exit(1);
}

// --- Pass 1: count companies per address, memory-flat ------------------------

function csvStream(file: string) {
  return createReadStream(file).pipe(
    parse({
      columns: (header: string[]) => header.map((h) => h.trim()),
      skip_empty_lines: true,
      relax_column_count: true,
    })
  );
}

/** Every row across every part, in order. */
async function* csvRows(files: string[]): AsyncGenerator<Record<string, string>> {
  for (const f of files) {
    yield* csvStream(f) as AsyncIterable<Record<string, string>>;
  }
}

function rowAddress(r: Record<string, string>): RawAddress {
  return {
    careOf: r["RegAddress.CareOf"],
    poBox: r["RegAddress.POBox"],
    line1: r["RegAddress.AddressLine1"],
    line2: r["RegAddress.AddressLine2"],
    town: r["RegAddress.PostTown"],
    county: r["RegAddress.County"],
    country: r["RegAddress.Country"],
    postcode: r["RegAddress.PostCode"],
  };
}

async function countAddresses(files: string[]): Promise<Uint16Array> {
  const counts = new Uint16Array(BUCKETS);
  const p = progress("pass 1 / counting addresses");
  for await (const r of csvRows(files)) {
    p.tick();
    if (r["CompanyStatus"] !== "Active") continue;
    const norm = normaliseAddress(rowAddress(r));
    if (!isGroupableAddress(norm)) continue;
    const b = hash32(norm) % BUCKETS;
    if (counts[b] < 65535) counts[b]++;
  }
  p.done();
  return counts;
}

// --- Pass 2: keep only companies at busy-ish addresses, then group exactly ---

function toRow(
  r: Record<string, string>,
  address: RawAddress = rowAddress(r),
  norm: string = normaliseAddress(address)
): CompanyRow {
  const sic = [1, 2, 3, 4]
    .map((i) => r[`SICCode.SicText_${i}`])
    .filter((s): s is string => Boolean(s && s.trim()));
  const previousNames = [1, 2, 3, 4, 5]
    .map((i) => r[`PreviousName_${i}.CompanyName`])
    .filter((s): s is string => Boolean(s && s.trim()));

  return {
    number: r["CompanyNumber"],
    name: r["CompanyName"],
    status: r["CompanyStatus"],
    category: r["CompanyCategory"],
    incorporated: r["IncorporationDate"],
    sic,
    previousNames,
    address,
    addressNorm: norm,
    addressId: addressId(norm),
  };
}

async function collectCandidates(
  files: string[],
  counts: Uint16Array
): Promise<CompanyRow[]> {
  const out: CompanyRow[] = [];
  const p = progress("pass 2 / collecting candidates");
  for await (const r of csvRows(files)) {
    p.tick();
    if (r["CompanyStatus"] !== "Active") continue;
    const address = rowAddress(r);
    const norm = normaliseAddress(address);
    if (!isGroupableAddress(norm)) continue;
    const c = counts[hash32(norm) % BUCKETS];
    if (c < MIN_AT_ADDRESS || c > MAX_AT_ADDRESS) continue;

    out.push(toRow(r, address, norm));
  }
  p.done();
  return out;
}

/** Third pass, run only when the PSC expansion reaches companies that were not
 *  at a busy address and so were dropped in pass 2. */
async function collectByNumber(files: string[], want: Set<string>): Promise<CompanyRow[]> {
  const out: CompanyRow[] = [];
  const p = progress("pass 3 / rows for PSC-linked companies");
  for await (const r of csvRows(files)) {
    p.tick();
    if (!want.has(r["CompanyNumber"])) continue;
    out.push(toRow(r));
    if (out.length === want.size) break;
  }
  p.done();
  return out;
}

// --- PSC snapshot -----------------------------------------------------------

function pscIdentityKey(name: string, dob?: { month?: number; year?: number }): string {
  const n = name.toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
  return dob?.year ? `${n}|${dob.year}-${String(dob.month ?? 0).padStart(2, "0")}` : n;
}

/**
 * The PSC snapshot is ~11M records. It is never held in memory: we stream it
 * twice, and each pass keeps only a set that is bounded by the seed size.
 *
 * Pass A — which people control the seed companies.
 * Pass B — which other companies those same people control, plus the full
 *          records for everything we end up keeping.
 */
async function streamPsc(
  file: string,
  onRecord: (rec: PscRecord) => void,
  label: string
): Promise<void> {
  const p = progress(label, 1_000_000);
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    p.tick();
    if (!line.trim()) continue;
    let raw: any;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const num: string | undefined = raw.company_number;
    const d = raw.data;
    if (!num || !d?.name) continue;
    // Individuals only. Corporate PSCs are real, but their identity matching is
    // a different problem and they make a duller graph.
    if (d.kind && !String(d.kind).startsWith("individual")) continue;

    const dob = d.date_of_birth as { month?: number; year?: number } | undefined;
    onRecord({
      company_number: num,
      name: d.name,
      kind: d.kind ?? "individual-person-with-significant-control",
      natures_of_control: d.natures_of_control ?? [],
      dob,
      address: d.address
        ? {
            line1: d.address.address_line_1,
            line2: d.address.address_line_2,
            town: d.address.locality,
            county: d.address.region,
            country: d.address.country,
            postcode: d.address.postal_code,
          }
        : undefined,
      notified_on: d.notified_on,
      identityKey: pscIdentityKey(d.name, dob),
    });
  }
  p.done();
}

// --- Selection --------------------------------------------------------------

interface AddressGroup {
  id: string;
  normalised: string;
  display: string;
  company_numbers: string[];
}

function groupByAddress(rows: CompanyRow[]): AddressGroup[] {
  const byNorm = new Map<string, CompanyRow[]>();
  for (const r of rows) {
    const list = byNorm.get(r.addressNorm);
    if (list) list.push(r);
    else byNorm.set(r.addressNorm, [r]);
  }

  const groups: AddressGroup[] = [];
  for (const [norm, list] of byNorm) {
    if (list.length < MIN_AT_ADDRESS || list.length > MAX_AT_ADDRESS) continue;
    groups.push({
      id: addressId(norm),
      normalised: norm,
      display: formatAddress(list[0].address),
      company_numbers: list.map((c) => c.number),
    });
  }
  return groups;
}

/**
 * Several medium clusters beat one big one: a four-hop chain needs at least two
 * clusters joined by a shared person, and a single 30-company address is a star,
 * not a chain. So we take groups in the middle of the band first.
 */
function rankGroups(groups: AddressGroup[]): AddressGroup[] {
  const ideal = 8;
  return [...groups].sort(
    (a, b) =>
      Math.abs(a.company_numbers.length - ideal) -
      Math.abs(b.company_numbers.length - ideal)
  );
}

// --- Main -------------------------------------------------------------------

const SELECT_ONLY = process.argv.includes("--select-only");

async function main() {
  if (!SELECT_ONLY) requireApiKey();
  ensureDirs();

  const bulk = findFiles(
    RAW_BULK,
    [".csv"],
    "the Free Company Data Product CSV",
    "  Download and unzip it from http://download.companieshouse.gov.uk/en_output.html\n" +
      `  then put the .csv (or all six split parts) in ${RAW_BULK}/`
  );
  console.log(`\n  bulk data: ${bulk.length} file(s)`);
  for (const f of bulk) console.log(`    ${f}`);

  const counts = await countAddresses(bulk);
  const candidates = await collectCandidates(bulk, counts);
  console.log(`  candidates at busy addresses: ${candidates.length.toLocaleString()}`);

  const groups = rankGroups(groupByAddress(candidates));
  console.log(
    `  address groups in band [${MIN_AT_ADDRESS}..${MAX_AT_ADDRESS}]: ${groups.length.toLocaleString()}`
  );

  // --- Seed: whole address groups, up to the seed budget ---
  // Deliberately less than the cap. The remaining budget is reserved for the
  // one-hop PSC expansion, which is what joins two address clusters into a
  // chain — without reserved room the seed eats the whole graph and every
  // path is one hop long.
  const chosenGroups: AddressGroup[] = [];
  const chosen = new Set<string>();
  for (const g of groups) {
    if (chosen.size >= SEED_BUDGET) break;
    chosenGroups.push(g);
    for (const n of g.company_numbers) chosen.add(n);
  }
  const seedNumbers = new Set(chosen);
  console.log(`  seed: ${seedNumbers.size} companies across ${chosenGroups.length} addresses`);

  const byNumber = new Map(candidates.map((c) => [c.number, c]));

  // --- One-hop expansion via shared PSC ---
  let psc: PscRecord[] = [];
  const pscFile = existsSync(RAW_PSC)
    ? readdirSync(RAW_PSC).find((f) => /\.(txt|json|jsonl)$/i.test(f))
    : undefined;

  if (pscFile) {
    const pscPath = join(RAW_PSC, pscFile);
    console.log(`  psc snapshot: ${pscPath}`);

    const seedIdentities = new Set<string>();
    await streamPsc(
      pscPath,
      (r) => {
        if (seedNumbers.has(r.company_number)) seedIdentities.add(r.identityKey);
      },
      "psc pass A / people controlling the seed"
    );
    console.log(`  people controlling the seed: ${seedIdentities.size}`);

    const linked = new Map<string, PscRecord[]>();
    await streamPsc(
      pscPath,
      (r) => {
        if (!seedIdentities.has(r.identityKey)) return;
        const list = linked.get(r.company_number);
        if (list) list.push(r);
        else linked.set(r.company_number, [r]);
      },
      "psc pass B / their other companies"
    );

    const expansionNumbers = [...linked.keys()].filter((n) => !chosen.has(n));
    console.log(`  one-hop expansion candidates: ${expansionNumbers.length}`);

    // Prefer companies we already have a row for; only re-stream the CSV if we
    // still have budget left and there are rows we are missing.
    const missing: string[] = [];
    for (const n of expansionNumbers) {
      if (chosen.size >= TARGET_COMPANIES) break;
      if (byNumber.has(n)) chosen.add(n);
      else missing.push(n);
    }
    if (chosen.size < TARGET_COMPANIES && missing.length) {
      const room = TARGET_COMPANIES - chosen.size;
      const want = new Set(missing.slice(0, room * 4));
      const extra = await collectByNumber(bulk, want);
      for (const row of extra) {
        if (chosen.size >= TARGET_COMPANIES) break;
        byNumber.set(row.number, row);
        chosen.add(row.number);
      }
    }
  } else {
    console.warn(
      `\n  No PSC snapshot in ${RAW_PSC}/ — continuing on shared addresses alone.\n` +
        "  The graph will be thinner and a four-hop chain much harder to find.\n" +
        "  Get it from http://download.companieshouse.gov.uk/en_pscdata.html\n"
    );
  }

  const selected = [...chosen].map((n) => byNumber.get(n)!).filter(Boolean);

  // Keep the full PSC records for exactly the companies we selected.
  if (pscFile) {
    const pscPath = join(RAW_PSC, pscFile);
    const keep: PscRecord[] = [];
    await streamPsc(
      pscPath,
      (r) => {
        if (chosen.has(r.company_number)) keep.push(r);
      },
      "psc pass C / records for the selection"
    );
    psc = keep;
  }

  console.log(
    `\n  selected: ${selected.length} companies ` +
      `(${seedNumbers.size} seed + ${selected.length - seedNumbers.size} expanded), ` +
      `${psc.length} PSC records\n`
  );

  writeFileSync(
    SELECTED,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        source: { bulk_files: bulk, psc: pscFile ? join(RAW_PSC, pscFile) : null },
        seed_company_numbers: [...seedNumbers],
        companies: selected,
        addressGroups: chosenGroups,
        psc,
      },
      null,
      2
    )
  );
  console.log(`  wrote ${SELECTED}`);

  if (SELECT_ONLY) {
    console.log("\n  --select-only: stopping before the API pull.");
    console.log("  Re-run without the flag to fetch officers and filing history.\n");
    return;
  }

  // --- REST API pull, cached per company ---
  console.log(`\n  pulling officers and filing history (cached in raw/)…`);
  let i = 0;
  for (const c of selected) {
    i++;
    process.stdout.write(`\r  ${i}/${selected.length} ${c.number}        `);
    await getOfficers(c.number, RAW_OFFICERS);
    await getFilingHistory(c.number, RAW_FILINGS);
  }
  console.log(`\n\n  done. Next: npm run corpus:build\n`);
}

main().catch((err) => {
  console.error("\n", err);
  process.exit(1);
});
