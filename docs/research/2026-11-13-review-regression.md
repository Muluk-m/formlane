# Targeted review-policy regression

Release: `followups-2712131-20261113`. Corpus SHA-256: `c8bb8c7e46611db7feb862b704a4db45d96401bbc7480437dc10097e2a16aad6`.

Saved successes: **4/4**. Independent semantic passes: **4/4**. All four cases are fresh model generations, selected from the complete corpus because prior runs exposed check-authoring defects. This is targeted regression evidence, not another twenty-case evaluation.

Saved success means the run completed and its immutable result is current. Semantic pass additionally requires every fixed browser assertion. A completed run can fail semantics; infrastructure errors and blocked dependencies never count as passes.

The corrected shared instructions require exact observed seeded action sequences, respect native disabled/number controls, and tell David to correct a mistaken check before requesting application repair. The same four case IDs and user requests were used across these observations:

| Metric, same four cases        | Original baseline | First candidate | Corrected policy |
| ------------------------------ | ----------------: | --------------: | ---------------: |
| Committed model calls          |                82 |              88 |               59 |
| Failed validation reports      |                 5 |               5 |                1 |
| Acknowledged check-set updates |                 7 |               6 |                4 |
| Committed repair stages        |                 0 |               1 |                0 |

Validation-report counts are distinct committed `validate_preview` operations returning `valid: false`, including deterministic verification. Check-set updates include added coverage and are not themselves defect counts. The original five failures covered four applications; the corrected policy's single failure was a 2048 occupied-cell assertion expecting five cells rather than the observed four. David corrected that check and validated again against the identical artifact hash, without sending the application into repair. Wrong checks are reduced in this sample, not eliminated.

The private collection and `check-analysis.json` remain under `/Users/mac/formlane-evaluation/review-regression-2712131` on macmini2. Its frozen four-case corpus is `/Users/mac/formlane-evaluation/review-regression-corpus/cases.json`. The complete first-candidate comparison remains [separate](2026-11-13-workflow-comparison.md); this selected regression does not establish a general latency improvement.

| Case      | Status    | Saved | Semantic | Run ID                               | First file (s) | Total (s) | Committed calls | Repair stages | Review stages |
| --------- | --------- | ----- | -------- | ------------------------------------ | -------------: | --------: | --------------: | ------------: | ------------: |
| expense   | completed | True  | passed   | 07c91faf-167c-4b8e-88dc-fa23958ce663 |          46.70 |    125.20 |              13 |             0 |             1 |
| dice      | completed | True  | passed   | f369e935-0a45-4b39-abf7-38ebd163e8f1 |          56.80 |    140.92 |              14 |             0 |             1 |
| game-2048 | completed | True  | passed   | 5f6a6114-c6f9-4a6f-8b37-2d5d7acc591a |          60.35 |    368.12 |              20 |             0 |             1 |
| cart      | completed | True  | passed   | 09a7121d-6848-43a7-8d71-31d6c895f033 |          46.04 |    101.98 |              12 |             0 |             1 |

## Persisted stage evidence

Operation duration sums include only committed operations. Stage span runs from the first committed operation start to the last committed operation finish; it is not full stage wall time or provider billing time. Missing timestamps produce unavailable durations. Replay does not add a committed model call.

| Case      | Stage              | Operations | Model calls | Timed operations | Duration sum (s) | Committed span (s) |
| --------- | ------------------ | ---------: | ----------: | ---------------: | ---------------: | -----------------: |
| expense   | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| expense   | plan-0             |          2 |           1 |                2 |            36.00 |              36.03 |
| expense   | candidate          |          4 |           0 |                4 |             0.10 |              12.77 |
| expense   | build              |         10 |           5 |               10 |            25.93 |              26.23 |
| expense   | review-0           |         14 |           7 |               14 |            54.10 |              54.35 |
| dice      | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| dice      | plan-0             |          2 |           1 |                2 |            43.94 |              43.97 |
| dice      | candidate          |          5 |           0 |                5 |             0.13 |              16.48 |
| dice      | build              |         12 |           6 |               12 |            29.47 |              29.85 |
| dice      | review-0           |         14 |           7 |               14 |            59.56 |              59.82 |
| game-2048 | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| game-2048 | plan-0             |          2 |           1 |                2 |            46.73 |              46.75 |
| game-2048 | candidate          |          5 |           0 |                5 |             0.13 |              36.80 |
| game-2048 | build              |         12 |           6 |               12 |            48.54 |              48.93 |
| game-2048 | review-0           |         26 |          13 |               26 |           263.69 |             264.22 |
| cart      | execution-manifest |          1 |           0 |                1 |             0.06 |               0.06 |
| cart      | plan-0             |          2 |           1 |                2 |            26.29 |              26.31 |
| cart      | candidate          |          4 |           0 |                4 |             0.11 |              21.21 |
| cart      | build              |         10 |           5 |               10 |            33.38 |              33.68 |
| cart      | review-0           |         12 |           6 |               12 |            33.59 |              33.80 |

## Independent browser evidence

- **expense**: passed; saved version `07c91faf-167c-4b8e-88dc-fa23958ce663`, HTML SHA-256 `0c25790c22af2be02a4d9bc35c3aeffb46f4cfa0352e345d76ba903a6e8b4295`.
  - Division, rounding and zero guard: passed; seed 1; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **dice**: passed; saved version `f369e935-0a45-4b39-abf7-38ebd163e8f1`, HTML SHA-256 `21fba4d334a5f1cb3b8d7fc3eec903a1a36d9cf405d9480f8dc2b1a1eee7a222`.
  - Dice range and real history transitions: passed; seed 7; clock unavailable; 8 steps passed; page errors 0; error unavailable.
  - Dice range and real history transitions: passed; seed 29; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **game-2048**: passed; saved version `5f6a6114-c6f9-4a6f-8b37-2d5d7acc591a`, HTML SHA-256 `2cb379507ab2979d187d5ca57cddee1e7d61a73d5d054e0ff3fd3893fd0b63c7`.
  - Legal board and keyboard state transition: passed; seed 7; clock unavailable; 10 steps passed; page errors 0; error unavailable.
  - Legal board and keyboard state transition: passed; seed 29; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **cart**: passed; saved version `09a7121d-6848-43a7-8d71-31d6c895f033`, HTML SHA-256 `8d7405a04fe6ea83fb9e6724342eb449bbcec3cdf4caf2a7e1311ea05d70a72f`.
  - Minimum boundary and decimal total: passed; seed 1; clock unavailable; 9 steps passed; page errors 0; error unavailable.

## Measurement limits

- Total time is persisted run creation through terminal finish, including queueing and repairs. First file is the earliest persisted file_start, file_delta or file_saved; JSON also records first file_saved separately.
- Repair notices can repeat across replay. Committed repair/review stage counts come from uniquely named DBOS operations with committed model responses; failed uncommitted provider attempts are not counted.
- Structured provider token usage and billed cost are not persisted by this workflow. Both remain null; there are no estimated tokens, invented prices or inferred charges.
- Semantic checks cover the stated interactions, not every visual detail or accessibility requirement. Undo exercises the existing restore API and verifies exact saved HTML plus interactions; it does not establish shell button behavior.
- The JSON includes operation IDs/timestamps, stage aggregates, run IDs, event metadata and per-check outcomes. It excludes owner capabilities, response bodies, database credentials and provider keys.
