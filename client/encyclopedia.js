/* Read-only catalog. Uses shared preview cards and leaves the room connection intact. */
const Encyclopedia = (() => {
  const list = byId("encyclopediaList");
  let tab = "units",
    weaponIndex = null;
  let pendingFocusKey = null,
    highlightedKey = null,
    usersTrigger = null;
  let renderGeneration = 0,
    renderTimer = null;
  const signature = (weapon) =>
    JSON.stringify([
      weapon.sourceName || weapon.id,
      weapon.level,
      WeaponClasses.paths(weapon),
      weapon.damage,
      weapon.shotCount,
      weapon.en,
      weapon.actionCost,
      weapon.min,
      weapon.max,
      weapon.hit,
      weapon.damageComponents,
    ]);
  const identity = (weapon) =>
    [
      weapon.sourceName || weapon.id,
      weapon.level,
      weapon.category === "irradiation" ? "irradiation" : "weapon",
    ].join(":");
  const categories = WeaponClasses.labels;
  const field = (name) => byId("encyclopedia" + name);
  function options(name, items) {
    const select = field(name),
      previous = select.value;
    select.replaceChildren(...items.map(([value, label]) => new Option(I18n.text(label), value)));
    if (items.some(([value]) => value === previous)) select.value = previous;
  }
  function setup() {
    options("Faction", [
      ["", "全部阵营"],
      ["EFSF", "地球联邦军"],
      ["ZEON", "吉翁公国军"],
    ]);
    options("Era", [["", "全部年代"], ...Rules.eras.map((v) => [v, v])]);
    options("Status", [
      ["", "全部"],
      ["developed", "已开发"],
      ["licensed", "已获得部署许可"],
      ["locked", "未解锁"],
    ]);
    if (tab === "units") UnitCatalog.populateTypeFilter(field("Type"), field("Type").value);
    else
      options("Type", [
        ["", "全部类型"],
        ...Object.entries(WeaponClasses.mainLabels).map(([key, name]) => ["main:" + key, name]),
        ...Object.entries(categories),
      ]);
    options("Level", [
      ["", "全部等级"],
      ...[
        ...new Set(
          Rules.catalog.prefabs.flatMap((p) => Object.values(p.weapons).map((w) => w.level)),
        ),
      ]
        .sort((a, b) => a - b)
        .map((v) => [String(v), "Lv." + v]),
    ]);
    field("Level").hidden = tab !== "weapons";
    field("Status").hidden = !!window.CATALOG_DEVELOPER_MODE;
    byId("encyclopediaUnitsTab").setAttribute("aria-pressed", String(tab === "units"));
    byId("encyclopediaWeaponsTab").setAttribute("aria-pressed", String(tab === "weapons"));
  }
  function stateMatches(prefab) {
    if (window.CATALOG_DEVELOPER_MODE) return true;
    const status = field("Status").value,
      faction = PlayerProfile.faction();
    const developed = Development.allows(faction, prefab.id),
      licensed = Economy.hasLicense(prefab.id);
    return (
      !status ||
      (status === "developed" && developed) ||
      (status === "licensed" && licensed) ||
      (status === "locked" && !developed && !licensed)
    );
  }
  function unitCard(prefab) {
    const card = element("article", "encyclopedia-unit"),
      modelId =
        prefab.id +
        "__" +
        ((window.CATALOG_DEVELOPER_MODE
          ? PRODUCTION_CATALOG.defaultKits[prefab.id]
          : Economy.defaultKit(prefab.id)) || prefab.weaponKits[0].id);
    card.dataset.unitId = prefab.id;
    const portrait = element("div", "encyclopedia-portrait"),
      image = element("img");
    image.src = unitIcon(modelId);
    image.alt = "";
    image.loading = "lazy";
    portrait.append(image);
    if (prefab.wip) portrait.append(element("small", "unit-portrait-status", "WIP"));
    const body = element("div", "encyclopedia-unit-body");
    body.append(element("strong", "encyclopedia-unit-name", prefab.code + " " + prefab.name));
    body.append(Formation.unitTags(prefab));
    body.append(
      Formation.unitSummaryTags(prefab.stats.adaptability, null, UnitModels[modelId].cost),
    );
    const state = window.CATALOG_DEVELOPER_MODE
      ? ""
      : Economy.hasLicense(prefab.id)
        ? "已获得部署许可"
        : Development.allows(PlayerProfile.faction(), prefab.id)
          ? "已开发"
          : "未解锁";
    if (!window.CATALOG_DEVELOPER_MODE) body.append(element("small", "muted", state));
    const detail = element("button", "", "详细");
    detail.type = "button";
    detail.onclick = () => Formation.previewUnit(prefab.id, detail);
    body.append(detail);
    card.append(portrait, body);
    return card;
  }
  function weapons() {
    if (weaponIndex) return weaponIndex;
    const groups = new Map();
    for (const model of Object.values(UnitModels)) {
      const irradiation = (model.skills || [])
        .filter((s) => s.type === "irradiation")
        .map((skill) => ({
          ...skill,
          id: skill.sourceWeapon,
          sourceName: skill.sourceWeapon,
          type: "beam",
          category: "irradiation",
          min: skill.minRange,
          max: skill.range,
          hit: skill.baseHit,
          en: skill.enCost ?? (model.en * skill.enCostPercent) / 100,
          damagePerShot: Object.values(skill.damageComponents).reduce((a, b) => a + b, 0),
          damage: Object.values(skill.damageComponents).reduce((a, b) => a + b, 0),
          shotCount: 1,
          attack: {
            strikes: [{ damageComponents: skill.damageComponents }],
            steps: [{ delay: 0, shots: 1 }],
          },
        }));
      for (const weapon of [...model.weapons, ...irradiation]) {
        // Keep performance differences visible, while deduplicating identical kit copies.
        const key = signature(weapon);
        if (!groups.has(key))
          groups.set(key, {
            key,
            weapon,
            users: new Set(),
            anchor: "encyclopedia-weapon-" + groups.size,
          });
        groups.get(key).users.add(model.prefabId);
      }
    }
    // The encyclopedia also covers source weapons absent from playable kits.
    // Keep their availability unchanged; this index is only for inspection.
    const byIdentity = new Map();
    for (const record of groups.values()) {
      const id = identity(record.weapon);
      if (!byIdentity.has(id)) byIdentity.set(id, []);
      byIdentity.get(id).push(record);
    }
    for (const prefab of Rules.catalog.prefabs)
      for (const [id, source] of Object.entries(prefab.weapons)) {
        const converted = (prefab.skills || []).find(
          (s) => s.id === source.availability?.convertedSkill,
        );
        if (converted?.type === "irradiation") continue;
        const sourceIdentity = identity({ ...source, id });
        const existing = byIdentity.get(sourceIdentity);
        if (existing) {
          for (const record of existing) record.users.add(prefab.id);
          continue;
        }
        const weapon = WeaponSequence.compile({ ...source, id });
        if (converted) {
          // Utility launchers use their implemented skill cost, rather than the
          // obsolete native projectile's attack cost and damage.
          weapon.name = converted.name;
          weapon.localization = converted.localization;
          weapon.actionCost = converted.actionCost;
          weapon.en =
            converted.enCost ??
            (converted.enCostPercent
              ? (UnitModels[prefab.id + "__" + prefab.weaponKits[0].id].en *
                  converted.enCostPercent) /
                100
              : converted.enCost || 0);
          weapon.damage = weapon.damagePerShot = 0;
          weapon.damageComponents = {};
          weapon.attack.strikes = weapon.attack.strikes.map((strike) => ({
            ...strike,
            damageComponents: {},
          }));
          weapon.description = SkillControls.description(converted);
        }
        const key = signature(weapon);
        const record = {
          key,
          weapon,
          users: new Set([prefab.id]),
          anchor: "encyclopedia-weapon-" + groups.size,
        };
        groups.set(key, record);
        byIdentity.set(sourceIdentity, [record]);
      }
    weaponIndex = [...groups.values()];
    return weaponIndex;
  }
  function render() {
    const generation = ++renderGeneration;
    clearTimeout(renderTimer);
    if (pageView !== "encyclopedia") return;
    const query = field("Search").value.trim().toLocaleLowerCase();
    const filters = {
      faction: field("Faction").value,
      era: field("Era").value,
      type: tab === "units" ? field("Type").value : "",
    };
    const allowed = (p) =>
      window.CATALOG_DEVELOPER_MODE || Development.allows(PlayerProfile.faction(), p.id);
    const selected = UnitCatalog.select(
      tab === "units" ? query : "",
      filters,
      allowed,
      true,
    ).filter(stateMatches);
    let records;
    if (tab === "units")
      records = selected.sort(
        window.CATALOG_DEVELOPER_MODE
          ? UnitCatalog.compareDevelopedCost("PMC", () => true)
          : UnitCatalog.compareDevelopedCost(),
      );
    else {
      const ids = new Set(selected.map((p) => p.id));
      records = weapons()
        .filter(
          ({ weapon, users }) =>
            [...users].some((id) => ids.has(id)) &&
            (!field("Type").value ||
              (field("Type").value.startsWith("main:")
                ? WeaponClasses.mainTags(weapon).includes(field("Type").value.slice(5))
                : WeaponClasses.tags(weapon).includes(field("Type").value))) &&
            (!field("Level").value || weapon.level === Number(field("Level").value)) &&
            (!query ||
              [
                weapon.id,
                weapon.name,
                ...Object.values(weapon.localization || {}).map((l) => l.name),
              ]
                .join(" ")
                .toLocaleLowerCase()
                .includes(query)),
        )
        .sort((a, b) =>
          a.weapon.name.localeCompare(b.weapon.name, I18n.language, { numeric: true }),
        );
    }
    list.replaceChildren();
    list.dataset.tab = tab;
    list.dataset.rendering = "true";
    byId("encyclopediaCount").textContent = String(records.length);
    let cursor = 0;
    function appendBatch() {
      if (generation !== renderGeneration || pageView !== "encyclopedia") return;
      const fragment = document.createDocumentFragment(),
        started = performance.now();
      do {
        const record = records[cursor++];
        if (!record) break;
        if (tab === "units") fragment.append(unitCard(record));
        else {
          const card = WeaponInfo.card(record.weapon);
          if (record.weapon.category === "irradiation")
            card.append(
              element(
                "p",
                "muted",
                SkillControls.description({ ...record.weapon, type: "irradiation" }),
              ),
            );
          card.dataset.weaponId = record.weapon.id;
          card.dataset.weaponSource = record.weapon.sourceName || record.weapon.id;
          card.dataset.weaponLevel = record.weapon.level;
          card.dataset.weaponKey = record.key;
          card.id = record.anchor;
          card.tabIndex = -1;
          card.classList.toggle("encyclopedia-weapon-target", record.key === highlightedKey);
          if (record.weapon.availability?.hidden) {
            const label = record.weapon.availability.convertedSkill
              ? "技能武器"
              : record.weapon.availability.reasons?.includes("paired_weapon")
                ? "联装子武器"
                : "未接入";
            card.append(element("small", "weapon-index-status", label));
          }
          card.append(usersButton(record.weapon));
          fragment.append(card);
        }
      } while (cursor < records.length && performance.now() - started < 6);
      list.append(fragment);
      if (pendingFocusKey) {
        const target = [...list.querySelectorAll(".weapon-card")].find(
          (card) => card.dataset.weaponKey === pendingFocusKey,
        );
        if (target) pendingFocusKey = null;
        if (target)
          requestAnimationFrame(() => {
            target.scrollIntoView({ block: "center" });
            target.focus({ preventScroll: true });
          });
      }
      if (cursor < records.length) renderTimer = setTimeout(appendBatch, 16);
      else {
        list.dataset.rendering = "false";
        if (!records.length) list.append(element("p", "muted", "没有符合筛选的内容"));
      }
    }
    renderTimer = setTimeout(appendBatch, 0);
  }
  const usersDialog = document.createElement("dialog");
  usersDialog.id = "weaponUsersDialog";
  usersDialog.className = "weapon-users-dialog";
  usersDialog.setAttribute("aria-labelledby", "weaponUsersTitle");
  document.body.append(usersDialog);
  function openUsers(weapon, trigger) {
    usersTrigger = trigger;
    const ids = new Set(
      weapons()
        .filter((record) => identity(record.weapon) === identity(weapon))
        .flatMap((record) => [...record.users]),
    );
    const title = element("h3", "", weapon.name + " · " + I18n.text("使用单位"));
    title.id = "weaponUsersTitle";
    const close = element("button", "", "关闭");
    close.type = "button";
    close.onclick = () => usersDialog.close();
    const header = element("header", "weapon-users-heading");
    header.append(title, close);
    const grid = element("div", "weapon-users-grid");
    for (const prefab of Rules.catalog.prefabs
      .filter((p) => ids.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name, I18n.language))) {
      const card = unitCard(prefab),
        detail = card.querySelector("button");
      detail.onclick = () => {
        usersTrigger = null;
        usersDialog.close();
        if (!byId("formationUnitDetail").hidden) byId("closeFormationDetail").click();
        Formation.previewUnit(prefab.id, trigger);
      };
      grid.append(card);
    }
    usersDialog.replaceChildren(header, grid);
    if (!usersDialog.open) usersDialog.showModal();
    close.focus();
  }
  usersDialog.addEventListener("close", () => {
    if (usersTrigger?.isConnected) usersTrigger.focus({ preventScroll: true });
    usersTrigger = null;
  });
  window.addEventListener("page-changing", () => {
    if (usersDialog.open) usersDialog.close();
  });
  function usersButton(weapon) {
    const button = element("button", "encyclopedia-users-button", "使用单位");
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-controls", "weaponUsersDialog");
    button.onclick = () => openUsers(findWeapon(weapon)?.weapon || weapon, button);
    return button;
  }
  function findWeapon(source) {
    if (source.sourceWeapon)
      return weapons().find(
        (record) =>
          record.weapon.category === "irradiation" &&
          record.weapon.sourceName === source.sourceWeapon &&
          record.weapon.level === source.level &&
          JSON.stringify(record.weapon.damageComponents) ===
            JSON.stringify(source.damageComponents),
      );
    return (
      weapons().find((record) => record.key === signature(source)) ||
      weapons().find((record) => identity(record.weapon) === identity(source))
    );
  }
  function weaponAnchor(source) {
    return findWeapon(source)?.anchor || "encyclopediaScreen";
  }
  function openWeapon(source) {
    const record = findWeapon(source);
    if (!record) return;
    if (!byId("formationUnitDetail").hidden) byId("closeFormationDetail").click();
    tab = "weapons";
    setup();
    for (const name of ["Search", "Faction", "Era", "Type", "Status", "Level"])
      field(name).value = "";
    pendingFocusKey = highlightedKey = record.key;
    if (pageView !== "encyclopedia") MenuShell.go("encyclopedia");
    else render();
  }
  for (const name of ["Search", "Faction", "Era", "Type", "Status", "Level"])
    field(name).addEventListener(name === "Search" ? "input" : "change", () => {
      list.scrollTop = 0;
      render();
    });
  for (const [id, value] of [
    ["encyclopediaUnitsTab", "units"],
    ["encyclopediaWeaponsTab", "weapons"],
  ])
    byId(id).onclick = () => {
      tab = value;
      field("Type").value = "";
      list.scrollTop = 0;
      setup();
      render();
    };
  window.addEventListener("language-change", () => {
    weaponIndex = null;
    setup();
    render();
  });
  for (const event of ["economy-changed", "character-selected", "development-changed"])
    window.addEventListener(event, render);
  function open() {
    setup();
    setPageView("encyclopedia");
    render();
  }
  window.addEventListener("page-changing", () => {
    ++renderGeneration;
    clearTimeout(renderTimer);
  });
  function invalidate() {
    weaponIndex = null;
    render();
  }
  return { open, render, openWeapon, weaponAnchor, usersButton, invalidate };
})();
