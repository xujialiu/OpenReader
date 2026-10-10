# Documents have one place in nested folders

## What is settled

The Library's add button opens a Drawer offering `Create folder` and `Import file`. Import file starts the existing import flow.

_Extended by [decision 0071](0071-select-several-library-entries.md): the add button becomes `…`, retains these actions and adds selection for moving or deleting several entries. The single-entry behavior below applies outside selection mode._

A Folder is a place, not a label. Each Document belongs to one Folder or sits at the Library root. Moving it into a Folder removes it from the root's immediate list; it does not copy the original file, change the Reading Position or discard Offline Narration.

Folders can contain other Folders. The owner can organize Documents as, for example, Language learning → English → Fiction, entering and returning through the hierarchy.

## Why and what it costs

A single place makes organizing Documents behave like moving files rather than attaching labels. Overlapping categories were turned down: they would allow one Document in several places, but that is not the meaning the owner chose for Folder.

Nested Folders let the owner group a large Library at more than one level. A single level would be simpler to navigate, but could not express groups within groups. The cost of nesting is navigating a path when entering Folders or choosing where to move something.

Creation and import use the current location: at the Library root they create root entries, and inside a Folder they add to that Folder.

Folder names are trimmed and must not be empty. Sibling Folders cannot share a name, including names differing only in letter case; Folders in different parents may share a name. Creation and renaming follow the same rule.

Deleting a Folder deletes its entire subtree after a warning alert and an explicit confirmation. The warning gives the counts of contained Documents and Folders. Document deletion follows the existing behavior: removal from the Library and deletion of local Offline Narration, while the original file is kept.

The row's actions button and a long press open the same Drawer. Documents gain `Move to…`; Folders offer renaming, moving and deletion. A move can target the Library root or another Folder, but never the Folder itself or any of its descendants. This first version operates on one selected entry at a time, without batch selection.

Folder organization is local to this device for now. Reading Position synchronization continues unchanged. Search is not added in this feature.

Creating a Folder leaves the owner in the current list. Returning from the reader returns to the Folder being browsed. Restarting the app restores the most recently browsed Folder; a new Document opened from another app is added to that Folder too.

A duplicate import shows an alert explaining that the Document already exists, giving its existing Library title and full Folder path from the Library root. The choices are Cancel and Open existing document. Cancel leaves the list in place; Open enters the existing Document. Neither creates another entry nor moves the existing Document. This also applies to imports from another app.

Each location lists its immediate child Folders first, sorted by name, followed by its immediate Documents in the existing most-recently-used order. Descendants appear only after entering their containing Folder. Manual ordering is not included.

Creation and renaming use the phone's text-input alert, with confirmation and cancellation. A blank name cannot be submitted. A duplicate name can be submitted, but is refused in a separate system warning explaining the conflict; Back to editing restores the entered name, and Cancel leaves everything unchanged. The owner chose this submit-time warning over moving the editor into a Drawer after live validation messages proved invisible on the tested phone interface. Moving uses a Drawer that shows the destination's full path and only its child Folders; the owner navigates up or down and confirms with `Move here`. Dismissing it does not move anything.

_Revised on 2026-10-10 (#151): `Move here` became a `Move` button in the Drawer's header, and the Folders being moved are listed. See "Move stays in the Drawer's header" below._

Moving a Folder into a location with an existing same-named Folder is refused with a request to rename it first. Folders are never merged or overwritten automatically.

When the remembered Folder no longer exists, browsing returns directly to the Library root, not to a surviving ancestor. Subsequent imports use that root location.

A Folder row shows its icon, name and actions button. Tapping it enters that Folder. The page title is the current Folder name and the top-left control returns to its parent; Settings remains accessible at the Library root. Full paths appear in the move Drawer and duplicate-import alert rather than taking up space above the main list.

When this feature first arrives, all existing Documents remain at the Library root, with their names, Reading Positions and Offline Narration unchanged. The owner organizes them explicitly. Sibling Folder names must be unique, but a Document and Folder may have the same name.

After the owner confirms deletion, any Reading or Download belonging to a contained Document is stopped before that Document is removed. Unrelated Reading and Downloads are unaffected. The warning explains this impact when applicable. Failures are reported explicitly, and content that could not be deleted is not presented as successfully removed. This version has no trash or recovery feature.

## Visual refinement after simulator review

The owner found that the shorter Folder rows interrupt the Library's visual rhythm. Folder and Document rows must have the same height. The Folder illustration also needs more detail than the initial outline; the owner's reference is Apple's Files list, with a layered blue folder and uniformly spaced folder and file rows.

The owner chose a layered blue Folder illustration close to Files: a top tab, back layer, light paper edges and a subtle gradient. It occupies the same illustration area as a Document Cover without being stretched to the Cover's shape. Small Folder action icons in Drawers remain simple.

A Folder's second line shows counts of its directly contained Documents and child Folders, excluding deeper descendants; an empty Folder says `Empty`. No date is shown.

After comparing both previews, the owner chose the more compact layout (B): Folder and Document rows share one height, Covers become smaller, and the text stays the same size. More entries fit on screen, at the cost of less prominent Covers. Keeping the larger Document rows was turned down because Folder rows would then have too much empty space. Both row kinds grow together for larger system text. Existing folder behavior remains as agreed above.

## Move stays in the Drawer's header

The owner found that `Move here` changed place. At the Library root it was the first row; inside a Folder it was the second, under the row that went up a level. In the Folder the entries were already in, it could not be pressed, but it looked exactly like a row that could.

The move Drawer now follows the phone's Files app. `Move` is a button at the right of the Drawer's header, in the same place in every Folder. Where it can move the entries, it is filled with the App Colour. Where it cannot, it is a plain grey button: the Folder the entries are already in, a Folder being moved, and anything inside one. Going up a level is the header's back button. At the Library root that button returns to the entry's actions; when a selection is being moved, there is none. The title stays `Move to…`, and the full path stays under it as the one line that says where the Drawer is. Files titles its sheet with the Folder's name instead, but the root and a Folder can both be called Library, and that title would read `Library` at both.

The list holds only the Folders in the Folder shown. A Folder being moved is listed with the others and can be entered, as Files lists it, and `Move` stays grey inside it. Documents are not listed. Nothing names what is being moved: a selection is in view behind the Drawer, and a single entry was chosen a moment before.

A refused move, such as one into a Folder that already holds a Folder of the same name, is said in the phone's own alert, with one OK. The Drawer stays where it was, so the owner can choose somewhere else. A line at the end of a long list could be out of sight of the button that was pressed.

In every Drawer, a row that cannot be pressed is now drawn as the phone draws one, in a much fainter grey. Before, it looked like any other row. The chapters in Contents that lead nowhere are drawn the same way.

Turned down:

- **A wide `Move here` fixed at the bottom of the Drawer**, the owner's first idea. It would also stay in place, but the phone puts a sheet's confirming action at the top right, and the bottom of the Drawer sits beside the home indicator, at a height the owner sets.
- **Keeping `Move here` as the first row.** It would stop moving, but it is not the phone's arrangement.
- **Hiding the Folders being moved**, as before, or listing them in grey. Files lists them like any other Folder.
- **A disabled `Move` faded to half strength**, like the header's other word buttons. Files does not fade its disabled `Move`; it shows a plain grey button.

The owner chose each of these on 2026-10-10 (#151).

## Design review

The owner accepted all individual choices above and confirmed the complete original scope for implementation on 2026-10-02 (#121). After simulator review, the owner approved fixing the missing duplicate-name explanation, repairing the tester configuration and completing the remaining verification, and requested the visual refinement described above.
