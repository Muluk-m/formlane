import io
import json
from uuid import uuid4
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_storage import complete

from formlane.app import create_app
from formlane.settings import Settings


@pytest.fixture
def client(pg_store):
    settings = Settings(
        database_url="postgresql://unused/unused",
        allowed_origins="https://pages.example,http://testserver",
        public_origin="https://api.example",
        openai_api_key="test-key",
    )
    with TestClient(create_app(settings, pg_store), raise_server_exceptions=False) as client:
        yield client


def auth(owner):
    return {"x-owner-id": owner}


def test_owner_header_survives_cross_origin_transition_and_cookie_clients(client, owner):
    old_cookie = str(uuid4())
    client.cookies.set("atoms_uid", old_cookie)
    response = client.get("/api/me", headers={**auth(owner), "origin": "https://pages.example"})
    assert response.json() == {"ownerId": owner}
    assert response.headers["access-control-allow-origin"] == "https://pages.example"
    assert response.headers["cache-control"] == "no-store"
    assert "HttpOnly" in response.headers["set-cookie"]
    client.cookies.clear()
    client.cookies.set("atoms_uid", old_cookie)
    assert client.get("/api/me").json() == {"ownerId": old_cookie}
    preflight = client.options(
        "/api/projects/x/runs/y/events",
        headers={
            "origin": "https://pages.example",
            "access-control-request-method": "GET",
            "access-control-request-headers": "x-owner-id,last-event-id",
        },
    )
    assert preflight.status_code == 200
    assert "last-event-id" in preflight.headers["access-control-allow-headers"].lower()
    denied = client.post(
        "/api/projects", json={"idea": "Steal"}, headers={"origin": "https://untrusted.example"}
    )
    assert denied.status_code == 403


def test_api_crud_ownership_health_and_body_errors(client, pg_store, owner):
    assert client.get("/healthz").json() == {"ok": True}
    health = client.get("/api/health").json()
    assert "test-key" not in json.dumps(health)
    created = client.post(
        "/api/projects", json={"idea": "  Build a planner  "}, headers=auth(owner)
    )
    assert created.status_code == 200
    project = created.json()["project"]
    assert project["title"] == "Planner" and project["idea"] == "Build a planner"
    route = f"/api/projects/{project['id']}"
    listed = client.get("/api/projects", headers=auth(owner)).json()["projects"]
    assert listed[0]["versionCount"] == 0
    detail = client.get(route, headers=auth(owner)).json()
    assert detail["html"] is None and detail["source"] is None and detail["versions"] == []
    assert detail["messages"][0]["content"] == "Build a planner"
    stranger = client.get(route, headers=auth(str(uuid4())))
    assert stranger.status_code == 404 and stranger.json()["code"] == "NOT_FOUND"
    assert client.get(route + "/runs/latest", headers=auth(owner)).json() == {"run": None}
    assert client.post("/api/projects", json={"idea": " "}, headers=auth(owner)).status_code == 400
    assert client.post(route + "/generate", content="{", headers=auth(owner)).json() == {
        "error": "Invalid JSON request."
    }
    for payload in ({"content": None}, {"content": ""}, {"content": 12}, {"content": "x" * 4001}):
        assert (
            client.post(route + "/generate", json=payload, headers=auth(owner)).status_code == 400
        )
    assert client.post(route + "/chat", json={}, headers=auth(owner)).status_code == 400
    assert client.post(route + "/publish", headers=auth(owner)).status_code == 400
    assert client.get(route + "/download", headers=auth(owner)).status_code == 400
    assert client.delete(route, headers=auth(owner)).json() == {"ok": True}
    assert client.get(route, headers=auth(owner)).status_code == 404


def test_generations_cancel_and_replay_terminal_events(client, pg_store, project, owner):
    route = f"/api/projects/{project['id']}"
    response = client.post(route + "/generate", headers=auth(owner))
    assert response.status_code == 202
    run = response.json()["run"]
    assert run["status"] == "queued"
    assert client.post(route + "/generate", headers=auth(owner)).status_code == 409
    leased = pg_store.claim_run("test-api")
    for index in range(105):
        pg_store.append_event(
            run["id"], leased["lease_token"], f"token:{index}", "token", {"text": str(index)}
        )
    cancelled = client.post(route + f"/runs/{run['id']}/cancel", headers=auth(owner))
    assert cancelled.json() == {"ok": True}
    snapshot = client.get(route + f"/runs/{run['id']}", headers=auth(owner)).json()["run"]
    assert snapshot["status"] == "cancelled" and "lease_token" not in snapshot
    assert client.get(route + "/runs/latest", headers=auth(owner)).json()["run"] == snapshot
    response = client.get(
        route + f"/runs/{run['id']}/events", headers={**auth(owner), "last-event-id": "2"}
    )
    assert response.status_code == 200 and "text/event-stream" in response.headers["content-type"]
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    assert len(events) == 106
    assert events[0]["sequence"] == 3 and events[-1]["data"]["status"] == "cancelled"
    assert [event["sequence"] for event in events] == sorted(
        {event["sequence"] for event in events}
    )
    again = client.get(
        route + f"/runs/{run['id']}/events?after={events[-1]['sequence']}", headers=auth(owner)
    )
    assert again.text == ""
    for cursor in ("-1", "1.2", "x", "9007199254740992"):
        assert (
            client.get(
                route + f"/runs/{run['id']}/events?after={cursor}", headers=auth(owner)
            ).status_code
            == 400
        )
    assert (
        client.get(route + f"/runs/{run['id']}/events", headers=auth(str(uuid4()))).status_code
        == 404
    )
    assert client.post(route + "/cancel", headers=auth(owner)).json() == {"ok": True}


def test_version_restore_remix_download_and_publication(client, pg_store, project, owner, result):
    first = complete(pg_store, project, owner, result)
    route = f"/api/projects/{project['id']}"
    published = client.post(
        route + "/publish",
        headers={
            **auth(owner),
            "x-forwarded-host": "attacker.example",
            "x-forwarded-proto": "http",
        },
    ).json()
    assert published["url"].startswith("https://api.example/p/")
    second = complete(pg_store, project, owner, {**result, "html": "<html>New</html>"}, "Followup")
    assert client.post(route + "/generate", headers=auth(owner)).status_code == 400
    saved = client.get(route + f"/versions/{second['id']}", headers=auth(owner)).json()["version"]
    assert saved["parentVersionId"] == first["id"]
    archive = client.get(route + f"/download?version={first['id']}", headers=auth(owner))
    with ZipFile(io.BytesIO(archive.content)) as zip_file:
        files = {name: zip_file.read(name).decode() for name in zip_file.namelist()}
    assert files == result["source"]["files"]
    assert "planner-v1.zip" in archive.headers["content-disposition"]
    public = client.get(f"/p/{published['slug']}")
    assert public.text == result["html"] and "set-cookie" not in public.headers
    restored = client.post(
        route + "/restore", json={"versionId": first["id"]}, headers=auth(owner)
    ).json()
    assert restored["number"] == 1 and restored["project"]["publishedVersionId"] == first["id"]
    remix = client.post(
        route + "/remix", json={"versionId": second["id"]}, headers=auth(owner)
    ).json()["project"]
    assert remix["id"] != project["id"] and remix["publishedSlug"] is None
    assert (
        client.get(
            f"/api/projects/{remix['id']}/versions/{second['id']}", headers=auth(owner)
        ).status_code
        == 404
    )
    assert client.post(route + "/unpublish", headers=auth(owner)).json() == {"ok": True}
    assert client.get(f"/p/{published['slug']}").status_code == 404


def test_unexpected_database_errors_do_not_expose_details(client, pg_store, owner):
    with pg_store.engine.begin() as connection:
        connection.execute(
            text("""CREATE FUNCTION reject_project() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'private database password'; END; $$""")
        )
        connection.execute(
            text(
                "CREATE TRIGGER reject_project BEFORE INSERT ON projects FOR EACH ROW EXECUTE FUNCTION reject_project()"
            )
        )
    response = client.post(
        "/api/projects",
        json={"idea": "Build"},
        headers={**auth(owner), "origin": "https://pages.example"},
    )
    assert response.status_code == 500
    assert response.json()["message"] == "Something went wrong."
    assert "private database password" not in response.text
    assert response.headers["access-control-allow-origin"] == "https://pages.example"


def test_readiness_detects_missing_migration_without_schema_creation(pg_store):
    with pg_store.engine.begin() as connection:
        connection.execute(text("DELETE FROM alembic_version"))
    settings = Settings(database_url="postgresql://unused/unused")
    with TestClient(create_app(settings, pg_store)) as client:
        assert client.get("/healthz").status_code == 503
        assert client.get("/healthz").json() == {"ok": False}


def test_resume_receipt_preserves_run_and_messages_and_replays_both_attempts(
    client, pg_store, project, owner
):
    route = f"/api/projects/{project['id']}"
    initial = client.post(route + "/generate", headers=auth(owner)).json()["run"]
    run_route = route + f"/runs/{initial['id']}"
    pg_store.claim_run("api-attempt-one")
    client.post(run_route + "/cancel", headers=auth(owner))
    before = client.get(route, headers=auth(owner)).json()
    failed = client.get(run_route, headers=auth(owner)).json()["run"]
    assert failed["attempt"] == 1 and failed["resumable"]
    response = client.post(run_route + "/resume", headers=auth(owner))
    assert response.status_code == 202
    resumed = response.json()["run"]
    assert resumed["id"] == initial["id"]
    assert resumed["attempt"] == 2 and resumed["status"] == "queued"
    assert resumed["cursor"] > failed["cursor"]
    assert not resumed["resumable"]
    assert "lease_token" not in resumed and "deadline_at" not in resumed
    assert client.get(route, headers=auth(owner)).json()["messages"] == before["messages"]
    assert client.post(run_route + "/resume", headers=auth(owner)).json() == {"run": resumed}
    assert client.get(route + "/runs/latest", headers=auth(owner)).json() == {"run": resumed}
    pg_store.claim_run("api-attempt-two")
    client.post(run_route + "/cancel", headers=auth(owner))
    replay = client.get(run_route + "/events", headers=auth(owner))
    events = [
        json.loads(line[6:]) for line in replay.text.splitlines() if line.startswith("data: ")
    ]
    terminal = [event for event in events if event["data"].get("status") == "cancelled"]
    assert [event["attempt"] for event in terminal] == [1, 2]
    assert [event["data"]["attempt"] for event in terminal] == [1, 2]
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))


def test_resume_authorization_superseded_and_completed_conflicts(
    client, pg_store, project, owner, result
):
    root = complete(pg_store, project, owner, result)
    route = f"/api/projects/{project['id']}"
    run = pg_store.create_run(project["id"], owner, "Modify the app")
    pg_store.cancel_run(project["id"], owner, run["id"])
    resume = route + f"/runs/{run['id']}/resume"
    assert client.post(resume, headers=auth(str(uuid4()))).status_code == 404
    other = pg_store.create_project(owner, "Other project")
    assert (
        client.post(
            f"/api/projects/{other['id']}/runs/{run['id']}/resume", headers=auth(owner)
        ).status_code
        == 404
    )
    assert client.post(route + f"/runs/{uuid4()}/resume", headers=auth(owner)).status_code == 404
    newer = pg_store.create_run(project["id"], owner, "New instruction")
    assert client.post(resume, headers=auth(owner)).status_code == 409
    pg_store.cancel_run(project["id"], owner, newer["id"])
    assert client.post(resume, headers=auth(owner)).status_code == 409
    assert client.post(route + f"/runs/{root['id']}/resume", headers=auth(owner)).status_code == 409
    assert (
        client.get(route, headers=auth(owner)).json()["project"]["currentVersionId"] == root["id"]
    )


def test_event_stream_does_not_stop_on_terminal_snapshot_from_prior_attempt(
    client, pg_store, project, owner, monkeypatch
):
    run = pg_store.create_run(project["id"], owner)
    pg_store.cancel_run(project["id"], owner, run["id"])
    original = pg_store.list_run_events
    reads = 0

    def resume_between_terminal_snapshot_and_drain(*args):
        nonlocal reads
        reads += 1
        rows = original(*args)
        if reads == 2:
            pg_store.resume_run(project["id"], owner, run["id"])
            pg_store.cancel_run(project["id"], owner, run["id"])
        return rows

    monkeypatch.setattr(pg_store, "list_run_events", resume_between_terminal_snapshot_and_drain)
    response = client.get(
        f"/api/projects/{project['id']}/runs/{run['id']}/events", headers=auth(owner)
    )
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    assert events[-1]["attempt"] == 2
    assert events[-1]["data"]["status"] == "cancelled"
    assert [event["attempt"] for event in events] == [1, 1, 2, 2]
