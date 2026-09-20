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
Library label, and replaces the Appearance label with Aa.

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

The player keeps the current speed visible as a tappable number. Tapping it
opens a bottom drawer with minus and plus controls for adjusting the speed.
The minus and plus controls leave the main player: keeping them always visible
would preserve one-tap adjustment but continue to crowd the reading page.
This choice costs an extra tap when the owner wants to change speed.

Contents moves to the left end of the playback row and the current speed to its
right end, removing the separate bottom row so the player covers less text.
Adjustments apply immediately. Each tap changes speed by 0.05, between 0.50 and
4.00 times natural pace; holding a button continues adjusting. Tapping outside
the drawer or Done closes it without undoing the chosen speed. This follows the
other drawers rather than introducing a separate confirmation step.

The owner approved this arrangement and interaction after the interview.
