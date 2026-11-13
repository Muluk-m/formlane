# Workflow evaluation

Release: `flow-release-20261113d`. Corpus SHA-256: `d614b3bb58deb0450509d8f7b8c415cb80e22112810fe46a78d2173759a63cae`.

Saved successes: **20/20**. Independent semantic passes: **19/20**. Generation runs: 19; Undo is a saved-version selection, not a model call.

Saved success means the run completed and its immutable result is current. Semantic pass additionally requires every fixed browser assertion. A completed run can fail semantics; infrastructure errors and blocked dependencies never count as passes.

| Case            | Status    | Saved | Semantic | Run ID                               | First file (s) |   Total (s) | Committed calls | Repair stages | Review stages |
| --------------- | --------- | ----- | -------- | ------------------------------------ | -------------: | ----------: | --------------: | ------------: | ------------: |
| signup          | completed | True  | passed   | 937d9ca8-2533-43d6-8262-42f2b8c83883 |          51.49 |      134.94 |              16 |             0 |             1 |
| expense         | completed | True  | passed   | 8324df7e-94a3-4284-b528-a5bc0727b32e |          70.48 |      187.47 |              20 |             0 |             1 |
| filter          | completed | True  | passed   | b8ee3a65-3ec6-4281-8e08-d236044e07c3 |          64.26 |      174.42 |              16 |             0 |             1 |
| todo            | completed | True  | passed   | d8a1b7bf-0b1d-4127-be53-510b35cafaeb |          68.78 |      155.96 |              16 |             0 |             1 |
| counter         | completed | True  | passed   | 470a829e-8fdd-4805-93fd-f18506797cc0 |          43.82 |       96.78 |              14 |             0 |             1 |
| counter-feature | completed | True  | passed   | 6e30b672-65c8-4567-903a-8459bdfa5a81 |          61.10 |      132.33 |              17 |             0 |             1 |
| counter-style   | completed | True  | passed   | f166ed6e-1325-4250-83da-df4879798912 |          32.73 |       92.93 |              13 |             0 |             1 |
| counter-undo    | restored  | True  | passed   | not applicable                       |    unavailable | unavailable |     unavailable |   unavailable |   unavailable |
| dice            | completed | True  | failed   | 8ee07cf9-9381-46f1-82e2-c99d6c475ecc |          69.64 |      172.57 |              21 |             0 |             1 |
| game-2048       | completed | True  | passed   | e1e76e92-855e-4ad1-b0a8-b874996e6391 |         168.95 |      491.60 |              25 |             0 |             1 |
| guess           | completed | True  | passed   | 95eb7806-2a6f-4a27-8156-73d0538c77e2 |          85.87 |      271.49 |              23 |             0 |             1 |
| today           | completed | True  | passed   | 945dd105-8181-48d1-a646-43f1dc71b856 |          52.32 |      107.72 |              15 |             0 |             1 |
| date-range      | completed | True  | passed   | da6eb306-9e74-4ff9-aad5-31832d5554d6 |          72.28 |      144.10 |              17 |             0 |             1 |
| bmi             | completed | True  | passed   | dd190ac8-0bdd-4393-829e-059163370188 |          50.23 |      103.55 |              16 |             0 |             1 |
| chinese-search  | completed | True  | passed   | c070f348-48fd-4eea-ad12-ce7faed51227 |          55.62 |      125.25 |              16 |             0 |             1 |
| cart            | completed | True  | passed   | 2a11c89c-d0f8-415e-9f4d-bb309ccd9c32 |          81.25 |      193.39 |              16 |             0 |             1 |
| temperature     | completed | True  | passed   | 4f579f3e-ab3d-4cce-823b-151f7e4c9be7 |          50.91 |      110.16 |              15 |             0 |             1 |
| quiz            | completed | True  | passed   | 03fcdb9e-c566-4cd2-b219-d204769ddc9d |          51.49 |      122.88 |              18 |             0 |             1 |
| signup-style    | completed | True  | passed   | b53258bb-0805-42ce-9da5-bbb1ee3433ac |          25.68 |       83.84 |              13 |             0 |             1 |
| filter-feature  | completed | True  | passed   | 665f47bb-c1a4-4a9c-85cd-5aee078f3483 |          58.95 |      136.22 |              18 |             0 |             1 |

## Persisted stage evidence

Operation duration sums include only committed operations. Stage span runs from the first committed operation start to the last committed operation finish; it is not full stage wall time or provider billing time. Missing timestamps produce unavailable durations. Replay does not add a committed model call.

| Case            | Stage              | Operations | Model calls | Timed operations | Duration sum (s) | Committed span (s) |
| --------------- | ------------------ | ---------: | ----------: | ---------------: | ---------------: | -----------------: |
| signup          | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| signup          | plan-0             |          4 |           2 |                4 |            31.45 |              31.51 |
| signup          | candidate          |          4 |           0 |                4 |             0.12 |              19.65 |
| signup          | build              |         18 |           9 |               18 |            34.76 |              35.25 |
| signup          | review-0           |         10 |           5 |               10 |            59.34 |              59.74 |
| expense         | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| expense         | plan-0             |          4 |           2 |                4 |            33.95 |              34.03 |
| expense         | candidate          |          5 |           0 |                5 |             0.14 |              36.52 |
| expense         | build              |         20 |          10 |               20 |            51.26 |              52.06 |
| expense         | review-0           |         16 |           8 |               16 |            89.58 |              89.89 |
| filter          | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| filter          | plan-0             |          4 |           2 |                4 |            42.73 |              42.80 |
| filter          | candidate          |          4 |           0 |                4 |             0.14 |              25.30 |
| filter          | build              |         18 |           9 |               18 |            60.90 |              61.55 |
| filter          | review-0           |         10 |           5 |               10 |            59.94 |              60.62 |
| todo            | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| todo            | plan-0             |          4 |           2 |                4 |            47.43 |              47.52 |
| todo            | candidate          |          5 |           0 |                5 |             0.19 |              29.59 |
| todo            | build              |         20 |          10 |               20 |            54.90 |              55.70 |
| todo            | review-0           |          8 |           4 |                8 |            42.13 |              42.34 |
| counter         | execution-manifest |          1 |           0 |                1 |             0.08 |               0.08 |
| counter         | plan-0             |          4 |           2 |                4 |            19.89 |              19.98 |
| counter         | candidate          |          3 |           0 |                3 |             0.11 |              16.60 |
| counter         | build              |         16 |           8 |               16 |            34.14 |              34.61 |
| counter         | review-0           |          8 |           4 |                8 |            31.61 |              31.80 |
| counter-feature | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| counter-feature | route              |          2 |           1 |                2 |             5.47 |               5.51 |
| counter-feature | plan-0             |          8 |           4 |                8 |            26.65 |              26.84 |
| counter-feature | candidate          |          3 |           0 |                3 |             0.10 |              23.02 |
| counter-feature | build              |         14 |           7 |               14 |            45.66 |              46.14 |
| counter-feature | review-0           |         10 |           5 |               10 |            42.81 |              43.03 |
| counter-style   | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| counter-style   | route              |          2 |           1 |                2 |             3.99 |               4.01 |
| counter-style   | quick-edit         |         14 |           7 |               14 |            44.78 |              45.11 |
| counter-style   | candidate          |          2 |           0 |                2 |             0.06 |               2.50 |
| counter-style   | review-0           |         10 |           5 |               10 |            35.27 |              35.45 |
| dice            | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| dice            | plan-0             |          4 |           2 |                4 |            49.38 |              49.44 |
| dice            | candidate          |          5 |           0 |                5 |             0.13 |              27.92 |
| dice            | build              |         20 |          10 |               20 |            42.74 |              43.30 |
| dice            | review-0           |         18 |           9 |               18 |            72.42 |              72.77 |
| game-2048       | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| game-2048       | plan-0             |          4 |           2 |                4 |           123.74 |             123.81 |
| game-2048       | candidate          |          5 |           0 |                5 |             0.13 |              60.49 |
| game-2048       | build              |         20 |          10 |               20 |            72.53 |              73.10 |
| game-2048       | review-0           |         26 |          13 |               26 |           286.03 |             286.58 |
| guess           | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| guess           | plan-0             |          4 |           2 |                4 |            67.24 |              67.31 |
| guess           | candidate          |          4 |           0 |                4 |             0.10 |              24.09 |
| guess           | build              |         18 |           9 |               18 |            39.58 |              40.01 |
| guess           | review-0           |         23 |          12 |               23 |           155.70 |             156.12 |
| today           | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| today           | plan-0             |          4 |           2 |                4 |            32.28 |              32.34 |
| today           | candidate          |          4 |           0 |                4 |             0.10 |              19.84 |
| today           | build              |         18 |           9 |               18 |            33.77 |              34.21 |
| today           | review-0           |          8 |           4 |                8 |            32.50 |              32.64 |
| date-range      | execution-manifest |          1 |           0 |                1 |             0.05 |               0.05 |
| date-range      | plan-0             |          4 |           2 |                4 |            49.76 |              49.84 |
| date-range      | candidate          |          5 |           0 |                5 |             0.14 |              23.36 |
| date-range      | build              |         20 |          10 |               20 |            39.08 |              39.63 |
| date-range      | review-0           |         10 |           5 |               10 |            46.36 |              46.52 |
| bmi             | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| bmi             | plan-0             |          4 |           2 |                4 |            31.89 |              31.94 |
| bmi             | candidate          |          4 |           0 |                4 |             0.10 |              20.71 |
| bmi             | build              |         18 |           9 |               18 |            32.07 |              32.53 |
| bmi             | review-0           |         10 |           5 |               10 |            30.39 |              30.57 |
| chinese-search  | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| chinese-search  | plan-0             |          4 |           2 |                4 |            30.90 |              30.96 |
| chinese-search  | candidate          |          4 |           0 |                4 |             0.10 |              24.27 |
| chinese-search  | build              |         18 |           9 |               18 |            38.14 |              38.58 |
| chinese-search  | review-0           |         10 |           5 |               10 |            47.89 |              48.08 |
| cart            | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| cart            | plan-0             |          4 |           2 |                4 |            55.55 |              55.60 |
| cart            | candidate          |          4 |           0 |                4 |             0.10 |              30.82 |
| cart            | build              |         18 |           9 |               18 |            53.67 |              54.20 |
| cart            | verify-0           |          1 |           0 |                1 |            13.31 |              13.31 |
| cart            | review-0           |         10 |           5 |               10 |            54.29 |              54.48 |
| cart            | revalidate-0       |          1 |           0 |                1 |             8.96 |               8.96 |
| temperature     | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| temperature     | plan-0             |          4 |           2 |                4 |            30.04 |              30.10 |
| temperature     | candidate          |          4 |           0 |                4 |             0.14 |              21.93 |
| temperature     | build              |         18 |           9 |               18 |            39.23 |              39.73 |
| temperature     | review-0           |          8 |           4 |                8 |            32.19 |              32.34 |
| quiz            | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| quiz            | plan-0             |          4 |           2 |                4 |            33.28 |              33.34 |
| quiz            | candidate          |          5 |           0 |                5 |             0.13 |              23.29 |
| quiz            | build              |         20 |          10 |               20 |            38.71 |              39.25 |
| quiz            | review-0           |         12 |           6 |               12 |            42.28 |              42.50 |
| signup-style    | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| signup-style    | route              |          2 |           1 |                2 |             4.32 |               4.34 |
| signup-style    | quick-edit         |         14 |           7 |               14 |            31.75 |              32.10 |
| signup-style    | candidate          |          2 |           0 |                2 |             0.06 |               1.90 |
| signup-style    | review-0           |         10 |           5 |               10 |            38.99 |              39.17 |
| filter-feature  | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| filter-feature  | route              |          2 |           1 |                2 |             7.47 |               7.49 |
| filter-feature  | plan-0             |          6 |           3 |                6 |            31.20 |              31.30 |
| filter-feature  | candidate          |          3 |           0 |                3 |             0.09 |              14.50 |
| filter-feature  | build              |         14 |           7 |               14 |            29.49 |              29.85 |
| filter-feature  | review-0           |         14 |           7 |               14 |            59.01 |              59.29 |

## Independent browser evidence

- **signup**: passed; saved version `937d9ca8-2533-43d6-8262-42f2b8c83883`, HTML SHA-256 `c286b9aab5912b8bb7d3a6d1316c31922a7faf4d67e25d12440a2bb8c9c53109`.
  - Reject empty form then submit valid Chinese name: passed; seed 1; clock unavailable; 6 steps passed; page errors 0; error unavailable.
- **expense**: passed; saved version `8324df7e-94a3-4284-b528-a5bc0727b32e`, HTML SHA-256 `864617ad4b2497eb34f58e032818075b3fcfe22488386a75a6d83e812f343c69`.
  - Division, rounding and zero guard: passed; seed 1; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **filter**: passed; saved version `b8ee3a65-3ec6-4281-8e08-d236044e07c3`, HTML SHA-256 `0f7cfefcb9b1707be3eda509b3d55c1c318ca78aa5715ddc3a5a45e1400da5e1`.
  - Native select and intersected Chinese search: passed; seed 1; clock unavailable; 9 steps passed; page errors 0; error unavailable.
- **todo**: passed; saved version `d8a1b7bf-0b1d-4127-be53-510b35cafaeb`, HTML SHA-256 `40a1abfc4d4295787e958b3d3c538908dcfa72e84dfb8639934bc494f35cd4ed`.
  - Chinese input, completion and deletion: passed; seed 1; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **counter**: passed; saved version `470a829e-8fdd-4805-93fd-f18506797cc0`, HTML SHA-256 `da35f4e7509f1da1f3a95f7199ab73fef0afc5b4c27f2dc388b2d4ea896853ea`.
  - Increment and reset: passed; seed 1; clock unavailable; 5 steps passed; page errors 0; error unavailable.
- **counter-feature**: passed; saved version `6e30b672-65c8-4567-903a-8459bdfa5a81`, HTML SHA-256 `3fd34e78193d3842cc9dde8b058535a0b0446028a24c6517624215274a6e1a95`.
  - New step size and negative decrement: passed; seed 1; clock unavailable; 7 steps passed; page errors 0; error unavailable.
- **counter-style**: passed; saved version `f166ed6e-1325-4250-83da-df4879798912`, HTML SHA-256 `a1724abb0174caa88e7f28a2dff58eba4b54b89a1e16c64ab561fa099aacb134`.
  - Style plus preserved accepted feature: passed; seed 1; clock unavailable; 7 steps passed; page errors 0; error unavailable.
- **counter-undo**: passed; saved version `6e30b672-65c8-4567-903a-8459bdfa5a81`, HTML SHA-256 `3fd34e78193d3842cc9dde8b058535a0b0446028a24c6517624215274a6e1a95`.
  - Restored saved version remains interactive: passed; seed 1; clock unavailable; 6 steps passed; page errors 0; error unavailable.
- **dice**: failed; saved version `8ee07cf9-9381-46f1-82e2-c99d6c475ecc`, HTML SHA-256 `a2ea80f95e22b1492cab126d0a5ba52c698a21543d09d5092ab8d3113d07f79a`.
  - Dice range and real history transitions: passed; seed 7; clock unavailable; 8 steps passed; page errors 0; error unavailable.
  - Dice range and real history transitions: failed; seed 29; clock unavailable; 1 steps passed; page errors 0; error ValueError.
- **game-2048**: passed; saved version `e1e76e92-855e-4ad1-b0a8-b874996e6391`, HTML SHA-256 `f2ccf118e8c7ac9b2eb93d1fd3487e926954ebc583cbac8b686e0f563abc8510`.
  - Legal board and keyboard state transition: passed; seed 7; clock unavailable; 10 steps passed; page errors 0; error unavailable.
  - Legal board and keyboard state transition: passed; seed 29; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **guess**: passed; saved version `95eb7806-2a6f-4a27-8156-73d0538c77e2`, HTML SHA-256 `c73ad490ce316508132086dea2994188e37f24be89e2737a614b4db349f12061`.
  - Invalid guess excluded from attempts: passed; seed 7; clock unavailable; 10 steps passed; page errors 0; error unavailable.
  - Invalid guess excluded from attempts: passed; seed 29; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **today**: passed; saved version `945dd105-8181-48d1-a646-43f1dc71b856`, HTML SHA-256 `ef4e190ef58412febc43226d26f9dd1282101a6d42192cbb7586185aca00b99f`.
  - December rollover: passed; seed 1; clock 2026-12-31T12:00:00+08:00; 3 steps passed; page errors 0; error unavailable.
  - Leap day: passed; seed 1; clock 2028-02-28T12:00:00+08:00; 3 steps passed; page errors 0; error unavailable.
- **date-range**: passed; saved version `da6eb306-9e74-4ff9-aad5-31832d5554d6`, HTML SHA-256 `d315b8ca4b9438334eb5b378c7fa1f8cfc69a6c0734622e7f7c41bcfb42d985a`.
  - Leap year and reversed interval: passed; seed 1; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **bmi**: passed; saved version `dd190ac8-0bdd-4393-829e-059163370188`, HTML SHA-256 `346febb0e5397d9e10aa124d5c2f05b38e9b1c98ad20eda3e0a3135ba288eef2`.
  - Units, rounding and invalid height: passed; seed 1; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **chinese-search**: passed; saved version `c070f348-48fd-4eea-ad12-ce7faed51227`, HTML SHA-256 `f933f069522e4ba3fe1c6e3e88d1b5441fa152ab09331b6f2bd210c693dc22d0`.
  - Chinese substring filtering and clear: passed; seed 1; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **cart**: passed; saved version `2a11c89c-d0f8-415e-9f4d-bb309ccd9c32`, HTML SHA-256 `f9d2a3b2aabed843b63b3d54fb0469cd9211956e2e74d63290bdacc1ba346b7d`.
  - Minimum boundary and decimal total: passed; seed 1; clock unavailable; 9 steps passed; page errors 0; error unavailable.
- **temperature**: passed; saved version `4f579f3e-ab3d-4cce-823b-151f7e4c9be7`, HTML SHA-256 `21597f070a777a87c06eeb3bf9613497b075137cee3b81ef4a75f6a965ee7ee0`.
  - Empty versus zero and negative values: passed; seed 1; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **quiz**: passed; saved version `03fcdb9e-c566-4cd2-b219-d204769ddc9d`, HTML SHA-256 `c437da4da6453598582f0e9fd1cf6be0445147fe1f72aa3a6409cdba22c3c256`.
  - Selection, correctness and retry: passed; seed 1; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **signup-style**: passed; saved version `b53258bb-0805-42ce-9da5-bbb1ee3433ac`, HTML SHA-256 `274e14a3d15a3742bce51639c83b39ebbb45c98a1a62ba2235b859c8506f446e`.
  - Form behavior survives restyling: passed; seed 1; clock unavailable; 7 steps passed; page errors 0; error unavailable.
- **filter-feature**: passed; saved version `665f47bb-c1a4-4a9c-85cd-5aee078f3483`, HTML SHA-256 `df994b57f59de3d0a9e83d61a332283169ed5613ce3854c5c0534c7317e5604a`.
  - New clear action preserves filter intersection: passed; seed 1; clock unavailable; 12 steps passed; page errors 0; error unavailable.

## Measurement limits

- Total time is persisted run creation through terminal finish, including queueing and repairs. First file is the earliest persisted file_start, file_delta or file_saved; JSON also records first file_saved separately.
- Repair notices can repeat across replay. Committed repair/review stage counts come from uniquely named DBOS operations with committed model responses; failed uncommitted provider attempts are not counted.
- Structured provider token usage and billed cost are not persisted by this workflow. Both remain null; there are no estimated tokens, invented prices or inferred charges.
- Semantic checks cover the stated interactions, not every visual detail or accessibility requirement. Undo exercises the existing restore API and verifies exact saved HTML plus interactions; it does not establish shell button behavior.
- The JSON includes operation IDs/timestamps, stage aggregates, run IDs, event metadata and per-check outcomes. It excludes owner capabilities, response bodies, database credentials and provider keys.
