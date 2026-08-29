/**
 * Documents are rendered ONCE, offline, and the character offsets recorded here
 * are the offsets the evidence drawer highlights. This is the piece people get
 * wrong: if the app reformats a document at display time, every span in the
 * corpus silently points at the wrong text and the citations become worthless.
 *
 * So text and spans are produced together, by the same code, in one pass.
 */

export interface Span {
  start: number;
  end: number;
}

export class TextBuilder {
  private parts: string[] = [];
  private len = 0;

  /** Append raw text, returning the span it occupies. */
  add(s: string): Span {
    const start = this.len;
    this.parts.push(s);
    this.len += s.length;
    return { start, end: this.len };
  }

  /** Append a line and a newline. The span covers the line, not the newline. */
  line(s = ""): Span {
    const span = this.add(s);
    this.add("\n");
    return span;
  }

  /**
   * Append a line, and return the span of `highlight` within it. Use this when
   * the citable fact is one phrase inside a sentence — the drawer should
   * underline the name, not the whole paragraph.
   */
  lineWith(before: string, highlight: string, after = ""): Span {
    this.add(before);
    const span = this.add(highlight);
    this.add(after);
    this.add("\n");
    return span;
  }

  blank(): void {
    this.add("\n");
  }

  toString(): string {
    return this.parts.join("");
  }

  get length(): number {
    return this.len;
  }
}
