# The Fish Model is chosen in Settings

The agreed product scope for [issue 229](https://github.com/xujialiu/OpenReader/issues/229),
following the final choices in
[Zotero-OpenReader's request](https://github.com/xujialiu/Zotero-OpenReader/issues/182).
The owner has confirmed the complete scope and authorized implementation.

## What was decided

Fish Audio gains a Model choice in Settings. One choice applies to every Fish
Audio Voice on this device. It starts with the free Model, including for an
owner who already uses the app; their existing saved audio remains usable with
that Model. No settings are shared with another device by this feature.

The choice is a list, not a name to type: the Models OpenReader knows, followed
by any other speech Models Fish's own list offers. Entries say free or paid,
not a price. A saved choice that neither list contains stays selected and is
shown by its name alone, without a claim about its price. The help leaves the
free Model's availability and terms to Fish Audio, and says that it retains
submitted text and offers no speed guarantee. No fixed end date is shown:
Fish has extended the offer repeatedly, so a date in the app would go stale.
There is no date-based restriction or extra availability check, and no added
check that refuses a Model because it has retired or its free offer has ended.

Model and Voice are different choices. The Model is changed only in Settings,
not in the Player or the Download drawer. Fish Speech on the owner's own server
is unchanged.

## A Download belongs to its Model, then its Voice

Audio made with one Fish Audio Model is not the audio of another, even when
the Voice and the words are the same. Neither audio prepared for Reading nor
saved Offline Narration from the old Model stands in for the selected Model.
A chapter counts as Downloaded only for the Model and Voice being shown; the
Contents check follows the same meaning.

Changing the Fish Audio Model pauses every unfinished Fish Audio Download,
across all Documents and Voices. Other Providers' Downloads are unaffected.
Saved audio stays on the device. Returning to a Model makes its matching saved
audio usable again without generating it again, but its unfinished Downloads
stay paused until the owner continues them.

The existing per-Document Download drawer shows only the selected Model's Fish
Audio downloads. Its other-Voice choices cannot expose another Fish Model or
change the Model setting. To inspect, continue or delete chapters belonging to
another Fish Model, the owner first chooses it in Settings. Other Providers'
existing download choices are unchanged.

Both Download and Manage downloads identify the current Fish Model and Voice
on two separate rows. The first is labelled Model and names both the Provider
and Model; the second is labelled Voice and names the Voice. Fish Audio Voice
names can be long, so the Model does not share their row. A Voice name alone
cannot tell the owner which Model's progress and saved audio they are looking
at after a switch. These rows are read-only information, not controls for
changing the Model; other Providers' existing display is unchanged.

This does not add a Model menu, a Model browser or a second Downloads page. In
particular, Model then Voice describes which audio belongs together, not a new
hierarchy to navigate inside the drawer.

## Deleting audio has three scopes

Delete selected removes the chosen chapters of the Model and Voice being
managed. It does not remove another Model's audio.

Delete all current voice audio removes everything saved for this Document in
the Voice being managed and, for Fish Audio, its Model, and ends that Voice's
Download of it (#306). It reaches audio no chapter can be selected for, such as
audio saved before a bracket setting changed, so it frees exactly the space the
page says that Voice holds. The same Voice in another Model, and every other
Voice, keep their audio and their Downloads. Its confirmation names the Voice,
its Provider and, for Fish Audio, its Model, with the space the deletion frees.

Delete all audio is the broadest: it deletes all Offline Narration for this
Document, across every Provider, Model and Voice, including Models hidden by
the current choice. Its confirmation explicitly names that scope and the space
the deletion frees.

The two whole deletions share one row of Manage downloads: Delete all audio at
its left, Delete all current voice audio at its right end, shown only while that
Voice has audio. Both keep the Document and its Reading Position. Neither pauses
a Reading playing in the Voice it deletes; its next sentences are asked of the
Provider again.

There is no new Folder audio-cleanup action and no new place to manage Downloads
across Documents.

## What was turned down, and why

- **A free-or-paid switch.** It cannot distinguish several paid Models. A list
  lets the owner choose the Model they mean.
- **Typing any Model name.** A misspelt name can result in an unintended paid
  Model being used. Choosing from the list avoids introducing that typing risk.
- **Quoted prices.** They can become misleading as Fish changes its prices or
  offers. Free or paid communicates the distinction without pretending to be
  an up-to-date price list.
- **Reusing the old Model's audio after a change.** The owner would hear the old
  sound while believing they were comparing a new Model, or hear a mixture in
  one chapter.
- **Deleting old audio on a change.** Returning to the old Model would require
  generating the same audio again, potentially paying again for what the owner
  already had.
- **Continuing old Downloads after the change, or switching them midway.** The
  former keeps generating audio for a Model the owner has just left; the latter
  can change the cost and mix Models within one Download. Pausing keeps both
  decisions with the owner.
- **Showing every Model's downloads together.** It adds another place to choose
  between Models. The owner instead chose one setting and a drawer that answers
  to it, accepting the trip back to Settings to manage another Model.
- **Making Delete all audio mean only the selected Model.** It would leave
  hidden audio behind after an action that promises to delete it all. Delete
  selected and Delete all current voice audio provide the narrower operations.
- **Clearing one Voice by selecting all its chapters.** Audio saved before a
  bracket setting changed belongs to no chapter the page lists, so it would
  still count as that Voice's space with nothing left to select, and the only
  way to free it would be deleting every other Voice's audio too.

## What it costs

Keeping audio from several Models occupies more space. The owner cannot compare
or manage those saved versions side by side in the Download drawer, and must
visit Settings to move between them. A Model change stops Fish Downloads in
other Documents too, so returning later requires a deliberate continue.

Those costs buy one predictable rule: Settings chooses the Fish Model; Reading
and the Download drawer use that choice without another control changing it.
