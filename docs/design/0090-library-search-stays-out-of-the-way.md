# Library Search stays out of the way

## What is settled

Issues #332 and #339. Library Search finds Documents already in the Library by their
current displayed names. It does not search the text inside Documents or look
for files elsewhere on the device. A renamed Document is found by the name the
Library now shows, not a separate original file name.

Search reaches the whole Library, including Documents in every nested Folder,
regardless of where the owner starts searching. Folder names are not results.

During ordinary use, neither a search field nor a magnifying-glass button is
shown, and no field waits hidden above the list: pulling down at the top of
the list only bounces. Search opens from the Library's top-right `…`, or with
Command-F on a hardware keyboard. Choosing Search shows the field with the
keyboard open, without a second tap on the field or a return to the top of a
long list. The close control beside the field is available as soon as search
opens, even before any text is entered.

While search is open the field stands under the page's title, above the list,
and does not scroll away with the results. The app draws it, copying the
phone's own search field as measured from the phone: the magnifying glass,
the `Search Library` placeholder, the clear button inside the field and the
close control beside it. The field appears and goes at once, with no animation
of its own; only the keyboard rises and falls as the phone moves it.

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
Move, Download, Share, Select and Delete. Finding a Document does not require
navigating to its Folder before acting on it.

Results can be selected as a Folder's rows are: from `…` → Select, from a
result's own Select, or with a two-finger sweep. Select all takes every
current result. A selection of results offers Move and Delete, as a Folder's
selection does. Results are Documents only, so a selection of results holds
Documents only, from any Folders; it is the one selection that spans Folders.

Moving a selection of results opens the Move page at the Folder where search
began. Move acts in any Folder that does not already hold every selected
Document; those already there stay where they are. A Document of the same
name already in the destination refuses the whole move and is named, as for
any move. After the move, selection ends and search stays, with its query,
and each moved result shows its new Folder path.

## Returning, clearing and cancelling

Pressing `…` or Settings leaves the list where it is, so search can remember
where browsing was. Both are the phone's own title-bar buttons.

Search is a temporary view, not a change to the Folder being browsed. Opening
a result opens its Document. Returning from that Document restores the query
and the result-list position without automatically reopening the keyboard.
It does not take the owner to the Document's containing Folder instead.

The close control beside the field cancels search: it clears the query,
hides the search field and keyboard, and returns to the Folder and list
position from before search. It works with empty input as well. The field
does not come back until Search is chosen again; clearing text is not a
substitute for closing search.

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

Selection does not lead into search: while selecting, Search is not offered
and the owner leaves selection before searching. Asking to search must not
silently clear a group of selected entries. Selecting within search locks the
query until selection ends, so the selected Documents are always the ones in
view: the field stays where it is, greyed, still showing the query. The close
control is greyed with it, so closing search waits until selection ends. On a
hardware keyboard, Escape first ends selection and, pressed again, closes
search; Command-F does nothing while selecting.

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

A pull at the top of the list, revealing the field from blurred to clear, was
built first and removed under #339. Keeping a field hidden yet ready for a
pull made it appear when nobody asked for it, during a quick return to the
top of the list, and made the list jump while pulling near its top. Search now
costs a press of `…` and a press of Search every time, in exchange for a list
that only ever scrolls. Command-F stays, since it is a keyboard form of the
same Search and has no gesture to misread.

The phone's own search field was turned down for the field itself, against
the usual rule that the phone draws what it can (design 0042). The phone keeps
that field in the title bar, and adding it only when Search is chosen, then
taking it away on close, is the use it handles least reliably: it can fail to
appear on the Library's first page, and the list can jump as the title bar
changes around it. The app's copy costs following the phone's look by hand:
when a new system changes how search fields look, this one stays as it was
until it is measured again. A field that takes over the title bar while
searching was not offered, since it would cover Select all and Cancel while
results are selected.

Animating the field in and out was turned down. It would have to keep time
with the keyboard and with the list's return to its place, the kind of timing
that made the pull unreliable.

Searching only the current Folder was turned down because finding a Document
should not require remembering which Folder contains it. Returning Folders as
well was left out to keep this search focused on finding a Document to open.

Revealing the field without the keyboard was initially considered to avoid
interrupting browsing. It adds another tap after deliberately asking to
search, so Search goes straight to input. An immediately available close
control makes this easy to undo before typing.

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
require finding it again in its Folder. Results without selection were chosen
under #332 and given up under #339: gathering the Documents one query finds
into one Folder meant moving them one at a time. A Folder's own selection
still holds only that Folder's rows. Offering only Move for results was turned
down, so that a selection offers the same actions wherever it is made.

Opening the Move page where search began lets a search made inside a Folder
gather its results there in one step. Starting at the Library root was turned
down. Ending search after a move was turned down too, so that more of the
same results can be moved without typing the query again.

`…` and Settings were drawn by the app. Pressing one also counted as a touch on
the title bar, which the phone answers by taking the list back to its top, so
a scrolled Library jumped to its top and Close could not return to where
browsing had been. They became the phone's own buttons: `…` is a few points
smaller and Settings shows the phone's own sliders symbol. Turning off the
phone's return to the top for the Library list was turned down: it would also
stop a tap on the status bar from taking a long Library back to its top.

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
Locking the query while selecting costs a Cancel before trying another word.
Letting the query change was turned down: the selected Documents that left
the results would either be dropped unseen or stay selected out of sight,
and Move or Delete would then act on Documents the owner cannot see.
Hiding the field while selecting was turned down: the greyed query keeps in
view what the selected results were found by. Letting the close control end
selection and search together was turned down too: it saves a press, but
drops the selection unseen.
Keyboard shortcuts cost no standing controls and provide a direct entry on
Mac and with an external keyboard, without extending search into the reader.

## Design review

The brief was confirmed for implementation under #332, and the removal of the
pull, the app's own field and the selection of results under #339. This
records product decisions, not a claim that the interactions have been
implemented or verified on a device.
