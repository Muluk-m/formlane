# Server

- JSON APIs implement `@atoms-demo/contracts` in `src/rpc/router.ts`; route handlers delegate to project services and Drizzle repositories. Keep generation SSE, downloads, and published HTML in the HTTP transport.
- Authorize ownership before loading project messages, versions, or downloads. The owner UUID is an anonymous capability, not a verified user identity.
- Generation writes carry the database run token. Cancellation, restore, and a replacement run invalidate old tokens; failed generation preserves the current and published versions. Keep multi-record writes atomic with D1 batches.
- `src/db/schema.ts` and checked-in SQL/snapshots are the migration authority. Preserve the original baseline; apply additive migrations before serving traffic. Runtime handlers never initialize schema.
- Provider prompts and deterministic local fixtures belong to core. Mock mode requires both `ENVIRONMENT=local` and an explicit mock flag. Public errors never expose provider payloads or secrets.
- For deployment/account selection, follow `../../AGENTS.md` and the root guarded deployment command. Remote resource IDs must come from the verified target account.
- For a backend change, run the targeted Vitest files, server typecheck, and dry-run build after integration. Regenerate Worker binding types when Wrangler configuration changes. D1 invariant tests use Miniflare and committed migrations.
