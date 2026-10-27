# App Store screenshots

The screenshots on OpenReader's App Store page, and the script that makes
them. Both sets show the same four screens, in this order:

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

## Making them

Each step is a heavy simulator phase, so it runs under the shared iOS guard
([ios-verification.md](../test/manual-test/kit/ios-verification.md)). From the
repository root:

```sh
OUT=/tmp/openreader-screenshots
# 1. The free role's Release app for the simulator. This rewrites ios/.
python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 1800 \
  --record "$OUT/build.json" -- python3 app-store-screenshots/shoot.py build "$OUT/build"
APP="$OUT/build/derived/Build/Products/Release-iphonesimulator/OpenReader.app"
# 2. Each set, on a new simulator that is deleted afterwards (--keep keeps it).
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

## Uploading

App Store Connect → the version → Media Manager. Put each folder's four files
in its slot above, in file order. Smaller devices use the scaled-down set
unless one of their own is added. See
[App Store Connect reference](../docs/app-store-connect.md#metadata-and-review),
whose **Working in the page** covers the sign-in and blank pages.

- **Replacing a set**: Remove All, then confirm. It removes the set from this
  version only; the pictures stay in the media library.
- **The file input** of each slot sits in a shadow root, out of reach of
  `document.querySelectorAll`. Claude in Chrome's `find` returns a ref to it,
  and `file_upload` takes that ref with the four files in file order.
- **After an upload** a notice says the set serves every iPhone, or every
  iPad, size; OK closes it.
- **Done** is every screenshot's `assetDeliveryState` reading `COMPLETE`, read
  through `scripts/asc-api.mjs` from the version localization's
  `appScreenshotSets` with `include=appScreenshots`. The largest iPad files
  stay at `UPLOAD_COMPLETE` for several minutes; Add for Review waits for them.
