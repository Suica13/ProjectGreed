/* One-way conversions at storage and import boundaries, never live gameplay APIs. */
"use strict";
const ProfileMigrations = (() => {
  function licensesFromInventory(inventory) {
    if (!inventory || typeof inventory !== "object" || Array.isArray(inventory))
      throw Error("旧库存存档格式无效");
    const licenses = {};
    for (const [id, count] of Object.entries(inventory)) {
      if (!Number.isSafeInteger(count) || count < 0) throw Error("旧库存数量无效：" + id);
      if (count > 0)
        Object.defineProperty(licenses, id.split("__")[0], {
          value: true,
          enumerable: true,
          configurable: true,
        });
    }
    return licenses;
  }
  function economy(value) {
    if (!value || typeof value !== "object") return value;
    const { inventory, kits, ...current } = value;
    if (current.licenses === undefined && inventory !== undefined)
      current.licenses = licensesFromInventory(inventory);
    return { ...current, schemaVersion: 2 };
  }
  function activityStore(state) {
    function rewards(value) {
      if (!value || typeof value !== "object") return value;
      const { inventory, ...current } = value;
      if (current.licenses === undefined)
        current.licenses = inventory === undefined ? {} : licensesFromInventory(inventory);
      return current;
    }
    for (const activity of state.activities || []) activity.rewards = rewards(activity.rewards);
    for (const player of Object.values(state.players || {}))
      for (const mail of player.mail || []) mail.rewards = rewards(mail.rewards);
    return state;
  }
  function battleGame(game) {
    for (const unit of game?.units || []) {
      if (unit.inventoryUnitId !== undefined) unit.deploymentUnitId ??= unit.inventoryUnitId;
      if (unit.inventoryModel !== undefined) unit.deploymentModel ??= unit.inventoryModel;
      delete unit.inventoryUnitId;
      delete unit.inventoryModel;
    }
    return game;
  }
  return { economy, activityStore, battleGame };
})();
if (typeof module !== "undefined") module.exports = ProfileMigrations;
