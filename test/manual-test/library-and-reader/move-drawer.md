# The move drawer in the header (#151, `1.0.0 (8)-beta1`)

Verified on a dedicated simulator, `move-151` (iPhone 16 Pro, iOS 27.0,
created for this run), with the Debug app of `xujialiu/move_items` at `fb131ae`
connected to its own Metro (port 8097, `EXPO_UNSTABLE_MCP_SERVER=1`). The app
was built with the guide's `xcodebuild` and launched with
`-RCT_jsLocation localhost:8097`; Settings read
`Version 1.0.0 (8)-beta1-debug`. Nothing played; the simulator was silenced
(`kit/silence.sh set`) after its boot and again after the relaunches, because a
relaunch can put the volume back to 60 (pitfalls/simulators.md, #146).

Touches were `kit/ax.py` pairs (`touch LABEL`, `alert-touch OK`) and
`axe drag` from the sheet grabber to close a drawer — an `axe swipe` did not
move the sheet (pitfalls/mcp.md, #117). Native name alerts were filled with
`kit/alert-input.py` and read back before submitting. States were read from
`ax.py tree`; colours from screenshots with
`python3 test/manual-test/library-and-reader/move-colour.py SHOT X Y W H`
(points; 1 pt = 3 px).

## The library it was exercised in

Folders `Alpha` (containing `Alpha One`) and `Bay` (containing a `Same`) and a
root `Same` were made through the UI (Library actions → Create folder), so the
move drawer could be tried against a same-named folder. Documents came from
the fixtures: `short-test-fixture.ts` and `pause-gap-fixture.ts`, copied to
`Documents/Inbox` and added with the harness (`{"do":"add","file":…}`), then
moved into the folders by the drawer itself. Theme and Highlight preset were
patched with the harness (`{"do":"settings","patch":{…}}`; the Amber word is
`#d99324`, the Blue word `#727efa`).

## What was measured

- **Move sits in the header's right end at every level.** From a Document's
  actions (`…` → Move to…), a Folder's actions, and a selection's bottom
  `Move selected` capsule: the capsule's frame stayed `306,452 73x42` at the
  Library root, in `Alpha`, and in the nested `Alpha One`; there is no
  `Move here` row and no `‹ parent` row in the list
  (`04-`…`06-move-doc-*.png`, `08-`…`11-move-folder-*.png`,
  `17-move-selection-root.png`).
- **Where it is grey, where it is filled.** At the entries' own folder, inside
  a Folder being moved, and inside that Folder's descendant it reads
  `enabled=False` (read off `axe describe-ui`: `{'AXLabel': 'Move',
  'enabled': False}`), and a real touch does nothing — the drawer stayed at
  `Library → Alpha → Alpha One` and no move happened. Elsewhere it acts.
  Pixel samples, all matching `accent.ts`'s arithmetic (fill =
  `accentOn(word, scheme, ACCENT_SURFACES)`, word = `INK.page`; disabled =
  `colours.button` with `INK.text`, unfaded):

  | Preset | Theme | Disabled fill / word | Enabled fill / word |
  | --- | --- | --- | --- |
  | Blue | light | `#ffffff` / `#16161a` | `#5d66cb` / `#ffffff` |
  | Blue | dark | `#2c2c32` / `#e6e6ea` | `#727efa` / `#111114` |
  | Amber | light | `#ffffff` / `#16161a` | `#976619` / `#ffffff` |
  | Amber | dark | `#2c2c32` / `#e6e6ea` | `#d99324` / `#111114` |

  (`04-`, `05-`, `22-`–`26-move-*.png`.)
- **Back.** Inside a folder the round button reads `Back to <parent>`
  (`Back to Library`, `Back to Alpha`, `Back to Alpha One`, read from the
  accessibility tree) and goes up one level. At the Library root, in the
  Document and Folder flows, its label is the drawer's plain
  `Back from Move to…` and touching it returns to that entry's actions menu
  (checked for both). A selection's move has no back button at the root
  (`17-move-selection-root.png`).
- **Title and path.** The title stays `Move to…`, centred; the path line under
  it followed every shown folder (`Library`, `Library → Alpha`,
  `Library → Alpha → Alpha One`, `Library → Bay`,
  `Library → Alpha → Alpha One → Same`).
- **The list holds only Folders**, a Folder being moved included and
  enterable, with `Move` grey inside it (`08-move-folder-alpha-root-light.png`,
  `09-`, `18-move-selection-inside-same.png`). Documents stayed out.
- **Each opening starts at the entries' own folder**: after browsing into
  another folder and backing out to the menu (Document and Folder flows), and
  after closing the selection's move with a drag and pressing `Move selected`
  again, the drawer reopened at the source (`Library → Alpha → Alpha One`),
  not where browsing had left it.
- **A refusal is the phone's alert.** Moving the root `Same` into `Bay`, which
  already holds a `Same`, in the single-Folder flow raised `Could not move` —
  message `A folder with this name already exists here. Rename it first.`, one
  OK — drawn over the sheet (`12-could-not-move-alert.png`). After OK the
  drawer stayed at `Library → Bay` (`13-after-alert-still-bay.png`). The
  selection flow refused the same way: the `Same` of `Alpha One` selected
  alone and moved into `Bay` raised `Could not move` with `“Same”: A folder
  with this name already exists here. Rename it first.` — the selection path
  prefixes the name, the single-Folder path does not
  (`36-selection-could-not-move.png`); after OK the drawer stayed at
  `Library → Alpha → Bay` (`37-selection-still-bay.png`).
- **A move works in all three flows.** `A Short Test of Reading Aloud` into
  the nested `Alpha One` (Document flow), `Bay` into `Alpha` (Folder flow),
  and a selection of `Same` + `Pause Gap Fixture` into `Alpha One` (selection
  flow): each closed the drawer, landed the entries where the path said
  (read back from the Library's tree), and ended selection mode
  (`07-`, `19-after-selection-move.png`).
- **A disabled drawer row is drawn at 30 % in every drawer.** The
  `short-test-fixture` rows stopped being unreachable when #125 fixed the
  rooted nav match, so `unreachable-contents-fixture.py` rewrites a copy of it
  with nav hrefs that match nothing. In that book the Contents sheet shows its
  note (`None of these rows could be matched…`) and the rows' words sample
  `#b1b1b4` — exactly 0.3 × `#16161a` + 0.7 × `#f4f4f6`
  (`28-contents-unreachable-fixture.png`); a touch on a row did nothing. The
  Library actions drawer's rows disabled by a `problem` were **not covered**:
  with `library-folders.json` corrupted the Library shows the problem text,
  but the header's Library actions button is itself disabled then
  (`disabled={… || !!problem}`), so the drawer cannot be opened to look at its
  rows; the corrupted file was restored from a copy.
- **Files, for comparison (light).** On the same simulator, with folders
  staged the way `../downloads/two-finger.sh stage` does (plus an `Other`
  folder and a loose `Top.txt`), Files' own Move sheet: the disabled `Move`
  capsule in the source folder samples fill `#d6d6d6` with `#ffffff` text; in
  another folder fill `#0087fd` with `#efffff` (white) text; a greyed file
  label samples `#c5c5c7` on `#ffffff` — the tertiary label at 30 %, the same
  mechanism as the app's disabled rows
  (`33-files-move-source.png`, `34-files-move-in-other.png`). The dark values
  are in notes/NOTES_2026-10-10.md (13:42). The app's disabled capsule is not
  Files' grey pill: it keeps the drawer's plain capsule (`#ffffff` fill,
  hairline rim, unfaded text) in light, and fills with the owner's App Colour
  where it can act instead of iOS blue.
- **Large type.** At the simulator's extra-extra-extra-large content size the
  header still holds: the centred title stays clear of the back button and the
  capsule (`35-move-header-xxl.png`; capsule frame grew to 86 pt wide).

## Finding for the implementing agent (not fixed here)

The Library's page behind a half-screen drawer stays interactive by design
(`presentationBackgroundInteraction`). A touch meant for the drawer that
instead lands on a Library row's `…` behind it switches the open actions
drawer to that other entry while it keeps its page and its browsed folder:
with `Same`'s move drawer open at `Library → Bay`, a touch on
`Actions for folder Bay` left the same drawer showing `Bay`'s move at
`Library → Bay` (`14-stale-subject-bay.png`); `Move` stayed correctly grey
(inside the moved subtree) and did nothing. The same reproduction with a
Document's drawer left it at `Library → Alpha → Alpha One → Same` with
`Move` enabled for the other document (`20-`, `21-doc-stale-subject.png`) —
pressing it would have moved the other document. Nothing was pressed and no
data changed in either probe; the header nowhere names the subject, so the
switch is invisible. A drawer should stop being live behind a sheet, or the
subject switch should restart the move page.

## What this cannot prove

- The `busy` disabling (a folder deletion's write) was never on screen long
  enough to photograph; it is the same `disabled` argument as `problem`.
- A destination deleted by another device while the drawer holds it (the
  fallback to the root) needs a second client; with one simulator the only
  deletions go through drawers that close. The fallback is the
  `shown !== null && !tree.folders.some(…)` line in `useMovePage`.
- VoiceOver was read through the accessibility labels, not with the rotor
  running.
