"""重新读取原 MOD，核对全部预制体的资源和原生武器流程。只读，不修复文件。"""
import copy
import json
from pathlib import Path
from mod_source import ASSETS, ROOT, load, stat
from native_combat import native_weapon


def main():
    units = weapons = 0
    fields = ["damageComponents", "damagePerShot", "hit", "sourceHit", "en", "attack", "nativeTiming"]
    for file in (ASSETS / "units").glob("*/unit.json"):
        unit = json.loads(file.read_text(encoding="utf-8"))
        native = load(ROOT / unit["source"].split("/", 1)[1])
        expected = (float(native["core"]["maxHp"]), stat(native, "enMax"), float(native["core"].get("maxShield", 0)))
        actual = (unit["stats"]["hp"], unit["stats"]["en"], unit["shield"]["hp"])
        assert actual == expected, (unit["id"], actual, expected)
        units += 1
        for key, weapon in unit["weapons"].items():
            rebuilt = native_weapon(unit, copy.deepcopy(weapon), native)
            for field in fields:
                assert weapon[field] == rebuilt[field], (unit["id"], key, field)
            weapons += 1
    print(f"Native source audit passed: {units} prefabs, {weapons} weapon configurations.")


if __name__ == "__main__":
    main()
