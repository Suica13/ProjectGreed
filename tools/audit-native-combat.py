"""重新读取原 MOD，核对全部预制体的资源和原生武器流程。只读，不修复文件。"""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import copy
import json
from pathlib import Path
from mod_source import ASSETS, ROOT, load, stat
from native_combat import native_weapon
from unit_energy import capacity_for
from weapon_policy import federation_space_turret_damage


def main():
    units = weapons = 0
    fields = ["damageComponents", "damagePerShot", "hit", "sourceHit", "en", "attack", "nativeTiming"]
    for file in (ASSETS / "units").glob("*/unit.json"):
        unit = load_source_json(file.read_text(encoding="utf-8"))
        native = load(ROOT / unit["source"].split("/", 1)[1])
        expected = (float(native["core"]["maxHp"]), capacity_for(unit["id"], stat(native, "enMax")), float(native["core"].get("maxShield", 0)))
        actual = (unit["stats"]["hp"], unit["stats"]["en"], unit["shield"]["hp"])
        assert actual == expected, (unit["id"], actual, expected)
        units += 1
        for key, weapon in unit["weapons"].items():
            rebuilt = native_weapon(unit, copy.deepcopy(weapon), native)
            rebuilt.pop("tacticalDamageMultiplier", None)
            federation_space_turret_damage({"id": unit["id"], "weapons": {key: rebuilt}})
            # Compare the preserved pre-policy payload for the explicit 50% charged-snipe rule.
            audited = copy.deepcopy(weapon)
            if weapon.get("special", {}).get("type") == "snipe":
                audited.update(audited["sniperDamageBeforeHalving"])
                for step in audited["attack"]["steps"]:
                    baseline = step.pop("sniperDamageBeforeHalving", None)
                    if baseline is not None:
                        step["damageComponents"] = baseline
            for field in fields:
                if field == "attack":
                    # Native source owns event count, order and delay. Muzzle indices are a
                    # ProjectGreed layout adaptation after L/R and fake-turret merging.
                    actual_attack = copy.deepcopy(audited[field])
                    rebuilt_attack = copy.deepcopy(rebuilt[field])
                    for attack in [actual_attack, rebuilt_attack]:
                        for step in attack.get("steps", []):
                            step.pop("muzzleIndex", None)
                    assert actual_attack == rebuilt_attack, (unit["id"], key, field)
                    mount_count = len(weapon.get("muzzle", {}).get("mounts", [weapon.get("muzzle", {})]))
                    assert all(
                        0 <= step.get("muzzleIndex", 0) < mount_count
                        for step in weapon[field].get("steps", [])
                        if step.get("shots", 0) > 0
                    ), (unit["id"], key, "muzzleIndex")
                else:
                    assert audited[field] == rebuilt[field], (unit["id"], key, field)
            weapons += 1
    print(f"Native source audit passed: {units} prefabs, {weapons} weapon configurations.")


if __name__ == "__main__":
    main()
