# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Asking the owner

Put each decision that is the owner's — a choice in a grilling round, a batch's acceptance, a finding that changes the plan — to them as a question they answer by choosing, through the harness's question tool (`AskUserQuestion` in Claude Code), with the recommended option first. The reasoning goes in the reply above the question. A custom answer is the decision it states, and it often differs from every option offered.

# Read before you act

Each file under `MEMORY/` holds the rules for one kind of work. Read it in full when its trigger applies, before the first step it governs.

- **Issues** — [MEMORY/github-workflow.md](MEMORY/github-workflow.md): a feature, bug fix or substantial change starts with an issue; small, clear chores go straight ahead. Read before starting such work, and before creating, labelling, commenting on or closing an issue.
- **Interface** — [MEMORY/interface.md](MEMORY/interface.md): before adding or changing any text, screen, control or drawer the owner sees.
- **Documentation** — [MEMORY/documentation.md](MEMORY/documentation.md): before writing to `docs/design/`, `docs/adr/`, `notes/` or `CONTEXT.md`, or when a term or decision changes.
- **Delegation** — [MEMORY/delegation.md](MEMORY/delegation.md): before handing work to another agent, waiting on one, or running work in parallel.
- **App change** — [MEMORY/app-change.md](MEMORY/app-change.md): after any change to app code, before calling it done: beta version, `ios-tester`, latest app left in the simulator.
- **Device testing** — [MEMORY/device-testing.md](MEMORY/device-testing.md): before running or writing a simulator, device or manual test, or playing any audio.
- **Cleanup** — [MEMORY/cleanup.md](MEMORY/cleanup.md): when all tasks are done and committed, before the final reply.
- **iPhone** — [docs/install-on-iphone.md](docs/install-on-iphone.md): before installing on the owner's iPhone, fixing its signing or provisioning, or building a standalone Release for it. In anything committed, write its UDID as `IPHONE_UDID`; look up the real one with `xcrun devicectl list devices`.
- **Simulator** — [docs/install-on-simulator.md](docs/install-on-simulator.md): before installing or updating the simulator app, or fixing a Metro connection or simulator build.
