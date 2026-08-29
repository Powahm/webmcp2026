import { createHash } from "node:crypto";

/**
 * Address normalisation is the backbone of the whole graph (docs/DATA.md).
 * Dirty strings quietly destroy the best links, so this is aggressive on
 * purpose: uppercase, punctuation stripped, whitespace collapsed, and the
 * common street-type abbreviations folded to one spelling.
 *
 * It is deliberately NOT clever. Fuzzy matching would invent links, and every
 * link in this product has to survive a judge looking it up.
 */

const STREET_TYPES: Record<string, string> = {
  ST: "STREET",
  STR: "STREET",
  RD: "ROAD",
  AVE: "AVENUE",
  AV: "AVENUE",
  LN: "LANE",
  DR: "DRIVE",
  CT: "COURT",
  PL: "PLACE",
  SQ: "SQUARE",
  CRES: "CRESCENT",
  GDNS: "GARDENS",
  GDN: "GARDEN",
  TER: "TERRACE",
  PK: "PARK",
  BLDG: "BUILDING",
  BLDGS: "BUILDINGS",
  HSE: "HOUSE",
  FLR: "FLOOR",
  STE: "SUITE",
  APT: "APARTMENT",
  NO: "NUMBER",
  N: "NORTH",
  S: "SOUTH",
  E: "EAST",
  W: "WEST",
};

export interface RawAddress {
  careOf?: string;
  poBox?: string;
  line1?: string;
  line2?: string;
  town?: string;
  county?: string;
  country?: string;
  postcode?: string;
}

/** The display form: what a human reads in the Inspector and the evidence drawer. */
export function formatAddress(a: RawAddress): string {
  return [a.line1, a.line2, a.town, a.county, a.postcode, a.country]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
    .join(", ");
}

/** The matching form: what we group on. Never shown to a user. */
export function normaliseAddress(a: RawAddress): string {
  const raw = [a.line1, a.line2, a.town, a.postcode]
    .map((p) => p ?? "")
    .join(" ");

  const cleaned = raw
    .toUpperCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(" ")
    .map((tok) => STREET_TYPES[tok] ?? tok)
    .filter(Boolean)
    .join(" ");
}

/** Stable id. Short hash keeps entity ids readable in tool output and logs. */
export function addressId(normalised: string): string {
  return "address:" + createHash("sha1").update(normalised).digest("hex").slice(0, 12);
}

/** A postcode alone is far too coarse to group on, and an empty address must
 *  never collapse hundreds of companies onto one node. Both are rejected. */
export function isGroupableAddress(normalised: string): boolean {
  if (normalised.length < 12) return false;
  // Needs at least one number (a building or street number) and two words.
  if (!/\d/.test(normalised)) return false;
  return normalised.split(" ").length >= 3;
}
