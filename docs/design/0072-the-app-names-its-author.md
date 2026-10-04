# The app names its author and asks for a star

## What was decided

The front page of Settings has a card of three rows between the settings and
the legal rows:

- **Author**: Xujia Liu.
- **Email**: his address. A tap starts an email to him.
- **GitHub**: the project's name on GitHub. A tap opens it in Safari.

Under the card, one sentence: *If you like OpenReader, give it a ⭐ on GitHub —
it helps others find it.*

The card is drawn as the phone's own About page is drawn, a name on the left
and what it is on the right. The two addresses are in the app's accent colour,
the colour that already marks Privacy Policy as something a tap opens.

The project's support page gains an About section saying the same: who made
the app, that it is free and open source, and the same sentence with GitHub
linked. The project's page on GitHub gains the sentence and a line naming the
author and his email. The App Store page's "Developer Website" will lead to
GitHub, and its description will end with the address. Both change with the
next version the store receives.

## Why

OpenReader is free and open source, and earns nothing. What it can gain is
people: someone who likes it and stars it on GitHub makes it easier for the
next person to find. On the day this was decided the project had no stars, and
nothing in the app said it was on GitHub at all, or who had made it, or how to
write to him. The email was on the support page, which nobody reaches from
inside the app. Apple's own rules ask that an app carry an easy way to reach
its developer, and not only its support page.

Zotero-TTS, the desktop counterpart, already names its author and his email and
asks for a star in its settings and on its GitHub page. The two say it in the
same words.

## Alternatives turned down

- **The names and addresses as plain words, nothing to tap.** No address would
  need to be opened from the app. But nobody types a web address into a phone
  from a settings page, so the GitHub address would be read and forgotten.
- **One row that opens the support page, with everything there.** The app
  would open only the project's own site, as it does now. But GitHub would then
  be two taps away and behind a page most people would not read to the end.
- **A row called About, opening a page of its own.** The front page would stay
  as short as it is. But a card on a page of its own is a card nobody sees
  unless they go looking, and the point is to be seen.
- **Leaving the app alone, and only changing the website and GitHub.** Nothing
  to build. But the people who like the app are in the app.

## The sentence is kept on purpose

The app's own rule removes a standing notice that says the same thing on every
visit, and the star sentence is one. It stays as the one exception, because it
says what the rows above it cannot: why a star is worth giving. It sits at the
foot of Settings, which is seldom visited, rather than over anything used every
day.

## What it costs

- **Three rows and a sentence on the front page of Settings.** The legal rows
  move down by that much.
- **Two more ways out of the app.** The app opened one page before, the
  privacy policy. A tap can now also leave for GitHub or the mail app. The rule
  that keeps a service's signup page out of reach still holds, and now covers
  the project's GitHub page and website too: they may say where a key is
  created, but not link to that page.
- **A long address at a very large text size.** The email wraps under its name
  rather than being cut off, so the row grows taller.
- **Nothing in the build now in review.** The card ships with the next build.

*The engineering half of this decision is the #129 section of
[ADR 0017](../adr/0017-no-provider-links-in-the-binary.md).*
