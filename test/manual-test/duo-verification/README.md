# Duo verification preparation

Recipes, probes and host evidence checks for the remaining Duo verification
and related platform/diagnostic gates. **Preparation, not acceptance:** host
checks validate the tools, not native behavior or issue completion. Runtime
measurements require the admitted tester lane and parent review.

- [Duo acceptance controls](duo-acceptance.md) (#350–#354): visible selection
  and handles, held lookup results, system windows, audio/Following and
  Appearance preview, with separate native evidence requirements.
- [Diagnostic controls](diagnostics.md) (#357/#358): crash-attribution evidence
  and bounded, read-only simulator-volume observation; neither supplies a
  native crash reproduction nor continuing-silence acceptance.
- [Mac runtime gates](platforms.md) (#355): authorized current-app launch,
  resizing and interaction checks, not an installation or passed-run record.

#356 is cancelled and closed as not planned; no physical-Duo coverage is
claimed here. Use the [manual-test index](../README.md) and [shared kit](../kit/README.md)
for prerequisites and existing tools.
