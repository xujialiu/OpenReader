# Drawer #361 final iOS verification (3dd2d14, tester run 2026-11-08)

Independent final verification of the iPad/Mac shared Drawer on current
source 3dd2d14 (branch xujialiu/fix--drawer-ios-test). Attempt directory:
`/tmp/openreader-drawer361-ios-qa-01` (raw logs, screenshots, trees, guard
records, measures). Metro 8362 from this worktree (PID 5622, debug variant).

## Devices

- `drawer-361-pad-01` EF3E47DA-C530-45CC-9BC8-9B70ECCD454B (iPad Air 11 M4,
  iPadOS 26.5) — transferred from the parent. Installed Debug shell 1.0.4,
  CFBundleVersion 30, Info RCTMetroPort 8293; native inputs byte-identical
  between 0361654 and 3dd2d14 (package/lock/modules/plugins/patches/
  app.config/app.json/ios, 0-byte diff), so the shell was reused with every
  launch pinned `-RCT_jsLocation localhost:8362`.
- `drawer-361-phone-01` E627518D-9AB2-47EF-8E49-E1EB114B9F15 (iPhone 17,
  iOS 26.5) — created by this run inside the shared admission after a
  memory_pressure check (37% free); first boot inside the guard; the reused
  Debug shell installed; Metro 8362 pinned the same way.

## Results per gate

Every green measurement below is native/painted, not props.

1. Readiness — PASS. `ios_ready.py … --metro http://127.0.0.1:8362` ready;
   the app registered on 8362; Debug Log launch lines read
   `OpenReader 1.0.4 (30)-beta19 … Debug Mode on, Metro bundle`.
2. Visible Settings version — PASS. Real touches (Library actions → Settings
   row → real grabber-drag dismiss → scroll): the footnote reads exactly
   `Version 1.0.4 (30)-beta19-debug` (settings-version-footnote.png).
3. Placement at staged heights 40/50/90 (harness-staged setting; real AXe
   opens) — GREEN all three, window 820x1180:
   - 40: x 119.5 y 655, 581x474, bottom gap 51
   - 50: x 119.5 y 537, 581x592, bottom gap 51
   - 90: x 65 top y, 581x1064 (y=65), bottom gap 51
   Width 581 ≈ the 580 ideal cap, centred (119.5 + 290.5 = 410); heights
   match the target share +2 pt paint; not page-sized, not dimmed, not
   narrow. 22 native trees: no `Close` control anywhere.
4. Interaction contract (drawer-interactions.py at 50) — PASS:
   opening background min RGB ≥ 250 (white, undimmed), real Settings/Library
   navigation behind the open drawer, real grabber expand → large + guard on
   + shaded background (180 ≤ RGB ≤ 225), expanded backdrop touch contracts
   to the opening height without navigating or dismissing (Q12, accepted),
   then real expand → contract → dismiss. `events.json` records each step.
5. System rotation (IpadRotationProbe, device rotation, 0 failures per run)
   — PASS both directions, drawer open throughout:
   - Landscape: window 1180x820; expanded retained (selection large, guard
     on), painted 579x726 centred, gap 52; opening detent re-rendered
     590 → 410 live.
   - Portrait: retained, detents back to 590; painted 579x1086 at large.
   - At opening: landscape 581x412 (y 357, gap 51), portrait 581x592 again.
   - CDP pollers (92 samples ~0.5 s apart across each rotation): zero
     non-presented samples — the same presentation instance, no
     re-presentation; poller resolution ~1 s is the stated limit.
   - XCUIScreen full-screen attachments kept in rotation-probe/attachments-*.
6. Real window-handle shrink/grow (iPadOS 26 windowing, real corner-handle
   drags; AX blind behind the desk surface → pixel+CDP driving):
   - RN's useWindowDimensions is the window authority; the opening detent
     equalled exactly 50% of it at every size seen: 828 → 414; 554 → 277;
     710.5 → 355.25.
   - Expanded (large) retained across every real shrink and grow
     (375x486 → 630.5x710.5), drawer continuously presented, guard on.
   - Same visible long-list content: rendered Contents rows constant
     (first "Chapter 10: First Man Down", last "Chapter 9: Wishful
     Thinking") and the painted rows identical across resizes.
   - Narrow windows use available width: painted 509.5 in 510, 374.5 in 375,
     630 in 630.5 (the 580 cap only applies at larger widths).
   - Windowed → fullscreen transition with the drawer open: retained, ratio
     recomputed to 590 = 50% of 1180, reader undimmed.
   - Dismiss + reopen resets the opening to the setting ratio of the current
     window (355.25 after reopen).
   - Native bottom chrome: about 51-52 pt fullscreen (accepted), about 6-11
     pt windowed — it follows the native presentation; not a fixed inset.
7. Ordinary iPhone (drawer-361-phone-01) — PASS:
   - Detent `{height: 412.78}` = drawerDetentHeight(50, {402, 874, inset
     34}) exactly; painted floating card x 8.33, width 385.33 (inset 8 pt
     each side), top y 436 ≈ 50% of 874; no Close.
   - Real drag flow usable: expand → grabber 69.5 (large), contract → back
     to the opening grabber position exactly (444.31), dismiss → gone.
8. Representative actions (on the phone; the iPad's input died mid-run —
   below): More actions drawer menu page shows the Share header action; the
   nested Appearance page opens with its `Back from Appearance` control; one
   real font-size increase and decrease restored the value (24 → 26 → 24;
   the ladder steps by two); Back returned to the menu page; the drawer
   dismissed by a real grabber drag.

## Environment checkpoint (input wedge, recurrence)

At ~18:19 touch delivery to drawer-361-pad-01 died (axe touch/tap,
mobilebuildmcp elementRef tap and the HID home button all answer success
without effect; describe-ui and screenshots keep working). One recorded
target-only shutdown/boot (recovery-used.json) restored it at 18:26 and all
verification above ran on real input after it. At ~19:20, after the heavy
windowing round-trip, the same wedge recurred (control: HID home no-op with
only an empty OpenReader root in the tree); the attempt's one recovery was
already spent, so no second reboot was taken: further iPad INPUT work is
BLOCKED at this checkpoint. Delivery state (Library, paused, Metro 8362) was
reached by relaunch; opening the drawer on delivery would need one owner tap.

## Limits

- The Mac Drawer (Escape/pointer) is out of scope here by the task.
- The system share sheet did not open from the AXe Share touch (known AXe
  system-sheet flakiness); the Share control's presence and enabled state are
  tree-verified. The XCTest ShareProbe route covers delivery elsewhere.
- Poller resolution (~1 s) bounds the no-re-presentation claim.
- Voice/Download/lookup shared-layout gates were not exercised (no provider
  configured, per the task's scoping rule).
