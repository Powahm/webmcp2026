/**
 * scripts/build-corpus.ts — raw/ -> public/corpus/*.json
 *
 * Emits the four files the app fetches at boot:
 *
 *   entities.json      companies, people, addresses
 *   documents.json     each record rendered as readable plain text, with the
 *                      character offsets the evidence drawer highlights
 *   search-index.json   a MiniSearch index, built here so the browser doesn't
 *   seed.json          the ~12 nodes the canvas opens with
 *
 * Nothing is invented. Every entity and every edge below comes from a field in
 * a real filing, and carries the document id and span that evidences it.
 *
 * Run after `npm run corpus:fetch`.  Needs no API key and no network.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";
import { addressId, formatAddress, normaliseAddress, type RawAddress } from "./lib/address";
import { displayName, identityStrength, personId, type Dob } from "./lib/people";
import { CORPUS, ensureDirs, RAW_FILINGS, RAW_OFFICERS, SELECTED } from "./lib/paths";
import { TextBuilder, type Span } from "./lib/textbuilder";

// --- Shapes shared with src/types.ts ----------------------------------------

type EntityType = "company" | "person" | "address" | "document";
type Relation =
  | "director_of"
  | "psc_of"
  | "registered_at"
  | "previously_named"
  | "shares_address_with"
  | "filed";

interface Citation {
  doc_id: string;
  span: Span;
  corroborating?: { doc_id: string; span: Span }[];
}
interface Entity {
  id: string;
  type: EntityType;
  label: string;
  attrs?: Record<string, string | number | undefined>;
  sources?: string[];
}
interface Edge {
  id: string;
  from_id: string;
  to_id: string;
  relation: Relation;
  derived?: boolean;
  citations: Citation[];
}
interface CorpusDocument {
  id: string;
  title: string;
  entity_id?: string;
  date?: string;
  text: string;
  mentions: string[];
}

// --- raw/selected.json ------------------------------------------------------

interface SelectedCompany {
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
interface SelectedPsc {
  company_number: string;
  name: string;
  kind: string;
  natures_of_control: string[];
  dob?: Dob;
  address?: RawAddress;
  notified_on?: string;
  identityKey: string;
}
interface Selected {
  companies: SelectedCompany[];
  psc: SelectedPsc[];
  seed_company_numbers?: string[];
  addressGroups: { id: string; normalised: string; display: string; company_numbers: string[] }[];
}

interface RawOfficer {
  name?: string;
  officer_role?: string;
  appointed_on?: string;
  resigned_on?: string;
  date_of_birth?: Dob;
  occupation?: string;
  nationality?: string;
  address?: Record<string, string>;
}
interface RawFiling {
  category?: string;
  type?: string;
  description?: string;
  description_values?: Record<string, string>;
  date?: string;
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  if (raw === "null" || !raw.trim()) return null;
  return JSON.parse(raw) as T;
}

// --- Rendering helpers ------------------------------------------------------

const UK_DATE = (iso?: string): string => {
  if (!iso) return "not recorded";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(iso.trim());
  if (d) return `${d[1]} ${MONTHS[Number(d[2]) - 1]} ${d[3]}`;
  return iso;
};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** Companies House filing descriptions are template keys. Render them readably
 *  rather than dumping the key — but never paraphrase away the facts. */
function humaniseFiling(f: RawFiling): string {
  const base = (f.description ?? f.type ?? "filing")
    .replace(/-/g, " ")
    .replace(/\bltd\b/gi, "Ltd")
    .replace(/^([a-z])/, (m) => m.toUpperCase());
  const vals = f.description_values ?? {};
  const extras = Object.entries(vals)
    .filter(([k]) => !/^(description)$/.test(k))
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);
  return extras.length ? `${base} (${extras.join("; ")})` : base;
}

const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").trim();

// --- Build ------------------------------------------------------------------

function main() {
  ensureDirs();

  const selected = readJson<Selected>(SELECTED);
  if (!selected) {
    console.error(
      `\n  ${SELECTED} not found. Run \`npm run corpus:fetch\` first.\n` +
        "  See docs/DATA.md for the two bulk downloads it needs.\n"
    );
    process.exit(1);
  }

  const entities = new Map<string, Entity>();
  const documents: CorpusDocument[] = [];
  const edges = new Map<string, Edge>();

  const addEntity = (e: Entity) => {
    const existing = entities.get(e.id);
    if (!existing) {
      entities.set(e.id, e);
      return;
    }
    existing.sources = [...new Set([...(existing.sources ?? []), ...(e.sources ?? [])])];
    existing.attrs = { ...e.attrs, ...existing.attrs };
  };

  const addEdge = (
    from_id: string,
    to_id: string,
    relation: Relation,
    citation: Citation,
    derived = false
  ) => {
    const id = `${from_id}|${relation}|${to_id}`;
    const existing = edges.get(id);
    if (existing) {
      const seen = existing.citations.some(
        (c) => c.doc_id === citation.doc_id && c.span.start === citation.span.start
      );
      if (!seen) existing.citations.push(citation);
      return;
    }
    edges.set(id, { id, from_id, to_id, relation, derived, citations: [citation] });
  };

  // ---- Addresses -----------------------------------------------------------
  const addressDisplay = new Map<string, string>();
  for (const c of selected.companies) {
    if (!addressDisplay.has(c.addressId)) {
      addressDisplay.set(c.addressId, formatAddress(c.address));
      addEntity({
        id: c.addressId,
        type: "address",
        label: formatAddress(c.address),
        attrs: { postcode: c.address.postcode, town: c.address.town },
      });
    }
  }

  // ---- Companies, and one profile document each ----------------------------
  const companyByName = new Map<string, string>();
  for (const c of selected.companies) {
    const cid = `company:${c.number}`;
    companyByName.set(norm(c.name), cid);

    const docId = `doc:profile:${c.number}`;
    const t = new TextBuilder();
    t.line(`COMPANIES HOUSE — COMPANY PROFILE`);
    t.line(`Retrieved from the Free Company Data Product.`);
    t.blank();
    const nameSpan = t.lineWith(`Company name: `, c.name);
    t.line(`Company number: ${c.number}`);
    t.line(`Company type: ${c.category}`);
    t.line(`Company status: ${c.status}`);
    t.line(`Incorporated on: ${UK_DATE(c.incorporated)}`);
    t.blank();
    t.line(`Registered office address`);
    const addrSpan = t.line(`  ${formatAddress(c.address)}`);
    if (c.sic.length) {
      t.blank();
      t.line(`Nature of business (SIC)`);
      for (const s of c.sic) t.line(`  ${s}`);
    }
    const prevSpans: { name: string; span: Span }[] = [];
    if (c.previousNames.length) {
      t.blank();
      t.line(`Previous company names`);
      for (const p of c.previousNames) {
        prevSpans.push({ name: p, span: t.lineWith(`  `, p) });
      }
    }

    addEntity({
      id: cid,
      type: "company",
      label: c.name,
      attrs: {
        company_number: c.number,
        status: c.status,
        category: c.category,
        incorporated: c.incorporated,
        sic: c.sic[0],
      },
      sources: [docId],
    });

    documents.push({
      id: docId,
      title: `${c.name} — company profile`,
      entity_id: cid,
      date: c.incorporated,
      text: t.toString(),
      mentions: [cid, c.addressId],
    });

    addEdge(cid, c.addressId, "registered_at", { doc_id: docId, span: addrSpan });
    void nameSpan;

    // previously_named becomes an edge only when a former name is another
    // company in the corpus. Otherwise it stays a fact on the profile document.
    for (const { name, span } of prevSpans) {
      const other = companyByName.get(norm(name));
      if (other && other !== cid) {
        addEdge(cid, other, "previously_named", { doc_id: docId, span });
      }
    }
  }

  // Second pass for previous names, now that every company name is known.
  for (const c of selected.companies) {
    if (!c.previousNames.length) continue;
    const cid = `company:${c.number}`;
    const doc = documents.find((d) => d.id === `doc:profile:${c.number}`);
    if (!doc) continue;
    for (const p of c.previousNames) {
      const other = companyByName.get(norm(p));
      if (!other || other === cid) continue;
      const start = doc.text.indexOf(p);
      if (start < 0) continue;
      addEdge(cid, other, "previously_named", {
        doc_id: doc.id,
        span: { start, end: start + p.length },
      });
    }
  }

  // ---- Officers ------------------------------------------------------------
  let officerDocs = 0;
  for (const c of selected.companies) {
    const raw = readJson<{ items?: RawOfficer[] }>(join(RAW_OFFICERS, `${c.number}.json`));
    const items = (raw?.items ?? []).filter((o) => o.name);
    if (!items.length) continue;

    const cid = `company:${c.number}`;
    const docId = `doc:officers:${c.number}`;
    const mentions = new Set<string>([cid]);

    const t = new TextBuilder();
    t.line(`COMPANIES HOUSE — OFFICERS`);
    t.line(`${c.name} (company number ${c.number})`);
    t.blank();

    const claims: { pid: string; span: Span; role: string }[] = [];
    for (const o of items) {
      const disp = displayName(o.name!);
      const pid = personId(o.name!, o.date_of_birth);
      const role = (o.officer_role ?? "officer").replace(/-/g, " ");
      const span = t.lineWith(``, disp, ` — ${role}`);
      t.line(`  Appointed on: ${UK_DATE(o.appointed_on)}`);
      if (o.resigned_on) t.line(`  Resigned on: ${UK_DATE(o.resigned_on)}`);
      if (o.occupation) t.line(`  Occupation: ${o.occupation}`);
      if (o.nationality) t.line(`  Nationality: ${o.nationality}`);
      t.blank();

      // Date of birth is deliberately absent from this text. It is published,
      // and we use it for identity matching, but docs/DATA.md forbids putting
      // it on screen — and this text is what the evidence drawer renders.
      addEntity({
        id: pid,
        type: "person",
        label: disp,
        attrs: {
          identity: identityStrength(o.date_of_birth),
          occupation: o.occupation,
          nationality: o.nationality,
        },
        sources: [docId],
      });
      mentions.add(pid);
      claims.push({ pid, span, role });
    }

    documents.push({
      id: docId,
      title: `${c.name} — officers`,
      entity_id: cid,
      text: t.toString(),
      mentions: [...mentions],
    });
    officerDocs++;

    for (const { pid, span } of claims) {
      addEdge(pid, cid, "director_of", { doc_id: docId, span });
    }
  }

  // ---- Persons with significant control -----------------------------------
  const pscByCompany = new Map<string, SelectedPsc[]>();
  for (const p of selected.psc) {
    const list = pscByCompany.get(p.company_number);
    if (list) list.push(p);
    else pscByCompany.set(p.company_number, [p]);
  }

  for (const [number, list] of pscByCompany) {
    const cid = `company:${number}`;
    if (!entities.has(cid)) continue;
    const company = selected.companies.find((c) => c.number === number)!;
    const docId = `doc:psc:${number}`;
    const mentions = new Set<string>([cid]);

    const t = new TextBuilder();
    t.line(`COMPANIES HOUSE — PERSONS WITH SIGNIFICANT CONTROL`);
    t.line(`${company.name} (company number ${number})`);
    t.blank();

    const claims: { pid: string; span: Span }[] = [];
    for (const p of list) {
      const disp = displayName(p.name);
      const pid = personId(p.name, p.dob);
      const span = t.lineWith(``, disp);
      t.line(`  Notified on: ${UK_DATE(p.notified_on)}`);
      for (const n of p.natures_of_control) {
        t.line(`  Nature of control: ${n.replace(/-/g, " ")}`);
      }
      t.blank();

      addEntity({
        id: pid,
        type: "person",
        label: disp,
        attrs: { identity: identityStrength(p.dob) },
        sources: [docId],
      });
      mentions.add(pid);
      claims.push({ pid, span });
    }

    documents.push({
      id: docId,
      title: `${company.name} — persons with significant control`,
      entity_id: cid,
      text: t.toString(),
      mentions: [...mentions],
    });

    for (const { pid, span } of claims) {
      addEdge(pid, cid, "psc_of", { doc_id: docId, span });
    }
  }

  // ---- Filing history ------------------------------------------------------
  for (const c of selected.companies) {
    const raw = readJson<{ items?: RawFiling[] }>(join(RAW_FILINGS, `${c.number}.json`));
    const items = (raw?.items ?? []).slice(0, 40);
    if (!items.length) continue;

    const cid = `company:${c.number}`;
    const docId = `doc:filings:${c.number}`;
    const t = new TextBuilder();
    t.line(`COMPANIES HOUSE — FILING HISTORY`);
    t.line(`${c.name} (company number ${c.number})`);
    t.blank();
    let firstSpan: Span | null = null;
    for (const f of items) {
      const span = t.lineWith(`${UK_DATE(f.date)}  `, humaniseFiling(f));
      if (!firstSpan) firstSpan = span;
    }

    documents.push({
      id: docId,
      title: `${c.name} — filing history`,
      entity_id: cid,
      text: t.toString(),
      mentions: [cid],
    });

    if (firstSpan) addEdge(cid, docId, "filed", { doc_id: docId, span: firstSpan });
  }

  // ---- shares_address_with, the one derived edge --------------------------
  // It cites TWO filings, not one, and the evidence drawer says so.
  const byAddress = new Map<string, string[]>();
  for (const c of selected.companies) {
    const list = byAddress.get(c.addressId);
    if (list) list.push(c.number);
    else byAddress.set(c.addressId, [c.number]);
  }

  let derivedCount = 0;
  for (const [aid, numbers] of byAddress) {
    if (numbers.length < 2 || numbers.length > 30) continue;
    for (let i = 0; i < numbers.length; i++) {
      for (let j = i + 1; j < numbers.length; j++) {
        const a = numbers[i];
        const b = numbers[j];
        const da = documents.find((d) => d.id === `doc:profile:${a}`);
        const db = documents.find((d) => d.id === `doc:profile:${b}`);
        if (!da || !db) continue;
        const display = addressDisplay.get(aid)!;
        const sa = da.text.indexOf(display);
        const sb = db.text.indexOf(display);
        if (sa < 0 || sb < 0) continue;
        addEdge(
          `company:${a}`,
          `company:${b}`,
          "shares_address_with",
          {
            doc_id: da.id,
            span: { start: sa, end: sa + display.length },
            corroborating: [{ doc_id: db.id, span: { start: sb, end: sb + display.length } }],
          },
          true
        );
        derivedCount++;
      }
    }
  }

  // ---- Document entities ---------------------------------------------------
  for (const d of documents) {
    addEntity({ id: d.id, type: "document", label: d.title, sources: [d.id] });
  }

  // ---- Search index --------------------------------------------------------
  const mini = new MiniSearch<CorpusDocument>({
    fields: ["title", "text"],
    storeFields: ["title", "entity_id"],
    idField: "id",
    searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.15 },
  });
  mini.addAll(documents);

  // ---- Seed: deliberately sparse, deliberately incomplete ------------------
  // find-chains.ts rewrites this once a chain is locked, to guarantee the
  // chain's intermediate nodes are NOT present at boot.
  const seedNumbers = (selected.seed_company_numbers ?? selected.companies.map((c) => c.number)).slice();
  const seedGroup = selected.addressGroups.find((g) =>
    g.company_numbers.filter((n) => seedNumbers.includes(n)).length >= 3
  );
  const seedIds: string[] = [];
  if (seedGroup) {
    seedIds.push(seedGroup.id);
    for (const n of seedGroup.company_numbers.slice(0, 4)) seedIds.push(`company:${n}`);
  }
  for (const c of selected.companies.slice(0, 40)) {
    if (seedIds.length >= 12) break;
    const id = `company:${c.number}`;
    if (!seedIds.includes(id)) seedIds.push(id);
  }

  const entityList = [...entities.values()];
  const edgeList = [...edges.values()];

  writeFileSync(join(CORPUS, "entities.json"), JSON.stringify(entityList));
  writeFileSync(join(CORPUS, "edges.json"), JSON.stringify(edgeList));
  writeFileSync(join(CORPUS, "documents.json"), JSON.stringify(documents));
  writeFileSync(join(CORPUS, "search-index.json"), JSON.stringify(mini));
  writeFileSync(
    join(CORPUS, "seed.json"),
    JSON.stringify({ node_ids: seedIds.slice(0, 12) }, null, 2)
  );

  const counts = (t: EntityType) => entityList.filter((e) => e.type === t).length;
  console.log(`
  entities   ${entityList.length}
    company  ${counts("company")}
    person   ${counts("person")}
    address  ${counts("address")}
    document ${counts("document")}
  edges      ${edgeList.length}  (${derivedCount} derived shares_address_with)
  documents  ${documents.length}  (${officerDocs} officer lists)
  seed       ${Math.min(seedIds.length, 12)} nodes

  wrote ${CORPUS}/{entities,edges,documents,search-index,seed}.json
`);

  // A corpus with no cross-company person is a corpus with no chain to find.
  const personDegree = new Map<string, number>();
  for (const e of edgeList) {
    if (e.relation === "director_of" || e.relation === "psc_of") {
      personDegree.set(e.from_id, (personDegree.get(e.from_id) ?? 0) + 1);
    }
  }
  const multi = [...personDegree.values()].filter((d) => d > 1).length;
  console.log(`  people connected to more than one company: ${multi}`);
  if (multi === 0) {
    console.warn(
      "  WARNING: no person links two companies. There is no four-hop chain in\n" +
        "  this corpus. Widen the selection in scripts/fetch-companies.ts.\n"
    );
  }
}

main();
