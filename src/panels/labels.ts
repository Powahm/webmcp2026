import type { EntityType, Relation } from "../types";

/**
 * UI copy for relations.
 *
 * Structural, never accusatory. "shares a registered address with" is a fact
 * about a public record; anything stronger would be a claim about a named
 * living person, and docs/DATA.md rules that out in the copy as well as in the
 * data.
 */
export const RELATION_LABEL: Record<Relation, string> = {
  director_of: "director of",
  psc_of: "person with significant control of",
  registered_at: "registered at",
  previously_named: "previously named",
  shares_address_with: "shares a registered address with",
  filed: "filed",
};

export const RELATION_SHORT: Record<Relation, string> = {
  director_of: "director",
  psc_of: "PSC",
  registered_at: "registered at",
  previously_named: "previous name",
  shares_address_with: "same address",
  filed: "filed",
};

export const TYPE_LABEL: Record<EntityType, string> = {
  company: "Company",
  person: "Person",
  address: "Address",
  document: "Filing",
};

/** Attribute keys the Inspector is allowed to render, in order. Anything not
 *  on this list stays out of the UI — which is how dates of birth stay off
 *  screen even though we use them for identity matching. */
export const VISIBLE_ATTRS: { key: string; label: string }[] = [
  { key: "company_number", label: "Company number" },
  { key: "status", label: "Status" },
  { key: "category", label: "Type" },
  { key: "incorporated", label: "Incorporated" },
  { key: "sic", label: "Nature of business" },
  { key: "postcode", label: "Postcode" },
  { key: "town", label: "Town" },
  { key: "occupation", label: "Occupation" },
  { key: "nationality", label: "Nationality" },
  { key: "identity", label: "Identity match" },
];
