/* Personal progress only: never copy connection credentials or an ongoing match. */
const ProfileSave = (() => {
  const factions = ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"];
  const pilotKey = "projectgreed.custom-pilots.v2.",
    formationKey = "slg-formations-v1.";
  // Archive-only lossless dictionary compression. Runtime receipt lookup stays unchanged.
  function packClaims(store) {
    const groups = new Map();
    for (const [id, match] of Object.entries(store.claimed || {})) {
      if (!groups.has(match)) groups.set(match, []);
      groups.get(match).push(id);
    }
    const { claimed, ...rest } = store;
    return {
      ...rest,
      claimedPacked: [...groups].map(([match, ids]) => {
        let prefix = ids[0];
        for (const id of ids) {
          let n = 0;
          while (n < prefix.length && prefix[n] === id[n]) n++;
          prefix = prefix.slice(0, n);
        }
        return [match, prefix, ids.map((id) => id.slice(prefix.length))];
      }),
    };
  }
  function unpackClaims(store) {
    if (!store || !Array.isArray(store.claimedPacked) || store.claimed !== undefined)
      throw Error("奖励记录压缩格式无效");
    const claimed = {};
    for (const group of store.claimedPacked) {
      if (!Array.isArray(group) || group.length !== 3) throw Error("奖励记录压缩格式无效");
      const [match, prefix, suffixes] = group;
      if (
        typeof match !== "string" ||
        match.length > 200 ||
        typeof prefix !== "string" ||
        prefix.length > 200 ||
        !Array.isArray(suffixes)
      )
        throw Error("奖励记录压缩格式无效");
      for (const suffix of suffixes) {
        if (typeof suffix !== "string" || prefix.length + suffix.length > 200)
          throw Error("奖励记录压缩格式无效");
        const id = prefix + suffix;
        if (!id || Object.hasOwn(claimed, id)) throw Error("奖励记录重复或无效");
        Object.defineProperty(claimed, id, { value: match, enumerable: true });
      }
    }
    const { claimedPacked, ...rest } = store;
    return { ...rest, claimed };
  }
  function encodeData(value = exportData()) {
    const clean = validate(value);
    return {
      ...clean,
      schemaVersion: 2,
      createdAt: value.createdAt || new Date().toISOString(),
      development: packClaims(clean.development),
      economy: packClaims(clean.economy),
    };
  }
  function validate(value) {
    if (value?.format !== "ProjectGreed-profile" || ![1, 2].includes(value.schemaVersion))
      throw Error("不支持的个人存档格式");
    if (value.schemaVersion === 2)
      value = {
        ...value,
        development: unpackClaims(value.development),
        economy: unpackClaims(value.economy),
      };
    const result = {
      format: value.format,
      schemaVersion: 1,
      identity: value.identity
        ? ProfileIdentity.validate(value.identity)
        : ProfileIdentity.snapshot(),
      pilots: {},
      formations: {},
      development: Development.validateProgress(value.development),
      economy: Economy.validate(ProfileMigrations.economy(value.economy)),
    };
    for (const faction of factions) {
      const addedFaction = ["AEUG", "TITANS", "NEO_ZEON"].includes(faction);
      const store =
        value.pilots?.[faction] ?? (addedFaction ? { pilots: [], awards: [] } : undefined);
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
      const formation =
        value.formations?.[faction] ?? (addedFaction ? null : value.formations?.[faction]);
      if (formation === null) {
        result.formations[faction] = null;
        continue;
      }
      if (
        formation?.version !== 3 ||
        !Array.isArray(formation.squads) ||
        !formation.squads.length ||
        formation.squads.length > (faction === "PMC" ? 6000 : 1000) ||
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
    const pilots = Formation.exportPilotStores();
    const roster = Object.values(pilots).flatMap(store => store.pilots);
    for (const faction of factions) {
      const saved = JSON.parse(localStorage.getItem(formationKey + faction) || "null");
      formations[faction] = saved
        ? { ...saved, squads: ProfileStorage.expandSquads(saved.squads, roster),
            index: Number(localStorage.getItem(formationKey + faction + "-active") || 0) }
        : null;
    }
    return {
      ...validate({
        format: "ProjectGreed-profile",
        schemaVersion: 1,
        pilots,
        formations,
        development: Development.exportProgress(),
        economy: Economy.exportProgress(),
      }),
      createdAt: new Date().toISOString(),
    };
  }
  function importData(value) {
    const clean = validate(value),
      writes = new Map();
    // Older faction archives can contain copies of the same pilot; retain the
    // most advanced copy, matching the existing shared-roster migration.
    const uniquePilots = new Map();
    for (const pilot of Object.values(clean.pilots).flatMap(store => store.pilots)) {
      const previous = uniquePilots.get(pilot.id);
      if (!previous || pilot.level > previous.level ||
          (pilot.level === previous.level && pilot.experience > previous.experience))
        uniquePilots.set(pilot.id, pilot);
    }
    const roster = [...uniquePilots.values()];
    for (const faction of factions) {
      writes.set(pilotKey + faction, null);
      const save = clean.formations[faction];
      writes.set(
        formationKey + faction,
        save ? JSON.stringify({ version: 3,
          squads: ProfileStorage.compactSquads(save.squads, roster) }) : null,
      );
      writes.set(formationKey + faction + "-active", save ? String(save.index) : null);
    }
    writes.set("projectgreed.custom-pilots.v3.shared", JSON.stringify({
      pilots: roster,
      awards: [...new Set(Object.values(clean.pilots).flatMap(store => store.awards))],
    }));
    writes.set("projectgreed.custom-pilots.v1", null);
    // A replaced personal profile must not retain large recovery copies of its old wallet.
    // These removals participate in the same rollback as the new profile.
    for (const suffix of [".before-counted-stock", ".before-unit-inventory", ".recovery-backup"])
      writes.set(Economy.key + suffix, null);
    writes.set("slg-formations-v1", null);
    writes.set("slg-formations-v1-active", null);
    writes.set("slg-formations-v1.pmc-unified", null);
    writes.set(ProfileIdentity.key, JSON.stringify(clean.identity));
    writes.set(Economy.key, JSON.stringify(clean.economy));
    writes.set(pilotKey + "migrated", "imported");
    writes.set("projectgreed.developmentProgress.v1", JSON.stringify(clean.development));
    ProfileStorage.replace(writes);
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
  status.id = "profileSaveStatus";
  status.setAttribute("role", "status");
  status.textContent = Economy.storageIssue()
    ? "存档读取失败，原始数据已保留。请导入有效存档或新建存档：" + Economy.storageIssue()
    : "个人进度：驾驶员、编组、累计科技、资金、物资、部署许可及机体／套件库存。导入将覆盖个人进度并刷新页面。";
  exportButton.onclick = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(encodeData())], { type: "application/json" }),
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
      status.textContent = "导入失败：" + Economy.errorMessage(error);
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
        identity: ProfileIdentity.create(),
        pilots,
        formations,
        development: { points: { EFSF: 0, ZEON: 0 }, claimed: {} },
      });
      PlayerProfile.setFaction("PMC");
      location.reload();
    } catch (error) {
      status.textContent = "新建失败：" + Economy.errorMessage(error);
    }
  };
  actions.className = "profile-save-actions";
  actions.append(exportButton, importButton, newButton);
  panel.append(actions, input, status);
  const diagnostics = document.createElement("div");
  diagnostics.className = "profile-save-actions";
  const checkStorage = document.createElement("button");
  checkStorage.id = "checkProfileStorage";
  checkStorage.type = "button";
  checkStorage.textContent = "检查存储";
  const exportDiagnostic = document.createElement("button");
  exportDiagnostic.id = "exportStorageDiagnostic";
  exportDiagnostic.type = "button";
  exportDiagnostic.textContent = "导出存储诊断";
  const diagnosticText = document.createElement("p");
  diagnosticText.id = "profileStorageDiagnostic";
  diagnosticText.className = "settings-help muted";
  diagnosticText.hidden = true;
  diagnosticText.setAttribute("role", "status");
  let lastDiagnostic;
  function inspectStorage() {
    lastDiagnostic = { ...ProfileStorage.inspect(), backend: typeof AppRuntime !== "undefined" && AppRuntime.native ? "native-file" : "browser-localStorage", client: document.title,
      entryMode: location.protocol, browser: navigator.userAgent };
    const kib = bytes => (bytes / 1024).toFixed(1) + " KiB";
    const native = lastDiagnostic.backend === "native-file";
    let message = lastDiagnostic.writable ? (native ? "应用文件存档写入正常。" : "本地存储写入正常。") :
      native ? "应用文件存档暂时无法写入。" :
      lastDiagnostic.errorName === "QuotaExceededError" ?
        "浏览器连极小的数据也无法保存（配额不足）。" : "浏览器禁止或无法保存本地数据。";
    message += (native ? " 当前应用存档估算占用 " : " 当前页面存储估算占用 ") + kib(lastDiagnostic.estimatedBytes) + "。";
    if (!lastDiagnostic.writable)
      message += native ? "请检查磁盘空间与应用数据目录权限，并导出存储诊断以便排查。" : "新建个人存档不会清除历史战役备份或其他页面数据，也不能解除浏览器存储限制。请导出存储诊断以便排查。";
    message += lastDiagnostic.groups.map(group => group.name + " " + kib(group.bytes)).join("；");
    diagnosticText.textContent = message;
    diagnosticText.hidden = false;
    return lastDiagnostic;
  }
  checkStorage.onclick = inspectStorage;
  exportDiagnostic.onclick = () => {
    const report = inspectStorage();
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], {type:"application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ProjectGreed-storage-diagnostic.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  diagnostics.append(checkStorage, exportDiagnostic);
  panel.append(diagnostics, diagnosticText);
  document.getElementById("clientSettingsDialog").append(panel);
  return { validate, exportData, encodeData, importData };
})();
