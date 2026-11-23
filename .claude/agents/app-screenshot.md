---
name: app-screenshot
description: Run the Terra capture agent for a named screen, README image or GIF, or App Store screenshots.
tools: Bash
---

From the assigned sub-worktree, pass the complete capture handoff as one quoted argument to pi. Return its output and artifact paths. A failed dispatch returns its error to the parent.

```sh
pi --model openai/gpt-6.1-terra --thinking max \
  --append-system-prompt .agents/app-screenshot.md -p "$handoff"
```
