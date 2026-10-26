/* 编组保存单位/套件 ID 与可选自定义名称；数值和部署合法性由共用规则决定。 */
const Formation = (() => {
  const storageKey = "slg-formations-v1";
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey));
  } catch {}
  const fallback = [
    { unitId: "PegasusClass", kitId: "standard" },
    { unitId: "RX_78_2", kitId: "kit_1", preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
    { unitId: "RX_77_2", kitId: "kit_2", preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
    { unitId: "RX_77_2", kitId: "kit_2", preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
    { unitId: "FF_X7Bst", kitId: "main_0", preload: { carrierIndex: 0, hangarId: "Hangar_2" } },
    { unitId: "FF_X7Bst", kitId: "main_0", preload: { carrierIndex: 0, hangarId: "Hangar_2" } },
  ];
  for (const entry of fallback)
    entry.customName = Rules.generateUnitName(
      UnitModels[entry.unitId + "__" + entry.kitId].name,
      fallback,
    );
  let squads = Array.isArray(saved)
    ? saved
        .filter((s) => {
          try {
            Rules.validateFormation(s.units, Infinity, Rules.catalog.formation.maxUnits * 3);
            return typeof s.name === "string";
          } catch {
            return false;
          }
        })
        .map((s) => ({
          ...s,
          units: Rules.validateFormation(s.units, Infinity, Rules.catalog.formation.maxUnits * 3),
        }))
    : [];
  if (!squads.length) squads = [{ name: I18n.text("V作战小队"), units: fallback }];
  let index = 0,
    returnView = "menu",
    draft = [],
    previousIndex = 0,
    nameEdit = null,
    previewModel = null,
    previewRoot = null,
    detailIndex = null,
    catalogDetail = null,
    pickerContext = null,
    pickerReturnIndex = null,
    detailFromPicker = false;
  try {
    const active = Number(localStorage.getItem(storageKey + "-active"));
    if (Number.isInteger(active) && active >= 0 && active < squads.length) index = active;
  } catch {}
  const pickerKits = new Map();
  const catalogFilters = { faction: "", era: "", types: "", environment: "" };
  const current = () =>
    Rules.validateFormation(squads[index].units, Infinity, Rules.catalog.formation.maxUnits * 3);
  const ownPlayer = () => Net.snapshot?.members.find((player) => player.id === Net.memberId);
  const budget = () =>
    Net.active && Net.snapshot?.settings
      ? Rules.armyBudget(Net.snapshot.settings, ownPlayer())
      : Infinity;
  const restrictions = () =>
    Net.active && Net.snapshot?.settings
      ? Rules.armyRestrictions(Net.snapshot.settings, ownPlayer())
      : {};
  const displayLimit = (value) => (Number.isFinite(value) ? value : I18n.text("无限"));
  const unitLimit = () =>
    Net.active && Net.snapshot?.settings
      ? Rules.armyUnitLimit(Net.snapshot.settings, ownPlayer())
      : Rules.catalog.formation.maxUnits * 3;
  const cost = (entries) =>
    entries.reduce((n, e) => n + UnitModels[e.unitId + "__" + e.kitId].cost, 0);
  function renderPickerCost() {
    const prefabId = byId("formationPrefab").value,
      prefab = Rules.catalog.prefabs.find((candidate) => candidate.id === prefabId),
      kitId = prefab && (pickerKits.get(prefab.id) || prefab.weaponKits[0].id),
      model = kitId && UnitModels[prefab.id + "__" + kitId],
      formationCost = cost(draft),
      formationLimit = budget(),
      unitCost = model?.cost,
      unitCostLimit = restrictions().unitCostLimit ?? Infinity,
      formation = element(
        "span",
        formationCost > formationLimit ? "danger-text" : "",
        I18n.text("编组COST") + ": " + formationCost + " / " + displayLimit(formationLimit),
      ),
      unit = element(
        "span",
        Number.isFinite(unitCost) && unitCost > unitCostLimit ? "danger-text" : "",
        I18n.text("单位COST") + ": " + (unitCost ?? "—") + " / " + displayLimit(unitCostLimit),
      );
    formation.id = "formationPickerSquadCost";
    unit.id = "formationPickerUnitCost";
    byId("formationPickerCost").replaceChildren(formation, unit);
  }
  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(squads));
      localStorage.setItem(storageKey + "-active", String(index));
    } catch {
      note("浏览器无法保存编组，本次会话仍可使用。");
    }
  }
  const sharePrefix = "PGF1.";
  function encodeShare(name, units) {
    const clean = Rules.validateFormation(units, Infinity, Rules.catalog.formation.maxUnits * 3),
      payload = JSON.stringify({
        version: 1,
        name: name.trim().slice(0, 32) || "未命名编组",
        units: clean,
      }),
      bytes = new TextEncoder().encode(payload);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return sharePrefix + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeShare(code) {
    code = code.trim();
    if (!code.startsWith(sharePrefix) || code.length > 100000) throw Error("编组分享代码无效。");
    let encoded = code.slice(sharePrefix.length).replace(/-/g, "+").replace(/_/g, "/");
    encoded += "=".repeat((4 - (encoded.length % 4)) % 4);
    let payload;
    try {
      const binary = atob(encoded),
        bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw Error("编组分享代码无效。");
    }
    if (
      !payload ||
      payload.version !== 1 ||
      typeof payload.name !== "string" ||
      !Array.isArray(payload.units)
    )
      throw Error("编组分享代码无效。");
    const units = Rules.validateFormation(
        payload.units,
        Infinity,
        Rules.catalog.formation.maxUnits * 3,
      ),
      name = payload.name.trim().slice(0, 32) || "分享编组";
    return { name, units };
  }
  function uniqueSquadName(name) {
    if (!squads.some((squad) => squad.name === name)) return name;
    for (let number = 2; ; number++) {
      const suffix = " (" + number + ")",
        candidate = name.slice(0, 32 - suffix.length) + suffix;
      if (!squads.some((squad) => squad.name === candidate)) return candidate;
    }
  }
  function closeShare(focus = true) {
    byId("formationSharePanel").hidden = true;
    byId("formationMain").inert = false;
    if (focus) byId("openFormationShare").focus();
  }
  function openShare() {
    closeDetail();
    byId("formationShareCode").value = "";
    byId("formationSharePanel").hidden = false;
    byId("formationMain").inert = true;
    byId("formationShareCode").focus();
  }
  function refreshSelect() {
    const select = byId("formationSelect");
    select.replaceChildren();
    squads.forEach((s, i) => {
      const option = new Option(s.name, i);
      option.setAttribute("data-i18n-ignore", "");
      select.add(option);
    });
    select.value = index;
    byId("deleteFormation").disabled = squads.length <= 1;
    byId("deleteFormation").title = squads.length <= 1 ? "至少保留一个编组。" : "";
  }
  function closeDetail() {
    nameEdit = null;
    previewModel = null;
    previewRoot = null;
    byId("formationUnitDetail").hidden = true;
    byId("formationMain").inert = false;
    if (detailFromPicker) {
      detailFromPicker = false;
      const inspectedId = catalogDetail?.unitId;
      catalogDetail = null;
      detailIndex = null;
      byId("formationUnitPicker").hidden = false;
      byId("formationMain").inert = true;
      renderCatalog();
      (
        byId("formationCatalog").querySelector(`[data-detail-unit-id="${inspectedId}"]`) ||
        byId("closeFormationPicker")
      ).focus();
      return;
    }
    const selectedIndex = detailIndex,
      catalogId = catalogDetail?.unitId;
    detailIndex = null;
    catalogDetail = null;
    if (catalogId)
      byId("formationCatalog").querySelector(`[data-detail-unit-id="${catalogId}"]`)?.focus();
    if (selectedIndex !== null)
      byId("formationUnits")
        .querySelector(`[data-formation-index="${selectedIndex}"] .formation-detail-button`)
        ?.focus();
  }
  function appendUnit(entry) {
    draft.push(entry);
    GameAudio.play("infoSound");
    note("成功添加");
  }
  function preloadMatches(entry, carrierIndex, hangarId) {
    return entry.preload?.carrierIndex === carrierIndex && entry.preload.hangarId === hangarId;
  }
  function removeEntry(i) {
    draft.splice(i, 1);
    for (const entry of draft)
      if (entry.preload) {
        if (entry.preload.carrierIndex === i) delete entry.preload;
        else if (entry.preload.carrierIndex > i) entry.preload.carrierIndex--;
      }
  }
  function pickerCompatible(prefab) {
    if (!pickerContext) return true;
    const carrier = draft[pickerContext.carrierIndex],
      model = carrier && UnitModels[carrier.unitId + "__" + carrier.kitId],
      h = model?.hangars.find((h) => h.id === pickerContext.hangarId);
    if (!h || prefab.hangars?.length) return false;
    const used = draft
      .filter((e) => preloadMatches(e, pickerContext.carrierIndex, h.id))
      .reduce((n, e) => n + (UnitModels[e.unitId + "__" + e.kitId].transport.slotCost || 1), 0);
    return (
      used + prefab.transport.slotCost <= h.capacity &&
      h.allowedTags.some((t) => prefab.transport.loadTags.includes(t))
    );
  }
  function openPicker(context = null) {
    pickerContext = context;
    pickerReturnIndex = context?.carrierIndex ?? null;
    detailIndex = null;
    catalogDetail = null;
    detailFromPicker = false;
    byId("formationUnitDetail").hidden = true;
    byId("formationUnitPicker").hidden = false;
    byId("formationMain").inert = true;
    byId("formationPickerTitle").textContent = context ? "预先搭载" : "添加单位";
    renderCatalog();
    byId("closeFormationPicker").focus();
  }
  function closePicker() {
    byId("formationUnitPicker").hidden = true;
    const returnIndex = pickerReturnIndex;
    pickerContext = null;
    pickerReturnIndex = null;
    detailFromPicker = false;
    byId("formationMain").inert = false;
    if (returnIndex !== null && draft[returnIndex]) {
      detailIndex = returnIndex;
      catalogDetail = null;
      renderDetail();
      byId("formationDetailKit").focus();
    } else byId("openFormationPicker").focus();
  }
  function hangarLabel(carrierIndex, hangarId) {
    const carrier = draft[carrierIndex],
      m = carrier && UnitModels[carrier.unitId + "__" + carrier.kitId],
      number = m?.hangars.findIndex((h) => h.id === hangarId);
    return I18n.text("格纳库") + (number >= 0 ? number + 1 : "?");
  }
  function renderCarrierChoice(entry, model) {
    const field = byId("formationDetailCarrierField"),
      select = byId("formationDetailCarrier"),
      hint = byId("formationDetailCarrierHint");
    field.hidden = !!model.hangars.length;
    select.replaceChildren(new Option(I18n.text("不搭载（独立部署）"), ""));
    if (field.hidden) return;
    draft.forEach((carrier, carrierIndex) => {
      if (carrierIndex === detailIndex || carrier.preload) return;
      const cm = UnitModels[carrier.unitId + "__" + carrier.kitId];
      for (const h of cm.hangars) {
        const cargo = draft
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => preloadMatches(e, carrierIndex, h.id)),
          used = cargo.reduce(
            (n, { e }) => n + UnitModels[e.unitId + "__" + e.kitId].transport.slotCost,
            0,
          ),
          others = cargo
            .filter(({ i }) => i !== detailIndex)
            .reduce((n, { e }) => n + UnitModels[e.unitId + "__" + e.kitId].transport.slotCost, 0);
        if (
          !h.allowedTags.some((tag) => model.transport.loadTags.includes(tag)) ||
          others + model.transport.slotCost > h.capacity
        )
          continue;
        const option = new Option(
          `${carrier.customName || cm.name} · ${hangarLabel(carrierIndex, h.id)} · ${I18n.text("剩余容量")} ${h.capacity - used}/${h.capacity}`,
          JSON.stringify({ carrierIndex, hangarId: h.id }),
        );
        option.setAttribute("data-i18n-ignore", "");
        select.add(option);
      }
    });
    select.value = entry.preload ? JSON.stringify(entry.preload) : "";
    const atLimit = detailIndex === null && draft.length >= unitLimit();
    select.disabled = select.options.length === 1 || atLimit;
    hint.textContent = atLimit
      ? "已达到编组数量上限。"
      : select.disabled
        ? "没有兼容且有剩余容量的格纳库。"
        : detailIndex === null
          ? "选择格纳库会将该单位加入编组并预先搭载。"
          : "可在格纳库间调整，或选择独立部署。";
  }

  function renderPreloads(model) {
    const container = byId("formationDetailHangars");
    container.replaceChildren();
    byId("formationDetailHangarsBlock").hidden = !model.hangars.length;
    for (const [number, h] of model.hangars.entries()) {
      const passengers =
          detailIndex === null
            ? []
            : draft
                .map((entry, i) => ({ entry, i }))
                .filter(({ entry }) => preloadMatches(entry, detailIndex, h.id)),
        used = passengers.reduce(
          (n, { entry }) => n + UnitModels[entry.unitId + "__" + entry.kitId].transport.slotCost,
          0,
        ),
        heading = element("div", "formation-preload-heading"),
        add = element("button", "", "预先搭载");
      add.dataset.preloadHangar = h.id;
      add.disabled = draft.length + (detailIndex === null ? 1 : 0) >= unitLimit();
      add.onclick = () => {
        if (detailIndex === null) {
          const entry = { ...catalogDetail, customName: Rules.generateUnitName(model.name, draft) };
          try {
            Rules.validateFormation([...draft, entry], Infinity, unitLimit());
          } catch (error) {
            note(error.message);
            return;
          }
          appendUnit(entry);
          detailIndex = draft.length - 1;
          catalogDetail = null;
          detailFromPicker = false;
          render();
        }
        openPicker({ carrierIndex: detailIndex, hangarId: h.id });
      };
      heading.append(
        element(
          "strong",
          "",
          `${I18n.text("格纳库")}${number + 1} · ${used} / ${h.capacity} ${I18n.text("容量点")}`,
        ),
        add,
      );
      container.append(heading);
      if (detailIndex === null)
        container.append(element("p", "helper", "预先搭载会先将这艘运输单位加入编组。"));
      for (const { entry, i } of passengers) {
        const row = element("div", "formation-cargo-row"),
          image = element("img"),
          m = UnitModels[entry.unitId + "__" + entry.kitId],
          remove = element("button", "", "移除");
        image.src = unitIcon(entry.unitId + "__" + entry.kitId);
        image.alt = "";
        const label = element("span"),
          name = element("strong", "", entry.customName || m.name);
        name.toggleAttribute("data-i18n-ignore", !!entry.customName);
        label.append(
          name,
          document.createTextNode(" · "),
          element("small", "muted", `COST ${m.cost}`),
        );
        const equipment = element("label", "formation-cargo-equipment"),
          kits = element("select"),
          prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId);
        kits.dataset.preloadKit = String(i);
        kits.setAttribute("aria-label", I18n.text("装备组") + " · " + (entry.customName || m.name));
        for (const kit of prefab.weaponKits)
          kits.add(new Option(`${kit.name} · COST ${prefab.stats.cost + kit.cost}`, kit.id));
        kits.value = entry.kitId;
        kits.onchange = () => {
          const kitId = kits.value;
          try {
            Rules.validateFormation(
              draft.map((e, index) => (index === i ? { ...e, kitId } : e)),
              Infinity,
              Rules.catalog.formation.maxUnits * 3,
            );
          } catch (error) {
            kits.value = entry.kitId;
            note(error.message);
            return;
          }
          GameAudio.play("changeEquipmentSound");
          entry.kitId = kitId;
          render();
          renderDetail();
          byId("formationDetailHangars").querySelector(`[data-preload-kit="${i}"]`)?.focus();
        };
        equipment.append(element("small", "muted", "装备组"), kits);
        row.append(image, label, equipment);
        row.dataset.preloadUnit = i;
        remove.onclick = () => {
          removeEntry(i);
          if (detailIndex > i) detailIndex--;
          render();
          renderDetail();
        };
        row.append(remove);
        container.append(row);
      }
    }
  }
  // 按实际部件与持握武器渲染静态精灵，再以整体边界适配预览窗口。
  function renderPreview(modelId) {
    const canvas = byId("formationDetailPreview"),
      ctx = canvas.getContext("2d"),
      model = UnitModels[modelId];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.setAttribute("aria-label", model.code + " " + model.name);
    if (!assetsReady) return;
    const held = model.weapons[0]?.id,
      points = [];
    for (const layer of SpriteRenderer.visibleLayers(
      modelId,
      held,
      true,
      false,
      null,
      0,
      false,
      {},
      false,
      true,
      "ground",
    )) {
      const image = SpriteRenderer.images[layer.asset];
      if (!image) continue;
      const t = SpriteRenderer.layerTransform(modelId, layer, 0, {}),
        w = (layer.frameWidth || Math.floor(image.width / (layer.frames || 1))) / 2,
        h = (layer.frameHeight || image.height) / 2;
      for (const x of [-w, w])
        for (const y of [-h, h])
          points.push({
            x: t.x + Math.cos(t.rotation) * x * t.scaleX - Math.sin(t.rotation) * y * t.scaleY,
            y: t.y + Math.sin(t.rotation) * x * t.scaleX + Math.cos(t.rotation) * y * t.scaleY,
          });
    }
    if (!points.length) return;
    const left = Math.min(...points.map((p) => p.x)),
      right = Math.max(...points.map((p) => p.x)),
      top = Math.min(...points.map((p) => p.y)),
      bottom = Math.max(...points.map((p) => p.y)),
      scale = Math.min(
        (canvas.width - 48) / Math.max(1, right - left),
        (canvas.height - 48) / Math.max(1, bottom - top),
      );
    SpriteRenderer.draw(
      ctx,
      modelId,
      canvas.width / 2 - ((left + right) / 2) * scale,
      canvas.height / 2 - ((top + bottom) / 2) * scale,
      scale,
      0,
      null,
      0,
      held,
      false,
      true,
      false,
      {},
      0,
      false,
      true,
      "ground",
    );
  }
  function detailMetrics(container, entries) {
    container.replaceChildren();
    for (const [label, value] of entries) {
      const cell = element("div", "unit-detail-metric");
      cell.append(element("dt", "", I18n.text(label) + " "), element("dd", "", String(value)));
      container.append(cell);
    }
  }
  function renderDetail() {
    const originalEntry = detailIndex === null ? catalogDetail : draft[detailIndex];
    if (!originalEntry) return closeDetail();
    if (previewRoot !== originalEntry) {
      previewRoot = originalEntry;
      previewModel = null;
    }
    const rootId = originalEntry.unitId + "__" + originalEntry.kitId;
    const forms = new Map([[rootId, UnitModels[rootId].name]]);
    for (const [id] of forms) {
      const current = UnitModels[id];
      for (const skill of current.skills || []) {
        const results = [skill.source, skill.spawn].filter((r) => r?.unitId);
        if (skill.formUnitId)
          results.push({ unitId: skill.formUnitId, kitId: skill.formKits[current.kitId] });
        for (const result of results) {
          const kitId = result.kitMap?.[current.kitId] || result.kitId;
          const next = result.unitId + "__" + kitId;
          if (UnitModels[next] && !forms.has(next))
            forms.set(next, skill.name + " · " + UnitModels[next].name);
        }
      }
    }
    if (!forms.has(previewModel)) previewModel = null;
    const formButtons = byId("formationDetailForms");
    formButtons.replaceChildren();
    formButtons.hidden = forms.size < 2;
    for (const [id, name] of forms) {
      const button = element("button", "", id === rootId ? "原始形态" : name);
      button.dataset.previewModel = id;
      button.disabled = id === (previewModel || rootId);
      button.onclick = () => {
        previewModel = id === rootId ? null : id;
        renderDetail();
      };
      formButtons.append(button);
    }
    const selectedModel = UnitModels[previewModel || rootId];
    const entry = previewModel
      ? { unitId: selectedModel.prefabId, kitId: selectedModel.kitId }
      : originalEntry;
    const prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId);
    const model = UnitModels[entry.unitId + "__" + entry.kitId];
    byId("formationDetailTitle").textContent = model.code + " " + (entry.customName || model.name);
    byId("formationDetailTitle").toggleAttribute("data-i18n-ignore", !!entry.customName);
    byId("formationDetailTags").replaceChildren(unitTags(model));
    byId("formationDetailNameEditor").hidden = detailIndex === null || !!previewModel;
    renderPreview(entry.unitId + "__" + entry.kitId);
    renderPreloads(model);
    renderCarrierChoice(entry, model);
    if (previewModel) {
      byId("formationDetailCarrierField").hidden = true;
      byId("formationDetailHangarsBlock").hidden = true;
    }
    if (nameEdit && nameEdit.entry !== entry) nameEdit = null;
    byId("formationDetailName").value = nameEdit ? nameEdit.value : entry.customName || "";
    byId("formationDetailName").readOnly = !nameEdit;
    byId("editFormationUnitName").textContent = I18n.text(nameEdit ? "保存名称" : "修改名称");
    byId("formationDetailName").placeholder = model.name;
    byId("resetFormationUnitName").disabled = !entry.customName;
    byId("formationDetailIntro").textContent = model.description;
    const kits = byId("formationDetailKit");
    kits.replaceChildren();
    for (const kit of prefab.weaponKits)
      kits.add(new Option(`${kit.name} · COST ${prefab.stats.cost + kit.cost}`, kit.id));
    kits.value = entry.kitId;
    kits.disabled = !!previewModel;
    detailMetrics(byId("formationDetailStats"), [
      ["HP", model.hp.toLocaleString()],
      ["EN", model.en],
      ["COST", model.cost],
      ["反应系数", model.mobility],
      ["命中系数", model.accuracy + "%"],
      ["行动点", model.actionPoints ?? 5],
      ["零件强度", model.partStructuralStrength],
      ...(model.ship
        ? [
            ["战舰占地", model.footprint.width + "×" + model.footprint.height],
            ["炮塔模块", model.modules.length],
          ]
        : []),
    ]);
    const movementNames = {
      ground: "地面移动",
      air: "空中移动",
      naval: "水上移动",
      amphibious: "两栖移动",
      hover: "气垫移动",
    };
    detailMetrics(byId("formationDetailMovement"), [
      ["移动", model.move],
      ["移动方式", I18n.text(movementNames[model.movementType || "ground"])],
      ...[
        ["ground", "地面适应性"],
        ["mountain", "山地适应性"],
        ["space", "宇宙适应性"],
        ["water", "水中适应性"],
        ["atmosphere", "大气层适应性"],
        ["air", "空中适应性"],
        ["forest", "树林适应性"],
        ["snow", "雪地适应性"],
        ["desert", "沙漠适应性"],
        ["rubble", "废墟适应性"],
      ].map(([key, label]) => [label, (model.adaptability[key] ?? 0) + "%"]),
    ]);
    const labels = {
      melee: "格斗",
      shooting: "射击",
      beam: "光束",
      shell: "实弹",
      dp: "DP",
      sp: "SP",
    };
    const defense = byId("formationDetailDefense"),
      table = element("table", "unit-defense-table"),
      head = element("thead"),
      header = element("tr");
    for (const text of ["防护", "抗性", "固定减伤"]) header.append(element("th", "", text));
    head.append(header);
    table.append(head);
    const body = element("tbody");
    for (const [type, value] of Object.entries(model.defenses)) {
      const row = element("tr");
      row.append(
        element("td", "", I18n.text(labels[type] || type)),
        element("td", "", value.percent + "%"),
        element("td", "", value.flat.toLocaleString()),
      );
      body.append(row);
    }
    table.append(body);
    defense.replaceChildren(table);
    detailMetrics(
      byId("formationDetailBonuses"),
      Object.entries(model.attackBonuses).map(([type, value]) => [
        labels[type] || type,
        (value >= 0 ? "+" : "") + value + "%",
      ]),
    );
    detailMetrics(byId("formationDetailShield"), [
      ["盾牌HP", model.shield.hp.toLocaleString()],
      ["格挡率", Math.round(model.shield.blockChance * 100) + "%"],
    ]);
    const weapons = byId("formationDetailSlots"),
      abilities = byId("formationDetailSkills"),
      mechanics = byId("formationDetailMechanics");
    weapons.replaceChildren();
    abilities.replaceChildren();
    mechanics.replaceChildren();
    for (const [index, weapon] of model.weapons.entries()) {
      const card = element("div", "formation-weapon-detail"),
        heading = element("div", "unit-slot-heading");
      heading.append(
        element("strong", "", weapon.name),
        element("span", "unit-slot-badge", I18n.text("槽位") + " " + (index + 1)),
      );
      card.append(heading);
      const metrics = element("dl", "unit-detail-metrics");
      detailMetrics(metrics, [
        ["威力", Math.round(weapon.damage).toLocaleString()],
        ["发射次数", weapon.shotCount],
        ["命中", weapon.hit + "%"],
        ["射程", weapon.min + "–" + weapon.max],
        ["EN", weapon.en],
        ["AP", Rules.actionCost(weapon)],
        ...(Number.isInteger(weapon.maxUses) ? [["\u4f7f\u7528\u6b21\u6570", weapon.maxUses]] : []),
      ]);
      card.append(metrics);
      const all = (weapon.requiredParts || [])
        .map((part) => I18n.text(Rules.partNames[part]))
        .join(" / ");
      const any = (weapon.anyParts || [])
        .map((part) => I18n.text(Rules.partNames[part]))
        .join(" / ");
      card.append(
        element(
          "p",
          "unit-slot-mount",
          I18n.text("安装部位") +
            ": " +
            (all || any || I18n.text("躯干")) +
            (any ? " · " + I18n.text("任一部位完好即可") : "") +
            " · " +
            I18n.text("部位破坏系数") +
            " " +
            weapon.partBreakModifier,
        ),
      );
      weapons.append(card);
    }
    if (model.supplyAura) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", "自动补给"),
        element(
          "p",
          "muted",
          `范围 ${model.supplyAura.range} · 每个己方回合范围内友军HP +5%、EN +10% · 不消耗EN，不消耗行动`,
        ),
      );
      mechanics.append(card);
    }
    for (const skill of model.skills || []) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", skill.name),
        element("p", "muted", SkillControls.description(skill)),
      );
      mechanics.append(card);
    }
    for (const weapon of model.hiddenWeapons || []) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", weapon.name + "（暂时隐藏）"),
        element(
          "p",
          "muted",
          weapon.reasons
            .map(
              (reason) =>
                ({
                  pilot_skill: "驾驶员技能解锁：保留原条件，暂不开放",
                  secondary_loadout: "可换装副武器：保留配置，暂不开放",
                })[reason] || reason,
            )
            .join(" · "),
        ),
      );
      mechanics.append(card);
    }
    for (const mechanic of model.mechanics || []) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", mechanic.name),
        element(
          "p",
          "muted",
          {
            implemented: "已接入",
            adapted: "回合制改编",
            review: "原MOD机制：待接入",
            not_applicable: "本项目未接入对应科技／驾驶员系统",
          }[mechanic.status] || mechanic.status,
        ),
      );
      mechanics.append(card);
    }
    if (model.movementType === "air")
      byId("formationDetailMovement").append(element("p", "helper", "空军：可跨越山岩和水域"));
    byId("formationDetailSkillsBlock").hidden = !abilities.children.length;
    byId("formationDetailMechanicsBlock").hidden = !mechanics.children.length;
    byId("formationUnitDetail").hidden = false;
    byId("formationMain").inert = true;
  }
  function environmentLabel(adaptability) {
    return ["ground", "space"]
      .filter((environment) => (adaptability?.[environment] ?? 100) >= 100)
      .map((environment) => I18n.text(environment === "ground" ? "地面" : "宇宙"))
      .join("/");
  }

  function unitSummaryTags(adaptability, kitName, cost) {
    const tags = element("span", "unit-summary-tags");
    const add = (label, kind, dim = false) =>
      tags.append(element("span", "unit-summary-tag " + kind + (dim ? " is-dim" : ""), label));
    const ground = adaptability?.ground ?? 0,
      space = adaptability?.space ?? 0;
    add(I18n.text("\u5730\u9762") + " " + ground + "%", "ground", ground < 90);
    add(I18n.text("\u5b87\u5b99") + " " + space + "%", "space", space < 90);
    add("COST " + cost, "cost");
    if (kitName) add(kitName, "kit");
    return tags;
  }

  function unitTags(model) {
    const tags = element("span", "unit-tags"),
      primary = element("span", "unit-tags-primary"),
      types = element("span", "unit-tags-types");
    for (const value of model.tags) {
      const tag = element("span", value === model.faction ? "faction-tag" : "era-tag", value);
      tag.dataset.tag = value;
      if (value === model.faction) tag.dataset.faction = value;
      primary.append(tag);
    }
    for (const value of model.unitTags || []) {
      const tag = element("span", "type-tag", I18n.text(Rules.unitTagName(value)));
      tag.dataset.tag = value;
      types.append(tag);
    }
    tags.append(primary);
    if (types.children.length) tags.append(types);
    return tags;
  }
  function render() {
    const unitCostLimit = restrictions().unitCostLimit;
    const unitCostRule = element(
      "span",
      "formation-unit-cost-limit" + (Number.isFinite(unitCostLimit) ? " has-limit" : ""),
      `单位COST上限: ${displayLimit(unitCostLimit)}`,
    );
    unitCostRule.id = "formationUnitCostLimit";
    byId("formationBudget").replaceChildren(
      element(
        "span",
        "",
        `${draft.length} / ${unitLimit()} 台 · 编组COST: ${cost(draft)} / ${displayLimit(budget())}`,
      ),
      document.createTextNode(" · "),
      unitCostRule,
    );
    byId("formationBudget").classList.toggle("danger-text", draft.length > unitLimit());
    byId("addFormationUnit").disabled =
      draft.length >= unitLimit() || !byId("formationPrefab").value;
    byId("openFormationPicker").disabled = draft.length >= unitLimit();
    renderPickerCost();
    const plan = draft.length
      ? Rules.planFormation(draft, budget(), restrictions(), Rules.catalog.formation.maxUnits * 3)
      : { disabled: [] };
    const list = byId("formationUnits"),
      scrollTop = list.scrollTop;
    list.replaceChildren();
    // 仅调整显示顺序，保留保存序号、搭载引用和 OVER COST 的末尾优先规则。
    const displayOrder = draft.flatMap((entry, i) =>
      entry.preload
        ? []
        : [
            i,
            ...(UnitModels[entry.unitId + "__" + entry.kitId].hangars || []).flatMap((h) =>
              draft.flatMap((cargo, j) => (preloadMatches(cargo, i, h.id) ? [j] : [])),
            ),
          ],
    );
    displayOrder.forEach((i, position) => {
      const entry = draft[i],
        previous = draft[displayOrder[position - 1]];
      if (
        entry.preload &&
        (!previous?.preload ||
          previous.preload.carrierIndex !== entry.preload.carrierIndex ||
          previous.preload.hangarId !== entry.preload.hangarId)
      ) {
        const divider = element(
          "div",
          "formation-hangar-divider",
          hangarLabel(entry.preload.carrierIndex, entry.preload.hangarId),
        );
        divider.dataset.hangarGroup = entry.preload.carrierIndex + "/" + entry.preload.hangarId;
        list.append(divider);
      }
      const row = element(
          "div",
          "formation-row" + (entry.preload ? " formation-preloaded-row" : ""),
        ),
        model = UnitModels[entry.unitId + "__" + entry.kitId];
      row.dataset.formationIndex = String(i);
      if (entry.preload) row.dataset.carrierIndex = String(entry.preload.carrierIndex);
      const show = () => {
        GameAudio.selectUnit(model);
        detailIndex = i;
        catalogDetail = null;
        renderDetail();
        byId("formationDetailKit").focus();
      };
      const details = element("button", "formation-detail-button", "详情");
      details.setAttribute("aria-haspopup", "dialog");
      details.onclick = show;
      const icon = element("span", "formation-icon"),
        image = element("img");
      image.src = unitIcon(entry.unitId + "__" + entry.kitId);
      image.width = 56;
      image.alt = entry.customName || model.name;
      icon.append(image);
      if (plan.disabled.includes(i)) {
        row.classList.add(
          "unit-disabled",
          plan.reasons[i] === "not_allowed" ? "not-allowed" : "overcost",
        );
        row.append(
          element("span", "disabled-panel"),
          element(
            "span",
            "overcost-label",
            plan.reasons[i] === "not_allowed" ? "不被允许的单位" : "OVER COST",
          ),
        );
      }
      const label = element("span", "formation-unit-name");
      const prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId),
        kit = prefab.weaponKits.find((k) => k.id === entry.kitId);
      const description = element("small", "muted formation-row-description", model.description);
      description.title = model.description;
      label.append(
        unitTags(model),
        element(
          "strong",
          "",
          `${entry.preload ? "" : i + 1 + ". "}${model.code} ${entry.customName || model.name}`,
        ),
        unitSummaryTags(model.adaptability, kit.name, model.cost),
        description,
      );
      if (entry.customName) label.querySelector("strong").setAttribute("data-i18n-ignore", "");
      if (entry.preload) {
        const carrier = draft[entry.preload.carrierIndex],
          annotation = element("small", "formation-cargo-note"),
          name = element(
            "span",
            "",
            carrier.customName || UnitModels[carrier.unitId + "__" + carrier.kitId].name,
          );
        name.toggleAttribute("data-i18n-ignore", !!carrier.customName);
        annotation.append(
          document.createTextNode(I18n.text("预先搭载") + " · "),
          name,
          document.createTextNode(
            " · " + hangarLabel(entry.preload.carrierIndex, entry.preload.hangarId),
          ),
        );
        label.append(annotation);
      }
      const remove = element("button", "", "移除");
      remove.onclick = (event) => {
        event.stopPropagation();
        closeDetail();
        removeEntry(i);
        render();
      };
      const actions = element("div", "formation-row-actions");
      actions.append(details, remove);
      row.append(icon, label, actions);
      list.append(row);
    });
    list.scrollTop = scrollTop;
  }
  byId("closeFormationDetail").onclick = closeDetail;
  byId("formationUnitDetail").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeDetail();
    }
    if (event.key === "Tab") {
      const controls = [
        ...byId("formationUnitDetail").querySelectorAll("button,input,select,summary"),
      ].filter((control) => !control.disabled && control.getClientRects().length);
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0].focus();
      }
    }
  });
  byId("formationDetailName").oninput = (event) => {
    if (nameEdit) nameEdit.value = event.target.value;
  };
  byId("editFormationUnitName").onclick = () => {
    if (detailIndex === null) return;
    const entry = draft[detailIndex];
    if (!nameEdit) {
      nameEdit = { entry, value: entry.customName || "" };
      renderDetail();
      byId("formationDetailName").focus();
      return;
    }
    try {
      const name = Rules.normalizeUnitName(nameEdit.value);
      if (name) entry.customName = name;
      else delete entry.customName;
      nameEdit = null;
      render();
      renderDetail();
    } catch (error) {
      byId("formationStatus").textContent = error.message;
    }
  };
  byId("resetFormationUnitName").onclick = () => {
    if (detailIndex === null) return;
    nameEdit = null;
    delete draft[detailIndex].customName;
    render();
    renderDetail();
    byId("formationDetailName").focus();
  };
  byId("formationDetailKit").onchange = (event) => {
    const entry = detailIndex === null ? catalogDetail : draft[detailIndex];
    if (!entry) return;
    previewModel = null;
    GameAudio.play("changeEquipmentSound");
    entry.kitId = event.target.value;
    if (detailIndex === null) pickerKits.set(entry.unitId, entry.kitId);
    if (detailIndex !== null) render();
    renderDetail();
  };
  byId("formationDetailCarrier").onchange = (event) => {
    const entry = detailIndex === null ? catalogDetail : draft[detailIndex];
    if (!entry) return;
    try {
      const next = { ...entry };
      if (event.target.value) next.preload = JSON.parse(event.target.value);
      else delete next.preload;
      if (detailIndex === null) {
        if (!next.preload) return;
        if (draft.length >= unitLimit()) throw Error("已达到编组数量上限。");
        next.customName = Rules.generateUnitName(
          UnitModels[next.unitId + "__" + next.kitId].name,
          draft,
        );
      }
      const entries =
        detailIndex === null
          ? [...draft, next]
          : draft.map((e, i) => (i === detailIndex ? next : e));
      Rules.validateFormation(entries, Infinity, Rules.catalog.formation.maxUnits * 3);
      const adding = detailIndex === null;
      if (adding) {
        appendUnit(next);
        detailIndex = draft.length - 1;
        catalogDetail = null;
      } else draft[detailIndex] = next;
      if (!adding) GameAudio.play("changeEquipmentSound");
      render();
      renderDetail();
      byId("formationDetailCarrier").focus();
    } catch (error) {
      note(error.message);
      renderDetail();
      byId("formationDetailCarrier").focus();
    }
  };
  function open() {
    if (Net.active && ownPlayer()?.formationPreset) {
      note("房主已指定编组预设，请由房主调整。");
      return;
    }
    detailFromPicker = false;
    pickerContext = null;
    pickerReturnIndex = null;
    byId("formationUnitPicker").hidden = true;
    closeDetail();
    previousIndex = index;
    returnView = pageView === "room" ? "room" : "menu";
    const activePlan =
      Net.snapshot?.phase === "assembly"
        ? Net.snapshot.assembly?.players.find((player) => player.memberId === Net.memberId)
        : null;
    draft = structuredClone(activePlan?.entries || current());
    byId("formationName").value = squads[index].name;
    refreshSelect();
    render();
    renderCatalog();
    setPageView("formation");
  }
  byId("formationSelect").onchange = (e) => {
    closeDetail();
    index = Number(e.target.value);
    byId("formationName").value = squads[index].name;
    draft = structuredClone(current());
    render();
  };
  byId("newFormation").onclick = () => {
    closeDetail();
    squads.push({ name: `编组${squads.length + 1}`, units: structuredClone(fallback) });
    index = squads.length - 1;
    byId("formationName").value = squads[index].name;
    draft = structuredClone(current());
    refreshSelect();
    render();
  };
  byId("deleteFormation").onclick = () => {
    if (squads.length <= 1) return;
    closeDetail();
    const removed = index;
    squads.splice(removed, 1);
    if (previousIndex > removed) previousIndex--;
    else if (previousIndex === removed) previousIndex = Math.min(removed, squads.length - 1);
    // 删除立即保存；回到仍有效的出战编组，取消编辑时也不会引用已删除项。
    index = previousIndex;
    draft = structuredClone(current());
    byId("formationName").value = squads[index].name;
    persist();
    refreshSelect();
    render();
    note("编组已删除。");
  };
  byId("openFormationPicker").onclick = () => openPicker();
  byId("closeFormationPicker").onclick = closePicker;
  byId("formationUnitPicker").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      closePicker();
    }
    if (event.key === "Tab") {
      const controls = [...byId("formationUnitPicker").querySelectorAll("button,select")].filter(
        (el) => !el.disabled && el.getClientRects().length,
      );
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    }
  });
  byId("addFormationUnit").onclick = () => {
    const prefab = Rules.catalog.prefabs.find((p) => p.id === byId("formationPrefab").value);
    if (!prefab || !pickerCompatible(prefab)) return;
    if (draft.length >= unitLimit()) return note("已达到编组数量上限。");
    const entry = {
      unitId: prefab.id,
      kitId: pickerKits.get(prefab.id) || prefab.weaponKits[0].id,
      customName: Rules.generateUnitName(prefab.name, draft),
      ...(pickerContext ? { preload: { ...pickerContext } } : {}),
    };
    try {
      Rules.validateFormation([...draft, entry], Infinity, unitLimit());
    } catch (error) {
      note(error.message);
      return;
    }
    appendUnit(entry);
    render();
    byId("formationUnits").scrollTop = byId("formationUnits").scrollHeight;
    if (pickerContext) closePicker();
    else renderCatalog();
  };
  byId("formationSearch").oninput = () => renderCatalog();
  function renderCatalog() {
    const query = byId("formationSearch").value.trim().toLocaleLowerCase();
    const prefabs = Rules.catalog.prefabs
      .filter(
        (p) =>
          !p.formOnly &&
          (!query ||
            [p.id, p.name, p.code, ...Object.values(p.localization || {}).map((l) => l.name)]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query)) &&
          pickerCompatible(p) &&
          (!catalogFilters.faction || p.faction === catalogFilters.faction) &&
          (!catalogFilters.era || p.tags.includes(catalogFilters.era)) &&
          (!catalogFilters.types || (p.unitTags || []).includes(catalogFilters.types)) &&
          (!catalogFilters.environment ||
            (p.stats.adaptability?.[catalogFilters.environment] ?? 0) >= 90),
      )
      .sort(
        (a, b) =>
          a.faction.localeCompare(b.faction, "en") ||
          a.name.localeCompare(b.name, I18n.language, { numeric: true, sensitivity: "base" }) ||
          a.id.localeCompare(b.id, "en"),
      );
    if (!prefabs.some((p) => p.id === byId("formationPrefab").value))
      byId("formationPrefab").value = prefabs[0]?.id || "";
    const list = byId("formationCatalog");
    const scroll = list.scrollTop;
    list.replaceChildren();
    for (const prefab of prefabs) {
      const card = element("button", "catalog-unit");
      card.dataset.unitId = prefab.id;
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", String(byId("formationPrefab").value === prefab.id));
      const image = element("img");
      image.src = unitIcon(prefab.id + "__" + prefab.weaponKits[0].id);
      image.alt = prefab.name;
      const title = element("strong", "", prefab.code + " " + prefab.name);
      const info = element("span", "catalog-unit-info");
      const costs = prefab.weaponKits.map((k) => prefab.stats.cost + k.cost);
      info.append(
        unitTags(prefab),
        title,
        unitSummaryTags(
          prefab.stats.adaptability,
          (
            prefab.weaponKits.find((kit) => kit.id === pickerKits.get(prefab.id)) ||
            prefab.weaponKits[0]
          ).name,
          Math.min(...costs) === Math.max(...costs)
            ? Math.min(...costs)
            : Math.min(...costs) + "?" + Math.max(...costs),
        ),
      );
      card.append(image, info);
      card.onclick = () => {
        GameAudio.selectUnit(prefab);
        byId("formationPrefab").value = prefab.id;
        renderCatalog();
      };
      const details = element("button", "catalog-detail", "详情");
      details.dataset.detailUnitId = prefab.id;
      details.setAttribute("aria-haspopup", "dialog");
      details.setAttribute("aria-label", `${prefab.code} ${prefab.name} · ${I18n.text("详情")}`);
      details.onclick = () => {
        GameAudio.selectUnit(prefab);
        byId("formationPrefab").value = prefab.id;
        renderCatalog();
        detailIndex = null;
        detailFromPicker = !byId("formationUnitPicker").hidden;
        byId("formationUnitPicker").hidden = true;
        catalogDetail = {
          unitId: prefab.id,
          kitId: pickerKits.get(prefab.id) || prefab.weaponKits[0].id,
        };
        renderDetail();
        byId("formationDetailKit").focus();
      };
      const row = element("div", "catalog-unit-row");
      row.append(card, details);
      list.append(row);
    }
    if (!prefabs.length) list.append(element("p", "empty", "没有符合筛选的单位"));
    list.scrollTop = scroll;
    byId("addFormationUnit").disabled = !prefabs.length || draft.length >= unitLimit();
    renderPickerCost();
  }
  function setupCatalogFilter(id, key, values, translate = (tag) => tag) {
    const select = byId(id);
    function refresh() {
      select.replaceChildren(new Option(I18n.text("不限"), ""));
      for (const value of values) select.add(new Option(translate(value), value));
      select.value = catalogFilters[key];
    }
    select.onchange = () => {
      catalogFilters[key] = values.includes(select.value) ? select.value : "";
      renderCatalog();
    };
    window.addEventListener("language-change", refresh);
    refresh();
  }
  setupCatalogFilter("formationFaction", "faction", Rules.factions);
  setupCatalogFilter("formationEra", "era", Rules.eras);
  setupCatalogFilter("formationEnvironment", "environment", ["ground", "space"], (value) =>
    I18n.text(value === "ground" ? "\u5730\u9762" : "\u5b87\u5b99"),
  );
  setupCatalogFilter(
    "formationType",
    "types",
    [
      ...new Set(Rules.catalog.prefabs.filter((p) => !p.formOnly).flatMap((p) => p.unitTags || [])),
    ].sort(),
    (tag) => I18n.text(Rules.unitTagName(tag)),
  );
  renderCatalog();
  byId("openFormationShare").onclick = openShare;
  byId("closeFormationShare").onclick = () => closeShare();
  byId("formationSharePanel").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeShare();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [...byId("formationSharePanel").querySelectorAll("button,input")].filter(
      (control) => !control.disabled && control.getClientRects().length,
    );
    if (event.shiftKey && document.activeElement === controls[0]) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault();
      controls[0]?.focus();
    }
  });
  byId("generateFormationShare").onclick = async () => {
    try {
      const input = byId("formationShareCode"),
        code = encodeShare(byId("formationName").value, draft);
      input.value = code;
      input.focus();
      input.select();
      let copied = false;
      // Preserve the click gesture for offline and HTTP clipboard access.
      try {
        copied = document.execCommand("copy");
      } catch {}
      if (!copied && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(code);
          copied = true;
        } catch {}
      }
      note(copied ? "分享代码已复制。" : "分享代码已生成，请手动复制。");
    } catch (error) {
      note(error.message);
    }
  };
  byId("loadSharedFormation").onclick = () => {
    try {
      const imported = decodeShare(byId("formationShareCode").value);
      imported.name = uniqueSquadName(imported.name);
      squads.push(imported);
      index = squads.length - 1;
      previousIndex = index;
      draft = structuredClone(imported.units);
      byId("formationName").value = imported.name;
      persist();
      refreshSelect();
      render();
      closeShare(false);
      byId("formationSelect").focus();
      note("分享编组已加载并保存。");
    } catch (error) {
      note(error.message || "编组分享代码无效。");
      byId("formationShareCode").focus();
    }
  };
  byId("saveFormation").onclick = () => {
    try {
      const units = Rules.validateFormation(draft, Infinity, Rules.catalog.formation.maxUnits * 3);
      squads[index] = {
        name: byId("formationName").value.trim().slice(0, 32) || "未命名编组",
        units,
      };
      persist();
      if (
        Net.active &&
        Net.seat !== null &&
        units.length <= unitLimit() &&
        (!Net.snapshot.started || Net.snapshot.phase === "assembly")
      )
        Net.request("update_formation", { formation: units });
      closeDetail();
      setPageView(returnView);
      update();
      note("编组已保存并选用。");
    } catch {
      note("请保留至少一台单位，并检查数量与 COST 上限。");
    }
  };
  byId("cancelFormation").onclick = () => {
    index = previousIndex;
    setPageView(returnView);
    update();
  };
  byId("openFormation").onclick = open;
  byId("roomFormation").onclick = open;
  window.addEventListener("game-assets-ready", () => {
    if (pageView === "formation" && (detailIndex !== null || catalogDetail)) renderDetail();
  });
  window.addEventListener("language-change", () => {
    renderCatalog();
    if (pageView === "formation") {
      refreshSelect();
      render();
      if (detailIndex !== null || catalogDetail) renderDetail();
    }
  });
  return {
    current,
    open,
    refresh: () => {
      if (pageView === "formation") {
        render();
        if (detailIndex !== null || catalogDetail) renderDetail();
      }
    },
    name: () => squads[index].name,
    presetIndex: () => index,
    selectPreset: (value) => {
      if (!Number.isInteger(value) || value < 0 || value >= squads.length) return false;
      index = value;
      persist();
      return true;
    },
    presets: () =>
      squads.map((squad) => ({
        name: squad.name,
        units: Rules.validateFormation(squad.units, Infinity, Rules.catalog.formation.maxUnits * 3),
      })),
  };
})();

/* 开局部署：预放在出生区，玩家可以选中单位后点击空格调整。 */
const Deployment = (() => {
  // 无房间时仅供开发预览与画面测试切换部署焦点。实际对局使用房间席位。
  let previewSeat = 0;
  const team = () => (Net.active ? Net.seat : previewSeat);
  const canEdit = () =>
    phase === "deployment" &&
    team() !== null &&
    !game.deployment?.[team()] &&
    !Net.awaiting &&
    (!Net.active || Net.snapshot.connected.every(Boolean));
  const canEditUnit = (u) =>
    !!u &&
    phase === "deployment" &&
    !Net.awaiting &&
    !game.deployment?.[Rules.ownerOf(u)] &&
    (Net.active
      ? Net.canControl(u) && Net.snapshot.connected.every(Boolean)
      : Rules.ownerOf(u) === team());
  const areaSeat = () => {
    const u = getUnit(selected);
    return u && (Net.active ? Net.canControl(u) : Rules.ownerOf(u) === team())
      ? Rules.ownerOf(u)
      : team();
  };
  function render() {
    byId("deploymentPanel").hidden = phase !== "deployment";
    byId("confirmDeployment").hidden = phase !== "deployment";
    byId("endTurn").hidden = [
      "start",
      "connecting",
      "deployment",
      "waiting",
      "assembly",
      "finished",
    ].includes(phase);
    if (phase !== "deployment") return;
    const seat = team();
    byId("deploymentStatus").textContent =
      seat === null
        ? "观战：等待两队部署。"
        : `${teamName(Rules.seatTeam(seat))}出生区部署 · 选中己方单位，再点击高亮空格调整位置。`;
    byId("confirmDeployment").disabled = !canEdit();
    byId("confirmDeployment").textContent =
      seat !== null && game.deployment[seat] ? "已确认，等待对方" : "确认部署";
  }
  function click(cell) {
    if (phase !== "deployment" || Net.awaiting || !cell) return;
    const target = Rules.at(game, cell.x, cell.y),
      u = getUnit(selected);
    if (target && canEditUnit(target)) {
      GameAudio.selectUnit(target);
      selected = target.id;
      update();
      return;
    }
    if (!canEditUnit(u)) return note("请先选中己方单位。");
    const anchor = Rules.anchorAt(u, cell.mapX ?? cell.x, cell.mapY ?? cell.y);
    if (Net.active) Net.request("deploy", { unitId: u.id, ...anchor });
    else {
      try {
        Rules.deploy(game, team(), u.id, anchor.x, anchor.y);
        update();
      } catch {
        note("请在己方出生区的空格部署。");
      }
    }
  }
  byId("confirmDeployment").onclick = () => {
    if (!canEdit()) return;
    if (Net.active) return Net.request("confirm_deployment");
    if (game.ai) game.deployment[1] = true;
    const finished = Rules.confirmDeployment(game, team());
    if (finished) {
      phase = "idle";
      selected = null;
      note("部署完成，蓝方先手。");
    } else {
      previewSeat = 1;
      selected = null;
      note("请红方调整并确认部署。");
    }
    update();
  };
  return {
    render,
    click,
    team,
    canEdit,
    canEditUnit,
    areaSeat,
    reset: () => {
      previewSeat = 0;
    },
  };
})();
