"""Canonical source snapshots, ported from packages/atoms-core/src/project.ts.

_TEMPLATE_SOURCES is generated from createProjectSource; template changes must update
these snapshots and the cross-runtime hash fixtures together. No Node runs on reads.
"""

import hashlib
import json
import re
from copy import deepcopy

MAX_PROJECT_FILES = 64
MAX_SOURCE_BYTES = 256 * 1024
MAX_FILE_CHARACTERS = 180000
MAX_PREVIEW_BYTES = 512 * 1024

_TEMPLATE_SOURCES = {
    "vanilla": {
        "template": "vanilla",
        "files": {
            "package.json": "{\n"
            '  "name": "generated-app",\n'
            '  "version": "1.0.0",\n'
            '  "private": true,\n'
            '  "type": "module",\n'
            '  "scripts": {\n'
            '    "dev": "vite --host 127.0.0.1",\n'
            '    "build": "vite build",\n'
            '    "preview": "vite preview --host 127.0.0.1"\n'
            "  },\n"
            '  "devDependencies": {\n'
            '    "vite": "8.3.7"\n'
            "  }\n"
            "}\n",
            "index.html": "<!doctype html>\n"
            '<html lang="en">\n'
            "  <head>\n"
            '    <meta charset="UTF-8" />\n'
            '    <meta name="viewport" content="width=device-width, '
            'initial-scale=1.0" />\n'
            "    <title>Application</title>\n"
            "  </head>\n"
            "  <body>\n"
            '    <div id="root"></div>\n'
            '    <script type="module" src="/src/main.js"></script>\n'
            "  </body>\n"
            "</html>\n",
            "src/styles.css": ":root { font-family: system-ui, sans-serif; color: "
            "#171717; background: #fff; }\n"
            "* { box-sizing: border-box; }\n"
            "body { margin: 0; }\n"
            "main { max-width: 64rem; margin: 0 auto; padding: 2rem; "
            "}\n"
            "button, input, select, textarea { font: inherit; }\n"
            "button { cursor: pointer; }\n"
            ":focus-visible { outline: 2px solid #0284c7; "
            "outline-offset: 3px; }\n",
            "src/main.js": "import './styles.css'\n"
            "\n"
            "const root = document.getElementById('root')\n"
            "if (!root) throw new Error('Application root is missing.')\n"
            "const heading = document.createElement('h1')\n"
            "heading.textContent = 'Application'\n"
            "const main = document.createElement('main')\n"
            "main.append(heading)\n"
            "root.append(main)\n",
        },
    },
    "react-ts": {
        "template": "react-ts",
        "files": {
            "package.json": "{\n"
            '  "name": "generated-app",\n'
            '  "version": "1.0.0",\n'
            '  "private": true,\n'
            '  "type": "module",\n'
            '  "scripts": {\n'
            '    "dev": "vite --host 127.0.0.1",\n'
            '    "build": "vite build",\n'
            '    "preview": "vite preview --host 127.0.0.1",\n'
            '    "typecheck": "tsc --noEmit"\n'
            "  },\n"
            '  "dependencies": {\n'
            '    "react": "19.3.1",\n'
            '    "react-dom": "19.3.1"\n'
            "  },\n"
            '  "devDependencies": {\n'
            '    "vite": "8.3.7",\n'
            '    "typescript": "6.0.3",\n'
            '    "@types/react": "19.3.0",\n'
            '    "@types/react-dom": "19.3.0"\n'
            "  }\n"
            "}\n",
            "index.html": "<!doctype html>\n"
            '<html lang="en">\n'
            "  <head>\n"
            '    <meta charset="UTF-8" />\n'
            '    <meta name="viewport" content="width=device-width, '
            'initial-scale=1.0" />\n'
            "    <title>Application</title>\n"
            "  </head>\n"
            "  <body>\n"
            '    <div id="root"></div>\n'
            '    <script type="module" src="/src/main.tsx"></script>\n'
            "  </body>\n"
            "</html>\n",
            "src/styles.css": ":root { font-family: system-ui, sans-serif; color: "
            "#171717; background: #fff; }\n"
            "* { box-sizing: border-box; }\n"
            "body { margin: 0; }\n"
            "main { max-width: 64rem; margin: 0 auto; padding: 2rem; "
            "}\n"
            "button, input, select, textarea { font: inherit; }\n"
            "button { cursor: pointer; }\n"
            ":focus-visible { outline: 2px solid #0284c7; "
            "outline-offset: 3px; }\n",
            "src/main.tsx": "import { createRoot } from 'react-dom/client'\n"
            "import App from './App'\n"
            "import './styles.css'\n"
            "\n"
            "const root = document.getElementById('root')\n"
            "if (!root) throw new Error('Application root is "
            "missing.')\n"
            "createRoot(root).render(<App />)\n",
            "src/App.tsx": "export default function App() {\n"
            "  return <main><h1>Application</h1></main>\n"
            "}\n",
            "tsconfig.json": "{\n"
            '  "compilerOptions": {\n'
            '    "target": "ES2022",\n'
            '    "lib": [\n'
            '      "ES2022",\n'
            '      "DOM",\n'
            '      "DOM.Iterable"\n'
            "    ],\n"
            '    "module": "ESNext",\n'
            '    "moduleResolution": "Bundler",\n'
            '    "jsx": "react-jsx",\n'
            '    "strict": true,\n'
            '    "noEmit": true,\n'
            '    "skipLibCheck": true,\n'
            '    "resolveJsonModule": true,\n'
            '    "isolatedModules": true,\n'
            '    "types": [\n'
            '      "vite/client"\n'
            "    ]\n"
            "  },\n"
            '  "include": [\n'
            '    "src"\n'
            "  ]\n"
            "}\n",
        },
    },
}

# English ICU collation on the ASCII alphabet admitted by is_project_path.
# Case is a tertiary weight: compare the entire folded path before letter case.
_COLLATION = {
    character: index for index, character in enumerate("_-./0123456789abcdefghijklmnopqrstuvwxyz")
}
_PATH_PART = re.compile(r"[a-zA-Z0-9_-][a-zA-Z0-9._-]*\Z")
_EXTENSION = re.compile(r"\.(?:html|css|js|jsx|ts|tsx|json|svg|md|txt)\Z", re.I)
_JS_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def utf8_bytes(value: str) -> bytes:
    """Match TextEncoder, including replacement of lone UTF-16 surrogates."""
    return (
        value.encode("utf-16-le", errors="surrogatepass")
        .decode("utf-16-le", errors="replace")
        .encode("utf-8")
    )


def js_trim(value: str) -> str:
    return value.strip(_JS_WHITESPACE)


def is_project_path(path: str) -> bool:
    return (
        isinstance(path, str)
        and 0 < len(path) <= 180
        and _EXTENSION.search(path) is not None
        and all(
            _PATH_PART.fullmatch(part) is not None
            and part not in {"__proto__", "constructor", "prototype"}
            for part in path.split("/")
        )
    )


def create_source(template: str) -> dict:
    if not isinstance(template, str) or template not in _TEMPLATE_SOURCES:
        raise ValueError("Unknown project template.")
    return deepcopy(_TEMPLATE_SOURCES[template])


def project_package_json(template: str) -> str:
    return create_source(template)["files"]["package.json"]


def legacy_source(html: str) -> dict:
    return {
        "template": "vanilla",
        "files": {"package.json": project_package_json("vanilla"), "index.html": html},
    }


def validate_source(source: dict) -> None:
    if (
        not isinstance(source, dict)
        or not isinstance(source.get("template"), str)
        or source["template"] not in _TEMPLATE_SOURCES
    ):
        raise ValueError("Unknown project template.")
    if set(source) != {"template", "files"}:
        raise ValueError("A source snapshot contains only template and files.")
    files = source["files"]
    if not isinstance(files, dict) or not 1 <= len(files) <= MAX_PROJECT_FILES:
        raise ValueError(f"A project must contain 1–{MAX_PROJECT_FILES} files.")
    paths = set()
    size = 0
    for path, content in files.items():
        if not is_project_path(path):
            raise ValueError(f"Unsupported project path: {path}")
        key = path.lower()
        if key in paths:
            raise ValueError(f"Project paths differ only by case: {path}")
        paths.add(key)
        if not isinstance(content, str):
            raise ValueError(f"Project file content must be a string: {path}")
        if utf16_length(content) > MAX_FILE_CHARACTERS:
            raise ValueError(f"File is too large: {path}")
        size += len(utf8_bytes(content))
    for path in paths:
        parts = path.split("/")
        if any("/".join(parts[:index]) in paths for index in range(1, len(parts))):
            raise ValueError(f"Project path is both a file and a directory: {path}")
    if size > MAX_SOURCE_BYTES:
        raise ValueError("Project source exceeds the 256 KiB limit.")
    if not js_trim(files.get("index.html", "")):
        raise ValueError("Project index.html is required.")
    try:
        manifest = json.loads(files.get("package.json", ""))
        expected = json.loads(project_package_json(source["template"]))
        # JSON booleans must not compare equal to Python integers (True == 1).
        if json.dumps(manifest, sort_keys=True, ensure_ascii=True) != json.dumps(
            expected, sort_keys=True, ensure_ascii=True
        ):
            raise ValueError("Manifest differs from the template.")
    except (ValueError, TypeError):
        raise ValueError(
            "package.json dependencies and scripts are owned by the selected template."
        ) from None


def _key_order(value: str) -> tuple:
    return (
        tuple(_COLLATION[char] for char in value.lower()),
        tuple(char.isupper() for char in value),
    )


def _json_string(value: str) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    # JSON.stringify escapes unpaired surrogates but leaves actual Unicode intact.
    return re.sub(r"[\ud800-\udfff]", lambda match: f"\\u{ord(match[0]):04x}", encoded)


def _canonical_source(source: dict) -> str:
    files = ",".join(
        _json_string(path) + ":" + _json_string(source["files"][path])
        for path in sorted(source["files"], key=_key_order)
    )
    return '{"files":{' + files + '},"template":' + _json_string(source["template"]) + "}"


def source_hash(source: dict) -> str:
    validate_source(source)
    return hashlib.sha256(utf8_bytes(_canonical_source(source))).hexdigest()


def artifact_hash(html: str) -> str:
    return hashlib.sha256(utf8_bytes(html)).hexdigest()
