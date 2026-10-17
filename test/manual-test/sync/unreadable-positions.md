# An unreadable Positions File is not an ordinary sync (#178)

Use an isolated local server, never a real Sync Folder. The transport's warning
rides `SyncOutcome.warning` into the existing status Footnote and the Debug Log.

## Server and setup

`fix2-dav-stub.cjs` answers PROPFIND, GET, PUT and MKCOL, and keeps its files in a
directory the host can change between runs:

```sh
node test/manual-test/sync/fix2-dav-stub.cjs PORT /tmp/openreader-recovery-dav
# xujialiu-positions.json  the file the app reads and replaces; absent = GET 404
# PUT_FAIL                 while present, PUT answers 500 and stores nothing
# access.log               request method, status and stored bytes; no credentials
```

Choose a free port and a directory owned by this test. The server listens only
on loopback. No real credentials are needed: the stub accepts any Basic auth,
and `use-sync` sends an empty password when the Keychain has none.

Setup through `kit/hx.cjs` is handler-based, not a test of the Sync switch:

1. Add a fixture Document through `Inbox` and harness `add`. Patch the whole
   sync object, substituting the chosen port:
   `{"do":"settings","patch":{"sync":{"url":"http://127.0.0.1:PORT/recovery/","username":"tester","enabled":false}}}`.
   A settings patch replaces nested objects wholesale; patching only `enabled`
   would discard the address and username.
2. To trigger a forced run, patch the complete object with `enabled:false`,
   allow that state to render, then patch it with `enabled:true`. This invokes
   the real switch-on sync path and bypasses a prior failure's retry window.
3. For cases needing a local Reading Position, use harness `open` and `seek`,
   then check `shelf`. This exercises the position-write path without playing
   audio; it does not prove timed saving during a live Reading.

## Cases

Inspect the stub's `access.log`, the app's files under
`Library/Application Support/debug-log/`, and the Sync screen's Footnote.
`debugLog` does not write its lines to Metro's console.

| Server state | Expected |
| --- | --- |
| file absent | Ordinary successful sync, no warning. Upload only when the device holds positions. |
| `{not json`, no local positions | Cannot-read and not-replaced warning; no PUT, bytes unchanged. |
| `{not json`, one local position | PUT stores the canonical file; warning says it was replaced; Footnote uses the attention style. |
| `{not json` plus `PUT_FAIL` | Upload failure and replacement-not-confirmed warning; the stub stores nothing. |
| `{"format":"xujialiu-positions","version":2,"items":[]}` | Frozen outcome; no adoption or PUT, original bytes unchanged. |
| Valid canonical file after a repaired run | Ordinary outcome with no earlier warning. |

For the #179 adoption check, give the same Document a newer remote stamp and
another Text Anchor. The next sync must adopt the position without clearing an
unrelated Library failure note.

## Limits and cleanup

The stub's HTTP 500 is a refused PUT, not a lost reply. The case where the
server writes but its response is lost is covered by
`test/app/sync-unreadable-file.test.ts`. This recipe does not prove HTTPS,
physical-device behavior, or a native touch on the Sync switch.

Neutralize `harness.json` before relaunching, restore any modified fixture
files/settings, and stop only this run's stub when finished. Record measurements
and failed setup attempts in `notes/`, not as extra steps in this recipe.
