# ADR 0003: Focused checks and coordinated integration

Status: accepted, 2026-11-10.

## Context

Multiple agents share development resources and can edit dependent packages concurrently. Overlapping full suites waste resources and test half-integrated states.

## Decision

Run named relevant tests and package typechecks for authorized local verification. Guard test invocations against accidental unscoped/watch runs. One integration owner runs agreed broader checks after all edits land; CI/remote execution is preferred for expensive full runs. An editing assignment must explicitly authorize checks before its worker runs them.

## Consequences

The handoff names checks that should be run and separates them from checks actually exercised. A skipped provider/account-dependent check remains an explicit limitation. Do not infer remote-machine configuration or copy reference-project infrastructure commands that this repository does not provide.
