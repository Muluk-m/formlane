"""Independent browser assertions against saved HTML; never acceptance-tool replay."""

import math
import os
import re
from datetime import datetime

from playwright.sync_api import sync_playwright, expect

PARENT = """<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src about:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-forms" title="Evaluation"></iframe>"""
RANDOM = """(() => { let state = __SEED__ >>> 0;
Math.random = () => { state = (state + 0x6D2B79F5) >>> 0;
let t = Math.imul(state ^ (state >>> 15), state | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();"""


def step(frame, instruction, remembered):
    kind, selector, *values = instruction
    value = values[0] if values else None
    target = frame.locator(selector)
    if kind == "click":
        target.click()
    elif kind == "fill":
        target.fill(value)
    elif kind == "select":
        target.select_option(value=value)
    elif kind == "press":
        target.press(value)
    elif kind == "text":
        expect(target).to_have_text(value)
    elif kind == "contains":
        expect(target).to_contain_text(value)
    elif kind == "notContains":
        expect(target).not_to_contain_text(value)
    elif kind == "matches":
        expect(target).to_contain_text(re.compile(value))
    elif kind == "value":
        expect(target).to_have_value(value)
    elif kind == "count":
        # Filtered rows may be hidden instead of removed from the DOM.
        expect(frame.locator(f"{selector}:visible")).to_have_count(value)
    elif kind == "checked":
        expect(target).to_be_checked(checked=value)
    elif kind == "disabled":
        expect(target).to_be_disabled() if value else expect(target).to_be_enabled()
    elif kind == "css":
        for property_name, expected in value.items():
            expect(target).to_have_css(property_name, expected)
    elif kind == "number":
        number = float(target.inner_text().strip())
        if not math.isfinite(number) or not value["min"] <= number <= value["max"]:
            raise AssertionError("Number outside requested range")
        if value.get("integer") and not number.is_integer():
            raise AssertionError("Expected integer")
    elif kind == "grid2048":
        cells = [int(text.strip() or "0") for text in target.all_text_contents()]
        if len(cells) != 16 or any(n < 0 or (n and n & (n - 1)) for n in cells):
            raise AssertionError("Invalid 2048 board")
        occupied = [n for n in cells if n]
        if value == "initial" and (len(occupied) != 2 or any(n not in (2, 4) for n in occupied)):
            raise AssertionError("Invalid starting tiles")
        if value == "valid" and not occupied:
            raise AssertionError("Empty game board")
    elif kind == "remember":
        remembered[value] = target.inner_text()
    elif kind == "changed":
        expect(target).not_to_have_text(remembered[value])
    else:
        raise ValueError("Unknown evaluation assertion")


def evaluate(html, case, executable=None):
    results = []
    # Chromium receives no API owner, provider key, database URL or inherited proxy.
    browser_env = {key: os.environ[key] for key in ("HOME", "PATH", "TMPDIR", "LANG", "DISPLAY") if key in os.environ}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=executable,
            headless=True,
            chromium_sandbox=True,
            env=browser_env,
            args=["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
            timeout=15000,
        )
        try:
            for check in case["checks"]:
                for seed in check.get("seeds", [1]):
                    result = {"name": check["name"], "seed": seed, "now": check.get("now"), "passed": False, "stepsPassed": 0}
                    context = browser.new_context(
                        service_workers="block", accept_downloads=False,
                        viewport={"width": 1280, "height": 800}, timezone_id="Asia/Shanghai",
                    )
                    errors = []
                    try:
                        context.set_default_timeout(5000)
                        context.set_default_navigation_timeout(5000)
                        context.route("**/*", lambda route: route.abort())
                        context.route_web_socket("**/*", lambda socket: socket.close())
                        context.add_init_script(RANDOM.replace("__SEED__", str(seed)))
                        page = context.new_page()
                        page.on("pageerror", lambda error: errors.append(type(error).__name__))
                        if check.get("now"):
                            page.clock.set_fixed_time(datetime.fromisoformat(check["now"]))
                        page.set_content(PARENT)
                        frame = next(f for f in page.frames if f.parent_frame == page.main_frame)
                        # Warm navigation is required before the first real app script.
                        for source in ("<!doctype html><title>Warm</title>", html):
                            with frame.expect_navigation(url="about:srcdoc", wait_until="domcontentloaded"):
                                page.locator("iframe").evaluate("(el, html) => el.setAttribute('srcdoc', html)", source)
                        remembered = {}
                        for index, instruction in enumerate(check["steps"]):
                            result["step"] = index + 1
                            step(frame, instruction, remembered)
                            result["stepsPassed"] += 1
                        if errors:
                            raise AssertionError("Generated application raised a page error")
                        result["passed"] = True
                    except Exception as error:
                        # Exception text may contain generated source; record only type and step.
                        result["errorType"] = type(error).__name__
                    finally:
                        result["pageErrorCount"] = len(errors)
                        context.close()
                    results.append(result)
        finally:
            browser.close()
    return {"status": "passed" if results and all(r["passed"] for r in results) else "failed", "checks": results}
