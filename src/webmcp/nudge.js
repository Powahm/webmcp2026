/**
 * The skill that fits what is on screen, attached to whatever the agent asked
 * for.
 *
 * Lives in its own file because both tool surfaces need it: a skill about how
 * this person likes their graphics is useless if it only surfaces on
 * get_open_script. A skill nobody loads is a file, not a capability.
 */

import { allSkills, loadedAt, matchSkills } from "../legacy/aiskills.js";
import { currentSignals } from "../skills/signals.js";

export async function skillNudge() {
  try {
    const [context, skills] = await Promise.all([currentSignals(), allSkills()]);
    const matches = matchSkills(skills, context)
      .filter((m) => !loadedAt(m.skill.id))
      .slice(0, 2);
    if (matches.length === 0) return {};

    return {
      suggested_skills: matches.map(({ skill, hits }) => ({
        id: skill.id,
        name: skill.name,
        use_when: skill.description,
        matched: hits,
      })),
      suggested_skills_note:
        "The person left these instructions for this exact situation, and the page matched them against what is on screen right now. " +
        "Load the first one with load_ai_skill before you answer, and follow it. Their instruction for how they want this done beats your default.",
    };
  } catch {
    // A nudge is a courtesy. If the page cannot work out what it is doing, the
    // tool the agent actually asked for still answers.
    return {};
  }
}
