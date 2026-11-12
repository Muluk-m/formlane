# Deployment

## Current rollout status

**Python/PostgreSQL is the verified production authority.** Static Pages deployment `fcf25487` serves merged release `9dce745`; `/version.json` reports commit `9dce7459ab36`. Its JavaScript/CSS artifacts match the accepted `f7dfcb3` build, including the latest light workspace layout. The final fenced import passed before activation; `backendReady` is true. Python and JavaScript CI plus GitGuardian passed before merge.

| Resource                      | Current identity / boundary                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| Cloudflare account            | **Maqiqian0316@gmail.com's Account**, `252fba810f75c0370e5aa7200abc8f80`                      |
| Pages                         | Project `formlane`, canonical frontend **https://formlane-9dp.pages.dev**                     |
| Python API / public documents | **https://136.65.182.87**                                                                     |
| Reserved GCP address          | `formlane-api`, region `us-central1`                                                          |
| GCP identity                  | `maqiqian@roibest.com`, project `roibest-internal-apps`                                       |
| Existing VM                   | `formlane-agent`, zone `us-central1-c`                                                        |
| Backend release               | `/opt/formlane/python-backend/current`                                                        |
| systemd services              | `formlane-python-api`, `formlane-python-worker`, non-root user `formlane`                     |
| Current service environment   | Private `/etc/formlane/backend.env`; production database `formlane`                           |
| Databases                     | Production `formlane`; isolated `formlane_stage` and `formlane_test` retained                 |
| Public ingress                | Caddy 2.11.9 on 80/443; only these web ingress ports are open                                 |
| Private listeners             | FastAPI `127.0.0.1:8090`; PostgreSQL loopback port 5432                                       |
| Provider                      | `grok-4.7` at `https://sub2api.qiliangjia.org/v1`; secrets only in private server environment |

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

The root [deploy script](../../scripts/deploy.mjs) builds and uploads **static Pages assets only**. It does not deploy a business Worker, migrate a database, change services or upload Functions. No `API` service binding or runtime API-origin binding is needed. Target settings live in [deploy/environments.json](../../deploy/environments.json).

Keep the canonical Pages hostname so existing localStorage `atoms_uid` capabilities survive. New clients send that capability as `x-owner-id`, omit cookies and reject bootstrap identity replacement; Python prioritizes the supplied owner header over legacy cookies. Backend `ALLOWED_ORIGINS` must explicitly include the canonical frontend and approved preview/local origins, including preflight for `Content-Type`, `X-Owner-ID` and `Last-Event-ID`. Preserve exact-origin credentialed support for older clients during transition.

`apiOrigin` and `apiPublicOrigin` select `https://136.65.182.87`; `PUBLIC_ORIGIN` agrees with the public origin. The guard maps these to public build-time `VITE_API_ORIGIN` / `VITE_API_PUBLIC_ORIGIN`. Builds require explicit validated origins; deployed targets require HTTPS. Changing a runtime Pages setting does not rewrite built assets. Test target fields remain unset until that separate target is verified. `backendReady` is an acceptance gate, not deployment authorization.

Vite generates temporary `/api/* <apiOrigin>/api/:splat 307` and `/p/* <apiPublicOrigin>/p/:splat 302` redirects. The first preserves methods and bodies for older loaded SPA clients; the second retains shared public links. New clients call Python directly. Pages serves static files with SPA fallback for `/project/...`; no Functions or `_routes.json` participate. Local Vite dev/preview mirrors redirects including queries. [Cloudflare's redirect rules](https://developers.cloudflare.com/pages/configuration/redirects/) describe supported statuses and splats.

### Required release sequence

1. **Prepare and accept stage.** Verify exact Cloudflare and GCP identities, final release artifacts, Caddy TLS, CORS and both services against the isolated stage database. Apply reviewed Alembic explicitly. Finish real-model acceptance of the final implementation, including the check-hash fix. Record prior Pages/backend release identities and private recovery snapshots. Keep production activation blocked.
2. **Fence legacy writes.** Reject new legacy project mutations and generation starts while allowing already-authorized runs to drain under controlled ownership. Stop the old Node executor once runs are terminal; verify no old producer, queued claim or writable legacy ingress remains. Explicit cancellation, if required, must itself finish before the final export. A browser connection closing is not a drain.
3. **Export the final authority.** Export all six D1 business tables after draining and fencing. Keep the immutable snapshot private and record counts/hashes, pointer relationships, message order, event cursors and ancestry-normalization policy. Rehearsal data is not a substitute for this snapshot.
4. **Import into empty production.** Keep Python production writers stopped/fenced. Confirm final `formlane` has no business rows; apply Alembic, import once through `formlane.import_d1`, then run `--verify-only` against the same snapshot and retain its manifest. A divergent populated target is a stop condition, never permission to merge or overwrite. Keep `formlane_stage` and `formlane_test` isolated.
5. **Switch one authority.** Configure API and worker together for the imported final database and intended release. Preserve a write fence while verifying data and routing. Arrange temporary legacy-ingress forwarding to Python for old clients as needed; it must never leave a second writable D1 backend. Enable PostgreSQL writes only after old writers are fenced. Run controlled production acceptance before setting `backendReady: true`.
6. **Activate static Pages.** Within the authorized release, run `pnpm run deploy production` to inspect the target and account guard; `--apply` rebuilds with target origins and uploads static assets. Set `BUILD_COMMIT` to the full verified release SHA before applying: local builds do not infer it from Git and otherwise report `unknown`. The same mechanism supports a separately verified test target. `backendReady` must already reflect accepted backend/data state. Record the deployed Pages identity and verify `/version.json` alongside the backend release/database identity.
7. **Verify the actual boundary and record the result.** Exercise preserved anonymous ownership, CRUD, real generation/follow-up, SSE replay/cancel, history/restore/Undo, remix, exact ZIP, publication/unpublication and SPA reload. Exercise a browser loaded before cutover: GET/POST/DELETE, SSE and downloads must follow the temporary API redirect with method/body/owner intact. Check allowed/denied CORS and existing anonymous public links on HTTPS. Record final run/version IDs, manifests and limitations; only then label the rollout complete.

### Explicit database operations

[Models](../../apps/backend/src/formlane/models.py) and [Alembic migrations](../../apps/backend/migrations/) define PostgreSQL's six business tables. API startup does not create them. With the intended database configured privately, `pnpm db:migrate` applies `alembic upgrade head`.

From the backend environment, `uv run python -m formlane.import_d1 /private/path/snapshot.sql --manifest /private/path/import-manifest.json` performs the offline import. Repeat with `--verify-only` to compare without inserting. The input may also be an exact six-table JSON export with messages in original row order. The tool reads the offline snapshot; it does not fetch D1 or create schema. Its table lock, transaction and exact-manifest check reject divergent targets. Review [data fidelity](../internals/data-model.md#d1-migration-fidelity) before importing.

Database creation, migrations, secret changes and service activation are distinct authorized remote actions. Source cleanup is not permission to delete live Worker/D1 resources or historical exports. Preserve rollback evidence until the release owner explicitly retires it.

## Recovery without split writes

Before PostgreSQL accepts production writes, a failed cutover can remain fenced while restoring the previously coherent legacy routing/services and confirming their original database authority. Do not enable both systems while deciding which to retain.

After PostgreSQL accepts writes, restoring old Pages assets alone can send writes to stale D1 and split project history. Keep forwarding to the authoritative Python/PostgreSQL backend, or fence **all** writers and perform an explicitly reviewed data/backend recovery before reopening traffic. The importer is one-way exact snapshot migration, not an automatic reverse sync. Never replace production with stage data or an earlier export after new writes without a coordinated recovery decision.

A worker restart preserves completed checkpoints; lease expiry permits reclaim, while cancelled/expired work stays fenced. A stale checkpoint does not justify accepting stale build/check/review evidence. Preserve Chromium sandboxing and private environment isolation during recovery.

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
