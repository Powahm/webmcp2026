import { announce } from "../a11y/focus-work.js";

/**
 * The guided tour: a hole in a dimmed screen, and a card that says what is
 * inside it.
 *
 * Every other way of explaining an interface asks the person to hold a picture
 * of it in their head while they read about it. A tour does not: the thing
 * being described is the thing on screen, lit, at the moment it is described.
 * That is the whole trick, and it is why the steps point at live elements
 * rather than at screenshots, which would start lying the first time a button
 * moved.
 *
 * The dimming is one element and one box shadow. A shadow is painted, not laid
 * out, so it cannot be clicked and it costs nothing to move: the hole is a
 * border and a rectangle, and the ninety-nine hundred pixels of shadow around
 * it darken the rest of the screen for free. A separate blocker underneath
 * swallows clicks, because a tour that lets you press the button it is
 * describing is a tour that ends somewhere it did not expect.
 */

const reduced = matchMedia("(prefers-reduced-motion: reduce)");

/** The one tour that can be running. Starting another ends this one first. */
let live = null;

const el = (cls, tag = "div") => {
  const node = document.createElement(tag);
  node.className = cls;
  return node;
};

/**
 * Wait for the thing a step points at.
 *
 * A step that opens a window is pointing at markup that does not exist yet
 * when the step begins, and the window flies in from its icon over about four
 * hundred milliseconds. Polling frame by frame for a little over a second
 * covers both, and a step whose target never arrives is shown centred rather
 * than dropped, because a missing highlight is worth less than a missing
 * explanation.
 */
function resolve(target, timeout = 1400) {
  if (!target) return Promise.resolve(null);
  const find = () => {
    try {
      const found = typeof target === "function" ? target() : document.querySelector(target);
      return found && found.isConnected ? found : null;
    } catch {
      return null;
    }
  };
  const first = find();
  if (first) return Promise.resolve(first);

  return new Promise((resolve) => {
    const started = performance.now();
    const look = () => {
      const found = find();
      if (found || performance.now() - started > timeout) return resolve(found);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
}

export function endTour() {
  if (!live) return;
  const { root, onKey, stop, onEnd } = live;
  live = null;
  cancelAnimationFrame(stop.frame);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", stop.reflow);
  root.remove();
  onEnd?.();
}

/**
 * Run a list of steps.
 *
 * A step is `{ title, text, target, before, spot }`. `target` is a selector or
 * a function returning an element; `before` is anything that has to happen
 * first, such as opening the window the step is about; `spot` widens the hole
 * when the thing being described is smaller than the idea of it.
 */
export async function startTour(steps, { name = "Tour", onEnd } = {}) {
  endTour();
  if (!steps.length) return;

  const root = el("tour");
  root.dataset.reduced = String(reduced.matches);
  const block = el("tour-block");
  const hole = el("tour-hole");
  const card = el("tour-card");
  card.tabIndex = -1;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", `${name}, guided`);
  card.innerHTML = `
    <p class="tour-count mono"></p>
    <h2 class="tour-title"></h2>
    <p class="tour-text"></p>
    <div class="tour-acts">
      <button class="btn btn-mini" data-tour="stop">End</button>
      <span class="tour-gap"></span>
      <button class="btn btn-mini" data-tour="back">Back</button>
      <button class="btn btn-mini btn-accent" data-tour="next">Next</button>
    </div>`;
  root.append(block, hole, card);
  document.body.appendChild(root);

  const countEl = card.querySelector(".tour-count");
  const titleEl = card.querySelector(".tour-title");
  const textEl = card.querySelector(".tour-text");
  const backBtn = card.querySelector('[data-tour="back"]');
  const nextBtn = card.querySelector('[data-tour="next"]');

  let at = 0;
  let node = null;
  let last = "";

  /** Put the hole where the element is, and the card where it fits. */
  function place() {
    const pad = 6;
    root.dataset.hole = String(Boolean(node && node.isConnected));
    if (!node || !node.isConnected) {
      hole.hidden = true;
      card.dataset.place = "middle";
      card.style.left = "";
      card.style.top = "";
      return;
    }
    const r = node.getBoundingClientRect();
    const spot = live?.spot || 0;
    const box = {
      left: Math.max(4, r.left - pad - spot),
      top: Math.max(4, r.top - pad - spot),
      width: Math.min(window.innerWidth - 8, r.width + (pad + spot) * 2),
      height: Math.min(window.innerHeight - 8, r.height + (pad + spot) * 2),
    };
    const key = `${box.left}|${box.top}|${box.width}|${box.height}`;
    if (key === last) return;
    last = key;

    hole.hidden = false;
    hole.style.left = `${box.left}px`;
    hole.style.top = `${box.top}px`;
    hole.style.width = `${box.width}px`;
    hole.style.height = `${box.height}px`;

    // Below the thing if there is room for the card, above it if there is not,
    // and clamped so a step about something in a corner is still readable.
    const cw = card.offsetWidth || 320;
    const ch = card.offsetHeight || 160;
    const below = box.top + box.height + 12;
    const room = window.innerHeight - below > ch + 12;
    card.dataset.place = room ? "below" : "above";
    card.style.top = `${room ? below : Math.max(12, box.top - ch - 12)}px`;
    card.style.left = `${Math.max(12, Math.min(window.innerWidth - cw - 12, box.left + box.width / 2 - cw / 2))}px`;
  }

  async function show(i) {
    at = Math.max(0, Math.min(steps.length - 1, i));
    const step = steps[at];
    // The card says what is coming before the window it is about has opened,
    // so the screen is never blank while a step is getting ready.
    countEl.textContent = `${at + 1} of ${steps.length}`;
    titleEl.textContent = step.title;
    textEl.textContent = step.text;
    backBtn.disabled = at === 0;
    nextBtn.textContent = at === steps.length - 1 ? "Done" : "Next";
    announce(`${step.title}. ${step.text}`);

    try { await step.before?.(); } catch { /* a step that cannot set itself up still reads */ }
    if (!live) return;
    node = await resolve(step.target);
    if (!live) return;
    live.spot = step.spot || 0;
    last = "";
    place();
    card.focus({ preventScroll: true });
  }

  const next = () => (at === steps.length - 1 ? endTour() : show(at + 1));
  const back = () => show(at - 1);

  card.addEventListener("click", (e) => {
    const act = e.target.closest("[data-tour]")?.dataset.tour;
    if (act === "next") next();
    if (act === "back") back();
    if (act === "stop") endTour();
  });
  // Anywhere else on the dimmed screen moves on, which is what people try
  // first and what a tour should reward rather than ignore.
  block.addEventListener("click", next);

  const onKey = (e) => {
    if (!live) return;
    if (e.key === "Escape") {
      // The desktop closes the top window on Escape. Leaving a tour is not a
      // reason to lose the window the tour just opened.
      e.preventDefault();
      e.stopPropagation();
      return endTour();
    }
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
      if (e.target.closest?.("[data-tour]")) return;
      e.preventDefault();
      e.stopPropagation();
      return void next();
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      return void back();
    }
  };
  document.addEventListener("keydown", onKey, true);

  // Windows are dragged, resized and animated while the tour is up, and the
  // hole has to stay on the thing it is lighting. Reading one rectangle a
  // frame is cheap; redrawing only when it has actually moved is cheaper.
  const stop = { frame: 0, reflow: () => { last = ""; place(); } };
  const follow = () => {
    if (!live) return;
    place();
    stop.frame = requestAnimationFrame(follow);
  };
  window.addEventListener("resize", stop.reflow);

  live = { root, onKey, stop, onEnd, spot: 0 };
  stop.frame = requestAnimationFrame(follow);
  await show(0);
}
