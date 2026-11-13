"""Native Playwright acceptance checks in fresh, opaque, offline browser contexts."""

import asyncio
import contextlib
import json
import re
import subprocess
import sys
import time
from concurrent.futures import CancelledError
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

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
INSPECT_TIMEOUT_SECONDS = 60
INSPECT_TREE_CHARACTERS = 6000
PARENT_DOCUMENT = """<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src about:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe sandbox="allow-scripts allow-forms" title="Candidate"></iframe></body></html>"""


def _string(value, label: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str) or not minimum <= utf16_length(value) <= maximum:
        raise ValueError(f"{label} must contain {minimum}–{maximum} characters.")
    return value


# Fixed in-sandbox PRNG (mulberry32): the same check observes the same "random" app state.
SEEDED_RANDOM = """(() => {
  let state = __SEED__ >>> 0;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = next;
  if (globalThis.crypto && crypto.getRandomValues) {
    const native = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (array) => {
      if (typeof BigInt64Array !== "undefined" && (array instanceof BigInt64Array || array instanceof BigUint64Array)) return native(array);
      const range = 2 ** (8 * array.BYTES_PER_ELEMENT);
      for (let index = 0; index < array.length; index++) array[index] = Math.floor(next() * range);
      return array;
    };
  }
})();"""
DEFAULT_SEED = 1
WARM_DOCUMENT = "<!doctype html><title>warm</title>"


def _seed(value) -> int:
    if value is None:
        return DEFAULT_SEED
    if type(value) is not int or not 0 <= value <= 2**31 - 1:
        raise ValueError("Seed must be an integer from 0 to 2147483647.")
    return value


def _clock(value) -> dict | None:
    """A fixed page clock lets checks assert time-relative behavior deterministically."""
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - {"now", "timezone"}:
        raise ValueError("Clock requires now and optional timezone.")
    now = _string(value.get("now"), "Clock now", 10, 40)
    try:
        moment = datetime.fromisoformat(now)
    except ValueError:
        raise ValueError("Clock now must be an ISO-8601 timestamp.") from None
    if moment.tzinfo is None:
        raise ValueError("Clock now must include a UTC offset, e.g. 2026-03-18T10:00:00+08:00.")
    timezone = value.get("timezone") or "UTC"
    try:
        ZoneInfo(_string(timezone, "Clock timezone", 1, 64))
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Clock timezone must be an IANA name such as Asia/Shanghai.") from None
    return {"now": now, "timezone": timezone}


def _actions(actions) -> list[dict]:
    if not isinstance(actions, list) or len(actions) > 16:
        raise ValueError("Provide at most 16 actions per check.")
    result = []
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
        result.append({"kind": kind, "selector": selector, "value": value})
    return result


def _viewport(viewport):
    if viewport is None:
        return None
    if not isinstance(viewport, dict):
        raise ValueError("Invalid viewport.")
    dimensions = {}
    for dimension, lower, upper in (("width", 375, 1440), ("height", 640, 1200)):
        value = viewport.get(dimension)
        if type(value) not in (int, float) or not lower <= value <= upper or int(value) != value:
            raise ValueError(f"Viewport {dimension} must be an integer from {lower} to {upper}.")
        dimensions[dimension] = int(value)
    return dimensions


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
        normalized["viewport"] = _viewport(check.get("viewport", DEFAULT_VIEWPORT))
        normalized["actions"] = _actions(check.get("actions"))
        clock = _clock(check.get("clock"))
        if clock:
            normalized["clock"] = clock
        if check.get("seed") is not None:
            normalized["seed"] = _seed(check["seed"])
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


async def _launch(playwright, settings):
    return await playwright.chromium.launch(
        executable_path=settings.browser_executable or None,
        chromium_sandbox=True,
        headless=True,
        args=["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
        timeout=15000,
        env=safe_environment(),
    )


async def _open(browser, html: str, viewport, clock, seed: int = DEFAULT_SEED):
    """A fresh offline context whose opaque iframe holds the candidate document."""
    context = await browser.new_context(
        service_workers="block",
        accept_downloads=False,
        viewport=viewport or DEFAULT_VIEWPORT,
        **({"timezone_id": clock["timezone"]} if clock else {}),
    )
    context.set_default_timeout(5000)
    context.set_default_navigation_timeout(5000)
    await context.route("**/*", lambda route: route.abort())
    await context.route_web_socket("**/*", lambda socket: socket.close())
    # Init scripts run in every frame, including the opaque candidate iframe.
    await context.add_init_script(SEEDED_RANDOM.replace("__SEED__", str(seed)))
    page = await context.new_page()
    errors, console = [], []
    page.on("pageerror", lambda error: errors.append(str(error)[:300]))
    page.on(
        "console",
        lambda message: (
            console.append(f"{message.type}: {message.text[:300]}") if len(console) < 40 else None
        ),
    )
    if clock:
        await page.clock.set_fixed_time(datetime.fromisoformat(clock["now"]))
    await page.set_content(PARENT_DOCUMENT)
    frame = next(
        (candidate for candidate in page.frames if candidate.parent_frame == page.main_frame),
        None,
    )
    if frame is None:
        raise ValueError("Candidate iframe was not attached.")

    async def load(document: str = html):
        async with frame.expect_navigation(
            url="about:srcdoc", wait_until="domcontentloaded", timeout=5000
        ):
            await page.locator("iframe").evaluate(
                "(element, source) => element.setAttribute('srcdoc', source)", document
            )

    # The first srcdoc document runs before clock, timezone and init-script overrides
    # reach the isolated iframe; only a later navigation sees them from its first script.
    await load(WARM_DOCUMENT)
    await load()
    return SimpleNamespace(
        context=context, page=page, frame=frame, load=load, errors=errors, console=console
    )


async def _act(session, action: dict) -> None:
    if action["kind"] == "reload":
        await session.load()
        return
    element = session.frame.locator(action["selector"])
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


async def _run_browser(html: str, checks: list[dict], settings, cancelled, report: dict) -> dict:
    async with async_playwright() as playwright:
        browser = await _launch(playwright, settings)
        try:
            for check in checks:
                raise_if_cancelled(cancelled)
                session = None
                try:
                    session = await _open(
                        browser,
                        html,
                        check["viewport"],
                        check.get("clock"),
                        check.get("seed", DEFAULT_SEED),
                    )
                    for action in check["actions"]:
                        raise_if_cancelled(cancelled)
                        await _act(session, action)
                    assertions = ([check["assertion"]] if check.get("assertion") else []) + check[
                        "assertions"
                    ]
                    deadline = time.monotonic() + ASSERTION_SECONDS
                    outcomes = await asyncio.gather(
                        *(
                            _poll_assertion(
                                session.frame, assertion, index, check["name"], deadline, cancelled
                            )
                            for index, assertion in enumerate(assertions)
                        )
                    )
                    issues = [outcome["issue"] for outcome in outcomes if outcome["issue"]]
                    if session.errors:
                        issues.append(f"{check['name']}: {'; '.join(session.errors)}")
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
                    if session is not None:
                        await _close(session.context)
            report["valid"] = not report["issues"]
            return report
        finally:
            await _close(browser)


async def _inspect_browser(html: str, request: dict, settings) -> dict:
    """Observation only: accessibility tree, console and errors after optional actions."""
    async with async_playwright() as playwright:
        browser = await _launch(playwright, settings)
        try:
            session = await _open(
                browser, html, request["viewport"], request.get("clock"), request["seed"]
            )
            try:
                performed, failure = 0, None
                for action in request["actions"]:
                    try:
                        await _act(session, action)
                        performed += 1
                    except Exception as error:
                        failure = f"Action {performed + 1} ({action['kind']} {action['selector']}): {str(error)[:300]}"
                        break
                await asyncio.sleep(0.2)
                selector = request["selector"]
                try:
                    tree = await session.frame.locator(selector).first.aria_snapshot(timeout=3000)
                except Exception as error:
                    tree = f"No accessibility snapshot for {selector}: {str(error)[:200]}"
                width = await session.frame.evaluate(
                    "() => ({document: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0), viewport: document.documentElement.clientWidth})"
                )
                return {
                    "actionsPerformed": performed,
                    "actionFailure": failure,
                    "accessibilityTree": tree[:INSPECT_TREE_CHARACTERS],
                    "truncated": len(tree) > INSPECT_TREE_CHARACTERS,
                    "console": session.console,
                    "pageErrors": session.errors,
                    "width": width,
                }
            finally:
                await _close(session.context)
        finally:
            await _close(browser)


def validate_inspection(request: dict) -> dict:
    if not isinstance(request, dict):
        raise ValueError("An inspection request object is required.")
    return {
        "viewport": _viewport(request.get("viewport")),
        "clock": _clock(request.get("clock")),
        "actions": _actions(request.get("actions") or []),
        "seed": _seed(request.get("seed")),
        "selector": _string(request.get("selector") or "body", "Inspection selector", 1, 300),
    }


def _subprocess(payload: dict, cancelled, timeout: int) -> dict:
    """The outer process owns the driver/browser process group and its cancellation."""
    data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
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
            stdout, stderr = _exchange(process, data, cancelled, timeout)
        except TimeoutError:
            raise TimeoutError("Browser validation timed out.") from None
        raise_if_cancelled(cancelled)
        if process.returncode:
            raise RuntimeError(
                "Browser validation failed: " + stderr.decode("utf-8", errors="replace")[:4000]
            )
        try:
            return json.loads(stdout)
        except (ValueError, UnicodeError):
            raise RuntimeError("Browser validator returned invalid JSON.") from None
    finally:
        _stop_group(process)


def inspect_artifact(html: str, request: dict, settings, cancelled) -> dict:
    """Debugging observation for agents; never acceptance evidence."""
    normalized = validate_inspection(request)
    result = _subprocess(
        {
            "mode": "inspect",
            "html": html,
            "request": normalized,
            "browserExecutable": settings.browser_executable,
        },
        cancelled,
        INSPECT_TIMEOUT_SECONDS,
    )
    if not isinstance(result, dict) or "accessibilityTree" not in result:
        raise RuntimeError("Browser inspector returned an invalid report.")
    return result


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
    result = _subprocess(
        {"html": html, "checks": normalized, "browserExecutable": settings.browser_executable},
        cancelled,
        VALIDATION_TIMEOUT_SECONDS,
    )
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


def _main() -> None:
    try:
        payload = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
        if len(payload) > 8 * 1024 * 1024:
            raise ValueError("Browser request exceeds 8 MiB.")
        request = json.loads(payload)
        html = request["html"]
        settings = SimpleNamespace(browser_executable=request["browserExecutable"])
        if request.get("mode") == "inspect":
            inspection = validate_inspection(request["request"])
            result = asyncio.run(_inspect_browser(html, inspection, settings))
        else:
            checks = validate_checks(request["checks"])
            report = {
                "valid": False,
                "artifactHash": artifact_hash(html),
                "issues": [],
                "checks": [],
            }
            result = asyncio.run(_run_browser(html, checks, settings, lambda: False, report))
        sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    except Exception as error:
        sys.stderr.write(str(error)[:4000] + "\n")
        raise SystemExit(1) from None


if __name__ == "__main__":
    _main()
