# Three copies for three recipients

Issue #324 records the author's decisions. The engineering half is
[ADR 0086](../adr/0086-three-copies-for-three-recipients.md). This records the
agreed product boundary, not a completed change or permission to publish.

## What was decided

One publication prepares three copies from the same state of the app, with the
same Version:

- **The App Store copy** remains a free download. Reading aloud, preparing
  Offline Narration and playing it need the thirty-day Trial or the one-time
  Unlock, as in [design 0075](0075-read-aloud-is-bought-once-after-a-trial.md).
  Nothing about its price, Trial or other free features changes.
- **The free test copy** goes through TestFlight. All existing features are
  available without a Trial or Unlock, including reading aloud and preparing
  and playing Offline Narration. The app imposes no trial deadline on it.
- **The author's own copy** has the same free access, with Debug Mode. It goes
  only to the author's internal TestFlight group, never to public testers or
  App Review. Installing it locally remains possible too.

Free access means OpenReader does not charge for its features. Each person
still supplies their own Provider credentials and pays the Provider's charges.
It does not extend the lifetime Apple gives a TestFlight copy. The free test
copy is for actual testing and feedback, not a promise of permanent stable
free distribution.

Preparing all three belongs to an explicit request to upload. An ordinary app
change, simulator check or local installation does not upload three copies.
Uploading does not itself authorize public testing, submission or release;
each remains the author's decision.

All three are the same app on the device: installing one replaces another
rather than adding a second app. Documents, settings, credentials, Reading
Positions, Offline Narration and legitimate purchase records stay in place.
Returning to the App Store copy applies its own Trial and Unlock, not free
access borrowed from a test copy.

The free test copy and the author's own copy have no purchase capability,
including the author's former simulated-purchase and real-store controls.
Purchase testing uses a test configuration of the App Store copy instead.
Removing purchases from the free copies neither cancels purchases nor removes
the products sold in the App Store copy.

After an upload, the author receives a table stating exactly which copy each
number identifies, what was uploaded successfully, and which copy alone may
be chosen for the store. A separate upload-history table records only copies
actually uploaded; it contains no plans or rules and stays an empty template
until the first confirmed upload. “Choose the latest” is unsafe: the newest
copy belongs to the author, not the store.

## Why separate the copies

A tester and the author should not have to start a Trial, make a test purchase
or restore one before they can listen. The App Store copy still funds the
project, while the author's own copy keeps the record needed to understand a
fault.

Keeping the purchase experience in every copy was the earlier choice in
[design 0075](0075-read-aloud-is-bought-once-after-a-trial.md): test purchases
cost nothing, and one copy served both testers and the reviewer. The author
now chooses to remove that purchase experience from the two free copies.
The App Store reviewer must still receive the copy with its real purchase
experience, not either free copy.

## Release safeguards

Each publication takes three consecutive numbers in the same order: store,
free test, then the author's own copy. The next publication takes the next
three numbers. The number does not change a copy's purpose, and neither odd
nor even means it is safe for the store.

The existing version line identifies the free and author's copies explicitly;
the store copy has no extra role label. The testing service's description
also names the recipient and permitted use, so the author does not have to
remember which number was which.

The author's internal test group receives all three copies as they upload.
The testing service fixes that choice when a group is made and offers no way
to change it. Rather than replace the group, the author chose to keep it and
pick the own copy by hand in the testing app; the other two are installed
only when the author wants to test them.

If only part of an upload succeeds, work pauses. The author gets each copy's
actual result and chooses whether to retry or rebuild. Nothing is renumbered,
substituted or submitted silently.
