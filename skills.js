/* ============================================================
   Skills — craft notes on cutting, pacing and looks.
   A skill that describes a look carries an `apply`, which sets
   it on the selected timeline clip, so the reference is usable
   rather than just readable.
   ============================================================ */

const Skills = (() => {
  const TINT = "#29963F";

  const SKILLS = [
    {
      id: "cut-on-action",
      name: "Cut on action",
      kind: "cut",
      eyebrow: "Cutting",
      title: "Cut on action",
      blocks: [
        { t: "lede", v: "Make the cut in the middle of a movement, not before or after it." },
        { t: "p", v: "A hand reaches for a cup. If you cut while the hand is still travelling and land on the next shot mid-reach, the eye follows the motion straight across the join and never registers the edit. Cut a beat earlier or later and the same edit reads as a jolt." },
        { t: "h", v: "How to find the frame" },
        { t: "ul", v: [
          "Scrub to where the movement is fastest — that is where the eye is least able to notice a change.",
          "Trim the outgoing clip to end there, and the incoming clip to start slightly *before* the matching position.",
          "Overlap by two or three frames. The brain fills the gap; a perfectly matched cut often reads as a stutter."
        ] },
        { t: "note", v: "In this editor: select the clip, drag **End** to the middle of the motion, then set the next clip's **Start** just ahead of where the movement left off." }
      ]
    },
    {
      id: "j-and-l",
      name: "J-cuts and L-cuts",
      kind: "cut",
      eyebrow: "Cutting",
      title: "J-cuts and L-cuts",
      blocks: [
        { t: "lede", v: "Let the sound arrive before the picture, or linger after it. This is the single biggest upgrade to an amateur edit." },
        { t: "p", v: "In a **J-cut** you hear the next scene before you see it — the audio leads. In an **L-cut** the audio of the outgoing shot continues over the incoming one. Both stop the video feeling like a slideshow, because picture and sound stop changing at the same instant." },
        { t: "h", v: "Where to use them" },
        { t: "ul", v: [
          "Interview to b-roll — keep the voice running, change the picture. That is an L-cut.",
          "Before a reveal — bring the room tone or music in a second early. That is a J-cut.",
          "Anywhere two talking heads alternate. Straight cuts between them feel mechanical."
        ] },
        { t: "note", v: "This editor cuts picture and sound together, so approximate it: mute the incoming clip and let the previous one carry, or trim so the spoken line finishes across the join." }
      ]
    },
    {
      id: "pacing",
      name: "Pacing and dead air",
      kind: "edit",
      eyebrow: "Editing",
      title: "Pacing and dead air",
      blocks: [
        { t: "lede", v: "The places you got bored are the places you cut. That is most of editing." },
        { t: "h", v: "The pass that fixes almost everything" },
        { t: "ul", v: [
          "Lay everything down in roughly the right order. Do not trim yet.",
          "Watch it once, start to finish, hands off the keyboard. Note where your attention drifts.",
          "Go back and cut only those places. Do not polish anything else on this pass."
        ] },
        { t: "h", v: "Where the dead air hides" },
        { t: "ul", v: [
          "The breath before a sentence. Cutting these alone can take 15% off a talking-head video.",
          "The first second of every clip, where you are still settling.",
          "The last second, where you are waiting to press stop.",
          "Any sentence that restates the one before it."
        ] },
        { t: "note", v: "A cut that feels slightly too fast on the third viewing is usually correct. You have seen it far more times than your audience will." }
      ]
    },
    {
      id: "three-act-clip",
      name: "Structure a short",
      kind: "edit",
      eyebrow: "Editing",
      title: "Structure a short",
      blocks: [
        { t: "lede", v: "Under two minutes, you have three jobs: earn the first three seconds, deliver one idea, get out." },
        { t: "h", v: "The shape" },
        { t: "ul", v: [
          "**Hook, 0–3s.** State the problem or show the result. No logo, no “hey guys”, no throat-clearing.",
          "**Body, 3s–80%.** One idea. If you have two, you have two videos.",
          "**Out, last 10%.** One line. Stop recording before you feel finished — the impulse to wrap up politely is what makes endings drag."
        ] },
        { t: "p", v: "The most common fixable mistake is burying the result. If the payoff is at 0:45, show a two-second flash of it at 0:02 and then go back and explain." },
        { t: "note", v: "Write the hook last, once you know what the video actually turned out to be about." }
      ]
    },
    {
      id: "look-punch",
      name: "Look: punchy",
      kind: "style",
      eyebrow: "Style",
      title: "Punchy",
      apply: { look: "punch", speed: 1, label: "Apply punchy look" },
      blocks: [
        { t: "lede", v: "High contrast, high saturation. Reads well small and fast." },
        { t: "p", v: "Contrast 1.35, saturation 1.45. Built for phone screens and for cuts that move quickly, where a flat image turns to mush at low bitrates." },
        { t: "h", v: "Use it for" },
        { t: "ul", v: ["Short-form and social.", "Product shots that need to pop.", "Anything with a lot of fast cuts."] },
        { t: "h", v: "Avoid it for" },
        { t: "ul", v: ["Skin tones in close-up — saturation this high goes orange fast.", "Footage already shot in harsh sun."] }
      ]
    },
    {
      id: "look-faded",
      name: "Look: faded",
      kind: "style",
      eyebrow: "Style",
      title: "Faded",
      apply: { look: "faded", speed: 1, label: "Apply faded look" },
      blocks: [
        { t: "lede", v: "Lifted blacks, low saturation. Calm, filmic, a little nostalgic." },
        { t: "p", v: "Contrast 0.85, saturation 0.75, brightness 1.12. The lifted black point is what reads as film — the image never reaches true black, so nothing feels digital or harsh." },
        { t: "h", v: "Use it for" },
        { t: "ul", v: ["Vlogs and personal pieces.", "Voiceover over b-roll.", "Anything you want to feel unhurried."] },
        { t: "note", v: "Pairs badly with fast cutting. If the edit is quick, the softness reads as a mistake rather than a choice." }
      ]
    },
    {
      id: "look-warm-cool",
      name: "Look: warm and cool",
      kind: "style",
      eyebrow: "Style",
      title: "Warm and cool",
      apply: { look: "warm", speed: 1, label: "Apply warm look" },
      blocks: [
        { t: "lede", v: "Temperature is the cheapest way to separate two places, or two times." },
        { t: "p", v: "**Warm** adds sepia and saturation — interiors, evenings, memory, comfort. **Cool** rotates hue and lifts brightness — mornings, exteriors, clinical, distant." },
        { t: "h", v: "The trick worth knowing" },
        { t: "p", v: "Grade a flashback or a before-shot cool and the present-day or after-shot warm, and the audience tracks which is which without being told once. Do not mix temperatures inside a single scene — it reads as a mistake, not a choice." },
        { t: "note", v: "Applies the warm look. Switch a clip to cool from the inspector to see the pairing." }
      ]
    },
    {
      id: "look-mono",
      name: "Look: mono",
      kind: "style",
      eyebrow: "Style",
      title: "Mono",
      apply: { look: "mono", speed: 1, label: "Apply mono look" },
      blocks: [
        { t: "lede", v: "Black and white forces the eye onto shape and light." },
        { t: "p", v: "Grayscale with contrast at 1.1. Without colour to sort the frame, composition has to do all the work — which is exactly why it exposes a weak shot rather than saving it." },
        { t: "h", v: "Honest test" },
        { t: "p", v: "If a shot looks better in mono, the colour version probably had a distraction in it — a bright object in the corner, mixed lighting. Fix that instead, and keep the colour." },
        { t: "h", v: "When it genuinely works" },
        { t: "ul", v: ["Strong side light and real shadow.", "Archive or interstitial material you want to sit apart.", "Faces, close, with one light source."] }
      ]
    }
  ];

  const bold = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const rich = (s) => bold(Desk.esc(s)).replace(/`([^`]+)`/g, "<code>$1</code>");

  function renderBlock(b) {
    switch (b.t) {
      case "lede": return `<p class="doc-lede">${rich(b.v)}</p>`;
      case "h":    return `<h2>${Desk.esc(b.v)}</h2>`;
      case "p":    return `<p>${rich(b.v)}</p>`;
      case "ul":   return `<ul>${b.v.map((li) => `<li>${rich(li)}</li>`).join("")}</ul>`;
      case "note": return `<p class="doc-note">${rich(b.v)}</p>`;
      default:     return "";
    }
  }

  function openSkill(skill, origin) {
    Desk.openWindow({
      id: `skill:${skill.id}`,
      title: skill.name,
      meta: skill.kind,
      tint: TINT,
      size: { w: 580, h: 500 },
      origin,
      build(body) {
        const article = document.createElement("article");
        article.className = "doc";
        article.innerHTML =
          `<span class="doc-eyebrow">${Desk.esc(skill.eyebrow)}</span><h1>${Desk.esc(skill.title)}</h1>` +
          skill.blocks.map(renderBlock).join("") +
          (skill.apply ? `<button class="btn btn-accent btn-wide skill-apply">${Desk.esc(skill.apply.label)}</button>` : "");
        body.appendChild(article);

        article.querySelector(".skill-apply")?.addEventListener("click", () => {
          const seg = Editor.timeline[Editor.timeline.length - 1];
          if (!seg) return Desk.toast("Put a clip on the timeline first.", "bad");
          seg.filter = skill.apply.look;
          seg.speed = skill.apply.speed;
          Editor.setAll({});
          Desk.toast(`Applied ${skill.apply.look} to the last clip.`, "good");
        });
      }
    });
  }

  function open(origin) {
    Desk.openWindow({
      id: "skills",
      title: "Skills",
      meta: `${SKILLS.length} skills`,
      tint: TINT,
      size: { w: 560, h: 400 },
      origin,
      build(body) {
        body.className = "win-body";
        const grid = document.createElement("div");
        grid.className = "filegrid spill";
        grid.innerHTML = SKILLS.map((s, i) => `
          <button class="file" data-skill="${s.id}" style="--i:${i}; --f-accent:${TINT}">
            <span class="file-art file-art--skill" data-kind="${s.kind}" aria-hidden="true"></span>
            <span class="file-name">${Desk.esc(s.name)}</span>
            <span class="file-kind">${Desk.esc(s.kind)}</span>
          </button>`).join("");

        grid.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-skill]");
          if (!btn) return;
          const skill = SKILLS.find((s) => s.id === btn.dataset.skill);
          if (skill) openSkill(skill, btn.getBoundingClientRect());
        });

        body.appendChild(grid);
      }
    });
  }

  return { open, openSkill, SKILLS, TINT };
})();
