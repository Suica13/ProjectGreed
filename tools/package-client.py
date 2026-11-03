"""Create the standalone client ZIP after npm run build. Uses only Python's standard library."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
client = root / 'public/client.html'
notes = root / 'dist/客户端使用说明.txt'
project = json.loads((root / 'project.json').read_text(encoding='utf-8'))
archive = root / f'dist/{project["name"]}-{project["version"]}-client.zip'
with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=9) as bundle:
    bundle.write(client, 'client.html')
    bundle.write(root / 'public/map-editor.html', 'map-editor.html')
    bundle.write(root / 'public/unit-editor.html', 'unit-editor.html')
    if notes.exists():
        bundle.write(notes, notes.name)
    else:
        bundle.writestr(notes.name, (
            f'{project["name"]} {project["version"]} 客户端\n\n'
            '请将全部文件解压到同一目录。\n'
            'client.html：游戏客户端，可独立打开；联机时输入游戏服务器地址。\n'
            'map-editor.html：地图编辑器。\n'
            'unit-editor.html：MS单位工坊，支持ProjectGreed单位及RW_GW模板覆盖包导出。\n'
            'RW_GW导出包依赖原MOD及0079 DLC，具体限制见工坊内的导出提示。\n'
        ).encode('utf-8-sig'))
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert bundle.read('client.html') == client.read_bytes()
print(f'Packaged {archive.name}: {archive.stat().st_size} bytes; verified client contents and ZIP integrity.')
