"""HTTP compatibility API. Start with uvicorn formlane.app:create_app --factory."""

import asyncio
import io
import json
import logging
import re
from contextlib import asynccontextmanager
from typing import Annotated
from uuid import uuid4
from zipfile import ZIP_STORED, ZipFile

from fastapi import Body, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse
from pydantic import (
    BaseModel,
    ConfigDict,
    StrictStr,
    StringConstraints,
    ValidationError,
    field_validator,
    model_validator,
)
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool
from starlette.middleware.cors import CORSMiddleware

from .compiler import compile_editor_project
from .selection import MAX_SELECTION_REQUEST_BYTES, SelectionSubmission, bind_selection
from .settings import Settings
from .storage import TERMINAL, Store, StoreError

UUID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
UuidString = Annotated[str, StringConstraints(pattern=UUID_PATTERN)]
logger = logging.getLogger(__name__)


class IdeaInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    idea: StrictStr

    @field_validator("idea")
    @classmethod
    def valid_idea(cls, value: str) -> str:
        value = value.strip()
        if not 1 <= len(value.encode("utf-16-le")) // 2 <= 4000:
            raise ValueError("Describe the app in 1 to 4000 characters.")
        return value


class FollowupInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: StrictStr
    expectedVersionId: UuidString | None = None
    selection: SelectionSubmission | None = None

    @field_validator("content")
    @classmethod
    def valid_content(cls, value: str) -> str:
        return IdeaInput.valid_idea(value)

    @model_validator(mode="after")
    def selection_baseline(self):
        if self.selection is not None and self.expectedVersionId is None:
            raise ValueError("Selection requires expectedVersionId.")
        return self


class GenerateInput(FollowupInput):
    content: StrictStr | None = None

    @field_validator("content", mode="before")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("Content must be a string when provided.")
        return value


class VersionInput(BaseModel):
    versionId: StrictStr

    @field_validator("versionId")
    @classmethod
    def valid_version(cls, value: str) -> str:
        if not UUID_PATTERN.fullmatch(value):
            raise ValueError("Invalid version ID.")
        return value


class RemixInput(VersionInput):
    versionId: StrictStr | None = None

    @field_validator("versionId", mode="before")
    @classmethod
    def reject_explicit_null(cls, value):
        if value is None:
            raise ValueError("Version ID must be a string when provided.")
        return value


def create_app(settings: Settings | None = None, store: Store | None = None) -> FastAPI:
    settings = settings or Settings()
    owned_store = store is None
    store = store or Store(settings.database_url)

    @asynccontextmanager
    async def lifespan(_app):
        yield
        if owned_store:
            await run_in_threadpool(store.close)

    app = FastAPI(title="Formlane API", lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.store = store
    app.state.settings = settings

    def error_response(request: Request, status: int, message: str) -> JSONResponse:
        path = request.url.path
        legacy_http = bool(re.search(r"/(generate|chat|download|runs)(/|$)", path))
        if legacy_http or not path.startswith("/api/"):
            payload = {"error": message}
        else:
            code = {
                400: "BAD_REQUEST",
                403: "FORBIDDEN",
                404: "NOT_FOUND",
                409: "CONFLICT",
                503: "SERVICE_UNAVAILABLE",
            }.get(status, "INTERNAL_SERVER_ERROR")
            payload = {
                "defined": status in {400, 404, 409, 500},
                "code": code,
                "status": status,
                "message": message,
            }
        return JSONResponse(payload, status_code=status)

    @app.exception_handler(StoreError)
    async def store_error(request: Request, error: StoreError):
        return error_response(request, error.status, error.message)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, _error: RequestValidationError):
        return error_response(request, 400, "Invalid request.")

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, _error: Exception):
        logger.error("api_request_failed")
        response = error_response(request, 500, "Something went wrong.")
        response.headers["cache-control"] = "no-store"
        origin = request.headers.get("origin")
        if origin in settings.cors_origins:
            response.headers["access-control-allow-origin"] = origin
            response.headers["access-control-allow-credentials"] = "true"
            response.headers["vary"] = "Origin"
        return response

    @app.middleware("http")
    async def owner_capability(request: Request, call_next):
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        origin = request.headers.get("origin")
        # Block cross-site cookie mutations, including form POSTs that do not preflight.
        if (
            origin
            and origin not in settings.cors_origins
            and origin != str(request.base_url).rstrip("/")
        ):
            return error_response(request, 403, "Origin is not allowed.")
        header, cookie = request.headers.get("x-owner-id", ""), request.cookies.get("atoms_uid", "")
        owner = (
            header
            if UUID_PATTERN.fullmatch(header)
            else cookie
            if UUID_PATTERN.fullmatch(cookie)
            else str(uuid4())
        )
        request.state.owner_id = owner
        response = await call_next(request)
        response.headers["cache-control"] = "no-store"
        response.set_cookie(
            "atoms_uid",
            owner,
            max_age=365 * 24 * 60 * 60,
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
            path="/",
        )
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Owner-ID", "Last-Event-ID"],
        expose_headers=["Content-Disposition"],
        max_age=600,
    )

    @app.get("/healthz")
    def readiness():
        try:
            with store.engine.connect() as connection:
                connection.execute(text("SELECT 1 FROM projects LIMIT 0"))
                connection.execute(text("SELECT selection_summary FROM messages LIMIT 0"))
                connection.execute(
                    text(
                        "SELECT source, parent_version_id, acceptance_checks FROM versions LIMIT 0"
                    )
                )
                connection.execute(
                    text(
                        "SELECT event_cursor, lease_token, attempt, attempt_started_at, execution_version, recovery_eligible, selection FROM runs LIMIT 0"
                    )
                )
                connection.execute(text("SELECT sequence, attempt FROM run_events LIMIT 0"))
                connection.execute(text("SELECT result FROM run_checkpoints LIMIT 0"))
                revision = connection.execute(
                    text("SELECT version_num FROM alembic_version")
                ).scalar()
                if revision != "0005_selection_evidence":
                    return JSONResponse({"ok": False}, status_code=503)
            return {"ok": True}
        except Exception:
            return JSONResponse({"ok": False}, status_code=503)

    @app.get("/api/health")
    def health():
        return {
            "ok": True,
            "mock": False,
            "model": settings.model,
            "hasKey": bool(settings.openai_api_key.strip()),
            "executorConfigured": settings.worker_enabled,
        }

    @app.get("/api/me")
    def me(request: Request):
        return {"ownerId": request.state.owner_id}

    @app.get("/api/projects")
    def projects(request: Request):
        return {"projects": store.list_projects(request.state.owner_id)}

    @app.post("/api/projects")
    def create_project(request: Request, body: IdeaInput):
        return {"project": store.create_project(request.state.owner_id, body.idea)}

    @app.get("/api/projects/{project_id}")
    def get_project(request: Request, project_id: UuidString):
        return store.get_project(project_id, request.state.owner_id)

    @app.delete("/api/projects/{project_id}")
    def delete_project(request: Request, project_id: UuidString):
        store.delete_project(project_id, request.state.owner_id)
        return {"ok": True}

    @app.get("/api/projects/{project_id}/versions/{version_id}")
    def version(request: Request, project_id: UuidString, version_id: UuidString):
        return {
            "version": store.get_version(project_id, request.state.owner_id, version_id)["version"]
        }

    def editor_artifact(project_id: str, owner_id: str, version_id: str) -> dict:
        saved = store.get_version(project_id, owner_id, version_id)["version"]
        try:
            compiled = compile_editor_project(saved["source"], settings, lambda: False)
        except (ValueError, TimeoutError):
            raise StoreError(409, "The editor preview could not be reproduced for this version.") from None
        if compiled["html"] != saved["html"]:
            raise StoreError(409, "The editor preview does not match the saved version.")
        return {
            "projectId": project_id, "versionId": version_id,
            "html": compiled["html"], "editorHtml": compiled["editorHtml"],
            "manifest": compiled["manifest"], "diagnostics": compiled["diagnostics"],
        }

    @app.get("/api/projects/{project_id}/versions/{version_id}/editor")
    def editor_version(request: Request, project_id: UuidString, version_id: UuidString):
        return editor_artifact(project_id, request.state.owner_id, version_id)

    @app.post("/api/projects/{project_id}/publish")
    def publish(request: Request, project_id: UuidString):
        published = store.publish_project(project_id, request.state.owner_id)
        return {**published, "url": f"{settings.public_origin}/p/{published['slug']}"}

    @app.post("/api/projects/{project_id}/unpublish")
    def unpublish(request: Request, project_id: UuidString):
        store.unpublish_project(project_id, request.state.owner_id)
        return {"ok": True}

    @app.post("/api/projects/{project_id}/restore")
    def restore(request: Request, project_id: UuidString, body: VersionInput):
        return store.restore_version(project_id, request.state.owner_id, body.versionId)

    @app.post("/api/projects/{project_id}/remix")
    def remix(
        request: Request,
        project_id: UuidString,
        body: RemixInput = Body(default_factory=RemixInput),
    ):
        return {"project": store.remix_project(project_id, request.state.owner_id, body.versionId)}

    @app.post("/api/projects/{project_id}/cancel")
    def cancel(request: Request, project_id: UuidString):
        store.cancel_run(project_id, request.state.owner_id)
        return {"ok": True}

    @app.get("/api/projects/{project_id}/download")
    def download(request: Request, project_id: str, version: str | None = None):
        saved = store.get_version(project_id, request.state.owner_id, version)
        output = io.BytesIO()
        with ZipFile(output, "w", compression=ZIP_STORED) as archive:
            for path, content in saved["version"]["source"]["files"].items():
                archive.writestr(path, content.encode("utf-8"))
        slug = re.sub(r"[^a-z0-9]+", "-", saved["title"].lower()).strip("-")[:40] or "app"
        return Response(
            output.getvalue(),
            media_type="application/zip",
            headers={
                "content-disposition": f'attachment; filename="{slug}-v{saved["version"]["number"]}.zip"',
                "x-content-type-options": "nosniff",
                "cache-control": "no-store",
            },
        )

    async def begin_run(request: Request, project_id: str, initial: bool):
        # Preserve ownership-before-configuration/body error ordering.
        detail = await run_in_threadpool(store.get_project, project_id, request.state.owner_id)
        if not settings.worker_enabled:
            raise StoreError(503, "Generation is unavailable: the executor is not configured.")
        if initial and detail["project"]["currentVersionId"]:
            raise StoreError(400, "This project already has a build. Send a follow-up instead.")
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > MAX_SELECTION_REQUEST_BYTES:
                raise StoreError(400, "Follow-up evidence exceeds the request size limit.")
            raw.extend(chunk)
        try:
            payload = json.loads(raw) if raw else {}
        except (ValueError, UnicodeDecodeError):
            raise StoreError(400, "Invalid JSON request.") from None
        try:
            parsed = (GenerateInput if initial else FollowupInput).model_validate(payload)
        except ValidationError as error:
            if any("image" in item["loc"] for item in error.errors()):
                raise StoreError(400, "Invalid selection image: use a single PNG, JPEG or WebP up to 2 MB and 16 million pixels.") from None
            raise StoreError(400, "Invalid follow-up content or selection evidence.") from None
        selection = None
        if parsed.selection is not None:
            if initial:
                raise StoreError(400, "Selection is only supported on follow-ups.")
            if (
                parsed.expectedVersionId != detail["project"]["currentVersionId"]
                or parsed.selection.versionId != parsed.expectedVersionId
            ):
                raise StoreError(409, "The current version changed. Select the target again.")
            editor = await run_in_threadpool(
                editor_artifact, project_id, request.state.owner_id, parsed.expectedVersionId
            )
            try:
                selection = bind_selection(parsed.selection, editor["manifest"])
            except LookupError:
                raise StoreError(400, "Selection contains an invalid source reference.") from None
            except ValueError:
                raise StoreError(409, "Selection does not match the current version.") from None
        run = await run_in_threadpool(
            store.create_run,
            project_id,
            request.state.owner_id,
            parsed.content,
            "initial" if initial else "followup",
            expected_version_id=parsed.expectedVersionId,
            selection=selection,
        )
        return JSONResponse({"run": run}, status_code=202)

    @app.post("/api/projects/{project_id}/generate")
    async def generate(request: Request, project_id: str):
        return await begin_run(request, project_id, True)

    @app.post("/api/projects/{project_id}/chat")
    async def chat(request: Request, project_id: str):
        return await begin_run(request, project_id, False)

    @app.get("/api/projects/{project_id}/runs/latest")
    def latest_run(request: Request, project_id: str):
        return {"run": store.get_run(project_id, request.state.owner_id)}

    @app.get("/api/projects/{project_id}/runs/{run_id}")
    def run_snapshot(request: Request, project_id: str, run_id: str):
        return {"run": store.get_run(project_id, request.state.owner_id, run_id)}

    @app.post("/api/projects/{project_id}/runs/{run_id}/cancel")
    def cancel_run(request: Request, project_id: str, run_id: str):
        store.cancel_run(project_id, request.state.owner_id, run_id)
        return {"ok": True}

    @app.post("/api/projects/{project_id}/runs/{run_id}/resume")
    def resume_run(request: Request, project_id: str, run_id: str):
        run = store.resume_run(project_id, request.state.owner_id, run_id)
        return JSONResponse({"run": run}, status_code=202)

    @app.get("/api/projects/{project_id}/runs/{run_id}/events")
    async def events(request: Request, project_id: str, run_id: str):
        owner = request.state.owner_id
        await run_in_threadpool(store.get_run, project_id, owner, run_id)
        requested = request.query_params.get("after", request.headers.get("last-event-id", "0"))
        normalized = requested.lstrip("0") or "0"
        if (
            not re.fullmatch(r"[0-9]+", requested)
            or len(normalized) > 16
            or int(normalized) > 9007199254740991
        ):
            raise StoreError(400, "Invalid event cursor.")
        cursor = int(normalized)

        def encode(event: dict) -> str:
            return f"id: {event['sequence']}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False, separators=(',', ':'))}\n\n"

        async def replay():
            nonlocal cursor
            idle = 0
            while not await request.is_disconnected():
                try:
                    batch = await run_in_threadpool(
                        store.list_run_events, project_id, owner, run_id, cursor
                    )
                    for event in batch:
                        yield encode(event)
                        cursor = event["sequence"]
                    if len(batch) == 100:
                        continue
                    current = await run_in_threadpool(store.get_run, project_id, owner, run_id)
                    if current["status"] in TERMINAL:
                        # A terminal snapshot can race the first page read; drain again after observing it.
                        remaining = await run_in_threadpool(
                            store.list_run_events, project_id, owner, run_id, cursor
                        )
                        for event in remaining:
                            yield encode(event)
                            cursor = event["sequence"]
                        if len(remaining) < 100:
                            latest = await run_in_threadpool(
                                store.get_run, project_id, owner, run_id
                            )
                            if (
                                latest["status"] in TERMINAL
                                and latest["attempt"] == current["attempt"]
                                and latest["cursor"] <= cursor
                            ):
                                return
                        continue
                except StoreError as error:
                    if error.status == 404:
                        return
                    raise
                idle += 1
                if idle % 15 == 0:
                    yield "event: heartbeat\ndata: {}\n\n"
                await asyncio.sleep(1)

        return StreamingResponse(
            replay(),
            media_type="text/event-stream",
            headers={"cache-control": "no-store", "x-accel-buffering": "no"},
        )

    @app.get("/p/{slug}")
    def published(slug: str):
        result = store.get_published(slug)
        if result is None:
            return HTMLResponse(
                '<!doctype html><html lang="en"><title>Not published · Atoms Demo</title><h1>This link is not published.</h1><p>Ask the owner to publish the project again.</p></html>',
                status_code=404,
            )
        return HTMLResponse(
            result["html"],
            headers={
                "cache-control": "no-cache",
                "x-atoms-demo": "published",
                "x-content-type-options": "nosniff",
            },
        )

    @app.exception_handler(404)
    async def not_found(_request: Request, _error):
        return JSONResponse({"error": "Not found."}, status_code=404)

    return app
