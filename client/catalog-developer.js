/* Deliberately injected only into developer.html. Game source remains shared. */
window.CatalogDeveloper = (() => {
  const Schema = CatalogEditorSchema;
  let token = window.editorConnection.token,
    base = window.editorConnection.base;
  let activeUnitId = null,
    unitSession = null,
    weaponSession = null,
    rulesSession = null,
    rulesInitial = null,
    wipSession = null,
    wipInitial = null,
    saving = false,
    templates = null;
  const node = (tag, text = "", className = "") => {
    const result = document.createElement(tag);
    result.textContent = text;
    result.className = className;
    result.setAttribute("data-i18n-ignore", "");
    return result;
  };
  const button = (text, action) => {
    const result = node("button", text);
    result.type = "button";
    result.onclick = action;
    return result;
  };
  const notice = (message) => GameDialog.alert(message, { title: "配置编辑" });
  async function requestEditor(path, options = {}) {
    let response;
    try {
      response = await fetch(base + path, {
        ...options,
        signal: AbortSignal.timeout(
          options.method === "POST" || path.includes("/catalog") ? 60000 : 8000,
        ),
      });
    } catch {
      throw Error(`无法连接编辑服务器：${base}\n请检查服务器IP、端口和服务是否启动。`);
    }
    let value;
    try {
      value = await response.json();
    } catch {
      throw Error("当前地址没有提供编辑接口，请检查编辑服务器地址。");
    }
    if (!response.ok) {
      if (response.status === 401) token = null;
      throw Error(value.error || `编辑接口不可用（HTTP ${response.status}）。`);
    }
    return value;
  }
  async function api(route, body) {
    if (!token) throw Error("编辑会话失效，请断开并重新输入密钥连接。");
    return requestEditor("/api/editor/" + route, {
      method: body ? "POST" : "GET",
      headers: { "X-Editor-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  async function refreshCatalog(includeAssets = false) {
    const next = await api("catalog" + (includeAssets ? "?assets=1" : ""));
    I18n.bindCatalog(next);
    Rules.catalog.prefabs.splice(0, Rules.catalog.prefabs.length, ...next.prefabs);
    for (const key of Object.keys(UnitModels)) delete UnitModels[key];
    Object.assign(UnitModels, next.models);
    Rules.catalog.units.splice(0, Rules.catalog.units.length, ...next.units);
    for (const key of Object.keys(SpriteRenderer.models)) delete SpriteRenderer.models[key];
    Object.assign(
      SpriteRenderer.models,
      Object.fromEntries(next.units.map((unit) => [unit.id, unit])),
    );
    if (next.assets) Object.assign(Rules.catalog.assets, next.assets);
    for (const key of Object.keys(next.production)) PRODUCTION_CATALOG[key] = next.production[key];
    Encyclopedia.invalidate();
  }
  function section(parent, title) {
    const fieldset = node("fieldset"),
      legend = node("legend", title),
      grid = node("div", "", "catalog-editor-grid");
    fieldset.append(legend, grid);
    parent.append(fieldset);
    return grid;
  }
  function input(parent, label, value, change, type = "text", key = label) {
    const field = node("label", label),
      control = document.createElement("input");
    control.type = type;
    control.value = value ?? "";
    control.dataset.field = key;
    if (type === "number") {
      control.step = "any";
      control.required = true;
    }
    let numericHint;
    let numericBase = Number(value ?? 0);
    if (type === "number" && !key.startsWith("conversion.")) {
      let source,
        parts = key.split(".");
      if (parts[0] === "common") {
        source = weaponSession?.baseline;
        parts.shift();
      } else if (parts[0] === "price") {
        source = unitSession?.baselines?.price;
        parts.shift();
      } else {
        source = unitSession?.baselines?.unit;
        if (parts[0] === "weapon") parts[0] = "weapons";
        if (parts[0] === "unit" && parts[1] === "previewScale")
          parts = ["presentation", "previewScale"];
      }
      if (parts.at(-1) === "damage") parts[parts.length - 1] = "damagePerShot";
      let found = source;
      for (const part of parts) found = found?.[part];
      if (Number.isFinite(found)) numericBase = found;
      numericHint = node("small", "", "catalog-numeric-delta");
    }
    const updateHint = () => {
      if (!numericHint) return;
      const delta = Number((control.valueAsNumber - numericBase).toPrecision(10));
      numericHint.textContent = `基准 ${numericBase} · 调整 ${delta >= 0 ? "+" : ""}${delta}`;
    };
    control.oninput = () => {
      if (type === "number" && (!control.value.trim() || !Number.isFinite(control.valueAsNumber))) {
        control.setCustomValidity("请输入有效数值");
        return;
      }
      control.setCustomValidity("");
      change(type === "number" ? control.valueAsNumber : control.value);
      updateHint();
    };
    field.append(control);
    if (numericHint) {
      field.append(numericHint);
      updateHint();
    }
    parent.append(field);
    return control;
  }
  function select(parent, label, value, items, change) {
    const field = node("label", label),
      control = document.createElement("select");
    for (const [id, text] of items) control.add(new Option(text, id));
    control.value = value;
    control.onchange = () => change(control.value);
    field.append(control);
    parent.append(field);
    return control;
  }
  function numbers(parent, object, prefix = "") {
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === "number")
        input(
          parent,
          Schema.labels[key] || key,
          value,
          (next) => (object[key] = next),
          "number",
          prefix + key,
        );
      else if (value && typeof value === "object" && !Array.isArray(value)) {
        const detail = node("details"),
          grid = node("div", "", "catalog-editor-grid");
        detail.append(node("summary", Schema.labels[key] || key), grid);
        numbers(grid, value, prefix + key + ".");
        parent.append(detail);
      }
    }
  }
  function names(parent, record, prefix) {
    for (const [lang, label] of [
      ["zh", "中文名称"],
      ["en", "英文名称"],
      ["ja", "日文名称"],
    ]) {
      input(
        parent,
        label,
        record.localization?.[lang]?.name || (lang === "zh" ? record.name : ""),
        (value) => {
          record.localization ??= {};
          record.localization[lang] ??= {};
          if (value.trim()) record.localization[lang].name = value;
          else delete record.localization[lang].name;
          if (lang === "zh") record.name = value;
        },
        "text",
        prefix + ".name." + lang,
      );
    }
  }
  function weaponForm(parent, weapon, prefix, view = weapon) {
    names(section(parent, "武器名称"), weapon, prefix);
    const core = section(parent, "基础属性（数值修改保存为基准值的增减量；伤害按25点取整）");
    input(
      core,
      "基础单发伤害",
      Object.values(view.damageComponents || {}).reduce((sum, value) => sum + value, 0),
      (value) => Schema.setDamage(weapon, value),
      "number",
      prefix + ".damage",
    );
    input(
      core,
      "基础命中率（%）",
      view.hit,
      (value) => Schema.setHit(weapon, value),
      "number",
      prefix + ".hit",
    );
    for (const key of ["min", "max", "actionCost", "en", "partBreakModifier"])
      input(
        core,
        Schema.labels[key] || key,
        view[key] ?? (key === "partBreakModifier" ? 1 : 0),
        (value) => {
          weapon[key] = value;

          if (key === "partBreakModifier")
            for (const step of weapon.attack?.steps || [])
              if (step.partBreakModifier !== undefined) step.partBreakModifier = value;
        },
        "number",
        prefix + "." + key,
      );
    const targets = section(parent, "目标倍率（1 = 100%）");
    weapon.targetModifiers ??= {};
    for (const key of ["ground", "space", "air", "water"])
      input(
        targets,
        (Schema.labels[key] || key) + "伤害／命中",
        weapon.targetModifiers[key] ?? 1,
        (value) => (weapon.targetModifiers[key] = value),
        "number",
        prefix + ".targetModifiers." + key,
      );
    weapon.antiSize ??= {};
    for (const key of ["small", "medium", "large"]) {
      for (const field of ["damage", "accuracy"])
        input(
          targets,
          Schema.labels[key] + (field === "damage" ? "伤害倍率" : "命中倍率"),
          weapon.antiSize[key]?.[field] ?? 1,
          (value) => {
            weapon.antiSize[key] ??= { damage: 1, accuracy: 1 };
            weapon.antiSize[key][field] = value;
          },
          "number",
          prefix + ".antiSize." + key + "." + field,
        );
    }
  }
  function templatesEditor(parent, unit) {
    const skills = section(parent, "技能（单位变化技能只读）");
    const redrawSkills = () => {
      skills.replaceChildren();
      for (const skill of unit.skills || []) {
        const row = node("div", "", "catalog-editor-row");
        row.append(node("span", skill.name + " · " + skill.type));
        if (Schema.safeSkillTypes.includes(skill.type))
          row.append(
            button("删除", () => {
              unit.skills.splice(unit.skills.indexOf(skill), 1);
              redrawSkills();
            }),
          );
        else row.append(node("small", "只读"));
        skills.append(row);
      }
      const choices = (templates?.skills || []).filter(
        (item) => !(unit.skills || []).some((skill) => skill.id === item.value.id),
      );
      const choice = select(
        skills,
        "添加已有技能",
        choices[0]?.key || "",
        choices.map((item) => [item.key, item.name + " · " + item.value.type]),
        () => {},
      );
      const add = button("添加技能", () => {
        const item = choices.find((item) => item.key === choice.value);
        if (item) {
          (unit.skills ??= []).push(structuredClone(item.value));
          redrawSkills();
        }
      });
      add.disabled = !choices.length;
      skills.append(add);
    };
    redrawSkills();
    const mechanisms = section(parent, "机制（直接配置对应功能）");
    const redrawMechanisms = () => {
      mechanisms.replaceChildren();
      for (const [type, title] of [
        ["cmdAtk", "攻击指挥"],
        ["cmdDef", "防御指挥"],
        ["cmdCom", "通信指挥"],
      ]) {
        const field = node("label", title),
          check = document.createElement("input");
        check.type = "checkbox";
        check.checked = (unit.stats.commandAuras || []).some((aura) => aura.type === type);
        check.onchange = () => {
          unit.stats.commandAuras = (unit.stats.commandAuras || []).filter(
            (aura) => aura.type !== type,
          );
          if (check.checked) unit.stats.commandAuras.push({ type, name: title });
        };
        field.append(check);
        mechanisms.append(field);
      }
      for (const key of Schema.mechanismFields)
        if (key !== "commandAuras" && unit.stats[key] !== undefined) {
          const row = node("div", "", "catalog-editor-row");
          row.append(
            node("span", Schema.labels[key]),
            button("删除", () => {
              delete unit.stats[key];
              const auditIds =
                { stealth: ["Stealth"], iField: ["I_Field"], pilotExperienceMultiplier: ["LPC"] }[
                  key
                ] || [];
              unit.mechanics = (unit.mechanics || []).filter((item) => !auditIds.includes(item.id));
              redrawMechanisms();
            }),
          );
          mechanisms.append(row);
          if (typeof unit.stats[key] === "number")
            input(
              mechanisms,
              "倍率",
              unit.stats[key],
              (v) => (unit.stats[key] = v),
              "number",
              "mechanism." + key,
            );
          else numbers(mechanisms, { [key]: unit.stats[key] }, "mechanism.");
        }
      const choices = (templates?.mechanisms || []).filter(
        (item) => item.key !== "commandAuras" && unit.stats[item.key] === undefined,
      );
      const choice = select(
        mechanisms,
        "添加机制",
        choices[0]?.key || "",
        choices.map((item) => [item.key, item.name]),
        () => {},
      );
      const add = button("添加机制", () => {
        const item = choices.find((item) => item.key === choice.value);
        if (item) {
          unit.stats[item.key] = structuredClone(item.value);
          redrawMechanisms();
        }
      });
      add.disabled = !choices.length;
      mechanisms.append(add);
    };
    redrawMechanisms();
  }
  const unitPanel = node("form", "", "catalog-editor-body");
  unitPanel.id = "unitSourceEditor";
  unitPanel.hidden = true;
  unitPanel.onsubmit = (event) => event.preventDefault();
  const editUnit = button("修改属性", () =>
    run(async () => {
      if (unitSession) return saveUnit(false);
      const data = await api("unit?id=" + encodeURIComponent(activeUnitId));
      templates ||= await api("templates");
      unitSession = { ...data, id: activeUnitId };
      renderUnitEditor();
      editUnit.textContent = "保存修改";
    }),
  );
  editUnit.id = "editUnitProperties";
  function renderUnitEditor() {
    const unit = unitSession.unit;
    unitPanel.replaceChildren(
      node(
        "p",
        "仅修改当前单位的武器覆盖项；通用模板请使用“修改通用属性”。保存后自动刷新预览，客户端发布前仍需重新构建。",
        "catalog-editor-note",
      ),
    );
    const identity = section(unitPanel, "单位身份");
    input(identity, "单位ID", unit.id, (value) => (unit.id = value), "text", "unit.id");
    input(
      identity,
      "型号／显示编号",
      unit.code,
      (value) => (unit.code = value),
      "text",
      "unit.code",
    );
    names(identity, unit, "unit");
    select(
      identity,
      "主要阵营标签",
      unit.tags.find((tag) => ["EFSF", "ZEON"].includes(tag)),
      [
        ["EFSF", "EFSF"],
        ["ZEON", "ZEON"],
      ],
      (value) => {
        unit.tags = unit.tags.filter((tag) => !["EFSF", "ZEON"].includes(tag));
        unit.tags.unshift(value);
        unit.faction = value;
      },
    );
    input(
      identity,
      "可用阵营标签（逗号分隔）",
      (unit.availableFactions || [unit.faction]).join(","),
      (value) => (unit.availableFactions = tags(value)),
      "text",
      "unit.availableFactions",
    );
    input(
      identity,
      "年代标签（逗号分隔）",
      unit.tags.filter((tag) => !["EFSF", "ZEON"].includes(tag)).join(","),
      (value) =>
        (unit.tags = [
          ...unit.tags.filter((tag) => ["EFSF", "ZEON"].includes(tag)),
          ...tags(value),
        ]),
      "text",
      "unit.eras",
    );
    input(
      identity,
      "类型标签（逗号分隔）",
      unit.unitTags.join(","),
      (value) => (unit.unitTags = tags(value)),
      "text",
      "unit.unitTags",
    );
    const price = section(unitPanel, "部署许可与预览");
    for (const [key, label] of [
      ["money", "资金"],
      ["supplies", "物资"],
    ])
      input(
        price,
        label,
        unitSession.price?.[key] ?? 0,
        (value) => {
          unitSession.price ??= { money: 0, supplies: 0 };
          unitSession.price[key] = value;
        },
        "number",
        "price." + key,
      );
    input(
      price,
      "预览图缩放倍率",
      unit.presentation?.previewScale ?? 1,
      (value) => {
        unit.presentation ??= {};
        unit.presentation.previewScale = value;
        const modelId = byId("formationDetailPreview").dataset.previewModel;
        if (UnitModels[modelId]) {
          UnitModels[modelId].presentation = {
            ...UnitModels[modelId].presentation,
            previewScale: value,
          };
          Formation.renderPreview(modelId);
        }
      },
      "number",
      "unit.previewScale",
    );
    const baseStats = section(unitPanel, "基础属性");
    for (const [key, value] of Object.entries(unit.stats))
      if (typeof value === "number" && !["move", ...Schema.mechanismFields].includes(key))
        input(
          baseStats,
          Schema.labels[key] || key,
          value,
          (next) => (unit.stats[key] = next),
          "number",
          "stats." + key,
        );
    if (unit.stats.sensors) numbers(baseStats, { sensors: unit.stats.sensors }, "stats.");
    numbers(section(unitPanel, "防护属性"), unit.defenses, "defenses.");
    numbers(section(unitPanel, "盾牌HP／格挡率／防护"), unit.shield, "shield.");
    const movement = section(unitPanel, "移动与适应性");
    input(
      movement,
      "基础移动距离",
      unit.stats.move,
      (value) => (unit.stats.move = value),
      "number",
      "stats.move",
    );
    select(
      movement,
      "移动方式",
      unit.stats.movementType || "ground",
      [
        ["ground", "地面"],
        ["air", "空中"],
        ["hover", "气垫"],
        ["naval", "水上"],
        ["amphibious", "两栖"],
      ],
      (value) => (unit.stats.movementType = value),
    );
    numbers(movement, { adaptability: unit.stats.adaptability }, "stats.");
    numbers(section(unitPanel, "伤害加成（%）"), unit.attackBonuses, "attackBonuses.");
    templatesEditor(unitPanel, unit);
    const slots = section(unitPanel, "武器槽位顺序（每套装备单独调整）");
    for (const kit of unit.weaponKits) {
      const detail = node("details"),
        rows = node("div");
      detail.append(node("summary", kit.name + " · " + kit.id), rows);
      slots.append(detail);
      const redraw = () => {
        rows.replaceChildren();
        kit.weapons.forEach((id, index) => {
          const row = node("div", "", "catalog-editor-row");
          row.dataset.slot = id;
          const up = button("↑", () => {
            [kit.weapons[index - 1], kit.weapons[index]] = [id, kit.weapons[index - 1]];
            redraw();
          });
          up.disabled = index === 0;
          const down = button("↓", () => {
            [kit.weapons[index], kit.weapons[index + 1]] = [kit.weapons[index + 1], id];
            redraw();
          });
          down.disabled = index === kit.weapons.length - 1;
          row.append(node("span", index + 1 + ". " + unit.weapons[id].name), up, down);
          rows.append(row);
        });
      };
      redraw();
    }
    const weapons = section(unitPanel, "单位特例武器属性");
    for (const [id, weapon] of Object.entries(unit.weapons)) {
      const detail = node("details"),
        body = node("div");
      detail.dataset.sourceWeapon = id;
      detail.append(node("summary", weapon.name + " · " + id), body);
      weapons.append(detail);
      // Populate expensive forms only when the weapon is expanded.
      detail.addEventListener("toggle", () => {
        if (detail.open && !body.children.length)
          weaponForm(body, weapon, "weapon." + id, unitSession.weaponViews?.[id] || weapon);
      });
    }
    unitPanel.hidden = false;
    byId("formationUnitDetail").querySelector(".modal").append(unitPanel);
    byId("formationDetailKit").disabled = true;
    byId("formationDetailForms").inert = true;
    unitPanel.scrollIntoView({ block: "start" });
  }
  const tags = (value) => [
    ...new Set(
      value
        .split(/[,，\s]+/)
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  async function saveUnit(closeAfter) {
    if (!unitPanel.reportValidity()) return false;
    const session = unitSession;
    const result = await api("unit", {
      id: session.id,
      revision: session.revision,
      unit: session.unit,
      price: session.price && { money: session.price.money, supplies: session.price.supplies },
    });
    unitSession = null;
    unitPanel.hidden = true;
    editUnit.textContent = "修改属性";
    await refreshCatalog(result.id !== session.id);
    activeUnitId = result.id;
    if (!closeAfter) Formation.previewUnit(result.id, editUnit);
    return true;
  }
  async function discardUnit() {
    unitSession = null;
    unitPanel.hidden = true;
    editUnit.textContent = "修改属性";
    await refreshCatalog();
  }
  async function closeChoice() {
    return GameDialog.choose({
      title: "保存修改？",
      message: "保存会覆盖项目中对应的源文件。",
      actions: [
        { label: "取消修改并关闭", value: "discard" },
        { label: "保存并关闭", value: "save", primary: true },
      ],
    });
  }
  async function run(task) {
    if (saving) return;
    saving = true;
    try {
      return await task();
    } catch (error) {
      await notice(error.message);
    } finally {
      saving = false;
    }
  }
  const weaponDialog = node("dialog", "", "catalog-editor-dialog");
  weaponDialog.id = "commonWeaponEditor";
  document.body.append(weaponDialog);
  async function closeWeapon() {
    if (!weaponSession) return;
    const choice = await closeChoice();
    if (!choice) return;
    if (choice === "save") {
      if (!(await saveWeapon())) return;
    }
    weaponSession = null;
    weaponDialog.close();
  }
  async function saveWeapon() {
    const form = weaponDialog.querySelector("form");
    if (!form.reportValidity()) return false;
    const result = await api("weapon", weaponSession);
    weaponSession.revision = result.revision;
    await refreshCatalog();
    if (activeUnitId && !byId("formationUnitDetail").hidden)
      Formation.previewUnit(activeUnitId, editUnit);
    return true;
  }
  async function openWeapon(weapon) {
    if (unitSession) {
      await notice("请先保存或取消当前单位修改，再修改通用模板。");
      return;
    }
    const ref =
      (weapon.sourceName || weapon.sourceWeapon || weapon.id) + "__lv" + (weapon.level || 1);
    const data = await api("weapon?ref=" + encodeURIComponent(ref));
    weaponSession = { ...data };
    const header = node("header", "", "catalog-editor-header");
    header.append(
      node("h3", "通用武器属性 · " + data.weapon.name),
      button("保存修改", () =>
        run(async () => {
          if (await saveWeapon()) {
            weaponSession = null;
            weaponDialog.close();
          }
        }),
      ),
      button("关闭", () => run(closeWeapon)),
    );
    const form = node("form", "", "catalog-editor-body");
    form.onsubmit = (event) => event.preventDefault();
    form.append(
      node(
        "p",
        "数值差值写入 shared/editor-adjustments.json；名称写入共用模板。差值在全局规则之后应用，再叠加单位特例；专属枪口、贴图与演出保持原配置。",
        "catalog-editor-note",
      ),
    );
    weaponForm(form, data.weapon, "common");
    weaponDialog.replaceChildren(header, form);
    weaponDialog.showModal();
  }
  weaponDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    run(closeWeapon);
  });
  for (const type of ["keydown", "keyup"])
    weaponDialog.addEventListener(type, (event) => event.stopPropagation());
  function decorateWeapon(card, weapon, unitPreview) {
    const modify = button(unitPreview ? "修改通用属性" : "修改", () =>
      run(() => openWeapon(weapon)),
    );
    modify.className = "edit-common-weapon";
    const actions = node("div", "", "catalog-weapon-actions");
    card.append(actions);
    if (unitPreview) actions.append(card.querySelector(".encyclopedia-users-button"), modify);
    else {
      actions.append(modify);
      // Encyclopedia attaches its usage button immediately after card creation.
      queueMicrotask(() => {
        const users = card.querySelector(".encyclopedia-users-button");
        if (users) actions.append(users);
      });
    }
  }
  window.addEventListener("unit-preview-rendered", (event) => {
    activeUnitId = event.detail.id;
    const close = byId("closeFormationDetail");
    close.before(editUnit);
  });
  const originalClose = byId("closeFormationDetail").onclick;
  byId("closeFormationDetail").onclick = () =>
    run(async () => {
      if (unitSession) {
        const choice = await closeChoice();
        if (!choice) return;
        if (choice === "save") {
          if (!(await saveUnit(true))) return;
        } else await discardUnit();
      }
      byId("formationDetailForms").inert = false;
      originalClose();
    });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && unitSession && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        byId("closeFormationDetail").click();
      }
    },
    true,
  );
  window.addEventListener("beforeunload", (event) => {
    if (
      unitSession ||
      weaponSession ||
      (rulesSession && JSON.stringify(rulesSession.rules) !== rulesInitial) ||
      (wipSession && JSON.stringify(wipSession.policy.units) !== wipInitial)
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  const rulesScreen = node("section", "", "developer-rules-screen");
  rulesScreen.id = "conversionRulesScreen";
  rulesScreen.hidden = true;
  document.body.append(rulesScreen);
  const wipScreen = node("section", "", "developer-rules-screen");
  wipScreen.id = "wipEditorScreen";
  wipScreen.hidden = true;
  document.body.append(wipScreen);
  let catalogTab, conversionTab, wipTab;
  function selectEditorTab(page) {
    byId("encyclopediaScreen").hidden = page !== "catalog";
    rulesScreen.hidden = page !== "conversion";
    wipScreen.hidden = page !== "wip";
    for (const [tab, id] of [
      [catalogTab, "catalog"],
      [conversionTab, "conversion"],
      [wipTab, "wip"],
    ])
      tab.setAttribute("aria-pressed", String(page === id));
  }
  async function saveRules() {
    if (!rulesScreen.querySelector("form").reportValidity()) return false;
    await api("conversion", { revision: rulesSession.revision, rules: rulesSession.rules });
    rulesSession = await api("conversion");
    rulesInitial = JSON.stringify(rulesSession.rules);
    await refreshCatalog();
    renderRules();
    rulesScreen.querySelector("[role=status]").textContent =
      "已保存，编辑器预览已刷新；正式客户端仍需手动构建。";
    return true;
  }
  function renderRules() {
    const header = node("header", "", "catalog-editor-header");
    header.append(
      node("h2", "换算规则"),
      button("保存规则", () => run(saveRules)),
      button("撤销修改", () =>
        run(async () => {
          rulesSession = await api("conversion");
          rulesInitial = JSON.stringify(rulesSession.rules);
          renderRules();
        }),
      ),
    );
    const form = node("form", "", "catalog-editor-body");
    form.onsubmit = (event) => event.preventDefault();
    form.append(
      node(
        "p",
        "倍率1表示100%，1.35表示135%。计算顺序：单位／武器原始基础值 → 本页规则 → 通用武器差值 → 单位特例差值 → 正常取整。保存会影响所有相关单位，但不会自动构建或重启游戏。原MOD导入阶段的转向速度、推进速度等换算公式仍由导入脚本维护。",
        "catalog-editor-note",
      ),
    );
    for (const [group, fields] of Object.entries(rulesSession.fields)) {
      const grid = section(form, group === "weapons" ? "武器与技能" : "单位基础属性");
      for (const [key, [label, min, max, integer, description]] of Object.entries(fields)) {
        const control = input(
          grid,
          label,
          rulesSession.rules[group][key],
          (value) => {
            rulesSession.rules[group][key] = value;
          },
          "number",
          `conversion.${group}.${key}`,
        );
        control.min = min;
        control.max = max;
        control.step = integer ? "1" : "0.01";
        control.parentElement.append(node("small", description, "catalog-editor-note"));
      }
    }
    const status = node("p", "", "catalog-editor-note");
    status.setAttribute("role", "status");
    rulesScreen.replaceChildren(header, form, status);
  }
  async function leaveConfigTab() {
    if (unitSession || weaponSession) {
      await notice("请先保存或取消当前属性修改，再切换页面。");
      return false;
    }
    const rulesDirty = rulesSession && JSON.stringify(rulesSession.rules) !== rulesInitial;
    const wipDirty = wipSession && JSON.stringify(wipSession.policy.units) !== wipInitial;
    if (rulesDirty || wipDirty) {
      const choice = await GameDialog.choose({
        title: rulesDirty ? "保存换算规则？" : "保存WIP列表？",
        message: "当前修改尚未保存。",
        actions: [
          { label: "取消切换", value: "stay" },
          { label: "取消修改并切换", value: "discard" },
          { label: "保存并切换", value: "save", primary: true },
        ],
      });
      if (!choice || choice === "stay") return false;
      if (choice === "save" && !(await (rulesDirty ? saveRules() : saveWip()))) return false;
    }
    return true;
  }
  async function openRules() {
    if (!rulesScreen.hidden || !(await leaveConfigTab())) return;
    if (!byId("formationUnitDetail").hidden) byId("closeFormationDetail").click();
    rulesSession = await api("conversion");
    rulesInitial = JSON.stringify(rulesSession.rules);
    wipSession = null;
    wipInitial = null;
    renderRules();
    selectEditorTab("conversion");
  }
  async function openCatalogTab() {
    if (!(await leaveConfigTab())) return;
    rulesSession = null;
    rulesInitial = null;
    wipSession = null;
    wipInitial = null;
    selectEditorTab("catalog");
  }
  async function saveWip() {
    await api("wip", { revision: wipSession.revision, units: wipSession.policy.units });
    wipSession = await api("wip");
    wipInitial = JSON.stringify(wipSession.policy.units);
    await refreshCatalog();
    renderWip();
    wipScreen.querySelector("[role=status]").textContent =
      "已保存至 assets/unit-wip.json；正式客户端仍需手动构建。";
    return true;
  }
  function renderWip() {
    const header = node("header", "", "catalog-editor-header");
    header.append(
      node("h2", "WIP列表"),
      button("保存列表", () => run(saveWip)),
      button("撤销修改", () =>
        run(async () => {
          wipSession = await api("wip");
          wipInitial = JSON.stringify(wipSession.policy.units);
          renderWip();
        }),
      ),
    );
    const content = node("div", "", "catalog-editor-body");
    content.append(
      node(
        "p",
        "直接维护 assets/unit-wip.json。WIP单位仍可预览，构建后会禁止编组出战及AI选取。添加、移除后点击保存列表；末尾*匹配整个系列。",
        "catalog-editor-note",
      ),
    );
    const controls = node("div", "", "wip-add-controls"),
      search = document.createElement("input"),
      choice = document.createElement("select");
    search.placeholder = "搜索单位名称／ID";
    search.id = "wipUnitSearch";
    choice.id = "wipUnitSelect";
    const filter = () => {
      const text = search.value.trim().toLowerCase();
      choice.replaceChildren();
      for (const unit of wipSession.units.filter(
        (u) =>
          !wipSession.policy.units.includes(u.id) &&
          (u.name + " " + u.id).toLowerCase().includes(text),
      ))
        choice.add(new Option(unit.name + " · " + unit.id, unit.id));
    };
    search.oninput = filter;
    filter();
    const add = (pattern) => {
      pattern = pattern.trim();
      if (!pattern) return;
      if (wipSession.policy.units.includes(pattern)) return notice("该条目已在WIP列表中。");
      wipSession.policy.units.push(pattern);
      renderWip();
    };
    controls.append(
      search,
      choice,
      button("添加单位", () => add(choice.value)),
    );
    const pattern = document.createElement("input");
    pattern.placeholder = "可选：系列前缀*，例如 Apsaras*";
    pattern.id = "wipPattern";
    controls.append(
      pattern,
      button("添加系列", () => add(pattern.value)),
    );
    content.append(controls);
    const list = node("div", "", "wip-unit-list");
    list.id = "wipUnitList";
    for (const id of wipSession.policy.units) {
      const row = node("div", "", "catalog-editor-row");
      row.dataset.wipId = id;
      const matched = wipSession.units.filter((u) =>
        id.endsWith("*") ? u.id.startsWith(id.slice(0, -1)) : u.id === id,
      );
      row.append(
        node("span", id + " · " + matched.length + "个单位"),
        node("span", matched.map((u) => u.name).join("、")),
        button("移除", () => {
          wipSession.policy.units = wipSession.policy.units.filter((value) => value !== id);
          renderWip();
        }),
      );
      list.append(row);
    }
    if (!wipSession.policy.units.length)
      list.append(node("p", "当前没有WIP单位。", "catalog-editor-note"));
    content.append(list);
    const status = node("p", "", "catalog-editor-note");
    status.setAttribute("role", "status");
    wipScreen.replaceChildren(header, content, status);
  }
  async function openWip() {
    if (!wipScreen.hidden || !(await leaveConfigTab())) return;
    if (!byId("formationUnitDetail").hidden) byId("closeFormationDetail").click();
    wipSession = await api("wip");
    wipInitial = JSON.stringify(wipSession.policy.units);
    rulesSession = null;
    rulesInitial = null;
    renderWip();
    selectEditorTab("wip");
  }
  const toolbar = node("header", "", "developer-toolbar");
  toolbar.append(
    node("strong", "PROJECT GREED · 配置编辑"),
    (catalogTab = button("图鉴", () => run(openCatalogTab))),
    (conversionTab = button("换算规则", () => run(openRules))),
    (wipTab = button("WIP列表", () => run(openWip))),
    node("span", base),
    node("small", "已连接"),
    button("断开连接", () => location.reload()),
  );
  document.body.append(toolbar);
  Encyclopedia.open();
  selectEditorTab("catalog");
  api("templates")
    .then((value) => (templates = value))
    .catch((error) => notice(error.message));
  return { decorateWeapon };
})();
