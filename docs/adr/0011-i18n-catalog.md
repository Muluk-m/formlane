# ADR 0011: One English/Chinese message catalog

Status: accepted, 2026-11-10.

## Context

Atoms already has bilingual behavior. Copied components and legacy dictionaries can create competing copy sources, inconsistent brand names, and untranslated accessible controls.

## Decision

`packages/i18n` owns the English and Chinese catalogs, locale helpers, and React integration under `@atoms-demo/i18n`. Application copy, primitive defaults, status labels, agent descriptions, form errors, and accessible names use shared keys. `brand.name` is **Formlane** in both locales. Use the configured default locale rather than establishing a second fallback convention.

Documentation, code explanations, and commit descriptions are English. Generated HTML follows the user's requested language and is not the application's translation catalog. Native CrewAI/provider prompts belong to backend behavior; fixed public API errors retain contract/catalog mapping rather than exposing arbitrary provider messages.

## Consequences

Update both locales together and keep parameter/key typing consistent. Shared UI can render outside an application provider using the package fallback, but application locale selection must remain persistent and coherent. Do not leave business-only copied catalog entries as an alternative product vocabulary.
