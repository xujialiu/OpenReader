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

## Judge the captured state, not an unconditional top offset

Before comparing versions, require the same native shell, target, viewport,
Document bytes, row, settings, fresh Reading and absent target view. Record
the stored position and the actual press mode. The staged control acquires
its position **before the row press**, not necessarily before the document
opens.

For a no-position `goToSection` press, check that the Reading takes the
chapter and follows at the chosen Line Position; do not impose the Browsing
offset. For `browse`, check the chapter against the actual reserved band and
require the Reading and stored place to remain where they were. A constant
such as 54 pt describes the measured phone, not every window or platform.

Validate the saved JSONs, mode, geometry, shelf and Reading state explicitly.
The leg script collects measurements: exit 0 alone does not establish either
a correct landing or a regression. Keep failed attempts and their original
preconditions intact; a repeated press on an already-rendered view is a
different trial, not a repair of the first trial.

The Locations input/index may deliberately differ across startup versions.
Treat that difference separately from the Reading's navigation contract.
Detailed measurements, source identities and corrections belong in the
engineering log, not in this reusable recipe.
