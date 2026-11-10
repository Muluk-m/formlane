# Debugging

## Establish the failing boundary

Record the local/deployed environment, browser owner context, selected project/version, real/mock mode, and exact symptom. Redact secrets and generated private content. Inspect the relevant source/configuration before retrying; a user-reported failure is evidence, not something to repeat just to prove it exists.

| Symptom                                     | Start here                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| Project request rejected or missing         | Contract input/output, ownership cookie/header, oRPC error mapping, local proxy |
| Generation never starts                     | Explicit mode, provider key presence, generation-state claim, SSE response      |
| Chat works but code is missing              | Alex note/fence parser and complete-document extraction in core                 |
| A partial document replaces an older result | Version-save boundary and current-version pointer update                        |
| Generation fails mid-stream                 | Worker logs, upstream stream errors, abort signal, current run ownership        |
| Restore changes the public app unexpectedly | Current pointer versus published pointer; these must remain separate            |
| Public link shows the wrong version         | Published version selection, slug lookup, republish operation                   |
| Preview differs from downloaded code        | Viewed/current version selection, iframe sandbox, HTML extraction               |
| Tabs or separators face the wrong way       | Base UI orientation custom variants in shared globals.css                       |
| Works in Node but not Worker                | workerd runtime support and bundled dependencies                                |
| Wrong branding or untranslated label        | Single i18n catalog and shared Logo; do not add a local dictionary              |

## Local evidence

Use local Wrangler/workerd and local D1 for runtime/persistence diagnosis. Apply migrations to a fresh local database when checking schema behavior. Do not use a production database to reproduce destructive operations. Browser network evidence should include the failing path/status or SSE event, not credentials or entire private prompts.

A mock pass isolates UI/protocol/persistence but does not establish real-provider behavior. A real-provider failure should remain visible rather than being masked with mock mode. An interrupted stream can leave partial text visible, but the last complete saved version remains authoritative.

## Ownership and generated content

Use two separate browser identities when checking private-project isolation. Published HTML is the only deliberate public surface; it must not expose project chat or owner tokens. Preview HTML remains sandboxed. A generated page's own styling or JavaScript failure is distinct from a bug in the Atoms shell.

## Deployment diagnosis

First read [deployment](deployment.md). Access to the designated Gmail account is currently blocked and its ID unverified. Historical wrong-account URLs are not deployment evidence. Do not tail logs, migrate, or redeploy a similarly named resource as if it were the authorized project. After access is available, correlate the verified account/resource and actual deployed version before interpreting runtime logs.

## Closing a diagnosis

State the observed cause, affected path, changed behavior, and verification actually exercised. Name an unresolved external prerequisite precisely. A successful build, an HTTP 200, a mock run, and an end-to-end live-provider run prove different things.
