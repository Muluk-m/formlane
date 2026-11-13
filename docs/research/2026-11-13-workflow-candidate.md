# Workflow evaluation

Release: `followups-cce3c4a-20261113`. Corpus SHA-256: `d614b3bb58deb0450509d8f7b8c415cb80e22112810fe46a78d2173759a63cae`.

Saved successes: **20/20**. Independent semantic passes: **19/20**. Generation runs: 19; Undo is a saved-version selection, not a model call.

Saved success means the run completed and its immutable result is current. Semantic pass additionally requires every fixed browser assertion. A completed run can fail semantics; infrastructure errors and blocked dependencies never count as passes.

| Case            | Status    | Saved | Semantic | Run ID                               | First file (s) |   Total (s) | Committed calls | Repair stages | Review stages |
| --------------- | --------- | ----- | -------- | ------------------------------------ | -------------: | ----------: | --------------: | ------------: | ------------: |
| signup          | completed | True  | passed   | e7ea64c2-1a68-4e5a-849a-2c3f30912420 |          59.07 |      130.16 |              13 |             0 |             1 |
| expense         | completed | True  | passed   | de825a90-6cd2-44bb-811e-0dceea29dee7 |          52.36 |      236.29 |              19 |             0 |             1 |
| filter          | completed | True  | passed   | e8ece7b2-c48c-4997-9c3f-e2d434c8184a |          57.21 |      130.23 |              15 |             0 |             1 |
| todo            | completed | True  | passed   | 173a3b10-5f21-4f95-952f-9e6d53b952c4 |          67.08 |      158.66 |              15 |             0 |             1 |
| counter         | completed | True  | passed   | fdbbd549-8578-420b-b79e-46076de2402b |          38.89 |       95.19 |              12 |             0 |             1 |
| counter-feature | completed | True  | passed   | 59873874-76a3-4e62-b496-0ce5d2eb6ae2 |          46.45 |      101.45 |              14 |             0 |             1 |
| counter-style   | completed | True  | passed   | b2867889-6aa2-412f-8b7b-d13e1bb14e8c |          45.26 |       99.33 |              14 |             0 |             1 |
| counter-undo    | restored  | True  | passed   | not applicable                       |    unavailable | unavailable |     unavailable |   unavailable |   unavailable |
| dice            | completed | True  | passed   | 1f013686-2a9d-4612-af24-2a861fe123a7 |          76.88 |      197.96 |              16 |             0 |             1 |
| game-2048       | completed | True  | passed   | 110b1c53-8ae0-42fb-9d1d-bf20eefb1622 |          96.63 |      772.61 |              38 |             1 |             2 |
| guess           | completed | True  | passed   | 792b9b08-dec4-4507-9edb-15861077ffae |          89.14 |      251.67 |              20 |             0 |             1 |
| today           | completed | True  | passed   | 77b074b7-e30b-4f4b-892c-be96e22043ad |          58.45 |      118.52 |              12 |             0 |             1 |
| date-range      | completed | True  | failed   | 814ba615-5fa0-4e9d-a206-5002347e2834 |          59.89 |      119.19 |              13 |             0 |             1 |
| bmi             | completed | True  | passed   | cc1a4fa4-5bff-4244-929c-cd3f9e26c874 |          39.70 |      114.51 |              13 |             0 |             1 |
| chinese-search  | completed | True  | passed   | 3eb988c6-1382-4dbf-a75b-d38dbf063b22 |          62.54 |      134.22 |              13 |             0 |             1 |
| cart            | completed | True  | passed   | 8cb26071-1cb6-48a3-8537-3bd520764408 |          50.79 |      160.46 |              15 |             0 |             1 |
| temperature     | completed | True  | passed   | 40a3d369-a7e8-4358-a348-967ae6c045f3 |          52.12 |      114.03 |              12 |             0 |             1 |
| quiz            | completed | True  | passed   | 1298266a-9f51-4622-8713-6e3845e55f36 |          70.79 |      160.43 |              14 |             0 |             1 |
| signup-style    | completed | True  | passed   | 5aa93f70-af7e-4131-94d9-dde21c18a854 |          24.95 |      101.16 |              13 |             0 |             1 |
| filter-feature  | completed | True  | passed   | a0b50845-dc68-42d7-abe2-3ccf83cf03c9 |          60.55 |      143.02 |              16 |             0 |             1 |

## Persisted stage evidence

Operation duration sums include only committed operations. Stage span runs from the first committed operation start to the last committed operation finish; it is not full stage wall time or provider billing time. Missing timestamps produce unavailable durations. Replay does not add a committed model call.

| Case            | Stage              | Operations | Model calls | Timed operations | Duration sum (s) | Committed span (s) |
| --------------- | ------------------ | ---------: | ----------: | ---------------: | ---------------: | -----------------: |
| signup          | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| signup          | plan-0             |          2 |           1 |                2 |            47.82 |              47.85 |
| signup          | candidate          |          5 |           0 |                5 |             0.13 |              17.33 |
| signup          | build              |         12 |           6 |               12 |            30.82 |              31.22 |
| signup          | review-0           |         12 |           6 |               12 |            42.82 |              43.06 |
| expense         | execution-manifest |          1 |           0 |                1 |             0.05 |               0.05 |
| expense         | plan-0             |          2 |           1 |                2 |            38.82 |              38.84 |
| expense         | candidate          |          5 |           0 |                5 |             0.15 |              19.13 |
| expense         | build              |         16 |           8 |               16 |            39.64 |              40.12 |
| expense         | review-0           |         20 |          10 |               20 |           148.10 |             148.50 |
| filter          | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| filter          | plan-0             |          2 |           1 |                2 |            44.05 |              44.08 |
| filter          | candidate          |          7 |           0 |                7 |             0.20 |              23.88 |
| filter          | build              |         16 |           8 |               16 |            37.80 |              38.41 |
| filter          | review-0           |         12 |           6 |               12 |            40.12 |              40.34 |
| todo            | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| todo            | plan-0             |          2 |           1 |                2 |            52.91 |              52.94 |
| todo            | candidate          |          7 |           0 |                7 |             0.17 |              32.31 |
| todo            | build              |         16 |           8 |               16 |            47.24 |              47.79 |
| todo            | review-0           |         12 |           6 |               12 |            49.09 |              49.32 |
| counter         | execution-manifest |          1 |           0 |                1 |             0.05 |               0.05 |
| counter         | plan-0             |          2 |           1 |                2 |            24.53 |              24.56 |
| counter         | candidate          |          4 |           0 |                4 |             0.10 |              15.53 |
| counter         | build              |         10 |           5 |               10 |            27.67 |              27.97 |
| counter         | review-0           |         12 |           6 |               12 |            34.26 |              34.47 |
| counter-feature | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| counter-feature | route              |          2 |           1 |                2 |             4.98 |               5.00 |
| counter-feature | plan-0             |          4 |           2 |                4 |            26.24 |              26.30 |
| counter-feature | candidate          |          3 |           0 |                3 |             0.08 |               9.32 |
| counter-feature | build              |         10 |           5 |               10 |            23.42 |              23.68 |
| counter-feature | review-0           |         12 |           6 |               12 |            37.97 |              38.19 |
| counter-style   | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| counter-style   | route              |          2 |           1 |                2 |             4.43 |               4.46 |
| counter-style   | quick-edit         |         14 |           7 |               14 |            51.39 |              51.72 |
| counter-style   | candidate          |          2 |           0 |                2 |             0.06 |               2.35 |
| counter-style   | review-0           |         12 |           6 |               12 |            34.65 |              34.88 |
| dice            | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| dice            | plan-0             |          2 |           1 |                2 |            66.56 |              66.59 |
| dice            | candidate          |          5 |           0 |                5 |             0.14 |              16.71 |
| dice            | build              |         14 |           7 |               14 |            34.75 |              35.19 |
| dice            | review-0           |         16 |           8 |               16 |            88.46 |              88.76 |
| game-2048       | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| game-2048       | plan-0             |          2 |           1 |                2 |            74.13 |              74.16 |
| game-2048       | candidate          |          8 |           0 |                8 |             0.25 |             393.06 |
| game-2048       | build              |         14 |           7 |               14 |            59.74 |              60.23 |
| game-2048       | review-0           |         24 |          12 |               24 |           242.10 |             242.63 |
| game-2048       | review-repair-0    |         18 |           9 |               18 |           138.69 |             139.25 |
| game-2048       | review-verify-0    |          1 |           0 |                1 |            15.52 |              15.52 |
| game-2048       | review-1           |         18 |           9 |               18 |           219.99 |             220.38 |
| game-2048       | revalidate-1       |          1 |           0 |                1 |            11.27 |              11.27 |
| guess           | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| guess           | plan-0             |          2 |           1 |                2 |            76.88 |              76.91 |
| guess           | candidate          |          5 |           0 |                5 |             0.15 |              17.76 |
| guess           | build              |         14 |           7 |               14 |            39.41 |              39.89 |
| guess           | review-0           |         24 |          12 |               24 |           125.39 |             125.90 |
| today           | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| today           | plan-0             |          2 |           1 |                2 |            45.39 |              45.42 |
| today           | candidate          |          4 |           0 |                4 |             0.12 |              11.13 |
| today           | build              |         10 |           5 |               10 |            23.63 |              23.96 |
| today           | review-0           |         12 |           6 |               12 |            40.17 |              40.40 |
| date-range      | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| date-range      | plan-0             |          2 |           1 |                2 |            35.80 |              35.83 |
| date-range      | candidate          |          5 |           0 |                5 |             0.13 |              24.99 |
| date-range      | build              |         12 |           6 |               12 |            37.95 |              38.34 |
| date-range      | review-0           |         12 |           6 |               12 |            36.55 |              36.81 |
| bmi             | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| bmi             | plan-0             |          2 |           1 |                2 |            28.44 |              28.46 |
| bmi             | candidate          |          4 |           0 |                4 |             0.11 |              12.92 |
| bmi             | build              |         12 |           6 |               12 |            27.88 |              28.22 |
| bmi             | review-0           |         12 |           6 |               12 |            49.69 |              49.91 |
| chinese-search  | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| chinese-search  | plan-0             |          2 |           1 |                2 |            48.75 |              48.78 |
| chinese-search  | candidate          |          5 |           0 |                5 |             0.12 |              22.48 |
| chinese-search  | build              |         12 |           6 |               12 |            35.09 |              35.50 |
| chinese-search  | review-0           |         12 |           6 |               12 |            42.20 |              42.43 |
| cart            | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| cart            | plan-0             |          2 |           1 |                2 |            36.57 |              36.59 |
| cart            | candidate          |          4 |           0 |                4 |             0.10 |              18.33 |
| cart            | build              |         10 |           5 |               10 |            30.83 |              31.14 |
| cart            | review-0           |         18 |           9 |               18 |            85.17 |              85.55 |
| temperature     | execution-manifest |          1 |           0 |                1 |             0.12 |               0.12 |
| temperature     | plan-0             |          2 |           1 |                2 |            37.56 |              37.59 |
| temperature     | candidate          |          4 |           0 |                4 |             0.10 |              11.84 |
| temperature     | build              |         10 |           5 |               10 |            26.09 |              26.39 |
| temperature     | review-0           |         12 |           6 |               12 |            38.24 |              38.47 |
| quiz            | execution-manifest |          1 |           0 |                1 |             0.03 |               0.03 |
| quiz            | plan-0             |          2 |           1 |                2 |            58.12 |              58.14 |
| quiz            | candidate          |          5 |           0 |                5 |             0.13 |              16.32 |
| quiz            | build              |         12 |           6 |               12 |            32.36 |              32.76 |
| quiz            | review-0           |         14 |           7 |               14 |            62.07 |              62.35 |
| signup-style    | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| signup-style    | route              |          2 |           1 |                2 |             3.32 |               3.34 |
| signup-style    | quick-edit         |         12 |           6 |               12 |            32.18 |              32.48 |
| signup-style    | candidate          |          2 |           0 |                2 |             0.05 |               4.32 |
| signup-style    | review-0           |         12 |           6 |               12 |            57.56 |              57.79 |
| filter-feature  | execution-manifest |          1 |           0 |                1 |             0.04 |               0.04 |
| filter-feature  | route              |          2 |           1 |                2 |             6.41 |               6.43 |
| filter-feature  | plan-0             |          4 |           2 |                4 |            32.61 |              32.67 |
| filter-feature  | candidate          |          3 |           0 |                3 |             0.09 |              20.10 |
| filter-feature  | build              |         12 |           6 |               12 |            34.87 |              35.17 |
| filter-feature  | review-0           |         14 |           7 |               14 |            59.69 |              59.96 |

## Independent browser evidence

- **signup**: passed; saved version `e7ea64c2-1a68-4e5a-849a-2c3f30912420`, HTML SHA-256 `834cca1b7d25ec70a1d05288b3adac4cba4a39654d5b8b4fa54b5e25fd75b0fa`.
  - Reject empty form then submit valid Chinese name: passed; seed 1; clock unavailable; 6 steps passed; page errors 0; error unavailable.
- **expense**: passed; saved version `de825a90-6cd2-44bb-811e-0dceea29dee7`, HTML SHA-256 `540d0e0c2fd618f12fb9b245067150c6c75556815d584407e901457c09e040cb`.
  - Division, rounding and zero guard: passed; seed 1; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **filter**: passed; saved version `e8ece7b2-c48c-4997-9c3f-e2d434c8184a`, HTML SHA-256 `e7812683c2bb05c70ea69dfb76372458e381194b7b815a777769c5d39a69da37`.
  - Native select and intersected Chinese search: passed; seed 1; clock unavailable; 9 steps passed; page errors 0; error unavailable.
- **todo**: passed; saved version `173a3b10-5f21-4f95-952f-9e6d53b952c4`, HTML SHA-256 `2140cee7a0d09e8de2f97aedea1ca62b8d785195e3560b7e0a02febf6f18628f`.
  - Chinese input, completion and deletion: passed; seed 1; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **counter**: passed; saved version `fdbbd549-8578-420b-b79e-46076de2402b`, HTML SHA-256 `557c2c430c6b2c43041ad001cc8c0f9107148dbd0e82deb6f85faca3cc3972b1`.
  - Increment and reset: passed; seed 1; clock unavailable; 5 steps passed; page errors 0; error unavailable.
- **counter-feature**: passed; saved version `59873874-76a3-4e62-b496-0ce5d2eb6ae2`, HTML SHA-256 `36a0c217dece11e1258bd2163c35d7ab2884dfeed5fdc4ea274905b19c4e06bd`.
  - New step size and negative decrement: passed; seed 1; clock unavailable; 7 steps passed; page errors 0; error unavailable.
- **counter-style**: passed; saved version `b2867889-6aa2-412f-8b7b-d13e1bb14e8c`, HTML SHA-256 `8454538ed0e892047efd59cf4338bb06d39a6df05cff6226473de70035bf318f`.
  - Style plus preserved accepted feature: passed; seed 1; clock unavailable; 7 steps passed; page errors 0; error unavailable.
- **counter-undo**: passed; saved version `59873874-76a3-4e62-b496-0ce5d2eb6ae2`, HTML SHA-256 `36a0c217dece11e1258bd2163c35d7ab2884dfeed5fdc4ea274905b19c4e06bd`.
  - Restored saved version remains interactive: passed; seed 1; clock unavailable; 6 steps passed; page errors 0; error unavailable.
- **dice**: passed; saved version `1f013686-2a9d-4612-af24-2a861fe123a7`, HTML SHA-256 `4ce6aa69cfdb40b8d6064c69f1e6e6a94aae02902114510a18f25fe89380a1a9`.
  - Dice range and real history transitions: passed; seed 7; clock unavailable; 8 steps passed; page errors 0; error unavailable.
  - Dice range and real history transitions: passed; seed 29; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **game-2048**: passed; saved version `110b1c53-8ae0-42fb-9d1d-bf20eefb1622`, HTML SHA-256 `5d19847e24b5fd1b82e840a3e4be4d8196144370c7300bce86303a9899ffdf76`.
  - Legal board and keyboard state transition: passed; seed 7; clock unavailable; 10 steps passed; page errors 0; error unavailable.
  - Legal board and keyboard state transition: passed; seed 29; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **guess**: passed; saved version `792b9b08-dec4-4507-9edb-15861077ffae`, HTML SHA-256 `45a8a290d557f7819cf791a8cc0267853232043faa1418cac90753d55a5be487`.
  - Invalid guess excluded from attempts: passed; seed 7; clock unavailable; 10 steps passed; page errors 0; error unavailable.
  - Invalid guess excluded from attempts: passed; seed 29; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **today**: passed; saved version `77b074b7-e30b-4f4b-892c-be96e22043ad`, HTML SHA-256 `d81e42b1f71b58e62ca535d8aa7232e9448b58045be41a5ef76dbd42f1a4fd5e`.
  - December rollover: passed; seed 1; clock 2026-12-31T12:00:00+08:00; 3 steps passed; page errors 0; error unavailable.
  - Leap day: passed; seed 1; clock 2028-02-28T12:00:00+08:00; 3 steps passed; page errors 0; error unavailable.
- **date-range**: failed; saved version `814ba615-5fa0-4e9d-a206-5002347e2834`, HTML SHA-256 `6bc1b0a6a6828aa8937e8b5f4a07412555141b217dc532f06f648f693db37af2`.
  - Leap year and reversed interval: failed; seed 1; clock unavailable; 3 steps passed; page errors 0; error AssertionError.
- **bmi**: passed; saved version `cc1a4fa4-5bff-4244-929c-cd3f9e26c874`, HTML SHA-256 `9cfd7825812825f54bbf34d463b5f4bbecbaa8c4f874b3e3710636af4a3aae50`.
  - Units, rounding and invalid height: passed; seed 1; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **chinese-search**: passed; saved version `3eb988c6-1382-4dbf-a75b-d38dbf063b22`, HTML SHA-256 `97e2a69c7e7e1da3c16a5c23c9d571ac8685ac21cc03ce54b3f7c54a4c70cb58`.
  - Chinese substring filtering and clear: passed; seed 1; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **cart**: passed; saved version `8cb26071-1cb6-48a3-8537-3bd520764408`, HTML SHA-256 `ce0723e435d438b9d0e17db1d22df5bcafaba234c7e3db6059fbf69df030a527`.
  - Minimum boundary and decimal total: passed; seed 1; clock unavailable; 9 steps passed; page errors 0; error unavailable.
- **temperature**: passed; saved version `40a3d369-a7e8-4358-a348-967ae6c045f3`, HTML SHA-256 `3c1345617eb66dd96b54e1e7a0b97594e44de03e45bdec819db8fb0adee660fb`.
  - Empty versus zero and negative values: passed; seed 1; clock unavailable; 8 steps passed; page errors 0; error unavailable.
- **quiz**: passed; saved version `1298266a-9f51-4622-8713-6e3845e55f36`, HTML SHA-256 `138a4cbd777f7471ee6236374caa9def59fc014cf2543b7e97aecf0963a5bcd6`.
  - Selection, correctness and retry: passed; seed 1; clock unavailable; 10 steps passed; page errors 0; error unavailable.
- **signup-style**: passed; saved version `5aa93f70-af7e-4131-94d9-dde21c18a854`, HTML SHA-256 `766fc37e164c4643e5059a559a85d795e59c3a903988130e22f6fedd071a9007`.
  - Form behavior survives restyling: passed; seed 1; clock unavailable; 7 steps passed; page errors 0; error unavailable.
- **filter-feature**: passed; saved version `a0b50845-dc68-42d7-abe2-3ccf83cf03c9`, HTML SHA-256 `9f1d356fe1d11493897e905c9ee9c1bfd2aea63cf2339c56b84658bb329072b5`.
  - New clear action preserves filter intersection: passed; seed 1; clock unavailable; 12 steps passed; page errors 0; error unavailable.

## Measurement limits

- Total time is persisted run creation through terminal finish, including queueing and repairs. First file is the earliest persisted file_start, file_delta or file_saved; JSON also records first file_saved separately.
- Repair notices can repeat across replay. Committed repair/review stage counts come from uniquely named DBOS operations with committed model responses; failed uncommitted provider attempts are not counted.
- Structured provider token usage and billed cost are not persisted by this workflow. Both remain null; there are no estimated tokens, invented prices or inferred charges.
- Semantic checks cover the stated interactions, not every visual detail or accessibility requirement. Undo exercises the existing restore API and verifies exact saved HTML plus interactions; it does not establish shell button behavior.
- The JSON includes operation IDs/timestamps, stage aggregates, run IDs, event metadata and per-check outcomes. It excludes owner capabilities, response bodies, database credentials and provider keys.
