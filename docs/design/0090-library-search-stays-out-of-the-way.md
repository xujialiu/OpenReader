# Library Search stays out of the way

## What is settled

Issue #332. Library Search finds Documents already in the Library by their
current displayed names. It does not search the text inside Documents or look
for files elsewhere on the device. A renamed Document is found by the name the
Library now shows, not a separate original file name.

Search reaches the whole Library, including Documents in every nested Folder,
regardless of where the owner starts searching. Folder names are not results.

During ordinary use, neither a search field nor a magnifying-glass button is
permanently shown. Pulling down at the top of the list reveals the search field
without opening the keyboard; tapping the field begins input. Ordinary
scrolling does not bring up the keyboard.

The Library's top-right `…` also offers Search. Choosing it goes directly to
input, without requiring a second tap on the field or a return to the top of a
long list. Remembering or performing the downward gesture is not the only way
to reach search.

Results update as the owner types. A name matches when it contains the typed
text as a continuous fragment, ignoring letter case. For example, `body`
finds `Three Body Problem`, and `三体` finds `三体纪念版`. Separate words are
not matched independently. This first version does not add pinyin matching,
conversion between simplified and traditional Chinese, or spelling correction.

## Results and actions

Results replace the list on the current Library page, rather than opening a
separate page or a Drawer. Each result keeps the Document's Cover and name.
Its parent Folder path, starting at the Library root, replaces the usual
last-read excerpt underneath. The path distinguishes same-named Documents in
different Folders without adding another line of information to every row.

Results keep the Library's existing order: most recently added or read aloud
first. Opening a Document without reading aloud does not put it first. There
is no separate relevance or alphabetical ordering for search.

A result opens its Document and retains its single-Document actions: Rename,
Move, Download, Share and Delete. Search results do not offer selection or
batch actions. Finding a Document does not require navigating to its Folder
before acting on that one Document; it does not extend the existing
same-level selection rule to a cross-Folder result list.

## Returning, clearing and cancelling

Search is a temporary view, not a change to the Folder being browsed. Opening
a result opens its Document. Returning from that Document restores the query
and the result-list position without automatically reopening the keyboard.
It does not take the owner to the Document's containing Folder instead.

Cancel clears the query, hides the search field and keyboard, and returns to
the Folder and list position from before search.

An empty field shows the ordinary list of the Folder where search began,
not every Document in the Library. Clearing the field restores that ordinary
list but leaves the field available for another query. It does not cancel
search. There are no search-history or recommendation rows. A nonempty query
with no matches shows only the no-results message, `No documents found`, in
place of result rows.

## Lifetime, selection and keyboards

Locking the device or temporarily backgrounding the app preserves the search.
A fresh app launch does not restore it, and no search history is saved.
Leaving the Library for Settings or another page ends the search; opening a
Document from the results and returning is the exception described above.

Search and batch selection are mutually exclusive. While selecting, pulling
down does not reveal search; the owner must leave selection before entering
search. Search offers no selection entry. Asking to search must not silently
clear a group of selected entries.

On a hardware keyboard, Command-F enters search and Escape exits it. These
shortcuts apply to Library and Folder pages, not the reading page; this does
not add searching within a Document.

## Why and what it costs

The owner wants to find a Document without giving up list space or adding a
standing control to a page used mostly for opening and returning to Documents.
The search field appears only when wanted.

A permanently visible magnifying glass would make search easier to discover
and reach in one press. The owner chose not to add it. The alternative entry
through `…` costs an extra press, but keeps the ordinary page unchanged.

A gesture alone was also turned down: Search remains listed among the
Library's actions, including for someone using a device without touch.

Searching only the current Folder was turned down because finding a Document
should not require remembering which Folder contains it. Returning Folders as
well was left out to keep this search focused on finding a Document to open.

Opening the keyboard on a downward pull was turned down because the gesture
can happen while browsing the list. Choosing Search from the actions, in
contrast, explicitly asks to type, so it goes straight to input.

Simple fragment matching keeps the rule predictable. It costs the ability to
find a name from scattered words, a phonetic spelling or a near miss.

Keeping results on the current page makes revealing the field and finding a
Document one continuous interaction. A separate page or a Drawer was turned
down because it would add another surface and, for a Drawer, leave less room
for results.

The Folder path takes the place of the last-read excerpt during search.
Showing both was turned down because it would make result rows taller. The
owner gives up seeing the excerpt in results in return for distinguishing
where each Document belongs.

Keeping the existing order makes search a narrower view rather than a new
ranking rule. Alphabetical ordering and promoting exact-name matches were
turned down; an older exact match can therefore appear below a more recently
read partial match.

Open-only results were turned down because managing a found Document would
require finding it again in its Folder. Cross-Folder batch selection was also
turned down: search retains individual actions without changing the scope of
batch movement and deletion.

Returning to results instead of the opened Document's Folder lets the owner
try another match without entering the query again. Cancelling restores the
original browsing position rather than turning a cross-Folder search into a
change of browsing destination.

Clearing input and cancelling have different purposes: one prepares to type
another query, the other ends search. Showing the original list for empty
input avoids filling it with an unfamiliar whole-Library list or search
history. Keeping a search through a brief interruption avoids losing work;
not restoring it on a fresh launch keeps the ordinary Library uncluttered.

Requiring the owner to leave selection before searching adds a step, but
preserves the selected group until the owner explicitly ends selection.
Keyboard shortcuts cost no standing controls and provide a direct entry on
Mac and with an external keyboard, without extending search into the reader.

## Design review

The complete brief is confirmed for implementation under #332. This records
product decisions, not a claim that the interactions have been implemented or
verified on a device.
