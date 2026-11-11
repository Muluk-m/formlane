# Web workspace

Use the root engineering guidance and shared Skyline tokens. Application navigation lives in `src/App.tsx`; product orchestration lives in pages and feature modules.

## Data and forms

- Define contract-derived query options in `src/features/<domain>/queries.ts` and mutation options in `mutations.ts`. Pages consume these options rather than constructing oRPC calls.
- Keep session bootstrap, authenticated SSE, and download transport in `src/lib/api.ts`. Project generation/chat remain streaming endpoints; project CRUD uses the shared contract.
- Invalidate the project-list query after changes visible in the sidebar. Refresh project details after generation or restore.
- Use assistant-ui runtimes for conversation drafts, suggestions, submission, cancellation, and message state; validate submitted text with Zod. Visible copy comes from typed `@atoms-demo/i18n/react` keys.

## Interface and preview

- Use assistant-ui for all agent and conversation surfaces through shared `@atoms-demo/ui` composites. Other controls use the shared Base UI components, Hugeicons, and Skyline tokens; destructive actions use AlertDialog.
- Preserve preview/code/mobile modes, version history, publish controls, downloads, and keyboard-accessible resizing.
- Generated HTML is untrusted. Keep the iframe opaque-origin sandbox; never add `allow-same-origin` to enable storage. Preview error messages must verify their source against the iframe window.
- Session-only mock interactions are not persisted application data. Do not describe them as durable saves.

## Runtime

Pages Functions forward `/api/*` and `/p/*` through the `API` service binding or runtime `API_ORIGIN`; Vite mirrors these routes locally. The deployment owner configures the verified account and bindings. Build identity is emitted as `/version.json` using the root build helper.
