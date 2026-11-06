/* Unit preview and permanent deployment license purchases. */
const ProductionUI = (() => {
  let selectedId = null,
    kitId = null,
    tab = "stats";
  let returnView = "menu",
    onReturn = null;
  const filters = { faction: "", era: "", type: "" };
  const screen = byId("productionScreen");
  const resourceIcon = (kind) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "resource-icon");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute(
      "d",
      kind === "technology"
        ? "M9 2h6v2h-1v5l6 10a2 2 0 0 1-2 3H6a2 2 0 0 1-2-3l6-10V4H9Zm3 8-4 7h8l-4-7Z"
        : kind === "money"
          ? "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 4v1h3v2h-6v2h4a3 3 0 0 1 0 6h-1v1h-2v-1H8v-2h6v-2h-4a3 3 0 0 1 0-6h1V6Z"
          : "M3 7 12 2l9 5v11l-9 5-9-5Zm2 1v9l6 3v-9Zm8 3v9l6-3V8ZM7 7l5 3 5-3-5-3Z",
    );
    svg.append(path);
    return svg;
  };
  function resources(
    container,
    value,
    { compact = false, income = null, technology = false } = {},
  ) {
    container.replaceChildren();
    for (const [kind, name] of [
      ["money", "资金"],
      ["supplies", "物资"],
      ...(technology ? [["technology", "科技点"]] : []),
    ]) {
      const item = element("span", "resource-" + kind);
      item.setAttribute("aria-label", name + " " + formatNumber(value[kind] || 0));
      item.title = name;
      item.append(
        resourceIcon(kind),
        element("span", "", (compact ? "" : name + " ") + formatNumber(value[kind] || 0)),
      );
      if (income) {
        const next = element("span", "resource-income", "+" + formatNumber(income[kind] || 0));
        next.dataset.resource = kind;
        next.title = "下回合收入";
        item.append(next);
      }
      container.append(item);
    }
  }
  const menuBalance = element("div", "resource-balance");
  menuBalance.id = "menuResources";
  byId("playerId").closest(".menu-profile-row").append(menuBalance);
  const techBalance = element("div", "resource-balance");
  techBalance.id = "developmentResources";
  byId("developmentMain").querySelector("header").append(techBalance);
  const formationBalance = element("div", "resource-balance");
  formationBalance.id = "formationResources";
  byId("formationMain").querySelector(".formation-heading h2").after(formationBalance);
  const roomBalance = element("div", "resource-balance");
  roomBalance.id = "roomResources";
  byId("roomChatPanel").append(roomBalance);
  const seatBalance = element("div", "resource-balance");
  seatBalance.id = "roomSeatResources";
  byId("roomSeatsPage").append(seatBalance);
  function refreshBalances() {
    for (const target of [
      menuBalance,
      techBalance,
      formationBalance,
      roomBalance,
      seatBalance,
      byId("productionResources"),
    ])
      resources(target, Economy.snapshot());
  }
  function receiveAwards(snapshot) {
    RewardNotifications.sync(snapshot);
    if (snapshot.replay || snapshot.phase === "replay" || snapshot.startedFromSave) return;
    for (const award of snapshot.economyAwards || []) {
      try {
        if (Economy.creditAward(award)) RewardNotifications.add("currency", award, snapshot);
      } catch (error) {
        note("战斗结算保存失败：" + Economy.errorMessage(error));
        break;
      }
    }
  }
  // Both license entry points share purchase validation and persistence.
  function purchaseUnitLicense(unitId) {
    if (Net.started && Net.snapshot?.phase !== "assembly") return "当前无法购买部署许可";
    try {
      if (!Economy.purchaseLicense(unitId, PlayerProfile.faction())) return "当前无法购买部署许可";
      GameAudio.play("productionSound");
      return "已获得永久部署许可，赠送机体和默认套件各1份";
    } catch (error) {
      return "许可购买失败：" + Economy.errorMessage(error);
    }
  }
  function productionNote(prefab) {
    return I18n.text("无法直接购买许可");
  }
  function renderLicensePurchase(unitId, selectedKit = Economy.defaultKit(unitId)) {
    let panel = byId("formationInventorySale");
    if (!panel) {
      panel = element("div", "inventory-sale");
      panel.id = "formationInventorySale";
      byId("formationUnitDetail").querySelector(".unit-detail-summary").after(panel);
    }
    const owned = Economy.hasLicense(unitId),
      offer = Economy.licenseOffer(unitId),
      prefab = Rules.catalog.prefabs.find((item) => item.id === unitId);
    panel.replaceChildren();
    const caption = element("span", "inventory-owned", "未许可");
    caption.hidden = owned;
    const productionPrice = element("span", "inventory-production-price");
    productionPrice.append(element("small", "muted", "部署许可价格（赠送默认配置1台）"));
    if (offer) {
      const balance = element("span", "resource-balance");
      resources(balance, offer, { compact: true });
      productionPrice.append(balance);
    } else productionPrice.append(element("small", "muted", productionNote(prefab)));
    const actions = element("span", "inventory-actions"),
      produce = element("button", "primary", owned ? "已获得许可" : "购买部署许可");
    produce.id = "producePreviewUnit";
    produce.disabled =
      owned ||
      !offer ||
      !prefab ||
      !allows(prefab) ||
      !Economy.affordable(offer) ||
      (Net.started && Net.snapshot?.phase !== "assembly");
    produce.onclick = () => {
      note(purchaseUnitLicense(unitId));
      Formation.refresh();
      renderLicensePurchase(unitId);
      if (pageView === "production") render();
    };
    actions.append(produce);
    panel.append(caption, productionPrice, actions);
    const modelId = unitId + "__" + selectedKit,
      kitOffer = Economy.kitOffer(modelId);
    const stock = element(
      "span",
      "inventory-owned",
      "机体库存 " + Economy.quantity(unitId) + " · 当前套件 " + Economy.kitQuantity(modelId),
    );
    stock.id = "previewKitStock";
    const kitPrice = element("span", "resource-balance");
    if (kitOffer) resources(kitPrice, kitOffer, { compact: true });
    const buy = element("button", "", "购买套件 ×1");
    buy.id = "buyPreviewKit";
    buy.disabled =
      !owned ||
      !kitOffer ||
      !allows(prefab) ||
      !Economy.affordable(kitOffer) ||
      (Net.started && Net.snapshot?.phase !== "assembly");
    buy.onclick = () => {
      try {
        const ok = Economy.buyKit(unitId, selectedKit, PlayerProfile.faction());
        note(ok ? "已购买套件 ×1" : "无法购买套件");
        if (ok) GameAudio.play("productionSound");
      } catch (error) {
        note(Economy.errorMessage(error));
      }
      Formation.refresh();
      renderLicensePurchase(unitId, selectedKit);
    };
    panel.append(stock, kitPrice, buy);
  }
  function allows(prefab) {
    const faction = PlayerProfile.faction();
    return (
      !prefab.wip &&
      (faction === "PMC" || (prefab.availableFactions || [prefab.faction]).includes(faction)) &&
      Development.allows(faction, prefab.id)
    );
  }
  function metrics(container, rows) {
    const dl = element("dl", "unit-detail-metrics");
    for (const [label, value] of rows) {
      const cell = element("div", "unit-detail-metric");
      cell.append(element("dt", "", label), element("dd", "", String(value)));
      dl.append(cell);
    }
    container.append(dl);
  }
  function metricSection(container, title, rows) {
    const section = element("section", "production-stat-section");
    section.append(element("h4", "production-stat-title", title));
    metrics(section, rows);
    container.append(section);
  }
  function renderInfo(model) {
    const info = byId("productionInfo");
    info.replaceChildren();
    for (const kind of ["stats", "weapons", "abilities"])
      byId("production" + kind[0].toUpperCase() + kind.slice(1) + "Tab").setAttribute(
        "aria-selected",
        String(tab === kind),
      );
    info.setAttribute(
      "aria-labelledby",
      "production" + tab[0].toUpperCase() + tab.slice(1) + "Tab",
    );
    if (tab === "stats") {
      metricSection(info, "基础性能", [
        ["HP", formatNumber(model.hp)],
        ["EN", formatNumber(model.en)],
        ["COST", model.cost],
        ["移动", model.move],
        ["AP参考", model.actionPoints ?? 5],
        ["盾牌HP", formatNumber(model.shield.hp)],
        ["零件强度", model.partStructuralStrength],
      ]);
      metricSection(info, "索敌与命中", [
        ["视野距离", formatDistance(model.sensors.sight)],
        ["侦察距离", formatDistance(model.sensors.radar)],
        ["命中系数", model.accuracy + "%"],
        ["机动", model.speed ?? 100],
        ["反应系数", model.mobility],
      ]);
      const environments = {
        ground: "地面",
        mountain: "山地",
        space: "宇宙",
        water: "水中",
        atmosphere: "大气层",
        air: "空中",
        forest: "树林",
        snow: "雪地",
        desert: "沙漠",
        rubble: "废墟",
      };
      metricSection(
        info,
        "地形适应性",
        Object.entries(environments).map(([key, label]) => [
          label,
          (model.adaptability[key] ?? 0) + "%",
        ]),
      );
      const defenseNames = {
        melee: "格斗",
        shooting: "射击",
        beam: "光束",
        shell: "实弹",
        dp: "DP",
        sp: "SP",
      };
      const defense = element("section", "production-stat-section");
      defense.append(element("h4", "production-stat-title", "防护能力"));
      const table = element("table", "production-defense-table");
      const head = element("thead"),
        headings = element("tr");
      for (const label of ["类型", "比例减伤", "固定减伤"])
        headings.append(element("th", "", label));
      head.append(headings);
      const body = element("tbody");
      for (const [kind, value] of Object.entries(model.defenses)) {
        const row = element("tr");
        const name = element("th", "", defenseNames[kind] || kind);
        name.scope = "row";
        row.append(
          name,
          element("td", "", value.percent + "%"),
          element("td", "", formatNumber(value.flat)),
        );
        body.append(row);
      }
      table.append(head, body);
      defense.append(table);
      info.append(defense);
      if (model.description) {
        const description = element("section", "production-stat-section");
        description.append(
          element("h4", "production-stat-title", "单位说明"),
          element("p", "muted", model.description),
        );
        info.append(description);
      }
    } else if (tab === "weapons") {
      for (const weapon of model.weapons) {
        const card = WeaponInfo.card(weapon, null, { encyclopediaLink: true });
        info.append(card);
      }
    } else {
      for (const skill of [
        ...SkillControls.commandAbilities(model),
        ...SkillControls.defensiveAbilities(model),
        ...(model.skills || []),
      ]) {
        const card = element("article", "formation-weapon-detail");
        card.append(
          element("strong", "", skill.name),
          element("p", "", SkillControls.description(skill)),
        );
        if (skill.sourceWeapon)
          card.append(WeaponInfo.encyclopediaLink(skill), Encyclopedia.usersButton(skill));
        info.append(card);
      }
      if (model.supplyAura)
        info.append(element("p", "", "自动补给 · 范围 " + model.supplyAura.range));
      if (!info.childElementCount) info.append(element("p", "muted", "无特殊能力"));
    }
  }
  function renderDetails() {
    const prefab = Rules.catalog.prefabs.find((p) => p.id === selectedId),
      select = byId("productionKit");
    select.replaceChildren();
    if (!prefab) {
      byId("productionUnitName").textContent = "没有符合筛选的单位";
      byId("productionInfo").replaceChildren();
      byId("productionPrice").replaceChildren();
      byId("productionQuantity").textContent = "";
      byId("productionBaseKitName").textContent = "购买部署许可";
      for (const button of ["produceUnit", "buyProductionKit", "purchaseProductionLicense"]) byId(button).disabled = true;
      byId("purchaseProductionLicense").hidden = true;
      byId("productionLicensePrice").hidden = true;
      const canvas = byId("productionPreview");
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (!prefab.weaponKits.some((k) => k.id === kitId))
      kitId = Economy.defaultKit(prefab.id) || prefab.weaponKits[0].id;
    for (const kit of prefab.weaponKits) select.add(new Option(kit.name, kit.id));
    select.value = kitId;
    select.disabled = false;
    const id = prefab.id + "__" + kitId,
      model = UnitModels[id];
    const permit = Economy.licenseOffer(prefab.id),
      offer = Economy.productionOffer(prefab.id, kitId);
    const owned = Economy.hasLicense(prefab.id),
      locked = !allows(prefab);
    const busy = Net.started && Net.snapshot?.phase !== "assembly";
    byId("productionUnitName").textContent = prefab.name;
    Formation.renderPreview(id, byId("productionPreview"));
    renderInfo(model);
    const prices = byId("productionPrice");
    prices.replaceChildren();
    prices.hidden = false;
    if (offer)
      for (const [name, value] of [
        ["机体生产费", offer.chassis],
        ["出厂套件费", offer.kit],
        ["合计", offer],
      ]) {
        const row = element("div", "production-price-row");
        row.append(element("small", "muted", name));
        const amount = element("span", "resource-balance");
        resources(amount, value, { compact: true });
        row.append(amount);
        prices.append(row);
      }
    else prices.append(element("span", "muted", "无法直接生产"));
    byId("productionQuantity").textContent =
      "机体库存 " +
      Economy.quantity(prefab.id) +
      " · 当前套件 " +
      Economy.kitQuantity(id);
    byId("productionBaseKitName").textContent = "选择出厂套件";
    const purchase = byId("purchaseProductionLicense");
    purchase.hidden = owned;
    purchase.disabled = owned || !permit || locked || busy || !Economy.affordable(permit);
    purchase.textContent = "购买部署许可";
    const permitPrice = byId("productionLicensePrice");
    permitPrice.hidden = owned;
    resources(permitPrice, permit || {}, { compact: true });
    byId("produceUnit").dataset.licenseLocked = String(!owned);
    byId("buyProductionKit").dataset.licenseLocked = String(!owned);
    byId("produceUnit").disabled = !owned || !offer || locked || busy || !Economy.affordable(offer);
    byId("produceUnit").textContent = "生产机体＋套件 ×1";
    byId("produceUnit").title = !owned ? "请先购买部署许可" : locked ? "尚未开发或阵营不匹配" : "";
    const buy = byId("buyProductionKit");
    buy.disabled = !owned || !offer || locked || busy || !Economy.affordable(offer.kit);
  }

  function render() {
    refreshBalances();
    const list = byId("productionList"),
      scroll = list.scrollTop;
    const prefabs = UnitCatalog.select(byId("productionSearch").value, filters, allows).sort(
      UnitCatalog.compareDevelopedCost(),
    );
    if (!prefabs.some((p) => p.id === selectedId)) {
      selectedId = prefabs[0]?.id || null;
      kitId = null;
    }
    list.replaceChildren();
    for (const prefab of prefabs) {
      const card = element("button", "production-unit");
      card.dataset.buttonSound = "off";
      card.type = "button";
      card.dataset.unitId = prefab.id;
      card.dataset.locked = String(!Economy.hasLicense(prefab.id) && !allows(prefab));
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", String(selectedId === prefab.id));
      const image = element("img");
      image.src = unitIcon(prefab.id + "__" + prefab.weaponKits[0].id);
      image.alt = "";
      image.loading = "lazy";
      const text = element("span", "production-unit-info"),
        offer = Economy.productionOffer(prefab.id, Economy.defaultKit(prefab.id));
      const licensed = Economy.hasLicense(prefab.id);
      const defaultModel = UnitModels[Economy.defaultModel(prefab.id)];
      const tags = Formation.unitTags(defaultModel || prefab, {
        cost: defaultModel?.cost ?? prefab.stats.cost,
        kitName: defaultModel?.kitName,
        limit: matchMedia("(max-width:720px)").matches ? 4 : 8,
      });
      const heading = element("span", "unit-line-heading"),
        metadata = element("span", "unit-line-meta");
      const name = element("strong", "unit-line-title", prefab.name);
      name.title = prefab.name;
      heading.append(name);
      metadata.append(tags);
      const price = element("span", "production-unit-price"),
        balance = element("span", "resource-balance");
      if (offer) resources(balance, offer);
      else balance.append(element("span", "muted", productionNote(prefab)));
      price.append(balance);
      const owned = element("small", "muted production-owned");
      owned.append(
        element(
          "span",
          "",
          "机体库存 " +
            Economy.quantity(prefab.id) +
            (licensed ? "" : " · 未许可"),
        ),
      );
      const portrait = element("span", "production-unit-portrait");
      portrait.append(image);
      const status = !allows(prefab) ? "未开发" : !licensed ? "未许可" : null;
      if (status) portrait.append(element("small", "unit-portrait-status", status));
      const footer = element("span", "production-unit-footer");
      footer.append(price, owned);
      text.append(heading, metadata, footer);
      card.append(portrait, text);
      card.onclick = () => {
        list.querySelector('[aria-selected="true"]')?.setAttribute("aria-selected", "false");
        selectedId = prefab.id;
        kitId = null;
        card.setAttribute("aria-selected", "true");
        byId("productionStatus").textContent = "";
        GameAudio.selectUnit(prefab);
        renderDetails();
      };
      list.append(card);
    }
    if (!prefabs.length) list.append(element("p", "empty", "没有符合筛选的单位"));
    list.scrollTop = scroll;
    renderDetails();
  }
  function setupFilters() {
    for (const [name, values] of [
      ["faction", Rules.factions],
      ["era", Rules.eras],
    ]) {
      const select = byId("production" + name[0].toUpperCase() + name.slice(1));
      select.replaceChildren(new Option("不限", ""));
      for (const value of values) select.add(new Option(value, value));
      select.value = filters[name];
      select.onchange = () => {
        filters[name] = select.value;
        render();
      };
    }
    const select = byId("productionType"),
      types = document.createElement("optgroup"),
      environments = document.createElement("optgroup");
    types.label = "单位类型";
    environments.label = "环境筛选";
    for (const value of [
      ...new Set(Rules.catalog.prefabs.filter((p) => !p.formOnly).flatMap((p) => p.unitTags || [])),
    ].sort())
      types.append(new Option(I18n.text(Rules.unitTagName(value)), "type:" + value));
    for (const [key, name] of [
      ["ground", "地面"],
      ["space", "宇宙"],
    ])
      environments.append(new Option(name, "environment:" + key));
    select.replaceChildren(new Option("不限", ""), types, environments);
    select.value = filters.type;
    select.onchange = () => {
      filters.type = select.value;
      render();
    };
  }
  byId("openProduction").onclick = () => {
    returnView = Net.active ? "room" : "menu";
    onReturn = null;
    byId("closeProduction").textContent = "返回主菜单";
    filters.faction = Rules.factions.includes(PlayerProfile.faction())
      ? PlayerProfile.faction()
      : "";
    setupFilters();
    setPageView("production");
    render();
    byId("productionSearch").focus();
  };
  byId("closeProduction").onclick = () => {
    setPageView(returnView);
    onReturn?.();
    if (returnView === "menu") byId("openProduction").focus();
  };
  screen.addEventListener("keydown", (e) => {
    if (e.key === "Escape") byId("closeProduction").click();
  });
  byId("productionSearch").oninput = () => {
    byId("productionStatus").textContent = "";
    render();
  };
  byId("productionKit").onchange = (e) => {
    kitId = e.target.value;
    byId("productionStatus").textContent = "";
    renderDetails();
  };
  for (const kind of ["stats", "weapons", "abilities"]) {
    const button = byId("production" + kind[0].toUpperCase() + kind.slice(1) + "Tab");
    button.onclick = () => {
      tab = kind;
      renderDetails();
    };
  }
  function finishPurchase(message) {
    try {
      render();
    } catch (error) {
      byId("productionStatus").textContent =
        message + "；界面刷新失败：" + Economy.errorMessage(error);
      return;
    }
    byId("productionStatus").textContent = message;
  }
  byId("purchaseProductionLicense").onclick = () => finishPurchase(purchaseUnitLicense(selectedId));
  function purchaseStock(onlyKit) {
    if (Net.started && Net.snapshot?.phase !== "assembly") return;
    try {
      const ok = onlyKit
        ? Economy.buyKit(selectedId, kitId, PlayerProfile.faction())
        : Economy.produce(selectedId, kitId, PlayerProfile.faction());
      if (ok) GameAudio.play("productionSound");
      finishPurchase(
        ok
          ? onlyKit
            ? "已购买套件 ×1"
            : "已生产机体 ×1、套件 ×1"
          : "无法购买，请检查许可、科技及资金物资",
      );
    } catch (error) {
      finishPurchase("购买失败：" + Economy.errorMessage(error));
    }
  }
  byId("produceUnit").onclick = () => purchaseStock(false);
  byId("buyProductionKit").onclick = () => purchaseStock(true);
  window.addEventListener("economy-changed", refreshBalances);
  window.addEventListener("character-selected", () => {
    if (pageView === "production") render();
  });
  window.addEventListener("development-changed", () => {
    if (pageView === "production") render();
  });
  window.addEventListener("language-change", () => {
    setupFilters();
    if (pageView === "production") render();
  });
  window.addEventListener("game-assets-ready", () => {
    if (pageView === "production") renderDetails();
  });
  setupFilters();
  refreshBalances();
  function openUnit(unitId, options = {}) {
    selectedId = unitId;
    kitId = null;
    returnView = options.returnView || "menu";
    onReturn = options.onReturn || null;
    filters.era = filters.type = "";
    // A direct unit link must remain visible even when it belongs to another faction.
    filters.faction =
      !unitId && Rules.factions.includes(PlayerProfile.faction()) ? PlayerProfile.faction() : "";
    setupFilters();
    byId("productionSearch").value = unitId || "";
    byId("closeProduction").textContent =
      returnView === "formation" ? "返回编组" : returnView === "room" ? "返回房间" : "返回主菜单";
    setPageView("production");
    render();
  }
  return { render, resources, resourceIcon, openUnit, receiveAwards, renderLicensePurchase };
})();
