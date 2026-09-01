# Data, real records, no planted links

## The rule that governs this whole file

**Nothing is invented.** Every entity and every relationship comes from UK public records. The
"hidden" links the agent finds are hidden only in the sense that they were not yet on the canvas.
They were always in the filings.

This exists because the impact criterion scores whether the solution addresses the problem *based on
what's demonstrated*. A planted fraud ring only demonstrates that the app finds links we put there,
and a judge will assume exactly that unless the data is verifiable in front of them.

**Second rule: show structure, never accusation.** "These four companies share a registered address
and a common PSC, here are the filings" is a fact about a public record. "This person is running a
fraud" is a defamatory claim about a named living individual. The product surfaces structure; the
human draws the conclusion. Keep this true in the UI copy and in the video narration.

## Sources

| Product | Contents | Format | Frequency | Cost |
|---|---|---|---|---|
| **Free Company Data Product** | All live UK companies: number, name, registered office address, status, SIC codes | CSV | Monthly | Free |
| **PSC snapshot** | Persons with Significant Control. Who ultimately controls each company, nature of control | JSON | Daily | Free |
| **REST API** (`api.company-information.service.gov.uk`) | Officers, filing history, per company | JSON | Live | Free with an API key |
| Accounts Data Product | Electronically filed accounts since 2008 | XML / iXBRL | Daily-yearly | Free |

Officers are **not** available as a free bulk download. Bulk officer data is a restricted product
you have to request. That is fine: we only need officers for the ~300 companies we select, which is
comfortably inside the API's rate limit (600 requests per 5 minutes). Register for a free API key at
the Companies House developer portal on Saturday, before you need it.

The Accounts product is large and we almost certainly don't need it. Skip unless you have spare time
on Sunday.

## Pipeline

### `scripts/fetch-companies.ts`

1. Stream the Company Data Product CSV. Do **not** load it into memory, it is millions of rows.
2. Select a seed set. The good selection strategies, in order of demo quality:
   - **Shared registered address.** Group by normalised address, keep addresses hosting an unusual
     number of companies. Mass-registration addresses are a well-documented, entirely public
     phenomenon and are the classic starting point for this kind of work.
   - **Shared PSC across nominally unrelated companies**, joined from the PSC snapshot.
   - A single SIC code in one postcode, as a fallback if the above is too noisy.
3. Expand one hop: every company sharing an address or a PSC with the seed set.
4. Cap at **~300 companies**. More is worse. A judge who can follow the chain is worth more than
   a big number, and the demo stays fast.
5. For each selected company, pull officers and filing history from the REST API. Cache to `raw/`
   so you never re-fetch; the API is rate-limited and you will re-run this.

Normalise addresses aggressively (uppercase, strip punctuation, collapse whitespace, standardise
`STREET`/`ST`). Address matching is the backbone of the whole graph and dirty strings will quietly
destroy your best links.

### `scripts/build-corpus.ts`

Emits four files into `public/corpus/`:

- **`entities.json`**, companies, people, addresses. Stable ids: `company:09876543`,
  `person:<slug>-<birth-yyyy-mm>`, `address:<normalised-hash>`. Include a `sources` array on every
  entity pointing at the documents it came from.
- **`documents.json`**, each filing rendered as **readable plain text with stable character
  offsets**. This is the piece people get wrong: the evidence drawer highlights `span.start` to
  `span.end`, so the text you index must be byte-for-byte the text you render. Generate once, never
  reformat at display time.

  **This file got more important.** A human now reads these documents end to end and drags across
  them to make their own marks (`docs/METHOD.md`). Two consequences for `build-corpus.ts`:

  1. **Render for a reader, not for a highlighter.** A filing that is a wall of field:value lines
     is fine as a citation target and miserable as something to actually read. Give each document a
     heading, short labelled sections, and blank lines between them. The first twenty seconds of
     the video are a person reading one of these, so at least the demo filings must be pleasant.
  2. **Length matters both ways.** Under ~600 characters there is nothing to read and marking feels
     pointless; over ~6000 the analyst scrolls instead of reading and the video drags. Aim for
     1-3k characters per filing and log the distribution when you build, so you can see the tail.
- **`search-index.json`**, a prebuilt MiniSearch index. Build it offline; do not index 300
  documents in the browser at boot.
- **`seed.json`**, the ~12 nodes the canvas opens with, **and the 5-8 filings the reader queue
  opens with**. Deliberately sparse and deliberately *incomplete*: the interesting entities must be
  reachable but not present.

  Pick the opening filing deliberately. It has to contain something a human would genuinely stop
  and mark (a correspondence address, a signatory, a date) whose consequences are *not* already on
  the canvas. If the first document the analyst reads has nothing worth marking in it, the whole
  demo starts flat and no amount of agent cleverness recovers it. Note the chosen filing and the
  intended first mark alongside the verified chain.

People need care. PSC records include names and month/year of birth. Use them for identity matching
because that is what they are published for, but do not render dates of birth in the UI and do not
put a person's full record on screen in the video. Names and roles are enough to show the structure.

### `scripts/find-chains.ts`

Run this Sunday. It searches the built corpus for a chain that satisfies all four:

1. **Exactly 3-4 hops.** Two is obvious, five is unfollowable in a 3-minute video.
2. **Not visible from the seed set.** At least two intermediate nodes must be absent from
   `seed.json`.
3. **Every hop independently citable**, a specific filing with a specific span.
4. **A shape a human can narrate in one sentence.** "These two companies look unrelated, but the
   director of one is the PSC of a third company registered at the same address as the second."
5. **Hop one must be findable by reading.** The chain has to start from something visible in a
   filing the analyst can open on the first screen. An address or a name they can highlight
   themselves. This criterion is new and it is the one that makes the demo work: the human finds
   the thread, the agent follows it. A chain whose first hop is only discoverable by full-text
   search is a chain that forces the agent to open the investigation, which is the story we are
   deliberately not telling.

Have it print the top ten candidates with their citations. Pick one, verify every hop by hand on the
Companies House website, and write the verified chain into a comment at the top of the file. **Do
not skip the manual verification**. The entire impact argument rests on it holding up if a judge
looks it up during judging.

## Graph schema

**Entity types:** `company`, `person`, `address`, `document`

**Relations:** `director_of`, `psc_of`, `registered_at`, `previously_named`, `shares_address_with`
(derived), `filed`

`shares_address_with` is the one derived edge and it is the one that makes the demo work. Compute it
in `build-corpus.ts` from normalised addresses, and mark it `derived: true` so the evidence drawer
can be honest about it. It cites *two* filings, not one, and the UI should say so.

## Sizes and timing

The Company Data Product is a large monthly ZIP. **Start the download on Saturday night**, it is
the only step with a wall-clock cost you cannot compress, and discovering that on Sunday afternoon
would cost you the day.

Everything downstream is fast: the selection pass is a single streaming read, the API pull for 300
companies takes a few minutes with polite rate limiting, and corpus build is seconds.
