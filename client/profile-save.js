/* Personal progress controls; serialization is shared with the offline save editor. */
(() => {
  const factions = ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON", "EFSF_0093", "NEO_ZEON_0093", "OMNI", "ZAFT"];
  const { validate, exportData, encodeData, importData } = ProfileSave;
  const panel = document.createElement("div"),
    actions = document.createElement("div"),
    status = document.createElement("p");
  panel.className = "profile-save-controls";
  const exportButton = document.createElement("button"),
    importButton = document.createElement("button"),
    newButton = document.createElement("button"),
    input = document.createElement("input");
  exportButton.id = "exportProfileSave";
  exportButton.textContent = "导出跨平台 JSON 存档";
  importButton.id = "importProfileSave";
  importButton.textContent = "导入跨平台 JSON 存档";
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
    : "个人进度：驾驶员、编组、累计科技、资金、物资、部署许可及机体库存。Windows / Android 可互相导入 JSON；导入将覆盖个人进度并刷新页面。";
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
      const limit = 64;
      if (file.size > limit * 1024 * 1024) throw Error("存档超过" + limit + "MB");
      const value = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
      importData(value);
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
})();
