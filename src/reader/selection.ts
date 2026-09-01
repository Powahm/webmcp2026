/**
 * Mapping a DOM selection back to offsets in the source string.
 *
 * The whole evidence model rests on one invariant: the text indexed offline is
 * byte-for-byte the text rendered here, and every span, the corpus's citations
 * and the analyst's own marks alike. Is an index into that exact string.
 *
 * The naive approach is to read `Range.startOffset` and hope. That breaks the
 * moment a mark exists, because rendering a highlight splits the text into
 * several nodes and the offset is then relative to whichever fragment the
 * selection happened to start in. So every rendered fragment carries its own
 * source offset in `data-start`, and this module walks up to that anchor and
 * adds the distance within it. Marks can then nest and overlap freely without
 * the arithmetic drifting.
 */

const ANCHOR_ATTR = "data-start";

/** Nearest ancestor (or self) that knows where it sits in the source text. */
function anchorFor(node: Node): HTMLElement | null {
  let el: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (el) {
    if (el instanceof HTMLElement && el.hasAttribute(ANCHOR_ATTR)) return el;
    el = el.parentNode;
  }
  return null;
}

/** Characters of text inside `root` that come before (node, offset). */
function textOffsetWithin(root: HTMLElement, node: Node, offset: number): number {
  if (node === root) {
    // The boundary is between children rather than inside a text node.
    let total = 0;
    for (let i = 0; i < offset && i < root.childNodes.length; i++) {
      total += root.childNodes[i].textContent?.length ?? 0;
    }
    return total;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  // The node is not inside root at all; the caller's guard should have caught
  // this, so fall back to the start rather than inventing a position.
  return 0;
}

export function sourceOffset(node: Node, offset: number): number | null {
  const anchor = anchorFor(node);
  if (!anchor) return null;
  const base = Number(anchor.getAttribute(ANCHOR_ATTR));
  if (!Number.isFinite(base)) return null;
  return base + textOffsetWithin(anchor, node, offset);
}

export interface ReadSelection {
  start: number;
  end: number;
  text: string;
}

/**
 * Read the current selection as source offsets, or null if there isn't a real
 * one inside `container`.
 *
 * `text` is sliced from the source string rather than taken from the DOM, so a
 * selection that crosses a highlight boundary still yields exactly the
 * characters the offsets describe.
 */
export function readSelection(
  container: HTMLElement,
  source: string
): ReadSelection | null {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;

  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }

  const a = sourceOffset(range.startContainer, range.startOffset);
  const b = sourceOffset(range.endContainer, range.endOffset);
  if (a === null || b === null) return null;

  let start = Math.min(a, b);
  let end = Math.max(a, b);

  // Trim whitespace at the edges: a double-click or a drag across a line almost
  // always picks up a trailing space, and a citation that includes it looks
  // sloppy when the analyst reads it back.
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;

  if (end <= start) return null;
  if (start < 0 || end > source.length) return null;

  return { start, end, text: source.slice(start, end) };
}
