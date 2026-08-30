# The verified chain

> Locked by `npm run corpus:chains -- --lock`.
> **Every hop below must be confirmed by hand on the Companies House website
> before this goes in the video.** Tick each one off here as you check it.

**In one sentence:** Matthew Colley-banks is a person with significant control of ENVIROPASS CONSULTING LTD; then Matthew Colley-banks is a person with significant control of ENVIROPASS LTD; then Peter Valaitis is a person with significant control of ENVIROPASS LTD; then Peter Valaitis is a person with significant control of RENEWABLE DIESEL FUELS LTD.

| # | Hop | Relation | Evidence | Verified |
|---|---|---|---|---|
| 1 | ENVIROPASS CONSULTING LTD → Matthew Colley-banks | `psc_of` | `doc:psc:11624512` [540..560] "Matthew Colley-banks" | ☐ |
| 2 | Matthew Colley-banks → ENVIROPASS LTD | `psc_of` | `doc:psc:15164603` [761..781] "Matthew Colley-banks" | ☐ |
| 3 | ENVIROPASS LTD → Peter Valaitis | `psc_of` | `doc:psc:15164603` [531..545] "Peter Valaitis" | ☐ |
| 4 | Peter Valaitis → RENEWABLE DIESEL FUELS LTD | `psc_of` | `doc:psc:15481912` [626..640] "Peter Valaitis" | ☐ |

## Canvas state at boot

- 0. **ENVIROPASS CONSULTING LTD** — on canvas (`company:11624512`)
- 1. **Matthew Colley-banks** — hidden, the agent must find it (`person:matthew-colley-banks-1984-02`)
- 2. **ENVIROPASS LTD** — hidden, the agent must find it (`company:15164603`)
- 3. **Peter Valaitis** — hidden, the agent must find it (`person:peter-valaitis-1950-11`)
- 4. **RENEWABLE DIESEL FUELS LTD** — hidden, the agent must find it (`company:15481912`)

Endpoints are seeded so the analyst can drag them together and ask.
Intermediates are deliberately absent from `public/corpus/seed.json`.

## The opening shot

The reader opens on **`doc:psc:11624512`** — the filing that
carries hop one. Rehearse this exact move:

1. Read it, then select **"Matthew Colley-banks"**
   (characters 540–560).
2. Press `1` to mark it `person`.
3. Raise a line of enquiry in your own words — *"what else does this person control?"*
4. Hand it to the agent.

No AI is on screen for any of that. It is the whole differentiator — do not rush it.
