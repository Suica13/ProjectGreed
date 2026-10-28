/* Factory preview and immediate production. Inventory consumption is a future policy. */
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
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute(
      "d",
      kind === "money"
        ? "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 4v1h3v2h-6v2h4a3 3 0 0 1 0 6h-1v1h-2v-1H8v-2h6v-2h-4a3 3 0 0 1 0-6h1V6Z"
        : "M3 7 12 2l9 5v11l-9 5-9-5Zm2 1v9l6 3v-9Zm8 3v9l6-3V8ZM7 7l5 3 5-3-5-3Z",
    );
    svg.append(path);
    return svg;
  };
  function resources(container, value, { compact = false } = {}) {
    container.replaceChildren();
    for (const [kind, name] of [
      ["money", "资金"],
      ["supplies", "物资"],
    ]) {
      const item = element("span", "resource-" + kind);
      item.setAttribute("aria-label", name + " " + formatNumber(value[kind] || 0));
      item.title = name;
      item.append(
        resourceIcon(kind),
        element("span", "", (compact ? "" : name + " ") + formatNumber(value[kind] || 0)),
      );
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
  const roomProduction = element("button", "", "生产");
  roomProduction.id = "roomProduction";
  roomProduction.type = "button";
  byId("roomFormation").after(roomProduction);
  roomProduction.onclick = () => {
    if (Net.started && Net.snapshot?.phase !== "assembly") return;
    openUnit(null, { returnView: "room", onReturn: () => RoomPanel.render(Net.snapshot) });
    byId("closeProduction").textContent = "返回房间";
  };
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
  function renderSale(unitId) {
    let panel = byId("formationInventorySale");
    if (!panel) {
      panel = element("div", "inventory-sale");
      panel.id = "formationInventorySale";
      byId("formationDetailPilot").parentElement.after(panel);
    }
    const price = Economy.sellPrice(unitId),
      count = Economy.quantity(unitId);
    panel.replaceChildren();
    const caption = element("span", "", "持有 " + count + " 台");
    const refund = element("span", "resource-balance");
    if (price) resources(refund, price);
    const sell = element("button", "", "出售 1 台");
    sell.id = "sellPreviewUnit";
    const inBattle = () => Net.started && Net.snapshot?.phase !== "assembly";
    sell.disabled = !count || !price || inBattle();
    sell.onclick = async () => {
      if (
        !(await GameDialog.confirm("出售1台库存单位，返还50%资金和物资，是否继续？", {
          title: "出售库存单位",
          confirmText: "出售",
        }))
      )
        return;
      if (inBattle()) return;
      try {
        if (Economy.sellUnit(unitId)) {
          renderSale(unitId);
          Formation.refresh();
          note("库存单位已出售");
        }
      } catch (error) {
        note(Economy.errorMessage(error));
      }
    };
    panel.append(caption, refund, sell);
  }
  function allows(prefab) {
    const faction = PlayerProfile.faction();
    return (
      !prefab.wip &&
      (faction === "PMC" || faction === prefab.faction) &&
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
      metrics(info, [
        ["HP", formatNumber(model.hp)],
        ["EN", model.en],
        ["COST", model.cost],
        ["移动", model.move],
        ["行动点", model.actionPoints ?? 5],
        ["视野距离", formatDistance(model.sensors.sight)],
        ["侦察距离", formatDistance(model.sensors.radar)],
        ["反应系数", model.mobility],
        ["命中系数", model.accuracy + "%"],
        ["零件强度", model.partStructuralStrength],
        ["盾牌HP", model.shield.hp],
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
      metrics(
        info,
        Object.entries(environments).map(([key, label]) => [
          label + "适应性",
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
      metrics(
        info,
        Object.entries(model.defenses).map(([kind, v]) => [
          (defenseNames[kind] || kind) + "防护",
          v.percent + "% / " + v.flat,
        ]),
      );
      info.append(element("p", "muted", model.description));
    } else if (tab === "weapons") {
      for (const weapon of model.weapons) {
        const card = element("article", "formation-weapon-detail");
        card.append(element("strong", "", weapon.name));
        metrics(card, [
          ["总威力", formatNumber(weapon.damage)],
          ["命中", weapon.hit + "%"],
          ["射程", weapon.min + "–" + weapon.max],
          ["发射", weapon.shotCount + " 发"],
          ["EN", weapon.en],
          ["AP", Rules.actionCost(weapon)],
          ...(Number.isInteger(weapon.maxUses) ? [["使用次数", weapon.maxUses]] : []),
        ]);
        card.append(WeaponInfo.effects(weapon), WeaponInfo.inspector(weapon));
        info.append(card);
      }
    } else {
      for (const skill of [...SkillControls.commandAbilities(model), ...(model.skills || [])]) {
        const card = element("article", "formation-weapon-detail");
        card.append(
          element("strong", "", skill.name),
          element("p", "", SkillControls.description(skill)),
        );
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
      byId("productionKitPrice").replaceChildren();
      byId("productionKitQuantity").textContent = "";
      byId("productionBaseKitName").textContent = "生产单位";
      byId("produceUnit").disabled = byId("buyProductionKit").disabled = true;
      const canvas = byId("productionPreview");
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (!prefab.weaponKits.some((k) => k.id === kitId))
      kitId = Economy.baseKit(prefab.id) || prefab.weaponKits[0].id;
    for (const kit of prefab.weaponKits) select.add(new Option(kit.name, kit.id));
    select.value = kitId;
    select.disabled = false;
    const id = prefab.id + "__" + kitId,
      model = UnitModels[id];
    const offer = Economy.catalog.offers[Economy.baseModel(prefab.id)];
    byId("productionUnitName").textContent = prefab.code + " " + prefab.name;
    Formation.renderPreview(id, byId("productionPreview"));
    renderInfo(model);
    const reason = prefab.wip
      ? "WIP"
      : !allows(prefab)
        ? PlayerProfile.faction() !== "PMC" && PlayerProfile.faction() !== prefab.faction
          ? "阵营不匹配"
          : "尚未开发"
        : !offer
          ? "原工厂没有此单位的生产方案"
          : !Economy.affordable(offer)
            ? "资金或物资不足"
            : "";
    resources(byId("productionPrice"), offer || {}, { compact: true });
    byId("productionPrice").hidden = !offer;
    byId("productionQuantity").textContent =
      (offer ? "每批 " + offer.quantity + " 台 · " : "") +
      "已持有 " +
      Economy.quantity(prefab.id) +
      " 台";
    byId("produceUnit").disabled = !!reason;
    byId("produceUnit").textContent = "生产单位";
    byId("produceUnit").title = reason;
    const baseKit = Economy.baseKit(prefab.id);
    byId("productionBaseKitName").textContent = "生产单位";
    const price = Economy.kitPrice(id);
    resources(byId("productionKitPrice"), price || {}, { compact: true });
    byId("productionKitPrice").hidden = !price;
    byId("productionKitQuantity").textContent = price
      ? "每批 " + price.quantity + " 套 · 已持有 " + Economy.kitQuantity(id) + " 套"
      : kitId === baseKit
        ? "单位自带此套件，无需购买"
        : "暂无原厂套件价格";
    const kitReason = !price
      ? byId("productionKitQuantity").textContent
      : !Economy.canBuyKit(id, PlayerProfile.faction())
        ? reason
        : !Economy.affordable(price)
          ? "资金或物资不足"
          : "";
    byId("buyProductionKit").disabled = !!kitReason;
    byId("buyProductionKit").title = kitReason;
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
      card.type = "button";
      card.dataset.unitId = prefab.id;
      card.dataset.locked = String(!allows(prefab));
      card.setAttribute("role", "option");
      card.setAttribute("aria-selected", String(selectedId === prefab.id));
      const image = element("img");
      image.src = unitIcon(prefab.id + "__" + prefab.weaponKits[0].id);
      image.alt = "";
      image.loading = "lazy";
      const text = element("span", "production-unit-info"),
        baseModel = Economy.baseModel(prefab.id),
        offer = Economy.catalog.offers[baseModel];
      const count = Economy.quantity(prefab.id);
      const summary = Formation.unitSummaryTags(
        prefab.stats.adaptability,
        null,
        UnitModels[baseModel]?.cost ?? prefab.stats.cost,
      );
      const cost = summary.querySelector(".cost");
      text.append(
        element("strong", "", prefab.code + " " + prefab.name),
        Formation.unitTags(prefab),
        summary,
      );
      const price = element("span", "production-unit-price"),
        balance = element("span", "resource-balance");
      if (offer) resources(balance, offer);
      else balance.append(element("span", "muted", "暂无原厂价格"));
      price.append(cost, balance);
      const owned = element("small", "muted production-owned");
      owned.append(element("span", "", "已持有 " + count + " 台"));
      if (offer) owned.append(element("span", "production-batch-count", "+" + offer.quantity));
      if (prefab.wip || !allows(prefab))
        owned.append(element("span", "", prefab.wip ? "WIP" : "未解锁"));
      text.append(price, owned);
      card.append(image, text);
      card.onclick = () => {
        selectedId = prefab.id;
        kitId = null;
        byId("productionStatus").textContent = "";
        GameAudio.selectUnit(prefab);
        render();
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
    returnView = "menu";
    onReturn = null;
    byId("closeProduction").textContent = "返回主菜单";
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
  byId("produceUnit").onclick = () => {
    const offer = Economy.catalog.offers[Economy.baseModel(selectedId)];
    let success;
    try {
      success = Economy.produce(selectedId, PlayerProfile.faction());
    } catch (error) {
      byId("productionStatus").textContent = "生产失败：" + Economy.errorMessage(error);
      return;
    }
    finishPurchase(success ? "生产完成：+" + offer.quantity + " 台" : "当前无法生产");
  };
  byId("buyProductionKit").onclick = () => {
    const id = selectedId + "__" + kitId,
      price = Economy.kitPrice(id);
    let success;
    try {
      success = Economy.buyKit(id, PlayerProfile.faction());
    } catch (error) {
      byId("productionStatus").textContent = "购买失败：" + Economy.errorMessage(error);
      return;
    }
    finishPurchase(success ? "套件购买完成：+" + price.quantity + " 套" : "当前无法购买套件");
  };
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
    filters.faction = filters.era = filters.type = "";
    setupFilters();
    byId("productionSearch").value = unitId || "";
    byId("closeProduction").textContent =
      returnView === "formation" ? "返回编组" : returnView === "room" ? "返回房间" : "返回主菜单";
    setPageView("production");
    render();
  }
  return { render, resources, openUnit, receiveAwards, renderSale };
})();
