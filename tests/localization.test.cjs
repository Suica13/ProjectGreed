const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { discoverUnits, nextCatalog } = require("../tools/reload-units.cjs"),
  { loadCatalog } = require("../tools/load-catalog.cjs");
function i18n(languages, saved) {
  const values = new Map(saved ? [["projectgreed.language", saved]] : []);
  const context = {
    navigator: { languages },
    localStorage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    },
    document: { body: { nodeType: 0 }, documentElement: {}, querySelectorAll: () => [] },
    window: { dispatchEvent() {} },
    CustomEvent: class {},
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    UI_LOCALES: {
      en: JSON.parse(fs.readFileSync("client/locales/en.json")),
      ja: JSON.parse(fs.readFileSync("client/locales/ja.json")),
    },
  };
  vm.runInNewContext(fs.readFileSync("client/i18n.js", "utf8") + ";globalThis.api=I18n;", context);
  return context.api;
}
test("locale detection supports regional variants, browser preference order, English fallback and saved selection", () => {
  assert.equal(i18n(["zh-TW"]).language, "zh");
  assert.equal(i18n(["ja-JP"]).language, "ja");
  assert.equal(i18n(["fr-FR", "en-GB", "ja-JP"]).language, "en");
  assert.equal(i18n(["fr-FR", "ja-JP"]).language, "ja");
  assert.equal(i18n(["fr-FR"]).language, "en");
  assert.equal(i18n(["en-US"], "ja").language, "ja");
  assert.equal(i18n(["ja-JP"], "invalid").language, "ja");
});
test("unit and weapon localization changes display names only and falls back to English", () => {
  const api = i18n(["en-US"]),
    catalog = loadCatalog(),
    model = catalog.models.RGM_79__bazooka;
  const original = JSON.parse(JSON.stringify(model));
  api.bindCatalog(catalog);
  assert.equal(model.name, "GM");
  assert.equal(model.weapons[0].name, "Hyper Bazooka");
  api.setLanguage("ja");
  assert.equal(model.name, "ジム");
  assert.equal(model.weapons[0].name, "ハイパー・バズーカ");
  assert.equal(model.weapons[0].id, original.weapons[0].id);
  assert.equal(model.weapons[0].damage, original.weapons[0].damage);
  assert.deepEqual(catalog.prefabs[0].weaponKits[2].weapons, [
    "EF_HypeBazooka",
    "EF_BeamSaber_A",
    "Common_DoubleVulcan_MS",
    "Common_Push_A",
  ]);
  assert.equal(
    api.localized({ name: "旧名称", localization: { en: { name: "English only" } } }),
    "English only",
  );
  api.setLanguage("zh");
  assert.equal(model.name, "吉姆");
});
test("UI messages preserve dynamic values and translate unit names in server text", () => {
  const api = i18n(["en-US"]);
  api.bindCatalog(loadCatalog());
  assert.equal(api.text("队伍1结束回合"), "Team 1 ends its turn");
  assert.equal(api.text("回合2"), "Turn 2");
  assert.equal(api.text("吉姆"), "GM");
  api.setLanguage("ja");
  assert.equal(api.text("队伍2开始行动"), "チーム2 行動開始");
});
test("unit discovery includes new files, omits disabled units and preserves existing order", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "projectgreed-units-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, enabled] of [
    ["NEW", true],
    ["OFF", false],
    ["OLD", true],
  ]) {
    fs.mkdirSync(path.join(root, "units", name), { recursive: true });
    fs.writeFileSync(
      path.join(root, "units", name, "unit.json"),
      JSON.stringify({ id: name, enabled }),
    );
  }
  const found = discoverUnits(path.join(root, "units"));
  assert.deepEqual(found, ["units/NEW/unit.json", "units/OLD/unit.json"]);
  assert.deepEqual(
    nextCatalog(
      { units: ["units/OLD/unit.json", "units/REMOVED/unit.json"], formation: { maxUnits: 9 } },
      found,
    ).units,
    ["units/OLD/unit.json", "units/NEW/unit.json"],
  );
  fs.writeFileSync(path.join(root, "units/NEW/unit.json"), "{broken");
  assert.throws(() => discoverUnits(path.join(root, "units")), /Invalid unit JSON/);
});
test("catalog preflight rejects duplicate IDs without writing the real catalog", () => {
  const file = "assets/unit-catalog.json",
    before = fs.readFileSync(file),
    catalog = JSON.parse(before);
  assert.throws(
    () =>
      loadCatalog({ catalogOverride: { ...catalog, units: [catalog.units[0], catalog.units[0]] } }),
    /Invalid prefab/,
  );
  assert.deepEqual(fs.readFileSync(file), before);
  const source = JSON.parse(fs.readFileSync("assets/units/RGM_79/unit.json"));
  assert.equal(source.localization.en.name, "GM");
  assert.equal(loadCatalog().models.RGM_79__bazooka.kitLocalization.ja.name, "バズーカ装備");
});

test("native introductions keep only the first content line and missing Japanese descriptions fall back to English", () => {
  const catalog = loadCatalog();
  const expected = {
    SalamisClass: "地球联邦军舰队主力战舰",
    RX_78_1: "联邦军试作型白刃战用MS,具备碾压扎古的性能",
    FF_X7: "V计划产物之一,皆在保护MS驾驶员的安全",
    RGM_79: "联邦军主力泛用型MS",
    RGC_80: "擅长中距离支援的炮击型MS",
    RGM_79L: "拥有极高机动性的强袭型MS",
    MS_06F: "最广为人知的MS,各项性能较为平衡",
    MS_06J: "为适应重力作战进行了改装的扎古",
    MS_06K: "为进行对空作战而开发的机体",
    MS_09: "采用气垫移动的重型MS,擅长据点破坏任务",
    RGM_79_G: "由陆战型高达再设计而来的泛用型MS",
    MS_14A: "吉翁军一年战争末期所开发的MS,性能匹敌高达",
    RX_79_G: "由V作战不合格零件设计组装而来的泛用型MS",
    MS_06F2: "扎古II的后期改修型,加强了装甲与推进器",
    MS_09R: "大魔的宇宙战式样,性能差强人意",
  };
  for (const prefab of catalog.prefabs.filter(p => Object.hasOwn(expected,p.id))) {
    assert.equal(prefab.description, expected[prefab.id]);
    assert.equal(prefab.localization.zh.description, prefab.description);
    assert.ok(prefab.localization.en.description.length > 0);
    assert.equal(prefab.localization.ja.description, undefined);
    for (const line of [prefab.description, prefab.localization.en.description])
      assert.doesNotMatch(line, /\\n|[\r\n]|Strengths|Weaknesses|优点|缺点/);
    for (const model of Object.values(catalog.models).filter((m) => m.prefabId === prefab.id))
      assert.equal(model.description, prefab.description);
  }
});
