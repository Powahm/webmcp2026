/**
 * Person identity.
 *
 * Companies House publishes officer and PSC names with month and year of birth
 * precisely so that two records can be matched to one person. We use it for
 * exactly that and nothing else: docs/DATA.md forbids rendering a date of birth
 * anywhere in the UI, so it never enters a document's text and never reaches a
 * corpus entity's visible attributes.
 */

export interface Dob {
  month?: number;
  year?: number;
}

/** "SMITH, John Alan" and "John Alan Smith" must land on the same key. */
export function normaliseName(raw: string): string {
  let n = raw.toUpperCase().replace(/\s+/g, " ").trim();
  const comma = n.indexOf(",");
  if (comma > 0) {
    const surname = n.slice(0, comma).trim();
    const forenames = n.slice(comma + 1).trim();
    n = `${forenames} ${surname}`.trim();
  }
  // Drop honorifics and suffixes; they are inconsistently recorded.
  n = n
    .replace(/\b(MR|MRS|MS|MISS|DR|PROF|SIR|DAME|LORD|LADY|REV)\b\.?/g, " ")
    .replace(/\b(JR|SNR|SR|II|III|IV)\b\.?/g, " ")
    .replace(/[^A-Z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return n;
}

/** Title Case for display: "JOHN ALAN SMITH" -> "John Alan Smith". */
export function displayName(raw: string): string {
  return normaliseName(raw)
    .toLowerCase()
    .split(" ")
    .map((w) => w.replace(/^([a-z])/, (m) => m.toUpperCase()))
    .join(" ")
    .replace(/\bMc([a-z])/g, (_, c: string) => "Mc" + c.toUpperCase())
    .replace(/\bO'([a-z])/g, (_, c: string) => "O'" + c.toUpperCase());
}

function slug(name: string): string {
  return normaliseName(name).toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Stable id. With a date of birth two records are the same person; without one
 * we still key on the name alone, but the entity is marked so the chain finder
 * can prefer the stronger identity when it has a choice.
 */
export function personId(name: string, dob?: Dob): string {
  const s = slug(name);
  if (dob?.year) {
    return `person:${s}-${dob.year}-${String(dob.month ?? 0).padStart(2, "0")}`;
  }
  return `person:${s}`;
}

export function identityStrength(dob?: Dob): "dob-matched" | "name-only" {
  return dob?.year ? "dob-matched" : "name-only";
}
