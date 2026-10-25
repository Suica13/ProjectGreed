"""Read-only source audit for every ship attachment; --write refreshes the review table."""
import json
import sys
from mod_source import ASSETS, ROOT, load, section
from native_ship_arcs import module_source
from native_ship_presentation import artwork


def audit():
    rows = []
    for ref in json.loads((ASSETS / "unit-catalog.json").read_text(encoding="utf-8"))["units"]:
        p = json.loads((ASSETS / ref).read_text(encoding="utf-8"))
        if not p["stats"].get("ship"):
            continue
        native = load(ROOT / p["source"].split("/", 1)[1])
        modules = p["stats"]["modules"]
        native_ids = set()
        for key in native:
            if not key.startswith("attachment_") or not any(t in key for t in ["Turret", "Weapon"]):
                continue
            a = section(native, key)
            if a.get("onCreateSpawnUnitOf") or native.get("hiddenAction_" + key, {}).get("attachments_addNewUnits"):
                native_ids.add(key[11:])
        assert native_ids == {m["id"] for m in modules}, (p["id"], "native attachment mismatch")
        body = [l["order"] for l in p["layers"] if l["name"] in ["Hull", "Body", "Body_2"]]
        images = below = 0
        for module in modules:
            attachment, data, source = module_source(native, module)
            expected = artwork(data)
            layers = [l for l in p["layers"] if l.get("moduleId") == module["id"]]
            assert len(layers) == len(expected), (p["id"], module["id"], "missing or extra art")
            assert p["skeleton"][module["bone"]]["endDirOffset"] == module["idleDir"]
            visual = module["visual"]
            assert visual["separateSprite"] == bool(expected)
            for layer, (_, original) in zip(layers, expected):
                assert (ASSETS / ref).parent.joinpath(p["materials"]["textures"][layer["texture"]]).exists()
                for key, native_key in [("scale","imageScale"),("scaleX","imageScaleX"),("scaleY","imageScaleY"),("rotation","dirOffset")]:
                    assert layer[key] == float(original.get(native_key, 0 if key == "rotation" else 1))
                assert not layer.get("hidden") and not layer.get("requiredParts")
                assert layer["order"] < min(body) if visual["belowHull"] else layer["order"] > max(body)
            images += bool(expected)
            below += bool(expected) and visual["belowHull"]
        rows.append((p["id"], p["name"], len(modules), images, len(modules)-images, below))
    print(f"Ship turret source audit passed: {len(rows)} ships, {sum(r[2] for r in rows)} modules, {sum(r[3] for r in rows)} separate sprites.")
    if "--write" in sys.argv:
        lines = ["# 战舰炮塔核对", "", "按当前目录逐舰核对原MOD附件、独立炮塔贴图、层级、镜像、旋转和默认方向。可运行 `python tools/audit-ship-turrets.py` 重新校验；加 `--write` 更新本表。", "", "原MOD部分导弹、防空导弹、炸弹发射点没有独立贴图，仅有内部发射挂点；表中单独计数，不把这些模块误判成漏导。标记Ring、状态特效不算物理炮塔。", "", "普通炮塔排在舰体上方；原MOD明确 setDrawLayerOnBottom 的模块保留在舰体下方。舰桥同样作为独立模块贴图导入。损坏模块保留贴图并播放小尺寸电流，开火仍禁用。", "", "待机、规划、被攻击和演出结束后保持原生默认方向；仅当前武器仍完好且射界合法的炮塔在开火演出期间瞄准。规则始终使用舰体方向＋原生idleDir＋固定射界判断，显示旋转不参与判定。", "", "| ID | 舰名 | 模块 | 独立贴图模块 | 原生无独立贴图 | 原生下层贴图 |", "| --- | --- | ---: | ---: | ---: | ---: |"]
        lines += ["| " + " | ".join(map(str, row)) + " |" for row in rows]
        (ASSETS.parent / "战舰炮塔核对.md").write_text("\n".join(lines)+"\n", encoding="utf-8")
    return rows


if __name__ == "__main__":
    audit()
