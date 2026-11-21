"""Read native unit categories through copyFrom; never write MOD files."""
import json, re, sys
from pathlib import Path
import mod_source as source
root = Path(sys.argv[1])
source.MOD = root.parent
source.ROOT = root
records = []
for file in sorted((root / 'Units/SystemUnits/UnitCard/Single').glob('*.ini')):
    text = file.read_text(encoding='utf-8-sig')
    identity = re.search(r'@global\s+UnitID\s*=\s*([^\s,]+)', text)
    if not identity: continue
    data = source.load(file, root)
    category = source.stat(data, 'unitCategory', -1)
    if category in (0, 1, 2, 3):
        records.append({'id': identity[1], 'category': int(category), 'source': file.relative_to(root).as_posix()})
print(json.dumps(records, ensure_ascii=False))
