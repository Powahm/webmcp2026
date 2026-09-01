# The method we are implementing

Threadweaver is not a new workflow. It is a forty-year-old one with an agent sitting in one of the
chairs.

This document exists because the strongest thing we can say to a judge is *we did not invent this
division of labour, policing did, in 1981, for exactly the reason we are here.* Everything in
`PLAN.md` and `TOOLS.md` follows from this file.

## 1. Where the problem was named

The Yorkshire Ripper investigation ran from 1975 to 1980 on a manual card index. By the end the
incident room held something like forty tons of paper. Peter Sutcliffe was interviewed nine times
and released nine times, because no one in the room could see that the same name kept coming back.
The information was in the room. Nobody could hold it.

Sir Lawrence Byford's 1981 report said so plainly: the incident room had become overloaded with
unprocessed information, and that overload was itself a handicap to the investigation. Two things
came out of it, **HOLMES**, the national computer system, and **MIRSAP**, the standardised set of
procedures every major incident room in the UK still runs on.

That is our problem statement, and it is better than any we could write ourselves, because it is
not hypothetical. It is the founding failure of the discipline:

> The link was in the documents. The humans could not hold enough of the documents in their heads
> at once to see it.

HOLMES solved the storage half. Forty years on it is still a database that waits to be asked. It
does not read. It does not notice. The recall problem was solved; the *attention* problem was not.

That is the gap Threadweaver goes after, and it is why an agent, not a better query language,
is the right answer in 2026.

## 2. The division of labour we are copying

A UK major incident room splits document handling across named roles. The two that matter to us:

**The Receiver** takes in everything that arrives and triages it. Reads it first, marks what needs
to be indexed, and rejects what does not belong.

**The Document Reader** reads every piece of material in detail and *annotates it*: highlighting
key information, marking links between records, and raising further lines of enquiry off the back
of what they have read. Their output is instructions. To the indexers, and to the investigation.

**The Indexers** take the Reader's marked-up documents and turn them into indexed, cross-referenced
records, checking every name, vehicle and address against everything already held.

**The Action Allocator** issues the resulting Actions to officers; results come back and are read.

**The SIO** keeps a policy log: every significant decision and the reasoning behind it, written
down at the time, so the investigation can be audited afterwards.

Read that list again with our project in mind. The Reader has judgement and cannot possibly
remember everything already in the system. The Indexer has total recall and no view on what
matters. **Nobody in a major incident room thinks one person should do both jobs.** They separated
these roles precisely because the human capacity that reads well is not the human capacity that
cross-references exhaustively, and pretending otherwise is what killed the Ripper investigation.

So:

| Major incident room | Threadweaver |
|---|---|
| Document Reader, reads, highlights, raises Actions | **The human.** The whole left-hand side of the app. |
| Indexer, cross-references the Reader's marks against everything held | **The agent**, over WebMCP. |
| Action Allocator | The human, from the Lines of Enquiry panel |
| Actions returned and read | Agent results an Action; the human marks it filed |
| SIO policy log | The Decision Log, written by both actors, exportable |

**The human does not supervise the agent. The human does the reading, and delegates the
cross-referencing.** That is a materially different product from "AI finds things, human clicks
Accept", and it is the difference the video has to land.

## 3. What this means concretely

### The human's job, in order

1. **Read.** Open a document from the working set and actually read it. This is not a formality,
   it is the job. The app has to be pleasant to read in.
2. **Mark.** Select a passage and mark it, typed: `person`, `company`, `address`, `date`,
   `question`, `lead`. A marking is a durable object with a document id, a character span, a type
   and an optional note. This is the Reader annotating the document, and it is the single richest
   piece of state in the application.
3. **Raise a line of enquiry.** From a marking: "trace this address", "who else signed this".
   The human writes the question. The human decides what is worth chasing.
4. **Delegate.** Hand the open enquiries to the agent, or just ask it directly, it can already see
   what is open, what is marked, and what is on the canvas.
5. **Verify and accept.** Check the citation against the filing. Accept, reject, or eliminate.
6. **Decide.** Every one of the above is written to the Decision Log with an actor and a timestamp.

Steps 1-3 are work the human does *before any agent exists*, and they are useful on their own. If
you delete the agent from this app you still have a document reader with a link canvas attached,
which is a real tool people would use. **That is the test.** If removing the AI leaves nothing, we
have built a chatbot with a graph skin.

### The agent's job

Everything the Indexer does and nothing the Reader does:

- Read what the human is reading and what they marked. The live document, the live selection, the
  markings, with their exact offsets.
- Cross-reference those marks against the whole corpus, which the human cannot hold.
- Come back with **structure and a citation**, staged as a proposal: a dashed node, a dashed edge,
  a highlight in the agent's own colour laid alongside the human's in the same document.
- Result an open line of enquiry, including with **nothing**.

### Elimination is a result

This is the part most AI demos miss and every real investigator will notice.

Major crime investigation runs a TIE process, Trace, Interview, Eliminate. Subjects are generated
from parameters into a pool, and the bulk of the work is *eliminating* them against stated criteria
until the pool is small. Clearing a name is not a failed search. It is the output.

So `query_paths` returning empty is a **result**, not an error, and the UI must treat it as one. An
Action can be resulted `eliminated`, with the reason recorded: *"no filing in the corpus connects
these two; searched by name, by company number, and by normalised address."* The Decision Log keeps
it. A judge who has ever done this work will notice immediately that we knew.

## 4. The biases this design is built against

Naming these in the write-up is worth real points on Impact, because it shows the design has a
theory of failure and not just a happy path.

**Automation bias**, people over-trust automated recommendations, and the effect is strongest
exactly where the stakes are high. Studies of security analysts put automation bias at the top of
the biases affecting their trust in AI tooling, and false positives from a model measurably drag
inexperienced reviewers toward the model's answer. Our defence is structural, not a disclaimer: the
agent cannot commit anything, every claim arrives with the source attached, and accepting requires
a human gesture on the proposal card.

**Confirmation bias and tunnel vision**. The reason structured analytic techniques exist at all.
Our defence: the agent is asked for structure, not conclusions, and an empty result is a first-class
outcome that gets recorded rather than retried until something turns up.

**Information overload**, the original sin, from Byford. Our defence: the canvas holds only what
the human chose to pull onto it, never the whole corpus. Forty nodes, not nine hundred.

## 5. The rule that survives all of this

**Structure, never accusation.** "These two companies share a director and a correspondence address,
and here are the two filings that say so" is a fact about a public record. Anything beyond that
about a named living person is ours to not say. It holds in the UI copy, in the tool descriptions,
in the Decision Log wording and in the video narration.

The agent's tool descriptions should say it too. A tool that says *return the structural
relationship and its source* is a tool that does not get asked for a verdict.

## Sources

- [MIRSAP, major incident room standardised administrative procedures, College of Policing](https://www.college.police.uk/app/major-investigation-and-public-protection/major-incident-room-standardised-administrative-procedures-mirsap)
- [MIRSAP v1, Nov 2021 (PDF)](https://library.college.police.uk/docs/NPCC/MIRSAP_V1_Nov_2021.pdf)
- [Reader and Receiver, Major Incident Room. Metropolitan Police role description](https://www.met.police.uk/police-forces/metropolitan-police/areas/c/careers/police-staff-roles/counter-terrorism-policing/roles/reader-and-receiver-major-incident-room-counter-terrorism-policing/overview/)
- [Document Reader, Major Incident Department. Role description](https://allpolicejobs.co.uk/jobs/document-reader---major-incident-department-staffordshire-2231379)
- [Sir Lawrence Byford report into the police handling of the Yorkshire Ripper case](https://www.gov.uk/government/publications/sir-lawrence-byford-report-into-the-police-handling-of-the-yorkshire-ripper-case)
- [Working with suspects, TIE, College of Policing APP](https://www.college.police.uk/app/investigation/working-suspects)
- [TIE Practice: Terminology, Tactics and Training (PDF)](https://e-space.mmu.ac.uk/609077/1/TIE%20Article%20FINAL%20261015.pdf)
- [Exploring automation bias in human-AI collaboration](https://dl.acm.org/doi/10.1007/s00146-025-02422-7)
- [Human Factors in AI-Driven Cybersecurity: Cognitive Biases and Trust Issues](https://dl.acm.org/doi/10.1145/3759260)
- [Test of the analysis of competing hypotheses in legal decision-making](https://onlinelibrary.wiley.com/doi/full/10.1002/acp.3738)
- [DocumentCloud, annotation and private notes in investigative reporting](https://www.documentcloud.org/about/)
- [ICIJ Datashare, what it is](https://www.icij.org/inside-icij/2019/11/what-is-datashare-frequently-asked-questions-about-our-document-analysis-software/)
