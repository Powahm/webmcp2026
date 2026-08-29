/** Kept in sync with src/styles/tokens.css by hand — three.js cannot read CSS
 *  custom properties, and the two layers must feel like one product. */
export const PALETTE = {
  bg: "#0b0e12",
  company: "#7c8ca1",
  person: "#d9a05b",
  address: "#6e8577",
  document: "#e6e8ea",
  proposed: "#4fd1c5",
  confirmed: "#e6e8ea",
  reject: "#c2513f",
  link: "#55636f",
  linkAsserted: "#7a8794",
} as const;

export type NodeKind = "company" | "person" | "address" | "document";

export const colourFor = (type: NodeKind): string => PALETTE[type];

export const prefersReducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
