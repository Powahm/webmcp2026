/**
 * What the ghost says when a tool is called.
 *
 * Every line here corresponds to a call that actually happened, which is the
 * rule the whole thing rests on: nothing is said on a timer, nothing is said
 * because something is "thinking". The tool's real name is always shown beside
 * it, so the phrasing is allowed to have a bit of character without anyone
 * having to trust it.
 *
 * Several phrasings per tool, picked in rotation rather than at random. An
 * agent reading your timeline four times in a row should not say the same
 * eleven words four times, and it should not say something different every
 * single time either, which reads as nervous.
 */

const LINES = {
  get_desktop_state: [
    "having a look around",
    "seeing what you have open",
    "getting my bearings",
  ],
  list_scripts: ["counting your scripts", "seeing what you have written"],
  get_script: ["reading a script", "having a read"],
  get_open_script: [
    "reading over your shoulder",
    "catching up on the draft",
    "seeing what you have got so far",
  ],
  get_prompter_state: ["checking where you are", "following along"],
  get_recorder_state: ["checking the camera", "seeing if you are rolling"],
  list_clips: ["going through your clips", "looking in the library"],
  get_timeline: ["reading your cut", "looking at the timeline"],
  get_selection: ["checking what you picked", "seeing what you mean"],
  get_playhead: ["finding the playhead", "checking where you are in the cut"],
  get_graphics: ["checking what is already on there", "reviewing the graphics"],
  get_offered_folders: ["checking what you let me see"],
  list_ai_skills: ["seeing what you taught me", "checking your instructions"],
  load_ai_skill: [
    "learning this one",
    "reading your instructions properly",
    "taking this on board",
  ],

  // The ones that ask something of you read differently, because they are the
  // ones you have to answer.
  propose_graphic: [
    "made you something, have a look",
    "here is a graphic, your call",
    "drew this. Keep it?",
  ],
  propose_graphic_change: [
    "tweaked it. Better?",
    "try it this way instead",
  ],
  get_composition: ["seeing what is layered on", "checking the composition"],
  get_transcript: ["reading back what you said", "going through the take"],
  get_composition_code: ["reading it as code", "checking the TSX"],
  propose_layer: [
    "put a layer up for you",
    "here is something over the cut",
    "layered this on. Yours to keep",
  ],
  propose_layer_change: ["moved it. Better?", "try the layer this way"],
  propose_sound: ["found a sound for that", "here is something under it"],
  propose_format: ["reframed it, have a look", "this might work vertical"],
  propose_cut: ["marked a cut for you", "here is a cut, your call"],
  propose_tidy: ["marked every um and every gap", "tidied the whole take, check it"],
  propose_script_line: [
    "wrote you a line",
    "here is a line, yours if you want it",
    "how about this one",
  ],
  offer_folder: ["I have a folder you might want", "found some files of yours"],
  get_page_title: ["saying hello"],
};

/** Rotate per tool, so a repeated call is not a repeated sentence. */
const turn = new Map();

export const isProposal = (name) => name.startsWith("propose_") || name === "offer_folder";

export function labelFor(name) {
  const options = LINES[name];
  if (!options) return "used a tool on this page";
  const i = turn.get(name) ?? 0;
  turn.set(name, i + 1);
  return options[i % options.length];
}

/** Reset between sessions, so a fresh page starts on the first phrasing. */
export const resetVoice = () => turn.clear();
