import MiniSearch from "minisearch";
import type { CorpusDocument, Edge, Entity } from "../types";

/**
 * The corpus is static JSON fetched once at boot. There is no server: every
 * tool executes in the page, which is what makes the WebMCP argument pure —
 * the agent can never reach data the analyst cannot also see.
 */

export interface Corpus {
  entities: Map<string, Entity>;
  /** Every relationship in the corpus. The canvas holds only a subset. */
  edges: Edge[];
  documents: Map<string, CorpusDocument>;
  index: MiniSearch<CorpusDocument>;
  seedNodeIds: string[];
  /** Filings the reader queue opens with. The first one is what the analyst
   *  sees on load, so build-corpus.ts should nominate one worth reading — see
   *  docs/DATA.md. Falls back to whatever the seed nodes cite. */
  seedDocIds: string[];
  /** Adjacency over the whole corpus, used to answer "what else is attached". */
  adjacency: Map<string, { to: string; edge: Edge }[]>;
  /** True when running on the gitignored dev fixture rather than real records. */
  isFixture: boolean;
}

let corpus: Corpus | null = null;

/** Throws if called before the boot sequence finished. Tools are registered
 *  last precisely so this cannot happen. */
export function getCorpus(): Corpus {
  if (!corpus) throw new Error("corpus not loaded");
  return corpus;
}

export function corpusReady(): boolean {
  return corpus !== null;
}

const MINISEARCH_OPTIONS = {
  fields: ["title", "text"],
  storeFields: ["title", "entity_id"],
  idField: "id",
  searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.15 },
};

function buildAdjacency(edges: Edge[]): Map<string, { to: string; edge: Edge }[]> {
  const adj = new Map<string, { to: string; edge: Edge }[]>();
  const push = (a: string, to: string, edge: Edge) => {
    const list = adj.get(a);
    if (list) list.push({ to, edge });
    else adj.set(a, [{ to, edge }]);
  };
  for (const e of edges) {
    push(e.from_id, e.to_id, e);
    push(e.to_id, e.from_id, e);
  }
  return adj;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function loadReal(): Promise<Omit<Corpus, "isFixture">> {
  const [entities, edges, documents, indexJson, seed] = await Promise.all([
    fetchJson<Entity[]>("/corpus/entities.json"),
    fetchJson<Edge[]>("/corpus/edges.json"),
    fetchJson<CorpusDocument[]>("/corpus/documents.json"),
    fetchJson<unknown>("/corpus/search-index.json"),
    fetchJson<{ node_ids: string[]; doc_ids?: string[] }>("/corpus/seed.json"),
  ]);

  return {
    entities: new Map(entities.map((e) => [e.id, e])),
    edges,
    documents: new Map(documents.map((d) => [d.id, d])),
    // Built offline by scripts/build-corpus.ts. Indexing 1000 documents at boot
    // would cost a second of blank screen for no reason.
    index: MiniSearch.loadJS(indexJson as never, MINISEARCH_OPTIONS as never),
    seedNodeIds: seed.node_ids,
    seedDocIds: seed.doc_ids ?? [],
    adjacency: buildAdjacency(edges),
  };
}

/**
 * The fixture is a handful of obviously-fake records used only to build the
 * canvas before the real corpus exists. It lives in a gitignored directory and
 * is loaded only when public/corpus/ is missing, so it can never reach a
 * deployment. docs/DATA.md: nothing in the demo is invented.
 */
type FixtureModule = {
  fixture: () => {
    entities: Entity[];
    edges: Edge[];
    documents: CorpusDocument[];
    seedNodeIds: string[];
    seedDocIds?: string[];
  };
};

// import.meta.glob rather than a bare dynamic import: the fixture directory is
// gitignored, so on Vercel it does not exist and a static import would fail the
// build. glob resolves to an empty object instead.
const fixtureModules = import.meta.glob<FixtureModule>("./__dev__/fixture.ts");

async function loadFixture(): Promise<Omit<Corpus, "isFixture">> {
  const load = fixtureModules["./__dev__/fixture.ts"];
  if (!load) {
    throw new Error(
      "public/corpus/ is missing and there is no dev fixture. " +
        "Run `npm run corpus:fetch && npm run corpus:build`."
    );
  }
  const { entities, edges, documents, seedNodeIds, seedDocIds } = (await load()).fixture();
  const index = new MiniSearch<CorpusDocument>(MINISEARCH_OPTIONS as never);
  index.addAll(documents);
  return {
    entities: new Map(entities.map((e) => [e.id, e])),
    edges,
    documents: new Map(documents.map((d) => [d.id, d])),
    index,
    seedNodeIds,
    seedDocIds: seedDocIds ?? [],
    adjacency: buildAdjacency(edges),
  };
}

/**
 * Add a document the analyst brought with them.
 *
 * The corpus is the 300 companies we ingested; this is everything else — the
 * statement they were emailed, the notes they typed up, the letter they were
 * sent. It is indexed in the browser and lives only for the session: there is
 * no server, so their document never leaves the page, which is worth saying
 * out loud to anyone who asks whether it is safe to drop a file in.
 *
 * The same offset discipline applies as to an ingested filing: the text stored
 * here is byte-for-byte the text the reader renders, so every span the analyst
 * marks and every span the agent cites means the same thing in both.
 */
export function addUploadedDocument(doc: CorpusDocument): void {
  const c = getCorpus();
  if (c.documents.has(doc.id)) return;
  c.documents.set(doc.id, doc);
  c.index.add(doc);
}

export async function loadCorpus(): Promise<Corpus> {
  if (corpus) return corpus;
  try {
    corpus = { ...(await loadReal()), isFixture: false };
  } catch (err) {
    console.warn(
      "[threadweaver] public/corpus/ not found — falling back to the dev fixture. " +
        "Run `npm run corpus:fetch && npm run corpus:build`.",
      err
    );
    corpus = { ...(await loadFixture()), isFixture: true };
  }
  return corpus;
}
