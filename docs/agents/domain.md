# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the single product glossary for Formlane (this repo keeps the `CONTEXT.md` name instead of `GLOSSARY.md`).
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. `docs/adr/README.md` marks superseded decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; the `/domain-modeling` skill creates or extends them when terms or decisions actually get resolved.

## File structure

Single-context repo: the web app, Python backend and shared packages all serve one product.

```
/
├── CONTEXT.md
├── docs/adr/
└── apps/, packages/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary avoids.

If the concept you need isn't in the glossary yet, either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0015 (flow-first delivery), but worth reopening because…_
