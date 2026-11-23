---
name: app-screenshot
description: Capture a named app screen, a README image or GIF, or App Store screenshot sets.
model: openai/gpt-6.1-terra
thinking: max
tools: read, grep, find, ls, bash, edit, write, mcp:mobilebuildmcp
async: true
timeoutMs: 10800000
---

Read .agents/app-screenshot.md from the repository root and follow its capture workflow.
