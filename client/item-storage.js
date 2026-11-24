/* Owned module parts share the persistent economy with the merchant and equipment screens. */
window.ItemStorageUI = (() => {
  const screen = element("section", "warehouse-screen item-storage-screen"),
    main = element("section", "warehouse-main"),
    header = element("header"),
    tabs = element("nav", "warehouse-tabs"),
    partsTab = element("button", "", "零件"),
    materialsTab = element("button", "", "材料"),
    itemsTab = element("button", "", "道具"),
    summary = element("span", "item-storage-summary"),
    body = element("div", "item-storage-body"),
    list = element("div", "item-storage-list"),
    grid = element("div", "item-storage-grid"),
    detail = element("aside", "item-storage-detail");
  screen.id = "itemStorageScreen";
  screen.hidden = true;
  partsTab.type = materialsTab.type = "button";
  partsTab.setAttribute("aria-pressed", "true");
  partsTab.id = "warehousePartsTab";
  materialsTab.id = "warehouseMaterialsTab";
  tabs.setAttribute("aria-label", I18n.text("仓库"));
  itemsTab.type = "button";
  itemsTab.id = "warehouseItemsTab";
  tabs.append(partsTab, itemsTab, materialsTab);
  header.append(tabs, summary);
  grid.setAttribute("aria-label", I18n.text("零件"));
  detail.setAttribute("aria-live", "polite");
  list.tabIndex = 0;
  list.setAttribute("role", "region");
  list.append(grid);
  body.append(list, detail);
  main.append(header, body);
  screen.append(main);
  document.body.append(screen);
  let category = "parts";
  const selected = { parts: null, items: "0079t1-token", materials: null };
  for (const [key, tab] of [["parts", partsTab], ["items", itemsTab], ["materials", materialsTab]])
    tab.onclick = () => { category = key; list.scrollTop = 0; render(); };

  function render() {
    const state = Economy.snapshot(), labels = { parts: "零件", items: "道具", materials: "材料" };
    const owned = category === "parts"
      ? UnitPlugins.catalog.filter(part => (state.pluginInventory[part.id] || 0) > 0)
        .map(part => ({ id: part.id, name: part.name, count: state.pluginInventory[part.id], part }))
      : category === "items" ? Economy.supplyPools.filter(pool => (state.itemInventory[pool.tokenId] || 0) > 0).map(pool => ({id:pool.tokenId,name:pool.tokenName,count:state.itemInventory[pool.tokenId]})) : [];
    if (!owned.some(item => item.id === selected[category])) selected[category] = owned[0]?.id || null;
    for (const [key, tab] of [["parts", partsTab], ["items", itemsTab], ["materials", materialsTab]])
      tab.setAttribute("aria-pressed", String(category === key));
    grid.setAttribute("aria-label", I18n.text(labels[category]));
    list.setAttribute("aria-label", I18n.text(labels[category]) + "单元格列表");
    summary.textContent = `${I18n.text("种类")} ${owned.length} · ${I18n.text("持有")} ${formatNumber(owned.reduce((sum, item) => sum + item.count, 0))}`;
    const scroll = list.scrollTop;
    grid.replaceChildren();
    for (const item of owned) {
      const slot = element("button", "item-storage-slot");
      slot.type = "button";
      slot.dataset.itemId = item.id;
      slot.title = I18n.text(item.name);
      slot.setAttribute("aria-label", `${I18n.text(item.name)} ×${formatNumber(item.count)}`);
      slot.setAttribute("aria-pressed", String(selected[category] === item.id));
      if (item.part) {
        slot.dataset.pluginId = item.id;
        slot.dataset.rarity = item.part.rarity;
        const image = element("img");
        image.src = ART.assets[ART.pluginIcons[item.id]];
        image.alt = "";
        image.draggable = false;
        slot.append(image, element("span", "item-storage-rarity", "★".repeat(item.part.rarity)));
      } else slot.append(element("span", "supply-token-symbol", "◈"));
      slot.append(element("span", "item-storage-count", "×" + formatNumber(item.count)));
      slot.onclick = () => {
        selected[category] = item.id;
        render();
        grid.querySelector('button[aria-pressed="true"]')?.focus({ preventScroll: true });
      };
      grid.append(slot);
    }
    // All categories share the same cells; empty cells impose no capacity limit.
    for (let i = owned.length; i < Math.max(24, Math.ceil(owned.length / 6) * 6); i++) {
      const slot = element("span", "item-storage-slot is-empty");
      slot.setAttribute("aria-hidden", "true");
      grid.append(slot);
    }
    list.scrollTop = scroll;
    detail.replaceChildren();
    const item = owned.find(item => item.id === selected[category]);
    if (!item) {
      detail.append(element("h3", "", labels[category]), element("p", "muted", "暂无持有的" + labels[category]));
      if (category === "materials") detail.append(element("p", "muted", "材料获取暂未开放"));
      return;
    }
    const counts = element("dl", "item-storage-quantities");
    if (item.part) {
      const available = Economy.pluginQuantity(item.id);
      detail.append(UnitPreview.pluginCard(item.part));
      for (const [label, value] of [["持有", item.count], ["可用", available], ["已装配", item.count - available]])
        counts.append(element("dt", "", label), element("dd", "", formatNumber(value)));
    } else {
      detail.append(element("h3", "", item.name), element("span", "supply-token-symbol", "◈"),
        element("p", "", "在联络终端的补给分页中抽取商品，每次消耗1枚。目前暂无获取途径。"));
      counts.append(element("dt", "", "持有"), element("dd", "", formatNumber(item.count)));
    }
    detail.append(counts);
  }
  window.addEventListener("economy-changed", () => {
    if (!screen.hidden) render();
  });
  window.addEventListener("language-change", () => {
    tabs.setAttribute("aria-label", I18n.text("仓库"));
    grid.setAttribute("aria-label", I18n.text("零件"));
    if (!screen.hidden) render();
  });
  return {
    open() {
      render();
      setPageView("itemStorage");
    },
  };
})();
