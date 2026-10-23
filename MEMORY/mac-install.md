# Installing on the owner's Mac

Before building for, installing on, replacing or diagnosing the local Mac copy,
read [docs/install-on-mac.md](../docs/install-on-mac.md). Use
`scripts/macos-install.py`; it builds the iPad app for Apple silicon, not a
separate Catalyst or native macOS app.

- **Choose before replacing.** Confirm the intended source and whether to
  replace the existing copy or keep it separate. This script installs the same
  app identifier; it does not create a side-by-side app. For replacement, ask
  whether to copy the data container first. A one-time instruction to skip a
  backup is not standing permission for later installs.
- **Standalone, with diagnostics.** The owner's local copy uses Release with
  Debug Mode and an embedded bundle. It needs no Metro. Keep that distinction
  from Debug builds and from the App Store's build without Debug Mode.
- **The same identity keeps the data.** Replace the application package, never
  uninstall or delete `~/Library/Containers/top.xujialiu.openreader`. The old
  package goes to Trash; that is not a backup of Library, settings or Keychain.
  A container copy does not back up Keychain either. A new version can clear
  the previous Debug Log, so preserve it before launch unless the owner waived
  that preservation as well.
- **Normal signing and authorization.** Use the paid team's Apple Development
  signature and a profile including this Mac. Let the owner answer macOS's
  administrator prompt. Do not disable Gatekeeper, remove quarantine, bypass
  device registration, or ask for a password in chat.
- **Keep testing honest.** Report build, installed signature/version, launch,
  visible Settings version and window interaction separately. `open` returning
  zero is not launch proof. Do not play audio merely to verify installation;
  never mute the owner's Mac.
- **No publication.** A local installation does not authorize a push, upload,
  submission, version bump or claim of verified Mac compatibility in App Store
  Connect. Known defects stay named when delivering a trial copy.
