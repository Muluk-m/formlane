"""Native Playwright acceptance checks in fresh, opaque, offline browser contexts."""

import asyncio
import contextlib
import json
import re
import subprocess
import sys
import time
from concurrent.futures import CancelledError
from pathlib import Path
from types import SimpleNamespace

from playwright.async_api import async_playwright

from .compiler import _exchange, _stop_group, raise_if_cancelled, safe_environment
from .project import MAX_PREVIEW_BYTES, artifact_hash, js_trim, utf8_bytes, utf16_length

DEFAULT_VIEWPORT = {"width": 1280, "height": 720}
KEYS = frozenset(
    (
        "Enter",
        "Escape",
        "Tab",
        "Space",
        "Backspace",
        "Delete",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown",
    )
)
ASSERTION_KINDS = frozenset(("text", "value", "count", "attribute", "no-horizontal-overflow"))
ASSERTION_SECONDS = 5
VALIDATION_TIMEOUT_SECONDS = 180
PARENT_DOCUMENT = """<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src about:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe sandbox="allow-scripts allow-forms" title="Candidate"></iframe></body></html>"""


def _string(value, label: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str) or not minimum <= utf16_length(value) <= maximum:
        raise ValueError(f"{label} must contain {minimum}–{maximum} characters.")
    return value


def _assertion(value) -> dict:
    if not isinstance(value, dict):
        raise ValueError("An assertion object is required.")
    kind = value.get("kind")
    if not isinstance(kind, str) or kind not in ASSERTION_KINDS:
        raise ValueError("Unsupported assertion kind.")
    result = {
        "selector": _string(value.get("selector"), "Assertion selector", 1, 300),
        "kind": kind,
        "expected": _string(value.get("expected"), "Assertion expectation", 0, 1000),
    }
    if "attribute" in value:
        attribute = value["attribute"]
        result["attribute"] = None if attribute is None else _string(attribute, "Attribute", 1, 100)
    if kind == "attribute" and not result.get("attribute"):
        raise ValueError("Attribute assertions require an attribute name.")
    if kind == "no-horizontal-overflow" and result["expected"] != "true":
        raise ValueError('No-horizontal-overflow assertions require expected "true".')
    return result


def validate_checks(checks: list[dict]) -> list[dict]:
    """Normalize legacy/strict-tool fields; never permit arbitrary browser code."""
    if not isinstance(checks, list) or not 2 <= len(checks) <= 16:
        raise ValueError("Provide 2–16 acceptance checks.")
    result = []
    for check in checks:
        if not isinstance(check, dict):
            raise ValueError("An acceptance check object is required.")
        normalized = {"name": _string(check.get("name"), "Check name", 1, 160)}
        viewport = check.get("viewport", DEFAULT_VIEWPORT)
        if viewport is not None:
            if not isinstance(viewport, dict):
                raise ValueError("Invalid viewport.")
            dimensions = {}
            for dimension, lower, upper in (("width", 375, 1440), ("height", 640, 1200)):
                value = viewport.get(dimension)
                if (
                    type(value) not in (int, float)
                    or not lower <= value <= upper
                    or int(value) != value
                ):
                    raise ValueError(
                        f"Viewport {dimension} must be an integer from {lower} to {upper}."
                    )
                dimensions[dimension] = int(value)
            viewport = dimensions
        normalized["viewport"] = viewport
        actions = check.get("actions")
        if not isinstance(actions, list) or len(actions) > 16:
            raise ValueError("Provide at most 16 actions per check.")
        normalized["actions"] = []
        for action in actions:
            if not isinstance(action, dict) or "value" not in action:
                raise ValueError("An action requires kind, selector and value.")
            kind, value = action.get("kind"), action["value"]
            selector = _string(action.get("selector"), "Action selector", 1, 300)
            if kind == "click":
                valid = value is None
            elif kind in ("fill", "select"):
                valid = isinstance(value, str) and utf16_length(value) <= 1000
            elif kind == "press":
                valid = isinstance(value, str) and value in KEYS
            elif kind == "reload":
                valid = value is None and selector == "body"
            else:
                valid = False
            if not valid:
                raise ValueError("Unsupported action kind, selector or value.")
            normalized["actions"].append({"kind": kind, "selector": selector, "value": value})
        assertions = check.get("assertions", [])
        if assertions is None:
            assertions = []  # Strict tool schemas send null for optional defaults.
        if not isinstance(assertions, list) or len(assertions) > 12:
            raise ValueError("Provide 1–12 assertions in total per check.")
        normalized["assertions"] = [_assertion(item) for item in assertions]
        if "assertion" in check:
            normalized["assertion"] = (
                None if check["assertion"] is None else _assertion(check["assertion"])
            )
        if not 1 <= len(assertions) + bool(normalized.get("assertion")) <= 12:
            raise ValueError("Provide 1–12 assertions in total per check.")
        result.append(normalized)
    return result


async def _sample(frame, assertion: dict, timeout: int):
    element = frame.locator(assertion["selector"])
    kind = assertion["kind"]
    if kind == "no-horizontal-overflow":
        actual = await frame.evaluate(
            """() => { const root = document.documentElement; return Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) <= root.clientWidth }"""
        )
        return "true" if actual else "false"
    if kind == "attribute":
        return await element.get_attribute(assertion["attribute"], timeout=timeout)
    if kind == "count":
        return str(await element.count())
    if kind == "value":
        return await element.input_value(timeout=timeout)
    return js_trim((await element.text_content(timeout=timeout)) or "")


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


async def _poll_assertion(
    frame, assertion: dict, index: int, name: str, deadline: float, cancelled
) -> dict:
    actual, sampled, matches, sample_error = None, False, False, None
    while True:
        raise_if_cancelled(cancelled)
        remaining = max(0.001, deadline - time.monotonic())
        timeout = max(1, min(500, int(remaining * 1000)))
        try:
            # count/evaluate have no native Playwright timeout; bound them too.
            actual = await asyncio.wait_for(
                _sample(frame, assertion, timeout), timeout=timeout / 1000 + 0.05
            )
            sampled = True
            raise_if_cancelled(cancelled)
            matches = actual is not None and (
                assertion["expected"] in actual
                if assertion["kind"] == "text"
                else actual == assertion["expected"]
            )
            if matches:
                break
        except CancelledError:
            raise
        except Exception as error:
            raise_if_cancelled(cancelled)
            sample_error = error
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        await asyncio.sleep(min(0.1, remaining))
    raise_if_cancelled(cancelled)
    detail = (
        _json(actual[:300] if actual is not None else None)
        if sampled
        else (str(sample_error)[:300] or "No assertion result.")
    )
    return {
        "actual": (actual[:1000] if actual is not None else "null") if sampled else detail,
        "issue": None
        if sampled and matches
        else f"{name} assertion {index + 1} ({assertion['kind']}, {assertion['selector']}): expected {_json(assertion['expected'])}, got {detail}.",
    }


async def _close(resource) -> None:
    with contextlib.suppress(Exception):
        await asyncio.wait_for(resource.close(), timeout=3)


async def _run_browser(html: str, checks: list[dict], settings, cancelled, report: dict) -> dict:
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=settings.browser_executable or None,
            chromium_sandbox=True,
            headless=True,
            args=["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
            timeout=15000,
            env=safe_environment(),
        )
        try:
            for check in checks:
                raise_if_cancelled(cancelled)
                context = await browser.new_context(
                    service_workers="block",
                    accept_downloads=False,
                    viewport=check["viewport"] or DEFAULT_VIEWPORT,
                )
                context.set_default_timeout(5000)
                context.set_default_navigation_timeout(5000)
                try:
                    await context.route("**/*", lambda route: route.abort())
                    await context.route_web_socket("**/*", lambda socket: socket.close())
                    page = await context.new_page()
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)[:300]))
                    await page.set_content(PARENT_DOCUMENT)
                    frame = next(
                        (
                            candidate
                            for candidate in page.frames
                            if candidate.parent_frame == page.main_frame
                        ),
                        None,
                    )
                    if frame is None:
                        raise ValueError("Candidate iframe was not attached.")

                    async def load_artifact():
                        async with frame.expect_navigation(
                            url="about:srcdoc", wait_until="domcontentloaded", timeout=5000
                        ):
                            await page.locator("iframe").evaluate(
                                "(element, source) => element.setAttribute('srcdoc', source)", html
                            )

                    await load_artifact()
                    for action in check["actions"]:
                        raise_if_cancelled(cancelled)
                        if action["kind"] == "reload":
                            await load_artifact()
                        else:
                            element = frame.locator(action["selector"])
                            if action["kind"] == "click":
                                await element.click(timeout=5000)
                            elif action["kind"] == "press":
                                await element.press(action["value"], timeout=5000)
                            elif action["kind"] == "select":
                                # Playwright strings match labels too; choose the exact option node.
                                option = await element.evaluate_handle(
                                    "(select, value) => Array.from(select.options).find(option => option.value === value)",
                                    action["value"],
                                )
                                try:
                                    node = option.as_element()
                                    if node is None:
                                        raise ValueError("No option matches the requested value.")
                                    await element.select_option(element=node, timeout=5000)
                                finally:
                                    await option.dispose()
                            else:
                                await element.fill(action["value"], timeout=5000)
                    assertions = ([check["assertion"]] if check.get("assertion") else []) + check[
                        "assertions"
                    ]
                    deadline = time.monotonic() + ASSERTION_SECONDS
                    outcomes = await asyncio.gather(
                        *(
                            _poll_assertion(
                                frame, assertion, index, check["name"], deadline, cancelled
                            )
                            for index, assertion in enumerate(assertions)
                        )
                    )
                    issues = [outcome["issue"] for outcome in outcomes if outcome["issue"]]
                    if errors:
                        issues.append(f"{check['name']}: {'; '.join(errors)}")
                    report["issues"].extend(issues)
                    results = [outcome["actual"] for outcome in outcomes]
                    actual = (
                        results[0]
                        if len(results) == 1
                        else "; ".join(
                            f"{index + 1}: {value}" for index, value in enumerate(results)
                        )
                    )
                    report["checks"].append(
                        {"name": check["name"], "passed": not issues, "actual": actual[:1000]}
                    )
                except CancelledError:
                    raise
                except Exception as error:
                    raise_if_cancelled(cancelled)
                    detail = str(error)[:400] or "Browser assertion failed."
                    report["checks"].append(
                        {"name": check["name"], "passed": False, "actual": detail}
                    )
                    report["issues"].append(f"{check['name']}: {detail}")
                finally:
                    await _close(context)
            report["valid"] = not report["issues"]
            return report
        finally:
            await _close(browser)


def validate_artifact(html: str, checks: list[dict], settings, cancelled) -> dict:
    raise_if_cancelled(cancelled)
    report = {"valid": False, "artifactHash": artifact_hash(html), "issues": [], "checks": []}
    trimmed = js_trim(html)
    if not re.match(r"^<!doctype html", trimmed, re.I) or not re.search(r"</html>$", trimmed, re.I):
        report["issues"].append("Return a complete HTML document.")
    if len(utf8_bytes(html)) > MAX_PREVIEW_BYTES:
        report["issues"].append(f"Artifact exceeds {MAX_PREVIEW_BYTES} UTF-8 bytes.")
    try:
        normalized = validate_checks(checks)
    except ValueError as error:
        report["issues"].append(f"Invalid acceptance checks: {error}")
        return report
    if not any(check["actions"] for check in normalized):
        report["issues"].append(
            "Provide at least two meaningful acceptance checks, including an interaction."
        )
    if report["issues"]:
        return report
    # The outer process owns the complete driver/browser process group. A hung
    # page or driver cannot prevent cancellation or outlive the tool invocation.
    payload = json.dumps(
        {"html": html, "checks": normalized, "browserExecutable": settings.browser_executable},
        ensure_ascii=True,
    ).encode("utf-8")
    environment = safe_environment()
    # A fixed, trusted import root supports installed and source-checkout use;
    # never inherit caller-controlled PYTHONPATH or Python startup injection.
    environment["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
    raise_if_cancelled(cancelled)
    process = subprocess.Popen(
        [sys.executable, "-m", "formlane.validator"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=environment,
        start_new_session=True,
    )
    try:
        try:
            stdout, stderr = _exchange(process, payload, cancelled, VALIDATION_TIMEOUT_SECONDS)
        except TimeoutError:
            raise TimeoutError("Browser validation timed out.") from None
        raise_if_cancelled(cancelled)
        if process.returncode:
            raise RuntimeError(
                "Browser validation failed: " + stderr.decode("utf-8", errors="replace")[:4000]
            )
        try:
            result = json.loads(stdout)
        except (ValueError, UnicodeError):
            raise RuntimeError("Browser validator returned invalid JSON.") from None
        if (
            not isinstance(result, dict)
            or set(result) != set(report)
            or result["artifactHash"] != report["artifactHash"]
            or type(result["valid"]) is not bool
            or not isinstance(result["issues"], list)
            or not isinstance(result["checks"], list)
            or len(result["checks"]) != len(normalized)
        ):
            raise RuntimeError("Browser validator returned an invalid report.")
        return result
    finally:
        _stop_group(process)


def _main() -> None:
    try:
        payload = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if len(payload) > 8 * 1024 * 1024:
            raise ValueError("Browser request exceeds 8 MiB.")
        request = json.loads(payload)
        html = request["html"]
        checks = validate_checks(request["checks"])
        report = {"valid": False, "artifactHash": artifact_hash(html), "issues": [], "checks": []}
        settings = SimpleNamespace(browser_executable=request["browserExecutable"])
        result = asyncio.run(_run_browser(html, checks, settings, lambda: False, report))
        sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    except Exception as error:
        sys.stderr.write(str(error)[:4000] + "\n")
        raise SystemExit(1) from None


if __name__ == "__main__":
    _main()
