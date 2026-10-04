---
status: accepted
---

# Contents' check is the Download drawer's rule, matched to rows by place

The product agreement is [design 0073](../design/0073-contents-shows-what-is-downloaded.md): Contents draws the Download drawer's check on every row that is Downloaded (CONTEXT.md) in the Player's Voice.

## One rule for both drawers

`download-rows.ts`'s `downloadedChapters(chapters, progress)` answers which chapters and volumes are Downloaded: every chapter in the group with something to speak (`prepared === false` or a text count above zero) is complete, and the group has at least one. A group is a chapter and its descendants, so a volume heading is Downloaded once every chapter under it is, and a cover with no text never is. The Download drawer computed the same thing inline, per rendered row, as `descendants(chapters, id)` followed by `every(complete)`; it now asks `downloadedChapters` once and looks rows up in the answer, so the two drawers cannot disagree about a chapter. The drawer's behaviour is unchanged and its tests pass unchanged.

It is one pass from the end of the plan rather than `descendants` per row, because the navigation lists a parent before its children (the same order `descendants` relies on), so each chapter's subtree can be folded into its parent before the parent is reached. The Download drawer only ever asked for the rows its FlatList drew. Contents asks for every row at once, and `descendants` walks the whole plan per call: over 仙逆's 2,076 rows the per-row rule took 39.96 ms in Node against 0.65 ms for the whole of `downloadedRows` (notes/NOTES_2026-10-05.md, 01:27), on every update while a Download saves clips.

## Rows are matched to chapters by place, never by position

`downloadedRows(rows, chapters, progress)` pairs each Contents row with the download plan's chapter for the same navigation entry. Contents' rows are epub.js's reading of the navigation (`contents.ts`), and the plan is the app's own (`navigation.ts`, `navigationPlan`). They keep different entries, so the n-th row is not the n-th chapter:

- epub.js drops an `<li>` with neither an `<a>` nor a `<span>` (the falsy child `contentsOf` skips); `readDocumentNavigation` keeps it as `Untitled chapter`.
- `navigationPlan` inserts a `section-N` part for a spine file the navigation does not list, which Contents has no row for.

So both sides are reduced to the place they point at: the spine index (`ContentsRow.target`, `Chapter.section`) and the fragment. The plan stores the fragment decoded (`decodeURIComponent(href.split('#')[1])`); a row keeps the href as written, so `fragmentOf` decodes it the same way, and leaves it as written if it does not decode. Several entries can point at one place, a volume heading and its first chapter on the same file being the common case, so the chapters for a place wait in a queue and rows take them in document order: each row answers for its own chapter, and the heading is not checked on its first chapter's audio. A row with no `target` cannot be opened and is never checked; a row whose place matches no chapter is not checked either.

Matching by position was the alternative, and it is simpler. It was turned down because one dropped `<li>` early in a book shifts every check after it onto the wrong chapter, silently. Matching by href string was turned down too: epub.js hands NCX `src` over raw and joins an EPUB 3 `navItem` href to the package directory with a leading slash (ADR 0020, "EPUB 3 path spelling correction (#125)"), while the app resolves both against the package itself. The spine index is the form both sides have already resolved.

## Asked for only while Contents is open

`reading-view.tsx` calls `requestProgress` for the Player's Voice (`settings.provider` and `settings.voice` of the per-document settings `reading-host.tsx` builds from the Library entry's Voice, which is where `reader-actions.tsx` takes the Download drawer's Voice from too) when Contents opens and `releaseProgress` when it closes, and reads `planOf` and `chapterProgress` on every render driven by `useDownloads`. While a progress is requested, every saved clip of a running Download reads it again (`refresh`), so requesting it whenever the reader is open would run the progress query per saved clip for a drawer that is not on screen. No Voice chosen means no request and no checks. The snapshot outlives the release, so a second opening shows the last answer at once and the fresh one a moment later, as the Download drawer does. Contents does not wait for it: the list opens at its row, and the checks arrive with the answer, passed to `DrawerList` as `extraData` so the drawn rows take them.

## Drawing

The check is `Icon name="check"` at 22 pt in the row's accessory, in `accent.reading`, or `accent.onMark` on the marked row: the Download drawer's sizes and colours. A checked row's accessibility label ends in `, downloaded`, as the Download drawer's does.
