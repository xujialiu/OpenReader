# A coherent reading interface

## What has been agreed

The owner finds the current interface rough, crowded and inconsistent. The
redesign must address all three: the finish of individual controls, which
information draws attention, and how the screens belong together.

The scope includes rearranging controls, simplifying information and changing
the steps needed to reach things. Restricting the work to colours, type and
spacing was rejected because it would leave the current crowding and hierarchy
untouched. This gives up some familiarity: controls the owner already knows may
move, and some information may take another tap to reach. The particular moves
have not yet been chosen.

ElevenReader and Speechify are the owner's visual references. The chosen
direction is a quiet reading page with clear priorities among its controls.
Neither reference is a decision to copy its features.

## Keep the reading layout; finish its controls

The owner finds the overall reading layout acceptable. Keep that arrangement
rather than introducing separate reading and listening layouts. The immediate
problem is the controls and the information competing around them.

Use a coherent set of icons, taking the owner's Zotero-TTS controls as the
reference. Settings and adding a document become icon buttons. Contents becomes
a bulleted-list icon: three dots beside three horizontal lines. These give up
visible labels in exchange for less clutter; their spoken labels must still
identify the actions for someone using a screen reader.

Remove the two routine lines above the voice: the playback state with its
sentence count, and the message confirming that the previous place was resumed.
The owner does not need that confirmation occupying the reading page. This
revises the earlier decision to keep a running status line in the player.
Failures and missing setup appear only when they need the owner's attention,
with a short explanation; they do not reserve space during normal reading.

The reading header keeps the document title, uses a back arrow without the
Library label, and replaces the Appearance label with an icon of a large and a
small letter side by side. An earlier revision set those two letters in type
instead, which left the row narrower than the letters needed and broke them onto
two lines, so the one row in the drawer that was not drawn ended up the only one
that looked wrong. Drawing it keeps the letters on one line at every size and
matches the rest of the set.

## A voice is shown by its name

The owner demonstrated a selected voice whose name is visible in the voice list
while the player shows its internal identifier. This is a display defect to
correct, not a reason to treat the name as unknown. A known voice name must be
shown in the player. Voice rows also lose the identifier underneath their names.
This gives up at-a-glance access to an internal identifier in exchange for a
list of recognisable names.

## Documents have covers and titles

The library will show covers with titles, replacing the plain text presentation.
This gives up some compactness to make documents easier to recognise visually.
The reference settles the arrangement: a small cover on the left, the title and
a quieter secondary line on the right, with generous space between rows. A
document without a cover has a consistent document placeholder. The last-read
quotation remains the secondary line; copying the reference does not introduce
a percentage, folders, recommendations or new navigation destinations.

The owner approved implementation after the interview.

## Speed adjustment opens when needed

_Revised in [decision 0041](0041-one-look-for-settings-and-the-speed-control.md):
the speed now opens in a small bubble at the number, not in a drawer._

The player keeps the current speed visible as a tappable number. Tapping it
opens a bottom drawer with minus and plus controls for adjusting the speed.
The minus and plus controls leave the main player: keeping them always visible
would preserve one-tap adjustment but continue to crowd the reading page.
This choice costs an extra tap when the owner wants to change speed.

Contents moves to the left end of the playback row and the current speed to its
right end, removing the separate bottom row so the player covers less text.
Adjustments apply immediately. Each tap changes speed by 0.05, between 0.50 and
4.00 times natural pace; holding a button continues adjusting. Tapping outside
the drawer closes it without undoing the chosen speed. The dismissal controls
were subsequently revised below; closing never adds a confirmation step.

The owner approved this arrangement and interaction after the interview.


## Provider settings separate availability from voice selection

The owner finds provider settings too wordy and their organisation confusing.
Keep a list of names with enabled-status marks, with each provider's configuration
and enable switch on its own detail page. Putting every form on one page was rejected because the
phone would make the owner scroll through unrelated settings. Detail pages keep
fields, a connection test and actionable errors. The later review below removes
help controls that supplied no useful information.

Enabling first tests the connection and succeeds only when that test succeeds.
Testing alone does not enable. Several providers can be enabled together, and
only enabled providers appear among the player's choices. Configuration alone
must not make a provider available there. This costs a successful connection at
enablement in exchange for a list the owner has deliberately made available.
Enabling does not change who reads the current document.

Use each provider's recognisable name rather than a generic description of
server ownership. Configuration pages no longer choose voices: the player is
where the owner chooses a document's voice.

An enabled provider's configuration is locked. Disable it before editing;
there is no Save button. Editing an enabled connection and testing a replacement
before applying it was rejected in favour of this explicit boundary. Disabling
retains configuration. If the provider is reading a document, disabling stops
playback immediately and preserves that document's remembered voice. The next
attempt to play asks the owner to choose an enabled provider rather than silently
substituting a narrator.

There is no separate default-voice setting. A new document takes the most recently
selected voice whose provider is still enabled, or asks for a choice when none
is available. Existing documents keep their own voices. This revises the explicit
default for new documents in decision 0010; its per-document memory remains.

Existing installations retain their configuration, but start with every provider
disabled when this change arrives. The owner enables each with a successful test.
This costs a one-time setup action in exchange for never guessing availability
from a saved credential or prefilled address.

Edits are retained automatically even while the provider is disabled, including
credentials, so leaving the page does not discard setup work. Enable tests and
enables; it is not a save action. A failed test preserves the owner's input.

The owner confirmed the complete proposal and authorised implementation.

Fish Audio offers three independent voice sources: Official voices, Your voices
and Manual voices. Only Official voices starts selected. Manual voices reveals
a field for the voices the owner supplies. These follow the same editing lock as
the rest of the provider configuration.

Default belongs to Your voices and disappears from the picker when that source
is off. Keeping it visible regardless of the choice was rejected because the
source controls should describe what the owner will find in the picker. Hiding
it does not replace a voice already selected for a document.

A voice explicitly described as English with one regional accent appears under
that region even if it can also speak other languages. This makes an Indian
English narrator findable beside other Indian English voices. Keeping every
such narrator under multilingual was rejected because it hides the distinction
its published name makes. A regional label alone, or conflicting regional
labels, is insufficient to choose an English accent.



## One enable switch per provider

After inspecting the implemented screens, the owner rejected having the same
enable switch in both the list and the detail page. Keep the switch in the
detail page only. The list shows the provider's name and a check mark when it is
enabled; it cannot change availability and shows no errors. This costs opening
a provider to enable or disable it, in exchange for keeping the action beside
the configuration it controls. Keeping the switch only in the list was considered
and then rejected during the review.

Remove the general help button in the detail header and the help button beside
the credential field: the owner found neither useful. Remove the separate
Remove action. Saved credentials behave like password fields: their contents
are masked, and while disabled the owner can replace or manually clear them.
Clearing removes the saved credential. Edits continue to save automatically.

Voice sources use the same style of switches as provider enablement rather
than checkboxes. Only Official voices is initially on. All configuration fields
and source switches are read-only while enabled; the enable switch itself must
remain usable to disable the provider. Show only the short instruction
"Disable to edit." while locked. Centre switches vertically beside their labels.
The owner confirmed this revised arrangement. It is implemented, with existing
settings and credentials retained across ordinary app updates.


## Keep the editing instruction beside enablement

Place “Disable to edit.” directly below the enabled label, in the same group
as its switch. Separating it from the switch made it look like an instruction
for the credential field alone.

The credential field has an eye button: hidden initially, visible after a tap,
and hidden again after another tap or leaving the page. Viewing remains available
while enabled; requiring disabling just to check a saved credential would
interrupt its availability unnecessarily. Editing still requires disabling.
The owner confirmed this interaction.

## Drawers dismiss by dragging their handles

_Speed is no longer a drawer; it opens in a bubble
([decision 0041](0041-one-look-for-settings-and-the-speed-control.md))._

_Revised in [decision 0066](0066-every-drawer-rises-to-the-drawer-height.md):
every drawer is now the phone's own, and a swipe down anywhere on it closes it.
A tap outside no longer closes a drawer: at the Drawer Height it reaches the
page behind._

Voice, Speed, Contents and Appearance close when the owner drags down from the
handle or the surrounding title area. A visible handle that does nothing was
rejected because it promises an action the owner cannot perform. Tapping outside
continues to close each drawer. Voice and Speed lose their Done buttons: these
buttons took up space without confirming a separate change. This gives up a
labelled close button in those two drawers in exchange for more room for their
controls and choices. The owner confirmed this scope.

## Voice selection stays open while the new voice prepares

Choosing a voice leaves the drawer open. While reading, the current voice keeps
speaking as the chosen voice prepares; when ready, the new voice takes over at
the next word. The chosen row shows a loading spinner until the actual handover,
then a check mark. Closing on selection was rejected because the owner wants to
keep choosing and see when the change actually takes effect. If either voice
cannot locate a safe shared word boundary, the handover waits for the next
sentence. Guessing a position was rejected because it can omit or repeat words.
The old voice keeps its check mark until handover. Only the most recent choice
can take over; choosing the current voice cancels a pending change. Failure
stops the spinner and shows an error while the old voice continues.

Choosing while paused immediately selects the voice without starting playback;
audio is prepared on the next Play. Pausing during a pending change never lets
its eventual arrival resume playback by itself.

When the owner opens a document and presses Play, the playback button shows a
loading spinner while waiting for audio. The spinner has the same appearance as
the one in the voice list. It also appears if playback later runs out of ready
audio. While the old voice is still speaking, the player keeps its Pause button;
only the chosen voice row spins. Tapping the player's spinner pauses playback
and restores the Play button, while audio continues arriving in the background.
The owner must press Play again to hear it. Aborting the request was rejected
because the owner wants the waiting time to remain useful after pausing.

The owner confirmed these behaviours and authorised implementation.
