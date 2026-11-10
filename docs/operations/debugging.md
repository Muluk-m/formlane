# Debugging

## Establish the failing boundary

Record the local/deployed environment, browser owner, project/version, run ID, event cursor and exact symptom. Redact secrets and generated private content. Inspect relevant source/configuration before retrying; a user-reported failure is evidence, not something to repeat just to prove it exists.

| Symptom                                     | Start here                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Project request rejected or missing         | Contract input/output, ownership cookie/header, oRPC error mapping, local proxy                                                   |
| Generation never starts                     | Executor systemd/polling, matching bearer token, HTTPS control-plane URL, D1 queued run/lease and executor provider configuration |
| Candidate exists but no version is saved    | Browser report artifact hash, failed checks, David's review and manager repair decision                                           |
| A partial document replaces an older result | Validated version commit and active-run fence                                                                                     |
| Generation fails during execution           | Persisted failure category/deadline, executor journal, current lease and named checkpoint, provider/tool evidence                 |
| Reload loses visible progress               | Owned event subscription, last sequence cursor, D1 replay and UI event reduction                                                  |
| Cancelled work writes a later result        | Run fence before termination and conditional late-write rejection                                                                 |
| Restore changes the public app unexpectedly | Current pointer versus published pointer; these must remain separate                                                              |
| Public link shows the wrong version         | Published version selection, slug lookup, republish operation                                                                     |
| Preview differs from downloaded code        | Viewed/current version selection, iframe sandbox, HTML extraction                                                                 |
| Tabs or separators face the wrong way       | Base UI orientation custom variants in shared globals.css                                                                         |
| Works in Node but not Worker                | workerd runtime support and bundled dependencies                                                                                  |
| Wrong branding or untranslated label        | Single i18n catalog and shared Logo; do not add a local dictionary                                                                |

## Local evidence

Use local Wrangler/workerd and local D1 for runtime/persistence diagnosis. Apply migrations to a fresh local database when checking schema behavior. Do not use a production database to reproduce destructive operations. Browser network evidence should include the failing path/status or SSE event, not credentials or entire private prompts.

Generation is real-only. Inspect D1 runs, events, leases and checkpoints rather than inferring execution from SSE. Disconnect closes observation only; cancel fences writes. The persisted 15-minute deadline survives reconnect and lease reclaim. A 60-second lease is refreshed every 10 seconds; heartbeat failure aborts the executor's local work. Restart reuses completed checkpoints; interrupted calls can repeat. Failed browser checks return repair evidence while preserving the prior version.

## Ownership and generated content

Use two separate browser identities when checking private-project isolation. Published HTML is the only deliberate public surface; it must not expose project chat or owner tokens. Preview HTML remains sandboxed. A generated page's own styling or JavaScript failure is distinct from a bug in the Atoms shell.

## Deployment diagnosis

First read [deployment](deployment.md). Verify Cloudflare and GCP identities independently before authorized remote actions. Correlate API and executor build versions, VM service journal, lease owner, run ID and event cursor. Historical wrong-account URLs or predecessor-generation checks are not current acceptance. The Cloudflare Free CPU failure was resolved architecturally by moving execution to GCP, not by enabling a paid plan or relaxing browser isolation.

## Closing a diagnosis

State the observed cause, affected path, changed behavior and verification actually exercised. Name an unresolved external prerequisite precisely. A build, HTTP 200, SDK provider proof and deployed end-to-end browser acceptance prove different things. See [ADR-0012](../adr/0012-durable-agent-harness.md).
