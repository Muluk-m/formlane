"""Transactional PostgreSQL authority for API, workers and event replay.

Every writer locks project then run, and allocates event sequences while holding
that run lock until commit. A replay cursor therefore cannot overtake an earlier
uncommitted event (PostgreSQL sequences alone do not provide this guarantee).
"""

import hashlib
import json
import re
import secrets
import time
from contextlib import contextmanager
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import create_engine, func, or_, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from .models import Message, Project, Run, RunCheckpoint, RunEvent, Version
from .project import MAX_PREVIEW_BYTES, validate_source

RUN_BUDGET_MS = 900_000
LEASE_DURATION_MS = 60_000
TERMINAL = {"completed", "failed", "cancelled"}
ERRORS = {
    "timeout": "Generation exceeded its 15-minute execution budget. Your previous version is unchanged.",
    "step_limit": "The agent reached its step limit before validation and review could finish. Your previous version is unchanged.",
    "validation": "The generated app did not pass validation after repair. Your previous version is unchanged.",
    "provider": "The model provider could not complete this run. Check the provider configuration and try again.",
    "internal": "Generation could not complete. Your previous version is unchanged. Please try again.",
}


class LeaseLost(RuntimeError):
    """The caller no longer has authority to read or mutate runtime state."""


class StoreError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


def timestamp(now: int | None = None) -> int:
    return time.time_ns() // 1_000_000 if now is None else now


def stable_uuid(value: str) -> str:
    data = bytearray(hashlib.sha256(value.encode()).digest()[:16])
    data[6] = (data[6] & 15) | 80
    data[8] = (data[8] & 63) | 128
    return str(UUID(bytes=bytes(data)))


def title_from_idea(idea: str) -> str:
    cleaned = re.sub(r"\s+", " ", idea).strip()
    if re.search(r"[\u4e00-\u9fff]", cleaned):
        return re.split(r"[。！？!?]", cleaned)[0][:16]
    sentence = re.split(r"[.!?]", cleaned)[0]
    sentence = re.sub(r"^(please\s+)?(build|create|make|design)\s+", "", sentence, flags=re.I)
    sentence = re.sub(r"^(a|an|the)\s+", "", sentence, flags=re.I)
    picked = " ".join(sentence.split()[:4])
    return (picked[:1].upper() + picked[1:])[:80] if picked else "Untitled app"


def project_json(row: Project, count: int | None = None) -> dict:
    result = {
        "id": row.id,
        "title": row.title,
        "idea": row.idea,
        "status": row.status,
        "error": row.error,
        "currentVersionId": row.current_version_id,
        "publishedSlug": row.published_slug,
        "publishedVersionId": row.published_version_id,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }
    if count is not None:
        result["versionCount"] = count
    return result


def version_json(row: Version, full: bool = False) -> dict:
    result = {
        "id": row.id,
        "parentVersionId": row.parent_version_id,
        "number": row.number,
        "prompt": row.prompt,
        "createdAt": row.created_at,
    }
    if full:
        result.update(html=row.html, source=row.source)
    return result


def run_json(row: Run) -> dict:
    return {
        "id": row.id,
        "projectId": row.project_id,
        "status": row.status,
        "attempt": row.attempt,
        "resumable": (
            row.recovery_eligible
            and row.execution_version in {"crew-v1", "dbos-v1"}
            and row.status in {"failed", "cancelled"}
        ),
        "request": row.request,
        "createdAt": row.created_at,
        "startedAt": row.started_at,
        "finishedAt": row.finished_at,
        "errorCode": row.error_code,
        "error": row.error,
        "versionId": row.version_id,
        "cursor": row.event_cursor,
    }


def event_json(row: RunEvent) -> dict:
    return {
        "runId": row.run_id,
        "sequence": row.sequence,
        "attempt": row.attempt,
        "type": row.type,
        "data": row.data,
        "createdAt": row.created_at,
    }


def message_json(row: Message) -> dict:
    return {
        "id": row.id,
        "role": row.role,
        "agent": row.agent if row.agent in {"mike", "emma", "bob", "alex", "david"} else None,
        "content": row.content,
        "createdAt": row.created_at,
    }


class Store:
    def __init__(self, database_url: str):
        url = make_url(database_url)
        if url.drivername not in {"postgresql", "postgresql+psycopg"}:
            raise ValueError("PostgreSQL with psycopg is the only supported business database.")
        options = f"{url.query.get('options', '')} -c statement_timeout=15000 -c lock_timeout=5000".strip()
        self.engine = create_engine(
            url.set(drivername="postgresql+psycopg"),
            pool_pre_ping=True,
            pool_timeout=5,
            connect_args={
                "connect_timeout": 5,
                "options": options,
                "keepalives": 1,
                "keepalives_idle": 5,
                "keepalives_interval": 5,
                "keepalives_count": 2,
                "tcp_user_timeout": 15000,
            },
        )
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def close(self) -> None:
        self.engine.dispose()

    @staticmethod
    def _project(s: Session, project_id: str, owner_id: str, lock: bool = True) -> Project:
        query = select(Project).where(Project.id == project_id, Project.owner_id == owner_id)
        if lock:
            query = query.with_for_update()
        row = s.scalar(query)
        if row is None:
            raise StoreError(404, "Project not found.")
        return row

    @staticmethod
    def _locked_run(s: Session, run_id: str) -> tuple[Project, Run] | None:
        project_id = s.scalar(select(Run.project_id).where(Run.id == run_id))
        if project_id is None:
            return None
        project = s.scalar(select(Project).where(Project.id == project_id).with_for_update())
        run = s.scalar(select(Run).where(Run.id == run_id).with_for_update())
        return (project, run) if project is not None and run is not None else None

    @staticmethod
    def _active(project: Project, run: Run, token: str, now: int) -> bool:
        return (
            project.run_id == run.id
            and project.status == "generating"
            and run.status == "running"
            and run.lease_token == token
            and run.deadline_at > now
            and (run.lease_expires_at or 0) > now
        )

    def _require_lease(
        self, s: Session, run_id: str, token: str, now: int | None = None
    ) -> tuple[Project, Run]:
        pair = self._locked_run(s, run_id)
        if pair is None or not self._active(*pair, token, timestamp(now)):
            raise LeaseLost("Run lease is no longer active.")
        return pair

    @staticmethod
    def _event(s: Session, run: Run, key: str, kind: str, data: dict, now: int) -> RunEvent:
        existing = s.scalar(
            select(RunEvent).where(RunEvent.run_id == run.id, RunEvent.event_key == key)
        )
        if existing is not None:
            return existing
        # No identity/sequence allocation: this counter and event commit together.
        run.event_cursor += 1
        event = RunEvent(
            run_id=run.id,
            sequence=run.event_cursor,
            event_key=key,
            attempt=run.attempt,
            type=kind,
            data=data,
            created_at=now,
        )
        s.add(event)
        s.flush()
        return event

    def _state(self, s: Session, run: Run, now: int) -> None:
        self._event(s, run, f"state:{run.attempt}:{run.status}", "run_state", run_json(run), now)

    def _finish(
        self,
        s: Session,
        project: Project,
        run: Run,
        status: str,
        code: str | None,
        now: int,
        *,
        message: bool = True,
        safe_error: str | None = None,
    ) -> bool:
        if run.status in TERMINAL:
            return False
        code = (code if code in ERRORS else "internal") if status == "failed" else None
        safe = safe_error or (ERRORS[code] if code else "Generation cancelled.")
        run.status, run.error_code = status, code
        run.error = safe if status == "failed" else None
        run.finished_at, run.lease_expires_at = now, None
        if message:
            s.add(
                Message(
                    id=stable_uuid(
                        f"{run.id}:terminal"
                        if run.attempt == 1
                        else f"{run.id}:terminal:{run.attempt}"
                    ),
                    project_id=run.project_id,
                    role="system",
                    content=safe,
                    created_at=now,
                )
            )
        if project.run_id == run.id:
            project.run_id = None
            project.status = "error" if status == "failed" else "idle"
            project.error, project.updated_at = run.error, now
        self._state(s, run, now)
        return True

    def _expire(self, s: Session, project: Project, run: Run, now: int) -> None:
        if run.status not in TERMINAL and run.deadline_at <= now:
            self._finish(s, project, run, "failed", "timeout", now)

    def create_project(self, owner_id: str, idea: str, now: int | None = None) -> dict:
        now = timestamp(now)
        with self.sessions.begin() as s:
            project = Project(
                id=str(uuid4()),
                owner_id=owner_id,
                title=title_from_idea(idea),
                idea=idea,
                status="idle",
                created_at=now,
                updated_at=now,
            )
            s.add(project)
            s.flush()
            s.add(
                Message(
                    id=str(uuid4()),
                    project_id=project.id,
                    role="user",
                    content=idea,
                    created_at=now + 1,
                )
            )
            return project_json(project)

    def list_projects(self, owner_id: str) -> list[dict]:
        with self.sessions() as s:
            count = (
                select(func.count(Version.id))
                .where(Version.project_id == Project.id)
                .scalar_subquery()
            )
            rows = s.execute(
                select(Project, count)
                .where(Project.owner_id == owner_id)
                .order_by(Project.updated_at.desc())
                .limit(60)
            )
            return [project_json(row, total) for row, total in rows]

    def get_project(self, project_id: str, owner_id: str) -> dict:
        with self.sessions.begin() as s:
            project = self._project(s, project_id, owner_id)
            versions = list(
                s.scalars(
                    select(Version).where(Version.project_id == project_id).order_by(Version.number)
                )
            )
            current = next((row for row in versions if row.id == project.current_version_id), None)
            messages = s.scalars(
                select(Message)
                .where(Message.project_id == project_id)
                .order_by(Message.created_at, Message.position)
            )
            return {
                "project": project_json(project),
                "versions": [version_json(row) for row in versions],
                "messages": [message_json(row) for row in messages],
                "html": current.html if current else None,
                "source": current.source if current else None,
            }

    def get_version(self, project_id: str, owner_id: str, version_id: str | None = None) -> dict:
        with self.sessions.begin() as s:
            project = self._project(s, project_id, owner_id)
            selected = version_id or project.current_version_id
            if not selected:
                raise StoreError(400, "Nothing to download yet.")
            version = s.scalar(
                select(Version).where(Version.project_id == project_id, Version.id == selected)
            )
            if version is None:
                raise StoreError(404, "Version not found.")
            return {"version": version_json(version, True), "title": project.title}

    def delete_project(self, project_id: str, owner_id: str) -> None:
        with self.sessions.begin() as s:
            s.delete(self._project(s, project_id, owner_id))

    def publish_project(self, project_id: str, owner_id: str) -> dict:
        with self.sessions.begin() as s:
            project = self._project(s, project_id, owner_id)
            if project.current_version_id is None:
                raise StoreError(400, "Build a version before publishing.")
            if not project.published_slug:
                # Serialize slug allocation across projects; database uniqueness is the final guard.
                s.execute(text("SELECT pg_advisory_xact_lock(714021, 2)"))
                while True:
                    alphabet = "abcdefghjkmnpqrstuvwxyz" + "23456789"
                    slug = "".join(secrets.choice(alphabet) for _ in range(10))
                    if s.scalar(select(Project.id).where(Project.published_slug == slug)) is None:
                        project.published_slug = slug
                        break
            project.published_version_id = project.current_version_id
            project.updated_at = timestamp()
            return {"slug": project.published_slug, "versionId": project.published_version_id}

    def unpublish_project(self, project_id: str, owner_id: str) -> None:
        with self.sessions.begin() as s:
            project = self._project(s, project_id, owner_id)
            project.published_slug = project.published_version_id = None
            project.updated_at = timestamp()

    def get_published(self, slug: str) -> dict | None:
        with self.sessions() as s:
            row = s.execute(
                select(Project.title, Version.html)
                .join(Version, Version.id == Project.published_version_id)
                .where(Project.published_slug == slug)
            ).first()
            return {"title": row.title, "html": row.html} if row else None

    def restore_version(self, project_id: str, owner_id: str, version_id: str) -> dict:
        with self.sessions.begin() as s:
            project = self._project(s, project_id, owner_id)
            version = s.scalar(
                select(Version).where(Version.project_id == project_id, Version.id == version_id)
            )
            if version is None:
                raise StoreError(404, "Version not found.")
            now = timestamp()
            s.execute(
                update(Run).where(Run.project_id == project_id).values(recovery_eligible=False)
            )
            active = s.scalars(
                select(Run)
                .where(Run.project_id == project_id, Run.status.in_(["queued", "running"]))
                .order_by(Run.id)
                .with_for_update()
            )
            for run in active:
                self._finish(s, project, run, "cancelled", None, now, message=False)
            project.current_version_id, project.status = version.id, "idle"
            project.run_id = project.error = None
            project.updated_at = now
            s.add(
                Message(
                    id=str(uuid4()),
                    project_id=project_id,
                    role="system",
                    content=f"Restored version {version.number}.",
                    created_at=now,
                )
            )
            return {
                "project": project_json(project),
                "html": version.html,
                "source": version.source,
                "number": version.number,
            }

    def remix_project(self, project_id: str, owner_id: str, version_id: str | None = None) -> dict:
        with self.sessions.begin() as s:
            original = self._project(s, project_id, owner_id)
            versions = list(
                s.scalars(
                    select(Version).where(Version.project_id == project_id).order_by(Version.number)
                )
            )
            selected = version_id if version_id is not None else original.current_version_id
            copied_ids = {row.id: str(uuid4()) for row in versions}
            if selected is not None and selected not in copied_ids:
                raise StoreError(404, "Version not found.")
            now, new_id = timestamp(), str(uuid4())
            project = Project(
                id=new_id,
                owner_id=owner_id,
                title=f"{original.title} remix"[:80],
                idea=original.idea,
                status="idle",
                current_version_id=copied_ids.get(selected),
                created_at=now,
                updated_at=now,
            )
            s.add(project)
            s.flush()
            for row in versions:
                s.add(
                    Version(
                        id=copied_ids[row.id],
                        project_id=new_id,
                        number=row.number,
                        html=row.html,
                        source=row.source,
                        prompt=row.prompt,
                        created_at=row.created_at,
                        parent_version_id=copied_ids.get(row.parent_version_id),
                    )
                )
            history = list(
                s.scalars(
                    select(Message)
                    .where(Message.project_id == project_id)
                    .order_by(Message.created_at, Message.position)
                )
            )
            for index, row in enumerate(history, 1):
                s.add(
                    Message(
                        id=str(uuid4()),
                        project_id=new_id,
                        role=row.role,
                        agent=message_json(row)["agent"],
                        content=row.content,
                        created_at=now + index,
                    )
                )
            s.add(
                Message(
                    id=str(uuid4()),
                    project_id=new_id,
                    role="system",
                    content=f"Remixed from {original.title}.",
                    created_at=now + len(history) + 1,
                )
            )
            return project_json(project)

    def create_run(
        self,
        project_id: str,
        owner_id: str,
        content: str | None = None,
        mode: str = "followup",
        now: int | None = None,
    ) -> dict:
        with self.sessions.begin() as s:
            project = self._project(s, project_id, owner_id)
            clock = timestamp(now)
            if mode == "initial" and project.current_version_id:
                raise StoreError(400, "This project already has a build. Send a follow-up instead.")
            if project.run_id:
                previous = s.scalar(select(Run).where(Run.id == project.run_id).with_for_update())
                if previous:
                    self._expire(s, project, previous, clock)
            if project.run_id:
                raise StoreError(409, "A generation is already running for this project.")
            s.execute(
                update(Run).where(Run.project_id == project_id).values(recovery_eligible=False)
            )
            run = Run(
                id=str(uuid4()),
                project_id=project_id,
                status="queued",
                request=content or project.idea,
                previous_version_id=project.current_version_id,
                created_at=clock,
                deadline_at=clock + RUN_BUDGET_MS,
                attempt=1,
                attempt_started_at=clock,
                execution_version="dbos-v1",
                recovery_eligible=True,
                event_cursor=0,
            )
            s.add(run)
            project.run_id, project.status, project.error, project.updated_at = (
                run.id,
                "generating",
                None,
                clock,
            )
            if content:
                s.add(
                    Message(
                        id=run.id,
                        project_id=project_id,
                        role="user",
                        content=content,
                        created_at=clock,
                    )
                )
            self._state(s, run, clock)
            return run_json(run)

    def claim_run(self, worker_id: str, now: int | None = None) -> dict | None:
        if not isinstance(worker_id, str) or not 1 <= len(worker_id) <= 200:
            raise ValueError("Worker identity must contain 1 to 200 characters.")
        with self.sessions.begin() as s:
            # Preserve the old executor's global concurrency of one, including concurrent pollers.
            s.execute(text("SELECT pg_advisory_xact_lock(714021, 1)"))
            clock = timestamp(now)
            active = s.scalar(
                select(Run)
                .join(Project, Project.id == Run.project_id)
                .where(
                    Run.status == "running",
                    Run.lease_expires_at > clock,
                    Run.deadline_at > clock,
                    Project.run_id == Run.id,
                    Project.status == "generating",
                )
                .limit(1)
            )
            if active:
                pair = self._locked_run(s, active.id)
                if pair and self._active(*pair, active.lease_token, timestamp(now)):
                    return self._job(pair[1]) if pair[1].lease_owner == worker_id else None
            candidates = list(
                s.scalars(
                    select(Run.id)
                    .join(Project, Project.id == Run.project_id)
                    .where(
                        Run.status.in_(["queued", "running"]),
                        Run.deadline_at > clock,
                        or_(Run.lease_expires_at.is_(None), Run.lease_expires_at <= clock),
                        Project.run_id == Run.id,
                        Project.status == "generating",
                    )
                    .order_by(Run.created_at, Run.id)
                )
            )
            for run_id in candidates:
                pair = self._locked_run(s, run_id)
                clock = timestamp(now)
                if pair is None:
                    continue
                project, run = pair
                if (
                    run.status in TERMINAL
                    or project.run_id != run.id
                    or project.status != "generating"
                    or run.deadline_at <= clock
                    or (run.lease_expires_at or 0) > clock
                ):
                    continue
                run.status, run.started_at = (
                    "running",
                    run.started_at if run.started_at is not None else clock,
                )
                run.lease_token, run.lease_owner = str(uuid4()), worker_id
                run.lease_expires_at = min(run.deadline_at, clock + LEASE_DURATION_MS)
                self._state(s, run, clock)
                return self._job(run)
            return None

    @staticmethod
    def _job(run: Run) -> dict:
        return {column.name: getattr(run, column.name) for column in Run.__table__.columns}

    def harness_context(self, run_id: str, lease_token: str) -> dict:
        with self.sessions.begin() as s:
            project, run = self._require_lease(s, run_id, lease_token)
            version = s.get(Version, run.previous_version_id) if run.previous_version_id else None
            return {
                "projectId": project.id,
                "runId": run.id,
                "idea": project.idea,
                "request": run.request,
                "previousSource": version.source if version else None,
                "attempt": run.attempt,
                "executionVersion": run.execution_version,
                "deadlineAt": run.deadline_at,
            }

    def check_authority(self, run_id: str, lease_token: str) -> None:
        with self.sessions.begin() as s:
            self._require_lease(s, run_id, lease_token)

    @contextmanager
    def scheduling_authority(self, run_id: str, lease_token: str):
        """Keep reclaim/cancellation serialized with DBOS ownership transfer."""
        with self.sessions.begin() as session:
            self._require_lease(session, run_id, lease_token)
            yield session.connection()
            self._require_lease(session, run_id, lease_token)

    def heartbeat(self, run_id: str, lease_token: str, now: int | None = None) -> bool:
        with self.sessions.begin() as s:
            pair = self._locked_run(s, run_id)
            clock = timestamp(now)
            if pair is None or not self._active(*pair, lease_token, clock):
                return False
            pair[1].lease_expires_at = min(pair[1].deadline_at, clock + LEASE_DURATION_MS)
            return True

    def append_event(
        self, run_id: str, lease_token: str, event_key: str, event_type: str, data: dict
    ) -> dict:
        if (
            not isinstance(event_key, str)
            or not 1 <= len(event_key) <= 300
            or not isinstance(event_type, str)
            or not 1 <= len(event_type) <= 100
        ):
            raise ValueError("Invalid event identity or type.")
        if (
            event_key.startswith("state:")
            or event_key == "version"
            or event_type in {"run_state", "version"}
        ):
            raise ValueError("Lifecycle events are owned by the storage transaction.")
        if not isinstance(data, dict):
            raise ValueError("Event data must be a JSON object.")
        json.dumps(data, allow_nan=False)
        with self.sessions.begin() as s:
            project, run = self._require_lease(s, run_id, lease_token)
            event = self._event(s, run, event_key, event_type, data, timestamp())
            # Use the immutable winning event, never the retried payload.
            payload = event.data
            if (
                event.type == "message_done"
                and isinstance(payload.get("id"), str)
                and isinstance(payload.get("content"), str)
            ):
                existing = s.get(Message, payload["id"])
                if existing is None:
                    s.add(
                        Message(
                            id=payload["id"],
                            project_id=project.id,
                            role="system" if payload.get("role") == "system" else "agent",
                            agent=payload.get("agent")
                            if isinstance(payload.get("agent"), str)
                            else None,
                            content=payload["content"],
                            created_at=event.created_at,
                        )
                    )
                elif existing.project_id != project.id:
                    raise ValueError("Message identity belongs to another project.")
                else:
                    existing.content, existing.created_at = payload["content"], event.created_at
            return event_json(event)

    def get_checkpoint(self, run_id: str, lease_token: str, name: str) -> dict | None:
        if not isinstance(name, str) or len(name) > 300:
            raise ValueError("Checkpoint name exceeds 300 characters.")
        with self.sessions.begin() as s:
            self._require_lease(s, run_id, lease_token)
            row = s.get(RunCheckpoint, (run_id, name))
            return {"value": row.result, "createdAt": row.created_at} if row else None

    def put_checkpoint(self, run_id: str, lease_token: str, name: str, value: Any) -> dict:
        if not isinstance(name, str) or len(name) > 300:
            raise ValueError("Checkpoint name exceeds 300 characters.")
        json.dumps(value, allow_nan=False)
        with self.sessions.begin() as s:
            self._require_lease(s, run_id, lease_token)
            row = s.get(RunCheckpoint, (run_id, name))
            if row is None:
                row = RunCheckpoint(run_id=run_id, name=name, result=value, created_at=timestamp())
                s.add(row)
            return {"value": row.result, "createdAt": row.created_at}

    def complete_run(self, run_id: str, lease_token: str, result: dict) -> bool:
        validate_source(result.get("source"))
        if (
            not isinstance(result.get("html"), str)
            or not result["html"]
            or len(result["html"].encode("utf-8")) > MAX_PREVIEW_BYTES
            or not isinstance(result.get("summary"), str)
            or not 1 <= len(result["summary"].encode("utf-16-le")) // 2 <= 20_000
        ):
            raise ValueError("Completion requires bounded compiled HTML and a nonempty summary.")
        with self.sessions.begin() as s:
            pair = self._locked_run(s, run_id)
            if pair is None:
                return False
            project, run = pair
            if run.status == "completed" and run.lease_token == lease_token:
                return True
            now = timestamp()
            if not self._active(project, run, lease_token, now):
                return False
            number = (
                s.scalar(
                    select(func.coalesce(func.max(Version.number), 0)).where(
                        Version.project_id == project.id
                    )
                )
                + 1
            )
            version = Version(
                id=run.id,
                project_id=project.id,
                number=number,
                html=result["html"],
                source=result["source"],
                prompt=run.request,
                created_at=now,
                parent_version_id=run.previous_version_id,
            )
            s.add(version)
            s.add(
                Message(
                    id=stable_uuid(f"{run.id}:complete"),
                    project_id=project.id,
                    role="system",
                    content=result["summary"],
                    created_at=now,
                )
            )
            self._event(s, run, "version", "version", version_json(version), now)
            run.status, run.finished_at, run.version_id, run.lease_expires_at = (
                "completed",
                now,
                version.id,
                None,
            )
            project.current_version_id, project.status, project.updated_at = version.id, "idle", now
            project.run_id = project.error = None
            self._state(s, run, now)
            return True

    def finish_run(
        self, run_id: str, lease_token: str, status: str, error_code: str | None, error: str
    ) -> bool:
        if status not in {"failed", "cancelled"}:
            raise ValueError("Only failed or cancelled terminal states are accepted.")
        # Raw provider error is intentionally never stored or exposed.
        with self.sessions.begin() as s:
            pair = self._locked_run(s, run_id)
            if pair and pair[1].status == status and pair[1].lease_token == lease_token:
                return True
            now = timestamp()
            if pair is None or not self._active(*pair, lease_token, now):
                return False
            return self._finish(s, *pair, status, error_code, now)

    def fail_incompatible_run(self, run_id: str, lease_token: str) -> bool:
        with self.sessions.begin() as s:
            pair = self._locked_run(s, run_id)
            now = timestamp()
            if pair is None or not self._active(*pair, lease_token, now):
                return False
            pair[1].recovery_eligible = False
            return self._finish(
                s,
                *pair,
                "failed",
                "internal",
                now,
                safe_error="This run requires its original execution version and cannot resume on this deployment.",
            )

    def expire_runs(self) -> None:
        with self.sessions() as s:
            ids = list(
                s.scalars(
                    select(Run.id).where(
                        Run.status.in_(["queued", "running"]), Run.deadline_at <= timestamp()
                    )
                )
            )
        for run_id in ids:
            with self.sessions.begin() as s:
                pair = self._locked_run(s, run_id)
                if pair:
                    self._expire(s, *pair, timestamp())

    def get_run(self, project_id: str, owner_id: str, run_id: str | None = None) -> dict | None:
        with self.sessions.begin() as s:
            try:
                project = self._project(s, project_id, owner_id)
            except StoreError:
                if run_id:
                    raise StoreError(404, "Run not found.") from None
                raise
            query = select(Run).where(Run.project_id == project_id)
            query = (
                query.where(Run.id == run_id)
                if run_id
                else query.order_by(
                    Run.recovery_eligible.desc(), Run.created_at.desc(), Run.id.desc()
                ).limit(1)
            )
            run = s.scalar(query.with_for_update())
            if run is None:
                if run_id:
                    raise StoreError(404, "Run not found.")
                return None
            self._expire(s, project, run, timestamp())
            return run_json(run)

    def resume_run(
        self, project_id: str, owner_id: str, run_id: str, now: int | None = None
    ) -> dict:
        with self.sessions.begin() as s:
            try:
                project = self._project(s, project_id, owner_id)
            except StoreError:
                raise StoreError(404, "Run not found.") from None
            run = s.scalar(
                select(Run).where(Run.id == run_id, Run.project_id == project_id).with_for_update()
            )
            if run is None:
                raise StoreError(404, "Run not found.")
            if (
                not run.recovery_eligible
                or run.execution_version not in {"crew-v1", "dbos-v1"}
                or project.current_version_id != run.previous_version_id
                or project.run_id not in {None, run.id}
                or run.status == "completed"
            ):
                raise StoreError(409, "This run can no longer be resumed.")
            if run.status in {"queued", "running"}:
                if project.run_id != run.id or project.status != "generating":
                    raise StoreError(409, "This run can no longer be resumed.")
                return run_json(run)
            clock = timestamp(now)
            run.attempt += 1
            run.attempt_started_at, run.deadline_at = clock, clock + RUN_BUDGET_MS
            run.status = "queued"
            run.finished_at = run.error_code = run.error = None
            run.lease_token = run.lease_owner = run.lease_expires_at = None
            project.run_id, project.status = run.id, "generating"
            project.error, project.updated_at = None, clock
            self._state(s, run, clock)
            return run_json(run)

    def cancel_run(self, project_id: str, owner_id: str, run_id: str | None = None) -> None:
        with self.sessions.begin() as s:
            try:
                project = self._project(s, project_id, owner_id)
            except StoreError:
                if run_id:
                    raise StoreError(404, "Run not found.") from None
                raise
            selected = run_id or project.run_id
            if not selected:
                return
            run = s.scalar(
                select(Run)
                .where(Run.id == selected, Run.project_id == project_id)
                .with_for_update()
            )
            if run is None:
                raise StoreError(404, "Run not found.")
            self._finish(s, project, run, "cancelled", None, timestamp())

    def list_run_events(
        self, project_id: str, owner_id: str, run_id: str, after: int
    ) -> list[dict]:
        with self.sessions.begin() as s:
            self._project(s, project_id, owner_id)
            if (
                s.scalar(select(Run.id).where(Run.id == run_id, Run.project_id == project_id))
                is None
            ):
                raise StoreError(404, "Run not found.")
            return [
                event_json(row)
                for row in s.scalars(
                    select(RunEvent)
                    .where(RunEvent.run_id == run_id, RunEvent.sequence > after)
                    .order_by(RunEvent.sequence)
                    .limit(100)
                )
            ]
