---
status: accepted
---

# react-dom follows the react the project pins

Purely technical: there is no `docs/design/0039`. Nothing the owner sees changes,
and the measurement below says so in the strongest form available — the iOS
bundle is byte-identical either way. What changes is that a clone of this
repository installs.

## What npm was doing

Measured for #42 on 2026-09-22, npm 10.9.8, node v22.23.2; the runs are in
`notes/NOTES_2026-09-23.md` from 02:43.

`npm ci` on a clean checkout exited 1 before installing anything, with
`Conflicting peer dependency: react@19.3.0`. Since 538fa10 (#32, #33) the only
way to install this project was `npm ci --legacy-peer-deps`, and every new
worktree met that wall first.

**`react-dom` is in the tree only as a peer, and nothing optional is what puts
it there.** `@expo/ui`'s own `react-dom` peer is optional, and so is `expo`'s.
But `@expo/ui` *depends* on `vaul` and six `@radix-ui/*` packages for its web
components, and their `react-dom` peer is **not** optional. Their range is
`^16.8 || ^17.0 || ^18.0 || ^19.0`, so npm places the newest `react-dom` it can
find — 19.3.0 — whose own peer is `react@^19.3.0`, while this project pins
`react@19.2.3`. The pair npm wrote down is one React itself does not support.

**The lockfile was written with `--legacy-peer-deps`, which is the flag that
stops npm checking.** `npm ci` checks, and refuses. There is no `.npmrc` in the
repository or in `$HOME`, and `npm config get legacy-peer-deps` is `false`, so
the flag was passed by hand when `@expo/ui` was added.

**Regenerating the lockfile does not repair it.** `npm install
--package-lock-only` with no flags keeps the locked `react-dom@19.3.0` and fails
with the same ERESOLVE: npm does not search downward for a `react-dom` whose
peer the pinned `react` satisfies. A lockfile that got into this state cannot
get out of it by being rewritten; something has to name the version.

**`^19.2.3` would name the wrong one.** `react-dom@19.2.8` is published and its
peer is `react@^19.2.8`, which `react@19.2.3` does not satisfy, so a caret range
resolves straight back into a conflict. The version has to be the pinned one
exactly.

**Expo names the same version.** `expo/bundledNativeModules.json` in SDK 57 has
`react` 19.2.3 and `react-dom` 19.2.3 — one number, both packages. Expo was
never asking for the pair that failed.

## Decision

**`package.json` carries one override, `"react-dom": "$react"`.**

`$react` is npm's reference to the spec of a direct dependency, so the override
is whatever `react` this project pins — today 19.2.3, tomorrow whatever an Expo
upgrade moves it to. There is no second number to remember to edit, which is the
drift this issue was made of. `react-dom` stays a peer rather than becoming a
declared dependency, because nothing here imports it: it exists for `@expo/ui`'s
web components, which this app never renders.

`test/lockfile.test.ts` holds the lockfile to it, reading the version Expo
expects from `expo/bundledNativeModules.json` rather than from a number written
down in the test.

## Consequences

- `npm ci` with no flags installs 831 packages in 4 s on a checkout with no
  `node_modules`, and `--legacy-peer-deps` is no longer part of any instruction
  in this repository. `npm ci --dry-run --ignore-scripts` is the 0.6 s form of
  the same check.
- The lockfile changed by exactly two nodes: `react-dom` 19.3.0 → 19.2.3, and
  `node_modules/react-dom/node_modules/scheduler@0.28.0` disappeared, because
  19.2.3 wants `scheduler@^0.27.0` and shares the root copy `react` and
  `react-native` already use. One duplicate package fewer.
- **The app is unchanged, and this is measured, not argued.** `npx expo export
  --platform ios` from the tree with `react-dom@19.3.0` and from the tree with
  19.2.3 produced the same Hermes bundle, down to its content hash
  (`index-7d7fa648d6374fccc875dcb766c70fbe.hbc`). So `app-version.ts` does not
  move for this change: the number is there to say which build is running, and
  a new number on identical bytes would say a difference that does not exist.
- If some future package needs a `react-dom` other than the pinned `react`'s
  version, npm now fails loudly at install time instead of writing down a
  mismatched pair. That failure is the point, and the answer to it will be to
  move `react`, not to widen the override.
- `npx expo install --check` reports "Dependencies are up to date".

## Alternatives turned down

- **Declare `react-dom@19.2.3` as a direct dependency**, which is what `npx expo
  install react-dom` does for a project that also builds for web. It installs,
  but it announces a package the native app never imports, and its version then
  has to be bumped by hand in step with `react` at every Expo upgrade — the same
  two numbers drifting apart, one line higher up the file.
- **Move `react` to 19.3.0** so that the `react-dom` already in the lockfile
  fits. Expo SDK 57 names 19.2.3 and `react-native@0.86.3` is tested against it;
  `expo install --check` would report the mismatch and the next `expo install`
  would pull it back.
- **Commit an `.npmrc` with `legacy-peer-deps=true`.** It would end the flag
  being something each new worktree has to discover, which is the one good thing
  about it, at the price of never being told about the next conflict — for every
  command, forever, and silently installing pairs React does not support.
- **Drop `@expo/ui`.** ADR 0035 chose it for the short menus; the conflict is
  its web components' dependencies, not the part this app uses.
