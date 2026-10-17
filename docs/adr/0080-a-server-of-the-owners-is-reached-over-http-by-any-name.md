---
status: accepted
---

# A server of the owner's is reached over http:// by any name

Kokoro FastAPI, OpenAI Compatible and the Sync Folder go to an address the
owner types. A server of his own is often plain `http://` under a dotted name:
Tailscale's full MagicDNS name (`http://mac-mini.tailnet.ts.net:8880`) or a
name a home router gives out (`http://tts.home.lan:8004`). The built app
refused every such request before it was sent (#210). The owner chose on
2026-10-18 that the app reaches such an address, rather than telling him which
forms of address can work.

## What the system did with the template's keys

`app.config.ts` set no `ios.infoPlist`, so a prebuild kept the template's
`NSAppTransportSecurity`: `NSAllowsArbitraryLoads` false and
`NSAllowsLocalNetworking` true (`node_modules/expo/template.tgz`,
`ios/HelloWorld/Info.plist`). The Release build 1.0.0 (7) and the Debug build
1.0.0 (6) both carried exactly that dictionary.

Apple's page for `NSAllowsLocalNetworking` says it lets the app reach
unqualified domains, `.local` domains and IP addresses; its page for
`NSAllowsArbitraryLoads` says that key's value is ignored, and NO used, while
`NSAllowsLocalNetworking`, `NSAllowsArbitraryLoadsForMedia` or
`NSAllowsArbitraryLoadsInWebContent` is present. Measured in #210 on macOS 27.0.1
with a command-line program carrying each dictionary as its `Info.plist`,
through `URLSession`'s default configuration: `127.0.0.1`, `localhost` and the
Mac's `.local` name answered 200 under the template's dictionary, and the
dotted name `atscheck.localhost` failed with `NSURLErrorDomain -1022` ("The
resource could not be loaded because the App Transport Security policy requires
the use of a secure connection.") while the server logged no request. With
`NSAllowsArbitraryLoads` true as the only key the dotted name answered 200;
with both keys true it failed with -1022 again.

## The decision

`ios.infoPlist.NSAppTransportSecurity` is `{ NSAllowsArbitraryLoads: true }`,
alone. Expo's v57 config reference says `ios.infoPlist` is applied before all
other Expo-specific configuration, and `@expo/config-plugins` spreads it over
the template's `Info.plist` at the top level, so the dictionary replaces the
template's whole and `NSAllowsLocalNetworking` goes with it.
`npx expo config --type introspect` gives `{"NSAllowsArbitraryLoads": true}`.
IP addresses, `.local` names and names without a dot stay reachable: with ATS
off nothing is refused for its host. `test/app-config.test.ts` holds the
dictionary and the three keys that would undo it.

## What it costs

- **HTTPS loses ATS's extra checks.** Apple: HTTPS connections are still
  subject to the default server trust evaluation, but checks such as the
  minimum TLS version are disabled. The app does not loosen server trust itself.
- **The reader's page can load an `http://` resource a Document names**, as it
  can an `https://` one today: ATS applies to the web view too, and the
  library's WebView is given `originWhitelist: ['*']`. A Document's script still
  does not run (ADR 0077).
- **App Review asks for a justification** of the key. The sentence for the
  review notes is in `docs/release-to-app-store.md`.
- **It is native.** It reaches the app through a prebuild, so the simulator's
  and the phone's builds have to be rebuilt to carry it.

## Kokoro's question

Kokoro's message for a request that did not get through asked "Is the server
running?" before the system's reason. Where that reason is about the secure
connection (a TLS failure, a certificate, an ATS refusal) the server was
reached, or never asked, and the question sent the owner to the wrong place, so
it is left out there (`SECURE_CONNECTION` in `kokoro.ts`). Expo's fetch carries
only the error's `localizedDescription` (`UnexpectedException`), so the match
is on the English wording; a reason worded otherwise keeps the question.

## Alternatives turned down

- **Keep ATS and say on the Provider screen which forms of address work.** No
  native change and no question at review, but a server named by a domain would
  have to be put behind HTTPS, and a Sync Folder at `http://` on a NAS by name
  could not be used at all.
- **`NSExceptionDomains`.** It names domains fixed in the build; the owner's are
  not known.
- **Both keys true.** Measured above: the dotted name failed with -1022 again.
