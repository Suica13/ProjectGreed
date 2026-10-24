const test = require("node:test"),
  assert = require("node:assert/strict");
const ART = require("../tools/load-catalog.cjs").loadCatalog();
test("all unit parts, weapon mounts and shared animation curves use semantic bone names", () => {
  const old = /^(arm|leg)\d+$/;
  for (const p of ART.prefabs) {
    assert.ok(p.skeleton.Body && p.skeleton.Head && p.skeleton.Eye);
    assert.ok(Object.keys(p.skeleton).every((k) => !old.test(k)));
    for (const layer of p.layers) assert.ok(p.skeleton[layer.bone], p.id + "/" + layer.name);
    for (const kit of p.weaponKits)
      for (const w of ART.models[p.id + "__" + kit.id].weapons)
        for (const m of w.muzzle?.mounts || (w.muzzle ? [w.muzzle] : []))
          if (m.bone) assert.ok(p.skeleton[m.bone]);
    const clips = ART.units.find((u) => u.id === p.id + "__" + p.weaponKits[0].id).animations;
    for (const clip of Object.values(clips))
      for (const bone of Object.keys(clip.curves))
        assert.ok(!old.test(bone) && p.skeleton[bone], p.id + "/" + bone);
  }
});
test("Zaku and Dom kits include the native eye layer above the head and Dom uses only eye 1", () => {
  for (const id of ["MS_06F", "MS_06J", "MS_06K", "MS_09"]) {
    const p = ART.prefabs.find((p) => p.id === id);
    const eyes = p.layers.filter((l) => l.name === "Eye");
    assert.equal(eyes.length, 1);
    const eye = eyes[0],
      head = p.layers.find((l) => l.name === "Head");
    assert.equal(eye.bone, "Eye");
    assert.equal(eye.texture, id + "_Eye_1.png");
    assert.equal(eye.scale, 1.5);
    assert.equal(eye.offset.y, id === "MS_09" ? 1 : 2.5);
    assert.ok(eye.order > head.order);
    assert.equal(eye.visibleWhen.visorClosed, false);
    for (const k of p.weaponKits) {
      const u = ART.units.find((u) => u.id === id + "__" + k.id),
        layer = u.decals.find((l) => l.name === "Eye");
      assert.match(ART.assets[layer.asset], /^data:image\/png;base64,/);
    }
  }
});
test("Dom bazooka uses 380mm across runtime weapon IDs, names, kits, layers and textures", () => {
  const p = ART.prefabs.find((p) => p.id === "MS_09"),
    w = ART.models.MS_09__bazooka.weapons[0];
  assert.equal(w.id, "ZN_380mmBazooka");
  assert.equal(w.name, "380mm火箭筒");
  assert.equal(w.sourceName, "ZN_380mmBazooka");
  assert.equal(w.muzzle.layer, "ZN_380mmBazooka");
  assert.ok(p.materials.textures["ZN_380mmBazooka.png"]);
  for (const lang of ["zh", "en", "ja"]) assert.ok(w.localization[lang].name.includes("380mm"));
  assert.ok(p.weaponKits.find((k) => k.id === "bazooka").weapons.includes(w.id));
  const runtime = JSON.parse(JSON.stringify(p));
  for (const weapon of Object.values(runtime.weapons)) delete weapon.source;
  assert.doesNotMatch(JSON.stringify(runtime), /360mm/);
});
