#!/usr/bin/env node
// KEYCHAIN-CREDENTIAL-PROBE — save and read back a synthetic Provider API key
// through the app's own `src/keys/store.ts` module over CDP. This is native
// Keychain/storage evidence (kSecClassGenericPassword through expo-secure-store),
// NOT touch input and NOT a claim that the Settings form works.
//
// Prerequisites: a running Debug app connected to its Metro, an intended
// Provider id whose Keychain entry must be ABSENT (the probe refuses to
// overwrite an existing secret), and no real secret values anywhere.
//
//   # 1. arm (returns 'armed'; the work runs in the app's JS runtime)
//   node test/manual-test/kit/cdp.cjs --eval /tmp/arm.js http://127.0.0.1:8081
//   # 2. poll (a fresh CDP connection each time; globalThis persists)
//   node test/manual-test/kit/cdp.cjs --eval /tmp/poll.js http://127.0.0.1:8081
//
// The arm file must define the arm expression below; `poll.js` prints
// `MARK done entry=… before=… saved=… read=… equal=true` when finished.
// The synthetic value never leaves the app: only outcomes, the entry NAME and
// its LENGTH are reported back. The Debug Log's credential guard records the
// entry (ADR 0054) — that is the app working as designed.
//
// Used to seed the #345 upgrade-baseline credential after AXe typing could not
// reach the masked field (see /tmp run of 2026-11-06; baseline report gaps):
// `before=absent saved=done read=found equal=true` for entry
// `provider-key.compatible`.
//
// ARM expression (keep in sync with the header above):
//
// (function () {
//   function modBySuffix(suffix) {
//     let idFound;
//     __r.getModules().forEach((m, id) => { if ((m.verboseName ?? '').endsWith(suffix)) idFound = id; });
//     if (idFound === undefined) throw Error('module not registered: ' + suffix);
//     return __r(idFound);
//   }
//   const store = modBySuffix('src/keys/store.ts');
//   const entry = modBySuffix('src/keys/entry-name.ts').providerKeyEntryName('compatible');
//   const SYNTH = 'synthetic-' + Date.now().toString(36);
//   globalThis.__keyProbe = { stage: 'started' };
//   (async () => {
//     try {
//       const before = await store.readProviderKey('compatible');
//       if (before.outcome !== 'absent') {
//         globalThis.__keyProbe = { stage: 'done', entry, before: before.outcome, saved: 'skipped', readOutcome: null, equal: false, note: 'existing entry present; nothing overwritten' };
//         return;
//       }
//       const saved = await store.saveProviderKey('compatible', SYNTH);
//       const after = await store.readProviderKey('compatible');
//       globalThis.__keyProbe = { stage: 'done', entry, before: 'absent', saved: saved.outcome, readOutcome: after.outcome, equal: after.outcome === 'found' && after.secret === SYNTH, readLen: after.outcome === 'found' ? after.secret.length : null, synthLen: SYNTH.length };
//     } catch (e) { globalThis.__keyProbe = { stage: 'failed', entry, error: String((e && e.message) || e) }; }
//   })();
//   return 'armed';
// })()
//
// POLL expression:
//
// globalThis.__keyProbe ? ('MARK ' + globalThis.__keyProbe.stage + ' entry=' + globalThis.__keyProbe.entry +
//   ' before=' + globalThis.__keyProbe.before + ' saved=' + globalThis.__keyProbe.saved +
//   ' read=' + globalThis.__keyProbe.readOutcome + ' equal=' + globalThis.__keyProbe.equal +
//   (globalThis.__keyProbe.error ? ' error=' + globalThis.__keyProbe.error : '') +
//   (globalThis.__keyProbe.note ? ' note=' + globalThis.__keyProbe.note : '')) : 'pending'
//
// What it cannot prove: that the Settings screen's own Save flow, keyboard
// routing or masked field rendering works; that the key is used on the
// synthesis path; anything about real credentials.
