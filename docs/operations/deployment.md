# Deployment

## Current rollout status

**Python/PostgreSQL with DBOS and execution compatibility `flow-v2` is the production authority.** Backend release `acceptance-recovery-4ff635eaa0b1` runs tested source `4ff635eaa0b151cab45e51f1a02fc8fd2c6c727e`, merged by [PR #43](https://github.com/Muluk-m/formlane/pull/43) as `80a1b569e513d12d471811de305416669926cd5f`. Both frontend origins report build `202611132054`, commit `4ff635eaa0b1`. See the [iterative acceptance activation](#iterative-acceptance-activation-2026-11-13) for current evidence and the earlier sections for historical releases.

The current release passed exact-candidate CI and five real-provider scenarios on isolated port 8096 before activation at 2026-11-13 12:53:51 UTC. Production was drained to zero queued/running Runs, fully backed up and switched atomically with a persistent rollback command. Pages was deployed separately after backend activation. The sections below distinguish each release's evidence.

| Resource                    | Current identity / boundary                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare account          | **Maqiqian0316@gmail.com's Account**, `252fba810f75c0370e5aa7200abc8f80`                                                                        |
| Pages                       | Project `formlane`, canonical frontend **https://formlane.nainma.online**; original Pages hostname retained                                     |
| Python API                  | **https://136.65.182.87**; public viewer navigation stays on the frontend domain                                                                |
| Reserved GCP address        | `formlane-api`, region `us-central1`                                                                                                            |
| GCP identity                | `maqiqian@roibest.com`, project `roibest-internal-apps`                                                                                         |
| Existing VM                 | `formlane-agent`, zone `us-central1-c`                                                                                                          |
| Backend release             | `/opt/formlane/python-backend/releases/acceptance-recovery-4ff635eaa0b1` (`4ff635e`), selected by `current`                                     |
| systemd services            | `formlane-python-api`, `formlane-python-worker`, non-root user `formlane`                                                                       |
| Current service environment | Private `/etc/formlane/backend.env`; production database `formlane`                                                                             |
| Databases                   | Production `formlane`; other-session staging `formlane_workflow_stage`; issue #32 acceptance `formlane_issue32_stage`; isolated `formlane_test` |
| Public ingress              | Caddy 2.11.9 on 80/443; only these web ingress ports are open                                                                                   |
| Private listeners           | FastAPI `127.0.0.1:8090`; PostgreSQL loopback port 5432                                                                                         |
| Provider                    | `grok-4.7` at `https://sub2api.qiliangjia.org/v1`; secrets only in private server environment                                                   |

Caddy automatically obtains and renews Let's Encrypt **short-lived IP certificates**. Preserve its TLS state and renewal reachability. The [Caddy template](../../apps/backend/deploy/Caddyfile) requests the `shortlived` ACME profile and sets `default_sni` to the API host: IP clients can omit SNI and the VM receives traffic on its private NAT address. Streaming proxy flush remains enabled. Neither the API nor PostgreSQL is exposed directly. Do not work around TLS failures by disabling certificate verification.

The [API](../../apps/backend/deploy/formlane-python-api.service) and [worker](../../apps/backend/deploy/formlane-python-worker.service) units share the intended private environment and release. The API serves HTTP; the worker claims PostgreSQL leases and executes native CrewAI. The [compiler](../../apps/compiler/) is a bounded credential-stripped Node subprocess, not a second business server. Keep sandboxed Chromium under the non-root service identity. Provider/database credentials must never enter Pages, Vite variables, generated content or logs.

Port 8094 and `formlane-workflow-stage-api` / `formlane-workflow-stage-worker` belong to another session: their environment/worktree drop-in selects `followups-cce3c4a`, despite the older base ExecStart. Do not modify those services, drop-ins, environment or database for issue #32. Its acceptance uses `formlane_issue32_stage`, private mode-0600 `/etc/formlane/backend-issue32-stage.env`, and dedicated `formlane-issue32-stage-api` / `formlane-issue32-stage-worker` on loopback 8096. Provisioning and explicit migrations are complete; do not repeat them.

Production's configured `COMPILER_COMMAND` remains the executable at `/opt/formlane/python-backend/releases/flow-v1-20261113b/apps/compiler/dist/index.js`. Preserve that exact command and the `durable-recovery-20261112` release/dependency graph it resolves through. Compiler relocation is outside this release. Current production API/worker ExecStart and WorkingDirectory use `/opt/formlane/python-backend/current`, and private `PYTHONPATH` follows `current/apps/backend/src`; no production unit drop-ins were observed. Existing `BUILD_COMMIT`/`BUILD_VERSION` are stale and cannot prove active source. Use `RELEASE_COMMIT`, the imported module path and process working directory.

### Final cutover evidence

The final six-table export was taken after all 53 legacy runs were terminal, the Node executor was stopped/disabled and Worker mutations/cron were fenced. Empty-production import and independent `--verify-only` both passed:

| Table           |  Rows |
| --------------- | ----: |
| projects        |    20 |
| messages        |   322 |
| versions        |    27 |
| runs            |    53 |
| run_events      | 4,593 |
| run_checkpoints |   357 |

The private snapshot and exact count/row/source/HTML-hash manifest are `/var/lib/formlane/backups/final-cutover-20261112.sql` and `final-cutover-20261112-manifest.json`. Snapshot SHA-256 is `e4672c270f3b2c150f69894803b57a6bc39b163dad0b4eae63cd1ddada1f64ef`; message-order SHA-256 is `907d5e5fd83d394cc88804a4ccad4af95aa05ad3679d00d8b628959f0012d4de`. The importer verified ownership/pointers, source/HTML, event cursors and checkpoints. Explicit ancestry was preserved. Counts describe the immutable cutover snapshot before new PostgreSQL writes.

Targeted verification passed: **144 Python tests**, **19 compiler tests**, **37 client message tests**, client/compiler typechecks and the static frontend build. Stage run `f43bd63c-6186-4d0c-96c3-213afc238c0f` saved v1; follow-up `d8cff470-6f81-4d5c-af6e-a2c6eed8f48d` saved v2. Browser reload reconnected to the running task (cursor 62 → 67). Independent review may use different checks from implementation validation, while both remain tied to the exact source/build. Stage Undo, frozen publication, exact ZIP, restore, remix, cancellation, unpublication, ownership and CORS checks passed.

The pre-cutover browser retained all four existing owned projects and draft `80601bf4-b494-4723-8a90-45dddfe6eb47`. Its GET/POST/DELETE, historical SSE cursor and version-selected ZIP requests preserved owner, method, body and query through redirects. All four historical public documents match their original HTML hashes; the six-file downloaded version matches the snapshot byte-for-byte. Legacy Worker `51e2cf38-563b-4ee3-8b3b-fb2e27e45a94` only redirects API/public URLs and has no D1 binding or scheduled work. The unused Pages `API` service binding was removed. Previous Worker `0fe9b4c0-c5c5-44b6-bd9f-c9f2413bed3c` and Pages `cfe7d89e-08d3-4654-a502-7e4c040bca0d` are recovery artifacts, not writable fallback authorities.

Production run `3caf135e-3703-4a64-809c-ee36e45df1e4` saved v1; ordinary follow-up `9f41178a-1a5a-4f09-8154-5e78fc518f8f` saved v2 (HTML SHA-256 `16e13c34bb5b4ad69273943b8f26e9bac41f2e2dbe303dd17b58ea825d3ada8c`). Mouse/Space/Reset observed 0 → 2 → 0. Reload preserved the completed run and cursor 89. Production Undo/restore, remix, exact ZIP, cancel preserving v2, publish/unpublish, cross-owner denial and CORS checks passed on this isolated acceptance project. Archived `python-cutover-desktop.png` and `python-cutover-mobile.png` ([location and hashes](#acceptance-evidence-retention)) show release `dea6d12` with retained v2 after the cancellation test; mobile document width equals the 375px viewport width.

A concurrent layout release briefly restored legacy routing. Forwarding was immediately restored, and a second six-table D1 export matched the frozen snapshot row-for-row: no data diverged. Its UI changes were integrated into `dea6d12` and deployed with static Python routing. [Python CI](https://github.com/Muluk-m/formlane/actions/runs/43227687355) and [JavaScript CI](https://github.com/Muluk-m/formlane/actions/runs/43227687280) passed after integration.

CI uses a per-run password only for its isolated loopback PostgreSQL container. No production secret is committed. Use released action tags, and pass the verified Cloudflare account through `CLOUDFLARE_ACCOUNT_ID`: Pages rejects `account_id` in its Wrangler configuration.

## Acceptance evidence retention

Acceptance screenshots, videos, browser traces and run logs **must be written to a private archive outside every source checkout**. Repository records must retain the archive location, exact build/source and run/version IDs, SHA-256 manifest and observed results, including failures and unobserved behavior. Keep credentials and owner capabilities private. Legitimate product assets and deterministic test fixtures remain allowed source inputs; captured acceptance output is not a fixture.

The commit-message hook and `check:changed` scan the Git index, including force-added ignored files; staged deletions are allowed. CI runs `check:evidence --tracked` against the complete committed tree. The guard reserves evidence directories and rejects recognizable capture/trace names and run logs without banning image or video extensions. Deterministic data under `fixtures`, `__fixtures__` or `__snapshots__` is exempt from filename rules, but reserved evidence directories remain forbidden. This path guard cannot classify arbitrarily renamed captures: the retention policy still applies.

On 2026-11-13 the eight previously tracked `docs/screenshots/*.png` files were archived unchanged at `/Users/qiqian/Backups/formlane/acceptance-evidence-20261113-OMbIKUM4` (directory mode 0700; files and manifest 0600). Its `SHA256SUMS` manifest has SHA-256 `dc82c1562511c8cb29f37e23b81f067907209c8dd896aca02c0ac542fed8340b`. The archive is private local storage, not a public download. These historical records preserve their original release/run context below; moving the files does not establish acceptance for a later build.

| Archived file                    | SHA-256                                                            | Historical context                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `python-cutover-desktop.png`     | `51a653e9371289cc648d66cf26906919d10d1f6e2a00989928e3d68193e08c9e` | [Final cutover](#final-cutover-evidence), `dea6d12`, saved v2 after cancellation                                   |
| `python-cutover-mobile.png`      | `4820360b7c1af1ed273569f96486eb28424faf1758fe5a96547609a7796c4421` | Same cutover/run, 375px viewport without overflow                                                                  |
| `durable-recovery-stage.png`     | `519a0fd23d38fbf36bbcb346320a6bd6393f0ffe20d27466e9ea662cc6de23a6` | [DBOS recovery](#dbos-recovery-release), `c6c62e0`, resumed run `d6afe371-8748-4572-a5e2-1dec5089f61b`             |
| `durable-public-production.png`  | `a01f3971ef74f0328a125d73fa510398a8f8f65f517dbf526e2daf992e282fa1` | Same DBOS release, public counter `8tq3mrv54j`, click 0 → 2                                                        |
| `recovery-budget-stage.png`      | `eaec119d5aed24e3aae9f3a46e96989dbfae4182db4dedf65757868fb9fc0926` | [Deadline removal](#removing-whole-run-deadlines), run `82930c09-1cf0-44a7-9d60-24b1bb534479`, attempt 4, saved v3 |
| `flow-v2-stage-mobile.png`       | `1dcfa81e9bd4d6c3972dec5432dfe2863cbfbeabdaef3a95836ed96ad0209679` | [Flow-v2 activation](#flow-v2-activation-2026-11-13), source `2364358`, resumed stage Version                      |
| `flow-v2-production-desktop.png` | `0d4bb8ac199da6605f0a6775cfd5060dc67e345880d2f2b800c41ef4b6a348b7` | Same source, accepted production Version                                                                           |
| `flow-v2-production-mobile.png`  | `be13c82fbc8b7b07ade96c4691602bd8a5ae499398fdced458649aa1aebd4e11` | Same source and production Version, mobile preview                                                                 |

## Static Pages Python API cutover

Production Pages releases use the manual [Deploy Pages workflow](../../.github/workflows/deploy-pages.yml). Deploy a tested commit compatible with the active backend; a frontend-only release does not require activating that commit on the VM. The workflow sets `BUILD_COMMIT`, builds with pinned pnpm, verifies the designated Cloudflare account, uploads static assets and fails unless both frontend origins serve the selected commit. Merging a PR does **not** trigger deployment; backend activation remains separate.

### Routine frontend release

1. Complete the relevant checks and merge the reviewed PR. Resolve the intended release to a full commit SHA; do not deploy an unreviewed moving branch accidentally.
2. Confirm compatibility with the active API. For a frontend-only change, leave VM services and the database untouched. Backend/schema changes must complete their own staged acceptance and activation first.
3. Trigger the workflow from `main`, pinning the artifact with its `ref` input:

   ```bash
   gh workflow run deploy-pages.yml --repo Muluk-m/formlane --ref main -f ref=<verified-full-commit-sha>
   gh run watch <run-id> --repo Muluk-m/formlane --exit-status
   ```

4. Require workflow success, including its live-version check. Check `/version.json` on `https://formlane.nainma.online` and `https://formlane-9dp.pages.dev`: `commit` must equal the selected SHA's first 12 characters. Then smoke-test the changed surface in the browser. Record the run URL, frontend identity and compatible backend release; an upload URL alone is not proof of production activation.

### Deployment credentials and failures

Repository secret `CLOUDFLARE_API_TOKEN` must contain a valid token with **Account → Cloudflare Pages → Edit**, restricted to the designated account above. Create or rotate it in [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens), then enter it interactively in a trusted terminal:

```bash
gh secret set CLOUDFLARE_API_TOKEN --repo Muluk-m/formlane
```

Never put the token in chat, tracked files, command arguments or logs. Local Wrangler OAuth credentials do not authenticate GitHub Actions. `gh secret list` confirms only that the secret name exists; it does not prove a nonempty value or valid permissions. The former empty-secret failure in run `43366631470` was resolved and verified by successful run `43372366587` on 2026-11-13; do not carry it forward as an outstanding blocker.

On failure, inspect that run with `gh run view <run-id> --repo Muluk-m/formlane --log-failed`. An identity/authentication failure requires checking the token, expiry and account scope. A build failure requires fixing the build. A version-check failure requires inspecting the actual deployment and both domains before declaring success or rerunning. Do not weaken the account or version guards.

Local deployment is a fallback when Actions is unavailable, using the same guarded deploy script and a clean checkout of the verified release. Run `pnpm run deploy production` to verify the account/target first, then `BUILD_COMMIT=<verified-full-commit-sha> BUILD_VERSION=<YYYYMMDDhhmm> pnpm run deploy production --apply`. Use the 12-digit timestamp format; arbitrary labels are rejected. Verify both live origins and browser behavior afterward. Local deployment does not repair the Actions secret. For a frontend-only rollback, redeploy a known-good commit compatible with the active backend through the same workflow; backend/schema rollback follows its separate database/release procedure.

The root [deploy script](../../scripts/deploy.mjs) builds and uploads **static Pages assets only**. It does not deploy a business Worker, migrate a database, change services or upload Functions. No `API` service binding or runtime API-origin binding is needed. Target settings live in [deploy/environments.json](../../deploy/environments.json).

Keep both the custom frontend and original Pages hostname available: anonymous `atoms_uid` capabilities are local to each browser origin and do not transfer between domains. Clients send that capability as `x-owner-id`, omit cookies and reject bootstrap identity replacement. Backend `ALLOWED_ORIGINS` must include `https://formlane.nainma.online`, the original Pages hostname and approved preview/local origins, including preflight for `Content-Type`, `X-Owner-ID` and `Last-Event-ID`. Public viewers fetch anonymously without owner bootstrap.

`apiOrigin` selects the Python server; `frontendOrigin` and `apiPublicOrigin` select `https://formlane.nainma.online`. Set backend `PUBLIC_ORIGIN` to that same public frontend origin. The guard maps origins to public build-time `VITE_API_ORIGIN` / `VITE_API_PUBLIC_ORIGIN`; changing runtime settings does not rewrite built assets. `backendReady` is an acceptance gate, not deployment authorization.

Vite retains `/api/* <apiOrigin>/api/:splat 307` for older loaded clients. `/p/:slug` is a static public route that anonymously fetches the published HTML from Python and renders an opaque full-screen iframe; the address bar stays on the custom domain. It neither redirects to the IP nor grants generated content access to frontend ownership storage. Missing/revoked links render an unavailable state; the SPA document itself has Pages' HTTP status. Pages remains static with SPA fallback, without Functions or a business Worker.

### Explicit database operations

[Models](../../apps/backend/src/formlane/models.py) and [Alembic migrations](../../apps/backend/migrations/) define PostgreSQL's six business tables. API startup does not create them. With the intended database configured privately, `pnpm db:migrate` applies `alembic upgrade head`.

Database creation, migrations, secret changes and service activation are distinct authorized remote actions. Source cleanup is not permission to delete live Worker/D1 resources or historical exports. Preserve rollback evidence until the release owner explicitly retires it.

## Recovery without split writes

PostgreSQL is the only writable business authority. Database recovery restores a compatible PostgreSQL backup, worker release and routing together; there is no rollback to D1. An executable-only rollback with no schema change instead retains the live database, as required for [flow-v2](#runtime-module-release-flow-v2). Old Pages assets must continue forwarding to Python. Fence all writers before data recovery, and never replace production with staging data or an earlier export after new writes without a coordinated recovery decision.

A worker restart reuses completed durable operations. Explicit owner-authorized resume continues the same eligible run with a new attempt; old attempts and producers remain fenced. Runs have no fixed wall-clock deadline. Superseded runs and changed baselines cannot resume. A stale checkpoint never permits stale build/check/review acceptance. Preserve Chromium sandboxing and private environment isolation during recovery.

### DBOS recovery release

Apply the application Alembic migration and `uv run python -m formlane.durable_execution migrate` explicitly against the intended database before activating the new worker. Runtime uses `run_migrations=False`. Preserve the business tables, legacy checkpoint rows and DBOS system schema together in recovery backups. Workflow code/config compatibility is pinned: retain the matching worker release or perform a reviewed migration instead of replaying old operations under incompatible code. Verify process termination/reclaim, same-run resume, completed-operation reuse, stale-token rejection and browser replay before activating the client resume action.

Package the compiler with its root pnpm dependency store and referenced workspace packages. Copying only `apps/compiler` leaves relative dependency links dangling. Override `COMPILER_COMMAND` to the candidate's exact executable during staging acceptance; a successful build through an older absolute path does not verify the release artifact.

Recovery candidate `c6c62e0` passed 32 focused PostgreSQL storage/recovery tests, including spawned-process death, legacy checkpoint reuse, interrupted initial dispatch and connection loss during ownership transfer. The populated staging database migrated successfully after making deferred constraints immediate before backfill/DDL. DBOS and application tables must share one database; their separate schemas participate in the same lease-fenced scheduling transaction.

Browser acceptance resumed migrated cancelled run `d6afe371-8748-4572-a5e2-1dec5089f61b` without changing its ID or request: attempt 1 advanced to 2 and completed as v3 at terminal cursor 177. Reload replayed cursor 156 while retaining saved v2. The resulting heading-only revision passed counter interaction 0 → 1 → 0. Archived `durable-recovery-stage.png` ([location and hash](#acceptance-evidence-retention)) shows candidate `c6c62e0` during independent review.

Production was drained before activation: 21 projects, 348 messages, 29 versions, 58 runs, 5,242 events and 549 legacy checkpoints. The full private backup is `/var/lib/formlane/backups/before-durable-recovery-20261112.dump`, SHA-256 `854146267fcbd086684cee47c032363f63812dc9658fc66da9fdecf9e81426e7`. The release and environment retained at activation were `role-prompts-pr14` and its private environment backup; their later retirement is recorded below. Production `/healthz` and `/api/health` returned 200 after activation. The [published counter](https://formlane.nainma.online/p/8tq3mrv54j) remained on the custom domain and changed 0 → 2 when clicked; archived `durable-public-production.png` ([location and hash](#acceptance-evidence-retention)) shows this release.

### Removing whole-run deadlines

Migration `0003_remove_run_deadline` removes the obsolete deadline column. Keep API and worker stopped while applying it, and retain a complete PostgreSQL backup. Pin service `PYTHONPATH` to the active release's `apps/backend/src`; copied editable Python environments may otherwise import a previous release.

The historical deadline-removal release preserved DBOS operation names/order and migrated matching application/DBOS compatibility metadata transactionally with a hash-pinned one-time script. That script is retired; its [source at `6aa6e08`](https://github.com/Muluk-m/formlane/blob/6aa6e08/apps/backend/deploy/migrate_execution_budget.py) documents the completed operation and is incompatible with `flow-v1`. Restore the database backup and matching executable together when recovering that historical release.

Focused verification covered 89 backend tests and five catalog tests, including historical D1 imports containing the retired deadline field. A simulated hour in the queue followed by an hour of heartbeating execution completed successfully. A production database copy resumed run `82930c09-1cf0-44a7-9d60-24b1bb534479` from attempt 3 to 4, reused its committed operations, completed independent acceptance, and saved v3 at terminal cursor 489. The recovered counter passed 0 → 1 → 0. Archived `recovery-budget-stage.png` ([location and hash](#acceptance-evidence-retention)) records this staging acceptance; it is not production activation evidence.

Integration with PR #17 passed another 50 PostgreSQL storage, worker and process-recovery tests and 41 frontend message tests. The migration dry run accepted both live workflow manifests. Queue/resume waiting, checkpoint rollback, cached replay cancellation and stale-producer rejection remain covered without a whole-run watchdog.

### Flow-first delivery (`flow-v1`)

[ADR-0015](../adr/0015-flow-first-delivery.md) replaced the hierarchical Crew. This section records the historical `flow-v1` schema transition and its activation; it is not the rollback procedure for the later `flow-v2` refactor. Its durable history is not interchangeable with `crew-v1`/`dbos-v1`: on that worker those runs fail closed as incompatible and are not resumable. Historical activation sequence:

1. Stop new run creation and let active runs finish, or record each unfinished run that will be failed as incompatible. Retain a complete PostgreSQL backup and the previous release.
2. With API and worker stopped, apply `0004_version_acceptance_checks`. Readiness requires this revision. Historical `crew-v1` manifest migrations do not apply to `flow-v1`.
3. Activate API and worker from the same release with pinned `PYTHONPATH`. New runs record `execution_version = flow-v1`.
4. Verify with the real provider: an initial build, a quick-edit follow-up that reuses saved checks, a plan follow-up, cancellation, and a worker restart during build. Record run IDs, model-call counts, time to first file event, wall time and repair rounds.

Rollback of that original schema transition restores the database backup and previous release together. The pre-Flow API's readiness requires revision `0003_remove_run_deadline`, so restore or downgrade before switching those historical executables. Do not apply this schema rollback to `flow-v2` → `flow-v1-20261113b`: both use `0004_version_acceptance_checks`, and that rollback keeps the live database and new writes.

#### Activation record (2026-11-13)

- Zero queued/running production runs before stopping services. Backup `/var/lib/formlane/backups/before-flow-v1-20261113T041650Z.dump`, SHA-256 `d703bf6999f6fee62cdff38982821bc13fb38b56857c308e68d87badd5bde84d`, contains all business and DBOS tables. Environment backup `/etc/formlane/backend.env.before-flow-v1-20261113T041840Z`; previous release `replay-budget-20261113` retained.
- Alembic reached `0004_version_acceptance_checks`; `current` points to `flow-v1-20261113` (built with the staging-verified virtualenv, unchanged lockfile, compiler link unchanged); the worker's working directory was verified as the new release. `/healthz`, public `/api/health`, the custom-domain frontend and published link `8tq3mrv54j` returned 200.
- Pages was built on macmini2 with the pinned pnpm 11.24.0 and `BUILD_COMMIT` set to the release SHA, then uploaded after `wrangler whoami` matched the designated account. Both frontend origins report `ee87304c439f`; SPA reload, public viewer and the legacy `/api` 307 forward passed.

Production smoke used a fresh anonymous owner and a request unrelated to the staging samples:

| Run                                                         | Route                 |  Wall | First file | Result                                                                                                              |
| ----------------------------------------------------------- | --------------------- | ----: | ---------: | ------------------------------------------------------------------------------------------------------------------- |
| `1ffa11f0-7378-47a5-9e0d-df23a529aa97` ledger initial build | plan → build → review | 235 s |       96 s | Saved; plan 53 s; month total computed from `new Date()` and checked at two clocks                                  |
| `46679514-29de-4c76-bbdb-2336f9820037` color/title change   | quick edit            | 139 s |       42 s | Saved; validation, filter and totals preserved                                                                      |
| `d52767d5-026d-4289-ab2b-b554c3609bcd` add delete           | plan follow-up        | 275 s |       84 s | Saved; an ambiguous planned selector was disputed by Alex, corrected by David and revalidated without a repair loop |

Follow-up release `4639c4361b79059dddf6260337dd78f3a9306118` (`flow-v1-20261113b`, no migration) adds per-stage tool budgets after staging run `194cf371-4777-4d31-8ad8-64a630e18416` spent 22 reviewer inspections and 1,002 s. With budgets, staging run `81786069-58c1-462d-89c1-e4d346296e4c` completed the same 2048 build in 384 s with one review round. Production was switched with zero active runs; environment backup `/etc/formlane/backend.env.before-budgets-20261113T045652Z`; previous release `flow-v1-20261113` retained. Pages was unchanged.

Staging (`formlane_workflow_stage`, release `flow-release-20261113b`) reproduced the reported production failure: the identical 2048 night-style request that failed or was cancelled three times in production (`1e28f623…`, `9edbdb6b…`, `a2717c46…`) saved through quick edit in 108 s with game logic untouched. A tool-library build (`32ed3c52-c38e-4277-bf31-d5cf880ed001`, 415 s) computed dates from `new Date()` and was checked at three clocks including Sunday and the following Monday.

## Runtime module release (`flow-v2`)

This release separates the delivery runtime, packages startup configuration and adopts official scoped budget hooks; [ADR-0015](../adr/0015-flow-first-delivery.md#runtime-modules-configuration-and-extension-points) records the decisions. It changes execution compatibility to `flow-v2` without a schema, HTTP contract, frontend or library-version change. Durable identifiers remain `formlane.flow.v1`, `flow-v1/execution-manifest`, `flow-v1/result` and the existing stage/model/tool/candidate paths. The manifest covers every packaged Python/YAML/YML/text file under `formlane`, including files outside delivery. Configuration is immutable once loaded; there is no hot reload or in-place production prompt tuning.

`flow-v1`, `crew-v1` and `dbos-v1` histories remain available for inspection but cannot run or resume on the new worker. Manifest mismatch also blocks replay and cached DBOS `SUCCESS` completion. Missing application manifest evidence after committed work fails closed; a dormant enqueue with no committed operations can recover. Never migrate manifest values merely to bypass this boundary. Drain all queued/running work before changing executables, and retain the previous release for rollback.

### Identity and candidate preparation

The user authorized this release's staging and production actions; the integration/release owner performs them. The independently verified target is GCP account `maqiqian@roibest.com`, project `roibest-internal-apps`, zone `us-central1-c`, instance `formlane-agent`, public IP `136.65.182.87`. The local default project is `roibest-internal`, which is different. Every gcloud command must supply the explicit account/project/zone; for example:

```bash
gcloud compute ssh formlane-agent --account=maqiqian@roibest.com --project=roibest-internal-apps --zone=us-central1-c
```

1. Pin the reviewed source commit and eventual merge commit, require the exact candidate's complete CI, and record the [equivalence and upgrade gates](../internals/testing.md#flow-equivalence-and-library-upgrade-gates). Historical green runs are insufficient. Package tracked source using `git archive` of the tested commit, record `RELEASE_COMMIT`, and install the frozen lockfile into a new release directory with Python 3.13. Do not copy an editable virtualenv. Pin `PYTHONPATH` to the candidate and inspect the imported `formlane.delivery` path. Verify all YAML/text resources are packaged and startup validation succeeds.
2. Retain the production private environment, release and protected compiler dependency. Check the candidate's exact configured compiler command through its own bridge as non-root `formlane`; it must remain the protected production command above. Keep provider/database secrets out of output and artifacts. No Pages deployment or frontend version change is part of this release.
3. Use only the prepared issue #32 environment/database and 8096 services. Apply existing application/DBOS migrations explicitly to that empty staging database before starting its API/worker from the candidate; production already has the required schema and needs no new migration. Confirm imported source, configured database, port and non-root sandbox. Do not reuse or alter 8094 staging.
4. Run real-provider staging acceptance on the exact candidate: initial build, quick-edit follow-up using saved checks, plan follow-up, worker process death after a committed operation with reclaim/reuse, and cancellation followed by same-run/new-attempt resume. Require saved accepted source/HTML/checks, exact SSE replay suffix, unchanged committed checkpoint hashes/timestamps, no repeated committed effects, and preservation of the last accepted version during cancellation. Exercise the accepted app in sandboxed desktop/375px browser previews, recording interactions, overflow/errors and screenshots. Record run/version IDs, routes, first-file seconds, wall seconds, model-call counts and repair rounds. A health response or prepared environment does not satisfy this gate.

### Drain, backup and atomic activation

Use the release owner's guarded `switch-release.py` only after the gates above. Its `--target` must be the verified candidate directory under `/opt/formlane/python-backend/releases`; its `--expected-current` must match the live pointer immediately before execution. The recorded activation used previous release `/opt/formlane/python-backend/releases/flow-v1-20261113b`. For a future switch, inspect the live pointer again; do not repeat this completed activation. Set `switch_helper` to the retained helper's actual VM path and `candidate_release` to the verified candidate:

```bash
sudo /usr/bin/python3 "$switch_helper" --target "$candidate_release" --expected-current /opt/formlane/python-backend/releases/flow-v1-20261113b
```

The required sequence is:

1. Recheck cloud/service/database/release identities and the expected-current guard. Stop `formlane-python-api` to fence creation and resume while leaving the old worker alive to finish its queue. Wait for `SELECT count(*) FROM runs WHERE status IN ('queued','running')` on production `formlane` to reach **zero**. A previous empty-queue observation is not sufficient. Do not switch with unfinished work; if work cannot finish, resolve its terminal state under the existing release first.
2. Stop `formlane-python-worker` and recheck zero. Take a full `pg_dump -Fc formlane`, without business-table/schema filtering, so business tables, application checkpoints and DBOS system history remain together. The helper validates the archive with `pg_restore --list`, computes SHA-256 and copies private `/etc/formlane/backend.env` into its mode-0700 backup directory. Record the actual archive path, checksum, environment backup, previous/target release and source SHA. Never substitute a staging snapshot.
3. **Before changing `current`**, persist both the switch helper and executable `rollback.sh` beside the backup, with private permissions. The generated rollback encodes the previous target and expected new current, and `record.json` records its exact command. Confirm those persistent files exist; rollback must survive a health failure or deletion of temporary upload files.
4. Create the new symlink beside `current` and atomically replace `/opt/formlane/python-backend/current`. Start production API and worker together from that pointer with the production private environment. Verify process working directories and actual imports select the target; retain the existing compiler command. Before-switch helper failures restore services on the previous pointer. A failure after switching requires the recorded guarded rollback, not automatic restoration of an old database.
5. Require loopback and public `/healthz` and `/api/health`, expected real provider/key/executor configuration, and the correct database/release. The helper's health checks alone are insufficient: perform a fresh real-provider production generation through the public API, observe file streaming and saved independent acceptance, then exercise the accepted app at desktop/375px and reconnect/replay. Record run/version identity and the same timing/model/repair metrics as staging. Confirm the existing frontend still reports its observed build and existing public viewing works; do not redeploy it.

### One-step rollback without losing writes

Run the exact `sudo .../rollback.sh` command recorded in the persistent backup's `record.json`. It invokes the retained switch helper with a guarded reverse target, stops new requests, drains the currently active worker's queued/running work to zero, stops the worker, takes another full backup, atomically selects the previous release, and restarts API/worker. If the active worker is unhealthy, resolve its active work before continuing; do not bypass the zero-work fence. Verify health, imports and a real generation after rollback.

**Keep the live production database and all new writes. Do not restore the pre-switch dump or downgrade Alembic for this rollback.** `flow-v2` and the retained `flow-v1-20261113b` use the same schema. Versions written after activation remain data; `flow-v2` histories cannot resume on the old executable, just as old histories cannot resume on the new one. Retain both executables, private environment backups, DBOS/application history and compiler dependencies. Database restore is a separate coordinated disaster-recovery action, not this release's one-step rollback.

### Flow-v2 activation (2026-11-13)

Reviewed source `2364358906d524654eb846f97d389435164448af` passed [backend CI 43399469727](https://github.com/Muluk-m/formlane/actions/runs/43399469727): 12 frozen Flow comparisons, 12 native CrewAI contracts, 29 DBOS recovery/compatibility gates and 248 other regressions, **301 tests total**, plus Ruff. [JavaScript CI 43399469678](https://github.com/Muluk-m/formlane/actions/runs/43399469678) passed. Both independent review axes closed all findings. PR #40 merged as `7830d8c285103fb529e8be8193f7d6b3c2b007ee`.

Post-merge [JavaScript CI 43402522337](https://github.com/Muluk-m/formlane/actions/runs/43402522337) passed. Post-merge [backend CI 43402522383](https://github.com/Muluk-m/formlane/actions/runs/43402522383) passed the three dedicated gate groups, then reported 247 passes and one failure in the remaining regressions: `test_independent_review_checks_preserve_current_implementation_evidence` hit `BrowserType.launch: Timeout 15000ms exceeded` before page assertions ran. Its Chrome log contains DBus connection diagnostics but does not establish the startup delay's cause. The failed run was not retried, and no timeout, browser assertion or runtime code was weakened. The subsequent [browser CI investigation](#browser-ci-provisioning-and-production-smoke-2026-11-13) is separate evidence from this historical failure and the exact-candidate/live acceptance above.

The tested archive SHA-256 is `5f556a6787af3e360437b299b95e22ed9020fe15416c444baaccfdb9b040bdde`. The immutable release has a fresh frozen Python 3.13 environment; non-root startup proved its delivery import, six stage configurations, `flow-v2`, dedicated stage database and preserved compiler command. Existing Alembic/DBOS migrations were applied explicitly to the empty issue #32 database.

| Staging scenario                          | Run and accepted Version ID            | Wall seconds | First file seconds | Model calls | Repair rounds | Reused operations |
| ----------------------------------------- | -------------------------------------- | -----------: | -----------------: | ----------: | ------------: | ----------------: |
| Initial build                             | `0c0edb28-9a99-415d-b7bf-712808f499f2` |      164.412 |             75.212 |          20 |             0 |                 0 |
| Quick edit                                | `ac99529c-f8fa-4522-ab94-ca298769aa9f` |       80.110 |               none |          15 |             0 |                 0 |
| Plan follow-up and worker SIGKILL/reclaim | `c8a2c69a-b6db-4241-b83e-e00fa14134c5` |      157.745 |               none |          18 |             0 |                14 |
| Cancellation and same-run resume          | `a437c00c-e10f-4a61-908e-e9bff053ea8d` |      106.636 |               none |          12 |             0 |                 5 |

All four runs saved independently accepted source/HTML and passed exact historical SSE suffix replay. Quick edit retained eight persisted checks, changing only the two heading expectations requested by the user. Worker death and cancellation preserved every previously committed checkpoint hash and timestamp; explicit resume kept the Run ID and incremented its attempt. Cancellation preserved the preceding complete Version. All four accepted apps passed sandboxed 1280px/375px browser interaction checks without script errors or horizontal overflow; step selection and reset preservation passed after the feature addition.

Production had **zero queued/running Runs** before stopping its worker. The full business/application-checkpoint/DBOS archive is `/var/lib/formlane/backups/issue32-switch-20261113T093554Z/formlane.dump`, SHA-256 `94c2657e374c4241d5f92bc6d25896d6557208feb832268cdfc3f43671aeac0d`; `pg_restore --list` passed. The same private directory contains `backend.env`, `record.json`, the retained switch helper and executable rollback script, persisted before replacing `current`.

```bash
sudo /var/lib/formlane/backups/issue32-switch-20261113T093554Z/rollback.sh
```

Previous release `flow-v1-20261113b` and its compiler dependencies remain retained. Production API/worker PIDs `392340`/`392341` had working directories in `runtime-32-2364358906d5/apps/backend`; the production import selected `current/apps/backend/src/formlane/delivery`, database `formlane`, and the unchanged protected compiler command. Loopback and public `/healthz` and `/api/health` passed with real `grok-4.7`, configured credentials and executor. The canonical frontend and existing public counter `8tq3mrv54j` rendered without console/page errors; the public iframe retained its opaque origin and sandbox.

Fresh production Run/Version `8ce40277-5fd6-4176-8110-c555e5b06dbe`, created through the public HTTPS API, saved in 137.507 seconds with its first streamed file at 42.210 seconds, 20 model calls and zero repair rounds. Its persisted manifest records `flow-v2`; historical SSE replay matched exactly. Accepted HTML SHA-256 is `dc65177b9c8fa0130c94ba63188034494a8ac6266f7e095f69f73a0150e4ca98`. Desktop and 375px sandboxed previews passed increment/reset interactions, opaque-origin checks and no-overflow/no-script-error checks.

Archived `flow-v2-stage-mobile.png`, `flow-v2-production-desktop.png` and `flow-v2-production-mobile.png` ([location and hashes](#acceptance-evidence-retention)) show the accepted Versions from source `2364358`. Private full HTTP/SSE/version/checkpoint evidence remains under `/var/lib/formlane/verification/issue32-23643589/{stage,production}`; the original local browser evidence directory is `/tmp/formlane-32-evidence.BtaDkt`. Owner capability files are private and must not be published.

After acceptance, the issue #32 API/worker services on 8096 were stopped with zero queued/running stage Runs. Their database, private environment, immutable release and evidence remain retained. Production services and the other session's 8094 environment were preserved.

### Browser CI provisioning and production smoke (2026-11-13)

Instrumented [cold-start probes](https://github.com/Muluk-m/formlane/actions/runs/43406859721) and [post-DBOS probes](https://github.com/Muluk-m/formlane/actions/runs/43407820391) captured Chrome main processes blocked in `folio_wait_bit_common`, major executable-page faults and growing disk reads with negligible CPU/memory pressure. Post-DBOS launch reached 8.47 s. Changing HOME or DBus addresses did not consistently improve it. [Controlled paging probes](https://github.com/Muluk-m/formlane/actions/runs/43408429879) observed system Chrome 156 launch in 7.31 s; pre-reading the same build's files took 12.20 s, followed by a 0.26 s launch. Earlier runners supplied Chrome 157. These measurements identify cold disk paging as an observed startup bottleneck; the original 15 s failure lacked process measurements, so its exact stall cannot be reconstructed.

The CI change pins Ubuntu 24.04 and reads the installed Chrome bundle immediately before the browser regression step, preparing cold image pages before the existing bounded launch. It records the browser version and retains the system browser and its existing AppArmor policy. A trial replacement with SDK-managed Chromium 158 first exposed its missing namespace allowance; after provisioning that allowance, [candidate CI 43409482863](https://github.com/Muluk-m/formlane/actions/runs/43409482863) passed startup and the three dedicated gates but failed 17 remaining browser regressions with closed-browser errors. That replacement and its custom profile were withdrawn. Runtime code, the 15 s launch deadline, assertions and production executables are unchanged. Temporary diagnostic workflows are removed; normal backend CI exercises the original regression after browser-file preparation.

A fresh real-provider production Run/Version `64f5b519-9687-43a1-ac9c-d1031c6fd8e0` on backend source `2364358906d524654eb846f97d389435164448af` saved independently accepted output in 108.918 s, streamed its first file at 43.594 s, used 18 model calls and required zero repair rounds. Historical SSE suffix replay matched exactly. Sandboxed 1280px/375px previews passed increment/reset (0 → 1 → 0), opaque-origin, no-overflow and no-script-error checks. Accepted HTML SHA-256 is `613ca1207cf6dee351ebad3176d8e1c795341c8da928a11eb61c55f0a876fca8`. Frontend identity remains `202611131351` / `e1871e318e8e`. This is acceptance of the existing production runtime; this CI-only repair does not require a backend or Pages activation.

Private HTTP/SSE/checkpoint records are `/var/lib/formlane/verification/chromium-startup-20261113/production`. Diagnostic artifacts, accepted source and desktop/mobile screenshots are archived outside the checkout at `/Users/qiqian/Backups/formlane/browser-startup-20261113`, with `SHA256SUMS` hash `7e900afcfafc4870ea70b67d1b37e05eff6040d5a35652af1fcd95692d0d411f`. Directory permissions are 0700; archive files are 0600. No owner capability or capture is committed.

### Iterative acceptance activation (2026-11-13)

Reviewed source `4ff635eaa0b151cab45e51f1a02fc8fd2c6c727e`, merged by [PR #43](https://github.com/Muluk-m/formlane/pull/43) as `80a1b569e513d12d471811de305416669926cd5f`, replaces fixed repair counts with Mike's explicit next-iteration decisions until current-source independent acceptance. Cancellation, provider/operation failures and lease fencing still terminate work. Rejected terminal tools preserve a recoverable native turn; acceptance errors identify missing file inspection and evidence. There is no schema or dependency change, but the changed source/config manifest prevents replay of older unfinished Runs.

Exact-candidate [backend CI 43426064464](https://github.com/Muluk-m/formlane/actions/runs/43426064464) passed **312 tests**: 17 equivalence/iteration, 12 native CrewAI, 29 DBOS/compatibility and 254 remaining regressions, plus Ruff. [JavaScript CI 43426064433](https://github.com/Muluk-m/formlane/actions/runs/43426064433) passed. Independent review approved the coordinator capabilities, evidence fences and deterministic replay. Eight compatible frozen comparisons remain; four historical fixed-repair recordings retain their original bytes and are superseded by semantic iteration tests. Native contracts cover four repairs before acceptance, QA-only corrections, stale decisions, missing decisions and interrupted iteration replay.

The source archive SHA-256 is `9a7e95b4f9bec45048317547c9c9a6de75c33c366d61ab90b0ad818f795827f0`. The fresh frozen Python 3.13 environment loaded all seven stages as non-root `formlane`, imported the candidate delivery package and compiled through the protected compiler with both stage and production environment configuration. Every accepted Run's persisted source manifest matched every candidate Python/YAML/text file.

| Staging scenario                          | Run and accepted Version ID            | Wall seconds | First file seconds | Model calls | Repair rounds | Reused operations |
| ----------------------------------------- | -------------------------------------- | -----------: | -----------------: | ----------: | ------------: | ----------------: |
| Initial build                             | `7f5eab5e-bc64-43b3-b151-17fc854cebb0` |      104.934 |             45.916 |          18 |             0 |                 0 |
| Quick edit                                | `7271f891-03c0-4205-84ed-2edaf7424d85` |       89.887 |               none |          16 |             0 |                 0 |
| Plan follow-up and worker SIGKILL/reclaim | `6ae992b9-d84e-4f47-b526-364fbd46dc11` |      170.925 |               none |          18 |             0 |                14 |
| Cancellation and same-run resume          | `58212ab2-10b4-4e09-808a-5fe59da401f2` |       85.279 |               none |          12 |             0 |                 5 |
| Tool-library request                      | `35a4dca1-a1d2-46ea-9448-5e8a385328a3` |      271.459 |            130.274 |          18 |             0 |                 0 |

All five saved accepted source/HTML and passed exact historical SSE suffix replay. Recovery preserved committed checkpoint hashes/timestamps and the prior saved Version. Counter interactions passed in opaque 1280px/375px previews, including step selection across reset. The accepted library passed listing and borrowing at both widths with clocks on Friday, Sunday and Monday; dates before the next Sunday were included and Sunday itself excluded. No horizontal overflow or script errors were observed. Local headless Chrome did not deliver mouse events to the borrow-submit control in the date probe; its precise cause remains unknown. The independent Ego Browser mouse flow succeeded on the identical saved HTML, and all six date/viewport cases passed using keyboard submission. This tooling limitation was not hidden by changing application source or assertions.

Production drained to **zero queued/running Runs** before the worker stopped. Activation at `20261113T125351Z` selected `/opt/formlane/python-backend/releases/acceptance-recovery-4ff635eaa0b1`. Full PostgreSQL backup `/var/lib/formlane/backups/issue32-switch-20261113T125351Z/formlane.dump` has SHA-256 `1e57ccea6fe17302c5f68035f886ace169183036354ee6e7dab5b65a04812d9a`; `pg_restore --list` passed. The private directory retains the environment, switch helper, record and rollback command persisted before switching:

```bash
sudo /var/lib/formlane/backups/issue32-switch-20261113T125351Z/rollback.sh
```

Rollback drains the new worker, backs up again and restores executable `runtime-32-2364358906d5` while retaining live database writes. Loopback and public health checks passed with real `grok-4.7` and configured credentials/executor. Private stage evidence is under `/var/lib/formlane/verification/iteration-4ff635ea/{stage-counter,stage-library}` and `/Users/qiqian/Backups/formlane/iteration-4ff635ea`; owner capabilities and captures remain outside the checkout.

[Pages deployment 43429094922](https://github.com/Muluk-m/formlane/actions/runs/43429094922) deployed exact candidate `4ff635eaa0b151cab45e51f1a02fc8fd2c6c727e` after backend activation. Both frontend origins report `202611132054` / `4ff635eaa0b1`. Production API/worker PIDs `412161` / `412162` had working directories in the activated candidate. Dedicated 8096 services were stopped after their queue drained; the other session's 8094 services were preserved.

The original failed tool-library project `e7e42443-148d-4acd-94ab-82c224869bac` was regenerated through the public HTTPS API under its existing owner. Fresh Run/Version `63b6463f-9dcc-42d0-99ef-e5e6cf2311d5` saved Version 1 in **320.909 s**, streamed its first file at **144.408 s**, used **21 model calls** and required **zero repair iterations**. Its source manifest matched the candidate and its historical SSE suffix replay matched exactly. Accepted HTML SHA-256 is `d42e514b70635e8c0a2d5969167d3d0dd76b06c17d651e75898eea8bd11dae35`. The old failed Run remains historical; its incompatible checkpoints were not rewritten.

The deployed workbench rendered the saved Version with completed status, the expected frontend identity, an opaque preview sandbox and no page errors. Accepted output passed listing drills/ladders, empty-date rejection, successful borrowing, dynamic seed dates and strict pre-Sunday filtering at Friday/Sunday/Monday clocks in 1280px/375px previews, without overflow or script errors. Date probes used keyboard controls; the independent native mouse flow also listed, borrowed and included a new drill in the due list on the identical saved HTML. Existing public counter `8tq3mrv54j` remained on the frontend domain and passed `0 → 2 → 0`.

Production HTTP/SSE/version/checkpoint evidence is `/var/lib/formlane/verification/iteration-4ff635ea/production-library`. All local acceptance captures, probes, source archive and switch record are under `/Users/qiqian/Backups/formlane/iteration-4ff635ea`, directory mode 0700 and file mode 0600. Its 75-file `SHA256SUMS` manifest has SHA-256 `93963edba2dea0bfa23d6884f5de4d51a987627b5c3b8d28315a29cc760b5c10`. Real-provider acceptance completed without needing a coordinator repair; iterations beyond the former limit are proved by the native contract suite, not claimed as observed in these real-provider Runs.

## Historical platform

The predecessor used Pages Functions, the Hono Worker `formlane-api`, Drizzle/D1 `atoms-demo` and a Node/OpenAI Agents SDK executor on the approved GCP VM. The final write-fenced cutover to Python/PostgreSQL completed on 2026-11-12; the snapshot, hashes and acceptance evidence are recorded above. [ADRs 0010 and 0012](../adr/README.md) preserve the decisions, and the [historical deployment guide](https://github.com/Muluk-m/formlane/blob/8a94fed953c6/docs/operations/deployment.md) preserves old procedures and release evidence. Those procedures no longer govern deployment or recovery; Cloudflare now serves static assets, with the legacy Worker retained only for old-client forwarding.

## Legacy retirement (2026-11-13)

The targets below were recorded before deletion in [PR #26](https://github.com/Muluk-m/formlane/pull/26), merged as `759ae17` after CI passed. All listed VM targets were then removed after backup verification and a fresh dependency/service fence. Private backup `/Users/qiqian/Backups/formlane/legacy-cleanup-20261113/vm-retired-runtime.tar.gz` is approximately 2.1 GB, SHA-256 `88bf5fa73c98c7b08c19cfdfe3f25973a2839b193000decd919133e16ffaa80a`. Gzip integrity passed; all 21 exact deletion targets were present among 127,771 archive members; the archived final D1 snapshot matched its recorded hash. `SHA256SUMS` and `backup-receipt.json` beside it retain the recovery inventory. Directory mode is 0700 and archive mode 0600. The archive also contains active environment files: restore only selected reviewed paths, never unpack it over the running system.

| Target                                                                                                                                                                                                | Backup / retirement condition                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository migration script, D1 importer/test, unreferenced `e2e-guard`, null `test` deployment target                                                                                                | Removed in PR #26; recoverable from Git revision `6aa6e08`. PostgreSQL recovery replaces reverse D1 rollout.                                                                                                                    |
| VM releases `idle-recovery-pr17`, `role-prompts-pr14`, `stage-20261112`, `workflow-rewrite-20261113`, `flow-release-20261113`                                                                         | Removed; archive above, exact paths under `opt/formlane/python-backend/releases/`. No retained symlink/`.pth` or running process referenced them at deletion.                                                                   |
| Disabled `formlane-budget-stage-api.service`, `formlane-budget-stage-worker.service`, `/etc/formlane/backend-budget-stage.env`                                                                        | Removed after confirming inactive; archive above, original paths relative to `/`. Current staging uses workflow-stage units.                                                                                                    |
| Disabled `formlane-executor.service`, `/opt/formlane/executor`, `/opt/formlane/executor-before-project-templates-136940bc`, `/opt/formlane/releases/workspace-8a94fed`, `/etc/formlane/executor.env*` | Removed; archive above includes both executor symlink and its target. No active service or cron file referenced the executor environment. Other historical Node release directories were outside this deletion list and remain. |
| Old `/etc/formlane` environment backups                                                                                                                                                               | Removed six older backup files; archive above. Retained exactly `backend.env.before-flow-v1-20261113T041840Z` and `backend.env.before-budgets-20261113T045652Z`, plus the three ordinary environment files.                     |
| `/opt/formlane/verification`                                                                                                                                                                          | Removed; archive above preserves historical acceptance source, model/tool event JSON and caches. No active process or service referenced it.                                                                                    |

Protected dependencies: **do not delete `durable-recovery-20261112`**. Production `flow-v1-20261113b`, staging `flow-release-20261113d` and retained rollback releases resolve their compiler symlinks into it. Retiring it requires packaging the complete pnpm dependency graph, changing each active `COMPILER_COMMAND`, and proving the exact commands before switching. This cleanup does not relocate it.

Keep `replay-budget-20261113` and `flow-v1-20261113` until production has been stable for a full week after activation (earliest 2026-11-20, subject to actual stability). Keep current staging, `formlane_test`, and existing database recovery snapshots. Old `formlane_stage` and `formlane_budget_stage` have no observed connections but remain until that stability gate; then take verified `pg_dump` backups before dropping either. `formlane_workflow_stage` is active.

Cloudflare inspection matched account `252fba810f75c0370e5aa7200abc8f80`: `atoms-demo-web-test` does not exist; D1 `atoms-demo` is `ffd1afdb-33f4-4063-ae97-4a624c034cd7`; the latest `formlane-api` deployment selects version `51e2cf38-563b-4ee3-8b3b-fb2e27e45a94`. Retain Worker/D1 until the stability gate, historical request evidence confirms old clients no longer need forwarding, and the final snapshot is independently backed up. A short quiet live tail alone does not establish absence of old clients. The VM final snapshot hash was rechecked against the recorded SHA-256 before archiving.

The shared checkout's untracked `docs/internals/reviews/2026-11-11-demo-acceptance.md` described the retired D1 acceptance and was deleted on 2026-11-13.

### Completion evidence

The cleanup ran on the verified `formlane-agent` VM in `roibest-internal-apps`, zone `us-central1-c`, as authorized. `systemctl daemon-reload` removed the retired units without restarting any active Formlane service. Production API/worker PIDs remained `277411` / `277412`; staging API/worker PIDs remained `273317` / `273321`. Both active environment-file hashes were unchanged. `/healthz` and `/api/health` returned 200 on both loopback ports 8090 and 8094. Each release's exact configured `COMPILER_COMMAND`, executed as non-root `formlane` through its own Python bridge, compiled vanilla and React TS source successfully and verified source hashes. Production remains `flow-v1-20261113b`; staging remains `flow-release-20261113d`.

| Observed metric                    |         Before |          After |
| ---------------------------------- | -------------: | -------------: |
| Root filesystem used (bytes)       | 19,999,547,392 | 14,667,390,976 |
| Root filesystem available (bytes)  | 10,055,073,792 | 15,387,230,208 |
| Reported filesystem usage          |            67% |            49% |
| Python release directories (bytes) | 11,609,444,352 |  6,066,565,120 |

The observed root-filesystem reduction was 5,332,156,416 bytes (about 5.3 GB); concurrent work added `followups-5b3dbdc-20261113`, which was preserved. These are point-in-time measurements rather than a claim that unrelated filesystem activity stopped.

Repository verification: syntax/Biome and production inspection passed; unsupported deployment arguments were rejected before external commands; local links resolved in the edited guidance. [JavaScript CI](https://github.com/Muluk-m/formlane/actions/runs/43378357044) passed. [Backend CI attempt 3](https://github.com/Muluk-m/formlane/actions/runs/43378357060/attempts/3) passed Ruff and all 208 tests. Attempts 1 and 2 had varying browser failures (Chrome startup timeout; click state and seeded-randomness observations); tests, validator code and runtime settings were unchanged between attempts. The green run does not establish that those intermittent browser failures are fixed. No new application build or production deployment was performed for this cleanup.

## Commit history rewrite (2026-11-13)

All branches were rewritten to replace the former company author/committer identity and `Co-authored-by` trailers with `Nain Ma <maqiqian0316@gmail.com>`; GitHub merge committers and `Cursor Agent` commits are unchanged. Trees are identical, so released source did not change, but every rewritten commit has a new hash. Commit references in this repository were updated. Hashes recorded elsewhere before the rewrite (VM `RELEASE_COMMIT` files, Pages `/version.json`, CI run pages, merged PR pages and read-only `refs/pull/*`) keep old values until their next release. The pre-rewrite mirror, its SHA-256 and the old-to-new commit map are kept privately in `/Users/qiqian/Backups/formlane/history-before-rewrite-20261113T065427Z`; for example production backend `e415db4` is now `4639c43` and the flow-v1 merge `685d07f` is now `ee87304`.

## Visual selection release (`flow-v3`)

[PR #53](https://github.com/Muluk-m/formlane/pull/53) implements [issue #46](https://github.com/Muluk-m/formlane/issues/46) and [ADR-0016](../adr/0016-version-bound-visual-selection.md). Its integration and staging work does not activate production. The current production identities above remain a separate release record.

The candidate requires Alembic `0005_selection_evidence`, matching API/worker code and its own compiler supporting separate canonical/editor artifacts. Private selection evidence is stored on Runs and bounded summaries on Messages; existing rows remain nullable. Execution eligibility advances to `flow-v3`, while workflow/operation names and the `flow-v1/candidate/` reader namespace remain frozen. Older histories are readable but cannot execute or Resume under the new acceptance contract. Never edit saved manifests to bypass that boundary.

Every newly saved Version requires Alex validation, David validation and David's explicit approval of native current-build desktop/mobile images received in the same review stage. Client crops and reconstructed baseline images are context, not acceptance evidence. The matching frontend must preserve Current/Viewed/Published separation and submit the expected Current version with the immutable attachment.

Isolated verification uses `/opt/formlane/python-backend/releases/issue46-selection-20261114` and dedicated `formlane_issue46_test` / `formlane_issue46_stage` databases. Real-provider staging is assigned loopback 8098 with separate issue46 services; it must not replace production or the other session's 8094 services. Keep the imported package and compiler command pinned to the exact tested release. Evidence belongs in private `/Users/qiqian/Backups/formlane/issue46-acceptance-20261114-bVgiVU`, outside source checkouts; owner capabilities and image bytes must not enter committed records.

A future authorized activation must drain work, retain the complete PostgreSQL/DBOS backup and previous release, explicitly migrate with API/worker stopped, and activate compatible backend/compiler/frontend artifacts together. The earlier executable-only `flow-v2` rollback procedure does not apply to this schema transition: older readiness checks require `0004_version_acceptance_checks`. Database restoration or downgrade is a separate coordinated recovery decision that must account for new writes and selection evidence. Never restore a staging database into production.

### Isolated acceptance (2026-11-14)

Backend source `de9ec7764c7ebb2f23f12448735740bfe914e563` ran the real configured provider in the dedicated stage above. The integration includes compiler/editor parity fixes and workspace lifecycle/capture fixes verified against that stage. No production activation was performed.

| Scenario                             | Run and accepted Version               | Wall seconds | Committed model calls |
| ------------------------------------ | -------------------------------------- | -----------: | --------------------: |
| Vanilla baseline                     | `d57876a6-f36e-492f-9123-037ea06df6d2` |      191.509 |                    18 |
| React TS baseline                    | `fb7a7731-7149-407c-b9f5-adfbb0efdfa2` |      348.625 |                    20 |
| Hero typography                      | `e71a576e-d562-47a5-9e8d-2aa6d243ab1a` |      147.214 |                    18 |
| Span-to-heading parent selection     | `9cf37cf8-2dad-4ed1-834f-ce184d7a9072` |      134.094 |                    16 |
| One repeated card                    | `44850d7f-8dd1-4fc1-9064-f18b0ca53e06` |      183.420 |                    18 |
| Explicit shared button styling       | `edb34e88-1940-4f5e-9ce3-48fabe536fc4` |      309.744 |                    21 |
| Open reservation modal               | `b99aac27-88ea-496e-ab78-2d5c4340739c` |      458.467 |                    26 |
| Planned approval behavior and Resume | `10fc1c0e-c181-42a5-be34-59514ea76927` |      545.117 |                    44 |

Baseline first-file events arrived at 86.633 s and 102.397 s. Follow-up metrics contained no `file_delta` event, so first-file latency is unavailable; source edits still committed through tools. Counts include committed model operations, not every provider transport attempt. The approval case needed one source-repair stage: David rejected an unrequested navigation item, then accepted the restored three-item navigation with approval behavior preserved. Earlier card/shared/modal review attempts also rejected incomplete target evidence before acceptance; those refusals remain in the private metrics.

Independent browser operation verified all six requested deltas and functional Undo. Coverage included preserved title/CTA behavior, only one recommended card, shared primary colors with unchanged secondary controls, modal Escape/focus/required-name validation, and request → pending → reject/retry → approve plus preserved reservation. The approval result also passed a measured 375px iframe viewport without horizontal overflow; the workspace's ordinary mobile preset measured 388px. Undo restored immediate borrowing and removed the approval list. The projects' publication pointers remained unset throughout these cases; separate workspace/API regressions cover a nonempty frozen publication.

The approval Run was interrupted after committed source work, cancelled and explicitly resumed after its browser observation tab closed. It completed with the same Run ID and attempt 2. All 19 prior checkpoint digests/timestamps and selection SHA-256 `fe820fb3785222ed3b5f4c99ab3c0409c33341df510e7d268c3cf48a4be8ef6f` survived through completion; cancellation preserved the accepted baseline and publication pointer.

Headed sandboxed Chrome captured real selected pixels for the current tab and a scrolled target at device scale 1.25. Pixel comparisons exclude only two video-conversion edge pixels and allow one pixel of fractional rounding. Real wrong-tab capture and native permission rejection preserved the selection, comment, expanded Layers and Edit state without attaching an image. The wrong-tab driver disables only the `preferCurrentTab` picker hint because Chromium's title-selection flag operates its standard chooser; it never substitutes a MediaStream or bypasses the application's surface checks. The initial wrong-tab attempts stalled in the preferred-tab chooser and are not passes.

The private archive named above contains accepted source/details, per-case browser assertions, screenshots, checkpoint metrics and recovery evidence. `SHA256SUMS` binds its retained files; no owner capability or capture is committed. The earlier compiler-tip CI failed formatting and one seeded-randomness regression. Eighteen subsequent diagnostic observations and default-seed validation passed without a runtime change; this does not establish a fix for that earlier intermittent failure. The final PR checks determine integration readiness.

The 60-file acceptance manifest has SHA-256 `4d8f649643f0451b7ea7cde11ed8e8f988baed771d1ec706e77310bbade1c53f`. The archive directory is mode 0700 and its files are mode 0600.
