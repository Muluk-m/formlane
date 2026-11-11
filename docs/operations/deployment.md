# Deployment

## Current production status

Cloudflare remains the presentation/control plane in **Maqiqian0316@gmail.com's Account**, verified as `252fba810f75c0370e5aa7200abc8f80`. The site is https://formlane-9dp.pages.dev. Pages `formlane` calls Worker `formlane-api` through service binding `API`; D1 remains `atoms-demo`. Apply the additive durable migrations, including `0004_executor_leases.sql` for leases and immutable checkpoints. The Worker no longer executes agents or requires Workflow/browser bindings.

The user-approved compute target is GCP VM `formlane-agent`, zone `us-central1-c`, project `roibest-internal-apps`, account `maqiqian@roibest.com`. It runs Node 24, OpenAI Agents SDK and native Playwright under non-root systemd user `formlane`, with application files at `/opt/formlane/executor`. It polls the Cloudflare control plane and exposes no public application port.

At approval, the browser showed $296.45 in trial credit and 62 days remaining. The approved VM is `e2-standard-2` (2 vCPU, 8 GB RAM) with 30 GB disk; the displayed estimate was $51.92/month plus IPv4, egress and other applicable charges. This dated estimate is not a spending cap. No billing upgrade was authorized. The compute move followed a validator failure at Cloudflare Free's 10 ms Worker CPU limit; see [ADR-0012](../adr/0012-durable-agent-harness.md).

The configured model is `grok-4.7` at `https://sub2api.qiliangjia.org/v1`, using the replacement key supplied on 2026-11-11. The requested name `grok-build-4.7` returned HTTP 404; the key's model list exposes `grok-4.7` and a separate `grok-build-0.1`. The registered 4.7 model passed a real SDK tool-call probe before configuration was changed. Executor secrets/configuration live in root-owned mode-600 `/etc/formlane/executor.env`, read by systemd; never source them into browser code or logs. `EXECUTOR_TOKEN` must match the Cloudflare Secret on `formlane-api`.

On 2026-11-11, acceptance fix `0f8d673` was deployed to GCP. Both real-browser regression tests passed there under the non-root `formlane` account with Chromium sandboxing enabled. Revision `3bb34b3` then passed [CI lint, typecheck, tests and build](https://github.com/Muluk-m/formlane/actions/runs/42987607630), using system Chrome for Ubuntu AppArmor compatibility. A real-provider SDK probe terminated successfully at its review tool within one model turn.

Grok verification passed both non-streaming and streaming SDK tool calls. A probe using the production HTML/check schema generated a 442-character interactive counter and two checks in 11.4 seconds, then passed the real sandboxed browser validator in 15.3 seconds. This establishes schema and runtime compatibility, not full market-app acceptance. Grok run `924bb1c3-780b-4d0f-b47b-7d65bc43579c` failed with a terminated HTTP response stream. Fix `00a999a` classifies this transport error for the existing bounded provider retries; its real socket-disconnection regression and [CI](https://github.com/Muluk-m/formlane/actions/runs/42992766223) passed, and the executor fix was deployed.

End-to-end acceptance is still incomplete: run `df472c7e-e072-4560-8163-834700016b79` exhausted provider retries with an upstream overload error. Run `bc659365-971b-431c-b117-14dc125412bd` reached browser validation: initial data, category filtering, details and mobile overflow passed; favorite and keyboard checks used a selector absent from the generated HTML. Alex returned the report to the manager as intended, but the repair delegation retried until the persisted 15-minute deadline. Neither run saved a version. These results do not establish successful generation, independent QA acceptance or saved-version interactions.

## Release gate

1. For Cloudflare, verify the designated personal account name and immutable ID. For GCP, independently verify the approved account, project, zone and VM; approval for one cloud does not change the other's identity boundary.
2. Verify that the intended Worker, D1 database, and any assets/routes belong to that exact account. Record configuration only after verification; leave unknown IDs unset rather than inserting a plausible value.
3. Run the repository deployment guard. It must require the configured account ID **and** expected account name, fail on a mismatch, and never fall back to another logged-in account or a default token.
4. Obtain explicit authorization for the specific remote actions. A local build or previous deployment instruction against a different account is not authorization.
5. Run the requested build and focused acceptance checks from the intended commit. A Worker dry-run is build evidence, not a remote release.
6. Apply reviewed D1 migrations through `0004_executor_leases.sql`; configure matching `EXECUTOR_TOKEN` on the Worker and executor. Install the real provider configuration only on the executor. Verify non-root systemd, native Chromium sandbox and the HTTPS control-plane connection. Generation is real-only.
7. Deploy Pages/Worker through the guarded root workflow and the executor through its authorized VM release path. Verify SPA reload, owned CRUD, manager delegation, real browser validation/repair, saved versions, restore, download, publication and isolation. Separately exercise cursor reconnect, explicit cancellation fences, lease-expiry/restart checkpoint recovery and the persisted 15-minute deadline.
8. Record account/resource identity, deployed version/URL, run IDs, provider configuration without secrets, checks exercised and limitations. Historical screenshots or SDK-only delegation proof do not establish deployed durable acceptance.

## Configuration boundaries

`pnpm run deploy <test|production>` verifies account ownership; add `--apply` to deploy. Use the explicit `run` form so pnpm does not interpret deployment flags as options for its built-in `deploy` command. Verified production IDs live in `deploy/environments.json`; test IDs remain unset. The script passes the account through the environment for Pages, uses a temporary discoverable `wrangler.jsonc`, and copies Functions beside it. The API Worker has no public workers.dev route because Pages accesses it through its service binding.

- Root package scripts orchestrate release; inspect their current implementations rather than bypassing them with a direct Wrangler deploy.
- `apps/server/wrangler.jsonc` owns Worker configuration and D1 binding names; the deployment guard/configuration owns verified target identity.
- Executor configuration uses `OPENAI_API_KEY`, `ENDPOINT`, `MODEL`, `EXECUTOR_TOKEN` and `CONTROL_PLANE_URL`. The token authenticates outbound polling to `/internal/executor`; never open a public executor application port. Provider keys are not Worker or frontend execution inputs.
- `apps/server/.dev.vars` is local-only. It does not configure deployed secrets.
- D1 migrations live with the server and must be applied explicitly. The request handler must not bootstrap or silently mutate schema on startup.
- Frontend assets and Worker routes must agree on `/api/*`, public `/p/*`, and SPA fallback handling. A successful API release alone does not establish a working web release.
- The systemd unit is `apps/executor/deploy/formlane-executor.service`. Keep its non-root identity, Chromium sandbox, credential-stripped browser environment and root-owned secret file. Do not add `--no-sandbox` to bypass deployment failures.

## Recovery

Before deploying a schema change, establish which prior Worker build remains compatible. Prefer additive migrations; stopping writes precedes removal of columns. A failed release is not permission to reset remote data. Keep the prior deploy/version and database state identifiable, and request authorization for any corrective remote mutation. Never “recover” by deploying to a different account.

Executor restart does not erase D1 checkpoints. An interrupted lease expires after 60 seconds without a heartbeat; a poller can reclaim and reuse completed step results. Cancellation and deadline expiry invalidate writes even if an old process remains alive. Rotate matching executor bearer secrets on both sides only through an authorized change; a mismatch stops polling, not the public site's static assets.
