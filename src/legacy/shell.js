/* ============================================================
   Shell: desktop, window manager, dock, launcher, theme.
   Apps register themselves with Desk.register() and are handed
   a body element to fill when they open.
   ============================================================ */

import { announce, linearNav, trapFocus } from "../a11y/focus-work.js";

export const Desk = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const desktop = $("#desktop");
  const dock = $("#dock");
  const dockList = $("#dock-list");
  const iconsEl = $("#icons");
  const hint = $("#hint");
  const toaster = $("#toaster");

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const compact = matchMedia("(max-width: 760px)");

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const registry = new Map();
  const windows = new Map();
  let zTop = 10;
  let cascade = 0;

  /* ---------------- toast ---------------- */

  function toast(message, tone = "info") {
    const el = document.createElement("div");
    el.className = "toast";
    el.dataset.tone = tone;
    el.setAttribute("role", "status");
    el.textContent = message;
    toaster.appendChild(el);
    setTimeout(() => {
      el.dataset.leaving = "true";
      setTimeout(() => el.remove(), 260);
    }, 2600);
  }

  /* ---------------- windows ---------------- */

  /** Change a window's state and tell the app inside it. */
  function setWindowState(rec, state) {
    if (rec.el.dataset.state === state) return;
    rec.el.dataset.state = state;
    const visible = state === "open";
    rec.visibility.forEach((fn) => { try { fn(visible); } catch { /* app teardown */ } });
  }

  function focusWindow(id) {
    const rec = windows.get(id);
    if (!rec) return;
    zTop += 1;
    rec.el.style.zIndex = String(zTop);
    windows.forEach((r, key) => (r.el.dataset.focused = String(key === id)));
    syncDock();
  }

  /** Dead centre, no cascade offset. For the windows a person spends the
   *  most time in, where a stack of near-misses just makes it harder to
   *  find the thing you just opened. */
  function centredPlacement(w, h) {
    const bounds = desktop.getBoundingClientRect();
    const left = Math.max(14, Math.round((bounds.width - w) / 2));
    const top = Math.max(14, Math.round((bounds.height - h) / 2));
    return {
      left: Math.min(left, Math.max(14, bounds.width - w - 14)),
      top: Math.min(top, Math.max(14, bounds.height - h - 14))
    };
  }

  function placement(w, h, { centered = false } = {}) {
    if (centered) return centredPlacement(w, h);
    const bounds = desktop.getBoundingClientRect();
    const offset = (cascade % 5) * 28;
    cascade += 1;
    const left = Math.max(14, Math.round((bounds.width - w) / 2) - 60 + offset);
    const top = Math.max(14, Math.round((bounds.height - h) / 2) - 40 + offset);
    return {
      left: Math.min(left, Math.max(14, bounds.width - w - 14)),
      top: Math.min(top, Math.max(14, bounds.height - h - 14))
    };
  }

  /** A window sized off the desktop rather than a fixed pixel guess, for
   *  the apps a person actually works inside. 70% of whatever screen this
   *  is, not a box tuned for one laptop and cramped on every other. */
  function largeSize() {
    return {
      w: Math.round(desktop.clientWidth * 0.7),
      h: Math.round(desktop.clientHeight * 0.7)
    };
  }

  function openWindow({ id, title, meta = "", tint, size = { w: 560, h: 440 }, centered = false, origin, help = "", build, onClose }) {
    const existing = windows.get(id);
    if (existing) {
      setWindowState(existing, "open");
      focusWindow(id);
      return existing;
    }

    const large = size === "large";
    const wanted = large ? largeSize() : size;
    const w = Math.min(wanted.w, Math.max(300, desktop.clientWidth - 28));
    const h = Math.min(wanted.h, Math.max(220, desktop.clientHeight - 28));
    const pos = placement(w, h, { centered: centered || large });

    const el = document.createElement("section");
    el.className = "win";
    el.dataset.win = id;
    el.dataset.state = "open";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", title);
    Object.assign(el.style, {
      width: w + "px", height: h + "px", left: pos.left + "px", top: pos.top + "px"
    });
    if (tint) el.style.setProperty("--w-tint", tint);

    el.innerHTML = `
      <header class="win-bar">
        <span class="win-dots">
          <button class="win-dot win-dot--close" data-act="close" aria-label="Close ${esc(title)}" title="Close">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6M9 3l-6 6"/></svg>
          </button>
          <button class="win-dot win-dot--min" data-act="min" aria-label="Minimise ${esc(title)}" title="Minimise">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6h6"/></svg>
          </button>
          <button class="win-dot win-dot--max" data-act="max" aria-label="Maximise ${esc(title)}" title="Maximise">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3h6v6H3z"/></svg>
          </button>
        </span>
        <h2 class="win-title">${esc(title)}</h2>
        <span class="win-meta mono">${esc(meta)}</span>
        ${help
          ? `<button class="win-help" data-act="help" aria-label="How ${esc(title)} works"
                     title="How this works">?</button>`
          : ""}
      </header>
      <div class="win-body"></div>
      <span class="win-resize" aria-hidden="true"></span>
      <span class="win-edge" data-edge="n" aria-hidden="true"></span>
      <span class="win-edge" data-edge="s" aria-hidden="true"></span>
      <span class="win-edge" data-edge="e" aria-hidden="true"></span>
      <span class="win-edge" data-edge="w" aria-hidden="true"></span>
      <span class="win-edge" data-edge="ne" aria-hidden="true"></span>
      <span class="win-edge" data-edge="nw" aria-hidden="true"></span>
      <span class="win-edge" data-edge="sw" aria-hidden="true"></span>`;

    desktop.appendChild(el);

    const rec = { el, id, title, tint, help, restore: null, onClose, cleanups: [], visibility: [] };
    windows.set(id, rec);

    const body = $(".win-body", el);
    try {
      build?.(body, {
        setMeta: (text) => ($(".win-meta", el).textContent = text),
        close: () => closeWindow(id),
        onCleanup: (fn) => rec.cleanups.push(fn),
        // Minimising is not closing, so cleanups do not run, but an app holding
        // a camera or a microphone must let go of it anyway. A webcam light
        // that stays on after you tuck the window into the dock is alarming,
        // and rightly so.
        onVisibility: (fn) => rec.visibility.push(fn),
        el
      });
    } catch (err) {
      body.innerHTML = `<div class="pad"><p class="err">This app failed to start.</p><pre class="err-detail">${esc(err.message)}</pre></div>`;
    }

    focusWindow(id);
    wireWindow(rec);
    syncDock();

    if (origin && !reduced.matches && !compact.matches) flipIn(el, origin);
    else el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });

    hint.dataset.faded = "true";
    $(".win-dot--close", el).focus({ preventScroll: true });
    announce(`${title} opened.`);
    return rec;
  }

  /* window is measured where it lands, then thrown back to its icon */
  function flipIn(el, from) {
    const to = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const sx = Math.max(from.width / to.width, 0.12);
    const sy = Math.max(from.height / to.height, 0.12);
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.2 },
        { transform: "none", opacity: 1 }
      ],
      { duration: 430, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
  }

  function closeWindow(id) {
    const rec = windows.get(id);
    if (!rec) return;

    rec.cleanups.forEach((fn) => { try { fn(); } catch { /* app teardown */ } });
    rec.onClose?.();

    const source = document.querySelector(`.icon[data-icon="${CSS.escape(id)}"]`);
    const done = () => {
      rec.el.remove();
      windows.delete(id);
      if (source) source.dataset.open = "false";
      syncDock();
      if (!windows.size) hint.dataset.faded = "false";
      // Focus has to land somewhere real. The icon that opened this window is
      // the honest place, and the window underneath is the next best: leaving
      // it on <body> means the next Tab starts again from the menubar.
      const next = [...windows.values()].pop();
      if (next) {
        focusWindow(next.id);
        $(".win-dot--close", next.el)?.focus({ preventScroll: true });
      } else if (source) source.focus({ preventScroll: true });
      announce(`${rec.title} closed.`);
    };

    if (reduced.matches || compact.matches) return done();

    const from = rec.el.getBoundingClientRect();
    const to = source ? source.getBoundingClientRect() : null;
    const frames = to
      ? [
          { transform: "none", opacity: 1 },
          {
            transform: `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${
              to.top + to.height / 2 - (from.top + from.height / 2)
            }px) scale(${Math.max(to.width / from.width, 0.12)}, ${Math.max(to.height / from.height, 0.12)})`,
            opacity: 0
          }
        ]
      : [{ transform: "none", opacity: 1 }, { transform: "scale(.94)", opacity: 0 }];

    const anim = rec.el.animate(frames, { duration: 280, easing: "cubic-bezier(0.4, 0, 1, 1)" });
    anim.onfinish = done;
    anim.oncancel = done;
  }

  function wireWindow(rec) {
    const { el, id } = rec;
    const bar = $(".win-bar", el);

    el.addEventListener("pointerdown", () => focusWindow(id), true);

    bar.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      if (act === "close") closeWindow(id);
      if (act === "min") {
        setWindowState(rec, "minimised");
        syncDock();
        announce(`${rec.title} minimised to the dock.`);
        // The window it was on has just gone display:none, so send focus to the
        // dock button that brings it back.
        dockList
          .querySelector(`.dock-btn[data-win-id="${CSS.escape(id)}"]`)
          ?.focus({ preventScroll: true });
      }
      if (act === "max") toggleMax(rec);
      // Loaded when it is asked for. The tour knows about every window in the
      // app, so importing it from the window manager at module scope would
      // pull the whole desktop into the file that draws the desktop.
      if (act === "help") {
        import("../help/tours.js").then((m) => m.startHelp(rec.help));
      }
    });

    bar.addEventListener("dblclick", (e) => {
      if (!e.target.closest("[data-act]")) toggleMax(rec);
    });

    drag(bar, el, (dx, dy, start) => {
      const bounds = desktop.getBoundingClientRect();
      el.style.left = Math.min(Math.max(start.x + dx, -start.w + 90), bounds.width - 90) + "px";
      el.style.top = Math.min(Math.max(start.y + dy, 0), bounds.height - 44) + "px";
    });

    drag($(".win-resize", el), el, (dx, dy, start) => {
      el.style.width = Math.max(320, start.w + dx) + "px";
      el.style.height = Math.max(220, start.h + dy) + "px";
    });

    // Every edge and corner resizes, not only the bottom-right grip. Pulling
    // the top or left edge moves the window by as much as it shrinks, so the
    // opposite edge stays put, which is what makes it read as resizing rather
    // than dragging. The minimum sizes are the ones the corner grip uses.
    const MIN_W = 320, MIN_H = 220;
    for (const grip of el.querySelectorAll(".win-edge")) {
      const edge = grip.dataset.edge;
      drag(grip, el, (dx, dy, start) => {
        if (edge.includes("e")) el.style.width = Math.max(MIN_W, start.w + dx) + "px";
        if (edge.includes("s")) el.style.height = Math.max(MIN_H, start.h + dy) + "px";
        if (edge.includes("w")) {
          const w = Math.max(MIN_W, start.w - dx);
          el.style.width = w + "px";
          el.style.left = start.x + (start.w - w) + "px";
        }
        if (edge.includes("n")) {
          const h = Math.max(MIN_H, start.h - dy);
          el.style.height = h + "px";
          el.style.top = Math.max(0, start.y + (start.h - h)) + "px";
        }
      });
    }
  }

  function toggleMax(rec) {
    const { el } = rec;
    if (rec.restore) {
      Object.assign(el.style, rec.restore);
      rec.restore = null;
    } else {
      rec.restore = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
      Object.assign(el.style, {
        left: "10px", top: "10px",
        width: desktop.clientWidth - 20 + "px",
        height: desktop.clientHeight - 20 + "px"
      });
    }
  }

  function drag(handle, el, onMove) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || compact.matches) return;
      if (e.target.closest("[data-act]")) return;
      e.preventDefault();

      const start = {
        px: e.clientX, py: e.clientY,
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        w: el.offsetWidth, h: el.offsetHeight
      };

      handle.setPointerCapture(e.pointerId);
      let frame = 0;

      const move = (ev) => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          onMove(ev.clientX - start.px, ev.clientY - start.py, start);
        });
      };
      const up = () => {
        cancelAnimationFrame(frame);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  /* ---------------- dock ---------------- */

  /**
   * What a docked window looks like at 16 pixels.
   *
   * The dock used to be a coloured square and a word, which is fine until four
   * windows are open and three of them are documents. Window ids are already
   * namespaced by what opened them (`doc:`, `script:`, `skill:`, `folder:`),
   * so the prefix picks the glyph and an app supplies its own.
   */
  const DOCK_GLYPHS = {
    doc: `<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/><path d="M9 13h6M9 17h6"/>`,
    script: `<path d="M5 3h11l3 3v15H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>`,
    skill: `<path d="M12 3.5l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z"/>`,
    folder: `<path d="M3 6h6l2 2h10v11H3z"/>`,
    aiskills: `<path d="M12 3.5l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z"/>`,
    window: `<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17"/>`,
  };

  const glyph = (body) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
       stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

  function dockGlyph(id) {
    const app = registry.get(id);
    if (app?.icon) return app.icon;
    if (app?.type === "folder") return glyph(DOCK_GLYPHS.folder);
    const kind = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
    return glyph(DOCK_GLYPHS[kind] ?? DOCK_GLYPHS.window);
  }

  function syncDock() {
    dockList.innerHTML = "";
    dock.hidden = windows.size === 0;

    windows.forEach((rec) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "dock-btn";
      btn.dataset.winId = rec.id;
      btn.style.setProperty("--sw", rec.tint || "var(--yellow)");
      const minimised = rec.el.dataset.state === "minimised";
      btn.dataset.minimised = String(minimised);
      btn.setAttribute("aria-current", String(rec.el.dataset.focused === "true" && !minimised));
      // The glyph is decorative: the label beside it already names the window,
      // so a second reading of the same word would be noise.
      btn.innerHTML =
        `<span class="dock-glyph" aria-hidden="true">${dockGlyph(rec.id)}</span>` +
        `<span class="dock-label">${esc(rec.title)}</span>`;
      btn.addEventListener("click", () => {
        setWindowState(rec, "open");
        focusWindow(rec.id);
      });
      li.appendChild(btn);
      dockList.appendChild(li);
    });
  }

  /* ---------------- desktop icons ---------------- */

  const FOLDER_ART = `
    <span class="folder-art" aria-hidden="true">
      <span class="folder-back"></span>
      <span class="folder-lid"></span>
    </span>`;

  function register(app) {
    registry.set(app.id, app);
  }

  function renderIcons() {
    iconsEl.innerHTML = "";
    [...registry.values()].forEach((app) => {
      const btn = document.createElement("button");
      btn.className = "icon";
      btn.dataset.icon = app.id;
      btn.dataset.type = app.type;
      btn.style.setProperty("--f-light", app.tint);
      btn.style.setProperty("--f-dark", app.tintDark || app.tint);
      btn.setAttribute("aria-label", `Open ${app.name}`);
      btn.innerHTML = `
        ${app.type === "folder" ? FOLDER_ART : `<span class="app-art" aria-hidden="true">${app.icon}</span>`}
        <span class="icon-label">${esc(app.name)}</span>
        <span class="icon-sub mono">${esc(app.subtitle || "")}</span>`;
      btn.addEventListener("click", () => launch(app.id));
      iconsEl.appendChild(btn);
    });
  }

  // Tab still reaches every icon. The arrows are the second habit: someone who
  // treats the desktop as one thing can walk it without twelve Tab presses.
  linearNav(iconsEl, ".icon");

  function launch(id) {
    const app = registry.get(id);
    if (!app) return;
    const source = document.querySelector(`.icon[data-icon="${CSS.escape(id)}"]`);
    if (source) source.dataset.open = "true";
    app.open(source ? source.getBoundingClientRect() : null);
  }

  /* ---------------- launcher (⌘K) ---------------- */

  const spotlight = $("#spotlight");
  const spotInput = $("#spotlight-input");
  const spotResults = $("#spotlight-results");
  let matches = [];
  let cursor = 0;
  let sources = [];

  /* apps contribute searchable entries: () => [{name, where, tint, run}] */
  function addSearchSource(fn) { sources.push(fn); }

  async function collect() {
    const lists = await Promise.all(sources.map(async (fn) => {
      try { return await fn(); } catch { return []; }
    }));
    return lists.flat();
  }

  /** Released when the launcher closes, which is also what restores focus. */
  let releaseSpotlight = null;

  async function openSpotlight() {
    spotlight.hidden = false;
    spotInput.value = "";
    await renderSpotlight("");
    releaseSpotlight = trapFocus($(".spotlight-panel", spotlight), { initial: spotInput });
  }

  function closeSpotlight() {
    spotlight.hidden = true;
    releaseSpotlight?.();
    releaseSpotlight = null;
  }

  async function renderSpotlight(query) {
    const q = query.trim().toLowerCase();
    const all = await collect();
    matches = q ? all.filter((it) => `${it.name} ${it.where} ${it.text || ""}`.toLowerCase().includes(q)) : all;
    cursor = 0;

    if (!matches.length) {
      spotResults.innerHTML = `<li class="sp-empty">Nothing matches “${esc(query)}”.</li>`;
      spotInput.removeAttribute("aria-activedescendant");
      announce(`No results for ${query}.`);
      return;
    }

    // Highlighting a row is a visual act. `aria-activedescendant` is what makes
    // the same move audible: focus stays in the field, and the option the
    // arrows landed on is read out.
    spotResults.innerHTML = matches
      .map((it, i) => `
        <li role="option" id="sp-opt-${i}" aria-selected="${i === 0}" class="sp-item" data-i="${i}" style="--sw:${it.tint}">
          <span class="sp-swatch" aria-hidden="true"></span>
          <span class="sp-name">${esc(it.name)}</span>
          <span class="sp-where">${esc(it.where)}</span>
        </li>`)
      .join("");
    spotInput.setAttribute("aria-activedescendant", "sp-opt-0");
  }

  function moveSpotlight(delta) {
    if (!matches.length) return;
    cursor = (cursor + delta + matches.length) % matches.length;
    [...spotResults.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === cursor)));
    spotInput.setAttribute("aria-activedescendant", `sp-opt-${cursor}`);
    spotResults.children[cursor]?.scrollIntoView({ block: "nearest" });
  }

  function choose(i = cursor) {
    const hit = matches[i];
    if (!hit) return;
    closeSpotlight();
    hit.run();
  }

  $("#spotlight-open").addEventListener("click", openSpotlight);
  $("#help-open")?.addEventListener("click", () => {
    import("../help/tours.js").then((m) => m.startHelp("system"));
  });
  spotInput.addEventListener("input", (e) => renderSpotlight(e.target.value));
  spotResults.addEventListener("click", (e) => {
    const li = e.target.closest(".sp-item");
    if (li) choose(Number(li.dataset.i));
  });
  spotlight.addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close-spotlight")) closeSpotlight();
  });
  spotInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSpotlight(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSpotlight(-1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(); }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      spotlight.hidden ? openSpotlight() : closeSpotlight();
      return;
    }
    // F6 is the desktop convention for "next window", and it is the only way
    // to reach a window that is behind another one without a mouse.
    if (e.key === "F6") {
      const open = [...windows.values()].filter((r) => r.el.dataset.state === "open");
      if (!open.length) return;
      e.preventDefault();
      const here = open.findIndex((r) => r.el.dataset.focused === "true");
      const next = open[(here + (e.shiftKey ? -1 : 1) + open.length) % open.length];
      focusWindow(next.id);
      $(".win-dot--close", next.el)?.focus({ preventScroll: true });
      announce(`${next.title}, window ${open.indexOf(next) + 1} of ${open.length}.`);
      return;
    }

    if (e.key !== "Escape") return;
    if (!spotlight.hidden) return closeSpotlight();
    if (document.activeElement?.closest(".code-input")) return;

    const open = [...windows.values()].filter((r) => r.el.dataset.state === "open");
    const top = open.sort((a, b) => Number(a.el.style.zIndex) - Number(b.el.style.zIndex)).pop();
    if (top) closeWindow(top.id);
  });

  /* ---------------- theme + clock ---------------- */

  const themeBtn = $("#theme-toggle");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
  };

  const currentlyDark = () => {
    const stamped = document.documentElement.getAttribute("data-theme");
    return stamped ? stamped === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  };

  function syncThemeButton() {
    const dark = currentlyDark();
    themeBtn.setAttribute("aria-pressed", String(dark));
    themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  }

  const saved = store.get("desk-theme");
  if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
  syncThemeButton();

  themeBtn.addEventListener("click", () => {
    const next = currentlyDark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    store.set("desk-theme", next);
    syncThemeButton();
  });

  const clock = $("#clock");
  const tick = () => (clock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  tick();
  setInterval(tick, 10000);

  /**
   * What is open, and what has focus.
   *
   * Added for the WebMCP layer. The window list lives only in this closure and
   * the focused flag only in a data attribute on a live element, so nothing
   * outside this tab has ever known it: no server, no API, and not a scraper
   * that cannot tell a focused window from a background one. That is the whole
   * reason get_desktop_state is worth a tool.
   */
  function openWindows() {
    return [...windows.values()].map((rec) => ({
      id: rec.id,
      title: rec.title,
      focused: rec.el.dataset.focused === "true",
      minimised: rec.el.dataset.state === "minimised"
    }));
  }

  /** Registered apps and folders, whether or not they are open. */
  function catalogue() {
    return [...registry.values()].map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      open: windows.has(a.id)
    }));
  }

  return {
    register, renderIcons, launch, openWindow, closeWindow, focusWindow,
    addSearchSource, toast, esc, compact, reduced,
    isOpen: (id) => windows.has(id),
    openWindows, catalogue
  };
})();
