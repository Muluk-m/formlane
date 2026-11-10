# ADR 0002: One shared Base UI and Skyline system

Status: accepted, 2026-11-10.

## Context

Copying a palette while leaving native controls or reducing the shared library to a few hand-written components loses the reference's accessibility, interaction model, and visual consistency.

## Decision

Use `@atoms-demo/ui` as the sole application control source, retaining shadcn base-nova primitives and their full variants. Base UI is the underlying primitive implementation; polymorphism uses `render`. Use Hugeicons Stroke Rounded at 1.5 stroke width and the complete Skyline frontmatter/visual rules in root DESIGN.md.

Preserve reusable composites, including generic tables, dates, intl selectors, numbers, QR, page headers, and statuses. Remove domain-specific status vocabulary with no Atoms use. Application-specific chat/preview composition stays in web. All labels come from i18n. Atoms Demo is the product name; the inherited AD monogram now represents that name.

## Consequences

Appearance changes belong in shared variants/tokens, not caller overrides. Native-control linting applies to product code, not the implementation of primitives or user-generated HTML. Generated apps remain free to follow the user's requested design; Skyline governs the Atoms shell. Visual verification must check actual rendering, especially Base UI orientation and focus behavior.
