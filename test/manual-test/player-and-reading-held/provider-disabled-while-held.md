# Disabling the active Provider while a Reading is held (#68, handler probe)

Not a real-touch script — a harness sequence run once, 2026-09-26, to answer
whether something in Settings that stops an in-progress Reading leaves the
Library's button in place. With the fixture playing and left while playing
(`{"do":"play"}` then `{"do":"shut"}`, both handler actions — the same
`goBack` the back arrow itself calls), patching `enabledProviders` to remove
the Voice's own provider (`{"do":"settings","patch":{"enabledProviders":[]}}`,
never the Keychain — no credential was read, written or displayed) stopped the
reading within one tick: `HX status playing=false …` followed by
`HX note attention=true "Fish Audio is disabled. Choose an enabled
provider."`. The button stayed (screenshot, partly covered by the LogBox
banner). Restoring `enabledProviders` to the original list (confirmed by
`{"do":"saysettings"}` matching the session's starting settings exactly) and
leaving the reader while the reading was already stopped left a clean Library
with no button. This is a handler-action result, not a real Settings-UI
toggle of Fish's own "Use this provider" switch, which the freeze-while-on
rule (#48, design 0041) may gate differently.

Since #103, emptying `enabledProviders` gives `No provider is enabled. Enable
one in Settings to listen.` instead; the Fish sentence above is what 2026-09-26
measured. It still appears when another Provider stays enabled.
