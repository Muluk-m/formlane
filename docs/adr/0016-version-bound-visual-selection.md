# ADR-0016: Version-bound visual selection evidence

Status: accepted design. [Issue #46](https://github.com/Muluk-m/formlane/issues/46) adds contextual source editing to the existing workspace and DeliveryFlow. This extends [ADR-0015](0015-flow-first-delivery.md); release and acceptance evidence belongs in [deployment](../operations/deployment.md).

## Decision

Keep selection inside the opaque Preview iframe and send bounded, versioned messages through a host bridge. Entering Edit changes input handling without replacing the document. Runtime node identity belongs to one document; compiler source identity belongs to one immutable build. Neither identifies an occurrence across unrelated revisions. A source definition can render several instances, so source attribution alone cannot determine whether a comment requests one occurrence or a shared change.

Compile a separate editor artifact and authoritative source manifest from the accepted source. Static HTML and intrinsic JSX receive opaque source IDs whose original ranges are resolved on the server. Canonical HTML remains byte-identical to normal compilation and is the only publication/download authority. Preserve application-owned reserved attributes; unknown markers and dynamically created nodes remain unmapped evidence. Reject an editor artifact whose canonical build cannot reproduce the saved Version rather than replacing that Version's HTML.

Persist the immutable selection with the Run, under the Project's existing anonymous ownership capability. Migration `0005_selection_evidence` adds nullable evidence and message-summary fields without rewriting historical Runs. Admission locks and checks the expected Current version before inserting the Run and its attachment. Owner-authorized snapshots expose the original evidence; receipts, events and conversation summaries expose only bounded summaries. Resume reuses that evidence. Viewing history, retaining a Candidate, Cancel and Undo cannot implicitly publish or promote unaccepted source.

Selection is context for a normal Follow-up. Alex still edits exact source and remains the sole writer; Emma and Bob plan together when the requested behavior requires planning. The existing deterministic verification, independent David validation and explicit acceptance gates remain mandatory. No DOM mutation becomes a saved Version and no selection-specific orchestration path is introduced.

## Visual evidence and trust

DOM text, geometry, source markers and images are untrusted task data. The server resolves source IDs through its own manifest; a browser-provided path is never authoritative. The document/session protocol rejects stale frames and replies but cannot make scripts inside the same generated document trustworthy. No owner capability, storage access or privileged browser command enters that document.

Optional browser-authorized capture attaches only a locally cropped selection from a verified surface. Refusal, unsupported capture or an unidentifiable surface preserves ordinary selection and the comment draft. Captured pixels, DOM approximations and reconstructed server images retain distinct provenance. A newly opened server browser does not reproduce arbitrary client memory; inspection must distinguish missing, ambiguous, stale and unreproduced targets.

Every newly accepted build requires David-owned native desktop and mobile screenshots, received as images in that same review stage and explicitly named in `record_review.visual_evidence_ids`. A client crop, baseline image, implementation-stage image or prior review's image cannot satisfy current-build visual acceptance. The screenshot requirement applies to initial builds and ordinary Follow-ups as well as selection requests, avoiding two different meanings of an accepted Version.

Selection resolution and original-scene reproduction are separate observations. David must either support an original-scene match with baseline evidence or disclose the unreproduced context; that limitation accompanies the delivered result. Intended content changes do not require recreating arbitrary earlier application memory. Every frozen region member and focus remains represented. Requested removals or replacements require explicit structural assessments citing the original comment and inspected changed source; surviving targets and each replacement need exposed current evidence at both desktop and mobile sizes. Missing members cannot silently disappear from acceptance.

## Compatibility and consequences

Execution eligibility advances to `flow-v3` because tool inputs, image delivery and acceptance semantics change. Existing durable names and the `flow-v1/candidate/` reader namespace stay frozen independently of eligibility. Older histories remain readable; their unfinished Runs cannot execute or Resume under the new worker. Preserve original frozen recording bytes, and exercise changed semantics through native contract tests instead of regenerating goldens to bless new behavior.

Activation requires an explicitly migrated database and matching API, worker, compiler and frontend releases. Retain the previous release and complete database/DBOS backup. Never rewrite saved execution manifests or copy staging data into production to make incompatible work resumable.

The editor remains a contextual source-editing interface, not a layout engine or deterministic DOM-to-AST patcher. Exact attribution improves the evidence but cannot guarantee edit scope; independent source and browser review must check neighboring controls, repeated instances and affected viewports. Both supported Templates use the same contract, without depending on React private development metadata or granting same-origin access to the Preview.
