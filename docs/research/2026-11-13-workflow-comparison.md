# Workflow evaluation comparison

Baseline: `flow-release-20261113d`. Candidate: `followups-cce3c4a-20261113`.

Saved successes: 20 → 20. Semantic passes: 20 → 20.

These semantic results come from a complete read-only recheck of both collections' saved artifacts. The original [baseline](2026-11-13-workflow-baseline.md) and [candidate](2026-11-13-workflow-candidate.md) each recorded 19/20 on the first pass and remain unchanged. The candidate correctly displayed `2 天`; the original independent assertion incorrectly required `2天`. The revised assertions allow unit spacing while still rejecting incorrect numeric values. No prompts, generated applications, run identities or generation timings changed. Every rechecked HTML hash matched its original record; all forty saved-artifact cases passed. Original semantic outcomes remain in the recheck JSON.

| Metric                                    | Baseline | First candidate |
| ----------------------------------------- | -------: | --------------: |
| Median first file (s), 19 generation runs |   58.947 |          58.448 |
| Median total (s), 19 generation runs      |  134.940 |         130.232 |
| Committed model calls                     |      325 |             297 |
| Committed repair stages                   |        0 |               1 |
| Acknowledged review check-set updates     |       14 |              11 |
| Failed validation reports                 |        5 |               5 |

The median paired first-file change was -0.727 s; 10/19 cases were faster. This does not establish a reliable latency improvement. Fewer committed calls did not guarantee lower total time: the candidate 2048 run entered an additional repair stage after David added incorrect seeded-state assertions. The shared check contract is being refined for that observed failure, disabled controls and numeric-input restrictions; its targeted regression is separate from this complete first-candidate cohort.

Median paired total-time delta among 19 generation cases saved in both evaluations: 6.40 seconds. Negative deltas are faster. Failure/status changes remain visible below; a fast failure is not a performance improvement.

| Case            | Baseline status / semantic | Candidate status / semantic | Baseline total (s) | Candidate total (s) | Total delta (s) |  Call delta |
| --------------- | -------------------------- | --------------------------- | -----------------: | ------------------: | --------------: | ----------: |
| signup          | completed / passed         | completed / passed          |             134.94 |              130.16 |           -4.78 |          -3 |
| expense         | completed / passed         | completed / passed          |             187.47 |              236.29 |           48.83 |          -1 |
| filter          | completed / passed         | completed / passed          |             174.42 |              130.23 |          -44.19 |          -1 |
| todo            | completed / passed         | completed / passed          |             155.96 |              158.66 |            2.70 |          -1 |
| counter         | completed / passed         | completed / passed          |              96.78 |               95.19 |           -1.58 |          -2 |
| counter-feature | completed / passed         | completed / passed          |             132.33 |              101.45 |          -30.88 |          -3 |
| counter-style   | completed / passed         | completed / passed          |              92.93 |               99.33 |            6.40 |           1 |
| counter-undo    | restored / passed          | restored / passed           |        unavailable |         unavailable |     unavailable | unavailable |
| dice            | completed / passed         | completed / passed          |             172.57 |              197.96 |           25.39 |          -5 |
| game-2048       | completed / passed         | completed / passed          |             491.60 |              772.61 |          281.02 |          13 |
| guess           | completed / passed         | completed / passed          |             271.49 |              251.67 |          -19.83 |          -3 |
| today           | completed / passed         | completed / passed          |             107.72 |              118.52 |           10.80 |          -3 |
| date-range      | completed / passed         | completed / passed          |             144.10 |              119.19 |          -24.90 |          -4 |
| bmi             | completed / passed         | completed / passed          |             103.55 |              114.51 |           10.96 |          -3 |
| chinese-search  | completed / passed         | completed / passed          |             125.25 |              134.22 |            8.97 |          -3 |
| cart            | completed / passed         | completed / passed          |             193.39 |              160.46 |          -32.93 |          -1 |
| temperature     | completed / passed         | completed / passed          |             110.16 |              114.03 |            3.87 |          -3 |
| quiz            | completed / passed         | completed / passed          |             122.88 |              160.43 |           37.54 |          -4 |
| signup-style    | completed / passed         | completed / passed          |              83.84 |              101.16 |           17.32 |           0 |
| filter-feature  | completed / passed         | completed / passed          |             136.22 |              143.02 |            6.79 |          -2 |

One run per case is descriptive evidence, not a statistical latency claim. Both runs use their own private baselines; model/provider/release metadata in the full reports must be considered when interpreting differences. Token usage and cost remain unavailable unless actually recorded; this comparison invents neither.
