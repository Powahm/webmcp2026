/**
 * What each tool call looks like from the outside.
 *
 * The ghost says the tool's real name, because the point of the thing is that
 * you can see which part of your page the model just touched. The phrase under
 * it is there so the name means something to someone who has never read
 * docs/OVERVIEW.md, which on the day includes every judge.
 */
export const TOOL_LABELS = {
  get_desktop_state: "looked at what you have open",
  list_scripts: "listed your scripts",
  get_script: "read a script",
  get_open_script: "read the script you have open",
  get_prompter_state: "checked the line you are on",
  get_recorder_state: "checked the camera",
  list_clips: "looked through your clips",
  get_timeline: "read your timeline",
  get_selection: "checked what you selected",
  get_playhead: "checked where the playhead is",
  get_graphics: "read the graphics on your cut",
  propose_graphic: "drew a graphic for you to judge",
  propose_graphic_change: "suggested a change to a graphic",
  propose_script_line: "wrote a line into your script",
  get_page_title: "said hello",
};

/** Proposals are the ones you have to answer, so they read differently. */
export const isProposal = (name) => name.startsWith("propose_");

export const labelFor = (name) => TOOL_LABELS[name] || "used a tool on this page";

TOOL_LABELS.offer_folder = "offered you a folder it has";
TOOL_LABELS.get_offered_folders = "checked which folders you let in";
