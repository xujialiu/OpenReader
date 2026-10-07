# Select several Library entries

## What has been decided

The Library's top-right `+` becomes `…`, listing Import file, Create folder, then Select. The owner subsequently added two more entries: a two-finger drag on the list enters selection mode directly, and a Document's or Folder's own actions offer Select (#136).

Select in an entry's actions starts selection with that entry already selected. It sits directly above Delete, so the red Delete stays at the bottom. A long press still opens those same actions rather than starting selection by itself, so it keeps reaching Rename, Move and Delete. The Reader's actions for the open Document do not offer Select, because there is no list behind them.

Selection is limited to the current level of the Library. Documents and Folders can be selected together. A Folder is selected rather than opened while selecting; selecting across different levels is not supported.

In selection mode, each Document's and Folder's existing `…` is replaced by a selection control, rather than adding another column of controls.

The first version offers Move and Delete, with Select All, Deselect All, a selected count, and a way to leave selection mode. It does not add bulk Share or bulk preparation of Offline Narration.

Tapping anywhere on a row toggles its selection, including its name, cover, or selection control. It does not open the Document or Folder.

The top holds Select All or Deselect All, Cancel, and the selected count. The bottom holds Move and Delete, both disabled when nothing is selected. Select All includes every entry at the current level, including entries off screen, but does not count a Folder's contents as separately selected entries.

A fully successful operation leaves selection mode. Cancelling the destination chooser or deletion confirmation preserves the selection. Explicitly cancelling selection mode clears it.

Backgrounding the app or locking the phone preserves an unsubmitted selection. Leaving the current Library page, including opening Settings or returning to the Reader, clears it. Selection is not restored after an app restart. These rules do not cancel an operation already submitted.

Once submitted, the batch is fixed. Its selection cannot be changed or submitted again while it runs. Waiting is shown when needed; there is no midway cancellation. Only the batch's selection and submission controls are locked, not the whole app.

## Why

Moving or deleting several entries currently means repeating the same operation for each one. Selection lets the owner organize a group together without changing the ordinary Library into a permanent checklist.

## What it costs

Entries in different Folders must be handled in separate batches. Keeping selection at one level makes the selected group visible in one list and avoids selecting both a Folder and its contents separately.

## Choosing a range with two fingers

Two fingers dragged over the Library start selection directly, or extend an existing selection. Starting on an unselected row adds the range; starting on a selected row removes it. Dragging back shrinks this sweep's range and restores rows outside it to their pre-sweep state. Separate sweeps accumulate.

Holding near either visible list edge scrolls the list so the range can extend beyond the screen. The bottom edge used for this gesture stays above the floating actions. One finger continues to scroll normally. A sweep does not enter Folders or submit Move or Delete; it is limited to the current level and is unavailable while a batch runs or an action chooser or confirmation is open.

## Deleting a selection

Delete retains the meaning of the existing single-entry action. Selecting a Folder includes every contained Folder and Document, at all depths. One confirmation covers the whole batch and gives the total affected Document and Folder counts, including descendants rather than only the selected rows. It warns that deletion cannot be undone, affected Reading and Downloads stop, and Offline Narration is removed. Unrelated Reading and Downloads continue.

Documents are removed from the Library, not erased from the owner's external original files. This feature does not add erasure of the app's retained document-file copies, remote Reading Positions, or a trash facility. Deletion must not be presented as reclaiming document-file storage.

## Moving a selection

The whole batch is checked before anything moves. A same-named Folder in the destination prevents the batch from starting; the conflict is named, and the owner can choose another destination or return to adjust the selection or rename. Folders are never merged or overwritten. Same-named Documents remain allowed.

The destination is the Library root or an existing Folder. The current parent and all selected Folders and their descendants are invalid destinations. Creating a Folder inside the destination chooser is not added. Moving retains Reading Positions and Offline Narration and does not stop Reading or Downloads.

## When a batch cannot finish

An execution error stops the batch at the first failure. Completed entries are no longer selected; failed and unprocessed entries remain selected. The result distinguishes what completed, what failed, and what was not attempted, so the owner can act on the remainder.

Failure does not imply that nothing changed. A failed entry may already have lost its Offline Narration while remaining in the Library. The app must report such partial outcomes honestly rather than promise rollback. Continuing past an error was turned down because a storage failure may affect every subsequent entry and spread partial changes further.

## The bottom actions follow the navigation buttons

Move and Delete are separate frosted-glass capsule buttons, Move on the left and Delete on the right. They retain their text labels; Delete stays red. The solid full-width bottom bar is removed, so the list remains visible behind the floating buttons. Enough scrolling room remains to bring the last entry above them, and they do not overlap the Reading Button.

The glass follows the phone's light and dark appearances and its reduced-transparency setting without sacrificing legibility. Zero-selection and in-progress restrictions remain unchanged. A shared capsule and icon-only buttons were turned down: independent capsules are closer to the navigation buttons, while text keeps both actions unambiguous.

## Design review

The owner accepted the individual choices and confirmed the complete brief for implementation on 2026-10-04 (#128). This extends the single-entry scope of decision 0069 without changing the meaning of Folder membership, movement or deletion. The owner subsequently approved the floating glass actions above and authorized merging to main and pushing after verification, without an additional owner inspection gate.
