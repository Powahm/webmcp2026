import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireApiKey } from "./env";

const BASE = "https://api.company-information.service.gov.uk";

/**
 * Polite client for the Companies House REST API.
 *
 * The documented limit is 600 requests per 5 minutes — one every 500ms with
 * headroom. Every response is cached to raw/, so re-running the pipeline costs
 * nothing and you never burn the budget twice on the same company.
 */

const MIN_INTERVAL_MS = 520;
let lastCall = 0;

async function throttle(): Promise<void> {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

let authHeader: string | null = null;
function auth(): string {
  if (!authHeader) {
    // Companies House uses HTTP Basic with the key as the username and no password.
    authHeader = "Basic " + Buffer.from(requireApiKey() + ":").toString("base64");
  }
  return authHeader;
}

export interface FetchOptions {
  /** Directory under raw/ to cache into. */
  cacheDir: string;
  /** Filename inside cacheDir, without extension. */
  cacheKey: string;
}

/**
 * GET a path, cached. Returns null for 404 (a company with no officers is a
 * normal outcome, not an error) and caches the miss so we don't re-ask.
 */
export async function chGet<T>(
  path: string,
  { cacheDir, cacheKey }: FetchOptions
): Promise<T | null> {
  const file = join(cacheDir, `${cacheKey}.json`);
  if (existsSync(file)) {
    const cached = readFileSync(file, "utf8");
    return cached === "null" ? null : (JSON.parse(cached) as T);
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    await throttle();
    const res = await fetch(BASE + path, { headers: { Authorization: auth() } });

    if (res.status === 404) {
      writeFileSync(file, "null");
      return null;
    }

    if (res.status === 429) {
      // Rate limited. Back off hard — the window is 5 minutes wide.
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 30_000 * (attempt + 1);
      console.warn(`  rate limited, waiting ${Math.round(waitMs / 1000)}s…`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }

    if (res.status === 401) {
      console.error(
        "\n  Companies House rejected the API key (401).\n" +
          "  Check CH_API_KEY in .env is a REST key, and that the application is live.\n"
      );
      process.exit(1);
    }

    if (!res.ok) {
      if (attempt === 4) {
        throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`);
      }
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }

    const body = (await res.json()) as T;
    writeFileSync(file, JSON.stringify(body));
    return body;
  }

  throw new Error(`GET ${path} exhausted retries`);
}

export interface Officer {
  name?: string;
  officer_role?: string;
  appointed_on?: string;
  resigned_on?: string;
  date_of_birth?: { month?: number; year?: number };
  address?: Record<string, string>;
  occupation?: string;
  nationality?: string;
}

export interface OfficerList {
  items?: Officer[];
  total_results?: number;
}

export interface FilingItem {
  transaction_id?: string;
  category?: string;
  type?: string;
  description?: string;
  date?: string;
  action_date?: string;
  description_values?: Record<string, string>;
}

export interface FilingHistory {
  items?: FilingItem[];
  total_count?: number;
}

export const getOfficers = (companyNumber: string, cacheDir: string) =>
  chGet<OfficerList>(`/company/${companyNumber}/officers?items_per_page=100`, {
    cacheDir,
    cacheKey: companyNumber,
  });

export const getFilingHistory = (companyNumber: string, cacheDir: string) =>
  chGet<FilingHistory>(
    `/company/${companyNumber}/filing-history?items_per_page=100`,
    { cacheDir, cacheKey: companyNumber }
  );
