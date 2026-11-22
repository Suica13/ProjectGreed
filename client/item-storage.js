/* Owned module parts share the persistent economy with the merchant and equipment screens. */
window.ItemStorageUI = (() => {
  const screen = element("section", "warehouse-screen item-storage-screen"),
    main = element("section", "warehouse-main"),
    header = element("header"),
    tabs = element("nav", "warehouse-tabs"),
    partsTab = element("button", "", "零件"),
    materialsTab = element("button", "", "材料"),
    summary = element("span", "item-storage-summary"),
    body = element("div", "item-storage-body"),
    grid = element("div", "item-storage-grid"),
    detail = element("aside", "item-storage-detail");
  screen.id = "itemStorageScreen";
  screen.hidden = true;
  partsTab.type = materialsTab.type = "button";
  partsTab.setAttribute("aria-pressed", "true");
  materialsTab.disabled = true;
  materialsTab.title = I18n.text("开发中");
  tabs.setAttribute("aria-label", I18n.text("仓库"));
  tabs.append(partsTab, materialsTab);
  header.append(tabs, summary);
  grid.setAttribute("aria-label", I18n.text("零件"));
  detail.setAttribute("aria-live", "polite");
  body.append(grid, detail);
  main.append(header, body);
  screen.append(main);
  document.body.append(screen);
  let selected = null;

  function render() {
    const inventory = Economy.snapshot().pluginInventory,
      owned = UnitPlugins.catalog.filter((part) => (inventory[part.id] || 0) > 0);
    if (!owned.some((part) => part.id === selected)) selected = owned[0]?.id || null;
    summary.textContent = `${I18n.text("种类")} ${owned.length} · ${I18n.text("持有")} ${owned.reduce((sum, part) => sum + inventory[part.id], 0)}`;
    grid.replaceChildren();
    for (const part of owned) {
      const slot = element("button", "item-storage-slot"),
        image = element("img"),
        count = element("span", "item-storage-count", "×" + inventory[part.id]);
      slot.type = "button";
      slot.dataset.pluginId = part.id;
      slot.dataset.rarity = part.rarity;
      slot.title = I18n.text(part.name);
      slot.setAttribute("aria-label", `${I18n.text(part.name)} ×${inventory[part.id]}`);
      slot.setAttribute("aria-pressed", String(selected === part.id));
      image.src = ART.assets[ART.pluginIcons[part.id]];
      image.alt = "";
      image.draggable = false;
      slot.append(image, element("span", "item-storage-rarity", "★".repeat(part.rarity)), count);
      slot.onclick = () => {
        selected = part.id;
        render();
        grid.querySelector('button[aria-pressed="true"]')?.focus({ preventScroll: true });
      };
      grid.append(slot);
    }
    // Empty cells are visual placeholders, not an additional inventory capacity limit.
    for (let i = owned.length; i < Math.max(24, Math.ceil(owned.length / 6) * 6); i++) {
      const slot = element("span", "item-storage-slot is-empty");
      slot.setAttribute("aria-hidden", "true");
      grid.append(slot);
    }
    detail.replaceChildren();
    const part = UnitPlugins.byId.get(selected);
    if (!part) {
      detail.append(element("p", "muted", "暂无持有的零件"));
      return;
    }
    const counts = element("dl", "item-storage-quantities"),
      available = Economy.pluginQuantity(part.id);
    for (const [label, value] of [
      ["持有", inventory[part.id]],
      ["可用", available],
      ["已装配", inventory[part.id] - available],
    ])
      counts.append(element("dt", "", label), element("dd", "", String(value)));
    detail.append(UnitPreview.pluginCard(part), counts);
  }
  window.addEventListener("economy-changed", () => {
    if (!screen.hidden) render();
  });
  window.addEventListener("language-change", () => {
    materialsTab.title = I18n.text("开发中");
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
