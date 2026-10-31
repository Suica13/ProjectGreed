/* 编组保存单位/套件 ID 与可选自定义名称；数值和部署合法性由共用规则决定。 */
const Formation = (() => {
  const legacyStorageKey = "slg-formations-v1";
  const formationSaveVersion = 3;
  let group = PlayerProfile.faction();
  let storageKey = legacyStorageKey + "." + group;
  const sessionSaves = new Map();
  const pilotStorageKey = "projectgreed.custom-pilots.v2.";
  const pilotStores = {};
  for (const faction of ["PMC", "EFSF", "ZEON"]) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(pilotStorageKey + faction));
    } catch {}
    pilotStores[faction] = {
      pilots: (Array.isArray(saved?.pilots) ? saved.pilots : []).flatMap((p) => {
        try {
          return [PilotSystem.custom({ ...p, faction })];
        } catch {
          return [];
        }
      }),
      awards: Array.isArray(saved?.awards) ? saved.awards : [],
    };
  }
  // Claim the old shared roster once; keep the original data as a migration backup.
  try {
    if (!localStorage.getItem(pilotStorageKey + "migrated")) {
      const old = JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v1"));
      if (Array.isArray(old?.pilots)) {
        const target = pilotStores[group];
        for (const p of old.pilots) {
          try {
            if (!target.pilots.some((x) => x.id === p.id))
              target.pilots.push(PilotSystem.custom({ ...p, faction: group }));
          } catch {}
        }
        target.awards = [...new Set([...target.awards, ...(old.awards || [])])];
        localStorage.setItem(pilotStorageKey + group, JSON.stringify(target));
      }
      localStorage.setItem(pilotStorageKey + "migrated", group);
    }
  } catch {}
  const sharedPilotKey = "projectgreed.custom-pilots.v3.shared";
  let pilotStore;
  try {
    pilotStore = JSON.parse(localStorage.getItem(sharedPilotKey));
  } catch {}
  if (!Array.isArray(pilotStore?.pilots) || !Array.isArray(pilotStore?.awards)) {
    const pilots = new Map();
    for (const store of Object.values(pilotStores))
      for (const pilot of store.pilots) {
        const previous = pilots.get(pilot.id);
        if (
          !previous ||
          pilot.level > previous.level ||
          (pilot.level === previous.level && pilot.experience > previous.experience)
        )
          pilots.set(pilot.id, pilot);
      }
    pilotStore = {
      pilots: [...pilots.values()],
      awards: [...new Set(Object.values(pilotStores).flatMap((store) => store.awards))],
    };
  } else {
    pilotStore.pilots = pilotStore.pilots.map((pilot) => PilotSystem.custom(pilot));
  }
  savePilots();
  function savePilots() {
    try {
      localStorage.setItem(sharedPilotKey, JSON.stringify(pilotStore));
    } catch {
      note("浏览器无法保存驾驶员，本次会话仍可使用。");
    }
  }
  function hydratePilots(entries) {
    return entries.map((entry) => {
      const copy = { ...entry };
      // Named ACEs remain in the catalog for future technology unlocks.
      delete copy.pilotId;
      if (copy.customPilot) {
        const saved = pilotStore.pilots.find((p) => p.id === copy.customPilot.id);
        if (saved && !saved.needsRecruitment && PilotSystem.canAssign(saved, group))
          copy.customPilot = structuredClone(saved);
        else delete copy.customPilot;
      }
      return copy;
    });
  }
  function receivePilotAwards(snapshot) {
    if (snapshot.replay || snapshot.phase === "replay" || snapshot.startedFromSave) return;
    if (PilotSystem.creditAwards(pilotStore, snapshot.pilotAwards || [])) {
      savePilots();
      squads = squads.map((s) => ({ ...s, units: hydratePilots(s.units) }));
    }
    draft = hydratePilots(draft);
  }
  function defaultSquads(faction) {
    const carrier = (unitId) => ({ unitId, kitId: "standard" });
    const passenger = (unitId, kitId) => ({
      unitId,
      kitId,
      preload: { carrierIndex: 0, hangarId: "Hangar_1" },
    });
    const units = {
      EFSF: [
        carrier("Medea"),
        passenger("FF_B2", "main_0"),
        passenger("FF_B2", "main_0"),
        ...Array.from({ length: 4 }, () => passenger("Type61", "standard")),
      ],
      ZEON: [
        carrier("FatUncle"),
        passenger("MS_06F", "machine_gun"),
        passenger("MS_06F", "machine_gun"),
        passenger("MS_06S", "kit_1"),
      ],
      PMC: [
        carrier("Medea"),
        passenger("MS_06F", "machine_gun"),
        passenger("MS_06F", "machine_gun"),
        passenger("MS_06S", "kit_1"),
      ],
    };
    return [{ name: faction + " 默认编组", units: units[faction] }];
  }
  let squads = defaultSquads(group);
  let index = 0,
    returnView = "menu",
    draft = [],
    previewModel = null,
    previewRoot = null,
    detailIndex = null,
    catalogDetail = null,
    pickerContext = null,
    pickerReturnIndex = null,
    detailFromPicker = false,
    detailFromDevelopment = false,
    developmentPreviewFocus = null,
    pilotIndex = null;
  const pickerKits = new Map();
  const catalogFilters = { faction: "", era: "", type: "" };
  const current = () =>
    !squads[index].units.length
      ? []
      : Rules.validateFormation(
          hydratePilots(squads[index].units),
          Infinity,
          Rules.catalog.formation.maxUnits,
        );
  const ownPlayer = () => Net.snapshot?.members.find((player) => player.id === Net.memberId);
  const budget = () =>
    Net.active && Net.snapshot?.settings
      ? Rules.armyBudget(Net.snapshot.settings, ownPlayer())
      : Infinity;
  const restrictions = () => ({
    ...(Net.active && Net.snapshot?.settings
      ? Rules.armyRestrictions(Net.snapshot.settings, ownPlayer())
      : {}),
    characterFaction: group,
    licenses: Economy.snapshot().licenses,
  });
  // Drafts may contain future units; technology is required to produce them; owned stock can deploy.
  const canAddUnit = (model) =>
    !!model && [null, "not_developed"].includes(PlayerProfile.restriction(model));
  const displayLimit = (value) => (Number.isFinite(value) ? value : I18n.text("无限"));
  const unitLimit = () =>
    Net.active && Net.snapshot?.settings
      ? Rules.armyUnitLimit(Net.snapshot.settings, ownPlayer())
      : Rules.catalog.formation.maxUnits;
  const points = (entries) => Rules.formationPoints(entries);
  const cost = (entries) =>
    entries.reduce((n, e) => n + Rules.formationModel(e).cost + PilotSystem.cost(e.customPilot), 0);
  function pickerWeight() {
    const prefab = Rules.catalog.prefabs.find((item) => item.id === byId("formationPrefab").value);
    if (!prefab) return Infinity;
    const kitId =
      pickerKits.get(prefab.id) || Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id;
    const model = UnitModels[prefab.id + "__" + kitId];
    return model ? Rules.formationWeight(model) : Infinity;
  }
  function renderPickerCost() {
    const prefabId = byId("formationPrefab").value,
      prefab = Rules.catalog.prefabs.find((candidate) => candidate.id === prefabId),
      kitId =
        prefab &&
        (pickerKits.get(prefab.id) || Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id),
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
    const count = element(
      "span",
      "",
      "编组单位点数: " + points(draft) + " / " + displayLimit(unitLimit()),
    );
    count.id = "formationPickerUnitPoints";
    byId("formationPickerCost").replaceChildren(count, formation, unit);
  }
  function persist() {
    sessionSaves.set(storageKey, {
      version: formationSaveVersion,
      squads: structuredClone(squads),
      index,
    });
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: formationSaveVersion, squads }));
      localStorage.removeItem(legacyStorageKey);
      localStorage.removeItem(legacyStorageKey + "-active");
      localStorage.setItem(storageKey + "-active", String(index));
    } catch {
      note("浏览器无法保存编组，本次会话仍可使用。");
    }
  }
  function loadCharacter() {
    storageKey = legacyStorageKey + "." + group;
    let stored = null;
    let active = 0;
    try {
      const save = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (save?.version === formationSaveVersion && Array.isArray(save.squads)) {
        stored = save.squads;
        active = Number(localStorage.getItem(storageKey + "-active"));
      }
    } catch {}
    const cached = sessionSaves.get(storageKey);
    if (cached?.version === formationSaveVersion) {
      stored = cached.squads;
      active = cached.index;
    }
    squads = (stored || []).flatMap((squad) => {
      try {
        if (typeof squad.name !== "string") return [];
        return [
          {
            name: squad.name,
            units:
              Array.isArray(squad.units) && !squad.units.length
                ? []
                : Rules.validateFormation(
                    hydratePilots(squad.units),
                    Infinity,
                    Rules.catalog.formation.maxUnits,
                  ),
          },
        ];
      } catch {
        return [];
      }
    });
    // Restore the untouched A5 default from the previous build; custom squads stay intact.
    if (group === "EFSF") {
      const modernDefault = defaultSquads("EFSF")[0];
      const oldUnits = modernDefault.units.map((unit) =>
        unit.unitId === "Type61" ? { ...unit, unitId: "Type61A5" } : unit,
      );
      for (const squad of squads)
        if (
          squad.name === modernDefault.name &&
          JSON.stringify(squad.units) === JSON.stringify(oldUnits)
        )
          squad.units = structuredClone(modernDefault.units);
    }
    if (!squads.length) squads = defaultSquads(group);
    index = Number.isInteger(active) && active >= 0 && active < squads.length ? active : 0;
    draft = structuredClone(current());
    persist();
    byId("formationGroup").value = group;
    refreshSelect();
    renderCatalog();
  }
  function setGroup(next) {
    if (!["PMC", "EFSF", "ZEON"].includes(next) || group === next) return;
    finishPilotEditor();
    group = next;
    PlayerProfile.setFormationGroup(group);
    if (!Net.active) PlayerProfile.setFaction(next);
    loadCharacter();
    if (pageView === "formation") {
      byId("formationName").value = squads[index].name;
      render();
      renderPilotRoster();
    }
  }
  const sharePrefix = "PGF1.";
  function encodeShare(name, units) {
    const clean = Rules.validateFormation(units, Infinity, Rules.catalog.formation.maxUnits),
      payload = JSON.stringify({
        version: 1,
        name: name.trim().slice(0, 32) || "未命名编组",
        units: clean.map(({ unitId, kitId, customName, preload }) => ({
          unitId,
          kitId,
          customName,
          preload,
        })),
      }),
      bytes = new TextEncoder().encode(payload);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return sharePrefix + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeShare(code) {
    code = code.trim();
    if (!code.startsWith(sharePrefix) || code.length > 4 * 1024 * 1024)
      throw Error("编组分享代码无效。");
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
        payload.units.map(({ unitId, kitId, customName, preload }) => ({
          unitId,
          kitId,
          customName,
          preload,
        })),
        Infinity,
        Rules.catalog.formation.maxUnits,
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
    if (typeof SpecialTransforms !== "undefined") SpecialTransforms.close();
    previewModel = null;
    previewRoot = null;
    byId("formationUnitDetail").hidden = true;
    byId("formationMain").inert = false;
    if (detailFromDevelopment) {
      detailFromDevelopment = false;
      byId("formationScreen").append(byId("formationUnitDetail"));
      byId("developmentMain").inert = false;
      detailIndex = null;
      catalogDetail = null;
      developmentPreviewFocus?.focus();
      developmentPreviewFocus = null;
      return;
    }
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
      model = carrier && Rules.formationModel(carrier),
      h = model?.hangars.find((h) => h.id === pickerContext.hangarId);
    if (!h || prefab.hangars?.length) return false;
    const used = draft
      .filter((e) => preloadMatches(e, pickerContext.carrierIndex, h.id))
      .reduce(
        (n, e) => n + (h.kind === "sfs" ? 1 : Rules.formationModel(e).transport.slotCost || 1),
        0,
      );
    return (
      used + (h.kind === "sfs" ? 1 : prefab.transport.slotCost) <= h.capacity &&
      h.allowedTags.some((t) => prefab.transport.loadTags.includes(t))
    );
  }
  function openPicker(context = null) {
    catalogFilters.faction = Rules.factions.includes(PlayerProfile.faction())
      ? PlayerProfile.faction()
      : "";
    byId("formationFaction").value = catalogFilters.faction;
    pickerContext = context;
    pickerReturnIndex = context?.carrierIndex ?? null;
    detailIndex = null;
    catalogDetail = null;
    detailFromPicker = false;
    byId("formationUnitDetail").hidden = true;
    // Escape the fixed page's stacking context so the picker covers shell navigation.
    document.body.append(byId("formationUnitPicker"));
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
      m = carrier && Rules.formationModel(carrier),
      number = m?.hangars.findIndex((h) => h.id === hangarId);
    return m?.hangars[number]?.kind === "sfs"
      ? "SFS"
      : I18n.text("格纳库") + (number >= 0 ? number + 1 : "?");
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
      const cm = Rules.formationModel(carrier);
      for (const h of cm.hangars) {
        const cargo = draft
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => preloadMatches(e, carrierIndex, h.id)),
          used = cargo.reduce(
            (n, { e }) => n + (h.kind === "sfs" ? 1 : Rules.formationModel(e).transport.slotCost),
            0,
          ),
          others = cargo
            .filter(({ i }) => i !== detailIndex)
            .reduce(
              (n, { e }) => n + (h.kind === "sfs" ? 1 : Rules.formationModel(e).transport.slotCost),
              0,
            );
        if (
          !h.allowedTags.some((tag) => model.transport.loadTags.includes(tag)) ||
          others + (h.kind === "sfs" ? 1 : model.transport.slotCost) > h.capacity
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
    const atLimit =
      detailIndex === null && points(draft) + Rules.formationWeight(model) > unitLimit();
    select.disabled = select.options.length === 1 || atLimit;
    hint.textContent = atLimit
      ? "已达到编组单位点数上限。"
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
          (n, { entry }) =>
            n + (h.kind === "sfs" ? 1 : Rules.formationModel(entry).transport.slotCost),
          0,
        ),
        heading = element("div", "formation-preload-heading"),
        add = element("button", "", "预先搭载");
      add.dataset.preloadHangar = h.id;
      add.disabled =
        points(draft) + (detailIndex === null ? Rules.formationWeight(model) : 0) > unitLimit();
      add.onclick = () => {
        if (!canAddUnit(model)) return note("单位禁用，或与当前阵营不匹配。");
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
          m = Rules.formationModel(entry),
          remove = element("button", "", "移除");
        image.src = unitIcon(Rules.formationModelId(entry), entry.customPilot);
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
              Rules.catalog.formation.maxUnits,
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
  function renderPreview(modelId, canvas = byId("formationDetailPreview")) {
    const ctx = canvas.getContext("2d"),
      model = UnitModels[modelId];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.setAttribute("aria-label", model.code + " " + model.name);
    if (!assetsReady) return;
    canvas.dataset.previewModel = modelId;
    if (!SpriteRenderer.modelsReady([modelId])) {
      SpriteRenderer.ensureModels([modelId])
        .then(() => {
          if (canvas.dataset.previewModel === modelId) renderPreview(modelId, canvas);
        })
        .catch((error) => note(error.message));
      return;
    }
    const previewAngle = 90;
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
      const t = SpriteRenderer.layerTransform(modelId, layer, previewAngle, {}),
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
      previewAngle,
      null,
      0,
      held,
      false,
      true,
      false,
      {},
      previewAngle,
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
  function pilotButtonText(button, prefix, entry, model) {
    const name = entry.customPilot?.name || PilotSystem.defaultName(model);
    button.classList.add("formation-pilot-button");
    const label = element("span", "pilot-button-prefix", prefix + " · ");
    const viewport = element("span", "pilot-name-viewport");
    const text = element("span", "pilot-name-scroll", name);
    if (entry.customPilot) text.setAttribute("data-i18n-ignore", "");
    viewport.append(text);
    button.replaceChildren(label, viewport);
    button.title = prefix + " · " + name;
  }
  function renderDetail() {
    const originalEntry = detailIndex === null ? catalogDetail : draft[detailIndex];
    if (!originalEntry) return closeDetail();
    if (previewRoot !== originalEntry) {
      previewRoot = originalEntry;
      previewModel = null;
    }
    const rootId = Rules.formationModelId(originalEntry);
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
      : { ...originalEntry, unitId: selectedModel.prefabId, kitId: selectedModel.kitId };
    const prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId);
    const model = Rules.formationModel(entry);
    window.dispatchEvent(new CustomEvent("unit-preview", { detail: { id: entry.unitId } }));
    byId("formationDetailTitle").textContent = model.code + " " + (entry.customName || model.name);
    byId("formationDetailTitle").toggleAttribute("data-i18n-ignore", !!entry.customName);
    byId("formationDetailTags").replaceChildren(unitTags(model));
    ProductionUI.renderLicensePurchase(originalEntry.unitId);
    const pilotButton = byId("formationDetailPilot");
    pilotButton.hidden = detailIndex === null || !!previewModel;
    pilotButtonText(pilotButton, "配属驾驶员", originalEntry, model);
    renderPreview(entry.unitId + "__" + entry.kitId);
    renderPreloads(model);
    renderCarrierChoice(entry, model);
    if (previewModel) {
      byId("formationDetailCarrierField").hidden = true;
      byId("formationDetailHangarsBlock").hidden = true;
    }
    byId("formationDetailIntro").textContent = model.description;
    const kits = byId("formationDetailKit");
    kits.replaceChildren();
    const equipmentPrefab = previewModel
      ? prefab
      : Rules.catalog.prefabs.find((p) => p.id === originalEntry.unitId);
    for (const kit of equipmentPrefab.weaponKits) {
      const suffix = kit.id === Economy.defaultKit(equipmentPrefab.id) ? " · 默认装备" : "";
      const displayKit = previewModel
        ? model
        : Rules.formationModel({ ...originalEntry, kitId: kit.id });
      kits.add(new Option(`${displayKit.kitName} · COST ${displayKit.cost}${suffix}`, kit.id));
    }
    kits.value = previewModel ? entry.kitId : originalEntry.kitId;
    kits.disabled = !!previewModel;
    byId("openSpecialTransforms").hidden =
      !!previewModel ||
      !equipmentPrefab.pilotForms?.length;

    detailMetrics(byId("formationDetailStats"), [
      ["HP", model.hp.toLocaleString()],
      ["EN", model.en],
      ["COST", model.cost],
      ["视野距离", formatDistance(model.sensors.sight)],
      ["侦察距离", formatDistance(model.sensors.radar)],
      ["机动", model.speed ?? 100],
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
    for (const weapon of model.weapons) weapons.append(WeaponInfo.card(weapon));
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
    for (const skill of [
      ...SkillControls.commandAbilities(
        model,
        originalEntry.customPilot
          ? {
              model: entry.unitId + "__" + entry.kitId,
              pilot: originalEntry.customPilot,
            }
          : null,
      ),
      ...SkillControls.defensiveAbilities(model),
      ...(model.skills || []),
    ]) {
      const card = element("div", "formation-weapon-detail");
      card.append(
        element("strong", "", I18n.language === "zh" ? skill.name : I18n.localized(skill)),
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
                  pilot_skill: "驾驶员条件待核对",
                  source_missing: "原 MOD 缺少对应攻击流程",
                  secondary_loadout: "可换装副武器：保留配置，暂不开放",
                })[reason] || reason,
            )
            .join(" · "),
        ),
      );
      mechanics.append(card);
    }
    for (const mechanic of model.mechanics || []) {
      if (["CmdAtk", "CmdDef", "CmdCom"].includes(mechanic.id) && model.commandAuras?.length)
        continue;
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
    // Portal above fixed page containers so the preview is never clipped by a page.
    document.body.append(byId("formationUnitDetail"));
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
    const size = Rules.unitSize(model);
    const sizeTag = element(
      "span",
      "type-tag unit-size-tag",
      { small: "小型", medium: "中型", large: "大型" }[size],
    );
    sizeTag.dataset.tag = size + "Unit";
    types.append(sizeTag);
    for (const value of model.unitTags || []) {
      if (value === "SmallUnit" || value === "LargeUnit" || value === "MediumUnit") continue;
      const tag = element("span", "type-tag", I18n.text(Rules.unitTagName(value)));
      tag.dataset.tag = value;
      types.append(tag);
    }
    tags.append(primary);
    if (types.children.length) tags.append(types);
    return tags;
  }
  function saveDraft() {
    if (pageView !== "formation") return;
    const units = draft.length
      ? Rules.validateFormation(draft, Infinity, Rules.catalog.formation.maxUnits)
      : [];
    const name = byId("formationName").value.trim().slice(0, 32) || "未命名编组";
    const changed =
      squads[index].name !== name || JSON.stringify(squads[index].units) !== JSON.stringify(units);
    if (!changed) return;
    const renamed = squads[index].name !== name;
    squads[index] = { name, units };
    persist();
    if (renamed) refreshSelect();
  }
  byId("formationName").oninput = saveDraft;
  function undevelopedWarning() {
    const warning = element("small", "unit-undeveloped");
    const icon = element("span", "unit-warning-icon", "⚠︎");
    icon.setAttribute("aria-hidden", "true");
    warning.append(icon, element("span", "", "尚未开发"));
    return warning;
  }
  function render() {
    saveDraft();
    byId("formationGroup").disabled = Net.active && Net.snapshot?.settings?.mode === "quick";
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
        `${points(draft)} / ${unitLimit()} 点（${draft.length} 台）· 编组COST: ${cost(draft)} / ${displayLimit(budget())}`,
      ),
      document.createTextNode(" · "),
      unitCostRule,
    );
    byId("formationBudget").title = byId("formationBudget").textContent;
    byId("formationBudget").classList.toggle("danger-text", points(draft) > unitLimit());
    byId("addFormationUnit").disabled =
      points(draft) + pickerWeight() > unitLimit() ||
      !byId("formationPrefab").value ||
      !canAddUnit(Rules.catalog.prefabs.find((p) => p.id === byId("formationPrefab").value));
    byId("openFormationPicker").disabled = points(draft) >= unitLimit();
    renderPickerCost();
    const plan = draft.length
      ? Rules.planFormation(draft, budget(), restrictions(), Rules.catalog.formation.maxUnits)
      : { disabled: [] };
    const shortagePlan = Economy.licensePlan(draft);
    byId("produceMissingFormation").hidden =
      byId("formationMain").dataset.page === "pilots" || !shortagePlan.items.length;
    byId("produceMissingFormation").classList.toggle(
      "inventory-attention",
      !!shortagePlan.items.length,
    );
    const list = byId("formationUnits"),
      scrollTop = list.scrollTop;
    list.replaceChildren();
    // 仅调整显示顺序，保留保存序号、搭载引用和 OVER COST 的末尾优先规则。
    const displayOrder = draft.flatMap((entry, i) =>
      entry.preload
        ? []
        : [
            i,
            ...(Rules.formationModel(entry).hangars || []).flatMap((h) =>
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
        model = Rules.formationModel(entry);
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
      image.src = unitIcon(Rules.formationModelId(entry), entry.customPilot);
      image.width = 56;
      image.alt = entry.customName || model.name;
      icon.append(image);
      const portrait = element("span", "formation-unit-portrait");
      portrait.append(icon);
      if (plan.reasons[i] === "faction_mismatch") row.classList.add("faction-mismatch");
      if (plan.disabled.includes(i) && plan.reasons[i] !== "not_developed") {
        row.classList.add(
          "unit-disabled",
          ["not_allowed", "not_developed", "wip"].includes(plan.reasons[i])
            ? "not-allowed"
            : "overcost",
        );
        row.append(
          element("span", "disabled-panel"),
          element(
            "span",
            "overcost-label",
            plan.reasons[i] === "license"
              ? "未获得部署许可"
              : plan.reasons[i] === "wip"
                ? "WIP"
                : plan.reasons[i] === "faction_mismatch"
                  ? "阵营不匹配"
                  : ["pilot_faction", "pilot_required"].includes(plan.reasons[i])
                    ? "驾驶员配属条件不满足"
                    : plan.reasons[i] === "not_developed"
                      ? "尚未开发"
                      : plan.reasons[i] === "count"
                        ? "超过单位点数"
                        : plan.reasons[i] === "not_allowed"
                          ? "不被允许的单位"
                          : "OVER COST",
          ),
        );
      }
      const label = element("span", "formation-unit-name");
      const prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId),
        kit = prefab.weaponKits.find((k) => k.id === entry.kitId);
      const metadata = element("span", "unit-line-meta");
      metadata.append(unitTags(model));
      label.title = model.description || "";
      label.append(
        element(
          "strong",
          "",
          `${entry.preload ? "" : i + 1 + ". "}${model.code} ${entry.customName || model.name}`,
        ),
        metadata,
        unitSummaryTags(model.adaptability, model.kitName, model.cost),
      );
      if (entry.customName) label.querySelector("strong").setAttribute("data-i18n-ignore", "");
      if (entry.preload) {
        const carrier = draft[entry.preload.carrierIndex],
          annotation = element("small", "formation-cargo-note"),
          name = element("span", "", carrier.customName || Rules.formationModel(carrier).name);
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
      const stockLine = element("span", "formation-stock-line");
      stockLine.append(
        element(
          "small",
          "formation-inventory-count",
          Economy.hasLicense(entry.unitId) ? "已获得部署许可" : "未获得部署许可",
        ),
      );
      if (!Economy.hasLicense(entry.unitId) && !Development.allows(group, entry.unitId))
        portrait.append(undevelopedWarning());
      if (plan.reasons[i] === "license") {
        row.classList.add("inventory-shortage");
        const produce = element("button", "produce-shortage-unit", "部署许可");
        produce.type = "button";
        produce.onclick = () => openProduction(entry.unitId);
        const prompt = element("div", "inventory-shortage-prompt");
        prompt.append(element("span", "", "未获得部署许可"), produce);
        row.querySelector(":scope > .overcost-label")?.remove();
        row.append(prompt);
      }
      const pilot = element(
        "button",
        "formation-pilot-button",
        "驾驶员 · " + (entry.customPilot?.name || PilotSystem.defaultName(model)),
      );
      pilotButtonText(pilot, "驾驶员", entry, model);
      pilot.setAttribute("aria-haspopup", "dialog");
      pilot.onclick = () => openPilot(i);
      actions.append(details, pilot, remove);
      row.append(portrait, label, actions, stockLine);
      list.append(row);
    });
    list.scrollTop = scrollTop;
  }
  function closePilot() {
    if (pilotIndex === null) return;
    const index = pilotIndex;
    pilotIndex = null;
    byId("formationPilotPanel").hidden = true;
    byId("formationUnitDetail").inert = false;
    byId("formationMain").inert = !byId("formationUnitDetail").hidden;
    if (!byId("formationUnitDetail").hidden) byId("formationDetailPilot").focus();
    else
      byId("formationUnits")
        .querySelector('[data-formation-index="' + index + '"] .formation-pilot-button')
        ?.focus();
  }
  function openPilot(index) {
    if (!draft[index]) return;
    document.body.append(byId("formationPilotPanel"));
    pilotIndex = index;
    const entry = draft[index],
      model = Rules.formationModel(entry),
      list = byId("formationPilotList");
    byId("formationPilotTitle").textContent = "驾驶员配属 · " + (entry.customName || model.name);
    list.replaceChildren();
    const command = PilotSystem.commandUnit(model);
    const available = pilotStore.pilots.filter(
      (p) => !p.needsRecruitment && PilotSystem.canAssign(p, group),
    );
    for (const profile of [null, ...available]) {
      const id = profile?.id || null,
        selected = (entry.customPilot?.id || null) === id,
        occupied = id && draft.some((other, i) => i !== index && other.customPilot?.id === id),
        card = element("div", "formation-pilot-card"),
        details = element("div"),
        choose = element("button", "", selected ? "已配属" : occupied ? "已配属其他单位" : "配属");
      card.dataset.selected = String(selected);
      const portrait = profile
        ? element("img")
        : element("span", "formation-pilot-default", "默认");
      if (profile) {
        portrait.src = PilotSystem.portrait(profile);
        portrait.alt = "";
      }
      const stats =
        profile?.stats ||
        Object.fromEntries(
          Object.entries(
            command ? PilotSystem.catalog.commanderRanges : PilotSystem.catalog.defaultRanges,
          ).map(([key, range]) => [key, range[0] + "–" + range[1]]),
        );
      details.append(
        profile?.ace
          ? aceName(PilotSystem.aceProfile(profile), "strong")
          : element("strong", "", profile?.name || PilotSystem.defaultName(model)),
      );
      if (profile?.ace) details.append(aceTags(PilotSystem.aceProfile(profile)));
      for (const keys of [
        ["shooting", "melee", "defense", "speed"],
        ["accuracy", "reaction", "leadership", "awakening"],
      ])
        details.append(
          element(
            "small",
            "",
            keys.map((key) => PilotSystem.labels[key] + " " + stats[key]).join(" · "),
          ),
        );
      if (profile)
        details.append(
          element(
            "small",
            "",
            `Lv.${profile.level} · COST +${PilotSystem.cost(profile)} · EXP ${profile.experience}/${PilotSystem.experienceRequired(profile.level, profile)}`,
          ),
        );
      choose.disabled = !!selected || !!occupied;
      choose.onclick = () => {
        delete entry.pilotId;
        if (profile) entry.customPilot = structuredClone(profile);
        else delete entry.customPilot;
        render();
        if (detailIndex === index) renderDetail();
        closePilot();
      };
      card.append(portrait, details, choose);
      list.append(card);
    }
    byId("formationUnitDetail").inert = !byId("formationUnitDetail").hidden;
    byId("formationMain").inert = true;
    byId("formationPilotPanel").hidden = false;
    byId("closeFormationPilot").focus();
  }
  byId("formationDetailPilot").onclick = () => openPilot(detailIndex);
  byId("closeFormationPilot").onclick = closePilot;
  byId("formationPilotPanel").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closePilot();
    }
  });
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
  byId("openSpecialTransforms").onclick = () => {
    const entry = detailIndex === null ? catalogDetail : draft[detailIndex];
    if (!entry) return;
    SpecialTransforms.open(entry.unitId);
  };
  byId("formationDetailCarrier").onchange = (event) => {
    const entry = detailIndex === null ? catalogDetail : draft[detailIndex];
    if (!entry) return;
    try {
      const next = { ...entry };
      if (event.target.value) next.preload = JSON.parse(event.target.value);
      else delete next.preload;
      if (detailIndex === null) {
        if (!canAddUnit(Rules.formationModel(next)))
          throw Error("单位尚未开发，或与当前阵营不匹配。");
        if (!next.preload) return;
        if (points(draft) >= unitLimit()) throw Error("已达到编组单位点数上限。");
        next.customName = Rules.generateUnitName(Rules.formationModel(next).name, draft);
      }
      const entries =
        detailIndex === null
          ? [...draft, next]
          : draft.map((e, i) => (i === detailIndex ? next : e));
      Rules.validateFormation(entries, Infinity, Rules.catalog.formation.maxUnits);
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
  function previewUnit(prefabId, trigger) {
    const prefab = Rules.catalog.prefabs.find((item) => item.id === prefabId);
    if (!prefab) return false;
    detailFromPicker = false;
    detailFromDevelopment = true;
    developmentPreviewFocus = trigger || document.activeElement;
    detailIndex = null;
    catalogDetail = {
      unitId: prefabId,
      kitId: Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id,
    };
    previewRoot = null;
    document.body.append(byId("formationUnitDetail"));
    byId("developmentMain").inert = true;
    renderDetail();
    byId("closeFormationDetail").focus();
    return true;
  }
  function open() {
    if (Net.active && Net.snapshot?.phase === "assembly") {
      note("确认阶段不可修改编组。");
      return;
    }
    if (Net.active && ownPlayer()?.formationPreset) {
      note("房主已指定编组预设，请由房主调整。");
      return;
    }
    detailFromPicker = false;
    pickerContext = null;
    pickerReturnIndex = null;
    byId("formationUnitPicker").hidden = true;
    closeDetail();
    returnView = Net.active ? "room" : "menu";
    const activePlan =
      Net.snapshot?.phase === "assembly"
        ? Net.snapshot.assembly?.players.find((player) => player.memberId === Net.memberId)
        : null;
    draft = hydratePilots(structuredClone(activePlan?.entries || current()));
    showFormationTab("units");
    byId("formationName").value = squads[index].name;
    refreshSelect();
    render();
    renderCatalog();
    setPageView("formation");
  }
  byId("formationGroup").onchange = (event) => {
    const next = event.target.value;
    if (Net.active) {
      event.target.value = group;
      const own = ownPlayer();
      if (Net.snapshot?.settings?.mode === "quick") return note("快速战固定使用 PMC 阵营。");
      const forced =
        own?.seat == null
          ? null
          : Net.snapshot?.settings?.teamFactions?.[Rules.seatTeam(own?.seat)];
      if (forced && forced !== next) return note("本队已设置强制阵营。");
      if (next !== own?.characterFaction) Net.request("set_faction", { faction: next });
      return;
    }
    setGroup(next);
  };
  byId("formationSelect").onchange = (e) => {
    closeDetail();
    index = Number(e.target.value);
    persist();
    byId("formationName").value = squads[index].name;
    draft = structuredClone(current());
    render();
  };
  byId("newFormation").onclick = () => {
    closeDetail();
    squads.push({
      name: `新编组 ${squads.length + 1}`,
      units: [],
    });
    index = squads.length - 1;
    persist();
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
    index = Math.min(removed, squads.length - 1);
    draft = structuredClone(current());
    byId("formationName").value = squads[index].name;
    persist();
    refreshSelect();
    render();
    note("编组已删除。");
  };
  byId("openFormationPicker").onclick = () => openPicker();
  byId("closeFormationPicker").onclick = closePicker;
  window.addEventListener("page-changing", () => {
    byId("formationUnitPicker").hidden = true;
    pickerContext = pickerReturnIndex = null;
    detailFromPicker = false;
    byId("formationMain").inert = false;
  });
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
    if (!canAddUnit(prefab)) return note("单位禁用，或与当前阵营不匹配。");
    if (points(draft) >= unitLimit()) return note("已达到编组单位点数上限。");
    const entry = {
      unitId: prefab.id,
      kitId: pickerKits.get(prefab.id) || Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id,
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
  byId("formationStock").onchange = () => renderCatalog();
  function renderCatalog() {
    const query = byId("formationSearch").value.trim().toLocaleLowerCase();
    const prefabs = UnitCatalog.select(query, catalogFilters, PlayerProfile.allows)
      .filter(
        (prefab) =>
          pickerCompatible(prefab) &&
          (byId("formationStock").value === "all" || Economy.hasLicense(prefab.id)),
      )
      .sort(UnitCatalog.compareDevelopedCost(group));
    if (!prefabs.some((p) => p.id === byId("formationPrefab").value))
      byId("formationPrefab").value = prefabs[0]?.id || "";
    const list = byId("formationCatalog");
    const scroll = list.scrollTop;
    list.replaceChildren();
    for (const prefab of prefabs) {
      const card = element("button", "catalog-unit");
      card.dataset.unitId = prefab.id;
      card.disabled = !!prefab.wip;
      if (prefab.wip) card.title = "WIP";
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", String(byId("formationPrefab").value === prefab.id));
      const image = element("img");
      image.src = unitIcon(
        prefab.id + "__" + (Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id),
      );
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
      const stockLine = element("span", "formation-stock-line");
      stockLine.append(
        element(
          "small",
          "formation-inventory-count",
          Economy.hasLicense(prefab.id) ? "已获得部署许可" : "未获得部署许可",
        ),
      );
      info.append(stockLine);
      const portrait = element("span", "catalog-unit-portrait");
      portrait.append(image);
      if (!Economy.hasLicense(prefab.id) && !Development.allows(group, prefab.id))
        portrait.append(undevelopedWarning());
      card.append(portrait, info);
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
          kitId: pickerKits.get(prefab.id) || Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id,
        };
        renderDetail();
        byId("formationDetailKit").focus();
      };
      const row = element("div", "catalog-unit-row");
      row.append(card, details);
      const restriction = PlayerProfile.restriction(prefab);
      if (restriction && restriction !== "not_developed") {
        row.classList.add("unit-disabled", restriction === "wip" ? "unit-wip" : "faction-mismatch");
        row.append(
          element("span", "disabled-panel"),
          element(
            "span",
            "overcost-label",
            restriction === "wip"
              ? "WIP"
              : restriction === "faction_mismatch"
                ? "阵营不匹配"
                : "尚未开发",
          ),
        );
      }
      list.append(row);
    }
    if (!prefabs.length) list.append(element("p", "empty", "没有符合筛选的单位"));
    list.scrollTop = scroll;
    byId("addFormationUnit").disabled =
      !prefabs.length ||
      points(draft) + pickerWeight() > unitLimit() ||
      !canAddUnit(prefabs.find((p) => p.id === byId("formationPrefab").value));
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
  const typeSelect = byId("formationType");
  const unitTypes = [
    ...new Set(Rules.catalog.prefabs.filter((p) => !p.formOnly).flatMap((p) => p.unitTags || [])),
  ].sort();
  function refreshTypeFilter() {
    const typeGroup = document.createElement("optgroup");
    typeGroup.label = I18n.text("\u5355\u4f4d\u7c7b\u578b");
    for (const tag of unitTypes)
      typeGroup.append(new Option(I18n.text(Rules.unitTagName(tag)), `type:${tag}`));
    const environmentGroup = document.createElement("optgroup");
    environmentGroup.label = I18n.text("\u73af\u5883\u7b5b\u9009");
    for (const environment of ["ground", "space"])
      environmentGroup.append(
        new Option(
          I18n.text(environment === "ground" ? "\u5730\u9762" : "\u5b87\u5b99"),
          `environment:${environment}`,
        ),
      );
    typeSelect.replaceChildren(
      new Option(I18n.text("\u4e0d\u9650"), ""),
      typeGroup,
      environmentGroup,
    );
    typeSelect.value = catalogFilters.type;
  }
  typeSelect.onchange = () => {
    catalogFilters.type = typeSelect.value;
    renderCatalog();
  };
  window.addEventListener("language-change", refreshTypeFilter);
  refreshTypeFilter();
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
  function showLicenseDialog(title, text, units, choices) {
    GameDialog.choose({
      title,
      message: text,
      items: units.map((id) => {
        const unit = Rules.catalog.prefabs.find((p) => p.id === id);
        return unit ? unit.code + " " + unit.name : id;
      }),
      actions: choices.map(([label, id], value) => ({ label, id, value })),
    }).then((choice) => {
      if (choice !== null) choices[choice]?.[2]?.();
    });
  }
  async function replenish(entries, faction = group) {
    const plan = Economy.licensePlan(entries);
    if (!plan.items.length) return true;
    // Only shortage-plan items participate in production checks or the purchase.
    // Stocked units never reach development validation, regardless of their unlock state.
    const undeveloped = plan.items
      .filter((item) => !Development.allows(faction, item.unitId))
      .map((item) => item.unitId);
    if (undeveloped.length) {
      const originalGroup = group,
        originalIndex = index,
        originalDraft = JSON.stringify(draft);
      showLicenseDialog(
        "尚未开发，无法购买许可",
        "存在尚未开发单位，无法购买许可，是否从当前编组移除？本次购买已中止。",
        undeveloped,
        [
          ["取消", "cancelRemoveUndeveloped"],
          [
            "移除",
            "removeUndevelopedUnits",
            () => {
              if (
                group !== originalGroup ||
                index !== originalIndex ||
                JSON.stringify(draft) !== originalDraft
              )
                return;
              closeDetail();
              closePicker();
              for (let i = draft.length - 1; i >= 0; i--)
                if (undeveloped.includes(draft[i].unitId)) removeEntry(i);
              render();
              renderCatalog();
              note("已移除尚未开发单位，请重新确认购买。");
            },
          ],
        ],
      );
      return false;
    }
    const unavailable = plan.items.filter((item) => {
      const offer = Economy.licenseOffer(item.unitId);
      const prefab = Rules.catalog.prefabs.find((unit) => unit.id === item.unitId);
      return (
        !offer ||
        !prefab ||
        prefab.wip ||
        (faction !== "PMC" && !(offer.availableFactions || [offer.faction]).includes(faction))
      );
    });
    if (unavailable.length) {
      showLicenseDialog(
        "无法购买许可",
        "以下单位无法购买许可，已中止本次购买：",
        unavailable.map((item) => item.unitId),
        [["确认", "acknowledgeUnavailableUnits"]],
      );
      return false;
    }
    const originalEntries = JSON.stringify(entries),
      originalGroup = group,
      originalIndex = index;
    const confirmed = await GameDialog.confirm("是否购买以下单位的永久部署许可？", {
      title: "一键购买许可",
      items: [
        ...plan.items.map((item) => {
          const unit = Rules.catalog.prefabs.find((prefab) => prefab.id === item.unitId);
          return unit.code + " " + I18n.text(unit.name) + " · 部署许可";
        }),
        I18n.text("资金") + "：" + formatNumber(plan.money),
        I18n.text("物资") + "：" + formatNumber(plan.supplies),
      ],
      confirmText: "确认购买",
    });
    if (!confirmed) return false;
    // A confirmation authorizes exactly the displayed units and price, never a changed plan.
    if (
      group !== originalGroup ||
      index !== originalIndex ||
      JSON.stringify(entries) !== originalEntries ||
      JSON.stringify(Economy.licensePlan(entries)) !== JSON.stringify(plan)
    ) {
      note("编组或许可已变化，请重新确认购买。");
      return false;
    }
    try {
      const result = Economy.purchaseMissingLicenses(entries, faction);
      if (!result.ok) {
        if (result.reason === "unavailable")
          showLicenseDialog("无法购买许可", "以下单位无法购买许可，已中止本次购买：", result.units, [
            ["确认", "acknowledgeUnavailableUnits"],
          ]);
        else note("货币不足，已取消购买。");
        return false;
      }
      note("已获得所需单位的永久部署许可。");
      return true;
    } catch (error) {
      note("许可购买失败：" + Economy.errorMessage(error));
      return false;
    }
  }
  function checkLicenses(entries, proceed) {
    if (!Economy.licensePlan(entries).items.length) return proceed();
    showLicenseDialog(
      "单位未获得部署许可",
      "编组中存在未获得部署许可的单位。强制准备后，未许可单位不会生成。",
      [],
      [
        ["取消", "cancelMissingStock"],
        ["去往机库（编组）", "openStockWarehouse", () => open()],
        ["强制准备", "forceReadyWithoutStock", proceed],
      ],
    );
  }
  function openProduction(unitId) {
    closeDetail();
    closePicker();
    ProductionUI.openUnit(unitId, {
      returnView: "formation",
      onReturn: () => {
        render();
        if (
          Net.active &&
          Net.seat !== null &&
          !Net.awaiting &&
          !Net.snapshot.started
        )
          Net.request("update_formation", { formation: current() });
      },
    });
  }
  byId("produceMissingFormation").onclick = async () => {
    const button = byId("produceMissingFormation");
    if (button.disabled) return;
    button.disabled = true;
    try {
      if (await replenish(draft)) render();
    } finally {
      button.disabled = false;
    }
  };
  byId("saveFormation").onclick = () => {
    finishPilotEditor();
    saveDraft();
    const units = current();
    if (
      Net.active &&
      Net.seat !== null &&
      points(units) <= unitLimit() &&
      !Net.snapshot.started
    )
      Net.request("update_formation", { formation: units });
    closeDetail();
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
  let pilotEdit = null;
  let pilotOriginal = null;
  let pilotIsNew = false;
  let pilotFocus = null;
  const pilotPage = byId("formationPilotRoster");
  const pilotEditor = byId("customPilotPanel");
  document.body.append(pilotEditor);
  function renderPilotRecord(container, pilot) {
    const record = pilot.record;
    const rows = [
      [
        ["击坠单位数", Math.max(0, record.kills - record.shipKills)],
        ["击坠战舰数", record.shipKills],
        ["参战次数", record.battles],
      ],
      [
        ["总击坠COST", record.destroyedCost],
        ["被击坠COST", record.lostCost],
        ["被击坠数", record.losses],
      ],
    ];
    container.replaceChildren();
    for (const values of rows) {
      const row = element("span", "pilot-record-row");
      for (const [label, value] of values) {
        const cell = element("span", "pilot-record-cell");
        cell.append(element("span", "", label), element("strong", "", formatNumber(value)));
        row.append(cell);
      }
      container.append(row);
    }
  }
  function aceCandidates() {
    return (PilotSystem.catalog.aces || []).filter((p) =>
      PilotSystem.canAssign({ aceId: p.id }, group),
    );
  }
  function aceTags(profile) {
    const tags = element("span", "unit-tags ace-tags");
    for (const faction of profile.availableFactions || [profile.faction]) {
      const tag = element("span", "faction-tag", faction);
      tag.dataset.faction = faction;
      tags.append(tag);
    }
    tags.append(element("span", "era-tag", profile.era || "0079"));
    return tags;
  }
  function aceName(profile, tag = "span") {
    const viewport = element(tag, "pilot-name-viewport ace-name");
    const text = element("span", "pilot-name-scroll", I18n.localized(profile));
    text.dataset.i18nIgnore = "";
    viewport.title = I18n.localized(profile);
    viewport.append(text);
    return viewport;
  }
  function aceStatus(profile) {
    const owned = pilotStore.pilots.find((p) => p.aceId === profile.id);
    return owned
      ? owned.needsRecruitment
        ? "待回归"
        : "已招募"
      : canRecruitAce(profile)
        ? "未招募"
        : "未解锁";
  }
  function renderAceInformation(container, profile) {
    container.replaceChildren();
    container.append(aceTags(profile));
    const growth = element(
      "p",
      "",
      `${I18n.text("悟性")} ${profile.comprehension} · ${I18n.text("最高等级")} ${profile.maxLevel} · ${profile.costBase} COST + ${profile.costPerLevel} COST/Lv.`,
    );
    const description = element(
      "p",
      "ace-biography",
      I18n.language === "zh" ? profile.description : I18n.localized(profile, "description"),
    );
    description.dataset.i18nIgnore = "";
    container.append(growth, description, element("h3", "", "ACE技能"));
    for (const skill of profile.skills) {
      const nativeDescription =
        I18n.language === "zh" ? skill.description : I18n.localized(skill, "description");
      const skillDescription =
        skill.owner === "pilot"
          ? SkillControls.description(skill)
          : skill.durationTurns
            ? nativeDescription.replace(
                /\d+(?:\.\d+)?\s*(?:sec(?:onds?)?\b|秒(?:間)?)/g,
                I18n.text(`${skill.durationTurns}回合`),
              )
            : nativeDescription;
      const card = element("div", "ace-skill-placeholder");
      if (skill.icon) {
        const img = element("img");
        img.src = skill.icon;
        img.alt = "";
        card.append(img);
      }
      const content = element("div");
      content.append(
        element("strong", "", I18n.language === "zh" ? skill.name : I18n.localized(skill)),
        element("p", "", skillDescription),
        element("small", "muted", "战斗中可用"),
      );
      if (skill.durationTurns)
        content.append(
          element(
            "small",
            "muted",
            I18n.text(
              `持续${skill.durationTurns}回合 · 冷却${skill.cooldownTurns}回合（效果结束后开始）`,
            ),
          ),
        );
      card.append(content);
      container.append(card);
    }
  }
  const aceRecruit = element("dialog", "ace-recruit-dialog");
  aceRecruit.id = "aceRecruitDialog";
  aceRecruit.setAttribute("aria-labelledby", "aceRecruitTitle");
  const aceHeading = element("header", "formation-pilot-heading"),
    aceTitle = element("h2", "", "招募ACE");
  aceTitle.id = "aceRecruitTitle";
  const closeAce = element("button", "", "关闭");
  closeAce.type = "button";
  closeAce.onclick = () => aceRecruit.close();
  aceHeading.append(aceTitle, closeAce);
  const aceWorkspace = element("div", "ace-recruit-workspace"),
    aceList = element("div", "ace-recruit-list"),
    acePreview = element("section", "ace-recruit-preview");
  aceList.id = "aceRecruitList";
  acePreview.id = "aceRecruitPreview";
  aceWorkspace.append(aceList, acePreview);
  const aceFooter = element("footer", "ace-recruit-footer"),
    acePrice = element("p"),
    buyAce = element("button", "primary", "招募");
  acePrice.id = "aceRecruitPrice";
  buyAce.id = "confirmRecruitAce";
  buyAce.type = "button";
  aceFooter.append(acePrice, buyAce);
  aceRecruit.append(aceHeading, aceWorkspace, aceFooter);
  document.body.append(aceRecruit);
  let selectedAce = null,
    previewAceId = null;
  function aceTechnology(profile) {
    return Development.nodes(profile.faction).filter((node) => node.unlocks.includes(profile.id));
  }
  function canRecruitAce(profile) {
    return (
      !!profile?.price &&
      PilotSystem.canAssign({ aceId: profile.id }, group) &&
      Development.allows(group, profile.id)
    );
  }
  function openAceRecruitment(id = null) {
    const owned = id && pilotStore.pilots.find((p) => p.aceId === id);
    if (owned && !owned.needsRecruitment) return editPilot(owned);
    previewAceId = id;
    selectedAce = id;
    renderAceRecruitment();
    aceRecruit.showModal();
  }
  function renderAceRecruitment() {
    const candidates = aceCandidates();
    if (previewAceId && !candidates.some((p) => p.id === previewAceId)) {
      const preview = PilotSystem.aceProfile(previewAceId);
      if (preview) candidates.push(preview);
    }
    if (!candidates.some((p) => p.id === selectedAce))
      selectedAce =
        candidates.find(
          (p) =>
            canRecruitAce(p) &&
            !pilotStore.pilots.some((o) => o.aceId === p.id && !o.needsRecruitment),
        )?.id || candidates[0]?.id;
    aceList.replaceChildren();
    for (const profile of candidates) {
      const button = element("button", "ace-recruit-candidate");
      button.type = "button";
      button.dataset.aceId = profile.id;
      button.setAttribute("aria-pressed", String(selectedAce === profile.id));
      const img = element("img");
      img.src = profile.icon;
      img.alt = "";
      const content = element("span", "ace-candidate-content");
      content.append(
        aceName(profile),
        aceTags(profile),
        element("small", "ace-recruit-status", aceStatus(profile)),
      );
      button.append(img, content);
      button.onclick = () => {
        selectedAce = profile.id;
        renderAceRecruitment();
      };
      aceList.append(button);
    }
    acePreview.replaceChildren();
    const profile = PilotSystem.aceProfile(selectedAce);
    const previous = pilotStore.pilots.find((p) => p.aceId === profile?.id);
    const price = PilotSystem.recruitmentPrice(profile?.id, previous);
    buyAce.disabled =
      !canRecruitAce(profile) ||
      (previous && !previous.needsRecruitment) ||
      !price ||
      !Economy.affordable(price);
    buyAce.textContent = previous ? (previous.needsRecruitment ? "回归招募" : "已招募") : "招募";
    if (!profile) {
      acePrice.textContent = I18n.text("暂无可招募ACE");
      return;
    }
    const portrait = element("img", "ace-recruit-portrait");
    portrait.src = profile.icon;
    portrait.alt = "";
    acePreview.append(
      portrait,
      aceName(profile, "h3"),
      element("p", "ace-recruit-status", aceStatus(profile)),
    );
    const attributes = element("div", "ace-native-stats");
    for (const [key, label] of Object.entries(PilotSystem.labels))
      attributes.append(
        element(
          "span",
          "",
          `${I18n.text(label)} ${profile.baseStats[key]} → ${Number(profile.maxStats[key].toFixed(2))}`,
        ),
      );
    acePreview.append(attributes);
    const owned = pilotStore.pilots.find((p) => p.aceId === profile.id);
    if (owned?.needsRecruitment)
      acePreview.append(element("p", "", "半价回归，保留等级和战绩，经验清零。"));
    if (!Development.allows(group, profile.id) || !aceTechnology(profile).length) {
      const technologies = aceTechnology(profile);
      acePreview.append(
        element(
          "p",
          "ace-recruit-locked",
          technologies.length
            ? I18n.text("需要开发科技：") + technologies.map((n) => n.name).join(" / ")
            : I18n.text("活动获取"),
        ),
      );
    }
    const information = element("div");
    renderAceInformation(information, profile);
    acePreview.append(information);
    acePrice.textContent = price
      ? `${I18n.text("资金")} ${price.money.toLocaleString()} · ${I18n.text("物资")} ${price.supplies.toLocaleString()}`
      : I18n.text("原MOD无招募报价，暂不可招募");
  }
  byId("recruitAcePilot").onclick = () => openAceRecruitment();
  buyAce.onclick = () => {
    const profile = aceCandidates().find((p) => p.id === selectedAce);
    if (!canRecruitAce(profile)) return;
    try {
      const previous = pilotStore.pilots.find((p) => p.aceId === profile.id);
      const pilot = PilotSystem.recruitAce(profile.id, previous),
        next = {
          ...pilotStore,
          pilots: previous
            ? pilotStore.pilots.map((p) => (p.id === pilot.id ? pilot : p))
            : [...pilotStore.pilots, pilot],
        };
      if (
        !Economy.transact(PilotSystem.recruitmentPrice(profile.id, previous), {}, [
          [sharedPilotKey, JSON.stringify(next)],
        ])
      )
        return note("资金或物资不足");
      pilotStore = next;
      aceRecruit.close();
      renderPilotRoster();
      editPilot(pilot);
    } catch (error) {
      note(Economy.errorMessage(error));
    }
  };
  window.addEventListener("development-changed", () => {
    if (pageView === "formation") renderPilotRoster();
    if (aceRecruit.open) renderAceRecruitment();
  });
  window.addEventListener("economy-changed", () => {
    if (aceRecruit.open) renderAceRecruitment();
  });
  function renderPilotRoster() {
    const list = byId("customPilotList");
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    byId("formationPilotBudget").textContent =
      `驾驶员 ${pilotStore.pilots.length} 名 · COST +${pilotStore.pilots.reduce((sum, p) => sum + PilotSystem.cost(p), 0)}`;
    if (!pilotStore.pilots.length)
      list.append(
        element("p", "muted", "点击下方“新增驾驶员”创建。未配属时使用单位所属阵营的默认驾驶员。"),
      );
    const search = byId("pilotRosterSearch").value.trim().toLocaleLowerCase();
    const visible = pilotStore.pilots.filter((p) =>
      (p.name + " " + I18n.pilotName(p)).toLocaleLowerCase().includes(search),
    );
    if (pilotStore.pilots.length && !visible.length)
      list.append(element("p", "muted", "没有符合条件的驾驶员。"));
    for (const p of visible) {
      const card = element("div", "formation-row custom-pilot-card");
      const img = element("img");
      img.src = PilotSystem.portrait(p);
      img.alt = "";
      const text = element("span");
      const pilotName = p.ace
        ? aceName(PilotSystem.aceProfile(p))
        : element("span", "", I18n.pilotName(p));
      pilotName.dataset.i18nIgnore = "";
      text.append(
        pilotName,
        document.createTextNode(` · Lv.${p.level} · COST +${PilotSystem.cost(p)}`),
      );
      text.append(
        element(
          "small",
          "",
          p.ace
            ? `ACE · EXP ${p.experience}/${p.level === PilotSystem.maxLevel(p) ? "MAX" : PilotSystem.experienceRequired(p.level, p)}`
            : `EXP ${p.experience}/${PilotSystem.experienceRequired(p.level, p)} · 强化点 ${p.points}`,
        ),
      );
      const record = element("span", "pilot-record");
      renderPilotRecord(record, p);
      text.append(record);
      if (p.ace)
        text.append(
          aceTags(PilotSystem.aceProfile(p)),
          element("small", "ace-recruit-status", aceStatus(PilotSystem.aceProfile(p))),
        );
      img.className = "formation-icon";
      text.className = "custom-pilot-summary";
      const actions = element("div", "formation-row-actions");
      const details = element("button", "formation-detail-button", "详情");
      details.type = "button";
      details.setAttribute("aria-label", "管理驾驶员 " + p.name);
      details.onclick = () => editPilot(p);
      const remove = element("button", "danger", "删除");
      remove.type = "button";
      remove.setAttribute("aria-label", "删除驾驶员 " + p.name);
      remove.onclick = async () => {
        if (
          await GameDialog.confirm(`删除驾驶员“${p.name}”？本地编组中的配属也会清除。`, {
            title: "删除驾驶员",
            confirmText: "删除",
            danger: true,
          })
        )
          deletePilot(p.id);
      };
      if (PilotSystem.canLearnSkill(p)) {
        const learn = element("button", "pilot-skill-alert", "选择技能");
        learn.type = "button";
        learn.setAttribute("aria-label", "选择驾驶员技能 " + p.name);
        learn.onclick = () => {
          editPilot(p);
          openPilotSkillPicker();
        };
        actions.append(learn);
      }
      actions.append(details);
      if (!p.ace) actions.append(remove);
      if (p.needsRecruitment) {
        text.append(element("small", "ace-recruit-locked", "待回归"));
        const recruit = element("button", "", "重新招募");
        recruit.type = "button";
        recruit.onclick = () => openAceRecruitment(p.aceId);
        actions.append(recruit);
      }
      card.append(img, text, actions);
      card.onclick = (event) => {
        if (!event.target.closest("button")) editPilot(p);
      };
      list.append(card);
    }
    byId("recruitAcePilot").disabled = false;
    list.scrollTop = scrollTop;
  }
  byId("pilotRosterSearch").oninput = renderPilotRoster;
  function showFormationTab(tab) {
    finishPilotEditor();
    const pilots = tab === "pilots";
    byId("formationMain").dataset.page = tab;
    byId("formationUnitsTab").setAttribute("aria-pressed", String(!pilots));
    byId("formationPilotsTab").setAttribute("aria-pressed", String(pilots));
    pilotPage.hidden = !pilots;
    byId("formationUnitsWorkspace").hidden = pilots;
    byId("formationPilotToolbar").hidden = !pilots;
    byId("formationPilotBudget").hidden = !pilots;
    byId("produceMissingFormation").hidden = pilots || !Economy.licensePlan(draft).items.length;
    byId("saveFormation").hidden = false;
    if (pilots) renderPilotRoster();
  }
  function deletePilot(id) {
    function detach(entries) {
      return entries.map((entry) => {
        if (entry.customPilot?.id !== id) return entry;
        const copy = { ...entry };
        delete copy.customPilot;
        return copy;
      });
    }
    pilotStore.pilots = pilotStore.pilots.filter((p) => p.id !== id);
    draft = detach(draft);
    squads = squads.map((squad) => ({ ...squad, units: detach(squad.units) }));
    savePilots();
    persist();
    render();
    renderPilotRoster();
    byId("createCustomPilot").focus();
  }
  function commitPilot(profile) {
    const clean = PilotSystem.custom(profile);
    const i = pilotStore.pilots.findIndex((p) => p.id === clean.id);
    if (i < 0) pilotStore.pilots.push(clean);
    else pilotStore.pilots[i] = clean;
    savePilots();
    draft = hydratePilots(draft);
    squads = squads.map((s) => ({ ...s, units: hydratePilots(s.units) }));
    persist();
    render();
    renderPilotRoster();
    // Refresh a submitted room squad after training or rank changes. The room
    // otherwise retains the profile captured when the player last readied.
    if (Net.active && Net.seat !== null && !Net.snapshot?.started &&
        !Net.snapshot?.loadedSave && !ownPlayer()?.formationPreset)
      Net.request("update_formation", { formation: current() });
    return clean;
  }
  function editPilot(p = null) {
    pilotFocus = document.activeElement;
    pilotIsNew = !p;
    pilotEdit = structuredClone(
      p ||
        PilotSystem.createCustom(
          "custom-" +
            (globalThis.crypto?.randomUUID?.() ||
              Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)),
          "驾驶员[" +
            String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
            String(Math.floor(Math.random() * 100)).padStart(2, "0") +
            "]",
          PilotSystem.defaultPortrait(group)?.id,
          group,
        ),
    );
    pilotOriginal = JSON.stringify(pilotEdit);
    byId("customPilotName").value = I18n.pilotName(pilotEdit);
    byId("customPilotName").disabled = true;
    byId("renameCustomPilot").textContent = "修改名称";
    byId("renameCustomPilot").hidden = !!pilotEdit.ace;
    byId("changeCustomPilotPortrait").disabled = !!pilotEdit.ace;
    byId("customPilotPortraitPicker").hidden = true;
    byId("createPilotConfirm").hidden = !pilotIsNew;
    renderPilotStats();
    pilotEditor.hidden = false;
    byId("formationMain").inert = true;
    (pilotEdit.ace ? byId("finishCustomPilot") : byId("changeCustomPilotPortrait")).focus();
  }
  function savePilotIdentity(fields) {
    Object.assign(pilotEdit, fields);
    const original = { ...JSON.parse(pilotOriginal), ...fields };
    // Identity edits never commit pending training points.
    if (!pilotIsNew) commitPilot(original);
    pilotOriginal = JSON.stringify(original);
    renderPilotStats();
  }
  function openPortraitPicker() {
    if (!pilotEdit || pilotEdit.ace) return;
    const portraits = byId("customPilotPortraits");
    portraits.replaceChildren();
    for (const [i, portrait] of PilotSystem.catalog.portraits.entries()) {
      const button = element("button");
      button.type = "button";
      button.setAttribute("aria-label", portrait.name);
      button.title = portrait.name;
      button.setAttribute(
        "aria-pressed",
        String(!pilotEdit.uploadedPortrait && portrait.id === pilotEdit.portraitId),
      );
      const img = element("img");
      img.src = portrait.icon;
      img.alt = "";
      button.append(img);
      button.onclick = () => {
        savePilotIdentity({ portraitId: portrait.id, uploadedPortrait: null });
        closePortraitPicker();
      };
      portraits.append(button);
    }
    byId("customPilotPortraitPicker").hidden = false;
    byId("closePilotPortraitPicker").focus();
  }
  function closePortraitPicker() {
    byId("customPilotPortraitPicker").hidden = true;
    byId("changeCustomPilotPortrait").focus();
  }
  byId("uploadPilotPortrait").onchange = async (event) => {
    if (!pilotEdit || pilotEdit.ace) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    const editing = pilotEdit;
    if (!file || !editing) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    )
      return note("请选择10MB以内的PNG、JPEG或WebP图片。");
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d"),
        side = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.fillStyle = "#152430";
      ctx.fillRect(0, 0, 128, 128);
      ctx.drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        128,
        128,
      );
      let data;
      for (const quality of [0.85, 0.65, 0.4, 0.2]) {
        data = canvas.toDataURL("image/jpeg", quality);
        if (data.length <= PilotSystem.maxPortraitLength) break;
      }
      PilotSystem.portraitData(data);
      if (pilotEdit !== editing) return;
      savePilotIdentity({ uploadedPortrait: data });
      closePortraitPicker();
    } catch {
      note("无法读取此头像，请换一张图片。");
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  function renderPilotStats() {
    byId("customPilotAvatar").src = PilotSystem.portrait(pilotEdit);
    resetTraining.hidden = !!pilotEdit.ace;
    byId("pilotTrainingTitle").textContent = pilotEdit.ace ? "驾驶员属性" : "属性强化";
    byId("acePilotDetails").hidden = !pilotEdit.ace;
    if (pilotEdit.ace)
      renderAceInformation(byId("acePilotDetails"), PilotSystem.aceProfile(pilotEdit));
    resetTraining.textContent = "重置属性点 · 资金 " + 1000 * pilotEdit.level;
    resetTraining.disabled = pilotIsNew || !Economy.affordable({ money: 1000 * pilotEdit.level });
    byId("customPilotProgress").textContent =
      `Lv.${pilotEdit.level}${pilotEdit.level === PilotSystem.maxLevel(pilotEdit) ? " MAX" : ""} · COST +${PilotSystem.cost(pilotEdit)} · EXP ${pilotEdit.experience}/${pilotEdit.level === PilotSystem.maxLevel(pilotEdit) ? "MAX" : PilotSystem.experienceRequired(pilotEdit.level, pilotEdit)}${pilotEdit.ace ? " · ACE · " + I18n.text("悟性") + " " + PilotSystem.aceProfile(pilotEdit).comprehension : " · 强化点 " + pilotEdit.points}`;
    renderPilotRecord(byId("customPilotRecord"), pilotEdit);
    learnPilotSkillButton.hidden = !!pilotEdit.ace;
    learnPilotSkillButton.disabled = pilotEdit.level < PilotSystem.skillUnlockLevel;
    learnPilotSkillButton.classList.toggle(
      "pilot-skill-alert",
      PilotSystem.canLearnSkill(pilotEdit),
    );
    learnPilotSkillButton.textContent = I18n.text(
      pilotEdit.selectedSkillId
        ? "查看驾驶员技能"
        : pilotEdit.level >= PilotSystem.skillUnlockLevel
          ? "选择驾驶员技能"
          : "6级解锁技能",
    );
    const original = JSON.parse(pilotOriginal);
    const pendingPoints = original.points - pilotEdit.points;
    const readyToUpgrade = PilotSystem.canUpgrade(pilotEdit);
    upgradePilotButton.hidden = pilotIsNew || pilotEdit.level >= PilotSystem.maxLevel(pilotEdit);
    upgradePilotButton.classList.toggle("pilot-skill-alert", readyToUpgrade);
    upgradePilotButton.disabled = !readyToUpgrade || pendingPoints !== 0 ||
      !Economy.affordable({ money: PilotSystem.upgradeCost(pilotEdit) });
    upgradePilotButton.textContent = I18n.text("升职") + " · " + I18n.text("资金") + " " +
      (PilotSystem.upgradeCost(pilotEdit) ?? "—");
    demotePilotButton.hidden = pilotIsNew || pilotEdit.level === 0;
    demotePilotButton.disabled = !!pilotEdit.needsRecruitment || pendingPoints !== 0 ||
      PilotSystem.demotionCost(pilotEdit) === null ||
      !Economy.affordable({ money: PilotSystem.demotionCost(pilotEdit) });
    demotePilotButton.textContent = I18n.text("降职") + " · " + I18n.text("资金") + " " +
      (PilotSystem.demotionCost(pilotEdit) ?? "—");
    byId("createPilotConfirm").textContent = I18n.text("招募驾驶员") + " · " +
      I18n.text("资金") + " " + PilotSystem.customRecruitmentCost;
    byId("createPilotConfirm").disabled = !Economy.affordable({ money: PilotSystem.customRecruitmentCost });
    byId("pilotTrainingActions").hidden = !!pilotEdit.ace;
    byId("confirmPilotTraining").disabled = pendingPoints === 0;
    byId("cancelPilotTraining").disabled = pendingPoints === 0;
    byId("pilotTrainingStatus").textContent =
      pendingPoints > 0
        ? `待确认强化：已分配${pendingPoints}点。确认强化后应用，取消强化可撤销本次分配。`
        : pilotEdit.ace
          ? I18n.text("ACE按悟性自动成长，不能手动加点或重置。")
          : "点击属性右侧“＋”分配强化点，再确认强化。";
    const stats = byId("customPilotStats");
    stats.replaceChildren();
    for (const [key, label] of Object.entries(PilotSystem.labels)) {
      const row = element("div", "custom-pilot-stat"),
        plus = element("button", "", "+");
      plus.type = "button";
      plus.setAttribute("aria-label", "强化" + label);
      plus.disabled =
        !pilotEdit.points || pilotEdit.stats[key] >= PilotSystem.statCap(pilotEdit.level);
      plus.onclick = () => {
        pilotEdit.stats[key]++;
        pilotEdit.points--;
        renderPilotStats();
      };
      const plusFive = element("button", "pilot-plus-five", "+5");
      plusFive.type = "button";
      plusFive.setAttribute("aria-label", "强化" + label + " +5");
      plusFive.disabled =
        pilotEdit.points < 5 || pilotEdit.stats[key] + 5 > PilotSystem.statCap(pilotEdit.level);
      plusFive.onclick = () => {
        pilotEdit.stats[key] += 5;
        pilotEdit.points -= 5;
        renderPilotStats();
      };
      plus.hidden = plusFive.hidden = !!pilotEdit.ace;
      row.append(
        element(
          "span",
          "",
          `${label} ${Number(pilotEdit.stats[key].toFixed(2))} / ${pilotEdit.ace ? Number(PilotSystem.aceStatCap(pilotEdit, key).toFixed(2)) : PilotSystem.statCap(pilotEdit.level)}`,
        ),
        plus,
        plusFive,
      );
      stats.append(row);
    }
  }
  const upgradePilotButton = element("button", "primary", "升职");
  upgradePilotButton.id = "upgradePilot";
  upgradePilotButton.type = "button";
  byId("customPilotProgress").after(upgradePilotButton);
  const demotePilotButton = element("button", "", "降职");
  demotePilotButton.id = "demotePilot";
  demotePilotButton.type = "button";
  upgradePilotButton.after(demotePilotButton);
  demotePilotButton.onclick = async () => {
    if (!pilotEdit || pilotIsNew || demotePilotButton.disabled) return;
    const original = pilotOriginal;
    const cost = PilotSystem.demotionCost(pilotEdit);
    if (!(await GameDialog.confirm(I18n.text("降职将重置已分配的强化点和所选技能，经验保留。是否继续？"), {
      title: I18n.text("降职") + " · " + I18n.text("资金") + " " + cost,
    }))) return;
    if (!pilotEdit || pilotOriginal !== original || demotePilotButton.disabled) return;
    try {
      const clean = PilotSystem.demote(pilotEdit);
      const next = { ...pilotStore, pilots: pilotStore.pilots.map((p) => p.id === clean.id ? clean : p) };
      if (!Economy.transact({ money: cost }, {}, [[sharedPilotKey, JSON.stringify(next)]]))
        return note("资金不足");
      pilotStore = next;
      pilotEdit = clean;
      pilotOriginal = JSON.stringify(clean);
      commitPilot(clean);
      renderPilotStats();
    } catch (error) { note(Economy.errorMessage(error)); }
  };
  upgradePilotButton.onclick = () => {
    if (!pilotEdit || pilotIsNew || !PilotSystem.canUpgrade(pilotEdit)) return;
    if (JSON.parse(pilotOriginal).points !== pilotEdit.points) return;
    const cost = PilotSystem.upgradeCost(pilotEdit);
    const clean = PilotSystem.upgrade(pilotEdit);
    const next = { ...pilotStore, pilots: pilotStore.pilots.map((p) => p.id === clean.id ? clean : p) };
    try {
      if (!Economy.transact({ money: cost }, {}, [[sharedPilotKey, JSON.stringify(next)]]))
        return note("资金不足");
      pilotStore = next;
      pilotEdit = clean;
      pilotOriginal = JSON.stringify(clean);
      commitPilot(clean);
      renderPilotStats();
    } catch (error) {
      note(Economy.errorMessage(error));
    }
  };
  const resetTraining = element("button", "", "重置属性点");
  resetTraining.id = "resetPilotTraining";
  resetTraining.type = "button";
  byId("pilotTrainingTitle").parentElement.append(resetTraining);
  resetTraining.onclick = async () => {
    if (!pilotEdit || pilotIsNew || pilotEdit.ace) return;
    const id = pilotEdit.id,
      faction = group,
      cost = 1000 * pilotEdit.level;
    if (
      !(await GameDialog.confirm("花费 " + cost + " 资金重置属性点，是否继续？", {
        title: "重置驾驶员属性",
        confirmText: "重置",
      }))
    )
      return;
    if (!pilotEdit || pilotEdit.id !== id || group !== faction) return;
    const clean = PilotSystem.refundTraining(pilotEdit);
    const next = { ...pilotStore, pilots: pilotStore.pilots.map((p) => (p.id === id ? clean : p)) };
    try {
      if (!Economy.transact({ money: cost }, {}, [[sharedPilotKey, JSON.stringify(next)]]))
        return note("资金不足");
      pilotStore = next;
      pilotEdit = clean;
      pilotOriginal = JSON.stringify(clean);
      commitPilot(clean);
      renderPilotStats();
    } catch (error) {
      note(Economy.errorMessage(error));
    }
  };
  function finishPilotEditor() {
    if (!pilotEdit) return;
    pilotEdit = null;
    pilotEditor.hidden = true;
    byId("customPilotPortraitPicker").hidden = true;
    byId("formationMain").inert = false;
    renderPilotRoster();
    pilotFocus?.focus();
  }
  byId("renameCustomPilot").onclick = () => {
    if (!pilotEdit || pilotEdit.ace) return;
    const input = byId("customPilotName"),
      button = byId("renameCustomPilot");
    if (input.disabled) {
      input.disabled = false;
      button.textContent = "保存名称";
      input.focus();
      input.select();
      return;
    }
    try {
      const clean = PilotSystem.custom({ ...pilotEdit, name: input.value });
      savePilotIdentity({ name: clean.name });
      input.value = clean.name;
      input.disabled = true;
      button.textContent = "修改名称";
    } catch (error) {
      note(error.message);
    }
  };
  byId("confirmPilotTraining").onclick = () => {
    if (!pilotEdit) return;
    if (!pilotIsNew) commitPilot(pilotEdit);
    pilotOriginal = JSON.stringify(pilotEdit);
    renderPilotStats();
  };
  byId("cancelPilotTraining").onclick = () => {
    pilotEdit = structuredClone(JSON.parse(pilotOriginal));
    renderPilotStats();
  };
  byId("createPilotConfirm").onclick = () => {
    if (!pilotEdit || !pilotIsNew) return;
    try {
      const clean = PilotSystem.custom(pilotEdit);
      const next = { ...pilotStore, pilots: [...pilotStore.pilots, clean] };
      if (!Economy.transact({ money: PilotSystem.customRecruitmentCost }, {}, [[sharedPilotKey, JSON.stringify(next)]]))
        return note("资金不足");
      pilotStore = next;
      pilotIsNew = false;
      commitPilot(clean);
      finishPilotEditor();
    } catch (error) { note(Economy.errorMessage(error)); }
  };
  byId("changeCustomPilotPortrait").onclick = openPortraitPicker;
  byId("closePilotPortraitPicker").onclick = closePortraitPicker;
  byId("formationUnitsTab").onclick = () => showFormationTab("units");
  byId("formationPilotsTab").onclick = () => showFormationTab("pilots");
  byId("createCustomPilot").onclick = () => editPilot();
  byId("finishCustomPilot").onclick = finishPilotEditor;
  const learnPilotSkillButton = element("button", "pilot-skill-button", "6级解锁技能");
  learnPilotSkillButton.id = "learnPilotSkill";
  learnPilotSkillButton.type = "button";
  byId("customPilotProgress").after(learnPilotSkillButton);
  const pilotSkillPicker = element("dialog", "pilot-attribute-help pilot-skill-picker");
  pilotSkillPicker.id = "pilotSkillPicker";
  pilotSkillPicker.setAttribute("aria-labelledby", "pilotSkillPickerTitle");
  document.body.append(pilotSkillPicker);
  function openPilotSkillPicker() {
    if (!pilotEdit || pilotEdit.ace || pilotEdit.level < PilotSystem.skillUnlockLevel) return;
    const ownerId = pilotEdit.id;
    const readOnly = !!pilotEdit.selectedSkillId;
    let choice = pilotEdit.selectedSkillId || null;
    const title = element("h3", "", "选择驾驶员技能");
    title.id = "pilotSkillPickerTitle";
    const explanation = element(
      "p",
      "muted",
      "选择一个技能；重置属性时会清除技能，可重新选择。",
    );
    const grid = element("div", "pilot-skill-choices");
    const confirm = element("button", "primary", "确认技能");
    confirm.id = "confirmPilotSkill";
    confirm.disabled = true;
    confirm.hidden = readOnly;
    for (const skill of PilotSystem.skillChoices.filter((s) => !readOnly || s.id === choice)) {
      const button = element("button", "pilot-skill-choice");
      button.type = "button";
      button.dataset.pilotSkillChoice = skill.id;
      button.setAttribute("aria-pressed", String(skill.id === choice));
      button.disabled = readOnly;
      const image = element("img");
      image.src = skill.icon;
      image.alt = "";
      const text = element("span");
      text.append(
        element("strong", "", I18n.localized(skill, "name")),
        element("small", "", SkillControls.description(skill)),
      );
      button.append(image, text);
      button.onclick = () => {
        choice = skill.id;
        for (const item of grid.querySelectorAll("[data-pilot-skill-choice]"))
          item.setAttribute("aria-pressed", String(item.dataset.pilotSkillChoice === choice));
        confirm.disabled = false;
      };
      grid.append(button);
    }
    confirm.onclick = () => {
      if (!pilotEdit || pilotEdit.id !== ownerId) return;
      try {
        const learned = PilotSystem.learnSkill(pilotEdit, choice);
        savePilotIdentity({ selectedSkillId: learned.selectedSkillId });
        pilotSkillPicker.close();
      } catch (error) {
        note(error.message);
      }
    };
    const cancel = element("button", "", readOnly ? "关闭" : "取消");
    cancel.id = "cancelPilotSkill";
    cancel.type = confirm.type = "button";
    cancel.onclick = () => pilotSkillPicker.close();
    const actions = element("footer", "pilot-skill-picker-actions");
    actions.append(cancel, confirm);
    pilotSkillPicker.replaceChildren(title, explanation, grid, actions);
    if (!pilotSkillPicker.open) pilotSkillPicker.showModal();
  }
  learnPilotSkillButton.onclick = openPilotSkillPicker;
  window.addEventListener("page-changing", () => pilotSkillPicker.close());
  const pilotHelp = element("dialog", "pilot-attribute-help");
  pilotHelp.id = "pilotAttributeHelp";
  pilotHelp.setAttribute("aria-labelledby", "pilotAttributeHelpTitle");
  document.body.append(pilotHelp);
  const pilotEffectDescriptions = [
    ["射击", "每点增加0.25个百分点的射击伤害倍率；100点为100%，200点为125%。"],
    ["格斗", "每点增加0.25个百分点的格斗伤害倍率；100点为100%，200点为125%。"],
    ["防御", "每点降低0.25个百分点的承受伤害倍率；100点为100%，200点为75%。"],
    [
      "机动",
      "以100点为基准，每点使移动倍率变化0.5%、AP倍率变化0.25%。150点为125%移动、112.5% AP，200点为150%移动、125% AP。最终AP四舍五入；移动保留小数预算。不影响回避。",
    ],
    [
      "命中",
      "每点增加0.25个百分点的命中倍率；100点为100%，200点为125%。命中率乘我方命中倍率、除以敌方回避倍率，全部修正后限制在0%～100%。",
    ],
    [
      "反应",
      "每点增加0.25个百分点的回避倍率；100点为100%，200点为125%。敌方命中率除以该倍率；与我方通讯回避倍率相乘，不再放大未命中概率。",
    ],
    [
      "指挥",
      "100点时指挥光环范围为3格、效果为10%；每高25点，范围增加1格、效果增加1个百分点；每低25点相应减少。仅影响机体已有的指挥光环。",
    ],
    [
      "觉醒",
      "达到100点时，射击与格斗伤害额外乘以107.5%；低于100点没有额外加成，超过100点不再继续提高此效果。",
    ],
  ];
  byId("openPilotAttributeHelp").onclick = () => {
    const heading = element("header", "pilot-help-heading");
    const title = element("h3", "", "驾驶员属性说明");
    title.id = "pilotAttributeHelpTitle";
    const close = element("button", "", "关闭");
    close.type = "button";
    close.onclick = () => pilotHelp.close();
    heading.append(title, close);
    const effects = element("dl", "pilot-effect-list");
    for (const [label, description] of pilotEffectDescriptions)
      effects.append(element("dt", "", label), element("dd", "", description));
    pilotHelp.replaceChildren(heading, effects);
    pilotHelp.showModal();
  };
  for (const event of ["keydown", "keyup"])
    pilotHelp.addEventListener(event, (event) => event.stopPropagation());
  window.addEventListener("page-changing", () => pilotHelp.close());
  pilotEditor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!byId("customPilotPortraitPicker").hidden) closePortraitPicker();
      else finishPilotEditor();
    }
    if (event.key === "Tab") {
      const focusable = [
        ...pilotEditor.querySelectorAll("button:not([disabled]), input:not([disabled])"),
      ].filter((e) => e.getClientRects().length);
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  window.addEventListener("language-change", () => {
    if (aceRecruit.open) renderAceRecruitment();
    if (pilotEdit && !pilotEditor.hidden) {
      if (pilotEdit.ace) byId("customPilotName").value = I18n.pilotName(pilotEdit);
      renderPilotStats();
    }
  });
  window.addEventListener("page-changing", finishPilotEditor);
  PlayerProfile.setFormationGroup(group);
  loadCharacter();
  return {
    renderPreview,
    unitTags,
    unitSummaryTags,
    replenish,
    checkLicenses,
    current,
    receivePilotAwards,
    exportPilotStores: () =>
      Object.fromEntries(
        ["PMC", "EFSF", "ZEON"].map((faction) => [
          faction,
          {
            pilots: structuredClone(pilotStore.pilots.filter((pilot) => pilot.faction === faction)),
            awards: [...pilotStore.awards],
          },
        ]),
      ),
    hasPilotAward: (id) => pilotStore.awards.includes(id),
    open,
    group: () => group,
    setGroup,
    alignWithRoom: (snapshot) => {
      const member = snapshot?.members?.find((item) => item.id === snapshot.you?.id);
      if (!member || !["PMC", "EFSF", "ZEON"].includes(member.characterFaction)) return;
      setGroup(member.characterFaction);
      PlayerProfile.setFaction(member.characterFaction);
    },
    previewUnit,
    openAceRecruitment,
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
        units: !squad.units.length ? [] : Rules.validateFormation(
          hydratePilots(squad.units),
          Infinity,
          Rules.catalog.formation.maxUnits,
        ),
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
        : `${teamName(Rules.seatTeam(seat))}全队共享部署区 · 选中己方单位，再点击高亮空格调整位置。`;
    byId("confirmDeployment").disabled = !canEdit() || !!pendingMovement();
    byId("confirmDeployment").textContent =
      seat !== null && game.deployment[seat] ? "已确认，等待对方" : "确认部署 (B)";
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
    if (pendingMovement()) return;
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
