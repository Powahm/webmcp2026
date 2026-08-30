/** Kept in sync with src/styles/tokens.css by hand — the canvas is drawn with
 *  2D context calls, which cannot read CSS custom properties. */
export const PALETTE = {
  bg: "#0d1117",
  grid: "#151b24",

  /**
   * One ink for every confirmed entity on the canvas.
   *
   * Type is carried by the glyph on the disc (src/canvas/glyphs.ts), not by the
   * disc's colour. That frees colour to mean *state* — proposed, asserted,
   * on-path — which is the distinction a reader actually has to make quickly.
   * The per-type colours below survive for the small chips in the side panels,
   * where there is no room for a glyph.
   */
  node: "#61748c",

  company: "#7aa2d4",
  person: "#e0a458",
  address: "#6fbfa0",
  document: "#a99bd6",

  proposed: "#4fd1c5",
  reject: "#e0655a",

  link: "#2c3644",
  linkStrong: "#42505f",
  linkAsserted: "#5a4f3c",

  text: "#e6e9ef",
  textDim: "#8b97a6",
  textFaint: "#5c6774",
  halo: "#0d1117",
} as const;

export type NodeKind = "company" | "person" | "address" | "document";

export const colourFor = (type: NodeKind): string => PALETTE[type];

export { prefersReducedMotion } from "./viewport";
