const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { discoverUnits, nextCatalog } = require("../tools/reload-units.cjs"),
  { loadCatalog } = require("../tools/load-catalog.cjs");
function i18n(languages, saved, body = { nodeType: 0 }) {
  const values = new Map(saved ? [["projectgreed.language", saved]] : []);
  const context = {
    navigator: { languages },
    localStorage: {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
    },
    document: { body, documentElement: {}, querySelectorAll: () => [] },
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

test("native introductions retain their content and now provide Japanese descriptions", () => {
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
  for (const prefab of catalog.prefabs.filter((p) => Object.hasOwn(expected, p.id))) {
    assert.equal(prefab.description, expected[prefab.id]);
    assert.equal(prefab.localization.zh.description, prefab.description);
    assert.ok(prefab.localization.en.description.length > 0);
    assert.ok(prefab.localization.ja.description.length > 0);
    assert.notEqual(prefab.localization.ja.description, prefab.localization.en.description);
    for (const line of [prefab.description, prefab.localization.en.description])
      assert.doesNotMatch(line, /\\n|[\r\n]|Strengths|Weaknesses|优点|缺点/);
    for (const model of Object.values(catalog.models).filter((m) => m.prefabId === prefab.id))
      assert.equal(model.description, prefab.description);
  }
});

test("room, skill and return messages are localized in both languages", () => {
  for (const language of ["en", "ja"]) {
    const api = i18n([language]);
    for (const text of [
      "选择出生点",
      "AI行动阶段",
      "冷却中",
      "请选择高亮的合法技能目标。",
      "30秒后所有人返回房间",
    ])
      assert.notEqual(api.text(text), text, language + ": " + text);
    assert.match(api.text("30秒后所有人返回房间"), /30/);
  }
});
test("binding the catalog invalidates earlier untranslated cache entries", () => {
  const api = i18n(["en"]);
  assert.equal(api.text("测试新机体"), "测试新机体");
  api.bindCatalog({
    prefabs: [
      {
        name: "测试新机体",
        localization: { en: { name: "Test unit" } },
        weaponKits: [],
        weapons: {},
      },
    ],
    models: {},
  });
  assert.equal(api.text("测试新机体"), "Test unit");
});

test("form hints translate while player-entered values remain untouched", () => {
  const attrs = { placeholder: "选择出生点", title: "技能" };
  const input = {
    nodeType: 1,
    tagName: "INPUT",
    value: "玩家输入的名字",
    childNodes: [],
    closest: () => null,
    hasAttribute: (name) => Object.hasOwn(attrs, name),
    getAttribute: (name) => attrs[name],
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
  };
  const api = i18n(["en"], undefined, input);
  api.refresh();
  assert.equal(attrs.placeholder, "Choose spawn point");
  assert.equal(attrs.title, "Skill");
  assert.equal(input.value, "玩家输入的名字");
  api.setLanguage("ja");
  assert.equal(attrs.placeholder, "出撃地点を選択");
  api.setLanguage("zh");
  assert.equal(attrs.placeholder, "选择出生点");
});

test("new UI terminology, precise patterns and canonical kit names localize in both languages", () => {
  for (const language of ["en", "ja"]) {
    const api = i18n([language]);
    for (const message of [
      "生产单位",
      "尚未开发",
      "一键生产",
      "确认强化",
      "导出存档",
      "资金",
      "物资",
      "本局收益：资金 400 · 物资 300 · 损毁扣除 2 台",
    ])
      assert.notEqual(api.text(message), message);
    const catalog = loadCatalog();
    api.bindCatalog(catalog);
    assert.equal(
      catalog.models.Type61__standard.kitName,
      language === "en" ? "Standard kit" : "標準装備",
    );
    assert.equal(
      catalog.models.RX_80PR_2__kit_0.kitName,
      language === "en" ? "Composite launcher kit" : "複合ランチャー装備",
    );
  }
  assert.equal(i18n(["en"]).text("编组单位点数: 7 / 72"), "Formation points: 7 / 72");
});

test("every catalog unit, weapon, kit and skill has English and Japanese display text", () => {
  const catalog = loadCatalog();
  for (const p of catalog.prefabs) {
    for (const language of ["en", "ja"]) {
      for (const field of ["name", "description"]) {
        assert.ok(p.localization?.[language]?.[field]?.trim(), p.id + "/" + language + "/" + field);
      }
      for (const item of [...Object.values(p.weapons), ...p.weaponKits, ...(p.skills || [])])
        assert.ok(
          item.localization?.[language]?.name?.trim(),
          p.id + "/" + item.name + "/" + language,
        );
    }
  }
});
test("curated display overlays survive reimport without changing gameplay or source names", () => {
  const localize = require("../tools/display-localization.cjs").createLocalizer();
  const p = JSON.parse(fs.readFileSync("assets/units/MSM_03/unit.json"));
  const original = structuredClone(p);
  localize.prefab(p);
  assert.equal(p.localization.ja.name, "ゴッグ");
  assert.deepEqual(p.stats, original.stats);
  assert.deepEqual(
    p.weaponKits.map((k) => k.weapons),
    original.weaponKits.map((k) => k.weapons),
  );
  assert.equal(p.id, original.id);
  assert.equal(p.name, original.name);
  for (const [id, weapon] of Object.entries(p.weapons)) {
    const { localization, ...rest } = weapon;
    const { localization: oldLocalization, ...oldRest } = original.weapons[id];
    assert.deepEqual(rest, oldRest);
  }
});
test("all ACE names, biographies and skill descriptions have Japanese translations", () => {
  const data = require("../tools/display-localization.cjs")
    .createLocalizer()
    .pilotCatalog(JSON.parse(fs.readFileSync("shared/pilots.json")));
  for (const ace of data.aces) {
    assert.ok(ace.localization.ja.name, ace.id);
    assert.ok(ace.localization.ja.description, ace.id);
    for (const skill of ace.skills)
      for (const field of ["name", "description"])
        assert.ok(skill.localization?.ja?.[field], ace.id + "/" + skill.id + "/" + field);
  }
});
test("locale dictionaries have matching keys and preserve template placeholders", () => {
  const en = JSON.parse(fs.readFileSync("client/locales/en.json"));
  const ja = JSON.parse(fs.readFileSync("client/locales/ja.json"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort());
  const tokens = (text) => (text.match(/\{\w+\}/g) || []).sort();
  for (const key of Object.keys(en)) {
    assert.deepEqual(tokens(en[key]), tokens(key), key + "/en");
    assert.deepEqual(tokens(ja[key]), tokens(key), key + "/ja");
  }
});

test("dynamic skill and command descriptions translate completely and preserve values", () => {
  const catalog = loadCatalog();
  const api = i18n(["en"]);
  api.bindCatalog(catalog);
  const context = { I18n: api, UnitModels: catalog.models };
  vm.runInNewContext(
    fs.readFileSync("client/skill-controls.js", "utf8") + ";globalThis.skills=SkillControls;",
    context,
  );
  for (const p of catalog.prefabs) {
    for (const skill of p.skills || []) {
      const text = api.text(context.skills.description(skill));
      assert.doesNotMatch(text, /[\u3400-\u9fff]/, p.id + "/" + skill.id + ": " + text);
    }
  }
  for (const model of Object.values(catalog.models))
    for (const item of [
      ...context.skills.commandAbilities(model),
      ...context.skills.defensiveAbilities(model),
    ])
      assert.doesNotMatch(
        api.text(item.description),
        /[\u3400-\u9fff]/,
        model.prefabId + ": " + item.description,
      );
  const sample =
    "独立耐久 250,000；吸收普通远程光束95%、贯穿光束50%，不影响实弹和格斗。耐久耗尽后失效，可过载至最大耐久的25%；每个己方回合恢复25%。";
  assert.match(api.text(sample), /250,000/);
  assert.doesNotMatch(api.text(sample), /[\u3400-\u9fff]/);
  api.setLanguage("ja");
  assert.match(api.text(sample), /250,000/);
  assert.match(api.text(sample), /独立耐久/);
});
