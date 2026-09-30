# Settings → Acknowledgements (#111, design 0065, ADR 0065)

Run 2026-10-01 02:13–02:49 on `iPhone 17 prepare`
(`3AC0934F-6CBA-4ABE-AB07-DF01E4F07C08`, iOS 27.0), tree `xujialiu/prepare` at
230beb1, `1.0.0-beta1-debug`, Metro on 8101. Real touches through AXe; nothing
plays, and nothing here needs the volume at zero.

## What it uses

- `acknowledgements-check.py UDID list` and `… licence [--pasteboard]`
  (this folder): the page's rows and one licence page, read from the phone's
  accessibility tree and compared with `src/app/acknowledgements.json`.
  `list` needs the Acknowledgements page open, `licence` a licence page.
  Exit 0 when everything is equal, 1 when something differs, 2 for a setup
  problem.
- `../kit/ax.py` (AXe): `tree`, `touch LABEL`, `scroll-touch LABEL` (a row of a
  long list: swipes until the row rests on the screen, then touches it),
  `scroll-to LABEL` (the same without the touch), `find LABEL`.
- `xcrun simctl ui UDID appearance light|dark` for the two themes (the app's
  Theme is `system`), and `xcrun simctl io UDID screenshot`.

## Recipe

```sh
python3 test/manual-test/kit/ax.py UDID touch Settings        # from the Library
python3 test/manual-test/kit/ax.py UDID tree                   # the front page
python3 test/manual-test/kit/ax.py UDID touch Acknowledgements
python3 test/manual-test/settings/acknowledgements-check.py UDID list
python3 test/manual-test/kit/ax.py UDID scroll-touch "OpenSSL, Apache-2.0"
python3 test/manual-test/settings/acknowledgements-check.py UDID licence
printf x | xcrun simctl pbcopy UDID                           # so a stale copy cannot pass
axe touch -x 200 -y 520 --down --up --delay 2.0 --udid UDID    # press the text for 2 s
python3 test/manual-test/kit/ax.py UDID touch Copy
python3 test/manual-test/settings/acknowledgements-check.py UDID licence --pasteboard
```

The scroll of a licence page is read back from the text's frame
(`y` in `ax.py tree`'s last column) before and after `axe swipe --start-y 780
--end-y 120 --duration 0.25 --post-delay 1.5`, repeated until the footnote under
the card is on screen.

## Facts and how each was shown

| Fact | Evidence |
| --- | --- |
| The front page's second card holds two rows, and the version sits under it | `ax.py tree`: `Button │ Privacy Policy │ 20,376 362x53`, `Button │ Acknowledgements │ 20,429 362x53`, `StaticText │ Version 1.0.0-beta1-debug │ 36,490 330x16`; the screenshot: Privacy Policy in amber (light and dark), Acknowledgements in the text colour with a chevron, `1.0.0-beta1-debug` in grey under the card (its label carries "Version", its text does not) |
| 132 rows, identical to the data, in order | `rows=132 entries=132 identical=True` (light 02:14, again after a back 02:19, and in dark 02:29); each row a 362×53 Button labelled `name, licence`, the first at 20,132 |
| Name left, licence right | screenshots in both appearances: the name at the row's left, the licence in grey before the chevron |
| OpenSSL, complete | `title='OpenSSL' text=10140 chars, equal=True; line under it equal=True`: the page's one long StaticText (`20,132 362x4772`) carries exactly `text`, and the footnote (`Version 4.0.0-dev, part of react-native-audio-api. Linked into FFmpeg's libavformat.`) is `aboutLine`'s |
| OpenSSL, scrolls | the text's `y` went 132 → −1741 after one 450 pt swipe (momentum: 1,873 pt) → −4001 after twelve more flings, its bottom at 771 and the footnote at 779–810; the screenshot ends at `END OF TERMS AND CONDITIONS` |
| OpenSSL, selectable | a 2 s press raised a `Copy` callout (the tree lists it, at 204,483); after the touch `pasteboard=10140 chars, equal to the text=True` |
| FFmpeg, complete and selectable | `text=30849 chars, equal=True`, footnote 375 chars equal; the pasteboard, seeded with `cleared-before-copy`, held 30,849 chars equal to the text after Copy; the text is 15,941 pt tall, and 18 flings brought its end (`That's all there is to it!`) and the footnote (686–810) on screen |
| The header's back leads to Acknowledgements | holding the back button (`axe touch -x 38 -y 84 --down`, 1.8 s, screenshot, then `--up`) showed the menu `Acknowledgements`, `Settings`, `Library`; the release went back to the list with its scroll position kept (OpenSSL's row at y 545, where it was touched); a quick touch pair on Back from FFmpeg (dark) gave `Heading │ Acknowledgements`, and a second one `Heading │ Settings` |
| Both appearances | light and dark screenshots of the front page, the list (rows 132, identical) and FFmpeg's page |

## What it found

- **Three rows cut both ends on a 402 pt screen.** A compound licence takes the
  room the name needs, and both are set to one line: `ConcurrentQ… │ BSD-2-Clause
  OR B…`, `fast_fl… │ MIT OR Apache-2.0 OR BSL…`, `WebKit We… │ BSD-3-Clause AND
  BS…`. `JSZip │ MIT OR GPL-3.0-or-later` and `miniaudio │ Unlicense OR MIT-0`
  fit, as do the longest names with `MIT` (`@react-navigation/native-stack`,
  `react-native-safe-area-context`). The row's accessibility label has both in
  full, and the licence page's title has the name, but the licence expression is
  nowhere else on screen. Seen in light; a larger text size was not tried.
  Cosmetic, and `NavigationRow`'s (`numberOfLines={1}` on both) for every row
  that uses it.
- **The back button draws only a chevron** on the iOS 27.0 bar, and its
  accessibility label is `Back` (`AXUniqueId BackButton`, role description
  `back button`), so "the back reads Acknowledgements" is true of its menu, not
  of its face. See `../pitfalls/mcp.md` ("A long text page…").

## What it cannot prove

- That the list names everything the build ships: that is the generator's and
  `test/app/acknowledgements.test.ts`'s job; this compares the screen with the
  committed data.
- How the page reads to VoiceOver, or at larger Dynamic Type sizes.
- The other 130 licence pages: two were read in full.
