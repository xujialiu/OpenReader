---
status: accepted
---

# A font stack may name a CJK face, as long as a generic family is behind it

The product argument is [design 0029](../design/0029-choosing-a-font-for-a-chinese-book.md). **This revises ADR 0021's font list**, which held three entries and prohibited naming a CJK face. ADR 0021 is otherwise unchanged: Appearance is still one stylesheet the page already has, and `READING_FONTS` is still a fixed list rather than a field the owner types, which is what keeps `appearanceCss` unable to inject anything.

## The rule that was there, and why half of it was right

`highlighter.ts` said:

> Each stack ends in a generic family so that something is always found, and none of them names a CJK face. That is deliberate: WebKit falls through a stack per script, so a Chinese book under "Serif" is laid out in the system's own serif CJK face rather than in a font that has no glyphs for it.

`test/renderer/appearance.test.ts` enforced both halves: every stack matching `/(serif|sans-serif)$/`, and no stack matching `/[一-鿿]|PingFang|Songti|Heiti/`.

**The first half is load bearing and stays.** WebKit resolves `font-family` per script, not per element, so the generic at the end of a stack is what a Chinese run gets when the named face has no glyphs for it. `Georgia, serif` sets Latin in Georgia and Chinese in the system's serif CJK face, in the same paragraph. Drop the generic and the second half of that sentence has nowhere to go.

**The second half was a different claim wearing the same clothes.** The danger the reasoning describes is a stack with *no* generic behind it — "a font that has no glyphs for it" is a stack that terminates at a Latin face. `"Songti SC", serif` does not have that problem: it names a CJK face first, so it wins where it has glyphs, and keeps the generic behind it for everything else. The prohibition therefore bought nothing the first rule was not already buying, and it cost the one thing the setting is for on a Chinese novel: choosing a particular Chinese face.

This was found while acting on the opposite belief. Issue #12 was written claiming the three kinds did nothing on a Chinese book because Georgia and Helvetica carry no Chinese glyphs. That is false, and this file's own comment already said so — which is the argument for the comment.

## What the list is now

Ten entries. `system` unchanged; `georgia`, `times`, `palatino`, `avenir`, `helvetica` for Latin; `pingfang`, `songti`, `kaiti`, `yuanti` for Chinese. Every stack still ends in a generic family, and `appearance.test.ts` still asserts that for all ten. A second test asserts the amended rule from the other side: every CJK entry matches `/^"[A-Za-z ]+ SC", (serif|sans-serif)$/` — named first, generic last — and carries a label in its own script.

The labels of the four Chinese entries are their own names in Chinese on purpose. Each row in the list is set in the font it offers, so 宋体 rendered in Songti is both the name and the sample. For the Latin entries the sample is Latin and therefore **a sample and not a promise**: Georgia and Palatino preview differently and set the same Chinese paragraph identically, because both fall to the same generic. `preview` carries that warning where it is defined.

## `serif` and `sans` are retired, and migrated

Those two ids are gone, so `settings-storage.ts` maps them rather than dropping them: `serif` → `georgia` and `sans` → `helvetica`, which are the faces `Georgia, "Times New Roman", serif` and `Helvetica, Arial, sans-serif` already resolved to first. An owner's existing book therefore renders exactly as it did, including its Chinese, since both replacements end in the same generic their originals did. `readFont` takes the retired map only after failing to match a live id, so a future id can never be shadowed by an old one.

The fallback for anything else remains `DEFAULT_SETTINGS.appearance.font`, which is `null` — follow the document. A settings file from a newer build naming a font this one does not have therefore reads the book the way its publisher set it, rather than in a guess.
