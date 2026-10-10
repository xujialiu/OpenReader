---
status: accepted
---

# A contribution is licensed once more to the author, by a box in the pull request

_The product half is [design 0076](../design/0076-a-contribution-is-licensed-once-more-to-the-author.md).
Issue #149; the author's decisions of 2026-10-10 are its plan comment. Every
page and repository quoted below was read on 2026-10-10._

## The decision

A contribution is accepted on the terms in `CONTRIBUTING.md`:

- The contributor keeps the copyright.
- Everyone receives the contribution under AGPL-3.0, the licence in `LICENSE`.
- Xujia Liu receives a second copyright licence: perpetual, worldwide,
  non-exclusive, no-charge, royalty-free and irrevocable, to reproduce, prepare
  derivative works of, publicly display, publicly perform, sublicense and
  distribute the contribution under any licence terms.

Agreement is a ticked box in `.github/pull_request_template.md`. The pull
request is the record. There is no bot, no signature file and no third-party
service.

## Why AGPL-3.0 alone is not enough

`LICENSE`, section 10: "You may not impose any further restrictions on the
exercise of the rights granted or affirmed under this License."

Apple's Media Services Terms and Conditions, "Last Updated: September 14,
2026", in the Standard EULA that governs an app unless its provider supplies
one of its own: "Licensor grants to you a
nontransferable license to use the Licensed Application on any Apple-branded
products that you own or control and as permitted by the Usage Rules", and "You
may not transfer, redistribute or sublicense the Licensed Application except as
expressly permitted in this Agreement".

The Free Software Foundation, "More about the App Store GPL Enforcement", 26
May 2010, about GNU Go under GPLv2: "this analysis would apply to all versions
of the GNU GPL and AGPL", and "Apple's Terms of Service impose restrictive
limits on use and distribution for any software distributed through the App
Store, and the GPL doesn't allow that."

A sole copyright holder is not a licensee of his own work, so section 10 does
not reach the author while every commit is his. On 2026-10-10 `git log` shows
one author for all 657 commits, and the repository has no fork and no pull
request.

What ships beside the author's code does not raise the question either. Of the
132 components in `src/app/acknowledgements.json`, none is GPL-only or AGPL.
The strictest is FFmpeg, LGPL-2.1-or-later (ADR 0065). JSZip is `MIT OR
GPL-3.0-or-later` and is taken as MIT.

VLC is what an objection looks like. Its iOS port was accepted in September
2010 and withdrawn in January 2011 after one VLC developer complained to Apple
about the conflict between GPLv2 and the store's terms. The authors began
relicensing its engine to LGPL-2.1-or-later in October 2011, and the app was
resubmitted in July 2013 under MPL-2.0 (Wikipedia, "VLC media player", citing
Ars Technica of 10 January 2011).

## The wording

The terms in `CONTRIBUTING.md` follow the Apache Software Foundation's
Individual Contributor License Agreement, version 2.2, read from
`apache.org/licenses/icla.pdf`. Clause 1 is its definitions, and clauses 4 to 8
are its clauses 3 to 8, with "the Maintainer" for "the Foundation" and its
clauses 5 and 7 joined into one. The employer clause loses its third way out, a
separate corporate agreement, because there is none here. Two things are
changed:

- **Clause 2 is new.** The Apache agreement gives its copyright licence "to the
  Foundation and to recipients of software distributed by the Foundation". Kept
  as it stands, that would hand every recipient a licence wider than AGPL-3.0.
  Here everyone receives AGPL-3.0, version 3 only, as the README states the
  project's licence.
- **Clause 3 grants to the Maintainer alone**, adds "under any licence terms",
  and names what that includes: app stores under their own terms, copies
  offered for a fee, and licences other than AGPL-3.0. The Apache agreement
  leaves this to the word "sublicense".

The patent licence still reaches "recipients of software distributed by the
Maintainer". A person who installs the App Store copy receives it under Apple's
terms, where AGPL-3.0's own patent licence, section 11, does not apply.

The Apache agreement's opening promise, that the Foundation will not use a
contribution against the public benefit, is left out. The author made no
promise about future licences.

## What others do

- `signalapp/Signal-iOS` (AGPL-3.0), `CONTRIBUTING.md`: "Make sure you sign the
  CLA."
- `mastodon/mastodon-ios` (GPL-3), `README.md`: "It is also dual-licensed to
  Apple for the purposes of publishing the app on the App Store. For this
  reason, any contributors are required to sign a Contributor License
  Agreement."
- `nextcloud/ios` (GPLv3 or later), `COPYING.iOS`: the copyright holders "have
  committed not to pursue any license violation that results solely from the
  conflict between the GNU GPLv3 or any later version and the Apple App Store
  terms of service", and say so for "derived apps".

## Alternatives

- **A public exception**, as in `nextcloud/ios`. It needs nothing from each
  contributor. It also lets anyone ship a copy on the App Store, paid or free,
  and covers that store only.
- **A grant limited to app stores.** New legal wording, and a change of licence
  or a store with other terms would need every contributor's consent again.
- **No outside code.**
- **A CLA bot.** A workflow to maintain for a repository with no pull request.
  It can replace the box later without changing the terms.
- **The Developer Certificate of Origin alone.** It certifies the right to
  submit under the project's licence and grants nothing beyond it.
- **Copyright assignment.** More than the store copy needs, and its validity
  differs between countries.

## Consequences

- **The box is checked by hand.** GitHub does not refuse a merge whose box is
  empty. `MEMORY/github-workflow.md`, "Outside contributions", says what an
  agent checks before it merges.
- **Lines from a pull request that was not merged stay out.** Copying them into
  a commit of the author's brings in the contributor's copyright without the
  licence. The problem a pull request points at can be fixed in new code.
- **Copied code is a second way in.** `src/core/providers/` and
  `src/core/sync/webdav.ts` are copied from Zotero-OpenReader
  ([ADR 0013](0013-provider-layer-is-copied-and-returns-pcm.md)). What is
  copied must be the author's own, or contributed there under the same terms.
  Its issue #178 asks for those terms.
- **That way in has been tried.** Zotero-OpenReader has two forks and has had
  two pull requests from outside, #168 and #171, both against its
  `src/core/webdav.ts`. Both were closed without a merge, and the author wrote
  each fix himself (#169, #172). Compared on 2026-10-10, none of the lines
  either pull request added is in the app's `src/core/sync/webdav.ts`. Three
  of #168's are in the plugin's file, each a stock line of reading a stream:
  `const decoder = new TextDecoder();`, `total += value.byteLength;` and
  `text += decoder.decode(value, { stream: true });`.
- **The terms are agreed as they stand.** A pull request agrees to
  `CONTRIBUTING.md` as `main` has it when the box is ticked, and `git log`
  keeps every version. A change to the terms does not reach contributions
  already merged.
- **No lawyer has reviewed the terms.** That should happen before the first
  outside contribution is merged.
- **GitHub offers `CONTRIBUTING.md` and fills in the template** on a new pull
  request only once both are on the default branch.
