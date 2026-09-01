import { enquiries, openEnquiries } from "../state/enquiryStore";

/**
 * The analyst's open queue, carried back on every tool the agent reaches for
 * first.
 *
 * The failure this fixes: the analyst raises a line of enquiry in the page and
 * the agent never learns it exists. Nothing pushes to the agent — it sees the
 * queue only if it calls `list_enquiries`, and no natural utterance ("find the
 * link between these two", "what does this filing say") routes it there. So
 * enquiries accumulated in the panel and nothing ever worked one.
 *
 * A page cannot interrupt an agent, but it can answer a question it was not
 * asked. Every read tool now returns the queue alongside whatever it was asked
 * for, so the agent meets the agenda whichever door it comes in through.
 */
export function openEnquiryNudge(): Record<string, unknown> {
  const open = openEnquiries(enquiries().enquiries);
  if (open.length === 0) return {};

  const unclaimed = open.filter((e) => e.status === "open").length;

  return {
    open_enquiries: open.slice(0, 5).map((e) => ({
      id: e.id,
      question: e.question,
      status: e.status,
      raised_by: e.raised_by,
    })),
    open_enquiries_note:
      `The analyst has ${open.length} open line(s) of enquiry, quoted above in their own ` +
      `words${unclaimed ? `, ${unclaimed} of them unclaimed` : ""}. They set the agenda — work ` +
      "one of these before inventing your own line of investigation. Call claim_enquiry with " +
      "its id so they can see you have it, then result_enquiry to report back. Reporting " +
      "'eliminated' with what you searched is a real result and is preferred to stretching " +
      "for a weak link. An enquiry you never result stays open in front of them forever.",
  };
}
