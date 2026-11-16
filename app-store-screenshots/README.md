# App Store screenshots

The screenshots on OpenReader's App Store page, and the script that makes
them. The iPhone and iPad sets show the same four screens, in this order:

| File | Screen |
| --- | --- |
| `1-reading.png` | Chapter I of Pride and Prejudice, the spoken word highlighted, the player paused |
| `2-lookup.png` | Word Lookup of "acknowledged", from the Free Dictionary API |
| `3-download.png` | The Download drawer with two chapters ticked |
| `4-library.png` | The Library, with the book's "Last read" line |

| Folder | Device | Size | App Store Connect slot |
| --- | --- | --- | --- |
| `iphone/` | iPhone 17 simulator | 1206 × 2622 | iPhone with Dynamic Island (medium display), the required iPhone set |
| `ipad/` | iPad Pro 13-inch (M5) simulator | 2064 × 2752 | iPad 13" display |
| `duo/` | iPhone Duo simulator, unfolded then folded | 2853 × 2007; 1398 × 2034 | iPhone Duo |

## What is on them

- **The book**: Pride and Prejudice, Project Gutenberg eBook #1342, public
  domain in the USA. The script hands the app a copy of the owner's unchanged
  download (`~/Works/epub_books/Pride and Prejudice/Pride and Prejudice.epub`,
  or `--epub`).
- **The voice**: "Bella" from a fake Kokoro server on the Mac
  (`test/manual-test/player-and-reading-held/fake-kokoro.cjs`). It answers with
  silent audio and word timings, so the highlight is real and nothing is heard.
  No API key and no Provider's prices appear.
- **The lookup** is live: the app sends "acknowledged" to the Free Dictionary
  API, so the definition shown is whatever that service returns that day.
- **The app** is the free role's Release build: the screens are the App Store
  copy's, without its Trial prompt in front of the first Play.
- **The device**: dark appearance, US English, status bar at 9:41 with a full
  battery, and on iPad Full Screen Apps, so no window handle is drawn.
  Duo captures retain its native vertical system bar and clock.

## Making them

Each step is a heavy simulator phase, so it runs under the shared iOS guard
([ios-verification.md](../test/manual-test/kit/ios-verification.md)). From the
repository root:

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer
OUT=/tmp/openreader-screenshots
# 1. The free role's Release app for the simulator. This rewrites ios/.
python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 1800 \
  --record "$OUT/build.json" -- python3 app-store-screenshots/shoot.py build "$OUT/build"
APP="$OUT/build/derived/Build/Products/Release-iphonesimulator/OpenReader.app"
# 2. Each set, on a new simulator deleted afterwards with its work directory (--keep keeps both).
for device in iphone ipad; do
  python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 1500 \
    --record "$OUT/$device.json" -- python3 app-store-screenshots/shoot.py shoot "$device" --app "$APP"
done
```

`shoot` writes into `iphone/` or `ipad/` here (or `--out`) and stops if a
picture has the wrong size. It needs Xcode with an iOS simulator runtime,
Node, `swiftc`, and the AXe that mobilebuildmcp caches under `~/.npm/_npx`.
`find-word.swift` finds the word to long-press in a screenshot with the
system's text recognition, so the touch lands on it whatever the layout.

Look at every picture before uploading: the lookup's definition and where
the paused word falls change from run to run.

## iPhone Duo captures

The iPhone Duo has two displays in one App Store screenshot slot. The stored
files are `duo/1-reading-unfolded.png` and `duo/2-reading-folded.png`.
Create a session-owned
`iPhone Duo` on iOS 27.1 and run the current free Release app with Xcode 27.1;
the Duo orientation module is only compiled by that SDK. Use the 27.1 Device
Hub pose controls and read the actual display after every pose input. The
outer display is display 1 and the inner display is display 3:

```sh
UDID=DUO_UDID
OUT=/tmp/openreader-duo-screenshots
mkdir -p "$OUT"
xcrun simctl io "$UDID" screenshot --display=1 "$OUT/outer.png"
xcrun simctl io "$UDID" screenshot --display=3 "$OUT/inner.png"
```

Capture a paused reader with a highlighted word in both poses. The accepted
native sizes are `1398 × 2034` or `2034 × 1398` for the outer display and
`2007 × 2853` or `2853 × 2007` for the inner display. Inspect the actual image
dimensions; do not upscale, crop, or rotate a capture from the other display.
Apple accepts PNG or JPEG without an alpha channel. Simulator PNGs can carry a
fully opaque alpha plane, so convert the retained screenshot to RGB before
uploading and verify the resulting mode has no `A` channel.

Keep the guest volume at zero and check it immediately before any Play. A
Device Hub click receipt is only an input dispatch; the pose is accepted from
the resulting display dimensions and the rendered app content. The screenshot
still needs the same visual review as the iPhone and iPad sets.

## Uploading

App Store Connect → the version → Media Manager. Put the four iPhone files,
four iPad files and two Duo files in their respective slots above, in file
order. Smaller devices use the scaled-down set
unless one of their own is added. See
[App Store Connect reference](../docs/app-store-connect.md#metadata-and-review),
whose **Working in the page** covers the sign-in and blank pages.

- **Replacing a set**: Remove All, then confirm. It removes the set from this
  version only; the pictures stay in the media library.
- **The file input** belongs to the selected device slot. With Playwright MCP,
  follow the visible-window and original-file-byte upload steps in
  [the App Store Connect reference](../docs/app-store-connect.md#metadata-and-review)
  if the browser rejects native file-path upload. The zero-size `DropZone`
  accessibility button is a focus helper; its visible container is the drop
  target.
- **After an upload** a notice says the set serves every iPhone, or every
  iPad, size; OK closes it.
- **Done** is every screenshot's `assetDeliveryState` reading `COMPLETE`, read
  through `scripts/asc-api.mjs` from the version localization's
  `appScreenshotSets` with `include=appScreenshots`. The largest iPad files
  stay at `UPLOAD_COMPLETE` for several minutes; Add for Review waits for them.
