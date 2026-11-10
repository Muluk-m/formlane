# @atoms-demo/ui

The sole interface component source: shadcn base-nova on Base UI. Read [DESIGN.md](../../DESIGN.md) before changing appearance, tokens, icons, or variants.

- `src/components/` retains the full generated primitive family and variants. Application controls consume these; do not replace them with a reduced hand-written button/card kit.
- `src/composites/` contains reusable composition: status, tables, dates, locale/intl controls, numbers, QR, key/value rows, page headers, and the brand. Feature-specific workspace components stay in the web application.
- `src/styles/globals.css` implements Skyline tokens, bundled fonts, and Base UI orientation adapters. Edit DESIGN.md before changing token values.
- External imports use `@atoms-demo/ui/components/<name>` or `/composites/<name>`; internal imports use the configured `#components`, `#composites`, `#lib`, `#hooks`, and `#brand` aliases.
- Base UI uses `render` for polymorphism. Preserve every existing variant and accessibility behavior when regenerating a primitive.
- Use Hugeicons Stroke Rounded with `strokeWidth={1.5}`. Keep the registry's `iconLibrary: hugeicons`; do not introduce another icon family.
- Appearance belongs in shared variants; consumer className is layout-only. The app is light-only; inherited dark selectors are not a separate supported theme.
- Visible labels and accessible names use `@atoms-demo/i18n/react`. `Logo` uses the shared `brand.name`; the Atoms Demo mark geometry is defined only in `src/brand/logo.ts`.

When adding a component, use the existing registry configuration and review generated token/variant changes before accepting them. Target the relevant component test file; the integration owner coordinates typechecking and visual verification after shared work lands. Never run parallel full-suite checks while other packages are being edited.
