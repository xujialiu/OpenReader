# Saving passages in a Document

Confirmed first-version design for [issue #370](https://github.com/xujialiu/OpenReader/issues/370).

The first version is for a reader who wants to keep a word or passage, then find it again after reopening the book. A Saved Highlight keeps the selected words marked on the page. Each Document has its own list of Saved Highlights, with a way back to the words in context. Writing a note about a passage is deferred.

A single excerpt can span sentences and paragraphs within a chapter, so a question at the end of one paragraph and its answer in the next can be kept together. To keep text on both sides of a chapter boundary, the reader makes a separate selection in each chapter.

## Highlighting from a lookup

By default, a long press still opens the lookup result immediately. A reader who looks up a word can mark the selected text from the same Drawer. Requiring a menu choice before every lookup would add a tap even for someone who uses the dictionary throughout a book.

The existing Long-press lookup switch controls whether lookup opens immediately. It starts on for a new reader and keeps the reader's saved choice on upgrade. With it off, a long press selects text and shows a menu beside it. The reader can drag the handles to adjust the passage, then highlight it or explicitly ask for lookup or translation. This gives occasional dictionary users access to lookup while saving a passage takes no dictionary request.

Selecting text for a highlight follows the same Pause reading during lookup preference as selecting it for a definition. With the preference on, the long press pauses ongoing speech even when immediate lookup is off. The reader presses Play to resume. With the preference off, speech continues and the page holds the selected words in view while the reader adjusts or colours them. When selection and lookup are both closed, a page that was following the voice returns to it and a reader who was browsing stays in place.

## Choosing a colour

Pressing Highlight saves the passage immediately and shows the colour choices. The first highlight is yellow. The reader can leave it as it is or choose another colour there and see the saved passage change. The next highlight uses the last colour chosen. The same action works from the lookup result Drawer and the selection menu, so keeping several passages in one colour takes a single press per selection.

The palette offers yellow, green, pink, purple and blue. Choosing a colour applies it and closes the palette. Tapping outside keeps the saved colour and dismisses the palette without sending that tap to the sentence underneath. A lookup Drawer that was open stays open with its result.

## Editing a saved passage

Long-pressing a word inside a Saved Highlight still selects that word for lookup. In the lookup Drawer, Recolour and Remove act on the whole Saved Highlight. With immediate lookup off, the selection menu offers the same edits. Keeping these actions on the long press preserves the ordinary sentence tap and the existing Tap Lock behaviour.

If the reader highlights “white cloud” and then “cloud soil”, both excerpts stay in the list with their original text and colour. On the page, “cloud” shows the colour of the more recently created highlight. Removing that highlight reveals the earlier colour. Selecting the exact same range again opens the existing highlight for editing.

A long press on “cloud” targets the visible, more recently saved “cloud soil”. The edit controls show that full excerpt so the reader can check what will change. The earlier excerpt can be reached from its visible words or directly from the list. Dragging the selection handles to a new range allows the reader to save that range separately.

## When speech reaches a saved passage

While the moving speech highlight covers saved words, the page shows the reader's chosen speech colours and keeps a thin line beneath the saved words. Even when the two colours happen to match, the line identifies the passage the reader saved. As the speech highlight moves away, the saved words regain their usual background colour.

## Finding a passage again

Highlights opens from the reader's more-actions menu. It lists coloured excerpts in their order in the Document, grouped by chapter. This helps distinguish two occurrences of the same word in different chapters. Each row has a menu to recolour or remove its Saved Highlight. Tapping the excerpt itself takes the page straight to the marked passage.

Recolouring is a single-excerpt action. Sharing excerpts is deferred.

Returning to an excerpt follows the same browsing rules as [choosing a chapter in Contents](0063-a-chapter-chosen-while-listening-only-takes-the-page-there.md). If the reader looks back at chapter three while listening to chapter eight, the voice carries on in chapter eight. A paused Reading stays paused, with its place kept for the next Play.

The first version keeps Saved Highlights on the device where they were made. Saving and revisiting a passage both work offline. A reader who continues the same book on another device can sync the Reading Position but will find these excerpts only on the original device.

## Removing highlights

Removing an individual highlight from the page or its row offers a brief Undo. To remove several, the reader taps Select at the top right of Highlights, then taps anywhere on a row to toggle it. A two-finger sweep can start or extend a selection, as in the Library. The selection can include excerpts from several chapters. Select All includes every highlight in this Document, even those off screen.

The removal button shows the selected count. One confirmation gives the total for the batch. Cancelling it leaves the rows checked so the reader can adjust the selection. Confirming removes the selected excerpts and returns to the ordinary list.

## Removing a book from the Library

Renaming a Document or moving it to another Folder keeps its Saved Highlights. When deleting a Document with Saved Highlights, the Library's deletion confirmation states how many highlights will be removed. Confirming deletes them along with the Library entry. Adding the same file again starts with an empty highlight list.
