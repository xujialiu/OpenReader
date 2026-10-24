# Purchase and release-copy verification

Read [release-variants.md](release-variants.md) before testing the formal,
free or Debug copy (#324). Native role, Metro role and the version label must
agree; Xcode Debug/Release configuration does not choose the product role.

| Role | Purchase behavior | Runtime purchase record |
| --- | --- | --- |
| Formal | Real StoreKit; existing Trial/Unlock and source-bound fallback | `Library/Application Support/purchase.json` |
| Free | All features; no purchase module, UI or controller | Untouched |
| Debug | The same free access, with diagnostics | Untouched |

Debug has no pretend store and no `store` harness command. Use the formal
variant for purchase testing. Its Xcode-launched Run action names
`storekit/OpenReader.storekit`; `simctl`, `expo run:ios` and bare xcodebuild
do not activate that scheme configuration. Claim real local StoreKit
transactions only when that environment was actually established.

Host coverage: `test/build/`, `test/purchase/`, `test/app/purchase-*` and
`test/offline/runtime-purchase*`. These cover identity, physical-exclusion
contracts, cache/source isolation, Trial arithmetic, speech/Download gates,
Restore/refund behavior and free → formal handoff. Mocks do not establish
App Store, TestFlight or purchasing-account-switch behavior.

## Historical evidence

These preserve earlier measurements, not controls available in current Debug:

- [Legacy harness and Trial-expiry runs](legacy-purchase-harness.md): the
  removed fake/real `store` controls, `trial-end.sh` and `download-across-end.sh`.
- [Source and Restore](source-and-restore.md), and the
  [beta20 device record](beta20-source-restore.md).
- [Old unscoped Unlock](beta7-unscoped-unlock.md): #316's planted-record
  controls and the boundary between simulator and host evidence.
