/* Personal progress only: never copy connection credentials or an ongoing match. */
const ProfileSave = (() => {
  const factions = ["PMC", "EFSF", "ZEON"];
  const pilotKey = "projectgreed.custom-pilots.v2.",
    formationKey = "slg-formations-v1.";
  function validate(value) {
    if (value?.format !== "ProjectGreed-profile" || value.schemaVersion !== 1)
      throw Error("不支持的个人存档格式");
    const result = {
      format: value.format,
      schemaVersion: 1,
      pilots: {},
      formations: {},
      development: Development.validateProgress(value.development),
      economy: Economy.validate(value.economy),
    };
    for (const faction of factions) {
      const store = value.pilots?.[faction];
      if (
        !Array.isArray(store?.pilots) ||
        !Array.isArray(store.awards) ||
        store.pilots.length > 10000 ||
        store.awards.some((id) => typeof id !== "string" || id.length > 200)
      )
        throw Error("驾驶员存档无效");
      const pilots = store.pilots.map((p) => {
        if (p.faction !== faction) throw Error("驾驶员阵营无效");
        return PilotSystem.custom(p);
      });
      if (new Set(pilots.map((p) => p.id)).size !== pilots.length) throw Error("驾驶员编号重复");
      result.pilots[faction] = { pilots, awards: [...new Set(store.awards)] };
      const formation = value.formations?.[faction];
      if (formation === null) {
        result.formations[faction] = null;
        continue;
      }
      if (
        formation?.version !== 3 ||
        !Array.isArray(formation.squads) ||
        !formation.squads.length ||
        formation.squads.length > 1000 ||
        !Number.isInteger(formation.index) ||
        formation.index < 0 ||
        formation.index >= formation.squads.length
      )
        throw Error("编组存档无效");
      result.formations[faction] = {
        version: 3,
        index: formation.index,
        squads: formation.squads.map((squad) => {
          if (typeof squad.name !== "string" || !squad.name.trim() || squad.name.length > 100)
            throw Error("编组名称无效");
          return {
            name: squad.name,
            units:
              Array.isArray(squad.units) && !squad.units.length
                ? []
                : Rules.validateFormation(squad.units, Infinity, Rules.catalog.formation.maxUnits),
          };
        }),
      };
    }
    return result;
  }
  function exportData() {
    const formations = {};
    for (const faction of factions) {
      const saved = JSON.parse(localStorage.getItem(formationKey + faction) || "null");
      formations[faction] = saved
        ? { ...saved, index: Number(localStorage.getItem(formationKey + faction + "-active") || 0) }
        : null;
    }
    return {
      ...validate({
        format: "ProjectGreed-profile",
        schemaVersion: 1,
        pilots: Formation.exportPilotStores(),
        formations,
        development: Development.exportProgress(),
        economy: Economy.snapshot(),
      }),
      createdAt: new Date().toISOString(),
    };
  }
  function importData(value) {
    const clean = validate(value),
      writes = new Map();
    for (const faction of factions) {
      writes.set(pilotKey + faction, JSON.stringify(clean.pilots[faction]));
      const save = clean.formations[faction];
      writes.set(
        formationKey + faction,
        save ? JSON.stringify({ version: 3, squads: save.squads }) : null,
      );
      writes.set(formationKey + faction + "-active", save ? String(save.index) : null);
    }
    writes.set(Economy.key, JSON.stringify(clean.economy));
    writes.set(pilotKey + "migrated", "imported");
    writes.set("projectgreed.developmentProgress.v1", JSON.stringify(clean.development));
    const previous = new Map([...writes.keys()].map((key) => [key, localStorage.getItem(key)]));
    const write = (key, value) =>
      value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
    try {
      for (const [key, value] of writes) write(key, value);
    } catch (error) {
      for (const [key, value] of previous) write(key, value);
      throw error;
    }
  }
  const panel = document.createElement("div"),
    actions = document.createElement("div"),
    status = document.createElement("p");
  panel.className = "profile-save-controls";
  const exportButton = document.createElement("button"),
    importButton = document.createElement("button"),
    newButton = document.createElement("button"),
    input = document.createElement("input");
  exportButton.id = "exportProfileSave";
  exportButton.textContent = "导出存档";
  importButton.id = "importProfileSave";
  importButton.textContent = "导入存档";
  newButton.id = "newProfileSave";
  newButton.textContent = "新建存档";
  exportButton.type = importButton.type = newButton.type = "button";
  input.type = "file";
  input.accept = ".json,application/json";
  input.hidden = true;
  input.id = "profileSaveFile";
  status.className = "settings-help muted";
  status.setAttribute("role", "status");
  status.textContent =
    "个人进度：驾驶员、编组、科技、资金、物资和单位库存。导入将覆盖个人进度并刷新页面。";
  exportButton.onclick = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(exportData(), null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "ProjectGreed-profile-" + new Date().toISOString().slice(0, 10) + ".json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "个人存档已导出";
    } catch (error) {
      status.textContent = "导出失败：" + error.message;
    }
  };
  const canImport = () => typeof Net === "undefined" || !Net.active;
  importButton.onclick = () => {
    if (!canImport()) {
      status.textContent = "请先退出当前战局，再导入个人存档";
      return;
    }
    input.click();
  };
  input.onchange = async () => {
    try {
      if (!canImport()) throw Error("请先退出当前战局");
      const file = input.files[0];
      if (!file) return;
      if (file.size > 32 * 1024 * 1024) throw Error("存档超过32MB");
      importData(JSON.parse(await file.text()));
      location.reload();
    } catch (error) {
      status.textContent = "导入失败：" + error.message;
      input.value = "";
    }
  };
  newButton.onclick = async () => {
    if (!canImport()) {
      status.textContent = "请先退出当前战局，再新建存档";
      return;
    }
    if (
      !(await GameDialog.confirm(
        "新建存档将重置驾驶员、编组、科技、资金、物资和单位库存，是否继续？",
        {
          title: "新建存档",
          confirmText: "新建存档",
          danger: true,
        },
      ))
    )
      return;
    if (!canImport()) {
      status.textContent = "请先退出当前战局，再新建存档";
      return;
    }
    try {
      const pilots = {},
        formations = {};
      for (const faction of factions) {
        pilots[faction] = { pilots: [], awards: [] };
        formations[faction] = null;
      }
      importData({
        format: "ProjectGreed-profile",
        schemaVersion: 1,
        pilots,
        formations,
        development: { points: { EFSF: 0, ZEON: 0 }, claimed: {} },
      });
      PlayerProfile.setFaction("EFSF");
      location.reload();
    } catch (error) {
      status.textContent = "新建失败：" + error.message;
    }
  };
  actions.className = "profile-save-actions";
  actions.append(exportButton, importButton, newButton);
  panel.append(actions, input, status);
  document.getElementById("clientSettingsDialog").append(panel);
  return { validate, exportData, importData };
})();
