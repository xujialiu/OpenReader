---
status: accepted
---

# Synthesize at natural pace; change speed only on playback

A provider is never asked to speak faster or slower. Every clip is synthesized
at the voice's natural pace, and the owner's reading speed is applied when the
clip is played, by a pitch-preserving time-stretch.

This carries over a decision the desktop plugin reached by removing a feature it
already had: `SynthesisOptions` has no speed parameter at all.

## Why

Asking the provider for a speed compounds with the player's own stretch, so the
two multiply. Providers disagree about what the parameter even means — some
ignore it, some genuinely re-synthesize at a different pace, and at least one
simply post-stretches the audio exactly as the player would. And already-fetched
clips keep the pace they were requested at, so changing the setting leaves the
next few utterances speaking at the old speed.

The decisive reason is the cache. The cache key is the provider, the voice and
the text — and **not** the speed. That is what makes a cached clip, a
pre-synthesized book and any future sharing of audio between devices possible at
all. Put speed in the key and nudging 1.5× to 1.6× discards every cached clip,
along with the quota and bandwidth already spent on it — which under ADR 0002 is
the owner's own money.

## Consequences

The playback engine must do pitch-preserving rate change itself. That is native
work on both platforms, not something the JavaScript side can provide.
