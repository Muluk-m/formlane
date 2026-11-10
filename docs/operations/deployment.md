# Deployment

## Current production status

The authorized target **Maqiqian0316@gmail.com's Account** is verified as `252fba810f75c0370e5aa7200abc8f80`. The live site is https://formlane-9dp.pages.dev. Pages `formlane` calls Worker `formlane-api` through service binding `API`; the Worker reuses project D1 `atoms-demo`. The additive run-fence migration was applied without deleting data.

The remaining functional blocker is the model credential: production reports `hasKey: false` and `mock: false`. Configure the provider secret on `formlane-api`, then verify a real generation. Previous company-account deployments are not this release.

## Release gate

1. Authenticate/switch to the designated Gmail account. Verify both its displayed name and immutable account ID using authoritative Cloudflare account information.
2. Verify that the intended Worker, D1 database, and any assets/routes belong to that exact account. Record configuration only after verification; leave unknown IDs unset rather than inserting a plausible value.
3. Run the repository deployment guard. It must require the configured account ID **and** expected account name, fail on a mismatch, and never fall back to another logged-in account or a default token.
4. Obtain explicit authorization for the specific remote actions. A local build or previous deployment instruction against a different account is not authorization.
5. Run the requested build and focused acceptance checks from the intended commit. A Worker dry-run is build evidence, not a remote release.
6. Apply reviewed D1 migrations to the verified binding and upload the real provider secret. Non-local environments reject `MOCK_LLM=true`; never replace real provider behavior with mock output to make a release smoke test pass.
7. Deploy through the guarded root workflow, then verify the actual target: SPA route reload, owned-project CRUD, generation, version restore, download, public publish/republish/unpublish, and anonymous isolation.
8. Record the real account, resource identity, deployed version/URL, selected mode, checks exercised, and any limitations. Publish a URL in README only after this evidence exists.

## Configuration boundaries

`pnpm deploy <test|production>` verifies account ownership; `--apply` deploys. Verified production IDs live in `deploy/environments.json`; test IDs remain unset. The script passes the account through the environment for Pages, uses a temporary discoverable `wrangler.jsonc`, and copies Functions beside it. The API Worker has no public workers.dev route because Pages accesses it through its service binding.

- Root package scripts orchestrate release; inspect their current implementations rather than bypassing them with a direct Wrangler deploy.
- `apps/server/wrangler.jsonc` owns Worker configuration and D1 binding names; the deployment guard/configuration owns verified target identity.
- Provider keys are secrets, never source or frontend build variables. Ordinary model/mode settings are environment configuration.
- `apps/server/.dev.vars` is local-only. It does not configure deployed secrets.
- D1 migrations live with the server and must be applied explicitly. The request handler must not bootstrap or silently mutate schema on startup.
- Frontend assets and Worker routes must agree on `/api/*`, public `/p/*`, and SPA fallback handling. A successful API release alone does not establish a working web release.

## Recovery

Before deploying a schema change, establish which prior Worker build remains compatible. Prefer additive migrations; stopping writes precedes removal of columns. A failed release is not permission to reset remote data. Keep the prior deploy/version and database state identifiable, and request authorization for any corrective remote mutation. Never “recover” by deploying to a different account.
