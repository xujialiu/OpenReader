# Choosing a font for a Chinese book

The reader could already choose how a book's text is set, from three answers: the system's font, a serif one, or a sans-serif one. Each of those is a description of a *kind* of font rather than a font, and the owner picking one was never told which face they actually got.

For a book in English that is a small annoyance. For a book in Chinese it was a wall. The three answers do change a Chinese book — a serif choice lays it out in a serif Chinese face and a sans-serif choice in a modern one — but that is the whole of it. An owner reading a Chinese novel who wanted it set in a particular face, the way a reader of English might want Georgia rather than Palatino, had no way to say so. The kinds were the only vocabulary available.

So the list now names faces. Georgia, Times New Roman, Palatino, Avenir Next and Helvetica for the Latin ones, and 苹方, 宋体, 楷体 and 圆体 for the Chinese. The book's own font stays at the top of the list and stays the default, because a book that ships its own typography keeps it until the owner says otherwise.

## Every name is shown in its own font

A list that names Georgia in the interface's font asks the owner to already know what Georgia looks like. So each row is set in the font it offers, and choosing is a matter of looking rather than remembering. 宋体 shown in 宋体 is the whole of the explanation.

The one exception is the book's own font at the top, which is set in the interface font because it is not any particular face — it is whatever that book shipped, and that differs from book to book.

## A Latin name is a sample, not a promise

A book is not always all one script. A Chinese novel quotes an English title; an English book quotes a Chinese name. When it does, the choice the owner made applies to the part of the text it has letters for, and the rest is laid out in the system's nearest equivalent rather than in empty boxes.

That has a consequence worth stating plainly, because it can look like a bug: **two rows that look different in the list can set the same Chinese book identically.** Georgia and Palatino are both serif faces with no Chinese in them, so a Chinese paragraph under either falls to the same serif Chinese face. The preview differs because the preview is Latin. The book does not.

The four Chinese faces are the other way round: there, what the row shows is what a Chinese book gets.

## What was turned down

**Leaving the list at three kinds.** It is honest — it promises a kind and delivers a kind — and it is what the app did. It was turned down because the owner of this app reads Chinese novels, and a setting that cannot name 楷体 is not a font setting for them.

**Naming only Latin faces, and leaving Chinese to fall through as before.** This was the original plan, and it was based on a mistaken belief that the three kinds did nothing at all for a Chinese book. They do. Once that was corrected, naming only Latin faces would have meant adding six rows that change nothing for the books this app was built to read.

**Removing the kinds entirely in favour of faces.** Almost what happened, except that the two old choices are kept working: an owner who had chosen the serif kind now has Georgia, and one who had chosen sans-serif now has Helvetica. Those are the faces those choices were already using, so nobody's book changes appearance because of this.
