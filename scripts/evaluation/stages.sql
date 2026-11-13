-- DBOS 3.5.0, inspected on the staging VM on 2026-11-13.
-- SQLAlchemy/psycopg bind :run_ids is a text[] of this evaluation's UUIDs.
-- Run inside a REPEATABLE READ, READ ONLY transaction against
-- formlane_workflow_stage. Both timestamp columns are epoch milliseconds.
-- A row is a committed operation; failed/uncommitted provider attempts are absent.
WITH committed AS (
    SELECT workflow_uuid AS run_id, function_id, function_name,
           split_part(function_name, '/', 2) AS stage,
           started_at_epoch_ms, completed_at_epoch_ms
    FROM dbos.operation_outputs
    WHERE workflow_uuid = ANY(CAST(:run_ids AS text[]))
      AND error IS NULL AND output IS NOT NULL
      AND function_name LIKE 'flow-v1/%'
), stages AS (
    SELECT run_id, stage,
           count(*) AS committed_operations,
           count(*) FILTER (WHERE function_name ~ '/llm-[0-9]+$') AS committed_model_calls,
           count(*) FILTER (WHERE function_name ~ '/tool-[0-9]+-record_review$') AS committed_review_operations,
           count(*) FILTER (
               WHERE started_at_epoch_ms IS NOT NULL AND completed_at_epoch_ms IS NOT NULL
                 AND completed_at_epoch_ms >= started_at_epoch_ms
           ) AS timed_operations,
           min(started_at_epoch_ms) AS first_operation_started_at_ms,
           max(completed_at_epoch_ms) AS last_operation_completed_at_ms,
           CASE WHEN bool_and(started_at_epoch_ms IS NOT NULL AND completed_at_epoch_ms IS NOT NULL
                              AND completed_at_epoch_ms >= started_at_epoch_ms)
                THEN CAST(sum(completed_at_epoch_ms - started_at_epoch_ms) AS bigint) END AS operation_duration_sum_ms,
           CASE WHEN bool_and(started_at_epoch_ms IS NOT NULL AND completed_at_epoch_ms IS NOT NULL
                              AND completed_at_epoch_ms >= started_at_epoch_ms)
                THEN max(completed_at_epoch_ms) - min(started_at_epoch_ms) END AS committed_stage_span_ms
    FROM committed
    GROUP BY run_id, stage
)
SELECT * FROM stages ORDER BY run_id, first_operation_started_at_ms NULLS LAST, stage;
