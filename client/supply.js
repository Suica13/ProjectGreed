/* Personal supply draws use the same atomic wallet and warehouse as contact rewards. */
window.SupplyUI = (() => {
  let root = null, selected = Economy.supplyPools[0].id, busy = false, results = [];
  const button = (label, action, cls = "") => {
    const node = element("button", cls, label);
    node.type = "button";
    node.onclick = action;
    return node;
  };
  function portrait(unitId, featured = false, index = 0, count = 2) {
    const modelId = featured && unitId === "RX_78_5" ? "RX_78_5__kit_0" : Economy.defaultModel(unitId);
    return SupplyDelivery.sprite(modelId, featured
      ? { angle: count === 4 ? [315, 45, 225, 135][index] : index % 2 === 0 ? 270 : 90, shooting: true, pixelRatio: 2 } : {});
  }
  function resultName(result) {
    if (result.itemId) return I18n.text(Economy.supplyPools.find(pool => pool.tokenId === result.itemId).tokenName) + " ×" + result.quantity;
    if (result.unitId) return I18n.text(UnitModels[Economy.defaultModel(result.unitId)].name) +
      (result.uses ? " · " + I18n.text("租赁") + " " + result.uses + I18n.text("次") : " ×1");
    if (result.pluginId) return I18n.text(UnitPlugins.byId.get(result.pluginId).name) + " ×1";
    return I18n.text(result.kind === "money" ? "资金" : "物资") + " +" + formatNumber(result.quantity);
  }
  function rewardCard(result) {
    const card = element("article", "supply-result"), icon = element("div", "supply-reward-icon");
    card.dataset.grade = result.grade;
    card.dataset.rewardKind = result.kind;
    if (result.unitId) icon.append(portrait(result.unitId));
    else if (result.pluginId) {
      const image = element("img");
      image.src = ART.assets[ART.pluginIcons[result.pluginId]];
      image.alt = UnitPlugins.byId.get(result.pluginId).name;
      icon.append(image);
    } else if (result.itemId) icon.append(element("span", "supply-token-symbol", "◈"));
    else icon.append(ProductionUI.resourceIcon(result.kind));
    card.append(element("strong", "", result.grade + "品"), icon, element("span", "", resultName(result)));
    return card;
  }
  function showProducts() {
    const dialog = element("dialog", "contact-terminal supply-products"), heading = element("header"), body = element("div", "supply-products-body");
    heading.append(element("h2", "", "商品一览"), button("关闭", () => dialog.close()));
    body.append(element("p", "muted", "以下百分比均为单次抽取的总概率，类内商品等概率。每次获得一项；十连独立抽取，无额外保底。S、A、B品使用指定单位清单；C品仅包含资金、物资、代币和零件。所有单位均送至保管库，租赁次数以各商品标注为准。"));
    for (const grade of Economy.supplyProducts(selected)) {
      const section = element("section", "supply-product-grade");
      section.dataset.grade = grade.id;
      section.append(element("h3", "", grade.id + "品 · " + grade.weight + "%"));
      for (const reward of grade.rewards) {
        const chance = reward.chance;
        const title = reward.kind === "unit" ? (reward.unitIds ? "指定单位 · 库存 ×1" : `0079 T1/T2 · ${reward.minCost} COST以上 · 库存 ×1`)
          : reward.kind === "rental" ? `指定单位租赁机 · 剩余次数 ${reward.uses} 次`
          : reward.kind === "item" ? `${Economy.supplyPools.find(pool => pool.id === selected).tokenName} ×${reward.quantity}`
          : reward.kind === "featured" ? "封面单位 · 库存 ×1"
          : reward.kind === "plugin" ? `0079年代随机零件 · 稀有度${reward.rarity} ×1`
          : (reward.kind === "money" ? "资金" : "物资") + ` · ${reward.min}–${reward.max}`;
        section.append(element("h4", "", title + ` · ${Number(chance.toFixed(4))}%`));
        if (reward.choices.length) {
          const list = element("ul");
          for (const id of reward.choices) {
            const model = UnitModels[Economy.defaultModel(id)];
            list.append(element("li", "", (reward.kind === "plugin" ? UnitPlugins.byId.get(id).name : model.name + " · " + model.cost + " COST") +
              ` · ${Number((chance / reward.choices.length).toFixed(4))}%`));
          }
          section.append(list);
        }
      }
      body.append(section);
    }
    dialog.append(heading, body);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    const close = () => dialog.close();
    window.addEventListener("page-changing", close, { once: true });
    dialog.addEventListener("close", () => window.removeEventListener("page-changing", close), { once: true });
    for (const type of ["keydown", "keyup"]) dialog.addEventListener(type, event => event.stopPropagation());
    document.body.append(dialog);
    dialog.showModal();
  }
  async function draw(count) {
    if (busy || Net.started) return;
    busy = true;
    try {
      results = Economy.drawSupply(selected, count);
      render();
      await SupplyDelivery.open(results, rewardCard);
    } catch (error) { note(Economy.errorMessage(error)); }
    finally { busy = false; render(); }
  }
  function render() {
    if (!root || root.hidden) return;
    const pool = Economy.supplyPools.find(pool => pool.id === selected), tokens = Economy.snapshot().itemInventory[pool.tokenId] || 0;
    const storage = Economy.supplyStorageStatus();
    const list = element("nav", "supply-pool-list"), detail = element("section", "supply-detail"), cover = element("div", "supply-cover"), units = element("div", "supply-featured");
    list.setAttribute("aria-label", I18n.text("扭蛋池"));
    list.append(element("h2", "", "补给扭蛋机"), element("small", "muted", "VERSION SELECTION"));
    for (const entry of Economy.supplyPools) {
      const card = button("", () => { selected = entry.id; results = []; render(); }, "supply-pool-card");
      card.dataset.poolId = entry.id;
      card.setAttribute("aria-pressed", String(selected === entry.id));
      card.append(element("span", "supply-pool-number", "VOL. " + String(Economy.supplyPools.indexOf(entry) + 1).padStart(2, "0")));
      const art = element("div", "supply-card-art"); art.dataset.count = entry.featured.length;
      entry.featured.forEach((unitId, index) => art.append(portrait(unitId, true, index, entry.featured.length)));
      card.append(art);
      const label = element("strong", "", entry.name);
      if (entry.machineName !== entry.name) label.append(element("small", "supply-pool-era", entry.machineName));
      card.append(label);
      list.append(card);
    }
    cover.append(element("small", "supply-kicker", pool.machineName + " / SPECIAL SUPPLY"), element("h2", "", pool.name));
    for (const [index, unitId] of pool.featured.entries()) {
      const unit = element("figure"), model = UnitModels[Economy.defaultModel(unitId)];
      unit.append(portrait(unitId, true, index, pool.featured.length), element("figcaption", "", model.name));
      units.append(unit);
    }
    cover.append(units, element("span", "supply-featured-label", "注目单位 · " + pool.featured.map(id => UnitModels[Economy.defaultModel(id)].name).join(" / ")));
    if (pool.featured.length > 2) { units.style.gridTemplateRows = "repeat(2, minmax(0, 1fr))"; units.classList.add("supply-featured-multiple"); }
    const rates = element("div", "supply-rates");
    for (const grade of pool.grades) {
      const badge = element("span", "", grade.id + "品 " + grade.weight + "%");
      badge.dataset.grade = grade.id;
      rates.append(badge);
    }
    const wallet = element("div", "supply-wallet"), tokenCount = element("strong", "", "◈ " + formatNumber(tokens));
    tokenCount.id = "supplyTokenCount";
    wallet.append(element("span", "", "剩余" + pool.tokenName), tokenCount, button("商品一览", showProducts));
    if (storage.blocked) wallet.append(element("small", "supply-capacity-warning", "保管库已超过99台，请先领取单位"));
    const actions = element("div", "supply-actions");
    for (const count of [1, 10]) {
      const action = button("", () => draw(count), "supply-draw");
      action.id = count === 1 ? "supplyDrawOnce" : "supplyDrawTen";
      action.append(element("strong", "", count === 1 ? "抽取一次" : "抽取十次"), element("small", "", `消耗 ${count} 枚${pool.tokenName}`));
      action.disabled = busy || Net.started || tokens < count || storage.blocked;
      if (storage.blocked) action.title = "保管库已超过99台，请先领取单位";
      actions.append(action);
    }
    const history = element("section", "supply-results");
    history.setAttribute("aria-live", "polite");
    if (results.length && !busy) {
      const review = button("查看上次补给", () => SupplyDelivery.open(results, rewardCard, { revealOnly: true }));
      review.id = "supplyLastResults";
      review.dataset.count = String(results.length);
      history.append(element("small", "muted", `已获得 ${results.length} 项奖励`), review);
    }
    detail.append(cover, rates, wallet, actions, history);
    root.replaceChildren(list, detail);
  }
  window.addEventListener("economy-changed", render);
  window.addEventListener("language-change", render);
  return { open(host) { root = host; render(); } };
})();
