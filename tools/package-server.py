"""Build a server-only Windows ZIP, including Node but no game client/media.

Run via npm run package:server. No npm/Python/install step is needed on the host.
Only activity definitions are exported from local server-data; identities, claims,
progress, cfg overrides, tests, dev dependencies and compressed HTML are excluded.
"""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ["server-activities.cjs", "open-server-activities.cjs", "settlement-log.cjs", "state-outbox.cjs"]


def main():
    parser = argparse.ArgumentParser(description="Package the Windows server with its runtime.")
    parser.add_argument("--folder", action="store_true", help="Keep an unpacked folder; do not create a ZIP.")
    parser.add_argument("--with-client", action="store_true", help="Include the built standalone client and serve it over HTTP.")
    args = parser.parse_args()
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js >=22 is required on the packaging machine.")
    runtime = load_source_json(subprocess.check_output([
        node, "-p", "JSON.stringify({version:process.version,platform:process.platform,arch:process.arch})"
    ], text=True))
    if runtime["platform"] != "win32" or int(runtime["version"].split(".")[0][1:]) < 22:
        raise SystemExit("Package on Windows using Node.js >=22.")
    project = load_source_json((ROOT / "project.json").read_text(encoding="utf-8"))
    name = f'{project["name"]}-{project["version"]}-server-only-win32-{runtime["arch"]}'
    if args.with_client:
        name = name.replace("-server-only-", "-server-client-")
        client = ROOT / "public/client.html"
        if not client.is_file() or f'"version":"{project["version"]}"' not in client.read_text(encoding="utf-8"):
            raise SystemExit("Build the matching client first: npm run build")
    output = ROOT / "build" / project["version"]
    output.mkdir(parents=True, exist_ok=True)
    if args.folder and (output / name).exists():
        raise SystemExit(f"Output already exists; choose a new destination before packaging: {output / name}")
    # Cache the full upstream notices for the exact runtime being redistributed.
    license_cache = ROOT / "tmp/cache/packaging"
    license_cache.mkdir(parents=True, exist_ok=True)
    license_file = license_cache / f'node-{runtime["version"]}-LICENSE.txt'
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
        # The server creates authoritative dialogue records from the shared client generator.
        (stage / "client").mkdir()
        shutil.copy2(ROOT / "client/battle-dialogue.js", stage / "client/battle-dialogue.js")
        for filename in ["server.js", "project.json", "start_server.bat"]:
            shutil.copy2(ROOT / filename, stage / filename)
        (stage / "cfg.json").write_text('{"port":1313}\n', encoding="utf-8")
        if args.with_client:
            (stage / "public").mkdir()
            shutil.copy2(client, stage / "public/client.html")
            for editor in ["map-editor.html", "unit-editor.html"]:
                shutil.copy2(ROOT / "public" / editor, stage / "public" / editor)
        for filename in TOOLS + (["client-resources.cjs", "static-client.cjs"] if args.with_client else []):
            destination = stage / "tools" / filename
            destination.parent.mkdir(exist_ok=True)
            shutil.copy2(ROOT / "tools" / filename, destination)
        catalog = subprocess.check_output([node, str(ROOT / "tools/export-server-catalog.cjs")], cwd=ROOT)
        parsed = load_source_json(catalog)
        assert parsed["models"] and parsed["prefabs"] and parsed["maps"]
        assert not parsed["assets"] and not parsed["sounds"]
        (stage / "shared/server-catalog.json").write_bytes(catalog)
        # Snapshot the currently authored activities without distributing player/claim data.
        defaults = subprocess.check_output([node, str(ROOT / "tools/export-default-activities.cjs")], cwd=ROOT)
        (stage / "shared/default-activities.json").write_bytes(defaults)
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
        (stage / "docs").mkdir(exist_ok=True)
        if args.with_client:
            (stage / "docs/使用说明.md").write_text(
                f'# {project["name"]} {project["version"]} 服务端与客户端\n\n'
                '双击 start_server.bat 启动服务端。已附带 Node 与 ws，无需安装依赖。\n'
                '服务器默认端口1313，可修改 cfg.json 后重启。网页客户端：http://127.0.0.1:1313/ 。\n'
                '其他玩家可在浏览器访问 http://服务器IP:1313/，也可复制 public/client.html 独立打开后输入服务器IP连接。\n'
                '地图编辑器：http://127.0.0.1:1313/map-editor.html；单位工坊：http://127.0.0.1:1313/unit-editor.html 。\n'
                'open_activities.bat 用于本机活动管理。关闭CMD窗口或按 Ctrl+C 停服。\n'
                '首次启动从 shared/default-activities.json 初始化活动；运行后生成的 server-data 为活动、领取记录与结算日志，升级时请保留。发行包不包含打包者的玩家、领取记录及累计进度。\n'
                '房间与对局在内存中，停服不会保留。manifest.json 记录发行文件的 SHA-256。\n', encoding="utf-8")
        else:
            shutil.copy2(ROOT / "docs/tools/server-package.md", stage / "docs/使用说明.md")
        files = sorted(p for p in stage.rglob("*") if p.is_file())
        manifest = {"mode":"server-client" if args.with_client else "server-only", "project":project, "runtime":runtime, "files":{
            p.relative_to(stage).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in files
        }}
        (stage / "manifest.json").write_text(dump_source_json(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        if args.folder:
            destination = output / name
            shutil.move(str(stage), str(destination))
            total = sum(p.stat().st_size for p in destination.rglob("*") if p.is_file())
            print(f"Packaged folder {destination}: {total / 1024**2:.1f} MiB; no ZIP created.")
            return
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
