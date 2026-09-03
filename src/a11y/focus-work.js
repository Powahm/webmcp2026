/**
 * Focus work: the keyboard's map of the desktop.
 *
 * A desktop metaphor is a mouse metaphor by default: things are where you can
 * see them, and you get to them by pointing. That is fine until you cannot
 * point. Everything here exists so the same machine can be driven from the
 * keyboard alone, and so a screen reader is told about the things that happen
 * on their own: a window flying open, a window folding back into the dock.
 *
 * Three pieces, deliberately small:
 *
 * - `announce`: one polite live region for the whole page, because window
 *   state changes are invisible to anything that is not watching pixels.
 * - `trapFocus`: Tab stays inside a modal while it is up, and focus goes back
 *   to whatever opened it. A dialog you can Tab out of behind the scrim is a
 *   dialog you have lost.
 * - `linearNav`: arrow keys move between the icons on the desktop. Tab still
 *   reaches every one of them; this is in addition, not instead, because the
 *   icons read as a row of launchers and both habits are common.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Focusable and actually on screen. `offsetParent` is null for display:none. */
const focusable = (root) =>
  [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("hidden") && (el.offsetParent !== null || el === document.activeElement)
  );

/* ---------------------------------------------------------------- announce */

let live = null;

/**
 * Say something once, politely.
 *
 * The region is created on first use and never removed. It has to be in the
 * document before the text lands in it, or a screen reader has nothing to
 * watch, which is why the text is written on the next frame rather than in
 * the same tick the node is appended.
 */
export function announce(message) {
  if (!message) return;

  if (!live) {
    live = document.createElement("p");
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    document.body.appendChild(live);
  }

  // Clearing first makes a repeat of the same sentence announce again, which
  // matters when you close two windows called Camera in a row.
  live.textContent = "";
  requestAnimationFrame(() => {
    live.textContent = message;
  });
}

/* -------------------------------------------------------------- focus trap */

/**
 * Keep Tab inside `container` until the returned function is called.
 *
 * Returns a release function that also puts focus back where it was, unless
 * something else has already moved it somewhere sensible.
 */
export function trapFocus(container, { initial } = {}) {
  const previous = document.activeElement;

  const first = initial ?? focusable(container)[0] ?? container;
  if (first === container && !container.hasAttribute("tabindex")) container.tabIndex = -1;
  first.focus({ preventScroll: true });

  const onKeydown = (e) => {
    if (e.key !== "Tab") return;
    const items = focusable(container);
    if (!items.length) return e.preventDefault();

    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (document.activeElement === edge || !container.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0]).focus({ preventScroll: true });
    }
  };

  container.addEventListener("keydown", onKeydown);

  return function release() {
    container.removeEventListener("keydown", onKeydown);
    if (previous?.isConnected && !container.contains(document.activeElement)) return;
    previous?.focus?.({ preventScroll: true });
  };
}

/* ------------------------------------------------------------- arrow keys */

/**
 * Arrow keys, Home and End move between the items in a row.
 *
 * Tab order is left alone on purpose. Roving tabindex (one stop for the whole
 * group) is the textbook pattern for a toolbar, but these are launchers on a
 * desktop, and someone who has learned that Tab walks the icons should not
 * find that it suddenly skips past all of them.
 */
export function linearNav(container, itemSelector) {
  container.addEventListener("keydown", (e) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(e.key)) return;

    const items = [...container.querySelectorAll(itemSelector)];
    if (items.length < 2) return;

    const here = items.indexOf(document.activeElement.closest(itemSelector));
    if (here === -1) return;

    e.preventDefault();
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next =
      e.key === "Home" ? 0
        : e.key === "End" ? items.length - 1
          : (here + step + items.length) % items.length;

    items[next].focus({ preventScroll: true });
  });
}
