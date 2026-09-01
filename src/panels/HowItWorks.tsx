import { useState } from "react";

/**
 * The five-step strip a first-time user needs and an experienced one dismisses.
 *
 * Threadweaver's method is not guessable from its chrome: nothing on screen
 * says that you read before you ask, that the agent's output is a proposal
 * rather than an answer, or that accepting is a decision only you can make. A
 * new analyst met five nouns in a rail and had to infer a workflow from them.
 *
 * Dismissal is remembered per tab, in the same sessionStorage the markings use,
 * so it does not follow you into a new session — and so the demo always opens
 * on it without a reset ritual.
 */

const KEY = "threadweaver:tour-dismissed:v1";

/** Kept terse so the five fit on one line at 1280px and up. The long form of
 *  each is in USER-GUIDE.md §5; this is a reminder, not the documentation. */
const STEPS = [
  { n: "1", verb: "Read", says: "a real filing" },
  { n: "2", verb: "Mark", says: "select text, press 1–6" },
  { n: "3", verb: "Ask", says: "in your own words" },
  { n: "4", verb: "Verify", says: "click a citation" },
  { n: "5", verb: "Accept", says: "only you decide" },
];

function dismissed(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export default function HowItWorks() {
  const [hidden, setHidden] = useState(dismissed);
  // An empty slot rather than null: .app is a grid and the row must stay.
  if (hidden) return <div className="howto-slot" />;

  const close = () => {
    setHidden(true);
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      /* a tab that cannot store simply sees the strip again next time */
    }
  };

  return (
    <aside className="howto" aria-label="How Threadweaver works">
      <ol>
        {STEPS.map((s) => (
          <li key={s.n}>
            <b aria-hidden>{s.n}</b>
            <span className="howto-verb">{s.verb}</span>
            <span className="howto-says">{s.says}</span>
          </li>
        ))}
      </ol>
      <button className="howto-close" onClick={close} aria-label="Hide the getting-started strip">
        ×
      </button>
    </aside>
  );
}
