/* 编组保存单位/套件 ID 与可选自定义名称；数值和部署合法性由共用规则决定。 */
const Formation = (() => {
  const { renderPreview, unitSummaryTags, unitTags } = UnitPreview;
  const legacyStorageKey = "slg-formations-v1";
  const formationSaveVersion = 3;
  let group = PlayerProfile.faction();
  let storageKey = legacyStorageKey + "." + group;
  const sessionSaves = new Map();
  let carrierPage = null;
  const pilotStorageKey = "projectgreed.custom-pilots.v2.";
  const pilotStores = {};
  const sharedPilotKey = "projectgreed.custom-pilots.v3.shared";
  let pilotStore;
  let pilotStorageReady = false;
  try {
    pilotStore = JSON.parse(localStorage.getItem(sharedPilotKey));
  } catch {}
  // Modern saves need no reads or parsing of the six obsolete faction rosters.
  const migratePilots = !Array.isArray(pilotStore?.pilots) || !Array.isArray(pilotStore?.awards);
  if (migratePilots) {
    for (const faction of ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"]) {
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
    // Merge the old shared roster before replacing the obsolete storage keys.
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
        }
        localStorage.setItem(pilotStorageKey + "migrated", group);
      }
    } catch {}
  }
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
  function activePilots() { return pilotStore.pilots.filter(p=>!p.inDormStorage); }
  for(const ace of [false,true]) {
    const limit=ace?Economy.acePilotLimit():Economy.customPilotLimit();
    activePilots().filter(p=>!!p.ace===ace).slice(limit).forEach(p=>p.inDormStorage=true);
  }
  savePilots();
  function savePilots() {
    try {
      ProfileStorage.replace([
        [sharedPilotKey, JSON.stringify(pilotStore)],
        ...["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"].map((faction) => [
          pilotStorageKey + faction,
          null,
        ]),
        ["projectgreed.custom-pilots.v1", null],
      ]);
      pilotStorageReady = true;
      return true;
    } catch {
      pilotStorageReady = false;
      note("浏览器无法保存驾驶员，本次会话仍可使用。");
      return false;
    }
  }
  function hydratePilots(entries) {
    const items = [...Economy.snapshot().storage.units, ...Economy.snapshot().storage.ships];
    const assigned = entries.map((entry) => {
      let index = entry.stockId ? items.findIndex((item) => item.id === entry.stockId) : items.findIndex((item) => item.unitId === entry.unitId && item.kitId === entry.kitId);
      if (index < 0 && !entry.stockId) index = items.findIndex((item) => item.unitId === entry.unitId);
      if (index < 0) {
        if (!entry.stockId) return entry;
        const copy = { ...entry };
        delete copy.customPilot;
        delete copy.pilotId;
        return copy;
      }
      const item = items.splice(index, 1)[0];
      const copy = { ...entry, stockId: item.id, unitId: item.unitId, kitId: item.kitId, plugins:item.plugins }, pilot = storedPilot(item);
      if (item.destroyed || item.hp === 0) {
        delete copy.customPilot;
        delete copy.pilotId;
        return copy;
      }
      if (!Object.hasOwn(item, "pilotId")) {
        if (!copy.customPilot || copy.customPilot.hired || copy.customPilot.pmcGeneral) copy.customPilot = pilot;
        return copy;
      }
      if (pilot) copy.customPilot = pilot;
      else delete copy.customPilot;
      return copy;
    });
    return PilotSystem.normalizeCrewFormation(assigned, Economy.snapshot().crewStock, Rules.formationModel).map((entry) => {
      const copy = { ...entry };
      // Named ACEs remain in the catalog for future technology unlocks.
      delete copy.pilotId;
      if (copy.customPilot) {
        if (copy.customPilot.pmcGeneral) {
          copy.customPilot=PilotSystem.custom(copy.customPilot);
          return copy;
        }
        if (copy.customPilot.hired) return copy;
        const saved = pilotStore.pilots.find((p) => p.id === copy.customPilot.id);
        if (saved && !saved.inDormStorage && !saved.needsRecruitment && PilotSystem.canAssign(saved, group))
          copy.customPilot = structuredClone(saved);
        else delete copy.customPilot;
      }
      return copy;
    });
  }
  function storedPilot(item) {
    if (item.destroyed) return null;
    const fallback = () => PilotSystem.generalPMC("pmc-general-" + item.id,
      PilotSystem.commandUnit(UnitModels[item.unitId + "__" + item.kitId]));
    if (!item.pilotId || item.pilotId.startsWith("crew:")) return fallback();
    if (item.pilotId.startsWith("pmc-general-")) return PilotSystem.generalPMC(item.pilotId,
      PilotSystem.commandUnit(UnitModels[item.unitId + "__" + item.kitId]));
    const pilot = activePilots().find((pilot) => pilot.id === item.pilotId && !pilot.needsRecruitment && PilotSystem.canAssign(pilot, group));
    return pilot ? structuredClone(pilot) : fallback();
  }
  function saveStoredPilot(entry, profile) {
    const entries = draft.length ? draft : current(),
      items = [...Economy.snapshot().storage.units, ...Economy.snapshot().storage.ships].filter((item) => !item.destroyed);
    for (const candidate of entries) {
      let index = candidate.stockId ? items.findIndex((item) => item.id === candidate.stockId) : items.findIndex((item) => item.unitId === candidate.unitId && item.kitId === candidate.kitId);
      if (index < 0 && !candidate.stockId) index = items.findIndex((item) => item.unitId === candidate.unitId);
      if (index < 0) continue;
      const item = items.splice(index, 1)[0];
      if (candidate === entry) {
        return Economy.setStoredPilot(item.id, profile?.hired ? "crew:" + profile.grade : profile?.id || null);
      }
    }
  }
  function receivePilotAwards(snapshot) {
    if (snapshot.replay || snapshot.phase === "replay" || snapshot.campaign) return;
    if (PilotSystem.creditAwards(pilotStore, snapshot.pilotAwards || [], { settled: !!snapshot.rewardsSettled })) {
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
      PMC: Economy.starterFormation(),
    };
    return [{ name: faction + " 默认编组", units: units[faction] || [] }];
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
    externalPreviewReturn = null,
    pilotIndex = null;
  const pickerKits = new Map();
  let selectedStoredId = null;
  function openStoredPreview(stockId) {
    if (!stockId) return note("出战库存不足");
    const pickerOpen = !byId("formationUnitPicker").hidden;
    byId("formationMain").inert = true;
    const opened = WarehouseUI.openItem(stockId, () => {
      const available = new Set([...Economy.snapshot().storage.units, ...Economy.snapshot().storage.ships].map((item) => item.id));
      for (let i = draft.length - 1; i >= 0; i--) if (draft[i].stockId && !available.has(draft[i].stockId)) removeEntry(i);
      draft = hydratePilots(draft);
      saveDraft();
      render();
      if (pickerOpen) renderCatalog();
      byId("formationMain").inert = pickerOpen;
    });
    if (!opened) byId("formationMain").inert = pickerOpen;
  }
  let catalogRevision = 0,
    catalogRenderKey = null;
  const catalogFilters = { faction: "", era: "", type: "" };
  const current = () =>
    !squads[index].units.length
      ? []
      : Rules.validateFleetFormation(
          hydratePilots(squads[index].units),
          Infinity,
          Rules.catalog.formation.maxUnits,
        );
  const ownPlayer = () => Net.snapshot?.members.find((player) => player.id === Net.memberId);
  let editorStyle =
    localStorage.getItem("projectgreed.formation-editor-style") === "free" ? "free" : "standard";
  const freeFormation = () =>
    Net.active && Net.snapshot?.settings
      ? Rules.formationStyle(Net.snapshot.settings) === "free"
      : editorStyle === "free";
  function canEditRoom() {
    const snapshot = Net.snapshot;
    return (
      !!snapshot &&
      Net.seat !== null &&
      !snapshot.loadedSave &&
      !ownPlayer()?.formationPreset &&
      (!snapshot.started ||
        (snapshot.phase === "assembly" &&
          !snapshot.assembly?.players.find((p) => p.memberId === Net.memberId)?.ready))
    );
  }
  const budget = () =>
    Net.active && Net.snapshot?.settings
      ? Rules.armyBudget(Net.snapshot.settings, ownPlayer())
      : Infinity;
  const restrictions = () => ({
    ...Rules.armyRestrictions(
      Net.active && Net.snapshot?.settings
        ? Net.snapshot.settings
        : {
            ...Rules.defaultRoomSettings(),
            // The hangar has no battlefield environment until a room is joined.
            mapId: null,
            costLimit: 99999,
            mode: "quick",
            formationStyle: editorStyle,
          },
      Net.active ? ownPlayer() : null,
    ),
    ...(Net.active ? {} : { unitCostLimit: Infinity }),
    ...(Net.active && Net.snapshot?.settings
      ? Rules.armyRestrictions(Net.snapshot.settings, ownPlayer())
      : {}),
    characterFaction: group,
    licenses: Economy.snapshot().licenses,
    ownedStock: Economy.normalizeStock(Economy.snapshot()),
    ...(Net.active && Net.snapshot?.settings.mode === "quick"
      ? {}
      : Economy.normalizeStock(Economy.snapshot())),
  });
  let technologyContext;
  function roomTechnologyCaps() {
    const settings = Net.active ? Net.snapshot?.settings : null, player = Net.active ? ownPlayer() : null;
    if (!technologyContext || technologyContext.settings !== settings || technologyContext.player !== player)
      technologyContext = { settings, player, caps: settings ? Rules.armyRestrictions(settings, player).technologyCaps : undefined };
    return technologyContext.caps;
  }
  function exceedsTechnology(unit) {
    if (!unit) return false;
    const model = unit.prefabId ? unit : UnitModels[unit.id + "__" + (pickerKits.get(unit.id) || Economy.defaultKit(unit.id) || unit.weaponKits[0].id)];
    return !!model && Rules.restrictionReason(model, { technologyCaps: roomTechnologyCaps() }) === "technology_limit";
  }
  // Owned stock can deploy without personal research, but room technology caps still apply.
  const canAddUnit = (model) =>
    !!model && !exceedsTechnology(model) && [null, "not_developed"].includes(PlayerProfile.restriction(model));
  const displayLimit = (value) => (Number.isFinite(value) ? value : I18n.text("无限"));
  const unitLimit = () =>
    !freeFormation() ? Rules.fleetLimit(Net.active ? Net.snapshot?.settings : {}) : Net.active && Net.snapshot?.settings
      ? Rules.armyUnitLimit(Net.snapshot.settings, ownPlayer())
      : Rules.catalog.formation.maxUnits;
  const points = (entries) => freeFormation() ? Rules.formationPoints(entries) : entries.filter(e => !e.preload && Rules.isFleetCarrier(Rules.formationModel(e))).length;
  const compositionWeight = model => freeFormation() ? Rules.formationWeight(model) : Number(Rules.isFleetCarrier(model));
  const cost = (entries) =>
    entries.reduce((n, e) => n + Rules.formationModel(e).cost + PilotSystem.cost(e.customPilot), 0);
  function pickerWeight() {
    const prefab = Rules.catalog.prefabs.find((item) => item.id === byId("formationPrefab").value);
    if (!prefab) return Infinity;
    const kitId =
      pickerKits.get(prefab.id) || Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id;
    const model = UnitModels[prefab.id + "__" + kitId];
    return model ? (!freeFormation() && pickerContext ? 0 : compositionWeight(model)) : Infinity;
  }
  function renderPickerCost() {
    const id = byId("formationPrefab").value,
      prefab = Rules.catalog.prefabs.find((p) => p.id === id);
    const kit = prefab && (pickerKits.get(id) || Economy.defaultKit(id) || prefab.weaponKits[0].id);
    const stored = [...Economy.snapshot().storage.units,...Economy.snapshot().storage.ships].find(item=>item.id===selectedStoredId);
    const unit = kit && UnitPlugins.apply(UnitModels[id + "__" + kit],stored?.plugins);
    const count = element(
      "span",
      "",
      I18n.text(freeFormation() ? "单位容量点" : "舰船数量") + ": " + points(draft) + " / " + displayLimit(unitLimit()),
    );
    count.id = "formationPickerUnitPoints";
    const total = element(
      "span",
      cost(draft) > budget() ? "danger-text" : "",
      I18n.text("编组COST") + ": " + cost(draft) + " / " + displayLimit(budget()),
    );
    total.id = "formationPickerSquadCost";
    const price = element("span", "", I18n.text("单位COST") + ": " + (unit?.cost ?? "—"));
    price.id = "formationPickerUnitCost";
    byId("formationPickerCost").replaceChildren(count, total, price);
  }
  function persist() {
    sessionSaves.set(storageKey, {
      version: formationSaveVersion,
      squads: structuredClone(squads),
      index,
    });
    try {
      // Assigned pilots are references into the shared roster, not copies of avatars/statistics.
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: formationSaveVersion,
          squads: pilotStorageReady
            ? ProfileStorage.compactSquads(squads, pilotStore.pilots)
            : squads,
        }),
      );
      localStorage.removeItem(legacyStorageKey);
      localStorage.removeItem(legacyStorageKey + "-active");
      localStorage.setItem(storageKey + "-active", String(index));
      return true;
    } catch (error) {
      note(typeof AppRuntime !== "undefined" && AppRuntime.native
        ? Economy.errorMessage(error)
        : "浏览器无法保存编组，本次会话仍可使用。");
      return false;
    }
  }
  function loadCharacter() {
    try {
      const marker = legacyStorageKey + ".pmc-unified";
      if (!localStorage.getItem(marker)) {
        const merged = [];
        const seen = new Set();
        for (const faction of ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"]) {
          const saved = JSON.parse(
            localStorage.getItem(legacyStorageKey + "." + faction) || "null",
          );
          for (const squad of saved?.version === formationSaveVersion ? saved.squads || [] : []) {
            const key = JSON.stringify(squad);
            if (!seen.has(key)) {
              merged.push(squad);
              seen.add(key);
            }
          }
        }
        if (merged.length)
          localStorage.setItem(
            legacyStorageKey + ".PMC",
            JSON.stringify({ version: formationSaveVersion, squads: merged }),
          );
        localStorage.setItem(marker, "1");
      }
    } catch {}

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
                : Rules.validateFleetFormation(
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
    next = "PMC";
    if (!["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"].includes(next) || group === next)
      return;
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
  function sharedUnits(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > Rules.catalog.formation.maxUnits)
      throw Error("编组分享代码无效。");
    // A shared template contains no personal pilot references, records or attributes.
    const units = entries.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        throw Error("编组分享代码无效。");
      const { unitId, kitId, preload } = entry;
      return { unitId, kitId, ...(preload === undefined ? {} : { preload }) };
    });
    return Rules.validateFleetFormation(units, Infinity, Rules.catalog.formation.maxUnits);
  }
  function encodeShare(name, units, formationStyle = "standard") {
    if (!units.length) throw Error("空编组无法分享，请先添加单位。");
    const clean = sharedUnits(units),
      payload = JSON.stringify({
        version: 1,
        name: name.trim().slice(0, 32) || "未命名编组",
        formationStyle,
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
    if (!code.startsWith(sharePrefix) || code.length > 4 * 1024 * 1024)
      throw Error("编组分享代码无效。");
    let encoded = code.slice(sharePrefix.length).replace(/\s+/g, "");
    if (!encoded || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(encoded))
      throw Error("编组分享代码无效。");
    encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    encoded += "=".repeat((4 - (encoded.length % 4)) % 4);
    let payload;
    try {
      const binary = atob(encoded),
        bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw Error("编组分享代码无效。");
    }
    if (!payload || payload.version !== 1 || typeof payload.name !== "string" ||
        (payload.formationStyle !== undefined && !["standard", "free"].includes(payload.formationStyle)))
      throw Error("编组分享代码无效。");
    const units = sharedUnits(payload.units),
      name = payload.name.trim().slice(0, 32) || "分享编组";
    // Old codes predate formation styles. Independent combat units need the free editor.
    const formationStyle = payload.formationStyle ||
      (units.some(entry => !entry.preload && !Rules.isFleetCarrier(Rules.formationModel(entry))) ? "free" : "standard");
    return { name, units, formationStyle };
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
    saveDraft();
    document.body.append(byId("formationSharePanel"));
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
      const onReturn = externalPreviewReturn;
      externalPreviewReturn = null;
      if (onReturn) onReturn();
      else developmentPreviewFocus?.focus();
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
      const list = byId("formationCatalog");
      const card = list.querySelector(`[data-unit-id="${inspectedId}"]`);
      if (
        !card ||
        list.dataset.revision !== String(catalogRevision) ||
        card.dataset.previewKit !== (pickerKits.get(inspectedId) || "")
      )
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
    if (carrierPage === i) carrierPage = null;
    else if (carrierPage > i) carrierPage--;
    draft.splice(i, 1);
    for (const entry of draft)
      if (entry.preload) {
        if (entry.preload.carrierIndex === i) delete entry.preload;
        else if (entry.preload.carrierIndex > i) entry.preload.carrierIndex--;
      }
  }
  function pickerCompatible(prefab) {
    if (!pickerContext) return freeFormation() || isFormationCarrier(prefab);
    const carrier = draft[pickerContext.carrierIndex],
      model = carrier && Rules.formationModel(carrier),
      h = model?.hangars.find((h) => h.id === pickerContext.hangarId);
    if (!h) return false;
    const used = draft
      .filter((e) => preloadMatches(e, pickerContext.carrierIndex, h.id))
      .reduce(
        (n, e) => n + (h.kind === "sfs" ? 1 : Rules.formationModel(e).transport.slotCost || 1),
        0,
      );
    return (
      used + (h.kind === "sfs" ? 1 : prefab.transport.slotCost) <= h.capacity &&
      Rules.hangarAllowsModel(h, prefab)
    );
  }
  let pickerFromHangarCard = false;
  function pickerHangarFull() {
    if (!pickerContext) return false;
    const model = Rules.formationModel(draft[pickerContext.carrierIndex]);
    const hangar = model.hangars.find((h) => h.id === pickerContext.hangarId);
    if (!hangar) return false;
    const used = draft
      .filter((entry) => preloadMatches(entry, pickerContext.carrierIndex, hangar.id))
      .reduce((sum, entry) => sum + (hangar.kind === "sfs" ? 1 : Rules.formationModel(entry).transport.slotCost || 1), 0);
    return used >= hangar.capacity;
  }
  function isFormationCarrier(prefab) {
    if (!prefab?.weaponKits?.length) return false;
    const model = Rules.formationModel({
      unitId: prefab.id,
      kitId: Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id,
    });
    return Rules.isFleetCarrier(model);
  }
  function openPicker(context = null, fromHangarCard = false) {
    byId("formationSearch").value = "";
    byId("formationSort").value = "storage";
    catalogChecks.clear();
    catalogFilters.faction = Rules.factions.includes(PlayerProfile.faction())
      ? PlayerProfile.faction()
      : "";
    byId("formationFaction").value = catalogFilters.faction;
    pickerContext = context;
    pickerFromHangarCard = fromHangarCard;
    pickerReturnIndex = context?.carrierIndex ?? null;
    detailIndex = null;
    catalogDetail = null;
    detailFromPicker = false;
    byId("formationUnitDetail").hidden = true;
    // Escape the fixed page's stacking context so the picker covers shell navigation.
    document.body.append(byId("formationUnitPicker"));
    byId("formationUnitPicker").hidden = false;
    byId("formationMain").inert = true;
    byId("formationPickerTitle").textContent = context
      ? "预先搭载"
      : freeFormation()
        ? "添加单位"
        : "选择战舰、运输机或MA";
    renderCatalog();
    byId("closeFormationPicker").focus();
  }
  function closePicker() {
    byId("formationUnitPicker").hidden = true;
    const returnIndex = pickerReturnIndex;
    const returnToList = pickerFromHangarCard;
    pickerFromHangarCard = false;
    pickerContext = null;
    pickerReturnIndex = null;
    detailFromPicker = false;
    byId("formationMain").inert = false;
    if (returnToList) {
      (
        byId("formationUnits").querySelector(`[data-add-hangar-carrier="${returnIndex}"]`) ||
        byId("formationUnits")
      ).focus();
    } else if (returnIndex !== null && draft[returnIndex]) {
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
    field.hidden = false;
    select.replaceChildren(new Option(I18n.text("不搭载（独立部署）"), ""));
    if (field.hidden) return;
    draft.forEach((carrier, carrierIndex) => {
      if (carrierIndex === detailIndex) return;
      const ancestors = new Set();
      let parent = carrierIndex;
      while (draft[parent] && !ancestors.has(parent)) {
        ancestors.add(parent);
        if (!draft[parent].preload) break;
        parent = draft[parent].preload.carrierIndex;
      }
      if (ancestors.has(detailIndex)) return;
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
          !Rules.hangarAllowsModel(h, model) ||
          others + (h.kind === "sfs" ? 1 : model.transport.slotCost) > h.capacity
        )
          continue;
        const option = new Option(
          `${cm.name} · ${hangarLabel(carrierIndex, h.id)} · ${I18n.text("剩余容量")} ${h.capacity - used}/${h.capacity}`,
          JSON.stringify({ carrierIndex, hangarId: h.id }),
        );
        option.setAttribute("data-i18n-ignore", "");
        option.dataset.hangarLabel = hangarLabel(carrierIndex, h.id);
        option.dataset.capacityLabel = `${I18n.text("剩余容量")} ${h.capacity - used}/${h.capacity}`;
        select.add(option);
      }
    });
    select.value = entry.preload ? JSON.stringify(entry.preload) : "";
    const atLimit =
      freeFormation() && detailIndex === null && points(draft) + compositionWeight(model) > unitLimit();
    select.disabled = select.options.length === 1 || atLimit;
    hint.textContent = atLimit
      ? "已达到编组单位点数上限。"
      : select.disabled
        ? "没有兼容且有剩余容量的格纳库。"
        : detailIndex === null
          ? "选择格纳库会将该单位加入编组并预先搭载。"
          : "可在格纳库间调整，或选择独立部署。";
  }

  function renderHangarProperties(model) {
    const container = byId("formationDetailHangars");
    container.replaceChildren();
    byId("formationDetailHangarsBlock").hidden = !model.hangars.length;
    for (const [number, hangar] of model.hangars.entries()) {
      const compatible = Rules.catalog.prefabs.filter(prefab =>
        !prefab.formOnly && Rules.hangarAllowsModel(hangar, prefab));
      const kinds = [...new Set(compatible.flatMap(prefab => prefab.unitTags.slice(0, 1)))];
      const section = element("section", "unit-reference-hangar");
      section.append(element("h4", "", hangar.kind === "sfs" ? "SFS" : I18n.text("格纳库") + " " + (number + 1)));
      const row = element("dl", "unit-detail-metrics");
      detailMetrics(row, [
        ["容量点", hangar.capacity],
        ["可搭载类型", kinds.map(Rules.unitTagName).join(" / ")],
      ]);
      section.append(row);
      container.append(section);
    }
  }
  // 按实际部件与持握武器渲染静态精灵，再以整体边界适配预览窗口。
  function detailMetrics(container, entries) {
    container.replaceChildren();
    for (const [label, value] of entries) {
      container.append(element("dt", "", I18n.text(label)), element("dd", "", String(value)));
    }
  }
  const boardingPicker = element("dialog", "formation-boarding-dialog");
  boardingPicker.id = "formationBoardingDialog";
  document.body.append(boardingPicker);
  function openBoarding(index) {
    const entry = draft[index];
    if (!entry) return;
    const previous = detailIndex;
    detailIndex = index;
    renderCarrierChoice(entry, Rules.formationModel(entry));
    const options = [...byId("formationDetailCarrier").options].map((o) => ({
      value: o.value,
      text: o.text,
      hangar: o.dataset.hangarLabel,
      capacity: o.dataset.capacityLabel,
    }));
    detailIndex = previous;
    let choice = entry.preload ? JSON.stringify(entry.preload) : "";
    const title = element("h3", "", I18n.text("搭乘") + " · " + Rules.formationModel(entry).name),
      list = element("div", "formation-boarding-options"),
      footer = element("footer"),
      close = element("button", "", "关闭"),
      confirm = element("button", "", "搭乘");
    close.onclick = () => boardingPicker.close();
    const carriers = new Map();
    for (const option of options) {
      const button = element("button", "formation-boarding-option");
      button.dataset.carrierChoice = option.value;
      button.setAttribute("aria-pressed", String(option.value === choice));
      let container = list;
      if (option.value) {
        const { carrierIndex } = JSON.parse(option.value);
        if (!carriers.has(carrierIndex)) {
          const carrier = draft[carrierIndex],
            group = element("section", "formation-boarding-carrier"),
            heading = element("h4", "formation-boarding-carrier-heading"),
            image = element("img");
          group.dataset.carrierIndex = carrierIndex;
          image.src = unitIcon(Rules.formationModelId(carrier), carrier.customPilot);
          image.alt = "";
          heading.append(
            image,
            element("span", "", `${carrierIndex + 1}. ${Rules.formationModel(carrier).name}`),
          );
          group.append(heading);
          list.append(group);
          carriers.set(carrierIndex, group);
        }
        container = carriers.get(carrierIndex);
        button.append(
          element("span", "", option.hangar),
          element("small", "muted", option.capacity),
        );
      } else button.textContent = option.text;
      button.onclick = () => {
        choice = option.value;
        for (const row of list.querySelectorAll("[data-carrier-choice]"))
          row.setAttribute("aria-pressed", String(row === button));
        confirm.textContent = I18n.text(choice ? "搭乘" : "独立部署");
      };
      container.append(button);
    }
    confirm.onclick = () => {
      try {
        const next = { ...draft[index] };
        if (choice) next.preload = JSON.parse(choice);
        else delete next.preload;
        Rules.validateFleetFormation(
          draft.map((e, i) => (i === index ? next : e)),
          Infinity,
          Rules.catalog.formation.maxUnits,
        );
        draft[index] = next;
        GameAudio.play("changeEquipmentSound");
        boardingPicker.close();
        render();
      } catch (error) {
        note(error.message);
      }
    };
    footer.append(close, confirm);
    boardingPicker.replaceChildren(title, list, footer);
    boardingPicker.showModal();
  }
  window.addEventListener("page-changing", () => boardingPicker.close());
  function openKitPicker(index) {
    const entry = draft[index];
    if (!entry) return;
    const prefab = Rules.catalog.prefabs.find((unit) => unit.id === entry.unitId);
    const dialog = element("dialog", "formation-kit-dialog");
    dialog.append(element("h3", "", "切换套件 · " + Rules.formationModel(entry).name));
    const list = element("div", "formation-kit-options");
    for (const kit of prefab.weaponKits) {
      const button = element(
        "button",
        kit.id === entry.kitId ? "selected" : "",
        kit.name + " · COST " + (prefab.stats.cost + kit.cost),
      );
      button.dataset.kitId = kit.id;
      button.setAttribute("aria-pressed", String(kit.id === entry.kitId));
      button.onclick = () => {
        try {
          const next = draft.map((unit, i) => (i === index ? { ...unit, kitId: kit.id } : unit));
          Rules.validateFleetFormation(next, Infinity, Rules.catalog.formation.maxUnits);
          if (entry.stockId) Economy.changeStoredKit(entry.stockId, kit.id);
          draft[index] = next[index];
          GameAudio.play("changeEquipmentSound");
          dialog.close();
          render();
        } catch (error) {
          note(error.message);
        }
      };
      list.append(button);
    }
    const close = element("button", "", "关闭");
    close.onclick = () => dialog.close();
    dialog.append(list, close);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
  }
  function pilotButtonText(button, prefix, entry, model) {
    const name = entry.customPilot?.hired ? I18n.pilotName(entry.customPilot) :
      entry.customPilot?.name || PilotSystem.defaultName(model);
    button.classList.add("formation-pilot-button");
    button.textContent = prefix + " · " + name;
    if (entry.customPilot && !entry.customPilot.hired) button.setAttribute("data-i18n-ignore", "");
    else button.removeAttribute("data-i18n-ignore");
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
    byId("formationDetailTitle").textContent = model.name;
    byId("formationDetailTitle").append(UnitPreview.roleIcon(model));
    byId("formationCatalogCost").textContent = model.cost + "C";
    byId("formationDetailTags").replaceChildren(unitTags(model, { limit: Infinity }));
    byId("formationInventorySale")?.remove();
    const pilotButton = byId("formationDetailPilot");
    pilotButton.hidden = true;
    pilotButtonText(pilotButton, "配属驾驶员", originalEntry, model);
    const previewCanvas = byId("formationDetailPreview");
    previewCanvas.dataset.cardZoom = String(UnitPreview.storageScale(model));
    renderPreview(entry.unitId + "__" + entry.kitId, previewCanvas, 180, "card");
    renderHangarProperties(model);
    renderCarrierChoice(entry, model);
    byId("formationDetailCarrierField").hidden = true;
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
    byId("openSpecialTransforms").hidden = !!previewModel || !equipmentPrefab.pilotForms?.length;

    const skillUnit = originalEntry.customPilot ? {
      model: entry.unitId + "__" + entry.kitId,
      pilot: originalEntry.customPilot,
      plugins: originalEntry.plugins,
    } : null;
    byId("formationDetailAttributes").replaceChildren(UnitPreview.attributePages(model, "formation", skillUnit));
    const weapons = byId("formationDetailSlots");
    weapons.replaceChildren();
    for (const weapon of model.weapons)
      weapons.append(WeaponInfo.card(weapon, null, { encyclopediaLink: true, unit: skillUnit }));
    if (model.movementType === "air")
      byId("formationDetailMovement").append(element("p", "helper", "空军：可跨越山岩和水域"));
    // Portal above fixed page containers so the preview is never clipped by a page.
    document.body.append(byId("formationUnitDetail"));
    byId("formationUnitDetail").hidden = false;
    byId("formationMain").inert = true;
    window.dispatchEvent(
      new CustomEvent("unit-preview-rendered", { detail: { id: entry.unitId } }),
    );
  }
  function environmentLabel(adaptability) {
    return ["ground", "space"]
      .filter((environment) => (adaptability?.[environment] ?? 100) >= 100)
      .map((environment) => I18n.text(environment === "ground" ? "地面" : "宇宙"))
      .join("/");
  }

  function saveDraft() {
    if (pageView !== "formation") return;
    const units = draft.length
      ? Rules.validateFleetFormation(draft, Infinity, Rules.catalog.formation.maxUnits)
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
  function unitStatusBadge(unitId) {
    const status = !Development.allows(group, unitId)
      ? "未开发"
      : !Economy.hasLicense(unitId)
        ? "未许可"
        : null;
    return status ? element("small", "unit-undeveloped", status) : null;
  }
  function appendStoredUnitBadges(portrait, item, pilot) {
    const statuses = element("span", "formation-stock-badges");
    if (item && Economy.isContactLoan(item))
      statuses.append(element("span", "formation-task-badge", "任务"));
    if (item?.rentalUses) {
      const rental = element("span", "catalog-rental-badge", I18n.text("租赁") + " " + item.rentalUses);
      rental.title = I18n.text("剩余次数:{count}次").replace("{count}", item.rentalUses);
      statuses.append(rental);
    }
    if (statuses.childElementCount) portrait.append(statuses);
    if (!pilot) return;
    const badge = element("span", "catalog-pilot-badge"), avatar = element("img");
    badge.title = I18n.text("驾驶员") + " · " + I18n.pilotName(pilot);
    badge.setAttribute("role", "img");
    badge.setAttribute("aria-label", badge.title);
    badge.dataset.pilotId = pilot.id;
    avatar.src = PilotSystem.portrait(pilot); avatar.alt = "";
    badge.append(avatar); portrait.append(badge);
  }
  function render() {
    saveDraft();
    byId("formationEditorStyle").value = freeFormation() ? "free" : "standard";
    byId("formationEditorStyle").disabled = !!Net.active;
    if (byId("formationMain").dataset.page !== "pilots")
      byId("formationPageTitle").textContent = I18n.text(freeFormation() ? "自由编组" : "常规编组");
    byId("openFormationPicker").textContent = freeFormation() ? "添加单位" : "添加战舰或运输机";
    byId("formationGroup").disabled = Net.active && Net.snapshot?.settings?.mode === "quick";
    const draftPoints = points(draft);
    byId("formationBudget").replaceChildren(
      element(
        "span",
        "",
        I18n.text("编组COST") +
          ": " +
          cost(draft) +
          " / " +
          displayLimit(budget()) +
          "\u00a0·\u00a0",
      ),
      element("span", "", I18n.text(freeFormation() ? "单位容量点" : "舰船数量") + ": " + draftPoints + " / " + unitLimit()),
    );
    byId("formationBudget").title = byId("formationBudget").textContent;
    byId("formationBudget").classList.toggle(
      "danger-text",
      draftPoints > unitLimit() || cost(draft) > budget(),
    );
    byId("addFormationUnit").disabled =
      draftPoints + pickerWeight() > unitLimit() ||
      !byId("formationPrefab").value ||
      !canAddUnit(Rules.catalog.prefabs.find((p) => p.id === byId("formationPrefab").value));
    byId("openFormationPicker").disabled = draftPoints >= unitLimit();
    renderPickerCost();
    const plan = draft.length
      ? Rules.planFormation(draft, budget(), restrictions(), unitLimit())
      : { disabled: [] };
    const shortagePlan = Economy.purchasePlan(draft);
    byId("produceMissingFormation").hidden =
      byId("formationMain").dataset.page === "pilots" || !shortagePlan.items.length;
    byId("produceMissingFormation").classList.toggle(
      "inventory-attention",
      !!shortagePlan.items.length,
    );
    const storedById = new Map([...Economy.snapshot().storage.units, ...Economy.snapshot().storage.ships].map(item=>[item.id,item]));
    const list = byId("formationUnits"),
      scrollTop = list.scrollTop;
    list.replaceChildren();
    // 仅调整显示顺序，保留保存序号、搭载引用和 OVER COST 的末尾优先规则。
    const displayOrder = [],
      visited = new Set(),
      cargoByHangar = new Map(),
      transportRoots = new Map();
    draft.forEach((entry, i) => {
      if (!entry.preload) return;
      const key = entry.preload.carrierIndex + "/" + entry.preload.hangarId;
      if (!cargoByHangar.has(key)) cargoByHangar.set(key, []);
      cargoByHangar.get(key).push(i);
    });
    function appendCargo(i, root = i) {
      if (visited.has(i)) return;
      visited.add(i);
      displayOrder.push(i);
      transportRoots.set(i, root);
      for (const h of Rules.formationModel(draft[i]).hangars || [])
        for (const j of cargoByHangar.get(i + "/" + h.id) || []) appendCargo(j, root);
    }
    draft.forEach((entry, i) => {
      if (!entry.preload) appendCargo(i);
    });
    const loadedRoots = new Set(
      displayOrder.filter((i) => draft[i].preload).map((i) => transportRoots.get(i)),
    );
    displayOrder.forEach((i) => {
      const entry = draft[i];
      const row = element(
          "div",
          "formation-row" + (entry.preload ? " formation-preloaded-row" : ""),
        ),
        model = Rules.formationModel(entry),
        stored = storedById.get(entry.stockId),
        condition = stored && Warehouse.status(stored, UnitModels[stored.unitId + "__" + stored.kitId]);
      row.dataset.formationIndex = String(i);
      if (loadedRoots.has(transportRoots.get(i)))
        row.dataset.transportGroup = String(transportRoots.get(i));
      if (entry.preload) row.dataset.carrierIndex = String(entry.preload.carrierIndex);
      const show = () => {
        GameAudio.selectUnit(model);
        openStoredPreview(entry.stockId);
      };
      const details = element("button", "formation-detail-button", "详情");
      details.setAttribute("aria-haspopup", "dialog");
      details.dataset.buttonSound = "off";
      details.onclick = show;
      const icon = element("span", "formation-icon"),
        image = element("img");
      image.src = unitIcon(Rules.formationModelId(entry), entry.customPilot);
      image.width = 56;
      image.alt = model.name;
      icon.append(image);
      appendStoredUnitBadges(icon, stored, entry.customPilot || (stored && storedPilot(stored)));
      const portrait = element("span", "formation-unit-portrait");
      portrait.append(icon);
      const reason = condition === "destroyed" ? "destroyed" : exceedsTechnology(model) ? "technology_limit" : plan.reasons[i];
      row.classList.toggle("technology-limited", reason === "technology_limit");
      if (reason === "faction_mismatch") row.classList.add("faction-mismatch");
      if ((plan.disabled.includes(i) || ["technology_limit","destroyed"].includes(reason)) && reason !== "not_developed") {
        row.classList.add(
          "unit-disabled",
          ["not_allowed", "not_developed", "wip", "technology_limit", "destroyed"].includes(reason)
            ? "not-allowed"
            : "overcost",
        );
        row.append(
          element("span", "disabled-panel"),
          element(
            "span",
            "overcost-label",
            reason === "destroyed" ? "完全损毁" : reason === "pilot_banned"
              ? "驾驶员被禁用，请解除配属"
              : reason === "stock"
                ? "机体库存不足"
                : reason === "license"
                  ? "未许可"
                  : reason === "wip"
                    ? "WIP"
                    : reason === "faction_mismatch"
                      ? "阵营不匹配"
                      : ["pilot_faction", "pilot_required"].includes(reason)
                        ? "驾驶员配属条件不满足"
                        : reason === "not_developed"
                          ? "尚未开发"
                          : reason === "count"
                            ? "超过单位点数"
                            : reason === "not_allowed"
                              ? "不被允许的单位"
                              : {
                                  technology_limit: "超出科技点",
                                  not_embarked: "必须预先搭载",
                                  carrier_disabled: "运输单位无法出击",
                                }[reason] || "OVER COST",
          ),
        );
      }
      const label = element("span", "formation-unit-name");
      const prefab = Rules.catalog.prefabs.find((p) => p.id === entry.unitId),
        kit = prefab.weaponKits.find((k) => k.id === entry.kitId);
      const metadata = element("span", "unit-line-meta");
      metadata.append(unitTags(model, { cost: model.cost, kitName: model.kitName, twoRows: true }));
      label.title = model.description || "";
      const unitName=element("strong", "", `${i + 1}. ${model.name}`);
      unitName.append(UnitPreview.roleIcon(model));label.append(unitName, metadata);
      if (condition && condition !== "healthy") {
        row.dataset.condition = condition;
        label.append(element("span", "warehouse-condition " + condition, condition === "destroyed" ? "完全损毁" : "需要修理"));
      }
      const remove = element("button", "danger", "移除");

      remove.onclick = (event) => {
        event.stopPropagation();
        closeDetail();
        removeEntry(i);
        render();
      };
      const actions = element("div", "formation-row-actions");
      const stockLine = element("span", "formation-stock-line");
      const status = unitStatusBadge(entry.unitId);
      if (status) portrait.append(status);
      if (entry.preload) {
        const carrier = draft[entry.preload.carrierIndex],
          note = element("small", "formation-cargo-note"),
          destination =
            Rules.formationModel(carrier).name +
            " · " +
            hangarLabel(entry.preload.carrierIndex, entry.preload.hangarId);
        note.append(
          element("span", "formation-preload-badge", "预先搭载"),
          element("span", "formation-cargo-destination", destination),
        );
        note.title = I18n.text("预先搭载") + " · " + destination;
        stockLine.append(note);
      }
      if (condition !== "destroyed" && ["license", "stock"].includes(plan.reasons[i])) {
        row.classList.add("inventory-shortage");
        const produce = element("button", "produce-shortage-unit", "前往生产");
        produce.type = "button";
        produce.onclick = () => openProduction(entry.unitId);
        const prompt = element("div", "inventory-shortage-prompt");
        prompt.append(
          element(
            "span",
            "",
            plan.reasons[i] === "license"
              ? "未许可"
              : plan.reasons[i] === "pilot_banned"
                ? "驾驶员被禁用，请解除配属"
                : plan.reasons[i] === "stock"
                  ? "机体库存不足"
                  : "机体库存不足",
          ),
          produce,
        );
        row.querySelector(":scope > .overcost-label")?.remove();
        row.append(prompt);
      }
      const board = element("button", "formation-board-button", entry.preload ? "搭乘中" : "搭乘");
      board.dataset.boardFormation = String(i);
      board.setAttribute("aria-pressed", String(!!entry.preload));
      board.onclick = () => openBoarding(i);
      const kitButton = element("button", "formation-kit-button", "切换套件");
      kitButton.onclick = () => openKitPicker(i);
      const forms = NormalForms.options(ART, entry.unitId);
      const transform = element("button", "formation-transform-button", "变形");
      transform.hidden = !forms.length;
      transform.onclick = async () => {
        const dialog = document.createElement("dialog");
        dialog.className = "game-dialog";
        dialog.append(element("h3", "", "选择机库形态"));
        for (const form of forms) {
          const target = ART.prefabs.find((p) => p.id === form.unitId),
            button = element("button", "", target.name);
          button.onclick = () => {
            try {
              const next = { ...entry, unitId: target.id, kitId: NormalForms.kit(ART, entry.unitId, target.id, entry.kitId, Economy.defaultKit(target.id)) };
              const preview = draft.map((e, j) => (j === i ? next : e));
              Rules.validateFleetFormation(preview, Infinity, Rules.catalog.formation.maxUnits);
              Economy.transformStock(entry.unitId, target.id, entry.stockId);
              draft[i] = next;
              saveDraft();
              render();
              dialog.close();
              dialog.remove();
            } catch (error) {
              GameDialog.alert(error.message);
            }
          };
          dialog.append(button);
        }
        const close = element("button", "", "取消");
        close.onclick = () => {
          dialog.close();
          dialog.remove();
        };
        dialog.append(close);
        document.body.append(dialog);
        dialog.showModal();
      };
      actions.append(details, kitButton, transform, board, remove);
      if (stockLine.childNodes.length) label.append(stockLine);
      row.append(portrait, label, actions);
      list.append(row);
    });
    renderFleetHangars(list, storedById);
    list.scrollTop = scrollTop;
    if (transportFrameList !== list) {
      transportFrameObserver.disconnect();
      transportFrameObserver.observe(list);
      transportFrameList = list;
    }
    scheduleTransportFrames();
  }
  function renderFleetHangars(list, storedById) {
    if (freeFormation() && !draft.some(entry => Rules.formationModel(entry).hangars?.length)) {
      carrierPage = null;
      list.classList.remove("formation-carrier-view", "formation-cargo-page");
      return;
    }
    list.classList.add("formation-carrier-view");
    const cards = new Map(
      [...list.querySelectorAll("[data-formation-index]")].map((row) => [
        Number(row.dataset.formationIndex),
        row,
      ]),
    );
    const visited = new Set(),
      fragment = document.createDocumentFragment();
    function appendCarrier(index, parent) {
      if (visited.has(index)) return;
      visited.add(index);
      parent.append(cards.get(index));
      const model = Rules.formationModel(draft[index]);
      for (const h of model.hangars) {
        const hangar = element("section", "formation-hangar-card");
        hangar.dataset.hangarCarrier = String(index);
        hangar.dataset.hangarId = h.id;
        const cargo = draft
          .map((entry, i) => ({ entry, i }))
          .filter(({ entry }) => preloadMatches(entry, index, h.id));
        const used = cargo.reduce(
          (n, { entry }) =>
            n + (h.kind === "sfs" ? 1 : Rules.formationModel(entry).transport.slotCost || 1),
          0,
        );
        hangar.append(
          element(
            "h3",
            "formation-hangar-title",
            `${hangarLabel(index, h.id)} · ${used} / ${h.capacity} ${I18n.text("容量点")}`,
          ),
        );
        for (const { i } of cargo) appendCarrier(i, hangar);
        if (used < h.capacity) {
          const add = element("button", "formation-empty-slot");
          add.type = "button";
          add.dataset.addHangarCarrier = String(index);
          add.dataset.addHangarId = h.id;
          add.setAttribute(
            "aria-label",
            `${model.name} · ${hangarLabel(index, h.id)} · ${I18n.text("预先搭载")}`,
          );
          const portrait = element("span", "formation-empty-portrait", "＋");
          portrait.setAttribute("aria-hidden", "true");
          const text = element("span", "formation-empty-label");
          text.append(
            element("strong", "", "选择预先搭载单位"),
            element("small", "", `${I18n.text("剩余容量")} ${h.capacity - used}`),
          );
          add.append(portrait, text);
          add.disabled = freeFormation() && points(draft) >= unitLimit();
          add.onclick = () => openPicker({ carrierIndex: index, hangarId: h.id }, true);
          hangar.append(add);
        }
        parent.append(hangar);
      }
    }
    const openCarrier = (i, targetIndex = null) => {
      carrierPage = i; render(); list.scrollTop = 0;
      const target = targetIndex === null ? null : list.querySelector(`[data-formation-index="${targetIndex}"]`);
      if (target) {
        target.tabIndex = -1;
        target.classList.add("formation-cargo-located");
        target.focus({preventScroll:true});
        target.scrollIntoView({block:"center",inline:"nearest"});
      } else byId("formationCargoBack")?.focus();
    };
    function descendants(index, seen = new Set([index])) {
      const result = [];
      draft.forEach((entry, i) => {
        if (entry.preload?.carrierIndex !== index || seen.has(i)) return;
        seen.add(i); result.push(i, ...descendants(i, seen));
      });
      return result;
    }
    list.classList.toggle("formation-cargo-page", carrierPage !== null && !!draft[carrierPage]);
    if (carrierPage !== null && draft[carrierPage]) {
      const heading = element("div", "formation-cargo-heading"),
        back = element("button", "", "返回编组");
      back.id = "formationCargoBack";
      back.onclick = () => { const i = carrierPage; carrierPage = null; render(); list.querySelector(`[data-manage-cargo="${i}"]`)?.focus(); };
      heading.append(back, element("h3", "", Rules.formationModel(draft[carrierPage]).name + " · 预先搭载"));
      fragment.append(heading);
      const group = element("section", "formation-carrier-group");
      group.dataset.fleetCarrier = String(carrierPage);
      appendCarrier(carrierPage, group);
      fragment.append(group);
      list.replaceChildren(fragment);
      return;
    }
    carrierPage = null;
    draft.forEach((entry, i) => {
      const model = Rules.formationModel(entry);
      if (entry.preload || !model.hangars?.length) return;
      const group = element("section", "formation-carrier-group formation-carrier-summary"), row = cards.get(i),
        cargo = descendants(i), manage = element("button", "formation-manage-cargo", "预先搭载"),
        strip = element("div", "formation-cargo-portraits");
      group.dataset.fleetCarrier = String(i);
      visited.add(i); cargo.forEach(j => visited.add(j));
      manage.dataset.manageCargo = String(i);
      manage.onclick = () => openCarrier(i);
      row.querySelector(".formation-row-actions").prepend(manage);
      const total = element("strong", "formation-carrier-total", `总 COST ${cost([entry, ...cargo.map(j => draft[j])])}`);
      total.title = "含载具、全部搭载单位及驾驶员";
      row.querySelector(".formation-unit-name").append(total);
      strip.setAttribute("aria-label", "搭载单位");
      for (const j of cargo) {
        const passenger = draft[j], unit = Rules.formationModel(passenger),
          button = element("button", "formation-cargo-avatar"), image = element("img"), pilot = element("img");
        button.dataset.cargoIndex = String(j);
        const pilotName = passenger.customPilot?.name || PilotSystem.defaultName(unit);
        button.title = `${j + 1}. ${unit.name} · ${pilotName}`;
        button.setAttribute("aria-label", button.title);
        image.src = unitIcon(Rules.formationModelId(passenger), passenger.customPilot); image.alt = unit.name;
        pilot.src = PilotSystem.portrait(passenger.customPilot || { faction: unit.faction });
        pilot.alt = pilotName; pilot.className = "formation-cargo-pilot";
        button.append(image, pilot, element("small", "", String(j + 1)));
        appendStoredUnitBadges(button, storedById.get(passenger.stockId));
        button.onclick = () => openCarrier(i, j);
        strip.append(button);
      }
      for (const carrierIndex of [i, ...cargo]) {
        const carrierModel = Rules.formationModel(draft[carrierIndex]);
        for (const hangar of carrierModel.hangars || []) {
          const used = draft.filter(e => preloadMatches(e, carrierIndex, hangar.id))
            .reduce((sum, e) => sum + (hangar.kind === "sfs" ? 1 : Rules.formationModel(e).transport.slotCost || 1), 0);
          const remaining = Math.max(0, Math.floor(hangar.capacity - used));
          for (let slot = 0; slot < remaining; slot++) {
            const empty = element("button", "formation-cargo-avatar formation-cargo-empty-slot", "＋");
            empty.dataset.emptyCarrier = String(carrierIndex);
            empty.dataset.emptyHangar = hangar.id;
            empty.title = `${carrierModel.name} · ${hangarLabel(carrierIndex, hangar.id)} · 空位 ${slot + 1} · 添加预先搭载单位`;
            empty.setAttribute("aria-label", empty.title);
            empty.onclick = () => {
              openCarrier(i, carrierIndex);
              openPicker({carrierIndex, hangarId:hangar.id}, true);
            };
            strip.append(empty);
          }
        }
      }
      group.append(row, strip); fragment.append(group);
    });
    if (visited.size < draft.length) {
      const remaining = element("section", "formation-unassigned");
      remaining.append(element("h3", "formation-hangar-title", "未搭载单位"));
      draft.forEach((entry, i) => {
        if (!visited.has(i)) appendCarrier(i, remaining);
      });
      fragment.append(remaining);
    }
    if (!draft.length)
      fragment.append(
        element("p", "formation-fleet-empty", "请先选择战舰、运输机或MA，再配置格纳库。"),
      );
    list.replaceChildren(fragment);
  }
  // Draw only the perimeter of each carrier group. An overlay preserves the
  // roster grid and its original indices, including groups wrapping between columns.
  let transportFrameRequest = 0;
  const transportFrameObserver = new ResizeObserver(scheduleTransportFrames);
  let transportFrameList = null;
  function scheduleTransportFrames() {
    if (transportFrameRequest) return;
    transportFrameRequest = requestAnimationFrame(() => {
      transportFrameRequest = 0;
      drawTransportFrames();
    });
  }
  function drawTransportFrames() {
    const list = byId("formationUnits");
    list.querySelector(".formation-transport-frames")?.remove();
    if (list.classList.contains("formation-carrier-view")) return;
    if (!list.clientWidth || !list.clientHeight) return;
    const rows = [...list.querySelectorAll(":scope > .formation-row")];
    if (!rows.length) return;
    const bounds = list.getBoundingClientRect();
    const cells = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        group: row.dataset.transportGroup,
        left: rect.left - bounds.left - list.clientLeft + list.scrollLeft,
        top: rect.top - bounds.top - list.clientTop + list.scrollTop,
        right: rect.right - bounds.left - list.clientLeft + list.scrollLeft,
        bottom: rect.bottom - bounds.top - list.clientTop + list.scrollTop,
      };
    });
    const columns = cells.length > 1 && Math.abs(cells[0].top - cells[1].top) < 1 ? 2 : 1;
    const style = getComputedStyle(list);
    const gapX = (parseFloat(style.columnGap) || 0) / 2;
    const gapY = (parseFloat(style.rowGap) || 0) / 2;
    const minX = Math.min(...cells.map((c) => c.left)) + 1;
    const maxX = Math.max(...cells.map((c) => c.right)) - 1;
    const minY = cells[0].top + 1;
    const maxY = Math.max(...cells.map((c) => c.bottom)) - 1;
    const paths = new Map();
    cells.forEach((cell, i) => {
      if (cell.group === undefined) return;
      const same = (j) => cells[j]?.group === cell.group;
      const left = Math.max(minX, cell.left - gapX);
      const right = Math.min(maxX, cell.right + gapX);
      const top = Math.max(minY, cell.top - gapY);
      const bottom = Math.min(maxY, cell.bottom + gapY);
      const edges = paths.get(cell.group) || [];
      if (!same(i - columns)) edges.push(`M${left},${top}H${right}`);
      else if (columns === 1) {
        // Indented cargo shifts the left perimeter; connect the step at the shared edge.
        const previousLeft = Math.max(minX, cells[i - 1].left - gapX);
        const previousRight = Math.min(maxX, cells[i - 1].right + gapX);
        if (Math.abs(previousLeft - left) > 0.5) edges.push(`M${previousLeft},${top}H${left}`);
        if (Math.abs(previousRight - right) > 0.5) edges.push(`M${previousRight},${top}H${right}`);
      }
      if (!same(i + columns)) edges.push(`M${left},${bottom}H${right}`);
      if (i % columns === 0 || !same(i - 1)) edges.push(`M${left},${top}V${bottom}`);
      if (i % columns === columns - 1 || !same(i + 1)) edges.push(`M${right},${top}V${bottom}`);
      paths.set(cell.group, edges);
    });
    if (!paths.size) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("formation-transport-frames");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", String(list.clientWidth));
    svg.setAttribute("height", String(maxY + 1));
    for (const [group, edges] of paths) {
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.dataset.transportGroup = group;
      path.setAttribute("d", edges.join(""));
      svg.append(path);
    }
    list.append(svg);
  }
  let pilotFromPreload = false;
  function closePilot() {
    if (pilotIndex === null) return;
    const index = pilotIndex;
    pilotIndex = null;
    byId("formationPilotPanel").hidden = true;
    byId("formationUnitDetail").inert = false;
    byId("formationMain").inert = !byId("formationUnitDetail").hidden;
    if (!byId("formationUnitDetail").hidden) {
      const target = pilotFromPreload
        ? byId("formationDetailHangars").querySelector(`[data-preload-pilot="${index}"]`)
        : byId("formationDetailPilot");
      (target || byId("formationDetailPilot")).focus();
    } else
      byId("formationUnits")
        .querySelector('[data-formation-index="' + index + '"] .formation-detail-button')
        ?.focus();
  }
  function openPilot(index, fromPreload = false) {
    if (!draft[index]) return;
    pilotFromPreload = fromPreload;
    document.body.append(byId("formationPilotPanel"));
    pilotIndex = index;
    const entry = draft[index],
      model = Rules.formationModel(entry),
      list = byId("formationPilotList");
    byId("formationPilotTitle").textContent = "驾驶员配属 · " + model.name;
    list.replaceChildren();
    const command = PilotSystem.commandUnit(model);
    const available = activePilots().filter(
      (p) =>
        PilotSystem.canAssign(p, group) &&
        PilotSystem.allowed(p, restrictions()),
    ).sort((a, b) => Number(!!a.ace) - Number(!!b.ace) ||
      (byId("formationPilotSort").value === "level" ? b.level - a.level : 0) ||
      I18n.pilotName(a).localeCompare(I18n.pilotName(b), I18n.language));
    const personalPilots = document.createDocumentFragment();
    const storedAssignments = [...Economy.snapshot().storage.units, ...Economy.snapshot().storage.ships];
    for (const profile of [PilotSystem.generalPMC("pmc-general-" + (entry.stockId || "formation-" + index), command), ...available]) {
      const id = profile?.id || null,
        selected = (entry.customPilot?.id || null) === id,
        card = element("div", "formation-pilot-card"),
        details = element("div"),
        choose = element("button", "", profile?.needsRecruitment ? "等待复归" : selected ? "已配属" : "配属");
      card.dataset.selected = String(selected);
      card.dataset.pilotKind = profile?.pmcGeneral ? "general" : profile ? (profile.ace ? "ace" : "custom") : "general";
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
      if (!profile || profile.pmcGeneral) details.querySelector("strong").append(pilotCostTag(null));
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
      if (profile && !profile.pmcGeneral) {
        const progress = element(
          "small",
          "pilot-roster-progress",
          `Lv.${profile.level} · ${pilotExperienceText(profile)}`,
        );
        progress.append(pilotCostTag(profile));
        details.append(progress, SkillControls.pilotSummary(profile));
      }
      for (const stored of storedAssignments.filter(item=>item.pilotId === id && item.id !== entry.stockId))
        details.append(element("small", "pilot-assignment-location", I18n.text("目前配属：{unit}").replace("{unit}",
          (stored.slot + 1) + ". " + I18n.text(UnitModels[stored.unitId + "__" + stored.kitId]?.name || stored.unitId))));
      choose.disabled = !!selected || !!profile?.needsRecruitment;
      card.classList.toggle("pilot-unavailable", !!profile?.needsRecruitment);
      choose.onclick = () => {
        if (profile?.needsRecruitment) return;
        let saved;
        try { saved = saveStoredPilot(entry, profile); } catch(error) { note(error.message); return; }
        if (saved) draft = hydratePilots(draft);
        else {
          if (id) for (const other of draft)
            if (other !== entry && other.customPilot?.id === id) delete other.customPilot;
          delete entry.pilotId;
          if (profile) entry.customPilot = structuredClone(profile);
          else delete entry.customPilot;
        }
        render();
        if (detailIndex !== null) renderDetail();
        closePilot();
      };
      card.append(portrait, details, choose);
      if (profile) personalPilots.append(card);
      else list.append(card);
    }
    list.append(personalPilots);
    byId("formationUnitDetail").inert = !byId("formationUnitDetail").hidden;
    byId("formationMain").inert = true;
    byId("formationPilotPanel").hidden = false;
    byId("closeFormationPilot").focus();
  }
  byId("formationPilotSort").onchange = () => {
    openPilot(pilotIndex, pilotFromPreload);
    byId("formationPilotSort").focus();
  };
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
        if (freeFormation() && points(draft) >= unitLimit()) throw Error("已达到编组单位点数上限。");
      }
      const entries =
        detailIndex === null
          ? [...draft, next]
          : draft.map((e, i) => (i === detailIndex ? next : e));
      Rules.validateFleetFormation(entries, Infinity, Rules.catalog.formation.maxUnits);
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
  function previewUnit(prefabId, trigger, options = {}) {
    const prefab = Rules.catalog.prefabs.find((item) => item.id === prefabId);
    if (!prefab) return false;
    detailFromPicker = false;
    detailFromDevelopment = true;
    developmentPreviewFocus = trigger || document.activeElement;
    externalPreviewReturn = typeof options.onClose === "function" ? options.onClose : null;
    detailIndex = null;
    catalogDetail = {
      unitId: prefabId,
      kitId: prefab.weaponKits.some((kit) => kit.id === options.kitId) ? options.kitId : Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id,
    };
    previewRoot = null;
    document.body.append(byId("formationUnitDetail"));
    byId("developmentMain").inert = true;
    renderDetail();
    byId("closeFormationDetail").focus();
    return true;
  }
  function open(tab = "units") {
    carrierPage = null;
    const pilotsOnly = tab === "pilots";
    if (!pilotsOnly && Net.active && Net.started && Net.snapshot?.loadedSave) {
      note("存档编组不可更改。");
      return;
    }
    if (!pilotsOnly && Net.active && Net.snapshot?.phase === "assembly" && !canEditRoom()) {
      note("确认阶段不可修改编组。");
      return;
    }
    if (!pilotsOnly && Net.active && Net.started && ownPlayer()?.formationPreset) {
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
    showFormationTab(pilotsOnly ? "pilots" : "units");
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
    carrierPage = null;
    closeDetail();
    index = Number(e.target.value);
    persist();
    byId("formationName").value = squads[index].name;
    draft = structuredClone(current());
    render();
  };
  byId("newFormation").onclick = () => {
    carrierPage = null;
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
    carrierPage = null;
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
  byId("formationEditorStyle").onchange = () => {
    editorStyle = byId("formationEditorStyle").value;
    localStorage.setItem("projectgreed.formation-editor-style", editorStyle);
    render();
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
    const stored = [...Economy.snapshot().storage.units, ...Economy.snapshot().storage.ships].find((item) => item.id === selectedStoredId && !item.destroyed);
    if (!stored || stored.unitId !== prefab.id || draft.some((entry) => entry.stockId === stored.id)) return note("出战库存不足");
    if (!canAddUnit(UnitPlugins.apply(UnitModels[stored.unitId+"__"+stored.kitId],stored.plugins))) return note("单位禁用，或与当前阵营不匹配。");
    if (points(draft) + pickerWeight() > unitLimit()) return note("已达到编组单位点数上限。");
    const entry = {
      unitId: prefab.id,
      kitId: stored.kitId,
      stockId: stored.id,
      plugins: stored.plugins,
      ...(storedPilot(stored) ? { customPilot: storedPilot(stored) } : {}),
      ...(pickerContext ? { preload: { ...pickerContext } } : {}),
    };
    try {
      Rules.validateFleetFormation([...draft, entry], Infinity, unitLimit());
    } catch (error) {
      note(error.message);
      return;
    }
    appendUnit(entry);
    saveDraft();
    render();
    byId("formationUnits").scrollTop = byId("formationUnits").scrollHeight;
    // Keep the hangar picker open and refresh its remaining capacity after each addition.
    renderCatalog();
    if (pickerContext) {
      if (pickerHangarFull()) note("格纳库已满");
    }
  };
  byId("formationSearch").oninput = () => {
    byId("formationCatalog").scrollTop = 0;
    renderCatalog();
  };
  byId("formationStock").onchange = () => renderCatalog();
  byId("formationSort").onchange = () => {
    byId("formationCatalog").scrollTop = 0;
    renderCatalog();
  };
  function selectCatalogUnit(prefab, card) {
    byId("formationPrefab").value = prefab.id;
    const previous = byId("formationCatalog").querySelector('[aria-selected="true"]');
    if (previous !== card) previous?.setAttribute("aria-selected", "false");
    card.setAttribute("aria-selected", "true");
    const stored = [...Economy.snapshot().storage.units,...Economy.snapshot().storage.ships].find(item=>item.id===selectedStoredId);
    byId("addFormationUnit").disabled =
      points(draft) + pickerWeight() > unitLimit() || !canAddUnit(stored?UnitPlugins.apply(UnitModels[stored.unitId+"__"+stored.kitId],stored.plugins):prefab);
    renderPickerCost();
  }
  function renderCatalog() {
    const list = byId("formationCatalog"), scroll = list.scrollTop,
      allowed = new Set(UnitCatalog.select(byId("formationSearch").value, catalogFilters, PlayerProfile.allows, true).map((prefab) => prefab.id)),
      prefabs = new Map(Rules.catalog.prefabs.map((prefab) => [prefab.id, prefab])),
      used = new Set(draft.map((entry) => entry.stockId).filter(Boolean)),
      storage = Economy.snapshot().storage,
      stored = [...storage.units.slice().sort((a,b)=>a.slot-b.slot), ...storage.ships.slice().sort((a,b)=>a.slot-b.slot)],
      order = new Map(stored.map((item,index)=>[item.id,index])), sort = byId("formationSort").value,
      items = stored.filter((item) => allowed.has(item.unitId) && pickerCompatible(prefabs.get(item.unitId)));
    if (sort !== "storage") items.sort((a,b)=>{
      const left=UnitPlugins.apply(UnitModels[a.unitId+"__"+a.kitId],a.plugins),right=UnitPlugins.apply(UnitModels[b.unitId+"__"+b.kitId],b.plugins);
      return (sort === "cost" ? left.cost-right.cost : left.name.localeCompare(right.name,"zh")) || order.get(a.id)-order.get(b.id);
    });
    byId("formationStock").closest("label").hidden = true;
    const usable = (item) => !item.destroyed && !used.has(item.id) && canAddUnit(UnitPlugins.apply(UnitModels[item.unitId + "__" + item.kitId],item.plugins));
    if (!items.some((item) => item.id === selectedStoredId && usable(item))) selectedStoredId = items.find(usable)?.id || null;
    const chosen = items.find((item) => item.id === selectedStoredId);
    byId("formationPrefab").value = chosen?.unitId || "";
    if (chosen) pickerKits.set(chosen.unitId, chosen.kitId);
    const rows = document.createDocumentFragment();
    for (const item of items) {
      const model = UnitPlugins.apply(UnitModels[item.unitId + "__" + item.kitId],item.plugins), card = element("div", "catalog-unit"),
        image = element("img"), info = element("span", "catalog-unit-info"), portrait = element("button", "catalog-unit-portrait"),
        row = element("div", "catalog-unit-row");
      portrait.type = "button";
      portrait.setAttribute("aria-label",I18n.text("查看单位详情")+" · "+model.name);
      portrait.onclick = event => { event.stopPropagation();openStoredPreview(item.id); };
      card.dataset.unitId = item.unitId;
      card.dataset.stockId = item.id;
      card.dataset.previewKit = item.kitId;
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", String(item.id === selectedStoredId));
      card.setAttribute("aria-disabled",String(!usable(item)));
      card.tabIndex = usable(item) ? 0 : -1;
      image.src = unitIcon(item.unitId + "__" + item.kitId);
      image.alt = model.name;
      portrait.append(image);
      const bound = draft.find(entry => entry.stockId === item.id),
        pilot = Object.hasOwn(item, "pilotId") ? storedPilot(item) :
          (bound?.customPilot && !bound.customPilot.hired ? bound.customPilot : null) || storedPilot(item);
      appendStoredUnitBadges(portrait, item, pilot);
      const tags = unitTags(model, { cost: model.cost, kitName: model.kitName, twoRows: true });
      for (const more of tags.querySelectorAll(".unit-tags-more")) more.remove();
      const storedName=element("strong", "", (item.slot + 1) + ". " + model.name);
      storedName.append(UnitPreview.roleIcon(model));
      info.append(storedName, tags,
        element("small", "", item.destroyed ? "完全损毁" : used.has(item.id) ? "已编入编组" : "HP " + formatNumber(item.hp) + " · EN " + formatNumber(item.en)));
      const condition = Warehouse.status(item,UnitModels[item.unitId + "__" + item.kitId]);
      if (condition !== "healthy") info.append(element("span", "warehouse-condition " + condition,
        condition === "destroyed" ? "完全损毁" : "需要修理"));
      card.append(portrait, info);
      card.onclick = () => { if (!usable(item)) return;selectedStoredId = item.id;renderCatalog(); };
      card.onkeydown = event => {
        if (event.target === card && ["Enter"," "].includes(event.key)) { event.preventDefault();card.click(); }
      };
      row.append(card);
      if (!usable(item)) {
        row.classList.add("unit-disabled");
        const reason = item.destroyed ? "完全损毁" : used.has(item.id) ? "已编入编组" : exceedsTechnology(model) ? "超出科技点" : "单位不符合房间规则";
        row.append(element("span", "disabled-panel"), element("span", "overcost-label", reason));
      }
      rows.append(row);
    }
    if (!items.length) rows.append(element("p", "empty", pickerHangarFull() ? "格纳库已满" : "没有符合筛选的库存单位"));
    list.replaceChildren(rows);
    list.scrollTop = scroll;
    catalogRenderKey = null;
    list.dataset.revision = String(++catalogRevision);
    byId("addFormationUnit").disabled = !chosen || points(draft) + pickerWeight() > unitLimit();
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
  const catalogChecks=UnitCatalog.checkboxFilters(byId("formationType"),catalogFilters,renderCatalog);
  window.addEventListener("language-change",catalogChecks.refresh);
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
        code = encodeShare(byId("formationName").value, draft, freeFormation() ? "free" : "standard");
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
      const { formationStyle, ...squad } = imported;
      squads.push(squad);
      index = squads.length - 1;
      draft = structuredClone(imported.units);
      byId("formationName").value = imported.name;
      const saved = persist();
      if (!Net.active) {
        editorStyle = formationStyle;
        try { localStorage.setItem("projectgreed.formation-editor-style", editorStyle); } catch {}
      }
      refreshSelect();
      render();
      closeShare(false);
      byId("formationSelect").focus();
      note(saved ? "分享编组已加载并保存。" : "分享编组已加载，但浏览器无法保存，请检查存储空间。");
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
        return unit ? unit.name : id;
      }),
      actions: choices.map(([label, id], value) => ({ label, id, value })),
    }).then((choice) => {
      if (choice !== null) choices[choice]?.[2]?.();
    });
  }
  async function replenish(entries, faction = group) {
    const plan = Economy.purchasePlan(entries);
    if (!plan.items.length) return true;
    const unavailable = plan.items.filter(
      (item) => !item.offer || !Development.allows(faction, item.unitId),
    );
    if (unavailable.length) {
      showLicenseDialog(
        "无法补充库存",
        "存在尚未开发或无法生产的单位，本次未扣费。",
        [...new Set(unavailable.map((item) => item.unitId))],
        [["确认", "acknowledgeUnavailableUnits"]],
      );
      return false;
    }
    const original = JSON.stringify(entries),
      originalGroup = group,
      originalIndex = index;
    const confirmed = await GameDialog.confirm("购买缺少的部署许可，并补充机体库存？", {
      title: "一键补充库存",
      items: [
        ...plan.items.map((item) => {
          const model = UnitModels[Economy.defaultModel(item.unitId)];
          return (
            (model?.name || item.unitId) +
            " · " +
            (item.kind === "licenses"
              ? "部署许可（赠送默认配置1台）"
              : item.kind === "inventory"
                ? "机体"
                : model?.kitName || "套件") +
            " ×" +
            item.count
          );
        }),
        "资金：" + formatNumber(plan.money),
        "物资：" + formatNumber(plan.supplies),
      ],
      confirmText: "确认购买",
    });
    if (!confirmed) return false;
    if (
      group !== originalGroup ||
      index !== originalIndex ||
      JSON.stringify(entries) !== original ||
      JSON.stringify(Economy.purchasePlan(entries)) !== JSON.stringify(plan)
    ) {
      note("编组或库存已变化，请重新确认。");
      return false;
    }
    try {
      const result = Economy.purchaseMissingStock(entries, faction);
      if (!result.ok) {
        note(result.reason === "funds" ? "资金或物资不足，未扣费。" : result.reason === "storage"
          ? "机库或船坞容量不足，无法补充库存，未扣费。" : "无法补充库存，未扣费。");
        return false;
      }
      note("已补充机体库存。");
      return true;
    } catch (error) {
      note("库存购买失败：" + Economy.errorMessage(error));
      return false;
    }
  }
  let reserveAcknowledgment = "";
  async function checkBattlefieldReserves(entries, proceed) {
    if (Net.snapshot?.settings.mode !== "battlefield") return proceed();
    const counts = new Map();
    for (const entry of entries) counts.set(entry.unitId, (counts.get(entry.unitId) || 0) + 1);
    const signature =
      (Net.snapshot?.matchId || Net.room || "") +
      JSON.stringify([...counts].map(([id, count]) => [id, count, Economy.quantity(id)]));
    if (signature === reserveAcknowledgment) return proceed();
    const missing = [...counts].filter(([id, count]) => Economy.quantity(id) - count < 2);
    if (
      missing.length &&
      !(await GameDialog.confirm("以下单位没有预备库存，确定要准备吗？", {
        title: "预备库存不足",
        items: missing.map(
          ([id, count]) =>
            (UnitModels[Economy.defaultModel(id)]?.name || id) +
            " · 出击 " +
            count +
            " · 备用 " +
            Math.max(0, Economy.quantity(id) - count),
        ),
        confirmText: "确定准备",
      }))
    )
      return;
    reserveAcknowledgment = signature;
    return proceed();
  }
  function checkLicenses(entries, proceed) {
    const stock = new Map([...Economy.snapshot().storage.units, ...Economy.snapshot().storage.ships].filter((item) => !item.destroyed).map((item) => [item.id, item]));
    if (entries.some((entry) => !entry.stockId || stock.get(entry.stockId)?.unitId !== entry.unitId || stock.get(entry.stockId)?.kitId !== entry.kitId)) {
      GameDialog.alert("编组包含不在格纳库中的单位，请重新编组。");
      return;
    }
    const originalProceed = proceed;
    proceed = () => checkBattlefieldReserves(entries, originalProceed);
    const quick = Net.snapshot?.settings.mode === "quick";
    if (
      quick
        ? !Economy.licensePlan(entries).items.length
        : !Economy.purchasePlan(entries).items.length
    )
      return proceed();
    showLicenseDialog(
      quick ? "部署许可不足" : "出战库存不足",
      quick
        ? "快速战可凭部署许可或完整机体库存出战。不满足条件的单位不会生成。"
        : "编组缺少机体库存。强制准备后，不足的单位不会生成。",
      [],
      [
        ["取消", "cancelMissingStock"],
        ["去往机库", "openStockWarehouse", () => open()],
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
        if (Net.active && !Net.awaiting && canEditRoom())
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
    if (Net.active && points(units) <= unitLimit() && canEditRoom())
      Net.request("update_formation", { formation: units });
    closeDetail();
    setPageView(returnView);
    update();
  };
  byId("openFormation").onclick = open;
  byId("roomFormation").onclick = open;
  byId("editFinalFormation").onclick = open;
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
      ],
      [
        ["参战次数", record.battles],
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
  function pilotSkillDescription(skill) {
    const nativeDescription=I18n.language==="zh"?skill.description:I18n.localized(skill,"description");
    return skill.owner==="pilot"?SkillControls.description(skill):skill.durationTurns
      ? nativeDescription.replace(/\d+(?:\.\d+)?\s*(?:sec(?:onds?)?\b|秒(?:間)?)/g,I18n.text(`${skill.durationTurns}回合`))
      : nativeDescription;
  }
  function renderAceInformation(container, profile) {
    container.replaceChildren();
    container.append(aceTags(profile));
    const growth = element(
      "p",
      "",
      `${I18n.text("悟性")} ${profile.comprehension} · ${I18n.text("最高等级")} ${profile.maxLevel}`,
    );
    growth.append(
      element(
        "span",
        "unit-summary-tag cost",
        `COST ${PilotSystem.aceBaseCost(profile)} + ${profile.costPerLevel}/Lv.`,
      ),
    );
    const description = element(
      "p",
      "ace-biography",
      I18n.language === "zh" ? profile.description : I18n.localized(profile, "description"),
    );
    description.dataset.i18nIgnore = "";
    container.append(growth, description, element("h3", "", "ACE技能"));
    for (const skill of profile.skills) {
      const skillDescription = pilotSkillDescription(skill);
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
    const owned = profile && pilotStore.pilots.find(p=>p.aceId===profile.id);
    if(owned?.needsRecruitment)return !Net.started;
    return (
      !!PilotSystem.recruitmentPrice(profile?.id) &&
      (owned || activePilots().filter(p=>p.ace).length < Economy.acePilotLimit()) &&
      Economy.canRecruitCrew("ace") &&
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
    const listScrollTop = aceList.scrollTop;
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
        SkillControls.pilotSummary({ aceId: profile.id }),
        aceTags(profile),
      );
      const portrait = element("span", "");
      portrait.append(img, element("small", "pilot-recruit-state", aceStatus(profile)));
      button.append(portrait, content);
      button.onclick = () => {
        selectedAce = profile.id;
        renderAceRecruitment();
        acePreview.scrollTop = 0;
      };
      aceList.append(button);
    }
    aceList.scrollTop = listScrollTop;
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
          `${I18n.text(label)} ${PilotSystem.aceStatValue(profile.baseStats[key], key)} → ${Math.round(PilotSystem.aceStatValue(profile.maxStats[key], key))}`,
        ),
      );
    acePreview.append(attributes);
    const owned = pilotStore.pilots.find((p) => p.aceId === profile.id);
    if (owned?.needsRecruitment)
      acePreview.append(element("p", "", "复归保留等级、经验、属性、技能和战绩。"));
    if (!Development.allows(group, profile.id) || !aceTechnology(profile).length) {
      const technologies = aceTechnology(profile);
      acePreview.append(
        element(
          "p",
          "ace-recruit-locked",
          technologies.length
            ? I18n.text("需要解锁科技：") + technologies.map((n) => n.name).join(" / ")
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
      if (!previous && activePilots().filter(p=>p.ace).length >= Economy.acePilotLimit()) return note("ACE驾驶员人数已达到士官学院上限");
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
    catalogRevision++;
    if (pageView === "formation") renderPilotRoster();
    if (aceRecruit.open) renderAceRecruitment();
  });
  window.addEventListener("economy-changed", () => {
    catalogRevision++;
    draft = hydratePilots(draft);
    squads = squads.map(s => ({ ...s, units: hydratePilots(s.units) }));
    if (aceRecruit.open) renderAceRecruitment();
  });
  function pilotCostTag(pilot, cost = PilotSystem.cost(pilot)) {
    return element(
      "span",
      "unit-summary-tag cost pilot-cost-tag",
      "COST " + cost,
    );
  }
  function pilotExperienceText(pilot) {
    return `EXP ${pilot.experience}/${pilot.level >= PilotSystem.maxLevel(pilot,Economy.academyLevel()) ? "MAX" : PilotSystem.experienceRequired(pilot.level, pilot)}`;
  }
  function populatePilotFilters() {
    const filter = byId("pilotRosterFilter"),
      selected = filter.value || "all";
    filter.replaceChildren(
      new Option(I18n.text("全部"), "all"),
      new Option(I18n.text("PMC驾驶员"), "custom"),
      ...Rules.factions.map(
        (faction) => new Option(PlayerProfile.displayFaction(faction), faction),
      ),
    );
    filter.value = selected;
  }
  populatePilotFilters();
  window.addEventListener("language-change", populatePilotFilters);
  let dormKind = "pmc", dormPage = 0, visiblePilotIds = [], revivalPending = false;
  const dormDepot = element("dialog","warehouse-dialog dorm-depot");
  dormDepot.id="dormStorageDialog";document.body.append(dormDepot);
  function showDormStorage(ace) {
    const title=ace?"ACE保管库":"PMC保管库",header=element("header"),close=element("button","","关闭"),body=element("div","warehouse-delivery-list");
    close.onclick=()=>dormDepot.close();header.append(element("h2","",title),close);dormDepot.replaceChildren(header,body);
    for(const pilot of pilotStore.pilots.filter(p=>p.inDormStorage&&!!p.ace===ace)){
      const row=element("article","warehouse-delivery-card"),portrait=element("img"),text=element("div"),accept=element("button","primary","接受");
      row.dataset.pilotId=pilot.id;portrait.src=PilotSystem.portrait(pilot);portrait.alt="";
      text.append(element("strong","",I18n.pilotName(pilot)),element("small","",`Lv${pilot.level} · ${PilotSystem.cost(pilot)}C`));
      accept.disabled=Net.started||activePilots().filter(p=>!!p.ace===ace).length>=(ace?Economy.acePilotLimit():Economy.customPilotLimit());
      accept.onclick=()=>{
        if(Net.started)return;
        const limit=ace?Economy.acePilotLimit():Economy.customPilotLimit();if(activePilots().filter(p=>!!p.ace===ace).length>=limit)return;
        delete pilot.inDormStorage;
        if(!savePilots()){pilot.inDormStorage=true;return;}
        renderPilotRoster();showDormStorage(ace);
      };
      const remove=element("button","danger","移除"),actions=element("div","warehouse-depot-actions");
      remove.disabled=Net.started;
      remove.onclick=async()=>{
        if(Net.started || remove.disabled)return;
        const signature=JSON.stringify(pilot);remove.disabled=true;
        try {
          if(!await GameDialog.confirm(I18n.text("确定移除保管库中的驾驶员「{name}」？此操作无法撤销。").replace("{name}",I18n.pilotName(pilot)),{title:I18n.text("移除驾驶员")}) || Net.started)return;
          const target=pilotStore.pilots.find(p=>p.id===pilot.id&&p.inDormStorage);
          if(!target || JSON.stringify(target)!==signature)throw Error("保管库内容已变化，请重新确认");
          const previous=pilotStore;
          pilotStore={...pilotStore,pilots:pilotStore.pilots.filter(p=>p.id!==pilot.id)};
          if(!savePilots()){pilotStore=previous;return;}
          draft=hydratePilots(draft);squads=squads.map(s=>({...s,units:hydratePilots(s.units)}));persist();
          renderPilotRoster();showDormStorage(ace);
        } catch(error){note(error.message);}
        finally {remove.disabled=Net.started;}
      };
      actions.append(accept);if(!ace)actions.append(remove);row.append(portrait,text,actions);body.append(row);
    }
    if(!body.children.length)body.append(element("p","muted","保管库为空"));
    if(!dormDepot.open)dormDepot.showModal();
  }
  byId("dormPMCStorage").onclick=()=>showDormStorage(false);
  byId("dormACEStorage").onclick=()=>showDormStorage(true);
  window.addEventListener("page-changing",()=>dormDepot.close());
  async function revivePilots(ids) {
    if(Net.started || revivalPending)return;
    const selected=pilotStore.pilots.filter(p=>ids.includes(p.id)&&p.needsRecruitment);
    if(!selected.length)return GameDialog.alert("没有需要复归的驾驶员");
    const signature=JSON.stringify(selected),supplies=selected.reduce((n,p)=>n+PilotSystem.revivalPrice(p).supplies,0);
    revivalPending=true;renderPilotRoster();
    try {
      const confirmed=await GameDialog.confirm(I18n.text("复归驾驶员：{count}名，消耗物资 {supplies}。是否继续？").replace("{count}",selected.length).replace("{supplies}",formatNumber(supplies)),{title:I18n.text("驾驶员复归")});
      if(!confirmed || Net.started)return;
      if(signature!==JSON.stringify(pilotStore.pilots.filter(p=>ids.includes(p.id)&&p.needsRecruitment)))throw Error("驾驶员状态已变化，请重新确认");
      const selectedIds=new Set(selected.map(p=>p.id)),next={...pilotStore,pilots:pilotStore.pilots.map(p=>selectedIds.has(p.id)?PilotSystem.revive(p):p)};
      if(!Economy.transact({supplies}, {}, [[sharedPilotKey,JSON.stringify(next)]]))return note("物资不足");
      pilotStore=next;draft=hydratePilots(draft);squads=squads.map(s=>({...s,units:hydratePilots(s.units)}));persist();
      if(pilotEdit && selectedIds.has(pilotEdit.id)){pilotEdit=structuredClone(next.pilots.find(p=>p.id===pilotEdit.id));pilotOriginal=JSON.stringify(pilotEdit);renderPilotStats();}
      render();if(Net.active && canEditRoom())Net.request("update_formation",{formation:current()});note("驾驶员已复归");
    } catch(error){note(error.message);} finally{revivalPending=false;renderPilotRoster();}
  }
  async function repairCurrentFormation() {
    if (Net.started || Net.awaiting || revivalPending || !canEditRoom()) return;
    const member = Net.snapshot?.members?.find(m => m.id === Net.snapshot.you?.id),
      entries = member?.formationPreset?.units || current(),
      stored = Economy.snapshot().storage,
      available = [...stored.units, ...stored.ships], selected = [];
    for (const entry of entries) {
      const index = entry.stockId ? available.findIndex(u => u.id === entry.stockId)
        : available.findIndex(u => u.unitId === entry.unitId && u.kitId === entry.kitId);
      if (index >= 0) selected.push(available.splice(index,1)[0]);
    }
    const ids = selected.map(u => u.id), pilotIds = new Set(selected.map(u => u.pilotId).filter(Boolean)),
      pilots = pilotStore.pilots.filter(p => pilotIds.has(p.id) && p.needsRecruitment),
      signature = JSON.stringify(pilots), quote = Economy.repairQuote(ids),
      revivalCost = pilots.reduce((sum,p) => sum + PilotSystem.revivalPrice(p).supplies,0);
    if (!quote.items.length && !pilots.length) return note("编组无需整备");
    revivalPending = true;
    try {
      const message = I18n.text("维修单位 {units} 台，复归驾驶员 {pilots} 名，共消耗 {supplies} 物资。是否继续？")
        .replace("{units}",quote.items.length).replace("{pilots}",pilots.length).replace("{supplies}",formatNumber(quote.supplies+revivalCost));
      if (!await GameDialog.confirm(message,{title:I18n.text("编组整备")}) || Net.started || Net.awaiting) return;
      const latestMember = Net.snapshot?.members?.find(m => m.id === Net.snapshot.you?.id);
      if (JSON.stringify(latestMember?.formationPreset?.units || current()) !== JSON.stringify(entries)
        || signature !== JSON.stringify(pilotStore.pilots.filter(p => pilotIds.has(p.id) && p.needsRecruitment)))
        throw Error("编组或驾驶员状态已变化，请重新确认");
      const revivedIds = new Set(pilots.map(p => p.id)),
        next = {...pilotStore,pilots:pilotStore.pilots.map(p => revivedIds.has(p.id) ? PilotSystem.revive(p) : p)},
        writes = pilots.length ? [[sharedPilotKey,JSON.stringify(next)]] : [];
      if (!Economy.repairAllStoredUnits(quote,revivalCost,writes)) return;
      pilotStore = next;
      draft = hydratePilots(draft);
      squads = squads.map(s => ({...s,units:hydratePilots(s.units)}));
      persist();render();
      if (Net.active && canEditRoom()) Net.request("update_formation",{formation:current()});
      note("编组整备完成");
    } catch(error) { note(error.message); }
    finally { revivalPending=false;renderPilotRoster(); }
  }
  byId("roomRepairFormation").onclick = repairCurrentFormation;
  byId("dormReviveAll").onclick=async()=>{
    if(Net.started || revivalPending)return;
    const scope=await GameDialog.scope("一键复归");
    if(scope)await revivePilots(scope==="page"?visiblePilotIds:activePilots().map(p=>p.id));
  };
  byId("reviveSelectedPilot").onclick=()=>pilotEdit && revivePilots([pilotEdit.id]);
  for (const [id,kind] of [["dormPMCTab","pmc"],["dormACETab","ace"]]) byId(id).onclick=()=>{dormKind=kind;dormPage=0;renderPilotRoster();};
  byId("dormPrevious").onclick=()=>{dormPage=Math.max(0,dormPage-1);renderPilotRoster();};
  byId("dormNext").onclick=()=>{dormPage++;renderPilotRoster();};
  function renderPilotRoster() {
    const list = byId("customPilotList");
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    byId("formationPilotBudget").textContent =
      `驾驶员 ${pilotStore.pilots.length} 名 · COST ${pilotStore.pilots.reduce((sum, p) => sum + PilotSystem.cost(p), 0)}`;
    const search = byId("pilotRosterSearch").value.trim().toLocaleLowerCase();
    const matching = activePilots().filter(
      (p) =>
        (dormKind === "ace" ? p.ace : !p.ace) && (p.name + " " + I18n.pilotName(p)).toLocaleLowerCase().includes(search) &&
        PilotSystem.matchesFilter(p, byId("pilotRosterFilter").value),
    );
    for(const [id,ace] of [["dormPMCStorage",false],["dormACEStorage",true]])byId(id).textContent=I18n.text(ace?"ACE保管库":"PMC保管库")+" ("+pilotStore.pilots.filter(p=>p.inDormStorage&&!!p.ace===ace).length+")";
    const pageSize=window.matchMedia("(max-width:720px)").matches?4:10;
    list.dataset.pageSize=String(pageSize);
    const capacity=dormKind==="ace"?Economy.acePilotLimit():Economy.customPilotLimit(),categoryCount=activePilots().filter(p=>!!p.ace===(dormKind==="ace")).length,
      displayCount=search || byId("pilotRosterFilter").value!=="all"?matching.length:Math.max(capacity,categoryCount),
      pageCount=Math.max(1,Math.ceil(displayCount/pageSize));dormPage=Math.min(dormPage,pageCount-1);
    const visible=matching.slice(dormPage*pageSize,dormPage*pageSize+pageSize);
    visiblePilotIds=visible.map(p=>p.id);
    byId("formationPilotBudget").textContent=`${I18n.text(dormKind==="ace"?"ACE驾驶员":"PMC驾驶员")} ${categoryCount} / ${capacity} · COST ${activePilots().filter(p=>!!p.ace===(dormKind==="ace")).reduce((n,p)=>n+PilotSystem.cost(p),0)}`;
    byId("dormReviveAll").disabled=Net.started || revivalPending || !activePilots().some(p=>p.needsRecruitment);
    byId("dormPMCTab").setAttribute("aria-pressed",String(dormKind==="pmc"));
    byId("dormACETab").setAttribute("aria-pressed",String(dormKind==="ace"));
    byId("dormPage").textContent=`${dormPage+1} / ${pageCount} 页`;
    byId("dormPrevious").disabled=dormPage===0;byId("dormNext").disabled=dormPage+1>=pageCount;
    byId("createCustomPilot").hidden=dormKind!=="pmc";byId("recruitAcePilot").hidden=dormKind!=="ace";
    for (const p of visible) {
      const card = element("div", "warehouse-bay dorm-card");
      card.dataset.pilotId = p.id;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "驾驶员详情 " + I18n.pilotName(p));
      const heading = element("div", "warehouse-card-heading"),
        name = element("span", "bay-unit-name"),
        nameText = element("strong", "", I18n.pilotName(p));
      nameText.dataset.i18nIgnore = "";
      name.title = nameText.textContent;
      name.append(nameText);
      heading.append(name, pilotCostTag(p));

      const portrait = element("div", "warehouse-icon-frame dorm-card-portrait"),
        img = element("img", "formation-icon"),
        tags = element("span", "unit-tags dorm-card-tags"),
        state = element(p.needsRecruitment ? "button" : "span", "dorm-card-state" + (p.needsRecruitment ? " needs-return" : ""),
          p.needsRecruitment ? "待回归" : "待机中");
      if (p.needsRecruitment) {
        state.type = "button";
        state.disabled = Net.started || revivalPending;
        state.title = I18n.text("复归") + " · " + I18n.text("物资") + " " + formatNumber(PilotSystem.revivalPrice(p).supplies);
        state.onclick = event => { event.stopPropagation(); revivePilots([p.id]); };
      }
      img.src = PilotSystem.portrait(p);
      img.alt = "";
      if (p.ace) {
        const source = aceTags(PilotSystem.aceProfile(p));
        const era = source.lastElementChild;
        era.remove();
        tags.append(era, ...source.children);
      } else {
        const faction = element("span", "faction-tag", "PMC");
        faction.dataset.faction = "PMC";
        tags.append(faction);
      }
      portrait.append(img, tags);

      const progress = element("div", "dorm-card-progress"),
        experience = element("div", "dorm-card-experience"),
        badges = element("div", "dorm-card-badges");
      experience.append(element("strong", "", `Lv.${p.level}`),
        element("span", "dorm-card-exp-value", pilotExperienceText(p)), state);
      experience.title = `Lv.${p.level} · ${pilotExperienceText(p)}`;
      if (p.reincarnations) badges.append(element("span", "pilot-training-points pilot-reincarnation-tag",
        I18n.text(["", "一转", "二转", "三转", "四转"][p.reincarnations])));
      if (PilotSystem.canUpgrade(p,Economy.academyLevel())) badges.append(element("span", "pilot-training-points pilot-promotion-tag", "可升级"));
      if (!p.ace && p.points > 0) badges.append(element("span", "pilot-training-points", `强化点 ${p.points}`));
      if (PilotSystem.canLearnSkill(p)) badges.append(element("span", "pilot-training-points", "可选技能"));
      progress.append(experience, badges);

      const skills = SkillControls.pilotSummary(p);
      skills.classList.add("dorm-card-skills");
      const skillBadges = [...skills.querySelectorAll(".pilot-list-skill")];
      if (skillBadges.length > 2) {
        skills.classList.add("has-more");
        const more = element("span", "dorm-skill-more", "…");
        more.title = skillBadges.slice(2).map(badge => badge.textContent).join("、");
        more.setAttribute("aria-label", "更多技能：" + more.title);
        for (const badge of skillBadges.slice(2)) badge.remove();
        skills.append(more);
      }
      card.append(heading, portrait, progress, skills);
      BasePageControls.dragSwap(img, card, {
        group: "dorm-" + dormKind, id: p.id, canDrag: () => !Net.started,
        onSwap: targetId => {
          const first = pilotStore.pilots.findIndex(pilot => pilot.id === p.id), second = pilotStore.pilots.findIndex(pilot => pilot.id === targetId);
          if (first < 0 || second < 0 || !!pilotStore.pilots[first].ace !== !!pilotStore.pilots[second].ace) return;
          const previous = pilotStore.pilots;
          pilotStore.pilots = previous.slice();
          [pilotStore.pilots[first], pilotStore.pilots[second]] = [previous[second], previous[first]];
          if (!savePilots()) { pilotStore.pilots = previous; return; }
          renderPilotRoster();
        },
      });
      card.onclick = () => editPilot(p);
      card.onkeydown = (event) => {
        if (event.target !== card) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          editPilot(p);
        }
      };
      const slot = element("div", "dorm-card-slot");
      slot.append(card);
      list.append(slot);
      requestAnimationFrame(() => {
        if (!name.isConnected) return;
        const overflow = nameText.scrollWidth - name.clientWidth;
        if (overflow > 1) {
          name.classList.add("is-scrolling");
          name.style.setProperty("--name-overflow", -overflow + "px");
          name.style.setProperty("--name-duration", Math.max(5, overflow / 24 + 3) + "s");
        }
      });
    }
    for(let i=visible.length;i<Math.min(pageSize,Math.max(1,displayCount-dormPage*pageSize));i++) {
      const empty=element("div","warehouse-bay dorm-card is-empty", "空位");
      const slot=element("div","dorm-card-slot");
      empty.setAttribute("aria-hidden","true");slot.append(empty);list.append(slot);
    }
    byId("recruitAcePilot").disabled = !Economy.canRecruitCrew("ace") || activePilots().filter(p=>p.ace).length>=Economy.acePilotLimit();
    byId("recruitAcePilot").title = Economy.canRecruitCrew("ace") ? "" : "需要2级信标";
    const customCount = activePilots().filter(p=>!p.ace).length;
    byId("createCustomPilot").disabled = customCount >= Economy.customPilotLimit();
    byId("createCustomPilot").title = `PMC驾驶员 ${customCount} / ${Economy.customPilotLimit()}`;
    list.scrollTop = scrollTop;
    requestAnimationFrame(()=>BasePageControls.fitPagedCards(list));
  }
  byId("pilotRosterSearch").oninput = () => {
    dormPage=0;
    byId("customPilotList").scrollTop = 0;
    renderPilotRoster();
  };
  byId("pilotRosterFilter").onchange = renderPilotRoster;
  BasePageControls.sortMenu("pilotRosterSortControl", [["name","名称排序"],["level","等级排序"],["cost","COST排序"]], rule => {
    const selected = activePilots().filter(p => dormKind === "ace" ? p.ace : !p.ace);
    const nameOrder = (a,b) => I18n.pilotName(a).localeCompare(I18n.pilotName(b), I18n.language);
    selected.sort((a,b) => (rule === "level" ? b.level-a.level : rule === "cost" ? PilotSystem.cost(a)-PilotSystem.cost(b) : 0) || nameOrder(a,b) || a.id.localeCompare(b.id));
    let index=0;
    const previous=pilotStore.pilots;
    pilotStore.pilots=previous.map(p => !p.inDormStorage && (dormKind === "ace" ? p.ace : !p.ace) ? selected[index++] : p);
    if (!savePilots()) { pilotStore.pilots=previous; return false; }
    dormPage=0;renderPilotRoster();
  });
  const dormCardsObserver=new ResizeObserver(()=>BasePageControls.fitPagedCards(byId("customPilotList")));
  dormCardsObserver.observe(byId("customPilotList"));
  window.matchMedia("(max-width:720px)").addEventListener("change",()=>{dormPage=0;renderPilotRoster();});
  function showFormationTab(tab) {
    finishPilotEditor();
    const pilots = tab === "pilots";
    byId("formationMain").dataset.page = tab;
    byId("dormTabs").hidden=!pilots;
    byId("formationUnitsTab").setAttribute("aria-pressed", String(!pilots));
    byId("formationPilotsTab").setAttribute("aria-pressed", String(pilots));
    pilotPage.hidden = !pilots;
    byId("formationUnitsWorkspace").hidden = pilots;
    byId("formationPilotToolbar").hidden = !pilots;
    byId("formationPilotBudget").hidden = !pilots;
    byId("produceMissingFormation").hidden = pilots || !Economy.purchasePlan(draft).items.length;
    byId("saveFormation").hidden = false;
    if (pilots) renderPilotRoster();
  }
  function commitPilot(profile) {
    const clean = PilotSystem.custom(profile);
    const i = pilotStore.pilots.findIndex((p) => p.id === clean.id);
    if(i<0 && !clean.ace && activePilots().filter(p=>!p.ace).length>=Economy.customPilotLimit())throw Error("PMC驾驶员人数已达到士官学院上限");
    if(i<0 && clean.ace && activePilots().filter(p=>p.ace).length>=Economy.acePilotLimit())throw Error("ACE驾驶员人数已达到士官学院上限");
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
    if (Net.active && canEditRoom()) Net.request("update_formation", { formation: current() });
    return clean;
  }
  function editPilot(p = null) {
    clearTimeout(pilotNameTimer);
    if(!p && activePilots().filter(p=>!p.ace).length>=Economy.customPilotLimit())return note("PMC驾驶员人数已达到士官学院上限");
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
    byId("customPilotPersonality").value = pilotEdit.personality || "";
    byId("customPilotOriginFaction").value = pilotEdit.originFaction || pilotEdit.faction || "PMC";
    byId("customPilotPersonality").disabled = !!pilotEdit.ace;
    byId("customPilotOriginFaction").disabled = !!pilotEdit.ace;
    byId("customPilotName").disabled = !!pilotEdit.ace;
    byId("editPilotDialogue").hidden = !!pilotEdit.ace || pilotEdit.personality !== "custom";
    byId("changeCustomPilotPortrait").disabled = !!pilotEdit.ace;
    byId("changeCustomPilotPortrait").hidden = !!pilotEdit.ace;
    byId("customPilotPortraitPicker").hidden = true;
    byId("createPilotConfirm").hidden = !pilotIsNew;
    byId("dismissCustomPilot").hidden = pilotIsNew;
    byId("dismissCustomPilot").disabled = Net.started || Net.awaiting || (Net.active && !canEditRoom());
    renderPilotStats();
    pilotEditor.hidden = false;
    byId("formationMain").inert = true;
    (pilotEdit.ace ? byId("finishCustomPilot") : byId("changeCustomPilotPortrait")).focus();
  }
  function savePilotIdentity(fields) {
    Object.assign(pilotEdit, fields);
    byId("editPilotDialogue").hidden = !!pilotEdit.ace || pilotEdit.personality !== "custom";
    byId("customPilotPersonality").value = pilotEdit.personality || "";
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
      !(["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.type.toLowerCase()) ||
        ((!file.type || file.type === "application/octet-stream") && /\.(png|jpe?g|webp)$/i.test(file.name))) ||
      file.size > 10 * 1024 * 1024
    )
      return note("请选择10MB以内的PNG、JPEG或WebP图片。");
    const url = URL.createObjectURL(file);
    try {
      const load = src => new Promise((resolve,reject) => {
        const image = new Image();
        image.onload = () => image.naturalWidth && image.naturalHeight ? resolve(image) : reject(Error("image"));
        image.onerror = () => reject(Error("image"));
        image.src = src;
      });
      let img;
      try { img = await load(url); }
      catch {
        const dataURL = await new Promise((resolve,reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
        });
        img = await load(dataURL);
      }
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
    byId("customPilotTitle").textContent=I18n.pilotName(pilotEdit);
    byId("pilotDetailCost").textContent=PilotSystem.cost(pilotEdit)+"C";
    byId("pilotDetailState").textContent=I18n.text(pilotEdit.needsRecruitment?"待回归":"待机中");
    byId("pilotDetailState").className="warehouse-condition "+(pilotEdit.needsRecruitment?"destroyed":"healthy");
    byId("reviveSelectedPilot").disabled=pilotIsNew || !pilotEdit.needsRecruitment || Net.started || revivalPending;
    byId("reviveSelectedPilot").textContent=I18n.text("复归")+" · "+I18n.text("物资")+" "+formatNumber(PilotSystem.revivalPrice(pilotEdit).supplies);
    byId("customPilotAvatar").src = PilotSystem.portrait(pilotEdit);
    resetTraining.hidden = false;
    byId("pilotTrainingTitle").textContent = I18n.text("属性强化");
    const mechanisms=byId("acePilotDetails");mechanisms.hidden=false;mechanisms.replaceChildren();
    const mechanism=(name,text)=>{const card=element("section","pilot-mechanic-card");card.append(element("strong","",name),element("p","muted",text));return card;};
    mechanisms.append(mechanism("成长机制",pilotEdit.ace
      ? I18n.text("ACE按悟性自动成长，不能手动加点或重置。")
      : I18n.text("使用强化点提升属性，达到等级上限后可转生提高上限。")),
      mechanism("复归费用",I18n.text(pilotEdit.ace?"每级1000物资，保留成长与战绩。":"每级500物资，保留成长与战绩。")));
    resetTalents.hidden = !Economy.canResetPilotTalents();
    resetTalents.textContent = "重置天赋 · 物资 " + 1000 * pilotEdit.level;
    resetTalents.disabled = !!pilotEdit.ace || pilotIsNew || pilotEdit.needsRecruitment || !pilotEdit.talents?.length || !Economy.affordable({supplies:1000 * pilotEdit.level});
    resetTraining.textContent = "重置属性点 · 资金 " + 1000 * pilotEdit.level;
    resetTraining.disabled = !!pilotEdit.ace || pilotIsNew || !Economy.affordable({ money: 1000 * pilotEdit.level });
    byId("customPilotProgress").replaceChildren(
      element("strong","pilot-detail-level",`Lv${pilotEdit.level}/${PilotSystem.maxLevel(pilotEdit,Economy.academyLevel())}`),
      document.createTextNode(
        ` · ${pilotExperienceText(pilotEdit)}${pilotEdit.ace ? " · ACE · " + I18n.text("悟性") + " " + PilotSystem.aceProfile(pilotEdit).comprehension : " · 强化点 " + pilotEdit.points}`,
      ),
    );
    renderPilotRecord(byId("customPilotRecord"), pilotEdit);
    const skills=PilotSystem.skillsOf({pilot:pilotEdit});
    byId("customPilotSkills").replaceChildren(...(skills.length?skills.map(skill=>{
      const card=mechanism(I18n.language==="zh"?skill.name:I18n.localized(skill),pilotSkillDescription(skill));
      if(skill.durationTurns)card.append(element("small","muted",I18n.text(`持续${skill.durationTurns}回合 · 冷却${skill.cooldownTurns}回合（效果结束后开始）`)));
      if(skill.icon){const icon=element("img");icon.src=skill.icon;icon.alt="";card.prepend(icon);card.classList.add("has-icon");}return card;
    }):[mechanism("驾驶员技能",I18n.text(pilotEdit.level>=PilotSystem.skillUnlockLevel?"未选择技能":"6级解锁技能"))]));
    for (const talent of PilotSystem.talents.of(pilotEdit))
      byId("customPilotSkills").append(mechanism("天赋 · " + talent.name, talent.description));
    if (!pilotEdit.ace) {
      const count = PilotSystem.talents.of(pilotEdit).length;
      const milestones = [
        ["第一天赋", "达到4级时随机获得；已获得的天赋永久保留。"],
        ["第二天赋", "第一次转生时随机获得，不与已有天赋重复。"],
        ["第三天赋", "第二次转生时随机获得；后续转生不再增加天赋。"],
      ];
      for (const [name, description] of milestones.slice(count))
        byId("customPilotSkills").append(mechanism(I18n.text(name), I18n.text(description)));
    }
    learnPilotSkillButton.hidden = false;
    learnPilotSkillButton.disabled = !!pilotEdit.ace || pilotEdit.level < PilotSystem.skillUnlockLevel;
    learnPilotSkillButton.classList.toggle(
      "pilot-skill-alert",
      PilotSystem.canLearnSkill(pilotEdit),
    );
    learnPilotSkillButton.textContent = I18n.text(
      pilotEdit.ace ? "固定技能" : pilotEdit.selectedSkillId && !PilotSystem.canLearnSkill(pilotEdit)
        ? "查看驾驶员技能"
        : pilotEdit.level >= PilotSystem.skillUnlockLevel
          ? "选择驾驶员技能"
          : "6级解锁技能",
    );
    const original = JSON.parse(pilotOriginal);
    const pendingPoints = original.points - pilotEdit.points;
    const readyToUpgrade = PilotSystem.canUpgrade(pilotEdit,Economy.academyLevel());
    const rebirth = PilotSystem.canReincarnate(pilotEdit,Economy.academyLevel());
    const advancementCost = rebirth ? PilotSystem.reincarnationCost(pilotEdit) : PilotSystem.upgradeCost(pilotEdit);
    upgradePilotButton.hidden = pilotIsNew || (pilotEdit.level >= PilotSystem.maxLevel(pilotEdit,Economy.academyLevel()) && !rebirth);
    upgradePilotButton.classList.toggle("pilot-skill-alert", readyToUpgrade || rebirth);
    upgradePilotButton.disabled =
      !(readyToUpgrade || rebirth) ||
      pendingPoints !== 0 ||
      !Economy.affordable({ money: advancementCost });
    upgradePilotButton.textContent =
      I18n.text(rebirth ? "转生" : "升职") +
      " · " +
      I18n.text("资金") +
      " " +
      (advancementCost ?? "—");
    let advancementHint = byId("pilotAdvancementHint");
    if (!advancementHint) {
      advancementHint = element("p", "helper"); advancementHint.id="pilotAdvancementHint";
      advancementHint.setAttribute("role","status"); upgradePilotButton.after(advancementHint);
    }
    const blockers=[];
    if (pendingPoints !== 0) blockers.push(I18n.text("\u8bf7\u5148\u786e\u8ba4\u5f3a\u5316\u70b9\u5206\u914d"));
    if (!Economy.affordable({money:advancementCost})) blockers.push(I18n.text("\u8d44\u91d1\u4e0d\u8db3")+" "+formatNumber(advancementCost));
    advancementHint.hidden=pilotIsNew || !blockers.length;
    advancementHint.textContent=blockers.join(" \u00b7 ");
    upgradePilotButton.title=advancementHint.hidden ? "" : advancementHint.textContent;
    demotePilotButton.hidden = pilotIsNew || pilotEdit.level === 0;
    demotePilotButton.disabled =
      !!pilotEdit.needsRecruitment ||
      pendingPoints !== 0 ||
      PilotSystem.demotionCost(pilotEdit) === null ||
      !Economy.affordable({ money: PilotSystem.demotionCost(pilotEdit) });
    demotePilotButton.textContent =
      I18n.text("降职") +
      " · " +
      I18n.text("资金") +
      " " +
      (PilotSystem.demotionCost(pilotEdit) ?? "—");
    byId("createPilotConfirm").textContent =
      I18n.text("招募PMC驾驶员") +
      " · " +
      I18n.text("资金") +
      " " +
      PilotSystem.customRecruitmentCost;
    byId("createPilotConfirm").disabled = !Economy.affordable({
      money: PilotSystem.customRecruitmentCost,
    });
    byId("pilotTrainingActions").hidden = false;
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
        !!pilotEdit.ace || !pilotEdit.points || pilotEdit.stats[key] >= PilotSystem.statCap(pilotEdit.level);
      plus.onclick = () => {
        pilotEdit.stats[key]++;
        pilotEdit.points--;
        renderPilotStats();
      };
      const plusFive = element("button", "pilot-plus-five", "+5");
      plusFive.type = "button";
      plusFive.setAttribute("aria-label", "强化" + label + " +5");
      plusFive.disabled =
        !!pilotEdit.ace || pilotEdit.points < 5 || pilotEdit.stats[key] + 5 > PilotSystem.statCap(pilotEdit.level);
      plusFive.onclick = () => {
        pilotEdit.stats[key] += 5;
        pilotEdit.points -= 5;
        renderPilotStats();
      };
      plus.hidden = plusFive.hidden = false;
      row.append(
        element(
          "span",
          "",
          `${label} ${Math.round(pilotEdit.stats[key])} / ${pilotEdit.ace ? Math.round(PilotSystem.aceStatCap(pilotEdit, key)) : PilotSystem.statCap(pilotEdit.level)}`,
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
  const pilotAdvancementActions=element("div","pilot-advancement-actions");
  byId("customPilotProgress").after(pilotAdvancementActions);
  pilotAdvancementActions.append(upgradePilotButton,demotePilotButton);
  demotePilotButton.onclick = async () => {
    if (!pilotEdit || pilotIsNew || demotePilotButton.disabled) return;
    const original = pilotOriginal;
    const cost = PilotSystem.demotionCost(pilotEdit);
    if (
      !(await GameDialog.confirm(
        I18n.text("降职将重置已分配的强化点和所选技能，经验保留。是否继续？"),
        {
          title: I18n.text("降职") + " · " + I18n.text("资金") + " " + cost,
        },
      ))
    )
      return;
    if (!pilotEdit || pilotOriginal !== original || demotePilotButton.disabled) return;
    try {
      const clean = PilotSystem.demote(pilotEdit);
      const next = {
        ...pilotStore,
        pilots: pilotStore.pilots.map((p) => (p.id === clean.id ? clean : p)),
      };
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
  upgradePilotButton.onclick = async () => {
    if (!pilotEdit || pilotIsNew || upgradePilotButton.disabled) return;
    if (JSON.parse(pilotOriginal).points !== pilotEdit.points) return;
    const rebirth = PilotSystem.canReincarnate(pilotEdit,Economy.academyLevel());
    const original = pilotOriginal;
    if (rebirth && !(await GameDialog.confirm(I18n.text("转生将保留天赋，清空经验、强化和技能，回到0级并恢复初始80强化点，等级上限提高1级。是否继续？")))) return;
    if (!pilotEdit || original !== pilotOriginal || upgradePilotButton.disabled) return;
    const cost = rebirth ? PilotSystem.reincarnationCost(pilotEdit) : PilotSystem.upgradeCost(pilotEdit);
    const clean = rebirth ? PilotSystem.reincarnate(pilotEdit,Economy.academyLevel()) : PilotSystem.upgrade(pilotEdit,Economy.academyLevel());
    const next = {
      ...pilotStore,
      pilots: pilotStore.pilots.map((p) => (p.id === clean.id ? clean : p)),
    };
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
  const resetTalents = element("button", "", "重置天赋");
  resetTalents.id = "resetPilotTalents";
  resetTalents.type = "button";
  const resetActions = element("div", "pilot-reset-actions");
  resetTraining.parentElement.append(resetActions);
  resetActions.append(resetTraining,resetTalents);
  resetTalents.onclick = async () => {
    if (!pilotEdit || resetTalents.disabled || Net.started) return;
    const id = pilotEdit.id, original = pilotOriginal;
    if (!await GameDialog.confirm("花费 " + 1000 * pilotEdit.level + " 物资重新抽取全部已解锁天赋。保留等级、转生、属性与技能；新天赋不重复且替换现有天赋。是否继续？",{title:"重置驾驶员天赋",confirmText:"重置"})) return;
    if (!pilotEdit || pilotOriginal !== original || Net.started) return;
    try {
      const result = Economy.resetPilotTalents(id,original);
      if (!result) return note("物资不足");
      pilotStore = result.store; pilotEdit = result.pilot; pilotOriginal = JSON.stringify(pilotEdit);
      commitPilot(pilotEdit); renderPilotStats();
    } catch (error) { note(Economy.errorMessage(error)); }
  };
  function finishPilotEditor() {
    if (!pilotEdit) return;
    savePilotName(true);
    PilotDialogueEditor.close();
    pilotEdit = null;
    pilotEditor.hidden = true;
    byId("customPilotPortraitPicker").hidden = true;
    byId("formationMain").inert = false;
    renderPilotRoster();
    pilotFocus?.focus();
  }
  let pilotNameTimer;
  function savePilotName(report = false) {
    clearTimeout(pilotNameTimer);
    if (!pilotEdit || pilotEdit.ace) return;
    const input = byId("customPilotName");
    if (input.value === pilotEdit.name) return;
    try {
      const clean = PilotSystem.custom({ ...pilotEdit, name: input.value });
      savePilotIdentity({ name: clean.name });
      if (report) input.value = clean.name;
    } catch (error) {
      if (report) { input.value = pilotEdit.name; note(error.message); }
    }
  }
  const pilotNameInput = byId("customPilotName");
  const schedulePilotName = event => {
    clearTimeout(pilotNameTimer);
    if (event.isComposing || !pilotEdit) return;
    const id = pilotEdit.id;
    pilotNameTimer = setTimeout(() => { if (pilotEdit?.id === id) savePilotName(); }, 350);
  };
  pilotNameInput.oninput = schedulePilotName;
  pilotNameInput.addEventListener("compositionstart", () => clearTimeout(pilotNameTimer));
  pilotNameInput.addEventListener("compositionend", schedulePilotName);
  pilotNameInput.onchange = () => savePilotName(true);
  pilotNameInput.onkeydown = event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); savePilotName(true); } };
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
  byId("editPilotDialogue").onclick = () => {
    if (!pilotEdit || pilotEdit.ace || pilotEdit.personality !== "custom") return;
    const pilotId = pilotEdit.id;
    PilotDialogueEditor.open(pilotEdit, (dialogue) => {
      if (!pilotEdit || pilotEdit.id !== pilotId) throw Error("驾驶员已变更，请重新打开编辑面板");
      savePilotIdentity({ personality: "custom", dialogue });
    });
  };
  byId("customPilotPersonality").onchange = () => {
    if (pilotEdit && !pilotEdit.ace)
      savePilotIdentity({ personality: byId("customPilotPersonality").value || null });
  };
  byId("customPilotOriginFaction").onchange = () => {
    if (pilotEdit && !pilotEdit.ace)
      savePilotIdentity({ originFaction: byId("customPilotOriginFaction").value });
  };
  byId("createPilotConfirm").onclick = () => {
    if (!pilotEdit || !pilotIsNew) return;
    try {
      const clean = PilotSystem.custom(pilotEdit);
      const next = { ...pilotStore, pilots: [...pilotStore.pilots, clean] };
      if (
        !Economy.transact({ money: PilotSystem.customRecruitmentCost }, {}, [
          [sharedPilotKey, JSON.stringify(next)],
        ])
      )
        return note("资金不足");
      pilotStore = next;
      pilotIsNew = false;
      commitPilot(clean);
      finishPilotEditor();
    } catch (error) {
      note(Economy.errorMessage(error));
    }
  };
  const changePortraitButton = element("button", "", "修改头像");
  changePortraitButton.id = "changeCustomPilotPortrait";
  changePortraitButton.type = "button";
  byId("editPilotDialogue").after(changePortraitButton);
  changePortraitButton.onclick = openPortraitPicker;
  byId("closePilotPortraitPicker").onclick = closePortraitPicker;
  byId("formationUnitsTab").onclick = () => showFormationTab("units");
  byId("formationPilotsTab").onclick = () => showFormationTab("pilots");
  byId("createCustomPilot").onclick = () => editPilot();
  byId("dismissCustomPilot").onclick = async () => {
    const button = byId("dismissCustomPilot");
    if (!pilotEdit || pilotIsNew || button.disabled || Net.started || Net.awaiting || (Net.active && !canEditRoom())) return;
    savePilotName(true);
    const id = pilotEdit.id, original = pilotStore.pilots.find(p=>p.id===id);
    if (!original) return;
    const signature = JSON.stringify(original);
    button.disabled = true;
    try {
      const message = "确定解雇驾驶员「" + I18n.pilotName(original) + "」？驾驶员将被永久移除。" + (original.ace ? "重新招募此ACE时，经验和成长将从初始状态开始。" : "此操作无法撤销。");
      if (!await GameDialog.confirm(message, {title:"解雇驾驶员"})) return;
      if (!pilotEdit || pilotEdit.id!==id || Net.started || Net.awaiting || (Net.active && !canEditRoom())) return;
      if (JSON.stringify(pilotStore.pilots.find(p=>p.id===id))!==signature) throw Error("驾驶员状态已变化，请重新确认");
      const next = {...pilotStore,pilots:pilotStore.pilots.filter(p=>p.id!==id)};
      if (!Economy.dismissPilot(id, [[sharedPilotKey,JSON.stringify(next)]])) return;
      pilotStore = next;
      clearTimeout(pilotNameTimer);
      // Closing must not save identity edits back into a deleted roster record.
      pilotEdit = null;
      PilotDialogueEditor.close();
      pilotEditor.hidden = true;
      byId("formationMain").inert = false;
      sessionSaves.clear();
      draft = hydratePilots(draft);
      squads = squads.map(s=>({...s,units:hydratePilots(s.units)}));
      persist(); render(); renderPilotRoster();
      if (Net.active && canEditRoom()) Net.request("update_formation",{formation:current()});
      byId("pilotRosterSearch").focus();
    } catch(error) { note(Economy.errorMessage(error)); }
    finally { button.disabled = Net.started || Net.awaiting || (Net.active && !canEditRoom()); }
  };
  byId("finishCustomPilot").onclick = finishPilotEditor;
  const learnPilotSkillButton = element("button", "pilot-skill-button", "6级解锁技能");
  learnPilotSkillButton.id = "learnPilotSkill";
  learnPilotSkillButton.type = "button";
  const customPilotSkills = element("div");
  customPilotSkills.id = "customPilotSkills";
  byId("pilotDetailSkills").querySelector("h3").after(customPilotSkills, learnPilotSkillButton);
  byId("pilotDetailPreview").append(byId("customPilotAvatar"));
  const pilotSkillPicker = element("dialog", "pilot-attribute-help pilot-skill-picker");
  pilotSkillPicker.id = "pilotSkillPicker";
  pilotSkillPicker.setAttribute("aria-labelledby", "pilotSkillPickerTitle");
  document.body.append(pilotSkillPicker);
  function openPilotSkillPicker() {
    if (!pilotEdit || pilotEdit.ace || pilotEdit.level < PilotSystem.skillUnlockLevel) return;
    const ownerId = pilotEdit.id;
    const readOnly = !PilotSystem.canLearnSkill(pilotEdit);
    const learnedIds = [pilotEdit.selectedSkillId, pilotEdit.selectedSecondSkillId].filter(Boolean);
    let choice = null;
    const title = element("h3", "", "选择驾驶员技能");
    title.id = "pilotSkillPickerTitle";
    const explanation = element("p", "muted", "选择一个技能；重置属性时会清除技能，可重新选择。");
    const grid = element("div", "pilot-skill-choices");
    const confirm = element("button", "primary", "确认技能");
    confirm.id = "confirmPilotSkill";
    confirm.disabled = true;
    confirm.hidden = readOnly;
    for (const skill of PilotSystem.skillChoices.filter((s) => readOnly ? learnedIds.includes(s.id) : !learnedIds.includes(s.id))) {
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
        savePilotIdentity({ selectedSkillId: learned.selectedSkillId, selectedSecondSkillId: learned.selectedSecondSkillId });
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
    ["射击", "以100点为基准，每点增加0.25个百分点的射击伤害倍率与射击次数倍率；200点时均为125%。"],
    ["格斗", "以100点为基准，每点增加0.25个百分点的格斗伤害倍率与主动格斗次数倍率；200点时均为125%。格斗反击仍按每名接近的敌人回复一次。"],
    ["防御", "每点降低0.1875个百分点的承受伤害倍率；100点为100%，200点为81.25%。"],
    [
      "机动",
      "以100点为基准，每点使移动倍率变化0.5%；200点为150%移动。射击和格斗轮数的驾驶员机动系数每点变化0.125%，200点为112.5%；机体机动系数为1+(机动-100)×0.25%。射击和主动格斗基础轮数均乘机体机动、驾驶员机动，再分别乘射击或格斗次数系数后四舍五入。格斗反击仍为一次，武器限次仍有效。",
    ],
    [
      "命中",
      "每点增加0.1875个百分点的命中倍率；100点为100%，200点为118.75%。命中率乘我方命中倍率、除以敌方回避倍率，全部修正后限制在0%～100%。",
    ],
    [
      "反应",
      "每点增加0.1875个百分点的反应倍率；100点为100%，200点为118.75%。敌方命中率除以该倍率；与我方通讯回避倍率相乘。",
    ],
    [
      "指挥",
      "指挥高于100时触发光环：非舰船2格，舰船4格；支援／一般为通信、泛用为防御、突击为攻击。机体原有指挥替换默认类型并额外增加2格。基础效果10%，每高25点增加2.5个百分点，同类取最强。",
    ],
    [
      "觉醒",
      "达到100点时，命中与反应系数各提高5%；低于100点无此加成，超过100点不再增长。觉醒不再改变浮游炮伤害，武器觉醒门槛仍须满足。",
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
    repairCurrentFormation,
    availablePilots: ({includeUnavailable=false}={}) => structuredClone(activePilots().filter(p=>includeUnavailable || !p.needsRecruitment)),
    storedPilot,
    unitTags,
    unitSummaryTags,
    replenish,
    checkLicenses,
    current,
    receivePilotAwards,
    exportPilotStores: () =>
      Object.fromEntries(
        ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"].map((faction) => [
          faction,
          {
            pilots: structuredClone(pilotStore.pilots.filter((pilot) => pilot.faction === faction)),
            awards: [...pilotStore.awards],
          },
        ]),
      ),
    hasPilotAward: (id) => pilotStore.awards.includes(id),
    open,
    canEditRoom,
    group: () => group,
    setGroup,
    alignWithRoom: (snapshot) => {
      const member = snapshot?.members?.find((item) => item.id === snapshot.you?.id);
      if (
        !member ||
        !["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"].includes(member.characterFaction)
      )
        return;
      setGroup(member.characterFaction);
      PlayerProfile.setFaction(member.characterFaction);
    },
    previewUnit,
    openAceRecruitment,
    refresh: () => {
      if (pageView === "formation") {
        render();
        if (!byId("formationUnitPicker").hidden) renderCatalog();
        if (detailIndex !== null || catalogDetail) renderDetail();
      }
    },
    name: () => squads[index].name,
    presetIndex: () => index,
    selectPreset: (value) => {
      if (!Number.isInteger(value) || value < 0 || value >= squads.length) return false;
      carrierPage = null;
      index = value;
      persist();
      return true;
    },
    presets: () =>
      squads.map((squad) => ({
        name: squad.name,
        units: !squad.units.length
          ? []
          : Rules.validateFleetFormation(
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
    !u.missionActor &&
    phase === "deployment" &&
    !Net.awaiting &&
    (!game.campaignBattlefield || !!u.campaignDeploying) &&
    !game.deployment?.[
      game.campaignBattlefield
        ? Rules.campaignBattlefield.deploymentSeat(game, u)
        : Rules.ownerOf(u)
    ] &&
    (Net.active
      ? Net.canControl(u) && Net.snapshot.connected.every(Boolean)
      : Rules.ownerOf(u) === team());
  const areaSeat = () => {
    const u = getUnit(selected);
    return u && (Net.active ? Net.canControl(u) : Rules.ownerOf(u) === team())
      ? Rules.ownerOf(u)
      : team();
  };
  function choose(unit) {
    if (!canEditUnit(unit)) return;
    window.HangarUI?.cancel();
    selected = unit.id;
    mode = "select";
    weaponId = null;
    if (unit.embarked) squadSingleMove = true;
    update();
  }
  function turn(direction) {
    const unit = getUnit(selected);
    if (!canEditUnit(unit) || !Rules.canRotate(game, unit, direction)) return;
    if (Net.active) return Net.request("rotate", { unitId: unit.id, direction });
    Rules.rotate(game, unit, direction);
    update();
  }
  function render() {
    byId("deploymentPanel").hidden = phase !== "deployment";
    byId("deploymentBottomBar").hidden = phase !== "deployment";
    byId("gameScene").dataset.deployment = String(phase === "deployment");
    requestAnimationFrame(updateClearance);
    byId("confirmDeployment").hidden = phase !== "deployment";
    byId("endTurn").hidden = [
      "start",
      "connecting",
      "deployment",
      "waiting",
      "assembly",
      "finished",
    ].includes(phase);
    let transform = byId("deploymentTransform");
    if (!transform) {
      transform = element("button", "", "变形");
      transform.id = "deploymentTransform";
      byId("confirmDeployment").before(transform);
    }
    const actor = getUnit(selected),
      forms = actor
        ? NormalForms.options(ART, Rules.modelOf(actor).prefabId).filter((f) => f.skillId && ["transform", "armor_purge"].includes(f.type))
        : [];
    let rotate=byId("deploymentRotate");
    if(!rotate){rotate=element("button","","旋转");rotate.id="deploymentRotate";byId("confirmDeployment").before(rotate);}
    rotate.hidden=phase!=="deployment" || !actor || !(Rules.modelOf(actor).ship || Rules.modelOf(actor).fixedWeaponFacing);
    rotate.disabled=!canEditUnit(actor) || !Rules.canRotate(game,actor,1);
    rotate.onclick=()=>BattleHUD.openRotation(actor);
    transform.hidden =
      phase !== "deployment" || !actor || actor.embarked || !Net.canControl(actor) || !forms.length;
    transform.onclick = () =>
      Net.request("deployment_transform", { unitId: actor.id, skillId: forms[0].skillId });
    if (phase !== "deployment") return;
    const seat = team();
    byId("deploymentHint").textContent = game.campaignBattlefield
      ? "在高亮区域内调整新参战单位，全部指挥玩家确认后继续局地战。"
      : "部署区域全队共享，在高亮区域内调整位置，两队确认后开始回合。";
    byId("deploymentStatus").textContent = game.campaignBattlefield
      ? "局地战部署：防守方选择己方据点，进攻方仅限各自来向入口；原战场存活部队保持位置。"
      : seat === null
        ? "观战：等待两队部署。"
        : `${teamName(Rules.seatTeam(seat))}全队共享部署区 · 选中己方单位，再点击高亮空格调整位置。`;
    const roster = byId("deploymentRoster"),
      scrollTop = roster.scrollTop;
    roster.replaceChildren();
    const living = game.units.filter((u) => u.hp > 0),
      cargo = new Map();
    for (const unit of living) {
      const carrierId = unit.embarked?.carrierId;
      if (!carrierId) continue;
      if (!cargo.has(carrierId)) cargo.set(carrierId, []);
      cargo.get(carrierId).push(unit);
    }
    function family(root, seen = new Set()) {
      if (seen.has(root.id)) return [];
      seen.add(root.id);
      return [root, ...(cargo.get(root.id) || []).flatMap((unit) => family(unit, seen))];
    }
    function icon(u) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "deployment-unit-icon";
      button.dataset.unitId = u.id;
      button.classList.toggle("is-staged", !!u.deploymentStaged);
      button.classList.toggle("is-passenger", !!u.embarked);
      button.disabled = !canEditUnit(u);
      button.title =
        unitName(u) + (u.embarked ? " · 预先搭载" : u.deploymentStaged ? " · 待放置" : " · 已部署");
      button.setAttribute("aria-label", button.title);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(selected === u.id));
      const img = document.createElement("img");
      img.src = unitIcon(u.model, u.pilot);
      img.alt = "";

      const label = document.createElement("span");
      label.className = "deployment-unit-number";
      label.textContent = String((u.formationIndex ?? game.units.indexOf(u)) + 1);
      button.append(img, label);
      button.onclick = () => choose(u);
      return button;
    }
    for (const root of living.filter((unit) => !unit.embarked)) {
      const members = family(root);
      if (!members.some(canEditUnit)) continue;
      if (members.length === 1) roster.append(icon(root));
      else {
        const group = element("div", "deployment-transport-group");
        group.dataset.carrierId = root.id;
        group.setAttribute("role", "group");
        group.setAttribute(
          "aria-label",
          unitName(root) + " · " + I18n.text("格纳库") + " " + (members.length - 1),
        );
        group.append(...members.map(icon));
        roster.append(group);
      }
    }
    roster.scrollTop = scrollTop;
    const canChange = canEdit();
    byId("deploymentUnplace").disabled =
      !canChange || !canEditUnit(getUnit(selected)) || !!getUnit(selected)?.embarked;
    byId("deploymentClear").disabled = !canChange;
    byId("deploymentAuto").disabled = !canChange;
    byId("confirmDeployment").disabled = !canEdit() || !!pendingMovement();
    byId("confirmDeployment").textContent =
      seat !== null && game.deployment[seat] ? "已确认，等待对方" : "确认部署 (B)";
  }
  async function click(cell) {
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
        GameAudio.selectUnit(u);
        update();
      } catch (error) {
        note(error.message || "请在己方出生区的空格部署。");
      }
    }
  }
  let dragging = null,
    pendingDrop = null;
  function failedDrop(message = "加入失败") {
    note(message);
    GameAudio.play("underAttackSound");
  }
  function beginDrag(event) {
    if (phase !== "deployment" || ["hangar-board", "hangar-launch"].includes(mode)) return false;
    const cell = cellAt(event),
      target = cell && Rules.at(game, cell.x, cell.y);
    let unit = getUnit(selected);
    if (!unit || !Rules.cells(unit).some((p) => p.x === cell?.x && p.y === cell?.y)) unit = target;
    if (!canEditUnit(unit) || unit.embarked || unit.deploymentStaged || unit.facility) return false;
    dragging = {
      unitId: unit.id,
      session,
      moved: false,
      x: event.clientX,
      y: event.clientY,
      image: new Image(),
    };
    dragging.image.src = unitIcon(unit.model, unit.pilot);
    return true;
  }
  function moveDrag(event) {
    if (!dragging || dragging.session !== session || phase !== "deployment") return cancelDrag();
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    if (!dragging.moved) {
      dragging.moved = true;
      selected = dragging.unitId;
      update();
    }
  }
  function cancelDrag() {
    dragging = null;
  }
  function sendDrop(unit, x, y, message) {
    if (Net.active) {
      const id = Net.request("deploy", { unitId: unit.id, x, y });
      if (id) pendingDrop = { id, message };
    } else {
      try {
        Rules.deploy(game, team(), unit.id, x, y);
        GameAudio.selectUnit(unit);
      } catch {
        failedDrop(message);
      }
      update();
    }
  }
  function drop(event) {
    const drag = dragging;
    cancelDrag();
    if (!drag?.moved || drag.session !== session || phase !== "deployment") return;
    const unit = getUnit(drag.unitId),
      cell = cellAt(event);
    if (!canEditUnit(unit)) return;
    const rect = byId("map").getBoundingClientRect();
    if (
      !cell ||
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      return failedDrop("部署失败");
    const target = Rules.at(game, cell.x, cell.y);
    if (target && target.id !== unit.id) {
      if (target.team === unit.team && Rules.hangars.of(target).length) {
        HangarUI.openDeploymentBoarding(unit, target);
        return;
      }
      if (!canEditUnit(target) || !Rules.squadJoinTarget(game, unit, target.x, target.y, [unit]))
        return failedDrop();
      squadSingleMove = false;
      sendDrop(unit, target.x, target.y, "加入失败");
    } else {
      const anchor = Rules.anchorAt(unit, cell.mapX ?? cell.x, cell.mapY ?? cell.y);
      sendDrop(unit, anchor.x, anchor.y, "部署失败");
    }
  }
  function dropRejected(id) {
    if (!pendingDrop || pendingDrop.id !== id) return false;
    const message = pendingDrop.message;
    pendingDrop = null;
    failedDrop(message);
    return true;
  }
  function dropAccepted(id) {
    if (pendingDrop?.id === id) pendingDrop = null;
  }
  function drawDrag(ctx) {
    if (!dragging?.moved || dragging.session !== session || phase !== "deployment") return;
    const box = byId("map").getBoundingClientRect(),
      size = Math.max(36, Math.min(72, mapGeo.tile * 1.5));
    ctx.save();
    ctx.globalAlpha = 0.8;
    if (dragging.image.complete && dragging.image.naturalWidth)
      ctx.drawImage(
        dragging.image,
        dragging.x - box.left - size / 2,
        dragging.y - box.top - size / 2,
        size,
        size,
      );
    ctx.restore();
  }
  function updateClearance() {
    const panel = byId("deploymentBottomBar"),
      scene = byId("gameScene");
    let clearance = 0;
    if (!panel.hidden) {
      const top = Math.min(
        panel.getBoundingClientRect().top,
        byId("deploymentAuto").getBoundingClientRect().top,
      );
      clearance = Math.ceil(byId("mapWrap").getBoundingClientRect().bottom - top + 10);
    }
    scene.style.setProperty("--deployment-panel-clearance", clearance + "px");
    // Commands belong to the scene; the portrait strip belongs to mapWrap.
    const sceneClearance = clearance
      ? clearance +
        scene.getBoundingClientRect().bottom -
        byId("mapWrap").getBoundingClientRect().bottom
      : 0;
    scene.style.setProperty("--deployment-command-clearance", sceneClearance + "px");
  }
  new ResizeObserver(updateClearance).observe(byId("deploymentBottomBar"));
  window.addEventListener("resize", updateClearance);
  function deploymentAction(action, id = null) {
    if (!canEdit()) return;
    if (Net.active) Net.request(action, id ? { unitId: id } : {});
    else {
      try {
        if (action === "stage_deployment") Rules.stageDeployment(game, team(), id);
        if (action === "clear_deployment") Rules.clearDeployment(game, team());
        if (action === "auto_place_deployment") Rules.autoPlaceDeployment(game, team());
      } catch (error) {
        note(error.message);
      }
      update();
    }
  }
  byId("deploymentUnplace").onclick = () => deploymentAction("stage_deployment", selected);
  byId("deploymentClear").onclick = () => deploymentAction("clear_deployment");
  byId("deploymentAuto").onclick = () => deploymentAction("auto_place_deployment");
  byId("confirmDeployment").onclick = () => {
    if (pendingMovement()) return;
    if (!canEdit()) return;
    if (Net.active) return Net.request("confirm_deployment");
    if (game.ai && !game.deployment[1]) {
      Rules.aiDeployment(game, 1);
      Rules.confirmDeployment(game, 1);
    }
    const finished = Rules.confirmDeployment(game, team());
    GameAudio.play("deploymentSound");
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
    beginDrag,
    moveDrag,
    drop,
    cancelDrag,
    drawDrag,
    dropAccepted,
    dropRejected,
    isDragging: (id) =>
      !!(
        dragging?.moved &&
        dragging.unitId === id &&
        dragging.session === session &&
        phase === "deployment"
      ),
    team,
    canEdit,
    canEditUnit,
    choose,
    turn,
    areaSeat,
    reset: () => {
      previewSeat = 0;
      cancelDrag();
      pendingDrop = null;
    },
  };
})();
