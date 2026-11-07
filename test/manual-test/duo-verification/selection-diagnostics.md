# Selection diagnostics: read-only H1/H4/H5 preparation (#350/#355)

**HOST-tested preparation only; runtime execution needs parent approval and the existing admitted lane.** The fixture is `Word Boundaries for Lookup`, section 0, selected `Even` or `hope`. This does not focus, change Selection/DOM/CSS, scroll, request geometry, install listeners/wrappers or inspect private highlighter closures. Computed-style reads can make the browser flush pending style work; this is not an uninstrumented timing control.

Host check: `npx vitest run test/manual-test/duo-verification/selection-diagnostics.test.ts`.

Later admitted simulator use (send only; retain the fresh matching `[probe]` answer):
```sh
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"seq":FRESH_MONOTONIC_INTEGER}' --code-file test/manual-test/duo-verification/selection-diagnostics.js
```
Replace the integer placeholder with a number above the running sender's consumed floor. Do not run `hx.cjs` on Mac or alongside another harness writer. The default marker is generated at page execution; a Mac loop should use its existing atomic sender and explicit UUID markers instead.

## Mac loop attachment, only after parent review

The current `mac-selection-paint.py` calls the native-loop sender **`Sender`**, owned as `NativeLoop.sender` (not a separate `NativeLoopSender` class). In the owning verifier's driver, use that **same** instance; do not create another writer. The following attachment reads the new file through the existing `do:js` convention, without app-source changes:
```python
source = Path('test/manual-test/duo-verification/selection-diagnostics.js').read_text()
def selection_diagnostics(sender):
    marker = 'selection-' + uuid.uuid4().hex
    code = source + '\nreturn probe(' + json.dumps(marker) + ');'
    match = sender.ask({'do': 'js', 'code': code},
                       r'\[probe\] (\{.*"marker":"' + marker + r'".*\})')
    value = json.loads(match[1])
    require(value['marker'] == marker and abs(time.time()*1000-value['at']) < 5000, 'Stale diagnostics')
    return value
```
`Path`, `uuid`, `json`, `time`, and `require` already exist in that helper. No driver changes are included here. After later authorization, the exact attachment inside `NativeLoop.checkpoint(role)`, immediately before its existing checkpoint save, is `save(self.out / (role + '-selection-diagnostics.json'), selection_diagnostics(self.sender))`. Its three existing callsites then save independently marked `baseline`, `control` and `after` sidecars before the preservation assertion can exit red. `baseline` and no-resize `control` must have the genuine native painted-word positive; `after` follows the delivered actual shrink and measured settle. Preserve the loop's existing identity/range/service/count/pixel guards and original receipts. Account for three extra bounded asks in the phase budget; never retimestamp, reuse an old receipt or weaken freshness to fit. A `BLOCKED` diagnostic must be retained as incomplete evidence, not converted into a native app verdict.

## Receipt interpretation and limits

`DEBUG-SELECTION`, schema 1, reports outer focus/active tag and **all matching section instances**, including hidden/unavailable ones. Each has existing library view/frame IDs, connection/display/visibility, document-frame ownership, focus/active tag, and selection text/CFI/endpoints/backward. Visibility/display arrays are `[view element, iframe]`; ancestors are `[tag, user-select, -webkit-user-select]`. Pseudo `selectionStyle` is `[reported backgroundColor, reported color]`, or null when unsupported: computed values are not reliable evidence of native selection rendering. `highlightStyle` records presence only, not effective cascade.

Caps: 16 total views, two matching instances, four selected-start ancestors, 64-character IDs/marker/style values, 20-character tags, 128-character numeric fixture CFI, and 1800 ASCII bytes including JSON. Overflow returns explicit `BLOCKED`; no fields/instances are silently truncated. Endpoint ancestor styles cover the supported single-word fixture, not arbitrary multi-element selections. No URLs, credentials, surrounding passages or exception messages are returned.

Match selected CFI/text/direction to each existing native checkpoint, **not frame-ID equality**: iframe replacement is expected. IDs are library labels, not independent object-generation proof; same IDs do not prove object identity. DOM focus is not native first-responder ownership. These observations neither establish H1/H4/H5 causality nor prove blue paint, handles, request continuity, Browsing/Reading Position preservation or #351 pending-result acceptance. Native paint/handle evidence stays mandatory. No focus experiment is authorized. Cleanup: no in-page state/listeners to remove; the owning sender still clears only its own commands through its existing cleanup.
