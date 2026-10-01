---
status: accepted
---

# No link to a provider's signup lives in the app

The app contains no tappable link or button leading to any provider's signup,
pricing or key console, and no provider pricing anywhere in the app or its
screenshots. Instructions for obtaining a key are static text; the walkthrough
itself lives in the repository and on the project's site.

The product argument is in `docs/design/0017-no-link-to-a-providers-signup.md`.

## Why

Review guideline 3.1.1 forbids unlocking functionality by mechanisms other than
in-app purchase, and names licence keys. Reviewers have applied that reading to
bring-your-own-key apps more than once — including to a free app with no in-app
purchase at all, where the reviewer characterised the user's own credential as "a
paid key".

But the one case with a documented resolution turned on something much narrower.
A free BYO-key app was rejected under 3.1.1 and the directive it received was
*remove the "Get API Key" link from the binary*. It deleted the link, replaced it
with static text, and shipped — keeping the key field, the save action, the
provider picker, the model picker, the validation and every bit of the plumbing.
**The credential field was never the problem. The tappable route to the provider's
paid signup was.**

The established precedent in this category does the same thing: the closest
analogue on the App Store, a document reader that has advertised "connect cloud AI
voices using your own API keys" for years, keeps its entire provider setup guide —
portal links, pricing warnings and all — on its own website rather than in the
app.

Combined with having no in-app purchase at all (ADR 0002), which removes any
second paid path a reviewer could compare against, this is the whole posture.

## The one link: the project's own pages (#110)

The rule was "nothing in `src/` opens a URL" (`test/app/no-outgoing-links.test.ts`).
#110 narrowed it by one module, because guideline 5.1.1(i) requires the privacy
policy to be reachable inside the app, and the policy is a page on the project's
own site: GitHub Pages, published from `site/` by `.github/workflows/pages.yml`.

`src/app/own-site.ts` opens `https://xujialiu.github.io/OpenReader/privacy.html`
from a row at the foot of the Settings front page. The test allows `openURL` in
that module and nowhere else. The only address the module may name is the
site's, and its one call must open the policy's constant. A Provider's signup,
pricing or key console is still unreachable from the binary. The line the
rejection drew was a route to a Provider's paid signup, and a page of our own
that names none is not one.

## What was deferred, and is now built (#109)

Guideline 5.1.2(i), amended in late 2025 to name third-party AI explicitly,
requires disclosing what data goes to a third party and obtaining permission
**before** it is sent — and a rejection in this category stated plainly that
putting it only in a privacy policy is not sufficient. A per-provider consent
sheet, shown before the first request, is therefore required to ship.

It was deferred while the app was used only by its author, when the consent
would have been asked of the person granting it. It is built now. There is one
gate in front of every send, a Provider's synthesis and a lookup service alike,
asked once per recipient in the phone's own alert: ADR 0064.
