"""Create the standalone client ZIP after npm run build. Uses only Python's standard library."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import shutil

root = Path(__file__).resolve().parents[1]
client = root / 'public/client.html'
notes = root / 'docs/tools/client-package.md'
project = json.loads((root / 'project.json').read_text(encoding='utf-8'))
output = root / 'build' / project['version']
output.mkdir(parents=True, exist_ok=True)
folder = output / f'{project["name"]}-{project["version"]}-client'
folder.mkdir(exist_ok=True)
for name in ['client.html']:
    shutil.copy2(root / 'public' / name, folder / name)
shutil.copytree(root / 'admin', folder / 'admin', dirs_exist_ok=True)
archive = output / f'{project["name"]}-{project["version"]}-client.zip'
with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=9) as bundle:
    bundle.write(client, 'client.html')
    for tool in sorted((root / 'admin').glob('*.html')):
        bundle.write(tool, 'admin/' + tool.name)
    bundle.write(notes, '使用说明.md')
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert bundle.read('client.html') == client.read_bytes()
print(f'Packaged {archive.name}: {archive.stat().st_size} bytes; verified client contents and ZIP integrity.')
