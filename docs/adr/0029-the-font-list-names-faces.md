---
status: accepted
---

# The font list names faces, and a stack may name a CJK face once one exists

The product argument is [design 0029](../design/0029-knowing-which-font-you-chose.md). **This revises ADR 0021's font list**, which held three entries and prohibited naming a CJK face. ADR 0021 is otherwise unchanged: Appearance is still one stylesheet the page already has, and `READING_FONTS` is still a fixed list rather than a field the owner types, which is what keeps `appearanceCss` unable to inject anything.

## The rule that was there, and why half of it was right

`highlighter.ts` said:

> Each stack ends in a generic family so that something is always found, and none of them names a CJK face. That is deliberate: WebKit falls through a stack per script, so a Chinese book under "Serif" is laid out in the system's own serif CJK face rather than in a font that has no glyphs for it.

`test/renderer/appearance.test.ts` enforced both halves: every stack matching `/(serif|sans-serif)$/`, and no stack matching `/[一-鿿]|PingFang|Songti|Heiti/`.

**The first half is load bearing and stays.** WebKit resolves `font-family` per script, not per element, so the generic at the end of a stack is what a Chinese run gets when the named face has no glyphs for it. `Georgia, serif` sets Latin in Georgia and Chinese in the system's serif CJK face, in the same paragraph. Drop the generic and the second half of that sentence has nowhere to go.

**The second half was a different claim wearing the same clothes.** The danger the reasoning describes is a stack with *no* generic behind it — "a font that has no glyphs for it" is a stack that terminates at a Latin face. `"Songti SC", serif` does not have that problem: it names a CJK face first, so it wins where it has glyphs, and keeps the generic behind it for everything else. The prohibition therefore bought nothing the first rule was not already buying, and it cost the one thing the setting is for on a Chinese novel: choosing a particular Chinese face.

This was found while acting on the opposite belief. Issue #12 was written claiming the three kinds did nothing on a Chinese book because Georgia and Helvetica carry no Chinese glyphs. That is false, and this file's own comment already said so — which is the argument for the comment.

## The four CJK faces were added, measured, and taken out again

The list held ten entries for one commit: `system`, five Latin faces, and `pingfang`, `songti`, `kaiti`, `yuanti`.

**Three of the four do not exist.** On the iOS 27.0 simulator runtime, `UIFont.familyNames` contains PingFang (SC/TC/HK/MO) and no other CJK family at all — `Songti SC`, `Kaiti SC` and `Yuanti SC` are absent. Established two ways in the same run: the font registry directly, and a screenshot of the Fonts page in which the four Chinese rows are visually indistinguishable from each other and from System. Selecting 楷体 left 仙逆's text unchanged, confirmed by diffing identical crops rather than by eye.

Nothing broke. An absent face falls through to its generic exactly as the rule above says, so the rows were inert rather than damaging. But **a row that does nothing is worse than no row**: it offers the owner a choice, takes it, shows a check, and changes nothing, which is a harder thing to understand than the option not being there.

So the list is six entries: `system` and the five Latin faces. **The rule change stands and nothing currently exercises it.** That is deliberate — the reasoning was checked and is sound, and it is the availability of those particular faces that failed, so the next attempt starts from a measurement rather than from this argument again.

**To put them back**, one thing has to be true: that the faces resolve where the owner actually reads. Physical iPhones ship a fuller font set than simulator runtimes, so they may well resolve on the owner's own phone — which is a claim this repository does not get to make until someone has run `docs/install-on-iphone.md` and looked. 苹方 resolved even here, so re-adding that one alone is a one-line change whenever it is wanted.

Every remaining stack still ends in a generic family, and `appearance.test.ts` asserts that for all six. A second test asserts what survives the removal: the list still reaches **both** kinds of CJK face, a serif one through `Georgia, serif` and a modern one through `Helvetica, sans-serif`, which is exactly what the three categories gave a Chinese book before any of this. Nothing was lost by taking the four out.

`preview` is a **sample and not a promise**: Georgia and Palatino preview differently and set the same Chinese paragraph identically, because both fall to the same generic. The field carries that warning where it is defined.

## `serif` and `sans` are retired, and migrated

Those two ids are gone, so `settings-storage.ts` maps them rather than dropping them: `serif` → `georgia` and `sans` → `helvetica`, which are the faces `Georgia, "Times New Roman", serif` and `Helvetica, Arial, sans-serif` already resolved to first. An owner's existing book therefore renders exactly as it did, including its Chinese, since both replacements end in the same generic their originals did. `readFont` takes the retired map only after failing to match a live id, so a future id can never be shadowed by an old one.

The fallback for anything else remains `DEFAULT_SETTINGS.appearance.font`, which is `null` — follow the document. A settings file from a newer build naming a font this one does not have therefore reads the book the way its publisher set it, rather than in a guess.
