# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. Layout: **single-context**.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. An ADR `docs/adr/NNNN-…` may have a twin `docs/design/NNNN-…` with the same number, the same decision written for someone who does not read code; read it when the trade-off for the reader matters.

## File structure

```
/
├── CONTEXT.md        ← the glossary, and nothing else
├── docs/
│   ├── adr/          ← engineering record, NNNN-slug.md with status: front matter
│   └── design/       ← the same decisions for a non-coder, paired by number
└── src/
```

## Writing to them

Before writing to `CONTEXT.md`, `docs/adr/` or `docs/design/` (for example from `/domain-modeling`), read `MEMORY/documentation.md`: it decides which file a thing belongs in and how ADRs and design files share numbers.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
