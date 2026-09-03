/**
 * What is true about this page, right now, in terms a skill can be written
 * against.
 *
 * A skill declares when it applies — `triggers: research_has_url, script_empty`
 * — and this is the other half of that contract. Every name below is part of
 * the format, so it is worth them being obvious rather than clever: someone
 * writing a skill in a text editor has to be able to guess them.
 *
 * The legacy modules are imported dynamically. shell.js resolves #desktop the
 * moment it is evaluated, and a static import here would drag the whole desktop
 * in through the tool layer before React has rendered anything.
 */

const URL_RE = /https?:\/\/\S+/i;

export async function currentSignals() {
  const [{ Scripts }, { Editor }, { Camera }, { Clips }, graphics, comp] = await Promise.all([
    import("../legacy/scripts-app.js"),
    import("../legacy/editor.js"),
    import("../legacy/camera.js"),
    import("../legacy/store.js"),
    import("../graphics/store.js"),
    import("../comp/store.js"),
  ]);

  const open = Scripts.openScriptState();
  const research = open?.research || "";
  const scriptText = (open?.lines || []).map((l) => l.text).join("\n");
  const said = (scriptText + " " + research).trim();
  const recorder = Camera.state();
  const prompter = Scripts.prompterState();
  const clips = await Clips.all();

  return {
    signals: {
      // The research notes
      research_has_url: URL_RE.test(research),
      research_nonempty: research.trim().length > 0,

      // The script
      script_open: Boolean(open),
      script_empty: Boolean(open) && said.replace(/\s/g, "").length < 40,
      script_has_lines: Boolean(open) && (open.lines || []).filter((l) => l.text.trim()).length > 1,

      // The shoot
      recording: recorder.status === "recording",
      camera_armed: recorder.status === "armed",
      prompter_running: Boolean(prompter?.running),

      // The cut
      clips_in_library: clips.length > 0,
      timeline_empty: Editor.timeline.length === 0,
      timeline_has_clips: Editor.timeline.length > 0,
      graphics_pending: graphics.pendingGraphics().length > 0,

      // The composition. A skill about how graphics should look wants to fire
      // when there are graphics, or when there is a blank clip waiting for
      // some — not when somebody is halfway through a take.
      composition_empty: comp.liveLayers().length === 0,
      composition_has_layers: comp.liveLayers().length > 0,
      making_graphics: comp.liveLayers().length > 0 || Editor.timeline.some((sg) => sg.blank),
      vertical_format: comp.composition().format === "vertical",
    },
    // Free words in a trigger are looked for in what the person has actually
    // written, so a skill can be about a subject and not only a situation.
    text: said,
  };
}
