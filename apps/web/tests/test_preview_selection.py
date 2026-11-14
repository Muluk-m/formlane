"""Behavior at the opaque preview/host bridge boundary (Python Playwright).

Run with the backend Python environment. The fixture bundles the web entry with
its existing compiler esbuild dependency; it never changes the source checkout.
"""

import base64
import json
import os
import subprocess
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def browser_bundle():
    entry = ROOT / "apps/web/src/features/preview-selection/index.ts"
    script = """
const {buildSync} = require('esbuild');
const result = buildSync({entryPoints: [process.argv[1]], bundle: true,
  format: 'iife', globalName: 'selectionRuntime', write: false, target: 'es2022'});
process.stdout.write(result.outputFiles[0].text);
"""
    return subprocess.check_output(
        ["node", "-e", script, str(entry)],
        cwd=ROOT / "apps/compiler",
        text=True,
    )


@pytest.fixture
def preview(browser_bundle):
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get("BROWSER_EXECUTABLE_PATH"),
            chromium_sandbox=True,
        )
        page = browser.new_page(viewport={"width": 1000, "height": 800})
        page.route("https://selection.test/**", lambda route: route.fulfill(
            body="<!doctype html><html><body></body></html>",
            content_type="text/html",
        ))
        page.goto("https://selection.test/")
        page.add_script_tag(content=browser_bundle)
        page.evaluate("""() => {
          window.events = [];
          window.mount = (html, late = false) => {
            window.bridge?.dispose();
            document.querySelectorAll('iframe').forEach(frame => frame.remove());
            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts');
            frame.style.cssText = 'width:800px;height:600px;border:0';
            document.body.append(frame);
            const config = {sessionId: crypto.randomUUID(), editorOrigin: location.origin};
            window.config = config;
            const connect = () => window.bridge = selectionRuntime.createPreviewSelectionBridge(
              frame, {...config, onEvent: event => events.push(event)});
            if (!late) connect();
            const {promise, resolve} = Promise.withResolvers();
            frame.addEventListener('load', () => {
              if (late) connect();
              resolve();
            }, {once: true});
            frame.srcdoc = selectionRuntime.injectPreviewSelectionRuntime(html, config);
            return promise;
          };
        }""")
        yield page
        browser.close()


def mount(page, html, *, late=False):
    page.evaluate("args => mount(...args)", [html, late])
    page.evaluate("() => bridge.enable(false)")
    return page.frames[1]


def command(page, method, *args):
    return page.evaluate("([method, args]) => bridge[method](...args)", [method, args])


def test_edit_owns_early_events_and_preserves_live_scene(preview):
    frame = mount(preview, """
      <input id="draft"><button id="action"><span>Save</span></button>
      <output id="count">0</output>
      <script>
        let count = 0;
        for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
          window.addEventListener(type, () => {
            document.querySelector('output').textContent = String(++count);
          }, true);
        }
      </script>
    """, late=True)
    frame.locator("#draft").fill("unsaved scene")
    before = frame.locator("#count").inner_text()
    command(preview, "enable", True)
    frame.locator("#action span").click()
    assert frame.locator("#count").inner_text() == before
    assert frame.locator("#draft").input_value() == "unsaved scene"
    selected = command(preview, "capture")
    assert selected["kind"] == "element"
    assert selected["element"]["tagName"] == "span"
    parent = command(preview, "parent")
    assert parent["element"]["tagName"] == "button"
    command(preview, "enable", False)
    frame.locator("#action").click()
    assert int(frame.locator("#count").inner_text()) > int(before)
    assert frame.locator("#draft").input_value() == "unsaved scene"


def test_layers_distinguish_instances_paginate_and_reject_replaced_nodes(preview):
    frame = mount(preview, "<main>" + "".join(
        f'<button data-formlane-source="same">Row {index}</button>'
        for index in range(205)
    ) + '<button hidden>Hidden row</button></main>')
    root = command(preview, "children", None)["children"][0]
    first = command(preview, "children", root["nodeId"])
    assert len(first["children"]) == 200
    assert first["nextCursor"]
    second = command(preview, "children", root["nodeId"], {"cursor": first["nextCursor"]})
    assert [row["label"] for row in second["children"]] == [f"Row {index}" for index in range(200, 205)]
    assert second["nextCursor"] is None
    rows = first["children"]
    assert rows[0]["sourceId"] == rows[1]["sourceId"] == "same"
    assert rows[0]["nodeId"] != rows[1]["nodeId"]
    selected = command(preview, "select", rows[1]["nodeId"])
    assert selected["element"]["text"] == "Row 1"
    assert selected["element"]["nodeId"] == rows[1]["nodeId"]
    revealed = command(preview, "children", root["nodeId"], {"includeHidden": True})
    revealed_last = command(preview, "children", root["nodeId"], {
        "includeHidden": True, "cursor": revealed["nextCursor"],
    })
    assert revealed_last["children"][-1]["hidden"] is True
    frame.locator("button").nth(1).evaluate("node => node.replaceWith(node.cloneNode(true))")
    preview.wait_for_function("id => events.some(event => event.type === 'invalidated' && event.payload.nodeId === id)", arg=rows[1]["nodeId"])
    assert command(preview, "capture") is None
    error = preview.evaluate("id => bridge.select(id).catch(error => error.message)", rows[1]["nodeId"])
    assert error == "node-missing"
    cursor_error = preview.evaluate("args => bridge.children(...args).catch(error => error.message)",
                                    [root["nodeId"], {"cursor": first["nextCursor"]}])
    assert cursor_error == "cursor-stale"


def test_composed_layers_shadow_slots_dialog_svg_and_opaque_hosts(preview):
    frame = mount(preview, """
      <section id="host"><button slot="action" data-formlane-source="slotted">Slotted</button></section>
      <div id="closed"></div><canvas id="canvas"></canvas><iframe id="foreign"></iframe>
      <dialog><button><svg width="30" height="30"><rect width="30" height="30"/></svg>Dialog action</button></dialog>
      <script>
        const root = document.querySelector('#host').attachShadow({mode:'open'});
        root.innerHTML = '<article><slot name="action"></slot><button>Shadow action</button></article>';
        document.querySelector('#closed').attachShadow({mode:'closed'}).innerHTML = '<b>Private</b>';
        document.querySelector('dialog').showModal();
      </script>
    """)
    command(preview, "enable", True)
    frame.locator("dialog svg rect").click()
    assert command(preview, "capture")["element"]["tagName"] == "rect"
    assert command(preview, "parent")["element"]["tagName"] == "svg"
    frame.locator("dialog").evaluate("node => node.close()")
    frame.get_by_text("Slotted", exact=True).click()
    selected = command(preview, "capture")["element"]
    assert selected["sourceId"] == "slotted"
    assert selected["ancestors"][0]["tagName"] == "slot"
    rows = command(preview, "children", None)["children"]
    host = next(row for row in rows if row["tagName"] == "section")
    article = command(preview, "children", host["nodeId"])["children"][0]
    slot = command(preview, "children", article["nodeId"])["children"][0]
    assert command(preview, "children", slot["nodeId"])["children"][0]["nodeId"] == selected["nodeId"]
    for row in rows:
        if row["tagName"] in {"canvas", "iframe"}:
            assert command(preview, "children", row["nodeId"])["children"] == []


def test_geometry_tracks_nested_scroll_zoom_resize_and_fragments(preview):
    frame = mount(preview, """
      <style>#scroller{height:200px;overflow:auto;width:220px}article{height:1000px}
      #target{display:inline;font-size:24px}body{zoom:1.25}</style>
      <div id="scroller"><article><span id="target">A long multiline target with several fragments</span></article></div>
    """)
    command(preview, "enable", True)
    frame.locator("#target").click(position={"x": 10, "y": 10})
    before = command(preview, "capture")["element"]
    assert len(before["rects"]) > 1
    frame.locator("#scroller").evaluate("node => node.scrollTop = 30")
    after = command(preview, "capture")["element"]
    assert after["nodeId"] == before["nodeId"]
    assert after["rects"][0]["y"] < before["rects"][0]["y"]
    preview.locator("iframe").evaluate("node => node.style.width = '375px'")
    assert command(preview, "capture")["element"]["viewport"]["width"] == 375
    actual = frame.locator("#target").evaluate("node => Array.from(node.getClientRects(), r => ({x:r.x,y:r.y,width:r.width,height:r.height}))")
    assert command(preview, "capture")["element"]["rects"] == actual


def test_region_deduplicates_ancestors_retains_overlap_and_bounds_evidence(preview):
    mount(preview, """
      <style>body{margin:0}main{position:relative;width:400px;height:400px}
      button{position:absolute;top:20px;left:20px;width:100px;height:40px}</style>
      <main><button><span>First</span></button><button style="left:70px">Second</button>
      <input type="password" value="PRIVATE_PASSWORD"><script>const secret = 'PRIVATE_SCRIPT';</script></main>
    """)
    result = command(preview, "capture", {"region": {"x": 0, "y": 0, "width": 300, "height": 100}})
    assert result["kind"] == "region"
    assert result["rectangle"] == {"x": 0, "y": 0, "width": 300, "height": 100}
    assert {item["text"] for item in result["elements"]} >= {"First", "Second"}
    assert not any(item["tagName"] in {"body", "main"} for item in result["elements"])
    assert "PRIVATE_PASSWORD" not in json.dumps(result)
    assert "PRIVATE_SCRIPT" not in json.dumps(result)
    mount(preview, '<main style="display:flex;flex-wrap:wrap;width:700px">' + ''.join(
        f'<span style="width:30px;height:30px">{index}</span>' for index in range(100)
    ) + '</main>')
    bounded = command(preview, "capture", {"region": {"x": 0, "y": 0, "width": 800, "height": 600}})
    assert len(bounded["elements"]) == 32
    assert bounded["truncated"] is True
    assert len(json.dumps(bounded).encode()) <= 65536


def test_keyboard_cancel_and_disposal_restore_application_input(preview):
    frame = mount(preview, '<button>Action</button><output>0</output><script>document.addEventListener("click", () => document.querySelector("output").textContent = "1")</script>')
    command(preview, "enable", True)
    frame.locator("button").click()
    frame.locator("button").press("Escape")
    assert command(preview, "capture") is None
    command(preview, "dispose")
    frame.locator("button").click()
    assert frame.locator("output").inner_text() == "1"
    assert preview.evaluate("() => bridge.capture().catch(error => error.message)") == "bridge-disposed"


def test_old_sessions_foreign_windows_and_malformed_messages_cannot_replace_selection(preview):
    frame = mount(preview, '<button>Original</button>')
    row = command(preview, "children", None)["children"][0]
    command(preview, "select", row["nodeId"])
    before = preview.evaluate("events.length")
    frame.evaluate("""() => parent.postMessage({protocol:'formlane-selection',protocolVersion:1,
      sessionId:'obsolete',requestId:null,type:'cleared',payload:null}, 'https://selection.test')""")
    preview.evaluate("""() => {
      const sibling = document.createElement('iframe'); sibling.setAttribute('sandbox','allow-scripts');
      sibling.srcdoc = '<script>parent.postMessage(' + JSON.stringify({protocol:'formlane-selection',
        protocolVersion:1,sessionId:config.sessionId,requestId:null,type:'cleared',payload:null}) +
        ', "https://selection.test")<\\/script>';
      document.body.append(sibling);
    }""")
    frame.evaluate("""sessionId => parent.postMessage({protocol:'formlane-selection',protocolVersion:1,
      sessionId,requestId:null,type:'selected',payload:{kind:'element',element:{nodeId:'fake'}}},
      'https://selection.test')""", preview.evaluate("config.sessionId"))
    assert command(preview, "capture")["element"]["text"] == "Original"
    assert preview.evaluate("events.length") == before
    old_session = preview.evaluate("config.sessionId")
    mount(preview, '<button>New document</button>')
    current = command(preview, "children", None)["children"][0]
    command(preview, "select", current["nodeId"])
    preview.frames[1].evaluate("""sessionId => parent.postMessage({protocol:'formlane-selection',protocolVersion:1,
      sessionId,requestId:null,type:'cleared',payload:null}, 'https://selection.test')""", old_session)
    assert command(preview, "capture")["element"]["text"] == "New document"


def test_overlap_cycle_is_distinct_from_parent_and_keyboard_can_select(preview):
    frame = mount(preview, '''
      <main style="position:relative;height:200px">
        <button id="back" style="position:absolute;width:180px;height:80px">Back</button>
        <button id="front" style="position:absolute;width:180px;height:80px">Front</button>
      </main>
    ''')
    command(preview, "enable", True)
    frame.locator("#front").click()
    assert command(preview, "capture")["element"]["text"] == "Front"
    frame.locator("#front").click(modifiers=["Alt"])
    assert command(preview, "capture")["element"]["text"] == "Back"
    assert command(preview, "parent")["element"]["tagName"] == "main"
    command(preview, "clear")
    frame.locator("#back").focus()
    frame.locator("#back").press("Enter")
    assert command(preview, "capture")["element"]["text"] == "Back"


def test_disable_during_pointer_sequence_does_not_release_its_click(preview):
    frame = mount(preview, '<button>Action</button><output>0</output><script>window.addEventListener("click", () => document.querySelector("output").textContent = "1", true)</script>')
    command(preview, "enable", True)
    box = frame.locator("button").bounding_box()
    preview.mouse.move(box["x"] + 5, box["y"] + 5)
    preview.mouse.down()
    command(preview, "enable", False)
    preview.mouse.up()
    assert frame.locator("output").inner_text() == "0"
    frame.locator("button").click()
    assert frame.locator("output").inner_text() == "1"


def test_wheel_scrolling_survives_edit_and_frame_never_receives_owner_secrets(preview):
    frame = mount(preview, '<main style="height:2000px"><button>Top</button></main>')
    command(preview, "enable", True)
    frame.locator("button").hover()
    preview.mouse.wheel(0, 300)
    frame.wait_for_function("scrollY > 0")
    rows = command(preview, "children", None)["children"]
    assert rows[0]["hidden"] is False
    assert frame.evaluate("() => {try { return parent.document.cookie } catch { return 'opaque' }}") == "opaque"


def test_request_correlation_rejects_wrong_command_and_dispose_settles_pending(preview):
    frame = mount(preview, '<button>Action</button>')
    frame.evaluate("""sessionId => parent.postMessage({protocol:'formlane-selection', protocolVersion:1,
      sessionId,requestId:'r999999',type:'result',payload:{command:'capture',value:null}},
      'https://selection.test')""", preview.evaluate("config.sessionId"))
    assert command(preview, "children", None)["children"][0]["label"] == "Action"
    result = preview.evaluate("""() => {
      const frame = document.createElement('iframe'); frame.setAttribute('sandbox','allow-scripts');
      document.body.append(frame);
      const idle = selectionRuntime.createPreviewSelectionBridge(frame,
        {sessionId:crypto.randomUUID(),editorOrigin:location.origin});
      const result = idle.capture().catch(error => error.message);
      idle.dispose();
      return result;
    }""")
    assert result == "bridge-disposed"


def test_large_unicode_metadata_remains_bounded_with_explicit_layer_continuation(preview):
    label = "界" * 500
    frame = mount(preview, '<main>' + ''.join(
        f'<button aria-label="{label}" data-formlane-source="{label}">{index}</button>'
        for index in range(205)
    ) + '</main>')
    root = command(preview, "children", None)["children"][0]
    seen = []
    cursor = None
    while True:
        page = command(preview, "children", root["nodeId"], {"cursor": cursor})
        assert len(json.dumps(page, ensure_ascii=False).encode()) < 65536
        seen.extend(row["nodeId"] for row in page["children"])
        cursor = page["nextCursor"]
        if cursor is None:
            break
    assert len(set(seen)) == 205
    frame.locator("button").first.evaluate("""node => {
      for (let i=0;i<20;i++) { const parent=document.createElement('section');
        parent.setAttribute('data-formlane-source','界'.repeat(500));
        parent.setAttribute('aria-label','界'.repeat(500));
        node.replaceWith(parent); parent.append(node);
      }
      for (const name of ['id','class','role','aria-label','aria-labelledby','aria-describedby',
        'aria-expanded','aria-selected','aria-checked','aria-disabled','alt','title','type','placeholder'])
        node.setAttribute(name, '界'.repeat(500));
    }""")
    selected = command(preview, "select", seen[0])
    assert len(json.dumps(selected, ensure_ascii=False).encode()) < 65536
    assert len(selected["element"]["ancestors"]) <= 12


def test_missing_runtime_times_out_without_resubmitting_or_reloading(preview):
    result = preview.evaluate("""async () => {
      const frame = document.createElement('iframe'); frame.setAttribute('sandbox','allow-scripts');
      document.body.append(frame);
      const idle = selectionRuntime.createPreviewSelectionBridge(frame,
        {sessionId:crypto.randomUUID(),editorOrigin:location.origin,requestTimeoutMs:25});
      try { return await idle.capture().catch(error => error.message) }
      finally { idle.dispose(); frame.remove() }
    }""")
    assert result == "selection-timeout"


def test_outline_is_rendered_above_modal_and_disappears_when_edit_is_disabled(preview):
    frame = mount(preview, '''
      <dialog style="padding:50px;background:white"><button style="width:180px;height:60px;background:white">Modal target</button></dialog>
      <script>document.querySelector('dialog').showModal()</script>
    ''')
    command(preview, "enable", True)
    frame.locator("button").click()
    box = frame.locator("button").bounding_box()

    def outline_pixel():
        image = base64.b64encode(preview.screenshot()).decode()
        return preview.evaluate("""async ({image,x,y}) => {
          const bytes = Uint8Array.from(atob(image), char => char.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
          const canvas = document.createElement('canvas'); canvas.width=bitmap.width; canvas.height=bitmap.height;
          const context = canvas.getContext('2d'); context.drawImage(bitmap,0,0); bitmap.close();
          return Array.from(context.getImageData(x,y,1,1).data);
        }""", {"image": image, "x": int(box["x"] + box["width"] / 2), "y": int(box["y"] + 1)})

    assert outline_pixel() == [2, 132, 199, 255]
    command(preview, "enable", False)
    assert outline_pixel() != [2, 132, 199, 255]
    assert frame.locator("dialog").evaluate("node => node.open") is True


def test_document_navigation_invalidates_even_a_late_attached_bridge(preview):
    mount(preview, '<button>Before navigation</button>', late=True)
    preview.locator("iframe").evaluate("frame => frame.srcdoc = '<button>Replacement</button>'")
    preview.wait_for_function("events.some(event => event.type === 'error' && event.payload.code === 'document-replaced')")
    assert preview.evaluate("() => bridge.capture().catch(error => error.message)") == "bridge-disposed"
