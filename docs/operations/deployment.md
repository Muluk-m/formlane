# Deployment

## Current rollout status

**Python/PostgreSQL with DBOS and the flow-first delivery workflow is the production authority.** Backend release `flow-v1-20261113b` runs commit `e415db4`. The latest verified static frontend runs `e1871e318e8e`, build `202611131330`, deployed successfully by [GitHub Actions run 43372366587](https://github.com/Muluk-m/formlane/actions/runs/43372366587). Both frontend domains returned that identity. Frontend and backend commit IDs may differ when their contracts remain compatible. See [flow-first delivery](#flow-first-delivery-flow-v1) for backend activation and rollback evidence.

| Resource                    | Current identity / boundary                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Cloudflare account          | **Maqiqian0316@gmail.com's Account**, `252fba810f75c0370e5aa7200abc8f80`                                    |
| Pages                       | Project `formlane`, canonical frontend **https://formlane.nainma.online**; original Pages hostname retained |
| Python API                  | **https://136.65.182.87**; public viewer navigation stays on the frontend domain                            |
| Reserved GCP address        | `formlane-api`, region `us-central1`                                                                        |
| GCP identity                | `maqiqian@roibest.com`, project `roibest-internal-apps`                                                     |
| Existing VM                 | `formlane-agent`, zone `us-central1-c`                                                                      |
| Backend release             | `/opt/formlane/python-backend/releases/flow-v1-20261113b` (`e415db4`), selected by `current`                |
| systemd services            | `formlane-python-api`, `formlane-python-worker`, non-root user `formlane`                                   |
| Current service environment | Private `/etc/formlane/backend.env`; production database `formlane`                                         |
| Databases                   | Production `formlane`; isolated `formlane_stage` and `formlane_test` retained                               |
| Public ingress              | Caddy 2.11.9 on 80/443; only these web ingress ports are open                                               |
| Private listeners           | FastAPI `127.0.0.1:8090`; PostgreSQL loopback port 5432                                                     |
| Provider                    | `grok-4.7` at `https://sub2api.qiliangjia.org/v1`; secrets only in private server environment               |

Caddy automatically obtains and renews Let's Encrypt **short-lived IP certificates**. Preserve its TLS state and renewal reachability. The [Caddy template](../../apps/backend/deploy/Caddyfile) requests the `shortlived` ACME profile and sets `default_sni` to the API host: IP clients can omit SNI and the VM receives traffic on its private NAT address. Streaming proxy flush remains enabled. Neither the API nor PostgreSQL is exposed directly. Do not work around TLS failures by disabling certificate verification.

The [API](../../apps/backend/deploy/formlane-python-api.service) and [worker](../../apps/backend/deploy/formlane-python-worker.service) units share the intended private environment and release. The API serves HTTP; the worker claims PostgreSQL leases and executes native CrewAI. The [compiler](../../apps/compiler/) is a bounded credential-stripped Node subprocess, not a second business server. Keep sandboxed Chromium under the non-root service identity. Provider/database credentials must never enter Pages, Vite variables, generated content or logs.

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

Production run `3caf135e-3703-4a64-809c-ee36e45df1e4` saved v1; ordinary follow-up `9f41178a-1a5a-4f09-8154-5e78fc518f8f` saved v2 (HTML SHA-256 `16e13c34bb5b4ad69273943b8f26e9bac41f2e2dbe303dd17b58ea825d3ada8c`). Mouse/Space/Reset observed 0 → 2 → 0. Reload preserved the completed run and cursor 89. Production Undo/restore, remix, exact ZIP, cancel preserving v2, publish/unpublish, cross-owner denial and CORS checks passed on this isolated acceptance project. [Desktop](../screenshots/python-cutover-desktop.png) and [375px mobile](../screenshots/python-cutover-mobile.png) show the retained v2 after the cancellation test; mobile document width equals viewport width.

A concurrent layout release briefly restored legacy routing. Forwarding was immediately restored, and a second six-table D1 export matched the frozen snapshot row-for-row: no data diverged. Its UI changes were integrated into `f7dfcb3` and deployed with static Python routing. [Python CI](https://github.com/Muluk-m/formlane/actions/runs/43227687355) and [JavaScript CI](https://github.com/Muluk-m/formlane/actions/runs/43227687280) passed after integration.

CI uses a per-run password only for its isolated loopback PostgreSQL container. No production secret is committed. Use released action tags, and pass the verified Cloudflare account through `CLOUDFLARE_ACCOUNT_ID`: Pages rejects `account_id` in its Wrangler configuration.

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

### Historical D1-to-PostgreSQL cutover sequence

This one-time migration is retained as historical recovery context. Do not repeat its export/import steps for routine Pages releases; use the routine frontend release procedure above.

1. **Prepare and accept stage.** Verify exact Cloudflare and GCP identities, final release artifacts, Caddy TLS, CORS and both services against the isolated stage database. Apply reviewed Alembic explicitly. Finish real-model acceptance of the final implementation, including the check-hash fix. Record prior Pages/backend release identities and private recovery snapshots. Keep production activation blocked.
2. **Fence legacy writes.** Reject new legacy project mutations and generation starts while allowing already-authorized runs to drain under controlled ownership. Stop the old Node executor once runs are terminal; verify no old producer, queued claim or writable legacy ingress remains. Explicit cancellation, if required, must itself finish before the final export. A browser connection closing is not a drain.
3. **Export the final authority.** Export all six D1 business tables after draining and fencing. Keep the immutable snapshot private and record counts/hashes, pointer relationships, message order, event cursors and ancestry-normalization policy. Rehearsal data is not a substitute for this snapshot.
4. **Import into empty production.** Keep Python production writers stopped/fenced. Confirm final `formlane` has no business rows; apply Alembic, import once through `formlane.import_d1`, then run `--verify-only` against the same snapshot and retain its manifest. A divergent populated target is a stop condition, never permission to merge or overwrite. Keep `formlane_stage` and `formlane_test` isolated.
5. **Switch one authority.** Configure API and worker together for the imported final database and intended release. Preserve a write fence while verifying data and routing. Arrange temporary legacy-ingress forwarding to Python for old clients as needed; it must never leave a second writable D1 backend. Enable PostgreSQL writes only after old writers are fenced. Run controlled production acceptance before setting `backendReady: true`.
6. **Activate static Pages.** Within the authorized release, use the manual Deploy Pages workflow described above, with `backendReady` already reflecting accepted backend/data state. Record the deployed Pages identity and verify `/version.json` alongside the backend release/database identity.
7. **Verify the actual boundary and record the result.** Exercise preserved anonymous ownership, CRUD, real generation/follow-up, SSE replay/cancel, history/restore/Undo, remix, exact ZIP, publication/unpublication and SPA reload. Exercise a browser loaded before cutover: GET/POST/DELETE, SSE and downloads must follow the temporary API redirect with method/body/owner intact. Check allowed/denied CORS and existing anonymous public links on HTTPS. Record final run/version IDs, manifests and limitations; only then label the rollout complete.

### Explicit database operations

[Models](../../apps/backend/src/formlane/models.py) and [Alembic migrations](../../apps/backend/migrations/) define PostgreSQL's six business tables. API startup does not create them. With the intended database configured privately, `pnpm db:migrate` applies `alembic upgrade head`.

From the backend environment, `uv run python -m formlane.import_d1 /private/path/snapshot.sql --manifest /private/path/import-manifest.json` performs the offline import. Repeat with `--verify-only` to compare without inserting. The input may also be an exact six-table JSON export with messages in original row order. The tool reads the offline snapshot; it does not fetch D1 or create schema. Its table lock, transaction and exact-manifest check reject divergent targets. Review [data fidelity](../internals/data-model.md#d1-migration-fidelity) before importing.

Database creation, migrations, secret changes and service activation are distinct authorized remote actions. Source cleanup is not permission to delete live Worker/D1 resources or historical exports. Preserve rollback evidence until the release owner explicitly retires it.

## Recovery without split writes

Before PostgreSQL accepts production writes, a failed cutover can remain fenced while restoring the previously coherent legacy routing/services and confirming their original database authority. Do not enable both systems while deciding which to retain.

After PostgreSQL accepts writes, restoring old Pages assets alone can send writes to stale D1 and split project history. Keep forwarding to the authoritative Python/PostgreSQL backend, or fence **all** writers and perform an explicitly reviewed data/backend recovery before reopening traffic. The importer is one-way exact snapshot migration, not an automatic reverse sync. Never replace production with stage data or an earlier export after new writes without a coordinated recovery decision.

A worker restart reuses completed durable operations. Explicit owner-authorized resume continues the same eligible run with a new attempt; old attempts and producers remain fenced. Runs have no fixed wall-clock deadline. Superseded runs and changed baselines cannot resume. A stale checkpoint never permits stale build/check/review acceptance. Preserve Chromium sandboxing and private environment isolation during recovery.

### DBOS recovery release

Apply the application Alembic migration and `uv run python -m formlane.durable_execution migrate` explicitly against the intended database before activating the new worker. Runtime uses `run_migrations=False`. Preserve the business tables, legacy checkpoint rows and DBOS system schema together in recovery backups. Workflow code/config compatibility is pinned: retain the matching worker release or perform a reviewed migration instead of replaying old operations under incompatible code. Verify process termination/reclaim, same-run resume, completed-operation reuse, stale-token rejection and browser replay before activating the client resume action.

Package the compiler with its root pnpm dependency store and referenced workspace packages. Copying only `apps/compiler` leaves relative dependency links dangling. Override `COMPILER_COMMAND` to the candidate's exact executable during staging acceptance; a successful build through an older absolute path does not verify the release artifact.

Recovery candidate `dbd1543` passed 32 focused PostgreSQL storage/recovery tests, including spawned-process death, legacy checkpoint reuse, interrupted initial dispatch and connection loss during ownership transfer. The populated staging database migrated successfully after making deferred constraints immediate before backfill/DDL. DBOS and application tables must share one database; their separate schemas participate in the same lease-fenced scheduling transaction.

Browser acceptance resumed migrated cancelled run `d6afe371-8748-4572-a5e2-1dec5089f61b` without changing its ID or request: attempt 1 advanced to 2 and completed as v3 at terminal cursor 177. Reload replayed cursor 156 while retaining saved v2. The resulting heading-only revision passed counter interaction 0 → 1 → 0. [Staging workspace evidence](../screenshots/durable-recovery-stage.png) shows candidate `dbd1543` during independent review.

Production was drained before activation: 21 projects, 348 messages, 29 versions, 58 runs, 5,242 events and 549 legacy checkpoints. The full private backup is `/var/lib/formlane/backups/before-durable-recovery-20261112.dump`, SHA-256 `854146267fcbd086684cee47c032363f63812dc9658fc66da9fdecf9e81426e7`. Prior release `role-prompts-pr14` and its private environment backup are retained. Production `/healthz` and `/api/health` returned 200 after activation. The [published counter](https://formlane.nainma.online/p/8tq3mrv54j) remained on the custom domain and changed 0 → 2 when clicked; [production viewer evidence](../screenshots/durable-public-production.png) shows this release.

### Removing whole-run deadlines

Migration `0003_remove_run_deadline` removes the obsolete deadline column. Keep API and worker stopped while applying it, and retain a complete PostgreSQL backup. Pin service `PYTHONPATH` to the active release's `apps/backend/src`; copied editable Python environments may otherwise import a previous release.

The reviewed change preserves DBOS operation names/order and committed results. After Alembic, run [the hash-pinned manifest migration](../../apps/backend/deploy/migrate_execution_budget.py) with the candidate Python environment and `--env-file /etc/formlane/backend.env`: inspect first, then add `--apply`. It accepts only the reviewed original recovery release, PR #17's inactivity-watchdog release, and the target release; it updates matching application/DBOS compatibility metadata in one transaction and rejects other source/config versions. Preserve the preceding release and its compiler dependency graph. Restore the database backup as part of rollback; switching only the executable is insufficient after this schema/manifest migration.

Focused verification covered 89 backend tests and five catalog tests, including historical D1 imports containing the retired deadline field. A simulated hour in the queue followed by an hour of heartbeating execution completed successfully. A production database copy resumed run `82930c09-1cf0-44a7-9d60-24b1bb534479` from attempt 3 to 4, reused its committed operations, completed independent acceptance, and saved v3 at terminal cursor 489. The recovered counter passed 0 → 1 → 0. [Staging evidence](../screenshots/recovery-budget-stage.png) records this acceptance; it is not production activation evidence.

Integration with PR #17 passed another 50 PostgreSQL storage, worker and process-recovery tests and 41 frontend message tests. The migration dry run accepted both live workflow manifests. Queue/resume waiting, checkpoint rollback, cached replay cancellation and stale-producer rejection remain covered without a whole-run watchdog.

### Flow-first delivery (`flow-v1`)

[ADR-0015](../adr/0015-flow-first-delivery.md) replaces the hierarchical Crew. Its durable history is not interchangeable with `crew-v1`/`dbos-v1`: on the new worker those runs fail closed as incompatible and are not resumable. Activation sequence:

1. Stop new run creation and let active runs finish, or record each unfinished run that will be failed as incompatible. Retain a complete PostgreSQL backup and the previous release.
2. With API and worker stopped, apply `0004_version_acceptance_checks`. Readiness requires this revision. The `migrate_execution_budget.py` manifest script is pinned to the previous release and does not apply.
3. Activate API and worker from the same release with pinned `PYTHONPATH`. New runs record `execution_version = flow-v1`.
4. Verify with the real provider: an initial build, a quick-edit follow-up that reuses saved checks, a plan follow-up, cancellation, and a worker restart during build. Record run IDs, model-call counts, time to first file event, wall time and repair rounds.

Rollback restores the database backup and previous release together. The previous API's readiness requires revision `0003_remove_run_deadline`, so restore or downgrade before switching executables.

#### Activation record (2026-11-13)

- Zero queued/running production runs before stopping services. Backup `/var/lib/formlane/backups/before-flow-v1-20261113T041650Z.dump`, SHA-256 `d703bf6999f6fee62cdff38982821bc13fb38b56857c308e68d87badd5bde84d`, contains all business and DBOS tables. Environment backup `/etc/formlane/backend.env.before-flow-v1-20261113T041840Z`; previous release `replay-budget-20261113` retained.
- Alembic reached `0004_version_acceptance_checks`; `current` points to `flow-v1-20261113` (built with the staging-verified virtualenv, unchanged lockfile, compiler link unchanged); the worker's working directory was verified as the new release. `/healthz`, public `/api/health`, the custom-domain frontend and published link `8tq3mrv54j` returned 200.
- Pages was built on macmini2 with the pinned pnpm 11.24.0 and `BUILD_COMMIT` set to the release SHA, then uploaded after `wrangler whoami` matched the designated account. Both frontend origins report `685d07f30b09`; SPA reload, public viewer and the legacy `/api` 307 forward passed.

Production smoke used a fresh anonymous owner and a request unrelated to the staging samples:

| Run                                                         | Route                 |  Wall | First file | Result                                                                                                              |
| ----------------------------------------------------------- | --------------------- | ----: | ---------: | ------------------------------------------------------------------------------------------------------------------- |
| `1ffa11f0-7378-47a5-9e0d-df23a529aa97` ledger initial build | plan → build → review | 235 s |       96 s | Saved; plan 53 s; month total computed from `new Date()` and checked at two clocks                                  |
| `46679514-29de-4c76-bbdb-2336f9820037` color/title change   | quick edit            | 139 s |       42 s | Saved; validation, filter and totals preserved                                                                      |
| `d52767d5-026d-4289-ab2b-b554c3609bcd` add delete           | plan follow-up        | 275 s |       84 s | Saved; an ambiguous planned selector was disputed by Alex, corrected by David and revalidated without a repair loop |

Follow-up release `e415db400a3c98b73685b6d90b0ba157cfe38731` (`flow-v1-20261113b`, no migration) adds per-stage tool budgets after staging run `194cf371-4777-4d31-8ad8-64a630e18416` spent 22 reviewer inspections and 1,002 s. With budgets, staging run `81786069-58c1-462d-89c1-e4d346296e4c` completed the same 2048 build in 384 s with one review round. Production was switched with zero active runs; environment backup `/etc/formlane/backend.env.before-budgets-20261113T045652Z`; previous release `flow-v1-20261113` retained. Pages was unchanged.

Staging (`formlane_workflow_stage`, release `flow-release-20261113b`) reproduced the reported production failure: the identical 2048 night-style request that failed or was cancelled three times in production (`1e28f623…`, `9edbdb6b…`, `a2717c46…`) saved through quick edit in 108 s with game logic untouched. A tool-library build (`32ed3c52-c38e-4277-bf31-d5cf880ed001`, 415 s) computed dates from `new Date()` and was checked at three clocks including Sunday and the following Monday.

#### Follow-up acceptance (2026-11-13)

- **Invalid moves preserve Undo.** Production project `f09a1abb-af0f-4f1c-a2e0-4e890bafaf17`, v5 `e8089f4f-bee5-4d3f-9f1e-a95efe90f67f`, passed actual browser interaction. Its existing board probe set rows `[2,2,16,32]`, `[64,128,256,512]`, `[1024,2048,4096,8192]`, `[16,32,64,128]` with score 37. Clicking Left merged the first pair and spawned a tile, producing first row `[4,16,32,2]` and score 41. A second Left was blocked: all 16 cells and score remained identical. Clicking Undo restored all 16 original cells and score 37. Only iframe memory changed; no project/version mutation was performed. The earlier disposable project `cb3964e1-11d1-4a37-9852-b84ae0e1e618` and `/root/undo-case` were already absent.
- **Pinned Pages CI.** Manual [run 43374706931](https://github.com/Muluk-m/formlane/actions/runs/43374706931) succeeded with input `ref=e1871e318e8ede5e61c6da62cdab437274f670ab`, including `Verify live version`. Independent GETs to both `formlane.nainma.online/version.json` and `formlane-9dp.pages.dev/version.json` returned commit `e1871e318e8e`, build `202611131351`. This proves the selected artifact is deployed even when the workflow runs from a newer `main`.
- **Cancel and Continue through the production UI.** Isolated project `e2a09f22-8b5c-41db-be89-baffc57121c5`, run `01df5e80-4d9f-49a6-adbc-55939c46cbec`, was cancelled with the Stop button during build at attempt 1, after 26 committed checkpoints. Clicking Continue resumed the same run at attempt 2; it completed and saved v1 with that same ID. All 26 pre-cancel checkpoint names, creation timestamps and result hashes remained identical; the final run had 44 checkpoints. The retained set included the planner calls/submit_plan and builder model/file/build operations, establishing reuse of committed work rather than restarting planning. Uncommitted interrupted provider calls are not covered by this reuse guarantee.
- **Saved-result Undo card.** Staging project `027807cc-c334-429d-a06c-3f299986730e` was restored from v2 to its saved parent v1 using the card action. The card then displayed "Undone / Current version 1", its Undo action disappeared, and the preview returned to the v1 title. [Desktop](../screenshots/followup-card-desktop.png) and [375px](../screenshots/followup-card-mobile.png) capture the actual UI. macmini2 passed four ancestry/eligibility tests, the Web typecheck, and five catalog tests. Undo receipts are page-session state: a reload does not infer an Undo from an ordinary historical version.

## Historical releases — Worker/D1 and Node executor

The following is predecessor evidence, **not Python rollout acceptance**. The prior topology used Pages Functions/service binding `API`, Hono Worker `formlane-api`, D1 `atoms-demo` and a non-root Node/OpenAI Agents SDK executor on the same approved GCP VM. Its old instructions and source are retained at [historical revision b8af77af1bb2](https://github.com/Muluk-m/formlane/tree/b8af77af1bb2); the [historical deployment guide](https://github.com/Muluk-m/formlane/blob/b8af77af1bb2/docs/operations/deployment.md) records detailed earlier run evidence. Deleted `apps/server` / `apps/executor` paths belong to that Git revision, not current modules.

| Historical release                                           | Recorded evidence                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform iteration `2032664`, PR #8, merge `987b53ff9f71`    | [CI](https://github.com/Muluk-m/formlane/actions/runs/43221789679); Pages `cfe7d89e`, Worker `0fe9b4c0-c5c5-44b6-bd9f-c9f2413bed3c`; real v3 `f9d42d7d-e3cc-491c-8850-88300e06ea0b`, exact Undo/restore and desktop/375px recovery. Full evidence remains at [revision 4575f9e](https://github.com/Muluk-m/formlane/blob/4575f9e/docs/operations/deployment.md). |
| Workspace review `b8af77af1bb2`, PR #6, merge `9eac92f5a5fe` | [CI](https://github.com/Muluk-m/formlane/actions/runs/43200579708); Pages `2f39b259`, Worker `ad185d7e-2e32-4751-888a-81dcd9075542`; real run/version `6a95da7c-ac5a-4ee2-91ca-47b37b5e0f21`, history/restore and desktop/375px source comparison                                                                                                                |
| Iteration/history `2b20b0c`, PR #4                           | [CI](https://github.com/Muluk-m/formlane/actions/runs/43191000631); real color-only follow-up `cf45f9d3-11fc-4c65-9b20-9af22f239982` preserved accepted +2 behavior and changed CSS only                                                                                                                                                                         |
| Source templates `23c2fcdd2265`                              | [CI](https://github.com/Muluk-m/formlane/actions/runs/43062672465); real React initial run `fcfd8c01-408f-4137-b503-711b82c44932` and follow-up `b7ad58a0-c2e4-4816-bc50-2103efb5f93f`; exact ZIP, restore/remix and frozen publication                                                                                                                          |
| Earlier market acceptance, executor `5c26a95`                | Run/version `a89ff0f4-d116-4e85-80e0-b22de6a46412`, 629 seconds, eight implementation and seven independent checks; artifact SHA-256 `1d73ed4b406a9fa6d59a42f463c15326fda9c5a1f3f379b89b703a014f257d5e`                                                                                                                                                          |

Historical screenshots remain in [docs/screenshots](../screenshots/). The former Cloudflare Free CPU failure motivated moving browser/agent compute to GCP rather than upgrading Cloudflare billing. At original approval the VM was `e2-standard-2` with 2 vCPU, 8 GB RAM and 30 GB disk; $296.45 trial credit, 62 days remaining and a $51.92/month estimate were observed then. These are dated observations, not current balances or a spending cap. The reserved IP and Python deployment reuse the approved VM; they do not change the designated accounts.
