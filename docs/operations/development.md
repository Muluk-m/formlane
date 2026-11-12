# Development

## Setup

Use an isolated Formlane checkout. Follow the root manifest's Node and pnpm pins, and `apps/backend/pyproject.toml` / `uv.lock` for Python 3.13 dependencies. JavaScript uses pnpm/Turbo; Python uses uv. Install only when authorized:

`pnpm install` and `uv sync --directory apps/backend --frozen` prepare their respective dependencies. Install a sandbox-capable Playwright Chromium/Chrome for the backend environment. Keep package versions and browser selection aligned with the lockfiles and actual deployment runtime.

Create a dedicated local PostgreSQL database before migrating. Put backend settings in a private `apps/backend/.env` or process environment:

| Setting                               | Purpose                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                        | Local PostgreSQL connection, using the psycopg driver                                                     |
| `OPENAI_API_KEY`, `ENDPOINT`, `MODEL` | Real compatible provider configuration; missing key is a visible generation error                         |
| `ALLOWED_ORIGINS`                     | Comma-separated explicit browser origins, including `http://localhost:5173`                               |
| `PUBLIC_ORIGIN`                       | Public HTML origin, normally `http://localhost:8090` locally                                              |
| `COMPILER_COMMAND`                    | JSON argv for the built compiler, e.g. `["node", "../compiler/dist/index.js"]` from the backend directory |
| `BROWSER_EXECUTABLE_PATH`             | Explicit sandbox-capable browser path when required by the host                                           |

Use private values for credentials; never put them in `VITE_*`, examples, logs or checked-in files. Remote staging/test/production databases are separate resources, not convenient local development stores.

## Migrations and processes

`pnpm db:migrate` applies Alembic explicitly before API/worker use. `pnpm db:generate --message <description>` generates a candidate migration; review it before applying. Startup and request handling do not create schema. SQLAlchemy models and reviewed Alembic history move together.

Run each process in its own terminal:

`pnpm dev:api` starts the FastAPI factory at loopback port 8090. `pnpm dev:worker` builds the isolated Node compiler and starts `formlane.worker`. `pnpm dev` (or `pnpm dev:web`) starts Vite only. API availability alone does not execute queued generation; the worker must run against the same database.

The frontend defaults to `http://localhost:8090` in development. Set `VITE_API_ORIGIN` to another approved backend and `VITE_API_PUBLIC_ORIGIN` only when public documents use a different origin. Frontend values may live in `apps/web/.env.local`; they contain public origins only. Existing `atoms_uid` is sent as `x-owner-id` and cookies are omitted.

For a build and local preview, supply the origin to both commands:

`VITE_API_ORIGIN=http://localhost:8090 pnpm --filter @atoms-demo/web build`

`VITE_API_ORIGIN=http://localhost:8090 pnpm --filter @atoms-demo/web preview`

Allow the preview origin (normally `http://localhost:4173`) in backend CORS. `pnpm --filter @atoms-demo/web pages:dev` serves the built artifact with Pages redirects; allow its actual displayed origin. Rebuild when origin values change. Local dev/preview mirrors historical `/api/*` and `/p/*` redirects; project reloads retain SPA fallback. Read [deployment](deployment.md#static-pages-python-api-cutover) before preparing a release artifact.

## Dependency boundaries and checks

API changes update shared contracts, Python routes/models and frontend consumers together. Native CrewAI/provider tools and durability belong in the backend. Node compiler changes stay in `apps/compiler`; shared TypeScript packages remain runtime-independent. All product controls use shared UI and visible copy uses the single i18n catalog.

One integration owner runs authorized checks after shared edits land. Choose explicit relevant files, package typechecks or a changed-file gate; avoid simultaneous installs, full suites and watch processes. Examples are `pnpm --filter @atoms-demo/web typecheck`, `pnpm --filter @formlane/compiler test src/project-build.test.ts` and, from `apps/backend`, `uv run pytest tests/test_api.py`. Backend persistence tests require `TEST_DATABASE_URL` pointing at an isolated PostgreSQL test database; never production. See [testing](../internals/testing.md).

Preserve unrelated work. The integration owner handles coherent English Conventional Commits after agreed checks; delegated editors do not independently commit or deploy. A handoff separates checks actually exercised from recommended checks. Historical screenshots do not establish visual evidence for a new build.
