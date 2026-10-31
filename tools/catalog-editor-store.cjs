/* Local source editor. Never imported by the game server. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { isDeepStrictEqual: equal } = require("node:util");
const Schema = require("../shared/catalog-editor-schema.js"),
  Codec = require("./weapon-store.cjs");
const Adjust = require("../shared/catalog-adjustments.cjs");
const Conversion = require("../shared/conversion-rules.cjs");
const encode = (value) => JSON.stringify(value, null, 2) + "\n";
function createEditorStore(root = path.resolve(__dirname, ".."), validate = null) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  const balance = (unit) =>
    require("./weapon-balance.cjs").applyWeaponBalance(unit, Conversion.read(root));
  const registered = () => read("assets/unit-catalog.json").units;
  const library = () => read("assets/weapons.json");
  const unitFiles = () => registered().map((ref) => ({ ref, raw: read("assets/" + ref) }));
  const find = (id) => {
    const result = unitFiles().find((item) => item.raw.id === id);
    if (!result) throw Error("单位不存在：" + id);
    return result;
  };
  function revision() {
    return crypto
      .createHash("sha256")
      .update(
        [
          "assets/weapons.json",
          Adjust.file,
          Conversion.file,
          "shared/production-catalog.json",
          "assets/localization/units.json",
          "assets/unit-catalog.json",
          "shared/development-tree.json",
          "shared/pilots.json",
          "assets/unit-wip.json",
          ...registered().map((ref) => "assets/" + ref),
        ]
          .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
          .join("\n"),
      )
      .digest("hex");
  }
  function getUnit(id) {
    const { raw } = find(id),
      unit = Adjust.unit(
        balance(Codec.expandPrefab(raw, library().definitions)),
        read(Adjust.file),
        raw.weapons,
      ),
      translations = read("assets/localization/units.json")[id];
    for (const language of ["en", "ja"])
      if (translations?.[language]) {
        unit.localization ??= {};
        unit.localization[language] = { ...unit.localization[language], ...translations[language] };
      }
    return {
      revision: revision(),
      unit,
      weaponViews: structuredClone(unit.weapons),
      price:
        Adjust.production(read("shared/production-catalog.json"), read(Adjust.file)).licenseOffers[
          id
        ] || null,
      adjustments: read(Adjust.file).units[id] || {},
      baselines: {
        unit: Adjust.unit(
          balance(Codec.expandPrefab(raw, library().definitions)),
          { ...read(Adjust.file), units: {} },
          raw.weapons,
        ),
        price: read("shared/production-catalog.json").licenseOffers[id] || null,
      },
    };
  }
  function getWeapon(ref) {
    const weapon = library().definitions[ref];
    if (!weapon) throw Error("共用武器不存在：" + ref);
    return {
      revision: revision(),
      ref,
      weapon: Adjust.apply(structuredClone(weapon), read(Adjust.file).weapons[ref]),
      adjustments: read(Adjust.file).weapons[ref] || {},
      baseline: structuredClone(weapon),
    };
  }
  function templates() {
    const skills = new Map(),
      mechanisms = new Map(),
      definitions = library().definitions;
    for (const { raw } of unitFiles()) {
      const unit = Codec.expandPrefab(raw, definitions);
      for (const skill of unit.skills || [])
        if (Schema.safeSkillTypes.includes(skill.type) && !skill.formUnitId && !skill.spawn) {
          const key = skill.type + ":" + skill.id;
          if (!skills.has(key)) skills.set(key, { key, name: skill.name, value: skill });
        }
      for (const key of Schema.mechanismFields)
        if (unit.stats[key] !== undefined && !mechanisms.has(key))
          mechanisms.set(key, { key, name: Schema.labels[key], value: unit.stats[key] });
    }
    return { skills: [...skills.values()], mechanisms: [...mechanisms.values()] };
  }
  function assertRevision(expected) {
    if (expected !== revision())
      throw Object.assign(Error("项目文件已被其他编辑修改，请关闭后重新打开再编辑。"), {
        status: 409,
      });
  }
  function checkJSON(value) {
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw Error("非法字段");
        checkJSON(child);
      }
    if (typeof value === "number" && !Number.isFinite(value)) throw Error("数值无效");
  }
  function weaponChanges(original, candidate) {
    candidate = structuredClone(candidate);
    original = structuredClone(original);
    const next = structuredClone(original);
    for (const key of Schema.weaponFields) {
      if (Object.hasOwn(candidate, key)) next[key] = structuredClone(candidate[key]);
      else delete next[key];
    }
    const allowed = ["damageComponents", "accuracy", "partBreakModifier", "damageMultiplier"];
    const strip = (step) =>
      Object.fromEntries(Object.entries(step).filter(([key]) => !allowed.includes(key)));
    if (
      !equal(original.attack?.steps.map(strip), next.attack?.steps.map(strip)) ||
      !equal({ ...original.attack, steps: [] }, { ...next.attack, steps: [] })
    )
      throw Error("不可修改武器演出、枪口或发数");
    if (!equal(next, candidate)) throw Error("包含不可编辑的武器字段");
    for (const key of [
      "min",
      "max",
      "hit",
      "en",
      "actionCost",
      "damagePerShot",
      "partBreakModifier",
    ])
      if (next[key] !== undefined && (!Number.isFinite(next[key]) || next[key] < 0))
        throw Error("武器数值无效：" + key);
    require("../shared/weapon-classes.js").classify(next);
    if (next.min > next.max) throw Error("最小射程不能大于最大射程");
    if (!next.name?.trim()) throw Error("请填写武器名称");
    require("../shared/weapon-sequence.js").compile(next);
    return next;
  }
  function transaction(changes, metadata) {
    // Formatting-only saves must not create revisions, logs or exception entries.
    for (const [file, content] of changes)
      if (equal(JSON.parse(fs.readFileSync(path.join(root, file), "utf8")), JSON.parse(content)))
        changes.delete(file);
    if (!changes.size) return { ok: true, noChanges: true, revision: revision() };
    const Audit = require("./editor-audit.cjs"),
      record = Audit.planAudit(root, changes, metadata);
    const backups = new Map();
    const write = (file, content) => {
      const target = path.resolve(root, file);
      if (!target.startsWith(path.resolve(root) + path.sep)) throw Error("非法文件路径");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const previous = fs.existsSync(target) ? fs.readFileSync(target) : null;
      const temp = target + ".editor-tmp";
      try {
        fs.writeFileSync(temp, content);
        fs.renameSync(temp, target);
        if (!backups.has(target)) backups.set(target, previous);
      } finally {
        fs.rmSync(temp, { force: true });
      }
    };
    try {
      for (const [file, content] of changes) write(file, content);
      if (validate) validate();
      else require("./load-catalog.cjs").loadCatalog();
      const afterRevision = revision();
      for (const [file, content] of Audit.auditOutputs(root, record, afterRevision))
        write(file, content);
      return {
        ok: true,
        revision: afterRevision,
        auditId: record.id,
        auditLog: record.logFile,
        affectedUnits: record.units.map((unit) => unit.id),
      };
    } catch (error) {
      for (const [file, bytes] of [...backups].reverse()) {
        if (bytes === null) fs.rmSync(file, { force: true });
        else fs.writeFileSync(file, bytes);
      }
      throw error;
    }
  }
  function saveWeapon(payload, actor = {}) {
    assertRevision(payload.revision);
    checkJSON(payload);
    const lib = library(),
      original = lib.definitions[payload.ref];
    if (!original) throw Error("请选择共用武器模板");
    const registry = read(Adjust.file);
    const current = Adjust.apply(structuredClone(original), registry.weapons[payload.ref]);
    let candidate;
    if (original.sourceWeapon) {
      candidate = structuredClone(current);
      for (const field of ["weaponClass", "weaponMainClass", "weaponSubClass"]) {
        if (payload.weapon[field] === undefined) delete candidate[field];
        else candidate[field] = payload.weapon[field];
      }
      require("../shared/weapon-classes.js").classify(candidate);
      if (!equal(candidate, payload.weapon)) throw Error("武器技能仅支持修改换算分类");
    } else candidate = weaponChanges(current, payload.weapon);
    const captured = Adjust.capture(original, current, candidate, registry.weapons[payload.ref]);
    lib.definitions[payload.ref] = captured.source;
    if (Object.keys(captured.deltas).length) registry.weapons[payload.ref] = captured.deltas;
    else delete registry.weapons[payload.ref];
    return transaction(
      new Map([
        ["assets/weapons.json", encode(lib)],
        [Adjust.file, encode(registry)],
      ]),
      {
        operation: "weapon-template",
        target: { id: payload.ref, name: original.name },
        revision: payload.revision,
        actor,
      },
    );
  }
  function saveUnit(payload, actor = {}) {
    assertRevision(payload.revision);
    checkJSON(payload);
    const record = find(payload.id),
      lib = library(),
      original = getUnit(payload.id).unit,
      candidate = payload.unit;
    if (!candidate || !/^[A-Za-z0-9_]+$/.test(candidate.id))
      throw Error("单位ID只允许字母、数字和下划线");
    if (candidate.id !== original.id && unitFiles().some((item) => item.raw.id === candidate.id))
      throw Error("单位ID已存在");
    const next = structuredClone(original);
    for (const key of [
      "id",
      "code",
      "name",
      "localization",
      "tags",
      "availableFactions",
      "unitTags",
      "stats",
      "defenses",
      "shield",
      "attackBonuses",
      "skills",
      "mechanics",
    ])
      if (Object.hasOwn(candidate, key)) next[key] = structuredClone(candidate[key]);
      else delete next[key];
    next.presentation ??= {};
    next.presentation.previewScale = candidate.presentation?.previewScale ?? 1;
    if (
      !Number.isFinite(next.presentation.previewScale) ||
      next.presentation.previewScale <= 0 ||
      next.presentation.previewScale > 10
    )
      throw Error("预览倍率必须大于0且不超过10");
    next.faction = next.tags.find((tag) => ["EFSF", "ZEON"].includes(tag));
    if (!candidate.name?.trim() || !candidate.code?.trim()) throw Error("单位名称和型号不能为空");
    if (
      (next.skills || []).some(
        (skill) =>
          Schema.safeSkillTypes.includes(skill.type) &&
          (skill.spawn || skill.formUnitId || skill.source?.unitId),
      )
    )
      throw Error("不可添加涉及单位变化的技能");
    const protectedSkills = (items) =>
      (items || []).filter((skill) => !Schema.safeSkillTypes.includes(skill.type));
    if (!equal(protectedSkills(original.skills), protectedSkills(next.skills)))
      throw Error("不可编辑变形／脱出等单位变化技能");
    const oldAudit = (original.mechanics || []).filter((m) =>
      /transform|escape|purge|变形|脱出|爆甲|合体|变换/i.test(m.id + m.name),
    );
    if (!oldAudit.every((item) => (next.mechanics || []).some((m) => equal(m, item))))
      throw Error("不可删除单位变化机制");
    if (!equal(Object.keys(original.weapons).sort(), Object.keys(candidate.weapons).sort()))
      throw Error("不可新增或删除源武器");
    for (const [id, weapon] of Object.entries(candidate.weapons))
      next.weapons[id] = weaponChanges(original.weapons[id], weapon);
    if (candidate.weaponKits.length !== original.weaponKits.length) throw Error("套件数量不匹配");
    next.weaponKits = original.weaponKits.map((kit, index) => {
      const other = candidate.weaponKits[index];
      if (other.id !== kit.id || !equal([...other.weapons].sort(), [...kit.weapons].sort()))
        throw Error("只能调整武器槽位顺序");
      return { ...kit, weapons: other.weapons };
    });
    const registry = read(Adjust.file);
    const rawUnit = Codec.expandPrefab(record.raw, lib.definitions);
    const captured = Adjust.capture(
      rawUnit,
      original,
      next,
      registry.units[original.id],
      (pointer) => /^\/(skills|mechanics|weaponKits)(?:\/|$)/.test(pointer),
    );
    if (Object.keys(captured.deltas).length) registry.units[original.id] = captured.deltas;
    else delete registry.units[original.id];
    const sourceNext = captured.source;
    // Skill editing is add/remove only. Do not bake live global skill damage into its source.
    sourceNext.skills = next.skills.map((skill) => {
      const raw = rawUnit.skills.find((item) => item.id === skill.id);
      const previous = original.skills.find((item) => item.id === skill.id);
      if (raw && require("../shared/weapon-classes.js").isWeaponSkill(skill) && previous) {
        const comparison = { ...skill },
          old = { ...previous };
        for (const field of ["weaponClass", "weaponMainClass", "weaponSubClass"]) {
          delete comparison[field];
          delete old[field];
        }
        if (equal(comparison, old)) {
          const result = structuredClone(raw);
          for (const field of ["weaponClass", "weaponMainClass", "weaponSubClass"]) {
            if (skill[field] === undefined) delete result[field];
            else result[field] = skill[field];
          }
          return result;
        }
      }
      return raw && equal(skill, previous) ? structuredClone(raw) : skill;
    });
    const packed = structuredClone(record.raw);
    for (const key of Object.keys(sourceNext))
      if (!["weapons", "skills"].includes(key)) packed[key] = sourceNext[key];
    for (const key of Object.keys(original))
      if (!Object.hasOwn(sourceNext, key)) delete packed[key];
    const encoded = Codec.packPrefab(sourceNext, lib.definitions, false);
    packed.skills = encoded.skills;
    for (const id of Object.keys(original.weapons))
      if (!equal(rawUnit.weapons[id], sourceNext.weapons[id]))
        packed.weapons[id] = encoded.weapons[id];
    const production = read("shared/production-catalog.json");
    if (payload.price) {
      if (
        ![payload.price.money, payload.price.supplies].every((v) => Number.isInteger(v) && v >= 0)
      )
        throw Error("许可价格必须为非负整数");
      const baseOffer = production.licenseOffers[original.id] || {
        unitId: original.id,
        sourceType: "editor",
        money: 0,
        supplies: 0,
      };
      const currentOffer = Adjust.apply(structuredClone(baseOffer), registry.prices[original.id]);
      const price = Adjust.capture(
        baseOffer,
        currentOffer,
        { ...currentOffer, ...payload.price },
        registry.prices[original.id],
      );
      production.licenseOffers[original.id] = { ...price.source, faction: next.faction };
      if (Object.keys(price.deltas).length) registry.prices[original.id] = price.deltas;
      else delete registry.prices[original.id];
    }
    const localization = read("assets/localization/units.json");
    localization[original.id] = {
      ...localization[original.id],
      en: next.localization?.en || {},
      ja: next.localization?.ja || {},
    };
    const changes = new Map([
      [Adjust.file, encode(registry)],
      ["assets/" + record.ref, encode(packed)],
      ["shared/production-catalog.json", encode(production)],
      ["assets/localization/units.json", encode(localization)],
    ]);
    if (next.id !== original.id) {
      const rename = (value) => {
        if (typeof value === "string")
          return value === original.id
            ? next.id
            : value.startsWith(original.id + "__")
              ? next.id + value.slice(original.id.length)
              : value;
        if (Array.isArray(value)) return value.map(rename);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [rename(key), rename(child)]),
          );
        return value;
      };
      for (const file of [
        Adjust.file,
        ...registered().map((ref) => "assets/" + ref),
        "shared/production-catalog.json",
        "shared/development-tree.json",
        "shared/pilots.json",
        "assets/localization/units.json",
        "assets/unit-wip.json",
        "assets/unit-catalog.json",
      ]) {
        const text = changes.get(file) || fs.readFileSync(path.join(root, file), "utf8"),
          value = JSON.parse(text),
          updated = rename(value);
        if (!equal(value, updated)) changes.set(file, encode(updated));
      }
    }
    return {
      ...transaction(changes, {
        operation: "unit",
        target: { id: original.id, newId: next.id, name: next.name },
        revision: payload.revision,
        actor,
      }),
      id: next.id,
    };
  }
  function getConversion() {
    return {
      revision: revision(),
      rules: Conversion.read(root),
      fields: Conversion.fields,
      classFields: Conversion.classFields,
    };
  }
  function saveConversion(payload, actor = {}) {
    assertRevision(payload.revision);
    checkJSON(payload);
    Conversion.validate(payload.rules);
    return transaction(new Map([[Conversion.file, encode(payload.rules)]]), {
      operation: "conversion-rules",
      target: { id: "global", name: "全局换算规则" },
      revision: payload.revision,
      actor,
    });
  }
  function getWip() {
    return {
      revision: revision(),
      policy: read("assets/unit-wip.json"),
      units: unitFiles().map(({ raw }) => ({ id: raw.id, name: raw.name })),
    };
  }
  function saveWip(payload, actor = {}) {
    assertRevision(payload.revision);
    checkJSON(payload);
    const current = read("assets/unit-wip.json"),
      ids = unitFiles().map(({ raw }) => raw.id);
    if (
      !Array.isArray(payload.units) ||
      payload.units.length > 1000 ||
      new Set(payload.units).size !== payload.units.length ||
      payload.units.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]+\*?$/.test(id))
    )
      throw Error("WIP列表包含重复或无效的单位ID");
    for (const pattern of payload.units)
      if (
        !current.units.includes(pattern) &&
        !ids.some((id) =>
          pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern,
        )
      )
        throw Error("WIP条目未匹配项目单位：" + pattern);
    return transaction(
      new Map([["assets/unit-wip.json", encode({ ...current, units: payload.units })]]),
      {
        operation: "wip-list",
        target: { id: "unit-wip", name: "WIP列表" },
        revision: payload.revision,
        actor,
      },
    );
  }
  return {
    getUnit,
    getWeapon,
    templates,
    saveUnit,
    saveWeapon,
    revision,
    getConversion,
    saveConversion,
    getWip,
    saveWip,
  };
}
module.exports = { createEditorStore };
