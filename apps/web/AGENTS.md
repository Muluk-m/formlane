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

Pages serves static assets only. `src/lib/api.ts` centralizes FastAPI transport with the origin-local `atoms_uid` / `x-owner-id` capability and omitted cookies. Public `/p/:slug` is a separate anonymous route: fetch the published HTML and render it in an opaque iframe without owner bootstrap or an IP redirect. Vite retains `/api/*` 307 redirects for old clients. Resume preserves the run ID and advances its attempt; historical terminal events must not settle a newer attempt. Read [deployment](../../docs/operations/deployment.md) before changing origins or releasing.
