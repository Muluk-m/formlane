# Python backend

Read root guidance and [architecture](../../docs/internals/architecture.md) before changing boundaries.

- FastAPI owns HTTP contracts and owner authorization; SQLAlchemy/PostgreSQL owns the six business tables. Update TypeScript contracts, Python models and consumers together, including safe public errors.
- Apply schema changes through explicit Alembic migrations. API startup and requests check/use schema; they never create it. Use isolated test databases for destructive fixtures.
- The worker claims PostgreSQL leases and runs the code-orchestrated CrewAI Flow through individual DBOS model/tool steps. The Flow owns stage order and bounded repairs. Explicit migration initializes DBOS; runtime never performs DDL. Check lease authority and cancellation around cached as well as live operations. Bound individual operations; renew leases without a whole-run deadline. Resume preserves run identity and committed operations; cancellation and superseded attempts fence late results. Reconnect only observes events.
- Completion requires current source/artifact/check-set evidence, passing implementation validation, independent David validation and acceptance. Follow-ups use immutable current source as baseline; changes invalidate affected evidence.
- Keep Node restricted to the virtual-source compiler in `apps/compiler`. Compiler and browser subprocesses receive stripped environments, bounded input/output and cancellation; generated scripts/plugins never run with host authority.
- Keep Chromium sandboxed and previews opaque. Provider/database secrets stay in private backend environment files and out of logs, tool events and generated output.

Read [development](../../docs/operations/development.md) for local commands, [testing](../../docs/internals/testing.md) for evidence boundaries, and [deployment](../../docs/operations/deployment.md) before migrations, service changes or cutover. Delegated editing does not authorize checks or remote actions.
