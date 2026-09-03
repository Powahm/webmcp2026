import { useEffect, useRef } from "react";
import { getSnapshot, subscribe } from "../webmcp/status.js";
import { labelFor } from "./toolLabels.js";

/**
 * The agent's hand.
 *
 * A WebMCP call changes the page without anything moving, which on a recording
 * looks like the page changing by itself. The ghost already says which tool ran;
 * this says *where*. It flies to the thing the call was about, presses it, and
 * the panel it pressed lights up for as long as the agent is still working.
 *
 * Two rules keep it honest, and they are the same two the ghost keeps:
 *
 *   1. It only ever moves because a tool was actually called. Nothing here runs
 *      on a timer and nothing is invented to fill a silence.
 *   2. It points at the surface that call really read or wrote. A tool that
 *      reads the transcript sends it to the transcript tab, not to wherever
 *      would look best.
 *
 * It is a pointer drawn on top of the page, not a pointer driving it. The agent
 * has no click, and this does not give it one: accepting a proposal still needs
 * a trusted event from a person, which a painted cursor cannot produce.
 */

/** Where each tool's work actually shows. First selector that matches wins. */
const TARGETS = {
  get_desktop_state: ["#icons"],
  list_scripts: ['[data-icon="scripts"]'],
  get_script: ['[data-icon="scripts"]'],
  get_open_script: [".scr-text", '.win[aria-label="Scripts"]'],
  propose_script_line: [".scr-suggestion", ".scr-text"],
  get_prompter_state: ['.win[aria-label="Camera"]'],
  get_recorder_state: ['.win[aria-label="Camera"]'],
  list_clips: [".ed-lib-list", ".ed-lib"],
  get_timeline: [".tl-lane--spine", ".tl"],
  get_selection: ['.tl-item[aria-pressed="true"]', ".tl"],
  get_playhead: [".tl-playhead-grab", ".tl"],
  get_graphics: [".tl-lane--motion", ".tl-item--mclip", ".tl"],
  get_composition: [".insp-panes", ".tl"],
  get_composition_code: ['[data-tab="code"]'],
  get_transcript: ['[data-tab="words"]'],
  propose_layer: [".cmp-item.proposed", ".tl-item--mclip", ".insp-panes"],
  propose_layer_change: [".cmp-item.proposed", ".insp-panes"],
  propose_graphic: [".gfx-item.proposed", ".insp-panes"],
  propose_graphic_change: [".gfx-item.proposed", ".insp-panes"],
  propose_blank_clip: [".tl-item--blank", ".tl-lane--spine"],
  propose_sound: [".tl-item--sfx", ".tl-lane--sfx", ".insp-panes"],
  propose_format: [".ed-formats-list", ".ed-frame"],
  propose_cut: [".cut-item", '[data-tab="words"]'],
  propose_tidy: [".cut-item", '[data-tab="words"]'],
  offer_folder: [".ghost-folder", ".agent-ghost"],
  get_offered_folders: [".ghost-folder", ".agent-ghost"],
  list_ai_skills: ['[data-icon="skills"]'],
  load_ai_skill: ['[data-icon="skills"]'],
};

/** Last resort, in order. There is always something on a desktop. */
const FALLBACK = [".win", "#icons", "body"];

const reduced = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function findTarget(name) {
  for (const sel of [...(TARGETS[name] || []), ...FALLBACK]) {
    const els = document.querySelectorAll(sel);
    // The last match is the newest thing added, which for a proposal is the
    // one the call just made.
    const el = els[els.length - 1];
    if (el) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return { el, box };
    }
  }
  return null;
}

/**
 * A critically damped spring, stepped per frame.
 *
 * Not a CSS transition, because a transition restarts from a standstill every
 * time the target changes and four calls in a row read as four separate jerks.
 * A spring carries its velocity into the next target, so a burst of calls is
 * one continuous movement.
 */
const STIFF = 108;
const DAMP = 19;

export default function Cursor() {
  const root = useRef(null);
  const chip = useRef(null);
  const raf = useRef(0);
  const pos = useRef({ x: -200, y: -200, vx: 0, vy: 0, to: null, placed: false });
  const seen = useRef(0);
  const lit = useRef(null);
  const hideAt = useRef(0);

  useEffect(() => {
    let live = true;
    let last = performance.now();

    /** Follow the spring. */
    function frame(now) {
      if (!live) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = pos.current;
      const el = root.current;

      if (s.to && el) {
        if (reduced() || !s.placed) {
          s.x = s.to.x;
          s.y = s.to.y;
          s.vx = 0;
          s.vy = 0;
          s.placed = true;
        } else {
          for (const [p, v, t] of [["x", "vx", "x"], ["y", "vy", "y"]]) {
            const a = STIFF * (s.to[t] - s[p]) - DAMP * s[v];
            s[v] += a * dt;
            s[p] += s[v] * dt;
          }
        }
        el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
      }

      if (el && hideAt.current && now > hideAt.current) {
        el.dataset.here = "false";
        hideAt.current = 0;
      }

      raf.current = requestAnimationFrame(frame);
    }
    raf.current = requestAnimationFrame(frame);

    /** React to what the agent actually did. */
    function onStatus() {
      const s = getSnapshot();
      const el = root.current;
      if (!el) return;

      // The glow says "still working", and that is `inFlight`, not a guess.
      document.body.classList.toggle("agent-working", s.inFlight > 0);

      const fresh = s.calls.filter((c) => c.seq > seen.current);
      if (fresh.length === 0) {
        if (s.inFlight > 0 && lit.current) lit.current.classList.add("is-agent-lit");
        return;
      }
      seen.current = Math.max(seen.current, ...s.calls.map((c) => c.seq));

      // Newest first in the log, so the newest call is the one to point at.
      const call = fresh.reduce((a, b) => (a.seq > b.seq ? a : b));
      const hit = findTarget(call.name);
      if (!hit) return;

      const { el: node, box } = hit;
      pos.current.to = {
        x: box.left + Math.min(box.width * 0.5, 90),
        y: box.top + Math.min(box.height * 0.5, 44),
      };

      el.dataset.here = "true";
      el.dataset.kind = call.ok === false ? "failed" : "ok";
      if (chip.current) chip.current.textContent = labelFor(call.name) || call.name;
      hideAt.current = performance.now() + 3400;

      // Press it, then let go. The ripple is on the cursor rather than the
      // element so nothing on the page has to know this exists.
      if (!reduced()) {
        el.classList.remove("is-pressing");
        // Reading offsetWidth restarts the animation; without it a second call
        // on the same target plays nothing.
        void el.offsetWidth;
        el.classList.add("is-pressing");
      }

      // Light the panel that was touched, and only that one.
      const win = node.closest?.(".win") || node;
      if (lit.current && lit.current !== win) lit.current.classList.remove("is-agent-lit");
      lit.current = win;
      win.classList?.add("is-agent-lit");
      clearTimeout(win.__agentGlow);
      win.__agentGlow = setTimeout(() => {
        if (getSnapshot().inFlight === 0) win.classList?.remove("is-agent-lit");
      }, 1600);
    }

    const off = subscribe(onStatus);
    onStatus();

    return () => {
      live = false;
      off();
      cancelAnimationFrame(raf.current);
      document.body.classList.remove("agent-working");
      lit.current?.classList?.remove("is-agent-lit");
    };
  }, []);

  return (
    <div className="agent-cursor" ref={root} data-here="false" aria-hidden="true">
      <svg className="agent-cursor-arrow" viewBox="0 0 20 22" width="20" height="22">
        <path d="M2 1.5 17.5 12.4l-6.6.6 3.4 6.9-2.7 1.3-3.4-6.9L2 18.9Z" />
      </svg>
      <span className="agent-cursor-chip mono" ref={chip} />
    </div>
  );
}
