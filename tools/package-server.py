"""Build a server-only Windows ZIP, including Node but no game client/media.

Run via npm run package:server. No npm/Python/install step is needed on the host.
Local server-data, cfg overrides, tests, dev dependencies and compressed HTML
are deliberately excluded from distribution.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ["server-activities.cjs", "open-server-activities.cjs"]


def main():
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js >=22 is required on the packaging machine.")
    runtime = json.loads(subprocess.check_output([
        node, "-p", "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})"
    ], text=True))
    if runtime["platform"] != "win32" or int(runtime["version"].split(".")[0][1:]) < 22:
        raise SystemExit("Package on Windows using Node.js >=22.")
    project = json.loads((ROOT / "project.json").read_text(encoding="utf-8"))
    name = f'{project["name"]}-{project["version"]}-server-only-win32-{runtime["arch"]}'
    output = ROOT / "build"
    output.mkdir(exist_ok=True)
    # Cache the full upstream notices for the exact runtime being redistributed.
    license_file = output / f'node-{runtime["version"]}-LICENSE.txt'
    if not license_file.exists():
        url = f'https://raw.githubusercontent.com/nodejs/node/{runtime["version"]}/LICENSE'
        with urllib.request.urlopen(url, timeout=45) as response:
            license_text = response.read()
        if b"Copyright Node.js contributors" not in license_text:
            raise SystemExit("Unexpected Node license response; packaging aborted.")
        license_file.write_bytes(license_text)
    with tempfile.TemporaryDirectory(prefix="server-package-", dir=output) as temporary:
        stage = Path(temporary) / name
        stage.mkdir()
        for directory in ["shared", "admin"]:
            shutil.copytree(ROOT / directory, stage / directory,
                            ignore=shutil.ignore_patterns("__pycache__", "*.log", "*.tmp", "asset-pool.js"))
        for filename in ["server.js", "project.json", "start_server.bat"]:
            shutil.copy2(ROOT / filename, stage / filename)
        (stage / "cfg.json").write_text('{"port":1313}\n', encoding="utf-8")
        for filename in TOOLS:
            destination = stage / "tools" / filename
            destination.parent.mkdir(exist_ok=True)
            shutil.copy2(ROOT / "tools" / filename, destination)
        catalog = subprocess.check_output([node, str(ROOT / "tools/export-server-catalog.cjs")], cwd=ROOT)
        parsed = json.loads(catalog)
        assert parsed["models"] and parsed["prefabs"] and parsed["maps"]
        assert not parsed["assets"] and not parsed["sounds"]
        (stage / "shared/server-catalog.json").write_bytes(catalog)
        # Adapter selects prevalidated metadata without ever reading textures or client files.
        (stage / "tools/load-catalog.cjs").write_text(
            '\"use strict\";\nconst catalog = require(\"../shared/server-catalog.json\");\n'
            'module.exports = { loadCatalog: () => catalog };\n', encoding="utf-8")
        shutil.copytree(ROOT / "node_modules/ws", stage / "node_modules/ws")
        (stage / "runtime").mkdir()
        shutil.copy2(node, stage / "runtime/node.exe")
        shutil.copy2(license_file, stage / "runtime/LICENSE.txt")
        (stage / "open_activities.bat").write_text(
            '@echo off\nsetlocal\nchcp 65001 >nul\ncd /d "%~dp0"\n'
            '"%~dp0runtime\\node.exe" "tools\\open-server-activities.cjs"\n'
            'if errorlevel 1 pause\n', encoding="utf-8", newline="\r\n")
        shutil.copy2(ROOT / "服务器独立包说明.md", stage / "使用说明.md")
        files = sorted(p for p in stage.rglob("*") if p.is_file())
        manifest = {"mode":"server-only", "project":project, "runtime":runtime, "files":{
            p.relative_to(stage).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in files
        }}
        (stage / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        archive = output / (name + ".zip")
        with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=6) as bundle:
            for file in sorted(stage.rglob("*")):
                if file.is_file():
                    bundle.write(file, Path(name) / file.relative_to(stage))
        with ZipFile(archive) as bundle:
            broken = bundle.testzip()
            if broken:
                raise SystemExit("ZIP integrity failure: " + broken)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        archive.with_suffix(".zip.sha256").write_text(digest + "  " + archive.name + "\n", encoding="ascii")
        print(f"Packaged {archive}: {archive.stat().st_size / 1024**2:.1f} MiB; ZIP verified.")


if __name__ == "__main__":
    main()
