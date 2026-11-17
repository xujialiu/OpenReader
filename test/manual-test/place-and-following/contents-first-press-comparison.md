# Contents first-press comparison legs (#307 contract; startup-batch follow-up)

What a first Contents-row press does depends on the Reading's state, and the
two modes land differently **by contract** (`use-reading.ts`'s `goToSection`):

- **No Reading Position** (fresh document, `resume === null`, nothing pointed
  yet): the row **takes the Reading** — the page displays the section with
  `(goToSection)` and `followRow` seeks to the chapter's first utterance, whose
  line is placed at the **Line Position** (`following.linePosition`, default
  50 % of the visible page). The heading does **not** land at the reserved bar
  band in this mode; that is the placement step, not a layout fault.
- **Existing Reading Position** (the reading is on a sentence: a stored place
  resumed, or a tapped sentence): the row only **browses** — `(browse)`, the
  page moves and nothing else, and the chapter lands at the **reserved band**
  (54 pt on the phone), the #307 landing signature.

`contents-first-press-leg.sh` runs one cold, repeatable leg of either kind and
records everything as data:

```sh
bash test/manual-test/place-and-following/contents-first-press-leg.sh \
  UDID OUT_DIR DOC_ID ROW_PREFIX [--stage-position]
```

- Fresh `shut`/`open` of DOC_ID, then: shelf + raw settings before, `say`
  before, the Locations probe at t0/t0+12 (the page's actual
  `initialLocations` binding and index length — the #255 input), the held
  views (the target view must be absent before the press), the Contents sheet
  opened with a real touch (state-matched mid-band pick of ROW_PREFIX, two
  agreeing tree reads), the press (one retry only for a lost synthetic touch —
  a second press never stands in for a failed first trial), the press line's
  mode, two settled geometry samples ≥3 s apart, `say`/shelf after, and
  Locations samples after.
- `--stage-position` stages a Reading Position the documented way first
  (`savePositionWhilePaused` patch, a real tapped sentence, the stored place
  verified on the shelf) and restores the setting afterwards, leaving the
  stored place in place as a recorded mutation.
- Wrap each leg in the shared guard. Baseline/reference legs read answers from
  the device's Debug Log, so they work against any Metro the app is connected
  to; record which Metro/JS the app ran (the launch line's version) beside the
  results.

Baseline (1.0.5 (33)-beta2 JS, Metro 8093) and current (1.0.5 (33)-beta3 JS, Metro 8092) results on
`Cultivation Online 2001-2044` (`sha256:46ca2bb1…`, 48 spine items), row `Chapter 2001` —
2026-11-17, `tester/phase-B1-baseline-trial1`, `phase-B2-baseline-trial2`,
`phase-B3-browsing-control`, `phase-C1-current-trial1`, `phase-C2-current-trial2`,
`phase-C3-browsing-control`:

| leg | JS | place at open | mode | view 3 absent | section 3 top (×2 settled) | heading top | reading after | shelf after | Locations input/index |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | beta2 | null | goToSection | yes ([1,2]) | 321 / 321 | 351 | utterance 59, section 3 (took) | null | undefined / 185 |
| B2 | beta2 | null | goToSection | yes ([1,2]) | 320 / 320 | 350 | utterance 59, section 3 (took) | null | undefined / 185 |
| B3 | beta2 | staged (utt 0) | browse | yes | 54 / 54 | 84 | utterance 0, section 1 (kept) | place kept | undefined / 185 |
| C1 | beta3 | null | goToSection | yes ([1,2]) | 320 / 320 | 350 | utterance 59, section 3 (took) | null | `[]` / 0 |
| C2 | beta3 | null | goToSection | yes ([1,2]) | 320 / 320 | 350 | utterance 59, section 3 (took) | null | `[]` / 0 |
| C3 | beta3 | staged (utt 0) | browse | yes | 54 / 54 | 84 | utterance 0, section 1 (kept) | place kept | `[]` / 0 |

Observed equivalence: mode, the Reading being taken or kept, the placed geometry (within the
baseline legs' own 1 px trial-to-trial variation, scrollTop 2344 vs 2345), and the staged
Browsing landing are identical between the two JS versions. The only measured difference is
the initialized Locations input/index — undefined plus a generated 185-entry index on the
pre-#255 baseline, the stable empty array plus length 0 on current — the #255 change itself,
with no effect on the press contract. A correction to an earlier interim interpretation: the
first-press 321-class landing was tentatively recorded as the #307 first-render landing race;
these legs supersede that reading — the landing is the deterministic taking-mode Line Position
placement (identical on both JS versions and stable across samples), not a layout race, and
the unconditional-54 oracle is invalid for the no-position first-press precondition.
