"""Cross-runtime fixtures are extracted from the checked TypeScript templates."""

import json

import pytest

from formlane.project import (
    MAX_FILE_CHARACTERS,
    MAX_PROJECT_FILES,
    MAX_SOURCE_BYTES,
    artifact_hash,
    create_source,
    is_project_path,
    legacy_source,
    project_package_json,
    source_hash,
    validate_source,
)


@pytest.mark.parametrize(
    "template,expected",
    [
        ("vanilla", "9c9e76bcb6c6c6a9009a08ebb9a4aba5cda7668e0c4081b9eef3dd4206f9cd03"),
        ("react-ts", "ae642f10ed26a150ace5a1080746b38292d2651c21dce4d1d11e43a52e6ca4e8"),
    ],
)
def test_template_hashes_match_typescript(template, expected):
    source = create_source(template)
    assert source_hash(source) == expected
    reordered = {"files": dict(reversed(list(source["files"].items()))), "template": template}
    assert source_hash(reordered) == expected
    source["files"]["src/main.js"] = "// Changed"
    assert source_hash(source) != expected
    assert source_hash(create_source(template)) == expected


@pytest.mark.parametrize(
    "path",
    [
        "../secret.ts",
        "/etc/passwd.txt",
        "src/../../secret.ts",
        "src\\outside.ts",
        ".env",
        "src/__proto__/a.js",
        "src/constructor/a.js",
        "src/prototype/a.js",
        "src//a.js",
        "src/a.js?raw",
        "src/a%2f.js",
        "src/中文.ts",
        "src/a.js\n",
        "a" * 178 + ".js",
    ],
)
def test_rejects_unsafe_paths(path):
    source = create_source("vanilla")
    source["files"][path] = "private"
    assert not is_project_path(path)
    with pytest.raises(ValueError, match="Unsupported project path"):
        validate_source(source)


@pytest.mark.parametrize(
    "files,message",
    [
        ({"src/MAIN.js": ""}, "differ only by case"),
        ({"asset.svg": "<svg/>", "asset.svg/child.svg": "<svg/>"}, "both a file and a directory"),
        ({"src/main.js": "中" * 90000}, "256 KiB"),
        ({"src/main.js": "😀" * (MAX_FILE_CHARACTERS // 2 + 1)}, "File is too large"),
        ({"index.html": "\ufeff\u00a0 "}, "index.html is required"),
        ({"src/main.js": None}, "must be a string"),
    ],
)
def test_source_boundaries(files, message):
    source = create_source("vanilla")
    source["files"].update(files)
    with pytest.raises(ValueError, match=message):
        validate_source(source)


def test_source_byte_budget_is_inclusive():
    source = legacy_source("<!doctype html><html></html>")
    used = sum(len(value.encode()) for value in source["files"].values())
    source["files"]["a.txt"] = "a" * MAX_FILE_CHARACTERS
    source["files"]["b.txt"] = "b" * (MAX_SOURCE_BYTES - used - MAX_FILE_CHARACTERS)
    validate_source(source)
    source["files"]["b.txt"] += "x"
    with pytest.raises(ValueError, match="256 KiB"):
        validate_source(source)


def test_file_inventory_is_bounded():
    source = legacy_source("<!doctype html><html></html>")
    for index in range(MAX_PROJECT_FILES - 2):
        source["files"][f"file{index}.txt"] = ""
    validate_source(source)
    source["files"]["overflow.txt"] = ""
    with pytest.raises(ValueError, match="1–64"):
        validate_source(source)


@pytest.mark.parametrize(
    "change",
    [
        lambda manifest: manifest["scripts"].update({"postinstall": "node payload.js"}),
        lambda manifest: manifest.update({"dependencies": {"evil": "latest"}}),
        lambda manifest: manifest.update({"private": 1}),
    ],
)
def test_template_owns_manifest(change):
    source = create_source("vanilla")
    manifest = json.loads(source["files"]["package.json"])
    change(manifest)
    source["files"]["package.json"] = json.dumps(manifest)
    with pytest.raises(ValueError, match="owned by the selected template"):
        validate_source(source)


def test_manifest_accepts_whitespace_and_reordered_keys():
    source = create_source("react-ts")
    manifest = json.loads(source["files"]["package.json"])
    source["files"]["package.json"] = json.dumps(manifest, sort_keys=True)
    validate_source(source)


def test_legacy_html_is_preserved_byte_for_byte():
    html = '<!doctype html>\n<html>\r\n<script>window.x = "中😀"</script></html>'
    source = legacy_source(html)
    assert source["files"]["index.html"] == html
    assert source["files"]["package.json"] == project_package_json("vanilla")
    validate_source(source)
    assert artifact_hash(html) != artifact_hash(html + "\n")
    assert artifact_hash("\ud800") == artifact_hash("\ufffd")


def test_english_path_collation_and_unicode_match_typescript():
    source = create_source("vanilla")
    for path in (
        "src/a_b.ts",
        "src/a-b.ts",
        "src/a.b.ts",
        "src/a/b.ts",
        "src/A10.ts",
        "src/a2.ts",
        "src/Z.ts",
        "src/z1.ts",
        "_private.txt",
        "-note.txt",
    ):
        source["files"][path] = "中😀\u2028\ud800\n"
    assert source_hash(source) == "4a73e4b2738ebfb97da2dcd9aa981de3564e0a533a3d95defa0c5662b4932fab"
