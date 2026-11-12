"""Shared PostgreSQL fixtures for backend behavior tests."""

from uuid import uuid4

import pytest
from test_storage import postgres_store

from formlane.project import create_source


@pytest.fixture
def pg_store():
    with postgres_store() as store:
        yield store


@pytest.fixture
def owner():
    return str(uuid4())


@pytest.fixture
def project(pg_store, owner):
    return pg_store.create_project(owner, "Build a planner")


@pytest.fixture
def result():
    return {
        "source": create_source("vanilla"),
        "html": "<!doctype html><html><body>Saved</body></html>",
        "summary": "Saved the validated app.",
    }
