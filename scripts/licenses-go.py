#!/usr/bin/env python3
"""Every Go module linked into the server binary, with its licence text.

`go list -deps .` is the real answer to "what ships": it excludes test-only and
tool dependencies that go.mod still lists. Output is web/static/legal/go.json,
a static asset the /legal/licenses page fetches — not an import, so a page
nobody visits costs the SPA bundle nothing.
"""

import json
import os
import re
import subprocess
import sys

LICENCE = re.compile(r"^(LICEN[CS]E|COPYING|NOTICE)([-.].*)?$", re.I)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, "server")


def go(*args: str) -> str:
    return subprocess.run(
        ["go", *args], cwd=SERVER, check=True, capture_output=True, text=True
    ).stdout


def licence_text(directory: str) -> str:
    if not directory or not os.path.isdir(directory):
        return ""
    for name in sorted(os.listdir(directory)):
        if LICENCE.match(name):
            with open(os.path.join(directory, name), encoding="utf-8", errors="replace") as fh:
                return fh.read().strip()
    return ""


def main() -> int:
    linked = {
        line
        for line in go(
            "list", "-deps",
            "-f", "{{if and .Module (not .Standard)}}{{.Module.Path}}{{end}}",
            ".",
        ).splitlines()
        if line and not line.startswith("github.com/natrontech/wattroom")
    }
    if not linked:
        print("go list returned no modules — refusing to write an empty page", file=sys.stderr)
        return 1

    modules = []
    for line in go("list", "-m", "-f", "{{.Path}}\t{{.Version}}\t{{.Dir}}", *sorted(linked)).splitlines():
        path, version, directory = line.split("\t")
        text = licence_text(directory)
        modules.append({
            "name": path,
            "version": version,
            # A Go module without a licence file in its own root is rare enough
            # to be worth naming on the page rather than hiding.
            "text": text,
            "textMissing": not text,
        })

    modules.sort(key=lambda m: m["name"])
    out = os.path.join(ROOT, "web", "static", "legal", "go.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"modules": modules}, fh, indent="\t", ensure_ascii=False)
        fh.write("\n")

    missing = [m["name"] for m in modules if m["textMissing"]]
    print(f"go: {len(modules)} modules" + (f", {len(missing)} without a licence file" if missing else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
