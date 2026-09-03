import { Desk } from "../legacy/shell.js";
import { startTour } from "./tour.js";

/**
 * What the tours say.
 *
 * One tour per window, plus one for the machine as a whole, kept here rather
 * than beside each app so that the whole story can be read in one file and the
 * order of it argued about. A step is a selector and two sentences: the first
 * says what the thing is, the second says what it is for. Anything longer
 * belongs in Readme, which is why every tour ends by pointing at it.
 *
 * Selectors are scoped to `[data-win="..."]` because the same class names
 * appear in more than one window, and a highlight on the wrong window is worse
 * than no highlight.
 */

const win = (id, sel = "") => `[data-win="${id}"]${sel ? ` ${sel}` : ""}`;
const open = (id) => () => Desk.launch(id);

/** The editor, seen from the tour: opened, and out of any motion graphics clip. */
const openEditor = () => {
  Desk.launch("editor");
};

const EDITOR_STEPS = [
  {
    title: "The library",
    text: "Everything you have recorded or imported, on the left. Click a clip to put it on the timeline, or drag it onto a lane.",
    target: win("editor", ".ed-lib-list"),
  },
  {
    title: "Video in, sound in",
    text: "Video brings footage into the library. Audio brings in music and sound effects, which sit here as clips like any other until you use one.",
    target: win("editor", ".ed-lib-bar"),
  },
  {
    title: "Folders",
    text: "Make a folder with the plus, then drag a clip onto it, or use the folder button on the card. Clicking a folder filters the library to it, and deleting a folder unfiles what was in it rather than deleting the footage.",
    target: win("editor", ".lib-folders"),
  },
  {
    title: "The other three tabs",
    text: "Text is the words you can put on screen, Transitions are what happens between two clips, and Transcript is what was said, once a clip has been through it.",
    target: win("editor", ".lib-tabs"),
  },
  {
    title: "The preview",
    text: "This plays the whole cut as one piece rather than clip by clip, and it draws graphics with the same renderer the export uses, so what you see is what gets written.",
    target: win("editor", ".ed-screen"),
  },
  {
    title: "The shape of the frame",
    text: "Landscape, square or vertical. The preview obeys it immediately, so a 9:16 cut looks like 9:16 while you are cutting it rather than only in the file.",
    target: win("editor", ".ed-formats"),
  },
  {
    title: "The timeline",
    text: "Click to select, drag to reorder, S splits whatever is under the playhead. The buttons above it add text, motion graphics, an overlay, and more video or audio lanes.",
    target: win("editor", ".tl-tools"),
  },
  {
    title: "Lanes",
    text: "The spine is the cut itself. Video lanes above it are overlays, audio lanes below it are sound, and anything dragged from the library lands on the lane you drop it on at the second you drop it.",
    target: win("editor", ".tl-lanes"),
  },
  {
    title: "The inspector",
    text: "Whatever is selected, in detail: trim, look, speed and sound under Clip, the graphics under Motion, and the composition as a whole under Comp.",
    target: win("editor", ".ed-insp"),
  },
  {
    title: "Export",
    text: "The cut is replayed into a canvas and recorded, so it renders in real time: a forty second video takes forty seconds. It lands back in your library and is offered as a download.",
    target: win("editor", '[data-act="export"]'),
  },
];

const TOURS = {
  editor: { name: "Editor", start: openEditor, steps: EDITOR_STEPS },

  camera: {
    name: "Camera",
    start: open("camera"),
    steps: [
      {
        title: "The preview",
        text: "Your camera, live. If it will not start, this panel says which of the three it is: permission refused, no device, or another program holding it.",
        target: win("camera", ".cam-stage"),
      },
      {
        title: "What to record",
        text: "Camera, screen, or both. The picker beside it chooses which camera when the machine has more than one.",
        target: win("camera", '[data-act="source"]'),
      },
      {
        title: "The teleprompter",
        text: "Pick a script here and it scrolls over the preview while you record, so you can read it and look at the lens at the same time.",
        target: win("camera", '[data-act="script"]'),
      },
      {
        title: "The shutter",
        text: "Press once to start, again to stop. The clip is written straight to the library, where the Editor and any script can reach it.",
        target: win("camera", ".shutter"),
        spot: 6,
      },
      {
        title: "No camera, no problem",
        text: "Import video puts a file you already have into the same library. Everything downstream treats it identically to something you shot here.",
        target: win("camera", '[data-act="import"]'),
      },
    ],
  },

  scripts: {
    name: "Scripts",
    start: open("scripts"),
    steps: [
      {
        title: "Scripts",
        text: "What you are going to say, before you say it. Open one to write it, or make a new one here.",
        target: win("scripts", ".filegrid"),
      },
      {
        title: "Inside a script",
        text: "Each line has the spoken words and a shot direction. The direction is for you while filming and never appears in the teleprompter.",
        target: win("scripts"),
      },
      {
        title: "The teleprompter",
        text: "It scrolls the script across roughly its estimated runtime, brightening the line you should be on. Minus and plus change the speed while it runs.",
        target: win("scripts"),
      },
    ],
  },

  script: {
    name: "Writing a script",
    steps: [
      {
        title: "Draft and shot list",
        text: "The same script, two ways. Draft is one document you can type into, Shot list breaks it into lines with a direction and a runtime each.",
        target: ".scr-views",
      },
      {
        title: "Research",
        text: "Notes and links you are working from. An agent reading this page can see them, and a skill exists for turning one into a script you can say out loud.",
        target: ".scr-research",
      },
      {
        title: "Runtime",
        text: "Every line is costed at about 150 words a minute and totalled here. Treat it as an upper bound if you read fast.",
        target: ".scr-foot",
      },
    ],
  },

  aiskills: {
    name: "AI Skills",
    start: async () => {
      const skills = await import("../legacy/aiskills.js");
      if (!Desk.isOpen("aiskills")) return void skills.open(null);
      // Open already, and possibly sitting on one skill's page. The tour is
      // about the list, so put it back on the list before pointing at it.
      Desk.focusWindow("aiskills");
      skills.showSkillsList();
    },
    steps: [
      {
        title: "Instructions, not software",
        text: "A page cannot install anything into an agent, and should not be able to. What it can do is answer well: markdown dropped here is offered to whatever agent is reading the page, and it takes one when it decides it is relevant.",
        target: win("aiskills", ".ais-bar"),
      },
      {
        title: "One card per skill",
        text: "The name and description come from the file's frontmatter, or are worked out from the file when it has none. Open reads the whole thing.",
        target: win("aiskills", ".ais-card"),
      },
      {
        title: "Reading and writing one",
        text: "Open a skill to read its body, and Edit to change it, frontmatter included, so you can fix what it is called and when it fires in the place those actually live. New starts an empty one.",
        target: win("aiskills", ".ais-list"),
      },
      {
        title: "When a skill fires",
        text: "Triggers are either something the page can tell about itself, like an empty timeline, or a word to watch for in what you have written. A card says whether it is waiting, whether it fits what you are doing now, or whether the agent has already taken it.",
        target: win("aiskills", ".ais-list"),
      },
    ],
  },

  readme: {
    name: "Readme",
    start: open("readme"),
    steps: [
      {
        title: "The manual",
        text: "Every document here is longer than a tour step: what each app does, where your files live, and how the whole thing works from a keyboard. Open one to read it.",
        target: win("readme", ".filegrid"),
      },
    ],
  },

  skills: {
    name: "Skills",
    start: open("skills"),
    steps: [
      {
        title: "Craft notes",
        text: "How to cut, how to pace, what a look is for. These are for you to read rather than for the agent to load.",
        target: win("skills", ".filegrid"),
      },
      {
        title: "AI Skills lives in here",
        text: "The folder inside this one holds the instructions offered to an agent. That is the other half: notes for you, files for it.",
        target: win("skills", '[data-open="aiskills"]'),
      },
    ],
  },
};

/**
 * The whole machine, in order.
 *
 * It opens the Editor part way through rather than describing it from outside,
 * because the point of a tour is that the thing being explained is on screen.
 * Camera is pointed at rather than opened: starting it asks for the webcam,
 * and a tutorial that trips a permission prompt is a tutorial people quit.
 */
const SYSTEM = [
  {
    title: "This is a computer",
    text: "A desktop in a browser tab: icons, windows you can drag and stack, and a dock. Everything you make stays on your machine, because there is no server to send it to. Arrow keys move through this tour, Escape leaves it.",
    target: null,
  },
  {
    title: "The menubar",
    text: "The strip along the top belongs to the whole machine rather than to any window: what is running, search, the theme, the clock.",
    target: ".menubar",
  },
  {
    title: "An agent is reading this page",
    text: "This is the WebMCP status. The page offers a set of tools to an agent running in the browser, and this says whether one is there and how many tools it has taken.",
    target: "#webmcp-status",
    spot: 4,
  },
  {
    title: "It proposes, you accept",
    text: "No tool here can accept anything. An agent can stage a cut, a graphic or a line of script, and every one of them waits for you to press a real button. The page checks the click came from a person, not from a script.",
    target: "#webmcp-status",
    spot: 4,
  },
  {
    title: "Search",
    text: "Command K, or click here. It searches your documents, skills, scripts and clips at once, and opens whatever you pick.",
    target: "#spotlight-open",
  },
  {
    title: "The desktop",
    text: "Two folders, a skills folder and two apps. Readme is the manual, Scripts is what you are going to say, Skills is craft notes plus the instructions offered to an agent.",
    target: "#icons",
  },
  {
    title: "Camera",
    text: "A live preview, a shutter, and a teleprompter that scrolls your script over the picture while you record. Clips go straight into the library.",
    target: '.icon[data-icon="camera"]',
  },
  {
    title: "Editor",
    text: "Where a recording becomes a cut. Opening it now.",
    target: '.icon[data-icon="editor"]',
    before: openEditor,
  },
  ...EDITOR_STEPS.slice(0, 3),
  EDITOR_STEPS[4],
  EDITOR_STEPS[6],
  EDITOR_STEPS[9],
  {
    title: "The dock",
    text: "Every open window, including the ones you have minimised. Click one to bring it back.",
    target: "#dock",
  },
  {
    title: "Every window has one of these",
    text: "The question mark in a window's title bar runs the tour for that window, in more detail than this one had room for. Readme has the long version of all of it.",
    target: win("editor", ".win-help"),
    spot: 4,
  },
];

/** Run a window's tour, or the whole machine's. */
export async function startHelp(id = "system") {
  if (id === "system") return void startTour(SYSTEM, { name: "Deskmate" });
  const tour = TOURS[id];
  if (!tour) return void startTour(SYSTEM, { name: "Deskmate" });
  await tour.start?.();
  startTour(tour.steps, { name: tour.name });
}

/** Which windows have a tour of their own, for the title bar button. */
export const hasTour = (id) => id === "system" || Boolean(TOURS[id]);
