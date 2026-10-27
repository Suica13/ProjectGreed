/* One modal purchase flow shared by production and unit previews. */
const KitShop = (() => {
  const dialog = byId("formationKitShop"),
    select = byId("formationKitPurchase");
  document.body.append(dialog); // The shop must also work while the formation screen is hidden.
  let context = null;
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  function render() {
    if (!context) return;
    const id = context.unitId + "__" + select.value,
      price = Economy.kitPrice(id);
    ProductionUI.resources(byId("formationKitWallet"), Economy.snapshot());
    ProductionUI.resources(byId("formationKitPrice"), price || {});
    byId("buyFormationKit").textContent = price
      ? "购买 " + price.quantity + " 套" + (context.equip ? "并装备" : "")
      : "暂无价格";
    const prefab = Rules.catalog.prefabs.find((p) => p.id === context.unitId);
    const faction = context.faction;
    byId("buyFormationKit").disabled =
      !price ||
      !Economy.affordable(price) ||
      prefab.wip ||
      (faction !== "PMC" && faction !== prefab.faction) ||
      !Development.allows(faction, prefab.id);
    byId("formationKitStock").textContent =
      (price ? "每批 " + price.quantity + " 套 · " : "") +
      "已持有 " +
      Economy.kitQuantity(id) +
      " 套" +
      (context.entries
        ? " · 当前可用 " + Economy.freeKits(id, context.entries(), context.exceptIndex) + " 套"
        : "");
    Formation.renderPreview(id, byId("kitPurchasePreview"));
    byId("kitPurchaseWeapons").textContent =
      "武装：" + UnitModels[id].weapons.map((w) => w.name).join("、");
  }
  function close() {
    const trigger = context?.trigger;
    dialog.close();
    context = null;
    if (trigger?.isConnected) trigger.focus();
  }
  function open(unitId, options = {}) {
    const prefab = Rules.catalog.prefabs.find((p) => p.id === unitId);
    const kits = prefab?.weaponKits.filter((k) => Economy.kitPrice(unitId + "__" + k.id)) || [];
    if (!kits.length) return false;
    context = { ...options, unitId, faction: options.faction || PlayerProfile.faction() };
    select.replaceChildren(...kits.map((k) => new Option(k.name, k.id)));
    if (kits.some((k) => k.id === options.kitId)) select.value = options.kitId;
    byId("formationKitShopTitle").textContent = prefab.code + " " + prefab.name + " · 购买套件";
    byId("formationKitShopStatus").textContent = "";
    render();
    dialog.showModal();
    select.focus();
    return true;
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  select.onchange = () => {
    byId("formationKitShopStatus").textContent = "";
    render();
  };
  byId("closeFormationKitShop").onclick = close;
  byId("buyFormationKit").onclick = () => {
    if (!context) return;
    const active = context,
      kitId = select.value,
      id = active.unitId + "__" + kitId;
    let success;
    try {
      success = Economy.buyKit(id, active.faction);
    } catch (error) {
      byId("formationKitShopStatus").textContent = "购买失败：" + Economy.errorMessage(error);
      return;
    }
    if (!success) {
      byId("formationKitShopStatus").textContent = "当前无法购买套件";
      render();
      return;
    }
    const quantity = Economy.kitPrice(id).quantity;
    close();
    active.onPurchase?.(kitId, quantity);
  };
  window.addEventListener("page-changing", () => {
    if (dialog.open) close();
  });
  window.addEventListener("game-assets-ready", () => {
    if (dialog.open) render();
  });
  return { open, close };
})();
