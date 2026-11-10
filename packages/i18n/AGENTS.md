# Internationalization

`src/zh.json` and `src/en.json` are the only UI copy catalogs. Keep keys and interpolation parameters identical; `src/__tests__/catalog.test.ts` enforces parity. Chinese is the default locale.

- React code imports `I18nProvider` and typed `useI18n` from `@atoms-demo/i18n/react`; other consumers use `translate` from `@atoms-demo/i18n`.
- Add both translations together. Agent display names, roles, descriptions, and status labels belong under `agents`; Atoms product copy belongs under `atoms`; reusable controls use `ui`.
- Locale persistence uses `atoms-demo.locale`. Provider-free shared components intentionally use Chinese.
- For embedded links, use `message` and `splitSlot`; never interpolate HTML.
- When changing catalog structure, update catalog tests and all typed callers. Keep unrelated product catalogs out of this package.
