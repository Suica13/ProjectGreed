"""Create the standalone client ZIP after npm run build. Uses only Python's standard library."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
client = root / 'public/client.html'
notes = root / 'dist/客户端使用说明.txt'
archive = root / 'dist/0079-SLG-client.zip'
with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=9) as bundle:
    bundle.write(client, 'client.html')
    bundle.write(notes, notes.name)
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert bundle.read('client.html') == client.read_bytes()
print(f'Packaged {archive.name}: {archive.stat().st_size} bytes; verified client contents and ZIP integrity.')
