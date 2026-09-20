# Prepare a whole document for offline listening

The owner can prepare a document's complete narration before travelling, then listen inside OpenReader without a network connection. Once the app says the download is complete, the owner can turn on airplane mode and listen from any chapter, with the text, navigation and available highlighting still accessible.

The initial scope is listening inside the reader. Exporting an audiobook to another player would serve a different need: carrying the recording elsewhere. That is left out so the first experience can focus on knowing the entire document is ready before leaving.

The action is described as downloading the whole document's audio. Preparing that audio uses the selected voice and may incur charges from the owner's speech provider; it is not merely saving an existing recording.

## Choose chapters or the whole document

Download opens a drawer listing chapter names with selection controls on the right. Select all sits at the upper right; Download selected stays at the bottom. Downloaded chapters carry a completion check. Selecting all offers the original whole-document preparation, while selecting individual chapters lets the owner prepare only what they need.

The chapter list appears from the document's existing contents before its body is prepared for speech. Opening this drawer does not start reading through the entire document. Only Download selected starts that work: prepare a selected chapter, download its audio, then move to the next. Someone choosing chapter 103 must not wait for chapters 1 through 102 to be prepared first. Preparation status stays in this view alongside the selectable list. Waiting for the whole document before showing any choices was rejected because it makes a small selection in a long book unnecessarily slow.

The drawer names the current voice, and every chapter status refers to that voice. Initially nothing is selected. Select all includes only incomplete chapters that are not already downloading, and becomes an action to clear the selection. The bottom button includes the selected chapter count and is disabled when nothing is selected.

An empty selection circle marks an available chapter; a coloured selected circle marks a chapter chosen for preparation. Downloading chapters show progress, and completed chapters show a check with Downloaded. Neither is added again. Failed or incomplete chapters remain selectable, and another attempt fills in missing audio rather than repeating completed work.

Download selected starts preparation immediately, without a second confirmation dialog. The selected voice, chapter count and a notice that generating audio may incur provider charges are visible before the button is pressed.

The chapter list preserves collapsible volume/chapter relationships; selecting a volume selects its chapters. Prefaces, afterwords and speakable content absent from the document's contents list are included, with neutral labels where titles are missing. Image-only and empty parts are excluded. Select all covers the entire speakable document, so omitted contents entries cannot create a false claim of complete offline availability.

Progress is displayed in the download view: completed chapters out of the selected total and progress within the active chapter. Before content has been counted, the view says Preparing rather than inventing a percentage or remaining time. Completing a subset says that the selected chapters are downloaded; only complete coverage for the current voice earns Whole document downloaded.

## A saved voice survives a change of narrator

Downloads retain the voice selected when preparation began. Changing the playback voice preserves the saved audio and does not automatically prepare the new voice. Playback uses the newly selected voice online when its audio has not been downloaded. Multiple downloaded voice versions may be retained and explicitly deleted by the owner.

Automatically replacing saved audio would discard preparation the owner may already have paid for, while automatically downloading a new voice would incur more charges merely for trying a narrator. Keeping the download separate from the playback choice avoids both outcomes.

When offline, if the selected voice has no saved audio for the requested text, the app offers a switch to an available downloaded voice rather than silently changing narrators.

Playback uses saved audio for the selected voice when available and otherwise plays online. If the needed audio is missing and there is no connection, playback stops at that position and reports No network connection, rather than Not downloaded. It does not skip content or silently switch voices.

Saved audio remains playable when its provider is disabled or its credentials are removed. Configuration is required only when missing audio must be generated.

## Reader actions and appearance

The reader's upper appearance button becomes an ellipsis. It opens a drawer containing three actions in order: Appearance with an Aa symbol, Rename with a pencil icon, and Download with a download icon.

Appearance uses a simple Font row with the selected font on the right and a disclosure indicator. Font Size uses a compact rounded minus/plus control on the right, following the owner's visual reference.

Rename changes only the display name in the library and reader. The original file, text, document identity, reading position and downloads are unaffected. The field starts with the current name, with Cancel and Save actions; a blank name cannot be saved.

## Preparation continues beyond the drawer

Closing the drawer, returning to the library or opening another document does not cancel preparation. Reopening the drawer shows its progress. Pause and resume retain completed work. Playback takes priority so preparing future listening does not noticeably delay what the owner is hearing now.

Documents are prepared in the order their tasks were added, one document at a time. Pausing one lets the next proceed. The drawer distinguishes downloading from queued work. Each task keeps the voice it started with even if the owner subsequently changes the playback voice.

The desired experience is continued preparation while the screen is locked or another app is open. The extent of that support still needs verification. If the system interrupts preparation, progress is retained and the owner can continue after reopening the app. The app does not promise continued preparation after a force quit, and must not describe interrupted work as actively downloading.

## Network and failures

Preparation may use any available network, including cellular. There is no Wi-Fi-only restriction or separate cellular permission switch in the download drawer.

Loss of connection displays No network connection, waiting to reconnect and resumes automatically when connectivity returns. Reopening the app resumes unfinished tasks, except those the owner explicitly paused. Credential and quota failures require the owner to resolve the problem and press Continue.

A temporary chapter failure receives a limited number of retries. If it still fails, later chapters continue and the failed chapter remains clearly marked. The result distinguishes completed and failed chapters and offers a retry of failed chapters. A credential or quota problem pauses the task because it affects all remaining chapters. Partial success never earns a whole-document completion label.

## Keep audio until the owner removes it

Downloaded audio stays until explicitly deleted, including after it has been heard. Manage downloads in the drawer groups saved audio by voice, shows actual occupied space and allows deletion of selected chapters or all audio for that voice. Deleting audio leaves the document and reading position intact.

Insufficient space pauses preparation and asks the owner to free space. Automatically deleting other downloads could undo preparation for a trip, so the app does not make that choice for the owner.

Removing a document from the library also removes its saved audio and stops its preparation tasks. When saved audio exists, the removal confirmation explicitly states that local audio will be deleted and how much space will be freed. Removing audio alone through Manage downloads continues to preserve the document and reading position.

## Agreement and remaining validation

The owner approved this interaction design on 2026-09-20. The system may stop preparation after allowing only a limited time in the background; completed work stays saved and preparation resumes when the app is opened again. A long document is not guaranteed to finish while the phone stays locked. The app must describe that interruption honestly.

## Opening a document does not audit every possible download

The owner approved maintaining saved-audio records as downloads finish and are removed. Opening a document and displaying download progress read those records, so a long document does not have to check every sentence before its reading page appears. Repeating a full check in the background was rejected because it would still do unnecessary work on every opening.

For this unreleased development change, the owner explicitly chose to discard the existing offline downloads instead of carrying them forward. Documents, reading positions and credentials remain. Those old audio downloads must be prepared again. New downloads are retained across ordinary restarts and updates, and preparation alone does not count as downloaded audio. Completion is recorded only after the audio has been safely stored, and interrupted writes or deletions are reconciled without falsely showing a completed download.
