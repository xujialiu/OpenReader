# Issue 86 verification — measurements (fake Kokoro on 127.0.0.1:8791, logs UTC; app Debug Log +08:00)

All on iPhone 18 issue86 (9F8F6EE8-90A7-411E-AF61-54700D1E12E5), Metro 8099, this tree @ 3c54209.

## E1 tap while playing, 20:02 (rate 1.5 default)
- press (real touch, Tap86Probe) -> app seek line 20:02:55.421 "seek to utterance 6"
- engine window jumped to the new cursor at once: fetches for utt 7,8 at 55.484 (63 ms after the seek line), utt 9 at 55.523
- utt 6 itself was already in flight (read-ahead had just reached it at 54.945: cursor 3, window 3..6, rate 1.5)
- highlight cued utt 6 at 55.980; the old queue's next (utt 3, due ~55.78) never cued; highlight never went back
- pause at utterance 7 (20:02:57.815) — reading proceeded 6 -> 7 normally

## E2 five quick next-sentence presses, 20:10 (rate 1)
- presses (probe print, s): 53.924, 54.420, 54.745, 55.080, 55.416 (330-500 ms apart — all inside one old 600 ms window)
- app: skip from 1->2 (54.076), 2->3 (54.550), 3->4 (54.883), 4->5 (55.199), 5->6 (55.553); each seek line same ms as its skip line
- ended at utterance 6 = start+5; pause at utterance 6
- no fetches: every target already cached by earlier runs (cache-hit seeks are immediate)

## E3 four skips while playing, 20:12 (rate 1), after paused seek(12) which warmed 12-15
- Play at 12 (07.310). press prev-sentence 09.700 -> skip from 12 -> seek 11 (09.850, same ms) -> fresh fetch utt 11: synthesis start 09.984 (134 ms after the skip line), POST 200 10.086
- press next-sentence 12.380 -> from 11 -> seek 12 (12.520, cache hit, instant)
- press next-paragraph 15.034 -> from 13 (clip boundary had moved 12->13) -> seek 14 (15.167, instant; fetch 16/17 at 15.063/15.267 from the boundary's own read-ahead)
- press previous-paragraph 17.684 -> from 15 -> seek 14 (17.833, instant; fetch 18 at 17.722 from boundary read-ahead)
- pause at utterance 14. No 600 ms gap anywhere.

## E4 paused taps/skips
- paused tap (20:01, real touch): seek to utterance 6, no fetch, no sound (probe 5.6 s 0 failures)
- paused skips (20:15:52-20:16:05, real touches): next 14->15 (01.716), previous 15->14 (05.156), playing=false throughout, zero fetches
