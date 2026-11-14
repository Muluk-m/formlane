"""Public workspace browser acceptance; run against an owned, seeded test Project.

The integration runner supplies FORMLANE_SELECTION_PROJECT_URL and
FORMLANE_SELECTION_OWNER. Seed an accepted vanilla Version from
fixtures/selection-scene.html, with one accepted generation parent for history.
No provider substitute or screenshot file is used by these browser checks.
"""

import json
import os

import pytest
from formlane.compiler import safe_environment
from playwright.sync_api import expect, sync_playwright


@pytest.fixture
def workspace():
    url = os.environ.get("FORMLANE_SELECTION_PROJECT_URL")
    owner = os.environ.get("FORMLANE_SELECTION_OWNER")
    if not url or not owner:
        if os.environ.get("CI"):
            pytest.fail("CI must provision FORMLANE_SELECTION_PROJECT_URL and FORMLANE_SELECTION_OWNER")
        pytest.skip("Requires an owned seeded workspace on the isolated acceptance release")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get("BROWSER_EXECUTABLE_PATH"),
            chromium_sandbox=True,
            env=safe_environment(),
            headless=not bool(os.environ.get("FORMLANE_SELECTION_NATIVE_CAPTURE")),
            args=json.loads(os.environ.get("FORMLANE_SELECTION_CAPTURE_BROWSER_ARGS", "[]")),
        )
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.add_init_script(
            "if (!localStorage.getItem('atoms-demo.locale')) localStorage.setItem('atoms-demo.locale', 'en');"
            f"localStorage.setItem('atoms_uid', {json.dumps(owner)});"
        )
        page.goto(url)
        expect(page.get_by_test_id("selection-edit")).to_be_enabled()
        yield page
        browser.close()


def test_edit_keeps_live_scene_and_attachment_replacement_keeps_comment(workspace):
    page = workspace
    frame = page.frame_locator('[data-testid="preview-frame"] iframe')
    frame.locator("#scene-input").fill("Unsaved scene")
    count = frame.locator("#scene-count").inner_text()
    page.get_by_test_id("selection-edit").click()
    frame.locator("#scene-action span").click()
    expect(frame.locator("#scene-input")).to_have_value("Unsaved scene")
    expect(frame.locator("#scene-count")).to_have_text(count)
    expect(page.get_by_test_id("selection-attachment")).to_contain_text("span")
    composer = page.get_by_test_id("followup-input")
    composer.fill("Make only this action easier to find")
    page.get_by_test_id("selection-parent").click()
    expect(page.get_by_test_id("selection-attachment")).to_contain_text("button")
    expect(composer).to_have_value("Make only this action easier to find")
    page.get_by_test_id("selection-remove").click()
    expect(page.get_by_test_id("selection-attachment")).to_have_count(0)
    expect(composer).to_have_value("Make only this action easier to find")
    page.get_by_test_id("selection-edit").click()
    frame.locator("#scene-action").click()
    expect(frame.locator("#scene-count")).not_to_have_text(count)
    expect(frame.locator("#scene-input")).to_have_value("Unsaved scene")


def test_layers_choose_the_same_instance_and_keep_hidden_rows_explicit(workspace):
    page = workspace
    page.get_by_test_id("selection-edit").click()
    page.get_by_role("button", name="Layers", exact=True).click()
    page.get_by_role("button", name="Expand Selection scene", exact=True).click()
    page.get_by_role("button", name="Expand Cards", exact=True).click()
    second = page.get_by_role("treeitem", name="Second card", exact=True)
    second.click()
    expect(second).to_have_attribute("aria-selected", "true")
    expect(page.get_by_test_id("selection-attachment")).to_contain_text("Second card")
    expect(page.get_by_role("treeitem", name="Hidden target", exact=True)).to_have_count(0)
    page.get_by_role("button", name="Show hidden elements", exact=True).click()
    page.get_by_role("button", name="Expand Selection scene", exact=True).click()
    expect(page.get_by_role("treeitem", name="Offscreen target", exact=True)).to_be_attached()
    expect(page.get_by_role("treeitem", name="Hidden target")).to_be_attached()
    page.get_by_role("treeitem", name="Selection scene", exact=True).focus()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    expect(page.get_by_test_id("selection-attachment")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.get_by_test_id("selection-attachment")).to_have_count(0)


def test_region_is_visible_and_focus_is_optional(workspace):
    page = workspace
    page.get_by_test_id("selection-edit").click()
    page.get_by_test_id("selection-region").click()
    surface = page.get_by_test_id("selection-region-surface")
    surface.press("Shift+ArrowRight")
    surface.press("ArrowDown")
    surface.press("Enter")
    expect(page.get_by_test_id("selection-rectangle")).to_be_visible()
    expect(page.get_by_test_id("selection-attachment")).to_contain_text("Region")
    expect(page.get_by_role("button", name="No focus element", exact=True)).to_be_visible()
    page.get_by_test_id("followup-input").fill("Reduce spacing in this area")
    page.get_by_test_id("selection-remove").click()
    expect(page.get_by_test_id("followup-input")).to_have_value("Reduce spacing in this area")


def test_version_conflict_keeps_draft_and_normalizes_app_owned_markers(workspace):
    page = workspace
    requests = []

    def conflict(route):
        requests.append(route.request.post_data_json)
        route.fulfill(status=409, content_type="application/json", body='{"error":"baseline changed"}')

    page.route("**/api/projects/*/chat", conflict)
    page.get_by_test_id("selection-edit").click()
    page.frame_locator('[data-testid="preview-frame"] iframe').locator("#dynamic-target").click()
    page.get_by_test_id("followup-input").fill("Change only this runtime action")
    page.get_by_test_id("send-button").click()
    expect(page.get_by_test_id("followup-input")).to_have_value("Change only this runtime action")
    expect(page.get_by_test_id("selection-attachment")).to_be_visible()
    expect(page.get_by_test_id("send-button")).to_be_disabled()
    assert len(requests) == 1
    sent = requests[0]
    assert sent["expectedVersionId"] == sent["selection"]["versionId"]
    assert sent["selection"]["documentId"] != sent["selection"]["sessionId"]
    element = sent["selection"]["evidence"]["element"]
    assert element["sourceId"] is None
    assert all(ancestor["sourceId"] != "app-owned-marker" for ancestor in element["ancestors"])


def test_uncertain_delivery_requires_observation_before_another_send(workspace):
    page = workspace
    requests = []

    def lose_receipt(route):
        requests.append(route.request.post_data_json)
        route.abort("connectionreset")

    page.route("**/api/projects/*/chat", lose_receipt)
    page.get_by_test_id("followup-input").fill("Keep this draft until delivery is known")
    page.get_by_test_id("send-button").click()
    expect(page.get_by_test_id("followup-input")).to_have_value("Keep this draft until delivery is known")
    expect(page.get_by_role("button", name="Check delivery", exact=True)).to_be_visible()
    expect(page.get_by_test_id("send-button")).to_be_disabled()
    page.get_by_role("button", name="Check delivery", exact=True).click()
    expect(page.get_by_test_id("send-button")).to_be_enabled()
    assert len(requests) == 1


def test_user_screenshot_attachment_is_visible_and_removable(workspace):
    page = workspace
    frame = page.frame_locator('[data-testid="preview-frame"] iframe')
    # Screenshot bytes live only in memory and are never written into the checkout.
    image = frame.locator("#scene-action").screenshot()
    page.get_by_test_id("selection-edit").click()
    frame.locator("#scene-action").click()
    page.get_by_test_id("selection-upload").set_input_files({"name": "scene.png", "mimeType": "image/png", "buffer": image})
    expect(page.get_by_role("img", name="Attached screenshot", exact=True)).to_be_visible()
    page.get_by_test_id("followup-input").fill("Use these original pixels as context")
    page.get_by_role("button", name="Remove image", exact=True).click()
    expect(page.get_by_role("img", name="Attached screenshot", exact=True)).to_have_count(0)
    expect(page.get_by_test_id("followup-input")).to_have_value("Use these original pixels as context")


def test_reload_invalidates_attachment_without_erasing_comment(workspace):
    page = workspace
    page.get_by_test_id("selection-edit").click()
    page.frame_locator('[data-testid="preview-frame"] iframe').locator("#scene-action span").click()
    page.get_by_test_id("followup-input").fill("Preserve this comment through a reload")
    page.get_by_role("button", name="Reload preview", exact=True).click()
    expect(page.get_by_test_id("selection-edit")).to_be_enabled()
    expect(page.get_by_test_id("followup-input")).to_have_value("Preserve this comment through a reload")
    expect(page.get_by_test_id("selection-attachment")).to_contain_text("no longer current")
    expect(page.get_by_test_id("send-button")).to_be_disabled()


def test_history_is_read_only_and_does_not_implicitly_restore(workspace):
    page = workspace
    restores = []
    page.on("request", lambda request: restores.append(request.url) if request.method == "POST" and "/restore" in request.url else None)
    page.get_by_test_id("followup-input").fill("Keep while inspecting history")
    page.get_by_test_id("history-button").click()
    page.get_by_test_id("preview-1").click()
    page.get_by_role("button", name="Back to conversation", exact=True).click()
    expect(page.get_by_test_id("followup-input")).to_have_value("Keep while inspecting history")
    expect(page.get_by_test_id("send-button")).to_be_disabled()
    page.get_by_test_id("back-current").click()
    expect(page.get_by_test_id("send-button")).to_be_enabled()
    assert restores == []


def test_mobile_preview_and_chinese_selection_labels(workspace):
    page = workspace
    page.get_by_test_id("device-mobile").click()
    page.get_by_test_id("selection-edit").click()
    page.frame_locator('[data-testid="preview-frame"] iframe').locator("#scene-action span").click()
    expect(page.get_by_test_id("selection-attachment")).to_be_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    page.get_by_test_id("workspace-preview").click()
    expect(page.get_by_test_id("selection-edit")).to_be_visible()
    page.get_by_test_id("workspace-chat").click()
    expect(page.get_by_test_id("selection-attachment")).to_be_visible()
    # Read the same real workspace in the other shipped catalog.
    page.add_init_script("localStorage.setItem('atoms-demo.locale', 'zh')")
    page.reload()
    page.get_by_test_id("workspace-preview").click()
    expect(page.get_by_test_id("selection-edit")).to_have_text("编辑")
    page.get_by_test_id("selection-edit").click()
    expect(page.get_by_role("button", name="图层", exact=True)).to_be_visible()


def test_open_modal_and_entered_values_survive_edit(workspace):
    page = workspace
    frame = page.frame_locator('[data-testid="preview-frame"] iframe')
    frame.locator("#open-modal").click()
    frame.locator("#dialog-input").fill("Unsaved dialog state")
    page.get_by_test_id("selection-edit").click()
    frame.locator("#close-modal").click()
    expect(frame.locator("dialog")).to_be_visible()
    expect(frame.locator("#dialog-input")).to_have_value("Unsaved dialog state")
    expect(page.get_by_test_id("selection-attachment")).to_contain_text("Close modal")
    page.get_by_test_id("selection-edit").click()
    frame.locator("#close-modal").click()
    expect(frame.locator("dialog")).not_to_be_visible()


@pytest.mark.skipif(os.environ.get("FORMLANE_SELECTION_REAL_PROVIDER") != "1", reason="Explicit isolated real-provider acceptance only")
def test_selection_followup_acceptance_and_ancestry_undo(workspace):
    page = workspace
    frame = page.frame_locator('[data-testid="preview-frame"] iframe')
    page.get_by_test_id("selection-edit").click()
    frame.locator("#scene-action span").click()
    page.get_by_test_id("followup-input").fill("Change only this selected Save scene label to Save draft. Preserve its behavior, all other text, controls and layout.")
    page.get_by_test_id("send-button").click()
    expect(page.get_by_test_id("message-selection-summary").last).to_contain_text("Selected span")
    expect(page.get_by_test_id("followup-input")).to_have_value("")
    # This is an observation bound, never a product run deadline or cancellation.
    expect(frame.locator("#scene-action")).to_have_text("Save draft", timeout=1_200_000)
    expect(frame.locator(".selection-card").nth(1)).to_have_text("Second card")
    before = frame.locator("#scene-count").inner_text()
    frame.locator("#scene-action").click()
    expect(frame.locator("#scene-count")).not_to_have_text(before)
    page.get_by_test_id("undo-version").click()
    expect(frame.locator("#scene-action")).to_have_text("Save scene")
    expect(frame.locator(".selection-card").nth(1)).to_have_text("Second card")


def test_native_capture_policy_refusal_keeps_selection_and_text(workspace):
    page = workspace
    url = page.url

    def disallow_capture(route):
        response = route.fetch()
        route.fulfill(response=response, headers={**response.headers, "permissions-policy": "display-capture=()"})

    page.route(url, disallow_capture)
    page.reload()
    page.get_by_test_id("selection-edit").click()
    page.frame_locator('[data-testid="preview-frame"] iframe').locator("#scene-action span").click()
    page.get_by_test_id("followup-input").fill("Keep this selection if capture is refused")
    page.get_by_test_id("selection-capture").click()
    expect(page.get_by_text("A verified crop is unavailable or capture was refused.", exact=False)).to_be_visible()
    expect(page.get_by_test_id("selection-attachment")).to_contain_text("span")
    expect(page.get_by_test_id("followup-input")).to_have_value("Keep this selection if capture is refused")
    expect(page.get_by_role("img", name="Attached screenshot", exact=True)).to_have_count(0)


@pytest.mark.skipif(not os.environ.get("FORMLANE_SELECTION_NATIVE_CAPTURE"), reason="Requires native browser chooser on a headed acceptance display")
def test_native_capture_verifies_surface_and_uploads_only_selected_pixels(workspace):
    import base64
    import io

    from PIL import Image, ImageChops, ImageStat

    page = workspace
    frame = page.frame_locator('[data-testid="preview-frame"] iframe')
    expected = Image.open(io.BytesIO(frame.locator("#scene-action").screenshot())).convert("RGB")
    page.get_by_test_id("selection-edit").click()
    frame.locator("#scene-action").click(position={"x": 5, "y": 5})
    page.get_by_test_id("followup-input").fill("Keep my live scene")
    page.get_by_test_id("selection-capture").click()
    # The native chooser is operated by the acceptance runner (or Chrome's actual
    # tab-selection policy flags), never by a synthetic MediaStream.
    if os.environ["FORMLANE_SELECTION_NATIVE_CAPTURE"] == "wrong-surface":
        expect(page.get_by_text("A verified crop is unavailable or capture was refused.", exact=False)).to_be_visible(timeout=60_000)
        expect(page.get_by_role("img", name="Attached screenshot", exact=True)).to_have_count(0)
    else:
        image = page.get_by_role("img", name="Attached screenshot", exact=True)
        expect(image).to_be_visible(timeout=60_000)
        data_url = image.get_attribute("src")
        actual = Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1]))).convert("RGB")
        assert abs(actual.width / actual.height - expected.width / expected.height) < 0.1
        expected = expected.resize(actual.size)
        assert max(ImageStat.Stat(ImageChops.difference(actual, expected)).mean) < 12
    expect(page.get_by_test_id("selection-attachment")).to_contain_text("button")
    expect(page.get_by_test_id("followup-input")).to_have_value("Keep my live scene")
