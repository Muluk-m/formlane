"""Owned API + real PostgreSQL + real compiler selection admission boundaries."""

import base64
import copy
import io
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from test_api import auth
from test_compiler import settings as compiler_settings
from test_storage import complete

from formlane.app import create_app
from formlane.compiler import compile_project
from formlane.project import legacy_source
from formlane.settings import Settings
from formlane.storage import LeaseLost


@pytest.fixture
def selection_api(pg_store, project, owner):
    source = legacy_source(
        "<!doctype html><html><body><h1>Hello</h1><button>Save</button></body></html>"
    )
    compiled = compile_project(source, compiler_settings(), lambda: False)
    baseline = complete(
        pg_store, project, owner, {"source": source, "html": compiled["html"], "summary": "Built"}
    )
    settings = Settings(
        database_url="postgresql://unused/unused",
        compiler_command=compiler_settings().compiler_command,
        allowed_origins="http://testserver",
        openai_api_key="private-provider-secret",
    )
    with TestClient(create_app(settings, pg_store), raise_server_exceptions=False) as client:
        route = f"/api/projects/{project['id']}"
        response = client.get(route + f"/versions/{baseline['id']}/editor", headers=auth(owner))
        assert response.status_code == 200, response.text
        editor = response.json()
        source_id = next(
            key
            for key, location in editor["manifest"]["entries"].items()
            if location["tagName"] == "h1"
        )
        element = {
            "nodeId": "node-1",
            "sourceId": source_id,
            "tagName": "h1",
            "role": None,
            "text": "Private transient heading",
            "attributes": {"aria-label": "Heading"},
            "styles": {"color": "rgb(0, 0, 0)"},
            "selector": "h1",
            "ancestors": [],
            "rects": [{"x": 10, "y": 20, "width": 200, "height": 40}],
            "viewport": {"width": 800, "height": 600},
            "scroll": {"x": 0, "y": 0},
            "instance": {"label": "Heading", "context": "Private scene"},
        }
        selection = {
            "versionId": baseline["id"],
            **{
                key: editor["manifest"][key]
                for key in (
                    "sourceHash",
                    "canonicalArtifactHash",
                    "editorArtifactHash",
                    "instrumentationVersion",
                )
            },
            "sessionId": "frame-session",
            "documentId": "document-1",
            "evidence": {"kind": "element", "element": element},
            "reproduction": {"steps": ["Open the dialog"]},
        }
        yield (
            client,
            route,
            editor,
            {
                "content": "Make only this heading smaller",
                "expectedVersionId": baseline["id"],
                "selection": selection,
            },
        )


def test_editor_and_selection_are_owner_private_and_resume_immutable(
    selection_api, pg_store, project, owner
):
    client, route, editor, payload = selection_api
    version_id = editor["versionId"]
    denied = client.get(route + f"/versions/{version_id}/editor", headers=auth(str(uuid4())))
    assert denied.status_code == 404
    assert "data-formlane-source" not in editor["html"]
    assert (
        client.get(route + f"/versions/{version_id}/editor", headers=auth(owner)).json() == editor
    )
    publication = client.post(route + "/publish", headers=auth(owner)).json()
    image = io.BytesIO()
    Image.new("RGB", (4, 3), "red").save(image, format="PNG")
    payload["selection"]["image"] = {
        "provenance": "client-captured",
        "mimeType": "image/png",
        "base64": base64.b64encode(image.getvalue()).decode(),
        "width": 4,
        "height": 3,
    }
    submitted = client.post(route + "/chat", json=payload, headers=auth(owner))
    assert submitted.status_code == 202, submitted.text
    receipt = submitted.json()["run"]
    assert "selection" not in receipt
    assert receipt["selectionSummary"]["hasImage"] is True
    run_route = route + f"/runs/{receipt['id']}"
    original = client.get(run_route, headers=auth(owner)).json()["run"]["selection"]
    assert original["evidence"] == payload["selection"]["evidence"]
    assert original["sourceResolutions"][0]["location"]["path"] == "index.html"
    assert original["image"]["base64"] == payload["selection"]["image"]["base64"]
    assert original["projectId"] == project["id"] and original["versionId"] == version_id
    assert client.get(run_route, headers=auth(str(uuid4()))).status_code == 404
    job = pg_store.claim_run("selection-worker")
    assert pg_store.harness_context(job["id"], job["lease_token"])["selection"] == original
    assert client.post(run_route + "/cancel", headers=auth(owner)).status_code == 200
    with pytest.raises(LeaseLost):
        pg_store.harness_context(job["id"], job["lease_token"])
    events = client.get(run_route + "/events", headers=auth(owner)).text
    for private in (
        "Private transient heading",
        "Private scene",
        original["image"]["base64"],
        owner,
        "private-provider-secret",
    ):
        assert private not in events
    messages = client.get(route, headers=auth(owner)).json()["messages"]
    message = next(row for row in messages if row["id"] == receipt["id"])
    assert message["content"] == payload["content"]
    assert message["selectionSummary"] == receipt["selectionSummary"]
    assert "Private scene" not in json.dumps(message)
    assert client.post(run_route + "/resume", headers=auth(owner)).status_code == 202
    resumed = pg_store.claim_run("selection-resumed")
    assert resumed["id"] == job["id"]
    assert pg_store.harness_context(resumed["id"], resumed["lease_token"])["selection"] == original
    assert client.get(run_route, headers=auth(owner)).json()["run"]["selection"] == original
    detail = client.get(route, headers=auth(owner)).json()
    assert (
        detail["project"]["currentVersionId"]
        == detail["project"]["publishedVersionId"]
        == version_id
    )
    assert client.get(f"/p/{publication['slug']}").text == editor["html"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("sourceHash", "0" * 64),
        ("canonicalArtifactHash", "0" * 64),
        ("editorArtifactHash", "0" * 64),
        ("instrumentationVersion", "forged"),
        ("versionId", str(uuid4())),
    ],
)
def test_selection_rejects_forged_baseline_identity(selection_api, owner, field, value):
    client, route, _, payload = selection_api
    before = client.get(route, headers=auth(owner)).json()
    payload["selection"][field] = value
    assert client.post(route + "/chat", json=payload, headers=auth(owner)).status_code == 409
    assert client.get(route, headers=auth(owner)).json() == before


@pytest.mark.parametrize(
    "mutation",
    [
        lambda p: p.pop("expectedVersionId"),
        lambda p: p["selection"]["evidence"]["element"].update(sourceId="forged"),
        lambda p: p["selection"]["evidence"]["element"].update(text="x" * 2001),
        lambda p: p["selection"]["evidence"]["element"].update(attributes={"value": "password"}),
        lambda p: p["selection"]["evidence"]["element"].update(
            styles={"background-image": "url(secret)"}
        ),
        lambda p: p["selection"].update(manifest={"entries": {}}),
        lambda p: p["selection"].update(
            image={
                "provenance": "server-reconstructed",
                "mimeType": "image/png",
                "base64": "eA==",
                "width": 1,
                "height": 1,
            }
        ),
        lambda p: p["selection"].update(
            image={
                "provenance": "client-captured",
                "mimeType": "image/png",
                "base64": "eA==",
                "width": 1,
                "height": 1,
            }
        ),
    ],
)
def test_invalid_selection_never_persists_message_or_run(selection_api, owner, mutation):
    client, route, _, payload = selection_api
    before = client.get(route, headers=auth(owner)).json()
    mutation(payload)
    assert client.post(route + "/chat", json=payload, headers=auth(owner)).status_code == 400
    assert client.get(route, headers=auth(owner)).json() == before


def test_unmapped_region_context_is_explicit_and_focus_is_not_a_second_target(selection_api, owner):
    client, route, _, payload = selection_api
    element = payload["selection"]["evidence"]["element"]
    element["sourceId"] = None
    payload["selection"]["evidence"] = {
        "kind": "region",
        "rectangle": {"x": 0, "y": 0, "width": 400, "height": 200},
        "elements": [element],
        "focus": copy.deepcopy(element),
        "viewport": element["viewport"],
        "scroll": element["scroll"],
        "truncated": False,
    }
    response = client.post(route + "/chat", json=payload, headers=auth(owner))
    assert response.status_code == 202, response.text
    run = client.get(route + f"/runs/{response.json()['run']['id']}", headers=auth(owner)).json()[
        "run"
    ]
    assert run["selection"]["sourceResolutions"] == [
        {"nodeId": "node-1", "status": "unmapped", "reason": "No compiler source attribution."}
    ]
    assert run["selectionSummary"]["memberCount"] == 1


def test_baseline_change_during_compile_is_rejected_atomically(
    selection_api, pg_store, project, owner, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    import formlane.app as api_module

    client, route, editor, payload = selection_api
    second = complete(
        pg_store,
        project,
        owner,
        {
            "source": legacy_source("<h1>Second accepted version</h1>"),
            "html": "<h1>Second accepted version</h1>",
            "summary": "Second",
        },
    )
    pg_store.restore_version(project["id"], owner, editor["versionId"])
    compiled, release = Event(), Event()
    real_compile = api_module.compile_editor_project

    def pause_after_compile(*args, **kwargs):
        value = real_compile(*args, **kwargs)
        compiled.set()
        assert release.wait(10)
        return value

    monkeypatch.setattr(api_module, "compile_editor_project", pause_after_compile)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, route + "/chat", json=payload, headers=auth(owner))
        try:
            assert compiled.wait(10)
            pg_store.restore_version(project["id"], owner, second["id"])
            before = pg_store.get_project(project["id"], owner)
        finally:
            release.set()
        assert pending.result().status_code == 409
    assert pg_store.get_project(project["id"], owner) == before


def test_concurrent_selection_submissions_admit_one_original(selection_api, owner):
    from concurrent.futures import ThreadPoolExecutor

    client, route, _, payload = selection_api
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda _: client.post(route + "/chat", json=payload, headers=auth(owner)), range(2)
            )
        )
    assert sorted(response.status_code for response in responses) == [202, 409]
    detail = client.get(route, headers=auth(owner)).json()
    assert (
        len([message for message in detail["messages"] if message["content"] == payload["content"]])
        == 1
    )


def test_history_candidates_and_foreign_versions_cannot_become_current(
    selection_api, pg_store, project, owner
):
    client, route, editor, payload = selection_api
    other = pg_store.create_project(owner, "Other project")
    other_version = complete(
        pg_store,
        other,
        owner,
        {
            "source": legacy_source("<h1>Other</h1>"),
            "html": "<h1>Other</h1>",
            "summary": "Other",
        },
    )
    assert (
        client.get(
            route + f"/versions/{other_version['id']}/editor", headers=auth(owner)
        ).status_code
        == 404
    )
    candidate = pg_store.create_run(project["id"], owner, "Unaccepted draft")
    job = pg_store.claim_run("candidate-worker")
    pg_store.put_checkpoint(
        job["id"],
        job["lease_token"],
        "flow-v1/candidate/1",
        {
            "source": legacy_source("<h1>Candidate</h1>"),
            "sourceHash": "0" * 64,
            "html": "<h1>Candidate</h1>",
            "artifactHash": "0" * 64,
        },
    )
    pg_store.cancel_run(project["id"], owner, candidate["id"])
    assert (
        client.get(route + f"/versions/{candidate['id']}/editor", headers=auth(owner)).status_code
        == 404
    )
    payload["expectedVersionId"] = payload["selection"]["versionId"] = candidate["id"]
    assert client.post(route + "/chat", json=payload, headers=auth(owner)).status_code == 409
    detail = client.get(route, headers=auth(owner)).json()
    assert detail["project"]["currentVersionId"] == editor["versionId"]
    assert detail["candidate"]["runId"] == candidate["id"]


@pytest.mark.parametrize("fault", ["mime", "dimensions", "pixels", "bytes", "animated"])
def test_images_validate_actual_bytes_and_pixels(selection_api, owner, fault):
    client, route, _, payload = selection_api
    output = io.BytesIO()
    width, height = (4001, 4000) if fault == "pixels" else (4, 3)
    image = Image.new("RGB", (width, height), "red")
    image.save(output, format="PNG")
    if fault == "animated":
        output = io.BytesIO()
        image.save(
            output,
            format="PNG",
            save_all=True,
            append_images=[Image.new("RGB", (4, 3), "blue")],
            duration=100,
            loop=0,
        )
    pixels = output.getvalue()
    if fault == "bytes":
        pixels += b"x" * 2_000_000
    payload["selection"]["image"] = {
        "provenance": "client-captured",
        "mimeType": "image/jpeg" if fault == "mime" else "image/png",
        "base64": base64.b64encode(pixels).decode(),
        "width": width + 1 if fault == "dimensions" else width,
        "height": height,
    }
    before = client.get(route, headers=auth(owner)).json()
    assert client.post(route + "/chat", json=payload, headers=auth(owner)).status_code == 400
    assert client.get(route, headers=auth(owner)).json() == before


def test_region_enforces_metadata_and_member_limits(selection_api, owner):
    client, route, _, payload = selection_api
    element = payload["selection"]["evidence"]["element"]
    region = {
        "kind": "region",
        "rectangle": {"x": 0, "y": 0, "width": 400, "height": 200},
        "elements": [{**element, "nodeId": f"member-{i}", "text": "x" * 2000} for i in range(32)],
        "focus": None,
        "viewport": element["viewport"],
        "scroll": element["scroll"],
        "truncated": True,
    }
    payload["selection"]["evidence"] = region
    assert client.post(route + "/chat", json=payload, headers=auth(owner)).status_code == 400
    region["elements"] = [{**element, "nodeId": f"member-{i}"} for i in range(33)]
    assert client.post(route + "/chat", json=payload, headers=auth(owner)).status_code == 400


@pytest.mark.parametrize("fault", [None, "outside", "viewport", "scroll", "contradiction"])
def test_region_focus_can_be_deduplicated_ancestor_but_not_unrelated_context(
    selection_api, owner, fault
):
    client, route, _, payload = selection_api
    element = payload["selection"]["evidence"]["element"]
    focus = copy.deepcopy(element)
    focus["nodeId"] = "focus-ancestor"
    if fault == "outside":
        focus["rects"] = [{"x": 900, "y": 900, "width": 10, "height": 10}]
    elif fault == "viewport":
        focus["viewport"]["width"] = 320
    elif fault == "scroll":
        focus["scroll"]["y"] = 200
    elif fault == "contradiction":
        focus["nodeId"] = element["nodeId"]
        focus["sourceId"] = None
    payload["selection"]["evidence"] = {
        "kind": "region",
        "rectangle": {"x": 0, "y": 0, "width": 400, "height": 200},
        "elements": [element],
        "focus": focus,
        "viewport": element["viewport"],
        "scroll": element["scroll"],
        "truncated": False,
    }
    response = client.post(route + "/chat", json=payload, headers=auth(owner))
    assert response.status_code == (400 if fault else 202), response.text
    if not fault:
        run = client.get(
            route + f"/runs/{response.json()['run']['id']}", headers=auth(owner)
        ).json()["run"]
        assert {row["nodeId"] for row in run["selection"]["sourceResolutions"]} == {
            element["nodeId"],
            focus["nodeId"],
        }
        assert run["selectionSummary"]["memberCount"] == 1


def test_original_selection_is_database_immutable_and_cancel_fences_late_completion(
    selection_api, pg_store, project, owner
):
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    client, route, editor, payload = selection_api
    publication = pg_store.publish_project(project["id"], owner)
    admitted = client.post(route + "/chat", json=payload, headers=auth(owner)).json()["run"]
    original = pg_store.get_run(project["id"], owner, admitted["id"])["selection"]
    job = pg_store.claim_run("cancel-selection")
    with pytest.raises(DBAPIError, match="Run selection is immutable"):
        with pg_store.engine.begin() as connection:
            connection.execute(
                text("UPDATE runs SET selection=NULL WHERE id=:id"), {"id": admitted["id"]}
            )
    pg_store.cancel_run(project["id"], owner, admitted["id"])
    saved = pg_store.get_version(project["id"], owner, editor["versionId"])["version"]
    assert not pg_store.complete_run(
        job["id"],
        job["lease_token"],
        {
            "source": saved["source"],
            "html": saved["html"],
            "summary": "Late result",
        },
    )
    assert pg_store.get_run(project["id"], owner, admitted["id"])["selection"] == original
    pg_store.resume_run(project["id"], owner, admitted["id"])
    resumed = pg_store.claim_run("failed-validation-selection")
    assert pg_store.finish_run(
        resumed["id"], resumed["lease_token"], "failed", "validation", "Validation failed"
    )
    assert pg_store.get_run(project["id"], owner, admitted["id"])["selection"] == original
    detail = pg_store.get_project(project["id"], owner)
    assert (
        detail["project"]["currentVersionId"]
        == detail["project"]["publishedVersionId"]
        == editor["versionId"]
    )
    assert pg_store.get_published(publication["slug"])["html"] == editor["html"]


def test_incompatible_editor_build_never_replaces_saved_canonical_artifact(
    selection_api, pg_store, project, owner
):
    client, route, _, _ = selection_api
    source = legacy_source("<h1>Original source</h1>")
    mismatched = complete(
        pg_store,
        project,
        owner,
        {
            "source": source,
            "html": "<h1>Different saved artifact</h1>",
            "summary": "Legacy version",
        },
    )
    before = pg_store.get_project(project["id"], owner)
    assert (
        client.get(route + f"/versions/{mismatched['id']}/editor", headers=auth(owner)).status_code
        == 409
    )
    assert pg_store.get_project(project["id"], owner) == before


def test_historical_editor_is_read_only_and_requires_explicit_restore(
    selection_api, pg_store, project, owner
):
    client, route, editor, payload = selection_api
    later = complete(
        pg_store,
        project,
        owner,
        {
            "source": legacy_source("<h1>Later</h1>"),
            "html": "<h1>Later</h1>",
            "summary": "Later",
        },
    )
    before = pg_store.get_project(project["id"], owner)
    viewed = client.get(route + f"/versions/{editor['versionId']}/editor", headers=auth(owner))
    assert viewed.status_code == 200 and viewed.json() == editor
    assert client.post(route + "/chat", json=payload, headers=auth(owner)).status_code == 409
    assert pg_store.get_project(project["id"], owner) == before
    assert before["project"]["currentVersionId"] == later["id"]
    client.post(route + "/restore", json={"versionId": editor["versionId"]}, headers=auth(owner))
    assert client.post(route + "/chat", json=payload, headers=auth(owner)).status_code == 202
