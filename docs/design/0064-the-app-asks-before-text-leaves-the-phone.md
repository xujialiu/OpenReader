# The app asks before text leaves the phone

## What was decided

The first time the app would send text to a service, it stops and asks. The
services are a speech provider that reads a document aloud, a dictionary that
looks up a word, and a translator that translates a selection. The question is
the phone's own alert. It names who would receive the text and what the text
is, and the owner answers Allow or Don't Allow. Each service is asked about
once. A yes is kept on that phone, so it is never asked about again there.

The words, as the owner approved them:

> **Send text to Fish Audio?**
> To read aloud, OpenReader sends your document's text to Fish Audio with your
> API key. Fish Audio's privacy policy applies.
>
> Don't Allow · Allow

> **Send selected text to Youdao?**
> Word Lookup sends the text you select to Youdao.
>
> Don't Allow · Allow

A server at an address the owner typed in counts as a service of its own, and
another address counts as another service. The alert names such a server by its
address, "the server at 192.168.1.20:8880", and leaves out the privacy policy,
because there is no company whose policy it could name. "With your API key" is
said only when a key actually goes with the text.

The alert is laid out like the phone's own permission prompts: Don't Allow on the
left, and Allow on the right in bold.

## What Don't Allow does

Nothing is sent, and nothing more is said. The owner has just answered, so
there is nothing to explain.

- **Reading aloud** stays where it was, paused, with no message under the page.
- **Choosing a voice** from another provider while listening leaves the reading
  in the voice it had.
- **A download** does not start. If a download was already under way (one left
  over from before the question existed, or one whose server address has
  changed since), it stops as "Needs attention", with a line saying which
  service was not allowed.
- **A lookup** closes, as its own close button would close it.

The question comes back the next time the owner asks for the thing again: a
press of Play, a voice chosen, a download started or resumed, a new lookup. It
never comes back by itself. A reading asks for the next few sentences ahead of
time, and without that rule each of them would put the same alert back on the
screen the moment it was dismissed.

A no is never kept, only a yes. So to allow a service after refusing it, the
owner asks for the thing again and answers Allow this time.

**The question takes as long as the owner does.** While it is on the screen,
nothing gives up waiting for it. A reading waits to start, and a new voice
waits to take over. Neither treats an unanswered question as a service that has
stopped responding. The first try did, after a minute, and the simulator
caught it: the player said the service had not answered, under an alert that
had not been answered yet.

A sentence whose sound is already on the phone, downloaded or heard earlier in
the same session, sends nothing, so it plays while the question is up. The
question is about the first sentence that would be sent. So Don't Allow leaves
the reading on that sentence, one on from where Play was pressed if the one
before it could play, and moves it nowhere else.

The owner confirmed these on 2026-09-30, after trying the alternatives:
- the question returns only when the owner asks again, not once per launch, and
  it is not left to a switch in Settings;
- a refused lookup closes rather than staying open to say it was not sent;
- Allow is the bold button, as in the phone's permission prompts;
- there is no way yet to take a yes back inside the app (below).

## Why

The store's rules say that before an app sends someone's data to another
company, and they now name artificial-intelligence services explicitly, it has
to say so and get a yes first. An app in this category was told that saying it
in a privacy policy is not enough. Decision 0017 knew this was owed and
deferred it while the only person to ask was the one building the app. It is
the last thing between the app and a submission.

It is also the app's own promise, said out loud. Text goes only to the services
the owner chose, and now the owner is told before it goes, in words that name
the company.

## Alternatives turned down

- **A panel of the app's own design**, with room to say more. The owner chose
  the phone's alert. It is what every other request for permission on the phone
  looks like, and decision 0042 asks the app to let the phone draw anything it
  can draw itself.
- **One screen at the first launch, listing every service.** It would ask about
  services the owner may never use. It would ask before anything is about to
  happen, and it would not be tied to the one service about to receive the text,
  which is the moment the rule is about.
- **Saying it in the privacy policy only.** The store has already said this does
  not count.
- **Asking every time.** A question that comes up on every press of Play is read
  once and tapped through from then on, which is the standing notice the app's
  interface rules remove on sight.

## What it costs

- **One more tap** the first time each service is used, at the moment the owner
  was about to listen or look something up.
- **On the owner's own phone**, one question per provider after the update.
  Nothing is carried over from before the question existed, because no yes was
  ever given.
- **A download that resumes by itself** after the update, away from the screen,
  can wait on the question until the owner next opens the app. So can a
  reading started from the lock screen that reaches a service not yet allowed:
  it stays silent, waiting, rather than giving up.
- **A yes cannot yet be taken back inside the app.** Deleting the app clears it.
  The privacy policy says what each service receives.

*The engineering half of this decision is
[ADR 0064](../adr/0064-consent-is-one-gate-in-front-of-every-send.md).*
