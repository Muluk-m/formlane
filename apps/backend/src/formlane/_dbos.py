"""Pinned DBOS scheduling adapter for the application's locked transaction.

DBOS 3.5.0's public resume opens another transaction and retries connection loss.
Neither can preserve the application lease fence: a stale producer could reconnect
and overwrite its replacement's queue. Keep the SDK's unchanged scheduling SQL,
but bind this per-call copy to the supplied connection without independent retries.
Real PostgreSQL connection-loss and process-death contracts guard this dependency.
"""

import copy
from contextlib import nullcontext
from types import SimpleNamespace

from dbos._schemas import SCHEMA_PLACEHOLDER


def resume_on_connection(runtime, connection, schema: str, run_id: str, queue: str) -> None:
    """Schedule without owning the connection, transaction, or retry policy."""
    connection = connection.execution_options(
        schema_translate_map={SCHEMA_PLACEHOLDER: schema}
    )
    scheduler = copy.copy(runtime._sys_db)
    scheduler.engine = SimpleNamespace(
        begin=lambda: nullcontext(connection), dialect=connection.dialect
    )
    scheduler._retry_connection_errors = False
    scheduler.resume_workflows([run_id], queue_name=queue)
