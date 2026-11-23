# OpenReader agents

| Role | When to dispatch |
| --- | --- |
| [app-installer](app-installer.md) | Build, install or reconnect a source-changing bundle on the assigned simulator and return the installation receipt. |
| [app-tester](app-tester.md) | Exercise changed behavior on the relevant devices and return observations and evidence. |
| [app-screenshot](app-screenshot.md) | Capture a named app screen, a README still or GIF, or an App Store screenshot set. |
| [resource-cleaner](resource-cleaner.md) | Release the session resources authorized for cleanup. |

Dispatch from the assigned sub-worktree with the source and target from the [handoff guide](../docs/agents/app-workflow.md). Codex and pi role definitions live in `.codex/agents/` and `.pi/agents/`. Claude Code's screenshot role invokes pi so the capture itself runs on `gpt-6.1-terra` with `max` reasoning in all three harnesses.

## GLM quota fallback

Start each subagent with its configured model. When the provider reports that the GLM usage allowance is exhausted, continue the same assignment with `gpt-6-luna` at reasoning effort `xhigh`. This switch is preauthorized.

If the named role pins GLM, dispatch a worker with the explicit model and effort and give it the same role instructions, working directory, source, and latest checkpoint. Carry forward the evidence and any recovery already spent. Report the quota error and the model used. An empty result or a timeout alone does not establish quota exhaustion.
