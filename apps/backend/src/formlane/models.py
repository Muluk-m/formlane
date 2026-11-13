"""Six business tables. All times are epoch milliseconds; IDs retain D1 text fidelity."""

from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    owner_id: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    idea: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="idle", server_default="idle")
    error: Mapped[str | None] = mapped_column(Text)
    current_version_id: Mapped[str | None] = mapped_column(Text)
    published_slug: Mapped[str | None] = mapped_column(Text, unique=True)
    published_version_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)
    run_id: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        CheckConstraint("status IN ('idle','generating','error')", name="project_status"),
        Index("idx_projects_owner", "owner_id", "updated_at"),
        ForeignKeyConstraint(
            ["id", "current_version_id"],
            ["versions.project_id", "versions.id"],
            name="project_current_version",
            use_alter=True,
            deferrable=True,
            initially="DEFERRED",
        ),
        ForeignKeyConstraint(
            ["id", "published_version_id"],
            ["versions.project_id", "versions.id"],
            name="project_published_version",
            use_alter=True,
            deferrable=True,
            initially="DEFERRED",
        ),
        ForeignKeyConstraint(
            ["id", "run_id"],
            ["runs.project_id", "runs.id"],
            name="project_active_run",
            use_alter=True,
            deferrable=True,
            initially="DEFERRED",
        ),
    )


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(Text)
    agent: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(BigInteger)
    # D1 orders tied timestamps by rowid. Import preserves export order in this identity.
    position: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    __table_args__ = (
        CheckConstraint("role IN ('user','agent','system')", name="message_role"),
        Index("idx_messages_project", "project_id", "created_at", "position"),
    )


class Version(Base):
    __tablename__ = "versions"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    number: Mapped[int] = mapped_column(Integer)
    html: Mapped[str] = mapped_column(Text)
    prompt: Mapped[str] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(BigInteger)
    source: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # Accepted check set: the regression baseline for follow-ups; null before flow-v1.
    acceptance_checks: Mapped[list[Any] | None] = mapped_column(JSONB)
    parent_version_id: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        UniqueConstraint("project_id", "number", name="idx_versions_number"),
        UniqueConstraint("project_id", "id", name="version_project_identity"),
        CheckConstraint("number > 0", name="version_positive_number"),
        ForeignKeyConstraint(
            ["project_id", "parent_version_id"],
            ["versions.project_id", "versions.id"],
            name="version_parent",
            deferrable=True,
            initially="DEFERRED",
        ),
    )


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(Text, default="queued", server_default="queued")
    request: Mapped[str] = mapped_column(Text)
    previous_version_id: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[int] = mapped_column(BigInteger)
    started_at: Mapped[int | None] = mapped_column(BigInteger)
    finished_at: Mapped[int | None] = mapped_column(BigInteger)
    attempt: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    attempt_started_at: Mapped[int] = mapped_column(BigInteger)
    execution_version: Mapped[str] = mapped_column(
        Text, default="crew-v1", server_default="crew-v1"
    )
    recovery_eligible: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    error_code: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    version_id: Mapped[str | None] = mapped_column(Text)
    lease_token: Mapped[str | None] = mapped_column(Text)
    lease_owner: Mapped[str | None] = mapped_column(Text)
    lease_expires_at: Mapped[int | None] = mapped_column(BigInteger)
    event_cursor: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    __table_args__ = (
        UniqueConstraint("project_id", "id", name="run_project_identity"),
        CheckConstraint(
            "status IN ('queued','running','completed','failed','cancelled')", name="run_status"
        ),
        CheckConstraint("event_cursor >= 0", name="run_cursor_nonnegative"),
        CheckConstraint("attempt >= 1", name="run_attempt_positive"),
        Index("idx_runs_project", "project_id", "created_at"),
        Index("idx_runs_queue", "status", "lease_expires_at", "created_at"),
        ForeignKeyConstraint(
            ["project_id", "previous_version_id"],
            ["versions.project_id", "versions.id"],
            name="run_previous_version",
            deferrable=True,
            initially="DEFERRED",
        ),
        ForeignKeyConstraint(
            ["project_id", "version_id"],
            ["versions.project_id", "versions.id"],
            name="run_result_version",
            deferrable=True,
            initially="DEFERRED",
        ),
    )


class RunEvent(Base):
    __tablename__ = "run_events"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    sequence: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    event_key: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[int] = mapped_column(BigInteger)
    attempt: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        UniqueConstraint("run_id", "event_key", name="idx_run_events_key"),
        CheckConstraint("sequence > 0", name="event_positive_sequence"),
        CheckConstraint("attempt >= 1", name="event_attempt_positive"),
    )


class RunCheckpoint(Base):
    __tablename__ = "run_checkpoints"
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    name: Mapped[str] = mapped_column(Text, primary_key=True)
    result: Mapped[Any] = mapped_column(JSONB(none_as_null=False), nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger)
