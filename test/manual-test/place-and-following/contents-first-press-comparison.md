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

Baseline (1.0.5 (33)-beta2 JS, Metro 8093) results on
`Cultivation Online 2001-2044` (`sha256:46ca2bb1…`), row `Chapter 2001` —
2026-11-17, `tester/phase-B1-baseline-trial1`, `phase-B2-baseline-trial2`,
`phase-B3-browsing-control`:

| leg | place at open | mode | view 3 absent | section 3 top (×2 settled) | heading top | reading after | shelf after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| trial 1 | null | goToSection | yes ([1,2]) | 321 / 321 | 351 | utterance 59, section 3 (took) | null |
| trial 2 | null | goToSection | yes ([1,2]) | 320 / 320 | 350 | utterance 59, section 3 (took) | null |
| staged browsing | "Cultivation Online" (utterance 0) | browse | yes | 54 / 54 | 84 | utterance 0, section 1 (not taken) | place kept |

Baseline Locations input was `undefined` (the pre-#255 visible reader passes
none), so the template scanned: an index of 185 entries existed at every
sample. A current-leg comparison must reproduce the same table with the same
document/row/settings/viewport and its own Metro identity before any
conclusion about either leg's landing is drawn.
